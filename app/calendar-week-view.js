import {addSeoulDays,seoulParts,formatSeoulTime} from './meeting-time.js';
import {weekTimeline,dayMinute} from './calendar-week-timeline.js';
import {dayKey} from './home-read-model.js';
import {dayItems,calendarDateKey,appendDayRows,captureDayFocus,restoreDayFocus,weekBands} from './calendar-day-items.js';
let focusKey=null,clipWatch=null,nowTimer=null;
// 주간 칸: 제목이 2줄을 넘어 잘린 일정만 말풍선(시간+전체 제목)을 보이게 표시한다. 화면 읽기는 본문 전체 제목을 그대로 읽으므로 말풍선은 가린다.
function addTips(rows){
  for(const row of rows.querySelectorAll('.clv-event')){
    const tip=document.createElement('span');tip.className='cwv-tip';tip.setAttribute('aria-hidden','true');
    tip.textContent=`${row.querySelector('.clv-time')?.textContent||''} ${row.querySelector('.clv-title')?.textContent||''}`.trim();row.append(tip);
  }
}
function markClipped(box){
  for(const row of box.querySelectorAll('.cwv-items .clv-event')){const title=row.querySelector('.clv-title');row.classList.toggle('cwv-clipped',!!title&&(title.scrollHeight>title.clientHeight+1||title.scrollWidth>title.clientWidth+1))}
}
// 지금 시각 빨간 선: 오늘 칸에만 하나. 1분마다 같은 선의 위치만 옮기고 주간을 다시 그리지 않는다.
function placeNow(box,line){
  clearInterval(nowTimer);nowTimer=null;
  const move=()=>{
    const today=box.querySelector(`.cwv-day[data-date="${dayKey()}"] .cwv-timeline`);
    let mark=box.querySelector('.cwv-now');
    if(!today||!box.isConnected){mark?.remove();if(!box.isConnected){clearInterval(nowTimer);nowTimer=null}return}
    if(!mark||mark.parentElement!==today){mark?.remove();mark=document.createElement('div');mark.className='cwv-now';mark.setAttribute('aria-hidden','true');today.append(mark)}
    mark.style.top=line.y(dayMinute(new Date()))+'px';
  };
  move();nowTimer=setInterval(move,60000);
}
// Sole owner of the week DOM; view/range state remains in calendar-view.js.
export function renderWeek(options,{start,tasks}){
  const box=document.querySelector('#calendarWeek');if(!box)return;
  focusKey=captureDayFocus(box,focusKey);box.replaceChildren();
  const {week,keys}=weekBands(options,start);
  box.style.setProperty('--cwv-band-height',`${week.laneCount*48}px`);
  // CAL-주간시간표: timed events per day first, so the whole week decides which early hours (0~7시) unfold.
  const days=Array.from({length:7},(_,i)=>{const date=addSeoulDays(start,i),items=dayItems(options,date,tasks);
    return {date,items,timed:items.filter(e=>e.source==='google'&&!keys.has('google:'+e.calendarId+':'+e.id)).sort((a,b)=>a.start-b.start||String(a.title).localeCompare(String(b.title),'ko'))}});
  const line=weekTimeline(days.map(d=>({date:calendarDateKey(d.date),events:d.timed})));
  box.style.setProperty('--cwv-timeline-height',`${line.height}px`);
  box.style.setProperty('--cwv-collapsed-height',`${line.collapsedHeight}px`);
  for(let i=0;i<7;i++){
    const {date,items,timed}=days[i];
    const section=document.createElement('section');section.className='cwv-day';section.style.gridColumn=String(i+2);section.dataset.date=calendarDateKey(date);
    if(section.dataset.date===dayKey())section.classList.add('cwv-today');
    const header=document.createElement('header');header.className='cwv-header';
    const label=document.createElement('h3');label.className='cwv-date';label.textContent=`${['일','월','화','수','목','금','토'][seoulParts(date).weekday]} ${seoulParts(date).day}`;header.append(label);
    const pending=items.filter(item=>item.source==='task'&&!item.done);
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
    const grid=document.createElement('div');grid.className='cwv-timeline';
    if(timed.length){
      appendDayRows(grid,date,timed);addTips(grid);
      const places=line.place(calendarDateKey(date));
      for(const row of grid.querySelectorAll('.clv-event')){
        const at=places.get(row.dataset.googleCalendar+':'+row.dataset.googleEvent);if(!at)continue;
        row.style.top=at.top+'px';row.style.height=at.height+'px';
        row.style.left=`calc(${at.col} * 100% / ${at.cols})`;row.style.width=`calc(100% / ${at.cols} - 2px)`;
        row.dataset.cwvLines=String(at.lines);if(at.cols>1)row.classList.add('cwv-overlap');
      }
    }
    rows.append(grid);section.append(header,create,rows);box.append(section);
  }
  const axis=document.createElement('div');axis.className='cwv-axis';axis.setAttribute('aria-hidden','true');
  const ticks=document.createElement('div');ticks.className='cwv-axis-ticks';
  if(line.collapsedHeight){const fold=document.createElement('span');fold.className='cwv-fold';fold.textContent=`0–${line.firstHour}시`;ticks.append(fold)}
  for(const tick of line.ticks){const label=document.createElement('span');label.className='cwv-tick'+(tick.top?'':' cwv-tick-top');label.style.top=tick.top+'px';label.textContent=tick.hour+'시';ticks.append(label)}
  axis.append(ticks);box.append(axis);
  const bands=document.createElement('div');bands.className='cwv-bands';
  for(const seg of week.segments){
    const button=window.KPTUCalendarMonthView.eventButton(seg);
    const date=addSeoulDays(start,seg.startCol);button.dataset.date=calendarDateKey(date);
    bands.append(button);
  }
  box.append(bands);placeNow(box,line);restoreDayFocus(box,focusKey);
  markClipped(box);
  if(!clipWatch&&typeof ResizeObserver==='function'){clipWatch=new ResizeObserver(()=>{const current=document.querySelector('#calendarWeek');if(current)markClipped(current)});clipWatch.observe(box)}
}
