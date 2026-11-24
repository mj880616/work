// S69-52 ①(명진 11/24 15:53·16:02 'ㄱ'): 자료실 ⋯ [드라이브와 맞는지 보기] 창. 자료실 폴더 ↔ 드라이브 '자료실' 폴더 1:1.
// 1) 열면 서버(workspace-drive drive-check op:'scan')가 어긋난 곳을 줄로 준다(아무것도 바꾸지 않음).
// 2) 줄마다 [맞추기](이름·자리는 어느 쪽으로 맞출지 두 단추), 아래 [모두 맞추기]. 서버가 다시 살펴 지금도 어긋난 줄만 고친다(10초씩 이어서).
// 3) 이 창에서 한 맞추기는 한 번호로 묶여 [되돌리기]가 모두 전으로 돌린다(드라이브 표식에 기록 — 기기 저장 없음).
// 자동으로 지우지 않는다(서버 규칙). '연결된 원본'(드라이브에서 가져오기로 연결만 한 파일)은 옮기지 않고 개수만 보여 준다.
import {DRIVE_CHECK_LABEL,CHECK_ROUNDS,CHECK_WAIT_MS,KIND_ORDER,KIND_TITLE,headLine,noteLine,lineView,addFix,fixLine,undoLine,failText} from './library-drive-check-model.mjs';
import {waitHtml,emptyHtml} from './wait-state.js';

const PATH='/functions/v1/workspace-drive?action=drive-check';
export {DRIVE_CHECK_LABEL};

