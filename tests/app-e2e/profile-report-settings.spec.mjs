import { appOrigin } from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';

// MULTI-노조사용자 ②-3(D5) → MULTI-다른담당자맞춤 ②·③: 내 프로필 '주간보고 일정 캘린더' 칸 하나(묶음·제외는 조직 보고 화면).
// 고정 페이지는 profile-workplaces-fixture.html(설정 대역 helpers/org-order-prefs.js = 운영자 값).
const url=`${appOrigin}/tests/app-e2e/profile-workplaces-fixture.html`;
async function openProfile(page){
  await page.goto(url);
  await page.click('#userBadge');
  await expect(page.locator('#profileView')).toBeVisible();
  await expect(page.locator('#psReportPanel [data-ps-report-summary]')).toBeVisible();
}

for(const [label,width] of [['폰 412',412],['PC 1440',1440]]){
  test(`${label}: 접힌 한 줄 → 펼치면 구글 캘린더 목록에서 선택해 저장, 묶음·뺄 조직 글자 칸은 없음`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await openProfile(page);
    const panel=page.locator('#psReportPanel');
    // 담당 사업장 칸 바로 뒤, 접힌 채 한 줄. 카드 이름 = 칸 이름(MULTI-다른담당자맞춤 ②·③).
    await expect(page.locator('#psWorkplacePanel + #psReportPanel')).toHaveCount(1);
    await expect(panel.locator('details')).not.toHaveAttribute('open','');
    await expect(panel.locator('summary h3')).toHaveText('주간보고 일정 캘린더');
    await expect(panel.locator('[data-ps-report-summary]')).toHaveText("'공공운수노조'");
    await panel.locator('summary').click();
    await expect(panel.locator('#psReportGroups,#psReportHidden,[data-ps-report-missing]')).toHaveCount(0);
    await expect(panel.locator('[data-ps-report-cal="list"]')).toContainText("주간보고 '주요 일정'에 넣을 일정이 있는 구글 캘린더");
    // 이름을 치지 않고 연결된 구글 캘린더 목록에서 고른다. 지금 값이 목록에 없으면 '(목록에 없음)'으로 남는다.
    await expect(panel.locator('#psReportCalendar')).toBeEnabled();
    await expect(panel.locator('#psReportCalendar')).toHaveValue('공공운수노조');
    await expect(panel.locator('#psReportCalendar option')).toHaveText(['선택 안 함','공공운수노조 (목록에 없음)','가상 공유 캘린더','다른 캘린더']);
    await expect(panel.locator('input#psReportCalendar')).toHaveCount(0);
    await panel.locator('#psReportCalendar').selectOption('가상 공유 캘린더');
    await panel.locator('[data-ps-report-save]').click();
    await expect(panel.locator('[data-ps-report-summary]')).toHaveText("'가상 공유 캘린더'");
    // 묶음 값(org_order)은 이 칸에서 건드리지 않는다.
    const prefs=await page.evaluate(()=>window.__orgOrderPrefs);
    expect(prefs.report_calendar).toBe('가상 공유 캘린더');expect(prefs.org_order.groups).toHaveLength(4);expect(prefs.org_order.hidden).toEqual(['궤도협의회']);
    await expect(panel.locator('#psReportCalendar')).toHaveValue('가상 공유 캘린더');
    await expect(panel.locator('#psReportCalendar option')).toHaveText(['선택 안 함','가상 공유 캘린더','다른 캘린더']);
  });
}

test('[선택 안 함]으로 저장하면 캘린더 설정을 지운다(미지정)',async({page})=>{
  await openProfile(page);
  const panel=page.locator('#psReportPanel');
  await panel.locator('summary').click();
  await expect(panel.locator('#psReportCalendar')).toBeEnabled();
  await panel.locator('#psReportCalendar').selectOption('');
  await panel.locator('[data-ps-report-save]').click();
  await expect(panel.locator('[data-ps-report-summary]')).toHaveText('미지정');
  expect(await page.evaluate(()=>'report_calendar' in window.__orgOrderPrefs)).toBe(false);
});

// MULTI-다른담당자맞춤 ③: 구글 캘린더 연결 전이면 선택 대신 연결 안내 한 줄과 [구글 캘린더 연결]. 저장해도 지금 값은 그대로.
for(const [label,width] of [['폰 412',412],['PC 1280',1280]])test(`${label}: 구글 캘린더 연결 전이면 연결 안내, 저장해도 캘린더 값은 그대로`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto(url);
  await page.evaluate(()=>{window.__state.calendarDisconnected=true;});
  await page.click('#userBadge');
  await expect(page.locator('#profileView')).toBeVisible();
  const panel=page.locator('#psReportPanel');
  await panel.locator('summary').click();
  const box=panel.locator('[data-ps-report-cal="unconnected"]');
  await expect(box).toContainText('구글 캘린더를 연결하면 여기서 선택할 수 있어요.');
  await expect(box).toContainText("지금: '공공운수노조'");
  await expect(box.getByRole('button',{name:'구글 캘린더 연결'})).toBeVisible();
  await expect(panel.locator('#psReportCalendar')).toHaveCount(0);
  await panel.locator('[data-ps-report-save]').click();
  await expect(panel.locator('[data-ps-report-summary]')).toHaveText("'공공운수노조'");
  expect(await page.evaluate(()=>window.__orgOrderPrefs.report_calendar)).toBe('공공운수노조');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
