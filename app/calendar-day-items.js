import {todayEvents} from './home-read-model.js?v=1';
// List and week share KST day calculation and event/task rows.
const pad=n=>String(n).padStart(2,'0');
export const calendarDateKey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
export function dayItems(options,date,tasks){
  const events=todayEvents(options.googleEvents||[],Date.parse(calendarDateKey(date)+'T12:00:00+09:00')).map(ev=>{
    const color=window.KPTUCalendarMonthView.googleColor(ev,options.googleState);
    return {...ev,source:'google',start:new Date(/^\d{4}-\d{2}-\d{2}$/.test(ev.start)?ev.start+'T00:00:00+09:00':ev.start),color};
  });
  return [...events,...tasks.filter(t=>t.date===calendarDateKey(date)).map(t=>({...t,source:'task'}))];
}
export function appendDayRows(container,date,items){
  const events=items.filter(e=>e.source==='google'),count=items.length-events.length;
  for(const ev of events){
    const row=document.createElement('button');row.type='button';row.className='clv-event cp-event';row.dataset.googleEvent=ev.id;row.dataset.googleCalendar=ev.calendarId||'primary';
    const time=document.createElement('span');time.className='clv-time';time.textContent=ev.allDay?'종일':pad(ev.start.getHours())+':'+pad(ev.start.getMinutes());
    const stripe=document.createElement('span');stripe.className='clv-color';stripe.style.background=ev.color;stripe.setAttribute('aria-hidden','true');
    const title=document.createElement('span');title.className='clv-title';title.textContent=ev.title||'(제목 없음)';
    row.append(time,stripe,title);container.append(row);
  }
  if(count){
    const button=document.createElement('button');button.type='button';button.className='clv-tasks';button.textContent=(events.length?'':'일정 없음 · ')+`할 일 ${count}개 ›`;
    button.addEventListener('click',()=>window.KPTUCalendarDayOverflow?.open(date,items));container.append(button);
  }else if(!events.length){const empty=document.createElement('div');empty.className='clv-empty';empty.textContent='일정 없음';container.append(empty)}
}
export function captureDayFocus(box,previous){
  const active=document.activeElement;
  if(!box.contains(active))return active===document.body?previous:null;
  const section=active.closest('[data-date]');
  return active.id==='calendarListMore'?{more:true}:section?{date:section.dataset.date,event:active.dataset.googleEvent,calendar:active.dataset.googleCalendar,tasks:active.classList.contains('clv-tasks')}:null;
}
export function restoreDayFocus(box,key){
  if(!key)return;
  const section=[...box.querySelectorAll('[data-date]')].find(s=>s.dataset.date===key.date);
  const target=key.more?box.querySelector('#calendarListMore'):key.tasks?section?.querySelector('.clv-tasks'):[...(section?.querySelectorAll('[data-google-event]')||[])].find(e=>e.dataset.googleEvent===key.event&&e.dataset.googleCalendar===key.calendar);
  if(target&&!target.disabled)target.focus({preventScroll:true});
}
