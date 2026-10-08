import {dayKey} from './home-read-model.js?v=1';
import {dayItems,calendarDateKey,appendDayRows,captureDayFocus,restoreDayFocus} from './calendar-day-items.js?v=2';
let observer=null,focusKey=null;
export function stopList(){observer?.disconnect()}
export function renderList(options,{start,days,tasks,busy,error,more}){
  stopList();
  const box=document.querySelector('#calendarList');if(!box)return;
  focusKey=captureDayFocus(box,focusKey);
  box.replaceChildren();
  for(let i=0;i<days;i++){
    const date=new Date(start);date.setDate(date.getDate()+i);
    const section=document.createElement('section');section.className='clv-day';section.dataset.date=calendarDateKey(date);
    const header=document.createElement('h3');header.className='clv-date';
    const today=section.dataset.date===dayKey();
    if(today)header.classList.add('clv-today');
    header.textContent=(today?'오늘 · ':'')+`${date.getMonth()+1}월 ${date.getDate()}일 ${['일','월','화','수','목','금','토'][date.getDay()]}`;
    section.append(header);
    appendDayRows(section,date,dayItems(options,date,tasks));
    box.append(section);
  }
  const button=document.createElement('button');button.type='button';button.id='calendarListMore';button.className='clv-more';button.textContent=error?'다시 불러오기':busy?'불러오는 중…':'다음 14일 불러오기';button.disabled=busy;button.addEventListener('click',more);box.append(button);
  restoreDayFocus(box,focusKey);
  if(!busy&&!error){observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))more()});observer.observe(button)}
}
