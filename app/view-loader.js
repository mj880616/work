(()=>{
'use strict';
if(window.KPTUViewLoader)return;
const flights=new Map(),loaded=new Set(),styleFlights=new Map();
const defer=window.requestIdleCallback||((fn)=>setTimeout(fn,200));
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
  calendar:['./calendar-ui.css?v=8'],
  tasks:['./task-layout.css?v=4','./google-tasks.css?v=4'],
  projects:['./project-system-v3.css?v=15','./forum-flow-polish.css?v=1'],
  library:['./library-upload.css?v=2','./compact-list.css?v=2'],
  meetings:['./meeting-ui.css?v=10'],
  media:['./web1-press.css?v=1'],
  pages:['./web1-board.css?v=2'],
  team:['./suborganizations.css?v=5','./workplace-detail.css?v=4'],
  photos:['./photo-room.css?v=2']
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
async function calendar(){
  await module('./calendar-month-view.js?v=6','__KPTU_CALENDAR_MONTH_VIEW_READY__');
  await team('calendar');
  await module('./calendar-plus.js?v=9','__KPTU_CALENDAR_PLUS_READY__');
  await Promise.all([
    module('./calendar-interactions-v2.js?v=8','__KPTU_CALENDAR_INTERACTIONS_READY__'),
    module('./calendar-mobile-ui.js?v=5','__KPTU_CALENDAR_MOBILE_UI_READY__'),
    module('./calendar-day-overflow.js?v=3','__KPTU_CALENDAR_DAY_OVERFLOW_READY__')
  ]);
  window.__KPTU_RENDER_CALENDAR__?.();
  const google=module('./calendar-persistence.js?v=13','__KPTU_CALENDAR_PERSISTENCE_READY__');
  background(google);
  background(style('./suborganizations.css?v=5').then(()=>module('./suborganizations.js?v=8','__KPTU_SUBORGANIZATIONS_READY__')));
  background(module('./google-calendar-return-status.js?v=1'));
  background(google.then(()=>module('./calendar-health.js?v=4')));
  defer(()=>load('photos').catch(()=>{}),{timeout:1200});
  return {ok:true}
}
async function tasks(){
  await module('./task-row-view.js?v=1');
  await module('./task-layout.js?v=13','__KPTU_TASK_LAYOUT_READY__');
  await module('./google-tasks.js?v=7');
  return {ok:true}
}
async function projects(){
  await Promise.all([
    module('./forum-flow-polish.js?v=2'),
    module('./due-date-calendar.js?v=1')
  ]);
  await module('./project-catalog.js?v=1');
  await module('./project-system-v3.js?v=25','__KPTU_PROJECT_V3_READY__');
  return {ok:true}
}
async function library(){
  await team('library');
  await module('./project-catalog.js?v=1');
  await module('./library-upload.js?v=15','__KPTU_LIBRARY_UPLOAD_READY__');
  return {ok:true}
}
async function meetings(){
  await team('meetings');
  await module('./task-workflow.js?v=9','__KPTU_TASK_WORKFLOW_READY__');
  await module('./meeting-round-detail.js?v=14','__KPTU_MEETING_ROUND_DETAIL_READY__');
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
  await module('./suborganizations.js?v=8','__KPTU_SUBORGANIZATIONS_READY__');
  await module('./workplace-detail.js?v=8');
  import('./workplace-ai-report.js?v=3').catch(console.error);
  return {ok:true}
}
async function photos(){
  await team('calendar');
  await module('./photo-room.js?v=6','__KPTU_PHOTO_ROOM_READY__');
  return {ok:true}
}
const loaders={calendar,tasks,projects,library,meetings,media,pages,team:organizations,photos};
function normalize(view){
  if(view==='home'||view==='profile'||view==='messages'||view==='myspace')return 'calendar';
  return loaders[view]?view:'calendar'
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
  for(const view of ['calendar','tasks','projects','library','meetings','media','pages','team'])await load(view);
  return true
}
window.KPTUViewLoader={load,loadAll,prepare,normalize,isLoaded:view=>loaded.has(normalize(view))};
})();
