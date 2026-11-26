// MULTI-사업보고빈화면(요청함 11/14 22:21, 설계 docs/design/new-user-start.md 2-4 — 사용자 11/13 확정): 사업영역이 0개인 새 계정의 사업 보고.
// - '이번 주 주간보고' 칸은 표·표 모양 자리(회색 칸)를 한 번도 그리지 않고 안내 한 줄 + [+ 사업 만들기](사업영역 관리 창)만.
// - 아래 목록의 '없음'도 그리지 않는다(안내 한 줄이 빈 자리를 맡음). 사용자 계정(사업영역 있음)은 지금과 같은 표 — biz-week-no-shift·biz-summary-now 시험이 본다.
// 서버는 가짜, 이름·글은 모두 합성 값. 시계 2026-11-09(월) 09:30(서울).
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {installBusinessNowServer} from './helpers/business-now-server.mjs';

test.use({timezoneId:'Asia/Seoul'});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',NOW='2026-11-09T00:30:00Z';
const SHOTS=process.env.S62_05_SHOTS;
const HINT='사업(예: 임단협, 조직 확대)을 만들면 회의·결과가 사업별로 모여요';

async function open(page,width,{spaces=[],spacesLate=0,url='/app/?view=reports'}={}){
  await page.setViewportSize({width,height:900});
  await page.clock.setFixedTime(new Date(NOW));
  const st=baseState();st.spaces=spaces;
  await mockApp(page,st);
  await page.route(`${SB}/rest/v1/app_weekly_exec_requests**`,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await installBusinessNowServer(page,{});
  // BIZ-빈표잠깐보임다시: 사업영역 목록(app_spaces)이 늦게 오는 느린 망 — 나중에 단 route가 먼저 받아 기다린 뒤 원래 가짜 서버로 넘긴다.
  if(spacesLate)await page.route(`${SB}/rest/v1/app_spaces**`,async route=>{await new Promise(r=>setTimeout(r,spacesLate));await route.fallback()});
  // 칸이 보이는 동안 표 모양 자리·표·양식 제목이 한 번이라도 그려졌는지 매 그림마다 센다.
  await page.addInitScript(()=>{
    window.__seen={skel:0,table:0,heading:0};window.__drawn=0;
    const tick=()=>{const box=document.querySelector('#bizWeekBox');
      // 화면에 안 보여도(다른 화면이 앞에 있거나 칸이 숨겨져 있어도) 칸 안에 표 모양·표가 그려진 적이 있는지도 센다 — 보이는 순간과 겹치면 한 프레임 깜빡임이 된다.
      if(box&&box.querySelector('.biz-skel,.biz-sum-table'))window.__drawn++;
      if(box&&!box.hidden&&box.offsetParent){if(box.querySelector('.biz-skel'))window.__seen.skel++;if(box.querySelector('.biz-sum-table'))window.__seen.table++;if(/사업요약표/.test(box.textContent))window.__seen.heading++}
      requestAnimationFrame(tick)};
    requestAnimationFrame(tick);
  });
  await signIn(page,testOrigin+url);
  if(url.includes('reports'))await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
}
const hintShown=page=>expect(page.locator('#bizWeekBox .biz-week-none')).toBeVisible();
const noTableYet=async page=>{await page.waitForTimeout(400);expect(await page.evaluate(()=>[window.__seen,window.__drawn])).toEqual([{skel:0,table:0,heading:0},0])};

for(const width of [412,690,840,1280])test(`${width}: 사업영역이 없으면 빈 표 없이 안내 한 줄 + [+ 사업 만들기]`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await open(page,width);
  const box=page.locator('#bizWeekBox'),hint=box.locator('.biz-week-none');
  await expect(hint).toBeVisible();await expect(hint).toContainText(HINT);
  const add=hint.getByRole('button',{name:'+ 사업 만들기'});await expect(add).toBeVisible();
  // 제목 줄(접기)·표·아래 [주간 정리에서 보기 ›] 없음, 아래 목록 '없음'도 없음.
  // BIZ-머리한줄(S71-23): 주 넘기기 ‹ ›는 이 상자 제목 줄에만 있으므로, 보고가 있으면 접기 없이 ‹ 날짜 ›만 남는다(목록이 그 주를 따름).
  await expect(box.locator('.biz-week-title [data-bw-fold]')).toHaveCount(0);await expect(box.locator('[data-bw-journal]')).toHaveCount(0);
  const withNav=await box.locator('.biz-week-nav').count();
  await expect(page.locator('#meetingList')).not.toContainText('없음');
  await page.waitForTimeout(400); // 늦은 그리기가 표로 바꾸지 않는지
  expect(await page.evaluate(()=>window.__seen)).toEqual({skel:0,table:0,heading:0});
  // 칸 높이는 한 줄(낮게)
  expect((await box.boundingBox()).height).toBeLessThanOrEqual((width<600?96:64)+(withNav?40:0));
  if(SHOTS)await page.screenshot({path:`${SHOTS}/biz-none-${width}.png`});
  await add.click();
  await expect(page.locator('#areaWindow')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('사업영역을 만들면 같은 칸이 표로 바뀐다',async({page})=>{
  await open(page,1280);
  await expect(page.locator('#bizWeekBox .biz-week-none')).toBeVisible();
  // 사업영역 관리 창에서 하나를 만든 것과 같은 알림(공용 목록 publish + kptu:project-spaces-updated)
  await page.evaluate(()=>{
    const s=[{id:'top-new',workspace_id:'workspace-1',name:'합성 사업',description:null,parent_id:null,status:'active',visibility:'private',owner_id:'user-1',sort_order:10,created_at:'2026-11-09T00:00:00Z',updated_at:'2026-11-09T00:00:00Z',metadata:{project_system:'v2',management_version:2}}];
    window.KPTUProjectCatalog.publish({workspaceId:'workspace-1',userId:'user-1',spaces:s});
    window.dispatchEvent(new CustomEvent('kptu:project-spaces-updated',{detail:{workspaceId:'workspace-1',userId:'user-1',spaces:s}}));
  });
  await expect(page.locator('#bizWeekBox .biz-week-none')).toHaveCount(0);
  await expect(page.locator('#bizWeekBox .biz-week-title [data-bw-fold]')).toBeVisible();
  await expect(page.locator('#bizWeekBox .biz-sum-table')).toBeVisible();
  await expect(page.locator('#bizWeekBox [data-bw-journal]')).toBeVisible();
});

// BIZ-빈표잠깐보임다시(사용자 11/15 18:11 '여전히 표를 잠깐 그렸다 가림'): 실제 순서마다 표·표 모양 자리(회색 칸)가 0프레임인지 센다(재시도·대기 늘리기 없음).
for(const width of [412,880,1280]){
  test(`${width}: 사업영역 목록이 늦게 와도(느린 망) 표 모양이 한 번도 안 보인다`,async({page})=>{
    await open(page,width,{spacesLate:1500});
    await hintShown(page);await noTableYet(page);
  });
  test(`${width}: 목록이 오기 전에 화면 폭이 바뀌어(폴드 접고 펴기·회전) 다시 그려져도 표 모양 0프레임`,async({page})=>{
    await open(page,width,{spacesLate:2500,url:'/app/'});
    await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('home'));
    await page.evaluate(()=>{window.KPTURouter.go('meetings')});
    await page.waitForTimeout(900); // 사업 보고 부품은 왔고 사업영역 목록은 아직(2.5초)
    await page.setViewportSize({width:width<600?700:412,height:900});await page.waitForTimeout(200);await page.setViewportSize({width,height:900});
    await hintShown(page);await noTableYet(page);
  });
  test(`${width}: 홈에서 시작해 사업 보고로 → 다른 화면 → 다시 사업 보고`,async({page})=>{
    await open(page,width,{spacesLate:800,url:'/app/'});
    await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('home'));
    await page.evaluate(()=>window.KPTURouter.go('meetings'));
    await hintShown(page);
    await page.evaluate(()=>window.KPTURouter.go('home'));await page.waitForFunction(()=>window.KPTURouter.current==='home');
    await page.evaluate(()=>window.KPTURouter.go('library'));await page.waitForFunction(()=>window.KPTURouter.current==='library');
    await page.evaluate(()=>window.KPTURouter.go('meetings'));
    await hintShown(page);await noTableYet(page);
  });
  test(`${width}: 새로 고침 · 앱 복귀(화면 다시 보임)에도 표 모양 0프레임`,async({page})=>{
    await open(page,width,{spacesLate:800});
    await hintShown(page);
    await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'))});
    await noTableYet(page);
    await page.reload();await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
    await hintShown(page);await noTableYet(page);
  });
}
