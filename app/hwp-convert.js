// HWP-서식변환: [HWP 편집] > [노조 서식으로 만들기]의 작은 창과 편집기 칸막이 안 보조 스크립트(studio-convert.js)와의 주고받기.
// 창: 문서 종류 칩(보고서·공문·회의자료) + 글 넣는 칸(붙여 넣기·글 파일 끌어 놓기) + 오른쪽 아래 [취소][만들기].
// 이 파일은 화면과 메시지만 맡고, 일(양식 찾기 → AI → 칸막이에서 채우기 → 편집기에 열기)은 hwp-lab.js가 한다.
// 넣은 글은 이 창 안(메모리)에만 있다: 기기·서버 저장소에 남기지 않고, 닫으면 사라진다. 서버로는 [만들기] 때 AI 요청 한 번만 간다.
import {AI_SUMMARY_TEXT,aiSummaryRetryable} from './basket-ai-summary.js';
import {DOC_TYPES,CONVERT_MAX_CHARS,cleanPasted,textState,dropProblem} from './hwp-convert-model.mjs';

export const CONVERT_TEXT=Object.freeze({
  ...AI_SUMMARY_TEXT,
  not_ready:'AI 서식 만들기는 아직 준비 중이에요. 잠시 뒤 다시 시도해 주세요. 아무것도 바뀌지 않았어요.',
  unsupported_kind:'AI 서식 만들기는 아직 준비 중이에요. 잠시 뒤 다시 시도해 주세요. 아무것도 바뀌지 않았어요.',
  invalid_request:`글을 확인해 주세요. ${CONVERT_MAX_CHARS.toLocaleString('ko-KR')}자까지, 이상한 문자가 없어야 해요.`,
  daily_limit:'오늘 AI를 쓸 수 있는 횟수를 다 썼어요. 내일 다시 시도해 주세요.',
  monthly_limit:'이번 달 AI 한도에 닿았어요. 글은 직접 [노조 양식으로 새 문서]에 옮겨 주세요.',
  ai_invalid_response:'AI 답을 읽지 못했어요. 다시 [만들기]를 눌러 주세요. 아무것도 바뀌지 않았어요.',
});
export const convertRetryable=code=>aiSummaryRetryable(code);

// 칸막이 안 보조 스크립트에 양식 바이트와 문단 목록을 보내고 HWP 바이트를 받는다. 한 번만 보내고 시간이 지나면 포기한다.
export const CONVERT_ENGINE_TIMEOUT_MS=60000;
export const ENGINE_TEXT=Object.freeze({
  no_engine:'편집기 엔진을 찾지 못했어요. 페이지를 새로 열어 다시 시도해 주세요.',
  empty_template:'양식 파일에 본문 자리가 없어요. 다른 양식 파일을 등록해 주세요.',
  paragraph_count:'문단을 넣는 중 어긋났어요. 다시 시도해 주세요. 아무것도 바뀌지 않았어요.',
  paragraph_empty:'문단을 넣는 중 어긋났어요. 다시 시도해 주세요. 아무것도 바뀌지 않았어요.',
  bad_request:'양식 파일이나 글 형식이 맞지 않아요. 아무것도 바뀌지 않았어요.',
  timeout:'편집기가 답하지 않아요. 페이지를 새로 열어 다시 시도해 주세요.',
  engine_error:'양식에 글을 넣지 못했어요. 다른 양식 파일로 시도해 주세요. 아무것도 바뀌지 않았어요.',
});
export function requestEngineBuild(frameWindow,base,plan,{timeoutMs=CONVERT_ENGINE_TIMEOUT_MS,host=window}={}){
  return new Promise((resolve,reject)=>{
    const id=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
    let timer=0;
    const done=(fn,value)=>{clearTimeout(timer);host.removeEventListener('message',onMessage);fn(value)};
    const onMessage=event=>{
      const data=event.data;
      if(event.source!==frameWindow||!data||data.type!=='web2-hwp-convert-result'||data.id!==id)return;
      if(data.ok===true&&ArrayBuffer.isView(data.bytes)&&data.bytes.length)done(resolve,{bytes:new Uint8Array(data.bytes.buffer,data.bytes.byteOffset,data.bytes.byteLength),filled:Array.isArray(data.filled)?data.filled.map(String):[],missing:Array.isArray(data.missing)?data.missing.map(String):[],inserted:Number(data.inserted)||0});
      else done(reject,Object.assign(new Error(ENGINE_TEXT[data.code]||ENGINE_TEXT.engine_error),{kind:'engine',code:String(data.code||'engine_error')}));
    };
    host.addEventListener('message',onMessage);
    timer=setTimeout(()=>done(reject,Object.assign(new Error(ENGINE_TEXT.timeout),{kind:'engine',code:'timeout'})),timeoutMs);
    try{frameWindow.postMessage({type:'web2-hwp-convert',id,base,plan},'*')}
    catch{done(reject,Object.assign(new Error(ENGINE_TEXT.engine_error),{kind:'engine',code:'engine_error'}))}
  });
}

