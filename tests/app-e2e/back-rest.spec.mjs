import { test, expect } from '@playwright/test';
import { ANDROID, phonePhotosFixture, openPhotos } from './helpers/phone-photos-fixture.mjs';
// S47-18 UI-뒤로가기겹규칙 2차(요청함 11/01 12:52 명진 재현): 사진 → [정리] → '원드라이브에만' → 목록 → 사진 크게 보기 → 폰 뒤로 = 목록.
// 크게 보기에서 뒤로가기 = 아래로 밀어 내리기와 같은 결과(크게 보기만 닫히고 그 아래 목록·스크롤 그대로).
const ids = page => page.locator('#photosRoot [data-photos-list] [data-photos-open]').evaluateAll(els => els.map(e => e.dataset.photosId));
const nativeBack = page => page.evaluate(() => window.KPTUNativeBack.handle());

test.describe('폰 앱 412 · 사진 정리 뒤로가기', () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });
  test('정리 → 원드라이브에만 → 크게 보기 → 폰 뒤로 = 원드라이브에만 목록', async ({ page }) => {
    const { state } = await phonePhotosFixture(page, { app: true });
    await openPhotos(page, 412);
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1', 'ph:2', 'O2', 'O3', 'ph:4']);
    await page.locator('#photosRoot [data-photos-tidy-chip]').click();
    const only = page.locator('#photosRoot [data-photos-place="onedrive"]');
    await expect(only).toBeVisible();
    await only.click();
    await expect.poll(() => ids(page)).toEqual(['O1', 'O2']);
    await page.locator('#photosRoot [data-photos-id="O2"]').tap();
    const viewer = page.locator('[data-diary-viewer]');
    await expect(viewer).toBeVisible();
    console.log('before', await page.evaluate(() => [navigation.currentEntry.index, JSON.stringify(history.state), location.search]));
    expect(await nativeBack(page)).toBe(true);
    await expect(viewer).toBeHidden();
    await page.waitForTimeout(500);
    console.log('after', await page.evaluate(() => [navigation.currentEntry.index, JSON.stringify(history.state), location.search, KPTURouter.current]));
    await expect(page.locator('#photosView')).toBeVisible();
    await expect.poll(() => ids(page)).toEqual(['O1', 'O2']);
    expect(state.errors).toEqual([]);
  });
});
