// LIB-토글트리 ③(docs/design/library-tree.md 6절): 자료실 전용 폴더 편집 — ⋯ 메뉴·작은 창·저장.
// 목록 그리기는 library-upload.js의 luRenderLibrary 하나다. 이 모듈은 폴더 메뉴(⋯), 이름·옮길 곳을 고르는 작은 창,
// 저장(기존 소유자 RLS REST: app_library_folders·app_library_folder_items)만 맡고, 저장 뒤 reload()로 다시 그리게 한다.
// 순환·3단·같은 프로젝트 틀은 DB 트리거가 지키고(거절 SQLSTATE 23514 + LIB_FOLDER_*), 화면은 같은 규칙으로 고를 수 있는 곳만 보인다.
// 폴더·자료 연결만 바꾼다. 자료(app_documents)·프로젝트·Drive 파일은 건드리지 않는다.
import {createAnchoredMenu} from './anchored-menu.js';
import {FOLDER_DEPTH,OUTSIDE_KEY,SORT_GAP,canAddChild,cleanFolderName,folderTrashCounts,folderDepth,folderErrorText,folderMoveTargets,folderReorderPlan,folderSiblings,nextSortOrder} from './library-tree.js';

const T_FOLDERS='/rest/v1/app_library_folders',T_ITEMS='/rest/v1/app_library_folder_items';
const enc=encodeURIComponent;

