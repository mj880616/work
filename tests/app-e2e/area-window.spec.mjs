// MTG-프로젝트합치기 ①③(명진 10/29 시안 승인): [사업영역 관리]는 사업 보고 위에 뜨는 창(area-window.js), 목록 맨 위 '사업영역 안 단 보고 n건 [달기]'.
// ① 창 열기·닫기 뒤 보던 주 그대로 · 폰 뒤로가기 순서(상세 → 목록 → 사업 보고) · 옛 주소(?view=projects·?project=)
// ③ 줄은 보고 있는 주에 안 단 보고가 있을 때만 · 0건 주는 줄 없음 · [달기] 창(AI 추천 미리 고름) → [저장] 한 번 → 줄이 사라지고 꼬리표가 바뀜.
// 모든 이름·글은 합성 값.
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {reportWeekButton} from './helpers/report-week.mjs';
import {openMeetingResult} from './helpers/meeting-open.mjs';

test.use({timezoneId:'Asia/Seoul'});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const WEEK_A='10.5(월)~10.11(일)',WEEK_B='9.28(월)~10.4(일)';

// 주 A(10.5~10.11): 안 단 보고 1건(m-1) + 단 보고 1건(m-2). 주 B(9.28~10.4): 단 보고 1건(m-3)뿐.
function state(){
  const s=baseState();s.meetingWrites=[];s.aiCalls=[];
  const row=(id,title,at,area)=>({id,workspace_id:s.workspace.id,title,series_name:title,round_no:1,meeting_at:at,transcript_text:'합성 결과 글 — 기능개혁 대응 논의',activity_kind:'meeting',business_area_id:area,next_plan:null,created_by:s.user.id,updated_at:at});
  s.meetings=[row('m-1','합성 정기 회의','2026-10-08T01:00:00Z',null),row('m-2','합성 대응 회의','2026-10-07T01:00:00Z','top-a'),row('m-3','합성 지난 회의','2026-10-01T01:00:00Z','top-a')];
  return s;
}
async function open(page,s,width,url='/app/?view=reports'){
  await page.setViewportSize({width,height:900});await mockApp(page,s);
  await page.route(`${SB}/functions/v1/ai-assist`,route=>{const body=route.request().postDataJSON();s.aiCalls.push(body);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,kind:'area_suggest',suggestions:[{id:'top-a',name:'공공기관 기능개혁 대응'}]})})});
  await signIn(page,testOrigin+url);await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#meetingsView')).toBeVisible();
}
const weekLabel=page=>page.locator('#reportWeekFilter .report-week-label');
const win=page=>page.locator('#areaWindow');
async function openAreas(page){
  await page.locator('#meetingsView #reportMore:visible').click();
  await page.locator('#reportMoreMenu [data-report-areas]:visible').click();
  await expect(win(page)).toBeVisible();
  await expect(page.locator('#projectGrid .ps3-plist [data-ps3-project="top-a"]')).toBeVisible();
}

