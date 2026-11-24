// S69-08 앱 전체 잠금: 잠금 설정 맨 위 '앱 전체' 스위치 → 켜면 앱을 열 때(새로고침·폰 앱 다시 열기) 어떤 화면보다 먼저 잠금 화면,
// 풀기 전에는 첫 화면 프로그램·자료를 받지 않는다(요청 목록으로 확인) → 맞는 PIN이면 원래 가려던 화면 → 다시 잠그기(앱을 떠난 뒤 5분·앱 닫을 때)
// → PIN 잊음(최근 로그인 아니면 다시 로그인 안내)·로그아웃 단추 → 끄면 바로 열림. 서버(app_lock_*)는 page.route로 흉내 낸다
// (실제 검사 목록·횟수는 tests/auth-handoff/app-lock-whole-app-db.test.mjs). 값은 모두 합성.
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const T0 = Date.parse('2026-10-06T01:00:00Z');

function lockServer({ pin = null, features = [], relock = '5m' } = {}) {
  const s = { pin, features, relock, calls: [] };
  const read = () => ({ has_pin: !!s.pin, features: s.features, relock: s.relock, left: 5, blocked_until: null });
  const tryPin = p => p === s.pin ? { ok: true, left: 5, blocked_until: null } : { ok: false, left: 4, blocked_until: null };
  s.install = async page => {
    await page.route(u => u.origin === SB && u.pathname.startsWith('/rest/v1/rpc/app_lock_'), async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      const body = route.request().postDataJSON() || {};
      s.calls.push(name);
      const json = v => route.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
      if (name === 'app_lock_read') return json(read());
      if (name === 'app_lock_note_folders') return json({ folders: [], covered: [], top_names: [] });
      if (name === 'app_lock_setup') { s.pin = body.p_pin; s.features = [...new Set(body.p_features)].sort(); s.relock = body.p_relock; return json({ ok: true, features: s.features, relock: s.relock }); }
      if (name === 'app_lock_check') return json(tryPin(body.p_pin));
      if (name === 'app_lock_save') {
        const r = tryPin(body.p_pin); if (!r.ok) return json(r);
        s.features = [...new Set(body.p_features)].sort(); s.relock = body.p_relock;
        return json({ ...r, features: s.features, relock: s.relock });
      }
      return route.fulfill({ status: 404, body: '' });
    });
  };
  return s;
}
const go = (page, view) => page.evaluate(v => window.KPTURouter.go(v, { source: 'delegated' }), view);
const keys = async (page, digits) => { for (const d of digits) await page.locator('#lockView [data-lk-key="' + d + '"]').click(); };
const pad = page => page.locator('#lockView .lk-pad');
const current = page => page.evaluate(() => window.KPTURouter.current);
const setVisible = (page, visible) => page.evaluate(v => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
  document.dispatchEvent(new Event('visibilitychange'));
}, visible ? 'visible' : 'hidden');
// 잠금 화면이 떠 있는 동안 나간 자료 요청(주소 경로만). 로그인·작업공간 확인·사람별 설정(이름 고침·화면 색·메뉴)·기능 목록·잠금 함수만 허락한다.
const ALLOWED = [/^\/auth\/v1\//, /^\/rest\/v1\/app_workspace_members$/, /^\/rest\/v1\/app_profiles$/, /^\/rest\/v1\/rpc\/app_my_features$/, /^\/rest\/v1\/rpc\/app_lock_/];
// 새로 연 문서의 요청만 센다(앞 화면이 아직 보내던 요청은 빼려고, 새 문서가 자리 잡은 뒤부터 — 새 문서 스크립트보다 먼저 온다).
function watchData(page) {
  const seen = [];
  let started = false;
  const nav = frame => { if (frame === page.mainFrame()) { started = true; seen.length = 0; } };
  const on = req => { const u = new URL(req.url()); if (started && (u.origin === SB || /\/functions\/v1\//.test(u.pathname))) seen.push(u.pathname); };
  page.on('framenavigated', nav); page.on('request', on);
  return { seen, stop: () => { page.off('request', on); page.off('framenavigated', nav); } };
}

test('앱 전체 켜기 → 새로 열면 잠금 화면 먼저(첫 화면·자료 안 받음) → 맞는 PIN이면 가려던 화면 → 떠난 뒤 5분이면 다시 잠김 (폰 412)', async ({ page }) => {
  const server = lockServer();
  await openHome(page, { beforeLoad: () => server.install(page) });
  await page.setViewportSize({ width: 412, height: 860 });
  await go(page, 'lock');
  // 스위치 줄 맨 위가 '앱 전체'.
  await expect(page.locator('#lockView .lk-row').first().locator('.lk-row-name')).toHaveText('앱 전체');
  const appSwitch = page.locator('#lockView [data-lk-feature="app"]');
  await expect(appSwitch).not.toBeChecked();
  await appSwitch.click();
  await expect(pad(page).locator('.lk-title')).toHaveText('PIN 정하기');
  await keys(page, '1234'); await keys(page, '1234');
  await expect(page.locator('#lockView .lk-list')).toBeVisible();
  await expect(appSwitch).toBeChecked();
  expect([server.features, server.relock]).toEqual([['app'], '5m']);
  // 방금 PIN을 넣었으니 앱 안에서는 그대로 쓴다.
  await go(page, 'tasks');
  await expect(page.locator('#tasksView')).toBeVisible();

  // 새로 열기(?view=tasks): 잠금 화면만, 할 일 화면·홈은 그리지 않고 자료 요청도 없다.
  const data = watchData(page);
  await page.goto(page.url().replace(/\?.*$/, '') + '?view=tasks');
  await expect(pad(page).locator('.lk-title')).toHaveText('앱 잠김', { timeout: 20000 });
  await expect(page.locator('#lockView')).toHaveAttribute('data-lk-full', '');
  await expect(page.locator('#lockView [data-lk-close]')).toHaveCount(0);
  await expect(page.locator('#lockView [data-lk-logout]')).toBeVisible();
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.KPTUViewLoader.isLoaded('tasks') || window.KPTUViewLoader.isLoaded('home'))).toBe(false);
  await expect(page.locator('#appView')).not.toHaveClass(/kptu-ui-ready/);
  expect(data.seen.length).toBeGreaterThan(0);
  expect(data.seen.filter(p => !ALLOWED.some(rule => rule.test(p)))).toEqual([]);
  await expect(page).toHaveURL(/view=tasks/);
  // 메뉴·주소로 다른 화면에 가려 해도 잠금 화면 그대로.
  await go(page, 'calendar');
  expect(await current(page)).toBe('lock');
  data.stop();
  // 틀리면 그대로, 맞으면 가려던 화면.
  await keys(page, '0000');
  await expect(page.locator('#lockView [data-lk-msg]')).toContainText('PIN이 맞지 않아요');
  await keys(page, '1234');
  await expect(page.locator('#tasksView')).toBeVisible();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  expect(await current(page)).toBe('tasks');
  await expect(page).toHaveURL(/view=tasks/);

  // 다시 잠그기 5분: 앱 안에서 화면을 옮겨 다니는 것은 시간을 재지 않는다. 앱을 떠난 뒤(화면 숨김) 4분이면 그대로, 5분 넘으면 잠김.
  await go(page, 'home');
  await page.clock.setFixedTime(new Date(T0 + 30 * 60 * 1000));
  await go(page, 'calendar');
  await expect(page.locator('#calendarView')).toBeVisible();
  await setVisible(page, false);
  await page.clock.setFixedTime(new Date(T0 + 34 * 60 * 1000));
  await setVisible(page, true);
  await expect(page.locator('#calendarView')).toBeVisible();
  expect(await current(page)).toBe('calendar');
  await setVisible(page, false);
  await page.clock.setFixedTime(new Date(T0 + 40 * 60 * 1000));
  await setVisible(page, true);
  await expect(pad(page).locator('.lk-title')).toHaveText('앱 잠김');
  expect(await current(page)).toBe('lock');
  await keys(page, '1234');
  await expect(page.locator('#calendarView')).toBeVisible();
});

test('앱 닫을 때: 떠나면 바로 잠김 · PIN 잊음(최근 로그인 아니면 다시 로그인 안내) · 로그아웃 · 끄면 바로 열림 (PC 1280)', async ({ page }) => {
  const server = lockServer({ pin: '1234', features: ['app', 'diary'], relock: 'close' });
  await page.setViewportSize({ width: 1280, height: 860 });
  let loggedOut = 0;
  // 홈 시험 도구는 첫 화면이 다 뜨기를 기다리므로, 앱 전체 잠금은 앱을 연 뒤에 켜진 것으로 한다(서버 값 바꾸고 새로 열기).
  server.features = ['diary'];
  await openHome(page, { beforeLoad: async () => {
    await server.install(page);
    await page.route(u => u.origin === SB && u.pathname === '/auth/v1/logout', route => { loggedOut++; return route.fulfill({ status: 204, body: '' }); });
  } });
  server.features = ['app', 'diary'];
  await page.reload();
  await expect(pad(page).locator('.lk-title')).toHaveText('앱 잠김', { timeout: 20000 });
  // PC는 키보드 숫자. 한 번 풀면 하루 기록도 함께 풀린다(PIN 하나).
  await page.keyboard.type('1234');
  await expect(page.locator('#homeView')).toBeVisible();
  await go(page, 'diary');
  await expect(page.locator('#diaryView')).toBeVisible();
  // '앱 닫을 때': 다른 앱으로 가면 바로 잠금 화면(최근 앱 미리보기에도 자료가 안 보이게).
  await setVisible(page, false);
  expect(await current(page)).toBe('lock');
  await setVisible(page, true);
  await expect(pad(page).locator('.lk-title')).toHaveText('앱 잠김');
  // PIN 잊음: 로그인한 지 오래됐으면 구글 로그인 다시 하기 안내(갇히지 않게). [취소]면 숫자 판으로.
  await page.locator('#lockView [data-lk-forgot]').click();
  await expect(page.locator('#lockView .lk-forgot')).toBeVisible();
  await expect(page.locator('#lockView [data-lk-relogin]')).toBeVisible();
  await expect(page.locator('#lockView [data-lk-logout]')).toBeVisible();
  await page.locator('#lockView [data-lk-cancel]').click();
  await expect(pad(page).locator('.lk-title')).toHaveText('앱 잠김');
  // 맞는 PIN이면 하루 기록으로 돌아온다(쓰던 화면 그대로).
  await page.keyboard.type('1234');
  await expect(page.locator('#diaryView')).toBeVisible();
  // PIN 잊음에서 구글 로그인을 다시 하고 돌아온 주소(?view=lock&renew=1&for=…)로 열어도 갇히지 않는다: 주소는 돌아갈 화면으로 바뀌고,
  // 최근 로그인이 아니면 다시 로그인 안내, [취소]면 숫자 판, 맞는 PIN이면 그 화면.
  await page.goto(page.url().replace(/\?.*$/, '') + '?view=lock&renew=1&for=calendar');
  await expect(page.locator('#lockView .lk-forgot')).toBeVisible({ timeout: 20000 });
  await expect(page).toHaveURL(/\?view=calendar$/);
  await page.locator('#lockView [data-lk-cancel]').click();
  await page.keyboard.type('1234');
  await expect(page.locator('#calendarView')).toBeVisible();
  expect(await current(page)).toBe('calendar');
  // 잠금 설정 목록을 보던 중 앱을 떠났다 오면 목록 대신 숫자 판(풀면 홈).
  await go(page, 'lock');
  await expect(page.locator('#lockView .lk-list')).toBeVisible();
  await setVisible(page, false);
  await setVisible(page, true);
  await expect(pad(page).locator('.lk-title')).toHaveText('앱 잠김');
  await page.keyboard.type('1234');
  await expect(page.locator('#homeView')).toBeVisible();
  // 끄기(PIN 확인 뒤) → 새로 열어도 바로 열림.
  await go(page, 'lock');
  await page.locator('#lockView [data-lk-feature="app"]').click();
  await expect(pad(page).locator('.lk-title')).toHaveText('PIN 확인');
  await page.keyboard.type('1234');
  await expect(page.locator('#lockView .lk-list')).toBeVisible();
  expect(server.features).toEqual(['diary']);
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
  await expect(page.locator('#lockView .lk-pad')).toHaveCount(0);
  // 다시 켜고 새로 연 잠금 화면의 [로그아웃]은 로그인 화면으로 보낸다.
  server.features = ['app'];
  await page.reload();
  await expect(pad(page).locator('.lk-title')).toHaveText('앱 잠김', { timeout: 20000 });
  await page.locator('#lockView [data-lk-logout]').click();
  await page.waitForURL(u => u.pathname === '/app/login/', { timeout: 10000 });
  expect(loggedOut).toBe(1);
});

test('설정 읽기가 실패하면 잠금 화면 [다시] · 늦게 오면 앱을 멈추지 않고, 온 설정이 앱 전체 잠금이면 바로 가림 (폰 412)', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 860 });
  const state = { mode: 'ok', features: ['diary'], wait: null };
  await openHome(page, { beforeLoad: () => page.route(u => u.origin === SB && u.pathname.startsWith('/rest/v1/rpc/app_lock_'), async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    if (name === 'app_lock_note_folders') return route.fulfill({ json: { folders: [], covered: [], top_names: [] } });
    if (name !== 'app_lock_read') return route.fulfill({ status: 404, body: '' });
    if (state.mode === 'fail') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"합성 오류"}' });
    if (state.mode === 'late') await new Promise(done => { state.wait = done; });
    return route.fulfill({ json: { has_pin: true, features: state.features, relock: '5m', left: 5, blocked_until: null } });
  }) });
  // 읽기 실패: 켜 두었는지 모르므로 잠금 화면(전체화면)에 [다시]. 다시 읽어 앱 전체 잠금이 아니면 원래 화면이 열린다.
  state.mode = 'fail';
  await page.reload();
  await expect(page.locator('#lockView [data-lk-retry]')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#lockView')).toHaveAttribute('data-lk-full', '');
  state.mode = 'ok';
  await page.locator('#lockView [data-lk-retry]').click();
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  // 늦게 옴(4초 넘게): 앱은 열고, 온 설정이 앱 전체 잠금이면 그 자리에서 잠금 화면으로.
  state.mode = 'late'; state.features = ['app'];
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
  expect(await current(page)).toBe('home');
  state.wait?.();
  await expect(pad(page).locator('.lk-title')).toHaveText('앱 잠김');
  expect(await current(page)).toBe('lock');
});
