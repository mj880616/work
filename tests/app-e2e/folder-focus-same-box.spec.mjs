// S51-24 FOLDER-그폴더만같은모양(요청함 11/06 21:52, 시안 docs/design/mockups/folder-focus-continuity.html ②·전환):
// 폰 '그 폴더만'도 나무와 같은 둥근 상자(ft-box)·같은 줄(ft-row)·같은 폴더 그림(ft-ico 열림/닫힘)·줄마다 ⋯.
// 상자 맨 위 작은 위치 줄(‹ + 저장소 › 위 폴더 ›, 누르면 그 단계), 머리 = 열린 폴더 그림 + 굵은 이름 + '폴더 n · 파일 m'.
// 옛 목록 모양(그림 문자 폴더·두 줄 줄·위 경로 막대)과 '나무로' 같은 돌아가기 글자는 없다. 벌리기·오므리기는 0.2초 움직임으로 잇고,
// 기기 '움직임 줄이기'면 움직임 없이 바로 바뀐다. 이름은 모두 지어낸 것이다.
import { test, expect } from '@playwright/test';
import { start, openFiles, phoneFolder } from './helpers/files-server.mjs';
import { pinch } from './helpers/pinch.mjs';

test.use({ hasTouch: true });
const tree = page => page.locator('#filesRoot [data-fx-tree]');
const box = page => page.locator('#filesRoot [data-fx-list] .ft-focus');
// 움직임을 몇 번 걸었는지(Element.animate 부른 수). 지금 도는지 재면 0.2초가 이미 끝났을 수 있어 센다.
const countMoves = page => page.addInitScript(() => { window.__moves = 0; const a = Element.prototype.animate; Element.prototype.animate = function (...x) { window.__moves++; return a.apply(this, x); }; });
const moves = page => page.evaluate(() => window.__moves);

test('파일 폰 412: 그 폴더만 = 나무와 같은 상자·줄·그림, 위치 줄, 돌아가기 글자 없음, 하위 폴더 위 벌리기 = 한 단계 더 안', async ({ page }) => {
  const { errors } = await start(page, 412);
  await openFiles(page, 412);
  await tree(page).locator('[data-fx-fold="od:OD!1"] .ft-main').tap();
  await phoneFolder(page, 'od', 'OD!1');
  await expect(box(page)).toBeVisible();
  await expect(box(page)).toHaveClass(/ft-box/);
  await expect(box(page).locator('.ft-focus-head .ft-focus-name')).toHaveText('가짜 문서함');
  await expect(box(page).locator('.ft-focus-head .ft-ico')).toHaveAttribute('data-ft-shape', 'open');
  await expect(box(page).locator('.ft-focus-head .ft-num')).toHaveText('폴더 1 · 파일 3');
  await expect(box(page).locator('.ft-focus-anc')).toHaveText('원드라이브›');
  // 줄: 나무와 같은 ft-row, 폴더는 닫힌 폴더 그림, 줄마다 ⋯. 옛 목록 줄(.fx-row)·위 경로 막대 없음.
  await expect(box(page).locator('.ft-folder [data-fx-row="od:OD!10"]')).toBeVisible();
  expect(await box(page).locator('.ft-folder .ft-ico').first().getAttribute('data-ft-shape')).toBe('closed');
  await expect(box(page).locator('.ft-row')).toHaveCount(4);
  await expect(box(page).locator('.ft-row .ft-dots')).toHaveCount(4);
  await expect(page.locator('#filesRoot .fx-row')).toHaveCount(0);
  await expect(page.locator('#filesRoot [data-fx-crumb]')).toBeHidden();
  expect(await page.locator('#filesRoot').innerText()).not.toContain('나무로');
  // 줄 높이·글자 크기는 나무와 같다.
  const treeH = 40, rowH = Math.round((await box(page).locator('.ft-folder .ft-main').boundingBox()).height);
  expect(rowH).toBeGreaterThanOrEqual(treeH);
  // ⋯ = 그 자리 메뉴(화면은 그대로).
  await box(page).locator('[data-fx-tmenu="od:OD!11"]').click();
  await expect(page.locator('[data-row-item]').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(box(page)).toBeVisible();
  // 하위 폴더 위 벌리기 = 한 단계 더 안(같은 상자 모양), 위치 줄에 위 단계가 더해진다.
  await pinch(page, box(page).locator('.ft-folder').first(), 'out');
  await expect(box(page).locator('.ft-focus-name')).toHaveText('가짜 2026');
  await expect(box(page).locator('.ft-focus-anc')).toHaveText('원드라이브›가짜 문서함›');
  // 위치 줄 '가짜 문서함' = 그 단계로.
  await box(page).locator('.ft-focus-step', { hasText: '가짜 문서함' }).click();
  await expect(box(page).locator('.ft-focus-name')).toHaveText('가짜 문서함');
  // 오므리기 = 나무.
  await pinch(page, box(page), 'in');
  await expect(tree(page)).toBeVisible();
  await page.screenshot({ path: 'test-results/files-focus-same-box-412.png' });
  expect(errors).toEqual([]);
});

test('파일 폰 412: 벌리기·오므리기는 0.2초 움직임으로 이어진다(그 줄 → 상자 머리 → 그 줄)', async ({ page }) => {
  await countMoves(page);
  const { errors } = await start(page, 412);
  await openFiles(page, 412);
  await tree(page).locator('[data-fx-fold="od:OD!1"] .ft-main').tap();
  const m0 = await moves(page);
  await pinch(page, tree(page).locator('[data-fx-fold="od:OD!1"]'), 'out');
  await expect(box(page)).toBeVisible();
  // 머리·하위 폴더 줄·파일 줄·위치 줄에 움직임.
  await expect.poll(() => moves(page)).toBeGreaterThan(m0 + 3);
  const m1 = await moves(page);
  await pinch(page, box(page), 'in');
  await expect(tree(page)).toBeVisible();
  await expect.poll(() => moves(page)).toBeGreaterThan(m1);
  expect(errors).toEqual([]);
});

test.describe('움직임 줄이기', () => {
  test.use({ reducedMotion: 'reduce' });
  test('파일 폰 412: 기기 움직임 줄이기면 움직임 없이 바로 바뀐다', async ({ page }) => {
    await countMoves(page);
    const { errors } = await start(page, 412);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openFiles(page, 412);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await tree(page).locator('[data-fx-fold="od:OD!1"] .ft-main').tap();
    const m0 = await moves(page);
    await pinch(page, tree(page).locator('[data-fx-fold="od:OD!1"]'), 'out');
    await expect(box(page)).toBeVisible();
    await pinch(page, box(page), 'in');
    await expect(tree(page)).toBeVisible();
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await moves(page)).toBe(m0);
    expect(errors).toEqual([]);
  });
});
