// S54-34 ② BIZ-기간정하기 + BIZ-주차고르기(요청함 11/09 07:53~07:58, 시안 docs/design/mockups/period-picker.html·week-number-picker.html).
// - 기간 메뉴 = 이번 주 · 주차 선택 · 전체 기간 · 기간 정하기.
// - [기간 정하기]: 고르기 상자 바로 아래 작은 창 하나 — ① 칩 한 줄(이번 주·이번 달·지난 달·최근 3달·전체, 누르면 날짜를 채움) ② 시작~끝 날짜 칸 반씩(잘리지 않음, '시작'·'끝' 글자 칸 없음) ③ 오른쪽 [닫기][적용].
// - [주차 선택]: [2026년 ▾] [46주차 (11.09~11.15) · 이번 주 ▾] + [닫기][적용]. 국제 표준 주차(월~일). 고른 뒤 '‹ n주차 · 11.9(월)~11.15(일) ›', 상자 글자 'n주차'.
// 서버는 가짜, 이름·글은 모두 합성 값. 시계 2026-11-09(월) 09:30(서울).
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {installBusinessNowServer} from './helpers/business-now-server.mjs';
import {reportPeriodSelect} from './helpers/report-week.mjs';

test.use({timezoneId:'Asia/Seoul'});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',NOW='2026-11-09T00:30:00Z';

async function open(page,width){
  const s=baseState();
  const row=(id,title,at)=>({id,workspace_id:s.workspace.id,title,series_name:title,round_no:1,meeting_at:at,transcript_text:'합성 결과 글',activity_kind:'meeting',business_area_id:'child-a1',next_plan:'',created_by:s.user.id,created_at:at,updated_at:at,notes:'',decisions:''});
  s.meetings=[row('m-oct','합성 10월 간담회','2026-10-14T01:00:00Z'),row('m-jan','합성 1월 간담회','2025-01-07T01:00:00Z'),row('m-now','합성 이번 주 간담회','2026-11-10T01:00:00Z')];
  await page.setViewportSize({width,height:900});
  await page.clock.setFixedTime(new Date(NOW));
  await mockApp(page,s);
  await page.route(`${SB}/rest/v1/app_weekly_exec_requests**`,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await installBusinessNowServer(page,{});
  await signIn(page,testOrigin+'/app/?view=reports');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#meetingsView #bizWeekBox')).toBeVisible();
}
const nav=page=>page.locator('#reportWeekFilter .report-week-nav');
const label=page=>page.locator('#reportWeekFilter .report-week-label');
const box=el=>el.boundingBox();

for(const width of [390,884,1280])test(`${width}: 기간 정하기 — 칩 한 줄·날짜 두 칸 반씩·[닫기][적용] 세 줄, 칩은 날짜를 채우고 [적용]으로 정함`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await open(page,width);
  const pick=reportPeriodSelect(page);
  await expect(pick.locator('option:not([hidden])')).toHaveText(['이번 주','주차 선택','전체 기간','기간 정하기']);
  await pick.selectOption('range');
  const panel=page.locator('[data-report-period-panel="range"]');
  await expect(panel).toBeVisible();
  // 고르기 상자 바로 아래, 주 줄 위.
  const pb=await box(panel),sb=await box(pick),nb=await box(nav(page));
  expect(pb.y).toBeGreaterThanOrEqual(sb.y+sb.height-1);expect(pb.y+pb.height).toBeLessThanOrEqual(nb.y+1);
  if(width<761)expect(pb.width).toBeGreaterThan(width-60); else expect(pb.width).toBeLessThanOrEqual(421);
  // ① 칩 한 줄
  const chips=panel.locator('[data-report-quick]');
  await expect(chips).toHaveText(['이번 주','이번 달','지난 달','최근 3달','전체']);
  const chipTops=await chips.evaluateAll(els=>els.map(e=>Math.round(e.getBoundingClientRect().top)));
  expect(Math.max(...chipTops)-Math.min(...chipTops)).toBeLessThanOrEqual(1);
  // ② 날짜 두 칸 반씩, '시작'·'끝' 글자 칸 없음, 공용 날짜 칸(date-field)
  await expect(panel.locator('label')).toHaveCount(0);
  const fields=panel.locator('.report-period-dates .date-field');
  await expect(fields).toHaveCount(2);
  const [f1,f2]=[await box(fields.nth(0)),await box(fields.nth(1))];
  expect(Math.abs(f1.width-f2.width)).toBeLessThanOrEqual(2);expect(Math.abs(f1.y-f2.y)).toBeLessThanOrEqual(1);
  expect(f1.width).toBeGreaterThan(110); // '10.31 (토)'가 잘리지 않는 폭
  // ③ [닫기][적용] 오른쪽 나란히, 작은 버튼 같은 높이
  const close=panel.locator('[data-report-week="cancel"]'),apply=panel.locator('[data-report-week="apply"]');
  const [cb,ab]=[await box(close),await box(apply)];
  expect(cb.x).toBeLessThan(ab.x);expect(Math.abs(cb.y-ab.y)).toBeLessThanOrEqual(1);expect(Math.abs(cb.height-ab.height)).toBeLessThanOrEqual(1);expect(ab.height).toBeLessThanOrEqual(36);
  expect(pb.x+pb.width-(ab.x+ab.width)).toBeLessThanOrEqual(12);
  expect(Math.max(...chipTops)).toBeLessThan(f1.y);expect(f1.y+f1.height).toBeLessThanOrEqual(ab.y);
  // 칩은 날짜만 채운다(아직 정하지 않음).
  await chips.filter({hasText:'지난 달'}).click();
  await expect(panel.locator('[data-report-from]')).toHaveValue('2026-10-01');await expect(panel.locator('[data-report-to]')).toHaveValue('2026-10-31');
  await expect(panel.locator('[data-report-quick="last-month"]')).toHaveAttribute('aria-pressed','true');
  await expect(fields.nth(1)).toHaveAttribute('data-date-text',/10\.31/);
  await expect(panel).toBeVisible();
  await apply.click();
  await expect(panel).toHaveCount(0);
  await expect(label(page)).toHaveText('10.1~10.31');
  await expect(pick.locator('option:checked')).toHaveText('정한 기간');
  // [전체] 칩 그대로 [적용]하면 전체 기간.
  await pick.selectOption('range');
  await page.locator('[data-report-period-panel] [data-report-quick="all"]').click();
  await expect(page.locator('[data-report-period-panel] [data-report-from]')).toHaveValue('2025-01-07');
  await page.locator('[data-report-period-panel] [data-report-week="apply"]').click();
  await expect(pick).toHaveValue('all');await expect(label(page)).toHaveText('전체');
  // [닫기]는 아무것도 바꾸지 않고 닫는다.
  await pick.selectOption('range');
  await page.locator('[data-report-period-panel] [data-report-week="cancel"]').click();
  await expect(page.locator('[data-report-period-panel]')).toHaveCount(0);await expect(label(page)).toHaveText('전체');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=1)).toBe(true);
  expect(errors).toEqual([]);
});

