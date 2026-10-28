import {holdToast as kptuHoldToast} from './small-notice.js'; // UI-작은알림자리: #toast도 위쪽·2초·올려 두면 멈춤(시계 하나)
import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {confirmLinks,ERROR_TEXT} from './basket-classification.js';
import {validateLinkSummary,isBlankLinkSummary,readRecordPages} from './basket-link-records.js';
import {selectBasketOrganizations} from './basket-ai-handoff.js';
import {createChoiceSheet,projectRows,projectRow,orgGroupRows,orgRow} from './choice-sheet.js';
import {readReferenceBundles} from './reference-bundles-data.js';
import {createGoogleTask} from './quick-save.js';
import {announceRecordSaved,basketDetail} from './record-saved.js';
import {dayKey} from './home-read-model.js';
import {noteTaskEntry,recordNoteTask} from './basket-note-tasks.js';
import {aiSummaryAllowed,aiSummaryMarkup,appliedText,attachmentTextState,newAiState,placeAiSummary,readDocumentBrief,requestLinkSummary} from './basket-ai-summary.js';

// BASKET-수동연결: the user picks destinations and writes each summary in the
// basket read view. Writes reuse app_basket_confirm_links (owner RLS, INVOKER).
export const MANUAL_LINK_REASON='직접 연결';
export const MANUAL_LINK_LIMIT=20;
export const TASK_LIMITS=Object.freeze({title:1024,notes:8192});
// REF-참고묶음: 'reference' = a reference bundle (app_reference_bundles, link column bundle_id). It is never report material.
const KIND_NAME={organization:'담당조직',project:'프로젝트',reference:'참고'};
const MANUAL_ERROR_TEXT=Object.freeze({
  NOTE_CHANGED:'업데이트가 그사이 바뀌었어요. 최신 업데이트를 다시 불러왔어요. 원문을 확인하고 다시 [연결]을 눌러 주세요.',
  NOTE_ARCHIVED:'보류한 업데이트는 연결할 수 없어요. 보류를 해제한 뒤 연결해 주세요.',
  AI_EXCLUDED:'AI 제외로 표시된 업데이트라 지금은 연결할 수 없어요.',
  ALREADY_CONFIRMED:'이미 연결된 곳이 있어요. 고른 곳을 확인해 주세요.',
  SUGGESTED_EXISTS:'이미 제안된 연결이 있어요. 고른 곳을 확인해 주세요.',
  INVALID_TARGETS:'연결할 곳과 요약을 다시 확인해 주세요.',
  INVALID_INPUT:'업데이트 정보가 맞지 않아요. 업데이트를 다시 불러와 주세요.',
});
export const manualErrorText=code=>MANUAL_ERROR_TEXT[code]||ERROR_TEXT[code]||'연결하지 못했어요. 다시 시도해 주세요.';
const linkKey=(kind,id)=>kind+':'+id;
// RPC payload: only the four keys the database accepts, one fixed reason.
export function manualLinkTargets(selections){
  // A blank summary leaves the key out: the database stores NULL and the note body is shown as the record.
  return selections.map(s=>({kind:s.kind,target_id:s.id,reason:MANUAL_LINK_REASON,...(isBlankLinkSummary(s.summary)?{}:{summary:s.summary})}));
}
// Returns the first selection whose summary the database would refuse, with a plain message.
export function invalidManualSelection(selections){
  if(!selections.length)return {index:-1,message:'연결할 담당조직이나 프로젝트를 골라 주세요.'};
  if(selections.length>MANUAL_LINK_LIMIT)return {index:-1,message:`한 번에 ${MANUAL_LINK_LIMIT}곳까지 연결할 수 있어요.`};
  for(let i=0;i<selections.length;i++){
    if(isBlankLinkSummary(selections[i].summary))continue;
    try{validateLinkSummary(selections[i].summary);}catch(error){return {index:i,message:`${selections[i].name}: ${error.message}`};}
  }
  return null;
}
// Confirmed or suggested links of this note, by destination. The RPC refuses both.
export function linkedDestinations(noteId,links){
  const out=new Map();
  for(const l of links||[]){
    if(l.note_id!==noteId||!['confirmed','suggested'].includes(l.status))continue;
    if(l.organization_id)out.set(linkKey('organization',l.organization_id),l.status);
    if(l.project_id)out.set(linkKey('project',l.project_id),l.status);
    if(l.bundle_id)out.set(linkKey('reference',l.bundle_id),l.status);
  }
  return out;
}
export function firstLine(text){
  const line=String(text||'').split(/\r?\n/).map(value=>value.trim()).find(Boolean)||'';
  return [...line].slice(0,TASK_LIMITS.title).join('');
}
export function validateTaskInput({title,notes}){
  if(!String(title||'').trim())return '할 일 제목을 입력해 주세요.';
  if([...String(title)].length>TASK_LIMITS.title)return '할 일 제목은 1,024자까지 쓸 수 있어요.';
  if([...String(notes||'')].length>TASK_LIMITS.notes)return '할 일 메모는 8,192자까지 넣을 수 있어요. 줄여 주세요.';
  return '';
}
const taskBodyMatches=(task,body)=>task?.title===body.title&&(task.notes||'')===(body.notes||'')&&(task.due?String(task.due).slice(0,10):null)===(body.due||null);
const taskIdentity=task=>!!task&&typeof task.id==='string'&&!!task.id&&typeof task.taskListId==='string'&&!!task.taskListId;

