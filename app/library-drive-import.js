// S69-25 LIB-드라이브에서가져오기(명진 11/24 09:22): 자료실 맨 위 ⋯ [드라이브에서 가져오기] 창.
// 내 구글 드라이브에만 있고 자료실에 없는 파일을 드라이브 폴더 경로별로 보여 주고(이름·크기·수정일), 선택한 것을 자료로 등록한다.
// 서버: library-files action drive-import-list / drive-import-add(drive-import.mjs) — 내 작업공간·내 구글 연결만, 파일 내용은 열지 않음,
//   드라이브 파일을 복사·다시 올리기·옮기기·지우기 하지 않는다(같은 드라이브 id로 자료 행만). 받는 폴더(잡동사니)에 넣는 일은 서버 트리거.
// 개인 서류로 보이는 이름·사진/동영상은 기본으로 빼 둔다(선택하면 넣음). 많으면 50개씩 나눠 보내고, 멈추면 남은 것만 다시 이어 한다.
// S69-25b(명진 11/24 09:43 "드라이브 전체가 아니라 드라이브 안에서 공공운수노조 폴더 안에 있는 것만"): 창 맨 위에서 드라이브 폴더 하나를 고르면
//   그 폴더 안(하위 포함)만 훑는다(서버 drive-import-folders로 '내 드라이브' 바로 아래 내 폴더 목록, list·add에 folder_id — 서버가 다시 확인).
//   마지막에 고른 폴더는 서버 화면 기억(view_prefs.drive_import_folder)에 둔다. 폴더 이름은 코드에 박지 않는다.
// S69-45: 드라이브 id가 달라도 자료실에 같은 내용(md5 + 크기)이 있는 파일은 '이미 있음(같은 내용: 자료 이름·폴더)'으로 표시하고 기본 선택에서 뺀다(서버가 판정).
// 기기 저장 없음(상태는 이 창 메모리·서버 화면 기억에만).
import {defaultPicked,groupByPath,batches,sizeText,addTotals,resultLine,headLine,skippedLine,pickFolder,sameNote} from './library-drive-import-model.mjs';
import {waitHtml,emptyHtml} from './wait-state.js';
import {viewPrefs} from './view-prefs.js';

const PATH='/functions/v1/library-files';
export const DRIVE_IMPORT_LABEL='드라이브에서 가져오기';

