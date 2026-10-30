import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// HOME-업무일지홈(2026-10-30 명진 시안 v2 확정): 홈 = 업무일지. PC 1440·폴드 884(PC 틀)·폰 412에서
// 앱을 열면 오늘 업무일지, 위에서부터 날짜 줄 → 요약 한 줄 → 업데이트 입력줄 → [그날 일정 | 할 일] → 오늘 한 일 → 주간보고 재료·그 밖의 기록.
// PC 틀(≥761)은 그날 일정·할 일이 좌우, 폰은 위아래이고 입력줄은 하단 탭 위 고정. 시계 2026-10-06(화) 10:00 KST(openHome).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const box = (page, sel) => page.locator(sel).first().evaluate(el => { const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right}; });

for (const [width, phone] of [[1440, false], [884, false], [412, true]]) {
  test(`home is today's work journal in the confirmed order (${width})`, async ({page}, info) => {
    await page.setViewportSize({width, height: 1000});
    await openHome(page);
    await expect(page.locator('#homeView')).toBeVisible();
    await expect(page.locator('#homeView #journalRoot')).toBeVisible();
    expect(await page.evaluate(() => window.KPTURouter.current)).toBe('home');
    expect(new URL(page.url()).searchParams.get('view')).toBeNull();
    // 날짜 줄: 제목은 오늘, 오늘 칸이 고른 날이고 공용 '오늘' 표시.
    await expect(page.locator('#homeView [data-journal-title]')).toHaveText('10월 6일 화요일');
    const today = page.locator('#homeView [data-journal-date="2026-10-06"]');
    await expect(today).toHaveAttribute('aria-current', 'date');
    await expect(today).toHaveAttribute('aria-pressed', 'true');
    await expect(today).toHaveClass(/ds-today/);
    await expect(page.locator('#homeView [data-journal-days] [data-journal-date]')).toHaveCount(7);
    await expect(page.locator('#homeView [data-journal-today]')).toHaveText('이번 주');
    // 순서: 날짜 줄 → 요약 → (PC) 입력줄 → 두 칸 → 오늘 한 일 → 재료.
    const head = await box(page, '#homeView .journal-head');
    const summary = await box(page, '#homeView [data-home-summary]');
    const quick = await box(page, '#homeView .home-quick[data-home-quick]');
    const sched = await box(page, '#homeView [data-journal-schedule]');
    const tasks = await box(page, '#homeView [data-journal-tasks]');
    const done = await box(page, '#homeView [data-journal-done-day]');
    const mats = await box(page, '#homeView [data-journal-materials]');
    expect(summary.y).toBeGreaterThanOrEqual(head.bottom - 1);
    if (phone) {
      // 폰: 입력줄은 화면 아래(하단 탭 위)에 붙고, 그날 일정 위에 할 일.
      const tabs = await box(page, '.mobile-tabs');
      expect(Math.abs(quick.bottom - tabs.y)).toBeLessThanOrEqual(2);
      expect(await page.locator('#homeView .home-quick[data-home-quick]').evaluate(el => getComputedStyle(el).position)).toBe('fixed');
      expect(tasks.y).toBeGreaterThanOrEqual(sched.bottom - 1);
      expect(Math.abs(tasks.x - sched.x)).toBeLessThanOrEqual(1);
    } else {
      expect(quick.y).toBeGreaterThanOrEqual(summary.bottom - 1);
      expect(sched.y).toBeGreaterThanOrEqual(quick.bottom - 1);
      // PC 틀: 좌우 두 칸, 같은 줄에서 시작.
      expect(Math.abs(tasks.y - sched.y)).toBeLessThanOrEqual(2);
      expect(tasks.x).toBeGreaterThanOrEqual(sched.right - 1);
    }
    expect(done.y).toBeGreaterThanOrEqual(Math.max(sched.bottom, tasks.bottom) - 1);
    expect(mats.y).toBeGreaterThanOrEqual(done.bottom - 1);
    await expect(page.locator('#journalDoneTitle')).toHaveText('오늘 한 일');
    // 그날 일정 칸: 개수·달력 › · D-day 칩(오늘만). 할 일 칸: 개수·할 일 ›.
    await expect(page.locator('#homeView [data-journal-schedule] [data-journal-calendar]')).toHaveText('달력 ›');
    await expect(page.locator('#homeView [data-journal-tasks] [data-journal-tasks-open]')).toHaveText('할 일 ›');
    await expect(page.locator('#homeView [data-journal-dday] .journal-dday-chip')).toHaveText(['D-1 주요 일정']);
    // 주간보고 재료는 펼쳐 있고, 그 밖의 기록은 접힌 한 줄.
    await expect(page.locator('#homeView [data-journal-report]')).toBeVisible();
    await expect(page.locator('#homeView details[data-journal-others]')).not.toHaveAttribute('open', '');
    // 옛 홈 칸·옛 챙길 것 상자는 없다.
    await expect(page.locator('[data-home-card],[data-home-cards],[data-journal-radar],#journalView')).toHaveCount(0);
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({path: info.outputPath(`home-journal-${width}.png`), fullPage: true});
  });
}

