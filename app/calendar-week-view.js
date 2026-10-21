import {addSeoulDays,seoulParts,formatSeoulTime} from './meeting-time.js';
import {dayKey} from './home-read-model.js';
import {dayItems,calendarDateKey,appendDayRows,captureDayFocus,restoreDayFocus,weekBands} from './calendar-day-items.js';
let focusKey=null,clipWatch=null;
// 주간 칸: 제목이 2줄을 넘어 잘린 일정만 말풍선(시간+전체 제목)을 보이게 표시한다. 화면 읽기는 본문 전체 제목을 그대로 읽으므로 말풍선은 가린다.
function addTips(rows){
  for(const row of rows.querySelectorAll('.clv-event')){
    const tip=document.createElement('span');tip.className='cwv-tip';tip.setAttribute('aria-hidden','true');
    tip.textContent=`${row.querySelector('.clv-time')?.textContent||''} ${row.querySelector('.clv-title')?.textContent||''}`.trim();row.append(tip);
  }
}
function markClipped(box){
  for(const row of box.querySelectorAll('.cwv-items .clv-event')){const title=row.querySelector('.clv-title');row.classList.toggle('cwv-clipped',!!title&&title.scrollHeight>title.clientHeight+1)}
}
// Sole owner of the week DOM; view/range state remains in calendar-view.js.
export function renderWeek(options,{start,tasks}){
  const box=document.querySelector('#calendarWeek');if(!box)return;
  focusKey=captureDayFocus(box,focusKey);box.replaceChildren();
  const {week,keys}=weekBands(options,start);
  box.style.setProperty('--cwv-band-height',`${week.laneCount*48}px`);
  for(let i=0;i<7;i++){
    const date=addSeoulDays(start,i);
    const section=document.createElement('section');section.className='cwv-day';section.dataset.date=calendarDateKey(date);
    if(section.dataset.date===dayKey())section.classList.add('cwv-today');
    const header=document.createElement('header');header.className='cwv-header';
    const label=document.createElement('h3');label.className='cwv-date';label.textContent=`${['일','월','화','수','목','금','토'][seoulParts(date).weekday]} ${seoulParts(date).day}`;header.append(label);
    const items=dayItems(options,date,tasks),pending=items.filter(item=>item.source==='task'&&!item.done);
    if(pending.length){
      const count=document.createElement('button');count.type='button';count.className='cmv-task-count';
      const overdue=pending.some(t=>t.overdue);count.classList.toggle('cmv-task-count-overdue',overdue);
      count.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg><span>${pending.length}</span>`;
      count.setAttribute('aria-label',`할 일 ${pending.length}개`+(overdue?', 기한 지남 포함':''));
      count.addEventListener('click',()=>window.KPTUCalendarDayOverflow?.open(date,items));header.append(count);
    }
    const create=document.createElement('button');create.type='button';create.className='cwv-create';
    create.setAttribute('aria-label',formatSeoulTime(date,{month:'long',day:'numeric',weekday:'long'})+' 일정 추가');
    const rows=document.createElement('div');rows.className='cwv-items';
    const timed=items.filter(e=>e.source==='google'&&!keys.has('google:'+e.calendarId+':'+e.id)).sort((a,b)=>a.start-b.start||String(a.title).localeCompare(String(b.title),'ko'));
    if(timed.length){appendDayRows(rows,date,timed);addTips(rows)}
    section.append(header,create,rows);box.append(section);
  }
  const bands=document.createElement('div');bands.className='cwv-bands';
  for(const seg of week.segments){
    const button=window.KPTUCalendarMonthView.eventButton(seg);
    const date=addSeoulDays(start,seg.startCol);button.dataset.date=calendarDateKey(date);
    bands.append(button);
  }
  box.append(bands);restoreDayFocus(box,focusKey);
  markClipped(box);
  if(!clipWatch&&typeof ResizeObserver==='function'){clipWatch=new ResizeObserver(()=>{const current=document.querySelector('#calendarWeek');if(current)markClipped(current)});clipWatch.observe(box)}
}
