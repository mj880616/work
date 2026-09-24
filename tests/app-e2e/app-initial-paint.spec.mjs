import { test, expect } from '@playwright/test';

test('anonymous workspace shell stays hidden until the public home is ready', async ({ page }) => {
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
  expect(favicon).toBe('./app-icon.svg?v=20260924-unicorn3');
  await expect(page.locator('.brand .brand-icon')).toHaveCount(1);
  await expect(page.locator('.brand .brand-icon')).toHaveAttribute('src','./app-icon.svg?v=20260924-unicorn3');
  await expect(page.locator('.brand .leaf')).toHaveCount(0);

  const legacyAuthDisplay = await page.locator('#authView').evaluate(el => getComputedStyle(el).display);
  expect(legacyAuthDisplay).toBe('none');

  await page.evaluate(() => document.querySelector('#appView')?.classList.remove('hidden'));
  const beforeReady = await page.locator('#appView').evaluate(el => getComputedStyle(el).visibility);
  expect(beforeReady).toBe('hidden');

  releaseApp();
  await expect(page).toHaveURL(/\/app\/$/, { timeout: 10000 });
  await expect(page.locator('body')).toHaveClass(/kptu-public-workspace/);
  await expect(page.locator('#publicLoginBtn')).toBeVisible();
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

  await expect(page.locator('#calendarView')).toHaveClass(/\bhidden\b/);
  await expect(page.locator('#tasksView')).toHaveClass(/\bhidden\b/);
  expect(await page.evaluate(() => window.KPTURouter.current)).toBeNull();

  await page.evaluate(() => {
    const app = document.querySelector('#appView');
    app?.classList.add('kptu-ui-ready');
    window.dispatchEvent(new Event('kptu:app-ui-ready'));
  });

  await expect(page.locator('#tasksView')).not.toHaveClass(/\bhidden\b/);
  await expect(page.locator('#calendarView')).toHaveClass(/\bhidden\b/);
  expect(await page.evaluate(() => window.KPTURouter.current)).toBe('tasks');

  await page.locator('.app-nav .nav-btn[data-view="projects"]').click();
  await expect(page).toHaveURL(/\?view=projects(?:&|$)/);
  await expect(page.locator('#projectsView')).not.toHaveClass(/\bhidden\b/);

  await page.goBack();
  await expect(page).toHaveURL(/\?view=tasks(?:&|$)/);
  await expect(page.locator('#tasksView')).not.toHaveClass(/\bhidden\b/);
  expect(await page.evaluate(() => window.KPTURouter.current)).toBe('tasks');

  await page.locator('.sidebar-brand').click();
  await expect(page.locator('#calendarView')).not.toHaveClass(/\bhidden\b/);
  await expect(page).not.toHaveURL(/[?&]view=/);
  expect(await page.evaluate(() => window.KPTURouter.current)).toBe('calendar');
});

test('legacy home URL normalizes to the calendar default without leaving a broken history entry', async ({ page }) => {
  await page.route('**/app/app.js*', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: ''
  }));

  await page.goto('http://127.0.0.1:8123/app/?view=home', { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ url: 'http://127.0.0.1:8123/app/app-router.js?legacy-home-e2e=1' });
  await page.waitForFunction(() => typeof window.KPTURouter?.go === 'function');

  await page.evaluate(() => {
    const app = document.querySelector('#appView');
    app?.classList.remove('hidden');
    app?.classList.add('kptu-ui-ready');
    window.dispatchEvent(new Event('kptu:app-ui-ready'));
  });

  await expect(page.locator('#calendarView')).not.toHaveClass(/\bhidden\b/);
  await expect(page).not.toHaveURL(/[?&]view=home(?:&|$)/);
  expect(await page.evaluate(() => window.KPTURouter.current)).toBe('calendar');
});


test('authenticated deep link survives a full page reload', async ({ page }) => {
  await page.route('**/app/app.js*', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: ''
  }));

  const bootRouter = async suffix => {
    await page.addScriptTag({ url: `http://127.0.0.1:8123/app/app-router.js?${suffix}` });
    await page.waitForFunction(() => typeof window.KPTURouter?.go === 'function');
    await page.evaluate(() => {
      const app = document.querySelector('#appView');
      app?.classList.remove('hidden');
      app?.classList.add('kptu-ui-ready');
      window.dispatchEvent(new Event('kptu:app-ui-ready'));
    });
  };

  await page.goto('http://127.0.0.1:8123/app/?view=meetings', { waitUntil: 'domcontentloaded' });
  await bootRouter('reload-e2e=1');
  await expect(page.locator('#meetingsView')).not.toHaveClass(/\\bhidden\\b/);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await bootRouter('reload-e2e=2');
  await expect(page.locator('#meetingsView')).not.toHaveClass(/\\bhidden\\b/);
  await expect(page).toHaveURL(/\\?view=meetings(?:&|$)/);
});
