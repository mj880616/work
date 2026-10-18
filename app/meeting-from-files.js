// MEET-파일로만들기(2026-10-17 사용자 결정): 회의 [+] 창의 [파일·글로 만들기].
// 회의자료·회의결과 파일(HWP·PDF 여러 개)과 붙여 넣은 결과 글을 회의별로 묶어 미리보기 표로 보이고, [만들기]로 한 번에 만든다.
// - 묶음 판단은 순수 함수(meeting-file-parse.mjs), 결과 파일 본문 읽기는 meeting-file-text.js(이 기기 안에서만).
// - 저장은 기존 경로만 쓴다: 회의 행은 회의 결과 창과 같은 app_meetings REST(POST·PATCH, owner RLS),
//   파일은 회의자료 올리기와 같은 meeting-files Edge(자료실 '회의자료' 등록 포함). DB·Edge 변경 없음.
// - 이 모듈은 #mffPanel 한 곳만 그린다. 창 열기·닫기·직접 쓰기 칸은 team.js가 그대로 맡고,
//   어느 쪽을 보일지는 #meetingModal의 data-create-mode(이 모듈이 정함)와 meeting-ui.css가 정한다.
import {parseKey,roleOf,splitPasted,firstLineKey,mergeKey,matchKind,nameKey,groupItems,findExisting,appendResult} from './meeting-file-parse.mjs';
import {readFileText,createHwpReader,kindOf} from './meeting-file-text.js';
import {fileLine,bindDropTarget} from './meeting-compact.js';
import {seoulDateKey,toMeetingISO} from './meeting-time.js';

