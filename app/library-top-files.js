// S69-40 LIB-맨위파일정리(명진 11/24: 드라이브 '자료실' 맨 위에 쌓인 파일 정리): 자료실 ⋯ [맨 위 파일 정리] 창.
// 1) 열면 서버(library-files top-files-scan)에 숫자만 묻는다(아무것도 바꾸지 않음). 2) [정리하기]를 누를 때만 서버가 옮기기·휴지통·정리 대기를 하고
//    (top-files-tidy, 10초씩 이어서), 결과 한 줄 '옮김 N · 첨부로 N · 휴지통 N · 정리 대기 N'과 [되돌리기](같은 정리 번호 top-files-undo).
// 3) '정리 대기' 파일마다 서버가 이름으로 붙인 보낼 곳 제안을 고름 칸에 채워 두고, [보내기]를 누르면 그 앱 폴더로 자료 등록(복사 없음) 또는 휴지통.
// 영구 삭제 없음(드라이브 휴지통 30일). 화면이 보내는 값은 정리 번호·파일 id·고른 앱 폴더 id뿐이고 서버가 다시 확인한다. 기기 저장 없음.
import {TOP_FILES_LABEL,TIDY_ROUNDS,TIDY_WAIT_MS,scanLines,addTidy,tidyLine,sizeShort} from './library-top-files-model.mjs';
import {waitHtml,emptyHtml} from './wait-state.js';

const PATH='/functions/v1/library-files';
export {TOP_FILES_LABEL};

