(()=>{
'use strict';
if(window.KPTUCalendarTasks)return;
// Google tasks on the month calendar by due date (CAL-할일). This module owns the calendar's task list; calendar-month-view.js
// draws it. It is kept apart from the Web2 events path (team.js) so removing Web2 events (CAL-웹2일정삭제) leaves it alone.
// Shown: every pending task with a due date (an overdue one stays on its due date) and tasks completed in the last 3 days
// (faded), whatever their project or organization links. Tasks without a due date are not shown. Read only: a tap opens the
// existing Google task editor, nothing here completes or changes a task. Without Google or its Tasks permission the calendar
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
function publish(list,at){tasks=list;tasksAt=at;window.KPTUCalendarMonthView?.setTasks?.(forCalendar(list))}
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
function open(id){const t=tasks.find(x=>x.id===id);if(t)api()?.openEditor?.(t)}
function boot(){
  owner=currentOwner();
  document.addEventListener('click',e=>{
    const b=e.target.closest?.('[data-calendar-task]');
    if(!b||window.KPTUCalendarMonthView?.suppressClick?.())return;
    e.preventDefault();open(b.dataset.calendarTask);
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
