(()=>{
'use strict';
if(window.KPTUCalendarTasks)return;
// Google tasks on the month calendar by due date (CAL-할일). This module owns the calendar's task list; calendar-month-view.js
// draws it. It is kept apart from the Web2 events path (team.js) so removing Web2 events (CAL-웹2일정삭제) leaves it alone.
// Shown: every pending task with a due date (an overdue one stays on its due date) and tasks completed in the last 3 days
// (faded), whatever their project or organization links. Tasks without a due date are not shown. A tap opens the existing
// Google task editor (which also completes, un-completes and deletes). In the date list the row's circle completes or un-completes through
// the task view's own toggle, and the row's ⋯ menu does the same plus 삭제 (UI-할일조조통일); nothing else here changes a task. Without Google or its Tasks permission the calendar
// simply shows no tasks, with no error message.
// The first calendar screen never waits for tasks: the view loader brings this module in after the first render, this device's
// copy is shown at once, and the fresh read starts a moment later and only while the calendar is still shown.
const FETCH_DELAY_MS=1200,REFRESH_MIN_MS=30*1000;
let tasks=[],tasksAt=0,fetchedAt=0,epoch=0,timer=0,fetching=null,owner='';
const api=()=>window.KPTUGoogleTasks;
const currentOwner=()=>window.KPTURuntime?.session?.read?.()?.user?.id||'';
const shown=()=>{const v=document.querySelector('#calendarView');return !!v&&!v.classList.contains('hidden')};
// The date is the date part of the Google due value as it is (dueDateKey), so a time zone cannot move a task to another day.
function forCalendar(list){
  const g=api(),now=Date.now();if(!g)return [];
  return list.flatMap(t=>{
    const date=g.dueDateKey(t.due);
    if(!date||!g.completedRecently(t,now))return [];
    return [{id:t.id,title:t.title||'제목 없음',date,done:t.status==='completed',overdue:g.isOverdue(t,now)}];
  });
}
function publish(list,at){tasks=list;tasksAt=at;window.KPTUCalendarMonthView?.setTasks?.(forCalendar(list));window.KPTUCalendarView?.setTasks?.(forCalendar(list))}
// This device's copy, when it is newer than what the calendar shows (e.g. after completing a task in the task view).
function applyCopy(){const copy=api()?.peekTasks?.();if(copy&&copy.owner===currentOwner()&&copy.savedAt>tasksAt)publish(copy.tasks,copy.savedAt)}
function refresh(){
  if(fetching)return fetching;
  const g=api(),me=currentOwner(),at=epoch;
  if(!g?.listTasks||!me)return Promise.resolve();
  fetching=(async()=>{
    try{
      const r=await g.listTasks();
      if(at!==epoch||r.owner!==me||currentOwner()!==me)return;
      fetchedAt=Date.now();
      publish(r.status==='ok'?r.tasks:[],fetchedAt);
    }catch(e){
      // Keep what is shown. The task view reports Google errors; the calendar stays quiet.
      if(at===epoch)console.warn('[calendar tasks]',e?.message||e);
    }finally{fetching=null}
  })();
  return fetching;
}
function schedule(delay=FETCH_DELAY_MS,force=false){
  clearTimeout(timer);
  timer=setTimeout(()=>{if(shown()&&(force||Date.now()-fetchedAt>=REFRESH_MIN_MS))refresh()},delay);
}
function open(id,dayModal){
  const t=tasks.find(x=>x.id===id);if(!t)return;
  const show=()=>api()?.openEditor?.(t);
  if(dayModal&&window.KPTUMobileModalHistory)window.KPTUMobileModalHistory.closeThen(dayModal,show);
  else{
    dayModal?.classList.add('hidden');dayModal?.setAttribute('aria-hidden','true');
    if(dayModal)window.KPTUA11y?.dialog.deactivate?.(dayModal,{restoreFocus:false});
    show();
  }
}
// The date list's circle: complete / un-complete with the task view's own toggle, keeping the list open. The row follows at once and is
// put back when the save fails (the task view reports the reason; this shows the same short notice).
async function toggleFromList(b){
  const id=b.dataset.calendarTask,g=api(),raw=tasks.find(x=>x.id===id);
  if(!raw||!g?.toggleTask||b.dataset.busy)return;
  const done=b.classList.contains('cmv-task-done'),task={...(g.taskState?.(id)?.task||raw),status:done?'completed':'needsAction'};
  const paint=value=>{
    b.classList.toggle('cmv-task-done',value);
    const mark=b.querySelector('.cmv-task-mark');if(mark)mark.textContent=value?'✓':'';
    const label=(b.getAttribute('aria-label')||'').replace(/, 완료$/,'')+(value?', 완료':'');
    b.setAttribute('aria-label',label);b.title=label;
  };
  b.dataset.busy='1';paint(!done);
  try{
    const r=await g.toggleTask(task);
    if(r?.ok===false){
      paint(done);
      const t=document.querySelector('#toast');
      if(t){t.textContent=r.message||'저장하지 못해 되돌렸습니다.';t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),3200)}
    }
  }catch{paint(done)}
  finally{delete b.dataset.busy}
}
// UI-할일조작통일: the ⋯ beside each task in the date list opens a small menu (완료 / 완료 취소, 삭제) where it was pressed
// (the existing anchored menu, as in the task screen). 삭제 asks first, like the editor's [삭제], then removes the row.
let menu=null,menuLoading=null;
const notice=text=>{const t=document.querySelector('#toast');if(t){t.textContent=text;t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),3200)}};
const rowOf=id=>document.querySelector(`#calendarDayTasks [data-calendar-task="${CSS.escape(id)}"]`);
async function deleteFromList(id){
  const g=api(),raw=tasks.find(x=>x.id===id),line=document.querySelector(`#calendarDayTasks [data-calendar-task-line="${CSS.escape(id)}"]`);
  if(!raw||!g?.deleteTask||line?.dataset.busy)return;
  if(!window.confirm('이 Google 할 일을 삭제할까요?'))return;
  if(line)line.dataset.busy='1';
  const task=g.taskState?.(id)?.task||raw;
  let r;try{r=await g.deleteTask(task)}catch{r={ok:false}}
  if(!r?.ok){if(line)delete line.dataset.busy;notice(r?.message||'할 일을 삭제하지 못했습니다.');return}
  tasks=tasks.filter(x=>x.id!==id);publish(tasks,Date.now());
  const section=line?.parentElement;line?.remove();
  if(section?.id==='calendarDayTasks'&&!section.querySelector('[data-calendar-task]'))section.remove();
  const list=document.querySelector('#calendarDayList');
  if(list&&!list.querySelector('#calendarDayEvents,#calendarDayTasks,#calendarDayDiary'))list.innerHTML='<div class="empty compact">일정 없음</div>';
  notice('할 일을 삭제했습니다.');
}
async function openMenu(trigger){
  const modal=trigger.closest('#calendarDayModal');if(!modal)return;
  if(!menu){
    menuLoading=menuLoading||import('./anchored-menu.js').then(({createAnchoredMenu})=>{
      menu=createAnchoredMenu({id:'calendarTaskMenu',className:'gt-task-menu',label:'할 일 관리',historyKey:'kptuCalendarTaskMenu',parent:modal,key:t=>t.dataset.calendarTaskMenu,
        render:id=>{const done=rowOf(id)?.classList.contains('cmv-task-done');return `<button type="button" data-calendar-menu-action="toggle">${done?'완료 취소':'완료'}</button>${api()?.deleteTask?'<button type="button" class="gt-menu-danger" data-calendar-menu-action="delete">삭제</button>':''}`},
        onAction:(button,active)=>{const row=rowOf(active.id);if(button.dataset.calendarMenuAction==='delete')void deleteFromList(active.id);else if(row)void toggleFromList(row)}
      });
    });
    await menuLoading;
  }
  menu.open(trigger);
}
function boot(){
  owner=currentOwner();
  document.addEventListener('click',e=>{
    const m=e.target.closest?.('[data-calendar-task-menu]');
    if(m){e.preventDefault();void openMenu(m);return}
    const b=e.target.closest?.('[data-calendar-task]');
    if(!b||window.KPTUCalendarMonthView?.suppressClick?.())return;
    if(e.target.closest('#calendarDayTasks .cmv-task-mark')){e.preventDefault();toggleFromList(b);return}
    e.preventDefault();open(b.dataset.calendarTask,b.closest('#calendarDayModal'));
  });
  window.KPTURouter?.on?.('calendar',()=>{applyCopy();schedule()});
  // A save or delete from the task editor (opened here or elsewhere) is read again at once while the calendar is shown.
  window.addEventListener('kptu:google-tasks-changed',()=>{fetchedAt=0;if(shown())schedule(0,true)});
  // The session is rewritten on every token refresh too; only a change of owner (sign-out, another account) clears the list.
  window.addEventListener('kptu:session-changed',()=>{if(currentOwner()===owner)return;owner=currentOwner();epoch++;clearTimeout(timer);fetchedAt=0;publish([],0)});
  applyCopy();
  if(shown())schedule();
}
window.KPTUCalendarTasks={refresh:()=>refresh()};
boot();
})();
