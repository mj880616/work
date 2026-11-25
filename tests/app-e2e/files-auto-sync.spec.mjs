import { test, expect } from '@playwright/test';
import { start, openFiles } from './helpers/files-server.mjs';
// FILES-맞춤단추없애기(S70-26, 11/25 명진 "굳이 내가 안쓰거든 / 자동으로 맞추게 하고 버튼은 안보이게"):
// [파일]에 '○분 전 맞춤' 글자·단추가 없다. 맞추기는 들어올 때 · 창으로 돌아올 때(1분 지났으면) · 화면에 있는 동안 2분마다 저절로.
// 한 번 실패는 조용하고, 연달아 3번 실패하면 공용 알림 한 줄('드라이브 목록을 못 받았어요' + [다시]). F2는 맞추기를 부르지 않는다.
// 서버는 흉내 낸다(files-server.mjs). 시계는 2026-10-06 10:00 서울에 고정(home-entry.mjs) — 지난 시간은 고정 시각을 옮겨 흉내 낸다.
const root = page => page.locator('#filesRoot');
const syncs = server => server.calls.filter(c => c.action === 'sync').length;
const notice = page => page.locator('.kptu-notice-text', { hasText: '드라이브 목록을 못 받았어요' });
const BASE = Date.parse('2026-10-06T01:00:00Z');
// 창을 숨겼다가 다시 보이게(폰 앱 전환·다른 창 다녀오기).
async function leaveAndBack(page, atMs) {
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  if (atMs) await page.clock.setFixedTime(new Date(atMs));
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
}

for (const width of [1280, 390]) {
  test(`${width}: 맞춤 글자·단추 없음, 들어오면 저절로 맞추고, 창으로 돌아오면 1분 지났을 때만 다시`, async ({ page }) => {
    const { errors, server } = await start(page, width);
    await openFiles(page, width);
    await expect.poll(() => syncs(server)).toBe(1);
    await expect(root(page).locator('[data-fx-tree], [data-fx-list]').first()).toBeVisible();
    await expect(root(page).locator('[data-fx-sync]')).toHaveCount(0);
    await expect(root(page)).not.toContainText('맞춤');
    await expect(root(page)).not.toContainText('맞추기');
    // 곧바로 돌아오면(1분 안) 다시 부르지 않는다.
    await leaveAndBack(page, BASE + 20 * 1000);
    await page.waitForTimeout(300);
    expect(syncs(server)).toBe(1);
    // 1분 넘게 지나 돌아오면 저절로 맞춘다.
    await leaveAndBack(page, BASE + 2 * 60 * 1000);
    await expect.poll(() => syncs(server)).toBe(2);
    // F2는 맞추기를 부르지 않는다(앱 전체에서 F2 = 이름 바꾸기).
    await root(page).locator('button:visible').first().focus();
    await page.keyboard.press('F2');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    expect(syncs(server)).toBe(2);
    expect(errors).toEqual([]);
  });

  test(`${width}: 한 번 실패는 조용히, 연달아 3번 실패하면 알림 한 줄 + [다시]`, async ({ page }) => {
    const { errors, server } = await start(page, width);
    server.syncReply = { od: { error: 'store_unavailable', more: false, done: false } };
    await openFiles(page, width);
    await expect.poll(() => syncs(server)).toBe(1);
    await page.waitForTimeout(300);
    await expect(notice(page)).toHaveCount(0);
    await expect(root(page)).not.toContainText('맞추기 안 됨');
    await leaveAndBack(page, BASE + 2 * 60 * 1000);
    await expect.poll(() => syncs(server)).toBe(2);
    await page.waitForTimeout(300);
    await expect(notice(page)).toHaveCount(0);
    await leaveAndBack(page, BASE + 4 * 60 * 1000);
    await expect.poll(() => syncs(server)).toBe(3);
    await expect(notice(page)).toBeVisible();
    // [다시]: 지금 다시 맞춘다(서버에 '지금'으로). 이번엔 성공.
    server.syncReply = null;
    await page.locator('.kptu-notice-action', { hasText: '다시' }).click();
    await expect.poll(() => syncs(server)).toBe(4);
    expect(server.calls.filter(c => c.action === 'sync').at(-1).body).toEqual({ action: 'sync', force: true });
    await expect(notice(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('1280: 화면에 머무는 동안 2분마다 저절로 맞춘다(새 시계 없이 기존 2분 주기)', async ({ page }) => {
  await page.clock.install({ time: new Date(BASE) });
  const { errors, server } = await start(page, 1280);
  await openFiles(page, 1280);
  await expect.poll(() => syncs(server)).toBe(1);
  await page.clock.runFor(2 * 60 * 1000 + 100);
  await expect.poll(() => syncs(server)).toBe(2);
  await page.clock.runFor(2 * 60 * 1000 + 100);
  await expect.poll(() => syncs(server)).toBe(3);
  expect(errors).toEqual([]);
});
