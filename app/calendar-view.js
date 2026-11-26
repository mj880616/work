import {seoulDayStart,seoulDate,seoulParts,addSeoulDays,seoulDateKey} from './meeting-time.js';
import {renderList,stopList} from './calendar-list-view.js';
import {renderWeek,resetWeekScroll} from './calendar-week-view.js';
import {dayItems,calendarDateKey} from './calendar-day-items.js';
import {dayKey,ranges} from './home-read-model.js';
import {viewPrefs} from './view-prefs.js';
// S70-57 UI-검색창하나로(명진 11/26 "메뉴별 검색창은 그 메뉴에서 찾기로 통일"): 맨 위 칸 '일정에서 찾기'.
import {registerScreenFind,findFor} from './screen-find.js';
import {loadEvents} from './global-search-data.js'; // S70-67: 다른 달 일정 찾기 = 전체 검색의 일정 읽기 그대로
// Owns view choice, list/week ranges and list pagination. The choice is remembered on the server (view-prefs.js, profile view_prefs).
const desktop=matchMedia('(min-width:761px)');
const today=()=>seoulDayStart(new Date());
const defaultView=()=>desktop.matches?'week':'list';
let preference=null;
{const saved=viewPrefs.get('calendar_view');if(saved==='list'||saved==='week'||saved==='month')preference=saved}
const effectiveView=()=>!desktop.matches&&preference==='week'?'list':preference||defaultView();
let view=effectiveView();
const thisWeek=()=>new Date(ranges().weekStart);
let start=today(),weekStart=thisWeek(),days=14,pendingDays=0,tasks=[],options=null,busy=false,error=false,revision=0;
function range(appendPage=false){if(view==='month')return null;const first=view==='week'?weekStart:start,end=new Date(first);end.setTime(addSeoulDays(end,view==='week'?7:pendingDays||days).getTime());const s=new Date(first),append=view==='list'&&appendPage&&pendingDays>days;if(append)s.setTime(addSeoulDays(s,days).getTime());return {s:new Date(calendarDateKey(s)+'T00:00:00+09:00'),e:new Date(calendarDateKey(end)+'T00:00:00+09:00'),append}}
// NAV-새로고침제자리: the first day shown (list: its first day, week: its Monday, month: the 1st) is written to the address as
// ?view=calendar&date=YYYY-MM-DD when it is not today's default (no history entry of its own), so a reload shows the same dates.
// The address is read once when this module loads; until it is applied nothing is written.
let placeDate=(()=>{const q=new URLSearchParams(globalThis.location?.search||''),d=q.get('date')||'';return q.get('view')==='calendar'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(seoulDayStart(d).getTime())?d:null})();
function applyPlace(){
  if(!placeDate)return false;
  const d=seoulDayStart(placeDate);
  if(view==='month'){const show=window.__KPTU_CALENDAR_SHOW_MONTH__;if(!show)return true;placeDate=null;show(d);return true}
  placeDate=null;
  if(view==='week')weekStart=new Date(addSeoulDays(d,-((seoulParts(d).weekday+6)%7)).getTime());else start=d;
  reset();queueMicrotask(()=>window.KPTUCalendarPersistence?.refresh());
  return false;
}
function writePlace(first){
  const t=seoulParts(today()),f=seoulParts(first);
  const isDefault=view==='month'?f.year===t.year&&f.month===t.month:seoulDateKey(first)===seoulDateKey(view==='week'?thisWeek():today());
  window.KPTURouter?.setPlace?.('calendar',{date:isDefault?null:seoulDateKey(first)});
}
// 맨 위 칸 '일정에서 찾기' = 지금 보기(목록·주간·월간)의 Google 일정·할 일을 제목으로 거른다. 걸러 내기는 그리기 직전 이 한 곳(render)에서만 하고
// 월간 칸의 할 일(calendar-month-view.js가 setTasks로 받은 목록)은 같은 판정(options.taskFind)을 넘겨 거른다. 글자는 메모리만.
// S70-67 SEARCH-비슷한것찾기: 판정은 공용 부품(screen-find.js findFor — 띄어쓰기 무시·오타·초성·앞부분, 비슷한 말·기간)이고,
// 지금 보기 밖의 날(다른 달) 일정도 찾는다: 전체 검색이 쓰는 일정 읽기(global-search-data.js loadEvents — 지난 3개월~앞 6개월, 이 탭 메모리)를 그대로 써서
// 보기 밖에서 맞은 일정을 맞은 정도 순으로 '다른 날 일정' 줄(#calendarFindMore, 이 파일이 유일한 주인)에 두고, 누르면 그 날로 옮긴다.
let findText='',calFind=null,otherEvents=null,otherAsked=false;
const eventDay=e=>{const d=new Date(e?.start||'');return Number.isFinite(d.getTime())?(e.allDay?String(e.start).slice(0,10):seoulDateKey(d)):''};
const findHit=x=>!calFind||calFind.empty||!!calFind.hitAt(x?.source==='task'||x?.date?String(x?.date||''):eventDay(x),x?.title);
const found=next=>{calFind=findFor('calendar',findText);return calFind.empty?next:{...next,googleEvents:(next.googleEvents||[]).filter(findHit),taskFind:findHit}};
const shownTasks=()=>calFind&&!calFind.empty?tasks.filter(findHit):tasks;
registerScreenFind('calendar',{label:'일정에서 찾기',marks:'#calendarView .clv-title, #calendarView .cmv-event-title, #calendarFindMore .cfm-title',
  active:()=>{const v=document.querySelector('#calendarView');return !!v&&!v.classList.contains('hidden')},value:()=>findText,
  apply:(raw,{again}={})=>{const next=String(raw??'');if(next.trim()===findText.trim()&&!again){findText=next;return}findText=next;if(!findText.trim())otherAsked=false;else if(!otherAsked)askOther();paint()}});
