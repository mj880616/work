// LIB-토글트리 ③(docs/design/library-tree.md 6절): 자료실 전용 폴더 편집 — ⋯ 메뉴·작은 창·저장.
// 목록 그리기는 library-upload.js의 luRenderLibrary 하나다. 이 모듈은 폴더 메뉴(⋯), 이름·옮길 곳을 고르는 작은 창,
// 저장(기존 소유자 RLS REST: app_library_folders·app_library_folder_items)만 맡고, 저장 뒤 reload()로 다시 그리게 한다.
// 순환·100단(folder-limits.mjs)·같은 프로젝트 틀은 DB 트리거가 지키고(거절 SQLSTATE 23514 + LIB_FOLDER_*), 화면은 같은 규칙으로 고를 수 있는 곳만 보인다.
// 폴더·자료 연결만 바꾼다. 자료(app_documents)·프로젝트·Drive 파일은 건드리지 않는다.
import {createAnchoredMenu} from './anchored-menu.js';
import {FOLDER_DEPTH,OUTSIDE_KEY,SORT_GAP,canAddChild,cleanFolderName,folderTrashCounts,folderDepth,folderErrorText,folderMoveTargets,folderReorderPlan,folderSiblings,nextSortOrder} from './library-tree.js';
import {pickerRows} from './library-move.mjs';
import {folderIndent} from './folder-limits.mjs';
import {createMovePicker} from './library-move-picker.js';

const T_FOLDERS='/rest/v1/app_library_folders',T_ITEMS='/rest/v1/app_library_folder_items';
const enc=encodeURIComponent;

