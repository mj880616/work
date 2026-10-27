import {seoulClock} from './meeting-time.js';
// CAL-저장본먼저: the one small status line of screens that show this device's saved copy first (calendar, home 오늘 일정·할 일,
// task list). Each screen keeps its own state and calls this to draw it; nothing is stored here.
//   'loading' — nothing saved yet, first read under way      → 불러오는 중…
//   'refresh' — saved copy shown, fresh read under way       → 새로 불러오는 중
//   'stale'   — fresh read failed, saved copy still shown    → 최신 아님 · 마지막 확인 HH:MM [다시 시도]
//   'failed'  — first read failed, nothing to show           → 불러오지 못했습니다 [다시 시도]
//   ''        — latest shown: the line is hidden
export function freshnessText(state,checkedAt=0){
  if(state==='loading')return '불러오는 중…';
  if(state==='refresh')return '새로 불러오는 중';
  if(state==='stale')return '최신 아님'+(checkedAt?` · 마지막 확인 ${seoulClock(new Date(checkedAt))}`:'');
  if(state==='failed')return '불러오지 못했습니다';
  return '';
}
export function paintFreshness(el,{state='',checkedAt=0,onRetry=null}={}){
  if(!el)return;
  const text=freshnessText(state,checkedAt),sign=state+'|'+text;
  if(el.dataset.freshnessSign===sign)return;
  // Keep focus on [다시 시도] when the same failure is drawn again, and move it to the line when the button goes away.
  const hadFocus=el.contains(document.activeElement);
  el.dataset.freshnessSign=sign;el.dataset.freshness=state;
  el.classList.add('data-freshness');el.classList.toggle('data-freshness-warn',state==='stale'||state==='failed');
  el.hidden=!text;
  const label=document.createElement('span');label.className='data-freshness-text';label.textContent=text;
  el.replaceChildren(label);
  if((state==='stale'||state==='failed')&&onRetry){
    const b=document.createElement('button');b.type='button';b.className='mini data-freshness-retry';b.dataset.freshnessRetry='';b.textContent='다시 시도';
    b.addEventListener('click',()=>{b.disabled=true;onRetry()});
    el.append(b);if(hadFocus)b.focus({preventScroll:true});
  }
}
