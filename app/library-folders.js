import {emptyHtml} from './wait-state.js';
// LIB-토글트리 ③(docs/design/library-tree.md 6절): 자료실 전용 폴더 편집 — ⋯ 메뉴·작은 창·저장.
// 목록 그리기는 library-upload.js의 luRenderLibrary 하나다. 이 모듈은 폴더 메뉴(⋯), 이름을 묻는 작은 창(옮길 곳 고르기는 S69-62부터 공용 folder-dest-sheet.js),
// 저장(기존 소유자 RLS REST: app_library_folders·app_library_folder_items)만 맡고, 저장 뒤 reload()로 다시 그리게 한다.
// 순환·100단(folder-limits.mjs)·같은 프로젝트 틀은 DB 트리거가 지키고(거절 SQLSTATE 23514 + LIB_FOLDER_*), 화면은 같은 규칙으로 고를 수 있는 곳만 보인다.
// 폴더·자료 연결만 바꾼다. 자료(app_documents)·프로젝트·Drive 파일은 건드리지 않는다.
import {createAnchoredMenu} from './anchored-menu.js';
import {FOLDER_DEPTH,OUTSIDE_KEY,canAddChild,cleanFolderName,folderTrashCounts,folderDepth,folderErrorText,folderMoveTargets,folderSiblings,nextSortOrder,SORT_GAP} from './library-tree.js';
import {folderMoveOk} from './library-pick-folders.mjs';
import {pickerRows,FRAME_REASON,MIXED_REASON} from './library-move.mjs';
import {folderIndent} from './folder-limits.mjs';
import {openFolderSheet,closeFolderSheet,folderSheetOpen,folderSheetContains} from './folder-dest-sheet.js'; // S69-62 폴더 고르기 = [파일] '옮길 곳' 창 하나
import {sheetTitle} from './folder-dest-sheet.mjs';
import {colorChoiceHtml,colorFromButton} from './folder-look.js';
import {colorOf,dropZone,folderDropPlan,placeAt,isSamePlace} from './folder-look-model.mjs';
import {setLibraryFolderColor,createLibraryFolder,putDocumentInFolder} from './library-folder-data.js';
import {paneDropAt} from './library-drop.js';
import {writeMoves,undoMoves} from './library-move-write.mjs';
import {createEdgeScroll,installDragEdgeScroll,followTouch} from './drag-edge-scroll.js';
import {createDragGhost,setDragGhostImage} from './drag-ghost.js'; // S69-29 끄는 동안 따라오는 반투명 조각(노트 폴더 보기와 같은 공용 부품)
import {openFolderAt,blankRootAt,lineOrBlank} from './drop-open-folder.mjs';
import {ftHoverExpander} from './folder-tree-press.mjs';
import {askConfirm} from './small-notice.js';
import {RECEIVE_MENU} from './library-receive.js';
import {WEEKLY_FOLDER_TEXT} from './weekly-save-folder-model.mjs'; // S70-11 주간보고 저장 폴더 두 줄
import {word} from './brand/brand.mjs';

const T_FOLDERS='/rest/v1/app_library_folders',T_ITEMS='/rest/v1/app_library_folder_items';
const enc=encodeURIComponent;

