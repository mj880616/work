// S69-45 LIB-같은내용정리(명진 11/24 15:51 "중복된 파일들이 있는거같어 … 중복된거 지워 알아서"): 자료실 ⋯ [같은 내용 자료 정리] 창.
// 1) 열면 서버(library-files same-content-scan)가 내 자료 중 내용이 같은(md5 + 크기) 묶음을 찾아 미리 보기만 돌려준다(아무것도 바꾸지 않음).
//    묶음마다 남길 자료(이름·폴더)와 휴지통으로 갈 자료를 보여 준다. 기록 연결을 옮길 수 없는 묶음은 '건너뜀'.
// 2) [정리하기]를 누를 때만 서버(same-content-apply)가 다시 확인하고, 지울 자료를 '같은 내용 정리 …' 폴더에 모아 그 폴더를 자료실 휴지통에 넣는다.
//    자료 행·드라이브 파일은 그대로(영구 삭제 없음). 결과 한 줄 '휴지통 N · 건너뜀 M' + [되돌리기](same-content-undo, 이 창이 열려 있는 동안).
//    창을 닫은 뒤에도 휴지통 화면에서 그 폴더를 되돌리면 자료가 다시 보인다. 기기 저장 없음.
import {SAME_LABEL,SAME_WAIT_MS,previewLine,previewNote,applyBatches,resultLine,undoLine} from './library-same-content-model.mjs';
import {waitHtml,emptyHtml} from './wait-state.js';

const PATH='/functions/v1/library-files';
export {SAME_LABEL};

