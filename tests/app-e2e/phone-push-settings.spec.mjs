// APP-폰알림 N4(설계 docs/design/phone-notifications.md 3절, N-D5): 내 프로필 '폰 알림' 칸.
// - 웹 브라우저(1280·412): 종류 칩 다섯 개(기본 전부 켬, S62-27에서 '원장 약속'·'다음 주 준비'를 뺐다)·조용한 시간 두 칸·[시험 알림]·등록된 폰 목록. 칩·시간은 바로 내 프로필 칸(notify_prefs)에 저장.
//   이 폰 줄은 없다(앱에서만). [시험 알림]은 phone-push test, [끊기]는 phone-push unregister(device_id).
// - 폰 앱(412, 앱 다리 흉내): 이 폰 꺼짐 → [시험 알림]이 먼저 push:enable로 켜고(토큰) register 뒤 test. [이 폰 끊기]는 unregister(token) 뒤 push:forget.
// 네트워크 없음(지어낸 서버·지어낸 앱). 토큰은 가짜 글.
import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { signInWithSession } from './helpers/session-login.mjs';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.4';
const TOKEN = 'fake_fcm_token-0123456789abcdefghij:XYZ';

// MULTI-처음쓰는사람 ⑤: features = 서버 운영자 기능 답(app_my_features). 기본은 운영자(통화·텔레그램) — 칩 다섯 개. 새 계정은 [].
async function boot(page, {app = false, prefs = null, devices = [], features = ['calls', 'telegram'], chips = 6, aiMonth = null} = {}) {
  const state = {prefs, devices: devices.map(d => ({...d})), patches: [], push: [], reads: [], errors: []};
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
    else if (path === '/rest/v1/rpc/app_my_features') data = features;
    else if (path === '/functions/v1/ai-assist') data = aiMonth || {ok: false};
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
      // UI-앱안알림 4·5(S47-40): 알림 줄(notices)·최근 알림 7일(recent) 읽기는 따로 센다(이 시험은 설정 칸의 쓰기 호출만 본다).
      if (action === 'notices' || action === 'recent') {
        state.reads.push(action);
        return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({ok: true, items: []})});
      }
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
  // S71-36 PROFILE-설정화면: 내 프로필 '알림 설정' 장(?view=profile&pane=push)으로 바로.
  await page.goto(appOrigin + '/app/login/?return=' + encodeURIComponent(appOrigin + '/app/?view=profile&pane=push'));
  await signInWithSession(page, user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  await expect(page.locator('#profileView [data-ps-page="push"]')).toBeVisible({timeout: 15000});
  await expect(page.locator('#psPushPanel [data-ps-push-kind]')).toHaveCount(chips, {timeout: 15000});
  return state;
}
const panel = page => page.locator('#psPushPanel');
// 종류 줄: 이름(.sl-label)·회색 설명·스위치(켜짐 = 받음). 줄 전체를 눌러 켜고 끈다.
const kindRow = (p, key) => p.locator(`label:has([data-ps-push-kind="${key}"])`);
const openFold = (p, key) => p.locator(`[data-ps-push-fold="${key}"] > summary`).click();
const OLD = {id: 'dev-old', token: 'other_phone_token_0123456789abcdef', app_version: '0.4.4', created_at: '2026-11-01T00:00:00Z', last_seen_at: '2026-11-01T01:20:00Z'};

