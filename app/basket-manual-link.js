import {confirmLinks,ERROR_TEXT} from './basket-classification.js?v=10';
import {validateLinkSummary,readRecordPages} from './basket-link-records.js?v=6';
import {selectBasketOrganizations} from './basket-ai-handoff.js?v=19';
import {createChoiceSheet,projectRows} from './choice-sheet.js?v=1';
import {createGoogleTask} from './quick-save.js?v=2';
import {dayKey} from './home-read-model.js?v=3';
import {noteTaskEntry,recordNoteTask} from './basket-note-tasks.js?v=3';

// BASKET-수동연결: the user picks destinations and writes each summary in the
// basket read view. Writes reuse app_basket_confirm_links (owner RLS, INVOKER).
export const MANUAL_LINK_REASON='직접 연결';
export const MANUAL_LINK_LIMIT=20;
export const TASK_LIMITS=Object.freeze({title:1024,notes:8192});
const KIND_NAME={organization:'담당조직',project:'프로젝트'};
const MANUAL_ERROR_TEXT=Object.freeze({
  NOTE_CHANGED:'메모가 그사이 바뀌었어요. 최신 메모를 다시 불러왔어요. 원문을 확인하고 다시 [연결]을 눌러 주세요.',
  NOTE_ARCHIVED:'보관된 메모는 연결할 수 없어요. 보관을 해제한 뒤 연결해 주세요.',
  AI_EXCLUDED:'AI 제외로 표시된 메모라 지금은 연결할 수 없어요.',
  ALREADY_CONFIRMED:'이미 연결된 곳이 있어요. 고른 곳을 확인해 주세요.',
  SUGGESTED_EXISTS:'이미 제안된 연결이 있어요. 고른 곳을 확인해 주세요.',
  INVALID_TARGETS:'연결할 곳과 요약을 다시 확인해 주세요.',
  INVALID_INPUT:'메모 정보가 맞지 않아요. 메모를 다시 불러와 주세요.',
});
export const manualErrorText=code=>MANUAL_ERROR_TEXT[code]||ERROR_TEXT[code]||'연결하지 못했어요. 다시 시도해 주세요.';
const linkKey=(kind,id)=>kind+':'+id;
// RPC payload: only the four keys the database accepts, one fixed reason.
export function manualLinkTargets(selections){
  return selections.map(s=>({kind:s.kind,target_id:s.id,reason:MANUAL_LINK_REASON,summary:s.summary}));
}
// Returns the first selection whose summary the database would refuse, with a plain message.
export function invalidManualSelection(selections){
  if(!selections.length)return {index:-1,message:'연결할 담당조직이나 프로젝트를 골라 주세요.'};
  if(selections.length>MANUAL_LINK_LIMIT)return {index:-1,message:`한 번에 ${MANUAL_LINK_LIMIT}곳까지 연결할 수 있어요.`};
  for(let i=0;i<selections.length;i++){
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
  await Promise.all([import('./project-catalog.js?v=3'),import('./organization-order.js?v=2')]);
  const [catalog,rows,assignees]=await Promise.all([
    window.KPTUProjectCatalog.load({workspaceId,userId,force:true}),
    readRecordPages(`/rest/v1/app_suborganizations?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,name,active&order=id.asc`,rt),
    readRecordPages(`/rest/v1/app_suborganization_assignees?user_id=eq.${encodeURIComponent(userId)}&select=organization_id&order=organization_id.asc`,rt).catch(()=>[]),
  ]);
  const after=rt.context.read();
  if(catalog.workspaceId!==workspaceId||catalog.userId!==userId||after?.workspace?.id!==workspaceId||after?.user?.id!==userId)throw Error('업무 공간이 바뀌었어요. 다시 눌러 주세요.');
  const order=window.KPTUOrganizationOrder,organizations=order.forPicker(selectBasketOrganizations(rows,assignees).organizations);
  return {owner:`${userId}:${workspaceId}`,organizations,groups:order.groups(organizations),projects:window.KPTUProjectCatalog.tree(catalog.projects).filter(x=>x.project.status==='active')};
}

// One link panel and one task form inside the basket read view. basket.js keeps
// owning the detail; this controller owns only what is drawn into its host.
// sheetId: each mounted panel needs its own choice sheet (the basket memo side and the note side, MEMO-노트).
export function mountManualLink({esc,rt=window.KPTURuntime,getNote,getLinks,isBusy,setBusy,onLinked,onNoteChanged,onModeChange,onTaskRecorded,sheetId='basketLinkChoice'}){
  const scope=()=>{const c=rt.context.read();return `${c?.user?.id||''}:${c?.workspace?.id||''}`;};
  let host=null,mode=null,noteId=null,choices=null,choicesFlight=null,seq=0;
  let link={targets:[],status:''},task=null;
  const note=()=>{const n=getNote();return n&&n.id===noteId?n:null;};
  const linked=()=>linkedDestinations(noteId,getLinks());
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
      if(kind==='task-project')return {title:'프로젝트 선택',html:projectRows(choices.projects,task?.project||'',esc)};
      const done=linked(),picked=new Set(link.targets.map(t=>linkKey(t.kind,t.id)));
      const item=(k,id,name,cls,extra='')=>{
        const state=done.get(linkKey(k,id));
        // Already linked places stay visible as text and cannot be chosen again.
        if(state)return `<span class="${cls} basket-choice-done" ${extra}>${esc(name)} · ${state==='suggested'?'이미 제안됨':'이미 연결됨'}</span>`;
        return `<button type="button" class="${cls}" ${extra} data-sheet-value="${esc(id)}" aria-pressed="${picked.has(linkKey(k,id))}">${esc(name)}</button>`;
      };
      if(kind==='organization')return {title:'담당조직 선택',html:choices.groups.length?choices.groups.filter(g=>g.length).map(g=>`<div class="home-choice-group">${g.map(o=>item('organization',o.id,o.name||'이름 없는 조직','home-choice-chip')).join('')}</div>`).join(''):'<p class="home-choice-label">고를 수 있는 담당조직이 없어요.</p>'};
      return {title:'프로젝트 선택',html:choices.projects.length?choices.projects.map(x=>item('project',x.project.id,x.project.name||'이름 없는 프로젝트','home-choice-row',`style="--home-choice-depth:${x.depth}" title="${esc(x.project.name||'')}"`)).join(''):'<p class="home-choice-label">고를 수 있는 프로젝트가 없어요.</p>'};
    },
    onSelect:(kind,value)=>{
      if(kind==='task-project'){if(task)task.project=value;paint();return;}
      if(linked().has(linkKey(kind,value)))return;
      const existing=link.targets.find(t=>t.kind===kind&&t.id===value);
      if(!existing){
        if(link.targets.length>=MANUAL_LINK_LIMIT){link.status=`한 번에 ${MANUAL_LINK_LIMIT}곳까지 연결할 수 있어요.`;paint();return;}
        const name=kind==='organization'?choices.organizations.find(o=>o.id===value)?.name:choices.projects.find(x=>x.project.id===value)?.project.name;
        link.targets.push({kind,id:value,name:name||'이름 없는 곳',summary:''});link.status='';
      }
      paint();
      // The sheet returns focus to its trigger once its history entry is gone; the new summary is
      // the next thing to write, so focus it after that close settles (sheet.close() returns it).
      queueMicrotask(()=>void sheet.close().then(()=>host?.querySelector(`[data-manual-summary="${CSS.escape(linkKey(kind,value))}"]`)?.focus()));
    },
    onError:error=>{const message=error?.message||'고를 목록을 불러오지 못했어요. 다시 눌러 주세요.';if(mode==='link')link.status=message;else if(task)task.status=message;paint();}
  });
  function linkMarkup(n){
    const done=[...linked().keys()].length;
    return `<section class="basket-manual" data-manual-link aria-labelledby="basketManualLinkTitle"><h3 id="basketManualLinkTitle">조직·프로젝트에 연결</h3>
<details data-manual-original><summary>원문 전체 보기</summary><div class="basket-classification-original">${esc(n.raw_text||'글 없이 첨부만 있는 메모입니다.')}</div></details>
<div class="basket-actions"><button type="button" data-manual-pick="organization" aria-haspopup="dialog" aria-expanded="false">담당조직 고르기 ▾</button><button type="button" data-manual-pick="project" aria-haspopup="dialog" aria-expanded="false">프로젝트 고르기 ▾</button></div>
${done?`<p class="basket-manual-hint">이미 연결된 곳 ${done}곳은 고를 수 없어요.</p>`:''}
<p class="basket-manual-hint">고른 곳마다 요약을 직접 써 주세요. 일시·장소·누가·숫자를 빠짐없이 적어 주세요.</p>
<div data-manual-targets>${link.targets.map(t=>{const key=linkKey(t.kind,t.id);return `<div class="basket-manual-target" data-manual-target="${esc(key)}"><div class="basket-manual-target-head"><b>${esc(KIND_NAME[t.kind]+' · '+t.name)}</b><button type="button" data-manual-remove="${esc(key)}" aria-label="${esc(t.name)} 빼기">빼기</button></div><label class="basket-text-label basket-manual-summary">기록 요약 (필수)<textarea data-manual-summary="${esc(key)}" rows="3" maxlength="2000" spellcheck="false" placeholder="일시·장소·누가·숫자를 빠짐없이">${esc(t.summary)}</textarea></label></div>`;}).join('')}</div>
<p data-manual-status role="status">${esc(link.status)}</p>
<div class="basket-actions"><button type="button" class="quick-pill-primary" data-manual-confirm>연결</button><button type="button" data-manual-cancel>취소</button></div></section>`;
  }
  const taskProjectName=()=>task?.project?choices?.projects.find(x=>x.project.id===task.project)?.project.name||'프로젝트':'프로젝트';
  function paintTaskProject(){
    const button=host?.querySelector('[data-manual-task-project]');if(!button)return;
    const project=taskProjectName();button.textContent=project+' ▾';button.setAttribute('aria-label',task.project?'프로젝트: '+project:'프로젝트');
  }
  function taskMarkup(){
    const project=taskProjectName();
    const dateLabel=task.dateKind==='date'&&task.due?`${Number(task.due.slice(5,7))}.${Number(task.due.slice(8,10))}`:'날짜';
    return `<section class="basket-manual" data-manual-task aria-labelledby="basketManualTaskTitle"><h3 id="basketManualTaskTitle">Google 할 일 만들기</h3>
<label class="basket-text-label">할 일 제목<input type="text" data-manual-task-title maxlength="${TASK_LIMITS.title}" value="${esc(task.title)}"></label>
<label class="basket-text-label">할 일 메모<textarea data-manual-task-notes rows="6" spellcheck="false">${esc(task.notes)}</textarea></label>
<div class="basket-actions basket-manual-task-options"><button type="button" data-manual-task-project aria-haspopup="dialog" aria-expanded="false" aria-label="${task.project?esc('프로젝트: '+project):'프로젝트'}">${esc(project)} ▾</button><button type="button" data-manual-task-day="today" aria-pressed="${task.dateKind==='today'}">오늘</button><button type="button" data-manual-task-day="tomorrow" aria-pressed="${task.dateKind==='tomorrow'}">내일</button><button type="button" data-manual-task-day="date" aria-pressed="${task.dateKind==='date'}">${esc(dateLabel)}</button><input type="date" class="basket-manual-date" data-manual-task-date aria-label="기한 날짜" tabindex="-1" value="${esc(task.dateKind==='date'?task.due:'')}"></div>
<p class="basket-manual-hint">만든 할 일은 이 메모의 ‘이 메모로 만든 할 일’에 기록돼요.</p>
<p data-manual-task-status role="status">${esc(task.status)}</p><div data-manual-task-recover></div>
<div class="basket-actions"><button type="button" class="quick-pill-primary" data-manual-task-save>할 일 만들기</button><button type="button" data-manual-task-cancel>취소</button></div></section>`;
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
    const invalid=invalidManualSelection(link.targets);
    if(invalid){link.status=invalid.message;paint();if(invalid.index>=0)host.querySelector(`[data-manual-summary="${CSS.escape(linkKey(link.targets[invalid.index].kind,link.targets[invalid.index].id))}"]`)?.focus();return;}
    const targets=manualLinkTargets(link.targets),run=++seq,owner=scope(),id=n.id;
    const current=()=>run===seq&&owner===scope()&&note()?.id===id&&window.KPTURouter.current==='basket';
    const changed=()=>window.dispatchEvent(new Event('kptu:basket-links-changed'));
    setBusy(true);link.status='연결하는 중…';paint();
    let result=null;
    try{result=await confirmLinks(id,n.updated_at,targets,rt);}catch{result=null;}
    setBusy(false);
    if(!current()){if(owner===scope()&&result?.ok!==false)changed();return;}
    if(!result||typeof result.ok!=='boolean'){
      // Unknown outcome: the RPC is all-or-nothing, so one fresh read tells which.
      changed();link.status='연결 결과를 확인하는 중…';paint();
      const fresh=await onLinked(id,[]).catch(()=>({ok:false}));if(!current())return;
      const now=linkedDestinations(id,getLinks());
      if(fresh.ok&&targets.every(t=>now.get(linkKey(t.kind,t.target_id))==='confirmed')){finish(targets.length,0);return;}
      link.status=!fresh.ok?'연결 결과를 확인하지 못했어요. [메모 다시 불러오기]로 실제 연결을 확인해 주세요.':'연결되지 않았어요. 다시 [연결]을 눌러 주세요.';paint();return;
    }
    if(!result.ok){
      if(result.error==='NOTE_CHANGED'){link.status=manualErrorText('NOTE_CHANGED');await onNoteChanged();if(note()?.id===id&&mode==='link'){link.status=manualErrorText('NOTE_CHANGED');paint();}return;}
      link.status=manualErrorText(result.error);paint();return;
    }
    changed();
    const fresh=await onLinked(id,targets.map(t=>({kind:t.kind,target_id:t.target_id,name:link.targets.find(s=>s.kind===t.kind&&s.id===t.target_id)?.name}))).catch(()=>({ok:false}));
    if(!current())return;
    finish(result.created||0,result.existing||0,fresh.ok?'':'목록 새로고침은 다시 시도해 주세요.');
  }
  function finish(created,existing,warning=''){
    reset();paint();
    const message=[`${created}곳에 연결했어요.`,existing?`${existing}곳은 이미 연결돼 있어 요약을 바꾸지 않았어요.`:'',warning].filter(Boolean).join(' ');
    host?.ownerDocument.querySelector('[data-basket-status]')?.replaceChildren(message);
    host?.ownerDocument.querySelector('[data-basket-link-open]')?.focus();
  }
  function paintRecover(){
    const box=host?.querySelector('[data-manual-task-recover]');if(!box||!task?.recover)return;
    box.replaceChildren();
    for(const action of task.recover){const b=document.createElement('button');b.type='button';b.textContent=action.label;b.dataset.manualTaskRecover=action.key;box.append(b);}
  }
  function showToast(message){const toast=document.querySelector('#toast');if(!toast)return;toast.textContent=message;toast.classList.remove('hidden');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>toast.classList.add('hidden'),3200);}
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
      task.status='할 일을 만들었어요. 메모에 기록하는 중…';paint();
      let recorded=null;
      try{recorded=await recordNoteTask(id,noteTaskEntry(result.task),{rt,expectedSessionEpoch:epoch});}catch{recorded=null;}
      setBusy(false);
      // A result that lands after an account switch or a different note is never shown or applied.
      if(!current())return;
      if(recorded?.ok)onTaskRecorded?.(recorded.note);
      reset();paint();
      const message=[recorded?.ok?'Google 할 일을 만들었어요. 이 메모에 기록했어요.':'할 일은 만들었지만 메모에 기록하지 못했어요.',linkMissing?'프로젝트 연결은 할 일 화면에서 확인해 주세요.':''].filter(Boolean).join(' ');
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
