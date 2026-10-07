import {renderList,dayItems,calendarDateKey} from './calendar-list-view.js?v=1';
import {dayKey} from './home-read-model.js?v=1';
// Owns view choice, range and list pagination. Storage is local to this device/browser.
const STORAGE_KEY='kptu-calendar-view';
const mobile=()=>matchMedia('(max-width:760px)').matches;
const today=()=>{const [y,m,d]=dayKey().split('-').map(Number);return new Date(y,m-1,d)};
const defaultView=()=>mobile()?'list':'month';
let view=defaultView();
try{const saved=localStorage.getItem(STORAGE_KEY);if(saved==='list'||saved==='month')view=saved}catch{}
let start=today(),days=14,pendingDays=0,tasks=[],options=null,busy=false,error=false,revision=0;
function range(appendPage=false){if(view!=='list')return null;const end=new Date(start);end.setDate(end.getDate()+(pendingDays||days));const s=new Date(start),append=appendPage&&pendingDays>days;if(append)s.setDate(s.getDate()+days);return {s:new Date(calendarDateKey(s)+'T00:00:00+09:00'),e:new Date(calendarDateKey(end)+'T00:00:00+09:00'),append}}
function render(next){
  options=next;
  const grid=document.querySelector('#calendarGrid'),list=document.querySelector('#calendarList');if(!grid||!list)return;
  grid.classList.toggle('hidden',view!=='month');list.classList.toggle('hidden',view!=='list');
  document.querySelectorAll('[data-calendar-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.calendarView===view)));
  document.querySelector('#prevMonthBtn')?.setAttribute('aria-label',view==='list'?'이전 14일':'이전 달');document.querySelector('#nextMonthBtn')?.setAttribute('aria-label',view==='list'?'다음 14일':'다음 달');
  if(view==='month')return window.KPTUCalendarMonthView?.render(next);
  const end=new Date(start);end.setDate(end.getDate()+days-1);
  document.querySelector('#monthTitle').textContent=`${start.getMonth()+1}월 ${start.getDate()}일 – ${end.getMonth()+1}월 ${end.getDate()}일`;
  renderList(next,{start,days,tasks,busy,error,more});
}
const paint=()=>window.__KPTU_RENDER_CALENDAR__?.();
function reset(){revision++;pendingDays=0;days=14;busy=false;error=false}
function select(next){if(next===view)return;view=next;reset();try{localStorage.setItem(STORAGE_KEY,view)}catch{}paint();window.KPTUCalendarPersistence?.refresh()}
function move(delta){if(view!=='list')return false;reset();start.setDate(start.getDate()+delta*14);paint();window.KPTUCalendarPersistence?.refresh();return true}
function begin(){busy=true;error=false;paint();return revision}
function finish(at,ok){if(at!==revision||view!=='list')return;busy=false;error=!ok;if(ok&&pendingDays){days=pendingDays;pendingDays=0}paint()}
async function more(){if(view!=='list'||busy)return;pendingDays=pendingDays||(error?days:days+14);busy=true;error=false;paint();await window.KPTUCalendarPersistence?.refresh({appendPage:true})}
window.KPTUCalendarView={render,range,move,begin,finish,cancel:()=>{revision++;pendingDays=0;busy=false;error=false;paint()},current:()=>view,setTasks:list=>{tasks=list;if(view==='list')paint()},dayItems:date=>options?dayItems(options,date,tasks):[]};
document.querySelectorAll('[data-calendar-view]').forEach(b=>b.addEventListener('click',()=>select(b.dataset.calendarView)));
document.querySelector('#calendarTodayBtn')?.addEventListener('click',()=>{if(view==='list'){start=today();reset();paint();window.KPTUCalendarPersistence?.refresh()}else window.__KPTU_CALENDAR_TODAY__?.()});
