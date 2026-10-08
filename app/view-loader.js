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
  home:['./choice-sheet.css?v=1','./home-read.css?v=7','./google-tasks.css?v=24'],
  calendar:['./choice-sheet.css?v=1','./calendar-ui.css?v=28'],
  tasks:['./task-layout.css?v=4','./google-tasks.css?v=24'],
  projects:['./project-system-v3.css?v=23','./forum-flow-polish.css?v=2','./google-tasks.css?v=24'],
  library:['./library-upload.css?v=4','./compact-list.css?v=2'],
  meetings:['./meeting-ui.css?v=12','./google-tasks.css?v=24'],
  media:['./web1-press.css?v=4'],
  pages:['./web1-board.css?v=5'],
  team:['./suborganizations.css?v=9','./workplace-detail.css?v=6','./google-tasks.css?v=24']
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
  await module('./project-catalog.js?v=2');
}
// Shared organization order (TASK-조직순서) for the organization list, checks and the Google task editor.
async function organizationOrder(){
  await module('./organization-order.js?v=1');
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
  await module('./calendar-month-view.js?v=17','__KPTU_CALENDAR_MONTH_VIEW_READY__');
  await module('./calendar-view.js?v=4');
  await projectCatalog();
  await team('calendar');
  await module('./calendar-plus.js?v=11','__KPTU_CALENDAR_PLUS_READY__');
  await Promise.all([
    module('./calendar-interactions-v2.js?v=17','__KPTU_CALENDAR_INTERACTIONS_READY__'),
    module('./calendar-mobile-ui.js?v=7','__KPTU_CALENDAR_MOBILE_UI_READY__'),
    module('./calendar-day-overflow.js?v=9','__KPTU_CALENDAR_DAY_OVERFLOW_READY__')
  ]);
  window.__KPTU_RENDER_CALENDAR__?.();
  const google=module('./calendar-persistence.js?v=15','__KPTU_CALENDAR_PERSISTENCE_READY__');
  background(google);
  background(style('./suborganizations.css?v=9').then(organizationOrder).then(()=>module('./suborganizations.js?v=13','__KPTU_SUBORGANIZATIONS_READY__')));
  background(module('./google-calendar-return-status.js?v=1'));
  // Google tasks by due date (CAL-할일) come after the first screen is shown and painted, so they never hold it: the task
  // editor's style and modules, then the calendar's task list. The task view and project/organization details load the same
  // google-tasks.js.
  background(afterReveal().then(()=>Promise.all([style('./google-tasks.css?v=24'),organizationOrder()])).then(()=>module('./google-tasks.js?v=30')).then(()=>module('./calendar-tasks.js?v=3')));
  background(google.then(()=>module('./calendar-health.js?v=6')));
  return {ok:true}
}
async function tasks(){
  await module('./project-catalog.js?v=2');
  await organizationOrder();
  await module('./google-tasks.js?v=30');
  return {ok:true}
}
async function projects(){
  await Promise.all([
    module('./forum-flow-polish.js?v=2'),
    module('./due-date-calendar.js?v=1')
  ]);
  await module('./project-catalog.js?v=2');
  // The project detail shows linked Google tasks and opens the Google task editor (TASK-구현 PR 4).
  await organizationOrder();
  await module('./google-tasks.js?v=30');
  await module('./project-system-v3.js?v=39','__KPTU_PROJECT_V3_READY__');
  return {ok:true}
}
async function library(){
  await team('library');
  await module('./project-catalog.js?v=2');
  await module('./library-upload.js?v=18','__KPTU_LIBRARY_UPLOAD_READY__');
  return {ok:true}
}
async function meetings(){
  await projectCatalog();
  await team('meetings');
  await module('./task-workflow.js?v=9','__KPTU_TASK_WORKFLOW_READY__');
  await module('./google-tasks.js?v=30');
  await module('./meeting-round-detail.js?v=20','__KPTU_MEETING_ROUND_DETAIL_READY__');
  return {ok:true}
}
async function media(){
  await module('./web1-press.js?v=2','__KPTU_WEB1_PRESS_READY__');
  return {ok:true}
}
async function pages(){
  await module('./web1-board.js?v=3');
  return {ok:true}
}
async function organizations(){
  await organizationOrder();
  await module('./suborganizations.js?v=13','__KPTU_SUBORGANIZATIONS_READY__');
  // The organization detail shows linked Google tasks and opens the Google task editor (TASK-조직상세).
  await module('./project-catalog.js?v=2');
  await module('./google-tasks.js?v=30');
  await module('./workplace-detail.js?v=14');
  import('./workplace-report.js?v=2').catch(console.error);
  return {ok:true}
}
async function home(){
  const date=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'long'}).format(new Date());
  document.querySelectorAll('[data-home-date]').forEach(el=>{el.textContent=date});
  // Preserve the existing narrow-screen action labels when home is the first route.
  await module('./calendar-mobile-ui.js?v=7','__KPTU_CALENDAR_MOBILE_UI_READY__');
  await module('./home-read.js?v=9');
  return {ok:true}
}
window.addEventListener('kptu:view-changed',event=>{if(event.detail?.view==='home')void home()});
window.addEventListener('pageshow',()=>{if(window.KPTURouter?.current==='home')void home()});
const loaders={home,calendar,tasks,projects,library,meetings,media,pages,team:organizations};
function normalize(view){
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
  for(const view of ['home','calendar','tasks','projects','library','meetings','media','pages','team'])await load(view);
  return true
}
window.KPTUViewLoader={load,loadAll,prepare,normalize,isLoaded:view=>loaded.has(normalize(view))};
})();
