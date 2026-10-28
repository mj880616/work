import {seoulClock} from './meeting-time.js';
import {barHtml} from './wait-state.js';
// CAL-저장본먼저: the one small status line of screens that show this device's saved copy first (calendar, home 오늘 일정·할 일,
// task list). Each screen keeps its own state and calls this to draw it; nothing is stored here.
//   'loading' — nothing saved yet, first read under way      → 글자 없는 가는 줄(wait-state.js barHtml)
//   'refresh' — saved copy shown, fresh read under way       → 글자 없는 가는 줄(UI-기다림표시통일 2차)
//   'stale'   — fresh read failed, saved copy still shown    → 최신 아님 · 마지막 확인 HH:MM [다시 시도]
//   'failed'  — first read failed, nothing to show           → 불러오지 못했습니다 [다시 시도]
//   ''        — latest shown: the line is hidden
export function freshnessText(state,checkedAt=0){
  if(state==='stale')return '최신 아님'+(checkedAt?` · 마지막 확인 ${seoulClock(new Date(checkedAt))}`:'');
  if(state==='failed')return '불러오지 못했습니다';
  return '';
}
export function paintFreshness(el,{state='',checkedAt=0,onRetry=null}={}){
  if(!el)return;
  const text=freshnessText(state,checkedAt),waiting=state==='loading'||state==='refresh',sign=state+'|'+text;
  if(el.dataset.freshnessSign===sign)return;
  // Keep focus on [다시 시도] when the same failure is drawn again, and move it to the line when the button goes away.
  const hadFocus=el.contains(document.activeElement);
  el.dataset.freshnessSign=sign;el.dataset.freshness=state;
  el.classList.add('data-freshness');el.classList.toggle('data-freshness-warn',state==='stale'||state==='failed');
  el.hidden=!text&&!waiting;
  // 기다림은 글자 없이 가는 줄 하나(0.4초 안에 끝나면 안 보임). 화면 읽기에는 '불러오는 중'으로 알린다.
  if(waiting){el.innerHTML=barHtml();return}
  const label=document.createElement('span');label.className='data-freshness-text';label.textContent=text;
  el.replaceChildren(label);
  if((state==='stale'||state==='failed')&&onRetry){
    const b=document.createElement('button');b.type='button';b.className='mini data-freshness-retry';b.dataset.freshnessRetry='';b.textContent='다시 시도';
    b.addEventListener('click',()=>{b.disabled=true;onRetry()});
    el.append(b);if(hadFocus)b.focus({preventScroll:true});
  }
}