// api(path,{method,body,timeoutMs,singleFlight}), esc(text), onDone(): 자료실 다시 읽기, reconnect(): [Drive 다시 연결].
export function createTopFiles({api,esc,onDone,reconnect}){
  let root=null,trigger=null,run=0,busy=false,scan=null,batch='',sum=null;
  const $=s=>root.querySelector(s);
  function ensure(){
    if(root)return root;
    document.body.insertAdjacentHTML('beforeend',`<div id="libraryTopFilesModal" class="modal hidden" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="libraryTopFilesTitle"><div class="modal-card small-card lu-di-card"><div class="modal-head"><div><h2 id="libraryTopFilesTitle">${TOP_FILES_LABEL}</h2><p id="libraryTopFilesSub" class="lu-di-sub" aria-live="polite"></p></div><button class="icon-btn" type="button" data-tf-close aria-label="닫기">×</button></div><div class="lu-di-list" id="libraryTopFilesList"></div><p class="status" id="libraryTopFilesStatus" role="status"></p><div class="modal-action-footer"><button class="secondary" type="button" data-tf-undo hidden>되돌리기</button><button class="secondary" type="button" data-tf-close>닫기</button><button class="primary" type="button" data-tf-apply disabled>정리하기</button></div></div></div>`);
    root=document.querySelector('#libraryTopFilesModal');
    root.addEventListener('click',onClick);
    return root;
  }
  const isOpen=()=>!!root&&!root.classList.contains('hidden');
  function close(){
    if(!isOpen()||busy)return;run++;
    root.classList.add('hidden');root.setAttribute('aria-hidden','true');
    if(window.KPTUA11y?.dialog?.deactivate)window.KPTUA11y.dialog.deactivate(root);else if(trigger?.isConnected)trigger.focus({preventScroll:true});
  }
  function say(text,{error=false}={}){const s=$('#libraryTopFilesStatus');s.textContent=text||'';s.classList.toggle('error',!!error)}
  const failText=e=>e?.status===424?'Google Drive 연결을 확인해 주세요.':e?.status===409?'드라이브 자료실 폴더가 아직 없어요.':'드라이브를 읽지 못했어요. 잠시 뒤 다시 해 주세요.';
  function buttons(){
    const lines=scan?scanLines(scan):null;
    const b=$('[data-tf-apply]');b.disabled=busy||!lines?.todo;b.textContent=busy?'정리하는 중…':'정리하기';
    const u=$('[data-tf-undo]');u.hidden=!batch;u.disabled=busy;
  }
  function waitRow(f,folders){
    const opts=folders.map(x=>`<option value="${esc(x.id)}"${x.id===f.suggest?' selected':''}>${esc(x.name)}</option>`).join('');
    return `<div class="lu-di-row lu-tf-row" data-tf-file="${esc(f.id)}"><span class="lu-di-name">${esc(f.name)}</span><span class="lu-di-meta">${esc(sizeShort(f.size))}</span><select data-tf-to aria-label="${esc(f.name)} 보낼 곳"><option value="">보낼 곳</option>${opts}<option value="trash">휴지통</option></select><button type="button" class="row-act" data-tf-send>보내기</button></div>`;
  }
  function paint(){
    const list=$('#libraryTopFilesList');
    if(!scan){list.innerHTML='';return}
    const l=scanLines(scan);
    $('#libraryTopFilesSub').textContent=l.head;
    const wait=Array.isArray(scan.wait)?scan.wait:[];
    const head=l.todo||l.note?`<p class="lu-di-hint">${esc(l.todo||'')}${l.todo&&l.note?'<br>':''}${esc(l.note||'')}</p>`:'';
    const waitPart=wait.length?`<details class="lu-di-group" open><summary><span class="lu-di-path">정리 대기</span><span class="lu-di-count">${wait.length}</span></summary>${wait.map(f=>waitRow(f,scan.folders||[])).join('')}</details>`:'';
    list.innerHTML=head+waitPart||emptyHtml('정리할 맨 위 파일 없음');
    buttons();
  }
  async function load(me){
    $('#libraryTopFilesList').innerHTML=waitHtml({rows:3});say('');
    try{
      const d=await api(PATH,{method:'POST',body:{action:'top-files-scan'},timeoutMs:TIDY_WAIT_MS});
      if(me!==run)return;
      if(!d?.ok)throw Object.assign(new Error('bad'),{status:d?.code==='drive_auth_expired'?424:0});
      scan=d;paint();
    }catch(e){if(me!==run)return;$('#libraryTopFilesList').innerHTML='';say(failText(e),{error:true});if(e?.status===424)$('#libraryTopFilesList').innerHTML='<p class="lu-di-empty"><button type="button" class="secondary" data-tf-reconnect>Drive 다시 연결</button></p>'}
  }
  async function apply(){
    if(busy||!scan)return;
    busy=true;buttons();const me=run;sum={};let stopped=false,b='';
    for(let i=0;i<TIDY_ROUNDS;i++){
      say('정리하는 중… '+tidyLine(sum));
      let r;
      try{r=await api(PATH,{method:'POST',body:b?{action:'top-files-tidy',batch:b}:{action:'top-files-tidy'},timeoutMs:TIDY_WAIT_MS,singleFlight:false})}
      catch{stopped=true;break}
      if(!r?.ok){stopped=true;break}
      b=r.batch||b;sum=addTidy(sum,r);
      const step=['moved','attached','trashed','waiting','cant','failed'].reduce((a,k)=>a+(Number(r[k])||0),0);
      if(!r.left||!step||me!==run)break;
    }
    busy=false;batch=b;
    say(tidyLine(sum)+(stopped?' · 중간에 멈췄어요 — 다시 누르면 이어서 해요':''),{error:stopped});
    await load(run);
    say(tidyLine(sum)+(stopped?' · 중간에 멈췄어요 — 다시 누르면 이어서 해요':''),{error:stopped});
    if(sum.moved||sum.attached)onDone?.();
  }
  async function undo(){
    if(busy||!batch)return;
    busy=true;buttons();let restored=0,stopped=false;
    for(let i=0;i<TIDY_ROUNDS;i++){
      let r;
      try{r=await api(PATH,{method:'POST',body:{action:'top-files-undo',batch},timeoutMs:TIDY_WAIT_MS,singleFlight:false})}catch{stopped=true;break}
      if(!r?.ok){stopped=true;break}
      restored+=Number(r.restored)||0;
      if(!r.left||!Number(r.restored))break;
    }
    busy=false;if(!stopped)batch='';
    await load(run);
    say(`되돌렸어요 · ${restored}개를 자료실 맨 위로`+(stopped?' · 중간에 멈췄어요 — 다시 눌러 주세요':''),{error:stopped});
    onDone?.();
  }
  async function send(row){
    const to=row.querySelector('[data-tf-to]')?.value||'',id=row.dataset.tfFile;
    if(!to){say('보낼 곳을 먼저 선택하세요.',{error:true});return}
    const btn=row.querySelector('[data-tf-send]');btn.disabled=true;
    try{
      const r=await api(PATH,{method:'POST',body:{action:'top-files-wait',file_id:id,to},timeoutMs:TIDY_WAIT_MS,singleFlight:false});
      if(!r?.ok)throw new Error('bad');
      scan.wait=scan.wait.filter(f=>f.id!==id);paint();
      say(to==='trash'?'휴지통으로 보냈어요(드라이브에서 30일 안 되돌릴 수 있어요).':'자료실에 등록하고 그 폴더로 옮겼어요.');
      if(to!=='trash')onDone?.();
    }catch{btn.disabled=false;say('보내지 못했어요. 잠시 뒤 다시 해 주세요.',{error:true})}
  }
  function onClick(e){
    if(e.target.closest('[data-tf-close]')){close();return}
    if(e.target.closest('[data-tf-reconnect]')){void reconnect?.();return}
    if(e.target.closest('[data-tf-apply]')){void apply();return}
    if(e.target.closest('[data-tf-undo]')){void undo();return}
    const s=e.target.closest('[data-tf-send]');if(s)void send(s.closest('[data-tf-file]'));
  }
  async function open(from){
    trigger=from||document.activeElement;ensure();
    const me=++run;busy=false;scan=null;
    $('#libraryTopFilesSub').textContent='';buttons();
    root.classList.remove('hidden');root.setAttribute('aria-hidden','false');
    window.KPTUA11y?.dialog?.activate?.(root,{trigger,initialFocus:root.querySelector('[data-tf-close]'),onRequestClose:close});
    if(!window.KPTUA11y?.dialog)root.querySelector('[data-tf-close]')?.focus();
    await load(me);
  }
  return {open,close,isOpen};
}
