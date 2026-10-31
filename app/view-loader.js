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
  basket:['./basket.css','./home-quick.css','./row-swipe.css','./folder-tree.css','./markdown-view.css','./ed-doc.css','./library-upload.css','./basket-picker.css','./choice-sheet.css','./todo-radar.css','./ui-standard.css'],
  home:['./journal.css','./home-quick.css','./library-upload.css','./row-swipe.css','./basket-picker.css','./choice-sheet.css','./google-tasks.css','./ui-standard.css'],
  calendar:['./choice-sheet.css','./calendar-ui.css','./ui-standard.css'],
  tasks:['./task-layout.css','./row-swipe.css','./google-tasks.css','./home-quick.css','./library-upload.css','./basket-picker.css','./ui-standard.css'],
  diary:['./diary.css','./od-link.css','./ed-doc.css','./ui-standard.css'],
  projects:['./project-system-v3.css','./record-sheet.css','./markdown-view.css','./google-tasks.css','./ui-standard.css'],
  library:['./filter-chips.css','./library-upload.css','./compact-list.css','./markdown-view.css','./ui-standard.css'],
  meetings:['./filter-chips.css','./choice-sheet.css','./meeting-ui.css','./markdown-view.css','./google-tasks.css','./todo-radar.css','./ui-standard.css'],
  pages:['./sr-blocks.css','./ed-doc.css','./share-pages.css','./ui-standard.css'],
  team:['./suborganizations.css','./workplace-detail.css','./markdown-view.css','./ed-doc.css','./record-sheet.css','./google-tasks.css','./ui-standard.css'],
  hwp:['./hwp-lab.css','./ui-standard.css'],
  profile:['./profile-settings.css','./home-quick.css','./ui-standard.css'],
  ledger:['./ledger-import.css','./ui-standard.css'],
  search:['./filter-chips.css','./global-search.css','./ui-standard.css'],
  reference:['./reference-bundles.css','./ui-standard.css'],
  calls:['./choice-sheet.css','./feed.css','./ui-standard.css'],
  telegram:['./choice-sheet.css','./feed.css','./ui-standard.css'],
  photos:['./diary.css','./od-link.css','./photos.css','./folder-tree.css','./ui-standard.css'],
  arsenal:['./arsenal.css','./ui-standard.css'],
  outside:['./outside-statements.css','./ui-standard.css'],
  updates:['./release-notes.css','./ui-standard.css']
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
  // UI-우클릭전수: 일정 위 우클릭 메뉴(수정 창의 기능을 그대로 부름).
  background(module('./calendar-context-menu.js'));
  // CAL-빈칸시간채우기: 주간 빈 곳을 끌어 시간 범위 고르기. 창 채우기는 위 calendar-interactions-v2.js.
  background(module('./calendar-range-select.js','__KPTU_CALENDAR_RANGE_READY__'));
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
  await module('./due-date-calendar.js');
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
  // MTG-녹음초안: [회의] 입력 창의 [녹음·전사 넣기](전사 글 → 회의 기록 초안).
  await module('./meeting-transcript-draft.js');
  return {ok:true}
}
async function pages(){
  // SHARE-현장공유 PR 2: my share pages (editor). DOMAIN-④ E2: the old Web1 cards below it are removed.
  await projectCatalog();
  await module('./share-pages.js');
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
// HOME-업무일지홈: 홈은 업무일지 화면이다(journal.js가 #homeView 안 #journalRoot의 유일한 renderer). 옛 홈 칸 화면은 코드째 삭제.
async function home(){ await module('./journal.js'); return {ok:true} }
async function basket(){ await module('./basket.js'); return {ok:true} }
// HWP-편집기(☰ 메뉴·사이드바 [HWP 편집], ?view=hwp): loadAll에 넣지 않아 이 화면을 열 때만 편집기(약 20MB)를 내려받는다.
async function diary(){ await module('./diary.js'); return {ok:true} }
async function hwpLab(){ await module('./hwp-lab.js','__KPTU_HWP_LAB_READY__'); return {ok:true} }
// UI-프로필입구: [계정 ▾] → [내 프로필]. Like hwp, it stays out of loadAll; the module installs #profileView and loads its data on first open.
async function profile(){ await organizationOrder(); await module('./profile-settings.js','__KPTU_PROFILE_SETTINGS_READY__'); return {ok:true} }
// AI-서버연동 S7-b → LEDGER-화면정리: [원장](사이드바·메뉴 판 [원장], ?view=ledger). loadAll에 넣지 않고 열 때만 목록(화면 틀)·고치기 칸·사본 상태 줄을 불러온다.
// 칸마다 모듈 하나(사본 상태 줄 ledger-export.js, 고치기·기록하기 ledger-fix.js, 겹친 기록 합치기 ledger-merge.js, 목록·검색 ledger-browse.js). 표·함수가 없으면 각 칸이 조용히 숨는다.
async function ledger(){ await module('./ledger-browse.js','__KPTU_LEDGER_BROWSE_READY__'); await Promise.all([module('./ledger-fix.js','__KPTU_LEDGER_FIX_READY__'),module('./ledger-merge.js','__KPTU_LEDGER_MERGE_READY__'),module('./ledger-export.js','__KPTU_LEDGER_EXPORT_READY__')]); void window.KPTULedgerExport?.open?.(); return {ok:true} }
// SEARCH-전체검색: 상단 줄 검색칸·결과 창·검색 결과 화면(?view=search)·폰 메뉴 검색 입구. loader-v2가 첫 화면 뒤에 한 번 불러온다.
async function search(){ await module('./global-search.js','__KPTU_GLOBAL_SEARCH_READY__'); return {ok:true} }
// REF-참고묶음 화면 2: 참고 묶음(?view=reference, 입구는 담당조직 목록 맨 아래·바구니 "참고" 칩). loadAll에 넣지 않고 처음 열 때만 불러온다.
async function reference(){ await module('./reference-bundles.js'); return {ok:true} }
// CALL-통화메뉴·TG-소식메뉴: [통화](?view=calls)·[텔레그램 소식](?view=telegram), 사이드바 맨 아래·폰 메뉴 판. loadAll에 넣지 않고 열 때만 불러온다.
async function calls(){ await organizationOrder(); await module('./call-feed.js'); return {ok:true} }
async function telegram(){ await organizationOrder(); await module('./telegram-feed.js'); return {ok:true} }
// PHOTO-사진메뉴: [사진](?view=photos, 폰 메뉴 판·사이드바). loadAll에 넣지 않고 열 때만 불러온다(모듈이 #photosView를 만든다).
async function photos(){ await module('./photos.js'); return {ok:true} }
// 주소 개편 ② E1: [아스날](?view=arsenal, 메뉴 창 맨 아래·사이드바 맨 아래). loadAll에 넣지 않고 열 때만 불러온다(모듈이 #arsenalView를 만들고 경기 자료도 그때 불러온다).
async function arsenal(){ await module('./arsenal.js'); return {ok:true} }
// OUTSIDE-바깥성명 ④: [바깥 성명](?view=outside, 위 메뉴 사진 다음). loadAll에 넣지 않고 열 때만 불러온다(모듈이 #outsideView를 만든다).
async function outside(){ await module('./outside-statements.js'); return {ok:true} }
// UI-업데이트기록입구: [업데이트 기록](?view=updates, 계정 메뉴 [내 프로필] 아래). loadAll에 넣지 않고 열 때만 불러온다(모듈이 #updatesView를 만든다).
async function updates(){ await module('./release-notes-ui.js'); return {ok:true} }
const loaders={home,basket,calendar,tasks,diary,projects,library,meetings,pages,team:organizations,hwp:hwpLab,profile,ledger,search,reference,photos,calls,telegram,arsenal,outside,updates};
// Retired addresses that open another view (옛 시험판 ?view=hwp-lab → hwp, 새 주소 ?view=reports → meetings 화면, 옛 ?view=media(성명·보도자료) → 자료실). The router uses the same map.
const VIEW_ALIAS={'hwp-lab':'hwp',reports:'meetings',media:'library',journal:'home'};
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
  for(const view of ['home','basket','calendar','tasks','projects','library','meetings','pages','team'])await load(view);
  return true
}
// UI-기다림표시통일 ⑤: 메뉴 화면 프로그램 미리 받기. 앱을 켠 뒤 쉬는 틈에(loader-v2.js) 메뉴 화면의 첫 프로그램과 모양 파일을 받아만 둔다
// (modulepreload·prefetch: 실행·적용하지 않음 → 화면·자료에 영향 없음). 처음 눌러도 '불러오는 중'이 거의 안 보이게 한다. 기기 저장 없이 브라우저 기본 캐시만.
// HWP 편집기(약 20MB)·아스날은 받지 않는다. 주소는 위 화면별 불러오기와 같은 글자(Pages 빌드가 같은 해시 번호를 붙인다).
const warmModules={
  basket:['./basket.js'],
  calendar:['./calendar-month-view.js','./calendar-view.js','./calendar-plus.js'],
  tasks:['./project-catalog.js','./organization-order.js','./google-tasks.js'],
  home:['./journal.js'],
  diary:['./diary.js'],
  projects:['./project-system-v3.js'],
  library:['./library-upload.js'],
  meetings:['./task-workflow.js','./meeting-round-detail.js'],
  pages:['./share-pages.js'],
  team:['./suborganizations.js','./workplace-detail.js'],
  ledger:['./ledger-browse.js'],
  reference:['./reference-bundles.js'],
  calls:['./call-feed.js'],
  telegram:['./telegram-feed.js'],
  photos:['./photos.js'],
  outside:['./outside-statements.js']
};
const warmed=new Set();
function hint(rel,path,as){
  const href=new URL(path,location.href).href;
  if(warmed.has(href))return;
  warmed.add(href);
  const link=document.createElement('link');
  link.rel=rel;link.href=path;if(as)link.as=as;link.dataset.kptuWarm='1';
  document.head.appendChild(link);
}
function warm(){
  if(navigator.connection?.saveData)return false;
  const have=new Set([...document.querySelectorAll('link[rel="stylesheet"]')].map(link=>link.href));
  for(const [view,paths] of Object.entries(warmModules)){
    if(loaded.has(view))continue;
    for(const path of paths)hint('modulepreload',path);
    for(const path of routeStyles[view]||[])if(!have.has(new URL(path,location.href).href))hint('prefetch',path,'style');
  }
  return true
}
window.KPTUViewLoader={load,loadAll,prepare,normalize,warm,isLoaded:view=>loaded.has(normalize(view))};
})();
