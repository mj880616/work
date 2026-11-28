import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// HOME-업무일지홈(2026-10-30 명진 시안 v2 확정): 홈 = 업무일지. PC 1440·폴드 884(PC 틀)·폰 412에서
// 앱을 열면 오늘 업무일지, 위에서부터 날짜 줄 → 요약 한 줄 → 업데이트 입력줄 → [그날 일정 | 할 일] → 오늘 한 일 → 주간보고 재료(JOURNAL-그밖의기록삭제).
// PC(≥1200)는 그날 일정·할 일이 좌우, 폰은 위아래이고 입력줄은 하단 탭 위 고정. 시계 2026-10-06(화) 10:00 KST(openHome).
// FOLD-넓은화면 ④(S57-16): 폴드 펼침(600~1199, 884)은 5:5 두 단 — 왼쪽 [그날 일정 → 할 일], 오른쪽 [오늘 한 일 → 재료], 다가오는 일은 두 단 폭 전체 한 줄(home-fold-two-cols.spec.mjs가 폭별로 자세히 본다).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const box = (page, sel) => page.locator(sel).first().evaluate(el => { const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right}; });

for (const [width, mode] of [[1440, 'pc'], [884, 'fold'], [412, 'phone']]) {
  const phone = mode === 'phone';
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
    // 순서: 날짜 줄 → [하루] 카드(두 칸) → 오늘 한 일 → 재료. QUICK-입력정리(2026-11-28): 입력 막대·잊지 말기 칩은 없다.
    await expect(page.locator('#homeView .home-quick,#homeView [data-home-summary]')).toHaveCount(0);
    const head = await box(page, '#homeView .journal-head');
    // 폴드 두 단에서는 일정 칸(section)이 display:contents라 상자가 없어, 그 안 머리·목록 묶음을 잰다.
    const sched = await box(page, mode === 'fold' ? '#homeView .journal-schedule-body' : '#homeView [data-journal-schedule]');
    const day = await box(page, '#homeView [data-journal-day]');
    const tasks = await box(page, '#homeView [data-journal-tasks]');
    const done = await box(page, '#homeView [data-journal-done-day]');
    const mats = await box(page, '#homeView [data-journal-materials]');
    expect(day.y).toBeGreaterThanOrEqual(head.bottom - 1);
    if (phone) {
      // 폰: 그날 일정 위에 할 일.
      expect(tasks.y).toBeGreaterThanOrEqual(sched.bottom - 1);
      expect(Math.abs(tasks.x - sched.x)).toBeLessThanOrEqual(1);
    } else if (mode === 'fold') {
      // 폴드 펼침: 두 단(5:5). 왼쪽은 일정 위·할 일 아래(같은 x), 오른쪽 오늘 한 일은 일정과 같은 줄에서 시작, 재료는 오늘 한 일 아래. 다가오는 일은 두 단 폭 전체.
      const dday = await box(page, '#homeView [data-journal-dday]');
      expect(dday.y).toBeGreaterThanOrEqual(day.y - 1); expect(dday.bottom).toBeLessThanOrEqual(sched.y + 1);
      expect(dday.w).toBeGreaterThan(done.right - sched.x - 2);
      expect(Math.abs(tasks.x - sched.x)).toBeLessThanOrEqual(1); expect(tasks.y).toBeGreaterThanOrEqual(sched.bottom - 1);
      expect(done.x).toBeGreaterThanOrEqual(sched.right - 1); expect(Math.abs(done.y - sched.y)).toBeLessThanOrEqual(2);
      expect(Math.abs(sched.w - done.w)).toBeLessThanOrEqual(40);
      expect(mats.y).toBeGreaterThanOrEqual(done.bottom - 1); expect(Math.abs(mats.x - done.x)).toBeLessThanOrEqual(1);
    } else {
      // PC: 좌우 두 칸, 같은 줄에서 시작.
      expect(Math.abs(tasks.y - sched.y)).toBeLessThanOrEqual(2);
      expect(tasks.x).toBeGreaterThanOrEqual(sched.right - 1);
    }
    if (mode !== 'fold') {
      expect(done.y).toBeGreaterThanOrEqual(Math.max(sched.bottom, tasks.bottom) - 1);
      expect(mats.y).toBeGreaterThanOrEqual(done.bottom - 1);
    }
    await expect(page.locator('#journalDoneTitle')).toHaveText('오늘 한 일');
    // 그날 일정 칸: 개수·달력 › · D-day 칩(오늘만). 할 일 칸: 개수·할 일 ›.
    await expect(page.locator('#homeView [data-journal-schedule] [data-journal-calendar]')).toHaveText('달력 ›');
    await expect(page.locator('#homeView [data-journal-tasks] [data-journal-tasks-open]')).toHaveText('할 일 ›');
    await expect(page.locator('#homeView [data-journal-dday] .journal-dday-chip')).toHaveText(['D-1 주요 일정']);
    // 주간보고 재료는 펼쳐 있고, 그 밖의 기록은 없다(JOURNAL-그밖의기록삭제).
    await expect(page.locator('#homeView [data-journal-report]')).toBeVisible();
    await expect(page.locator('#homeView [data-journal-others]')).toHaveCount(0);
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
    await expect(page.locator('#calendarView .schedule-switch button')).toHaveText(['달력', '할 일', '하루 기록']);
  } else {
    await expect(page.locator('#appView .sidebar-brand')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#appView .nav-sub[aria-label="일정"] .nav-sub-btn')).toHaveText(['달력', '할 일', '하루 기록']);
  }
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
