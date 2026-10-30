import {HOUR} from './calendar-week-timeline.js';
import {canDrag,moveTimed,resizeTimed,moveBand,resizeBand,moveDays,dayDiff,original,same,label} from './calendar-drag-model.js';
import {setWeekDrag} from './calendar-week-view.js';
import {offerUndoNotice} from './basket-record-delete.js';
// CAL-끌어옮기기(PC, 마우스): 주간 시간 일정(위아래 = 시간, 옆 = 날짜, 아래 끝 = 끝 시간), 주간 종일·여러 날 띠(옆 = 날짜, 오른쪽 끝 =
// 기간), 월간 일정(다른 날로)을 끌어 옮긴다. 이 모듈은 끌기 입력과 상태(메모리)만 갖고, 미리보기는 주간·월간 renderer가 그리며
// (setWeekDrag·KPTUCalendarMonthView.setDrag), 저장은 일정 수정 창과 같은 update-event 경로(KPTUCalendarEvents.saveMove)다.
// 짧게 누르기는 지금처럼 일정 열기(클릭)이고, 4px 넘게 움직여야 끌기가 된다. 끌기 뒤에 따라오는 클릭 한 번은 막는다.
// 시간 일정 ↔ 종일 줄 사이로 끌면 막는다(놓으면 원래 자리). 키보드는 그대로 Enter·Space로 수정 창을 연다.
const PC=matchMedia('(min-width:761px)'),SLOP=4,EDGE=28;
let g=null,swallowClick=false;
const findRaw=(id,calendarId)=>(window.__KPTU_GOOGLE_EVENTS__||[]).find(e=>e.id===id&&(e.calendarId||'primary')===calendarId);
const show=(state,view=g?.view)=>{if(view==='month')window.KPTUCalendarMonthView?.setDrag?.(state);else setWeekDrag(state)};
const toast=text=>window.KPTUCalendarEvents?.toast?.(text);
function columnAt(box,x){
  const days=[...box.querySelectorAll('.cwv-day[data-date]')];if(!days.length)return null;
  let best=days[0];for(const d of days){const r=d.getBoundingClientRect();if(x>=r.left)best=d}
  return best.dataset.date;
}
function cellAt(grid,x,y){
  for(const c of grid.querySelectorAll('.cal-cell[data-date]')){const r=c.getBoundingClientRect();if(x>=r.left&&x<r.right&&y>=r.top&&y<r.bottom)return c.dataset.date}
  return null;
}
// 주간 상자에서 시간표가 보이기 시작하는 높이(고정된 날짜 줄 + 종일 띠 아래).
function timelineTop(box){const band=box.querySelector('.cwv-bands:not([hidden])'),head=box.querySelector('.cwv-header');return (band||head)?.getBoundingClientRect().bottom??box.getBoundingClientRect().top}
function compute(e){
  const {raw,kind,mode}=g;
  if(g.view==='month'){const at=cellAt(g.box,e.clientX,e.clientY)||g.lastCell;g.lastCell=at;return {next:moveDays(raw,dayDiff(g.fromCell,at)),blocked:false}}
  const col=columnAt(g.box,e.clientX),dayDelta=dayDiff(g.fromCol,col);
  if(kind==='timed'){
    const blocked=e.clientY<timelineTop(g.box);
    const minuteDelta=((e.clientY+g.box.scrollTop)-g.y0)/HOUR*60;
    return {next:mode==='resize'?resizeTimed(raw,{minuteDelta}):moveTimed(raw,{dayDelta,minuteDelta}),blocked};
  }
  const band=g.box.querySelector('.cwv-bands');const blocked=!!band&&e.clientY>band.getBoundingClientRect().bottom+4;
  return {next:mode==='resize'?resizeBand(raw,{dayDelta}):moveBand(raw,{dayDelta}),blocked};
}
function paint(){if(!g?.next)return show(null);show({key:g.key,kind:g.kind,next:g.next,blocked:g.blocked,saving:g.saving,label:g.blocked?'여기로는 옮길 수 없음':label(g.next)})}
function autoscroll(e){if(g.view!=='week'||g.kind!=='timed')return;const r=g.box.getBoundingClientRect();if(e.clientY>r.bottom-EDGE)g.box.scrollTop+=12;else if(e.clientY<timelineTop(g.box)+EDGE&&e.clientY>=timelineTop(g.box))g.box.scrollTop-=12}
function down(e){
  if(g||e.button!==0||e.pointerType!=='mouse'||!PC.matches||e.ctrlKey||e.metaKey||e.shiftKey)return;
  const el=e.target.closest?.('[data-drag][data-google-event]');if(!el)return;
  const week=el.closest('#calendarWeek'),month=el.closest('#calendarGrid');const box=week||month;if(!box)return;
  const id=el.dataset.googleEvent,calendarId=el.dataset.googleCalendar||'primary',raw=findRaw(id,calendarId);
  if(!raw||!canDrag(calendarId,window.__KPTU_GOOGLE_STATE__))return;
  g={el,box,view:week?'week':'month',kind:el.dataset.drag,mode:e.target.closest('[data-drag-resize]')?'resize':'move',key:{id,calendarId},raw,pointer:e.pointerId,x0:e.clientX,y1:e.clientY,y0:e.clientY+box.scrollTop,started:false,next:null,blocked:false,saving:false};
  if(week)g.fromCol=columnAt(box,e.clientX);else g.fromCell=g.lastCell=cellAt(box,e.clientX,e.clientY);
  if(g.view==='month'&&!g.fromCell){g=null;return}
}
function move(e){
  if(!g||g.saving||e.pointerId!==g.pointer)return;
  if(!g.started){if(Math.hypot(e.clientX-g.x0,e.clientY-g.y1)<SLOP)return;g.started=true;try{g.el.setPointerCapture(e.pointerId)}catch{}}
  e.preventDefault();autoscroll(e);
  const r=compute(e);g.next=r.next;g.blocked=r.blocked||!r.next;paint();
}
function cancel(){if(!g)return;const was=g;g=null;if(was.started)show(null,was.view)}
async function up(e){
  if(!g||g.saving||e.pointerId!==g.pointer)return;
  if(!g.started){g=null;return}
  swallowClick=true;setTimeout(()=>{swallowClick=false},0);
  const r=compute(e);g.next=r.next;g.blocked=r.blocked||!r.next;
  if(g.blocked||same(g.raw,g.next)){if(g.blocked)toast(g.kind==='timed'&&g.view==='week'?'시간 일정은 종일 줄로 옮길 수 없습니다.':g.kind==='band'?'종일 일정은 시간표로 옮길 수 없습니다.':'여기로는 옮길 수 없습니다.');cancel();return}
  const drop=g;drop.saving=true;paint();
  const before=original(drop.raw),result=await window.KPTUCalendarEvents?.saveMove?.(drop.key.id,drop.key.calendarId,before,drop.next)||{status:'unknown',text:'저장 경로를 불러오지 못했습니다.'};
  if(g===drop){g=null;show(null,drop.view)}
  if(result.status==='stale')return;
  if(result.status!=='saved'){if(result.text)toast(result.text);if(['changed','unknown'].includes(result.status))window.__KPTU_RELOAD_GOOGLE_EVENTS__?.()?.catch?.(()=>{});return}
  const after=original(result.event);
  offerUndoNotice({text:result.recurring?'옮김 · 반복 일정 중 이 일정만':'옮김',onUndo:async()=>{
    const back=await window.KPTUCalendarEvents.saveMove(drop.key.id,drop.key.calendarId,after,before);
    if(back.status==='stale')return {status:'stale'};
    if(back.status==='saved')return {status:'restored',message:'원래 시간으로 되돌렸어요.'};
    if(['changed','unknown'].includes(back.status))window.__KPTU_RELOAD_GOOGLE_EVENTS__?.()?.catch?.(()=>{});
    return {status:'failed',message:back.text||'되돌리지 못했습니다.'};
  }});
}
document.addEventListener('pointerdown',down,true);
document.addEventListener('pointermove',move,{capture:true,passive:false});
document.addEventListener('pointerup',up,true);
document.addEventListener('pointercancel',e=>{if(g&&!g.saving&&e.pointerId===g.pointer)cancel()},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&g&&!g.saving&&g.started){swallowClick=true;setTimeout(()=>{swallowClick=false},0);cancel()}},true);
// 끌기 뒤 클릭은 일정 열기·새 일정 만들기보다 먼저(window capture) 막는다.
window.addEventListener('click',e=>{if(swallowClick){swallowClick=false;e.preventDefault();e.stopImmediatePropagation()}},true);
document.addEventListener('dragstart',e=>{if(e.target?.closest?.('[data-drag]'))e.preventDefault()},true);
window.addEventListener('kptu:session-changed',cancel);
window.__KPTU_CALENDAR_DRAG_READY__=Promise.resolve(true);