(()=>{
'use strict';
if(window.__KPTU_MEETING_FROM_FILES__)return;
window.__KPTU_MEETING_FROM_FILES__=true;
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MAX_FILE=100*1024*1024;
const ROLE_LABEL={result:'결과',material:'자료'};

let files=[],textItems=[],lastText='',seq=0,saving=false,generation=0,hwp=null,readQueue=Promise.resolve(),typingTimer=0;
const confirmed=new Set(),opened=new Map(),textOverride=new Map(),textSaved=new Map();
let runMessage='';

const modal=()=>$('#meetingModal');
const rt=()=>window.KPTURuntime;
const meetings=()=>window.KPTUTeamData?.meetings?.()||[];
const kinds=()=>[...new Set(meetings().map(m=>String(m.series_name||m.title||'').trim()).filter(Boolean))];
const isSaved=item=>item.kind==='file'?item.uploaded:textSaved.has(item.text);
const shortDate=v=>v?v.slice(2).replace(/-/g,'.'):'';
function toast(message){const t=$('#toast');if(!t)return;t.textContent=message;t.classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.add('hidden'),3200)}

function install(){
  const host=modal();
  if(!host||$('#mffPanel'))return !!host;
  const head=host.querySelector('.modal-head');
  if(!head)return false;
  head.insertAdjacentHTML('afterend','<div class="meeting-create-modes" role="group" aria-label="만드는 방법"><button type="button" data-meeting-mode="manual" aria-pressed="true">직접 쓰기</button><button type="button" data-meeting-mode="files" aria-pressed="false">파일·글로 만들기</button></div>');
  const modes=host.querySelector('.meeting-create-modes');
  modes.insertAdjacentHTML('afterend',`<section id="mffPanel" class="mff-panel" aria-label="파일·글로 회의 만들기">
<section class="mtg-group" aria-labelledby="mffFilesHead"><div class="mtg-group-head"><h3 id="mffFilesHead">파일</h3><button id="mffPick" class="mtg-add-plus" type="button" aria-label="회의자료·회의결과 파일 고르기">+</button><input id="mffFiles" type="file" multiple accept=".hwp,.hwpx,.pdf" hidden></div>
<p class="mtg-note">HWP·PDF 여러 개 · 이름에 "결과·회의록"이면 결과, "자료·안건"이면 자료 · 자료실에도 자동 등록</p></section>
<label class="mff-text-label">회의 결과 글 <span class="optional">붙여 넣기</span><textarea id="mffText" rows="5" placeholder="회의 결과 글을 붙여 넣으세요. 회의가 여럿이면 회의 제목 줄(예: 제5차 중앙집행위원회 결과 2025.10.15)로 나눠요."></textarea></label>
<div id="mffList" class="mff-list" aria-live="polite"></div>
<datalist id="mffKinds"></datalist>
<div class="modal-action-footer mff-footer"><div id="mffStatus" class="status" role="status"></div><button id="mffCreate" class="primary wide" type="button" disabled>만들기</button></div>
</section>`);
  modes.addEventListener('click',e=>{const b=e.target.closest('[data-meeting-mode]');if(b)setMode(b.dataset.meetingMode,true)});
  $('#mffPick').onclick=()=>$('#mffFiles').click();
  $('#mffFiles').addEventListener('change',()=>{const input=$('#mffFiles'),picked=Array.from(input.files||[]);input.value='';addFiles(picked)});
  // 글이 바뀐 때만 다시 그린다. 글 칸을 떠나며 생기는 change는 초점이 옮겨 간 뒤에 그려서, 막 누른 표의 칸이 바뀌지 않게 한다.
  const textChanged=()=>{clearTimeout(typingTimer);if(($('#mffText')?.value||'')===lastText)return;rebuildText();paint()};
  $('#mffText').addEventListener('input',()=>{clearTimeout(typingTimer);typingTimer=setTimeout(textChanged,300)});
  $('#mffText').addEventListener('change',()=>{clearTimeout(typingTimer);typingTimer=setTimeout(textChanged,0)});
  $('#mffCreate').onclick=()=>void run();
  const list=$('#mffList');
  list.addEventListener('change',onListChange);
  list.addEventListener('click',onListClick);
  list.addEventListener('toggle',e=>{const row=e.target.closest?.('[data-mff-anchor]');if(row)opened.set(row.dataset.mffAnchor,row.open)},true);
  bindDropTarget($('#mffPanel'),addFiles,()=>!saving&&mode()==='files');
  setMode('manual');
  return true;
}
const mode=()=>modal()?.dataset.createMode==='files'?'files':'manual';
function setMode(next,focus=false){
  const host=modal();if(!host)return;
  if(saving&&next!=='files')return;
  host.dataset.createMode=next==='files'?'files':'manual';
  host.querySelectorAll('[data-meeting-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.meetingMode===host.dataset.createMode)));
  if(next==='files'){paint();if(focus)$('#mffPick')?.focus()}
}

function addFiles(picked){
  if(saving)return;
  const rejected=[];
  for(const file of picked||[]){
    if(file.size>MAX_FILE){rejected.push(file.name);continue}
    const item={id:'f'+(++seq),kind:'file',file,role:roleOf(file.name),fileKey:parseKey(file.name),bodyKey:null,text:'',read:'none',readNote:'',override:{},meetingId:null,uploaded:false,textSaved:false,error:''};
    files.push(item);
    if(item.role==='result')queueRead(item);
  }
  runMessage=rejected.length?`100MB가 넘는 파일은 뺐어요: ${rejected.join(', ')}`:'';
  paint();
}
function queueRead(item){
  if(item.read!=='none')return;
  if(!kindOf(item.file.name)){item.read='failed';item.readNote='PDF·HWP만 본문을 읽어요';return}
  item.read='reading';
  const gen=generation;
  readQueue=readQueue.then(async()=>{
    if(gen!==generation||!files.includes(item))return;
    if(kindOf(item.file.name)==='hwp'&&!hwp)hwp=createHwpReader();
    const result=await readFileText(item.file,{hwp});
    if(gen!==generation)return;
    item.text=result.text;item.readNote=result.error;item.read=result.text?'done':'failed';
    item.bodyKey=result.text?firstLineKey(result.text):null;
    paint();
  }).catch(err=>console.warn('meeting file read queue',err));
}
function rebuildText(){
  lastText=$('#mffText')?.value||'';
  const chunks=splitPasted(lastText);
  textItems=chunks.map((chunk,index)=>({id:'t'+index+':'+chunk.text.length,kind:'text',role:'result',text:chunk.text,key:chunk.key,override:textOverride.get(chunk.text)||{},meetingId:textSaved.get(chunk.text)||null}));
}

function plan(){
  for(const item of files)item.key=mergeKey(item.fileKey,item.bodyKey);
  const known=kinds(),all=meetings();
  return groupItems([...textItems,...files]).map(g=>{
    const items=[...g.results,...g.materials,...g.undecided];
    const matched=matchKind(g.name,known),kind=matched||g.name;
    const saved=items.find(i=>i.meetingId)?.meetingId||null;
    const existing=saved?(all.find(m=>m.id===saved)||{id:saved}):findExisting({name:kind,round:g.round,date:g.date},all,seoulDateKey);
    const date=g.date||(existing?.meeting_at?seoulDateKey(existing.meeting_at):'');
    const done=items.length>0&&items.every(isSaved);
    const error=items.find(i=>i.error&&!isSaved(i))?.error||'';
    let state='ready',note=existing?'기존 회의에 결과·자료 더하기':'새로 만들기';
    if(done){state='done';note=existing?'더했어요':'만들었어요'}
    else if(g.undecided.length){state='pick';note='결과인지 자료인지 골라 주세요'}
    else if(!g.results.length){state='no-result';note='결과를 더해 주세요'}
    else if(!kind){state='pick';note='회의 종류를 골라 주세요'}
    else if(!existing&&!date){state='pick';note='날짜를 골라 주세요'}
    else if(!existing&&!matched&&!confirmed.has(nameKey(kind))){state='new-kind';note='처음 보는 회의명이에요'}
    if(error&&state==='ready')note='실패 · '+error;
    const reading=g.results.some(i=>i.kind==='file'&&i.read==='reading');
    return {...g,items,anchor:items[0]?.id||g.key,kind,isNew:!matched,existing,date,state,note,reading};
  });
}

function rowHtml(g){
  const done=g.state==='done',locked=done||saving;
  const open=opened.has(g.anchor)?opened.get(g.anchor):['pick','new-kind','no-result'].includes(g.state);
  const result=g.results.length?'있음':'없음';
  const label=[g.date||'날짜 없음',g.kind||'종류 없음',g.round?g.round+'차':'',`자료 ${g.materials.length}개`,`결과 ${result}`,g.note].filter(Boolean).join(', ');
  const fileRows=g.items.map(item=>{
    if(item.kind==='text'){const first=item.text.split('\n').find(Boolean)||'';return `<div class="file-line mff-text-line"><span class="file-kind" data-kind="other" aria-hidden="true">글</span><span class="file-line-main"><b>${esc(first.slice(0,60))}</b><small>붙여 넣은 결과 글 · ${item.text.length}자</small></span><span class="file-line-state">결과</span></div>`}
    const meta=item.role==='result'?({reading:'본문 읽는 중…',done:'본문을 결과 칸에 넣어요',failed:(item.readNote||'본문 못 읽음')+' · 파일만 첨부'}[item.read]||''):'';
    const state=item.uploaded?'완료':item.error?'실패':'';
    const end=locked||item.uploaded?'':`<select class="mff-role" data-mff-role="${esc(item.id)}" aria-label="${esc(item.file.name)} 결과·자료 고르기">${item.role?'':'<option value="" selected>고르기</option>'}<option value="result"${item.role==='result'?' selected':''}>결과</option><option value="material"${item.role==='material'?' selected':''}>자료</option></select><button class="icon-btn file-line-x" type="button" data-mff-remove="${esc(item.id)}" aria-label="${esc(item.file.name)} 빼기">×</button>`;
    return fileLine({name:item.file.name,meta,state:item.uploaded?'success':item.error?'error':item.read==='reading'?'uploading':'',label:state||(locked?ROLE_LABEL[item.role]||'':''),end,attrs:` data-mff-item="${esc(item.id)}"`});
  }).join('');
  const fields=`<div class="mff-fields"><label>종류<input type="text" data-mff-field="name" list="mffKinds" value="${esc(g.kind)}" autocomplete="off"${locked?' disabled':''}></label><label>차수<input type="number" min="1" inputmode="numeric" data-mff-field="round" value="${esc(g.round||'')}"${locked?' disabled':''}></label><label>날짜<input type="date" data-mff-field="date" value="${esc(g.date)}"${locked?' disabled':''}></label></div>`;
  const confirm=g.state==='new-kind'&&!saving?`<p class="mff-confirm">"${esc(g.kind)}"은 처음 보는 회의명이에요. <button type="button" class="secondary" data-mff-confirm="${esc(g.kind)}">새 종류로 만들기</button></p>`:'';
  return `<details class="mff-row" data-mff-anchor="${esc(g.anchor)}" data-state="${g.state}"${open?' open':''}><summary aria-label="${esc(label)}"><span class="mff-cell mff-date">${esc(shortDate(g.date)||'—')}</span><span class="mff-cell mff-kind">${esc(g.kind||'—')}</span><span class="mff-cell mff-round">${esc(g.round?g.round+'차':'—')}</span><span class="mff-cell mff-count">${g.materials.length}</span><span class="mff-cell mff-result" data-has="${g.results.length?1:0}">${result}</span><span class="mff-note">${esc(g.note)}</span></summary><div class="mff-body">${confirm}${fields}<div class="mtg-file-list">${fileRows}</div></div></details>`;
}

function paint(){
  const list=$('#mffList');if(!list)return;
  const focus=document.activeElement&&list.contains(document.activeElement)?focusKey(document.activeElement):null;
  const groups=plan();
  const dl=$('#mffKinds');if(dl)dl.innerHTML=kinds().map(k=>`<option value="${esc(k)}"></option>`).join('');
  list.innerHTML=groups.length?`<div class="mff-head" aria-hidden="true"><span>날짜</span><span>종류</span><span>차수</span><span>자료</span><span>결과</span></div>${groups.map(rowHtml).join('')}`:'<p class="mtg-empty">파일을 고르거나 결과 글을 붙여 넣으면 회의별로 묶어 보여 줘요.</p>';
  if(focus)restoreFocus(focus);
  const ready=groups.filter(g=>g.state==='ready'),reading=groups.some(g=>g.reading)||files.some(i=>i.read==='reading');
  const skipped=groups.filter(g=>!['ready','done'].includes(g.state)).length,retry=ready.some(g=>g.items.some(i=>i.error));
  const button=$('#mffCreate');
  button.disabled=saving||reading||!ready.length;
  button.textContent=saving?'만드는 중…':reading?'본문 읽는 중…':ready.length?`회의 ${ready.length}건 ${retry?'다시 ':''}만들기`:'만들기';
  if(saving)button.setAttribute('aria-busy','true');else button.removeAttribute('aria-busy');
  const status=$('#mffStatus');
  status.textContent=runMessage||(skipped&&!saving?`확인이 필요한 ${skipped}건은 만들지 않아요`:'');
  status.className='status'+(runMessage&&/실패/.test(runMessage)?' error':'');
  const text=$('#mffText');if(text)text.readOnly=saving||textSaved.size>0;
  const pick=$('#mffPick');if(pick)pick.disabled=saving;
}
function focusKey(el){
  const row=el.closest('[data-mff-anchor]');
  if(el.dataset.mffRole)return {sel:`[data-mff-role="${CSS.escape(el.dataset.mffRole)}"]`};
  if(el.dataset.mffField&&row)return {sel:`[data-mff-field="${el.dataset.mffField}"]`,items:groupIds(row)};
  if(row&&el.matches('summary'))return {sel:'summary',items:groupIds(row)};
  return null;
}
function groupIds(row){return [...row.querySelectorAll('[data-mff-item]')].map(n=>n.dataset.mffItem).concat(row.dataset.mffAnchor)}
function restoreFocus(key){
  const list=$('#mffList');
  if(!key.items){list.querySelector(key.sel)?.focus({preventScroll:true});return}
  const row=[...list.querySelectorAll('[data-mff-anchor]')].find(r=>key.items.includes(r.dataset.mffAnchor)||groupIds(r).some(id=>key.items.includes(id)));
  row?.querySelector(key.sel)?.focus({preventScroll:true});
}
function rowItems(row){
  const groups=plan(),g=groups.find(x=>x.anchor===row.dataset.mffAnchor);
  return g?g.items:[];
}
function onListChange(e){
  if(saving)return;
  const role=e.target.closest('[data-mff-role]');
  if(role){const item=files.find(i=>i.id===role.dataset.mffRole);if(item){item.role=role.value;if(item.role==='result')queueRead(item);paint()}return}
  const field=e.target.closest('[data-mff-field]');
  if(!field)return;
  const row=field.closest('[data-mff-anchor]'),name=field.dataset.mffField;
  const value=name==='round'?(Number(field.value)>0?Math.floor(Number(field.value)):null):field.value.trim();
  for(const item of rowItems(row)){
    item.override={...item.override,[name]:value};
    if(item.kind==='text')textOverride.set(item.text,item.override);
  }
  opened.set(row.dataset.mffAnchor,true);
  paint();
}
function onListClick(e){
  if(saving)return;
  const remove=e.target.closest('[data-mff-remove]');
  if(remove){files=files.filter(i=>i.id!==remove.dataset.mffRemove);paint();$('#mffPick')?.focus();return}
  const confirm=e.target.closest('[data-mff-confirm]');
  if(confirm){confirmed.add(nameKey(confirm.dataset.mffConfirm));paint()}
}

async function api(path,options){const runtime=rt();if(!runtime?.api)throw new Error('공용 런타임을 불러오지 못했습니다.');return runtime.api(path,options)}
async function saveGroup(g,scope){
  let meetingId=g.existing?.id||null;
  const pendingText=g.results.filter(i=>i.kind==='text'?!textSaved.has(i.text):!i.textSaved&&i.text).map(i=>i.text);
  const combined=pendingText.join('\n\n');
  const markText=id=>{for(const i of g.results){if(i.kind==='text')textSaved.set(i.text,id);else if(i.text)i.textSaved=true}};
  if(!meetingId){
    const rows=await api('/rest/v1/app_meetings',{method:'POST',prefer:'return=representation',body:{workspace_id:scope.workspace,project_id:null,title:g.kind,series_name:g.kind,round_no:g.round||null,meeting_at:toMeetingISO(`${g.date}T${g.time||'00:00'}`),notes:'',transcript_text:combined,result_status:'final',finalized_at:new Date().toISOString(),created_by:scope.user}});
    const row=rows?.[0];if(!row?.id)throw new Error('저장된 회의를 확인하지 못했습니다.');
    meetingId=row.id;
    for(const i of g.items)i.meetingId=meetingId;
    markText(meetingId);
  }else{
    for(const i of g.items)i.meetingId=meetingId;
    if(combined){
      const current=(await api(`/rest/v1/app_meetings?id=eq.${encodeURIComponent(meetingId)}&workspace_id=eq.${encodeURIComponent(scope.workspace)}&select=id,transcript_text`))?.[0];
      if(!current)throw new Error('기존 회의를 찾지 못했습니다.');
      const next=appendResult(current.transcript_text,combined);
      if(next!==String(current.transcript_text||'')){
        const rows=await api(`/rest/v1/app_meetings?id=eq.${encodeURIComponent(meetingId)}&workspace_id=eq.${encodeURIComponent(scope.workspace)}&select=id`,{method:'PATCH',prefer:'return=representation',body:{transcript_text:next,updated_at:new Date().toISOString()}});
        if(!Array.isArray(rows)||rows.length!==1)throw new Error('회의 결과 저장을 확인하지 못했습니다.');
      }
    }
    markText(meetingId);
  }
  let failed=0,message='';
  for(const item of g.items){
    if(item.kind!=='file'||item.uploaded)continue;
    let form=null;
    try{
      form=new FormData();form.append('meeting_id',meetingId);form.append('file',await rt().copyUploadFile(item.file));
      await api('/functions/v1/meeting-files',{method:'POST',body:form});
      item.uploaded=true;item.error='';
    }catch(err){failed++;message=err?.message||'파일 올리기 실패';item.error=message;console.warn('meeting file upload failed',item.file.name,err)}
    finally{form?.delete('file');form=null}
    paint();
  }
  if(failed)throw new Error(`파일 ${failed}개 실패${message?' · '+message:''}`);
}
async function run(){
  if(saving)return;
  const ready=plan().filter(g=>g.state==='ready');
  if(!ready.length)return;
  const context=rt()?.context?.read?.();
  const scope={workspace:context?.workspace?.id,user:context?.user?.id};
  if(!scope.workspace||!scope.user){runMessage='로그인 상태를 확인하지 못했습니다.';paint();return}
  saving=true;runMessage='';paint();
  let ok=0,fail=0;
  try{
    for(const g of ready){
      try{await saveGroup(g,scope);ok++}
      catch(err){fail++;const msg=err?.message||'실패';for(const i of g.items)if(!isSaved(i)&&!i.error)i.error=msg}
      paint();
    }
  }finally{saving=false}
  try{await window.__KPTU_RELOAD_MEETINGS__?.()}catch(err){console.warn('meeting list refresh failed',err)}
  window.dispatchEvent(new CustomEvent('kptu:meetings-changed'));
  window.dispatchEvent(new CustomEvent('kptu:documents-changed'));
  const left=plan().filter(g=>g.state!=='done').length;
  if(!fail&&!left){
    toast(`회의 ${ok}건을 만들었어요.`);
    reset();
    modal()?.querySelector('[data-close="meetingModal"]')?.click();
    return;
  }
  runMessage=fail?`회의 ${ok}건 완료 · ${fail}건 실패. 실패한 묶음만 다시 만들 수 있어요.`:`회의 ${ok}건 완료 · 확인이 필요한 ${left}건은 남겨 두었어요`;
  paint();
}

function reset(){
  generation++;clearTimeout(typingTimer);
  files=[];textItems=[];lastText='';confirmed.clear();opened.clear();textOverride.clear();textSaved.clear();runMessage='';
  const text=$('#mffText');if(text){text.value='';text.readOnly=false}
  // 읽던 것은 generation이 바뀌어 결과를 버린다. 숨은 편집기는 바로 닫는다(다음 읽기 때 새로 연다).
  hwp?.close();hwp=null;readQueue=Promise.resolve();
  paint();
}
window.addEventListener('kptu:dialog-opened',e=>{if(e.detail?.modal?.id!=='meetingModal'||saving)return;install();reset();setMode('manual')});
window.addEventListener('kptu:dialog-closed',e=>{if(e.detail?.modal?.id!=='meetingModal'||saving)return;generation++;hwp?.close();hwp=null;readQueue=Promise.resolve()});
window.addEventListener('kptu:before-reload',e=>{if(saving)e.preventDefault();else if(files.length||textItems.length)e.detail.otherDraft=true});
install();
})();
