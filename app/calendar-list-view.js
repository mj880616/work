import {addSeoulDays,seoulParts,formatSeoulTime} from './meeting-time.js';
import {dayKey} from './home-read-model.js';
import {waitEl} from './wait-state.js';
import {dayItems,calendarDateKey,appendDayRows,captureDayFocus,restoreDayFocus} from './calendar-day-items.js';
let observer=null,focusKey=null,armScroll=null;
export function stopList(){observer?.disconnect();if(armScroll){document.removeEventListener('scroll',armScroll,true);armScroll=null}}
export function renderList(options,{start,days,tasks,busy,error,more}){
  stopList();
  const box=document.querySelector('#calendarList');if(!box)return;
  focusKey=captureDayFocus(box,focusKey);
  box.replaceChildren();
  for(let i=0;i<days;i++){
    const date=addSeoulDays(start,i);
    const section=document.createElement('section');section.className='clv-day';section.dataset.date=calendarDateKey(date);
    const header=document.createElement('h3');header.className='clv-date';
    const today=section.dataset.date===dayKey();
    if(today){header.classList.add('clv-today');section.classList.add('ds-today');}
    header.textContent=(today?'오늘 · ':'')+`${seoulParts(date).month+1}월 ${seoulParts(date).day}일 ${['일','월','화','수','목','금','토'][seoulParts(date).weekday]}`;
    section.append(header);
    const persistence=window.KPTUCalendarPersistence,known=!!persistence?.knows?.(new Date(section.dataset.date+'T00:00:00+09:00'),addSeoulDays(new Date(section.dataset.date+'T00:00:00+09:00'),1));
    appendDayRows(section,date,dayItems(options,date,tasks),known);
    // UI-전수디자인점검 F05: 일정·할 일이 없는 날(받은 뒤)은 날짜와 '일정 없음'을 한 줄로 접는다.
    if(section.children.length===2&&section.lastElementChild.matches('.clv-empty:not([data-calendar-pending])'))section.classList.add('clv-day-empty');
    box.append(section);
  }
  const button=document.createElement('button');button.type='button';button.id='calendarListMore';button.className='clv-more';button.textContent=error?'다시 불러오기':'다음 14일 불러오기';button.disabled=busy;button.addEventListener('click',more);
  // UI-기다림표시통일 2차: 다음 14일을 받는 동안은 버튼 글자 대신 그 자리 위에 가는 줄 + 회색 빈 줄(wait-state.js).
  if(busy){button.setAttribute('aria-busy','true');box.append(waitEl({rows:2}))}
  box.append(button);
  restoreDayFocus(box,focusKey);
  // 아래로 내려 끝에 닿으면 다음 14일. UI-전수디자인점검 F05로 빈 날이 한 줄이 되어 14일이 한 화면에 들어오므로,
  // 열자마자 저절로 더 받지 않게 사용자가 한 번 내린 뒤부터 지켜본다(다 들어오면 [다음 14일 불러오기]를 누르면 된다).
  if(!busy&&!error){const watch=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))more()});observer=watch;armScroll=()=>{document.removeEventListener('scroll',armScroll,true);armScroll=null;if(observer===watch)watch.observe(button)};document.addEventListener('scroll',armScroll,{capture:true,passive:true})}
}
