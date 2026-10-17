(()=>{
'use strict';
if(window.KPTUViewLoader)return;
const flights=new Map(),loaded=new Set(),styleFlights=new Map();
const background=promise=>Promise.resolve(promise).catch(err=>console.warn('background feature load',err));

function style(path){
  const href=new URL(path,location.href).href;
  const existing=[...document.querySelectorAll('link[rel="stylesheet"]')].find(link=>link.href===href);
  if(existing)return Promise.resolve(true);
  if(styleFlights.has(href))return styleFlights.get(href);
  const flight=new Promise(resolve=>{
    const link=document.createElement('link');
    link.rel='stylesheet';link.href=path;link.dataset.kptuViewStyle='1';
    link.onload=()=>resolve(true);
    link.onerror=()=>resolve(false);
    document.head.appendChild(link);
  }).finally(()=>styleFlights.delete(href));
  styleFlights.set(href,flight);
  return flight
}
const routeStyles={
  basket:['./basket.css?v=19','./markdown-view.css?v=2','./md-editor.css?v=2','./library-upload.css?v=8','./basket-picker.css?v=2','./choice-sheet.css?v=1','./ui-standard.css?v=10'],
  home:['./library-upload.css?v=8','./basket-picker.css?v=2','./choice-sheet.css?v=1','./home-read.css?v=18','./google-tasks.css?v=26','./ui-standard.css?v=10'],
  calendar:['./choice-sheet.css?v=1','./calendar-ui.css?v=34','./ui-standard.css?v=10'],
  tasks:['./task-layout.css?v=4','./google-tasks.css?v=26','./ui-standard.css?v=10'],
  projects:['./project-system-v3.css?v=31','./forum-flow-polish.css?v=2','./google-tasks.css?v=26','./ui-standard.css?v=10'],
  library:['./filter-chips.css?v=2','./library-upload.css?v=8','./compact-list.css?v=2','./ui-standard.css?v=10'],
  meetings:['./filter-chips.css?v=2','./meeting-ui.css?v=15','./google-tasks.css?v=26','./ui-standard.css?v=10'],
  media:['./web1-press.css?v=4','./ui-standard.css?v=10'],
  pages:['./web1-board.css?v=7','./ui-standard.css?v=10'],
  team:['./suborganizations.css?v=11','./workplace-detail.css?v=10','./google-tasks.css?v=26','./ui-standard.css?v=10'],
  hwp:['./hwp-lab.css?v=3','./ui-standard.css?v=10']
};
async function prepare(view){
  const key=normalize(view);
  await Promise.all((routeStyles[key]||[]).map(style));
  return key
}

async function module(path,readyName){
  await import(path);
  const ready=readyName?window[readyName]:null;
  if(ready&&typeof ready.then==='function')await ready;
  return true
}
async function team(view){
  const fn=window.__KPTU_START_TEAM_VIEW__;
  if(typeof fn==='function')await fn(view);
}
async function projectCatalog(){
  await module('./project-catalog.js?v=3');
}
// Shared organization order (TASK-조직순서) for the organization list, checks and the Google task editor.
async function organizationOrder(){
  await module('./organization-order.js?v=2');
}
// Resolves once the app shell has been revealed (kptu-ui-ready) and one frame has been painted after it.
function afterReveal(){
  return new Promise(resolve=>{
    const next=()=>requestAnimationFrame(()=>setTimeout(resolve,0));
    if(document.querySelector('#appView')?.classList.contains('kptu-ui-ready'))return next();
    window.addEventListener('kptu:app-ui-ready',next,{once:true});
  });
}
async function calendar(){
  await module('./calendar-month-view.js?v=22','__KPTU_CALENDAR_MONTH_VIEW_READY__');
  await module('./calendar-view.js?v=8');
  await projectCatalog();
  await team('calendar');
  await module('./calendar-plus.js?v=14','__KPTU_CALENDAR_PLUS_READY__');
  await Promise.all([
    module('./calendar-interactions-v2.js?v=20','__KPTU_CALENDAR_INTERACTIONS_READY__'),
    module('./calendar-mobile-ui.js?v=8','__KPTU_CALENDAR_MOBILE_UI_READY__'),
    module('./calendar-day-overflow.js?v=11','__KPTU_CALENDAR_DAY_OVERFLOW_READY__')
  ]);
  window.__KPTU_RENDER_CALENDAR__?.();
  const google=module('./calendar-persistence.js?v=17','__KPTU_CALENDAR_PERSISTENCE_READY__');
  background(google);
  background(style('./suborganizations.css?v=11').then(organizationOrder).then(()=>module('./suborganizations.js?v=33','__KPTU_SUBORGANIZATIONS_READY__')));
  background(module('./google-calendar-return-status.js?v=1'));
  // Google tasks by due date (CAL-할일) come after the first screen is shown and painted, so they never hold it: the task
  // editor's style and modules, then the calendar's task list. The task view and project/organization details load the same
  // google-tasks.js.
  background(afterReveal().then(()=>Promise.all([style('./google-tasks.css?v=26'),organizationOrder()])).then(()=>module('./google-tasks.js?v=39')).then(()=>module('./calendar-tasks.js?v=3')));
  background(google.then(()=>module('./calendar-health.js?v=7')));
  return {ok:true}
}
async function tasks(){
  await module('./project-catalog.js?v=3');
  await organizationOrder();
  await module('./google-tasks.js?v=39');
  return {ok:true}
}
async function projects(){
  await Promise.all([
    module('./forum-flow-polish.js?v=2'),
    module('./due-date-calendar.js?v=2')
  ]);
  await module('./project-catalog.js?v=3');
  // The project detail shows linked Google tasks and opens the Google task editor (TASK-구현 PR 4).
  await organizationOrder();
  await module('./google-tasks.js?v=39');
  await module('./project-system-v3.js?v=63','__KPTU_PROJECT_V3_READY__');
  return {ok:true}
}
async function library(){
  await team('library');
  await module('./project-catalog.js?v=3');
  await module('./library-upload.js?v=33','__KPTU_LIBRARY_UPLOAD_READY__');
  return {ok:true}
}
async function meetings(){
  await projectCatalog();
  await team('meetings');
  await module('./task-workflow.js?v=9','__KPTU_TASK_WORKFLOW_READY__');
  await module('./google-tasks.js?v=39');
  await module('./meeting-round-detail.js?v=30','__KPTU_MEETING_ROUND_DETAIL_READY__');
  return {ok:true}
}
async function media(){
  await module('./web1-press.js?v=2','__KPTU_WEB1_PRESS_READY__');
  return {ok:true}
}
async function pages(){
  await module('./web1-board.js?v=5');
  return {ok:true}
}
async function organizations(){
  await organizationOrder();
  await module('./suborganizations.js?v=33','__KPTU_SUBORGANIZATIONS_READY__');
  // The organization detail shows linked Google tasks and opens the Google task editor (TASK-조직상세).
  await module('./project-catalog.js?v=3');
  await module('./google-tasks.js?v=39');
  await module('./workplace-detail.js?v=27');
  import('./workplace-report.js?v=5').catch(console.error);
  return {ok:true}
}
async function home(){
  const date=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'long'}).format(new Date());
  document.querySelectorAll('[data-home-date]').forEach(el=>{el.textContent=date});
  await module('./home-read.js?v=40');
  return {ok:true}
}
window.addEventListener('kptu:view-changed',event=>{if(event.detail?.view==='home')void home()});
window.addEventListener('pageshow',()=>{if(window.KPTURouter?.current==='home')void home()});
async function basket(){ await module('./basket.js?v=45'); return {ok:true} }
// HWP-편집기(☰ 메뉴·사이드바 [HWP 편집], ?view=hwp): loadAll에 넣지 않아 이 화면을 열 때만 편집기(약 20MB)를 내려받는다.
async function hwpLab(){ await module('./hwp-lab.js?v=5','__KPTU_HWP_LAB_READY__'); return {ok:true} }
const loaders={home,basket,calendar,tasks,projects,library,meetings,media,pages,team:organizations,hwp:hwpLab};
// Retired addresses that open another view (옛 시험판 ?view=hwp-lab → hwp). The router uses the same map.
const VIEW_ALIAS={'hwp-lab':'hwp'};
function normalize(view){
  view=VIEW_ALIAS[view]||view;
  return loaders[view]?view:'home'
}
function load(view){
  const key=normalize(view);
  if(loaded.has(key))return Promise.resolve({ok:true,view:key,cached:true});
  if(flights.has(key))return flights.get(key);
  const flight=Promise.resolve().then(()=>prepare(key)).then(()=>loaders[key]()).then(result=>{
    loaded.add(key);
    window.dispatchEvent(new CustomEvent('kptu:view-loader-ready',{detail:{view:key}}));
    return {...(result||{ok:true}),view:key}
  }).finally(()=>flights.delete(key));
  flights.set(key,flight);
  return flight
}
async function loadAll(){
  for(const view of ['home','basket','calendar','tasks','projects','library','meetings','media','pages','team'])await load(view);
  return true
}
window.KPTUViewLoader={load,loadAll,prepare,normalize,isLoaded:view=>loaded.has(normalize(view))};
})();