// ---- 작은 창 ----
const ID='hwpConvertModal';
let modal=null,run=0;
const esc=text=>String(text).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
function markup(){
  return `<div id="${ID}" data-kptu-history-all="1" class="modal hidden hwp-convert" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="hwpConvertTitle"><div class="modal-card small-card hwp-convert-card">
<div class="modal-head"><h2 id="hwpConvertTitle">노조 서식으로 만들기</h2><button type="button" class="icon-btn" data-close="${ID}" aria-label="닫기">×</button></div>
<div class="hwp-convert-types" role="group" aria-label="문서 종류">${DOC_TYPES.map((row,i)=>`<button type="button" class="hwp-convert-chip" data-doc-type="${row.id}" aria-pressed="${i===0}">${esc(row.label)}</button>`).join('')}</div>
<label class="hwp-convert-field"><span>글</span><textarea id="hwpConvertText" rows="11" spellcheck="false" placeholder="마크다운이나 일반 글을 붙여 넣거나, 글 파일(.md·.txt)을 여기에 끌어 놓으세요."></textarea></label>
<p class="hwp-convert-meta"><span id="hwpConvertCount" aria-live="off">0 / ${CONVERT_MAX_CHARS.toLocaleString('ko-KR')}자</span></p>
<p id="hwpConvertStatus" class="hwp-convert-status" role="status" aria-live="polite"></p>
<div class="hwp-convert-foot"><button type="button" class="secondary" data-hwp-convert-cancel>취소</button><button type="button" class="primary" data-hwp-convert-make>만들기</button></div>
</div></div>`;
}
function ensure(){
  if(modal?.isConnected)return modal;
  document.body.insertAdjacentHTML('beforeend',markup());
  modal=document.getElementById(ID);
  return modal;
}
export function closeConvertDialog(){
  if(!modal)return;
  run++;
  modal.classList.add('hidden');modal.setAttribute('aria-hidden','true');
  window.KPTUA11y?.dialog.deactivate(modal,{restoreFocus:true});
  const area=modal.querySelector('#hwpConvertText');
  if(area)area.value='';
}
// onMake({docType,text,progress(text),cancelled()}) → Promise<{ok:true}|{ok:false,message}>. 성공하면 창이 닫히고, 실패하면 창에 안내가 보이고 글은 그대로 남는다.
export function openConvertDialog({onMake,docType='report'}){
  const root=ensure();
  const area=root.querySelector('#hwpConvertText'),count=root.querySelector('#hwpConvertCount'),note=root.querySelector('#hwpConvertStatus');
  const make=root.querySelector('[data-hwp-convert-make]'),cancel=root.querySelector('[data-hwp-convert-cancel]');
  const chips=[...root.querySelectorAll('[data-doc-type]')];
  let busy=false,type=docType;
  const say=(text,state='info')=>{note.textContent=text;note.dataset.state=state};
  const paintChips=()=>chips.forEach(chip=>chip.setAttribute('aria-pressed',String(chip.dataset.docType===type)));
  const paint=()=>{
    const state=textState(area.value);
    count.textContent=`${state.count.toLocaleString('ko-KR')} / ${CONVERT_MAX_CHARS.toLocaleString('ko-KR')}자`;
    count.dataset.over=String(state.tooLong);
    make.disabled=busy||state.empty||state.tooLong;
    chips.forEach(chip=>{chip.disabled=busy});
    area.readOnly=busy;
    return state;
  };
  // 이 창을 다시 열 때마다 이벤트를 새로 붙이므로(파일 하나로 여러 번 열림) 이전 붙임은 AbortController로 한꺼번에 뗀다.
  root.__abort?.abort();
  const abort=new AbortController();root.__abort=abort;const opts={signal:abort.signal};
  area.value='';say('');type=docType;paintChips();
  chips.forEach(chip=>chip.addEventListener('click',()=>{if(busy)return;type=chip.dataset.docType;paintChips()},opts));
  area.addEventListener('input',()=>{say('');paint()},opts);
  async function readDropped(file){
    const problem=dropProblem(file);
    if(problem){say(problem,'error');return}
    try{
      const text=cleanPasted(await file.text());
      area.value=text;say(`${file.name}에서 글을 가져왔어요.`);paint();
    }catch{say('파일을 읽지 못했어요.','error')}
  }
  area.addEventListener('dragover',event=>{if(busy||![...(event.dataTransfer?.types||[])].includes('Files'))return;event.preventDefault();area.dataset.drop='1'},opts);
  area.addEventListener('dragleave',()=>{delete area.dataset.drop},opts);
  area.addEventListener('drop',event=>{
    delete area.dataset.drop;
    const file=event.dataTransfer?.files?.[0];
    if(!file)return;
    event.preventDefault();
    if(!busy)void readDropped(file);
  },opts);
  const mine=++run;
  const close=()=>{if(run===mine)closeConvertDialog()};
  cancel.addEventListener('click',close,opts);
  root.querySelector('[data-close]').addEventListener('click',close,opts);
  make.addEventListener('click',async()=>{
    const state=paint();
    if(busy||state.empty||state.tooLong)return;
    busy=true;paint();say('만드는 중…');
    let result;
    try{result=await onMake({docType:type,text:state.text,progress:text=>{if(run===mine)say(text)},cancelled:()=>run!==mine})}
    catch(err){console.error('hwp-convert',err?.kind||err?.code||'error');result={ok:false,message:'만들지 못했어요. 아무것도 바뀌지 않았어요.'}}
    if(run!==mine)return;
    busy=false;
    if(result?.ok){close();return}
    paint();say(result?.message||'만들지 못했어요. 아무것도 바뀌지 않았어요.','error');
  },opts);
  paint();
  root.classList.remove('hidden');root.setAttribute('aria-hidden','false');
  window.KPTUA11y?.dialog.activate(root,{trigger:document.activeElement,initialFocus:'#hwpConvertText',onRequestClose:close});
  return {close};
}