for (const width of [1280, 412]) test(`웹: 종류 칩 여섯 개(노트 알림 포함)·조용한 시간·시험 알림·등록된 폰, 넘치지 않음 (${width}px)`, async ({page}) => {
  await page.setViewportSize({width, height: 900});
  const state = await boot(page, {devices: [OLD]});
  const p = panel(page);
  await expect(page.locator('#profileView [data-ps-page="push"] .sl-page-title')).toHaveText('알림 설정');
  await expect(p.locator('label:has([data-ps-push-kind]) .sl-label')).toHaveText(['할 일 기한', '회의 요약', '수집 멈춤', '아침 묶음', '저녁 묶음', '노트 알림']);
  for (const sw of await p.locator('[data-ps-push-kind]').all()) await expect(sw).toBeChecked();
  await expect(p.locator('[data-ps-push-quiet-sum]')).toHaveText('22:00–07:00');
  await openFold(p, 'quiet');
  await expect(p.locator('[data-ps-push-quiet="from"]')).toHaveValue('22:00');
  await expect(p.locator('[data-ps-push-quiet="to"]')).toHaveValue('07:00');
  await expect(p.locator('[data-ps-push-test] .sl-label')).toHaveText('시험 알림 보내기');
  await expect(p.locator('[data-ps-push-phone]')).toHaveCount(0);
  await expect(p.locator('[data-ps-push-devices]')).toHaveText('1대');
  await openFold(p, 'devices');
  await expect(p.locator('[data-ps-push-fold="devices"] .sl-fold-body .sl-label')).toHaveText('폰 앱 0.4.4 · 11/01 10:20');
  expect(state.push).toEqual([]);
  expect(state.patches).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  // 종류 칩 한 줄 묶음과 시간 줄이 칸 안에 있다(넘쳐 잘리지 않음).
  const inside = await page.evaluate(() => {
    const box = document.querySelector('#psPushPanel').getBoundingClientRect();
    return [...document.querySelectorAll('#psPushPanel button, #psPushPanel input')].filter(el => el.getClientRects().length).every(el => { const r = el.getBoundingClientRect(); return r.left >= box.left - 1 && r.right <= box.right + 1; });
  });
  expect(inside).toBe(true);
  await p.screenshot({path: `test-results/phone-push-settings-${width}.png`});
  expect(state.errors).toEqual([]);
});

test('웹: 칩·조용한 시간은 바로 내 프로필 칸에만 저장, 시험 알림·끊기는 phone-push', async ({page}) => {
  const state = await boot(page, {prefs: {kinds: {morning: false}}, devices: [OLD]});
  const p = panel(page);
  await expect(p.locator('[data-ps-push-kind="morning"]')).not.toBeChecked();
  await kindRow(p, 'collect_stall').click();
  await expect(p.locator('[data-ps-push-state]')).toHaveText('저장했어요');
  await expect(p.locator('[data-ps-push-kind="collect_stall"]')).not.toBeChecked();
  expect(state.prefs).toEqual({kinds: {task_due: true, meeting_done: true, collect_stall: false, morning: false, evening: true}, quiet: {from: '22:00', to: '07:00'}});
  await openFold(p, 'quiet');
  await p.locator('[data-ps-push-quiet="from"]').fill('23:00');
  await expect.poll(() => state.prefs?.quiet?.from).toBe('23:00');
  expect(state.patches.every(b => Object.keys(b).join() === 'notify_prefs')).toBe(true);
  await p.locator('[data-ps-push-test]').click();
  await expect(p.locator('[data-ps-push-result]')).toHaveText('시험 알림을 1대에 보냈어요');
  await openFold(p, 'devices');
  await p.locator('[data-ps-push-remove="dev-old"]').click();
  await expect(p.locator('[data-ps-push-devices]')).toHaveText('없음');
  expect(state.push.map(x => x.action)).toEqual(['test', 'unregister']);
  expect(state.push[1].body).toEqual({device_id: 'dev-old'});
  await p.locator('[data-ps-push-test]').click();
  await expect(p.locator('[data-ps-push-state]')).toHaveText('등록된 폰이 없어요');
  expect(state.errors).toEqual([]);
});

test.describe('폰 앱', () => {
  test.use({viewport: {width: 412, height: 915}, userAgent: ANDROID, hasTouch: true, isMobile: true});

  test('이 폰 꺼짐 → [시험 알림 보내기]가 알림 권한을 묻고 등록한 뒤 보낸다, 이 폰 알림 스위치를 끄면 서버에서 삭제하고 앱 토큰도 삭제한다', async ({page}) => {
    const state = await boot(page, {app: true});
    const p = panel(page);
    await expect(p.locator('[data-ps-push-phone="off"] .sl-label')).toHaveText('이 폰 알림');
    await expect(p.locator('[data-ps-push-phone-switch]')).not.toBeChecked();
    await expect(p.locator('[data-ps-push-devices]')).toHaveText('없음');
    await p.locator('[data-ps-push-test]').click();
    await expect(p.locator('[data-ps-push-result]')).toHaveText('시험 알림을 1대에 보냈어요');
    await expect(p.locator('[data-ps-push-phone="on"]')).toBeVisible();
    await expect(p.locator('[data-ps-push-phone-switch]')).toBeChecked();
    await openFold(p, 'devices');
    await expect(p.locator('[data-ps-push-fold="devices"] .sl-fold-body .sl-label')).toContainText('이 폰');
    const actions = state.push.map(x => x.action);
    expect(actions.slice(-2)).toEqual(['register', 'test']);
    const reg = state.push.find(x => x.action === 'register');
    expect(reg.body).toEqual({token: TOKEN, app_version: '0.4.4'});
    expect(await page.evaluate(() => window.__pushSent.filter(m => m.startsWith('push:')))).toContain('push:enable');
    // 토큰은 화면에 보이지 않는다.
    await expect(p).not.toContainText(TOKEN);
    await p.locator('[data-ps-push-phone="on"]').click();
    await expect(p.locator('[data-ps-push-phone="off"]')).toBeVisible();
    await expect(p.locator('[data-ps-push-devices]')).toHaveText('없음');
    const un = state.push.filter(x => x.action === 'unregister');
    expect(un).toEqual([{action: 'unregister', body: {token: TOKEN}}]);
    expect(await page.evaluate(() => window.__pushSent.at(-1))).toBe('push:forget');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await p.screenshot({path: 'test-results/phone-push-settings-app-412.png'});
    expect(state.errors).toEqual([]);
  });
});

