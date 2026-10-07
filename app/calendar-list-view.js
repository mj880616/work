import {todayEvents,dayKey} from './home-read-model.js?v=1';
// The list has its own renderer; event overlap and exclusive ends share the home read model.
const pad=n=>String(n).padStart(2,'0');
export const calendarDateKey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
let observer=null,focusKey=null;
export function dayItems(options,date,tasks){
  const events=todayEvents(options.googleEvents||[],Date.parse(calendarDateKey(date)+'T12:00:00+09:00')).map(ev=>{
    const color=window.KPTUCalendarMonthView.googleColor(ev,options.googleState);
    return {...ev,source:'google',start:new Date(/^\d{4}-\d{2}-\d{2}$/.test(ev.start)?ev.start+'T00:00:00+09:00':ev.start),color};
  });
  return [...events,...tasks.filter(t=>t.date===calendarDateKey(date)).map(t=>({...t,source:'task'}))];
}
export function renderList(options,{start,days,tasks,busy,error,more}){
  observer?.disconnect();
  const box=document.querySelector('#calendarList');if(!box)return;
  const active=document.activeElement;
  if(box.contains(active))focusKey=active.id==='calendarListMore'?{more:true}:active.closest('.clv-day')?{date:active.closest('.clv-day').dataset.date,event:active.dataset.googleEvent,calendar:active.dataset.googleCalendar,tasks:active.classList.contains('clv-tasks')}:null;
  else if(active!==document.body)focusKey=null;
  box.replaceChildren();
  for(let i=0;i<days;i++){
    const date=new Date(start);date.setDate(date.getDate()+i);
    const items=dayItems(options,date,tasks),events=items.filter(e=>e.source==='google'),count=items.length-events.length;
    const section=document.createElement('section');section.className='clv-day';section.dataset.date=calendarDateKey(date);
    const header=document.createElement('h3');header.className='clv-date';
    const today=section.dataset.date===dayKey();
    if(today)header.classList.add('clv-today');
    header.textContent=(today?'오늘 · ':'')+`${date.getMonth()+1}월 ${date.getDate()}일 ${['일','월','화','수','목','금','토'][date.getDay()]}`;
    section.append(header);
    for(const ev of events){
      const row=document.createElement('button');row.type='button';row.className='clv-event cp-event';row.dataset.googleEvent=ev.id;row.dataset.googleCalendar=ev.calendarId||'primary';
      const time=document.createElement('span');time.className='clv-time';time.textContent=ev.allDay?'종일':pad(ev.start.getHours())+':'+pad(ev.start.getMinutes());
      const stripe=document.createElement('span');stripe.className='clv-color';stripe.style.background=ev.color;stripe.setAttribute('aria-hidden','true');
      const title=document.createElement('span');title.className='clv-title';title.textContent=ev.title||'(제목 없음)';
      row.append(time,stripe,title);section.append(row);
    }
    if(count){
      const button=document.createElement('button');button.type='button';button.className='clv-tasks';button.textContent=(events.length?'':'일정 없음 · ')+`할 일 ${count}개 ›`;
      button.addEventListener('click',()=>window.KPTUCalendarDayOverflow?.open(date,items));section.append(button);
    }else if(!events.length){const empty=document.createElement('div');empty.className='clv-empty';empty.textContent='일정 없음';section.append(empty)}
    box.append(section);
  }
  const button=document.createElement('button');button.type='button';button.id='calendarListMore';button.className='clv-more';button.textContent=error?'다시 불러오기':busy?'불러오는 중…':'다음 14일 불러오기';button.disabled=busy;button.addEventListener('click',more);box.append(button);
  if(focusKey){const section=[...box.querySelectorAll('.clv-day')].find(s=>s.dataset.date===focusKey.date);const target=focusKey.more?button:focusKey.tasks?section?.querySelector('.clv-tasks'):[...(section?.querySelectorAll('[data-google-event]')||[])].find(e=>e.dataset.googleEvent===focusKey.event&&e.dataset.googleCalendar===focusKey.calendar);if(target&&!target.disabled)target.focus({preventScroll:true})}
  if(!busy&&!error){observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))more()});observer.observe(button)}
}
