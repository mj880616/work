import {waitHtml, failHtml, emptyHtml} from './wait-state.js';
import {seoulDateKey,seoulClock} from './meeting-time.js';
import {todayEvents} from './home-read-model.js';
import {planMarkOf,planMarkEl} from './report-plan-mark.js'; // BIZ-보고할일정 PR B: 일정 줄 제목 앞 ✓(보고 씀)·□(보고할 일정)
// List and week share KST day calculation and event/task rows. Month owns normalized bar geometry.
export const calendarDateKey=seoulDateKey;
export function dayItems(options,date,tasks){
  const events=todayEvents(options.googleEvents||[],Date.parse(calendarDateKey(date)+'T12:00:00+09:00')).map(ev=>{
    const color=window.KPTUCalendarMonthView.googleColor(ev,options.googleState);
    // raw = Google 일정 그대로(시작이 글자). '보고할 일정' 규칙(report-plan-model.mjs)이 일정 원본의 제목·시작을 본다.
    return {...ev,source:'google',start:new Date(/^\d{4}-\d{2}-\d{2}$/.test(ev.start)?ev.start+'T00:00:00+09:00':ev.start),color,raw:ev};
  });
  return [...events,...tasks.filter(t=>t.date===calendarDateKey(date)).map(t=>({...t,source:'task'}))];
}
// known=false: Google has not answered for this day yet (CAL-저장본먼저), so an empty day says 불러오는 중, never 일정 없음.
export function appendDayRows(container,date,items,known=true){
  const events=items.filter(e=>e.source==='google'),pending=items.filter(e=>e.source==='task'&&!e.done),count=pending.length;
  for(const ev of events){
    const row=document.createElement('button');row.type='button';row.className='clv-event cp-event';row.dataset.googleEvent=ev.id;row.dataset.googleCalendar=ev.calendarId||'primary';
    // Same per-event color variable as month/week bands; the week CSS paints its stripe from it.
    row.style.setProperty('--cmv-google-source',ev.color);
    const time=document.createElement('span');time.className='clv-time';time.textContent=ev.allDay?'종일':seoulClock(ev.start);
    const stripe=document.createElement('span');stripe.className='clv-color';stripe.style.background=ev.color;stripe.setAttribute('aria-hidden','true');
    const title=document.createElement('span');title.className='clv-title';title.textContent=ev.title||'(제목 없음)';
    // BIZ-보고할일정 PR B: 목록 줄·주간 시간표 칸이 같은 줄을 쓴다. 표시는 글자가 없는 마디라 제목 글자(말풍선·읽기 이름)는 그대로다.
    const plan=planMarkOf(ev.raw||ev);if(plan)title.prepend(planMarkEl(plan));
    row.append(time,stripe,title);container.append(row);
  }
  if(count){
    const button=document.createElement('button');button.type='button';button.className='clv-tasks'+(pending.some(t=>t.overdue)?' clv-tasks-overdue':'');button.textContent=(events.length||!known?'':'일정 없음 · ')+`할 일 ${count}개 ›`;
    button.addEventListener('click',()=>window.KPTUCalendarDayOverflow?.open(date,items));container.append(button);
  }else if(!events.length){const empty=document.createElement('div');empty.className='clv-empty';const failed=window.KPTUCalendarPersistence?.state?.()==='failed';if(!known)empty.dataset.calendarPending='';if(known)empty.innerHTML=emptyHtml('일정 없음');else empty.innerHTML=failed?failHtml():waitHtml({rows:1});container.append(empty)}
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
