import {emptyHtml} from './wait-state.js';
import {createTaskInline} from './task-inline.js';
(()=>{
'use strict';
if(window.KPTUCalendarTasks)return;
// Google tasks on the month calendar by due date (CAL-할일). This module owns the calendar's task list; calendar-month-view.js
// draws it. It is kept apart from the Web2 events path (team.js) so removing Web2 events (CAL-웹2일정삭제) leaves it alone.
// Shown: every pending task with a due date (an overdue one stays on its due date) and tasks completed in the last 3 days
// (faded), whatever their project or organization links. Tasks without a due date are not shown. A tap opens the existing
// Google task editor (which also completes, un-completes and deletes). In the date list the row's circle and ⋯ are the shared task line
// (TASK-바로처리통일, task-inline.js); nothing else here changes a task. Without Google or its Tasks permission the calendar
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
// TASK-바로처리통일 (was UI-할일조작통일): the date list's rows are the shared task line (task-inline.js). The circle completes with a
// 5-second [되돌리기] (a finished row's circle reopens it), keeping the list open; the ⋯ beside each row holds 내일로 · 기한 바꾸기 ·
// 고치기 · 지우기 (finished: 다시 할 일로 · 고치기). This module stays the owner of the calendar's task list: it repaints the row it
// was asked to change (paint) and hands the list to the month view (publish); the task view's toggle / update / delete do the saving.
const rowOf=id=>document.querySelector(`#calendarDayTasks [data-calendar-task="${CSS.escape(id)}"]`);
const lineOf=id=>document.querySelector(`#calendarDayTasks [data-calendar-task-line="${CSS.escape(id)}"]`);
function paint(b,value){
  if(!b)return;
  b.classList.toggle('cmv-task-done',value);
  const mark=b.querySelector('.cmv-task-mark');if(mark)mark.textContent=value?'✓':'';
  const label=(b.getAttribute('aria-label')||'').replace(/, 완료$/,'')+(value?', 완료':'');
  b.setAttribute('aria-label',label);b.title=label;
}
// A row leaves the date list (deleted, or its due date moved to another day); the empty list says so.
function dropRow(id){
  const line=lineOf(id),section=line?.parentElement;line?.remove();
  if(section?.id==='calendarDayTasks'&&!section.querySelector('[data-calendar-task]'))section.remove();
  const list=document.querySelector('#calendarDayList');
  if(list&&!list.querySelector('#calendarDayEvents,#calendarDayTasks,#calendarDayDiary'))list.innerHTML=emptyHtml('일정 없음');
}
const findTask=id=>{const raw=tasks.find(x=>x.id===id);if(!raw)return null;const row=rowOf(id);return {...(api()?.taskState?.(id)?.task||raw),...(row?{status:row.classList.contains('cmv-task-done')?'completed':'needsAction'}:{})}};
const line=createTaskInline({menuId:'calendarTaskMenu',historyKey:'kptuCalendarTaskMenu',menuAttr:'calendarTaskMenu',find:findTask,
  begin:id=>{const l=lineOf(id);if(l)l.dataset.busy='1'},
  end:id=>{const l=lineOf(id);if(l)delete l.dataset.busy},
  apply:(id,done,original)=>paint(rowOf(id),done===null?original.status==='completed':done),
  edit:id=>open(id,document.querySelector('#calendarDayModal')),
  saved:(id,task)=>{tasks=tasks.map(x=>x.id===id?{...x,...task}:x);publish(tasks,Date.now());dropRow(id)},
  removed:id=>{tasks=tasks.filter(x=>x.id!==id);publish(tasks,Date.now());dropRow(id)}});
function boot(){
  owner=currentOwner();
  document.addEventListener('click',e=>{
    const m=e.target.closest?.('[data-calendar-task-menu]');
    if(m){e.preventDefault();line.openMenu(m);return}
    const b=e.target.closest?.('[data-calendar-task]');
    if(!b||window.KPTUCalendarMonthView?.suppressClick?.())return;
    if(e.target.closest('#calendarDayTasks .cmv-task-mark')){e.preventDefault();if(!b.closest('[data-busy]'))void line.toggle(b.dataset.calendarTask,b);return}
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
