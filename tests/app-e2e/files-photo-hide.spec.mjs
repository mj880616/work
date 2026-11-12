import { test, expect } from '@playwright/test';
import { start, openFiles, phoneFolder, treeGo } from './helpers/files-server.mjs';
// LIB-사진숨김(S60-10, 명진 결정 11/12, 시안 docs/design/mockups/photo-hide-thumbs.html ⑤): [파일] 폴더 안 사진은 줄에서 빠지고 맨 아래 [사진 n] 하나.
// 누르면 그 자리에 작은 그림(누르면 미리보기). 검색·묶음은 그대로. 이름은 모두 지어낸 것이다.
const root = page => page.locator('#filesRoot');
const addPhotos = server => {
  const base = server.items.find(i => i.item_id === 'OD!11');
  server.items.push({ ...base, item_id: 'OD!31', name: '가짜 집회.png', mime: 'image/png', size_bytes: 2048 }, { ...base, item_id: 'OD!32', name: '가짜 회견.jpg', mime: 'image/jpeg', size_bytes: 4096 });
};
const shot = (page, name) => page.screenshot({ path: test.info().outputPath(name + '.png') });

for (const width of [1280, 884]) test(`파일 ${width}: 폴더 목록의 사진은 [사진 2] 하나, 누르면 작은 그림 칸`, async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, width);
  addPhotos(server);
  await openFiles(page, width);
  await treeGo(page, 'od', 'OD!1');
  const list = root(page).locator('[data-fx-pane-i="0"] [data-fx-list]');
  await expect(list.locator('[data-fx-row="od:OD!11"]')).toBeVisible();
  await expect(list.locator('[data-fx-row="od:OD!31"]')).toHaveCount(0);
  await expect(list.locator('[data-fx-row="od:OD!32"]')).toHaveCount(0);
  const toggle = list.locator('[data-fx-photos]');
  await expect(toggle).toHaveText('사진 2');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await shot(page, `files-photo-hide-${width}`);
  await toggle.click();
  await expect(list.locator('[data-fx-photos]')).toHaveAttribute('aria-expanded', 'true');
  const cell = list.locator('.fx-photo-grid [data-fx-row="od:OD!31"]');
  await expect(cell).toBeVisible();
  await expect(cell.locator('.fx-cell-pic img')).toBeVisible();
  await shot(page, `files-photo-open-${width}`);
  // 누르면 미리보기(줄과 같은 길).
  await cell.click();
  await expect(root(page).locator('[data-fx-prev] .fx-pv-imgbox')).toHaveAttribute('data-img-state', 'shown');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('파일 412: 폰 나무·그 폴더만에서도 사진은 [사진 2] 하나, 누르면 그 자리에 작은 그림', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 412);
  addPhotos(server);
  await openFiles(page, 412);
  const tree = root(page).locator('[data-fx-tree] [data-fx-box="od"]');
  await tree.locator('[data-fx-fold="od:OD!1"]').click();
  await expect(tree.locator('[data-fx-tfile="od:OD!11"]')).toBeVisible();
  await expect(tree.locator('[data-fx-tfile="od:OD!31"]')).toHaveCount(0);
  const toggle = tree.locator('[data-fx-photos]');
  await expect(toggle).toHaveText('사진 2');
  await toggle.click();
  const tile = tree.locator('[data-photo-tile="od:OD!32"]');
  await expect(tile).toBeVisible();
  await expect(tile.locator('img')).toBeVisible();
  // 작은 그림 칸 안 ⋯는 오른쪽 위 24px 칸(base-ui.css .photo-fold-tile, 우선순위 강제 없이).
  expect(await tile.locator('[data-fx-tmenu]').evaluate(e => { const r = e.getBoundingClientRect(), p = e.closest('[data-photo-tile]').getBoundingClientRect(); return [r.width, r.height, Math.round(p.right - r.right), Math.round(r.top - p.top)]; })).toEqual([24, 24, 0, 0]);
  await shot(page, 'files-photo-tree-412');
  // 다시 누르면 접힌다.
  await tree.locator('[data-fx-photos]').click();
  await expect(tree.locator('[data-photo-tile]')).toHaveCount(0);
  // 그 폴더만(두 손가락 벌리기)도 같은 규칙.
  await phoneFolder(page, 'od', 'OD!1');
  const list = root(page).locator('[data-fx-pane-i="0"] [data-fx-list]');
  await expect(list.locator('[data-fx-row="od:OD!31"]')).toHaveCount(0);
  await list.locator('[data-fx-photos]').click();
  await expect(list.locator('[data-photo-tile="od:OD!31"] img')).toBeVisible();
  await shot(page, 'files-photo-focus-412');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
