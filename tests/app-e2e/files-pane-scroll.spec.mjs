import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { start, openFiles } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S52-41 ② FILES-칸따로스크롤(요청함 11/08): 폴드 펼침·PC에서 왼쪽 나무와 오른쪽 목록이 각자 따로 스크롤한다.
// 맨 위 줄(위치 길·찾기·정렬·출처·두 칸 보기)은 화면 위에 고정. 두 칸이면 칸마다 따로. 폰(한 칸)은 지금대로(화면 스크롤 하나).
// 서버는 흉내(파일·폴더 이름은 모두 가짜). 나무가 화면보다 길도록 원드라이브 맨 위에 가짜 폴더 80개를 더한다.
const root = page => page.locator('#filesRoot');
const tree = page => root(page).locator('[data-fx-tree]');
const pane = (page, i) => root(page).locator(`[data-fx-pane-i="${i}"]`);
const SHOTS = process.env.FILES_SCROLL_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };
const fakeFolders = n => Array.from({ length: n }, (_, i) => ({ source: 'od', item_id: `OD!F${i}`, parent_id: null, name: `가짜 폴더 ${String(i).padStart(2, '0')}`, is_folder: true,
  mime: null, size_bytes: null, modified_at: '2026-10-01T01:00:00Z', hash: null, trashed: false, starred: false, library_doc_id: null }));
const topOf = loc => loc.evaluate(el => Math.round(el.getBoundingClientRect().top));

async function begin(page, width, prefs = null) {
  const { errors, server } = await start(page, width);
  server.items.push(...fakeFolders(80));
  await installViewPrefsServer(page, prefs);
  await page.reload();
  await openFiles(page, width, { two: !!prefs });
  await expect(root(page).locator('[data-fx-row="od:OD!F79"]').first()).toBeAttached();
  return { errors, server };
}

for (const width of [1440, 884]) {
  test(`${width} 한 칸: 왼쪽 나무를 끝까지 내려도 오른쪽 목록 첫 줄·위치 길은 제자리, 오른쪽(화면)을 내리면 나무·맨 위 줄은 제자리`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors } = await begin(page, width);
    await expect(root(page)).toHaveClass(/fx-split-scroll/);
    const first = pane(page, 0).locator('[data-fx-list] [data-fx-row]').first(), crumb = root(page).locator('.fx-top [data-fx-crumb]');
    const firstTop = await topOf(first), crumbTop = await topOf(crumb);
    // 나무는 따로 스크롤하는 칸(화면보다 길다).
    expect(await tree(page).evaluate(el => el.scrollHeight > el.clientHeight + 50)).toBe(true);
    await tree(page).evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect.poll(() => tree(page).evaluate(el => el.scrollTop)).toBeGreaterThan(100);
    expect(await topOf(first)).toBe(firstTop);
    expect(await topOf(crumb)).toBe(crumbTop);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await shot(page, `files-scroll-tree-${width}`);
    // 오른쪽 목록이 길면 화면 스크롤: 목록만 올라가고, 나무 칸과 맨 위 줄은 화면 위에 붙어 있다.
    await tree(page).evaluate(el => { el.scrollTop = 0; });
    await page.mouse.move(width - 200, 600);
    await page.mouse.wheel(0, 900);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
    const head = await root(page).locator('.fx-top').evaluate(el => Math.round(el.getBoundingClientRect().top));
    expect(head).toBeGreaterThanOrEqual(-1);
    expect(head).toBeLessThan(80);
    const treeTop = await topOf(tree(page)), headBottom = await root(page).locator('.fx-top').evaluate(el => Math.round(el.getBoundingClientRect().bottom));
    expect(treeTop).toBeGreaterThanOrEqual(headBottom);
    expect(treeTop).toBeLessThan(headBottom + 60);
    expect(await tree(page).evaluate(el => el.scrollTop)).toBe(0);
    await shot(page, `files-scroll-list-${width}`);
    expect(errors).toEqual([]);
  });
}

test('PC 1440 두 칸: 칸마다 따로 스크롤(오른쪽 칸을 끝까지 내려도 왼쪽 칸 첫 줄·칸 머리 줄은 제자리), 칸 머리 줄은 칸 위에 고정', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await begin(page, 1440, { files_two: { pc: { wide: true } } });
  await expect(pane(page, 1)).toBeVisible();
  // 오른쪽 칸을 원드라이브 맨 위로(가짜 폴더 80개). 두 칸이면 나무는 접혀 있어 ◫로 연다(S52-41 ③).
  await root(page).locator('[data-fx-tree-tog]').click();
  await pane(page, 1).locator('.fx-ptop').click({ position: { x: 300, y: 5 } });
  await tree(page).locator('[data-fx-go="od"][data-fx-id=""]').click();
  await expect(pane(page, 1).locator('[data-fx-row="od:OD!F79"]')).toBeAttached();
  const right = pane(page, 1);
  // 칸은 제자리에서 시작한다(나무와 같은 높이 — 붙는 자리만큼 밀려 내려가지 않음).
  expect(Math.abs((await topOf(pane(page, 0))) - (await topOf(tree(page))))).toBeLessThan(4);
  expect(await right.evaluate(el => el.scrollHeight > el.clientHeight + 50)).toBe(true);
  const leftFirst = pane(page, 0).locator('[data-fx-row]').first(), leftTop = await topOf(leftFirst);
  const rightHead = right.locator('.fx-ptop'), rightHeadTop = await topOf(rightHead);
  await right.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => right.evaluate(el => el.scrollTop)).toBeGreaterThan(100);
  expect(await topOf(leftFirst)).toBe(leftTop);
  expect(await topOf(rightHead)).toBe(rightHeadTop);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await shot(page, 'files-scroll-two-1440');
  expect(errors).toEqual([]);
});

test('폰 412: 한 칸은 지금대로(화면 스크롤 하나, 나무 칸 따로 스크롤 없음)', async ({ page }) => {
  test.setTimeout(60000);
  const { errors } = await start(page, 412);
  await installViewPrefsServer(page, null);
  await page.reload();
  await openFiles(page, 412);
  await expect(root(page)).not.toHaveClass(/fx-split-scroll/);
  await expect(tree(page)).not.toHaveClass(/kptu-follow-pane/);
  expect(errors).toEqual([]);
});
