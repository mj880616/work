import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// HOME-업무일지홈(2026-10-30 명진 시안 v2 확정): 업무일지 화면이 홈이다. PC 1440·폴드 884·폰 412에서
// ① 앱을 열면 새 홈(오늘 업무일지) ② 입력줄로 업데이트 저장 ③ [일정] 아래·폰 전환 줄에 업무일지 없음 ④ 옛 주소(?view=journal·?view=home)
// ⑤ 뒤로 가기·새로고침 제자리 ⑥ 마지막 수집 시각·AI 사용량은 내 프로필 ⑦ '사업 보고 후속' 칸 없음 ⑧ 할 일 줄 기한은 작은 진회색, 연결된 사업 보고 이름은 흐린 글씨.
// 시계는 2026-10-06 10:00 KST(화, home-entry.mjs). 가짜 서버·합성 자료만 쓴다.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const WIDTHS = [[1440, 900], [884, 1104], [412, 915]];
const root = page => page.locator('#journalRoot');
const date = (page, day) => root(page).locator(`[data-journal-date="${day}"]`);
const view = page => page.evaluate(() => window.KPTURouter.current);

async function boot(page, width, height, {query = ''} = {}) {
  await page.setViewportSize({width, height});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const notes = [];
  const beforeLoad = async () => {
    // 업데이트 저장(정리함 미분류 = app_notes POST). 읽기는 기본 가짜 서버로.
    await page.route(SB + '/rest/v1/app_notes**', async r => {
      const req = r.request();
      if (req.method() !== 'POST') return r.fallback();
      const body = req.postDataJSON(), at = '2026-10-06T01:00:00Z';
      const row = {id: 'home-note-' + (notes.length + 1), kind: 'basket', title: null, journal_day: null, occurred_at: at, created_at: at, updated_at: at, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {}, ...body};
      notes.push(row);
      return r.fulfill({status: 201, json: [row]});
    });
    // 오늘 기한 할 일(today)에 사업 보고(m) 연결: 할 일 줄 끝 흐린 이름.
    await page.route(SB + '/rest/v1/app_record_links**', r => {
      const q = new URL(r.request().url()).searchParams;
      if (q.has('google_task_id') && q.get('meeting_id') === 'not.is.null') return r.fulfill({json: [{google_task_id: 'today', meeting_id: 'm'}]});
      return r.fallback();
    });
  };
  const f = await openHome(page, {query, beforeLoad});
  return {...f, errors, notes};
}

