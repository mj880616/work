import { appOrigin } from './helpers/test-origin.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import { test, expect } from '@playwright/test';

async function installAuthenticatedRouterContext(page) {
  await page.evaluate(() => {
    const context={user:{id:'router-user'},membership:{role:'owner'},workspace:{id:'router-workspace'}};
    window.__KPTU_BOOT_CONTEXT__=context;
    window.KPTURuntime={session:{read:()=>({access_token:'router-access',user:context.user})},context:{read:()=>context}};
    document.body.classList.remove('kptu-session-pending');
    const app=document.querySelector('#appView');
    if(app)app.inert=false;
  });
}

test('anonymous workspace shell stays hidden until the dedicated login is ready', async ({ page }) => {
  let releaseApp;
  let appRequested = false;
  const appHold = new Promise(resolve => { releaseApp = resolve; });

  await page.route('**/app/app.js*', async route => {
    appRequested = true;
    await appHold;
    await route.continue();
  });

  await page.goto(`${appOrigin}/app/`, { waitUntil: 'commit' });
  await expect.poll(() => appRequested, { timeout: 10000 }).toBeTruthy();
  await page.locator('#appView').waitFor({ state: 'attached', timeout: 10000 });
  await expect(page.locator('#authView')).toHaveCount(0);

  // UI-디자인손질 7: the SVG favicon first, a 32px PNG as a fallback for browsers without SVG favicons.
  await expect(page.locator('link[rel="icon"]')).toHaveCount(2);
  const favicon = await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute('href');
  expect(favicon).toBe('./app-icon.svg');
  await expect(page.locator('.brand .brand-icon')).toHaveCount(1);
  await expect(page.locator('.brand .brand-icon')).toHaveAttribute('src','./app-icon.svg');
  await expect(page.locator('.brand .leaf')).toHaveCount(0);


  await page.evaluate(() => document.querySelector('#appView')?.classList.remove('hidden'));
  const beforeReady = await page.locator('#appView').evaluate(el => getComputedStyle(el).visibility);
  expect(beforeReady).toBe('hidden');

  releaseApp();
  await expect(page).toHaveURL(/\/app\/login\/?\?return=/, { timeout: 10000 });
  await expect(page.locator('.login-shell')).toBeVisible();
  await expect(page.locator('#appView,.app-nav,#publicLoginBtn')).toHaveCount(0);
});

test('router restores deep links only after explicit app-ui-ready and preserves browser history', async ({ page }) => {
  await page.route('**/app/app.js*', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: ''
  }));

  await page.goto(`${appOrigin}/app/?view=tasks`, { waitUntil: 'domcontentloaded' });
  await installAuthenticatedRouterContext(page);
  await page.addScriptTag({ url: `${appOrigin}/app/app-router.js?router-ready-e2e=1` });
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

  // MTG-프로젝트합치기 3단계: [프로젝트] 메뉴가 없다. 이 시험은 라우터만 띄우므로(app.js 비움) 사업 보고 ⋯ 처리기가 없어 라우터로 바로 연다.
  // MTG-프로젝트합치기 ①: projects는 화면이 아니라 사업 보고 위 창이다. go('projects')는 사업 보고(?view=reports)로 가고 창은 area-window.js가 띄운다.
  await page.evaluate(() => window.KPTURouter.go('projects', {source: 'delegated'}));
  await expect(page).toHaveURL(/\?view=reports(?:&|$)/);
  await expect(page.locator('#meetingsView')).not.toHaveClass(/\bhidden\b/);

  await page.goBack();
  await expect(page).toHaveURL(/\?view=tasks(?:&|$)/);
  await expect(page.locator('#tasksView')).not.toHaveClass(/\bhidden\b/);
  expect(await page.evaluate(() => window.KPTURouter.current)).toBe('tasks');

  await page.locator('.sidebar-brand').click();
  await expect(page.locator('#homeView')).not.toHaveClass(/\bhidden\b/);
  expect(new URL(page.url()).searchParams.get('view')).toBeNull();
  expect(await page.evaluate(() => window.KPTURouter.current)).toBe('home');
});

test('explicit home URL opens home without leaving a broken history entry', async ({ page }) => {
  await page.route('**/app/app.js*', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: ''
  }));

  await page.goto(`${appOrigin}/app/?view=home`, { waitUntil: 'domcontentloaded' });
  await installAuthenticatedRouterContext(page);
  await page.addScriptTag({ url: `${appOrigin}/app/app-router.js?legacy-home-e2e=1` });
  await page.waitForFunction(() => typeof window.KPTURouter?.go === 'function');

  await page.evaluate(() => {
    const app = document.querySelector('#appView');
    app?.classList.remove('hidden');
    app?.classList.add('kptu-ui-ready');
    window.dispatchEvent(new Event('kptu:app-ui-ready'));
  });

  await expect(page.locator('#homeView')).not.toHaveClass(/\bhidden\b/);
  await expect(page).toHaveURL(/[?&]view=home(?:&|$)/);
  expect(await page.evaluate(() => window.KPTURouter.current)).toBe('home');
});


test('authenticated deep link survives a full page reload', async ({ page }) => {
  await page.route('**/app/app.js*', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: ''
  }));

  const bootRouter = async suffix => {
    await installAuthenticatedRouterContext(page);
    await page.addScriptTag({ url: `${appOrigin}/app/app-router.js?${suffix}` });
    await page.waitForFunction(() => typeof window.KPTURouter?.go === 'function');
    await page.evaluate(() => {
      const app = document.querySelector('#appView');
      app?.classList.remove('hidden');
      app?.classList.add('kptu-ui-ready');
      window.dispatchEvent(new Event('kptu:app-ui-ready'));
    });
  };

  await page.goto(`${appOrigin}/app/?view=meetings`, { waitUntil: 'domcontentloaded' });
  await bootRouter('reload-e2e=1');
  await expect(page.locator('#meetingsView')).not.toHaveClass(/\\bhidden\\b/);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await bootRouter('reload-e2e=2');
  await expect(page.locator('#meetingsView')).not.toHaveClass(/\\bhidden\\b/);
  await expect(page).toHaveURL(/\\?view=meetings(?:&|$)/);
});
