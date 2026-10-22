// LIB-토글트리 ③(docs/design/library-tree.md 6절): 자료실 전용 폴더 편집 — ⋯ 메뉴·작은 창·저장.
// 목록 그리기는 library-upload.js의 luRenderLibrary 하나다. 이 모듈은 폴더 메뉴(⋯), 이름·옮길 곳을 고르는 작은 창,
// 저장(기존 소유자 RLS REST: app_library_folders·app_library_folder_items)만 맡고, 저장 뒤 reload()로 다시 그리게 한다.
// 순환·3단·같은 프로젝트 틀은 DB 트리거가 지키고(거절 SQLSTATE 23514 + LIB_FOLDER_*), 화면은 같은 규칙으로 고를 수 있는 곳만 보인다.
// 폴더·자료 연결만 바꾼다. 자료(app_documents)·프로젝트·Drive 파일은 건드리지 않는다.
import {createAnchoredMenu} from './anchored-menu.js';
import {FOLDER_DEPTH,SORT_GAP,canAddChild,cleanFolderName,folderDeleteCounts,folderDepth,folderErrorText,folderMoveTargets,folderReorderPlan,folderSiblings,nextSortOrder} from './library-tree.js';

const T_FOLDERS='/rest/v1/app_library_folders',T_ITEMS='/rest/v1/app_library_folder_items';
const enc=encodeURIComponent;

