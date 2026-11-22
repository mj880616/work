import {addSeoulDays,seoulParts,formatSeoulTime} from './meeting-time.js';
import {dayKey} from './home-read-model.js';
import {waitEl} from './wait-state.js';
import {dayItems,calendarDateKey,appendDayRows,captureDayFocus,restoreDayFocus} from './calendar-day-items.js';
import {bindRowSwipe,PICK} from './row-swipe.js';
let observer=null,focusKey=null,armScroll=null,armedStart=null;
// 끝 지켜보기는 다시 그릴 때마다 같은 곳(renderList)에서 새 단추에 다시 건다. 사용자가 한 번 내린 뒤(armedStart)에는 다시 그려도 바로 건다.
function unwatch(){observer?.disconnect();observer=null;if(armScroll){document.removeEventListener('scroll',armScroll,true);armScroll=null}}
export function stopList(){unwatch();armedStart=null}
// UI-줄밀기 Raindrop식(S68-26 2/2, 명진 11/22 21:31): 폰 일정 목록 줄 — 왼쪽으로 밀면 [보고할 일정]/[표시 끄기](우클릭·꾹 누르기 메뉴의 [보고할 일정]과 같은
// KPTUCalendarEvents.setPlan, 서버 저장·다시 누르면 되돌아감, 끝까지 밀면 바로). 서버에서 읽어 둔 값이 없으면 칸이 없다(메뉴와 같은 규칙).
// 오른쪽으로 밀면 [선택] → 'n개 선택됨 · [보고할 일정]'(하나씩 차례로 같은 길). 일정 삭제는 되돌리는 길이 없어(Google 일정 바로 삭제) 줄 밀기에 두지 않고,
// 다른 캘린더로 옮기기도 수정 창에서만 한다. 같은 일정이 여러 날에 보이면 함께 골라진다(같은 일정).
let swipeBound=false;
const planOf=el=>window.KPTUCalendarEvents?.planOf?.(el.dataset.googleEvent,el.dataset.googleCalendar||'primary')||null;
const pickKey=el=>`${el.dataset.googleCalendar||'primary'} ${el.dataset.googleEvent}`;
function bindSwipe(box){
  if(swipeBound)return;swipeBound=true;
  bindRowSwipe(box,{row:'.clv-event[data-google-event]',
    actions:el=>{const plan=planOf(el);if(!plan||!window.KPTUCalendarEvents?.setPlan)return null;return {start:PICK,end:[plan.on?{key:'plan-off',label:'표시 끄기',tone:'muted',icon:'undo'}:{key:'plan-on',label:'보고할 일정',tone:'info'}]}},
    run:(key,el)=>{const plan=planOf(el);if(!plan)return;void window.KPTUCalendarEvents?.setPlan?.(el.dataset.googleEvent,el.dataset.googleCalendar||'primary',key==='plan-on')},
    select:{attr:'data-clv-pick',label:'선택한 일정',acts:()=>[{key:'plan-on',label:'보고할 일정'}],
      run:async(key,ids)=>{if(key!=='plan-on')return;for(const id of ids){const [calendarId,eventId]=id.split(' ');const plan=window.KPTUCalendarEvents?.planOf?.(eventId,calendarId);if(plan&&!plan.on)await window.KPTUCalendarEvents.setPlan(eventId,calendarId,true)}}}});
}
export function renderList(options,{start,days,tasks,busy,error,more}){
  unwatch();
  const startKey=start.getTime();
  if(armedStart!==null&&armedStart!==startKey)armedStart=null;
  const box=document.querySelector('#calendarList');if(!box)return;
  focusKey=captureDayFocus(box,focusKey);
  bindSwipe(box);
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
  const button=document.createElement('button');button.type='button';button.id='calendarListMore';button.className='clv-more';button.textContent=error?'다시':'다음 14일 불러오기';button.disabled=busy;button.addEventListener('click',more);
  // UI-기다림표시통일 2차: 다음 14일을 받는 동안은 버튼 글자 대신 그 자리 위에 가는 줄 + 회색 빈 줄(wait-state.js).
  if(busy){button.setAttribute('aria-busy','true');box.append(waitEl({rows:2}))}
  box.append(button);
  // 줄 밀기 [선택]이 고를 열쇠(캘린더 + 일정 id). 줄 그리기(calendar-day-items.js)는 주간 보기와 같이 쓰므로 목록에서만 붙인다.
  for(const row of box.querySelectorAll('.clv-event[data-google-event]'))row.dataset.clvPick=pickKey(row);
  restoreDayFocus(box,focusKey);
  // 아래로 내려 끝에 닿으면 다음 14일. UI-전수디자인점검 F05로 빈 날이 한 줄이 되어 14일이 한 화면에 들어오므로,
  // 열자마자 저절로 더 받지 않게 사용자가 한 번 내린 뒤부터 지켜본다(다 들어오면 [다음 14일 불러오기]를 누르면 된다).
  if(!busy&&!error){const watch=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))more()});observer=watch;
    if(armedStart===startKey)watch.observe(button);
    else{armScroll=()=>{document.removeEventListener('scroll',armScroll,true);armScroll=null;armedStart=startKey;if(observer===watch)watch.observe(button)};document.addEventListener('scroll',armScroll,{capture:true,passive:true})}}
}
