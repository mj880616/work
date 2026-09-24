(()=>{
'use strict';
if(window.KPTUViewLoader)return;
const flights=new Map(),loaded=new Set(),styleFlights=new Map();

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
async function styles(paths){await Promise.all(paths.map(style));}

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
async function home(){
  await module('./home-dashboard-v2.js?v=8');
  const ready=window.__KPTU_HOME_READY__;
  return ready&&typeof ready.then==='function'?await ready:{ok:true}
}
async function calendar(){
  await styles(['./calendar-ui.css?v=5','./suborganizations.css?v=5']);
  await module('./calendar-month-view.js?v=2','__KPTU_CALENDAR_MONTH_VIEW_READY__');
  await team('calendar');
  await Promise.all([
    module('./calendar-plus.js?v=8','__KPTU_CALENDAR_PLUS_READY__'),
    module('./calendar-persistence.js?v=13','__KPTU_CALENDAR_PERSISTENCE_READY__'),
    module('./calendar-interactions-v2.js?v=6','__KPTU_CALENDAR_INTERACTIONS_READY__'),
    module('./calendar-mobile-ui.js?v=4','__KPTU_CALENDAR_MOBILE_UI_READY__'),
    module('./calendar-day-overflow.js?v=3','__KPTU_CALENDAR_DAY_OVERFLOW_READY__'),
    module('./suborganizations.js?v=7','__KPTU_SUBORGANIZATIONS_READY__'),
    module('./calendar-health.js?v=4'),
    module('./google-calendar-return-status.js?v=1')
  ]);
  window.__KPTU_RENDER_CALENDAR__?.();
  return {ok:true}
}
async function tasks(){
  await styles(['./task-layout.css?v=4','./google-tasks.css?v=4']);
  await module('./task-row-view.js?v=1');
  await module('./task-layout.js?v=13','__KPTU_TASK_LAYOUT_READY__');
  await module('./google-tasks.js?v=7');
  return {ok:true}
}
async function projects(){
  await styles(['./project-system-v3.css?v=13','./forum-flow-polish.css?v=1']);
  await Promise.all([
    module('./forum-flow-polish.js?v=2'),
    module('./public-page-links.js?v=1'),
    module('./due-date-calendar.js?v=1')
  ]);
  await module('./project-system-v3.js?v=20','__KPTU_PROJECT_V3_READY__');
  return {ok:true}
}
async function library(){
  await styles(['./library-upload.css?v=1']);
  await team('library');
  await module('./library-upload.js?v=12','__KPTU_LIBRARY_UPLOAD_READY__');
  return {ok:true}
}
async function meetings(){
  await styles(['./meeting-ui.css?v=8']);
  await team('meetings');
  await module('./task-workflow.js?v=9','__KPTU_TASK_WORKFLOW_READY__');
  await module('./meeting-round-detail.js?v=12','__KPTU_MEETING_ROUND_DETAIL_READY__');
  return {ok:true}
}
async function media(){
  await styles(['./web1-press.css?v=1']);
  await module('./web1-press.js?v=2','__KPTU_WEB1_PRESS_READY__');
  return {ok:true}
}
async function pages(){
  await styles(['./page-editor-static.css?v=2','./page-core.css?v=7','./page-builder.css?v=2','./web1-board.css?v=2']);
  await team('pages');
  await Promise.all([
    module('./page-design-core.js?v=4'),
    module('./web1-board.js?v=3')
  ]);
  return {ok:true}
}
async function organizations(){
  await styles(['./suborganizations.css?v=5','./workplace-detail.css?v=3']);
  await module('./suborganizations.js?v=7','__KPTU_SUBORGANIZATIONS_READY__');
  await module('./workplace-detail.js?v=6');
  import('./workplace-ai-report.js?v=2').catch(console.error);
  return {ok:true}
}
async function photos(){
  await styles(['./photo-room.css?v=2']);
  await team('calendar');
  await module('./photo-room.js?v=6','__KPTU_PHOTO_ROOM_READY__');
  return {ok:true}
}
async function notifications(){
  await styles(['./notification-center-ui.css?v=2']);
  await module('./notification-center-ui.js?v=7','__KPTU_NOTIFICATION_CENTER_READY__');
  return {ok:true}
}

const loaders={home,calendar,tasks,projects,library,meetings,media,pages,team:organizations,photos,notifications};
function normalize(view){
  if(view==='profile'||view==='messages'||view==='myspace')return 'home';
  return loaders[view]?view:'home'
}
function load(view){
  const key=normalize(view);
  if(loaded.has(key))return Promise.resolve({ok:true,view:key,cached:true});
  if(flights.has(key))return flights.get(key);
  const flight=Promise.resolve().then(()=>loaders[key]()).then(result=>{
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
window.KPTUViewLoader={load,loadAll,normalize,isLoaded:view=>loaded.has(normalize(view))};
})();