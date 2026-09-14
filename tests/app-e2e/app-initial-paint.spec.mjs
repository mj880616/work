import { test, expect } from '@playwright/test';

test('workspace shell is not paintable before the final UI readiness gate opens', async ({ page }) => {
  let releaseLoader;
  let loaderRequested = false;
  const loaderHold = new Promise(resolve => { releaseLoader = resolve; });

  await page.route('**/app/loader-v2.js*', async route => {
    loaderRequested = true;
    await loaderHold;
    await route.continue();
  });

  await page.goto('http://127.0.0.1:8123/app/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => loaderRequested, { timeout: 10000 }).toBeTruthy();

  await page.evaluate(() => document.querySelector('#appView')?.classList.remove('hidden'));
  const beforeReady = await page.locator('#appView').evaluate(el => getComputedStyle(el).visibility);
  expect(beforeReady).toBe('hidden');

  await page.evaluate(() => window.__KPTU_MARK_APP_UI_READY__?.());
  const afterReady = await page.locator('#appView').evaluate(el => getComputedStyle(el).visibility);
  expect(afterReady).toBe('visible');

  releaseLoader();
});