// api(path,{method,body,timeoutMs,singleFlight}), esc(text), onDone(): 자료실 다시 읽기, reconnect(): [Drive 다시 연결].
export function createDriveCheck({api,esc,onDone,reconnect}){
  let root=null,trigger=null,run=0,busy=false,scan=null,batch='';
  const $=s=>root.querySelector(s);
  function ensure(){
    if(root)return root;
    document.body.insertAdjacentHTML('beforeend',`<div id="libraryDriveCheckModal" class="modal hidden" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="libraryDriveCheckTitle"><div class="modal-card small-card lu-di-card"><div class="modal-head"><div><h2 id="libraryDriveCheckTitle">${DRIVE_CHECK_LABEL}</h2><p id="libraryDriveCheckSub" class="lu-di-sub" aria-live="polite"></p></div><button class="icon-btn" type="button" data-dc-close aria-label="닫기">×</button></div><div class="lu-di-list" id="libraryDriveCheckList"></div><p class="status" id="libraryDriveCheckStatus" role="status"></p><div class="modal-action-footer"><button class="secondary" type="button" data-dc-undo hidden>되돌리기</button><button class="secondary" type="button" data-dc-close>닫기</button><button class="primary" type="button" data-dc-all disabled>모두 맞추기</button></div></div></div>`);
    root=document.querySelector('#libraryDriveCheckModal');
    root.addEventListener('click',onClick);
    return root;
  }
  const isOpen=()=>!!root&&!root.classList.contains('hidden');
  function close(){
    if(!isOpen()||busy)return;run++;
    root.classList.add('hidden');root.setAttribute('aria-hidden','true');
    if(window.KPTUA11y?.dialog?.deactivate)window.KPTUA11y.dialog.deactivate(root);else if(trigger?.isConnected)trigger.focus({preventScroll:true});
  }
  function say(text,{error=false}={}){const s=$('#libraryDriveCheckStatus');s.textContent=text||'';s.classList.toggle('error',!!error)}
  function buttons(){
    const b=$('[data-dc-all]');b.disabled=busy||!scan?.ok||!Number(scan.total);b.textContent=busy?'맞추는 중…':'모두 맞추기';
    const u=$('[data-dc-undo]');u.hidden=!batch;u.disabled=busy;
    for(const x of root.querySelectorAll('[data-dc-fix]'))x.disabled=busy;
  }
  function row(kind,l){
    const v=lineView(kind,l);
    const acts=v.acts.map(a=>`<button type="button" class="row-act${a.to&&a.to===v.prefer?' is-prefer':''}" data-dc-fix${a.to?` data-dc-to="${esc(a.to)}"`:''}>${esc(a.label)}</button>`).join('');
    return `<div class="lu-di-row lu-dc-row" data-dc-kind="${esc(kind)}" data-dc-id="${esc(l.id)}"><span class="lu-di-name">${esc(v.text)}<small class="lu-dc-sub">${esc(v.sub)}${v.note?` · ${esc(v.note)}`:''}</small></span><span class="lu-dc-acts">${acts}</span></div>`;
  }
  function paint(){
    const list=$('#libraryDriveCheckList');
    if(!scan?.ok){list.innerHTML='';return}
    $('#libraryDriveCheckSub').textContent=headLine(scan);
    const groups=KIND_ORDER.filter(k=>Number(scan.counts?.[k])).map(k=>{
      const lines=Array.isArray(scan.lines?.[k])?scan.lines[k]:[];
      const more=Number(scan.counts[k])>lines.length?`<p class="lu-di-hint">${Number(scan.counts[k])-lines.length}개 더 — 맞춘 뒤 다시 보면 이어서 보여요</p>`:'';
      return `<details class="lu-di-group" open data-dc-group="${esc(k)}"><summary><span class="lu-di-path">${esc(KIND_TITLE[k])}</span><span class="lu-di-count">${Number(scan.counts[k])}</span></summary>${lines.map(l=>row(k,l)).join('')}${more}</details>`;
    }).join('');
    const note=noteLine(scan);
    const linked=Array.isArray(scan.linked_lines)&&scan.linked_lines.length?`<details class="lu-di-group" data-dc-group="linked"><summary><span class="lu-di-path">연결된 원본</span><span class="lu-di-count">${Number(scan.linked)}</span></summary>${scan.linked_lines.map(x=>`<div class="lu-di-row"><span class="lu-di-name">${esc(x.title||'이름 없는 자료')}<small class="lu-dc-sub">드라이브 원래 자리 그대로</small></span></div>`).join('')}</details>`:'';
    list.innerHTML=(groups||emptyHtml('드라이브와 같아요'))+(note?`<p class="lu-di-hint">${esc(note)}</p>`:'')+linked;
    buttons();
  }
  async function load(me){
    $('#libraryDriveCheckList').innerHTML=waitHtml({rows:3});
    try{
      const d=await api(PATH,{method:'POST',body:{op:'scan'},timeoutMs:CHECK_WAIT_MS,singleFlight:false});
      if(me!==run)return;
      if(!d?.ok){scan=null;$('#libraryDriveCheckList').innerHTML=d?.code==='drive_not_connected'?'<p class="lu-di-empty"><button type="button" class="secondary" data-dc-reconnect>Drive 다시 연결</button></p>':'';say(failText(d?.code),{error:true});buttons();return}
      scan=d;paint();
    }catch{if(me!==run)return;scan=null;$('#libraryDriveCheckList').innerHTML='';say(failText(),{error:true});buttons()}
  }
  // 맞추기(줄 몇 개 또는 모두). 이어서 하기(left) · 아무것도 나아가지 않으면 멈춤 · 모두는 폴더를 맞춘 뒤 새로 보이는 자료까지 한 번 더.
  async function fix(body){
    if(busy)return;
    busy=true;buttons();const me=run;let sum={},stopped=false;
    for(let i=0;i<CHECK_ROUNDS;i++){
      say('맞추는 중… '+fixLine(sum));
      let r;
      try{r=await api(PATH,{method:'POST',body:{op:'fix',...body,...(batch?{batch}:{})},timeoutMs:CHECK_WAIT_MS,singleFlight:false})}catch{stopped=true;break}
      if(!r?.ok){stopped=true;break}
      batch=r.batch||batch;sum=addFix(sum,r);
      if(me!==run)break;
      if(r.left&&Number(r.done))continue;
      if(r.left){stopped=true;break}
      if(!body.all||!Number(r.done))break;
      const again=await api(PATH,{method:'POST',body:{op:'scan'},timeoutMs:CHECK_WAIT_MS,singleFlight:false}).catch(()=>null);
      if(!again?.ok||!Number(again.total))break;
    }
    busy=false;
    await load(run);
    say(fixLine(sum)+(stopped?' · 중간에 멈췄어요 — 다시 누르면 이어서 해요':''),{error:stopped});
    if(Number(sum.done))onDone?.();
  }
  async function undo(){
    if(busy||!batch)return;
    busy=true;buttons();let restored=0,stopped=false;
    for(let i=0;i<CHECK_ROUNDS;i++){
      let r;
      try{r=await api(PATH,{method:'POST',body:{op:'undo',batch},timeoutMs:CHECK_WAIT_MS,singleFlight:false})}catch{stopped=true;break}
      if(!r?.ok){stopped=true;break}
      restored+=Number(r.restored)||0;
      if(!r.left||!Number(r.restored))break;
    }
    busy=false;if(!stopped)batch='';
    await load(run);
    say(undoLine(restored,stopped),{error:stopped});
    onDone?.();
  }
  function onClick(e){
    if(e.target.closest('[data-dc-close]')){close();return}
    if(e.target.closest('[data-dc-reconnect]')){void reconnect?.();return}
    if(e.target.closest('[data-dc-all]')){void fix({all:true});return}
    if(e.target.closest('[data-dc-undo]')){void undo();return}
    const b=e.target.closest('[data-dc-fix]');
    if(b){const r=b.closest('[data-dc-kind]');void fix({lines:[{kind:r.dataset.dcKind,id:r.dataset.dcId,...(b.dataset.dcTo?{to:b.dataset.dcTo}:{})}]})}
  }
  async function open(from){
    trigger=from||document.activeElement;ensure();
    const me=++run;busy=false;scan=null;batch='';
    $('#libraryDriveCheckSub').textContent='';say('');buttons();
    root.classList.remove('hidden');root.setAttribute('aria-hidden','false');
    window.KPTUA11y?.dialog?.activate?.(root,{trigger,initialFocus:root.querySelector('[data-dc-close]'),onRequestClose:close});
    if(!window.KPTUA11y?.dialog)root.querySelector('[data-dc-close]')?.focus();
    await load(me);
  }
  return {open,close,isOpen};
}
