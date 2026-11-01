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
    expect(await nativeBack(page)).toBe(true);
    await expect(viewer).toBeHidden();
    await expect(page.locator('#photosView')).toBeVisible();
    await expect.poll(() => ids(page)).toEqual(['O1', 'O2']);
    expect(state.errors).toEqual([]);
  });
});

// 크게 보기 뒤로가기 = 아래로 밀어 내리기와 같은 결과: 크게 보기만 닫히고 같은 목록·같은 스크롤 위치(1280 PC 브라우저 뒤로 포함).
for (const width of [412, 1280]) test.describe(`크게 보기 뒤로 ${width}`, () => {
  test.use(width === 412 ? { viewport: { width: 412, height: 500 }, userAgent: ANDROID, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 500 } });
  test('뒤로 = 내리기(목록·스크롤 그대로)', async ({ page }) => {
    const { state } = await phonePhotosFixture(page, { app: width === 412 });
    await openPhotos(page, width);
    await expect.poll(async () => (await ids(page)).length).toBeGreaterThan(2);
    const before = await ids(page);
    const last = page.locator('#photosRoot [data-photos-list] [data-photos-open]').last();
    await last.scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => window.scrollY);
    const viewer = page.locator('[data-diary-viewer]');
    // ① ✕(내리기와 같은 닫기)로 닫은 결과
    await last.click(); await expect(viewer).toBeVisible();
    await viewer.locator('[data-diary-viewer-close]').click(); await expect(viewer).toBeHidden();
    const closedY = await page.evaluate(() => window.scrollY), closedAt = await page.evaluate(() => navigation.currentEntry.index);
    // ② 뒤로가기로 닫은 결과가 같다
    await last.click(); await expect(viewer).toBeVisible();
    if (width === 412) await nativeBack(page); else await page.goBack();
    await expect(viewer).toBeHidden();
    await expect(page.locator('#photosView')).toBeVisible();
    expect(await ids(page)).toEqual(before);
    expect(await page.evaluate(() => window.scrollY)).toBe(closedY);
    expect(closedY).toBe(y);
    expect(await page.evaluate(() => navigation.currentEntry.index)).toBe(closedAt);
    expect(state.errors).toEqual([]);
  });
});

// 겹 두 개를 같은 순간에 닫으면 두 기록 칸이 한 번에 정리된다: 다음 뒤로가기가 건너뛰지 않고 바로 앞 화면(사진 화면 전 = 홈)으로.
test.describe('라우터 겹 동시 닫기', () => {
  test.use({ viewport: { width: 412, height: 915 } });
  test('겹 두 개 동시 닫기 뒤 뒤로가기 한 번 = 한 칸', async ({ page }) => {
    await phonePhotosFixture(page);
    await openPhotos(page, 412);
    const start = await page.evaluate(() => navigation.currentEntry.index);
    const r = await page.evaluate(async () => {
      const closed = [];
      const a = KPTURouter.layer.open('t-a', { close: () => { closed.push('a'); return true; } });
      const b = KPTURouter.layer.open('t-b', { close: () => { closed.push('b'); return true; } });
      const mid = navigation.currentEntry.index;
      await Promise.all([b.close(), a.close()]);
      return { mid, after: navigation.currentEntry.index, closed };
    });
    expect(r.mid).toBe(start + 2);
    expect(r.after).toBe(start);
    expect(r.closed).toEqual([]);
    // 아래 겹부터 닫아도 같다.
    const r2 = await page.evaluate(async () => {
      const a = KPTURouter.layer.open('t-a', { close: () => true });
      KPTURouter.layer.open('t-b', { close: () => true });
      const b = KPTURouter.layer.open('t-b', { close: () => true });
      await Promise.all([a.close(), b.close()]);
      return navigation.currentEntry.index;
    });
    expect(r2).toBe(start);
    // 다음 뒤로가기: 한 칸(사진 화면 → 그 앞 화면). 건너뛰지 않는다.
    await page.goBack();
    await expect.poll(() => page.evaluate(() => navigation.currentEntry.index)).toBe(start - 1);
  });
});

// 폰 앱 맨 처음 화면(홈)에서 더 닫을 것이 없을 때 뒤로가기 = 앱 뒤로 보내기('share:back', 앱이 moveTaskToBack).
test.describe('폰 앱 홈 뒤로', () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });
  test('홈 첫 화면 = 앱에 share:back, 다른 화면에서는 보내지 않음', async ({ page }) => {
    await phonePhotosFixture(page, { app: true });
    await expect(page.locator('#homeView')).toBeVisible();
    const sent = () => page.evaluate(() => window.__photoSent.filter(m => m === 'share:back').length);
    await openPhotos(page, 412);
    expect(await nativeBack(page)).toBe(true);
    await expect(page.locator('#homeView')).toBeVisible();
    expect(await sent()).toBe(0);
    await expect.poll(() => page.evaluate(() => KPTURouter.canBack())).toBe(false);
    expect(await nativeBack(page)).toBe(true);
    expect(await sent()).toBe(1);
    await expect(page.locator('#homeView')).toBeVisible();
  });
});