// Same choice rules as the AI guidance and the home quick input:
// my active assigned organizations (all active when none are assigned), active projects.
export async function readManualChoices(rt=window.KPTURuntime){
  const c=rt.context.read(),workspaceId=c?.workspace?.id,userId=c?.user?.id;
  if(!workspaceId||!userId)throw Error('업무 공간을 확인할 수 없어요.');
  await Promise.all([import('./project-catalog.js'),import('./organization-order.js')]);
  const [catalog,rows,assignees,bundles]=await Promise.all([
    window.KPTUProjectCatalog.load({workspaceId,userId,force:true}),
    readRecordPages(`/rest/v1/app_suborganizations?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,name,active&order=id.asc`,rt),
    readRecordPages(`/rest/v1/app_suborganization_assignees?user_id=eq.${encodeURIComponent(userId)}&select=organization_id&order=organization_id.asc`,rt).catch(()=>[]),
    // REF-참고묶음: the reference bundles (owner RLS). A failed read leaves [참고 ▾] with nothing to choose; the rest still works.
    readReferenceBundles(rt).catch(()=>[]),
  ]);
  const after=rt.context.read();
  if(catalog.workspaceId!==workspaceId||catalog.userId!==userId||after?.workspace?.id!==workspaceId||after?.user?.id!==userId)throw Error('업무 공간이 바뀌었어요. 다시 눌러 주세요.');
  const order=window.KPTUOrganizationOrder,organizations=order.forPicker(selectBasketOrganizations(rows,assignees).organizations);
  return {owner:`${userId}:${workspaceId}`,organizations,organizationNames:new Map(rows.map(row=>[row.id,row.name])),groups:order.groups(organizations),projects:window.KPTUProjectCatalog.tree(catalog.projects).filter(x=>x.project.status==='active'),bundles};
}