export function mountLibraryFolders({api,esc,state,reload,status,reveal=()=>{},notify=null,toggleNode=()=>{},selected=()=>[],touchOk=()=>false,recent={get:()=>[],push:()=>{}},onMoveProgress=()=>{},onMoved=()=>{},categoryOf=null,changeCategory=null,photoSetDocs=()=>[],enter=null,selectNode=null}){
  // state(): {workspace, folders, items, docs, projectName(id), free(폴더 보기: 프로젝트 틀을 보지 않음), isOpen(key)}
  // notify(text,{error,undo}): '… · 되돌리기' 한 줄(없으면 status). toggleNode(key): 토글 접기·펼치기.
  // selected(): 지금 고른 자료 id들(여러 개 끌기). touchOk(): 폰 길게 누르기를 켤 화면인지.
  // recent: 최근 넣은 폴더 기억(get()=id 목록, push(id)=맨 앞에 두고 서버에 기억). state().treeView: 지금 묶기가 폴더 토글이 보이는 화면(프로젝트·폴더)인지.
  let busy=false,dialog=null;
  const s=()=>state();
  const folder=id=>s().folders.find(f=>f.id===id);
  const frameName=pid=>pid?s().projectName(pid):'사업영역 없음';
  // 폴더 경로 이름(옮길 곳 고르기): "가 › 나 › 다".
  const pathName=id=>{const out=[];let f=folder(id),guard=0;while(f&&guard++<FOLDER_DEPTH+2){out.unshift(f.name);f=f.parent_id?folder(f.parent_id):null}return out.join(' › ')};
  // 자료의 폴더. 프로젝트 묶기에서는 자료의 프로젝트 틀과 맞는 연결만(설계 3.2, 어긋난 연결은 없는 것으로), 폴더 보기에서는 틀과 무관하게 연결 그대로(설계 12절).
  function docFolder(doc){const it=s().items.find(x=>x.document_id===doc.id),f=it&&folder(it.folder_id);return f&&(s().free||(f.project_id||null)===(doc.project_id||null))?f:null}
  const sibs=(projectId,parentId)=>folderSiblings(s().folders,{projectId,parentId,free:!!s().free});
  const say=(text,opt)=>notify?notify(text,opt):status(text,!!opt?.error);
  const rawItem=doc=>s().items.find(x=>x.document_id===doc.id)||null;

  let lastError='';
  async function run(work,done){
    if(busy)return false;busy=true;status('');lastError='';
    try{await work();await reload();if(done)status(done);return true}
    catch(e){lastError=folderErrorText(e);status(lastError,true);try{await reload()}catch{}return false}
    finally{busy=false}
  }
  const where=id=>`?id=eq.${enc(id)}&workspace_id=eq.${enc(s().workspace)}`;

  // ---- 저장 ----
  // 만든 뒤·옮긴 뒤에는 그 자리가 보이도록 위 토글을 연다(프로젝트 토글 → 상위 폴더들).
  const chain=(projectId,folderId)=>{const keys=['p:'+(projectId||'none')];let f=folderId?folder(folderId):null,guard=0;const up=[];while(f&&guard++<FOLDER_DEPTH+2){up.unshift('f:'+f.id);f=f.parent_id?folder(f.parent_id):null}return [...keys,...up]};
  const createFolder=(projectId,parentId,name)=>run(()=>api(T_FOLDERS,{method:'POST',prefer:'return=minimal',body:{workspace_id:s().workspace,project_id:projectId||null,parent_id:parentId||null,name,sort_order:nextSortOrder(sibs(projectId,parentId))}}),'폴더를 만들었어요.').then(ok=>{if(ok)reveal(chain(projectId,parentId));return ok});
  const patchName=(id,name,done)=>run(()=>api(T_FOLDERS+where(id),{method:'PATCH',prefer:'return=minimal',body:{name}}),done);
  // 이름 바꾸기: 저장하면 줄 위 한 줄에 '이름을 바꿨어요 · 되돌리기'(자료 줄 이름 바꾸기와 같은 방식). 그 사이 또 바뀌었으면 되돌리지 않는다.
  const renameFolder=async(id,name)=>{
    const before=folder(id)?.name;
    const ok=await patchName(id,name,'');
    if(ok&&before!==undefined&&before!==name)say('이름을 바꿨어요 ·',{undo:async()=>{if(folder(id)?.name!==name){say('그 사이 이름이 또 바뀌어 되돌리지 않았어요.');return}await patchName(id,before,'이름을 되돌렸어요.')}});
    return ok;
  };
  const reorderFolder=(id,dir)=>{const plan=folderReorderPlan(s().folders,id,dir,!!s().free);if(!plan.length)return Promise.resolve(false);return run(async()=>{for(const p of plan)await api(T_FOLDERS+where(p.id),{method:'PATCH',prefer:'return=minimal',body:{sort_order:p.sort_order}})})};
  const moveFolder=(id,parentId,done='폴더를 옮겼어요.')=>{const f=folder(id),pid=f?.project_id||null;return run(()=>api(T_FOLDERS+where(id),{method:'PATCH',prefer:'return=minimal',body:{parent_id:parentId||null,sort_order:nextSortOrder(sibs(pid,parentId))}}),done).then(ok=>{if(ok)reveal(chain(pid,parentId));return ok})};
  // TRASH-다른삭제 3단계: [폴더 지우기]는 휴지통으로 보낸다(공용 흐름 trash-actions.js). 요청은 그대로 폴더 하나의 DELETE이고(설계 3.4),
  // 서버의 가로채기 트리거가 그 폴더와 아래 폴더 전부를 휴지통 표시로 바꾼다(자료 연결은 그대로, 자료실 목록에서만 함께 숨음).
  // 휴지통 함수가 이 종류를 모르면(DB 적용 전) '준비 중'을 알리고 삭제 요청을 보내지 않는다. 영구 삭제만 안의 것을 한 단 위로 올린다.
  async function trashFolder(f){
    if(busy)return false;busy=true;status('');
    try{
      const {deleteToTrash}=await import('./trash-actions.js');
      const r=await deleteToTrash({kind:'library_folder',id:f.id,name:f.name,detail:folderTrashCounts(s().folders,s().items,f.id),
        remove:()=>api(T_FOLDERS+where(f.id),{method:'DELETE',prefer:'return=minimal'}),afterChange:reload,notify:text=>status(text,true)});
      if(r.status==='failed')status(folderErrorText(r.error),true);
      return r.status==='moved';
    }catch(e){status(folderErrorText(e),true);try{await reload()}catch{}return false}
    finally{busy=false}
  }
  // 자료를 폴더로: 연결이 있으면 folder_id만 고치고(어긋난 연결도 고쳐 씀), 없으면 새로 넣는다. 폴더 밖으로 = 연결 지우기.
  function fileToFolder(doc,folderId){
    const it=rawItem(doc),w=`?document_id=eq.${enc(doc.id)}&workspace_id=eq.${enc(s().workspace)}`;
    return run(()=>it?api(T_ITEMS+w,{method:'PATCH',prefer:'return=minimal',body:{folder_id:folderId}}):api(T_ITEMS,{method:'POST',prefer:'return=minimal',body:{document_id:doc.id,folder_id:folderId,workspace_id:s().workspace}}),'폴더로 옮겼어요.').then(ok=>{if(ok)reveal(chain(doc.project_id||null,folderId));return ok});
  }
  function fileOut(doc){const it=rawItem(doc);if(!it)return Promise.resolve(false);return run(()=>api(T_ITEMS+`?document_id=eq.${enc(doc.id)}&workspace_id=eq.${enc(s().workspace)}`,{method:'DELETE',prefer:'return=minimal'}),'폴더 밖으로 옮겼어요.')}

  // ---- 작은 창(이름 입력·옮길 곳 고르기) ----
  function ensureDialog(){
    if(dialog)return dialog;
    document.body.insertAdjacentHTML('beforeend',`<div id="libraryFolderModal" class="modal hidden" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="libraryFolderTitle"><div class="modal-card small-card lu-folder-card"><div class="modal-head"><div><h2 id="libraryFolderTitle"></h2><p id="libraryFolderHint" class="lu-folder-hint"></p></div><button id="libraryFolderClose" class="icon-btn" type="button" aria-label="닫기">×</button></div><form id="libraryFolderForm" data-enter-save novalidate><label id="libraryFolderNameField" class="lu-folder-name">폴더 이름<input id="libraryFolderName" type="text" maxlength="40" autocomplete="off"></label><div id="libraryFolderTargets" class="lu-folder-targets" role="radiogroup" aria-labelledby="libraryFolderTitle"></div><p id="libraryFolderStatus" class="status" role="status"></p><div class="modal-action-footer"><button id="libraryFolderCancel" class="secondary" type="button">취소</button><button id="libraryFolderSave" class="primary" type="submit" data-enter-save-submit>저장</button></div></form></div></div>`);
    const root=document.querySelector('#libraryFolderModal');
    dialog={root,title:root.querySelector('#libraryFolderTitle'),hint:root.querySelector('#libraryFolderHint'),nameField:root.querySelector('#libraryFolderNameField'),name:root.querySelector('#libraryFolderName'),targets:root.querySelector('#libraryFolderTargets'),status:root.querySelector('#libraryFolderStatus'),save:root.querySelector('#libraryFolderSave'),submit:null,trigger:null};
    const close=()=>closeDialog();
    root.querySelector('#libraryFolderClose').addEventListener('click',close);root.querySelector('#libraryFolderCancel').addEventListener('click',close);
    root.querySelector('#libraryFolderForm').addEventListener('submit',async e=>{e.preventDefault();if(!dialog.submit||dialog.save.disabled)return;dialog.save.disabled=true;dialog.save.setAttribute('aria-busy','true');try{const ok=await dialog.submit();if(ok!==false)closeDialog();else if(lastError)fail(lastError)}finally{dialog.save.disabled=false;dialog.save.removeAttribute('aria-busy')}});
    // 옮길 곳: 하나만 고르는 줄 목록(라디오 모양 버튼, 화살표로 옮김).
    dialog.targets.addEventListener('click',e=>{const b=e.target.closest('[data-lu-target]');if(b)pickTarget(b)});
    dialog.targets.addEventListener('keydown',e=>{const list=[...dialog.targets.querySelectorAll('[data-lu-target]')],i=list.indexOf(document.activeElement);if(i<0)return;const j=e.key==='ArrowDown'?i+1:e.key==='ArrowUp'?i-1:-9;if(j===-9)return;e.preventDefault();const b=list[(j+list.length)%list.length];b.focus();pickTarget(b)});
    return dialog;
  }
  function pickTarget(b){for(const x of dialog.targets.querySelectorAll('[data-lu-target]')){const on=x===b;x.setAttribute('aria-checked',String(on));x.tabIndex=on?0:-1}dialog.save.disabled=false}
  const picked=()=>dialog.targets.querySelector('[aria-checked="true"]')?.dataset.luTarget;
  function openDialog({title,hint='',name=null,targets=null,save='저장',submit,trigger}){
    const d=ensureDialog();d.trigger=trigger||document.activeElement;d.title.textContent=title;d.hint.textContent=hint;d.hint.hidden=!hint;d.status.textContent='';d.status.className='status';
    d.nameField.hidden=name===null;d.name.value=name??'';
    d.targets.hidden=!targets;d.targets.innerHTML=(targets||[]).map((t,i)=>`<button type="button" role="radio" class="lu-folder-target" data-lu-target="${esc(t.value)}" aria-checked="false" tabindex="${i?-1:0}" style="--lu-target-depth:${folderIndent(t.depth)}">${esc(t.label)}</button>`).join('');
    d.save.textContent=save;d.save.disabled=!!targets;d.submit=submit;
    d.root.classList.remove('hidden');d.root.setAttribute('aria-hidden','false');
    window.KPTUA11y?.dialog?.activate?.(d.root,{trigger:d.trigger,initialFocus:name!==null?d.name:d.targets.querySelector('[data-lu-target]'),onRequestClose:closeDialog});
    if(!window.KPTUA11y?.dialog)(name!==null?d.name:d.targets.querySelector('[data-lu-target]'))?.focus();
  }
  function closeDialog(){if(!dialog||dialog.root.classList.contains('hidden'))return;dialog.root.classList.add('hidden');dialog.root.setAttribute('aria-hidden','true');dialog.submit=null;if(window.KPTUA11y?.dialog?.deactivate)window.KPTUA11y.dialog.deactivate(dialog.root);else if(dialog.trigger?.isConnected)dialog.trigger.focus({preventScroll:true})}
  const fail=text=>{dialog.status.textContent=text;dialog.status.className='status error';return false};
  const askName=({title,hint,name='',trigger,then})=>openDialog({title,hint,name,trigger,submit:async()=>{const clean=cleanFolderName(dialog.name.value);if(!clean)return fail('폴더 이름은 1~40자로 써 주세요.');if(clean===name)return true;return await then(clean)}});
  const askTarget=({title,hint,targets,trigger,then})=>{if(!targets.length){status('옮길 수 있는 곳이 없어요.',true);return}openDialog({title,hint,targets,save:'옮기기',trigger,submit:async()=>{const v=picked();if(v===undefined)return fail('옮길 곳을 골라 주세요.');return await then(v==='__top__'?null:v)}})};

  // ---- 메뉴 ----
  // key: 'p:<project id>' | 'p:none' | 'f:<folder id>'
  const outsideHead=()=>document.querySelector(`#documentList [data-lu-node-menu="${OUTSIDE_KEY}"]`);
  const frameFromKey=key=>key==='p:none'||key===OUTSIDE_KEY?null:key.slice(2);
  const sep='<hr class="lu-menu-sep" role="separator">';
  const menu=createAnchoredMenu({id:'luFolderMenu',className:'lu-folder-menu',label:'폴더 관리',historyKey:'kptuLibraryFolderMenu',key:t=>t.dataset.luNodeMenu,
    render:key=>{
      if(!key.startsWith('f:'))return '<button type="button" data-lu-folder-action="create">새 폴더</button>'+(key===OUTSIDE_KEY&&selectNode?.(key)?'<button type="button" data-lu-folder-action="select-all">전체 고르기</button>':'');
      const f=folder(key.slice(2));if(!f)return '';
      const sib=sibs(f.project_id||null,f.parent_id||null),i=sib.findIndex(x=>x.id===f.id);
      // LIB-폴더100단 ②(10:34): 폴더 보기에서는 펼치기·접기 다음에 [이 폴더로 들어가기] — 그 폴더만 보이고 위에 위치 줄(자료실 › … ). 폴더 줄을 두 번 눌러도 같다.
      // '폴더 밖'이 비어 그 줄이 없으면(LIB-정리보충) 맨 위 폴더 메뉴 첫 줄이 맨 위 새 폴더 자리.
      const top=s().free&&!s().inFolder&&!f.parent_id&&!outsideHead()?'<button type="button" data-lu-folder-action="create-top">맨 위에 새 폴더</button>':'';
      return top+'<button type="button" data-lu-folder-action="rename" aria-keyshortcuts="F2">이름 바꾸기<span class="lu-menu-key" aria-hidden="true">F2</span></button>'
        +(canAddChild(s().folders,f.id)?'<button type="button" data-lu-folder-action="create">안에 새 폴더</button>':'')
        +`<button type="button" data-lu-folder-action="toggle">${s().isOpen?.(key)?'접기':'펼치기'}</button>`
        +(enter&&s().free?'<button type="button" data-lu-folder-action="enter">이 폴더로 들어가기</button>':'')
        +(i>0?'<button type="button" data-lu-folder-action="up">위로</button>':'')+(i>=0&&i<sib.length-1?'<button type="button" data-lu-folder-action="down">아래로</button>':'')
        +(folderMoveTargets(s().folders,f.id,!!s().free).length?'<button type="button" data-lu-folder-action="move">옮기기…</button>':'')
        +sep+'<button type="button" class="lu-menu-danger" data-lu-folder-action="delete">폴더 지우기</button>';
    },
    onAction:(button,active)=>{const key=active.id,action=button.dataset.luFolderAction,trigger=active.trigger;if(key.startsWith('f:'))folderAction(key.slice(2),action,trigger);else if(action==='select-all')selectNode?.(key,true);else if(action==='create')askName({title:'폴더 만들기',hint:(key===OUTSIDE_KEY?'폴더 밖(맨 위)에':frameName(frameFromKey(key))+' 안에')+' 만들어요. 자료실에서만 보이고 Drive 폴더는 바뀌지 않아요.',trigger,then:name=>createFolder(frameFromKey(key),null,name)})}});
  function folderAction(id,action,trigger){
    const f=folder(id);if(!f)return;
    if(action==='create-top')askName({title:'폴더 만들기',hint:'폴더 밖(맨 위)에 만들어요. 자료실에서만 보이고 Drive 폴더는 바뀌지 않아요.',trigger,then:name=>createFolder(null,null,name)});
    else if(action==='create')askName({title:'안에 폴더 만들기',hint:pathName(id)+' 안에 만들어요.',trigger,then:name=>createFolder(f.project_id||null,id,name)});
    else if(action==='enter')enter?.(id);
    else if(action==='rename')startRename(id);
    else if(action==='toggle')toggleNode('f:'+id);
    else if(action==='up'||action==='down')void reorderFolder(id,action).then(()=>focusHead('f:'+id));
    else if(action==='move')askTarget({title:'폴더 옮기기',hint:s().free?`${f.name}을(를) 옮길 곳을 고르세요.`:`${f.name}을(를) 옮길 곳을 고르세요. 같은 사업영역 안에서만 옮길 수 있어요.`,trigger,targets:folderMoveTargets(s().folders,id,!!s().free).map(t=>t===null?{value:'__top__',label:s().free?'맨 위(폴더 밖)':frameName(f.project_id||null)+' 바로 아래',depth:0}:{value:t,label:pathName(t),depth:folderDepth(s().folders,t)}),then:parent=>moveFolder(id,parent)});
    else if(action==='delete')void trashFolder(f);
  }
  const headOf=key=>[...document.querySelectorAll('#documentList summary.lu-node-head')].find(h=>h.parentElement?.dataset.luNode===key);
  // 줄 안 이름 바꾸기(폴더): 창 없이 그 줄 이름이 입력칸이 된다. Enter·바깥 누르기=저장, Esc=취소. 저장은 폴더 이름뿐(자료·Drive는 그대로).
  let renaming=null;
  function startRename(id){
    const f=folder(id);if(!f||busy)return;
    if(renaming){if(renaming.id===id){renaming.input.focus();return}renaming.finish(true)}
    const head=headOf('f:'+id),nameEl=head?.querySelector('.lu-node-name');if(!head||!nameEl)return;
    const input=document.createElement('input'),wasDraggable=head.getAttribute('draggable');
    input.type='text';input.className='lu-folder-rename';input.value=f.name;input.maxLength=40;input.autocomplete='off';input.setAttribute('aria-label','폴더 이름');
    let done=false;
    const state={id,input,finish(save,refocus=false){
      if(done)return;done=true;if(renaming===state)renaming=null;
      const raw=input.value;
      if(input.isConnected)input.replaceWith(nameEl);if(wasDraggable!==null&&head.isConnected)head.setAttribute('draggable',wasDraggable);
      if(refocus&&head.isConnected)head.focus({preventScroll:true});
      if(!save||raw===f.name)return;
      const clean=cleanFolderName(raw);
      if(!clean){status('폴더 이름은 1~40자로 써 주세요.',true);return}
      if(clean!==f.name)void renameFolder(id,clean).then(()=>focusSummary('f:'+id));
    }};
    for(const type of ['click','dblclick','pointerdown','mousedown','keyup','keypress'])input.addEventListener(type,e=>e.stopPropagation());
    input.addEventListener('keydown',e=>{
      e.stopPropagation();
      if(e.isComposing||e.keyCode===229)return;
      if(e.key==='Enter'){e.preventDefault();state.finish(true,true)}
      else if(e.key==='Escape'){e.preventDefault();state.finish(false,true)}
    });
    input.addEventListener('blur',()=>state.finish(input.isConnected));
    head.removeAttribute('draggable');nameEl.replaceWith(input);renaming=state;
    input.focus({preventScroll:true});input.select();
  }
  function focusSummary(key){headOf(key)?.focus({preventScroll:true})}
  function focusHead(key){const b=[...document.querySelectorAll('#documentList [data-lu-node-menu]')].find(x=>x.dataset.luNodeMenu===key);b?.focus({preventScroll:true})}

  // ---- 자료 → 폴더 옮기기 (LIB-폴더로옮기기, 2026-10-27) ----
  // 자료 ⋯·우클릭 메뉴의 [폴더로 옮기기 ›], 선택 모드의 [폴더로 옮기기], 끌어 놓기가 모두 이 아래 moveDocs 하나(app_library_folder_items 쓰기,
  // LIB-폴더탐색기와 같은 길)로 옮긴다. 어느 묶기 화면에서나 같다. 프로젝트 묶기·종류·담당조직·월별에서는 자료의 프로젝트 틀과 같은 폴더에만 넣을 수 있고
  // (프로젝트 묶기는 틀이 다른 연결을 보이지 않으므로) 나머지 폴더는 흐리게 + 이유 한 줄, 묶기 '폴더'에서는 틀과 무관하게 모든 폴더에 넣는다.
  const picker=createMovePicker({esc});
  const itemFolders=()=>new Map(s().items.map(x=>[x.document_id,x.folder_id]));
  const rowsFor=(docs,query='')=>pickerRows({folders:s().folders,docs,itemFolder:itemFolders(),free:!!s().free,recent:recent.get(),query});
  const moveMenuHtml=(doc,count=1)=>`<button type="button" data-lu-move-open="${esc(doc.id)}" aria-haspopup="true" aria-expanded="false">${count>1?`고른 ${count}개 폴더로 옮기기`:'폴더로 옮기기'}<span class="lu-menu-key" aria-hidden="true">›</span></button>`;
  // 옮기고 나면 그 폴더를 '최근 넣은 폴더' 맨 앞에 둔다(서버 기억).
  async function putDocs(docs,folderId,opt={}){const ok=await moveDocs(docs,folderId,opt);if(ok&&folderId)recent.push(folderId);return ok}
  // [+ 새 폴더 만들어 넣기]: 이름을 받아 맨 위 폴더 하나를 만들고(프로젝트 묶기 계열은 자료의 프로젝트 틀, 폴더 묶기는 폴더 밖) 곧바로 그 안에 넣는다.
  function newFolderAndPut(docs,trigger,opt={}){
    const free=!!s().free,frame=free?null:(docs[0]?.project_id||null);
    askName({title:'새 폴더 만들어 넣기',hint:`${docs.length>1?`고른 ${docs.length}개를`:'이 자료를'} 넣을 폴더예요. ${free?'폴더 밖(맨 위)에':frameName(frame)+' 안에'} 만들고, 자료의 사업영역은 바뀌지 않아요.`,trigger,then:async name=>{
      let created=null;
      const ok=await run(async()=>{const rows=await api(T_FOLDERS,{method:'POST',prefer:'return=representation',body:{workspace_id:s().workspace,project_id:frame,parent_id:null,name,sort_order:nextSortOrder(sibs(frame,null))}});created=Array.isArray(rows)?rows[0]?.id||null:null});
      if(!ok)return false;
      if(!created){status('폴더는 만들었지만 자료는 옮기지 못했어요. 목록에서 [폴더로 옮기기]를 다시 눌러 주세요.',true);return false}
      return await putDocs(docs,created,opt);
    }});
  }
  // 목록을 연다. anchor = 누른 버튼, closeOuter = 이 목록을 연 바깥 메뉴(자료 ⋯)를 닫는 함수(고른 뒤 먼저 닫는다), place = 'side'(메뉴 옆)·'below'(도구줄 버튼 아래).
  // all=true(사진 묶음 메뉴): 묶음 안 사진은 모두 옮기거나 모두 그대로(끌어 놓기와 같은 moveDocs all 모드).
  function openMove(docs,anchor,{place='below',history=false,closeOuter=null,trigger=anchor,onClosed=null,all=false}={}){
    const list=(docs||[]).filter(Boolean);if(!list.length||!anchor)return false;
    const after=work=>async(...a)=>{if(closeOuter)await closeOuter();return work(...a)};
    picker.open({anchor,place,history,onClosed,canOut:list.some(d=>rawItem(d)),canNew:!!s().free||new Set(list.map(d=>d.project_id||null)).size===1,
      rows:q=>rowsFor(list,q),
      onPick:after(id=>putDocs(list,id,{all})),onOut:after(()=>moveDocs(list,null,{all})),onNew:after(()=>newFolderAndPut(list,trigger,{all}))});
    return true;
  }
  // ---- 끌어 놓기(LIB-토글트리 ④ + LIB-폴더탐색기, 설계 6·12절) ----
  // 끌 수 있는 것: 폴더 머리, 파일 줄(고른 줄이 여럿이면 고른 것 모두). 놓을 곳:
  //   프로젝트 묶기: 같은 프로젝트 틀 안의 폴더 머리(그 안으로), 같은 상위 형제 폴더의 위·아래 끝(그 앞·뒤로), 그 틀의 프로젝트 머리(폴더 밖으로)
  //   폴더 보기: 틀과 무관하게 모든 폴더 머리(그 안으로), 형제 폴더 위·아래 끝, 맨 위 '폴더 밖' 머리(폴더 밖으로)
  // 자기·자기 아래·100단 초과는 놓을 수 없음 표시. 키보드는 ⋯ 메뉴(위로·아래로·옮기기…)가 같은 일을 한다.
  // 놓은 뒤에는 '옮겼어요 · 되돌리기' 한 줄. 바깥 파일을 올리는 끌어놓기(library-drop.js)는 dataTransfer에 'Files'가 있을 때만 반응하고,
  // 여기는 안에서 시작한 끌기(drag)만 보므로 서로 부딪치지 않는다.
  let drag=null;
  const frameKeyOf=key=>key==='p:none'?null:key.slice(2);
  const docById=id=>s().docs.find(d=>d.id===id);
  const rowOf=id=>[...document.querySelectorAll('#documentList .lu-row')].find(x=>x.dataset.luDocument===id);
  // el에서 시작한 끌기 상태. touch=true(폰 길게 누르기)이면 draggable 표시가 없어도 잡는다.
  function dragFrom(el,touch=false){
    const head=el.closest?.(touch?'summary.lu-node-head':'summary.lu-node-head[draggable="true"]'),row=el.closest?.(touch?'.lu-row[data-lu-document],.lu-row[data-lu-photoset]':'.lu-row[draggable="true"]');
    if(head){const key=head.parentElement?.dataset.luNode||'';if(!key.startsWith('f:'))return null;const f=folder(key.slice(2));if(!f)return null;return {kind:'folder',id:f.id,frame:f.project_id||null,els:[head.parentElement]}}
    // LIB-정리보충 ②: 사진 묶음 줄은 폴더 보기에서만 끈다. 묶음 안 실제 사진 자료 모두가 함께 옮겨지고(set=true), 일부만 옮겨진 채로 끝나지 않는다(moveDocs all).
    if(row?.dataset.luPhotoset){if(!s().free)return null;const docs=photoSetDocs(row.dataset.luPhotoset);if(!docs.length)return null;return {kind:'file',id:'photoset:'+row.dataset.luPhotoset,docs,els:[row],set:true}}
    if(row){
      const doc=docById(row.dataset.luDocument);if(!doc)return null;
      const picked=selected(),many=picked.length>1&&picked.includes(doc.id),docs=(many?picked.map(docById).filter(Boolean):[doc]);
      return {kind:'file',id:doc.id,docs,els:docs.map(d=>rowOf(d.id)).filter(Boolean)};
    }
    return null;
  }
  function dropFor(e){
    if(!drag)return null;
    // LIB-후속1 ⑤: 분류로 묶은 화면에서 자료를 다른 분류 머리(또는 그 분류의 열린 자료 줄) 위에 놓으면 그 분류로 바꾼다. 왼쪽 폴더 팝업은 그대로(폴더 옮기기).
    if(drag.kind==='file'&&categoryOf&&changeCategory){
      const rowNode=e.target?.closest?.('#documentList .lu-row')?.closest('details.lu-node');
      const cHead=e.target?.closest?.('#documentList summary.lu-node-head')||(rowNode?.dataset.luNode?.startsWith('c:')?rowNode.querySelector(':scope > summary.lu-node-head'):null);
      const cKey=cHead?.parentElement?.dataset.luNode||'';
      if(cKey.startsWith('c:')){const name=cKey.slice(2);return {head:cHead,ok:drag.docs.some(d=>categoryOf(d.category)!==name),kind:'category',value:name}}
    }
    // LIB-정리보충 ④(10:41): 폴더 머리뿐 아니라 열린 폴더 안의 자료 줄 위에 놓아도 그 자료가 든 폴더(가장 가까운 토글)로. '폴더 밖' 자료 줄이면 폴더 밖으로.
    let head=e.target?.closest?.('#documentList summary.lu-node-head'),viaRow=false;
    if(!head){const rowNode=e.target?.closest?.('#documentList .lu-row')?.closest('details.lu-node');if(rowNode){head=rowNode.querySelector(':scope > summary.lu-node-head');viaRow=!!head}}
    if(!head)return null;
    const node=head.parentElement,key=node?.dataset.luNode;if(!key)return null;
    const free=!!s().free,r=head.getBoundingClientRect(),y=e.clientY-r.top,edge=viaRow?-1:r.height/4;
    const sameFrame=frame=>drag.kind==='folder'?drag.frame===frame:drag.docs.every(d=>(d.project_id||null)===frame);
    // 맨 위 머리: 프로젝트 묶기는 그 프로젝트 머리, 폴더 보기는 '폴더 밖'.
    if(key.startsWith('p:')||key===OUTSIDE_KEY){
      if(key.startsWith('p:')===free)return {head,ok:false};
      if(!free&&!sameFrame(frameKeyOf(key)))return {head,ok:false};
      if(drag.kind==='file')return {head,ok:drag.docs.some(d=>docFolder(d)),kind:'top'};
      return {head,ok:!!folder(drag.id)?.parent_id,kind:'top'};
    }
    const target=folder(key.slice(2));if(!target)return {head,ok:false};
    if(!free&&!sameFrame(target.project_id||null))return {head,ok:false};
    if(drag.kind==='file')return {head,ok:drag.docs.some(d=>docFolder(d)?.id!==target.id),kind:'into',target:target.id};
    if(target.id===drag.id)return {head,ok:false};
    const f=folder(drag.id),sibling=(target.parent_id||null)===(f.parent_id||null);
    if(sibling&&(y<edge||y>r.height-edge))return {head,ok:true,kind:y<edge?'before':'after',target:target.id};
    const ok=folderMoveTargets(s().folders,drag.id,free).includes(target.id);
    return {head,ok,kind:'into',target:target.id};
  }
  // LIB-정리보충 10:42: 끄는 채 닫힌 폴더(또는 '폴더 밖'·프로젝트 토글) 위에 1초 머물면 저절로 열린다(탐색기 방식). 다른 곳으로 가거나 끌기가 끝나면 취소.
  // 여는 것은 details.open만 바꾼다(목록을 다시 그리지 않아 끌기가 끊기지 않음). 펼침 기억은 기존 toggle 이벤트가 맡는다.
  const HOVER_OPEN_MS=1000;let hoverKey='',hoverTimer=0;
  function hoverOpen(t){
    const node=t?.head?.parentElement,key=node?.dataset?.luNode||'';
    const want=node&&!node.open&&t.kind!=='before'&&t.kind!=='after'?key:'';
    if(want===hoverKey)return;
    clearTimeout(hoverTimer);hoverKey=want;
    if(want)hoverTimer=setTimeout(()=>{if(hoverKey===want&&(drag||touch?.grabbed)&&node.isConnected&&!node.open)node.open=true},HOVER_OPEN_MS);
  }
  function clearMarks(){clearTimeout(hoverTimer);hoverKey='';hideDropPanel();document.querySelectorAll('#documentList .lu-drop-into,#documentList .lu-drop-before,#documentList .lu-drop-after,#documentList .lu-drop-no,#documentList .lu-dragging,#documentList .lu-grabbed,#documentList .lu-drop-group').forEach(el=>el.classList.remove('lu-drop-into','lu-drop-before','lu-drop-after','lu-drop-no','lu-dragging','lu-grabbed','lu-drop-group'))}
  function showMarks(t){
    if(!t)document.querySelectorAll('#documentList .lu-drop-group').forEach(el=>el.classList.remove('lu-drop-group'));
    document.querySelectorAll('#documentList .lu-drop-into,#documentList .lu-drop-before,#documentList .lu-drop-after,#documentList .lu-drop-no').forEach(el=>{if(el!==t?.head)el.classList.remove('lu-drop-into','lu-drop-before','lu-drop-after','lu-drop-no')});
    if(!t)return;t.head.classList.remove('lu-drop-into','lu-drop-before','lu-drop-after','lu-drop-no');
    t.head.classList.add(!t.ok?'lu-drop-no':t.kind==='before'?'lu-drop-before':t.kind==='after'?'lu-drop-after':'lu-drop-into');
    document.querySelectorAll('#documentList .lu-drop-group').forEach(el=>{if(el!==t.head.parentElement)el.classList.remove('lu-drop-group')});
    // 놓일 묶음 전체(머리줄 + 안의 줄)를 연한 강조색으로: 분류 바꾸기, 그리고 자료를 폴더(또는 폴더 밖)에 넣을 때.
    t.head.parentElement?.classList.toggle('lu-drop-group',t.ok&&(t.kind==='category'||(drag?.kind==='file'&&(t.kind==='into'||t.kind==='top'))));
  }
  const markDragging=d=>{for(const el of d?.els||[])el.classList.add('lu-dragging')};
  // 화면 가장자리 근처에서 끌면 목록이 저절로 움직인다(끌기가 끝나면 멈춤).
  let scroller=null,scrollTimer=0,scrollDir=0,scrollSpeed=0;
  function scrollParent(el){for(let n=el?.parentElement;n&&n!==document.body;n=n.parentElement){const o=getComputedStyle(n).overflowY;if((o==='auto'||o==='scroll')&&n.scrollHeight>n.clientHeight)return n}return null}
  function edgeScroll(y,list){
    scroller=scrollParent(list);const box=scroller?scroller.getBoundingClientRect():{top:0,bottom:innerHeight},edge=56;
    scrollDir=y<box.top+edge?-1:y>box.bottom-edge?1:0;
    // 10:42: 끝에 가까울수록 빠르게(가장자리 56px 안에서 4~24px씩). 처음엔 천천히 넘어간다.
    const dist=scrollDir<0?y-box.top:box.bottom-y;scrollSpeed=scrollDir?Math.round(4+20*Math.min(1,Math.max(0,1-dist/edge))):0;
    if(scrollDir&&!scrollTimer){const step=()=>{if(!scrollDir||(!drag&&!touch?.grabbed)){scrollTimer=0;return}(scroller||window).scrollBy(0,scrollDir*scrollSpeed);scrollTimer=requestAnimationFrame(step)};scrollTimer=requestAnimationFrame(step)}
  }
  function stopScroll(){scrollDir=0;if(scrollTimer&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(scrollTimer);scrollTimer=0}
  // 자료 여럿(또는 하나)을 폴더로/폴더 밖으로. 이전 자리를 기억해 '되돌리기'가 그 자리로 돌려놓는다(그 사이 또 바뀐 것은 건드리지 않음).
  // all=true(사진 묶음): 하나라도 못 옮기면 이미 옮긴 것을 이전 자리로 되돌려 '모두 옮김 / 모두 그대로' 둘 중 하나로 끝낸다.
  async function moveDocs(docs,folderId,{all=false}={}){
    const todo=docs.filter(d=>folderId?docFolder(d)?.id!==folderId:!!rawItem(d));if(!todo.length)return false;
    const prev=todo.map(d=>({id:d.id,had:!!rawItem(d),folder:rawItem(d)?.folder_id||null})),w=id=>`?document_id=eq.${enc(id)}&workspace_id=eq.${enc(s().workspace)}`;
    // LIB-후속1 ③: 하나씩 옮기며 'n/전체'를 알리고, 일부가 실패해도 옮긴 것은 그대로 둔다(실패한 것만 onMoved로 돌려 고른 채 남김).
    const done=[],failed=[];let firstError=null;
    const ok=await run(async()=>{for(let i=0;i<prev.length;i++){const p=prev[i];
      try{
        if(folderId===null)await api(T_ITEMS+w(p.id),{method:'DELETE',prefer:'return=minimal'});
        else if(p.had)await api(T_ITEMS+w(p.id),{method:'PATCH',prefer:'return=minimal',body:{folder_id:folderId}});
        else await api(T_ITEMS,{method:'POST',prefer:'return=minimal',body:{document_id:p.id,folder_id:folderId,workspace_id:s().workspace}});
        done.push(p.id);
      }catch(e){firstError??=e;failed.push(p.id)}
      try{onMoveProgress({index:i+1,total:prev.length})}catch{}
      if(all&&failed.length){failed.push(...prev.slice(i+1).map(x=>x.id));break}
    }
    if(all&&failed.length&&done.length){
      // 되돌리기(보상): 옮긴 것을 이전 자리로. 이것도 실패하면 그 사실을 알린다(남은 것은 목록 다시 읽기가 보여 줌).
      const back=[];for(const id of done){const p=prev.find(x=>x.id===id);try{
        if(!p.had)await api(T_ITEMS+w(p.id),{method:'DELETE',prefer:'return=minimal'});
        else await api(T_ITEMS+w(p.id),{method:'PATCH',prefer:'return=minimal',body:{folder_id:p.folder}});
        back.push(id)}catch{}}
      failed.push(...back);const stuck=done.filter(id=>!back.includes(id));done.length=0;done.push(...stuck);
      throw Object.assign(new Error('LIB_PHOTOSET_PARTIAL'),{partial:stuck.length});
    }
    if(!done.length)throw firstError||new Error('move failed')});
    try{onMoved({done:ok?done:[],failed:ok?failed:prev.map(p=>p.id),folderId})}catch{}
    if(!ok)return false;
    if(folderId)reveal(chain(todo[0].project_id||null,folderId));
    const moved=prev.filter(p=>done.includes(p.id)),where_=folderId?`📁 ${folder(folderId)?.name||'폴더'}`:'폴더 밖';
    say(`옮겼어요 ${moved.length}개 → ${where_}${failed.length?` · ${failed.length}개는 옮기지 못했어요(고른 채로 남김)`:''} ·`,{error:failed.length>0,undo:()=>run(async()=>{for(const p of moved){
      const cur=s().items.find(x=>x.document_id===p.id);if((cur?.folder_id||null)!==folderId)continue;
      const back=p.had?p.folder:null;
      if(back===null)await api(T_ITEMS+w(p.id),{method:'DELETE',prefer:'return=minimal'});
      else await api(T_ITEMS+w(p.id),{method:'PATCH',prefer:'return=minimal',body:{folder_id:back}});
    }},'되돌렸어요.')});
    return true;
  }
  async function dragMoveFolder(id,parentId){
    const f=folder(id);if(!f)return false;const before={parent_id:f.parent_id||null,sort_order:f.sort_order};
    const ok=await moveFolder(id,parentId,'');if(!ok)return false;
    say('폴더를 옮겼어요 ·',{undo:()=>{const cur=folder(id);if(!cur||(cur.parent_id||null)!==(parentId||null)){say('그 사이 폴더가 또 바뀌어 되돌리지 않았어요.');return Promise.resolve(false)}return run(()=>api(T_FOLDERS+where(id),{method:'PATCH',prefer:'return=minimal',body:before}),'되돌렸어요.')}});
    return true;
  }
  // 같은 상위 형제 사이로 옮기기: 끈 폴더를 target 앞/뒤에 두고 그 형제만 1024 간격으로 다시 매긴다(바뀐 행만 저장).
  async function placeBeside(id,targetId,after){
    const f=folder(id),sib=sibs(f.project_id||null,f.parent_id||null).filter(x=>x.id!==id),at=sib.findIndex(x=>x.id===targetId);if(at<0)return false;
    const order=[...sib.slice(0,at+(after?1:0)).map(x=>x.id),id,...sib.slice(at+(after?1:0)).map(x=>x.id)];
    const plan=order.map((x,i)=>({id:x,sort_order:(i+1)*SORT_GAP})).filter(p=>Number(folder(p.id)?.sort_order)!==p.sort_order);
    if(!plan.length)return false;
    const prev=plan.map(p=>({id:p.id,sort_order:folder(p.id).sort_order}));
    const patch=list=>async()=>{for(const p of list)await api(T_FOLDERS+where(p.id),{method:'PATCH',prefer:'return=minimal',body:{sort_order:p.sort_order}})};
    const ok=await run(patch(plan));if(!ok)return false;
    say('순서를 바꿨어요 ·',{undo:()=>run(patch(prev),'되돌렸어요.')});
    return true;
  }
  function commitDrop(d,t){
    if(!d||!t?.ok)return;
    if(d.kind==='file'){const docs=d.docs.map(x=>docById(x.id)).filter(Boolean);if(!docs.length)return;if(t.kind==='category'){void changeCategory(docs.filter(x=>categoryOf(x.category)!==t.value),t.value);return}void moveDocs(docs,t.kind==='top'?null:t.target,{all:!!d.set});return}
    if(t.kind==='top')void dragMoveFolder(d.id,null);else if(t.kind==='into')void dragMoveFolder(d.id,t.target);else void placeBeside(d.id,t.target,t.kind==='after');
  }
  // ---- 끌기 놓을 곳 목록 (LIB-폴더로옮기기 ③) ----
  // 종류·담당조직·월별로 묶은 화면에는 폴더 토글이 없어서, 파일을 끌기 시작하면 화면 왼쪽에 작은 폴더 목록이 뜨고 거기에 놓으면 옮겨진다
  // (놓은 뒤 '옮겼어요 · 되돌리기'는 moveDocs 그대로). 틀이 다른 폴더는 흐리게 + 이유 한 줄. 끌기가 끝나면 사라진다. 프로젝트·폴더 묶기는 토글에 바로 놓는다.
  let dropPanel=null,dropPanelDocs=null;
  function ensureDropPanel(){
    if(dropPanel)return dropPanel;
    dropPanel=document.createElement('aside');dropPanel.className='lu-drop-panel';dropPanel.hidden=true;dropPanel.setAttribute('aria-label','폴더에 놓기');
    dropPanel.innerHTML='<p class="lu-drop-title"></p><div class="lu-drop-list"></div><p class="lu-drop-note" hidden></p>';
    document.body.append(dropPanel);
    const targetOf=e=>e.target?.closest?.('[data-lu-drop-folder],[data-lu-drop-out]');
    dropPanel.addEventListener('dragover',e=>{
      if(!drag||drag.kind!=='file')return;
      const t=targetOf(e);for(const el of dropPanel.querySelectorAll('.lu-drop-over'))if(el!==t)el.classList.remove('lu-drop-over');
      if(!t)return;
      if(t.getAttribute('aria-disabled')==='true'){try{e.dataTransfer.dropEffect='none'}catch{}t.classList.remove('lu-drop-over');return}
      e.preventDefault();try{e.dataTransfer.dropEffect='move'}catch{}t.classList.add('lu-drop-over');
    });
    dropPanel.addEventListener('dragleave',e=>{if(!dropPanel.contains(e.relatedTarget))for(const el of dropPanel.querySelectorAll('.lu-drop-over'))el.classList.remove('lu-drop-over')});
    dropPanel.addEventListener('drop',e=>{
      const t=targetOf(e),d=drag;
      if(!d||d.kind!=='file'||!t||t.getAttribute('aria-disabled')==='true')return;
      e.preventDefault();
      const docs=d.docs.map(x=>docById(x.id)).filter(Boolean);
      drag=null;clearMarks();stopScroll();
      if(docs.length)void putDocs(docs,t.dataset.luDropOut!==undefined?null:t.dataset.luDropFolder);
    });
    return dropPanel;
  }
  function showDropPanel(d){
    if(!d||d.kind!=='file'||s().treeView)return;
    const docs=d.docs.map(x=>docById(x.id)).filter(Boolean);if(!docs.length)return;
    const el=ensureDropPanel(),data=rowsFor(docs);
    dropPanelDocs=docs;
    el.querySelector('.lu-drop-title').textContent=`${docs.length>1?docs.length+'개를 ':''}놓을 폴더`;
    const list=data.all.map(r=>`<div class="lu-drop-item" data-lu-drop-folder="${esc(r.id)}"${r.enabled?'':' aria-disabled="true"'} style="--lu-depth:${r.depth}" title="${esc(r.reason||r.label)}">${esc(r.name)}</div>`).join('');
    el.querySelector('.lu-drop-list').innerHTML=(list||'<p class="lu-drop-note">아직 폴더가 없어요</p>')+(docs.some(x=>rawItem(x))?'<div class="lu-drop-item" data-lu-drop-out>폴더 밖으로</div>':'');
    const reason=data.all.find(r=>r.reason)?.reason;
    const foot=el.lastElementChild;foot.hidden=!reason;foot.textContent=reason?`흐린 폴더는 ${reason}. 묶기를 ‘폴더’로 바꾸면 고를 수 있어요.`:'';
    el.hidden=false;
  }
  function hideDropPanel(){if(dropPanel){dropPanel.hidden=true;for(const el of dropPanel.querySelectorAll('.lu-drop-over'))el.classList.remove('lu-drop-over')}dropPanelDocs=null}
  let touch=null,suppressUntil=0;
  function bindDrag(list){
    list.addEventListener('dragstart',e=>{
      const d=dragFrom(e.target);if(!d)return;drag=d;markDragging(d);
      try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',d.id)}catch{}
      // 폴더 토글이 없는 묶기에서는 왼쪽에 놓을 곳 목록을 띄운다. 끌기 시작 중에 DOM을 바꾸면 브라우저가 끌기를 취소하므로 한 박자 뒤에.
      if(d.kind==='file'&&!s().treeView)setTimeout(()=>{if(drag===d)showDropPanel(d)},0);
    });
    list.addEventListener('dragover',e=>{
      if(!drag)return;const t=dropFor(e);showMarks(t);hoverOpen(t);edgeScroll(e.clientY,list);
      if(!t)return;
      if(!t.ok){try{e.dataTransfer.dropEffect='none'}catch{}return}
      e.preventDefault();try{e.dataTransfer.dropEffect='move'}catch{}
    });
    list.addEventListener('drop',e=>{
      if(!drag)return;const t=dropFor(e),d=drag;drag=null;clearMarks();stopScroll();if(!t?.ok)return;e.preventDefault();commitDrop(d,t);
    });
    list.addEventListener('dragend',()=>{drag=null;clearMarks();stopScroll()});
    bindTouch(list);
  }
  // ---- 폰: 길게 눌러 잡고 옮기기 ----
  // 줄·폴더 머리를 LONG_MS 눌러 두면 잡힌다. 잡기 전에 손가락이 움직이면(세로 스크롤) 그대로 스크롤이고, 잡은 뒤에는 스크롤을 막고 손가락을 따라 놓을 곳을 표시한다.
  // 움직이지 않고 떼면 우클릭과 같은 메뉴(폴더 머리는 폴더 메뉴, 자료 줄은 자료 ⋯ 메뉴), 움직였다 떼면 놓은 곳으로 옮긴다.
  const LONG_MS=450,SLOP=8,MOVED=12;
  function bindTouch(list){
    const cancel=()=>{if(touch?.timer)clearTimeout(touch.timer);touch=null};
    const finish=()=>{clearMarks();stopScroll();drag=null;cancel()};
    list.addEventListener('pointerdown',e=>{
      if(e.pointerType!=='touch'||!e.isPrimary||!touchOk())return;
      const t=e.target;if(!(t instanceof Element)||t.closest('input,textarea,select,[contenteditable],button,a[href],.lu-undo,.lu-more-files'))return;
      const el=t.closest('.lu-row,summary.lu-node-head');if(!el||(el.matches('summary')&&renaming))return;
      cancel();
      touch={el,x:e.clientX,y:e.clientY,grabbed:false,moved:false,drop:null,at:Date.now(),timer:setTimeout(()=>{
        if(!touch||touch.el!==el)return;
        touch.grabbed=true;touch.drag=dragFrom(el,true);drag=touch.drag;
        el.classList.add('lu-grabbed');markDragging(touch.drag);try{navigator.vibrate?.(12)}catch{}
      },LONG_MS)};
    });
    list.addEventListener('pointermove',e=>{
      if(!touch||touch.grabbed||e.pointerType!=='touch')return;
      if(Math.hypot(e.clientX-touch.x,e.clientY-touch.y)>SLOP)cancel();
    });
    list.addEventListener('pointercancel',e=>{if(e.pointerType==='touch'&&touch&&!touch.grabbed)cancel()});
    // 잡은 뒤의 움직임은 touch 이벤트로 받는다(passive:false라야 스크롤을 막을 수 있다).
    list.addEventListener('touchmove',e=>{
      if(!touch?.grabbed)return;
      if(e.cancelable)e.preventDefault();
      const p=e.touches[0];if(!p)return;
      if(Math.hypot(p.clientX-touch.x,p.clientY-touch.y)>MOVED)touch.moved=true;
      if(!touch.moved||!touch.drag)return;
      touch.drop=dropFor({target:document.elementFromPoint(p.clientX,p.clientY),clientY:p.clientY});showMarks(touch.drop);hoverOpen(touch.drop);edgeScroll(p.clientY,list);
    },{passive:false});
    list.addEventListener('touchend',e=>{
      if(!touch)return;
      if(!touch.grabbed){cancel();return}
      if(e.cancelable)e.preventDefault();
      const {el,moved,drop,drag:d}=touch;
      finish();
      if(moved){suppressUntil=Date.now()+600;commitDrop(d,drop);return}
      // 움직이지 않고 뗌 = 우클릭과 같은 메뉴.
      const btn=el.matches('summary')?el.querySelector('[data-lu-node-menu]'):el.querySelector('[data-lu-menu]');
      suppressUntil=0;
      if(btn){const r=el.getBoundingClientRect();window.KPTUContextMenu?.pinAt?.(btn,r.left+Math.min(r.width/2,48),r.top+r.height/2);btn.click()}
      suppressUntil=Date.now()+600;
    });
    list.addEventListener('touchcancel',()=>{if(touch?.grabbed)finish();else cancel()});
    // 잡은 직후 따라오는 기본 길게누르기 메뉴·클릭(자료 열기, 토글 접기)은 막는다.
    list.addEventListener('contextmenu',e=>{if(touch||Date.now()<suppressUntil||(e.pointerType==='touch'&&e.target.closest?.('.lu-row,summary.lu-node-head')&&touchOk()))e.preventDefault()},true);
    list.addEventListener('click',e=>{if(Date.now()<suppressUntil){e.preventDefault();e.stopPropagation()}},true);
  }
  // F2 = 포커스가 있는 폴더 줄의 이름 바꾸기. 빈 곳 우클릭 = 그 자리를 품은 가장 가까운 토글의 ⋯ 메뉴(폴더면 폴더 메뉴, 프로젝트·'폴더 밖'이면 [새 폴더]),
  // 어느 토글도 아니면 맨 위 자리의 [새 폴더]. 카드·줄·입력칸·링크·버튼 위의 우클릭은 공용 우클릭(context-menu.js)이 그대로 맡는다.
  const WIDE=typeof matchMedia==='function'?matchMedia('(min-width:761px)'):null;
  const IGNORE='.lu-row,summary.lu-node-head,input,textarea,select,button,a[href],[contenteditable],.lu-off-hint,.lu-more-files,.lu-undo';
  function blankTrigger(target,list){
    for(let el=target.closest('.lu-node');el;el=el.parentElement?.closest('.lu-node')){const b=el.querySelector(':scope > summary [data-lu-node-menu]');if(b)return b}
    return list.querySelector(`[data-lu-node-menu="${s().free?OUTSIDE_KEY:'p:none'}"]`)||(s().free?list.querySelector('summary[data-lu-top] [data-lu-node-menu^="f:"]'):null);
  }
  function bindKeys(list){
    list.addEventListener('keydown',e=>{
      if(e.key!=='F2'||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return;
      const t=e.target;if(!(t instanceof Element)||t.closest('input,textarea,select,[contenteditable]'))return;
      const head=t.closest('summary.lu-node-head'),key=head?.parentElement?.dataset.luNode;
      if(!key||!key.startsWith('f:'))return;
      e.preventDefault();startRename(key.slice(2));
    });
    list.addEventListener('contextmenu',e=>{
      if(e.defaultPrevented||e.shiftKey||e.ctrlKey||e.altKey||e.metaKey||e.pointerType==='touch'||!WIDE?.matches)return;
      const t=e.target;if(!(t instanceof Element)||t.closest(IGNORE))return;
      const sel=getSelection?.();if(sel&&!sel.isCollapsed&&sel.toString().trim())return;
      const trigger=blankTrigger(t,list);if(!trigger)return;
      e.preventDefault();
      window.KPTUContextMenu?.pinAt?.(trigger,e.clientX,e.clientY);
      trigger.click();
    });
  }
  return {moveDocsTo:(ids,folderId)=>{const docs=ids.map(docById).filter(Boolean);return docs.length?moveDocs(docs,folderId||null):Promise.resolve(false)},open:t=>menu.open(t),close:()=>menu.close(),moveMenuHtml,openMove,closeMove:()=>picker.close(false,false),moveContains:n=>picker.contains(n),get moveOpen(){return picker.isOpen},docFolder,bindDrag,bindKeys,startRename,get busy(){return busy}};
}