// api(path,{method,body,timeoutMs,singleFlight}), esc(text), onDone(): 자료실 다시 읽기, reconnect(): [Drive 다시 연결].
export function createSameContent({api,esc,onDone,reconnect}){
  let root=null,trigger=null,run=0,busy=false,scan=null,undos=[];
  const $=s=>root.querySelector(s);
  function ensure(){
    if(root)return root;
    document.body.insertAdjacentHTML('beforeend',`<div id="librarySameModal" class="modal hidden" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="librarySameTitle"><div class="modal-card small-card lu-di-card"><div class="modal-head"><div><h2 id="librarySameTitle">${SAME_LABEL}</h2><p id="librarySameSub" class="lu-di-sub" aria-live="polite"></p></div><button class="icon-btn" type="button" data-sc-close aria-label="닫기">×</button></div><div class="lu-di-list" id="librarySameList"></div><p class="status" id="librarySameStatus" role="status"></p><div class="modal-action-footer"><button class="secondary" type="button" data-sc-undo hidden>되돌리기</button><button class="secondary" type="button" data-sc-close>닫기</button><button class="primary" type="button" data-sc-apply disabled>정리하기</button></div></div></div>`);
    root=document.querySelector('#librarySameModal');
    root.addEventListener('click',onClick);
    return root;
  }
  const isOpen=()=>!!root&&!root.classList.contains('hidden');
  function close(){
    if(!isOpen()||busy)return;run++;
    root.classList.add('hidden');root.setAttribute('aria-hidden','true');
    if(window.KPTUA11y?.dialog?.deactivate)window.KPTUA11y.dialog.deactivate(root);else if(trigger?.isConnected)trigger.focus({preventScroll:true});
  }
  function say(text,{error=false}={}){const s=$('#librarySameStatus');s.textContent=text||'';s.classList.toggle('error',!!error)}
  const todo=()=>applyBatches(scan?.groups).flat().length;
  function buttons(){
    const b=$('[data-sc-apply]'),n=todo();
    b.disabled=busy||!n;b.textContent=busy?'정리하는 중…':'정리하기';
    const u=$('[data-sc-undo]');u.hidden=!undos.length;u.disabled=busy;
  }
  const line=(d,mark)=>`<div class="lu-di-row"><span class="lu-di-note">${mark}</span><span class="lu-di-name">${esc(d.title)}</span><span class="lu-di-meta">${esc(d.path)}</span></div>`;
  function paint(){
    const list=$('#librarySameList');
    if(!scan){list.innerHTML='';return}
    $('#librarySameSub').textContent=previewLine(scan);
    const groups=Array.isArray(scan.groups)?scan.groups:[];
    if(!groups.length){list.innerHTML=emptyHtml('같은 내용 자료 없음');buttons();return}
    const note=previewNote(scan);
    list.innerHTML=(note?`<p class="lu-di-hint">${esc(note)}</p>`:'')+groups.map(g=>`<details class="lu-di-group"${groups.length<=30?' open':''} data-sc-group><summary><span class="lu-di-path">${esc(g.keep.title)}</span><span class="lu-di-count">${g.skip?'건너뜀':`휴지통 ${g.drop.length}`}</span></summary>${line(g.keep,'남김')}${g.drop.map(d=>line(d,g.skip?'그대로':'휴지통')).join('')}${g.skip?'<p class="lu-di-hint">기록 연결을 옮길 수 없어 건너뛰어요</p>':''}</details>`).join('');
    buttons();
  }
  const failText=e=>e?.status===424?'Google Drive 연결을 확인해 주세요.':'같은 내용 자료를 찾지 못했어요. 잠시 뒤 다시 해 주세요.';
  async function load(me){
    $('#librarySameList').innerHTML=waitHtml({rows:3});
    try{
      const d=await api(PATH,{method:'POST',body:{action:'same-content-scan'},timeoutMs:SAME_WAIT_MS});
      if(me!==run)return;
      if(!d?.ok)throw Object.assign(new Error('bad'),{status:['drive_auth_expired','drive_denied'].includes(d?.code)?424:0});
      scan=d;paint();
    }catch(e){
      if(me!==run)return;
      $('#librarySameList').innerHTML=e?.status===424?'<p class="lu-di-empty"><button type="button" class="secondary" data-sc-reconnect>Drive 다시 연결</button></p>':'';
      say(failText(e),{error:true});
    }
  }
  async function apply(){
    if(busy||!scan)return;
    const parts=applyBatches(scan.groups);if(!parts.length)return;
    busy=true;buttons();const me=run;let trashed=0,skipped=0,stopped=false;
    for(let i=0;i<parts.length;i++){
      say(`정리하는 중… ${i+1}/${parts.length}`);
      let r;
      try{r=await api(PATH,{method:'POST',body:{action:'same-content-apply',groups:parts[i]},timeoutMs:SAME_WAIT_MS,singleFlight:false})}catch{stopped=true;break}
      if(!r?.ok){stopped=true;break}
      trashed+=Number(r.trashed)||0;skipped+=Number(r.skipped)||0;
      if(r.undo)undos.push(r.undo);
      if(me!==run)break;
    }
    skipped+=(scan.groups||[]).filter(g=>g.skip).length;
    busy=false;
    const text=resultLine({trashed,skipped,stopped});
    await load(run);
    say(text,{error:stopped});buttons();
    if(trashed)onDone?.();
  }
  async function undo(){
    if(busy||!undos.length)return;
    busy=true;buttons();let restored=0,missed=0,stopped=false;
    while(undos.length){
      let r;
      try{r=await api(PATH,{method:'POST',body:{action:'same-content-undo',undo:undos[undos.length-1]},timeoutMs:SAME_WAIT_MS,singleFlight:false})}catch{stopped=true;break}
      if(!r?.ok){stopped=true;break}
      undos.pop();restored+=Number(r.restored)||0;missed+=Number(r.missed)||0;
    }
    busy=false;
    await load(run);
    say(undoLine({restored,missed})+(stopped?' · 중간에 멈췄어요 — 다시 눌러 주세요':''),{error:stopped});buttons();
    onDone?.();
  }
  function onClick(e){
    if(e.target.closest('[data-sc-close]')){close();return}
    if(e.target.closest('[data-sc-reconnect]')){void reconnect?.();return}
    if(e.target.closest('[data-sc-apply]')){void apply();return}
    if(e.target.closest('[data-sc-undo]'))void undo();
  }
  async function open(from){
    trigger=from||document.activeElement;ensure();
    const me=++run;busy=false;scan=null;undos=[];
    $('#librarySameSub').textContent='';say('');buttons();
    root.classList.remove('hidden');root.setAttribute('aria-hidden','false');
    window.KPTUA11y?.dialog?.activate?.(root,{trigger,initialFocus:root.querySelector('[data-sc-close]'),onRequestClose:close});
    if(!window.KPTUA11y?.dialog)root.querySelector('[data-sc-close]')?.focus();
    await load(me);
  }
  return {open,close,isOpen};
}