for(const width of [390,884,1280])test(`${width}: 주차 선택 — 연도·주차 드롭다운, 오늘은 46주차, 고른 주로 가고 ‹ ›로 번호도 같이`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await open(page,width);
  const pick=reportPeriodSelect(page);
  await pick.selectOption('isoweek');
  const panel=page.locator('[data-report-period-panel="isoweek"]');
  await expect(panel).toBeVisible();
  const year=panel.locator('[data-report-iso-year]'),week=panel.locator('[data-report-iso-week]');
  await expect(year).toHaveValue('2026');await expect(week).toHaveValue('46');
  await expect(week.locator('option:checked')).toHaveText('46주차 (11.09~11.15) · 이번 주');
  await expect(year.locator('option')).toHaveText(['2027년','2026년','2025년']);
  await expect(week.locator('option')).toHaveCount(53);
  await expect(week.locator('option').first()).toHaveText('53주차 (12.28~01.03)');
  const [yb,wb]=[await box(year),await box(week)];
  expect(Math.abs(yb.y-wb.y)).toBeLessThanOrEqual(1);expect(yb.x).toBeLessThan(wb.x);
  // 연도를 바꾸면 그 해 주차 목록(같은 번호), 1주차 = 그 해 첫 목요일이 든 주.
  await year.selectOption('2025');
  await expect(panel.locator('[data-report-iso-week] option')).toHaveCount(52);
  await expect(panel.locator('[data-report-iso-week]')).toHaveValue('46');
  await panel.locator('[data-report-iso-week]').selectOption('1');
  await expect(panel.locator('[data-report-iso-week] option:checked')).toHaveText('1주차 (12.30~01.05)');
  await panel.locator('[data-report-week="iso-apply"]').click();
  await expect(panel).toHaveCount(0);
  await expect(label(page)).toHaveText('1주차 · 12.30(월)~1.5(일)');
  await expect(pick.locator('option:checked')).toHaveText('1주차');
  await expect(nav(page).locator('.report-week-count')).toHaveText('· 0건');
  // ‹ ›로 한 주씩, 번호도 같이.
  await page.locator('#reportWeekFilter [data-report-week="next"]').click();
  await expect(label(page)).toHaveText('2주차 · 1.6(월)~1.12(일)');await expect(pick.locator('option:checked')).toHaveText('2주차');
  await expect(nav(page).locator('.report-week-count')).toHaveText('· 1건');
  // 이번 해로 돌아가 45주차: 이번 주 주간보고 칸도 그 주를 따른다.
  await pick.selectOption('isoweek');
  await page.locator('[data-report-period-panel] [data-report-iso-year]').selectOption('2026');
  await expect(page.locator('[data-report-period-panel] [data-report-iso-week]')).toHaveValue('46');
  await page.locator('[data-report-period-panel] [data-report-iso-week]').selectOption('45');
  await page.locator('[data-report-period-panel] [data-report-week="iso-apply"]').click();
  await expect(label(page)).toHaveText('45주차 · 11.2(월)~11.8(일)');
  await expect(page.locator('#bizWeekBox .biz-week-title')).toHaveText('11.2~11.8 주간보고');
  // [이번 주]를 고르면 번호 없이 이번 주.
  await pick.selectOption('week');
  await expect(label(page)).toHaveText('11.9(월)~11.15(일)');await expect(pick).toHaveValue('week');
  // [닫기]는 그대로.
  await pick.selectOption('isoweek');
  await page.locator('[data-report-period-panel] [data-report-week="cancel"]').click();
  await expect(page.locator('[data-report-period-panel]')).toHaveCount(0);await expect(label(page)).toHaveText('11.9(월)~11.15(일)');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=1)).toBe(true);
  expect(errors).toEqual([]);
  if(process.env.SHOT_DIR){await pick.selectOption('isoweek');await page.screenshot({path:`${process.env.SHOT_DIR}/week-number-${width}.png`})}
});
