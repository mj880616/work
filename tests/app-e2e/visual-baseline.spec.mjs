// DESIGN-검증하네스 ③(S73-04, 2026-11-27 사용자 요청): 주요 화면 20개 × PC 1280·폰 412 기준 사진.
// 왜: 화면 시험이 모두 동작만 확인해, 한 화면(공용 CSS·공용 부품)을 고치면 다른 화면이 틀어져도 못 잡았다.
// 무엇을 고정하나: 시각(Date — openHome이 2026-10-06 10:00 KST로 멈춤), 시간대(Asia/Seoul)·언어(ko-KR), 글꼴(저장소 안 Noto Sans KR 두 굵기),
// 애니메이션·전환·깜박이는 커서 끔(toHaveScreenshot 기본 + 아래 CSS), 자료(가짜 서버 openHome — 운영 서버는 부르지 않는다).
// 흔들리면 화면을 빼지 않고 원인(날짜·글꼴·늦게 오는 자료)을 고정한다(AGENTS.md 9절: 재시도·대기 늘리기·skip 금지).
// 기준 사진: tests/app-e2e/visual-baseline.spec.mjs-snapshots/ (CI 리눅스에서 만든 것). 갱신 방법은 docs/visual-baseline.md.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView,accountButton} from './helpers/shell-navigation.mjs';
import {chooseBasketKind} from './helpers/basket-kind.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {SB,libDoc,libFolder} from './helpers/library-folder-server.mjs';

test.use({timezoneId:'Asia/Seoul',locale:'ko-KR'});

const FONT_DIR=`${testOrigin}/app/hwp-lab/rhwp-0.8.7/studio/fonts`;
// 글꼴 고정: 기기마다 다른 시스템 글꼴 대신 저장소 안 글꼴 파일 하나로 모든 글자를 그린다(그림 글자 ⋯·이모지는 그 OS 글꼴로 떨어진다 — CI 같은 판).
// 애니메이션·전환 끔, 입력 커서 숨김, 스크롤 막대 숨김(폭은 그대로 두지 않으면 기기별로 달라짐).
const FREEZE_CSS=`
@font-face{font-family:"VB Noto";src:url("${FONT_DIR}/NotoSansKR-Regular.woff2") format("woff2");font-weight:100 599;font-display:block}
@font-face{font-family:"VB Noto";src:url("${FONT_DIR}/NotoSansKR-Bold.woff2") format("woff2");font-weight:600 900;font-display:block}
*,*::before,*::after{font-family:"VB Noto",sans-serif!important;animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}
::-webkit-scrollbar{width:0!important;height:0!important}
`;
async function freeze(page){
  await page.addInitScript(css=>{
    const put=()=>{if(document.getElementById('vb-freeze'))return;const s=document.createElement('style');s.id='vb-freeze';s.textContent=css;(document.head||document.documentElement).appendChild(s)};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',put,{once:true});else put();
  },FREEZE_CSS);
}

// 자료실은 빈 목록이면 모양을 볼 것이 없어 지어낸 자료 6개·폴더 2개를 둔다(날짜 고정). 홈 주간 보고 재료(분류 주간보고) 읽기는 openHome 것 그대로.
async function libraryData(page){
  const docs=[libDoc('d1','p',{workspace_id:'w',title:'가상 정책 검토안',category:'정책자료'}),libDoc('d2','p',{workspace_id:'w',title:'가상 회의 자료',category:'회의자료',file_name:'d2.hwp'}),
    libDoc('d3','child',{workspace_id:'w',title:'가상 설명 자료',category:'기타',file_name:'d3.docx'}),libDoc('d4',null,{workspace_id:'w',title:'가상 보도자료',category:'성명·보도자료'}),
    libDoc('d5','p',{workspace_id:'w',title:'가상 통계표',category:'정책자료',file_name:'d5.xlsx'}),libDoc('d6',null,{workspace_id:'w',title:'가상 사진 묶음',category:'기타',file_name:'d6.zip'})];
  const folders=[libFolder('f1','p',{name:'가상 폴더 1',workspace_id:'w',created_at:'2026-10-01T00:00:00Z'}),libFolder('f2','p',{name:'가상 폴더 2',sort_order:2048,workspace_id:'w',created_at:'2026-10-01T00:00:00Z'})];
  const ok=(route,data)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  await page.route(`${SB}/rest/v1/app_documents**`,route=>{
    const u=new URL(route.request().url());
    if(route.request().method()!=='GET'||u.searchParams.get('category')||u.searchParams.get('id'))return route.fallback();
    return ok(route,docs);
  });
  await page.route(`${SB}/rest/v1/app_library_folders**`,route=>route.request().method()==='GET'?ok(route,folders):route.fallback());
  await page.route(`${SB}/rest/v1/app_library_folder_items**`,route=>route.request().method()==='GET'?ok(route,[{workspace_id:'w',document_id:'d1',folder_id:'f1'}]):route.fallback());
}
// FIX-노트폴드목록(2026-11-28): 폴드 펼침 두 칸(왼쪽 폴더 나무 | 오른쪽 노트 목록)에서 폴더를 누른 화면 — 제목 칸이 0으로 줄던 화면.
// 지어낸 노트 5개(날짜 고정)를 한 폴더(하위 폴더 하나)에 두고, 나무에서 그 폴더를 누른 뒤 찍는다.
async function noteFolderData(page){
  const at=i=>`2026-10-0${i}T01:00:00Z`;
  const notes=[1,2,3,4,5].map(i=>({id:'vn'+i,workspace_id:'w',kind:'note',title:`가상 노트 제목 ${i}번`,raw_text:`가상 본문 ${i} #가상`,occurred_at:at(i),created_at:at(i),updated_at:at(i),archived_at:null,ai_export_allowed:true,attachments:i===2?[{id:'va1',name:'가상.pdf'}]:[],metadata:{folder_id:'00000000-0000-4000-8000-000000000001'}}));
  const folders=[{id:'00000000-0000-4000-8000-000000000001',workspace_id:'w',parent_id:null,name:'01. 가상 메모',sort_order:1024,created_at:'2026-10-01T00:00:00Z'},
    {id:'00000000-0000-4000-8000-000000000002',workspace_id:'w',parent_id:'00000000-0000-4000-8000-000000000001',name:'가상 하위',sort_order:1024,created_at:'2026-10-01T00:00:00Z'}];
  const ok=(route,data)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',route=>route.request().method()==='GET'?ok(route,notes):route.fallback());
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_note_folders',route=>route.request().method()==='GET'?ok(route,folders):route.fallback());
}
async function openNoteFolder(page){
  await chooseBasketKind(page,'note');
  await page.locator('[data-nx-tree] [data-nx-folder="00000000-0000-4000-8000-000000000001"]').first().click();
  await expect(page.locator('#noteRows .nx-note.nl-cols')).toHaveCount(5,{timeout:20000});
}
async function openDiary(page){
  // 폰: [일정] 탭 → 위 [달력 | 할 일 | 하루 기록] 전환. PC: 왼쪽 메뉴 줄.
  if((page.viewportSize()?.width||0)>760)return clickView(page,'diary');
  await clickView(page,'calendar');
  await page.locator('.schedule-switch [data-view="diary"]:visible').click();
}
const panel=sel=>page=>expect(page.locator(sel)).toBeVisible({timeout:20000});
const go=view=>async page=>{await clickView(page,view)};
async function openMenuEdit(page){
  const phone=(page.viewportSize()?.width||0)<=760;
  await accountButton(page).click();
  const box=page.locator(phone?'#mobileMenu':'#sidebarAccountPanel');
  await expect(box).toBeVisible();
  await box.locator('[data-menu-edit-open]').click();
}
async function openProfile(page){
  const phone=(page.viewportSize()?.width||0)<=760;
  await accountButton(page).click();
  const box=page.locator(phone?'#mobileMenu':'#sidebarAccountPanel');
  await expect(box).toBeVisible();
  await box.locator('[data-profile-open]').click();
}