// api(path,{method,body}), esc(text), receiveName(): 받는 폴더 이름|null, onDone(): 자료실 다시 읽기, reconnect(): 자료실의 [Drive 다시 연결].
export function createDriveImport({api,esc,receiveName,onDone,reconnect}){
  let root=null,trigger=null,run=0,busy=false,data=null,picked=new Set(),done=new Set(),totals=null,folders=[],folderId='',chosenThisVisit='';
  const $=s=>root.querySelector(s);
  function ensure(){
    if(root)return root;
    document.body.insertAdjacentHTML('beforeend',`<div id="libraryDriveImportModal" class="modal hidden" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="libraryDriveImportTitle"><div class="modal-card small-card lu-di-card"><div class="modal-head"><div><h2 id="libraryDriveImportTitle">${DRIVE_IMPORT_LABEL}</h2><p id="libraryDriveImportSub" class="lu-di-sub" aria-live="polite"></p></div><button class="icon-btn" type="button" data-di-close aria-label="닫기">×</button></div><div class="lu-di-from"><label for="libraryDriveImportFolder">드라이브 폴더</label><select id="libraryDriveImportFolder" data-di-folder disabled><option value="">—</option></select></div><div class="lu-di-list" id="libraryDriveImportList"></div><p class="status" id="libraryDriveImportStatus" role="status"></p><div class="modal-action-footer"><button class="secondary" type="button" data-di-close>닫기</button><button class="primary" type="button" data-di-apply disabled>가져오기</button></div></div></div>`);
    root=document.querySelector('#libraryDriveImportModal');
    root.addEventListener('click',onClick);
    root.addEventListener('change',onChange);
    return root;
  }
  const isOpen=()=>!!root&&!root.classList.contains('hidden');
  function close(){
    if(!isOpen()||busy)return;run++;
    root.classList.add('hidden');root.setAttribute('aria-hidden','true');
    if(window.KPTUA11y?.dialog?.deactivate)window.KPTUA11y.dialog.deactivate(root);else if(trigger?.isConnected)trigger.focus({preventScroll:true});
  }
  const left=()=>(data?.items||[]).filter(it=>!done.has(it.id));
  const target=()=>{const n=receiveName?.();return n?`'${n}'`:''};
  function applyLabel(){
    const b=$('[data-di-apply]'),n=[...picked].filter(id=>!done.has(id)).length,t=target();
    b.textContent=(t?`${t}로 가져오기`:'자료실로 가져오기')+(n?` ${n}`:'');
    b.disabled=busy||!n;
  }
  function say(text,{error=false}={}){const s=$('#libraryDriveImportStatus');s.textContent=text||'';s.classList.toggle('error',!!error)}
  function sub(){
    if(!data)return;
    const items=left(),n=[...picked].filter(id=>!done.has(id)).length;
    const extra=[skippedLine(data.skipped),receiveName?.()?'':'받는 폴더가 꺼져 있어 폴더 밖에 들어가요'].filter(Boolean).join(' · ');
    $('#libraryDriveImportSub').textContent=headLine({total:Math.max(0,(data.total||0)-done.size),shown:items.length,picked:n,more:data.more,partial:data.partial,same:items.filter(it=>it.same).length,samePartial:!!data.same_partial})+(extra?' · '+extra:'');
    applyLabel();
  }
  function rowHtml(it){
    const meta=[it.kind==='link'?'구글 문서(링크)':sizeText(it.size),it.modified||''].filter(Boolean).join(' · ');
    return `<label class="lu-di-row"><input type="checkbox" data-di-pick="${esc(it.id)}"${picked.has(it.id)?' checked':''}><span class="lu-di-name">${esc(it.name)}</span>${it.personal?'<span class="lu-di-note">개인 서류로 보여 뺐어요</span>':''}${it.same?`<span class="lu-di-note" data-di-same>${esc(sameNote(it))}</span>`:''}<span class="lu-di-meta">${esc(meta)}</span></label>`;
  }
  function paint(){
    const list=$('#libraryDriveImportList'),items=left();
    if(!items.length){list.innerHTML=emptyHtml(totals?'남은 파일 없음':'자료실에 없는 파일 없음');sub();return}
    const groups=groupByPath(items),open=items.length<=300;
    list.innerHTML=groups.map((g,i)=>{
      const n=g.items.filter(it=>picked.has(it.id)).length,all=n===g.items.length;
      return `<details class="lu-di-group"${open?' open':''}><summary><input type="checkbox" data-di-group="${i}" aria-label="${esc(g.path)} 모두 선택"${all?' checked':''}${n&&!all?' data-mixed':''}><span class="lu-di-path">${esc(g.path)}</span><span class="lu-di-count">${n}/${g.items.length}</span></summary>${g.items.map(rowHtml).join('')}</details>`;
    }).join('');
    list.querySelectorAll('[data-mixed]').forEach(x=>{x.indeterminate=true});
    const media=items.filter(it=>it.media&&!picked.has(it.id)).length;
    if(media)list.insertAdjacentHTML('afterbegin',`<p class="lu-di-hint">사진·동영상 ${media}개는 기본으로 뺐어요(선택하면 넣어요).</p>`);
    sub();
  }
  function onChange(e){
    const t=e.target;
    if(t.matches('[data-di-folder]')){void choose(t.value);return}
    if(t.matches('[data-di-pick]')){if(t.checked)picked.add(t.dataset.diPick);else picked.delete(t.dataset.diPick);const g=t.closest('details');if(g)syncGroup(g);sub();return}
    if(t.matches('[data-di-group]')){const g=t.closest('details');g.querySelectorAll('[data-di-pick]').forEach(x=>{x.checked=t.checked;if(t.checked)picked.add(x.dataset.diPick);else picked.delete(x.dataset.diPick)});syncGroup(g);sub()}
  }
  function syncGroup(g){
    const boxes=[...g.querySelectorAll('[data-di-pick]')],n=boxes.filter(x=>x.checked).length,head=g.querySelector('[data-di-group]');
    head.checked=n===boxes.length;head.indeterminate=n>0&&n<boxes.length;
    g.querySelector('.lu-di-count').textContent=`${n}/${boxes.length}`;
  }
  function onClick(e){
    if(e.target.closest('[data-di-close]')){close();return}
    if(e.target.closest('[data-di-reconnect]')){void reconnect?.();return}
    if(e.target.closest('summary')&&e.target.matches('[data-di-group]'))e.stopPropagation();
    if(e.target.closest('[data-di-apply]'))void apply();
  }
  const SCOPE_HTML='<p class="lu-di-empty">구글 드라이브 전체를 볼 권한이 아직 없어 목록을 못 읽어요. [Drive 다시 연결]에서 드라이브 권한을 모두 허용한 뒤 다시 해 주세요.</p><p class="lu-di-empty"><button type="button" class="secondary" data-di-reconnect>Drive 다시 연결</button></p>';
  function paintFolders(){
    const sel=$('#libraryDriveImportFolder');
    sel.innerHTML=`<option value="">${folders.length?'폴더 선택':'선택할 폴더 없음'}</option>`+folders.map(f=>`<option value="${esc(f.id)}"${f.id===folderId?' selected':''}>${esc(f.name)}</option>`).join('');
    sel.disabled=busy||!folders.length;
  }
  // 고를 폴더 목록 → 기억한 폴더가 있으면 바로 그 안을 읽는다.
  async function loadFolders(me){
    $('#libraryDriveImportList').innerHTML=waitHtml({rows:4});
    say('');
    try{
      const d=await api(PATH,{method:'POST',body:{action:'drive-import-folders'}});
      if(me!==run)return;
      if(d?.ok===false&&d?.code==='scope_missing'){$('#libraryDriveImportFolder').innerHTML='<option value="">—</option>';$('#libraryDriveImportList').innerHTML=SCOPE_HTML;return}
      if(!d?.ok||!Array.isArray(d.folders))throw new Error('bad');
      folders=d.folders;folderId=pickFolder(folders,chosenThisVisit||viewPrefs.get('drive_import_folder'));
      paintFolders();
      if(folderId)await load(me);
      else{$('#libraryDriveImportList').innerHTML=emptyHtml(folders.length?'가져올 드라이브 폴더를 선택하세요(그 안 하위 폴더까지 훑어요)':'내 드라이브에 선택할 폴더가 없어요');sub()}
    }catch(err){
      if(me!==run)return;
      $('#libraryDriveImportList').innerHTML='';
      say(err?.status===424?String(err.message||'Google Drive 연결을 확인해 주세요.'):'드라이브 폴더 목록을 읽지 못했어요. 잠시 후 다시 해 주세요.',{error:true});
    }
  }
  async function choose(id){
    if(busy)return;
    folderId=folders.some(f=>f.id===id)?id:'';
    const me=++run;data=null;picked=new Set();done=new Set();totals=null;
    if(!folderId){$('#libraryDriveImportList').innerHTML=emptyHtml('가져올 드라이브 폴더를 선택하세요(그 안 하위 폴더까지 훑어요)');$('#libraryDriveImportSub').textContent='';applyLabel();return}
    chosenThisVisit=folderId;
    viewPrefs.set('drive_import_folder',folderId,{rejectable:true});
    await load(me);
  }
  async function load(me){
    $('#libraryDriveImportList').innerHTML=waitHtml({rows:4});
    say('');
    try{
      const d=await api(PATH,{method:'POST',body:{action:'drive-import-list',folder_id:folderId}});
      if(me!==run)return;
      if(d?.ok===false&&d?.code==='scope_missing'){$('#libraryDriveImportList').innerHTML=SCOPE_HTML;return}
      if(!d?.ok||!Array.isArray(d.items))throw new Error('bad');
      data=d;picked=new Set(d.items.filter(defaultPicked).map(it=>it.id));done=new Set();totals=null;
      paint();
    }catch(err){
      if(me!==run)return;
      $('#libraryDriveImportList').innerHTML='';
      say(err?.status===424||err?.status===400?String(err.message||'Google Drive 연결을 확인해 주세요.'):'드라이브 목록을 읽지 못했어요. 잠시 후 다시 해 주세요.',{error:true});
    }
  }
  async function apply(){
    if(busy||!data)return;
    const ids=left().map(it=>it.id).filter(id=>picked.has(id));if(!ids.length)return;
    busy=true;applyLabel();paintFolders();const me=run;let sum=totals||{added:0,exists:0,unreadable:0,failed:0},stopped=false;
    const parts=batches(ids);
    for(let i=0;i<parts.length;i++){
      say(`가져오는 중… ${Math.min((i+1)*parts[0].length,ids.length)}/${ids.length}`);
      try{
        const r=await api(PATH,{method:'POST',body:{action:'drive-import-add',folder_id:folderId,file_ids:parts[i]},singleFlight:false});
        sum=addTotals(sum,r);parts[i].forEach(id=>done.add(id));
      }catch{stopped=true;break}
      if(me!==run)break;
    }
    busy=false;totals=sum;
    paintFolders();paint();
    say(resultLine(sum)+(stopped?' · 중간에 멈췄어요 — 다시 누르면 남은 것만 이어서 가져와요':''),{error:stopped});
    if(sum.added)onDone?.();
  }
  async function open(from){
    trigger=from||document.activeElement;ensure();
    const me=++run;data=null;picked=new Set();done=new Set();totals=null;busy=false;folders=[];folderId='';
    $('#libraryDriveImportSub').textContent='';applyLabel();
    root.classList.remove('hidden');root.setAttribute('aria-hidden','false');
    window.KPTUA11y?.dialog?.activate?.(root,{trigger,initialFocus:root.querySelector('[data-di-close]'),onRequestClose:close});
    if(!window.KPTUA11y?.dialog)root.querySelector('[data-di-close]')?.focus();
    await loadFolders(me);
  }
  return {open,close,isOpen};
}