// 로그인이 바뀌면 받아 둔 다른 날 일정을 버린다. 찾기 글자를 비웠다가 다시 치면 새로 받는다(읽기 자체는 loadEvents가 이 탭 메모리에서 아낀다).
window.addEventListener('kptu:session-changed',()=>{otherEvents=null;otherAsked=false});
function askOther(){
  otherAsked=true;
  loadEvents().then(r=>{otherEvents=Array.isArray(r?.list)?r.list:[];if(findText.trim())paint()},()=>{otherAsked=false});
}
const shortDay=d=>{const [y,m,day]=d.split('-').map(Number),ty=seoulParts(today()).year;return `${y!==ty?y+'년 ':''}${m}월 ${day}일`};
function paintOther(first,end){
  const box=document.querySelector('#calendarFindMore');if(!box)return;
  const from=seoulDateKey(first),to=seoulDateKey(end);
  const rows=calFind&&!calFind.empty&&otherEvents?calFind.rank(otherEvents.filter(e=>{const d=eventDay(e);return d&&(d<from||d>to)}),e=>[e.title],eventDay).slice(0,8):[];
  box.hidden=!rows.length;box.replaceChildren();
  if(!rows.length)return;
  const head=document.createElement('div');head.className='cfm-head';head.textContent=`다른 날 일정 ${rows.length}개`;box.append(head);
  for(const e of rows){
    const day=eventDay(e),row=document.createElement('button');row.type='button';row.className='cfm-row';row.dataset.day=day;
    const d=document.createElement('span');d.className='cfm-day';d.textContent=shortDay(day);
    const t=document.createElement('span');t.className='cfm-title';t.textContent=e.title||'(제목 없음)';
    row.append(d,t);row.addEventListener('click',()=>showDay(day));box.append(row);
  }
}
function render(next){
  if(applyPlace())return;
  next=found(next);options=next;
  const grid=document.querySelector('#calendarGrid'),list=document.querySelector('#calendarList'),week=document.querySelector('#calendarWeek');if(!grid||!list||!week)return;
  grid.classList.toggle('hidden',view!=='month');list.classList.toggle('hidden',view!=='list');week.classList.toggle('hidden',view!=='week');grid.closest('#calendarView')?.classList.toggle('calendar-list-active',view!=='month');
  if(view!=='list')stopList();
  document.querySelectorAll('[data-calendar-view]').forEach(b=>{b.hidden=b.dataset.calendarView==='week'&&!desktop.matches;b.setAttribute('aria-pressed',String(b.dataset.calendarView===view))});
  document.querySelector('#prevMonthBtn')?.setAttribute('aria-label',view==='list'?'이전 14일':view==='week'?'이전 주':'이전 달');document.querySelector('#nextMonthBtn')?.setAttribute('aria-label',view==='list'?'다음 14일':view==='week'?'다음 주':'다음 달');
  const first=view==='month'?seoulDate(next.year,next.month):view==='week'?weekStart:start,end=new Date(first);
  if(view!=='month')end.setTime(addSeoulDays(end,(view==='week'?7:days)-1).getTime());
  writePlace(first);
  const sameMonth=seoulParts(first).year===seoulParts(end).year&&seoulParts(first).month===seoulParts(end).month;
  const full=view==='month'?`${seoulParts(first).year}년 ${seoulParts(first).month+1}월`:`${seoulParts(first).month+1}월 ${seoulParts(first).day}일 – ${sameMonth?'':`${seoulParts(end).month+1}월 `}${seoulParts(end).day}일`;
  const label=view==='month'?full:`${seoulParts(first).year}년 ${seoulParts(first).month+1}월 ${seoulParts(first).day}일 – ${sameMonth?'':`${seoulParts(end).year}년 ${seoulParts(end).month+1}월 `}${seoulParts(end).day}일`;
  const title=document.querySelector('#monthTitle'),year=seoulParts(first).year===seoulParts(today()).year?'':`<span class="calendar-title-year">${seoulParts(first).year}</span>`;
  title.setAttribute('aria-label',label);
  title.innerHTML=`<span class="calendar-title-full" aria-hidden="true">${full}</span><span class="calendar-title-compact" aria-hidden="true">${year}<span class="calendar-title-month">${seoulParts(first).month+1}월</span></span>`;
  paintOther(first,view==='month'?new Date(addSeoulDays(seoulDate(seoulParts(first).year,seoulParts(first).month+1),-1).getTime()):end);
  if(view==='month')return window.KPTUCalendarMonthView?.render(next);
  if(view==='week')return renderWeek(next,{start:weekStart,tasks:shownTasks()});
  renderList(next,{start,days,tasks:shownTasks(),busy,error,more});
}
const paint=()=>window.__KPTU_RENDER_CALENDAR__?.();
function reset(){revision++;pendingDays=0;days=14;busy=false;error=false}
function select(next){if(next==='week'&&!desktop.matches)return;preference=next;viewPrefs.set('calendar_view',next);if(next===view)return;view=next;reset();paint();window.KPTUCalendarPersistence?.refresh()}
function move(delta){if(view==='month')return false;reset();const cursor=view==='week'?weekStart:start;cursor.setTime(addSeoulDays(cursor,delta*(view==='week'?7:14)).getTime());paint();window.KPTUCalendarPersistence?.refresh();return true}
function begin(){busy=true;error=false;paint();return revision}
function finish(at,ok){if(at!==revision||view==='month')return;busy=false;error=!ok;if(ok&&pendingDays){days=pendingDays;pendingDays=0}paint()}
// JOURNAL-하루일정다시: 업무일지 [달력 ›]가 그 날짜가 든 화면으로 옮긴다. 월간 = 그 달(team.js의 달 위치), 주간 = 그 주 월요일, 목록 = 그 날부터.
function showDay(day){
  const d=seoulDayStart(day);if(!Number.isFinite(d.getTime()))return false;
  if(view==='month'){window.__KPTU_CALENDAR_SHOW_MONTH__?.(d);return true}
  if(view==='week'){weekStart=new Date(addSeoulDays(d,-((seoulParts(d).weekday+6)%7)).getTime());resetWeekScroll()}else start=d;
  reset();paint();window.KPTUCalendarPersistence?.refresh();return true;
}
async function more(){if(view!=='list'||busy)return;pendingDays=pendingDays||(error?days:days+14);busy=true;error=false;paint();await window.KPTUCalendarPersistence?.refresh({appendPage:true})}
window.KPTUCalendarView={render,range,move,showDay,begin,finish,cancel:()=>{revision++;pendingDays=0;busy=false;error=false;paint()},current:()=>view,setTasks:list=>{tasks=list;if(view!=='month')paint()},dayItems:date=>options?dayItems(options,date,shownTasks()):[]};
document.querySelectorAll('[data-calendar-view]').forEach(b=>b.addEventListener('click',()=>select(b.dataset.calendarView)));
document.querySelector('#calendarTodayBtn')?.addEventListener('click',()=>{if(view!=='month'){if(view==='week'){weekStart=thisWeek();resetWeekScroll()}else start=today();reset();paint();window.KPTUCalendarPersistence?.refresh()}else window.__KPTU_CALENDAR_TODAY__?.()});

function resizeView(){const next=effectiveView();if(next!==view){view=next;reset();paint();window.KPTUCalendarPersistence?.refresh()}else paint()}
if(desktop.addEventListener)desktop.addEventListener('change',resizeView);else desktop.addListener(resizeView);