export function mountLibraryFolders({api,esc,state,reload,status,reveal=()=>{},notify=null,toggleNode=()=>{}}){
  // state(): {workspace, folders, items, docs, projectName(id), free(폴더 보기: 프로젝트 틀을 보지 않음), isOpen(key)}
  // notify(text,{error,undo}): '… · 되돌리기' 한 줄(없으면 status). toggleNode(key): 토글 접기·펼치기.
  let busy=false,dialog=null;
  const s=()=>state();
  const folder=id=>s().folders.find(f=>f.id===id);
  const frameName=pid=>pid?s().projectName(pid):'프로젝트 없음';
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
  const moveFolder=(id,parentId)=>{const f=folder(id),pid=f?.project_id||null;return run(()=>api(T_FOLDERS+where(id),{method:'PATCH',prefer:'return=minimal',body:{parent_id:parentId||null,sort_order:nextSortOrder(sibs(pid,parentId))}}),'폴더를 옮겼어요.').then(ok=>{if(ok)reveal(chain(pid,parentId));return ok})};
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
    d.targets.hidden=!targets;d.targets.innerHTML=(targets||[]).map((t,i)=>`<button type="button" role="radio" class="lu-folder-target" data-lu-target="${esc(t.value)}" aria-checked="false" tabindex="${i?-1:0}" style="--lu-target-depth:${t.depth||0}">${esc(t.label)}</button>`).join('');
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
  const frameFromKey=key=>key==='p:none'||key===OUTSIDE_KEY?null:key.slice(2);
  const sep='<hr class="lu-menu-sep" role="separator">';
  const menu=createAnchoredMenu({id:'luFolderMenu',className:'lu-folder-menu',label:'폴더 관리',historyKey:'kptuLibraryFolderMenu',key:t=>t.dataset.luNodeMenu,
    render:key=>{
      if(!key.startsWith('f:'))return '<button type="button" data-lu-folder-action="create">새 폴더</button>';
      const f=folder(key.slice(2));if(!f)return '';
      const sib=sibs(f.project_id||null,f.parent_id||null),i=sib.findIndex(x=>x.id===f.id);
      return '<button type="button" data-lu-folder-action="rename" aria-keyshortcuts="F2">이름 바꾸기<span class="lu-menu-key" aria-hidden="true">F2</span></button>'
        +(canAddChild(s().folders,f.id)?'<button type="button" data-lu-folder-action="create">안에 새 폴더</button>':'')
        +`<button type="button" data-lu-folder-action="toggle">${s().isOpen?.(key)?'접기':'펼치기'}</button>`
        +(i>0?'<button type="button" data-lu-folder-action="up">위로</button>':'')+(i>=0&&i<sib.length-1?'<button type="button" data-lu-folder-action="down">아래로</button>':'')
        +(folderMoveTargets(s().folders,f.id,!!s().free).length?'<button type="button" data-lu-folder-action="move">옮기기…</button>':'')
        +sep+'<button type="button" class="lu-menu-danger" data-lu-folder-action="delete">폴더 지우기</button>';
    },
    onAction:(button,active)=>{const key=active.id,action=button.dataset.luFolderAction,trigger=active.trigger;if(key.startsWith('f:'))folderAction(key.slice(2),action,trigger);else if(action==='create')askName({title:'폴더 만들기',hint:(key===OUTSIDE_KEY?'폴더 밖(맨 위)에':frameName(frameFromKey(key))+' 안에')+' 만들어요. 자료실에서만 보이고 Drive 폴더는 바뀌지 않아요.',trigger,then:name=>createFolder(frameFromKey(key),null,name)})}});
  function folderAction(id,action,trigger){
    const f=folder(id);if(!f)return;
    if(action==='create')askName({title:'안에 폴더 만들기',hint:pathName(id)+' 안에 만들어요.',trigger,then:name=>createFolder(f.project_id||null,id,name)});
    else if(action==='rename')startRename(id);
    else if(action==='toggle')toggleNode('f:'+id);
    else if(action==='up'||action==='down')void reorderFolder(id,action).then(()=>focusHead('f:'+id));
    else if(action==='move')askTarget({title:'폴더 옮기기',hint:s().free?`${f.name}을(를) 옮길 곳을 고르세요.`:`${f.name}을(를) 옮길 곳을 고르세요. 같은 프로젝트 안에서만 옮길 수 있어요.`,trigger,targets:folderMoveTargets(s().folders,id,!!s().free).map(t=>t===null?{value:'__top__',label:s().free?'맨 위(폴더 밖)':frameName(f.project_id||null)+' 바로 아래',depth:0}:{value:t,label:pathName(t),depth:folderDepth(s().folders,t)}),then:parent=>moveFolder(id,parent)});
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

  // 자료 ⋯ 메뉴에 붙일 버튼(프로젝트 묶기에서만). 같은 프로젝트 틀의 폴더가 있을 때만.
  function fileMenuHtml(doc){
    const frame=doc.project_id||null,here=docFolder(doc),inFrame=s().folders.filter(f=>(s().free||(f.project_id||null)===frame)&&f.id!==here?.id);
    return (inFrame.length?`<button type="button" data-lu-file-folder="${esc(doc.id)}">폴더로 옮기기…</button>`:'')+(here?`<button type="button" data-lu-file-out="${esc(doc.id)}">폴더 밖으로</button>`:'');
  }
  function fileAction(button){
    const id=button.dataset.luFileFolder||button.dataset.luFileOut,doc=s().docs.find(d=>d.id===id);if(!doc)return;
    if(button.dataset.luFileOut){void fileOut(doc);return}
    const frame=doc.project_id||null,here=docFolder(doc);
    const targets=s().folders.filter(f=>(s().free||(f.project_id||null)===frame)&&f.id!==here?.id).map(f=>f.id);
    // 차례: 트리 차례(맨 위 폴더 → 그 안).
    const ordered=[],add=parent=>{for(const f of sibs(frame,parent)){if(targets.includes(f.id))ordered.push(f.id);add(f.id)}};add(null);
    askTarget({title:'폴더로 옮기기',hint:s().free?`${doc.title||doc.file_name||'자료'}을(를) 넣을 폴더를 고르세요. 자료의 프로젝트는 바뀌지 않아요.`:`${doc.title||doc.file_name||'자료'}을(를) 넣을 폴더를 고르세요. ${frameName(frame)} 안의 폴더만 보여요.`,trigger:document.querySelector(`[data-lu-menu="${CSS.escape(doc.id)}"]`),targets:ordered.map(t=>({value:t,label:pathName(t),depth:folderDepth(s().folders,t)})),then:fid=>fileToFolder(doc,fid)});
  }
  // ---- PC 끌어 놓기(LIB-토글트리 ④, 설계 6절) ----
  // 끌 수 있는 것: 폴더 머리, 파일 줄(프로젝트 묶기, PC). 놓을 곳은 같은 프로젝트 틀 안만:
  //   폴더 → 다른 폴더 머리 가운데(그 안으로), 같은 상위의 형제 폴더 머리 위·아래 끝(그 앞·뒤로), 그 틀의 프로젝트 머리(맨 위로)
  //   파일 → 폴더 머리(그 폴더로), 그 틀의 프로젝트 머리(폴더 밖으로)
  // 그 밖(다른 프로젝트, 자기·자기 아래, 3단 초과)은 놓을 수 없음 표시. 키보드·폰은 ⋯ 메뉴(위로·아래로·옮기기…)가 같은 일을 한다.
  let drag=null;
  const frameKeyOf=key=>key==='p:none'?null:key.slice(2);
  function dropFor(e){
    if(!drag)return null;
    const head=e.target.closest?.('#documentList summary.lu-node-head');if(!head)return null;
    const node=head.parentElement,key=node?.dataset.luNode;if(!key)return null;
    const r=head.getBoundingClientRect(),y=e.clientY-r.top,edge=r.height/4;
    if(key.startsWith('p:')){const frame=frameKeyOf(key);if(frame!==drag.frame)return {head,ok:false};if(drag.kind==='file'&&!drag.inFolder)return {head,ok:false};if(drag.kind==='folder'&&!folder(drag.id)?.parent_id)return {head,ok:false};return {head,ok:true,kind:'top'}}
    const target=folder(key.slice(2));if(!target||(target.project_id||null)!==drag.frame)return {head,ok:false};
    if(drag.kind==='file')return {head,ok:target.id!==drag.folder,kind:'into',target:target.id};
    if(target.id===drag.id)return {head,ok:false};
    const f=folder(drag.id),sibling=(target.parent_id||null)===(f.parent_id||null);
    if(sibling&&(y<edge||y>r.height-edge))return {head,ok:true,kind:y<edge?'before':'after',target:target.id};
    const ok=folderMoveTargets(s().folders,drag.id).includes(target.id);
    return {head,ok,kind:'into',target:target.id};
  }
  function clearMarks(){document.querySelectorAll('#documentList .lu-drop-into,#documentList .lu-drop-before,#documentList .lu-drop-after,#documentList .lu-drop-no,#documentList .lu-dragging').forEach(el=>el.classList.remove('lu-drop-into','lu-drop-before','lu-drop-after','lu-drop-no','lu-dragging'))}
  // 같은 상위 형제 사이로 옮기기: 끈 폴더를 target 앞/뒤에 두고 그 형제만 1024 간격으로 다시 매긴다(바뀐 행만 저장).
  function placeBeside(id,targetId,after){
    const f=folder(id),sib=folderSiblings(s().folders,{projectId:f.project_id||null,parentId:f.parent_id||null}).filter(x=>x.id!==id),at=sib.findIndex(x=>x.id===targetId);if(at<0)return Promise.resolve(false);
    const order=[...sib.slice(0,at+(after?1:0)).map(x=>x.id),id,...sib.slice(at+(after?1:0)).map(x=>x.id)];
    const plan=order.map((x,i)=>({id:x,sort_order:(i+1)*SORT_GAP})).filter(p=>Number(folder(p.id)?.sort_order)!==p.sort_order);
    if(!plan.length)return Promise.resolve(false);
    return run(async()=>{for(const p of plan)await api(T_FOLDERS+where(p.id),{method:'PATCH',prefer:'return=minimal',body:{sort_order:p.sort_order}})},'순서를 바꿨어요.');
  }
  function bindDrag(list){
    list.addEventListener('dragstart',e=>{
      const head=e.target.closest?.('summary.lu-node-head[draggable="true"]'),row=e.target.closest?.('.lu-row[draggable="true"]');
      if(head){const id=head.parentElement.dataset.luNode.slice(2),f=folder(id);if(!f)return;drag={kind:'folder',id,frame:f.project_id||null};head.parentElement.classList.add('lu-dragging')}
      else if(row){const doc=s().docs.find(d=>d.id===row.dataset.luDocument);if(!doc)return;const here=docFolder(doc);drag={kind:'file',id:doc.id,frame:doc.project_id||null,folder:here?.id||null,inFolder:!!here};row.classList.add('lu-dragging')}
      else return;
      try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',drag.id)}catch{}
    });
    list.addEventListener('dragover',e=>{
      if(!drag)return;const t=dropFor(e);
      list.querySelectorAll('.lu-drop-into,.lu-drop-before,.lu-drop-after,.lu-drop-no').forEach(el=>{if(el!==t?.head)el.classList.remove('lu-drop-into','lu-drop-before','lu-drop-after','lu-drop-no')});
      if(!t)return;
      t.head.classList.remove('lu-drop-into','lu-drop-before','lu-drop-after','lu-drop-no');
      if(!t.ok){t.head.classList.add('lu-drop-no');try{e.dataTransfer.dropEffect='none'}catch{}return}
      e.preventDefault();try{e.dataTransfer.dropEffect='move'}catch{}
      t.head.classList.add(t.kind==='before'?'lu-drop-before':t.kind==='after'?'lu-drop-after':'lu-drop-into');
    });
    list.addEventListener('drop',e=>{
      if(!drag)return;const t=dropFor(e),d=drag;drag=null;clearMarks();if(!t?.ok)return;e.preventDefault();
      if(d.kind==='file'){const doc=s().docs.find(x=>x.id===d.id);if(!doc)return;void(t.kind==='top'?fileOut(doc):fileToFolder(doc,t.target));return}
      if(t.kind==='top')void moveFolder(d.id,null);else if(t.kind==='into')void moveFolder(d.id,t.target);else void placeBeside(d.id,t.target,t.kind==='after');
    });
    list.addEventListener('dragend',()=>{drag=null;clearMarks()});
  }
  // F2 = 포커스가 있는 폴더 줄의 이름 바꾸기. 빈 곳 우클릭 = 그 자리를 품은 가장 가까운 토글의 ⋯ 메뉴(폴더면 폴더 메뉴, 프로젝트·'폴더 밖'이면 [새 폴더]),
  // 어느 토글도 아니면 맨 위 자리의 [새 폴더]. 카드·줄·입력칸·링크·버튼 위의 우클릭은 공용 우클릭(context-menu.js)이 그대로 맡는다.
  const WIDE=typeof matchMedia==='function'?matchMedia('(min-width:761px)'):null;
  const IGNORE='.lu-row,summary.lu-node-head,input,textarea,select,button,a[href],[contenteditable],.lu-off-hint,.lu-more-files,.lu-undo';
  function blankTrigger(target,list){
    for(let el=target.closest('.lu-node');el;el=el.parentElement?.closest('.lu-node')){const b=el.querySelector(':scope > summary [data-lu-node-menu]');if(b)return b}
    return list.querySelector(`[data-lu-node-menu="${s().free?OUTSIDE_KEY:'p:none'}"]`);
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
  return {open:t=>menu.open(t),close:()=>menu.close(),fileMenuHtml,fileAction,docFolder,bindDrag,bindKeys,startRename,get busy(){return busy}};
}
