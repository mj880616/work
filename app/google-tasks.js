import {formatSeoulTime} from './meeting-time.js';
import { createAnchoredMenu } from './anchored-menu.js';
import { dayKey } from './home-read-model.js';
import { createGoogleTask } from './quick-save.js';
import { readTaskSourceNotes, requestBasketNote, takeTaskOpenRequest, basketNoteHref } from './basket-note-tasks.js';
(()=>{
'use strict';
if(window.__KPTU_GOOGLE_TASKS__)return;
window.__KPTU_GOOGLE_TASKS__=true;
const rt=window.KPTURuntime;const RECENT_COMPLETED_MS=3*24*60*60*1000;let loadingEpoch=-1,loadSeq=0,lastTasks=[],cacheOwnerId='',shownOwner='',fetchedOwner='',overviewUnsupported=false,allPendingConfirmed=false,sessionEpoch=0,editing=null,editorReturn='',editorSaving=false,editorDraft=null,editorReady=false,toggleSeq=0;let unlinkedOnly=false;const stateListeners=new Set();const notifyState=()=>{for(const fn of stateListeners)fn()};const pendingToggles=new Map(),savedToggles=new Map(),settling=new Map(),arriving=new Map(),pendingDeletes=new Map(),deletedTombstones=new Set();
// Web2 reads and creates tasks in the Google default list ("내 할 일") only (TASK-구현 PR 3), so the editor has no list choice (PR 4).
const SCOPE_NOTE='Google "내 할 일"만 표시합니다. 다른 목록은 표시하지 않으며, 다른 목록으로 옮기면 연결이 끊길 수 있습니다.';
// Links (TASK-구현 PR 4): a task may be linked to any number of projects and organizations (up to the Edge limit), or to none.
let editorRuntimeEpoch=rt.session.epoch();
const MAX_LINKS=20;let editorSeq=0,editorLinks=null,editorPreset=[],linkTargets=null,editorRequest=null,createAttempt=null;const uncertainTasks=new Map(),pendingEditors=new Map();
// Last result per owner on this device, shown first while a fresh copy loads. KPTURuntime drops it on sign-out or owner change.
// v2 (묶음C-4): results now include overdue pending tasks, so a v1 copy is ignored and removed.
const GT_CACHE_NAME='google-tasks-v2',GT_CACHE_OLD_NAMES=['google-tasks-v1'],GT_CACHE_MAX_AGE=7*24*60*60*1000;
const gtCacheKey=(owner,name=GT_CACHE_NAME)=>rt?.ownerCache?.prefix&&owner?`${rt.ownerCache.prefix}${name}:${owner}`:'';
const cacheRead=owner=>{const k=gtCacheKey(owner);if(!k)return null;try{const v=JSON.parse(localStorage.getItem(k)||'null');return v&&v.owner===owner&&Array.isArray(v.tasks)&&Date.now()-Number(v.savedAt||0)<GT_CACHE_MAX_AGE?v.tasks:null}catch{return null}};
const cacheWrite=(owner,tasks)=>{const k=gtCacheKey(owner);if(!k)return;try{localStorage.setItem(k,JSON.stringify({owner,savedAt:Date.now(),tasks}))}catch{}};
const cacheDrop=owner=>{const k=gtCacheKey(owner);if(!k)return;try{localStorage.removeItem(k)}catch{}};
const cacheDropOld=owner=>{for(const name of GT_CACHE_OLD_NAMES){const k=gtCacheKey(owner,name);if(!k)continue;try{localStorage.removeItem(k)}catch{}}};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const endpoint=action=>`/functions/v1/google-tasks?action=${encodeURIComponent(action)}`;
const currentOwner=()=>rt?.session?.read()?.user?.id||'';
const stillCurrent=(epoch,owner)=>epoch===sessionEpoch&&owner&&currentOwner()===owner;
const completedRecently=(task,now=Date.now())=>{if(task?.status!=='completed')return true;const completedAt=Date.parse(task?.completed||'');return Number.isFinite(completedAt)&&completedAt>=now-RECENT_COMPLETED_MS};
// Dates follow Korean time whatever the device time zone (same rule as the google-tasks Edge).
const DAY_MS=24*60*60*1000;
const kstDateKey=(offset=0,now=Date.now())=>dayKey(now+offset*DAY_MS);
const dueDateKey=v=>{const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})/);if(!m)return'';const y=Number(m[1]),mo=Number(m[2]),day=Number(m[3]),d=new Date(Date.UTC(y,mo-1,day));return d.getUTCFullYear()===y&&d.getUTCMonth()===mo-1&&d.getUTCDate()===day?m[0]:''};
const inSevenDayWindow=(task,now=Date.now())=>{const key=dueDateKey(task?.due);return Boolean(key)&&key>kstDateKey(0,now)&&key<=kstDateKey(7,now)};
const isOverdue=(task,now=Date.now())=>{if(task?.status==='completed')return false;const key=dueDateKey(task?.due);return Boolean(key)&&key<kstDateKey(0,now)};
const byDue=(a,b)=>dueDateKey(a.due).localeCompare(dueDateKey(b.due));
const due=v=>{const raw=dueDateKey(v);if(!raw)return'기한 미정';return formatSeoulTime(raw,{month:'numeric',day:'numeric',weekday:'short'})};
let taskMenu=null,taskRenderPending=false;
function section(){
  let sec=document.querySelector('#gtTaskSection');if(sec)return sec;
  const taskList=document.querySelector('#taskList');if(!taskList)return null;
  taskList.replaceChildren();taskList.classList.remove('tl-task-list');
  sec=document.createElement('section');sec.id='gtTaskSection';sec.className='tl-task-section';
  sec.innerHTML='<div class="gt-head"><div class="gt-head-left"><span class="gt-count" data-gt-count tabindex="-1">할 일 0개</span><button type="button" class="icon-btn gt-info" data-gt-info aria-label="할 일 목록 안내">ⓘ</button><span class="gt-note gt-sync" data-gt-sync role="status" aria-live="polite"></span></div></div><div id="gtTaskBody" class="gt-status">불러오는 중…</div><div id="gtUndoDeletes" role="status" aria-live="polite"></div><aside id="gtDetailPane" class="gt-pane" aria-label="할 일 상세"><p class="gt-pane-empty">왼쪽에서 할 일을 고르면 여기서 고칠 수 있어요.</p></aside>';
  taskList.insertAdjacentElement('afterend',sec);
  sec.querySelector('[data-gt-info]').onclick=openScope;
  if(!taskMenu)taskMenu=createAnchoredMenu({id:'gtTaskMenu',className:'gt-task-menu',label:'할 일 관리',historyKey:'kptuTaskMenu',key:trigger=>trigger.dataset.gtMenu,onClose:()=>{if(taskRenderPending){taskRenderPending=false;renderTasks(lastTasks)}},
    render:()=>'<button type="button" data-gt-menu-action="edit">편집</button><button type="button" class="gt-menu-danger" data-gt-menu-action="delete">삭제</button>',
    onAction:(button,active)=>{active.trigger.focus({preventScroll:true});if(button.dataset.gtMenuAction==='edit'){const task=lastTasks.find(t=>t.id===active.id);if(task)openEditor(task,{docked:true})}else queueDelete(active.id)}
  });
  return sec;
}
function closeScope(){const modal=document.querySelector('#gtScopeModal');if(!modal)return;modal.classList.add('hidden');modal.setAttribute('aria-hidden','true');window.KPTUA11y?.dialog.deactivate(modal,{restoreFocus:true})}
function openScope(){
  let modal=document.querySelector('#gtScopeModal');
  if(!modal){document.body.insertAdjacentHTML('beforeend',`<div id="gtScopeModal" data-kptu-history-all="1" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="gtScopeTitle"><div class="modal-card small-card"><div class="modal-head"><h2 id="gtScopeTitle">할 일 목록 안내</h2><button type="button" class="icon-btn" data-gt-scope-close data-close="gtScopeModal" aria-label="닫기">×</button></div><p class="gt-scope-note">${esc(SCOPE_NOTE)}</p></div></div>`);modal=document.querySelector('#gtScopeModal');modal.querySelector('[data-gt-scope-close]').onclick=closeScope;}
  modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');window.KPTUA11y?.dialog.activate(modal,{trigger:document.activeElement,initialFocus:'[data-gt-scope-close]',onRequestClose:closeScope});
}

