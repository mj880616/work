import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { bootLibrary, libFolder, menuButton, folderMenuItem, press } from './helpers/library-folder-server.mjs';

// NAV-새로고침제자리 (요청 10/28 17:16): 새로고침(폰 당겨서 새로고침)해도 보던 화면 그대로. 라우터가 주소를 혼자 맡고(app-router.js),
// 정리함의 쪽([챙길 것]·[노트])은 ?pane=, 화면 안의 자리(열린 노트·들어간 폴더·고른 날·보던 날짜·열린 조직)는 화면마다 정한 칸
// (setPlace, 기록을 따로 만들지 않음)으로 적힌다. 기기 저장은 쓰지 않는다. 뒤로 가기는 이전 화면 그대로. 이름·내용은 지어낸 것.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-05T01:00:00Z';
const row = (id, kind, raw_text, extra = {}) => ({ id, workspace_id: 'w', kind, title: kind === 'note' ? raw_text : null, journal_day: null, raw_text, occurred_at: at, created_at: at, updated_at: at, archived_at: null, ai_export_allowed: kind !== 'diary', attachments: [], metadata: {}, ...extra });

async function boot(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const rows = [
    row('b1', 'basket', '합성 업데이트 하나'),
    row('n1', 'note', '가 노트'),
    row('n2', 'note', '나 노트', { metadata: { folder: '회의' } }),
    row('d3', 'diary', '가을 산책', { journal_day: '2026-10-03', ai_export_allowed: false }),
  ];
  const folders = [{ id: U(1), workspace_id: 'w', parent_id: null, name: '회의', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' }];
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => {
      const q = new URL(r.request().url()).searchParams;
      const pick = x => (!q.get('kind') || q.get('kind') === 'eq.' + x.kind || (q.get('kind').startsWith('in.(') && q.get('kind').slice(4, -1).split(',').includes(x.kind))) && (!q.get('id') || q.get('id') === 'eq.' + x.id);
      return r.request().method() === 'GET' ? r.fulfill({ json: rows.filter(pick).map(x => structuredClone(x)) }) : r.fulfill({ json: [] });
    });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.fulfill({ json: r.request().method() === 'GET' ? structuredClone(folders) : [] }));
  } });
  return errors;
}
const reload = async page => { await page.reload(); await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/); };
const view = page => page.evaluate(() => window.KPTURouter.current);

