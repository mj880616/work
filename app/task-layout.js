(()=>{
'use strict';
const rt=window.KPTURuntime;if(!rt)return;
let userId='',workspaceId='',projects=[],tasks=[],editing=null,installed=false,renderingEpoch=-1,sessionEpoch=0;
const openState=new Map();
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=(p,o={})=>rt.api(p,o);
const due=v=>{if(!v)return'기한 미정';const d=new Date(v);return d.toLocaleDateString('ko-KR',{month:'numeric',day:'numeric',weekday:'short'})};
const dateValue=v=>{if(!v)return'';const d=new Date(v);if(Number.isNaN(d.getTime()))return'';const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`};
const projectName=id=>projects.find(x=>x.id===id)?.name||'';
const canDelete=t=>t?.created_by===userId;
function toast(msg){const t=$('#toast');if(!t)return;t.textContent=msg;t.classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.add('hidden'),2200)}
function root(){const r=$('#taskList');if(r)r.classList.add('tl-task-list');return r}
function rememberOpen(){root()?.querySelectorAll('details[data-tl-state]').forEach(d=>openState.set(d.dataset.tlState,d.open))}
function stateOpen(key,fallback){return openState.has(key)?openState.get(key):fallback}
function card(t){return window.KPTUTaskRowView.render({...t,dueLabel:due(t.due_at)},{scope:'tl',context:projectName(t.project_id),canDelete:canDelete(t)})}
function group(key,title,rows){const pending=rows.filter(t=>t.status!=='done'),done=rows.filter(t=>t.status==='done'),pendingKey=`${key}:pending`,doneKey=`${key}:done`;return `<section class="tl-task-section" data-tl-section="${key}"><div class="tl-section-head"><h3>${esc(title)}</h3><span>${rows.length}건</span></div><details class="tl-status-group tl-incomplete" data-tl-state="${pendingKey}" ${stateOpen(pendingKey,true)?'open':''}><summary><span>미완료된 할 일</span><b>${pending.length}</b></summary><div class="tl-open-list">${pending.length?pending.map(card).join(''):'<div class="empty compact">미완료된 할 일이 없습니다.</div>'}</div></details><details class="tl-status-group tl-completed" data-tl-state="${doneKey}" ${stateOpen(doneKey,false)?'open':''}><summary><span>완료된 할 일</span><b>${done.length}</b></summary><div class="tl-done-list">${done.length?done.map(card).join(''):'<div class="empty compact">완료된 할 일이 없습니다.</div>'}</div></details></section>`}
async function context(){const epoch=sessionEpoch;if(!(await rt.session.ensure())||epoch!==sessionEpoch)return false;const u=await api('/auth/v1/user');if(epoch!==sessionEpoch)return false;const ms=await api(`/rest/v1/app_workspace_members?user_id=eq.${encodeURIComponent(u.id)}&select=workspace_id&limit=1`);if(epoch!==sessionEpoch||!ms?.length)return false;userId=u.id;workspaceId=ms[0].workspace_id;await loadProjects();return epoch===sessionEpoch}
async function loadProjects(){if(!workspaceId)return;const workspace=workspaceId,epoch=sessionEpoch;const rows=await api(`/rest/v1/app_spaces?workspace_id=eq.${encodeURIComponent(workspace)}&status=neq.archived&select=id,name,parent_id,status&order=sort_order.asc,created_at.asc`);if(epoch!==sessionEpoch||workspace!==workspaceId)return;projects=rows||[]}
async function render(){if(renderingEpoch===sessionEpoch||!userId||!workspaceId)return;const r=root();if(!r)return;rememberOpen();const owner=userId,workspace=workspaceId,epoch=sessionEpoch;renderingEpoch=epoch;try{const rows=await api(`/rest/v1/app_tasks?workspace_id=eq.${encodeURIComponent(workspace)}&assignee_id=eq.${encodeURIComponent(owner)}&select=*&order=due_at.asc.nullslast,created_at.desc`)||[];if(epoch!==sessionEpoch||owner!==userId||workspace!==workspaceId)return;tasks=rows;r.innerHTML=group('mine','내 할 일',tasks)}catch(e){if(epoch===sessionEpoch)r.innerHTML=`<div class="status error">${esc(e.message||String(e))}</div>`}finally{if(renderingEpoch===epoch)renderingEpoch=-1}}
function setMode(task=null){editing=task;const modal=$('#taskModal'),h=modal?.querySelector('.modal-head h2'),btn=$('#saveTaskBtn'),status=$('#taskModalStatus'),actions=$('#taskModalActions'),toggleBtn=$('#taskModalToggle'),deleteBtn=$('#taskModalDelete');if(h)h.textContent=task?'할 일 상세·수정':'할 일 추가';if(btn){btn.textContent=task?'수정 저장':'저장';btn.disabled=false}if(status){status.textContent='';status.className='status'}actions?.classList.toggle('hidden',!task);$('#personalTaskNote')?.classList.toggle('hidden',Boolean(task));if(toggleBtn&&task)toggleBtn.textContent=task.status==='done'?'미완료로 변경':'완료';if(deleteBtn)deleteBtn.classList.toggle('hidden',!task||!canDelete(task));if(!task&&$('#taskNote'))$('#taskNote').value=''}
function closeModal({restoreFocus=true}={}){const m=$('#taskModal');if(m){m.classList.add('hidden');m.classList.remove('from-project');m.setAttribute('aria-hidden','true');window.KPTUA11y?.dialog.deactivate(m,{restoreFocus,fallbackFocus:'#newTaskBtn'})}setMode(null)}
function focusTask(id){const row=id?root()?.querySelector(`[data-tl-task-row="${CSS.escape(id)}"]`):null;(row?.querySelector('.tl-task-main')||root()?.querySelector('.tl-task-main')||$('#newTaskBtn'))?.focus({preventScroll:true})}
function ensureProjectOption(id){const s=$('#taskProject');if(!s||!id||[...s.options].some(o=>o.value===id))return;const o=document.createElement('option');o.value=id;o.textContent=projectName(id)||'기존 연결 프로젝트';s.prepend(o)}
function ensureToolbarLabels(){const pairs=[['taskScope','할 일 범위'],['taskStatus','할 일 상태']];for(const [id,text] of pairs){const control=$('#'+id);if(!control||document.querySelector(`label[for="${id}"]`))continue;const label=document.createElement('label');label.className='sr-only';label.htmlFor=id;label.textContent=text;control.before(label)}}
function openEdit(id,focus='title'){const t=tasks.find(x=>x.id===id);if(!t)return;setMode(t);ensureProjectOption(t.project_id);const vals={taskTitle:t.title||'',taskAssignee:t.assignee_id||userId,taskProject:t.project_id||'',taskDue:dateValue(t.due_at),taskPriority:t.priority||'normal',taskDescription:t.description||'',taskNote:t.note||''};Object.entries(vals).forEach(([id,v])=>{const e=$('#'+id);if(e)e.value=v});const m=$('#taskModal');if(m){m.classList.remove('hidden');m.classList.toggle('from-project',!$('#ps3DetailModal')?.classList.contains('hidden'));m.setAttribute('aria-hidden','false');window.KPTUA11y?.dialog.activate(m,{trigger:document.activeElement,initialFocus:focus==='note'?'#taskNote':'#taskTitle',onRequestClose:closeModal})}$('#'+(focus==='note'?'taskNote':'taskTitle'))?.focus()}
function payload(){return{title:$('#taskTitle')?.value.trim()||'',project_id:$('#taskProject')?.value||null,assignee_id:editing?.assignee_id||userId,due_at:$('#taskDue')?.value?new Date($('#taskDue').value).toISOString():null,priority:$('#taskPriority')?.value||'normal',description:$('#taskDescription')?.value.trim()||null,note:$('#taskNote')?.value.trim()||null}}
function changed(id=null){window.dispatchEvent(new CustomEvent('kptu:tasks-changed',{detail:{source:'task-layout',task_id:id}}))}
async function saveTask(){const body=payload(),status=$('#taskModalStatus'),btn=$('#saveTaskBtn');if(!body.title){if(status){status.textContent='할 일을 입력해 주세요.';status.className='status error'}return}if(btn)btn.disabled=true;try{if(editing){const id=editing.id;await api(`/rest/v1/app_tasks?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{...body,updated_at:new Date().toISOString()}});closeModal({restoreFocus:false});await render();focusTask(id);changed(id);toast('할 일을 수정했습니다.')}else{const rows=await api('/rest/v1/app_tasks',{method:'POST',body:{workspace_id:workspaceId,...body,status:'todo',source_type:'manual',created_by:userId},prefer:'return=representation'});closeModal({restoreFocus:false});await render();focusTask(rows?.[0]?.id);changed(rows?.[0]?.id||null);toast('할 일을 추가했습니다.')}}catch(e){if(status){status.textContent=e.message||String(e);status.className='status error'}}finally{if(btn)btn.disabled=false}}
async function remove(id){const t=tasks.find(x=>x.id===id);if(!t||!canDelete(t)||!confirm(`“${t.title}” 할 일을 삭제할까요?`))return;try{await api(`/rest/v1/app_tasks?id=eq.${encodeURIComponent(id)}`,{method:'DELETE'});if(editing?.id===id)closeModal({restoreFocus:false});await render();focusTask();changed(id);toast('할 일을 삭제했습니다.')}catch(e){alert(e.message||String(e))}}
async function toggle(id){const t=tasks.find(x=>x.id===id);if(!t)return;const done=t.status==='done',fromModal=editing?.id===id;try{rememberOpen();await api(`/rest/v1/app_tasks?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{status:done?'todo':'done',completed_at:done?null:new Date().toISOString(),updated_at:new Date().toISOString()}});t.status=done?'todo':'done';if(fromModal)setMode(t);await render();if(!fromModal){const control=root()?.querySelector(`[data-tl-toggle="${CSS.escape(id)}"]`);if(control?.getClientRects().length)control.focus();else root()?.querySelector('.tl-completed summary')?.focus()}changed(id)}catch(e){await render();alert(e.message||String(e))}}
function closeMenu(restoreFocus=false){const menu=root()?.querySelector('[data-tl-menu-items]:not([hidden])');if(!menu)return;menu.hidden=true;const trigger=menu.parentElement.querySelector('[data-tl-menu]');trigger?.setAttribute('aria-expanded','false');if(restoreFocus)trigger?.focus()}
function openMenu(trigger){const menu=trigger.parentElement.querySelector('[data-tl-menu-items]');if(!menu)return;const wasOpen=!menu.hidden;closeMenu();if(wasOpen)return;menu.hidden=false;trigger.setAttribute('aria-expanded','true');menu.querySelector('[role="menuitem"]')?.focus()}
function install(){
  if(installed)return;
  const r=root(),btn=$('#saveTaskBtn');if(!r||!btn)return;
  installed=true;ensureToolbarLabels();
  document.querySelector('#taskTarget')?.closest('label')?.remove();
  document.querySelectorAll('.meeting-action-target').forEach(x=>x.remove());
  btn.onclick=saveTask;
  $('#taskModalToggle')?.addEventListener('click',()=>{if(editing)toggle(editing.id)});
  $('#taskModalDelete')?.addEventListener('click',()=>{if(editing)remove(editing.id)});
  r.addEventListener('change',e=>{const check=e.target.closest('[data-tl-toggle]');if(check)toggle(check.dataset.tlToggle)});
  document.addEventListener('focusin',e=>{const menu=r.querySelector('[data-tl-menu-items]:not([hidden])');if(menu&&!menu.parentElement.contains(e.target))closeMenu()});
  document.addEventListener('toggle',e=>{const d=e.target?.closest?.('#taskList details[data-tl-state]');if(d)openState.set(d.dataset.tlState,d.open)},true);
  document.addEventListener('click',e=>{
    if(e.target.closest?.('#quickTaskBtn,#newTaskBtn')){setMode(null);$('#taskModal')?.classList.toggle('from-project',!$('#ps3DetailModal')?.classList.contains('hidden'));return}
    if(e.target.closest?.('[data-close="taskModal"]')&&editing){e.preventDefault();e.stopImmediatePropagation();closeModal();return}
    const menu=e.target.closest?.('[data-tl-menu]');if(menu){e.preventDefault();openMenu(menu);return}
    const edit=e.target.closest?.('[data-tl-menu-edit]');if(edit){e.preventDefault();closeMenu(true);openEdit(edit.dataset.tlMenuEdit);return}
    const note=e.target.closest?.('[data-tl-menu-note]');if(note){e.preventDefault();closeMenu(true);openEdit(note.dataset.tlMenuNote,'note');return}
    const del=e.target.closest?.('[data-tl-delete]');if(del){e.preventDefault();closeMenu(true);remove(del.dataset.tlDelete);return}
    const main=e.target.closest?.('[data-tl-open]');if(main){e.preventDefault();openEdit(main.dataset.tlOpen,e.target.closest('.tl-task-note')?'note':'title');return}
    const row=e.target.closest?.('[data-tl-task-row]');if(row&&!e.target.closest?.('button,input,label,[data-tl-menu-items]')){openEdit(row.dataset.tlTaskRow);return}
    if(!e.target.closest?.('[data-tl-menu-items]'))closeMenu();
  },true);
  document.addEventListener('keydown',e=>{
    const menu=e.target.closest?.('[data-tl-menu-items]:not([hidden])');
    if(menu&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
      e.preventDefault();const items=[...menu.querySelectorAll('[role="menuitem"]')],index=items.indexOf(document.activeElement);
      const next=e.key==='Home'?0:e.key==='End'?items.length-1:e.key==='ArrowDown'?(index+1)%items.length:(index-1+items.length)%items.length;
      items[next]?.focus();return;
    }
    if(e.key==='Escape'&&root()?.querySelector('[data-tl-menu-items]:not([hidden])')){e.preventDefault();closeMenu(true)}
  },true);
  window.KPTURouter?.on?.('tasks',render);
  window.addEventListener('kptu:tasks-changed',e=>{if(e.detail?.source!=='task-layout')render()});
  window.addEventListener('kptu:projects-changed',async()=>{await loadProjects();render()});
}
async function boot(){if(!(await context()))return false;install();await render();return true}
async function openTask(id){const owner=userId,workspace=workspaceId,epoch=sessionEpoch;try{let task=tasks.find(x=>x.id===id);if(!task){const rows=await api(`/rest/v1/app_tasks?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);if(epoch!==sessionEpoch||owner!==userId||workspace!==workspaceId)return;task=rows?.[0];if(!task)throw new Error('할 일을 찾을 수 없거나 열람 권한이 없습니다.');tasks.push(task)}openEdit(id)}catch(e){if(epoch!==sessionEpoch)return;console.error('project task open failed',e);toast('할 일을 열지 못했습니다.')}}
window.KPTUTaskLayout={openTask};
window.__KPTU_TASK_LAYOUT_READY__=boot().catch(e=>{console.error('task layout init',e);return false});
window.addEventListener('kptu:session-changed',e=>{sessionEpoch++;const nextId=e.detail?.session?.user?.id||'';if(!nextId||nextId!==userId){userId='';workspaceId='';projects=[];tasks=[];openState.clear();root()?.replaceChildren();if(editing)closeModal({restoreFocus:false})}if(!e.detail?.session)return;window.__KPTU_TASK_LAYOUT_READY__=context().then(async ok=>{if(ok){install();await render()}return ok}).catch(()=>false)});
})();