// 화면 표: 이름(사진 파일 이름), 여는 법, 다 열렸다고 볼 곳. 고른 이유는 docs/visual-baseline.md 표.
export const SCREENS=[
  {name:'home',open:async()=>{},ready:'#homeView'},
  {name:'calendar',open:go('calendar'),ready:'#calendarView'},
  {name:'tasks',open:go('tasks'),ready:'#tasksView'},
  {name:'diary',open:openDiary,ready:'#diaryView'},
  {name:'note',open:page=>chooseBasketKind(page,'note'),ready:'#basketView[data-kind="note"]'},
  {name:'forget',open:page=>chooseBasketKind(page,'basket'),ready:'#basketView[data-kind="memo"]'},
  {name:'library',open:go('library'),ready:'#libraryView',data:libraryData},
  {name:'photos',open:go('photos'),ready:'#photosView'},
  {name:'files',open:go('files'),ready:'#filesView'},
  {name:'reading',open:go('reading'),ready:'#readingView'},
  {name:'team',open:go('team'),ready:'#teamView'},
  {name:'reports',open:go('meetings'),ready:'#meetingsView'},
  {name:'areas',open:go('projects'),ready:'#areaWindow'},
  {name:'brief',open:go('brief'),ready:'#briefView'},
  {name:'news',open:go('outside'),ready:'#outsideView'},
  {name:'calls',open:go('calls'),ready:'#callsView'},
  {name:'telegram',open:go('telegram'),ready:'#telegramView'},
  {name:'arsenal',open:go('arsenal'),ready:'#arsenalView'},
  {name:'profile',open:openProfile,ready:'#profileView'},
  {name:'menu-edit',open:openMenuEdit,ready:'#menuEditModal'},
];
const WIDTHS=[{tag:'pc',width:1280,height:800},{tag:'phone',width:412,height:915}];
// 폴드 펼침 폭(600~760px: 두 칸 + 손가락 줄 밀기)에서만 따로 보는 화면. 사진 이름 <화면>-fold.
export const FOLD_SCREENS=[
  {name:'note-folder',open:openNoteFolder,ready:'#basketView[data-kind="note"]',data:noteFolderData},
];
const FOLD={tag:'fold',width:712,height:900};

for(const [{tag,width,height},list] of [...WIDTHS.map(w=>[w,SCREENS]),[FOLD,FOLD_SCREENS]]){
  for(const screen of list){
    test(`기준 사진 ${screen.name} (${tag} ${width}px)`,async({page})=>{
      test.setTimeout(90000);
      await page.setViewportSize({width,height});
      await freeze(page);
      await openHome(page,{beforeLoad:screen.data?()=>screen.data(page):null});
      await screen.open(page);
      await panel(screen.ready)(page);
      await page.evaluate(()=>document.fonts.ready);
      await page.waitForLoadState('networkidle');
      await page.mouse.move(0,0);
      await expect(page).toHaveScreenshot(`${screen.name}-${tag}.png`,{animations:'disabled',caret:'hide',timeout:15000});
    });
  }
}
