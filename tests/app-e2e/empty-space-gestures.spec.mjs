// S51-24 UI-빈칸손짓(요청함 11/06 21:52, 시안 docs/design/mockups/folder-focus-continuity.html 왼쪽 두 화면 점선 칸):
// 손짓(두 손가락 벌리기·오므리기, 좌우 밀기)은 내용이 끝난 아래 빈 곳에서도 된다 — 손짓 칸이 아래 바 바로 위까지 채워진다(app/gesture-fill.js).
// 화면마다 '목록이 짧아 아래가 빈' 상태에서 빈 곳 좌표가 손짓 칸 안인지 보고, 그 좌표에서 실제 손짓을 흉내 낸다. 이름은 모두 지어낸 것이다.
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { pinchAt, swipeAt, emptySpot, spotIn } from './helpers/pinch.mjs';

test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
// 빈 곳: 내용 끝 아래, 아래 바보다 위(목록이 짧은 상태여야 시험이 뜻이 있다).
async function emptyIn(page, items, host) {
  const spot = await emptySpot(page, items);
  expect(spot.y).toBeLessThan(spot.barTop - 8);
  expect(await spotIn(page, spot, host)).toBe(true);
  return spot;
}

test('파일 폰 412: 그 폴더만 아래 빈 곳에서 오므리기 = 나무, 나무 아래 빈 곳도 손짓 칸', async ({ page }) => {
  const { start, openFiles, phoneFolder } = await import('./helpers/files-server.mjs');
  const { errors } = await start(page, 412);
  await openFiles(page, 412);
  const tree = page.locator('#filesRoot [data-fx-tree]');
  await expect(tree.locator('[data-fx-fold="od:OD!2"]')).toBeVisible();
  await emptyIn(page, '#filesRoot [data-fx-tree] .ft-box', '#filesRoot');
  await phoneFolder(page, 'od', 'OD!2');
  await expect(page.locator('#filesRoot [data-fx-list] [data-fx-row="od:OD!20"]')).toBeVisible();
  const spot = await emptyIn(page, '#filesRoot [data-fx-list] .ft-focus', '#filesRoot');
  await pinchAt(page, spot.x, spot.y, 'in');
  await expect(tree).toBeVisible();
  // 아래 바 바로 위까지 손짓 칸이고, 그 때문에 화면이 더 길어지지 않는다(짧은 목록이면 스크롤 없음).
  expect(await spotIn(page, { x: spot.x, y: spot.barTop - 6 }, '#filesRoot')).toBe(true);
  expect(await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1);
  // 빈 곳 손짓은 화면 확대가 아니다(손짓 칸 touch-action).
  expect(await page.evaluate(() => visualViewport.scale)).toBe(1);
  expect(errors).toEqual([]);
});

test('노트 폰 412: 아래 빈 곳에서 좌우 밀기 = 보기 전환, 그 폴더만 아래 빈 곳에서 오므리기 = 나무', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const folders = [{ id: U(1), workspace_id: 'w', parent_id: null, name: '가상 메모', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' }];
  const note = (id, title, folder) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title, occurred_at: '2026-10-02T01:00:00Z', created_at: '2026-10-02T01:00:00Z', updated_at: '2026-10-02T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: folder ? { folder_id: U(1), folder: '가상 메모' } : {} });
  const rows = [note('a1', '가상 노트 하나', true), note('a2', '가상 노트 둘', true)];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(rows) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  const folderRow = page.locator(`#noteRows [data-nx-folder="${U(1)}"]`);
  await expect(folderRow).toBeVisible();
  // 그 폴더만 → 아래 빈 곳 오므리기 → 나무.
  const { pinch } = await import('./helpers/pinch.mjs');
  await pinch(page, folderRow, 'out');
  await expect(page.locator('#noteRows [data-nx-focus]')).toBeVisible();
  let spot = await emptyIn(page, '#noteRows [data-nx-focus]', '[data-nx-body]');
  await pinchAt(page, spot.x, spot.y, 'in');
  await expect(page.locator('#noteRows [data-nx-focus]')).toHaveCount(0);
  await expect(folderRow).toBeVisible();
  // 나무 아래 빈 곳에서 왼쪽으로 밀기 = [목록] 보기.
  spot = await emptyIn(page, '#noteRows > *, [data-nx-recent] > *', '[data-nx-body]');
  await swipeAt(page, spot.x + 100, spot.y, -200);
  await expect(page.locator('[data-note-view="list"]')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('자료실 폰 412: 그 폴더만 아래 빈 곳에서 오므리기 = 나무', async ({ page }) => {
  const { bootLibrary, libFolder } = await import('./helpers/library-folder-server.mjs');
  const { errors } = await bootLibrary(page, 412, { folders: [libFolder('fa', 'top-a', { name: '가상 A', sort_order: 1024 })], items: [{ document_id: 'n-1', folder_id: 'fa' }] });
  await page.locator('#libraryGroupBy').getByRole('radio', { name: '폴더' }).click();
  const head = page.locator('#documentList details[data-lu-node="f:fa"] > summary');
  await expect(head).toBeVisible();
  const { pinch } = await import('./helpers/pinch.mjs');
  await pinch(page, head, 'out');
  const path = page.locator('#libraryPath');
  await expect(path).toBeVisible();
  // 손짓 칸은 자료실 화면 전체(테두리 있는 목록 상자는 늘이지 않는다).
  const spot = await emptyIn(page, '#libraryListCard', '#libraryView');
  expect(await spotIn(page, { x: spot.x, y: spot.barTop - 6 }, '#libraryView')).toBe(true);
  await pinchAt(page, spot.x, spot.y, 'in');
  await expect(path).toBeHidden();
  expect(errors).toEqual([]);
});

test('News 폰 412: 글 아래 빈 곳에서 좌우 밀기 = 탭 이동', async ({ page }) => {
  const { start, openNews } = await import('./helpers/news-server.mjs');
  const { errors } = await start(page, 412);
  await openNews(page, 412);
  await expect(page.locator('#nowPanelNews')).toBeVisible();
  // 글 줄을 다 그린 뒤에 빈 곳을 잰다(늦게 그려진 줄 위를 밀면 줄 밀기가 가져간다).
  await expect(page.locator('#outsideRoot [data-nc-item]')).toHaveCount(5);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const spot = await emptyIn(page, '#outsideRoot > *:not([hidden])', '#outsideRoot');
  expect(await page.evaluate(([x, y]) => !document.elementFromPoint(x, y)?.closest('[data-nc-item], .now-row'), [spot.x, spot.y])).toBe(true);
  await swipeAt(page, spot.x + 100, spot.y, -200);
  await expect(page.locator('#outsideRoot [data-os-tab="archive"]')).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('사진 폰 412: 본문 아래 빈 곳도 손짓 칸(아래 바 바로 위까지)', async ({ page }) => {
  const { phonePhotosFixture, openPhotos } = await import('./helpers/phone-photos-fixture.mjs');
  await page.setViewportSize({ width: 412, height: 915 });
  const state = await phonePhotosFixture(page);
  await openPhotos(page, 412);
  const body = page.locator('#photosView [data-photos-body]');
  await expect(body).toBeVisible();
  // 본문 아래 끝이 아래 바 위 끝까지(사진을 그린 뒤 다시 재므로 잠깐 기다린다).
  await expect.poll(() => page.evaluate(() => {
    const b = document.querySelector('#photosView [data-photos-body]'), bar = document.querySelector('nav.mobile-tabs');
    return b.getBoundingClientRect().bottom >= bar.getBoundingClientRect().top - 2;
  })).toBe(true);
  expect(state.errors || []).toEqual([]);
});
