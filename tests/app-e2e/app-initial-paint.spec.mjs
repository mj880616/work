import { test, expect } from '@playwright/test';

test('anonymous workspace shell cannot paint before redirect to login', async ({ page }) => {
  let releaseApp;
  let appRequested = false;
  const appHold = new Promise(resolve => { releaseApp = resolve; });

  await page.route('**/app/app.js*', async route => {
    appRequested = true;
    await appHold;
    await route.continue();
  });

  await page.goto('http://127.0.0.1:8123/app/', { waitUntil: 'commit' });
  await expect.poll(() => appRequested, { timeout: 10000 }).toBeTruthy();
  await page.locator('#authView').waitFor({ state: 'attached', timeout: 10000 });
  await page.locator('#appView').waitFor({ state: 'attached', timeout: 10000 });

  const favicon = await page.locator('link[rel="icon"]').getAttribute('href');
  expect(favicon).toMatch(/^\.\/app-icon\.svg\?v=[\w-]+$/);
  const brandIcon = page.locator('.brand .brand-icon');
  await expect(brandIcon).toHaveAttribute('src', /^\.\/app-icon\.svg\?v=[\w-]+$/);
  await expect.poll(() => brandIcon.evaluate(el => el.complete && el.naturalWidth > 0)).toBeTruthy();

  const legacyAuthDisplay = await page.locator('#authView').evaluate(el => getComputedStyle(el).display);
  expect(legacyAuthDisplay).toBe('none');

  await page.evaluate(() => document.querySelector('#appView')?.classList.remove('hidden'));
  const beforeReady = await page.locator('#appView').evaluate(el => getComputedStyle(el).visibility);
  expect(beforeReady).toBe('hidden');

  releaseApp();
  await expect(page).toHaveURL(/\/app\/login\/?\?return=/, { timeout: 10000 });
  await expect(page.locator('#appView')).toHaveCount(0);
});

test('router restores deep links only after explicit app-ui-ready and preserves browser history', async ({ page }) => {
  await page.route('**/app/app.js*', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: ''
  }));

  await page.goto('http://127.0.0.1:8123/app/?view=tasks', { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ url: 'http://127.0.0.1:8123/app/app-router.js?router-ready-e2e=1' });
  await page.waitForFunction(() => typeof window.KPTURouter?.go === 'function');

  await page.evaluate(() => document.querySelector('#appView')?.classList.remove('hidden'));
  await page.waitForTimeout(100);

  await expect(page.locator('#homeView')).not.toHaveClass(/\bhidden\b/);
  await expect(page.locator('#tasksView')).toHaveClass(/\bhidden\b/);
  expect(await page.evaluate(() => window.KPTURouter.current)).toBe('home');

  await page.evaluate(() => {
    const app = document.querySelector('#appView');
    app?.classList.add('kptu-ui-ready');
    window.dispatchEvent(new Event('kptu:app-ui-ready'));
  });

  await expect(page.locator('#tasksView')).not.toHaveClass(/\bhidden\b/);
  await expect(page.locator('#homeView')).toHaveClass(/\bhidden\b/);
  expect(await page.evaluate(() => window.KPTURouter.current)).toBe('tasks');

  await page.locator('.app-nav .nav-btn[data-view="projects"]').click();
  await expect(page).toHaveURL(/\?view=projects(?:&|$)/);
  await expect(page.locator('#projectsView')).not.toHaveClass(/\bhidden\b/);

  await page.goBack();
  await expect(page).toHaveURL(/\?view=tasks(?:&|$)/);
  await expect(page.locator('#tasksView')).not.toHaveClass(/\bhidden\b/);
  expect(await page.evaluate(() => window.KPTURouter.current)).toBe('tasks');

  await page.locator('.topbar .brand').click();
  await expect(page.locator('#homeView')).not.toHaveClass(/\bhidden\b/);
  await expect(page).not.toHaveURL(/[?&]view=/);
  expect(await page.evaluate(() => window.KPTURouter.current)).toBe('home');
});
