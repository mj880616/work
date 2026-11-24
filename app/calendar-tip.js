// CAL-말풍선통일(S69-21): 달력 일정 막대·할 일 줄에 마우스를 올리거나 키보드로 갔을 때 뜨는 말풍선은 이 부품 하나다.
// - 쓰는 곳: 월 보기 일정 막대·칸 안 할 일 줄·날 창 할 일 줄(calendar-month-view.js), 주 보기 시간표 일정·종일 띠(calendar-week-view.js).
// - 규칙(주 보기 기존 규칙 그대로): 제목이 잘린 것만 띄운다. 칸에 다 보이는 짧은 제목은 띄우지 않는다. 마우스(pointerType mouse)와
//   키보드 초점(:focus-visible)만 — 손가락 누름에는 띄우지 않는다. 화면 읽기는 줄의 aria-label을 읽으므로 말풍선은 가린다(aria-hidden).
// - 모양: .cwv-tip(calendar-ui.css). 칸 흐름에 끼지 않게 화면 기준(position:fixed)으로 줄 바로 아래에 뜨고, 아래가 모자라면 위로,
//   좌우는 화면 가장자리 8px 안으로 당긴다. 그래서 칸 높이·다른 줄 위치가 바뀌지 않고 칸(overflow:hidden)에 잘리지도 않는다.
// - 말풍선 마디는 열 때 만들고 닫을 때 지운다(줄 글자에 섞이지 않게). 글은 줄의 data-cal-tip에 둔다(addTip).
// - 스크롤·창 크기 바꾸기·누르기(끌기 시작 포함)·초점 이동이면 닫는다.
const EDGE=8,GAP=4;
const TITLE='.clv-title,.cmv-event-title';
let bound=false,openHost=null;

export function addTip(host,text){
  const value=String(text||'').trim();
  if(value)host.dataset.calTip=value;else delete host.dataset.calTip;
  bind();
  return host;
}
export function isClipped(title){
  return !!title&&(title.scrollWidth>title.clientWidth+1||title.scrollHeight>title.clientHeight+1);
}
const hostOf=target=>target?.closest?.('[data-cal-tip]')||null;
function close(){
  const host=openHost;openHost=null;
  if(!host)return;
  host.classList.remove('cwv-tip-open');
  host.querySelectorAll(':scope>.cwv-tip').forEach(tip=>tip.remove());
}
function place(host,tip){
  const r=host.getBoundingClientRect(),vw=document.documentElement.clientWidth,vh=document.documentElement.clientHeight;
  const w=tip.offsetWidth,h=tip.offsetHeight;
  let left=r.left;if(left+w>vw-EDGE)left=vw-EDGE-w;left=Math.max(EDGE,left);
  let top=r.bottom+GAP;if(top+h>vh-EDGE)top=Math.max(EDGE,r.top-GAP-h);
  tip.style.left=Math.round(left)+'px';tip.style.top=Math.round(top)+'px';
}
function open(host){
  if(openHost===host)return;
  close();
  if(!host.isConnected||host.closest('.cwv-dragging,.cmv-dragging'))return;
  const clipped=isClipped(host.querySelector(TITLE));
  host.classList.toggle('cwv-clipped',clipped);
  if(!clipped)return;
  const tip=document.createElement('span');tip.className='cwv-tip';tip.setAttribute('aria-hidden','true');tip.textContent=host.dataset.calTip;
  host.append(tip);host.classList.add('cwv-tip-open');openHost=host;
  place(host,tip);
}
function bind(){
  if(bound)return;bound=true;
  document.addEventListener('pointerover',e=>{
    if(e.pointerType!=='mouse')return;
    const host=hostOf(e.target);if(host)open(host);else if(openHost&&!openHost.matches(':focus-visible'))close();
  },true);
  document.addEventListener('pointerout',e=>{
    if(e.pointerType!=='mouse'||!openHost||hostOf(e.target)!==openHost)return;
    if(e.relatedTarget&&openHost.contains(e.relatedTarget))return;
    if(!openHost.matches(':focus-visible'))close();
  },true);
  document.addEventListener('focusin',e=>{const host=hostOf(e.target);if(host&&host===e.target&&host.matches(':focus-visible'))open(host);else close()});
  document.addEventListener('focusout',e=>{if(openHost&&e.target===openHost)close()});
  document.addEventListener('pointerdown',close,true);
  window.addEventListener('scroll',close,true);
  window.addEventListener('resize',close);
}