// MULTI-처음쓰는사람 ⑤(docs/design/new-user-start.md 2-5): 통화·텔레그램 수집이 없는 새 계정은 '수집 멈춤·아침 묶음·저녁 묶음' 칩이 없다.
// '사용 현황' 칸은 MULTI-다른담당자맞춤 ⑥(#2566)이 정한 그대로: 새 계정은 한도에 닿기 전에는 칸이 없다.
// S62-27(PUSH-원장약속알림빼기·JOURNAL-다음주준비삭제): '원장 약속'·'다음 주 준비'는 누구에게도 없다 → 새 계정은 '할 일 기한·회의 요약' 둘.
// 저장된 설정에 옛 키(next_week·commitment)가 남아 있어도 오류 없이 무시하고, 다음 저장에서 빠진다.
for (const width of [1280, 880, 760, 412]) test(`새 계정: 폰 알림 칩 셋(할 일 기한·회의 요약·노트 알림), 사용 현황 칸 없음, 옛 키는 무시 (${width}px)`, async ({page}) => {
  await page.setViewportSize({width, height: 900});
  const state = await boot(page, {features: [], chips: 3, prefs: {kinds: {next_week: false, commitment: false, task_due: true}}, aiMonth: {ok: true, exempt: false, used_krw: 420, cap_krw: 3000, capped: false}});
  await expect(panel(page).locator('label:has([data-ps-push-kind]) .sl-label')).toHaveText(['할 일 기한', '회의 요약', '노트 알림']);
  await expect(page.locator('#psRoot [data-ps-open="status"]')).toHaveCount(0);
  await page.locator('#profileView').screenshot({path: `docs/design/screens/s62-27/profile-new-${width}.png`});
  // 칩을 눌러도 저장 모양은 그대로(숨긴 종류의 값은 건드리지 않음), 옛 키는 빠진다.
  await kindRow(panel(page), 'task_due').click();
  await expect.poll(() => state.patches.length).toBe(1);
  expect(Object.keys(state.patches[0].notify_prefs.kinds).sort()).toEqual(['collect_stall', 'evening', 'meeting_done', 'morning', 'task_due']);
  expect(state.errors).toEqual([]);
});
// 운영자 계정: 수집·잊지 말기·새 가입 기능이 있으면 그 칩만 더해진다. '원장 약속'·'다음 주 준비'는 여기에도 없다.
for (const width of [1280, 880, 412]) test(`운영자 계정: 폰 알림 칩에 원장 약속·다음 주 준비 없음 (${width}px)`, async ({page}) => {
  await page.setViewportSize({width, height: 900});
  const state = await boot(page, {features: ['calls', 'telegram', 'family', 'dev_inbox'], chips: 8});
  await expect(panel(page).locator('label:has([data-ps-push-kind]) .sl-label')).toHaveText(['할 일 기한', '회의 요약', '수집 멈춤', '아침 묶음', '저녁 묶음', '노트 알림', '잊지 말기', '새 가입']);
  await page.locator('#profileView').screenshot({path: `docs/design/screens/s62-27/profile-operator-${width}.png`});
  expect(state.errors).toEqual([]);
});
test('기능 답을 못 받으면 칩 여섯 개 그대로(운영자 화면이 빠지지 않게)', async ({page}) => {
  await page.setViewportSize({width: 412, height: 900});
  await boot(page, {features: {message: 'x'}});
});
