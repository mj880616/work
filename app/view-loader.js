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
  basket:['./basket.css','./markdown-view.css','./ed-doc.css','./library-upload.css','./basket-picker.css','./choice-sheet.css','./ui-standard.css'],
  home:['./library-upload.css','./basket-picker.css','./choice-sheet.css','./home-read.css','./google-tasks.css','./todo-radar.css','./ui-standard.css'],
  calendar:['./choice-sheet.css','./calendar-ui.css','./view-wide.css','./ui-standard.css'],
  tasks:['./task-layout.css','./google-tasks.css','./library-upload.css','./basket-picker.css','./ui-standard.css'],
  journal:['./journal.css','./todo-radar.css','./view-wide.css','./ui-standard.css'],
  diary:['./diary.css','./ed-doc.css','./view-wide.css','./ui-standard.css'],
  projects:['./project-system-v3.css','./record-sheet.css','./markdown-view.css','./forum-flow-polish.css','./google-tasks.css','./ui-standard.css'],
  library:['./filter-chips.css','./library-upload.css','./compact-list.css','./markdown-view.css','./ui-standard.css'],
  meetings:['./filter-chips.css','./choice-sheet.css','./meeting-ui.css','./google-tasks.css','./ui-standard.css'],
  media:['./web1-press.css','./ui-standard.css'],
  pages:['./web1-board.css','./sr-blocks.css','./ed-doc.css','./share-pages.css','./ui-standard.css'],
  team:['./suborganizations.css','./workplace-detail.css','./markdown-view.css','./ed-doc.css','./record-sheet.css','./google-tasks.css','./ui-standard.css'],
  hwp:['./hwp-lab.css','./ui-standard.css'],
  profile:['./profile-settings.css','./ui-standard.css'],
  ledger:['./ledger-import.css','./ui-standard.css'],
  search:['./filter-chips.css','./global-search.css','./ui-standard.css'],
  reference:['./reference-bundles.css','./ui-standard.css'],
  calls:['./choice-sheet.css','./feed.css','./ui-standard.css'],
  telegram:['./choice-sheet.css','./feed.css','./ui-standard.css']
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
  await module('./project-catalog.js');
}
// Shared organization order (TASK-조직순서) for the organization list, checks and the Google task editor.
async function organizationOrder(){
  await module('./organization-order.js');
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
  await module('./calendar-month-view.js','__KPTU_CALENDAR_MONTH_VIEW_READY__');
  await module('./calendar-view.js');
  await projectCatalog();
  await team('calendar');
  await module('./calendar-plus.js','__KPTU_CALENDAR_PLUS_READY__');
  await Promise.all([
    module('./calendar-interactions-v2.js','__KPTU_CALENDAR_INTERACTIONS_READY__'),
    module('./calendar-mobile-ui.js','__KPTU_CALENDAR_MOBILE_UI_READY__'),
    module('./calendar-day-overflow.js','__KPTU_CALENDAR_DAY_OVERFLOW_READY__')
  ]);
  // CAL-끌어옮기기: PC 마우스 끌기. 저장은 위 calendar-interactions-v2.js의 수정 경로를 쓴다.
  background(module('./calendar-drag.js','__KPTU_CALENDAR_DRAG_READY__'));
  window.__KPTU_RENDER_CALENDAR__?.();
  const google=module('./calendar-persistence.js','__KPTU_CALENDAR_PERSISTENCE_READY__');
  background(google);
  background(style('./suborganizations.css').then(organizationOrder).then(()=>module('./suborganizations.js','__KPTU_SUBORGANIZATIONS_READY__')));
  background(module('./google-calendar-return-status.js'));
  // Google tasks by due date (CAL-할일) come after the first screen is shown and painted, so they never hold it: the task
  // editor's style and modules, then the calendar's task list. The task view and project/organization details load the same
  // google-tasks.js.
  background(afterReveal().then(()=>Promise.all([style('./google-tasks.css'),organizationOrder()])).then(()=>module('./google-tasks.js')).then(()=>module('./calendar-tasks.js')));
  background(google.then(()=>module('./calendar-health.js')));
  return {ok:true}
}
async function tasks(){
  await module('./project-catalog.js');
  await organizationOrder();
  await module('./google-tasks.js');
  return {ok:true}
}
async function projects(){
  await Promise.all([
    module('./forum-flow-polish.js'),
    module('./due-date-calendar.js')
  ]);
  await module('./project-catalog.js');
  // The project detail shows linked Google tasks and opens the Google task editor (TASK-구현 PR 4).
  await organizationOrder();
  await module('./google-tasks.js');
  await module('./project-system-v3.js','__KPTU_PROJECT_V3_READY__');
  return {ok:true}
}
async function library(){
  await team('library');
  await module('./project-catalog.js');
  await module('./library-upload.js','__KPTU_LIBRARY_UPLOAD_READY__');
  return {ok:true}
}
async function meetings(){
  await projectCatalog();
  await team('meetings');
  await module('./task-workflow.js','__KPTU_TASK_WORKFLOW_READY__');
  await module('./google-tasks.js');
  await module('./meeting-round-detail.js','__KPTU_MEETING_ROUND_DETAIL_READY__');
  // MEET-파일로만들기: 회의 [+] 창의 [직접 쓰기 | 파일·글로 만들기].
  await module('./meeting-from-files.js');
  return {ok:true}
}
async function media(){
  await module('./web1-press.js','__KPTU_WEB1_PRESS_READY__');
  return {ok:true}
}
async function pages(){
  // SHARE-현장공유 PR 2: my share pages (editor) on top, the old Web1 cards folded under "이전 페이지" below.
  await projectCatalog();
  await module('./share-pages.js');
  await module('./web1-board.js');
  return {ok:true}
}
async function organizations(){
  await organizationOrder();
  await module('./suborganizations.js','__KPTU_SUBORGANIZATIONS_READY__');
  // The organization detail shows linked Google tasks and opens the Google task editor (TASK-조직상세).
  await module('./project-catalog.js');
  await module('./google-tasks.js');
  await module('./workplace-detail.js');
  import('./workplace-report.js').catch(console.error);
  return {ok:true}
}
async function home(){
  const date=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'long'}).format(new Date());
  document.querySelectorAll('[data-home-date]').forEach(el=>{el.textContent=date});
  await module('./home-read.js');
  return {ok:true}
}
window.addEventListener('kptu:view-changed',event=>{if(event.detail?.view==='home')void home()});
window.addEventListener('pageshow',()=>{if(window.KPTURouter?.current==='home')void home()});
async function basket(){ await module('./basket.js'); return {ok:true} }
// HWP-편집기(☰ 메뉴·사이드바 [HWP 편집], ?view=hwp): loadAll에 넣지 않아 이 화면을 열 때만 편집기(약 20MB)를 내려받는다.
// JOURNAL-일지 2단계: [일지] is journal.js (week row, "오늘 한 줄", the day's materials); [일기] is diary.js (month photo calendar).
async function journal(){ await module('./journal.js'); return {ok:true} }
async function diary(){ await module('./diary.js'); return {ok:true} }
async function hwpLab(){ await module('./hwp-lab.js','__KPTU_HWP_LAB_READY__'); return {ok:true} }
// UI-프로필입구: [계정 ▾] → [내 프로필]. Like hwp, it stays out of loadAll; the module installs #profileView and loads its data on first open.
async function profile(){ await organizationOrder(); await module('./profile-settings.js','__KPTU_PROFILE_SETTINGS_READY__'); return {ok:true} }
// AI-서버연동 S7-b → LEDGER-화면정리: [원장](사이드바·메뉴 판 [원장], ?view=ledger). loadAll에 넣지 않고 열 때만 목록(화면 틀)·고치기 칸·사본 상태 줄을 불러온다.
// 칸마다 모듈 하나(사본 상태 줄 ledger-export.js, 고치기·기록하기 ledger-fix.js, 목록·검색 ledger-browse.js). 표·함수가 없으면 각 칸이 조용히 숨는다.
async function ledger(){ await module('./ledger-browse.js','__KPTU_LEDGER_BROWSE_READY__'); await Promise.all([module('./ledger-fix.js','__KPTU_LEDGER_FIX_READY__'),module('./ledger-export.js','__KPTU_LEDGER_EXPORT_READY__')]); void window.KPTULedgerExport?.open?.(); return {ok:true} }
// SEARCH-전체검색: 상단 줄 검색칸·결과 창·검색 결과 화면(?view=search)·폰 메뉴 검색 입구. loader-v2가 첫 화면 뒤에 한 번 불러온다.
async function search(){ await module('./global-search.js','__KPTU_GLOBAL_SEARCH_READY__'); return {ok:true} }
// REF-참고묶음 화면 2: 참고 묶음(?view=reference, 입구는 담당조직 목록 맨 아래·바구니 "참고" 칩). loadAll에 넣지 않고 처음 열 때만 불러온다.
async function reference(){ await module('./reference-bundles.js'); return {ok:true} }
// CALL-통화메뉴·TG-소식메뉴: [통화](?view=calls)·[텔레그램 소식](?view=telegram), 사이드바 맨 아래·폰 메뉴 판. loadAll에 넣지 않고 열 때만 불러온다.
async function calls(){ await organizationOrder(); await module('./call-feed.js'); return {ok:true} }
async function telegram(){ await organizationOrder(); await module('./telegram-feed.js'); return {ok:true} }
const loaders={home,basket,calendar,tasks,journal,diary,projects,library,meetings,media,pages,team:organizations,hwp:hwpLab,profile,ledger,search,reference,calls,telegram};
// Retired addresses that open another view (옛 시험판 ?view=hwp-lab → hwp, 새 주소 ?view=reports → meetings 화면). The router uses the same map.
const VIEW_ALIAS={'hwp-lab':'hwp',reports:'meetings'};
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