for(const width of [390,1280])test(`${width}: 사업 보고 ⋯ › 사업영역 관리는 사업 보고 위 창 — 닫으면 넘겨 본 주 그대로`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state();await open(page,s,width);
  await expect(weekLabel(page)).toContainText(WEEK_A);
  await reportWeekButton(page,'prev').click();await expect(weekLabel(page)).toContainText(WEEK_B);
  await openAreas(page);
  // 화면은 사업 보고 그대로(라우터 이름 projects는 없다), 창 머리줄: PC '사업영역 관리 [+ 사업영역] ✕' / 폰 '‹ 사업 보고 · 사업영역 관리 · +'.
  expect(await page.evaluate(()=>window.KPTURouter.current)).toBe('meetings');
  await expect(page.locator('#areaWindowTitle')).toHaveText('사업영역 관리');
  await expect(page.locator('#areaWindow .area-window-head #newProjectBtn')).toBeVisible();
  const close=page.locator(width<=760?'#areaWindow .area-window-back':'#areaWindow .area-window-close');
  await expect(close).toBeVisible();
  await expect(page.locator(width<=760?'#areaWindow .area-window-close':'#areaWindow .area-window-back')).toBeHidden();
  if(width<=760){
    // 폰: 하단바를 가리지 않는다(창은 하단바 위에서 끝남).
    const w=await win(page).boundingBox(),tabs=await page.locator('.mobile-tabs').boundingBox();
    expect(Math.round(w.y+w.height)).toBeLessThanOrEqual(Math.round(tabs.y)+1);
  }else{
    // PC: 왼쪽 앱 메뉴는 덮지 않고, 목록 | 상세 두 칸이 창 안에 있다.
    const w=await win(page).boundingBox(),nav=await page.locator('#appView>.app-nav').boundingBox();
    expect(w.x).toBeGreaterThanOrEqual(nav.x+nav.width-1);
    await expect(page.locator('#areaWindow #ps3DetailPane')).toBeVisible();
  }
  await close.click();
  await expect(win(page)).toBeHidden();
  await expect(page.locator('#meetingsView')).toBeVisible();
  await expect(weekLabel(page)).toContainText(WEEK_B);
  // Esc도 닫는다.
  await openAreas(page);await page.keyboard.press('Escape');await expect(win(page)).toBeHidden();await expect(weekLabel(page)).toContainText(WEEK_B);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('390: 폰 뒤로가기는 상세 → 사업영역 목록 → 사업 보고 순서',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state();await open(page,s,390);
  await openAreas(page);
  await page.locator('#projectGrid .ps3-plist [data-ps3-project="top-a"]').click();
  const detail=page.locator('#ps3DetailModal');
  await expect(detail).toBeVisible();await expect(page.locator('#ps3Body')).toHaveAttribute('data-project','top-a');
  await page.goBack();
  await expect(detail).toBeHidden();await expect(win(page)).toBeVisible();await expect(page.locator('#projectGrid .ps3-plist')).toBeVisible();
  await page.goBack();
  await expect(win(page)).toBeHidden();await expect(page.locator('#meetingsView')).toBeVisible();
  expect(await page.evaluate(()=>window.KPTURouter.current)).toBe('meetings');
  // 아래 탭으로 다른 화면에 가면 창은 닫힌다.
  await openAreas(page);
  await page.locator('.mobile-tabs [data-view="home"]').click();
  await expect(win(page)).toBeHidden();await expect(page.locator('#homeView')).toBeVisible();
  expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`${width}: 옛 주소 ?view=projects·?project= 는 사업 보고를 열고 창을 띄운다`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state();await open(page,s,width,'/app/?view=projects');
  await expect(win(page)).toBeVisible();
  await expect(page.locator('#projectGrid .ps3-plist [data-ps3-project="top-a"]')).toBeVisible();
  expect(await page.evaluate(()=>window.KPTURouter.current)).toBe('meetings');
  await expect(page).toHaveURL(/[?&]view=reports(?:&|$)/);
  // ?project=: 창 + 그 사업영역 상세.
  await page.goto(testOrigin+'/app/?project=child-a1');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
  await expect(win(page)).toBeVisible();
  await expect(page.locator('#ps3Body')).toHaveAttribute('data-project','child-a1');
  await expect(page.locator('#meetingsView')).toBeVisible();
  expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`${width}: '사업영역 안 단 보고 n건 [달기]' — 보고 있는 주에만, 0건이면 없음, [달기] → AI 미리 고름 → 저장 뒤 줄이 사라지고 꼬리표가 바뀜`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state();await open(page,s,width);
  const line=page.locator('#areaUntaggedLine');
  await expect(weekLabel(page)).toContainText(WEEK_A);
  await expect(line).toBeVisible();await expect(line).toContainText('사업영역 안 단 보고 1건');
  // 0건인 주(9.28~10.4)는 줄이 없다. [전체] 보기도 줄이 없다(보고 있는 주가 아님).
  await reportWeekButton(page,'prev').click();await expect(weekLabel(page)).toContainText(WEEK_B);await expect(line).toBeHidden();
  await reportWeekButton(page,'next').click();await expect(weekLabel(page)).toContainText(WEEK_A);await expect(line).toBeVisible();
  await reportWeekButton(page,'all').click();await expect(line).toBeHidden();
  await reportWeekButton(page,'all').click();await expect(line).toBeVisible();
  // 줄은 얇고 버튼은 작다.
  const btn=line.locator('[data-area-untagged]');
  expect((await line.boundingBox()).height).toBeLessThanOrEqual(36);expect((await btn.boundingBox()).height).toBeLessThanOrEqual(28);
  await btn.click();
  const sheet=page.locator('#reportAreaTagSheet');await expect(sheet).toBeVisible();
  await expect(sheet.locator('h2')).toHaveText('사업영역 달기 · 1건');
  const row=sheet.locator('[data-area-tag-row="m-1"]');await expect(sheet.locator('[data-area-tag-row]')).toHaveCount(1);
  await expect(row.locator('.area-tag-day')).toHaveText('10.8');await expect(row.locator('.area-tag-title')).toHaveText('합성 정기 회의');
  // AI 추천(이미 있는 area_suggest 길)이 미리 고르고 작은 'AI' 표시.
  const select=row.locator('[data-area-tag-select]');
  await expect(select).toHaveValue('top-a');await expect(row.locator('[data-area-tag-mark]')).toHaveText('AI');
  expect(s.aiCalls).toHaveLength(1);expect(s.aiCalls[0]).toMatchObject({kind:'area_suggest',title:'합성 정기 회의'});
  // 고른 것을 바꾸면 AI 표시가 사라진다. 다시 AI가 고른 것으로.
  await select.selectOption('child-a1');await expect(row.locator('[data-area-tag-mark]')).toBeHidden();
  await select.selectOption('top-a');
  if(width<=760){const b=await sheet.boundingBox(),tabs=await page.locator('.mobile-tabs').boundingBox();expect(b.y).toBeGreaterThan(200);expect(tabs).toBeTruthy()}
  const before=s.meetingWrites.length;
  await sheet.locator('[data-area-tag-save]').click();
  await expect(sheet).toBeHidden();
  // 기존 사업 보고 저장 길(app_meetings PATCH)로 꼬리표·updated_at만.
  const writes=s.meetingWrites.slice(before);
  expect(writes).toHaveLength(1);expect(Object.keys(writes[0]).sort()).toEqual(['business_area_id','updated_at']);expect(writes[0].business_area_id).toBe('top-a');
  await expect(line).toBeHidden();
  // 그 보고의 꼬리표가 바로 보인다.
  await openMeetingResult(page,'m-1');
  await expect(page.locator('[data-biz-area-name]:visible')).toHaveText('공공기관 기능개혁 대응');
  expect(errors).toEqual([]);
});
