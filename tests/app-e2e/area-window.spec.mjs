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

// MTG-사업영역없음(요청 10/30 07:51): '사업영역 없음' 칸(business_area_none)이 있는 서버 — [달기] 창 '고르기' 바로 아래 [없음](회색)
// → [저장] → '안 단 보고' 줄이 사라지고 그 보고는 꼬리표 없이 '사업영역 없음'. AI 추천은 [없음]을 미리 고르지 않는다.
for(const width of [390,1280])test(`${width}: [달기] 창 [없음] → 저장 뒤 '안 단 보고'에서 빠지고 꼬리표 없이 '사업영역 없음'`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state();for(const m of s.meetings)m.business_area_none=false;
  await open(page,s,width);
  const line=page.locator('#areaUntaggedLine');
  await expect(weekLabel(page)).toContainText(WEEK_A);await expect(line).toContainText('사업영역 안 단 보고 1건');
  await line.locator('[data-area-untagged]').click();
  const sheet=page.locator('#reportAreaTagSheet');await expect(sheet).toBeVisible();
  const select=sheet.locator('[data-area-tag-row="m-1"] [data-area-tag-select]');
  await expect(select).toHaveValue('top-a'); // AI 추천은 사업영역만
  const labels=await select.locator('option').allTextContents();
  expect(labels.slice(0,2)).toEqual(['고르기','없음']);
  await select.selectOption('__area_none__');await expect(select).toHaveClass(/is-none/);
  const before=s.meetingWrites.length;
  await sheet.locator('[data-area-tag-save]').click();await expect(sheet).toBeHidden();
  const writes=s.meetingWrites.slice(before);
  expect(writes).toHaveLength(1);expect(Object.keys(writes[0]).sort()).toEqual(['business_area_id','business_area_none','updated_at']);
  expect(writes[0]).toMatchObject({business_area_id:null,business_area_none:true});
  await expect(line).toBeHidden();
  await openMeetingResult(page,'m-1');
  await expect(page.locator('[data-biz-area-line]:visible')).toHaveText('사업영역 없음');
  await expect(page.locator('[data-biz-area-name]:visible')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// UI-창잘림·끌어옮기기: PC 1440·노트북 1024·폴드 펼침 884에서 [달기] 창은 화면 안(오른쪽·아래 침범 0), 고르기 칸·[저장]이 보인다.
// 제목 줄('∷ 사업영역 달기 · n건 …… ×')을 잡고 끌면 옮겨지고 화면 밖으로는 못 나간다. 닫았다 다시 열면 [달기] 버튼 옆으로.
for(const width of [1440,1024,884])test(`${width}: [달기] 창은 화면 안, 제목 줄로 끌어 옮기고 화면 밖으로 못 나감`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state();await open(page,s,width);
  const btn=page.locator('#areaUntaggedLine [data-area-untagged]');await btn.click();
  const sheet=page.locator('#reportAreaTagSheet');await expect(sheet).toBeVisible();await expect(sheet).toHaveClass(/home-choice-anchored/);
  const vw=await page.evaluate(()=>document.documentElement.clientWidth),vh=900;
  const inside=async()=>{const b=await sheet.boundingBox();expect(b.x).toBeGreaterThanOrEqual(0);expect(b.y).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(vw);expect(b.y+b.height).toBeLessThanOrEqual(vh);return b;};
  const first=await inside();expect(first.width).toBeGreaterThanOrEqual(Math.min(420,vw-16)-1);
  for(const el of [sheet.locator('[data-area-tag-select]').first(),sheet.locator('[data-area-tag-save]')]){const b=await el.boundingBox();expect(b.x+b.width).toBeLessThanOrEqual(first.x+first.width);expect(b.x+b.width).toBeLessThanOrEqual(vw);}
  // 제목 줄: 손잡이(∷)와 손 모양 커서.
  const head=sheet.locator('header');
  expect(await head.evaluate(el=>getComputedStyle(el).cursor)).toBe('grab');
  expect(await sheet.locator('h2').evaluate(el=>getComputedStyle(el,'::before').content)).toBe('"∷"');
  const h=await sheet.locator('h2').boundingBox(),sx=h.x+h.width/2,sy=h.y+h.height/2;
  const dx=first.x>200?-120:120,dy=first.y+first.height+100<vh?80:-80;
  await page.mouse.move(sx,sy);await page.mouse.down();await page.mouse.move(sx+dx,sy+dy,{steps:6});await page.mouse.up();
  const moved=await inside();expect(Math.round(moved.x-first.x)).toBe(dx);expect(Math.round(moved.y-first.y)).toBe(dy);
  await expect(sheet).toBeVisible();
  // 오른쪽 아래 끝까지 끌어도 화면 안에 멈춘다.
  await page.mouse.move(sx+dx,sy+dy);await page.mouse.down();await page.mouse.move(vw-2,vh-2,{steps:6});await page.mouse.up();
  const edge=await inside();expect(Math.round(edge.x+edge.width)).toBe(vw-8);expect(Math.round(edge.y+edge.height)).toBe(vh-8);
  // 닫으면 잊는다: 다시 열면 [달기] 버튼 옆.
  await sheet.locator('[data-sheet-close]').click();await expect(sheet).toBeHidden();
  await btn.click();await expect(sheet).toBeVisible();
  const again=await inside();expect(Math.round(again.x)).toBe(Math.round(first.x));expect(Math.round(again.y)).toBe(Math.round(first.y));
  expect(errors).toEqual([]);
});