export function mountLibraryFolders({api,esc,state,reload,status,reveal=()=>{}}){
  // state(): {workspace, folders, items, docs, projectName(id)}
  let busy=false,dialog=null;
  const s=()=>state();
  const folder=id=>s().folders.find(f=>f.id===id);
  const frameName=pid=>pid?s().projectName(pid):'프로젝트 없음';
  // 폴더 경로 이름(옮길 곳 고르기): "가 › 나 › 다".
  const pathName=id=>{const out=[];let f=folder(id),guard=0;while(f&&guard++<FOLDER_DEPTH+2){out.unshift(f.name);f=f.parent_id?folder(f.parent_id):null}return out.join(' › ')};
  // 자료의 폴더(자료의 프로젝트 틀과 맞는 연결만, 설계 3.2). 어긋난 연결은 없는 것으로 본다.
  function docFolder(doc){const it=s().items.find(x=>x.document_id===doc.id),f=it&&folder(it.folder_id);return f&&(f.project_id||null)===(doc.project_id||null)?f:null}
  const rawItem=doc=>s().items.find(x=>x.document_id===doc.id)||null;

  async function run(work,done){
    if(busy)return false;busy=true;status('');
    try{await work();await reload();if(done)status(done);return true}
    catch(e){status(folderErrorText(e),true);try{await reload()}catch{}return false}
    finally{busy=false}
  }
  const where=id=>`?id=eq.${enc(id)}&workspace_id=eq.${enc(s().workspace)}`;

  // ---- 저장 ----
  // 만든 뒤·옮긴 뒤에는 그 자리가 보이도록 위 토글을 연다(프로젝트 토글 → 상위 폴더들).
  const chain=(projectId,folderId)=>{const keys=['p:'+(projectId||'none')];let f=folderId?folder(folderId):null,guard=0;const up=[];while(f&&guard++<FOLDER_DEPTH+2){up.unshift('f:'+f.id);f=f.parent_id?folder(f.parent_id):null}return [...keys,...up]};
  const createFolder=(projectId,parentId,name)=>run(()=>api(T_FOLDERS,{method:'POST',prefer:'return=minimal',body:{workspace_id:s().workspace,project_id:projectId||null,parent_id:parentId||null,name,sort_order:nextSortOrder(folderSiblings(s().folders,{projectId,parentId}))}}),'폴더를 만들었어요.').then(ok=>{if(ok)reveal(chain(projectId,parentId));return ok});
  const renameFolder=(id,name)=>run(()=>api(T_FOLDERS+where(id),{method:'PATCH',prefer:'return=minimal',body:{name}}),'이름을 바꿨어요.');
  const reorderFolder=(id,dir)=>{const plan=folderReorderPlan(s().folders,id,dir);if(!plan.length)return Promise.resolve(false);return run(async()=>{for(const p of plan)await api(T_FOLDERS+where(p.id),{method:'PATCH',prefer:'return=minimal',body:{sort_order:p.sort_order}})})};
  const moveFolder=(id,parentId)=>{const f=folder(id),pid=f?.project_id||null;return run(()=>api(T_FOLDERS+where(id),{method:'PATCH',prefer:'return=minimal',body:{parent_id:parentId||null,sort_order:nextSortOrder(folderSiblings(s().folders,{projectId:pid,parentId}))}}),'폴더를 옮겼어요.').then(ok=>{if(ok)reveal(chain(pid,parentId));return ok})};
  // 지우기는 요청 하나에 폴더 하나(설계 3.4). 안의 폴더·자료는 DB가 한 단 위로 올린다.
  const deleteFolder=id=>run(()=>api(T_FOLDERS+where(id),{method:'DELETE',prefer:'return=minimal'}),'폴더를 지웠어요.');
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
    root.querySelector('#libraryFolderForm').addEventListener('submit',async e=>{e.preventDefault();if(!dialog.submit||dialog.save.disabled)return;dialog.save.disabled=true;dialog.save.setAttribute('aria-busy','true');try{const ok=await dialog.submit();if(ok!==false)closeDialog()}finally{dialog.save.disabled=false;dialog.save.removeAttribute('aria-busy')}});
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
  const frameFromKey=key=>key==='p:none'?null:key.slice(2);
  const menu=createAnchoredMenu({id:'luFolderMenu',className:'lu-more-panel',label:'폴더 관리',historyKey:'kptuLibraryFolderMenu',key:t=>t.dataset.luNodeMenu,
    render:key=>{
      if(!key.startsWith('f:'))return '<button type="button" data-lu-folder-action="create">폴더 만들기</button>';
      const f=folder(key.slice(2));if(!f)return '';
      const sib=folderSiblings(s().folders,{projectId:f.project_id||null,parentId:f.parent_id||null}),i=sib.findIndex(x=>x.id===f.id);
      return (canAddChild(s().folders,f.id)?'<button type="button" data-lu-folder-action="create">안에 폴더 만들기</button>':'')+'<button type="button" data-lu-folder-action="rename">이름 바꾸기</button>'
        +(i>0?'<button type="button" data-lu-folder-action="up">위로</button>':'')+(i>=0&&i<sib.length-1?'<button type="button" data-lu-folder-action="down">아래로</button>':'')
        +(folderMoveTargets(s().folders,f.id).length?'<button type="button" data-lu-folder-action="move">옮기기…</button>':'')
        +'<button type="button" class="lu-menu-danger" data-lu-folder-action="delete">폴더 지우기</button>';
    },
    onAction:(button,active)=>{const key=active.id,action=button.dataset.luFolderAction,trigger=active.trigger;if(key.startsWith('f:'))folderAction(key.slice(2),action,trigger);else if(action==='create')askName({title:'폴더 만들기',hint:frameName(frameFromKey(key))+' 안에 만들어요. 자료실에서만 보이고 Drive 폴더는 바뀌지 않아요.',trigger,then:name=>createFolder(frameFromKey(key),null,name)})}});
  function folderAction(id,action,trigger){
    const f=folder(id);if(!f)return;
    if(action==='create')askName({title:'안에 폴더 만들기',hint:pathName(id)+' 안에 만들어요.',trigger,then:name=>createFolder(f.project_id||null,id,name)});
    else if(action==='rename')askName({title:'이름 바꾸기',name:f.name,trigger,then:name=>renameFolder(id,name)});
    else if(action==='up'||action==='down')void reorderFolder(id,action).then(()=>focusHead('f:'+id));
    else if(action==='move')askTarget({title:'폴더 옮기기',hint:`${f.name}을(를) 옮길 곳을 고르세요. 같은 프로젝트 안에서만 옮길 수 있어요.`,trigger,targets:folderMoveTargets(s().folders,id).map(t=>t===null?{value:'__top__',label:frameName(f.project_id||null)+' 바로 아래',depth:0}:{value:t,label:pathName(t),depth:folderDepth(s().folders,t)}),then:parent=>moveFolder(id,parent)});
    else if(action==='delete'){
      const n=folderDeleteCounts(s().folders,s().items,id),inside=[n.folders?`폴더 ${n.folders}개`:'',n.files?`자료 ${n.files}개`:''].filter(Boolean).join('·');
      if(!confirm(`${f.name} 폴더를 지울까요?`+(inside?`\n안의 ${inside}는 한 단 위로 가요.`:'')+'\n자료와 Drive 파일은 지워지지 않아요.'))return;
      void deleteFolder(id);
    }
  }
  function focusHead(key){const b=[...document.querySelectorAll('#documentList [data-lu-node-menu]')].find(x=>x.dataset.luNodeMenu===key);b?.focus({preventScroll:true})}

  // 자료 ⋯ 메뉴에 붙일 버튼(프로젝트 묶기에서만). 같은 프로젝트 틀의 폴더가 있을 때만.
  function fileMenuHtml(doc){
    const frame=doc.project_id||null,here=docFolder(doc),inFrame=s().folders.filter(f=>(f.project_id||null)===frame&&f.id!==here?.id);
    return (inFrame.length?`<button type="button" data-lu-file-folder="${esc(doc.id)}">폴더로 옮기기…</button>`:'')+(here?`<button type="button" data-lu-file-out="${esc(doc.id)}">폴더 밖으로</button>`:'');
  }
  function fileAction(button){
    const id=button.dataset.luFileFolder||button.dataset.luFileOut,doc=s().docs.find(d=>d.id===id);if(!doc)return;
    if(button.dataset.luFileOut){void fileOut(doc);return}
    const frame=doc.project_id||null,here=docFolder(doc);
    const targets=s().folders.filter(f=>(f.project_id||null)===frame&&f.id!==here?.id).map(f=>f.id);
    // 차례: 트리 차례(맨 위 폴더 → 그 안).
    const ordered=[],add=parent=>{for(const f of folderSiblings(s().folders,{projectId:frame,parentId:parent})){if(targets.includes(f.id))ordered.push(f.id);add(f.id)}};add(null);
    askTarget({title:'폴더로 옮기기',hint:`${doc.title||doc.file_name||'자료'}을(를) 넣을 폴더를 고르세요. ${frameName(frame)} 안의 폴더만 보여요.`,trigger:document.querySelector(`[data-lu-menu="${CSS.escape(doc.id)}"]`),targets:ordered.map(t=>({value:t,label:pathName(t),depth:folderDepth(s().folders,t)})),then:fid=>fileToFolder(doc,fid)});
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
  return {open:t=>menu.open(t),close:()=>menu.close(),fileMenuHtml,fileAction,docFolder,bindDrag,get busy(){return busy}};
}
