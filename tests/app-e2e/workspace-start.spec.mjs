// MULTI-노조사용자 ②-4 (S50-19): 접근 거부 화면의 [내 작업공간 만들기].
// 서버 답(app_workspace_start_status)이 '스위치 켜짐 + 내 작업공간 없음'일 때만 버튼이 생기고, 누르면 인자 없이 app_workspace_start를 한 번 부른 뒤 다시 연다.
// 스위치가 꺼져 있거나 답이 이상하면 지금처럼 접근 거부·로그아웃만 보인다. 서버·Google 연결 없음(모두 가짜 답).
import { appOrigin } from './helpers/test-origin.mjs';
import {test, expect} from '@playwright/test';
import { signInWithSession } from './helpers/session-login.mjs';
import {loginEntry} from './helpers/login-entry.mjs';

const sb = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const base = `${appOrigin}/app/`;

async function mock(page, {status, start, startDelay = 0}) {
  const calls = [];
  await page.route(`${sb}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    calls.push({path, method: request.method(), body: request.postData()});
    const json = (data, code = 200) => route.fulfill({status: code, contentType: 'application/json', body: JSON.stringify(data)});
    if (path === '/auth/v1/token') return json({access_token: 'newcomer-access', refresh_token: 'newcomer-refresh',
      expires_at: Math.floor(Date.now()/1000)+3600, user: {id: 'newcomer-user', user_metadata: {display_name: 'Test'}}});
    if (path === '/auth/v1/user') return json({id: 'newcomer-user'});
    if (path === '/rest/v1/rpc/app_workspace_start_status') return json(status());
    if (path === '/rest/v1/rpc/app_workspace_start') {
      if (startDelay) await new Promise(r => setTimeout(r, startDelay));
      const [data, code] = start();
      return json(data, code);
    }
    return json([]);
  });
  return calls;
}
const startCalls = calls => calls.filter(x => x.path === '/rest/v1/rpc/app_workspace_start');

for (const width of [390, 1280]) {
  test(`switch on: [내 작업공간 만들기] appears, sends one empty call and reopens at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 844});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let open = true;
    const calls = await mock(page, {status: () => ({open, has_workspace: false}),
      start: () => { open = false; return [{ok: true, created: true, workspace_id: '31000000-0000-4000-8000-000000000001'}, 200]; }, startDelay: 300});
    await page.goto(loginEntry(base));
    await signInWithSession(page, 'newcomer@example.test');
    const card = page.locator('#accessDeniedView');
    await expect(card).toBeVisible();
    const button = card.locator('[data-workspace-start]');
    await expect(button).toHaveText('내 작업공간 만들기');
    await expect(card.locator('button:visible')).toHaveText(['내 작업공간 만들기', '로그아웃']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: test.info().outputPath(`workspace-start-${width}.png`), fullPage: true});
    const reopened = page.waitForEvent('load');
    await button.click();
    await button.click({force: true}).catch(() => {});
    await reopened;
    expect(startCalls(calls)).toHaveLength(1);
    expect(startCalls(calls)[0].method).toBe('POST');
    expect(JSON.parse(startCalls(calls)[0].body || '{}')).toEqual({});
    // 다시 연 뒤(이 가짜 서버에서는 스위치가 꺼짐) 버튼 없이 접근 거부만.
    await expect(page.locator('#accessDeniedView')).toBeVisible();
    await expect.poll(() => calls.filter(x => x.path === '/rest/v1/rpc/app_workspace_start_status').length).toBe(2);
    await expect(page.locator('[data-workspace-start]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

const QUIET_ANSWERS = [
  ['switch off', {open: false, has_workspace: false}],
  ['already has a workspace', {open: true, has_workspace: true}],
  ['empty answer', null],
  ['odd answer', {open: 'true', has_workspace: false}],
];
for (const [label, answer] of QUIET_ANSWERS) {
  test(`${label}: no button, nothing sent to create`, async ({page}) => {
    const calls = await mock(page, {status: () => answer, start: () => [{ok: true, workspace_id: 'x'}, 200]});
    await page.goto(loginEntry(base));
    await signInWithSession(page, 'newcomer@example.test');
    await expect(page.locator('#accessDeniedView')).toBeVisible();
    await expect.poll(() => calls.filter(x => x.path === '/rest/v1/rpc/app_workspace_start_status').length).toBe(1);
    await expect(page.locator('[data-workspace-start]')).toHaveCount(0);
    await expect(page.locator('main button:visible')).toHaveText(['로그아웃']);
    expect(startCalls(calls)).toHaveLength(0);
  });
}

test('server refuses: short message, button usable again, no reopen', async ({page}) => {
  const calls = await mock(page, {status: () => ({open: true, has_workspace: false}),
    start: () => [{code: '42501', message: 'SIGNUP_CLOSED'}, 403]});
  await page.goto(loginEntry(base));
  await signInWithSession(page, 'newcomer@example.test');
  const button = page.locator('[data-workspace-start]');
  await expect(button).toBeVisible();
  let reloaded = false;
  page.on('load', () => { reloaded = true; });
  await button.click();
  await expect(page.locator('.workspace-start-note')).toHaveText('지금은 새 작업공간을 만들 수 없어요.');
  await expect(button).toBeEnabled();
  expect(startCalls(calls)).toHaveLength(1);
  expect(reloaded).toBe(false);
});