for (const width of [1440, 412]) test(`the [일정] menu has no 업무일지 line; 홈 menu is current (${width})`, async ({page}) => {
  await page.setViewportSize({width, height: 900});
  await openHome(page);
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('#appView .nav-sub-btn', {hasText: '업무일지'})).toHaveCount(0);
  await expect(page.locator('.schedule-switch button', {hasText: '업무일지'})).toHaveCount(0);
  await expect(page.locator('[data-view="journal"]')).toHaveCount(0);
  if (width < 761) {
    await expect(page.locator('.mobile-tabs [data-view="home"]')).toHaveAttribute('aria-current', 'page');
    await page.locator('.mobile-tabs [data-mobile-schedule-tab]').click();
    await expect(page.locator('#calendarView')).toBeVisible();
    await expect(page.locator('#calendarView .schedule-switch button')).toHaveText(['달력', '할 일', '일기']);
  } else {
    await expect(page.locator('#appView .sidebar-brand')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#appView .nav-sub[aria-label="일정"] .nav-sub-btn')).toHaveText(['달력', '할 일', '일기']);
  }
});

test('the update input saves an update from the home', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  const posts = [];
  await openHome(page, {beforeLoad: () => page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', route => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    const body = req.postDataJSON(); posts.push(body);
    return route.fulfill({status: 201, json: [{id: 'n-home-1', workspace_id: 'w', kind: 'basket', raw_text: body.raw_text, created_at: '2026-10-06T01:00:00Z', updated_at: '2026-10-06T01:00:00Z', attachments: []}]});
  })});
  const quick = page.locator('#homeView .home-quick[data-home-quick]');
  await expect(quick).toBeVisible();
  await expect(quick.locator('[data-quick-mode="update"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(quick.locator('[data-quick-mode]')).toHaveText(['업데이트', '할 일']);
  await quick.locator('[data-quick-input]').fill('홈에서 쓴 업데이트');
  await quick.locator('[data-quick-save]').click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({workspace_id: 'w', raw_text: '홈에서 쓴 업데이트'});
  await expect(quick.locator('[data-quick-input]')).toHaveValue('');
  await expect(page.locator('#toast')).toContainText('정리함에 저장했습니다.');
});

test('old addresses, reload and back all land on the new home (day kept in the address)', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await openHome(page, {query: '?view=journal&day=2026-10-07'});
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('#homeView [data-journal-title]')).toHaveText('10월 7일 수요일');
  await expect.poll(() => new URL(page.url()).searchParams.get('day')).toBe('2026-10-07');
  // 새로고침해도 그 날.
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, {timeout: 20000});
  await expect(page.locator('#homeView [data-journal-title]')).toHaveText('10월 7일 수요일');
  // 다른 화면으로 갔다가 뒤로 가기 → 보던 날 그대로.
  await page.locator('#appView .nav-btn[data-view="basket"]').click();
  await expect(page.locator('#basketView')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('#homeView [data-journal-title]')).toHaveText('10월 7일 수요일');
  // 로고(브랜드)를 누르면 오늘.
  await page.locator('#appView [data-core-brand]').click();
  await expect(page.locator('#homeView [data-journal-title]')).toHaveText('10월 6일 화요일');
  expect(new URL(page.url()).searchParams.get('day')).toBeNull();
  // 옛 ?view=home도 홈.
  await page.goto(page.url().replace(/\?.*$/, '') + '?view=home');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, {timeout: 20000});
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('#homeView [data-journal-title]')).toHaveText('10월 6일 화요일');
});