export function mountLibraryFolders({api,esc,state,reload,status,reveal=()=>{},notify=null,toggleNode=()=>{},selected=()=>[],pickedFolders=()=>[],onPickedMoved=()=>{},touchOk=()=>false,recent={get:()=>[],push:()=>{}},onMoveProgress=()=>{},onMoved=()=>{},categoryOf=null,changeCategory=null,photoSetDocs=()=>[],twinDocs=()=>null,enter=null,selectNode=null,receive=null,weekly=null,tidy=null,onDragState=()=>{},onHold=()=>false,navOpen=()=>{}}){
  // state(): {workspace, folders, items, docs, projectName(id), free(폴더 보기: 프로젝트 틀을 보지 않음), isOpen(key)}
  // notify(text,{error,undo}): '… · 되돌리기' 한 줄(없으면 status). toggleNode(key): 토글 접기·펼치기.
  // selected(): 지금 고른 자료 id들(여러 개 끌기). touchOk(): 폰 길게 눌러 끌기를 켤 화면인지. onHold(el): 폰에서 줄을 꾹 눌렀다 움직이지 않고 뗌(고르기).
  // recent: 최근 넣은 폴더 기억(get()=id 목록, push(id)=맨 앞에 두고 서버에 기억). state().treeView: 지금 묶기가 폴더 토글이 보이는 화면(프로젝트·폴더)인지.
  // receive(LIB-받는폴더 S59-11): {ready()=서버 칸이 있어 켜고 끌 수 있나, get()=지금 받는 폴더 id|null, set(id|null)=서버에 저장(성공 true), outside()='폴더 밖' 자료, sortCount()·sort(trigger)=받는 폴더 나누기(S60-18)}.
  // pickedFolders()(S70-08 LIB-여러폴더끌기): 폴더째 고른 폴더 id들(위 폴더를 함께 고른 아래 폴더는 뺐다 — topPicked). onPickedMoved(): 고른 것을 끌어 모두 옮긴 뒤 선택을 끝낸다.
  // onDragState(v)(LIB-끄는중막대 S69): 자료를 끄는 동안 {count}, 놓은 뒤 옮기는 동안 {count,moving:true}, 끝나면 null — 고르기 막대 주인(library-upload.js)이 그 모양으로 다시 그린다.
  // tidy(LIB-정돈제안 S61-13): {open(trigger, folderId)} — 폴더 메뉴 [정돈 제안]은 그 폴더 안만(창·묶음·옮기기는 library-sort.js createTidySuggest).
  let busy=false,dialog=null;
  const s=()=>state();
  const folder=id=>s().folders.find(f=>f.id===id);
  const frameName=pid=>pid?s().projectName(pid):word('사업영역 없음');
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
  // 폴더 색(1~8, 기본 = null): 서버 함수(owner만)로 바로 저장하고 다시 읽어 그린다. 같은 폴더를 보이는 모든 곳(토글 머리·폴더 고르기 창)이 이 값 하나를 읽는다. 실패하면 그대로 두고 알린다.
  async function colorFolder(id,color){
    const f=folder(id);if(!f||busy||colorOf(f)===color)return false;
    const ok=await run(()=>setLibraryFolderColor(api,id,color),'');
    if(!ok)status('폴더 색을 저장하지 못했어요. 잠시 뒤 다시 해 주세요.',true);
    return ok;
  }
  const moveFolder=(id,parentId,done='폴더를 옮겼어요.')=>{const f=folder(id),pid=f?.project_id||null;return run(()=>api(T_FOLDERS+where(id),{method:'PATCH',prefer:'return=minimal',body:{parent_id:parentId||null,sort_order:nextSortOrder(sibs(pid,parentId))}}),done).then(ok=>{if(ok)reveal(chain(pid,parentId));return ok})};
  // TRASH-다른삭제 3단계: [폴더 지우기]는 휴지통으로 보낸다(공용 흐름 trash-actions.js). 요청은 그대로 폴더 하나의 DELETE이고(설계 3.4),
  // 서버의 가로채기 트리거가 그 폴더와 아래 폴더 전부를 휴지통 표시로 바꾼다(자료 연결은 그대로, 자료실 목록에서만 함께 숨음).
  // 휴지통 함수가 이 종류를 모르면(DB 적용 전) '준비 중'을 알리고 삭제 요청을 보내지 않는다. 영구 삭제만 안의 것을 한 단 위로 올린다.
  async function trashFolder(f,trigger=null){
    if(busy)return false;busy=true;status('');
    try{
      const {deleteToTrash}=await import('./trash-actions.js');
      const r=await deleteToTrash({kind:'library_folder',id:f.id,name:f.name,detail:folderTrashCounts(s().folders,s().items,f.id),
        remove:()=>api(T_FOLDERS+where(f.id),{method:'DELETE',prefer:'return=minimal'}),afterChange:reload,notify:text=>status(text,true),
        ...(trigger?.isConnected?{anchor:trigger}:{})}); // S69-13: 확인창은 메뉴를 연 ⋯ 단추 옆(없으면 공용 부품이 방금 누른 자리)
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
    document.body.insertAdjacentHTML('beforeend',`<div id="libraryFolderModal" class="modal hidden" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="libraryFolderTitle"><div class="modal-card small-card lu-folder-card"><div class="modal-head"><div><h2 id="libraryFolderTitle"></h2><p id="libraryFolderHint" class="lu-folder-hint"></p></div><button id="libraryFolderClose" class="icon-btn" type="button" aria-label="닫기">×</button></div><form id="libraryFolderForm" data-enter-save novalidate><label id="libraryFolderNameField" class="lu-folder-name">폴더 이름<input id="libraryFolderName" type="text" maxlength="40" autocomplete="off"></label><p id="libraryFolderStatus" class="status" role="status"></p><div class="modal-action-footer"><button id="libraryFolderCancel" class="secondary" type="button">취소</button><button id="libraryFolderSave" class="primary" type="submit" data-enter-save-submit>저장</button></div></form></div></div>`);
    const root=document.querySelector('#libraryFolderModal');
    dialog={root,title:root.querySelector('#libraryFolderTitle'),hint:root.querySelector('#libraryFolderHint'),nameField:root.querySelector('#libraryFolderNameField'),name:root.querySelector('#libraryFolderName'),status:root.querySelector('#libraryFolderStatus'),save:root.querySelector('#libraryFolderSave'),submit:null,trigger:null};
    const close=()=>closeDialog();
    root.querySelector('#libraryFolderClose').addEventListener('click',close);root.querySelector('#libraryFolderCancel').addEventListener('click',close);
    root.querySelector('#libraryFolderForm').addEventListener('submit',async e=>{e.preventDefault();if(!dialog.submit||dialog.save.disabled)return;dialog.save.disabled=true;dialog.save.setAttribute('aria-busy','true');try{const ok=await dialog.submit();if(ok!==false)closeDialog();else if(lastError)fail(lastError)}finally{dialog.save.disabled=false;dialog.save.removeAttribute('aria-busy')}});
    return dialog;
  }
  function openDialog({title,hint='',name=null,save='저장',submit,trigger}){
    const d=ensureDialog();d.trigger=trigger||document.activeElement;d.title.textContent=title;d.hint.textContent=hint;d.hint.hidden=!hint;d.status.textContent='';d.status.className='status';
    d.nameField.hidden=name===null;d.name.value=name??'';
    d.save.textContent=save;d.save.disabled=false;d.submit=submit;
    d.root.classList.remove('hidden');d.root.setAttribute('aria-hidden','false');
    window.KPTUA11y?.dialog?.activate?.(d.root,{trigger:d.trigger,initialFocus:d.name,onRequestClose:closeDialog});
    if(!window.KPTUA11y?.dialog)d.name.focus();
  }
  function closeDialog(){if(!dialog||dialog.root.classList.contains('hidden'))return;dialog.root.classList.add('hidden');dialog.root.setAttribute('aria-hidden','true');dialog.submit=null;if(window.KPTUA11y?.dialog?.deactivate)window.KPTUA11y.dialog.deactivate(dialog.root);else if(dialog.trigger?.isConnected)dialog.trigger.focus({preventScroll:true})}
  const fail=text=>{dialog.status.textContent=text;dialog.status.className='status error';return false};
  const askName=({title,hint,name='',trigger,then})=>openDialog({title,hint,name,trigger,submit:async()=>{const clean=cleanFolderName(dialog.name.value);if(!clean)return fail('폴더 이름은 1~40자로 써 주세요.');if(clean===name)return true;return await then(clean)}});
  // 폴더 옮기기(⋯ [옮기기…]): [파일] '옮길 곳' 창과 같은 창(S69-62). 갈 수 있는 곳(folderMoveTargets)만 고를 수 있고, 자기·자기 아래·다른 사업영역은 흐리게 + 까닭.
  function moveFolderSheet(f,trigger){
    const allowed=new Set(folderMoveTargets(s().folders,f.id,!!s().free));
    if(!allowed.size){status('옮길 수 있는 곳이 없어요.',true);return}
    const free=!!s().free,pid=f.project_id||null;
    openFolderSheet({anchor:trigger,title:`'${f.name}' 옮길 곳`,rootName:free?'자료실':frameName(pid),folders:()=>s().folders.filter(x=>free||(x.project_id||null)===pid),current:f.parent_id||null,
      allowRoot:allowed.has(null),rootReason:'맨 위로는 옮길 수 없어요',blocked:id=>id===f.id?'옮기는 폴더예요':allowed.has(id)?'':word('그 안으로는 옮길 수 없어요'),
      mkdir:(parent,name)=>makeFolderIn(pid,parent,name),onGo:parent=>moveFolder(f.id,parent)});
  }
  // 고르기 창 [새 폴더]: 고른 폴더 안(맨 위 줄이면 맨 위)에 만들고 다시 읽은 뒤 그 폴더를 돌려준다(창이 그 폴더를 고른다).
  async function makeFolderIn(projectId,parentId,typed){
    const name=cleanFolderName(typed);if(!name)throw new Error('폴더 이름은 1~40자로 써 주세요.');
    if(parentId&&!canAddChild(s().folders,parentId))throw new Error('이 폴더 안에는 더 만들 수 없어요.');
    let row=null;
    const ok=await run(async()=>{row=await createLibraryFolder(api,{workspace:s().workspace,project_id:projectId||null,parent_id:parentId||null,name,sort_order:nextSortOrder(sibs(projectId,parentId))})},'폴더를 만들었어요.');
    if(!ok||!row?.id)throw new Error(lastError||'폴더를 만들지 못했어요.');
    return folder(row.id)||row;
  }

  // ---- 메뉴 ----
  // key: 'p:<project id>' | 'p:none' | 'f:<folder id>'
  let colorFor=null,colorReopen=false; // 색 고르기 모드로 다시 열 폴더 키
  const outsideHead=()=>document.querySelector(`#documentList [data-lu-node-menu="${OUTSIDE_KEY}"]`);
  const frameFromKey=key=>key==='p:none'||key===OUTSIDE_KEY?null:key.slice(2);
  const sep='<hr class="lu-menu-sep" role="separator">';
  // S55-08 LIB-우클릭메뉴 ②: 왼쪽 나무 폴더 줄(data-lu-nav=폴더 id)도 같은 폴더 메뉴의 주인이 될 수 있다(우클릭 = 오른쪽 폴더 줄 ⋯와 같은 메뉴·같은 실행).
  const menu=createAnchoredMenu({id:'luFolderMenu',className:'lu-folder-menu',label:'폴더 관리',historyKey:'kptuLibraryFolderMenu',key:t=>t.dataset.luNodeMenu||(t.dataset.luNav?'f:'+t.dataset.luNav:'')||(t.dataset.luNavMore?'f:'+t.dataset.luNavMore:''),
    render:key=>{
      // FOLDER-순서·색 ③: [색 고르기…]를 누르면 같은 자리에 동그라미 8개 + [기본]을 다시 연다(고르면 바로 저장).
      if(colorFor===key&&key.startsWith('f:')){const f0=folder(key.slice(2));return f0?colorChoiceHtml(colorOf(f0)):''}
      if(!key.startsWith('f:'))return '<button type="button" data-lu-folder-action="create">새 폴더</button>'+(key===OUTSIDE_KEY&&selectNode?.(key)?'<button type="button" data-lu-folder-action="select-all">전체 선택</button>':'');
      const f=folder(key.slice(2));if(!f)return '';
      // LIB-폴더끌어순서(S61-14, 명진 11/12 15:30): 순서는 끌어서 바꾸므로 [위로]·[아래로]는 메뉴에서 뺐다. 키보드는 폴더 줄에서 Alt+↑·Alt+↓(bindKeys).
      // LIB-폴더100단 ②(10:34): 폴더 보기에서는 [이 폴더로 들어가기](UI-폴더이름펼치기 11/24부터 첫 줄) — 그 폴더만 보이고 위에 위치 줄(자료실 › … ). 폴더 줄을 두 번 눌러도 같다.
      // '폴더 밖'이 비어 그 줄이 없으면(LIB-정리보충) 맨 위 폴더 메뉴 첫 줄이 맨 위 새 폴더 자리.
      // 탐색기(S69-28)는 '폴더 밖' 머리가 늘 없지만 맨 위 ⋯·빈 자리 우클릭 [새 폴더]가 맨 위 자리라 이 줄을 더하지 않는다.
      const top=s().free&&!s().explorer&&!s().inFolder&&!f.parent_id&&!outsideHead()?'<button type="button" data-lu-folder-action="create-top">맨 위에 새 폴더</button>':'';
      // UI-폴더이름펼치기(명진 11/24 18:09): 폴더 이름 누르기는 그 자리 펼치기·접기만이라, 들어가기는 이 메뉴 첫 줄 [이 폴더로 들어가기]로만.
      return (enter&&s().free?'<button type="button" data-lu-folder-action="enter">이 폴더로 들어가기</button>':'')+top+'<button type="button" data-lu-folder-action="rename" aria-keyshortcuts="F2">이름 바꾸기<span class="lu-menu-key" aria-hidden="true">F2</span></button>'
        +(canAddChild(s().folders,f.id)?'<button type="button" data-lu-folder-action="create">안에 새 폴더</button>':'')
        // S69-28 LIB-한칸탐색기: 탐색기(한 칸 폴더 보기)의 폴더 줄은 펼치지 않고 들어가므로 [펼치기·접기] 줄이 없다(왼쪽 나무는 줄 앞 폴더 그림).
        +(s().explorer?'':`<button type="button" data-lu-folder-action="toggle">${s().isOpen?.(key)?'접기':'펼치기'}</button>`)
        +(folderMoveTargets(s().folders,f.id,!!s().free).length?'<button type="button" data-lu-folder-action="move">옮기기…</button>':'')
        +'<button type="button" data-lu-folder-action="paint">색 선택…</button>'
        +receiveLine(f)+weeklyLines(f)+sortLine(f)+(tidy&&s().free?'<button type="button" class="row-act lu-menu-tidy" data-lu-folder-action="tidy">정돈 제안</button>':'')
        +sep+'<button type="button" class="lu-menu-danger" data-lu-folder-action="delete">폴더 삭제</button>';
    },
    onClose:()=>{if(!colorReopen)colorFor=null},
    onAction:(button,active)=>{const key=active.id,action=button.dataset.luFolderAction,trigger=active.trigger;colorReopen=false;const picked=colorFor===key?colorFromButton(button):undefined;if(picked!==undefined){colorFor=null;void colorFolder(key.slice(2),picked).then(()=>focusSummary(key));return}colorFor=null;if(key.startsWith('f:'))folderAction(key.slice(2),action,trigger);else if(action==='select-all')selectNode?.(key,true);else if(action==='create')askName({title:'폴더 만들기',hint:(key===OUTSIDE_KEY?'폴더 밖(맨 위)에':frameName(frameFromKey(key))+' 안에')+' 만들어요. 자료실에서만 보이고 Drive 폴더는 바뀌지 않아요.',trigger,then:name=>createFolder(frameFromKey(key),null,name)})}});
  function folderAction(id,action,trigger){
    const f=folder(id);if(!f)return;
    if(action==='create-top')askName({title:'폴더 만들기',hint:'폴더 밖(맨 위)에 만들어요. 자료실에서만 보이고 Drive 폴더는 바뀌지 않아요.',trigger,then:name=>createFolder(null,null,name)});
    else if(action==='create')askName({title:'안에 폴더 만들기',hint:pathName(id)+' 안에 만들어요.',trigger,then:name=>createFolder(f.project_id||null,id,name)});
    else if(action==='enter')enter?.(id,trigger); // LIB-두칸폴더펼치기: 두 칸이면 메뉴를 연 칸에서 들어간다
    else if(action==='rename')startRename(id,trigger);
    else if(action==='toggle')toggleNode('f:'+id);
    else if(action==='move')moveFolderSheet(f,trigger);
    else if(action==='paint'){colorFor='f:'+id;colorReopen=true;queueMicrotask(()=>{colorReopen=false;if(trigger?.isConnected)menu.open(trigger)})}
    else if(action==='receive')void toggleReceive(f,trigger);
    else if(action==='weekly-personal'||action==='weekly-confirmed')void toggleWeekly(f,action.slice(7));
    else if(action==='sort')void receive?.sort?.(trigger);
    else if(action==='tidy')void tidy?.open?.(trigger,id);
    else if(action==='delete')void trashFolder(f,trigger);
  }
  // ---- LIB-받는폴더(S59-11, 시안 ①③): 폴더 우클릭(폰 ⋯) 메뉴 한 줄 [폴더 안 정한 자료 받기] — 켜면 ✓, 다시 누르면 끔. 받는 폴더는 하나뿐(다른 폴더에서 켜면 그쪽으로).
  // 저장은 내 프로필 칸 하나(서버, library-receive.js), 자료를 그 폴더에 넣는 일은 서버 트리거가 한다. 서버 칸이 아직 없으면(DB 적용 전) 줄을 보이지 않는다.
  function receiveLine(f){
    if(!receive?.ready?.())return '';
    const on=receive.get()===f.id;
    return toggleLine('receive',on,RECEIVE_MENU,'lu-menu-receive');
  }
  // 켜고 끄는 메뉴 줄 한 모양(받는 폴더·주간 보고 저장 폴더 줄이 같이 씀): 켜면 앞에 ✓, aria-pressed.
  function toggleLine(action,on,label,cls=''){
    return `<button type="button"${cls?` class="${cls}"`:''} data-lu-folder-action="${action}" aria-pressed="${on}"><span>${on?'<span class="lu-menu-check" aria-hidden="true">✓ </span>':''}${label}</span></button>`;
  }
  // S70-11 WEEKLY-저장폴더나누기: [내 주간 보고 저장 폴더]·[팀 보고 취합 저장 폴더] — 받는 폴더 줄과 같은 모양(켜면 ✓, 다시 누르면 끔).
  // weekly = {show(id)=이 폴더 메뉴에 보일까, get(kind)=지금 저장 폴더 id|null, set(kind,id|null)=서버에 저장(성공 true)}. 규칙·글은 weekly-save-folder-model.mjs.
  function weeklyLines(f){
    if(!weekly?.show?.(f.id))return '';
    return ['personal','confirmed'].map(kind=>toggleLine('weekly-'+kind,weekly.get(kind)===f.id,esc(WEEKLY_FOLDER_TEXT.menu(kind)))).join('');
  }
  async function toggleWeekly(f,kind){
    if(!weekly||busy)return;
    const was=weekly.get(kind),next=was===f.id?null:f.id;
    if(!(await weekly.set(kind,next))){status(WEEKLY_FOLDER_TEXT.menuFailed,true);return}
    say(next?WEEKLY_FOLDER_TEXT.menuOn(kind,f.name):WEEKLY_FOLDER_TEXT.menuOff(kind,f.name),{undo:()=>weekly.set(kind,was||null)});
  }
  // LIB-받는폴더나누기(S60-18, 시안 ②): 받는 폴더 메뉴에 [폴더로 나누기] — 그 폴더에 자료가 있을 때만(창·제안·옮기기는 library-sort.js).
  function sortLine(f){return receive?.ready?.()&&receive.get()===f.id&&(receive.sortCount?.()||0)>0?'<button type="button" class="row-act lu-menu-sort" data-lu-folder-action="sort">폴더로 나누기</button>':''}
  async function toggleReceive(f,trigger){
    if(!receive||busy)return;
    const was=receive.get();
    if(was===f.id){
      if(!(await receive.set(null))){status('받는 폴더를 끄지 못했어요. 잠시 뒤 다시 해 주세요.',true);return}
      say(`‘${f.name}’ 폴더가 더 이상 받지 않아요. 폴더를 정하지 않은 자료는 폴더 밖에 있어요 ·`,{undo:()=>receive.set(f.id)});
      return;
    }
    if(!(await receive.set(f.id))){status('받는 폴더를 켜지 못했어요. 잠시 뒤 다시 해 주세요.',true);return}
    // 명진 결정(11/11 '지금 폴더 밖 자료도 한 번에 옮김'): 켤 때 지금 '폴더 밖' 자료 개수를 보여 주고 물은 뒤 옮긴다. 되돌리기 한 줄로 다시 폴더 밖으로.
    const outside=receive.outside?.()||[];
    if(outside.length&&await askConfirm(trigger,{text:`폴더 밖 자료 ${outside.length}개도 ‘${f.name}’ 폴더로 옮길까요?`,note:'앞으로 폴더를 정하지 않고 들어오는 자료는 이 폴더로 들어가요.',ok:'옮기기',cancel:'그대로 두기'})){
      await fileOutside(outside,f);
      return;
    }
    say(`이제 폴더를 정하지 않은 자료는 ‘${f.name}’ 폴더로 들어가요 ·`,{undo:()=>receive.set(was||null)});
  }
  // '폴더 밖' 자료(폴더 연결 줄이 없는 자료)를 한 폴더에 한 번에 넣는다. 옮기기와 같은 자료 연결 표 쓰기(소유자 RLS)이고 100개씩 한 요청으로 넣는다.
  // 한 덩어리가 거절되면(그 사이 다른 기기에서 폴더에 넣은 자료 등) 그 덩어리만 하나씩 넣는다. 되돌리기 = 이번에 넣은 연결 중 아직 그 폴더에 있는 것만 지움(폴더 밖으로).
  const CHUNK=100;
  async function fileOutside(docs,f){
    const ids=[...new Set(docs.map(d=>d.id).filter(Boolean))],done=[];let failed=0;
    const row=id=>({document_id:id,folder_id:f.id,workspace_id:s().workspace});
    const ok=await run(async()=>{
      for(let i=0;i<ids.length;i+=CHUNK){
        const part=ids.slice(i,i+CHUNK);
        try{await api(T_ITEMS,{method:'POST',prefer:'return=minimal',body:part.map(row),singleFlight:false});done.push(...part)}
        catch{for(const id of part){try{await api(T_ITEMS,{method:'POST',prefer:'return=minimal',body:row(id),singleFlight:false});done.push(id)}catch{failed++}}}
        if(ids.length>CHUNK)status(`옮기는 중 ${Math.min(i+CHUNK,ids.length)}/${ids.length}`);
      }
      if(!done.length)throw new Error('move failed');
    });
    if(!ok)return false;
    say(`옮겼어요 ${done.length}개 → ${f.name} 폴더${failed?` · ${failed}개는 옮기지 못했어요`:''} ·`,{error:failed>0,undo:()=>run(async()=>{
      for(let i=0;i<done.length;i+=CHUNK)await api(T_ITEMS+`?workspace_id=eq.${enc(s().workspace)}&folder_id=eq.${enc(f.id)}&document_id=in.(${done.slice(i,i+CHUNK).map(enc).join(',')})`,{method:'DELETE',prefer:'return=minimal',singleFlight:false});
    },'되돌렸어요.')});
    return true;
  }
  const headOf=key=>[...document.querySelectorAll('#documentList summary.lu-node-head')].find(h=>h.parentElement?.dataset.luNode===key);
  // 줄 안 이름 바꾸기(폴더): 창 없이 그 줄 이름이 입력칸이 된다. Enter·바깥 누르기=저장, Esc=취소. 저장은 폴더 이름뿐(자료·Drive는 그대로).
  let renaming=null;
  // LIB-두칸보기: 두 칸(#documentList 안 [data-lu-pane-i])의 폴더 줄도 왼쪽 나무 줄과 같은 data-lu-nav 단추다.
  // LIB-두칸폴더펼치기(S56-40): 두 칸 폴더 줄을 누르면 그 칸 안에서 펼치기·접기, 들어가기는 이 메뉴의 [이 폴더로 들어가기].
  const navBtnOf=(id,trigger=null)=>{const own=trigger?.closest?.('[data-lu-nav]');if(own?.dataset.luNav===id)return own;return [...document.querySelectorAll('#libraryListCard [data-lu-nav]')].find(b=>b.dataset.luNav===id)||null};
  // trigger가 왼쪽 나무 줄이면(나무 줄 우클릭 → [이름 바꾸기]) 그 나무 줄이 입력칸이 된다. 오른쪽 목록에 그 폴더 줄이 없을 때도 나무 줄로.
  function startRename(id,trigger=null){
    const f=folder(id);if(!f||busy)return;
    if(renaming){if(renaming.id===id){renaming.input.focus();return}renaming.finish(true)}
    let head=trigger?.closest?.('#libraryFolderNav,[data-lu-pane-i]')?null:headOf('f:'+id),nameEl=head?.querySelector('.lu-node-name');
    if(!head||!nameEl){const b=navBtnOf(id,trigger);if(!b)return;head=b.closest('.ft-row')||b.parentElement;nameEl=b}
    const inNav=!head.matches('summary');
    const input=document.createElement('input'),wasDraggable=head.getAttribute('draggable');
    input.type='text';input.className=inNav?'lu-folder-rename lu-fnav-rename':'lu-folder-rename';input.value=f.name;input.maxLength=40;input.autocomplete='off';input.setAttribute('aria-label','폴더 이름');
    let done=false;
    const state={id,input,finish(save,refocus=false){
      if(done)return;done=true;if(renaming===state)renaming=null;
      const raw=input.value;
      if(input.isConnected)input.replaceWith(nameEl);head.classList.remove('lu-renaming');if(wasDraggable!==null&&head.isConnected)head.setAttribute('draggable',wasDraggable);
      if(refocus)(inNav?nameEl:head).focus?.({preventScroll:true});
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
    // S55-08 LIB-폴더이름칸닫힘: 원인(사실) — 폴더 줄 머리의 손가락 크기 누름 칸(.lu-node-head::after, 줄 전체를 덮는 투명 칸)이 입력칸 위에 있어
    // 칸을 눌러도 누름이 머리(summary)로 가서 초점이 머리로 옮겨지고(blur = 저장·닫힘) 폴더가 펼쳐지거나 접혔다. 고치는 동안은 그 칸을 걷는다(lu-renaming).
    // 칸 안 누름·끌어 고르기·두 번 눌러 단어 고르기는 입력칸이 받고, 그 줄은 펼침·접힘·끌기를 하지 않는다(위 stopPropagation + draggable 해제 + summary 기본 동작 막기).
    head.classList.add('lu-renaming');head.removeAttribute('draggable');nameEl.replaceWith(input);renaming=state;
    input.focus({preventScroll:true});input.select();
  }
  function focusSummary(key){(headOf(key)||(key.startsWith('f:')?navBtnOf(key.slice(2)):null))?.focus({preventScroll:true})}

  // ---- 자료 → 폴더 옮기기 (LIB-폴더로옮기기, 2026-10-27) ----
  // 자료 ⋯·우클릭 메뉴의 [폴더로 옮기기 ›], 선택 모드의 [폴더로 옮기기], 끌어 놓기가 모두 이 아래 moveDocs 하나(app_library_folder_items 쓰기,
  // LIB-폴더탐색기와 같은 길)로 옮긴다. 어느 묶기 화면에서나 같다. 프로젝트 묶기·종류·담당조직·월별에서는 자료의 프로젝트 틀과 같은 폴더에만 넣을 수 있고
  // (프로젝트 묶기는 틀이 다른 연결을 보이지 않으므로) 나머지 폴더는 흐리게 + 이유 한 줄, 묶기 '폴더'에서는 틀과 무관하게 모든 폴더에 넣는다.
  const itemFolders=()=>new Map(s().items.map(x=>[x.document_id,x.folder_id]));
  // 끌기 중 놓을 곳 목록(폴더 토글이 없는 묶기, 아래 showDropPanel)은 같은 줄 규칙(pickerRows)을 그대로 쓴다.
  const rowsFor=(docs,query='')=>pickerRows({folders:s().folders,docs,itemFolder:itemFolders(),free:!!s().free,recent:recent.get(),query});
  const moveMenuHtml=(doc,count=1)=>`<button type="button" data-lu-move-open="${esc(doc.id)}" aria-haspopup="dialog">${count>1?`선택한 ${count}개 폴더로 옮기기`:'폴더로 옮기기'}<span class="lu-menu-key" aria-hidden="true">›</span></button>`;
  // 옮기고 나면 그 폴더를 '최근 넣은 곳' 맨 앞에 둔다(서버 기억).
  async function putDocs(docs,folderId,opt={}){const ok=await moveDocs(docs,folderId,opt);if(ok&&folderId)recent.push(folderId);return ok}
  // S69-62 폴더 고르기 = [파일] '옮길 곳' 창 하나: 위 '최근 넣은 곳' 칩, 폴더 나무(누르면 펼침·선택), 아래 '자료실 › 가 › 나' + [새 폴더] + [여기에 옮기기].
  // 고르기만으로는 옮기지 않고 [여기에 옮기기]로만 옮긴다. 폴더 묶기가 아니면(사업영역 묶기) 자료의 사업영역과 다른 폴더는 흐리게 + 까닭.
  // anchor·trigger = 누른 단추(창을 닫으면 초점이 돌아갈 곳), closeOuter = 이 창을 연 바깥 메뉴(자료 ⋯)를 닫는 함수 — 창은 화면을 덮으므로 열 때 먼저 닫는다.
  // all=true(사진 묶음 메뉴): 묶음 안 사진은 모두 옮기거나 모두 그대로(끌어 놓기와 같은 moveDocs all 모드).
  // S69-69 LIB-사각형폴더: folders(고른 폴더 id들, 위 폴더를 함께 고른 아래 폴더는 부르는 쪽이 뺐다)가 있으면 폴더째 함께 옮긴다.
  // 옮길 수 있는 곳은 고른 폴더·그 아래가 아니고 폴더 단 제한 안(folderMoveOk). [새 폴더]는 자료만 고른 때만.
  function openMove(docs,anchor,{closeOuter=null,trigger=anchor,onClosed=null,all=false,folders=[],done=null}={}){
    const list=(docs||[]).filter(Boolean),fids=(folders||[]).filter(id=>folder(id));if((!list.length&&!fids.length)||!anchor)return false;
    const fin=ok=>{try{done?.(ok)}catch{}return ok}; // 폴더째 옮긴 뒤 부른 쪽이 선택을 끝낸다
    const fm=fids.length?folderMoveOk(s().folders,fids,{maxDepth:FOLDER_DEPTH,free:!!s().free}):null;
    const free=!!s().free,frames=new Set([...list.map(d=>d.project_id||null),...fids.map(id=>folder(id)?.project_id||null)]),frame=frames.size===1?[...frames][0]:undefined;
    const places=new Set(list.map(d=>docFolder(d)?.id||null));
    const current=fm?undefined:places.size===1?[...places][0]:undefined;
    const back=trigger?.isConnected&&!trigger.closest?.('.lu-folder-menu,.lu-more-panel,[role="menu"]')?trigger:null;
    const rootOk=(free||frame!==undefined)&&(!fm||fm.top||list.length>0);
    // 바깥 메뉴를 닫는 뒤로가기가 다 끝난 뒤에 연다(먼저 열면 그 뒤로가기가 새 창의 뒤로가기 칸까지 닫는다).
    const openIt=()=>openFolderSheet({anchor:back?.isConnected?back:document.activeElement,title:sheetTitle(list.length+fids.length,'옮길 곳'),rootName:free?'자료실':frame===undefined?word('사업영역 바로 아래'):frameName(frame),
      folders:()=>s().folders,recent:recent.get(),current,start:current,
      allowRoot:rootOk,rootReason:fm&&(free||frame!==undefined)?'이미 맨 위에 있어요':MIXED_REASON,
      blocked:id=>{if(id===null)return '';if(fm&&!fm.ok(id))return '선택한 폴더 안이나 너무 깊은 곳에는 옮길 수 없어요';if(free||!list.length)return '';const f=folder(id);return frame!==undefined&&(f?.project_id||null)===frame?'':(frame===undefined?MIXED_REASON:FRAME_REASON)},
      mkdir:!fids.length&&(free||frame!==undefined)?(parent,name)=>makeFolderIn(free?null:frame,parent,name):null,
      onGo:id=>fids.length?movePicked(list,fids,id||null).then(fin):id?putDocs(list,id,{all}):moveDocs(list,null,{all}),onClosed});
    if(closeOuter)Promise.resolve(closeOuter()).then(openIt,openIt);else openIt();
    return true;
  }
  // 고른 폴더를 target(없으면 맨 위) 안으로: 폴더마다 위 폴더·순서만 바꾼다(소유자 RLS REST, 순환·단 제한·틀은 DB 트리거가 지킨다). 이미 그 안이면 그대로.
  async function moveFoldersTo(ids,target){
    const list=ids.map(folder).filter(f=>f&&(f.parent_id||null)!==(target||null));if(!list.length)return {ok:true,moved:[],prev:[]};
    const prev=list.map(f=>({id:f.id,parent_id:f.parent_id||null,sort_order:f.sort_order})),moved=[];
    const ok=await run(async()=>{let order=nextSortOrder(sibs(list[0].project_id||null,target||null));for(const f of list){await api(T_FOLDERS+where(f.id),{method:'PATCH',prefer:'return=minimal',body:{parent_id:target||null,sort_order:order}});moved.push(f.id);order+=SORT_GAP}},'');
    return {ok,moved,prev:prev.filter(p=>moved.includes(p.id))};
  }
  // 폴더째 + 자료를 함께 옮긴다. 알림은 한 줄 '옮겼어요 폴더 n개 · 자료 m개 → 곳 · 되돌리기'(되돌리기 = 둘 다, 그 사이 또 옮겨진 폴더는 그대로).
  async function movePicked(docs,folderIds,target){
    const r=await moveFoldersTo(folderIds,target);
    const where_=target?`${folder(target)?.name||''} 폴더`:'맨 위';
    const undoFolders=async()=>{const back=r.prev.filter(p=>(folder(p.id)?.parent_id||null)===(target||null));if(!back.length)return true;return run(async()=>{for(const p of back)await api(T_FOLDERS+where(p.id),{method:'PATCH',prefer:'return=minimal',body:{parent_id:p.parent_id,sort_order:p.sort_order}})},'되돌렸어요.')};
    if(r.moved.length){if(target)reveal(chain(folder(target)?.project_id||null,target));say(`옮겼어요 폴더 ${r.moved.length}개 → ${where_} ·`,{undo:undoFolders})}
    if(!r.ok)return false;
    if(!docs.length)return true;
    const also=r.moved.length?{count:r.moved.length,undo:undoFolders}:null;
    return target?putDocs(docs,target,{also}):moveDocs(docs,null,{also});
  }
  // 고른 폴더 여럿을 한 번에 휴지통으로(확인은 부르는 쪽이 한 번 받았다). 폴더 하나 [폴더 삭제]와 같은 요청·같은 휴지통, 되돌리기 한 번에 모두.
  async function trashFolders(ids){
    const list=(ids||[]).map(folder).filter(Boolean);if(!list.length||busy)return {status:'failed',moved:[]};
    busy=true;status('');
    try{
      const {deleteManyToTrash}=await import('./trash-actions.js');
      const r=await deleteManyToTrash({kind:'library_folder',ids:list.map(f=>f.id),remove:id=>api(T_FOLDERS+where(id),{method:'DELETE',prefer:'return=minimal'}),afterChange:reload,notify:text=>status(text,true),movedText:n=>`폴더 ${n}개를 휴지통으로 옮겼어요.`});
      if(r.error)status(folderErrorText(r.error),true);
      return r;
    }catch(e){status(folderErrorText(e),true);try{await reload()}catch{}return {status:'failed',moved:[]}}
    finally{busy=false}
  }
  // ---- 끌어 놓기(LIB-토글트리 ④ + LIB-폴더탐색기, 설계 6·12절) ----
  // 끌 수 있는 것: 폴더 머리, 파일 줄(고른 줄이 여럿이면 고른 것 모두). 놓을 곳:
  //   프로젝트 묶기: 같은 프로젝트 틀 안의 폴더 머리(그 안으로), 같은 틀 폴더의 위·아래 끝(그 앞·뒤로), 그 틀의 프로젝트 머리(폴더 밖으로)
  //   폴더 보기: 틀과 무관하게 모든 폴더 머리(그 안으로), 모든 폴더 위·아래 끝, 맨 위 '폴더 밖' 머리(폴더 밖으로)
  // 자기·자기 아래·100단 초과는 놓을 수 없음 표시. 키보드는 폴더 줄 Alt+↑·Alt+↓(순서)와 ⋯ 메뉴 [옮기기…]가 같은 일을 한다(S61-14).
  // LIB-폴더끌어순서(S61-14): 다른 단의 폴더 줄 위·아래 끝에 놓아도 그 단으로 옮기며 그 자리에 끼운다. 왼쪽 나무·두 칸 칸의 폴더 줄도 같다.
  // 놓은 뒤에는 '옮겼어요 · 되돌리기' 한 줄. 바깥 파일을 올리는 끌어놓기(library-drop.js)는 dataTransfer에 'Files'가 있을 때만 반응하고,
  // 여기는 안에서 시작한 끌기(drag)만 보므로 서로 부딪치지 않는다.
  let drag=null,moving=0,dragTick=0;
  // LIB-끄는중막대: 끌기 시작·끝, 옮기기 시작·끝마다 부른다. 끌기 시작 중에 화면을 바꾸면 브라우저가 끌기를 취소하므로 한 박자 뒤에, 그때의 상태로 한 번만 알린다.
  function pokeDrag(){if(dragTick)return;dragTick=setTimeout(()=>{dragTick=0;const v=moving?{count:moving,moving:true}:drag?.kind==='file'?{count:drag.docs.length}:drag?.kind==='many'?{count:drag.folders.length+drag.docs.length}:null;try{onDragState(v)}catch{}},0)}
  const frameKeyOf=key=>key==='p:none'?null:key.slice(2);
  const docById=id=>s().docs.find(d=>d.id===id);
  const rowOf=id=>[...document.querySelectorAll('#documentList .lu-row')].find(x=>x.dataset.luDocument===id);
  // el에서 시작한 끌기 상태. touch=true(폰 길게 누르기)이면 draggable 표시가 없어도 잡는다.
  // S55-08 LIB-나무로끌기안됨: 두 칸 폴더 보기의 왼쪽 나무 폴더 줄(#libraryFolderNav)도 같은 끌기·놓기 부품을 쓴다(ⓑ 나무 → 목록, ⓓ 나무 → 나무).
  const navAt=el=>el?.closest?.('#libraryListCard [data-lu-nav]')||null;
  const rootNav=()=>document.querySelector('#libraryFolderNav [data-lu-nav=""]');
  const BLANK_ROWS='.ft-row,details.lu-node,.lu-row,[data-lu-pane-i],#libraryRecent,.lu-pane-head,.lu-search-row,.lu-filter-row,.lu-select-row,#libraryUploadRows,.lu-two-bar';
  const blankRoot=el=>!!rootNav()&&(blankRootAt(el,{zone:'#libraryFolderNav'})||blankRootAt(el,{zone:'#libraryListCard',rows:BLANK_ROWS}));
  // LIB-두칸보기(S55-11): 두 칸의 칸 상자(폴더 줄이 아닌 빈 자리·자료 줄 위)에 놓으면 그 칸의 지금 폴더(맨 위면 폴더 밖)로.
  // LIB-펼친폴더안놓기(S59-9): 칸 안에서 펼친 폴더 안 자료 줄(과 그 묶음 안 빈 틈)이면 그 폴더(가장 가까운 펼친 폴더)로, 표시는 그 폴더 줄.
  // 판정은 PC 파일 올리기와 같은 하나(library-drop.js paneDropAt) — {id, place(표시할 곳)}.
  const paneAt=el=>paneDropAt(el);
  // UI-펼친폴더안놓기전체(S60-13): 한 칸 목록에서 펼친 폴더 묶음(details.lu-node) 안 아무 자리 — 자료 줄뿐 아니라 [사진 n]·작은 그림·줄 사이 틈·기다림 줄 —
  // 이면 그 묶음의 폴더(공용 규칙 drop-open-folder.mjs). 원인(사실): 전에는 '.lu-row' 위만 보아서 LIB-사진숨김(PR 2448) 뒤 묶음 끝 [사진 n]·그 사이 틈에 놓으면 아무 일도 없었다.
  const openAt=el=>openFolderAt(el,{group:'details.lu-node',keyOf:g=>g.dataset.luNode||'',within:'#documentList',skip:'summary.lu-node-head'});
  const openHead=el=>{const g=openAt(el);return g?g.el.querySelector(':scope > summary.lu-node-head'):null};
  function dragFrom(el,touch=false){
    // S69-84: 손가락 끌기는 왼쪽 나무·두 칸 칸의 폴더 줄(.ft-row)째 잡는다(draggable은 마우스 HTML 끌기 표시라 보지 않음).
    const nav=touch?(el?.matches?.('.ft-row')?el.querySelector('[data-lu-nav]'):null):el?.closest?.('#libraryListCard [data-lu-nav][draggable="true"]');
    if(nav){const f=folder(nav.dataset.luNav);return f?withPicked({kind:'folder',id:f.id,frame:f.project_id||null,els:[nav.closest('.ft-row')||nav]}):null}
    const head=el.closest?.(touch?'summary.lu-node-head':'summary.lu-node-head[draggable="true"]'),row=el.closest?.(touch?'.lu-row[data-lu-document],.lu-row[data-lu-photoset]':'.lu-row[draggable="true"]');
    if(head){const key=head.parentElement?.dataset.luNode||'';if(!key.startsWith('f:'))return null;const f=folder(key.slice(2));if(!f)return null;return withPicked({kind:'folder',id:f.id,frame:f.project_id||null,els:[head.parentElement]})}
    // LIB-정리보충 ②: 사진 묶음 줄은 폴더 보기에서만 끈다. 묶음 안 실제 사진 자료 모두가 함께 옮겨지고(set=true), 일부만 옮겨진 채로 끝나지 않는다(moveDocs all).
    if(row?.dataset.luPhotoset){if(!s().free)return null;const docs=photoSetDocs(row.dataset.luPhotoset);if(!docs.length)return null;return {kind:'file',id:'photoset:'+row.dataset.luPhotoset,docs,els:[row],set:true}}
    if(row){
      const doc=docById(row.dataset.luDocument);if(!doc)return null;
      const picked=selected(),many=picked.length>1&&picked.includes(doc.id),docs=(many?picked.map(docById).filter(Boolean):(twinDocs(doc.id)||[doc]));
      return withPicked({kind:'file',id:doc.id,docs,els:docs.map(d=>rowOf(d.id)).filter(Boolean)});
    }
    return null;
  }
  // S70-08 LIB-여러폴더끌기(명진 11/25 09:39 "선택해서 드래그하면 다 드래그되어야하는데 하나만 드래그됨"): 원인(사실) — 끌기 시작(dragFrom)이 폴더 줄이면
  // 고른 것을 보지 않고 그 폴더 하나만, 자료 줄이면 고른 자료만(폴더째 고른 폴더는 빼고) 잡았다. 끄는 방향과는 상관없다.
  // 이제 잡은 줄이 고른 것 안에 있고(폴더째 고른 폴더 아래 폴더 포함) 고른 것에 폴더가 하나라도 있으면 고른 것 모두(kind 'many')를 끈다.
  // 고른 상태의 주인은 그대로 선택 모드(luPick) 하나 — 여기서는 읽기만 한다. 옮기기는 메뉴 [폴더로 옮기기]와 같은 movePicked(한 서버 길).
  const underPicked=(id,fids)=>{for(let f=folder(id),g=0;f&&g<200;f=f.parent_id?folder(f.parent_id):null,g++)if(fids.includes(f.id))return true;return false};
  function withPicked(d){
    if(!d||d.set)return d;
    const fids=(pickedFolders()||[]).filter(id=>folder(id));if(!fids.length)return d;
    const dids=selected()||[],inPick=d.kind==='folder'?underPicked(d.id,fids):d.docs.some(x=>dids.includes(x.id));
    if(!inPick||fids.length+dids.length<2)return d;
    const docs=dids.map(docById).filter(Boolean);
    return {kind:'many',id:d.id,folders:fids,docs,els:[...fids.flatMap(folderEls),...docs.map(x=>rowOf(x.id))].filter(Boolean)};
  }
  // 화면에 보이는 그 폴더의 줄(한 칸 목록 토글·두 칸 칸 줄·왼쪽 나무 줄) — 끄는 동안 흐리게 표시할 곳.
  const folderEls=id=>[...document.querySelectorAll(`#documentList details[data-lu-node="f:${CSS.escape(id)}"], #libraryListCard [data-lu-nav="${CSS.escape(id)}"]`)].map(el=>el.matches('[data-lu-nav]')?el.closest('.ft-row')||el:el);
  // 고른 것 모두를 targetId(null = 맨 위·폴더 밖) 안으로 옮길 수 있나 — 메뉴 [폴더로 옮기기] 창(openMove)과 같은 규칙:
  // 고른 폴더나 그 아래, 폴더 단 제한을 넘는 곳은 거절(놓을 폴더가 고른 것 안이면 거절), 폴더 묶기가 아니면 같은 사업영역 틀 안만, 이미 다 그 안이면 할 일 없음.
  function manyOk(targetId){
    const free=!!s().free,fm=folderMoveOk(s().folders,drag.folders,{maxDepth:FOLDER_DEPTH,free});
    const frames=new Set([...drag.docs.map(x=>x.project_id||null),...drag.folders.map(id=>folder(id)?.project_id||null)]);
    if(targetId===null)return (free||frames.size===1)&&(fm.top||drag.docs.some(x=>docFolder(x)));
    if(!fm.ok(targetId))return false;
    if(!free&&!(frames.size===1&&frames.has(folder(targetId)?.project_id||null)))return false;
    return drag.folders.some(id=>(folder(id)?.parent_id||null)!==targetId)||drag.docs.some(x=>docFolder(x)?.id!==targetId);
  }
  // S69-29 LIB-끄는모습: 끄는 동안 따라오는 조각 글자 — 폴더면 폴더 이름, 자료 여럿이면 '자료 n개', 하나면 그 제목.
  const ghostLabel=d=>!d?'':d.kind==='many'?manyText(d.folders.length,d.docs.length):d.kind==='folder'?String(folder(d.id)?.name||'폴더'):d.docs.length>1?`자료 ${d.docs.length}개`:String(d.docs[0]?.title||d.docs[0]?.file_name||'자료');
  const manyText=(f,n)=>n?`폴더 ${f}개 · 자료 ${n}개`:`폴더 ${f}개`;
  const touchGhost=createDragGhost();
  function dropFor(e){
    if(!drag)return null;
    // S55-08 ⓐ·ⓓ: 왼쪽 나무 줄에 놓기. '자료실 전체'는 오른쪽 '폴더 밖' 머리와 같은 맨 위(폴더 밖으로), 폴더 줄은 그 안으로.
    // 원인(사실): 끌기·놓기 이벤트를 오른쪽 목록(#documentList)에만 걸어 두어 나무 줄 위에서는 놓기를 받는 곳이 없었다(브라우저가 놓기를 거절).
    let nav=navAt(e.target);const spot=!nav&&paneAt(e.target);
    // STD-빈곳놓기·순서는줄사이만(S71-45, 2026-11-26 사용자 "폴더 밑에 여백 등에 마우스 가져가면 그냥 자료실 전체에 드롭"): 왼쪽 나무의 줄 밖 빈 곳(맨 아래 폴더 밑·칸 위아래 여백)과
    // 한 칸 목록 상자의 줄·묶음 밖 빈 곳은 '자료실 전체'(맨 위) — 표시도 그 줄. 폴더를 끌 때 나무 맨 끝 줄의 아래 끝은 줄 사이가 아니라 빈 곳(공용 lineOrBlank).
    // 폴더 줄 위(이름 오른쪽 같은 줄 포함)는 지금처럼 그 폴더. 판정은 공용 blankRootAt 하나.
    if(nav&&drag.kind==='folder'&&nav.dataset.luNav&&nav.closest('#libraryFolderNav')){const row=nav.closest('.ft-row'),rows=[...document.querySelectorAll('#libraryFolderNav .ft-row')];if(row&&row===rows.at(-1)&&lineOrBlank(dropZone(row.getBoundingClientRect(),e.clientY),{last:true})==='blank')nav=rootNav()||nav}
    if(!nav&&!spot&&s().free&&blankRoot(e.target))nav=rootNav();
    if(nav||spot){
      const head=nav?nav.closest('.ft-row')||nav:spot.place,id=nav?nav.dataset.luNav||'':spot.id,group=spot?.group||null;
      if(!s().free)return null;
      if(!id||id===OUTSIDE_KEY){
        if(drag.kind==='many')return {head,nav:true,ok:manyOk(null),kind:'top'};
        if(drag.kind==='file')return {head,nav:true,ok:drag.docs.some(d=>docFolder(d)),kind:'top'};
        return {head,nav:true,ok:!!folder(drag.id)?.parent_id,kind:'top'};
      }
      const target=folder(id);if(!target)return {head,nav:true,ok:false};
      if(drag.kind==='many')return {head,nav:true,group,ok:manyOk(target.id),kind:'into',target:target.id};
      if(drag.kind==='file')return {head,nav:true,group,ok:drag.docs.some(d=>docFolder(d)?.id!==target.id),kind:'into',target:target.id};
      // LIB-폴더끌어순서(S61-14): 나무·칸의 폴더 줄도 위 끝 = 그 앞, 아래 끝 = 그 뒤, 가운데 = 안으로(노트 나무와 같은 공용 판정). 칸의 빈 자리·자료 줄은 안으로만.
      const p=folderPlace(drag.id,target,nav?dropZone(head.getBoundingClientRect(),e.clientY):'inside');
      if(!p)return {head,nav:true,ok:false};
      return p.kind==='reorder'?{head,nav:true,ok:true,kind:p.line,target:target.id}:{head,nav:true,group,ok:true,kind:'into',target:target.id};
    }
    // LIB-후속1 ⑤: 분류로 묶은 화면에서 자료를 다른 분류 머리(또는 그 분류의 열린 자료 줄) 위에 놓으면 그 분류로 바꾼다. 왼쪽 폴더 팝업은 그대로(폴더 옮기기).
    if(drag.kind==='file'&&categoryOf&&changeCategory){
      const cHead=e.target?.closest?.('#documentList summary.lu-node-head')||openHead(e.target);
      const cKey=cHead?.parentElement?.dataset.luNode||'';
      if(cKey.startsWith('c:')){const name=cKey.slice(2);return {head:cHead,ok:drag.docs.some(d=>categoryOf(d.category)!==name),kind:'category',value:name}}
    }
    // LIB-정리보충 ④(10:41): 폴더 머리뿐 아니라 열린 폴더 안의 자료 줄 위에 놓아도 그 자료가 든 폴더(가장 가까운 토글)로. '폴더 밖' 자료 줄이면 폴더 밖으로.
    let head=e.target?.closest?.('#documentList summary.lu-node-head'),viaRow=false;
    if(!head){head=openHead(e.target);viaRow=!!head}
    if(!head)return null;
    const node=head.parentElement,key=node?.dataset.luNode;if(!key)return null;
    const free=!!s().free,r=head.getBoundingClientRect();
    const sameFrame=frame=>drag.kind==='folder'?drag.frame===frame:drag.kind==='many'?drag.folders.every(id=>(folder(id)?.project_id||null)===frame)&&drag.docs.every(d=>(d.project_id||null)===frame):drag.docs.every(d=>(d.project_id||null)===frame);
    // 맨 위 머리: 프로젝트 묶기는 그 프로젝트 머리, 폴더 보기는 '폴더 밖'.
    if(key.startsWith('p:')||key===OUTSIDE_KEY){
      if(key.startsWith('p:')===free)return {head,ok:false};
      if(!free&&!sameFrame(frameKeyOf(key)))return {head,ok:false};
      if(drag.kind==='many')return {head,ok:manyOk(null),kind:'top'};
      if(drag.kind==='file')return {head,ok:drag.docs.some(d=>docFolder(d)),kind:'top'};
      return {head,ok:!!folder(drag.id)?.parent_id,kind:'top'};
    }
    const target=folder(key.slice(2));if(!target)return {head,ok:false};
    if(!free&&!sameFrame(target.project_id||null))return {head,ok:false};
    if(drag.kind==='many')return {head,ok:manyOk(target.id),kind:'into',target:target.id};
    if(drag.kind==='file')return {head,ok:drag.docs.some(d=>docFolder(d)?.id!==target.id),kind:'into',target:target.id};
    // LIB-폴더끌어순서(S61-14): 같은 단·다른 단 모두 위 끝 = 그 앞, 아래 끝 = 그 뒤(다른 단이면 그 단으로 옮기며 그 자리에), 가운데 = 안으로. 열린 폴더 안 자료 줄 위는 안으로만.
    const p=folderPlace(drag.id,target,viaRow?'inside':dropZone(r,e.clientY));
    if(!p)return {head,ok:false};
    return p.kind==='reorder'?{head,ok:true,kind:p.line,target:target.id}:{head,ok:true,kind:'into',target:target.id};
  }
  // 폴더를 폴더 줄에 놓을 때의 판정(공용 folderDropPlan). 옮길 수 있는 곳은 메뉴 [옮기기…]와 같은 목록(자기·자기 아래·100단 초과·다른 틀 제외).
  function folderPlace(dragId,target,zone){
    const f=folder(dragId);if(!f||!target)return null;
    let can=null;const ok=id=>(can??=folderMoveTargets(s().folders,dragId,!!s().free)).includes(id);
    return folderDropPlan({dragId,targetId:target.id,dragParent:f.parent_id||null,targetParent:target.parent_id||null,zone,canPlaceIn:ok,canInto:()=>ok(target.id)});
  }
  // LIB-정리보충 10:42: 끄는 채 닫힌 폴더(또는 '폴더 밖'·프로젝트 토글) 위에 1초 머물면 저절로 열린다(탐색기 방식). 다른 곳으로 가거나 끌기가 끝나면 취소.
  // 여는 것은 details.open만 바꾼다(목록을 다시 그리지 않아 끌기가 끊기지 않음). 펼침 기억은 기존 toggle 이벤트가 맡는다.
  const HOVER_OPEN_MS=1000;let hoverKey='',hoverTimer=0;
  // TREE-펼치기먼저 ④(S70-81): 왼쪽 나무(#libraryFolderNav)의 닫힌 폴더 위에 0.6초 머무르면 그 줄도 펼친다(공용 ftHoverExpander, [파일]·사진과 같은 값).
  //  나무 칸만 다시 그린다(navOpen — 오른쪽 목록은 그대로라 끌기가 끊기지 않음). 오른쪽 목록 폴더(details)는 아래 원래 1초 그대로.
  const navHover=ftHoverExpander(id=>{if(drag||touch?.grabbed||fileDrag)navOpen(id)});
  function hoverOpen(t){
    const navTog=t?.nav&&t.head?.closest?.('#libraryFolderNav')?t.head.querySelector(':scope > [data-lu-nav-tog][aria-expanded="false"]'):null;
    navHover.over(navTog?.dataset.luNavTog||'',!!navTog);
    if(t?.nav)t=null;
    const node=t?.head?.parentElement,key=node?.dataset?.luNode||'';
    // S69-28·S69-68: 탐색기 칸의 0단 폴더 줄(data-lu-enter)은 끄는 중 머물러도 열지 않는다(놓으면 그 폴더 안 — 끄는 동안 칸 모양이 바뀌지 않게).
    const want=node&&!node.open&&!node.hasAttribute?.('data-lu-enter')&&t.kind!=='before'&&t.kind!=='after'?key:'';
    if(want===hoverKey)return;
    clearTimeout(hoverTimer);hoverKey=want;
    if(want)hoverTimer=setTimeout(()=>{if(hoverKey===want&&(drag||touch?.grabbed||fileDrag)&&node.isConnected&&!node.open)node.open=true},HOVER_OPEN_MS);
  }
  // LIB-폴더로올리기 (2026-10-30 명진 요청): PC 파일을 폴더 묶기의 폴더 줄(머리, 또는 열린 폴더 안 자료 줄) 위로 끌면 그 폴더가 놓을 곳이다.
  // 자료 옮기기와 같은 놓을 곳 표시·머물면 펼침을 쓴다. 폴더 묶기(free)에서만, 폴더가 아닌 곳('폴더 밖' 등)은 null(지금처럼 화면 끌어놓기).
  let fileDrag=false;
  function fileTarget(e){
    if(drag||!s().free)return null;
    let head=e?.target?.closest?.('#documentList summary.lu-node-head');
    if(!head)head=openHead(e?.target);
    const key=head?.parentElement?.dataset.luNode||'';
    if(!key.startsWith('f:'))return null;
    const f=folder(key.slice(2));
    return f?{head,ok:true,kind:'into',target:f.id,name:f.name}:null;
  }
  function markFile(t){
    if(drag)return;
    if(!t){if(fileDrag){fileDrag=false;clearMarks()}return}
    fileDrag=true;showMarks(t);hoverOpen(t);
  }
  // 막 올린 자료를 그 폴더에 넣는다(옮기기와 같은 자료 연결 표 한 줄 쓰기, 소유자 RLS). 안내·다시 읽기는 부른 쪽이 한 번에 한다.
  // LIB-받는폴더: 받는 폴더가 켜져 있으면 서버가 막 만든 자료를 이미 받는 폴더에 넣어 두었다(연결 줄이 있어 넣기가 겹침 거절 409) → 연 폴더로 고친다.
  async function putUploaded(docId,folderId){
    if(!docId||!folder(folderId))return false;
    return putDocumentInFolder(api,{workspace:s().workspace,documentId:docId,folderId}); // 조직 기록 자료 폴더(org-files-folder.js)와 같은 쓰기
  }
  // 표시는 오른쪽 목록과 왼쪽 나무 두 곳에 붙는다(S55-08).
  const marked=list=>document.querySelectorAll(list.split(',').flatMap(c=>['#documentList '+c,'#libraryFolderNav '+c]).join(','));
  function clearMarks(){pokeDrag();clearTimeout(hoverTimer);hoverKey='';hideDropPanel();marked('.lu-drop-into,.lu-drop-before,.lu-drop-after,.lu-drop-no,.lu-dragging,.lu-grabbed,.lu-drop-group').forEach(el=>el.classList.remove('lu-drop-into','lu-drop-before','lu-drop-after','lu-drop-no','lu-dragging','lu-grabbed','lu-drop-group'))}
  function showMarks(t){
    if(!t)document.querySelectorAll('#documentList .lu-drop-group').forEach(el=>el.classList.remove('lu-drop-group'));
    marked('.lu-drop-into,.lu-drop-before,.lu-drop-after,.lu-drop-no').forEach(el=>{if(el!==t?.head)el.classList.remove('lu-drop-into','lu-drop-before','lu-drop-after','lu-drop-no')});
    if(!t)return;t.head.classList.remove('lu-drop-into','lu-drop-before','lu-drop-after','lu-drop-no');
    t.head.classList.add(!t.ok?'lu-drop-no':t.kind==='before'?'lu-drop-before':t.kind==='after'?'lu-drop-after':'lu-drop-into');
    document.querySelectorAll('#documentList .lu-drop-group').forEach(el=>{if(t.nav||el!==t.head.parentElement)el.classList.remove('lu-drop-group')});
    // UI-펼친폴더안놓기전체(S60-13): 두 칸 칸 안 펼친 폴더 묶음이면 그 폴더 줄 + 안의 자료 묶음 전체를 옅은 바탕으로(한 칸 목록과 같은 표시).
    if(t.nav){paneGroup(t);return} // 나무 줄·칸 상자는 그 줄만 표시(묶음 강조 없음).
    // 놓일 묶음 전체(머리줄 + 안의 줄)를 연한 강조색으로: 분류 바꾸기, 그리고 자료를 폴더(또는 폴더 밖)에 넣을 때.
    t.head.parentElement?.classList.toggle('lu-drop-group',t.ok&&(t.kind==='category'||((drag?.kind==='file'||drag?.kind==='many'||fileDrag)&&(t.kind==='into'||t.kind==='top'))));
  }
  function paneGroup(t){for(const el of t?.ok!==false&&t?.kind!=='before'&&t?.kind!=='after'?t?.group||[]:[])el.classList.add('lu-drop-group')}
  const markDragging=d=>{for(const el of d?.els||[])el.classList.add('lu-dragging')};
  // UI-끌기가장자리스크롤(S69-15): 끄는 동안 포인터(손가락) 아래 칸(두 칸 보기의 각 칸 목록·나무·목록 상자·화면)의 위·아래 가장자리면 저절로 굴린다 — 공용 부품 drag-edge-scroll.js.
  // PC HTML 끌기는 문서 전체 하나(installDragEdgeScroll, drop·dragend로 멈춤), 폰 길게 눌러 끌기는 같은 계산(createEdgeScroll) — 굴린 뒤 손가락 아래 놓을 곳을 다시 본다.
  // 원인(사실): 전에는 목록 상자의 바깥 칸만 굴려서, 칸마다 따로 굴러가는 두 칸 보기 목록(.lu-pane-list)은 끄는 동안 움직이지 않았다.
  installDragEdgeScroll();
  const touchScroll=createEdgeScroll({fallback:()=>document.querySelector('#documentList'),onScroll:(x,y)=>{if(!touch?.grabbed||!touch.moved||!touch.drag)return;touch.drop=dropFor({target:document.elementFromPoint(x,y),clientY:y});showMarks(touch.drop);hoverOpen(touch.drop)}});
  function stopScroll(){touchScroll.stop()}
  // 자료 여럿(또는 하나)을 폴더로/폴더 밖으로. 이전 자리를 기억해 '되돌리기'가 그 자리로 돌려놓는다(그 사이 또 바뀐 것은 건드리지 않음).
  // all=true(사진 묶음): 하나라도 못 옮기면 이미 옮긴 것을 이전 자리로 되돌려 '모두 옮김 / 모두 그대로' 둘 중 하나로 끝낸다.
  async function moveDocs(docs,folderId,{all=false,open=true,also=null}={}){
    const todo=docs.filter(d=>folderId?docFolder(d)?.id!==folderId:!!rawItem(d));if(!todo.length)return false;
    const prev=todo.map(d=>({id:d.id,had:!!rawItem(d),folder:rawItem(d)?.folder_id||null})),w=id=>`?document_id=eq.${enc(id)}&workspace_id=eq.${enc(s().workspace)}`;
    // LIB-후속1 ③: 'n/전체'를 알리고, 일부가 실패해도 옮긴 것은 그대로 둔다(실패한 것만 onMoved로 돌려 고른 채 남김).
    // LIB-끌어옮기기저장실패(S69): 100개씩 한 요청 + 거절된 묶음만 하나씩, 화면이 몰랐던 연결 줄(겹침 409)은 지금 폴더를 읽고 옮긴다(library-move-write.mjs).
    let done=[],failed=[],lastMoveError=null;moving=prev.length;pokeDrag();
    const ok=await run(async()=>{const r=await writeMoves({api,ws:s().workspace,prev,folderId,all,chunk:all?1:undefined/* 사진 묶음은 한 장씩(하나라도 막히면 되돌림) */,onProgress:p=>{try{onMoveProgress(p)}catch{}}});done=r.done;failed=r.failed;lastMoveError=r.firstError;
    if(all&&failed.length&&done.length){
      // 되돌리기(보상): 옮긴 것을 이전 자리로. 이것도 실패하면 그 사실을 알린다(남은 것은 목록 다시 읽기가 보여 줌).
      const back=[];for(const id of done){const p=prev.find(x=>x.id===id);try{
        if(!p.had)await api(T_ITEMS+w(p.id),{method:'DELETE',prefer:'return=minimal'});
        else await api(T_ITEMS+w(p.id),{method:'PATCH',prefer:'return=minimal',body:{folder_id:p.folder}});
        back.push(id)}catch{}}
      failed.push(...back);const stuck=done.filter(id=>!back.includes(id));done=stuck;
      throw Object.assign(new Error('LIB_PHOTOSET_PARTIAL'),{partial:stuck.length});
    }
    if(!done.length)throw r.firstError||new Error('move failed')}).finally(()=>{moving=0;pokeDrag()});
    try{onMoved({done:ok?done:[],failed:ok?failed:prev.map(p=>p.id),folderId})}catch{}
    if(!ok)return false;
    // LIB-추천넣기안열기(S60-27): 점선 추천으로 넣을 때(open:false)는 받는 폴더를 펼치지 않고 화면 자리를 그대로 둔다.
    if(folderId&&open)reveal(chain(todo[0].project_id||null,folderId));
    const moved=prev.filter(p=>done.includes(p.id)),where_=folderId?`${folder(folderId)?.name||''} 폴더`:'폴더 밖';
    // 못 옮긴 것이 있으면 개수와 이유 한 줄(이유 = 첫 거절의 일상어 문구).
    const why=failed.length?folderErrorText(lastMoveError):'';
    // S69-69: 고른 폴더를 함께 옮겼으면(also) 한 줄에 '폴더 n개 · 자료 m개', 되돌리기도 둘 다.
    const what=also?`폴더 ${also.count}개 · 자료 ${moved.length}개`:`${moved.length}개`;
    const undoDocs=()=>run(()=>undoMoves({api,ws:s().workspace,moved,folderId}),'되돌렸어요.');
    say(`옮겼어요 ${what} → ${where_}${failed.length?` · ${failed.length}개는 옮기지 못했어요(선택한 채로 남김) — ${why}`:''} ·`,{error:failed.length>0,undo:also?async()=>{await undoDocs();return also.undo()}:undoDocs});
    return true;
  }
  async function dragMoveFolder(id,parentId){
    const f=folder(id);if(!f)return false;const before={parent_id:f.parent_id||null,sort_order:f.sort_order};
    const ok=await moveFolder(id,parentId,'');if(!ok)return false;
    say(`폴더를 옮겼어요 → ${parentId?`${folder(parentId)?.name||''} 폴더`:'맨 위'} ·`,{undo:()=>{const cur=folder(id);if(!cur||(cur.parent_id||null)!==(parentId||null)){say('그 사이 폴더가 또 바뀌어 되돌리지 않았어요.');return Promise.resolve(false)}return run(()=>api(T_FOLDERS+where(id),{method:'PATCH',prefer:'return=minimal',body:before}),'되돌렸어요.')}});
    return true;
  }
  // LIB-폴더끌어순서(S61-14): 끈 폴더를 target 앞/뒤에 둔다. 상위가 다르면 target의 상위로 옮기며 그 자리에. 순서 값은 공용 placeAt(틈이 있으면 옮긴 줄 하나, 없으면 그 형제를 1024 간격으로).
  // 바뀐 행만 저장(기존 소유자 RLS REST, DB 변경 없음). '… · 되돌리기'(Ctrl+Z 포함)는 바뀐 행을 이전 상위·순서로 돌린다(그 사이 또 옮겨졌으면 되돌리지 않음).
  async function placeBeside(id,targetId,after){
    const f=folder(id),t=folder(targetId);if(!f||!t||f.id===t.id)return false;
    const parent=t.parent_id||null,same=(f.parent_id||null)===parent;
    const sib=sibs(s().free?null:(f.project_id||null),parent),others=sib.filter(x=>x.id!==id),i=others.findIndex(x=>x.id===targetId);if(i<0)return false;
    const at=i+(after?1:0);
    if(same&&isSamePlace(sib,id,at))return false;
    const plan=placeAt(same?sib:others,id,at).map(c=>({id:c.id,sort_order:c.order}));
    const prev=plan.map(p=>{const x=folder(p.id);return {id:p.id,parent_id:x.parent_id||null,sort_order:x.sort_order}});
    const body=p=>p.id===id&&!same?{parent_id:parent,sort_order:p.sort_order}:{sort_order:p.sort_order};
    // 옮기는 폴더를 먼저 써서 DB 검사(순환·100단·틀)가 거절하면 나머지는 쓰지 않는다.
    const order=[...plan.filter(p=>p.id===id),...plan.filter(p=>p.id!==id)];
    const ok=await run(async()=>{for(const p of order)await api(T_FOLDERS+where(p.id),{method:'PATCH',prefer:'return=minimal',body:body(p)})});if(!ok)return false;
    if(!same)reveal(chain(f.project_id||null,parent));
    const text=same?'순서를 바꿨어요 ·':`폴더를 옮겼어요 → ${parent?`${folder(parent)?.name||''} 폴더`:'맨 위'} ·`;
    say(text,{undo:()=>{const cur=folder(id);if(!cur||(cur.parent_id||null)!==parent){say('그 사이 폴더가 또 바뀌어 되돌리지 않았어요.');return Promise.resolve(false)}
      return run(async()=>{for(const p of [...prev.filter(p=>p.id===id),...prev.filter(p=>p.id!==id)])await api(T_FOLDERS+where(p.id),{method:'PATCH',prefer:'return=minimal',body:p.id===id&&!same?{parent_id:p.parent_id,sort_order:p.sort_order}:{sort_order:p.sort_order}})},'되돌렸어요.')}});
    return true;
  }
  function commitDrop(d,t){
    if(!d||!t?.ok)return;
    // S70-08: 고른 것 모두 — 메뉴 [폴더로 옮기기]와 같은 movePicked(폴더째 + 자료, 알림 한 줄 '옮겼어요 폴더 n개 · 자료 m개 → 곳 · 되돌리기', 되돌리기 = 모두).
    if(d.kind==='many'){const docs=d.docs.map(x=>docById(x.id)).filter(Boolean),fids=d.folders.filter(id=>folder(id));if(!fids.length)return;void movePicked(docs,fids,t.kind==='top'?null:t.target).then(ok=>{if(ok)try{onPickedMoved()}catch{}});return}
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
    el.querySelector('.lu-drop-list').innerHTML=(list||emptyHtml())+(docs.some(x=>rawItem(x))?'<div class="lu-drop-item" data-lu-drop-out>폴더 밖으로</div>':'');
    const reason=data.all.find(r=>r.reason)?.reason;
    const foot=el.lastElementChild;foot.hidden=!reason;foot.textContent=reason?`흐린 폴더는 ${reason}. 묶기를 ‘폴더’로 바꾸면 선택할 수 있어요.`:'';
    el.hidden=false;
  }
  function hideDropPanel(){if(dropPanel){dropPanel.hidden=true;for(const el of dropPanel.querySelectorAll('.lu-drop-over'))el.classList.remove('lu-drop-over')}dropPanelDocs=null}
  let touch=null,suppressUntil=0;
  function bindDrag(list){
    // S55-08: 끌기·놓기는 목록 상자 전체(#libraryListCard = 왼쪽 나무 + 오른쪽 목록)에서 받는다. 폰 길게 누르기는 지금처럼 목록만.
    const area=list.closest?.('#libraryListCard')||list;
    area.addEventListener('dragstart',e=>{
      const d=dragFrom(e.target);if(!d)return;drag=d;markDragging(d);pokeDrag();
      try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',d.id)}catch{}
      setDragGhostImage(e.dataTransfer,ghostLabel(d),document,e);
      // 폴더 토글이 없는 묶기에서는 왼쪽에 놓을 곳 목록을 띄운다. 끌기 시작 중에 DOM을 바꾸면 브라우저가 끌기를 취소하므로 한 박자 뒤에.
      if(d.kind==='file'&&!s().treeView)setTimeout(()=>{if(drag===d)showDropPanel(d)},0);
    });
    area.addEventListener('dragover',e=>{
      if(!drag)return;const t=dropFor(e);showMarks(t);hoverOpen(t);
      if(!t)return;
      if(!t.ok){try{e.dataTransfer.dropEffect='none'}catch{}return}
      e.preventDefault();try{e.dataTransfer.dropEffect='move'}catch{}
    });
    area.addEventListener('drop',e=>{
      if(!drag)return;const t=dropFor(e),d=drag;drag=null;clearMarks();stopScroll();if(!t?.ok)return;e.preventDefault();commitDrop(d,t);
    });
    area.addEventListener('dragend',()=>{drag=null;clearMarks();stopScroll()});
    bindTouch(list);
  }
  // ---- 폰: 길게 누르기 = 고르기, 길게 눌러 움직이기 = 옮기기 ----
  // 줄·폴더 머리를 LONG_MS 눌러 두면(짧게 진동) 잡힌다. 잡기 전에 손가락이 움직이면(세로 스크롤) 그대로 스크롤이고,
  // 끌 수 있는 화면(touchOk)이면 잡은 뒤에는 스크롤을 막고 손가락을 따라 놓을 곳을 표시한다.
  // S69 LONGPRESS-선택(2026-11-24 명진): 움직이지 않고 떼면 선택 모드를 켜고 그 줄을 고른다(onHold — 공용 규칙 select-mode.js holdPick).
  // 메뉴는 줄 오른쪽 ⋯로만 연다. 움직였다 떼면 놓은 곳으로 옮긴다. PC 마우스 우클릭·키보드(⋯·Shift+F10)는 그대로.
  const LONG_MS=450,SLOP=8,MOVED=12;
  // S69-84 목록 엔진 통일 ①(명진 11/24 23:57 "폴드 펼침 화면에서도 꾹 눌러 선택 등 움직임 통일"): 받는 곳 = 목록 상자 전체(왼쪽 나무 + 오른쪽 목록).
  // 원인(사실): 목록(#documentList)에만 걸려 폴드·PC 왼쪽 나무 폴더 줄은 꾹 눌러도 아무 일이 없었다. 기기 폭이 아니라 손가락(pointerType)으로만 가른다.
  // 폴더 줄(.ft-row, 이름 단추 [data-lu-nav])은 단추지만 줄째 잡는다. ⋯·펼침 아이콘은 그대로 단추.
  const NAV_ROW='#libraryFolderNav .ft-row,[data-lu-pane-i] .ft-row';
  function bindTouch(list){
    const area=list.closest?.('#libraryListCard')||list;
    const cancel=()=>{if(touch?.timer)clearTimeout(touch.timer);touch?.unbind?.();touch=null};
    const finish=()=>{clearMarks();stopScroll();touchGhost.hide();drag=null;cancel()};
    const ROW='.lu-row[data-lu-document],.lu-row[data-lu-photoset],summary.lu-node-head,'+NAV_ROW;
    area.addEventListener('pointerdown',e=>{
      if(e.pointerType!=='touch'||!e.isPrimary)return;
      const t=e.target;if(!(t instanceof Element))return;
      const navMain=t.closest('.ft-row > [data-lu-nav]')&&!t.closest('[data-lu-nav="'+OUTSIDE_KEY+'"]');
      if(!navMain&&t.closest('input:not(.lu-pick),textarea,select,[contenteditable],button,a[href],.lu-undo,.lu-more-files,.lu-more-row'))return;
      const el=t.closest(ROW);if(!el||(el.matches('summary')&&renaming)||(el.matches('.ft-row')&&!folder(el.querySelector('[data-lu-nav]')?.dataset.luNav||'')))return;
      cancel();
      const canDrag=touchOk();
      touch={el,x:e.clientX,y:e.clientY,grabbed:false,moved:false,drop:null,at:Date.now(),canDrag,timer:setTimeout(()=>{
        if(!touch||touch.el!==el)return;
        touch.grabbed=true;
        if(canDrag){touch.drag=dragFrom(el,true);drag=touch.drag;pokeDrag();if(touch.drag){el.classList.add('lu-grabbed');markDragging(touch.drag)}}
        // S70-10: 끄는 동안 목록이 다시 그려져('n개 더 보기' 열림) 처음 누른 칸이 빠져도 끌기가 이어지게(공용 followTouch).
        touch.unbind=followTouch(t,{move:onMove,end:onEnd,cancel:onCancel});
        try{navigator.vibrate?.(12)}catch{}
      },LONG_MS)};
    });
    area.addEventListener('pointermove',e=>{
      if(!touch||touch.grabbed||e.pointerType!=='touch')return;
      if(Math.hypot(e.clientX-touch.x,e.clientY-touch.y)>SLOP)cancel();
    });
    area.addEventListener('pointercancel',e=>{if(e.pointerType==='touch'&&touch&&!touch.grabbed)cancel()});
    // 잡은 뒤의 움직임은 touch 이벤트로 받는다(passive:false라야 스크롤을 막을 수 있다).
    const onMove=e=>{
      if(!touch?.grabbed)return;
      if(e.cancelable)e.preventDefault();
      const p=e.touches[0];if(!p)return;
      if(Math.hypot(p.clientX-touch.x,p.clientY-touch.y)>MOVED)touch.moved=true;
      if(!touch.moved||!touch.drag)return;
      if(!touchGhost.shown)touchGhost.show(ghostLabel(touch.drag),p.clientX,p.clientY);else touchGhost.move(p.clientX,p.clientY);
      touch.drop=dropFor({target:document.elementFromPoint(p.clientX,p.clientY),clientY:p.clientY});showMarks(touch.drop);hoverOpen(touch.drop);touchScroll.update(p.clientX,p.clientY);
    };
    area.addEventListener('touchmove',onMove,{passive:false});
    const onEnd=e=>{
      if(!touch)return;
      if(!touch.grabbed){cancel();return}
      if(e.cancelable)e.preventDefault();
      const {el,moved,drop,drag:d}=touch;
      finish();
      suppressUntil=Date.now()+600;
      if(moved){if(d)commitDrop(d,drop);return}
      // 움직이지 않고 뗌 = 선택 모드 + 그 줄 선택(메뉴 아님).
      onHold(el);
    };
    area.addEventListener('touchend',onEnd);
    const onCancel=()=>{if(touch?.grabbed)finish();else cancel()};
    area.addEventListener('touchcancel',onCancel);
    // 꾹 누르면 브라우저가 보내는 기본 길게누르기 메뉴와 뗀 직후 따라오는 클릭(자료 열기, 토글 접기)은 막는다.
    area.addEventListener('contextmenu',e=>{if(touch||Date.now()<suppressUntil||(e.pointerType==='touch'&&e.target.closest?.(ROW)))e.preventDefault()},true);
    // ⋯ 단추는 따로 누르는 것이라 삼키지 않는다(꾹 눌러 고른 바로 뒤에도 ⋯로 메뉴).
    area.addEventListener('click',e=>{if(Date.now()<suppressUntil&&!e.target.closest?.('[data-lu-menu],[data-lu-node-menu]')){e.preventDefault();e.stopPropagation()}},true);
  }
  // F2 = 포커스가 있는 폴더 줄의 이름 바꾸기. 빈 곳 우클릭 = 그 자리를 품은 가장 가까운 토글의 ⋯ 메뉴(폴더면 폴더 메뉴, 프로젝트·'폴더 밖'이면 [새 폴더]),
  // 어느 토글도 아니면 맨 위 자리의 [새 폴더]. 카드·줄·입력칸·링크·버튼 위의 우클릭은 공용 우클릭(context-menu.js)이 그대로 맡는다.
  const WIDE=typeof matchMedia==='function'?matchMedia('(min-width:761px)'):null;
  const IGNORE='.lu-row,summary.lu-node-head,input,textarea,select,button,a[href],[contenteditable],.lu-off-hint,.lu-more-files,.lu-more-row,.lu-undo';
  function blankTrigger(target,list){
    for(let el=target.closest('.lu-node');el;el=el.parentElement?.closest('.lu-node')){const b=el.querySelector(':scope > summary [data-lu-node-menu]');if(b)return b}
    // S55-08 LIB-우클릭메뉴 ①: 폴더 보기에서 어느 토글도 아닌 빈 자리는 자료실 빈 자리 메뉴([새 폴더][자료 등록], library-upload.js)가 맡는다.
    if(s().free)return null;
    return list.querySelector('[data-lu-node-menu="p:none"]');
  }
  // LIB-폴더끌어순서(S61-14): 키보드만 쓰는 길 — 폴더 줄(한 칸 머리·왼쪽 나무·두 칸 칸)에 초점을 두고 Alt+↑·Alt+↓ = 한 칸 위·아래(보이는 단추 없음).
  // 저장·되돌리기는 끌어 놓기와 같은 placeBeside(바로 위 형제 앞 / 바로 아래 형제 뒤).
  function stepKey(e){
    if(!e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||(e.key!=='ArrowUp'&&e.key!=='ArrowDown'))return;
    const t=e.target;if(!(t instanceof Element)||t.closest('input,textarea,select,[contenteditable]'))return;
    const head=t.closest('summary.lu-node-head'),key=head?.parentElement?.dataset.luNode||'',nav=!head&&t.closest('[data-lu-nav]');
    const id=key.startsWith('f:')?key.slice(2):nav?.dataset.luNav||'',f=id&&folder(id);if(!f)return;
    e.preventDefault();e.stopPropagation();
    const sib=sibs(s().free?null:(f.project_id||null),f.parent_id||null),i=sib.findIndex(x=>x.id===id),j=e.key==='ArrowUp'?i-1:i+1;
    if(i<0||j<0||j>=sib.length||busy)return;
    const pane=nav?.closest?.('[data-lu-pane-i]')?.dataset.luPaneI,inTree=!!nav?.closest?.('#libraryFolderNav');
    void placeBeside(id,sib[j].id,j>i).then(()=>{
      const back=head?headOf('f:'+id):document.querySelector(pane!==undefined?`#documentList [data-lu-pane-i="${pane}"] [data-lu-nav="${CSS.escape(id)}"]`:inTree?`#libraryFolderNav [data-lu-nav="${CSS.escape(id)}"]`:`[data-lu-nav="${CSS.escape(id)}"]`);
      back?.focus({preventScroll:true});
    });
  }
  function bindKeys(list){
    (list.closest?.('#libraryListCard')||list).addEventListener('keydown',stepKey,true);
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
  // LIB-맨위메뉴하나(빠짐9): 자료실 칸 맨 위 ⋯의 [새 폴더]. 폴더 묶기에서만 — 들어간 폴더가 있으면 그 안, 없으면 맨 위(폴더 밖 자리).
  const createIn=(parentId,trigger)=>{const p=parentId?folder(parentId):null;if(parentId&&!p)return;if(p&&!canAddChild(s().folders,p.id)){status('여기에는 폴더를 더 만들 수 없어요.',true);return}
    askName({title:p?'안에 폴더 만들기':'폴더 만들기',hint:p?pathName(p.id)+' 안에 만들어요.':'폴더 밖(맨 위)에 만들어요. 자료실에서만 보이고 Drive 폴더는 바뀌지 않아요.',trigger,then:name=>createFolder(p?.project_id||null,p?.id||null,name)})};
  return {openAt:(trigger,x,y)=>menu.open(trigger,{at:{x,y}}),createIn,moveFolderTo:(id,parentId)=>dragMoveFolder(id,parentId||null),moveDocsTo:(ids,folderId,opt={})=>{const docs=ids.map(docById).filter(Boolean);return docs.length?moveDocs(docs,folderId||null,{open:opt.open!==false}):Promise.resolve(false)},open:t=>menu.open(t),close:()=>menu.close(),follow:find=>menu.follow(find),get menuTrigger(){return menu.active?.trigger||null},get menuClosing(){return menu.closing},moveMenuHtml,openMove,trashFolders,closeMove:()=>{if(folderSheetOpen())closeFolderSheet()},moveContains:n=>folderSheetContains(n),get moveOpen(){return folderSheetOpen()},docFolder,bindDrag,bindKeys,fileTarget,markFile,putUploaded,revealFolder:id=>{const f=folder(id);if(f)reveal(chain(f.project_id||null,id))},startRename,get busy(){return busy}};
}
