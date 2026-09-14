import { test, expect } from '@playwright/test';

test('legacy auth screen and workspace shell cannot paint before the current UI is ready', async ({ page }) => {
  let releaseApp;
  let appRequested = false;
  const appHold = new Promise(resolve => { releaseApp = resolve; });

  await page.route('**/app/app.js*', async route => {
    appRequested = true;
    await appHold;
    await route.continue();
  });

  await page.goto('http://127.0.0.1:8123/app/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => appRequested, { timeout: 10000 }).toBeTruthy();

  const legacyAuthDisplay = await page.locator('#authView').evaluate(el => getComputedStyle(el).display);
  expect(legacyAuthDisplay).toBe('none');

  await page.evaluate(() => document.querySelector('#appView')?.classList.remove('hidden'));
  const beforeReady = await page.locator('#appView').evaluate(el => getComputedStyle(el).visibility);
  expect(beforeReady).toBe('hidden');

  releaseApp();
  await page.waitForFunction(() => typeof window.__KPTU_MARK_APP_UI_READY__ === 'function');
  await page.evaluate(() => window.__KPTU_MARK_APP_UI_READY__?.());
  const afterReady = await page.locator('#appView').evaluate(el => getComputedStyle(el).visibility);
  expect(afterReady).toBe('visible');
});
