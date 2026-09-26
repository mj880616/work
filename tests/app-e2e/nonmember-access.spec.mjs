import {test, expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';

const sb = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const base = 'http://127.0.0.1:8123/app/';

for (const width of [390, 1280]) {
  test(`nonmember gets only denial and logout, including legacy invite at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 844});
    const calls = [], errors = [], modules = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.resourceType()==='script' && request.url().includes('/app/')) modules.push(new URL(request.url()).pathname);
    });
    await page.route(`${sb}/**`, route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      calls.push({path, method: request.method()});
      const data = path === '/auth/v1/token' ? {
        access_token: 'nonmember-access', refresh_token: 'nonmember-refresh',
        expires_at: Math.floor(Date.now()/1000)+3600,
        user: {id: 'nonmember-user', user_metadata: {display_name: 'Test'}}
      } : path === '/auth/v1/user' ? {id: 'nonmember-user'} : [];
      return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data)});
    });
    await page.goto(loginEntry(base+'?invite=retired-token&view=team&focus=access-requests'));
    await page.locator('#emailAuthToggle').click();
    await expect(page.locator('[data-auth-tab="signup"],#inviteNotice')).toHaveCount(0);
    await page.locator('#authEmail').fill('nonmember@example.test');
    await page.locator('#authPassword').fill('synthetic-password');
    await page.locator('#authSubmit').click();
    await expect(page.locator('#accessDeniedView')).toBeVisible();
    await expect(page.locator('#accessDeniedView')).toHaveText('접근 권한이 없습니다 로그아웃');
    await expect(page.locator('main button:visible')).toHaveText(['로그아웃']);
    await expect(page.locator('main input:visible,main a:visible')).toHaveCount(0);
    await expect(page.locator('#appView')).toBeHidden();
    await expect(page.locator('#bootstrapView,#aaPending,#bootstrapBtn,#authView')).toHaveCount(0);
    expect(calls.filter(x=>x.path.startsWith('/rest/v1/')).map(x=>x.path)).toEqual(['/rest/v1/app_workspace_members']);
    expect(calls.some(x=>x.path.includes('/rpc/')||x.path.includes('/signup')||x.path.includes('/functions/'))).toBe(false);
    expect(modules.some(x=>/access-approval|view-loader|project-system|calendar-month-view/.test(x))).toBe(false);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:test.info().outputPath('nonmember.png'),fullPage:true});
    await page.reload();
    await expect(page.locator('#accessDeniedView')).toBeVisible();
    await page.locator('#accessDeniedLogoutBtn').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/app\/login\//);
    expect(calls.filter(x=>x.path==='/auth/v1/logout')).toHaveLength(1);
    await expect(page.locator('#emailAuthToggle')).toBeVisible();
    await page.waitForFunction(()=>window.KPTURuntime?.session);
    expect(await page.evaluate(()=>window.KPTURuntime.session.read())).toBeNull();
    expect(errors).toEqual([]);
  });
}