// One link panel and one task form inside the basket read view. basket.js keeps
// owning the detail; this controller owns only what is drawn into its host.
// sheetId: each mounted panel needs its own choice sheet (the basket memo side and the note side, MEMO-노트).
// UI-바구니첨부메모 ⑦⑧⑨: files (optional) = {read:()=>({files,docs}), put:({projectId,organizationId,projectName,organizationName},isCurrent)=>result}.
// 글 없이 첨부만 있는 메모는 프로젝트·담당조직을 고르면 요약 없이 [자료로 넣기](진행상황·기록에 안 남음), 원할 때만 [기록도 남기기].
// 글이 있는 메모는 기록이 되고(요약은 선택, 비우면 본문 표시), 첨부가 있으면 파일은 첫 번째로 고른 프로젝트·첫 번째로 고른 담당조직 자료에도 들어간다.
export function mountManualLink({esc,rt=window.KPTURuntime,getNote,getLinks,isBusy,setBusy,onLinked,onNoteChanged,onModeChange,onTaskRecorded,files:fileDocs=null,sheetId='basketLinkChoice'}){
  const scope=()=>{const c=rt.context.read();return `${c?.user?.id||''}:${c?.workspace?.id||''}`;};
  let host=null,mode=null,noteId=null,choices=null,choicesFlight=null,seq=0;
  let link={targets:[],status:''},task=null;
  // One AI answer per update and place for [요약해서 기록으로]: pressing again reuses it instead of asking AI again.
  const filesCache=new Map();
  const note=()=>{const n=getNote();return n&&n.id===noteId?n:null;};
  const linked=()=>linkedDestinations(noteId,getLinks());
  const fileState=()=>{const value=fileDocs?.read?.();return {files:Array.isArray(value?.files)?value.files:[],docs:value?.docs instanceof Map?value.docs:new Map()};};
  const filesOnly=n=>!!n&&!String(n.raw_text||'').trim()&&fileState().files.length>0;
  // The first chosen project and the first chosen organization take the files (a document belongs to one project and one organization).
  const fileTargets=()=>{const has=fileState().files.length>0;return {project:has?link.targets.find(t=>t.kind==='project')||null:null,organization:has?link.targets.find(t=>t.kind==='organization')||null:null};};
  const projectName=id=>choices?.projects.find(x=>x.project.id===id)?.project.name||window.KPTUProjectCatalog?.describe?.(id)?.name||'다른 프로젝트';
  const organizationName=id=>choices?.organizationNames?.get(id)||choices?.organizations.find(o=>o.id===id)?.name||'다른 조직';
  const bundleName=id=>choices?.bundles?.find(b=>b.id===id)?.name||'참고 묶음';
  const placeName={project:projectName,organization:organizationName,reference:bundleName};
  async function loadChoices(){
    if(choices&&choices.owner===scope())return choices;
    if(choicesFlight)return choicesFlight;
    const owner=scope();
    choicesFlight=readManualChoices(rt).then(value=>{if(owner===scope())choices=value;return value;}).finally(()=>{choicesFlight=null;});
    return choicesFlight;
  }
  const sheet=createChoiceSheet({id:sheetId+'Sheet',titleId:sheetId+'Title',historyKey:'kptu'+sheetId[0].toUpperCase()+sheetId.slice(1),
    canOpen:()=>!!mode&&!!note()&&!isBusy()&&window.KPTURouter.current==='basket',
    choices:loadChoices,
    render:kind=>{
      if(kind==='task-project')return {title:'프로젝트 선택',search:'프로젝트 이름 검색',html:projectRows(choices.projects,task?.project||'',esc)};
      const done=linked(),picked=new Set(link.targets.map(t=>linkKey(t.kind,t.id)));
      // Already linked places stay visible as text and cannot be chosen again.
      const doneItem=(state,name,cls,extra='')=>`<span class="${cls} basket-choice-done" data-sheet-item ${extra}>${esc(name)} · ${state==='suggested'?'이미 제안됨':'이미 연결됨'}</span>`;
      // UPD-여러곳고르기 ①: organizations are rows with a check box under their group heading, as in the 기록할 곳 sheet.
      const chip=o=>{const name=o.name||'이름 없는 조직',state=done.get(linkKey('organization',o.id));return state?doneItem(state,name,'home-choice-row','style="--home-choice-depth:0"'):orgRow(o,picked.has(linkKey('organization',o.id)),esc);};
      const row=x=>{const state=done.get(linkKey('project',x.project.id));if(!state){const pressed=picked.has(linkKey('project',x.project.id));return projectRow(x,pressed?x.project.id:null,esc);}return doneItem(state,x.project.name||'이름 없는 프로젝트','home-choice-row',`style="--home-choice-depth:${x.depth}" title="${esc(x.project.name||'')}"`);};
      if(kind==='organization')return {title:'담당조직 선택',search:'조직 이름 검색',html:choices.groups.some(g=>g.length)?orgGroupRows(choices.groups,chip):'<p class="home-choice-label">고를 수 있는 담당조직이 없어요.</p>'};
      // REF-참고묶음 (질문 3: an update may be in an organization and a bundle at once): bundles are rows with a check box, like organizations.
      const ref=b=>{const name=b.name||'이름 없는 묶음',state=done.get(linkKey('reference',b.id));return state?doneItem(state,name,'home-choice-row','style="--home-choice-depth:0"'):orgRow(b,picked.has(linkKey('reference',b.id)),esc);};
      if(kind==='reference')return {title:'참고 묶음 선택',search:'묶음 이름 검색',html:choices.bundles?.length?choices.bundles.map(ref).join(''):'<p class="home-choice-label">고를 수 있는 참고 묶음이 없어요.</p>'};
      return {title:'프로젝트 선택',search:'프로젝트 이름 검색',html:choices.projects.length?choices.projects.map(row).join(''):'<p class="home-choice-label">고를 수 있는 프로젝트가 없어요.</p>'};
    },
    onSelect:(kind,value)=>{
      if(kind==='task-project'){if(task)task.project=value;paint();return;}
      if(linked().has(linkKey(kind,value)))return;
      const existing=link.targets.find(t=>t.kind===kind&&t.id===value);
      if(!existing){
        if(link.targets.length>=MANUAL_LINK_LIMIT){link.status=`한 번에 ${MANUAL_LINK_LIMIT}곳까지 연결할 수 있어요.`;paint();return;}
        const name=kind==='organization'?choices.organizations.find(o=>o.id===value)?.name:kind==='reference'?choices.bundles?.find(b=>b.id===value)?.name:choices.projects.find(x=>x.project.id===value)?.project.name;
        // A reference link is the whole point of picking a bundle, so it is always made (no [기록도 남기기] choice for it).
        link.targets.push({kind,id:value,name:name||'이름 없는 곳',summary:'',record:kind==='reference'||!filesOnly(note()),ai:newAiState(),files:newAiState()});link.status='';
      }
      paint();
      // The sheet returns focus to its trigger once its history entry is gone; the new summary is
      // the next thing to write, so focus it after that close settles (sheet.close() returns it).
      queueMicrotask(()=>void sheet.close().then(()=>host?.querySelector(`[data-manual-summary="${CSS.escape(linkKey(kind,value))}"]`)?.focus()));
    },
    onError:error=>{const message=error?.message||'고를 목록을 불러오지 못했어요. 다시 눌러 주세요.';if(mode==='link')link.status=message;else if(task)task.status=message;paint();}
  });
  function targetFiles(t){
    const {files,docs}=fileState();if(!files.length||t.kind==='reference')return '';
    const into=fileTargets()[t.kind];
    if(into?.id!==t.id)return `<p class="basket-manual-file-note">파일은 ${esc(into?.name||'')} 한 곳에만 들어가요.</p>`;
    const column=t.kind+'_id';
    const from=[...new Set(files.map(f=>docs.get(f.drive_file_id)?.[column]).filter(id=>id&&id!==t.id))].map(placeName[t.kind]);
    return `<p class="basket-manual-file-note" data-manual-file-note>파일 ${files.length}개를 이 ${KIND_NAME[t.kind]} 자료로 넣어요.${from.length?` ${esc(from.join(', '))}에서 옮겨요.`:''}</p>`;
  }
  // UPD-사진요약기록: [요약해서 기록으로] — the text the server already read from this update's photos and files (사진 글자·한글·PDF),
  // summarized once for this place and put in the record box. Only for 담당조직·프로젝트. No text → no button (the title shows the file);
  // a photo still being read → '글자 읽는 중'. Works together with [자료로 넣기]: pressing it turns 기록 on for that place.
  function filesMarkup(n,t,key){
    if(t.kind==='reference')return '';
    const state=attachmentTextState(n);if(state==='none')return '';
    return aiSummaryMarkup(t.files,key,'data-manual',esc,{label:'요약해서 기록으로',slot:'files',aria:'사진·파일 글자를 요약해서 기록으로',waiting:state==='pending'?'글자 읽는 중':''});
  }
  async function runFilesAi(key){
    const n=note(),t=link.targets.find(x=>linkKey(x.kind,x.id)===key);
    if(mode!=='link'||!n||!t||t.kind==='reference'||t.files.busy||attachmentTextState(n)!=='ready')return;
    if(!t.record){t.record=true;}
    const cacheKey=n.id+'|'+key;
    let reused=filesCache.get(cacheKey),result;
    // UPD-요약부품통일 ③: one file that is already a library document with its upload summary ('b1:', PR 1108·1116) uses that summary
    // as it is — no AI call. Several files are joined by AI into one summary.
    if(!reused){const files=fileState().files;if(files.length===1){const doc=fileState().docs.get(files[0].drive_file_id);if(doc?.id){reused=await readDocumentBrief(doc.id,{rt});if(reused)filesCache.set(cacheKey,reused);}}}
    if(mode!=='link'||note()?.id!==n.id||!link.targets.includes(t))return;
    if(reused)result={ok:true,summary:reused};
    else{
      const run=++t.files.run,owner=scope(),id=n.id;
      Object.assign(t.files,{busy:true,status:'',retry:false,proposal:''});paint();
      result=await requestLinkSummary({noteId:id,use:'files',targetKind:t.kind,targetId:t.id},{rt});
      if(t.files.run!==run||mode!=='link'||noteId!==id||owner!==scope()||!link.targets.includes(t))return;
      t.files.busy=false;
      if(result.ok)filesCache.set(cacheKey,result.summary);
    }
    const hadFocus=!document.activeElement||document.activeElement===document.body||host?.contains(document.activeElement);
    if(!result.ok){t.files.status=result.message;t.files.retry=result.retry;paint();if(hadFocus)host?.querySelector(`[data-manual-files-run="${CSS.escape(key)}"]`)?.focus();return;}
    const save=confirmLabel(n);
    const placed=placeAiSummary(t.summary,result.summary,save);
    if(placed.fill!==null)t.summary=placed.fill;
    t.files.proposal=placed.proposal;t.files.status=placed.status;paint();
    if(hadFocus)host?.querySelector(placed.fill!==null?`[data-manual-summary="${CSS.escape(key)}"]`:`[data-manual-files-apply="${CSS.escape(key)}"]`)?.focus();
  }
  function applyFilesAi(key,use){
    const t=link.targets.find(x=>linkKey(x.kind,x.id)===key);if(!t||!t.files.proposal)return;
    if(use){t.summary=t.files.proposal;t.files.status=appliedText(confirmLabel(note()));}else t.files.status='';
    t.files.proposal='';paint();
    host?.querySelector(use?`[data-manual-summary="${CSS.escape(key)}"]`:`[data-manual-files-run="${CSS.escape(key)}"]`)?.focus();
  }
  function confirmLabel(n){return filesOnly(n)&&link.targets.every(t=>!t.record)?'자료로 넣기':'연결';}
  function linkMarkup(n){
    const done=[...linked().keys()].length,only=filesOnly(n);
    return `<section class="basket-manual" data-manual-link data-enter-save aria-labelledby="basketManualLinkTitle"><h3 id="basketManualLinkTitle">${only?'조직·프로젝트 자료로 넣기':'조직·프로젝트에 연결'}</h3>
${only?'':`<details data-manual-original><summary>원문 전체 보기</summary><div class="basket-classification-original">${esc(n.raw_text||'')}</div></details>`}
<div class="basket-actions"><button type="button" data-manual-pick="organization" aria-haspopup="dialog" aria-expanded="false">담당조직 고르기 ▾</button><button type="button" data-manual-pick="project" aria-haspopup="dialog" aria-expanded="false">프로젝트 고르기 ▾</button><button type="button" data-manual-pick="reference" aria-haspopup="dialog" aria-expanded="false">참고 ▾</button></div>
${done?`<p class="basket-manual-hint">이미 연결된 곳 ${done}곳은 고를 수 없어요.</p>`:''}
<p class="basket-manual-hint">${only?'담당조직이나 프로젝트를 고르면 파일을 그 자료로 넣어요. 진행상황과 기록에는 남지 않아요.':'고른 곳마다 요약을 직접 쓸 수 있어요(선택). 비워 두면 업데이트 본문이 기록에 보여요.'}</p>
<div data-manual-targets>${link.targets.map(t=>{const key=linkKey(t.kind,t.id);return `<div class="basket-manual-target" data-manual-target="${esc(key)}"><div class="basket-manual-target-head"><b>${esc(KIND_NAME[t.kind]+' · '+t.name)}</b><button type="button" data-manual-remove="${esc(key)}" aria-label="${esc(t.name)} 빼기">빼기</button></div>${targetFiles(t)}${only&&t.kind!=='reference'?`<button type="button" class="basket-manual-record-toggle" data-manual-record="${esc(key)}" aria-pressed="${t.record}">기록도 남기기</button>`:''}${t.record?`<label class="basket-text-label basket-manual-summary">${t.kind==='reference'?'요약 (선택 · 비우면 업데이트 본문이 보여요)':'기록 요약 (선택 · 비우면 업데이트 본문이 기록에 보여요)'}<textarea data-manual-summary="${esc(key)}" rows="3" maxlength="2000" spellcheck="false" placeholder="일시·장소·누가·숫자를 빠짐없이">${esc(t.summary)}</textarea></label>${aiSummaryAllowed(n)?aiSummaryMarkup(t.ai,key,'data-manual',esc):''}`:''}${filesMarkup(n,t,key)}</div>`;}).join('')}</div>
<p data-manual-status role="status">${esc(link.status)}</p>
<div class="basket-actions save-row"><button type="button" data-manual-cancel>취소</button><button type="button" class="quick-pill-primary" data-manual-confirm data-enter-save-submit>${confirmLabel(n)}</button></div></section>`;
  }
  const taskProjectName=()=>task?.project?choices?.projects.find(x=>x.project.id===task.project)?.project.name||'프로젝트':'프로젝트';
  function paintTaskProject(){
    const button=host?.querySelector('[data-manual-task-project]');if(!button)return;
    const project=taskProjectName();button.textContent=project+' ▾';button.setAttribute('aria-label',task.project?'프로젝트: '+project:'프로젝트');
  }
  function taskMarkup(){
    const project=taskProjectName();
    const dateLabel=task.dateKind==='date'&&task.due?`${Number(task.due.slice(5,7))}.${Number(task.due.slice(8,10))}`:'날짜';
    return `<section class="basket-manual" data-manual-task data-enter-save aria-labelledby="basketManualTaskTitle"><h3 id="basketManualTaskTitle">Google 할 일 만들기</h3>
<label class="basket-text-label">할 일 제목<input type="text" data-manual-task-title maxlength="${TASK_LIMITS.title}" value="${esc(task.title)}"></label>
<label class="basket-text-label">할 일 메모<textarea data-manual-task-notes rows="6" spellcheck="false">${esc(task.notes)}</textarea></label>
<div class="basket-actions basket-manual-task-options"><button type="button" data-manual-task-project aria-haspopup="dialog" aria-expanded="false" aria-label="${task.project?esc('프로젝트: '+project):'프로젝트'}">${esc(project)} ▾</button><button type="button" data-manual-task-day="today" aria-pressed="${task.dateKind==='today'}">오늘</button><button type="button" data-manual-task-day="tomorrow" aria-pressed="${task.dateKind==='tomorrow'}">내일</button><button type="button" data-manual-task-day="date" aria-pressed="${task.dateKind==='date'}">${esc(dateLabel)}</button><input type="date" class="basket-manual-date" data-manual-task-date aria-label="기한 날짜" tabindex="-1" value="${esc(task.dateKind==='date'?task.due:'')}"></div>
<p class="basket-manual-hint">만든 할 일은 이 업데이트의 ‘이 업데이트로 만든 할 일’에 기록돼요.</p>
<p data-manual-task-status role="status">${esc(task.status)}</p><div data-manual-task-recover></div>
<div class="basket-actions save-row"><button type="button" data-manual-task-cancel>취소</button><button type="button" class="quick-pill-primary" data-manual-task-save data-enter-save-submit>할 일 만들기</button></div></section>`;
  }
  function paint(){
    if(!host)return;
    const n=note();
    if(!mode||!n){host.replaceChildren();host.hidden=true;onModeChange?.();return;}
    // Keep native disclosure state and the caret across repaints.
    const open=host.querySelector('[data-manual-original]')?.open,focused=document.activeElement&&host.contains(document.activeElement)?document.activeElement:null;
    const focusKey=focused&&[...focused.attributes].find(a=>a.name.startsWith('data-manual'))?.name,focusValue=focusKey?focused.getAttribute(focusKey):null,caret=focused&&'selectionStart' in focused?[focused.selectionStart,focused.selectionEnd]:null;
    host.hidden=false;host.innerHTML=mode==='link'?linkMarkup(n):taskMarkup();
    if(open)host.querySelector('[data-manual-original]').open=true;
    if(mode==='task'&&task.recover)paintRecover();
    controls();
    if(focusKey){const next=host.querySelector(`[${focusKey}${focusValue?`="${CSS.escape(focusValue)}"`:''}]`);if(next&&!next.disabled){next.focus({preventScroll:true});if(caret&&'setSelectionRange' in next)try{next.setSelectionRange(...caret);}catch{}}}
    onModeChange?.();
  }
  function controls(){
    if(!host)return;const busy=isBusy();
    host.querySelectorAll('button,input,textarea').forEach(el=>{el.disabled=busy;});
    const save=host.querySelector('[data-manual-task-save]');
    if(save&&task?.unknown)save.disabled=true;
    // A summary being made keeps only its own [AI 요약] locked; the rest of the panel stays usable.
    host.querySelectorAll('[data-manual-ai-run]').forEach(el=>{if(link.targets.find(t=>linkKey(t.kind,t.id)===el.dataset.manualAiRun)?.ai.busy)el.disabled=true;});
    host.querySelectorAll('[data-manual-files-run]').forEach(el=>{if(link.targets.find(t=>linkKey(t.kind,t.id)===el.dataset.manualFilesRun)?.files.busy)el.disabled=true;});
  }
  // AI-서버연동 S4: ask ai-assist for one summary. It only fills the box (or offers a proposal); [연결] still saves.
  async function runAi(key){
    const n=note(),t=link.targets.find(x=>linkKey(x.kind,x.id)===key);
    if(mode!=='link'||!n||!t||!t.record||t.ai.busy||!aiSummaryAllowed(n))return;
    const run=++t.ai.run,owner=scope(),id=n.id;
    Object.assign(t.ai,{busy:true,status:'',retry:false,proposal:''});paint();
    const result=await requestLinkSummary({noteId:id,targetKind:t.kind,targetId:t.id},{rt});
    // A result for a removed pick, another note, a closed panel or another account is dropped.
    if(t.ai.run!==run||mode!=='link'||noteId!==id||owner!==scope()||!link.targets.includes(t))return;
    t.ai.busy=false;
    const hadFocus=!document.activeElement||document.activeElement===document.body||host?.contains(document.activeElement);
    if(!result.ok){t.ai.status=result.message;t.ai.retry=result.retry;paint();if(hadFocus)host?.querySelector(`[data-manual-ai-run="${CSS.escape(key)}"]`)?.focus();return;}
    const placed=placeAiSummary(t.summary,result.summary,'연결');
    if(placed.fill!==null)t.summary=placed.fill;
    t.ai.proposal=placed.proposal;t.ai.status=placed.status;paint();
    if(hadFocus)host?.querySelector(placed.fill!==null?`[data-manual-summary="${CSS.escape(key)}"]`:`[data-manual-ai-apply="${CSS.escape(key)}"]`)?.focus();
  }
  function applyAi(key,use){
    const t=link.targets.find(x=>linkKey(x.kind,x.id)===key);if(!t||!t.ai.proposal)return;
    if(use){t.summary=t.ai.proposal;t.ai.status=appliedText('연결');}else t.ai.status='';
    t.ai.proposal='';paint();
    host?.querySelector(use?`[data-manual-summary="${CSS.escape(key)}"]`:`[data-manual-ai-run="${CSS.escape(key)}"]`)?.focus();
  }
  function open(next){
    const n=getNote();if(!n||isBusy())return;
    if(mode&&mode!==next&&hasDraft()&&!window.confirm(mode==='link'?'고른 곳과 쓰던 요약을 버릴까요?':'쓰던 할 일 입력을 버릴까요?'))return;
    if(mode!==next||noteId!==n.id){reset();noteId=n.id;mode=next;}
    if(next==='link'&&(n.archived_at||n.ai_export_allowed!==true)){mode=null;onModeChange?.();return manualErrorText(n.archived_at?'NOTE_ARCHIVED':'AI_EXCLUDED');}
    if(next==='task'&&!task){const title=firstLine(n.raw_text);task={title,notes:n.raw_text||'',initial:{title,notes:n.raw_text||''},due:'',dateKind:'',project:'',status:'',unknown:null,recover:null};}
    paint();
    host?.querySelector(next==='link'?'[data-manual-pick="organization"]':'[data-manual-task-title]')?.focus();
    // Only the project label depends on the loaded list; never rebuild the form under the user's finger.
    if(next==='task')void loadChoices().then(()=>{if(mode==='task')paintTaskProject();}).catch(()=>{});
    return '';
  }
  function reset(){++seq;mode=null;noteId=null;link={targets:[],status:''};task=null;sheet.dismiss();}
  function hasDraft(){
    if(mode==='link')return link.targets.length>0;
    if(mode==='task'&&task)return !!task.unknown||task.title!==task.initial.title||task.notes!==task.initial.notes||!!task.due||!!task.project;
    return false;
  }
  function cancel({force=false}={}){
    if(!mode||isBusy())return false;
    if(!force&&hasDraft()&&!window.confirm(mode==='link'?'고른 곳과 쓰던 요약을 버리고 닫을까요?':'쓰던 할 일 입력을 버리고 닫을까요?'))return false;
    const was=mode;reset();paint();
    host?.ownerDocument.querySelector(was==='link'?'[data-basket-link-open]':'[data-basket-task-open]')?.focus();
    return true;
  }
  async function confirm(){
    const n=note();if(mode!=='link'||!n||isBusy())return;
    const done=linked();link.targets=link.targets.filter(t=>!done.has(linkKey(t.kind,t.id)));
    const records=link.targets.filter(t=>t.record),into=fileTargets(),filing=into.project||into.organization;
    const invalid=!link.targets.length||link.targets.length>MANUAL_LINK_LIMIT?invalidManualSelection(link.targets):records.length?invalidManualSelection(records):null;
    if(invalid){link.status=invalid.message;paint();if(invalid.index>=0)host.querySelector(`[data-manual-summary="${CSS.escape(linkKey(records[invalid.index].kind,records[invalid.index].id))}"]`)?.focus();return;}
    const run=++seq,owner=scope(),id=n.id;
    const current=()=>run===seq&&owner===scope()&&note()?.id===id&&window.KPTURouter.current==='basket';
    let linkedResult={created:0,existing:0,warning:''};
    if(records.length){linkedResult=await linkRecords(n,records,current,owner,{keepBusy:!!filing});if(!linkedResult)return;}
    let filed=null;
    if(filing){
      setBusy(true);link.status='자료로 넣는 중…';paint();
      try{filed=await fileDocs.put({projectId:into.project?.id||null,organizationId:into.organization?.id||null,projectName:into.project?.name||'',organizationName:into.organization?.name||''},current);}catch{filed={ok:false,kind:'unknown',message:'자료로 넣었는지 확인하지 못했어요. 자료실에서 먼저 확인해 주세요.'};}
      setBusy(false);
      if(!current())return;
      // Nothing linked and the files did not go in: keep the panel so the person can try again (sending is idempotent).
      if(!filed.ok&&!records.length){link.status=filed.message;paint();return;}
    }
    finish(linkedResult.created,linkedResult.existing,linkedResult.warning,{records:records.length,into:filing?into:null,filed});
  }
  // The record path (app_basket_confirm_links). Returns the counts, or null when it already painted why it stopped.
  async function linkRecords(n,records,current,owner,{keepBusy=false}={}){
    const targets=manualLinkTargets(records),id=n.id;
    const changed=()=>window.dispatchEvent(new Event('kptu:basket-links-changed'));
    setBusy(true);link.status='연결하는 중…';paint();
    let result=null;
    try{result=await confirmLinks(id,n.updated_at,targets,rt);}catch{result=null;}
    if(!keepBusy||!result?.ok)setBusy(false);
    if(!current()){setBusy(false);if(owner===scope()&&result?.ok!==false)changed();return null;}
    if(!result||typeof result.ok!=='boolean'){
      // Unknown outcome: the RPC is all-or-nothing, so one fresh read tells which.
      changed();link.status='연결 결과를 확인하는 중…';paint();
      const fresh=await onLinked(id,[]).catch(()=>({ok:false}));if(!current())return null;
      const now=linkedDestinations(id,getLinks());
      if(fresh.ok&&targets.every(t=>now.get(linkKey(t.kind,t.target_id))==='confirmed'))return {created:targets.length,existing:0,warning:''};
      link.status=!fresh.ok?'연결 결과를 확인하지 못했어요. [업데이트 다시 불러오기]로 실제 연결을 확인해 주세요.':'연결되지 않았어요. 다시 [연결]을 눌러 주세요.';paint();return null;
    }
    if(!result.ok){
      if(result.error==='NOTE_CHANGED'){link.status=manualErrorText('NOTE_CHANGED');await onNoteChanged();if(note()?.id===id&&mode==='link'){link.status=manualErrorText('NOTE_CHANGED');paint();}return null;}
      link.status=manualErrorText(result.error);paint();return null;
    }
    changed();
    if(result.created>0)announceRecordSaved(basketDetail(n,records)); // MTG-기록겹침거르기: 새로 연결했을 때만
    const fresh=await onLinked(id,targets.map(t=>({kind:t.kind,target_id:t.target_id,name:records.find(s=>s.kind===t.kind&&s.id===t.target_id)?.name}))).catch(()=>({ok:false}));
    if(!current()){setBusy(false);return null;}
    return {created:result.created||0,existing:result.existing||0,warning:fresh.ok?'':'목록 새로고침은 다시 시도해 주세요.'};
  }
  function finish(created,existing,warning='',{records=1,into=null,filed=null}={}){
    reset();paint();
    const names=into?[into.project?.name,into.organization?.name].filter(Boolean).join('·'):'';
    const files=!into?'':filed?.ok?`파일 ${filed.placed}개를 ${names} 자료로 넣었어요.`:filed?.message||'';
    const message=[records?`${created}곳에 연결했어요.`:'',existing?`${existing}곳은 이미 연결돼 있어 요약을 바꾸지 않았어요.`:'',files,warning].filter(Boolean).join(' ');
    host?.ownerDocument.querySelector('[data-basket-status]')?.replaceChildren(message);
    host?.ownerDocument.querySelector('[data-basket-link-open]')?.focus();
  }
  function paintRecover(){
    const box=host?.querySelector('[data-manual-task-recover]');if(!box||!task?.recover)return;
    box.replaceChildren();
    for(const action of task.recover){const b=document.createElement('button');b.type='button';b.textContent=action.label;b.dataset.manualTaskRecover=action.key;box.append(b);}
  }
  function showToast(message){const toast=document.querySelector('#toast');if(!toast)return;toast.textContent=message;kptuHoldToast(toast);}
  async function saveTask(){
    const n=note();if(mode!=='task'||!task||!n||isBusy())return;
    if(task.unknown){task.status='앞선 결과를 먼저 확인해 주세요. 새 할 일은 만들지 않았어요.';paint();return;}
    const problem=validateTaskInput(task);if(problem){task.status=problem;paint();host.querySelector(problem.includes('메모')?'[data-manual-task-notes]':'[data-manual-task-title]')?.focus();return;}
    const body=Object.freeze({title:task.title.trim(),notes:task.notes,due:task.due||null,links:task.project?[{project_id:task.project}]:[]});
    const run=++seq,owner=scope(),epoch=rt.session.epoch(),id=n.id,current=()=>run===seq&&owner===scope()&&rt.session.epoch()===epoch&&note()?.id===id&&mode==='task';
    setBusy(true);task.status='만드는 중…';paint();
    let result=null,error=null;
    try{result=await createGoogleTask({...body,expectedSessionEpoch:epoch},rt);}catch(e){error=e;}
    if(!current()){setBusy(false);return;}
    if(!error&&result?.ok===true&&taskIdentity(result.task)&&taskBodyMatches(result.task,body)){
      const linkMissing=body.links.length&&(result.link_error||!(result.links||[]).some(l=>l.project_id===task.project&&l.status==='confirmed'));
      // BASKET-할일출처: the task exists now, so a failed record is only reported, never retried by making another task.
      task.status='할 일을 만들었어요. 업데이트에 기록하는 중…';paint();
      let recorded=null;
      try{recorded=await recordNoteTask(id,noteTaskEntry(result.task),{rt,expectedSessionEpoch:epoch});}catch{recorded=null;}
      setBusy(false);
      // A result that lands after an account switch or a different note is never shown or applied.
      if(!current())return;
      if(recorded?.ok)onTaskRecorded?.(recorded.note);
      reset();paint();
      const message=[recorded?.ok?'Google 할 일을 만들었어요. 이 업데이트에 기록했어요.':'할 일은 만들었지만 업데이트에 기록하지 못했어요.',linkMissing?'프로젝트 연결은 할 일 화면에서 확인해 주세요.':''].filter(Boolean).join(' ');
      document.querySelector('[data-basket-status]')?.replaceChildren(message);showToast('Google 할 일을 만들었어요.');
      window.KPTUGoogleTasks?.invalidateAfterCreate?.();window.dispatchEvent(new CustomEvent('kptu:google-tasks-changed'));
      document.querySelector('[data-basket-task-open]')?.focus();return;
    }
    setBusy(false);
    // Like the home quick input: an unclear result never retries by itself.
    task.unknown=body;task.status='할 일을 만들었는지 확인하지 못했어요. 겹치지 않게 다시 만들지 않아요. 할 일 목록에서 확인해 주세요.';
    task.recover=[{key:'check',label:'할 일 목록에서 확인'}];paint();
  }
  async function recoverTask(){
    if(mode!=='task'||!task?.unknown||isBusy())return;
    const body=task.unknown,run=++seq,owner=scope(),epoch=rt.session.epoch(),current=()=>run===seq&&owner===scope()&&rt.session.epoch()===epoch&&mode==='task';
    setBusy(true);task.status='할 일 목록을 확인하는 중…';task.recover=null;paint();
    try{
      const data=await rt.api('/functions/v1/google-tasks?action=tasks&pending_scope=all',{singleFlight:false,expectedSessionEpoch:epoch});
      if(!current())return;
      if(!Array.isArray(data?.tasks)||data.needs_reconnect||data.error)throw Error(data?.warning||data?.error||'Google 할 일 목록을 확인하지 못했어요.');
      const same=data.tasks.filter(t=>taskIdentity(t)&&taskBodyMatches(t,body));
      if(same.length){task.status=`같은 제목·메모·기한의 할 일이 목록에 ${same.length}개 있어요. 만들어진 것으로 보고 다시 만들지 않아요.`;task.recover=[{key:'close',label:'닫기'}];}
      else{task.unknown=null;task.status='목록에서 찾지 못했어요. 입력을 확인한 뒤 다시 [할 일 만들기]를 눌러 주세요.';}
    }catch(e){if(!current())return;task.status='할 일 목록을 확인하지 못했어요. '+(e?.message||'');task.recover=[{key:'check',label:'할 일 목록에서 확인'}];}
    finally{if(run===seq){setBusy(false);paint();}}
  }
  function attach(next){
    host=next;
    host.addEventListener('click',event=>{
      const b=event.target.closest('button');if(!b||b.disabled||isBusy())return;
      if(b.dataset.manualPick)void sheet.open(b.dataset.manualPick,b);
      else if(b.dataset.manualRemove){link.targets=link.targets.filter(t=>linkKey(t.kind,t.id)!==b.dataset.manualRemove);link.status='';paint();host.querySelector('[data-manual-pick="organization"]')?.focus();}
      else if(b.dataset.manualRecord){const t=link.targets.find(x=>linkKey(x.kind,x.id)===b.dataset.manualRecord);if(t){t.record=!t.record;paint();if(t.record)host.querySelector(`[data-manual-summary="${CSS.escape(b.dataset.manualRecord)}"]`)?.focus();}}
      else if(b.dataset.manualAiRun)void runAi(b.dataset.manualAiRun);
      else if(b.dataset.manualAiApply)applyAi(b.dataset.manualAiApply,true);
      else if(b.dataset.manualAiDismiss)applyAi(b.dataset.manualAiDismiss,false);
      else if(b.dataset.manualFilesRun)void runFilesAi(b.dataset.manualFilesRun);
      else if(b.dataset.manualFilesApply)applyFilesAi(b.dataset.manualFilesApply,true);
      else if(b.dataset.manualFilesDismiss)applyFilesAi(b.dataset.manualFilesDismiss,false);
      else if(b.hasAttribute('data-manual-confirm'))void confirm();
      else if(b.hasAttribute('data-manual-cancel')||b.hasAttribute('data-manual-task-cancel'))cancel();
      else if(b.hasAttribute('data-manual-task-save'))void saveTask();
      else if(b.hasAttribute('data-manual-task-project'))void sheet.open('task-project',b);
      else if(b.dataset.manualTaskDay&&task){
        const kind=b.dataset.manualTaskDay;
        if(task.dateKind===kind){task.due='';task.dateKind='';paint();return;}
        if(kind==='date'){const date=host.querySelector('[data-manual-task-date]');try{date.showPicker();}catch{date.focus();date.click();}return;}
        task.dateKind=kind;task.due=dayKey(Date.now()+(kind==='tomorrow'?86400000:0));paint();
      }
      else if(b.dataset.manualTaskRecover==='check')void recoverTask();
      else if(b.dataset.manualTaskRecover==='close')cancel({force:true});
    });
    host.addEventListener('input',event=>{
      const el=event.target;
      if(el.dataset.manualSummary!==undefined){const t=link.targets.find(s=>linkKey(s.kind,s.id)===el.dataset.manualSummary);if(t)t.summary=el.value;}
      else if(el.hasAttribute('data-manual-task-title')&&task)task.title=el.value;
      else if(el.hasAttribute('data-manual-task-notes')&&task)task.notes=el.value;
    });
    host.addEventListener('change',event=>{if(event.target.hasAttribute('data-manual-task-date')&&task){task.due=event.target.value;task.dateKind=task.due?'date':'';paint();}});
    // Reopening the same note (for example after a reload) keeps the panel and its draft.
    const n=getNote();if(mode&&(!n||n.id!==noteId))reset();
    paint();
  }
  window.addEventListener('kptu:view-changed',event=>{if(event.detail?.view!=='basket')sheet.dismiss();});
  window.addEventListener('kptu:session-changed',()=>{if(choices&&choices.owner!==scope())choices=null;});
  window.addEventListener('kptu:project-catalog-updated',()=>{choices=null;});
  return {attach,open,cancel,reset:()=>{reset();paint();},isOpen:()=>!!mode,hasDraft,controls};
}
