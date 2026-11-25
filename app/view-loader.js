(()=>{
'use strict';
if(window.KPTUViewLoader)return;
const flights=new Map(),loaded=new Set(),styleFlights=new Map();
const background=promise=>Promise.resolve(promise).catch(err=>console.warn('background feature load',err));

// 모양 파일 불러오기는 여기 하나다. 화면 목록(아래 routeStyles)과 공용 부품 표(part-styles.js PART_STYLES, S67-41)가 같이 쓴다.
// 이미 붙은 파일은 주소 뒤 번호(?v=)와 상관없이 같은 파일로 본다. 부르는 중인 파일은 다 붙을 때까지 같은 약속을 준다
// (부르는 중인 link도 문서에는 이미 있으므로 그보다 먼저 본다).
function style(path){
  const url=new URL(path,location.href),href=url.href;
  if(styleFlights.has(href))return styleFlights.get(href);
  const existing=[...document.querySelectorAll('link[rel="stylesheet"]')].find(link=>{const u=new URL(link.href,location.href);return u.origin===url.origin&&u.pathname===url.pathname});
  if(existing)return Promise.resolve(true);
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
// S67-41: 화면 목록에는 그 화면 첫 프로그램 사슬에 든 공용 부품의 모양 파일도 적는다(ui-standard.css 바로 앞) — 부품이 스스로 붙이기도 하지만
// (part-styles.js) 여기 적으면 화면 프로그램과 함께 미리 받아 첫 화면이 모양 받기를 따로 기다리지 않는다. 빠지면 tests/part-styles.test.mjs가 잡는다.
// 예외: 일정의 할 일 창 모양(google-tasks.css)은 전처럼 ui-standard.css 뒤에 붙어야 PC 할 일 칸 빠른 기한 단추가 작은 크기로 이긴다(시험의 LATE 표).
const routeStyles={
  basket:['./basket.css','./month-cal.css','./news-mark-rows.css','./home-quick.css','./row-swipe.css','./folder-tree.css','./markdown-view.css','./ed-doc.css','./library-upload.css','./basket-picker.css','./choice-sheet.css','./todo-radar.css','./folder-look.css','./area-org-picker.css','./filter-chips.css','./od-link.css','./marquee-select.css','./folder-dest-sheet.css','./memo-thread.css','./ui-standard.css'],
  home:['./journal.css','./weekly-org-lines.css','./biz-summary.css','./home-quick.css','./library-upload.css','./row-swipe.css','./od-link.css','./basket-picker.css','./choice-sheet.css','./google-tasks.css','./area-org-picker.css','./folder-look.css','./todo-radar.css','./folder-tree.css','./ui-standard.css'],
  calendar:['./choice-sheet.css','./area-org-picker.css','./od-link.css','./calendar-ui.css','./basket-picker.css','./folder-look.css','./folder-tree.css','./row-swipe.css','./ui-standard.css'],
  tasks:['./task-layout.css','./row-swipe.css','./google-tasks.css','./area-org-picker.css','./home-quick.css','./library-upload.css','./basket-picker.css','./folder-look.css','./choice-sheet.css','./folder-tree.css','./ui-standard.css'],
  diary:['./diary.css','./od-link.css','./ed-doc.css','./folder-look.css','./basket-picker.css','./folder-tree.css','./ui-standard.css'],
  projects:['./project-system-v3.css','./record-sheet.css','./markdown-view.css','./google-tasks.css','./area-org-picker.css','./basket-picker.css','./choice-sheet.css','./folder-look.css','./folder-tree.css','./row-swipe.css','./ui-standard.css'],
  library:['./filter-chips.css','./choice-sheet.css','./library-upload.css','./folder-tree.css','./compact-list.css','./markdown-view.css','./folder-look.css','./list-edit.css','./area-org-picker.css','./row-swipe.css','./marquee-select.css','./od-link.css','./folder-dest-sheet.css','./record-sheet.css','./ui-standard.css'],
  meetings:['./first-use.css','./filter-chips.css','./weekly-org-lines.css','./biz-summary.css','./choice-sheet.css','./od-link.css','./month-cal.css','./meeting-ui.css','./markdown-view.css','./google-tasks.css','./area-org-picker.css','./todo-radar.css','./basket-picker.css','./folder-look.css','./folder-tree.css','./row-swipe.css','./memo-thread.css','./ui-standard.css'],
  team:['./first-use.css','./suborganizations.css','./weekly-org-lines.css','./workplace-detail.css','./library-upload.css','./basket-picker.css','./markdown-view.css','./ed-doc.css','./record-sheet.css','./google-tasks.css','./area-org-picker.css','./list-edit.css','./ui-standard.css'],
  hwp:['./hwp-lab.css','./ui-standard.css'],
  profile:['./profile-settings.css','./home-quick.css','./ui-standard.css'],
  search:['./filter-chips.css','./global-search.css','./folder-look.css','./folder-tree.css','./ui-standard.css'],
  reference:['./reference-bundles.css','./ui-standard.css'],
  calls:['./choice-sheet.css','./feed.css','./area-org-picker.css','./ui-standard.css'],
  telegram:['./choice-sheet.css','./feed.css','./area-org-picker.css','./folder-look.css','./folder-tree.css','./news-mark-rows.css','./memo-thread.css','./ui-standard.css'],
  photos:['./diary.css','./od-link.css','./source-chips.css','./photos.css','./folder-tree.css','./folder-look.css','./basket-picker.css','./folder-dest-sheet.css','./ui-standard.css'],
  arsenal:['./arsenal.css','./ui-standard.css'],
  // OUTSIDE-글상세·관심환류 ③: Now 한 메뉴(사회운동·뉴스·보관·문장 찾기 탭 + 글 상세). 옛 news 화면은 Now [뉴스] 탭.
  outside:['./od-link.css','./outside-statements.css','./news-clipping.css','./row-swipe.css','./library-upload.css','./now.css','./news-mark-rows.css','./folder-look.css','./folder-tree.css','./folder-dest-sheet.css','./memo-thread.css','./ui-standard.css'],
  files:['./od-link.css','./folder-tree.css','./source-chips.css','./folder-dest-sheet.css','./files.css','./folder-look.css','./ui-standard.css'],
  updates:['./release-notes.css','./update-news.css','./small-form-modal.css','./ui-standard.css'],
  whatsnew:['./update-news.css','./ui-standard.css'],
  feedback:['./feedback.css','./ui-standard.css'],
  signups:['./signups.css','./ui-standard.css'],
  // SEC-기능PIN잠금 ②: 잠금 화면(설정 목록·숫자 판).
  lock:['./lock.css','./ui-standard.css'],
  brief:['./feed.css','./news-mark-rows.css','./brief-room.css','./first-use.css','./folder-look.css','./library-upload.css','./ui-standard.css'],
  // S68-09 READ-읽을거리함: 읽을 거리 목록·글 보기(줄 메뉴는 feed.css 공용 작은 메뉴).
  reading:['./feed.css','./choice-sheet.css','./area-org-picker.css','./filter-chips.css','./news-mark-rows.css','./folder-look.css','./folder-tree.css','./row-swipe.css','./reading.css','./memo-thread.css','./ui-standard.css'],
  // HELP-메뉴안쓰는법: 쓰는 법 화면. 앱 내려받기 탭·단계는 빈 화면 안내와 같은 모양(first-use.css).
  help:['./help.css','./first-use.css','./ui-standard.css']
};
// PERF-첫로딩 P4: 화면 프로그램을 처음 부를 때(첫 화면은 이 도구가 실행되는 즉시 — loader-v2.js) 그 화면 첫 프로그램의 정적 사슬 전체를
// 받기만 먼저 걸어 둔다(실행 순서는 아래 loaders 그대로). 사슬은 Pages 빌드가 채운다(/*static-chain*/, scripts/build-pages.mjs).
// 담당조직은 목록만 — 조직 상세는 목록이 보인 뒤 받는다(P5, organization-detail-deferred 시험).
const firstModules={team:/*static-chain*/['./suborganizations.js']};
async function prepare(view){
  const key=normalize(view);
  if(!loaded.has(key))for(const path of firstModules[key]||warmModules[key]||[])hint('modulepreload',path);
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
  background(afterReveal().then(()=>Promise.all([style('./google-tasks.css'),style('./area-org-picker.css'),organizationOrder()])).then(()=>module('./google-tasks.js')).then(()=>module('./calendar-tasks.js')));
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
  return {ok:true}
}
async function organizations(){
  await organizationOrder();
  // The organization detail (workplace-detail.js, with its linked Google tasks — TASK-조직상세) is loaded by suborganizations.js
  // after the list is shown (PERF-첫로딩 P5); until then its KPTUWorkplace.open and row clicks load it first.
  await module('./suborganizations.js','__KPTU_SUBORGANIZATIONS_READY__');
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
// OUTSIDE-글상세·관심환류 ③: Now 껍데기(outside-statements.js)가 #outsideView와 [뉴스] 탭 자리를 만든 뒤 뉴스 클리핑(news-clipping.js)이 그 자리에 들어간다.
// NEWS-운영자만(S63-03, 명진 11/16): News는 서버 운영자 기능 키 'outside'가 있는 작업공간만. 키가 없다는 답이면 화면 모듈을 불러오지 않고
// 홈으로 보낸다(주소 ?view=news·옛 ?view=outside·now를 직접 열어도). 답을 못 읽었으면(null) 막지 않는다 — 운영자 화면이 잠깐 못 읽었다고 닫히지 않게
// (메뉴 myFeaturesOrNull 규칙과 같음). 화면 판정은 보안이 아니다: 수집·AI는 Edge가 같은 키로 막는다.
async function outsideAllowed(){
  try{const {myFeaturesOrNull}=await import('./my-features.js');const got=await myFeaturesOrNull();return !Array.isArray(got)||got.includes('outside')}
  catch{return true}
}
async function outside(){
  if(!await outsideAllowed()){window.KPTURouter?.go?.('home',{replaceUrl:true});return {ok:false,denied:true}}
  await module('./outside-statements.js'); await module('./news-clipping.js'); return {ok:true}
}
// FILES-클라우드탐색기 ④: [파일](?view=files, 위 메뉴 자료실 바로 아래). loadAll에 넣지 않고 열 때만 불러온다(모듈이 #filesView를 만든다).
async function files(){ await module('./files.js'); return {ok:true} }
// UI-업데이트기록입구: [업데이트 기록](?view=updates, 계정 메뉴 [내 프로필] 아래). loadAll에 넣지 않고 열 때만 불러온다(모듈이 #updatesView를 만든다).
async function updates(){ await module('./release-notes-ui.js'); return {ok:true} }
// UPDATE-운영자전용기록업데이트소식 PR3: [업데이트 소식](?view=whatsnew, 계정 메뉴 — 모든 이용자). 열 때만 불러온다(모듈이 #whatsnewView를 만든다).
async function whatsnew(){ await module('./update-news-ui.js'); return {ok:true} }
// FEEDBACK-의견보내기 PR5: 운영자 '받은 의견'(?view=feedback, 운영자 계정 메뉴). 열 때만 불러온다(모듈이 #feedbackView를 만든다, 읽기는 서버가 운영자만).
async function feedback(){ await module('./feedback-inbox.js'); return {ok:true} }
// OPS-새가입알림 ③·OPS-가입자현황: 운영자 '가입자 현황'(?view=signups, 운영자 계정 메뉴·새 가입 알림). 열 때만 불러온다(모듈이 #signupsView를 만든다, 읽기는 서버가 운영자만).
async function signups(){ await module('./signups-view.js'); return {ok:true} }
// BRIEF-브리핑룸 ③: [브리핑 룸](?view=brief, 메뉴 자료실 바로 아래). loadAll에 넣지 않고 열 때만 불러온다(모듈이 #briefView를 만든다).
async function brief(){ await module('./brief-room.js'); return {ok:true} }
// S68-09 READ-읽을거리함: [읽을 거리](?view=reading, 위 메뉴 잊지 말기 다음). 열 때만 불러온다(모듈이 #readingView를 만든다).
async function reading(){ await module('./reading.js'); return {ok:true} }
// HELP-메뉴안쓰는법: [쓰는 법](?view=help, 계정 › 쓰는 법·각 화면 ⋯ 맨 아래). loadAll에 넣지 않고 열 때만 불러온다(모듈이 #helpView를 만든다).
// SEC-기능PIN잠금 ②: [잠금](?view=lock, 계정 메뉴) — 잠긴 기능을 열 때도 문지기(feature-lock.js)가 이 화면으로 보낸다. 열 때만 불러온다(모듈이 #lockView를 만든다).
async function lock(){ await module('./lock-ui.js'); return {ok:true} }
async function help(){ await module('./help.js'); return {ok:true} }
const loaders={home,basket,calendar,tasks,diary,projects,library,meetings,team:organizations,hwp:hwpLab,profile,search,reference,photos,calls,telegram,arsenal,outside,files,updates,whatsnew,feedback,signups,brief,reading,help,lock};
// Retired addresses that open another view (옛 시험판 ?view=hwp-lab → hwp, 새 주소 ?view=reports → meetings 화면, 옛 ?view=media(성명·보도자료) → 자료실). The router uses the same map.
// NOTE-게시 ③: 옛 [공유 페이지] 화면(?view=pages)은 없앴다 — 노트(정리함 노트 쪽, 라우터 ALIAS_SUB)를 연다.
const VIEW_ALIAS={'hwp-lab':'hwp',reports:'meetings',media:'library',news:'outside',now:'outside',journal:'home',pages:'basket'};
function normalize(view){
  view=VIEW_ALIAS[view]||view;
  return loaders[view]?view:'home'
}
function load(view){
  const key=normalize(view);
  // SEC-기능PIN잠금 ②: 잠긴 기능(하루 기록·사진·통화·텔레그램)은 화면 프로그램을 받기 전에 멈춘다 — 잠긴 동안 그 화면의 자료를 불러오지도 그리지도 않는다.
  // 불러온 것으로 치지 않으므로 풀린 뒤 다시 부르면 그때 받는다. 판정은 feature-lock.js 한 곳(라우터 go()도 같은 판정으로 잠금 화면으로 보낸다).
  if(window.KPTUFeatureLock?.locked?.(key))return Promise.resolve({ok:false,locked:true,view:key});
  if(loaded.has(key))return Promise.resolve({ok:true,view:key,cached:true});
  if(flights.has(key))return flights.get(key);
  const flight=Promise.resolve().then(()=>prepare(key)).then(()=>loaders[key]()).then(result=>{
    // 막힌 화면(ok:false, 예: 기능 키 없는 News)은 불러온 것으로 치지 않는다 — 다음에 다시 판정.
    if(result&&result.ok===false)return {...result,view:key};
    loaded.add(key);
    window.dispatchEvent(new CustomEvent('kptu:view-loader-ready',{detail:{view:key}}));
    return {...(result||{ok:true}),view:key}
  }).finally(()=>{flights.delete(key);resumeWarm()});
  flights.set(key,flight);
  return flight
}
async function loadAll(){
  for(const view of ['home','basket','calendar','tasks','projects','library','meetings','team'])await load(view);
  // PERF-첫로딩 P5: 'team'은 목록만 기다리므로, 전부 받기에서는 조직 상세 묶음도 받아 둔다.
  await window.KPTUWorkplace?.load?.();
  return true
}
// UI-기다림표시통일 ⑤: 메뉴 화면 프로그램 미리 받기. 앱을 켠 뒤 쉬는 틈에(loader-v2.js) 메뉴 화면의 첫 프로그램과 모양 파일을 받아만 둔다
// (modulepreload·prefetch: 실행·적용하지 않음 → 화면·자료에 영향 없음). 처음 눌러도 '불러오는 중'이 거의 안 보이게 한다. 기기 저장 없이 브라우저 기본 캐시만.
// HWP 편집기(약 20MB)·아스날은 받지 않는다. 주소는 위 화면별 불러오기와 같은 글자(Pages 빌드가 같은 해시 번호를 붙인다).
// PERF-첫로딩 P4: 목록에는 화면 첫 프로그램(뿌리)만 적고, 그 정적 import 사슬은 Pages 빌드가 채운다(/*static-chain*/) — 미리 받은 뒤 눌러도 사슬을 다시 받지 않게.
// S52-08 ①(docs/design/perf-first-load-1107.md 6절): 뿌리에는 위 loaders가 화면이 보이기 전에 기다리는 모듈을 모두 적는다(달력 interactions·mobile-ui·
// day-overflow·persistence, 사업 보고 파일·녹음 초안, 원장 고치기·합치기·사본 줄). 빠지면 첫 클릭 때 그 사슬을 새로 받는다.
const warmModules={
  basket:/*static-chain*/['./basket.js'],
  calendar:/*static-chain*/['./calendar-month-view.js','./calendar-view.js','./calendar-plus.js','./calendar-interactions-v2.js','./calendar-mobile-ui.js','./calendar-day-overflow.js','./calendar-persistence.js'],
  tasks:/*static-chain*/['./project-catalog.js','./organization-order.js','./google-tasks.js'],
  home:/*static-chain*/['./journal.js'],
  diary:/*static-chain*/['./diary.js'],
  projects:/*static-chain*/['./project-system-v3.js'],
  library:/*static-chain*/['./library-upload.js'],
  meetings:/*static-chain*/['./team-report-kit.js','./task-workflow.js','./meeting-round-detail.js','./meeting-from-files.js'],
  team:/*static-chain*/['./suborganizations.js','./workplace-detail.js'],
  reference:/*static-chain*/['./reference-bundles.js'],
  calls:/*static-chain*/['./call-feed.js'],
  telegram:/*static-chain*/['./telegram-feed.js'],
  photos:/*static-chain*/['./photos.js'],
  outside:/*static-chain*/['./outside-statements.js','./news-clipping.js'],
  files:/*static-chain*/['./files.js'],
  brief:/*static-chain*/['./brief-room.js'],
  reading:/*static-chain*/['./reading.js'],
  help:/*static-chain*/['./help.js']
};
const warmed=new Set();
function hint(rel,path,as){
  const href=new URL(path,location.href).href;
  if(warmed.has(href))return null;
  warmed.add(href);
  const link=document.createElement('link');
  link.rel=rel;link.href=path;if(as)link.as=as;link.dataset.kptuWarm='1';
  document.head.appendChild(link);
  return link
}
// PERF-첫로딩 P5-c(docs/design/first-load.md 11절): 화면마다 차례로 받는다 — 한 화면 사슬을 다 받은(또는 실패한) 뒤 다음 쉬는 틈에 다음 화면.
// 한꺼번에(약 220개) 걸면 폰에서 받기·해석(modulepreload는 받은 뒤 해석까지 함)이 한데 몰려, P5-b로 홈 앞에서 뺀 사업 보고 묶음까지 홈 바로 뒤에서
// 먼저 누를 화면(일정 등)과 다툰다(S48-34 측정: 달력 첫 전환 775 → 1359ms). 순서는 위 목록 그대로(메뉴 순서). 그 화면을 이미 열었으면 건너뛰고,
// 화면을 누르면 prepare가 그 사슬을 바로 받는다(같은 주소는 한 번만).
let warmPaused=null;
function resumeWarm(){if(flights.size||!warmPaused)return;const next=warmPaused;warmPaused=null;idle(next)}
const settled=link=>new Promise(resolve=>{link.addEventListener('load',resolve,{once:true});link.addEventListener('error',resolve,{once:true})});
const idle=fn=>window.requestIdleCallback?window.requestIdleCallback(fn,{timeout:2000}):setTimeout(fn,50);
function warm(){
  if(navigator.connection?.saveData)return false;
  const have=new Set([...document.querySelectorAll('link[rel="stylesheet"]')].map(link=>link.href));
  const queue=Object.entries(warmModules);
  const next=()=>{
    while(queue.length){
      // S52-08 ①: 화면을 부르는 중이면(누른 화면의 받기·실행) 다음 화면 미리 받기를 걸지 않고, 다 부른 뒤 쉬는 틈에 잇는다.
      if(flights.size){warmPaused=next;return}
      const [view,paths]=queue.shift();
      if(loaded.has(view))continue;
      const links=paths.map(path=>hint('modulepreload',path)).filter(Boolean);
      for(const path of routeStyles[view]||[])if(!have.has(new URL(path,location.href).href))hint('prefetch',path,'style');
      if(!links.length)continue;
      void Promise.all(links.map(settled)).then(()=>idle(next));
      return;
    }
  };
  next();
  return true
}
// PERF-첫로딩 P5-c: 화면 안에서 뒤늦게 부르는 묶음(예: 홈의 [주간 정리] 묶음)도 같은 받기 도구로 사슬을 한꺼번에 받아만 둔다.
// 부르는 쪽은 /*static-chain*/ 목록(뿌리만, 빌드가 사슬을 채움)을 넘긴다. 받기만 하고 실행은 부르는 쪽 import() 그대로.
function preload(paths){for(const path of paths||[])hint('modulepreload',path)}
window.KPTUViewLoader={load,loadAll,prepare,normalize,warm,preload,style,isLoaded:view=>loaded.has(normalize(view))};
// S67-41: 공용 부품(part-styles.js)이 이 도구를 기다리고 있으면 알려 준다.
window.dispatchEvent(new Event('kptu:view-loader-installed'));
})();
