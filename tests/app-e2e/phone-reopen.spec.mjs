// APP-다시열림(요청함 11/01 13:43): 폰 앱이 쓰는 중에 웹2 화면을 통째로 다시 열지 않게.
// - 폰 앱(앱 다리 흉내): 알림·링크로 들어오면 앱이 KPTUAppNav.open(질의)를 먼저 부른다 → 화면을 다시 불러오지 않고 자리만 옮긴다.
//   모르는 질의(공유 받기 등)는 false → 앱이 지금처럼 통째로 연다.
// - 내 프로필 '다시 연 기록'(폰 앱만): 펼치면 앱에 reopen:list를 묻고 종류·시각만 보인다.
// - 새로고침으로 다시 열 때는 큰 확인 카드 대신 맨 위 가는 줄(boot-quiet)이고, 앱에는 까닭(reopen:mark:…)을 먼저 알린다.
// 네트워크 없음(지어낸 서버·지어낸 앱).
import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { signInWithSession } from './helpers/session-login.mjs';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.5';

async function boot(page, {app = false, view = 'home'} = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(isApp => {
    // 첫 화면 칸이 조용한 줄(boot-quiet)로 보인 적이 있는지 기록(화면 열 때마다 새로).
    window.__bootQuiet = false;
    new MutationObserver(() => { if (document.querySelector('#bootView.boot-quiet')) window.__bootQuiet = true; })
      .observe(document, {subtree: true, attributes: true, attributeFilter: ['class'], childList: true});
    if (!isApp) return;
    const listeners = [];
    const sent = JSON.parse(sessionStorage.getItem('__reopenSent') || '[]');
    window.__reopenSent = sent;
    window.KPTUAppShell = {
      postMessage(m) {
        m = String(m);
        sent.push(m);
        sessionStorage.setItem('__reopenSent', JSON.stringify(sent));
        if (m === 'reopen:list') setTimeout(() => listeners.forEach(fn => fn({data: 'reopen:list:start@1761955200000,pull@1761955500000'})), 0);
      },
      addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    };
  }, app);
  const user = {id: 'reopen-user', email: 'reopen@example.org'}, workspace = {id: 'reopen-workspace', name: 'QA', slug: 'qa'};
  await page.route('https://xmlkxfjeagycwttklxjw.supabase.co/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    let data = [];
    if (path === '/auth/v1/token') data = {access_token: 'qa', refresh_token: 'qa-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user};
    else if (path === '/auth/v1/user') data = user;
    else if (path === '/rest/v1/app_workspace_members') data = [{workspace_id: workspace.id, user_id: user.id, role: 'owner'}];
    else if (path === '/rest/v1/app_workspaces') data = [workspace];
    else if (path === '/rest/v1/app_profiles') data = [{user_id: user.id, display_name: 'QA'}];
    else if (path.startsWith('/functions/')) data = {connected: false, enabled: false, tasks: [], events: [], calendars: []};
    return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data)});
  });
  await page.goto(appOrigin + '/app/login/?return=' + encodeURIComponent(appOrigin + '/app/?view=' + view));
  await signInWithSession(page, user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  return errors;
}

test.describe('폰 앱', () => {
  test.use({userAgent: ANDROID, viewport: {width: 412, height: 860}});

  test('알림·링크로 들어오면 다시 불러오지 않고 자리만 옮긴다, 모르는 주소는 앱에 맡긴다', async ({page}) => {
    const errors = await boot(page, {app: true});
    await page.waitForFunction(() => typeof window.KPTUAppNav?.open === 'function');
    await page.evaluate(() => { window.__samePage = true; });
    // 앱 MainActivity.NAV_SCRIPT와 같은 부름.
    expect(await page.evaluate(() => window.KPTUAppNav.open('?view=calendar'))).toBe(true);
    await expect(page.locator('#calendarView')).toBeVisible({timeout: 15000});
    await expect(page).toHaveURL(/\?view=calendar/);
    expect(await page.evaluate(() => window.__samePage)).toBe(true);
    expect(await page.evaluate(() => window.KPTUAppNav.open(''))).toBe(true);
    await expect(page.locator('#homeView')).toBeVisible();
    expect(await page.evaluate(() => window.__samePage)).toBe(true);
    expect(await page.evaluate(() => window.KPTUAppNav.open('?view=basket&share=abc'))).toBe(false);
    expect(await page.evaluate(() => window.KPTUAppNav.open("?view=x');alert(1)//"))).toBe(false);
    expect(errors).toEqual([]);
  });

  test("내 프로필 '다시 연 기록': 접힌 채로 있다가 펼치면 종류·시각만 보인다", async ({page}) => {
    await boot(page, {app: true, view: 'profile'});
    const panel = page.locator('#psReopenPanel');
    await expect(panel).toBeVisible({timeout: 15000});
    await expect(panel.locator('summary')).toContainText('다시 연 기록');
    expect(await page.evaluate(() => window.__reopenSent.includes('reopen:list'))).toBe(false);
    await panel.locator('summary').click();
    await expect(panel.locator('.ps-reopen-list li')).toHaveCount(2);
    await expect(panel.locator('.ps-reopen-list li').first()).toContainText('당겨서 새로고침');
    await expect(panel.locator('.ps-reopen-list li').last()).toContainText('앱 켬');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });

  test('새로고침으로 다시 열면 큰 확인 카드 대신 맨 위 가는 줄, 처음 열 때는 카드 그대로', async ({page}) => {
    await boot(page, {app: true});
    expect(await page.evaluate(() => window.__bootQuiet)).toBe(false);
    await page.reload();
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, {timeout: 15000});
    expect(await page.evaluate(() => window.__bootQuiet)).toBe(true);
    // 앱 화면이 열리면 첫 화면 칸은 숨는다(내용은 로그인 확인 뒤에만).
    await expect(page.locator('#bootView')).toBeHidden();
  });
});

test('웹 브라우저: 다시 연 기록 칸·화면 안 이동 길이 없다', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 900});
  await boot(page, {view: 'profile'});
  await expect(page.locator('#profileView')).toBeVisible({timeout: 15000});
  await page.waitForTimeout(300);
  await expect(page.locator('#psReopenPanel')).toHaveCount(0);
  expect(await page.evaluate(() => typeof window.KPTUAppNav)).toBe('undefined');
});
