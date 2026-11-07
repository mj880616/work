import {emptyHtml} from './wait-state.js';
import {createTaskInline} from './task-inline.js';
import {applyCheckPop} from './check-motion.js'; // UI-누름움직임: 끝낸 줄의 체크 움직임
import {moveTaskToDay,dueDay} from './task-due.mjs';
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
// fresh: after a change, never join a read that another screen started before the change (runtime single flight).
function refresh(fresh=false){
  if(fetching)return fetching;
  const g=api(),me=currentOwner(),at=epoch;
  if(!g?.listTasks||!me)return Promise.resolve();
  fetching=(async()=>{
    try{
      const r=await g.listTasks({fresh});
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
  timer=setTimeout(()=>{if(shown()&&(force||Date.now()-fetchedAt>=REFRESH_MIN_MS))refresh(force)},delay);
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
// S52-11: 달력 칸 안 할 일 줄(☐ 제목). ☐를 누르면 저장을 기다리지 않고 바로 완료 모양, 실패하면 되돌린다(저장은 날짜 목록 동그라미와 같은 길).
const cellsOf=id=>[...document.querySelectorAll(`#calendarGrid .cmv-cell-task[data-calendar-task="${CSS.escape(id)}"]`)];
function paintCell(id,value){cellsOf(id).forEach(b=>b.classList.toggle('cmv-cell-task-done',!!value))}
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
  begin:id=>{const l=lineOf(id);if(l)l.dataset.busy='1';cellsOf(id).forEach(b=>{b.dataset.busy='1'})},
  end:id=>{const l=lineOf(id);if(l)delete l.dataset.busy;cellsOf(id).forEach(b=>{delete b.dataset.busy})},
  apply:(id,done,original)=>{const value=done===null?original.status==='completed':done;paint(rowOf(id),value);paintCell(id,value);if(done===true)applyCheckPop(rowOf(id),id)},
  edit:id=>open(id,document.querySelector('#calendarDayModal')),
  // S51-27: 칸 안 할 일 막대에는 동그라미가 없어 PC 우클릭 메뉴에 [완료]를 더한다(동그라미와 같은 완료·되돌리기).
  extras:(task,el)=>el&&!el.closest('#calendarDayTasks')&&task.status!=='completed'?[{key:'done',label:'완료',run:()=>void line.complete(task.id,el)}]:[],
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
    // S52-11 CAL-폰달력핀치 ③: 달력 칸 안 ☐ = 바로 완료(5초 되돌리기). 폰·폴드·PC, 처음·커진 크기 모두 같은 줄 부품이라 한 곳에서 받는다.
    if(e.target.closest('#calendarGrid .cmv-cell-task-box')){e.preventDefault();e.stopPropagation();if(!b.dataset.busy)void line.complete(b.dataset.calendarTask,b);return}
    e.preventDefault();open(b.dataset.calendarTask,b.closest('#calendarDayModal'));
  });
  window.KPTURouter?.on?.('calendar',()=>{applyCopy();schedule()});
  // A save or delete from the task editor (opened here or elsewhere) is read again at once while the calendar is shown.
  // STAB-달력할일토글: a confirmed toggle / save carries the saved task (detail.task); this list takes it at once, so a date list
  // opened before the fresh read returns already shows it (the read used to be the only way in, and a slow one left it stale).
  window.addEventListener('kptu:google-tasks-changed',e=>{const t=e.detail?.task;if(t?.id&&tasks.some(x=>x.id===t.id)){tasks=tasks.map(x=>x.id===t.id?{...x,...t}:x);publish(tasks,Date.now())}fetchedAt=0;if(shown())schedule(0,true)});
  // The session is rewritten on every token refresh too; only a change of owner (sign-out, another account) clears the list.
  window.addEventListener('kptu:session-changed',()=>{if(currentOwner()===owner)return;owner=currentOwner();epoch++;clearTimeout(timer);fetchedAt=0;publish([],0)});
  applyCopy();
  if(shown())schedule();
}
// S51-16 CAL-할일끌기: PC 달력에서 할 일을 다른 날짜 칸에 끌어 놓았을 때(calendar-drag.js) 기한만 그 날로 바꾼다. 저장은 수정 창·⋯[기한 바꾸기]와
// 같은 google-tasks action=update(task-due.mjs moveTaskToDay)이고, 이 모듈이 달력의 할 일 목록 주인이라 저장된 값으로 다시 그린다.
// 결과: {status:'saved',before,task} | 'same'(같은 날) | 'blocked'(완료·없음) | 'stale'(계정 바뀜) | 'failed'(text).
async function moveDue(id,day){
  const raw=tasks.find(x=>x.id===id),base=api()?.taskState?.(id)?.task||raw;
  if(!base)return {status:'blocked',text:'할 일을 찾지 못했어요.'};
  if(base.status==='completed')return {status:'blocked',text:'끝낸 할 일은 옮길 수 없어요.'};
  const before=dueDay(base);if(before===day)return {status:'same'};
  const me=currentOwner();
  try{
    const next=await moveTaskToDay(base,day,window.KPTURuntime);
    if(me!==currentOwner())return {status:'stale'};
    tasks=tasks.map(x=>x.id===id?{...x,...next}:x);publish(tasks,Date.now());
    const g=api();if(g?.taskSaved)g.taskSaved(next);else window.dispatchEvent(new CustomEvent('kptu:google-tasks-changed'));
    return {status:'saved',before,task:next};
  }catch(e){
    if(me!==currentOwner())return {status:'stale'};
    return {status:'failed',text:e?.message&&!e.status?e.message:'기한을 바꾸지 못했어요. 다시 시도해 주세요.'};
  }
}
// S51-27 UI-PC우클릭: 달력 칸·주간의 할 일 줄(data-calendar-task)을 우클릭한 자리에 그 줄의 ⋯ 메뉴(task-inline.js)를 연다.
function menuAt(el,at){const id=el?.dataset?.calendarTask;if(!id||!findTask(id))return false;line.openMenu(el,{id,at});return true}
window.KPTUCalendarTasks={refresh:()=>refresh(),moveDue,menuAt};
boot();
})();