for (const width of [390, 1280]) test.describe(`새로고침 뒤 같은 화면 ${width}`, () => {
  test.use({ hasTouch: width < 761 });

  test(`노트: 노트 쪽·열린 노트가 새로고침 뒤 그대로, 뒤로는 목록 → 이전 화면 ${width}`, async ({ page }) => {
    const errors = await boot(page, width);
    await page.evaluate(() => window.KPTURouter.go('calendar'));
    await expect(page.locator('#calendarView')).toBeVisible();
    await chooseBasketKind(page, 'note');
    await expect(page.locator('#basketView')).toHaveAttribute('data-kind', 'note');
    await expect(page).toHaveURL(/[?&]view=basket(?:&|$)/); await expect(page).toHaveURL(/[?&]pane=note(?:&|$)/);
    await reload(page);
    await expect(page.locator('#basketView')).toBeVisible(); await expect(page.locator('#basketView')).toHaveAttribute('data-kind', 'note');
    // 폰은 한 화면씩(폴더 목록 → '폴더 없음' 화면, 폴더 화면은 기록 한 칸): '폴더 없음'에 들어가면 ?folder=out이 그 칸에 적힌다.
    if (width < 761) { await page.locator('#noteRows [data-nx-open="out"]').click(); await expect(page.locator('[data-nx-here]')).toContainText('폴더 없음'); await expect(page).toHaveURL(/[?&]folder=out(?:&|$)/); }
    await expect(page.locator('[data-note-host] [data-note-row="n1"]')).toBeVisible();
    // 열린 노트는 ?doc=로 적히고, 새로고침해도 그 노트가 열린 채다.
    await page.locator('[data-note-host] [data-note-row="n1"]').click();
    await expect(page.locator('[data-note-detail]')).toBeVisible(); await expect(page).toHaveURL(/[?&]doc=n1(?:&|$)/);
    await reload(page);
    await expect(page.locator('#basketView')).toHaveAttribute('data-kind', 'note');
    await expect(page.locator('[data-note-detail]')).toBeVisible(); await expect(page.locator('[data-note-detail]')).toContainText('가 노트');
    // 뒤로: 노트를 닫고 노트 목록(주소에서 doc 빠짐) → 한 번 더 뒤로는 이전 화면(달력).
    await page.goBack();
    await expect(page.locator('[data-note-detail]')).toBeHidden(); await expect(page).not.toHaveURL(/[?&]doc=/);
    await expect(page.locator('#basketView')).toHaveAttribute('data-kind', 'note');
    // 폰: 한 번 더 뒤로는 '폴더 없음' 화면에서 폴더 목록(주소에서 folder 빠짐).
    if (width < 761) { await expect(page.locator('[data-nx-here]')).toContainText('폴더 없음'); await page.goBack(); await expect(page.locator('[data-nx-here]')).toBeHidden(); await expect(page).not.toHaveURL(/[?&]folder=/); }
    await page.goBack();
    await expect(page.locator('#calendarView')).toBeVisible(); await expect(page).not.toHaveURL(/[?&]pane=/);
    // [정리함]으로 가면 노트 쪽이 아니고 주소에도 pane이 없다.
    await page.evaluate(() => window.KPTURouter.go('basket'));
    await expect(page.locator('#basketView')).toHaveAttribute('data-kind', 'memo'); await expect(page).not.toHaveURL(/[?&]pane=/);
    expect(errors).toEqual([]);
  });

  test(`정리함: 열린 업데이트가 새로고침 뒤 그대로 ${width}`, async ({ page }) => {
    const errors = await boot(page, width);
    await page.evaluate(() => window.KPTURouter.go('basket'));
    await page.locator('[data-basket-row="b1"]').click();
    await expect(page.locator('[data-basket-text]')).toHaveValue('합성 업데이트 하나'); await expect(page).toHaveURL(/[?&]note=b1(?:&|$)/);
    await reload(page);
    await expect(page.locator('#basketView')).toBeVisible(); await expect(page.locator('[data-basket-text]')).toHaveValue('합성 업데이트 하나');
    await page.goBack();
    await expect(page.locator('[data-basket-detail]')).toBeHidden(); await expect(page).not.toHaveURL(/[?&]note=/);
    expect(errors).toEqual([]);
  });

  test(`일기·업무일지·달력: 고른 날과 보던 날짜가 새로고침 뒤 그대로 ${width}`, async ({ page }) => {
    const errors = await boot(page, width);
    // 일기: 고른 날(?day=)
    await page.evaluate(() => window.KPTURouter.go('diary'));
    const day = page.locator('#diaryView [data-diary-day="2026-10-03"]');
    await day.click(); await expect(day).toHaveAttribute('aria-pressed', 'true'); await expect(page).toHaveURL(/[?&]day=2026-10-03(?:&|$)/);
    await reload(page);
    expect(await view(page)).toBe('diary'); await expect(day).toHaveAttribute('aria-pressed', 'true');
    // 업무일지 = 홈(HOME-업무일지홈): 고른 날(?day=), [주간 정리](?mode=week). 주소에 view는 없다.
    await page.evaluate(() => window.KPTURouter.go('home'));
    await expect(page).not.toHaveURL(/[?&]day=/);
    const date = page.locator('#journalRoot [data-journal-date="2026-10-08"]');
    await date.click(); await expect(date).toHaveAttribute('aria-pressed', 'true'); await expect(page).toHaveURL(/[?&]day=2026-10-08(?:&|$)/);
    await expect(page).not.toHaveURL(/[?&]view=/);
    await reload(page);
    expect(await view(page)).toBe('home'); await expect(date).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#journalRoot [data-journal-mode="week"]').click();
    await expect(page.locator('#journalRoot [data-journal-weekly-root]')).toBeVisible(); await expect(page).toHaveURL(/[?&]mode=week(?:&|$)/);
    await reload(page);
    await expect(page.locator('#journalRoot [data-journal-weekly-root]')).toBeVisible();
    // 달력: 다음으로 넘긴 날짜(?date=)
    await page.evaluate(() => window.KPTURouter.go('calendar'));
    await expect(page.locator('#calendarView')).toBeVisible(); await expect(page).not.toHaveURL(/[?&]date=/);
    const title = page.locator('#monthTitle'), before = await title.getAttribute('aria-label');
    await page.locator('#nextMonthBtn').click();
    await expect(title).not.toHaveAttribute('aria-label', before); await expect(page).toHaveURL(/[?&]date=\d{4}-\d{2}-\d{2}(?:&|$)/);
    const moved = await title.getAttribute('aria-label');
    await reload(page);
    await expect(page.locator('#calendarView')).toBeVisible(); await expect(title).toHaveAttribute('aria-label', moved);
    expect(errors).toEqual([]);
  });

  test(`담당조직: 열린 조직이 새로고침 뒤 그대로 ${width}`, async ({ page }) => {
    const errors = await boot(page, width);
    await page.evaluate(() => window.KPTURouter.go('team'));
    await page.locator('#soOrganizationList [data-so-org="o"]').first().click();
    await expect(page.locator('#wdModal')).toBeVisible(); await expect(page).toHaveURL(/[?&]org=o(?:&|$)/);
    await reload(page);
    expect(await view(page)).toBe('team'); await expect(page.locator('#wdModal')).toBeVisible(); await expect(page.locator('#wdModal')).toContainText('테스트 조직');
    expect(errors).toEqual([]);
  });

  test(`자료실: 들어간 폴더가 새로고침 뒤 그대로 ${width}`, async ({ page }) => {
    const { errors } = await bootLibrary(page, width, { folders: [libFolder('fa', 'top-a', { name: '가상 A' })], items: [] });
    await page.locator('#libraryGroupBy').getByRole('radio', { name: '폴더' }).click();
    await press(page, menuButton(page, 'f:fa'), width); await press(page, folderMenuItem(page, '이 폴더로 들어가기'), width);
    const path = page.locator('#libraryPath');
    await expect(path).toHaveText('자료실›가상 A'); await expect(page).toHaveURL(/[?&]folder=fa(?:&|$)/);
    await reload(page);
    await expect(path).toHaveText('자료실›가상 A');
    // '자료실'을 누르면 처음 목록, 주소에서도 빠진다.
    await press(page, path.locator('[data-lu-path=""]'), width);
    await expect(page).not.toHaveURL(/[?&]folder=/);
    expect(errors).toEqual([]);
  });
});

test('노트 폴더(PC): 들어간 폴더가 새로고침 뒤 그대로', async ({ page }) => {
  const errors = await boot(page, 1280);
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await page.locator(`[data-nx-tree] [data-nx-open="${U(1)}"]`).click();
  await expect(page).toHaveURL(new RegExp(`[?&]folder=${U(1)}(?:&|$)`));
  // 맨 위 폴더는 위치 줄 없이 위에 '회의 · 1'(NOTE-화면정리 #1399).
  await expect(page.locator('[data-nx-here]')).toContainText('회의');
  await reload(page);
  await expect(page.locator('#basketView')).toHaveAttribute('data-kind', 'note');
  await expect(page.locator('[data-nx-here]')).toContainText('회의');
  expect(errors).toEqual([]);
});
