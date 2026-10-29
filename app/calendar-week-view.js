import {addSeoulDays,seoulParts,formatSeoulTime} from './meeting-time.js';
import {weekTimeline,dayMinute,eventMinutes,MIN_HEIGHT} from './calendar-week-timeline.js';
import {canDrag,dayDiff} from './calendar-drag-model.js';
import {dayKey} from './home-read-model.js';
import {dayItems,calendarDateKey,appendDayRows,captureDayFocus,restoreDayFocus,weekBands} from './calendar-day-items.js';
let focusKey=null,clipWatch=null,nowTimer=null;
// CAL-끌어옮기기: 끄는 동안의 미리보기도 이 renderer가 그린다. 상태는 calendar-drag.js가 setWeekDrag로 넘기고(메모리만),
// 주간을 다시 그려도 끝에서 같은 미리보기를 다시 그린다. lastLine·lastStart = 마지막으로 그린 시간표 위치 계산과 주 시작.
let drag=null,lastLine=null,lastStart=null;
const sameEvent=(el,key)=>el.dataset.googleEvent===key.id&&el.dataset.googleCalendar===key.calendarId;
function paintDrag(box){
  box.querySelectorAll('.cwv-drag-preview').forEach(el=>el.remove());
  box.querySelectorAll('.cwv-drag-source').forEach(el=>el.classList.remove('cwv-drag-source'));
  box.classList.toggle('cwv-dragging',!!drag);
  if(!drag||!lastLine||!lastStart)return;
  const source=[...box.querySelectorAll(drag.kind==='band'?'.cwv-bands [data-google-event]':'.cwv-timeline [data-google-event]')].find(el=>sameEvent(el,drag.key));
  source?.classList.add('cwv-drag-source');
  const preview=document.createElement('div');preview.className='cwv-drag-preview'+(drag.blocked?' cwv-drag-blocked':'')+(drag.saving?' cwv-drag-saving':'');
  preview.setAttribute('aria-hidden','true');preview.textContent=drag.label||'';
  if(drag.kind==='band'){
    const bands=box.querySelector('.cwv-bands');if(!bands)return;
    const first=calendarDateKey(lastStart),inclusive=drag.next.allDay?addSeoulDays(drag.next.end,-1):new Date(Date.parse(drag.next.end)-1);
    const startCol=Math.max(0,dayDiff(first,calendarDateKey(drag.next.start))),endCol=Math.min(6,dayDiff(first,calendarDateKey(inclusive)));
    if(endCol<0||startCol>6)return;
    preview.style.gridColumn=`${startCol+1} / span ${Math.max(1,endCol-startCol+1)}`;preview.style.gridRow=source?.style.gridRow||'1';bands.append(preview);return;
  }
  const key=calendarDateKey(new Date(drag.next.start)),day=box.querySelector(`.cwv-day[data-date="${key}"] .cwv-timeline`);if(!day)return;
  const m=eventMinutes(drag.next,key),top=lastLine.y(m.start);
  preview.style.top=top+'px';preview.style.height=Math.max(MIN_HEIGHT,lastLine.y(m.end)-top)+'px';day.append(preview);
}
export function setWeekDrag(next){drag=next;const box=document.querySelector('#calendarWeek');if(box)paintDrag(box)}
// 7시 시작 위치: 처음 열 때·다른 주로 옮길 때·'오늘'을 누를 때만 맞춘다(pendingTop). 사용자가 스크롤한 뒤에는 건드리지 않는다.
// 화면에 안 보이는 상태(display:none)에서는 스크롤 값이 0으로 눌리므로 값을 맞추지 않고 보류했다가, 보이게 되는 순간 한 번 맞춘다.
let pendingTop=true,shownKey=null,startTop=0,boxHeight=0;
export function resetWeekScroll(){pendingTop=true}
const laidOut=box=>box.clientHeight>0;
function applyStart(box){if(!pendingTop||!laidOut(box))return;box.scrollTop=startTop;pendingTop=false}
// 주간 칸: 제목이 2줄을 넘어 잘린 일정만 말풍선(시간+전체 제목)을 보이게 표시한다. 화면 읽기는 본문 전체 제목을 그대로 읽으므로 말풍선은 가린다.
function addTips(rows){
  for(const row of rows.querySelectorAll('.clv-event')){
    const tip=document.createElement('span');tip.className='cwv-tip';tip.setAttribute('aria-hidden','true');
    tip.textContent=`${row.querySelector('.clv-time')?.textContent||''} ${row.querySelector('.clv-title')?.textContent||''}`.trim();row.append(tip);
  }
}
function markClipped(box){
  for(const row of box.querySelectorAll('.cwv-items .clv-event')){const title=row.querySelector('.clv-title');row.classList.toggle('cwv-clipped',!!title&&(title.scrollHeight>title.clientHeight+1||title.scrollWidth>title.clientWidth+1))}
  // 종일·여러 날 띠: 제목이 한 줄에서 잘린 것만 같은 말풍선을 보인다.
  for(const row of box.querySelectorAll('.cwv-bands .cmv-event')){const title=row.querySelector('.cmv-event-title');row.classList.toggle('cwv-clipped',!!title&&title.scrollWidth>title.clientWidth+1)}
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
  // 같은 주를 다시 그릴 때는 보던 자리를 그대로 둔다(그리기 전에 읽어 둔다). 주가 바뀌었거나 안 보이는 상태면 7시 맞춤을 보류한다.
  const key=calendarDateKey(start);if(shownKey!==key)pendingTop=true;if(!laidOut(box))pendingTop=true;
  const kept=pendingTop?null:box.scrollTop;shownKey=key;
  focusKey=captureDayFocus(box,focusKey);box.replaceChildren();
  const {week,keys}=weekBands(options,start);
  box.style.setProperty('--cwv-band-height',`${week.laneCount*48}px`);
  // CAL-주간시간표: timed events per day first, so the whole week decides which early hours (0~7시) unfold.
  const days=Array.from({length:7},(_,i)=>{const date=addSeoulDays(start,i),items=dayItems(options,date,tasks);
    return {date,items,timed:items.filter(e=>e.source==='google'&&!keys.has('google:'+e.calendarId+':'+e.id)).sort((a,b)=>a.start-b.start||String(a.title).localeCompare(String(b.title),'ko'))}});
  const line=weekTimeline(days.map(d=>({date:calendarDateKey(d.date),events:d.timed})));
  box.style.setProperty('--cwv-timeline-height',`${line.height}px`);
  box.dataset.week=key;startTop=line.startTop;lastLine=line;lastStart=start;
  const state=options.googleState;
  for(let i=0;i<7;i++){
    const {date,items,timed}=days[i];
    const section=document.createElement('section');section.className='cwv-day';section.style.gridColumn=String(i+2);section.dataset.date=calendarDateKey(date);
    const isToday=section.dataset.date===dayKey();if(isToday)section.classList.add('cwv-today','ds-today');
    const header=document.createElement('header');header.className='cwv-header';
    const label=document.createElement('h3');label.className='cwv-date'+(isToday?' ds-today-num':'');label.textContent=`${['일','월','화','수','목','금','토'][seoulParts(date).weekday]} ${seoulParts(date).day}`;header.append(label);
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
        // CAL-끌어옮기기: 수정 창과 같은 쓰기 권한(owner·writer) 캘린더 일정만 끌 수 있고, 아래 끝 손잡이로 길이를 바꾼다.
        if(canDrag(row.dataset.googleCalendar,state)){row.dataset.drag='timed';const grip=document.createElement('span');grip.className='cwv-resize';grip.dataset.dragResize='';grip.setAttribute('aria-hidden','true');row.append(grip)}
      }
    }
    const cap=document.createElement('div');cap.className='cwv-cap';cap.setAttribute('aria-hidden','true');
    rows.append(cap,grid);section.append(header,create,rows);box.append(section);
  }
  const axis=document.createElement('div');axis.className='cwv-axis';axis.setAttribute('aria-hidden','true');
  const ticks=document.createElement('div');ticks.className='cwv-axis-ticks';
  for(const tick of line.ticks){const label=document.createElement('span');label.className='cwv-tick';label.style.top=tick.top+'px';label.textContent=tick.hour+'시';ticks.append(label)}
  axis.append(ticks);box.append(axis);
  const bands=document.createElement('div');bands.className='cwv-bands';
  for(const seg of week.segments){
    const button=window.KPTUCalendarMonthView.eventButton(seg);
    const date=addSeoulDays(start,seg.startCol);button.dataset.date=calendarDateKey(date);
    button.removeAttribute('title');if(seg.startCol>=4)button.classList.add('cwv-tip-end');
    if(canDrag(seg.ev.calendarId,state)){button.dataset.drag='band';if(!seg.continuesRight){const grip=document.createElement('span');grip.className='cwv-band-resize';grip.dataset.dragResize='';grip.setAttribute('aria-hidden','true');button.append(grip)}}
    const tip=document.createElement('span');tip.className='cwv-tip';tip.setAttribute('aria-hidden','true');
    tip.textContent=`${button.querySelector('.cmv-event-time')?.textContent||''} ${button.querySelector('.cmv-event-title')?.textContent||''}`.trim();button.append(tip);
    bands.append(button);
  }
  bands.hidden=!week.segments.length;
  box.append(bands);
  placeNow(box,line);paintDrag(box);restoreDayFocus(box,focusKey);
  if(pendingTop)applyStart(box);else if(kept!==null)box.scrollTop=kept;
  markClipped(box);
  if(!clipWatch&&typeof ResizeObserver==='function'){clipWatch=new ResizeObserver(()=>{const current=document.querySelector('#calendarWeek');if(!current)return;const was=boxHeight;boxHeight=current.clientHeight;if(!was&&boxHeight)pendingTop=true;applyStart(current);markClipped(current)});clipWatch.observe(box)}
}
