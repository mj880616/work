import {dayKey} from './home-read-model.js?v=1';
import {dayItems,calendarDateKey,appendDayRows,captureDayFocus,restoreDayFocus} from './calendar-day-items.js?v=2';
let focusKey=null;
export function renderWeek(options,{start,tasks}){
  const box=document.querySelector('#calendarWeek');if(!box)return;
  focusKey=captureDayFocus(box,focusKey);box.replaceChildren();
  for(let i=0;i<7;i++){
    const date=new Date(start);date.setDate(date.getDate()+i);
    const section=document.createElement('section');section.className='cwv-day';section.dataset.date=calendarDateKey(date);
    if(section.dataset.date===dayKey())section.classList.add('cwv-today');
    const header=document.createElement('h3');header.className='cwv-date';header.textContent=`${['일','월','화','수','목','금','토'][date.getDay()]} ${date.getDate()}`;
    const rows=document.createElement('div');rows.className='cwv-items';
    appendDayRows(rows,date,dayItems(options,date,tasks));section.append(header,rows);box.append(section);
  }
  restoreDayFocus(box,focusKey);
}
