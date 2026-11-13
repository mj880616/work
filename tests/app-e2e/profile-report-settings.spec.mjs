import { appOrigin } from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';

// MULTI-노조사용자 ②-3(D5, S50-13): 내 프로필 › 보고 설정 — 담당조직 묶음·순서, 고르기에서 뺄 조직, 보고 캘린더 이름.
// 고정 페이지는 profile-workplaces-fixture.html(설정 대역 helpers/org-order-prefs.js = 운영자 값).
const url=`${appOrigin}/tests/app-e2e/profile-workplaces-fixture.html`;
async function openProfile(page){
  await page.goto(url);
  await page.click('#userBadge');
  await expect(page.locator('#profileView')).toBeVisible();
  await expect(page.locator('#psReportPanel [data-ps-report-summary]')).toBeVisible();
}

for(const [label,width] of [['폰 412',412],['PC 1440',1440]]){
  test(`${label}: 접힌 한 줄 요약 → 펼치면 지금 값, 수정해 저장하면 요약·담당 사업장 묶음이 바로 바뀐다`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await openProfile(page);
    const panel=page.locator('#psReportPanel');
    // 담당 사업장 칸 바로 뒤, 접힌 채 한 줄.
    await expect(page.locator('#psWorkplacePanel + #psReportPanel')).toHaveCount(1);
    await expect(panel.locator('details')).not.toHaveAttribute('open','');
    await expect(panel.locator('[data-ps-report-summary]')).toHaveText("담당조직 묶음 4개 · 주간보고 일정 캘린더 '공공운수노조'");
    await panel.locator('summary').click();
    // MULTI-다른담당자맞춤 ③: 이름을 치지 않고 연결된 구글 캘린더 목록에서 선택한다. 지금 값이 목록에 없으면 '(목록에 없음)'으로 남는다.
    await expect(panel.locator('[data-ps-report-cal="list"]')).toContainText("주간보고 '주요 일정'에 넣을 일정이 있는 구글 캘린더");
    await expect(panel.locator('#psReportCalendar')).toBeEnabled();
    await expect(panel.locator('#psReportCalendar')).toHaveValue('공공운수노조');
    await expect(panel.locator('#psReportCalendar option')).toHaveText(['선택 안 함','공공운수노조 (목록에 없음)','가상 공유 캘린더','다른 캘린더']);
    await expect(panel.locator('input#psReportCalendar')).toHaveCount(0);
    await expect(panel.locator('#psReportGroups')).toHaveValue(/^철도: 전국철도노동조합\n지하철: 서울교통공사노동조합, /);
    await expect(panel.locator('#psReportHidden')).toHaveValue('궤도협의회');
    // 내 조직 목록에 없는 이름은 한 줄로 알린다(이름이 정확히 같아야 묶음에 든다).
    await expect(panel.locator('[data-ps-report-missing]')).toContainText('내 담당조직 목록에 없는 이름');
    // 고쳐 저장: 묶음 하나 + 보고 캘린더 다른 이름.
    await panel.locator('#psReportGroups').fill('가짜묶음: 한국가스공사노조, 서울교통공사노동조합');
    await panel.locator('#psReportHidden').fill('');
    await panel.locator('#psReportCalendar').selectOption('가상 공유 캘린더');
    await panel.locator('[data-ps-report-save]').click();
    await expect(panel.locator('[data-ps-report-summary]')).toHaveText("담당조직 묶음 1개 · 주간보고 일정 캘린더 '가상 공유 캘린더'");
    expect(await page.evaluate(()=>window.__orgOrderPrefs)).toEqual({org_order:{groups:[{name:'가짜묶음',orgs:['한국가스공사노조','서울교통공사노동조합']}],hidden:[]},report_calendar:'가상 공유 캘린더'});
    // 저장 뒤에도 고른 값 그대로, 목록에 없던 옛 값은 사라진다.
    await expect(panel.locator('#psReportCalendar')).toHaveValue('가상 공유 캘린더');
    await expect(panel.locator('#psReportCalendar option')).toHaveText(['선택 안 함','가상 공유 캘린더','다른 캘린더']);
    expect(await page.evaluate(()=>window.__state.reloads)).toBeGreaterThan(0);
    // 같은 순서를 쓰는 담당 사업장 '그 외' 목록: 새 묶음 이름이 보이고 그 순서대로.
    await page.locator('#psWorkplaceList summary').first().click();
    const others=page.locator('#psWorkplaceList .pick-others');
    if(!(await others.evaluate(el=>el.open).catch(()=>true)))await others.locator('summary').first().click();
    await expect(page.locator('#psWorkplaceList .pick-others .pick-group-name')).toHaveText(['가짜묶음']);
    await expect(page.locator('#psWorkplaceList .pick-others .ps-org-name')).toHaveText(['한국가스공사노조','서울교통공사노동조합','전국철도노동조합']);
  });
}

test('모두 비우면 설정을 삭제한다(묶음 없이 가나다순·보고 캘린더 미지정), 틀린 줄은 저장하지 않고 한 줄로 알린다',async({page})=>{
  await openProfile(page);
  const panel=page.locator('#psReportPanel');
  await panel.locator('summary').click();
  // 목록이 오기 전에 쓰기 시작해도 쓴 글은 지워지지 않는다(캘린더 칸만 다시 그림).
  await panel.locator('#psReportGroups').fill('쌍점 없는 줄');
  await expect(panel.locator('#psReportCalendar')).toBeEnabled();
  await expect(panel.locator('#psReportGroups')).toHaveValue('쌍점 없는 줄');
  await panel.locator('[data-ps-report-save]').click();
  await expect(panel.locator('.ps-report-note[role=status]')).toContainText("'묶음 이름: 조직, 조직' 모양");
  expect(await page.evaluate(()=>window.__orgOrderPrefs.org_order.groups.length)).toBe(4);
  await panel.locator('#psReportGroups').fill('');
  await panel.locator('#psReportHidden').fill('');
  await panel.locator('#psReportCalendar').selectOption('');
  await panel.locator('[data-ps-report-save]').click();
  await expect(panel.locator('[data-ps-report-summary]')).toHaveText('담당조직 묶음 없음(가나다순) · 주간보고 일정 캘린더 미지정');
  expect(await page.evaluate(()=>window.__orgOrderPrefs)).toEqual({});
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
  await expect(panel.locator('[data-ps-report-summary]')).toContainText("주간보고 일정 캘린더 '공공운수노조'");
  expect(await page.evaluate(()=>window.__orgOrderPrefs.report_calendar)).toBe('공공운수노조');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
