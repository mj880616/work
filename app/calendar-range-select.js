import {minuteAtY,rangeSlot,slotStart,slotEnd} from './calendar-create-slot.js';
// CAL-빈칸시간채우기(PC, 마우스): 주간 시간표의 빈 곳을 위아래로 끌어 시간 범위를 고르면, 놓을 때 그 범위가 들어간 일정 만들기 창이 열린다.
// 이 모듈은 끌기 입력과 미리보기 표시(메모리만)만 갖는다. 창 채우기는 calendar-interactions-v2.js(KPTUCalendarEvents.createSlot) 하나가 한다.
// 짧게 누르기는 calendar-interactions-v2.js의 한 번 누름(누른 15분 칸부터 1시간)이고, 4px 넘게 움직여야 범위 고르기가 된다.
// 일정을 끄는 것(calendar-drag.js)과는 시작하는 곳이 달라 겹치지 않는다: 여기는 빈 칸(.cwv-create)에서 시작할 때만 한다.
const PC=matchMedia('(min-width:1024px)'),SLOP=4;
let s=null,swallowClick=false;
const pad=n=>String(n).padStart(2,'0');
const clock=m=>m>=1440?'24:00':`${pad(Math.floor(m/60))}:${pad(m%60)}`;
function minuteAt(e){const r=s.line.getBoundingClientRect();return Math.min(1440,Math.max(0,minuteAtY(e.clientY,r.top+s.line.clientTop,s.line.clientHeight/24)))}
function clear(){s?.preview?.remove()}
function paint(e){
  const to=minuteAt(e),lo=Math.min(s.from,to),hi=Math.max(s.from,to),a=slotStart(lo),b=Math.max(slotEnd(hi),a+15);
  if(!s.preview){s.preview=document.createElement('div');s.preview.className='cwv-drag-preview';s.preview.setAttribute('aria-hidden','true');s.line.append(s.preview)}
  const hour=s.line.clientHeight/24;s.preview.style.top=a/60*hour+'px';s.preview.style.height=(b-a)/60*hour+'px';s.preview.textContent=`${clock(a)}–${clock(b)}`;s.to=to;
}
function down(e){
  if(s||e.button!==0||e.pointerType!=='mouse'||!PC.matches||e.ctrlKey||e.metaKey||e.shiftKey)return;
  const target=e.target;if(!target.classList?.contains('cwv-create'))return;
  const day=target.closest('.cwv-day[data-date]'),line=day?.querySelector('.cwv-timeline');if(!line||!line.clientHeight)return;
  if(e.clientY<line.getBoundingClientRect().top)return;
  s={target,date:day.dataset.date,line,pointer:e.pointerId,x0:e.clientX,y0:e.clientY,started:false,preview:null,to:null};
  s.from=minuteAt(e);
}
function move(e){
  if(!s||e.pointerId!==s.pointer)return;
  if(!s.started){if(Math.hypot(e.clientX-s.x0,e.clientY-s.y0)<SLOP)return;s.started=true;try{s.target.setPointerCapture(e.pointerId)}catch{}}
  e.preventDefault();paint(e);
}
function cancel(){if(!s)return;const was=s;clear();s=null;if(was.started){swallowClick=true;setTimeout(()=>{swallowClick=false},0)}}
function up(e){
  if(!s||e.pointerId!==s.pointer)return;
  if(!s.started){s=null;return}
  const done=s;done.to=minuteAt(e);clear();s=null;
  // 창을 먼저 연다(열기 버튼의 클릭이 아래 '끌기 뒤 클릭 막기'에 걸리지 않게). 그 뒤에 오는 마우스 클릭 한 번만 막는다.
  window.KPTUCalendarEvents?.createSlot?.(rangeSlot(done.date,done.from,done.to));
  swallowClick=true;setTimeout(()=>{swallowClick=false},0);
}
document.addEventListener('pointerdown',down,true);
document.addEventListener('pointermove',move,{capture:true,passive:false});
document.addEventListener('pointerup',up,true);
document.addEventListener('pointercancel',e=>{if(s&&e.pointerId===s.pointer)cancel()},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&s&&s.started)cancel()},true);
// 끌기 뒤 따라오는 클릭 한 번은 한 번 누름(1시간 일정 만들기)으로 처리하지 않는다.
window.addEventListener('click',e=>{if(swallowClick){swallowClick=false;e.preventDefault();e.stopImmediatePropagation()}},true);
window.addEventListener('kptu:session-changed',cancel);
window.__KPTU_CALENDAR_RANGE_READY__=Promise.resolve(true);
