// APP-폰알림 N4(설계 docs/design/phone-notifications.md 3절, N-D5): 내 프로필 '폰 알림' 칸.
// - 웹 브라우저(1280·412): 종류 칩 일곱 개(기본 전부 켬)·조용한 시간 두 칸·[시험 알림]·등록된 폰 목록. 칩·시간은 바로 내 프로필 칸(notify_prefs)에 저장.
//   이 폰 줄은 없다(앱에서만). [시험 알림]은 phone-push test, [끊기]는 phone-push unregister(device_id).
// - 폰 앱(412, 앱 다리 흉내): 이 폰 꺼짐 → [시험 알림]이 먼저 push:enable로 켜고(토큰) register 뒤 test. [이 폰 끊기]는 unregister(token) 뒤 push:forget.
// 네트워크 없음(지어낸 서버·지어낸 앱). 토큰은 가짜 글.
import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { signInWithSession } from './helpers/session-login.mjs';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.4';
const TOKEN = 'fake_fcm_token-0123456789abcdefghij:XYZ';

async function boot(page, {app = false, prefs = null, devices = []} = {}) {
  const state = {prefs, devices: devices.map(d => ({...d})), patches: [], push: [], errors: []};
  page.on('pageerror', e => state.errors.push(e.message));
  if (app) {
    await page.addInitScript(token => {
      const listeners = [];
      let on = false;
      window.__pushSent = [];
      const reply = data => setTimeout(() => listeners.forEach(fn => fn({data})), 0);
      window.KPTUAppShell = {
        postMessage(m) {
          m = String(m);
          window.__pushSent.push(m);
          if (m === 'push:hello') reply(on ? 'push:on:' + token : 'push:off');
          if (m === 'push:enable') { on = true; reply('push:on:' + token); }
          if (m === 'push:forget') { on = false; reply('push:off'); }
        },
        addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
      };
    }, TOKEN);
  }
  const user = {id: 'push-user', email: 'push@example.org'}, workspace = {id: 'push-workspace', name: 'QA', slug: 'qa'};
  await page.route('https://xmlkxfjeagycwttklxjw.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    let data = [], status = 200;
    if (path === '/auth/v1/token') data = {access_token: 'qa', refresh_token: 'qa-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user};
    else if (path === '/auth/v1/user') data = user;
    else if (path === '/rest/v1/app_workspace_members') data = [{workspace_id: workspace.id, user_id: user.id, role: 'owner'}];
    else if (path === '/rest/v1/app_workspaces') data = [workspace];
    else if (path === '/rest/v1/app_profiles' && method === 'PATCH') {
      const body = JSON.parse(req.postData() || '{}');
      state.patches.push(body);
      if (body.notify_prefs) state.prefs = body.notify_prefs;
      data = [];
    }
    else if (path === '/rest/v1/app_profiles') data = [{user_id: user.id, display_name: 'QA', notify_prefs: state.prefs}];
    else if (path === '/rest/v1/app_push_devices') {
      // 화면은 토큰 칸을 묻지 않는다(읽을 권한 없음).
      if ((url.searchParams.get('select') || '').includes('fcm_token')) { status = 403; data = {message: 'permission denied'}; }
      else data = state.devices.map(({token, ...rest}) => rest);
    }
    else if (path === '/functions/v1/phone-push') {
      const action = url.searchParams.get('action'), body = JSON.parse(req.postData() || '{}');
      state.push.push({action, body});
      if (action === 'register') {
        let d = state.devices.find(x => x.token === body.token);
        if (!d) { d = {id: 'dev-new', token: body.token, app_version: body.app_version, created_at: new Date().toISOString(), last_seen_at: new Date().toISOString()}; state.devices.unshift(d); }
        data = {ok: true, device: {id: d.id, tail: body.token.slice(-6)}};
      } else if (action === 'unregister') {
        const before = state.devices.length;
        state.devices = state.devices.filter(d => !(body.device_id ? d.id === body.device_id : d.token === body.token));
        data = {ok: true, removed: before - state.devices.length};
      } else if (action === 'test') {
        if (!state.devices.length) { status = 409; data = {ok: false, error: 'NO_DEVICE'}; }
        else data = {ok: true, sent: state.devices.length, failed: 0, revoked: 0};
      } else { status = 400; data = {ok: false, error: 'UNKNOWN_ACTION'}; }
    }
    else if (path.startsWith('/functions/')) data = {connected: false, enabled: false, tasks: [], events: [], calendars: []};
    return route.fulfill({status, contentType: 'application/json', body: JSON.stringify(data)});
  });
  await page.goto(appOrigin + '/app/login/?return=' + encodeURIComponent(appOrigin + '/app/?view=profile'));
  await signInWithSession(page, user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  await expect(page.locator('#profileView')).toBeVisible({timeout: 15000});
  await expect(page.locator('#psPushPanel [data-ps-push-kind]')).toHaveCount(7, {timeout: 15000});
  return state;
}
const panel = page => page.locator('#psPushPanel');
const OLD = {id: 'dev-old', token: 'other_phone_token_0123456789abcdef', app_version: '0.4.4', created_at: '2026-11-01T00:00:00Z', last_seen_at: '2026-11-01T01:20:00Z'};

for (const width of [1280, 412]) test(`웹: 종류 칩 일곱 개·조용한 시간·시험 알림·등록된 폰, 넘치지 않음 (${width}px)`, async ({page}) => {
  await page.setViewportSize({width, height: 900});
  const state = await boot(page, {devices: [OLD]});
  const p = panel(page);
  await expect(p.locator('h3')).toHaveText('폰 알림');
  await expect(p.locator('[data-ps-push-kind]')).toHaveText(['할 일 기한', '원장 약속', '회의 요약', '수집 멈춤', '아침 묶음', '저녁 묶음', '다음 주 준비']);
  for (const chip of await p.locator('[data-ps-push-kind]').all()) await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(p.locator('[data-ps-push-quiet="from"]')).toHaveValue('22:00');
  await expect(p.locator('[data-ps-push-quiet="to"]')).toHaveValue('07:00');
  await expect(p.locator('[data-ps-push-test]')).toHaveText('시험 알림');
  await expect(p.locator('[data-ps-push-phone]')).toHaveCount(0);
  await expect(p.locator('[data-ps-push-devices]')).toHaveText('등록된 폰 1대');
  await expect(p.locator('.ps-todo-room-name')).toHaveText('폰 앱 0.4.4 · 11/01 10:20');
  expect(state.push).toEqual([]);
  expect(state.patches).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  // 종류 칩 한 줄 묶음과 시간 줄이 칸 안에 있다(넘쳐 잘리지 않음).
  const inside = await page.evaluate(() => {
    const box = document.querySelector('#psPushPanel').getBoundingClientRect();
    return [...document.querySelectorAll('#psPushPanel button, #psPushPanel input')].every(el => { const r = el.getBoundingClientRect(); return r.left >= box.left - 1 && r.right <= box.right + 1; });
  });
  expect(inside).toBe(true);
  await p.screenshot({path: `test-results/phone-push-settings-${width}.png`});
  expect(state.errors).toEqual([]);
});

test('웹: 칩·조용한 시간은 바로 내 프로필 칸에만 저장, 시험 알림·끊기는 phone-push', async ({page}) => {
  const state = await boot(page, {prefs: {kinds: {morning: false}}, devices: [OLD]});
  const p = panel(page);
  await expect(p.locator('[data-ps-push-kind="morning"]')).toHaveAttribute('aria-pressed', 'false');
  await p.locator('[data-ps-push-kind="collect_stall"]').click();
  await expect(p.locator('[data-ps-push-state]')).toHaveText('저장했어요');
  await expect(p.locator('[data-ps-push-kind="collect_stall"]')).toHaveAttribute('aria-pressed', 'false');
  expect(state.prefs).toEqual({kinds: {task_due: true, commitment: true, meeting_done: true, collect_stall: false, morning: false, evening: true, next_week: true}, quiet: {from: '22:00', to: '07:00'}});
  await p.locator('[data-ps-push-quiet="from"]').fill('23:00');
  await expect.poll(() => state.prefs?.quiet?.from).toBe('23:00');
  expect(state.patches.every(b => Object.keys(b).join() === 'notify_prefs')).toBe(true);
  await p.locator('[data-ps-push-test]').click();
  await expect(p.locator('[data-ps-push-result]')).toHaveText('시험 알림을 1대에 보냈어요');
  await p.locator('[data-ps-push-remove="dev-old"]').click();
  await expect(p.locator('[data-ps-push-devices]')).toHaveText('등록된 폰 없음');
  expect(state.push.map(x => x.action)).toEqual(['test', 'unregister']);
  expect(state.push[1].body).toEqual({device_id: 'dev-old'});
  await p.locator('[data-ps-push-test]').click();
  await expect(p.locator('[data-ps-push-state]')).toHaveText('등록된 폰이 없어요');
  expect(state.errors).toEqual([]);
});

test.describe('폰 앱', () => {
  test.use({viewport: {width: 412, height: 915}, userAgent: ANDROID, hasTouch: true, isMobile: true});

  test('이 폰 꺼짐 → [시험 알림]이 알림 권한을 묻고 등록한 뒤 보낸다, [이 폰 끊기]는 서버에서 지우고 앱 토큰도 지운다', async ({page}) => {
    const state = await boot(page, {app: true});
    const p = panel(page);
    await expect(p.locator('[data-ps-push-phone="off"]')).toContainText('꺼짐');
    await expect(p.locator('[data-ps-push-enable]')).toHaveText('이 폰에서 받기');
    await expect(p.locator('[data-ps-push-devices]')).toHaveText('등록된 폰 없음');
    await p.locator('[data-ps-push-test]').click();
    await expect(p.locator('[data-ps-push-result]')).toHaveText('시험 알림을 1대에 보냈어요');
    await expect(p.locator('[data-ps-push-phone="on"]')).toContainText('켜짐');
    await expect(p.locator('.ps-todo-room-name')).toContainText('이 폰');
    const actions = state.push.map(x => x.action);
    expect(actions.slice(-2)).toEqual(['register', 'test']);
    const reg = state.push.find(x => x.action === 'register');
    expect(reg.body).toEqual({token: TOKEN, app_version: '0.4.4'});
    expect(await page.evaluate(() => window.__pushSent.filter(m => m.startsWith('push:')))).toContain('push:enable');
    // 토큰은 화면에 보이지 않는다.
    await expect(p).not.toContainText(TOKEN);
    await p.locator('[data-ps-push-forget]').click();
    await expect(p.locator('[data-ps-push-phone="off"]')).toContainText('꺼짐');
    await expect(p.locator('[data-ps-push-devices]')).toHaveText('등록된 폰 없음');
    const un = state.push.filter(x => x.action === 'unregister');
    expect(un).toEqual([{action: 'unregister', body: {token: TOKEN}}]);
    expect(await page.evaluate(() => window.__pushSent.at(-1))).toBe('push:forget');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await p.screenshot({path: 'test-results/phone-push-settings-app-412.png'});
    expect(state.errors).toEqual([]);
  });
});
