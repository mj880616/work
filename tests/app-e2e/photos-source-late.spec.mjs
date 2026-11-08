import { test, expect } from '@playwright/test';
import { ANDROID, phonePhotosFixture, openPhotos } from './helpers/phone-photos-fixture.mjs';
// S53-3 PHOTO-폰불러오기느림(요청함 11/08 10:15·10:16·10:17 ★급★): 폰 출처를 켜면 원드라이브 사진까지 안 뜨고, [정리]를 눌러야 뜨는 것처럼 보였다.
// - 느린 출처 하나(폰 목록 읽기에 아직 답 없음)가 다른 출처(원드라이브) 그리기를 막지 않는다 — 준비된 출처부터 바로 보인다.
// - 늦게 온 출처의 칸은 정렬 자리에 끼워지고, 이미 그린 칸은 그대로 둔다(다시 만들지 않음).
// - [정리]를 누르지 않아도 받은 사진이 그려진다.
const ids = page => page.locator('#photosRoot [data-photos-list] [data-photos-open]').evaluateAll(els => els.map(e => e.dataset.photosId));
const foot = page => page.locator('#photosRoot [data-photos-foot]');

async function slowPhone(page) {
  const held = [];
  const ctl = { hold: true };
  const { state } = await phonePhotosFixture(page, { app: true });
  // 나중에 건 길이 먼저: hold면 폰 사진 목록(page) 읽기를 붙잡아 둔다(폰 앱이 늦게 답하는 것처럼). 놓으면 원래 흉내로 넘긴다.
  await page.route('**/__phone/**', r => {
    if (ctl.hold && new URL(r.request().url()).pathname.endsWith('/page')) { held.push(r); return; }
    return r.fallback();
  });
  const release = async () => { ctl.hold = false; for (const r of held.splice(0)) await r.fallback(); };
  return { state, held, release };
}

test.describe('폰 앱 412 · 늦은 출처', () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });

  test('폰 목록이 늦어도 원드라이브 사진은 바로 보이고, 폰 사진은 제자리에 끼워진다([정리] 안 누름)', async ({ page }) => {
    const { state, held, release } = await slowPhone(page);
    await openPhotos(page, 412);
    await expect.poll(() => held.length).toBeGreaterThan(0);
    // 폰이 아직 답하지 않았는데 원드라이브 사진은 그려진다(바닥은 받는 중 회색 줄).
    await expect.poll(() => ids(page)).toEqual(['O1', 'O2', 'O3']);
    await expect(foot(page).locator('[data-wait]')).toHaveCount(1);
    await page.locator('#photosRoot [data-photos-id="O1"]').evaluate(el => { el.dataset.testKeep = '1'; });
    await release();
    // 폰 사진이 정렬 자리에 끼워진다(같은 사진 IMG_9는 원드라이브 것 하나만). [정리] 칸은 열지 않았다.
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1', 'ph:2', 'O2', 'O3', 'ph:4']);
    await expect(page.locator('#photosRoot [data-photos-tidy]')).toBeHidden();
    // 이미 그린 칸은 다시 만들지 않았다(받은 그림 그대로).
    await expect(page.locator('#photosRoot [data-photos-id="O1"]')).toHaveAttribute('data-test-keep', '1');
    // 칸 번호(크게 보기 자리)는 새 순서대로.
    const open = await page.locator('#photosRoot [data-photos-list] [data-photos-open]').evaluateAll(els => els.map(e => e.dataset.photosOpen));
    expect(open).toEqual(['0', '1', '2', '3', '4', '5']);
    await expect(foot(page).locator('[data-wait]')).toHaveCount(0);
    expect(state.errors).toEqual([]);
  });

  test('폰 출처만 켜도 받은 사진이 [정리]를 누르지 않고 바로 그려진다', async ({ page }) => {
    const { state, release } = await slowPhone(page);
    await release();
    await openPhotos(page, 412);
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1', 'ph:2', 'O2', 'O3', 'ph:4']);
    // 원드라이브 끄기 → 폰 사진만.
    await page.locator('#photosRoot [data-photos-src="onedrive"]').click();
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'ph:2', 'ph:9', 'ph:4']);
    await expect(page.locator('#photosRoot [data-photos-tidy]')).toBeHidden();
    expect(state.errors).toEqual([]);
  });
});