function ensureModal(){let m=document.querySelector('#gtTaskModal');if(m)return m;document.body.insertAdjacentHTML('beforeend',`<div id="gtTaskModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="gtTaskHeading"><div class="modal-card small-card"><div class="modal-head"><div><h2 id="gtTaskHeading">Google 할 일</h2></div><button class="icon-btn" data-gt-close type="button" aria-label="닫기">×</button></div><label>할 일<input id="gtEditTitle" type="text"></label><p class="gt-scope-note" data-gt-list-note>Google "내 할 일" 목록에 저장됩니다.</p><label>기한<input id="gtEditDue" type="date"></label><label>메모<textarea id="gtEditNotes" rows="4"></textarea></label><p class="gt-scope-note hidden" id="gtMeetingLinks"></p><p class="gt-scope-note hidden" id="gtSourceNote"></p><fieldset class="gt-links"><legend>연결할 프로젝트·조직</legend><p class="gt-links-hint">고르지 않아도 됩니다 · 여러 개 가능</p><div id="gtEditLinkBody" class="gt-link-body"></div></fieldset><div class="modal-action-footer"><div id="gtEditStatus" class="status"></div><div class="gt-modal-actions"><button id="gtDeleteBtn" class="ghost tl-danger hidden" type="button">삭제</button><button id="gtToggleBtn" class="ghost hidden" type="button">완료</button><button id="gtSaveBtn" class="primary" type="button">저장</button></div></div></div></div>`);m=document.querySelector('#gtTaskModal');m.querySelector('[data-gt-close]').onclick=closeEditor;document.querySelector('#gtSaveBtn').onclick=saveEditor;document.querySelector('#gtDeleteBtn').onclick=deleteEditor;document.querySelector('#gtToggleBtn').onclick=toggleEditor;return m}
function closeEditor(){editorSeq++;editorRequest=null;editorSaving=false;const m=document.querySelector('#gtTaskModal');if(!m)return;const target=editorReturn?document.querySelector(editorReturn):null;if(isDocked()){const hadFocus=m.contains(document.activeElement);m.classList.add('hidden');m.setAttribute('aria-hidden','true');placeEditor(false);editing=null;editorReturn='';paintSelection();if(hadFocus)(target?.getClientRects().length?target:focusFallback())?.focus({preventScroll:true});return}m.classList.add('hidden');m.setAttribute('aria-hidden','true');window.KPTUA11y?.dialog.deactivate(m,{restoreFocus:true,fallbackFocus:target?.getClientRects().length?target:focusFallback()});editing=null;editorReturn=''}
// UI-PC할일: on a wide screen (≥1024) the [할 일] screen shows the same editor docked in the right pane instead of as a popup.
// It is the same element (it keeps its .modal look: buttons, labels) and the same save, complete and delete functions; only its place
// changes, and it is not a modal dialog there (no focus trap, no history entry). Phone and mid width keep the popup.
const PC=window.matchMedia?.('(min-width:1024px)');
const pcColumns=()=>!!PC?.matches;
const isDocked=()=>document.querySelector('#gtTaskModal')?.dataset.gtDocked==='1';
// While docked, the save button and the status line live in the sticky head (beside the close X) so they never scroll out of view; in the popup they stay in the footer.
function placeEditorActions(docked){const m=ensureModal(),head=m.querySelector('.modal-head'),close=head?.querySelector('[data-gt-close]'),save=m.querySelector('#gtSaveBtn'),st=m.querySelector('#gtEditStatus'),footer=m.querySelector('.modal-action-footer'),actions=m.querySelector('.gt-modal-actions');if(!head||!close||!save||!st||!footer||!actions)return;if(docked){if(save.parentElement!==head)head.insertBefore(save,close);if(st.parentElement!==head)head.append(st);save.classList.add('gt-pane-save')}else{if(st.parentElement!==footer)footer.prepend(st);if(save.parentElement!==actions)actions.append(save);save.classList.remove('gt-pane-save')}}
function placeEditor(docked){const m=ensureModal(),pane=document.querySelector('#gtDetailPane');placeEditorActions(!!(docked&&pane));if(docked&&pane){if(m.parentElement!==pane)pane.append(m);m.classList.add('gt-docked');m.setAttribute('role','region');m.removeAttribute('aria-modal');m.dataset.gtDocked='1';pane.classList.add('has-task');return}if(m.parentElement!==document.body)document.body.append(m);m.classList.remove('gt-docked');m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');delete m.dataset.gtDocked;pane?.classList.remove('has-task')}
// The card whose task is open in the pane is marked (one place, after every render and every open or close).
function paintSelection(){const id=isDocked()&&!document.querySelector('#gtTaskModal').classList.contains('hidden')?editing?.id:'';document.querySelectorAll('#gtTaskBody [data-gt-edit]').forEach(b=>{const on=!!id&&b.dataset.gtEdit===id;b.closest('.gt-row')?.classList.toggle('is-selected',on);if(on)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current')})}
const linkKey=l=>l?.project_id?'p:'+l.project_id:l?.meeting_id?'m:'+l.meeting_id:'o:'+(l?.organization_id||'');
const keyLink=k=>k.startsWith('p:')?{project_id:k.slice(2)}:k.startsWith('m:')?{meeting_id:k.slice(2)}:{organization_id:k.slice(2)};
const workspaceOf=()=>rt?.context?.read?.()?.workspace?.id||window.__KPTU_BOOT_CONTEXT__?.workspace?.id||'';
const tasksViewShown=()=>{const v=document.querySelector('#tasksView');return !!v&&!v.classList.contains('hidden')};
function toast(msg){const t=document.querySelector('#toast');if(!t){setSync(msg,true);return}t.textContent=msg;t.classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.add('hidden'),3200)}
function errorText(e){const msg=String(e?.message||e);if(/TASKS_SCOPE_REQUIRED|권한/.test(msg))return 'Google 할 일 권한을 다시 연결해 주세요(할 일 탭).';if(/연결되지/.test(msg))return 'Google 계정을 연결하면 Google 할 일을 함께 볼 수 있습니다(할 일 탭).';return msg}
// Link choices: active projects in the shared catalog's tree order, and organizations explicitly assigned to this user in the
// shared organization order (TASK-조직순서), split into its groups.
// The Edge validates every target again. Existing links to targets not offered here are preserved by chosenLinks().
async function loadTargets(){const owner=currentOwner(),ws=workspaceOf(),cat=window.KPTUProjectCatalog,order=window.KPTUOrganizationOrder;if(linkTargets?.owner===owner)return linkTargets;if(!owner||!ws)throw new Error('작업공간 정보를 확인할 수 없습니다.');const [snap,assignments,orgs]=await Promise.all([cat?.load?cat.load({workspaceId:ws,userId:owner}):null,rt.api(`/rest/v1/app_suborganization_assignees?user_id=eq.${encodeURIComponent(owner)}&select=organization_id`),rt.api(`/rest/v1/app_suborganizations?workspace_id=eq.${encodeURIComponent(ws)}&active=eq.true&select=id,name`)]);const assigned=new Set((assignments||[]).map(x=>x.organization_id)),assignedOrgs=order.forPicker((orgs||[]).filter(o=>assigned.has(o.id)));const unlisted=order.unlisted(assignedOrgs);if(unlisted)console.warn(`[Google Tasks] 조직 순서표 미등록: ${unlisted}개. 이름 일치 여부를 확인하세요.`);const out={owner,projects:(snap?.tree||[]).map(x=>({key:'p:'+x.project.id,label:cat.label(x.project.name,x.depth),name:x.project.name,depth:x.depth})),orgGroups:order.groups(assignedOrgs).map(g=>g.map(o=>({key:'o:'+o.id,label:o.name||'(이름 없음)',group:order.groupName(o)})))};if(currentOwner()===owner)linkTargets=out;return out}
// UI-고르기창개선 C: a child project's "↳" and its indent are their own span, so a PC (761px~) can show the name indented and
// lighter without the arrow (google-tasks.css); phones keep the arrow. The text of the span is unchanged.
const linkText=x=>x.depth>0?`<i class="gt-link-arrow">${esc(x.label.slice(0,x.label.length-String(x.name).length))}</i>${esc(x.name)}`:esc(x.label);
const linkOpt=(x,selected)=>`<label class="gt-link-opt"${x.depth>0?` data-depth="${x.depth}"`:''}><input type="checkbox" data-gt-link value="${esc(x.key)}"${selected.has(x.key)?' checked':''}><span>${linkText(x)}</span></label>`;
const linkGroup=(title,groups,selected)=>`<div class="gt-link-group" role="group" aria-label="${esc(title)}"><b>${esc(title)}</b>${groups.some(g=>g.length)?groups.filter(g=>g.length).map(g=>title==='조직'?`<div class="gt-org-group">${groups.length>1&&g[0]?.group?`<b class="gt-org-group-name">${esc(g[0].group)}</b>`:''}${g.map(x=>linkOpt(x,selected)).join('')}</div>`:g.map(x=>linkOpt(x,selected)).join('')).join(''):`<span class="gt-muted">${title==='조직'?'담당 조직이 없습니다.':esc(title)+' 없음'}</span>`}</div>`;
// Links chosen in the editor. Links to targets that are not offered (e.g. an archived project) are kept as they are.
function chosenLinks(){if(!editorLinks)return null;const box=document.querySelector('#gtEditLinkBody'),inputs=[...(box?.querySelectorAll('[data-gt-link]')||[])],shown=new Set(inputs.map(x=>x.value)),out=new Set(inputs.filter(x=>x.checked).map(x=>x.value));for(const k of editorLinks)if(!shown.has(k))out.add(k);return out}
async function openEditor(task=null,{links=[],focusLinks=false,docked=false}={}){docked=docked&&!!task&&pcColumns()&&tasksViewShown()&&!!document.querySelector('#gtDetailPane');if(docked&&isDocked()&&editing&&editing.id!==task.id&&editorReady&&!document.querySelector('#gtTaskModal').classList.contains('hidden')&&editorDirty()&&!confirm('저장하지 않은 수정이 있습니다. 다른 할 일을 열까요?'))return;const pending=task?.id?pendingEditors.get(taskUncertaintyKey(task.id)):null;editorRequest=null;editorSaving=false;const trigger=document.activeElement,kind=trigger?.dataset?.gtMenu?'menu':trigger?.dataset?.gtEdit?'edit':'';editorReturn=kind&&task?.id?`[data-gt-${kind}="${CSS.escape(task.id)}"]`:'';const m=ensureModal(),seq=++editorSeq;placeEditor(docked);m.querySelectorAll('input,textarea,#gtSaveBtn,#gtDeleteBtn,#gtToggleBtn').forEach(el=>el.disabled=false);editing=task;editorReady=false;editorLinks=null;editorPreset=links;document.querySelector('#gtTaskHeading').textContent=task?'Google 할 일 수정':'Google 할 일 추가';document.querySelector('#gtEditTitle').value=task?.title||'';document.querySelector('#gtEditDue').value=task?.due?String(task.due).slice(0,10):'';document.querySelector('#gtEditNotes').value=task?.notes||'';document.querySelector('#gtDeleteBtn').classList.toggle('hidden',!task);const toggle=document.querySelector('#gtToggleBtn');toggle.classList.toggle('hidden',!task);toggle.textContent=task?.status==='completed'?'완료 취소':'완료';toggle.disabled=true;document.querySelector('#gtSaveBtn').disabled=true;editorDraft=readEditorDraft();document.querySelector('#gtEditStatus').textContent='';paintSourceNote(task);const box=document.querySelector('#gtEditLinkBody'),meetingBox=document.querySelector('#gtMeetingLinks');box.innerHTML='<span class="gt-muted">연결할 프로젝트·조직을 불러오는 중…</span>';meetingBox.textContent='';meetingBox.classList.add('hidden');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');if(docked)paintSelection();else window.KPTUA11y?.dialog.activate(m,{trigger:document.activeElement,initialFocus:'#gtEditTitle',onRequestClose:closeEditor});document.querySelector('#gtEditTitle').focus();
  try{const [targets,cur]=await Promise.all([loadTargets(),task?rt.api(endpoint('links')+'&task_id='+encodeURIComponent(task.id)):{links,meeting_links:[]}]);if(seq!==editorSeq)return;const projectOrg=cur?.links||[],meetingLinks=cur?.meeting_links||[],selected=new Set([...projectOrg,...meetingLinks].filter(l=>!l.status||l.status==='confirmed').map(linkKey));editorLinks=selected;box.innerHTML=linkGroup('프로젝트',[targets.projects],selected)+linkGroup('조직',targets.orgGroups,selected);if(meetingLinks.length){const known=new Map((window.KPTUTeamData?.meetings?.()||[]).map(row=>[row.id,row.series_name||row.title]));meetingBox.textContent='회의: '+meetingLinks.map(link=>known.get(link.meeting_id)||'회의 연결').join(', ');meetingBox.classList.remove('hidden');const missing=meetingLinks.filter(link=>!known.has(link.meeting_id));if(missing.length){const rows=await Promise.all(missing.map(link=>rt.api('/rest/v1/app_meetings?id=eq.'+encodeURIComponent(link.meeting_id)+'&select=id,title,series_name&limit=1').catch(()=>[])));if(seq===editorSeq){rows.flat().forEach(row=>known.set(row.id,row.series_name||row.title));meetingBox.textContent='회의: '+meetingLinks.map(link=>known.get(link.meeting_id)||'회의 연결').join(', ')}}}if(pending){document.querySelector('#gtEditStatus').textContent='이 할 일의 앞선 저장 결과를 기다리는 중…';await pending.done;if(seq!==editorSeq||pending.epoch!==editorSession()||pending.owner!==currentOwner())return;const latest=await rt.api(endpoint('links')+'&task_id='+encodeURIComponent(task.id),{singleFlight:false});if(seq!==editorSeq||pending.epoch!==editorSession()||pending.owner!==currentOwner())return;editorLinks=confirmedKeys(latest);if(pending.savedText)editorDraft=pending.savedText;document.querySelector('#gtEditStatus').textContent='앞선 저장 처리가 끝났습니다. 현재 입력을 확인한 뒤 저장해 주세요.';}if(focusLinks)box.querySelector('[data-gt-link]')?.focus()}catch{if(seq!==editorSeq)return;editorLinks=null;box.innerHTML='<span class="gt-error">연결 정보를 불러오지 못했습니다. 연결은 그대로 두고 할 일만 저장합니다.</span>'}finally{if(seq===editorSeq){editorReady=true;toggle.disabled=editorSaving;document.querySelector('#gtSaveBtn').disabled=editorSaving}}}
// Compare the draft exactly, including whitespace and retained links. Never save a draft as a side effect of completion.
function readEditorDraft(){return JSON.stringify(['#gtEditTitle','#gtEditDue','#gtEditNotes'].map(selector=>document.querySelector(selector).value))}
function editorDirty(){const chosen=chosenLinks();return readEditorDraft()!==editorDraft||Boolean(chosen&&editorLinks&&(chosen.size!==editorLinks.size||[...chosen].some(key=>!editorLinks.has(key))))}
async function toggleEditor(){
  if(editorSaving||!editing||!editorReady)return;
  const task=editing,m=ensureModal(),st=document.querySelector('#gtEditStatus'),seq=editorSeq,epoch=sessionEpoch,owner=currentOwner();
  if(editorDirty()){st.textContent='수정한 내용을 먼저 저장하세요. 완료 상태는 바꾸지 않았습니다.';return}
  if(pendingToggles.has(task.id)){st.textContent='완료 상태를 저장 중입니다. 잠시 후 다시 눌러 주세요.';return}
  const controls=[...m.querySelectorAll('input,textarea,#gtSaveBtn,#gtDeleteBtn,#gtToggleBtn')].map(el=>({el,disabled:el.disabled}));
  editorSaving=true;controls.forEach(({el})=>{el.disabled=true});st.textContent='';
  try{
    const result=await toggleTask(task);
    if(seq!==editorSeq||!stillCurrent(epoch,owner)||editing?.id!==task.id||m.classList.contains('hidden'))return;
    if(result?.ok)closeEditor();else if(result?.message)st.textContent=result.message;
  }finally{if(seq===editorSeq&&stillCurrent(epoch,owner)){editorSaving=false;controls.forEach(({el,disabled})=>{el.disabled=disabled})}}
}
const editorSession=()=>rt.session.epoch();
const editorCall=(r,path,options={})=>rt.api(path,{...options,expectedSessionEpoch:r.epoch});
const sameKeys=(a,b)=>a.size===b.size&&[...a].every(k=>b.has(k));
const confirmedKeys=d=>{
  if(!Array.isArray(d?.links)||(d.meeting_links!=null&&!Array.isArray(d.meeting_links)))throw new Error('연결 저장 결과를 확인하지 못했습니다.');
  return new Set([...d.links,...(d.meeting_links||[])].filter(l=>!l.status||l.status==='confirmed').map(linkKey));
};
const confirmedTask=(d,id=null)=>d?.ok===true&&typeof d.task?.id==='string'&&d.task.id&&(!id||d.task.id===id);
const editorActive=r=>editorRequest===r&&r.seq===editorSeq&&r.epoch===editorSession()&&r.owner===currentOwner()&&editing?.id===r.task?.id&&!document.querySelector('#gtTaskModal').classList.contains('hidden');
const taskUncertaintyKey=id=>`${editorSession()}:${currentOwner()}:${id}`;
function editorNotice(text,{recover=false,reconnect=false}={}){
  const st=document.querySelector('#gtEditStatus');st.textContent=text;
  const button=(label,fn)=>{const b=document.createElement('button');b.type='button';b.className='mini';b.textContent=label;b.onclick=fn;st.append(document.createTextNode(' '),b)};
  if(reconnect)button('Google 권한 다시 연결',()=>connect());
  if(recover)button('목록에서 저장 결과 확인',()=>recoverCreatedTask());
}
async function recoverCreatedTask(){
  const attempt=createAttempt,seq=editorSeq,epoch=editorSession(),owner=currentOwner();
  const active=()=>seq===editorSeq&&epoch===editorSession()&&owner===currentOwner()&&!document.querySelector('#gtTaskModal').classList.contains('hidden');
  if(!attempt||attempt.owner!==owner||attempt.epoch!==epoch||attempt.pending)return;
  editorNotice('저장된 할 일을 직접 골라 주세요. 새 할 일은 다시 만들지 않습니다.');
  try{
    const d=await fetchOverview(true,epoch);if(!active())return;
    if(!Array.isArray(d?.tasks)||d.authorized===false||d.connected===false)throw new Error('Google 할 일 목록을 확인하지 못했습니다.');
    const rows=attempt.task?d.tasks.filter(t=>t.id===attempt.task.id):d.tasks;
    const st=document.querySelector('#gtEditStatus');
    if(!rows.length)return editorNotice('목록에서 결과를 찾지 못했습니다. Google 할 일에서 먼저 확인해 주세요.',{recover:true});
    for(const t of rows.filter(t=>typeof t.id==='string'&&t.id)){
      const b=document.createElement('button');b.type='button';b.className='mini';b.textContent=(t.title||'제목 없음')+' · 이 할 일에 이어서 저장';
      b.onclick=async()=>{b.disabled=true;try{
        const links=await rt.api(endpoint('links')+'&task_id='+encodeURIComponent(t.id),{singleFlight:false,expectedSessionEpoch:epoch});if(!active())return;
        const keys=confirmedKeys(links);editing={...t};editorLinks=keys;editorDraft=JSON.stringify([t.title||'',t.due?String(t.due).slice(0,10):'',t.notes||'']);createAttempt=null;
        document.querySelector('#gtTaskHeading').textContent='Google 할 일 수정';document.querySelector('#gtDeleteBtn').classList.remove('hidden');document.querySelector('#gtToggleBtn').classList.remove('hidden');
        editorNotice('고른 할 일에 이어서 저장합니다. 입력과 연결을 확인한 뒤 저장해 주세요.');
      }catch(e){if(active())editorNotice('연결을 확인하지 못했습니다. '+errorText(e),{recover:true})}};
      st.append(document.createTextNode(' '),b);
    }
  }catch(e){if(active())editorNotice(errorText(e),{recover:true})}
}
async function saveEditor(){
  if(editorSaving||!editorReady)return;
  const title=document.querySelector('#gtEditTitle').value.trim();if(!title)return editorNotice('할 일을 입력해 주세요.');
  const chosen=chosenLinks();if(chosen&&[...chosen].filter(k=>!k.startsWith('m:')).length>MAX_LINKS)return editorNotice(`연결은 ${MAX_LINKS}개까지 고를 수 있습니다.`);
  const owner=currentOwner(),epoch=editorSession();if(!owner)return editorNotice('로그인이 필요합니다.');
  if(!editing&&createAttempt?.owner===owner&&createAttempt.epoch===epoch){editorNotice(createAttempt.pending?'앞선 할 일을 저장 중입니다. 결과가 확인될 때까지 새로 만들지 않습니다.':'앞선 할 일의 저장 결과를 확인해 주세요. 새로 만들지 않았습니다.',{recover:!createAttempt.pending});return}
  const r={owner,epoch,seq:editorSeq,task:editing,text:readEditorDraft(),chosen:chosen?new Set(chosen):null},b=document.querySelector('#gtSaveBtn'),toggle=document.querySelector('#gtToggleBtn');
  const body={action:r.task?'update':'create',task_id:r.task?.id||null,title,notes:document.querySelector('#gtEditNotes').value,due:document.querySelector('#gtEditDue').value||null};
  if(r.task)body.task_list_id=r.task.taskListId||null;else body.links=[...(r.chosen||new Set(editorPreset.map(linkKey)))].map(keyLink);
  r.done=new Promise(resolve=>{r.finish=resolve});if(r.task)pendingEditors.set(taskUncertaintyKey(r.task.id),r);editorRequest=r;editorSaving=true;b.disabled=true;toggle.disabled=true;editorNotice('저장 중…');
  let stage='body',attempt=null;
  try{
    if(r.task&&uncertainTasks.has(taskUncertaintyKey(r.task.id))){
      const kind=uncertainTasks.get(taskUncertaintyKey(r.task.id));
      if(kind==='body'){
        const d=await fetchOverview(true,r.epoch);if(!editorActive(r))return;
        const t=d?.tasks?.find(t=>t.id===r.task.id);if(!t)throw new Error('앞선 저장 결과를 확인하지 못했습니다. Google 할 일에서 확인해 주세요.');
        editorDraft=JSON.stringify([t.title||'',t.due?String(t.due).slice(0,10):'',t.notes||'']);
      }
      const d=await editorCall(r,endpoint('links')+'&task_id='+encodeURIComponent(r.task.id),{singleFlight:false});if(!editorActive(r))return;
      editorLinks=confirmedKeys(d);uncertainTasks.delete(taskUncertaintyKey(r.task.id));
    }
    if(!r.task||r.text!==editorDraft){
      if(!editorActive(r))return;
      if(!r.task){attempt={owner,epoch,pending:true,task:null};createAttempt=attempt}
      const d=r.task?await editorCall(r,endpoint('update'),{method:'POST',body}):await createGoogleTask(body,{api:(path,options)=>editorCall(r,path,options)});
      if(attempt){attempt.pending=false;if(confirmedTask(d))attempt.task=d.task}
      if(!editorActive(r)){
        if(attempt&&owner===currentOwner()&&epoch===editorSession()&&confirmedTask(d)&&!d.link_error)createAttempt=null;
        return;
      }
      if(!confirmedTask(d,r.task?.id))throw new Error('저장 결과를 확인하지 못했습니다.') ;
      if(!r.task){r.task=editing={...d.task};editorLinks=confirmedKeys(d);document.querySelector('#gtTaskHeading').textContent='Google 할 일 수정'}
      else editing=r.task={...r.task,...d.task};
      editorDraft=r.text;r.savedText=r.text;pendingEditors.set(taskUncertaintyKey(r.task.id),r);
      if(d.link_error){
        stage='links';
        const actual=await editorCall(r,endpoint('links')+'&task_id='+encodeURIComponent(r.task.id),{singleFlight:false});if(!editorActive(r))return;
        editorLinks=confirmedKeys(actual);editorNotice('할 일은 저장했습니다. 연결은 일부만 저장됐을 수 있습니다. 확인한 뒤 저장해 주세요.');tasksChanged();return;
      }
    }
    if(!editorActive(r))return;
    if(r.chosen&&editorLinks){
      stage='links';
      const add=[...r.chosen].filter(k=>!editorLinks.has(k));
      if(add.length){const d=await editorCall(r,endpoint('link'),{method:'POST',body:{action:'link',task_id:r.task.id,links:add.map(keyLink)}});if(!editorActive(r))return;if(d?.ok!==true)throw new Error('연결 저장 결과를 확인하지 못했습니다.');editorLinks=confirmedKeys(d)}
      const del=[...editorLinks].filter(k=>!r.chosen.has(k));
      if(del.length){const d=await editorCall(r,endpoint('unlink'),{method:'POST',body:{action:'unlink',task_id:r.task.id,links:del.map(keyLink)}});if(!editorActive(r))return;if(d?.ok!==true)throw new Error('연결 저장 결과를 확인하지 못했습니다.');editorLinks=confirmedKeys(d)}
      if(!sameKeys(editorLinks,r.chosen))throw new Error('연결 저장 결과가 선택과 다릅니다.');
    }
    if(!editorActive(r))return;
    if(createAttempt===attempt||(createAttempt?.task?.id===r.task?.id))createAttempt=null;
    const current=chosenLinks(),unchanged=readEditorDraft()===r.text&&(!r.chosen||!!current&&sameKeys(current,r.chosen));
    if(unchanged){if(isDocked())editorNotice('저장했습니다.');else closeEditor()}else editorNotice('보낸 내용은 저장했습니다. 이후 수정한 내용은 아직 저장하지 않았습니다.');
    tasksChanged();
  }catch(e){
    if(attempt)attempt.pending=false;
    if(!editorActive(r)){if(r.task&&r.epoch===editorSession()&&r.owner===currentOwner())uncertainTasks.set(taskUncertaintyKey(r.task.id),stage);return}
    const scope=/TASKS_SCOPE_REQUIRED|권한/.test(String(e?.message||''));
    if(stage==='links'&&r.task){
      uncertainTasks.set(taskUncertaintyKey(r.task.id),'links');
      try{const d=await editorCall(r,endpoint('links')+'&task_id='+encodeURIComponent(r.task.id),{singleFlight:false});if(!editorActive(r))return;editorLinks=confirmedKeys(d);uncertainTasks.delete(taskUncertaintyKey(r.task.id))}catch{}
      if(!editorActive(r))return;
      editorNotice('할 일은 저장했습니다. 연결 저장을 확인해 주세요. '+errorText(e),{reconnect:scope});
    }else if(scope){if(createAttempt===attempt)createAttempt=null;editorNotice(errorText(e),{reconnect:true})}
    else{if(r.task)uncertainTasks.set(taskUncertaintyKey(r.task.id),'body');editorNotice('저장 결과를 확인하지 못했습니다. 입력은 유지했습니다. '+errorText(e),{recover:!r.task})}
  }finally{
    for(const [key,pending] of pendingEditors)if(pending===r)pendingEditors.delete(key);r.finish();
    if(editorRequest===r){editorRequest=null;editorSaving=false;if(r.seq===editorSeq&&r.epoch===editorSession()&&r.owner===currentOwner()){b.disabled=false;toggle.disabled=!editorReady}}
  }
}
async function deleteEditor(){if(editorSaving||!editing||!confirm('이 Google 할 일을 삭제할까요?'))return;const task=editing,seq=editorSeq,epoch=editorSession(),owner=currentOwner(),toggle=document.querySelector('#gtToggleBtn');const active=()=>seq===editorSeq&&epoch===editorSession()&&owner===currentOwner()&&editing?.id===task.id&&!document.querySelector('#gtTaskModal').classList.contains('hidden');editorSaving=true;toggle.disabled=true;try{await rt.api(endpoint('delete'),{method:'POST',expectedSessionEpoch:epoch,body:{action:'delete',task_list_id:task.taskListId,task_id:task.id}});if(!active())return;closeEditor();tasksChanged()}catch(e){if(active())document.querySelector('#gtEditStatus').textContent=String(e?.message||e)}finally{if(seq===editorSeq&&epoch===editorSession()&&owner===currentOwner()){editorSaving=false;toggle.disabled=!editorReady}}}
// After a change from the editor: the task view reloads only while it is shown (it reloads on every visit anyway), and open link views refetch.
function tasksChanged(){linkedCache.clear();refreshLinked();if(tasksViewShown())load(true);else fetchedOwner='';window.dispatchEvent(new CustomEvent('kptu:google-tasks-changed'))}
// Completing or reopening shows at once and saves to Google in the background, without reloading the whole list.
// Per task: base is the state Google last confirmed, want is the state last tapped. One save at a time per task; repeated taps
// save only the last wish. A failed save goes back to base. A list load that started before a save finished keeps the saved state.
const withStatus=(t,completed)=>completed?{...t,status:'completed',completed:t.status==='completed'&&t.completed?t.completed:new Date().toISOString()}:{...t,status:'needsAction',completed:null};
// PR 1-보완: a changed row first changes in place (circle fills, check draws, title struck; or the reverse), then fades and moves
// to its new group. While it settles it keeps the place it had before the tap. The save is not delayed by this. A tap during the
// effect stops it. Reduced motion keeps the delay without animation. --gt-t (a negative delay) keeps an effect running when the list re-renders.
const SETTLE_MS=3000,UNDO_SETTLE_MS=600,ARRIVE_MS=200,IN_PLACE_MS=400,isDone=t=>t?.status==='completed';
function stopEffects(){for(const s of settling.values())clearTimeout(s.timer);settling.clear();arriving.clear()}
function showChange(id,before,after,stop=false){const s=settling.get(id);if(s){clearTimeout(s.timer);settling.delete(id)}arriving.delete(id);const from=s?s.before:before,dir=isDone(after)?'on':'off';
if(isDone(from)===isDone(after)){if(!stop&&s)settling.set(id,{before:from,dir,start:Date.now(),stay:true,timer:setTimeout(()=>settling.delete(id),IN_PLACE_MS)});return}
const entry={before:from,dir,start:Date.now()};entry.timer=setTimeout(()=>{if(settling.get(id)!==entry)return;settling.delete(id);notifyState();if(!section()?.querySelector(`#gtTaskBody [data-google-task="${CSS.escape(id)}"]`))return;arriving.set(id,Date.now());renderTasks(lastTasks)},dir==='on'?SETTLE_MS:UNDO_SETTLE_MS);settling.set(id,entry)}
function effectOf(id,now){const s=settling.get(id);if(s)return {cls:s.stay?` gt-anim-${s.dir}`:` gt-settle gt-anim-${s.dir}`,t:now-s.start};const a=arriving.get(id);if(a===undefined)return null;if(now-a>=ARRIVE_MS){arriving.delete(id);return null}return {cls:' gt-arrive',t:now-a}}
function putTask(task,owner){lastTasks=lastTasks.map(t=>t.id===task.id?task:t);const deleting=pendingDeletes.get(task.id);if(deleting)deleting.task=task;if(cacheOwnerId===owner)cacheWrite(owner,lastTasks);renderTasks(lastTasks);notifyState()}
function mergeToggles(tasks,since){for(const [id,s] of savedToggles)if(s.seq<=since)savedToggles.delete(id);return tasks.map(t=>{const p=pendingToggles.get(t.id);if(p)return withStatus(t,p.want);const s=savedToggles.get(t.id);return s?{...s.task,unlinked:t.unlinked}:t})}
// An editor opened during a list toggle follows the confirmed status (including rollback), without touching its draft.
function syncEditorTask(task){if(editing?.id!==task.id)return;editing={...editing,status:task.status,completed:task.completed};document.querySelector('#gtToggleBtn').textContent=task.status==='completed'?'완료 취소':'완료'}
function toggleTask(task){const owner=currentOwner();if(!task||!owner)return;const p=pendingToggles.get(task.id)||{base:task,want:task.status==='completed',busy:false};p.want=task.status!=='completed';pendingToggles.set(task.id,p);setSync('');const next=withStatus(task,p.want);showChange(task.id,task,next,true);putTask(next,owner);syncLinkedTask(next);if(!p.busy)p.saving=saveToggle(task.id,p,sessionEpoch,owner);return p.saving}
async function saveToggle(id,p,epoch,owner){p.busy=true;let failed=null;while((p.base.status==='completed')!==p.want){const want=p.want;try{const d=await rt.api(endpoint('toggle'),{method:'POST',body:{action:'toggle',task_list_id:p.base.taskListId,task_id:id,task_list_title:p.base.taskListTitle,completed:want}});if(!stillCurrent(epoch,owner))return;p.base=d?.task?.id===id?{...d.task,unlinked:p.base.unlinked,projectNames:p.base.projectNames,orgNames:p.base.orgNames}:withStatus(p.base,want)}catch(e){if(!stillCurrent(epoch,owner))return;failed=e;break}}pendingToggles.delete(id);savedToggles.set(id,{task:p.base,seq:++toggleSeq});const shown=lastTasks.find(t=>t.id===id);if(shown&&isDone(shown)!==isDone(p.base))showChange(id,shown,p.base);putTask(p.base,owner);syncLinkedTask(p.base);syncEditorTask(p.base);fetchedOwner='';if(!failed){window.dispatchEvent(new CustomEvent('kptu:google-tasks-changed',{detail:{source:'toggle'}}));return {ok:true}};const msg=String(failed?.message||failed),notice=(p.want?'완료를 저장하지 못해 되돌렸습니다':'완료 취소를 저장하지 못해 되돌렸습니다');if(/TASKS_SCOPE_REQUIRED|권한/.test(msg))renderConnect('Google 할 일을 수정하려면 Google 계정을 다시 연결해 주세요.');else setSync(notice,true);for(const box of linkedBoxes.keys())if(box.isConnected&&box.querySelector(`[data-gt-linked-toggle="${CSS.escape(id)}"]`))linkedMessage(box,notice+' '+errorText(failed));return {ok:false,message:notice+' '+errorText(failed)}}
// Overdue pending tasks (묶음C-4) come first in their own group, oldest due first; then today and tomorrow..+7 days; then every task completed
// in the last 3 days whatever its due date (2026-09-27 decision: completing an overdue or undated task keeps it visible).
const taskMeta=t=>{const date=dueDateKey(t.due)?`<span class="gt-due">${esc(due(t.due))}</span>`:'',names=(t.projectNames||[]).join(', ');return date||names?`<div class="gt-meta">${date}${names?`<span class="gt-project" title="${esc(names)}">${date?' · ':''}${esc(names)}</span>`:''}</div>`:''};
const taskRow=(t,overdue=false,fx=null)=>`<div class="gt-row ${t.status==='completed'?'completed':'pending'}${overdue?' overdue':''}${fx?fx.cls:''}" data-google-task="${esc(t.id)}"${fx?` style="--gt-t:-${Math.max(0,Math.round(fx.t))}ms"`:''}><button class="gt-check" type="button" data-gt-toggle="${esc(t.id)}" aria-label="${t.status==='completed'?'완료 취소':'완료'}"></button><button class="gt-main" type="button" data-gt-edit="${esc(t.id)}"><b>${esc(t.title||'제목 없음')}</b>${taskMeta(t)}</button><button class="icon-btn gt-menu-trigger" type="button" data-gt-menu="${esc(t.id)}" aria-label="할 일 관리: ${esc(t.title||'제목 없음')}" aria-expanded="false" aria-controls="gtTaskMenu">⋯</button>${sourceLink(t.id)}</div>`;
// UI-PC할일: PC(≥1024) card in a due-date column. Same controls and data attributes as taskRow (completion circle, open, ⋯),
// so toggling, the tap effect, the menu and the source link work unchanged; the meta line becomes due date + small link tags.
const tagList=t=>[...(t.projectNames||[]).map(n=>['project',n]),...orgNamesOf(t).map(n=>['org',n])];
const taskCard=(t,overdue=false,fx=null)=>{const date=dueDateKey(t.due)?`<span class="gt-due">${esc(due(t.due))}</span>`:'',tags=tagList(t).map(([kind,n])=>`<span class="gt-tag gt-tag-${kind}" title="${esc(n)}">${esc(n)}</span>`).join('');return `<li class="gt-row gt-card ${t.status==='completed'?'completed':'pending'}${overdue?' overdue':''}${fx?fx.cls:''}" data-google-task="${esc(t.id)}"${fx?` style="--gt-t:-${Math.max(0,Math.round(fx.t))}ms"`:''}><button class="gt-check" type="button" data-gt-toggle="${esc(t.id)}" aria-label="${t.status==='completed'?'완료 취소':'완료'}"></button><button class="gt-main" type="button" data-gt-edit="${esc(t.id)}"><b>${esc(t.title||'제목 없음')}</b>${date||tags?`<span class="gt-meta">${date}${tags}</span>`:''}</button><button class="icon-btn gt-menu-trigger" type="button" data-gt-menu="${esc(t.id)}" aria-label="할 일 관리: ${esc(t.title||'제목 없음')}" aria-expanded="false" aria-controls="gtTaskMenu">⋯</button>${sourceLink(t.id)}</li>`};
// Organization names for the tags: the assigned organizations the editor already offers (loadTargets, cached per owner).
let orgNameMap={owner:'',map:new Map(),loading:false};
function orgNamesOf(t){const ids=t.orgIds||[];if(!ids.length)return[];const owner=currentOwner();if(orgNameMap.owner!==owner&&!orgNameMap.loading){orgNameMap.loading=true;loadTargets().then(targets=>{if(currentOwner()!==owner)return;orgNameMap={owner,map:new Map(targets.orgGroups.flat().map(o=>[o.key.slice(2),o.label])),loading:false};if(tasksViewShown()&&pcColumns())renderTasks(lastTasks)},()=>{orgNameMap.loading=false})}return orgNameMap.owner===owner?ids.map(id=>orgNameMap.map.get(id)).filter(Boolean):[]}
// The two columns. "지남·오늘" joins overdue and today (the home "오늘 할 일" card uses the same due ≤ today rule). "7일 안" ends with two
// fold rows: "나중 N ▸" (later tasks, with the undated ones under their own small heading) and "완료 N ▸" (recent completed). Nothing is dropped.
function columnsHtml({overdue,today,week,later,undated,completed},row,{completedOpen=false,laterOpen=false}={}){
  const cards=(rows,isOverdue=false)=>rows.map(x=>row(x,isOverdue)).join('');
  const col=(id,title,count,inner,extra='')=>`<section class="gt-col" data-gt-col="${id}" aria-labelledby="gt-col-${id}-head"><h3 class="gt-col-head" id="gt-col-${id}-head"><span class="gt-col-name">${title}</span><span class="gt-col-count" aria-label="${count}건">${count}</span></h3><div class="gt-col-body">${inner||'<p class="gt-col-empty">없음</p>'}${extra}</div></section>`;
  // Each bucket keeps its list hook (data-gt-overdue/today/week/later/undated), as in the phone list.
  const list=(id,html)=>html?`<ul class="gt-cards"${id?` data-gt-${id}`:''}>${html}</ul>`:'';
  const now=list('overdue',cards(overdue,true))+list('today',cards(today));
  const undatedCards=undated.length?`<h4 class="gt-col-sub">기한 없음 ${undated.length}</h4>${list('undated',cards(undated))}`:'';
  const laterFold=later.length+undated.length?`<details id="gtLater" class="gt-col-fold gt-later"${laterOpen?' open':''}><summary class="gt-group-head">나중 ${later.length+undated.length} <span class="gt-disclosure">▸</span></summary>${list('later',cards(later))+undatedCards}</details>`:'';
  const doneFold=completed.length?`<details id="gtCompleted" class="gt-completed gt-col-fold gt-col-done"${completedOpen?' open':''}><summary class="gt-group-head">완료 ${completed.length} <span class="gt-disclosure">▸</span></summary>${list('',cards(completed))}</details>`:'';
  return `<div class="gt-cols">${col('now','지남·오늘',overdue.length+today.length,now)+col('week','7일 안',week.length,list('week',cards(week)),laterFold+doneFold)}</div>`;
}
// BASKET-할일출처: task id -> source note id, read once per list load for the signed-in owner.
let sourceNotes={owner:'',map:new Map()};
const sourceNoteOf=id=>sourceNotes.owner&&sourceNotes.owner===currentOwner()?sourceNotes.map.get(id)||'':'';
const sourceLink=id=>{const note=sourceNoteOf(id);return note?`<a class="gt-source" href="${esc(basketNoteHref(note))}" data-gt-source-note="${esc(note)}">출처 업데이트</a>`:''};
// In-app hand-off to the basket; a modified click or a new tab follows the ?note= address.
function openSourceNote(event){
  const id=event.currentTarget.dataset.gtSourceNote;
  if(!id||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  event.preventDefault();
  if(!document.querySelector('#gtTaskModal')?.classList.contains('hidden'))closeEditor();
  requestBasketNote(id,rt);window.KPTURouter?.go('basket',{source:'delegated'});
}
function paintSourceNote(task){
  const box=document.querySelector('#gtSourceNote');if(!box)return;
  const note=task?.id?sourceNoteOf(task.id):'';
  box.classList.toggle('hidden',!note);box.innerHTML=note?`이 할 일은 바구니 업데이트에서 만들었습니다. <a href="${esc(basketNoteHref(note))}" data-gt-source-note="${esc(note)}">출처 업데이트</a>`:'';
  box.querySelector('[data-gt-source-note]')?.addEventListener('click',openSourceNote);
}
async function loadSourceNotes(owner,epoch){
  const map=await readTaskSourceNotes({rt});
  if(!stillCurrent(epoch,owner))return false;
  sourceNotes={owner,map};return true;
}
// A task opened from its source note's list: open its editor once this load has the task.
function openRequestedTask(){
  const id=takeTaskOpenRequest(rt);if(!id||!tasksViewShown())return;
  const task=lastTasks.find(t=>t.id===id);
  if(task)openEditor(task,{docked:true});else setSync('이 할 일을 목록에서 찾지 못했습니다. 완료한 지 오래됐거나 삭제됐을 수 있습니다.',true);
}
// "나중 N ▸" open state survives the fold vanishing for a moment (delete, then undo): remembered here, reset when the screen is entered again.
let laterWasOpen=false;
// Settling rows keep their previous bucket for the existing three-second effect.
function renderTasks(tasks){
  const body=section()?.querySelector('#gtTaskBody');if(!body)return;
  if(taskMenu?.active){taskRenderPending=true;return;}
  const focusId=body.contains(document.activeElement)?document.activeElement.dataset?.gtToggle:'',focusEdit=body.contains(document.activeElement)?document.activeElement.dataset?.gtEdit:'',focusMenu=body.contains(document.activeElement)?document.activeElement.dataset?.gtMenu:'',completedOpen=body.querySelector('#gtCompleted')?.open===true,laterFold=body.querySelector('#gtLater'),laterOpen=laterFold?laterFold.open===true:laterWasOpen;
  const now=Date.now(),items=tasks.filter(t=>!pendingDeletes.has(t.id)&&!deletedTombstones.has(t.id)).map(t=>({t,p:settling.get(t?.id)?.before||t})),row=(x,overdue=false)=>taskRow(x.t,overdue,effectOf(x.t.id,now)),pending=items.filter(x=>!isDone(x.p)),overdue=pending.filter(x=>isOverdue(x.p,now)).sort((a,b)=>byDue(a.p,b.p)),today=pending.filter(x=>dueDateKey(x.p.due)===dayKey(now)).sort((a,b)=>byDue(a.p,b.p)),week=pending.filter(x=>inSevenDayWindow(x.p,now)).sort((a,b)=>byDue(a.p,b.p)),later=allPendingConfirmed?pending.filter(x=>dueDateKey(x.p.due)>kstDateKey(7,now)).sort((a,b)=>byDue(a.p,b.p)):[],undated=allPendingConfirmed?pending.filter(x=>!dueDateKey(x.p.due)):[],completed=items.filter(x=>isDone(x.p)&&completedRecently(x.p,now)).sort((a,b)=>(Date.parse(b.p.completed||'')||0)-(Date.parse(a.p.completed||'')||0));
  const count=items.filter(x=>!isDone(x.t)).length;document.querySelector('[data-gt-count]').textContent=`할 일 ${count}개`;document.querySelector('#gtTaskSection .gt-head-left').classList.toggle('hidden',pending.length===0);
  const pc=pcColumns()&&!unlinkedOnly;section()?.classList.toggle('gt-pc',pc);
  if(pc){body.className='gt-list gt-board';const openId=isDocked()&&!document.querySelector('#gtTaskModal').classList.contains('hidden')?editing?.id:'',has=rows=>!!openId&&rows.some(x=>x.t.id===openId);body.innerHTML=columnsHtml({overdue,today,week,later,undated,completed},(x,overdue=false)=>taskCard(x.t,overdue,effectOf(x.t.id,now)),{completedOpen:completedOpen||has(completed),laterOpen:laterOpen||has(later)||has(undated)});laterWasOpen=!!body.querySelector('#gtLater')?.open||(!body.querySelector('#gtLater')&&laterOpen)}else{
  const group=(id,title,rows)=>rows.length?`<div class="gt-group${id==='overdue'?' gt-overdue':''}" data-gt-${id} role="group" aria-labelledby="gt-${id}-head"><h4 id="gt-${id}-head" class="gt-group-head">${title} ${rows.length}</h4>${rows.map(x=>row(x,id==='overdue')).join('')}</div>`:'';
  body.className='gt-list';body.innerHTML=(pending.length?'':'<div class="gt-status">할 일이 없습니다</div>')+group('overdue','기한 지남',overdue)+group('today','오늘',today)+group('week','7일 안',week)+group('later','나중',later)+group('undated','기한 없음',undated)+(completed.length?`<details id="gtCompleted" class="gt-group gt-completed"${completedOpen?' open':''}><summary class="gt-group-head">완료 ${completed.length} <span class="gt-disclosure">▸</span></summary>${completed.map(x=>row(x)).join('')}</details>`:'');}
  if(unlinkedOnly){section()?.classList.remove('gt-pc');const unlinked=pending.filter(x=>x.t.unlinked);body.innerHTML=`<div class="gt-group-head" tabindex="-1" data-gt-unlinked-heading>연결 안 된 할 일 ${unlinked.filter(x=>!isDone(x.t)).length} <button type="button" data-gt-show-all>전체 보기 ›</button></div>${unlinked.map(x=>row(x,isOverdue(x.p,now))).join('')}`;body.querySelector('[data-gt-show-all]').onclick=()=>{unlinkedOnly=false;renderTasks(lastTasks)}}
  body.querySelectorAll('[data-gt-toggle]').forEach(b=>b.onclick=()=>toggleTask(lastTasks.find(t=>t.id===b.dataset.gtToggle)));
  body.querySelectorAll('[data-gt-edit]').forEach(b=>b.onclick=()=>{const task=lastTasks.find(t=>t.id===b.dataset.gtEdit);if(task)openEditor(task,{docked:pc})});
  body.querySelectorAll('[data-gt-menu]').forEach(b=>b.onclick=()=>taskMenu.open(b));
  body.querySelectorAll('[data-gt-source-note]').forEach(a=>a.onclick=openSourceNote);
  if(focusMenu){const target=body.querySelector(`[data-gt-menu="${CSS.escape(focusMenu)}"]`);(target?.getClientRects().length?target:focusFallback())?.focus({preventScroll:true});}
  if(focusId)body.querySelector(`[data-gt-toggle="${CSS.escape(focusId)}"]`)?.focus({preventScroll:true});
  if(focusEdit)body.querySelector(`[data-gt-edit="${CSS.escape(focusEdit)}"]`)?.focus({preventScroll:true});
  // A task open in the pane that is no longer listed (deleted elsewhere, or older than the 3-day completed window) closes the pane.
  if(isDocked()&&editing?.id&&!document.querySelector('#gtTaskModal').classList.contains('hidden')&&(!pc||!body.querySelector(`[data-gt-edit="${CSS.escape(editing.id)}"]`)))closeEditor();
  paintSelection();
}

const DELETE_DELAY_MS=5000;
function renderUndo(){const box=document.querySelector('#gtUndoDeletes');if(!box)return;box.innerHTML=[...pendingDeletes].filter(([,s])=>!s.committing).map(([id,s])=>`<div class="gt-undo-item"><span>${esc(s.task.title||'제목 없음')} 삭제 대기</span><button type="button" data-gt-undo="${esc(id)}">되돌리기</button></div>`).join('');box.querySelectorAll('[data-gt-undo]').forEach(b=>b.onclick=()=>undoDelete(b.dataset.gtUndo))}
function keepDeletingTasks(tasks){const next=[...tasks];for(const [id,s] of [...pendingDeletes].sort((a,b)=>a[1].index-b[1].index)){const at=next.findIndex(t=>t.id===id);if(at>=0)next[at]=s.task;else next.splice(Math.min(s.index,next.length),0,s.task)}return next}
function undoDelete(id){const s=pendingDeletes.get(id);if(!s||s.committing)return;clearTimeout(s.timer);pendingDeletes.delete(id);renderTasks(lastTasks);renderUndo();document.querySelector(`#gtTaskBody [data-gt-menu="${CSS.escape(id)}"]`)?.focus({preventScroll:true})}
function cancelPendingDeletes(){for(const [id,s] of pendingDeletes){if(s.committing)continue;clearTimeout(s.timer);pendingDeletes.delete(id)}renderUndo()}
function queueDelete(id){const task=lastTasks.find(t=>t.id===id),owner=currentOwner();if(!task||!owner||pendingDeletes.has(id))return;const effect=settling.get(id);if(effect)clearTimeout(effect.timer);settling.delete(id);arriving.delete(id);const state={task,index:lastTasks.findIndex(t=>t.id===id),owner,epoch:sessionEpoch,committing:false,timer:null};pendingDeletes.set(id,state);state.timer=setTimeout(()=>void finishDelete(id,state),DELETE_DELAY_MS);renderTasks(lastTasks);renderUndo();document.querySelector(`#gtUndoDeletes [data-gt-undo="${CSS.escape(id)}"]`)?.focus({preventScroll:true})}
// TASK-삭제유지: the wait runs to the end on any screen or tab; only [되돌리기] (or another account) cancels it.
// Closing the page drops the wait (pagehide below): a delete sent from a closing page cannot be confirmed, so the task stays.
async function finishDelete(id,state){if(pendingDeletes.get(id)!==state)return;state.committing=true;renderUndo();await pendingToggles.get(id)?.saving;if(pendingDeletes.get(id)!==state||!stillCurrent(state.epoch,state.owner)){pendingDeletes.delete(id);return}try{await rt.api(endpoint('delete'),{method:'POST',body:{action:'delete',task_list_id:state.task.taskListId,task_id:id}});if(!stillCurrent(state.epoch,state.owner))return;deletedTombstones.add(id);lastTasks=lastTasks.filter(t=>t.id!==id);cacheWrite(state.owner,lastTasks);linkedCache.clear();refreshLinked()}catch{if(stillCurrent(state.epoch,state.owner)){if(tasksViewShown())setSync('삭제하지 못해 되돌렸습니다',true);else toast('할 일을 삭제하지 못해 되돌렸습니다.')}}finally{if(pendingDeletes.get(id)===state)pendingDeletes.delete(id);if(stillCurrent(state.epoch,state.owner)){renderTasks(lastTasks);notifyState()}}}
function renderConnect(message='Google 할 일을 함께 보려면 Google Tasks 권한을 연결해 주세요.'){const body=section()?.querySelector('#gtTaskBody');if(!body)return;section().classList.remove('gt-pc');if(isDocked())closeEditor();body.className='gt-status';body.innerHTML=`<div>${esc(message)}</div><button class="secondary gt-connect gt-reconnect" type="button" data-gt-connect>Google 할 일 권한 다시 연결</button>`;body.querySelector('[data-gt-connect]').onclick=connect}
function appendRetry(el){const button=document.createElement('button');button.type='button';button.className='mini gt-retry';button.dataset.gtRetry='';button.textContent='다시 시도';button.onclick=()=>load(true);el.append(button)}
function renderError(message,retry=false){const body=section()?.querySelector('#gtTaskBody');if(body){section().classList.remove('gt-pc');if(isDocked())closeEditor();body.className='gt-status';body.innerHTML=`<span class="gt-error" role="status">${esc(message)}</span>`;if(retry)appendRetry(body)}}
async function connect(){const epoch=sessionEpoch;let owner='';try{if(!rt?.session||!(await rt.session.ensure())||epoch!==sessionEpoch)return;owner=currentOwner();if(!owner)return;const params=new URLSearchParams(location.search),platform=/KPTUAndroid/i.test(navigator.userAgent)||params.get('native')==='android'?'android':'web',d=await rt.api(endpoint('start')+'&platform='+platform);if(!stillCurrent(epoch,owner))return;if(d?.url)location.href=d.url;else throw new Error('Google 권한 연결 주소를 받지 못했습니다.')}catch(e){if(stillCurrent(epoch,owner))renderError(e.message||String(e))}}
function setSync(text='',failed=false,retry=false){const el=document.querySelector('#gtTaskSection [data-gt-sync]');if(!el)return;el.textContent=text;if(text)el.closest('.gt-head-left')?.classList.remove('hidden');el.style.color=failed?'var(--kptu-danger)':'';if(retry)appendRetry(el)}
// action=overview combines status and tasks. An older google-tasks Edge answers "Unknown action", so fall back to status then tasks.
async function fetchOverview(fresh=false,expectedSessionEpoch=null){const options={...(fresh?{singleFlight:false}:{}),...(expectedSessionEpoch==null?{}:{expectedSessionEpoch})};if(!overviewUnsupported){try{return await rt.api(endpoint('overview')+'&pending_scope=all',options)}catch(e){if(!(e?.status===400&&/Unknown action/i.test(String(e?.message||''))))throw e;overviewUnsupported=true}}const status=await rt.api(endpoint('status'),options);if(status?.needs_reconnect||status?.authorized===false)return {...status,tasks:[]};const d=await rt.api(endpoint('tasks')+'&pending_scope=all',options);return d?.needs_reconnect?{connected:true,authorized:false,needs_reconnect:true,warning:d.warning,tasks:[]}:{connected:true,authorized:true,needs_reconnect:false,error:d?.error,tasks:d?.tasks||[],pending_scope:d?.pending_scope}}
// The overview contains Google task data but no link rows. Read only confirmed project/organization links through the existing owner-scoped RLS endpoint.
async function readLinks(tasks){const ids=[...new Set(tasks.map(t=>t.id).filter(Boolean))],rows=[];for(let i=0;i<ids.length;i+=50){const query=ids.slice(i,i+50).map(encodeURIComponent).join(',');rows.push(...await rt.api(`/rest/v1/app_record_links?google_task_id=in.(${query})&status=eq.confirmed&select=google_task_id,project_id,organization_id,meeting_id,status`))}return rows}
// Shared display enrichment for this screen and calendarDayModal only. Organization/meeting links do not display as project names.
async function describeTasks(tasks){
  const epoch=sessionEpoch,owner=currentOwner(),rows=await readLinks(tasks),linked=new Set(rows.filter(row=>row.project_id||row.organization_id).map(row=>row.google_task_id));
  const snapshot=rows.some(row=>row.project_id)?await window.KPTUProjectCatalog?.load?.({workspaceId:workspaceOf(),userId:owner}):null;
  if(!stillCurrent(epoch,owner))throw new Error('session changed');
  const projects=new Map((snapshot?.projects||[]).map(p=>[p.id,p.name]));
  return tasks.map(t=>({...t,unlinked:!linked.has(t.id),projectNames:[...new Set(rows.filter(row=>row.google_task_id===t.id&&row.project_id).map(row=>projects.get(row.project_id)).filter(Boolean))],orgIds:[...new Set(rows.filter(row=>row.google_task_id===t.id&&row.organization_id).map(row=>row.organization_id))]}));
}

// Reserve this session's load before awaiting readiness so rapid route changes share one fetch.
async function load(force=false){
  const epoch=sessionEpoch;
  if(loadingEpoch===epoch)return;
  const seq=++loadSeq;
  const sec=section();if(!sec)return;
  loadingEpoch=epoch;
  let owner=currentOwner(),prev=!!owner&&shownOwner===owner;
  try{
    if(!rt?.session||!(await rt.session.ensure())||epoch!==sessionEpoch)return;
    owner=currentOwner();if(!owner)return;
    rt.ownerCache?.clear?.(owner);cacheDropOld(owner);
    if(!force&&fetchedOwner===owner){renderTasks(lastTasks);return}
    if(shownOwner!==owner){const cached=cacheRead(owner);if(cached){lastTasks=cached;cacheOwnerId=owner;shownOwner=owner}}
    prev=shownOwner===owner;
    const body=sec.querySelector('#gtTaskBody');
    if(prev){renderTasks(lastTasks);setSync('새로 받는 중…')}
    else if(body){setSync('');body.className='gt-status';body.textContent='Google 할 일을 불러오는 중…'}
    const since=toggleSeq,d=await fetchOverview();
    if(!stillCurrent(epoch,owner))return;
    if(d?.connected===false||d?.needs_reconnect||d?.authorized===false){
      lastTasks=[];cacheOwnerId=owner;shownOwner='';fetchedOwner='';cacheDrop(owner);setSync('');
      renderConnect(d?.connected===false?'Google 계정을 연결하면 Google 할 일을 함께 관리할 수 있습니다.':(d?.warning||'기존 Google 연결에 Google Tasks 수정 권한이 없습니다. 한 번 다시 연결해 주세요.'));return
    }
    if(d?.error)throw new Error(d.error);
    const fresh=d?.tasks||[];for(const id of deletedTombstones)if(!fresh.some(t=>t.id===id))deletedTombstones.delete(id);
    allPendingConfirmed=d?.pending_scope==='all';
    lastTasks=keepDeletingTasks(mergeToggles(fresh.filter(t=>!deletedTombstones.has(t.id)).map(t=>({...t,unlinked:false})),since));cacheOwnerId=owner;shownOwner=owner;fetchedOwner=owner;
    cacheWrite(owner,lastTasks);setSync('');renderTasks(lastTasks);
    if(loadSeq===seq)loadingEpoch=-1;
    // Source notes: one owner-scoped query per load. A failure only hides the links.
    void loadSourceNotes(owner,epoch).then(changed=>{if(changed&&seq===loadSeq)renderTasks(lastTasks)},()=>{}).finally(()=>{if(seq===loadSeq&&stillCurrent(epoch,owner))openRequestedTask()});
    try{const decorated=await describeTasks(fresh);if(seq!==loadSeq||!stillCurrent(epoch,owner))return;lastTasks=lastTasks.map(t=>{const d=decorated.find(x=>x.id===t.id);return {...t,unlinked:d?.unlinked||false,projectNames:d?.projectNames||[],orgIds:d?.orgIds||[]}});cacheWrite(owner,lastTasks);renderTasks(lastTasks)}catch{if(seq===loadSeq&&stillCurrent(epoch,owner))setSync('연결 표시를 확인하지 못했습니다.',true)}
  }catch(e){
    if(seq!==loadSeq||!stillCurrent(epoch,owner))return;
    const msg=String(e?.message||e);
    if(/연결되지|재인증|TASKS_SCOPE_REQUIRED|권한/i.test(msg)){shownOwner='';fetchedOwner='';cacheDrop(owner);setSync('');renderConnect(msg)}
    else if(prev)setSync('새로 받지 못했습니다 · 직전 결과 표시 중',true,true);
    else renderError('Google 할 일을 불러오지 못했습니다.',true)
  }finally{if(seq===loadSeq)loadingEpoch=-1}
}
// Tasks linked to one project (plan 4.1-5, decision 3): every pending one and those completed in the last 3 days, which the Edge reads
// from Google by id. A result is reused for a minute, so re-rendering the project detail does not ask Google again.
const LINKED_FRESH_MS=60*1000,linkedCache=new Map(),linkedBoxes=new Map();
function syncLinkedTask(task){for(const hit of linkedCache.values())if(hit.owner===currentOwner())hit.tasks=hit.tasks.map(t=>t.id===task.id?{...task,unlinked:t.unlinked}:t);for(const [box,s] of linkedBoxes)if(box.isConnected&&linkedCache.get(linkKey(s.target))?.tasks.some(t=>t.id===task.id))renderLinked(box)}
const linkedQuery=t=>t.project_id?'&project_id='+encodeURIComponent(t.project_id):'&organization_id='+encodeURIComponent(t.organization_id);
async function mountLinked(box,target,opts={}){if(!box||!target)return;for(const b of linkedBoxes.keys())if(!b.isConnected)linkedBoxes.delete(b);const key=linkKey(target),owner=currentOwner(),epoch=sessionEpoch,seq=(linkedBoxes.get(box)?.seq||0)+1;linkedBoxes.set(box,{target,opts,seq});const hit=linkedCache.get(key);if(hit&&hit.owner===owner&&Date.now()-hit.at<LINKED_FRESH_MS){renderLinked(box);return}box.className='gt-linked gt-status';box.textContent='Google 할 일을 불러오는 중…';try{const d=await rt.api(endpoint('linked')+linkedQuery(target));if(linkedBoxes.get(box)?.seq!==seq||!stillCurrent(epoch,owner))return;linkedCache.set(key,{owner,at:Date.now(),tasks:d?.tasks||[]});renderLinked(box)}catch(e){if(linkedBoxes.get(box)?.seq!==seq||!stillCurrent(epoch,owner))return;box.className='gt-linked gt-status';box.innerHTML=`<span class="gt-error">${esc(errorText(e))}</span>`}}
function refreshLinked(){for(const [b,s] of linkedBoxes){if(!b.isConnected){linkedBoxes.delete(b);continue}mountLinked(b,s.target,s.opts)}}
function renderLinked(box){const s=linkedBoxes.get(box);if(!s)return;const tasks=linkedCache.get(linkKey(s.target))?.tasks||[],focusId=box.contains(document.activeElement)?document.activeElement.dataset?.gtLinkedToggle:'';s.opts.onCount?.(tasks.filter(t=>!isDone(t)).length);if(!tasks.length){box.className='gt-linked gt-status';box.textContent='연결된 Google 할 일이 없습니다.';return}box.className='gt-linked gt-list';box.innerHTML=tasks.map(t=>{const title=esc(t.title||'제목 없음');return `<div class="gt-row ${isDone(t)?'completed':'pending'} gt-side-row${isOverdue(t)?' overdue':''}" data-google-task="${esc(t.id)}"><button class="gt-check" type="button" data-gt-linked-toggle="${esc(t.id)}" aria-label="${isDone(t)?'완료 취소':'완료'}"></button><button class="gt-main" type="button" data-gt-linked-edit="${esc(t.id)}"><b>${title}</b><div class="gt-meta"><span class="gt-due">${esc(due(t.due))}</span>${t.notes?`<span>${esc(t.notes)}</span>`:''}</div></button><button class="mini" type="button" data-gt-linked-unlink="${esc(t.id)}" aria-label="${title} 연결 해제">연결 해제</button></div>`}).join('')+'<div class="gt-linked-msg" data-gt-linked-msg role="status" aria-live="polite"></div>';const find=id=>tasks.find(t=>t.id===id);box.querySelectorAll('[data-gt-linked-toggle]').forEach(b=>b.onclick=()=>toggleLinked(box,find(b.dataset.gtLinkedToggle)));box.querySelectorAll('[data-gt-linked-edit]').forEach(b=>b.onclick=()=>openEditor(find(b.dataset.gtLinkedEdit)));box.querySelectorAll('[data-gt-linked-unlink]').forEach(b=>b.onclick=()=>unlinkFrom(box,find(b.dataset.gtLinkedUnlink)));if(focusId)box.querySelector(`[data-gt-linked-toggle="${CSS.escape(focusId)}"]`)?.focus({preventScroll:true})}
function linkedMessage(box,text){const el=box.querySelector('[data-gt-linked-msg]');if(el)el.innerHTML=`<span class="gt-error">${esc(text)}</span>`}
// Completing here shows at once; a failed save goes back and says so. One save at a time per task.
function toggleLinked(box,t){if(!linkedBoxes.has(box)||!t)return;toggleTask(t)}
async function unlinkFrom(box,t){const s=linkedBoxes.get(box);if(!s||!t)return;const btn=box.querySelector(`[data-gt-linked-unlink="${CSS.escape(t.id)}"]`);if(btn)btn.disabled=true;try{await rt.api(endpoint('unlink'),{method:'POST',body:{action:'unlink',task_id:t.id,links:[s.target]}});const hit=linkedCache.get(linkKey(s.target));if(hit)hit.tasks=hit.tasks.filter(x=>x.id!==t.id);renderLinked(box);if(tasksViewShown())load(true)}catch(e){if(btn)btn.disabled=false;linkedMessage(box,'연결을 해제하지 못했습니다. '+errorText(e))}}
// Linking an existing task from a project (decision 6): the picker offers the unlinked pending tasks. A task already linked elsewhere
// gets more links from its editor.
let pickTarget=null,pickSeq=0,pickTasks=[];const pickDone=new Set();
function ensurePicker(){let m=document.querySelector('#gtPickModal');if(m)return m;document.body.insertAdjacentHTML('beforeend','<div id="gtPickModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="gtPickHeading"><div class="modal-card small-card"><div class="modal-head"><div><h2 id="gtPickHeading">기존 할 일 연결</h2></div><button class="icon-btn" data-gt-pick-close type="button" aria-label="닫기">×</button></div><p class="gt-scope-note">연결하지 않은 미완료 할 일입니다. 다른 프로젝트·조직에 연결된 할 일은 수정 창에서 연결을 추가하세요.</p><div id="gtPickBody" class="gt-status"></div><div class="gt-linked-msg" data-gt-pick-msg role="status" aria-live="polite"></div></div></div>');m=document.querySelector('#gtPickModal');m.querySelector('[data-gt-pick-close]').onclick=closePicker;return m}
function closePicker(){const m=document.querySelector('#gtPickModal');if(!m||m.classList.contains('hidden'))return;pickSeq++;m.classList.add('hidden');m.setAttribute('aria-hidden','true');window.KPTUA11y?.dialog.deactivate(m,{restoreFocus:true});pickTarget=null}
async function openLinkPicker(target){if(!target)return;const m=ensurePicker(),seq=++pickSeq,epoch=sessionEpoch,owner=currentOwner(),body=m.querySelector('#gtPickBody');pickTarget=target;pickTasks=[];pickDone.clear();m.querySelector('[data-gt-pick-msg]').textContent='';body.className='gt-status';body.textContent='연결 안 된 할 일을 불러오는 중…';m.classList.remove('hidden');m.setAttribute('aria-hidden','false');window.KPTUA11y?.dialog.activate(m,{trigger:document.activeElement,initialFocus:'[data-gt-pick-close]',onRequestClose:closePicker});try{const d=await rt.api(endpoint('unlinked'));if(seq!==pickSeq||!stillCurrent(epoch,owner))return;pickTasks=d?.tasks||[];renderPicker()}catch(e){if(seq!==pickSeq)return;body.innerHTML=`<span class="gt-error">${esc(errorText(e))}</span>`}}
function renderPicker(){const body=document.querySelector('#gtPickBody');if(!body)return;if(!pickTasks.length){body.className='gt-status';body.textContent='연결할 수 있는 할 일이 없습니다.';return}body.className='gt-list';body.innerHTML=pickTasks.map(t=>{const done=pickDone.has(t.id);return `<div class="gt-row pending gt-side-row${isOverdue(t)?' overdue':''}"><div class="gt-main"><b>${esc(t.title||'제목 없음')}</b><div class="gt-meta"><span class="gt-due">${esc(due(t.due))}</span></div></div><button class="mini" type="button" data-gt-pick="${esc(t.id)}"${done?' disabled':''} aria-label="${esc(t.title||'제목 없음')} ${done?'연결됨':'연결'}">${done?'연결됨':'연결'}</button></div>`}).join('');body.querySelectorAll('[data-gt-pick]').forEach(b=>b.onclick=()=>pickLink(b))}
async function pickLink(btn){const target=pickTarget,id=btn.dataset.gtPick,seq=pickSeq;if(!target||!id||pickDone.has(id))return;btn.disabled=true;try{await rt.api(endpoint('link'),{method:'POST',body:{action:'link',task_id:id,links:[target]}});pickDone.add(id);linkedCache.delete(linkKey(target));refreshLinked();if(tasksViewShown())load(true);if(seq===pickSeq)renderPicker()}catch(e){btn.disabled=false;const msg=document.querySelector('#gtPickModal [data-gt-pick-msg]');if(msg&&seq===pickSeq)msg.innerHTML=`<span class="gt-error">연결하지 못했습니다. ${esc(errorText(e))}</span>`}}
// UI-할일입력: the [할 일] screen adds tasks through its always-visible input (no [+]). It is the shared quick input
// (home-quick.js, the same box as the basket memo input) in its [할 일] mode: same Google create path, due today, no DB change.
// Mounted the first time the screen is shown, so other screens that load this module do not load the input.
// With no [+] to return to, focus goes to the count (or the input's [추가]); never the text box, which would open the phone keyboard.
let quickMount=null;
function focusFallback(){const count=document.querySelector('#gtTaskSection [data-gt-count]');return count?.getClientRects().length?count:document.querySelector('#tasksView [data-quick-save]')}
function mountQuickInput(){
  if(quickMount||!document.querySelector('#tasksView > .home-quick-placeholder'))return quickMount;
  quickMount=import('./home-quick.js').then(({mountQuick})=>mountQuick({root:document.querySelector('#tasksView'),dependencies:{},refreshTasks:tasksChanged,esc,taskOnly:true,view:'tasks',idPrefix:'tasks'})).catch(e=>{quickMount=null;console.error(e)});
  return quickMount;
}
async function boot(){section();ensureModal();window.KPTURouter?.on?.('tasks',()=>{void mountQuickInput();unlinkedOnly=false;document.querySelector('#gtCompleted')?.removeAttribute('open');document.querySelector('#gtLater')?.removeAttribute('open');laterWasOpen=false;load(true)});window.addEventListener('kptu:view-changed',e=>{if(e.detail?.view!=='tasks'){taskMenu?.close();closeScope();if(isDocked())closeEditor()}});PC?.addEventListener?.('change',()=>{if(isDocked())closeEditor();if(tasksViewShown())renderTasks(lastTasks)});document.addEventListener('keydown',e=>{if(e.key!=='Escape'||e.defaultPrevented||!isDocked())return;const m=document.querySelector('#gtTaskModal');if(m.classList.contains('hidden')||!m.contains(e.target))return;e.preventDefault();closeEditor()});window.addEventListener('pagehide',cancelPendingDeletes);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&tasksViewShown())renderTasks(lastTasks)});window.addEventListener('focus',()=>{if(tasksViewShown())load(true)});window.addEventListener('kptu:session-changed',e=>{if(editorRuntimeEpoch===rt.session.epoch())return;editorRuntimeEpoch=rt.session.epoch();sessionEpoch++;editorSeq++;editorRequest=null;editorSaving=false;createAttempt=null;uncertainTasks.clear();pendingEditors.clear();closeEditor();document.querySelector('#gtSaveBtn').disabled=false;taskMenu?.close();closeScope();cancelPendingDeletes();pendingDeletes.clear();deletedTombstones.clear();lastTasks=[];pendingToggles.clear();savedToggles.clear();stopEffects();cacheOwnerId='';shownOwner='';fetchedOwner='';allPendingConfirmed=false;linkTargets=null;orgNameMap={owner:'',map:new Map(),loading:false};editorSeq++;linkedCache.clear();closePicker();document.querySelector('#gtTaskSection')?.remove();if(e.detail?.session&&tasksViewShown())queueMicrotask(()=>load(true))});window.addEventListener('kptu:project-catalog-updated',()=>{linkTargets=null;orgNameMap={owner:'',map:new Map(),loading:false}});
  // The project view loads this module too (PR 4), so the task list is read only while the task view is shown; the route hook reads it on each visit.
  if(tasksViewShown()){void mountQuickInput();await load(false)}}
// Read-only task list for other screens (CAL-할일 calendar; later the new home, D-4). Neither call changes this view's list, its
// Google. The home opts into publish to share the current task state and device copy. peekTasks() returns this device's last task-view copy; listTasks() reads the same overview as this view
// (every pending task, completed in the last 3 days). Taps not yet saved and deletes waiting for undo show as this view shows them.
// status is 'ok', or 'disconnected' when Google is not connected or lacks the Tasks permission; other failures throw.
const shownState=tasks=>tasks.filter(t=>!pendingDeletes.has(t.id)&&!deletedTombstones.has(t.id)).map(t=>{const p=pendingToggles.get(t.id);return p?withStatus(t,p.want):{...t}});
function peekTasks(){const owner=currentOwner(),k=gtCacheKey(owner);if(!k)return null;try{const v=JSON.parse(localStorage.getItem(k)||'null'),tasks=cacheRead(owner);return tasks?{owner,savedAt:Number(v?.savedAt||0),tasks:shownState(tasks)}:null}catch{return null}}
let publishedReadSeq=0;
async function listTasks({publish=false,fresh=false}={}){const owner=currentOwner(),epoch=sessionEpoch,since=toggleSeq,readSeq=publish?++publishedReadSeq:0;if(!owner)return {owner:'',status:'disconnected',tasks:[]};let d;try{d=await fetchOverview(fresh)}catch(e){if(/연결되지|재인증|TASKS_SCOPE_REQUIRED|권한/i.test(String(e?.message||e))&&stillCurrent(epoch,owner))return {owner,status:'disconnected',tasks:[]};throw e}if(!stillCurrent(epoch,owner))throw new Error('session changed');if(d?.connected===false||d?.needs_reconnect||d?.authorized===false)return {owner,status:'disconnected',tasks:[]};if(d?.error)throw new Error(d.error);const tasks=shownState(mergeToggles(d?.tasks||[],since));if(publish&&readSeq===publishedReadSeq){lastTasks=tasks;cacheOwnerId=shownOwner=owner;allPendingConfirmed=d?.pending_scope==='all';cacheWrite(owner,tasks);renderTasks(tasks)}return {owner,status:'ok',tasks}}
// Used by the project detail (TASK-구현 PR 4) and the calendar (CAL-할일). The date rules are shared so other screens judge dates as this view does.
// UI-할일조작통일: delete from another screen (the calendar date list) with the same Edge call as the editor's [삭제]. The caller asks first.
// It waits for a toggle still being saved, and answers {ok:true} or {ok:false,message} so the caller can keep or restore its row.
async function deleteTask(task){
  const id=task?.id,owner=currentOwner(),epoch=sessionEpoch;
  if(!id||!owner||pendingDeletes.has(id))return {ok:false,message:'할 일을 삭제하지 못했습니다.'};
  try{
    await pendingToggles.get(id)?.saving;
    if(!stillCurrent(epoch,owner))return {ok:false,message:'로그인 정보가 바뀌어 삭제하지 않았습니다.'};
    await rt.api(endpoint('delete'),{method:'POST',body:{action:'delete',task_list_id:task.taskListId||lastTasks.find(t=>t.id===id)?.taskListId,task_id:id}});
  }catch(e){return {ok:false,message:'할 일을 삭제하지 못했습니다.'}}
  if(stillCurrent(epoch,owner)){deletedTombstones.add(id);lastTasks=lastTasks.filter(t=>t.id!==id);cacheWrite(owner,lastTasks);tasksChanged()}
  return {ok:true};
}
window.KPTUGoogleTasks={deleteTask,invalidateAfterCreate:()=>{linkedCache.clear();fetchedOwner='';},openEditor:(task=null,opts={})=>openEditor(task,opts),mountLinked,openLinkPicker,toggleTask,waitForPendingToggles:()=>Promise.allSettled([...pendingToggles.values()].map(p=>p.saving).filter(Boolean)),peekTasks,listTasks,readLinks,describeTasks,taskMeta,subscribe:fn=>{stateListeners.add(fn);return()=>stateListeners.delete(fn)},taskState:id=>({task:lastTasks.find(t=>t.id===id),place:settling.get(id)?.before}),showUnlinked:()=>{unlinkedOnly=true;renderTasks(lastTasks);const heading=document.querySelector('[data-gt-unlinked-heading]');heading?.focus({preventScroll:true});heading?.scrollIntoView({block:'start'})},dueDateKey,completedRecently,isOverdue};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>boot().catch(console.error),{once:true});else boot().catch(console.error);
})();
