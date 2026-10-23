import {seoulDayStart,seoulDate,seoulParts,addSeoulDays} from './meeting-time.js';
import {renderList,stopList} from './calendar-list-view.js';
import {renderWeek,resetWeekScroll} from './calendar-week-view.js';
import {dayItems,calendarDateKey} from './calendar-day-items.js';
import {dayKey,ranges} from './home-read-model.js';
import {viewPrefs} from './view-prefs.js';
// Owns view choice, list/week ranges and list pagination. The choice is remembered on the server (view-prefs.js, profile view_prefs).
const desktop=matchMedia('(min-width:1024px)');
const today=()=>seoulDayStart(new Date());
const defaultView=()=>desktop.matches?'week':'list';
let preference=null;
{const saved=viewPrefs.get('calendar_view');if(saved==='list'||saved==='week'||saved==='month')preference=saved}
const effectiveView=()=>!desktop.matches&&preference==='week'?'list':preference||defaultView();
let view=effectiveView();
const thisWeek=()=>new Date(ranges().weekStart);
let start=today(),weekStart=thisWeek(),days=14,pendingDays=0,tasks=[],options=null,busy=false,error=false,revision=0;
function range(appendPage=false){if(view==='month')return null;const first=view==='week'?weekStart:start,end=new Date(first);end.setTime(addSeoulDays(end,view==='week'?7:pendingDays||days).getTime());const s=new Date(first),append=view==='list'&&appendPage&&pendingDays>days;if(append)s.setTime(addSeoulDays(s,days).getTime());return {s:new Date(calendarDateKey(s)+'T00:00:00+09:00'),e:new Date(calendarDateKey(end)+'T00:00:00+09:00'),append}}
function render(next){
  options=next;
  const grid=document.querySelector('#calendarGrid'),list=document.querySelector('#calendarList'),week=document.querySelector('#calendarWeek');if(!grid||!list||!week)return;
  grid.classList.toggle('hidden',view!=='month');list.classList.toggle('hidden',view!=='list');week.classList.toggle('hidden',view!=='week');grid.closest('#calendarView')?.classList.toggle('calendar-list-active',view!=='month');
  if(view!=='list')stopList();
  document.querySelectorAll('[data-calendar-view]').forEach(b=>{b.hidden=b.dataset.calendarView==='week'&&!desktop.matches;b.setAttribute('aria-pressed',String(b.dataset.calendarView===view))});
  document.querySelector('#prevMonthBtn')?.setAttribute('aria-label',view==='list'?'이전 14일':view==='week'?'이전 주':'이전 달');document.querySelector('#nextMonthBtn')?.setAttribute('aria-label',view==='list'?'다음 14일':view==='week'?'다음 주':'다음 달');
  const first=view==='month'?seoulDate(next.year,next.month):view==='week'?weekStart:start,end=new Date(first);
  if(view!=='month')end.setTime(addSeoulDays(end,(view==='week'?7:days)-1).getTime());
  const sameMonth=seoulParts(first).year===seoulParts(end).year&&seoulParts(first).month===seoulParts(end).month;
  const full=view==='month'?`${seoulParts(first).year}년 ${seoulParts(first).month+1}월`:`${seoulParts(first).month+1}월 ${seoulParts(first).day}일 – ${sameMonth?'':`${seoulParts(end).month+1}월 `}${seoulParts(end).day}일`;
  const label=view==='month'?full:`${seoulParts(first).year}년 ${seoulParts(first).month+1}월 ${seoulParts(first).day}일 – ${sameMonth?'':`${seoulParts(end).year}년 ${seoulParts(end).month+1}월 `}${seoulParts(end).day}일`;
  const title=document.querySelector('#monthTitle'),year=seoulParts(first).year===seoulParts(today()).year?'':`<span class="calendar-title-year">${seoulParts(first).year}</span>`;
  title.setAttribute('aria-label',label);
  title.innerHTML=`<span class="calendar-title-full" aria-hidden="true">${full}</span><span class="calendar-title-compact" aria-hidden="true">${year}<span class="calendar-title-month">${seoulParts(first).month+1}월</span></span>`;
  if(view==='month')return window.KPTUCalendarMonthView?.render(next);
  if(view==='week')return renderWeek(next,{start:weekStart,tasks});
  renderList(next,{start,days,tasks,busy,error,more});
}
const paint=()=>window.__KPTU_RENDER_CALENDAR__?.();
function reset(){revision++;pendingDays=0;days=14;busy=false;error=false}
function select(next){if(next==='week'&&!desktop.matches)return;preference=next;viewPrefs.set('calendar_view',next);if(next===view)return;view=next;reset();paint();window.KPTUCalendarPersistence?.refresh()}
function move(delta){if(view==='month')return false;reset();const cursor=view==='week'?weekStart:start;cursor.setTime(addSeoulDays(cursor,delta*(view==='week'?7:14)).getTime());paint();window.KPTUCalendarPersistence?.refresh();return true}
function begin(){busy=true;error=false;paint();return revision}
function finish(at,ok){if(at!==revision||view==='month')return;busy=false;error=!ok;if(ok&&pendingDays){days=pendingDays;pendingDays=0}paint()}
async function more(){if(view!=='list'||busy)return;pendingDays=pendingDays||(error?days:days+14);busy=true;error=false;paint();await window.KPTUCalendarPersistence?.refresh({appendPage:true})}
window.KPTUCalendarView={render,range,move,begin,finish,cancel:()=>{revision++;pendingDays=0;busy=false;error=false;paint()},current:()=>view,setTasks:list=>{tasks=list;if(view!=='month')paint()},dayItems:date=>options?dayItems(options,date,tasks):[]};
document.querySelectorAll('[data-calendar-view]').forEach(b=>b.addEventListener('click',()=>select(b.dataset.calendarView)));
document.querySelector('#calendarTodayBtn')?.addEventListener('click',()=>{if(view!=='month'){if(view==='week'){weekStart=thisWeek();resetWeekScroll()}else start=today();reset();paint();window.KPTUCalendarPersistence?.refresh()}else window.__KPTU_CALENDAR_TODAY__?.()});

function resizeView(){const next=effectiveView();if(next!==view){view=next;reset();paint();window.KPTUCalendarPersistence?.refresh()}else paint()}
if(desktop.addEventListener)desktop.addEventListener('change',resizeView);else desktop.addListener(resizeView);
