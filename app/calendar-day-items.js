import {seoulDateKey,seoulClock} from './meeting-time.js';
import {todayEvents} from './home-read-model.js';
// List and week share KST day calculation and event/task rows. Month owns normalized bar geometry.
export const calendarDateKey=seoulDateKey;
export function dayItems(options,date,tasks){
  const events=todayEvents(options.googleEvents||[],Date.parse(calendarDateKey(date)+'T12:00:00+09:00')).map(ev=>{
    const color=window.KPTUCalendarMonthView.googleColor(ev,options.googleState);
    return {...ev,source:'google',start:new Date(/^\d{4}-\d{2}-\d{2}$/.test(ev.start)?ev.start+'T00:00:00+09:00':ev.start),color};
  });
  return [...events,...tasks.filter(t=>t.date===calendarDateKey(date)).map(t=>({...t,source:'task'}))];
}
export function appendDayRows(container,date,items){
  const events=items.filter(e=>e.source==='google'),pending=items.filter(e=>e.source==='task'&&!e.done),count=pending.length;
  for(const ev of events){
    const row=document.createElement('button');row.type='button';row.className='clv-event cp-event';row.dataset.googleEvent=ev.id;row.dataset.googleCalendar=ev.calendarId||'primary';
    // Same per-event color variable as month/week bands; the week CSS paints its stripe from it.
    row.style.setProperty('--cmv-google-source',ev.color);
    const time=document.createElement('span');time.className='clv-time';time.textContent=ev.allDay?'종일':seoulClock(ev.start);
    const stripe=document.createElement('span');stripe.className='clv-color';stripe.style.background=ev.color;stripe.setAttribute('aria-hidden','true');
    const title=document.createElement('span');title.className='clv-title';title.textContent=ev.title||'(제목 없음)';
    row.append(time,stripe,title);container.append(row);
  }
  if(count){
    const button=document.createElement('button');button.type='button';button.className='clv-tasks'+(pending.some(t=>t.overdue)?' clv-tasks-overdue':'');button.textContent=(events.length?'':'일정 없음 · ')+`할 일 ${count}개 ›`;
    button.addEventListener('click',()=>window.KPTUCalendarDayOverflow?.open(date,items));container.append(button);
  }else if(!events.length){const empty=document.createElement('div');empty.className='clv-empty';empty.textContent='일정 없음';container.append(empty)}
}
export function captureDayFocus(box,previous){
  const active=document.activeElement;
  if(!box.contains(active))return active===document.body?previous:null;
  const section=active.closest('[data-date]');
  return active.id==='calendarListMore'?{more:true}:section?{date:section.dataset.date,event:active.dataset.googleEvent,calendar:active.dataset.googleCalendar,tasks:active.matches('.clv-tasks,.cmv-task-count'),create:active.classList.contains('cwv-create')}:null;
}
export function restoreDayFocus(box,key){
  if(!key)return;
  const section=[...box.querySelectorAll('[data-date]')].find(s=>s.dataset.date===key.date);
  const target=key.more?box.querySelector('#calendarListMore'):key.tasks?section?.querySelector('.clv-tasks,.cmv-task-count'):key.create?section?.querySelector('.cwv-create'):[...box.querySelectorAll('[data-google-event]')].find(e=>e.dataset.googleEvent===key.event&&e.dataset.googleCalendar===key.calendar&&e.closest('[data-date]')?.dataset.date===key.date);
  if(target&&!target.disabled)target.focus({preventScroll:true});
}

export function weekBands(options,start){
  const month=window.KPTUCalendarMonthView;
  const events=(options.googleEvents||[]).filter(ev=>ev.status!=='cancelled').map(raw=>month.normalizeGoogle(raw,options.googleState)).filter(ev=>Number.isFinite(ev.start.getTime())&&Number.isFinite(ev.end.getTime()));
  const bands=events.filter(ev=>ev.allDay||calendarDateKey(ev.start)!==calendarDateKey(ev.end));
  return {week:month.segmentWeeks(bands,{start,weeks:1})[0],keys:new Set(bands.map(ev=>ev.key))};
}
