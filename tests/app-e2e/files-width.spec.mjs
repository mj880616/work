import { test, expect } from '@playwright/test';
import { start, openFiles } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { checkSplit } from './helpers/split-check.mjs';
// S49-4 FILES-칸폭(요청함 11/03 10:39): [파일] 왼쪽 폴더 나무 | 오른쪽 목록 경계, 표 머리 칸(위치·바뀐 날·크기·종류) 경계를 끌어 폭 조절.
// 폭은 서버(view_prefs.split_ratio.files · view_prefs.col_widths.files)에만 기억한다. 서버는 흉내 낸다(기기 저장 없음).
const root = page => page.locator('#filesRoot');
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const headCell = (page, key) => root(page).locator(`.fx-head [data-col-grip="${key}"]`).locator('xpath=..');
const cellWidth = async (page, key) => (await headCell(page, key).boundingBox()).width;

test('PC 1440: [파일] 나무 | 목록 경계 끌기·키보드·새로고침 유지·두 번 눌러 기본', async ({ page }) => {
  test.setTimeout(90000);
  const server = await installViewPrefsServer(page);
  const { errors } = await start(page, 1440);
  const open = async () => { await openFiles(page, 1440); await expect(root(page).locator('[data-fx-list] [data-fx-row]').first()).toBeVisible(); };
  await open();
  await checkSplit(page, { container: '#filesRoot [data-fx-cols]', left: ':scope>.fx-tree', right: ':scope>.fx-main', name: 'files', share: 0.22, server, reopen: open });
  expect(errors).toEqual([]);
});

test('PC 1440: 표 머리 칸 경계 끌기 · 두 번 눌러 글 길이에 맞춤 · Home 기본 · 새로고침 뒤 유지(서버 저장)', async ({ page }) => {
  test.setTimeout(90000);
  const server = await installViewPrefsServer(page);
  const { errors } = await start(page, 1440);
  await openFiles(page, 1440);
  await expect(root(page).locator('.fx-head [data-col-grip]')).toHaveCount(4); // 최근 묶음: 위치·바뀐 날·크기·종류
  await settle(page);
  const stored = () => server.value?.col_widths?.files ?? null;
  expect(stored()).toBeNull();
  const before = await cellWidth(page, 'day');
  // 왼쪽 가장자리를 왼쪽으로 40px 끌면 그 칸이 40px 넓어진다(이름 칸이 남는 폭을 먹는다).
  const grip = root(page).locator('.fx-head [data-col-grip="day"]');
  const g = await grip.boundingBox(), y = g.y + g.height / 2, x = g.x + g.width / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x - 20, y, { steps: 4 }); await page.mouse.move(x - 40, y, { steps: 4 }); await page.mouse.up(); await settle(page);
  expect(Math.abs((await cellWidth(page, 'day')) - (before + 40))).toBeLessThan(3);
  await expect.poll(() => Math.abs((stored()?.day ?? 0) - (before + 40))).toBeLessThan(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  const dragged = stored().day;
  // 새로고침(다른 PC도 같은 서버 값을 읽는다) 뒤에도 그대로, 다른 칸은 기본 그대로.
  await page.reload(); await openFiles(page, 1440);
  await expect(root(page).locator('.fx-head [data-col-grip="day"]')).toBeVisible(); await settle(page);
  await expect.poll(async () => Math.abs((await cellWidth(page, 'day')) - dragged)).toBeLessThan(3);
  expect(Math.abs((await cellWidth(page, 'size')) - 72)).toBeLessThan(3);
  // 두 번 누르면 글 길이에 맞춤(저장됨, 40~800).
  const g2 = await root(page).locator('.fx-head [data-col-grip="day"]').boundingBox();
  await page.mouse.dblclick(g2.x + g2.width / 2, g2.y + g2.height / 2); await settle(page);
  await expect.poll(() => stored()?.day).not.toBe(dragged);
  expect(stored().day).toBeGreaterThanOrEqual(40); expect(stored().day).toBeLessThanOrEqual(800);
  // 키보드: ← 로 8px 넓히고, Home 이면 그 칸만 기본으로(서버 값 지움).
  const kb = root(page).locator('.fx-head [data-col-grip="size"]');
  await kb.focus(); const w0 = await cellWidth(page, 'size');
  await page.keyboard.press('ArrowLeft'); await settle(page);
  expect(Math.abs((await cellWidth(page, 'size')) - (w0 + 8))).toBeLessThan(2);
  await expect.poll(() => stored()?.size).toBeGreaterThan(w0);
  await page.keyboard.press('Home'); await settle(page);
  await expect.poll(() => stored()?.size ?? null).toBeNull();
  expect(Math.abs((await cellWidth(page, 'size')) - 72)).toBeLessThan(3);
  expect(errors).toEqual([]);
});

test('폰 412: 손잡이·경계 없음(표 머리가 없다)', async ({ page }) => {
  await installViewPrefsServer(page);
  const { errors } = await start(page, 412);
  await openFiles(page, 412);
  await expect(root(page).locator('.col-grip:visible')).toHaveCount(0);
  await expect(root(page).locator('.split-resize-handle:visible')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
