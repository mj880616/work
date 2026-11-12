import { test, expect } from '@playwright/test';
import { start, openFiles, treeGo } from './helpers/files-server.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
// FILES-다시그리기메뉴자리(S60-28): [파일]·[사진]의 ⋯ 메뉴를 연 채 화면이 뒤에서 다시 그려져도(보기 설정 받음·재조회 등)
// 메뉴는 같은 줄의 새 ⋯ 옆에 그대로 붙어 있고(왼쪽 위 구석으로 튀지 않음), 항목을 누르면 그 줄에 대해 실행된다(공용 anchored-menu keepMenus).
// 가짜 서버만(이름 모두 가짜). 폰 412·PC 1280. 사진: MENU_FOLLOW_SHOTS 폴더가 있으면 남긴다.
const SHOTS = process.env.MENU_FOLLOW_SHOTS || '';
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';

// 지금 그 칸에 표시를 달고 화면을 다시 그리게 한 뒤, 표시 없는 새 칸이 그려질 때까지 기다린다(정말 다시 그려졌는지).
async function redraw(page, trigger, fire) {
  await trigger.evaluate(el => { el.dataset.oldDraw = '1'; });
  await fire();
  await expect(trigger).toBeVisible();
  await expect(trigger).not.toHaveAttribute('data-old-draw', '1');
}
// 메뉴 상자가 그 칸 바로 옆(위·아래 24px 안)에 있는지.
async function nextTo(panel, trigger) {
  const p = await panel.boundingBox(), t = await trigger.boundingBox();
  return Math.min(Math.abs(p.y - (t.y + t.height)), Math.abs(p.y + p.height - t.y)) < 24;
}
const prefsReady = page => () => page.evaluate(() => window.dispatchEvent(new CustomEvent('kptu:view-prefs-ready')));

// ---------- [사진] 폴더 ⋯ ----------
async function photosFixture(page, width) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  await openHome(page);
  await installViewPrefsServer(page);
  const folders = [{ id: 'S1', name: '가짜 2026', parent_id: 'T' }, { id: 'S2', name: '가짜 여행', parent_id: 'T' }];
  const media = [{ id: 'A1', name: 'A1.jpg', day: '2026-10-05', taken_at: '2026-10-05T03:00:00.000Z', approx: false, kind: 'photo', screenshot: false, duration_ms: null }];
  await page.route(u => u.origin === SB && ['/rest/v1/app_diary_stars', '/rest/v1/app_photo_tag_items', '/rest/v1/app_photo_tags', '/rest/v1/app_folder_prefs'].includes(u.pathname), r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
    const body = r.request().postDataJSON();
    if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
    if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false } });
    if (body.action === 'months') return r.fulfill({ json: { months: { '2026-10': 1 }, total: 1 } });
    if (body.action === 'library') return r.fulfill({ json: { items: media, next_cursor: null, indexing: false } });
    if (body.action === 'folders-tree') return r.fulfill({ json: { top: { id: 'T', name: '카메라', count: 1, total: 1 }, folders: folders.map(f => ({ ...f, enabled: true, count: 0, total: 0 })), indexing: false } });
    return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
  });
  return errors;
}

for (const width of [412, 1280]) test.describe(`다시 그려도 메뉴 자리 ${width}`, () => {
  test('[사진] 폴더 ⋯: 연 채 다시 그려도 같은 폴더 옆에 붙고 항목이 눌린다', async ({ page }) => {
    const errors = await photosFixture(page, width);
    await clickView(page, 'photos');
    await expect(page.locator('#photosView')).toBeVisible();
    await page.locator('#photosRoot [data-photos-view]').selectOption('folders');
    const more = page.locator('#photosRoot [data-photos-fx-more="S2"]').first(), panel = page.locator('#photosFolderMenu');
    await more.click();
    await expect(panel).toBeVisible();
    await redraw(page, more, prefsReady(page));
    await expect(panel).toBeVisible();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(await nextTo(panel, more)).toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${width < 761 ? 'phone' : 'pc'}-${width}-photos-folder-menu-kept.png` });
    // 다시 그린 뒤에도 그 폴더에 대해 실행된다: [색 선택…] → 색 고르기 칸.
    await panel.getByRole('button', { name: '색 선택…', exact: true }).click();
    await expect(panel.locator('.fl-choice')).toBeVisible();
    expect(errors).toEqual([]);
  });

  if (width < 761) test('[파일] 나무 파일 ⋯: 연 채 다시 그려도 같은 줄 옆에 붙고 항목이 눌린다', async ({ page }) => {
    const { errors } = await start(page, width);
    await openFiles(page, width);
    const tree = page.locator('#filesRoot [data-fx-tree]'), od = tree.locator('[data-fx-box="od"]');
    await od.locator('[data-fx-fold="od:OD!1"] .ft-main').first().click();
    const file = () => od.locator('[data-ft-parent="od:OD!1"]').filter({ hasText: '가짜 안내문.pdf' }).first();
    await expect(file()).toBeVisible();
    const more = () => file().locator('[data-fx-tmenu]'), panel = page.locator('#rowMenu');
    await file().hover();
    await more().click();
    await expect(panel).toBeVisible();
    await redraw(page, more(), prefsReady(page));
    await expect(panel).toBeVisible();
    await expect(more()).toHaveAttribute('aria-expanded', 'true');
    await expect(file()).toHaveClass(/row-menu-owner/); // 연보라 표시도 새 줄로
    expect(await nextTo(panel, more())).toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${width < 761 ? 'phone' : 'pc'}-${width}-files-row-menu-kept.png` });
    await panel.getByRole('button', { name: '이름 바꾸기' }).click();
    await expect(page.locator('.kptu-ask .kptu-ask-field')).toHaveValue('가짜 안내문');
    expect(errors).toEqual([]);
  });

  if (width >= 761) test('[파일] 목록 줄 PC 우클릭 메뉴: 연 채 다시 그려도 누른 자리 그대로 · 새 줄 표시 · 항목이 눌린다', async ({ page }) => {
    const { errors } = await start(page, width);
    await openFiles(page, width);
    await treeGo(page, 'od', 'OD!1');
    const row = () => page.locator('#filesRoot [data-fx-list] [data-fx-row]').filter({ hasText: '가짜 안내문.pdf' }).first(), panel = page.locator('#rowMenu');
    await expect(row()).toBeVisible();
    await row().click({ button: 'right' });
    await expect(panel).toBeVisible();
    const before = await panel.boundingBox();
    await redraw(page, row(), prefsReady(page));
    await expect(panel).toBeVisible();
    await expect(row()).toHaveClass(/row-menu-owner/);
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    const after = await panel.boundingBox();
    expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeLessThan(4);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/pc-${width}-files-list-menu-kept.png` });
    await panel.getByRole('button', { name: '이름 바꾸기' }).click();
    await expect(page.locator('.kptu-ask .kptu-ask-field')).toHaveValue('가짜 안내문');
    expect(errors).toEqual([]);
  });
});
