import { test, expect } from '@playwright/test';
import { start, openFiles, phoneFolder, treeGo } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { pinch } from './helpers/pinch.mjs';
// S51-20 FILES-폰보기끌기 ①(요청함 11/06 01:12 · 명진 01:14 'ㅇ', 시안 docs/design/mockups/files-phone-grid-two-drag.html ①):
// [파일] 목록 위 두 손가락 벌리기 = 목록 → 격자 → 큰 격자, 오므리기 = 반대. 폰은 3칸·2칸, 폴드 펼침·PC 한 칸은 4칸·3칸.
// 사진은 작은 그림(목록에서도), 폴더는 큰 폴더. 마지막 보기는 서버(view_prefs.files_look 기기 칸 · 폭 칸)에 기억해 다시 열어도 같다. 이름은 모두 지어낸 것이다.
const root = page => page.locator('#filesRoot');
const list = page => root(page).locator('[data-fx-pane-i="0"] [data-fx-list]');
const cols = page => list(page).locator('.fx-grid').evaluate(e => getComputedStyle(e).gridTemplateColumns.split(' ').filter(Boolean).length);
const photo = page => list(page).locator('[data-fx-row="od:OD!20"]');
// LIB-사진숨김(S60-10): 폴더 안 사진은 [사진 n]을 눌러 펼쳐야 보인다(펼침은 화면 메모리 — 새로 고치면 다시 접힘).
const showPhotos = async page => { const t = list(page).locator('[data-fx-photos]'); await expect(t).toBeVisible(); if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click(); };
const devOf = w => (w <= 760 ? 'phone' : 'pc'), layOf = w => (w < 600 ? 'narrow' : w >= 1200 ? 'wide' : 'fold');

for (const width of [412, 700, 884, 1280]) test(`파일 ${width}: 두 손가락으로 목록 ⇄ 격자 ⇄ 큰 격자, 사진은 작은 그림, 서버에 기억`, async ({ page }) => {
  test.setTimeout(120000);
  const prefs = await installViewPrefsServer(page);
  const { errors } = await start(page, width);
  const open = async () => {
    await openFiles(page, width);
    if (width < 600) await phoneFolder(page, 'od', 'OD!2'); else await treeGo(page, 'od', 'OD!2');
    await showPhotos(page);
    await expect(photo(page)).toBeVisible();
  };
  await open();
  const roomy = width >= 600;
  // 목록: 사진 줄도 작은 그림(받은 그림이 보인다).
  await expect(list(page)).toHaveAttribute('data-fx-look', 'list');
  await expect(photo(page).locator('.fx-th')).toHaveAttribute('data-img-state', 'shown');
  // 벌리기 → 격자
  await pinch(page, list(page), 'out');
  await expect(list(page)).toHaveAttribute('data-fx-look', 'grid');
  expect(await cols(page)).toBe(roomy ? 4 : 3);
  await expect(photo(page).locator('.fx-cell-pic img')).toBeVisible();
  await expect.poll(() => prefs.value?.files_look?.[devOf(width)]?.[layOf(width)]).toBe('grid');
  // 한 번 더 벌리기 → 큰 격자
  await pinch(page, list(page), 'out');
  await expect(list(page)).toHaveAttribute('data-fx-look', 'big');
  expect(await cols(page)).toBe(roomy ? 3 : 2);
  await expect.poll(() => prefs.value?.files_look?.[devOf(width)]?.[layOf(width)]).toBe('big');
  // 격자 칸도 누르면 열린다(미리보기)·폴더 칸은 큰 폴더.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `test-results/files-look-${width}.png` });
  // 다시 열어도 마지막 보기 그대로.
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
  // 새로고침은 같은 폴더로 돌아온다(주소). 다른 곳이면 그 폴더를 다시 연다.
  await page.waitForTimeout(800);
  if (await list(page).locator('[data-fx-photos]').isVisible().catch(() => false)) await showPhotos(page);
  if (!(await photo(page).isVisible().catch(() => false))) await open();
  await expect(photo(page)).toBeVisible();
  await expect(list(page)).toHaveAttribute('data-fx-look', 'big');
  // 오므리기 두 번 → 목록.
  await pinch(page, list(page), 'in');
  await expect(list(page)).toHaveAttribute('data-fx-look', 'grid');
  await pinch(page, list(page), 'in');
  await expect(list(page)).toHaveAttribute('data-fx-look', 'list');
  await expect.poll(() => prefs.value?.files_look?.[devOf(width)]?.[layOf(width)]).toBe('list');
  expect(errors).toEqual([]);
});

test('파일 폴드 700: 격자 칸 — 폴더는 큰 폴더, 누르면 그 폴더를 연다', async ({ page }) => {
  test.setTimeout(90000);
  await installViewPrefsServer(page, { files_look: { phone: { fold: 'grid' } } });
  const { errors } = await start(page, 700);
  await openFiles(page, 700);
  await treeGo(page, 'od', '');
  const folder = list(page).locator('[data-fx-row="od:OD!1"]');
  await expect(list(page)).toHaveAttribute('data-fx-look', 'grid');
  await expect(folder.locator('.fx-cell-fold svg')).toBeVisible();
  const b = await folder.boundingBox();
  expect(b.width).toBeGreaterThan(80);
  await folder.click();
  await expect(list(page).locator('[data-fx-row="od:OD!11"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('파일 폰 412: 나무에서 연 폴더 — 격자에서 오므리면 목록, 목록에서 한 번 더 오므리면 펼친 자리 그대로 나무', async ({ page }) => {
  test.setTimeout(90000);
  await installViewPrefsServer(page);
  const { errors } = await start(page, 412);
  await openFiles(page, 412);
  await phoneFolder(page, 'od', 'OD!2');
  await showPhotos(page);
  await expect(photo(page)).toBeVisible();
  await pinch(page, list(page), 'out');
  await expect(list(page)).toHaveAttribute('data-fx-look', 'grid');
  await pinch(page, list(page), 'in');
  await expect(list(page)).toHaveAttribute('data-fx-look', 'list');
  await expect(root(page)).toHaveAttribute('data-fx-pane', 'list');
  await pinch(page, list(page), 'in');
  await expect(root(page)).toHaveAttribute('data-fx-pane', 'tree');
  expect(errors).toEqual([]);
});