for (const [width, height] of WIDTHS) {
  test(`${width}: 앱을 열면 오늘 업무일지가 홈, 입력줄로 업데이트 저장, [일정]에 업무일지 없음, 사업 보고 후속 칸 없음`, async ({ page }) => {
    const f = await boot(page, width, height);
    // ① 새 홈 = 업무일지, 오늘.
    await expect(page.locator('#homeView')).toBeVisible();
    await expect(page.locator('#journalView')).toHaveCount(0);
    expect(await view(page)).toBe('home');
    await expect(page).not.toHaveURL(/[?&](view|day)=/);
    await expect(root(page).locator('[data-journal-title]')).toHaveText('10월 6일 화요일');
    await expect(date(page, '2026-10-06')).toHaveAttribute('aria-current', 'date');
    await expect(date(page, '2026-10-06')).toHaveAttribute('aria-pressed', 'true');
    await expect(root(page).locator('[data-journal-mode="day"]')).toHaveAttribute('aria-pressed', 'true');
    // 순서: 날짜 줄 → 요약 → 입력줄 → [그날 일정 | 할 일] → 오늘 한 일 → 주간보고 재료·그 밖의 기록.
    const order = await page.evaluate(() => ['[data-journal-days]', '[data-home-summary]', '[data-home-quick]', '[data-journal-top-cols]', '[data-journal-done-day]', '[data-journal-materials]']
      .map(sel => { const all = [...document.querySelectorAll('#journalRoot *')]; return all.indexOf(document.querySelector('#journalRoot ' + sel)); }));
    expect(order.every(i => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    await expect(root(page).locator('[data-journal-tasks-open]')).toHaveText('할 일 ›');
    await expect(root(page).locator('[data-journal-radar]')).toHaveCount(0);
    // ⑦ 옛 홈 '사업 보고 후속' 칸·파란 꼬리표 없음.
    await expect(page.locator('#homeView')).not.toContainText('사업 보고 후속');
    await expect(page.locator('#homeView [data-home-card]')).toHaveCount(0);
    // ⑧ 할 일 줄: 기한 '오늘'은 작은 진회색(--kptu-muted, 노란색 아님), 연결된 사업 보고 이름은 흐린 글씨(--kptu-faint).
    const todo = root(page).locator('[data-journal-group="todo"] li[data-journal-task="today"]');
    await expect(todo.locator('[data-journal-task-due]')).toHaveText('오늘');
    await expect(todo.locator('[data-journal-task-due]')).toHaveClass(/task-due-text/);
    await expect(todo.locator('[data-journal-task-meeting]')).toHaveText('테스트 회의');
    const colors = await todo.evaluate(li => {
      const probe = v => { const e = document.createElement('span'); e.style.color = `var(${v})`; li.append(e); const c = getComputedStyle(e).color; e.remove(); return c; };
      return {due: getComputedStyle(li.querySelector('[data-journal-task-due]')).color, meeting: getComputedStyle(li.querySelector('[data-journal-task-meeting]')).color,
        muted: probe('--kptu-muted'), faint: probe('--kptu-faint'), warning: probe('--kptu-warning'), ink: probe('--kptu-ink')};
    });
    expect(colors.due).toBe(colors.muted);expect(colors.due).not.toBe(colors.warning);expect(colors.due).not.toBe(colors.ink);
    expect(colors.meeting).toBe(colors.faint);
    // 기한 지난 것(10/3)은 접힌 줄 안에 '지남 10.3'.
    const overdue = root(page).locator('[data-journal-overdue]');
    await overdue.locator(':scope > summary').click();
    await expect(overdue.locator('li[data-journal-task="overdue"] [data-journal-task-due]')).toHaveText('지남 10.3');
    // ③ [일정] 아래(PC)·폰 전환 줄에 업무일지가 없다.
    await expect(page.locator('[data-view="journal"]')).toHaveCount(0);
    if (width > 760) await expect(page.locator('.app-nav .nav-sub[aria-label="일정"] .nav-sub-btn')).toHaveText(['달력', '할 일', '일기']);
    else {
      await page.locator('.mobile-tabs [data-mobile-schedule-tab]').click();
      await expect(page.locator('#calendarView .schedule-switch').getByRole('button')).toHaveText(['달력', '할 일', '일기']);
      await page.locator('.mobile-tabs [data-view="home"]').click();
      await expect(page.locator('#homeView')).toBeVisible();
      await expect(page.locator('.mobile-tabs [data-view="home"]')).toHaveAttribute('aria-current', 'page');
    }
    // ② 업데이트 입력줄([업데이트 ▾ | 할 일])로 저장 → 정리함 미분류(app_notes POST 한 번).
    const quick = page.locator('#homeView [data-home-quick]');
    await expect(quick.locator('.home-quick-modes button[data-quick-mode]')).toHaveText(['업데이트', '할 일']);
    await quick.locator('[data-quick-mode="update"]').click();
    await quick.locator('[data-quick-input]').fill('합성 홈 업데이트');
    await quick.locator('[data-quick-save]').click();
    await expect.poll(() => f.notes.length).toBe(1);
    expect(f.notes[0]).toMatchObject({workspace_id: 'w', raw_text: '합성 홈 업데이트'});
    await expect(quick.locator('[data-quick-input]')).toHaveValue('');
    if (width <= 760) {
      // 폰: 입력줄은 하단 탭 바로 위에 붙는다.
      const q = await quick.boundingBox(), tabs = await page.locator('.mobile-tabs').boundingBox();
      expect(q.y + q.height).toBeLessThanOrEqual(tabs.y + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(f.errors).toEqual([]);
  });

  test(`${width}: 옛 주소·뒤로 가기·새로고침은 홈 그 날, 메뉴 [홈]은 오늘`, async ({ page }) => {
    const f = await boot(page, width, height, {query: '?view=journal&day=2026-10-08'});
    // ④ 옛 ?view=journal&day= → 홈 그 날, 주소에서 view는 빠지고 day는 남는다.
    await expect(page.locator('#homeView')).toBeVisible();
    expect(await view(page)).toBe('home');
    await expect(date(page, '2026-10-08')).toHaveAttribute('aria-pressed', 'true');
    await expect(root(page).locator('[data-journal-title]')).toHaveText('10월 8일 목요일');
    await expect(root(page).locator('[data-journal-done-title]')).toHaveText('그날 한 일');
    await expect(page).not.toHaveURL(/view=journal/);
    await expect(page).toHaveURL(/[?&]day=2026-10-08(?:&|$)/);
    // ⑤ 새로고침 제자리.
    await page.reload();
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, {timeout: 20000});
    await expect(date(page, '2026-10-08')).toHaveAttribute('aria-pressed', 'true');
    // ⑤ 다른 화면 → 뒤로 가기: 보던 날 그대로.
    await date(page, '2026-10-09').click();
    await expect(page).toHaveURL(/[?&]day=2026-10-09(?:&|$)/);
    await page.evaluate(() => window.KPTURouter.go('library', {source: 'delegated'}));
    await expect(page.locator('#libraryView')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#homeView')).toBeVisible();
    await expect(date(page, '2026-10-09')).toHaveAttribute('aria-pressed', 'true');
    // 메뉴 [홈](PC 사이드바 맨 위·폰 하단 탭)으로 들어오면 오늘·[하루].
    await page.evaluate(() => window.KPTURouter.go('library', {source: 'delegated'}));
    await expect(page.locator('#libraryView')).toBeVisible();
    if (width <= 760) await page.locator('.mobile-tabs [data-view="home"]').click();
    else await page.locator('#appView>.app-nav .sidebar-brand').click();
    await expect(page.locator('#homeView')).toBeVisible();
    await expect(date(page, '2026-10-06')).toHaveAttribute('aria-pressed', 'true');
    await expect(root(page).locator('[data-journal-title]')).toHaveText('10월 6일 화요일');
    await expect(page).not.toHaveURL(/[?&](view|day)=/);
    expect(f.errors).toEqual([]);
  });

  test(`${width}: 옛 ?view=home도 홈(오늘), 마지막 수집 시각·AI 사용량은 내 프로필에만`, async ({ page }) => {
    const f = await boot(page, width, height, {query: '?view=home'});
    await expect(page.locator('#homeView')).toBeVisible();
    await expect(root(page).locator('[data-journal-title]')).toHaveText('10월 6일 화요일');
    // ⑥ 홈에는 수집·사용량 칸이 없다.
    await expect(page.locator('#homeView :is(.home-collect,.home-ai-usage,[data-ps-collect],[data-ps-ai-usage],[data-home-ai-usage],[data-home-collect-alert])')).toHaveCount(0);
    await expect(page.locator('#homeView')).not.toContainText('마지막 수집 시각');
    await expect(page.locator('#mobileMenu [data-menu-collect]')).toHaveCount(0);
    await page.evaluate(() => window.KPTURouter.go('profile', {source: 'delegated'}));
    await expect(page.locator('#profileView')).toBeVisible();
    const panel = page.locator('#psStatusPanel');
    await expect(panel).toBeAttached();
    await expect(panel.locator('h3').first()).toHaveText('수집·사용량');
    await expect(panel.locator('[data-ps-collect]')).toBeAttached();
    await expect(panel.locator('[data-ps-ai-usage]')).toBeAttached();
    await expect(panel.locator('[data-ps-quiet] button')).toHaveText(['2주', '3주', '4주', '6주', '끄기']);
    expect(f.errors).toEqual([]);
  });
}
