// S51-24 FILES-핀치돌아오기(요청함 11/06 20:27): 폰 [파일] '그 폴더만'에서 오므리기·[‹]·뒤로 키 = 어떤 길로 들어왔든 나무, 그 폴더를 펼친 그 자리.
// 몇 번을 되풀이해도 같고, 두 칸 → 한 칸처럼 두 손가락이 아닌 길로 들어온 목록도 같다. 손가락이 줄 위가 아니어도(목록 칸 안 어디든) 된다.
import { test, expect } from '@playwright/test';
import { start, openFiles, phoneFolder } from './helpers/files-server.mjs';
import { pinch, pinchAt } from './helpers/pinch.mjs';

test.use({ hasTouch: true });

const tree = page => page.locator('#filesRoot [data-fx-tree]');
const list = page => page.locator('#filesRoot [data-fx-list]');
const shape = (page, key) => tree(page).locator(`[data-fx-fold="${key}"] .ft-ico`).first().getAttribute('data-ft-shape');

test('파일 폰 412: 벌리기 → 그 폴더만 → 오므리기 → 같은 나무·같은 펼침, 세 번 되풀이', async ({ page }) => {
  const { errors } = await start(page, 412);
  await openFiles(page, 412);
  await expect(tree(page).locator('[data-fx-fold="od:OD!1"]')).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await phoneFolder(page, 'od', 'OD!1');
    await expect(list(page).locator('[data-fx-row="od:OD!11"]')).toBeVisible();
    // 손가락이 파일 줄 사이가 아니라 목록 칸 맨 아래 쪽이어도 오므리기.
    const box = await list(page).boundingBox();
    await pinchAt(page, box.x + box.width / 2, box.y + box.height - 6, 'in');
    await expect(tree(page)).toBeVisible();
    await expect(page.locator('#filesRoot')).toHaveAttribute('data-fx-pane', 'tree');
    expect(await shape(page, 'od:OD!1')).toBe('open');
    await expect(tree(page).locator('[data-fx-fold="od:OD!10"]')).toBeVisible();
  }
  // 하위 폴더 '그 폴더만'에서 [‹] 한 번 = 나무(한 단계 위 목록이 아님).
  await phoneFolder(page, 'od', 'OD!10');
  await expect(list(page).locator('[data-fx-row="od:OD!14"]')).toBeVisible();
  await page.locator('#filesRoot [data-fx-list] [data-fx-up]').click();
  await expect(tree(page)).toBeVisible();
  expect(await shape(page, 'od:OD!1')).toBe('open');
  expect(errors).toEqual([]);
});

test('파일 폰 412: 두 손가락이 아닌 길(두 칸 → 한 칸)로 들어온 목록도 오므리기·[‹]·뒤로 키 = 그 폴더를 펼친 나무', async ({ page }) => {
  const { errors } = await start(page, 412);
  await openFiles(page, 412);
  await tree(page).locator('[data-fx-fold="od:OD!1"] .ft-main').tap();
  await phoneFolder(page, 'od', 'OD!10');
  await expect(list(page).first().locator('[data-fx-row="od:OD!14"]')).toBeVisible();
  const two = page.locator('#filesRoot [data-fx-two]');
  for (const leave of ['pinch', 'up', 'back']) {
    await two.click();
    await expect(page.locator('#filesRoot [data-fx-pane-i="1"]')).toHaveCount(1);
    await two.click();
    await expect(page.locator('#filesRoot [data-fx-pane-i="1"]')).toHaveCount(0);
    await expect(page.locator('#filesRoot')).toHaveAttribute('data-fx-pane', 'list');
    if (leave === 'pinch') await pinch(page, list(page), 'in');
    else if (leave === 'up') await page.locator('#filesRoot [data-fx-list] [data-fx-up]').click();
    else await page.goBack();
    await expect(tree(page)).toBeVisible();
    expect(await shape(page, 'od:OD!1')).toBe('open');
    await expect(tree(page).locator('[data-fx-fold="od:OD!10"]')).toBeInViewport();
    // 다시 그 폴더만으로(다음 길 시험).
    await phoneFolder(page, 'od', 'OD!10');
  }
  await expect(page.locator('#filesView')).toBeVisible();
  expect(errors).toEqual([]);
});
