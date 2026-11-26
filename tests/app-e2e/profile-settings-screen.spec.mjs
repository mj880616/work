// S71-36 PROFILE-설정화면(사용자 11/26 시안 확정 "ㅇㅋ", 안드로이드 설정 화면처럼 '한 줄 메뉴 → 들어가면 상세'):
// - 첫 화면은 묶음별 한 줄 메뉴만(이름 + 오른쪽 작은 회색 요약 + ›), 맨 아래 큰 [저장] 단추 없음.
// - 줄을 누르면 그 장(?view=profile&pane=…), ‹·뒤로가기는 내 프로필 첫 화면으로.
// - 알림 종류 스위치·조용한 시간·이 폰 켜기/끄기·백업 자동 스위치·지금 백업·Claude 연결 스위치·이름·홈 칸이 서버에 저장되고 다시 열어도 그대로.
// - 사용 현황 줄은 서버가 운영자 기능을 준 사람에게만(운영자 아닌 사람은 줄 없음 — 서버 거절 시험은 collection-status·ai-usage-line 그대로).
// - 계정 삭제 줄은 따로 떨어진 묶음의 빨간 글자, 누르면 기존 확인 창.
// 네트워크 없음(지어낸 서버). 주소·메일은 가짜.
import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { signInWithSession } from './helpers/session-login.mjs';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.4';
const TOKEN = 'fake_fcm_token-0123456789abcdefghij:XYZ';
const FOLDER = 'https://drive.google.com/drive/folders/abcdefghij12';

async function boot(page, {app = false, features = ['calls', 'telegram'], mcp = true} = {}) {
  const user = {id: 'ps-user', email: 'ps@example.org'}, workspace = {id: 'ps-workspace', name: 'QA', slug: 'qa'};
  const state = {name: '처음 이름', prefs: null, viewPrefs: {}, devices: [], mcp: mcp ? {workspace_id: workspace.id, enabled: false, revoked_before: null} : null,
    patches: [], push: [], backups: [], mcpPatches: [], errors: []};
  page.on('pageerror', e => state.errors.push(e.message));
  if (app) {
    await page.addInitScript(token => {
      const listeners = [];
      let on = false;
      window.__sent = [];
      const reply = data => setTimeout(() => listeners.forEach(fn => fn({data})), 0);
      window.KPTUAppShell = {
        postMessage(m) {
          m = String(m); window.__sent.push(m);
          if (m === 'push:hello') reply(on ? 'push:on:' + token : 'push:off');
          if (m === 'push:enable') { on = true; reply('push:on:' + token); }
          if (m === 'push:forget') { on = false; reply('push:off'); }
          if (m === 'widget:status') reply('widget:status:on');
          if (m === 'widget:logout') reply('widget:status:off');
        },
        addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
      };
    }, TOKEN);
  }
  await page.route('https://xmlkxfjeagycwttklxjw.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    const body = () => JSON.parse(req.postData() || '{}');
    let data = [], status = 200;
    if (path === '/auth/v1/token') data = {access_token: 'qa', refresh_token: 'qa-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user};
    else if (path === '/auth/v1/user') data = user;
    else if (path === '/rest/v1/rpc/app_my_features') data = features;
    else if (path === '/rest/v1/app_workspace_members') data = [{workspace_id: workspace.id, user_id: user.id, role: 'owner'}];
    else if (path === '/rest/v1/app_workspaces') data = [workspace];
    else if (path === '/rest/v1/app_profiles' && method === 'PATCH') {
      const b = body(); state.patches.push(b);
      if ('display_name' in b) state.name = b.display_name;
      if (b.notify_prefs) state.prefs = b.notify_prefs;
      if (b.view_prefs) state.viewPrefs = b.view_prefs;
      data = [{user_id: user.id, view_prefs: state.viewPrefs}];
    }
    else if (path === '/rest/v1/app_profiles') data = [{user_id: user.id, display_name: state.name, notify_prefs: state.prefs, view_prefs: state.viewPrefs}];
    else if (path === '/rest/v1/app_push_devices') data = state.devices;
    else if (path === '/functions/v1/phone-push') {
      const action = url.searchParams.get('action');
      if (action === 'notices' || action === 'recent') data = {ok: true, items: []};
      else {
        const b = body(); state.push.push({action, body: b});
        if (action === 'register') { state.devices = [{id: 'dev-1', app_version: '0.4.4', created_at: '2026-11-26T00:00:00Z', last_seen_at: '2026-11-26T00:00:00Z'}]; data = {ok: true, device: {id: 'dev-1'}}; }
        else if (action === 'unregister') { state.devices = []; data = {ok: true, removed: 1}; }
        else if (action === 'test') data = state.devices.length ? {ok: true, sent: state.devices.length, failed: 0, revoked: 0} : (status = 409, {ok: false, error: 'NO_DEVICE'});
      }
    }
    else if (path === '/functions/v1/record-backup') {
      if (url.searchParams.get('action') === 'run') { state.backups.push(body()); data = {ok: true, date: '2026-11-26', count: 240, folder_url: FOLDER, root_url: FOLDER, root_name: 'WORK ON+ 백업'}; }
      else data = {ok: true, connected: true, last_at: '2026-11-20T03:00:00Z', folder_url: FOLDER, folder_name: 'WORK ON+ 백업', keep_weeks: 4,
        kinds: [{key: 'notes', label: '노트', count: 240}, {key: 'reports', label: '조직 보고 · 사업 보고', count: 258}]};
    }
    else if (path === '/functions/v1/workspace-drive' && url.searchParams.get('action') === 'gather-folders') data = {ok: true, root_name: 'WORK ON+', root_url: FOLDER};
    else if (path === '/rest/v1/app_mcp_settings' && method === 'PATCH') { const b = body(); state.mcpPatches.push(b); Object.assign(state.mcp, b); data = [state.mcp]; }
    else if (path === '/rest/v1/app_mcp_settings') data = state.mcp ? [state.mcp] : [];
    else if (path === '/rest/v1/app_mcp_read_log') data = [];
    else if (path === '/functions/v1/account-delete') data = {ok: true};
    else if (path === '/functions/v1/ai-assist') data = {ok: false};
    else if (path === '/functions/v1/drive-summary') data = {ok: true, checked_at: '2026-11-26T01:00:00.000Z', copy: {state: 'found', last_success_at: '2026-11-26T00:30:00.000Z', last_failure_at: null, last_failure_code: null}};
    else if (path === '/rest/v1/app_todo_radar_state') data = [{last_success_at: '2026-11-26T00:30:00Z'}];
    else if (path.startsWith('/functions/')) data = {connected: false, enabled: false, tasks: [], events: [], calendars: []};
    return route.fulfill({status, contentType: 'application/json', body: JSON.stringify(data)});
  });
  await page.goto(appOrigin + '/app/login/?return=' + encodeURIComponent(appOrigin + '/app/?view=profile'));
  await signInWithSession(page, user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  await expect(page.locator('#psRoot')).toBeVisible({timeout: 15000});
  return state;
}
const root = page => page.locator('#psRoot');
const pageOf = (page, key) => page.locator(`#profileView [data-ps-page="${key}"]`);
async function open(page, key) {
  await root(page).locator(`[data-ps-open="${key}"]`).click();
  await expect(pageOf(page, key)).toBeVisible();
  await expect(root(page)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`[?&]pane=${key}(&|$)`));
}

for (const width of [390, 1280]) test(`첫 화면은 묶음별 한 줄 메뉴만, [저장] 단추 없음 · 줄마다 그 장 → ‹·뒤로가기로 돌아옴 (${width}px)`, async ({page}) => {
  await page.setViewportSize({width, height: 900});
  const state = await boot(page);
  const r = root(page);
  await expect(r.locator('.sl-group-title')).toHaveText(['앱', '자료', '조직']);
  await expect(r.locator('[data-ps-open]')).toHaveText([/이름\s*처음 이름/, /홈 칸.*켜짐/, /알림 설정.*폰 없음 · 조용한 시간 22–07/, /내 기록 백업.*마지막 11\/20/, /구글 드라이브.*WORK ON\+ 폴더/, /Claude 읽기 연결.*꺼짐/, /담당조직 현황/, /내 묶음/, /계정/, /사용 현황/]);
  // 첫 화면에 입력칸·스위치·큰 단추가 없다(한 줄 메뉴만).
  await expect(page.locator('#profileView :is(input, button.primary, .save-row):visible')).toHaveCount(0);
  await expect(page.locator('#psSave')).toBeHidden();
  for (const row of await r.locator('[data-ps-open]').all()) {
    const box = await row.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(43);
    expect(box.height).toBeLessThanOrEqual(64);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.locator('#profileView').screenshot({path: `test-results/profile-settings-root-${width}.png`});
  for (const key of ['name', 'home', 'push', 'backup', 'drive', 'mcp', 'account', 'status']) {
    await open(page, key);
    await expect(pageOf(page, key).locator('.sl-page-title')).toBeVisible();
    if (key === 'push' || key === 'backup') await page.locator('#profileView').screenshot({path: `test-results/profile-settings-${key}-${width}.png`});
    if (key === 'home' || key === 'account') await page.goBack(); else await pageOf(page, key).locator('[data-ps-back]').click();
    await expect(root(page)).toBeVisible();
    await expect(pageOf(page, key)).toBeHidden();
    await expect(page).not.toHaveURL(/pane=/);
    await expect(page.locator('#profileView')).toBeVisible();
  }
  // 첫 화면에서 한 번 더 뒤로가면 내 프로필 앞 화면(앱 밖이 아니라 앱 안 이전 화면)이다.
  expect(state.errors).toEqual([]);
});

test('주소로 바로 연 장(새로고침): ‹는 내 프로필 첫 화면으로', async ({page}) => {
  await boot(page);
  await open(page, 'push');
  await page.reload();
  await expect(pageOf(page, 'push')).toBeVisible({timeout: 15000});
  await pageOf(page, 'push').locator('[data-ps-back]').click();
  await expect(root(page)).toBeVisible();
  await expect(page).not.toHaveURL(/pane=/);
});

test('알림 설정: 종류 스위치·조용한 시간은 바로 서버 저장, 다시 열어도 그대로', async ({page}) => {
  const state = await boot(page);
  await open(page, 'push');
  const p = pageOf(page, 'push');
  await expect(p.locator('.sl-group-title')).toHaveText('알림 종류');
  await expect(p.locator('[data-ps-push-kind]')).toHaveCount(6);
  await expect(p.locator('label:has([data-ps-push-kind="collect_stall"]) .sl-desc')).toHaveText('운영자만 · 수집이 멈추면');
  await p.locator('label:has([data-ps-push-kind="morning"])').click();
  await expect(p.locator('[data-ps-push-state]')).toHaveText('저장했어요');
  expect(state.prefs.kinds.morning).toBe(false);
  await p.locator('[data-ps-push-fold="quiet"] > summary').click();
  await p.locator('[data-ps-push-quiet="from"]').fill('23:00');
  await expect.poll(() => state.prefs?.quiet?.from).toBe('23:00');
  await page.reload();
  await expect(pageOf(page, 'push')).toBeVisible({timeout: 15000});
  await expect(p.locator('[data-ps-push-kind="morning"]')).not.toBeChecked();
  await expect(p.locator('[data-ps-push-kind="task_due"]')).toBeChecked();
  await expect(p.locator('[data-ps-push-quiet-sum]')).toHaveText('23:00–07:00');
  await p.locator('[data-ps-back]').click();
  await expect(root(page).locator('[data-ps-open="push"] .sl-sum')).toHaveText('폰 없음 · 조용한 시간 23–07');
  expect(state.patches.filter(b => b.notify_prefs).length).toBe(2);
  expect(state.errors).toEqual([]);
});

test.describe('폰 앱', () => {
  test.use({viewport: {width: 390, height: 844}, userAgent: ANDROID, hasTouch: true, isMobile: true});
  test('이 폰 알림 스위치: 켜면 권한을 묻고 등록, 끄면 서버에서 지우고 앱 토큰도 지운다 · 계정 장의 폰 위젯 줄', async ({page}) => {
    const state = await boot(page, {app: true});
    await open(page, 'push');
    const p = pageOf(page, 'push');
    const sw = p.locator('[data-ps-push-phone-switch]');
    await expect(sw).not.toBeChecked();
    await p.locator('[data-ps-push-phone="off"]').click();
    await expect(p.locator('[data-ps-push-phone="on"]')).toBeVisible();
    await expect(sw).toBeChecked();
    expect(state.push.map(x => x.action)).toEqual(['register']);
    expect(state.push[0].body.token).toBe(TOKEN);
    await expect(p).not.toContainText(TOKEN);
    await p.locator('[data-ps-push-phone="on"]').click();
    await expect(p.locator('[data-ps-push-phone="off"]')).toBeVisible();
    expect(state.push.map(x => x.action)).toEqual(['register', 'unregister']);
    expect(await page.evaluate(() => window.__sent.at(-1))).toBe('push:forget');
    await p.locator('[data-ps-back]').click();
    await expect(root(page).locator('[data-ps-open="push"] .sl-sum')).toHaveText(/^꺼짐 · 조용한 시간/);
    await open(page, 'account');
    const a = pageOf(page, 'account');
    await expect(a.locator('[data-ps-widget-state="on"]')).toContainText('로그인됨');
    await a.locator('[data-ps-widget-logout]').click();
    await expect(a.locator('[data-ps-widget-state="off"]')).toContainText('로그인 안 됨');
    await expect(a.locator('[data-ps-widget-logout]')).toHaveCount(0);
    expect(state.errors).toEqual([]);
  });
});

test('내 기록 백업: 자동 백업 스위치는 서버 저장(다시 열어도 켜짐), 끈 항목은 지금 백업에서 빠진다', async ({page}) => {
  const state = await boot(page);
  await open(page, 'backup');
  const p = pageOf(page, 'backup');
  await expect(p.locator('.sl-group-title')).toHaveText('백업할 것');
  await expect(p.locator('label:has([data-rb-auto]) .sl-desc')).toHaveText('앱을 열 때 · 최근 4주만 남겨요');
  await expect(p.locator('[data-rb-folder]')).toHaveAttribute('href', FOLDER);
  await expect(p.locator('.sl-note')).toHaveText('일정·할 일은 구글에, 자료실 파일은 내 드라이브에 이미 있어요');
  await p.locator('label:has([data-rb-auto])').click();
  await expect.poll(() => state.viewPrefs?.record_backup?.auto).toBe(true);
  await p.locator('label:has([data-rb-kind="reports"])').click();
  await expect(p.locator('[data-rb-kind="reports"]')).not.toBeChecked();
  await p.locator('[data-rb-run]').click();
  await expect(p.locator('.rb-done')).toContainText('240건');
  expect(state.backups).toEqual([{kinds: ['notes']}]);
  await page.reload();
  await expect(pageOf(page, 'backup')).toBeVisible({timeout: 15000});
  await expect(p.locator('[data-rb-auto]')).toBeChecked();
  expect(state.errors).toEqual([]);
});

test('Claude 읽기 연결: 켜기 스위치는 서버 저장, 다시 열어도 켜짐 · 모든 연결 끊기는 빨간 글자', async ({page}) => {
  const state = await boot(page);
  await open(page, 'mcp');
  const p = pageOf(page, 'mcp');
  await p.locator('label:has([data-mr-enabled])').click();
  await expect.poll(() => state.mcpPatches).toEqual([{enabled: true}]);
  await expect(p.locator('[data-mr-revoke]')).toHaveClass(/sl-danger/);
  await page.reload();
  await expect(pageOf(page, 'mcp')).toBeVisible({timeout: 15000});
  await expect(p.locator('[data-mr-enabled]')).toBeChecked();
  await p.locator('[data-ps-back]').click();
  await expect(root(page).locator('[data-ps-open="mcp"] .sl-sum')).toHaveText('켜짐');
  expect(state.errors).toEqual([]);
});

test('이름·홈 칸: 바꾸면 바로 서버 저장(저장 단추 없음), 첫 화면 요약도 바뀐다', async ({page}) => {
  const state = await boot(page);
  await open(page, 'name');
  const p = pageOf(page, 'name');
  await expect(p.locator('.sl-note')).toHaveText('닉네임 써도 돼요');
  await expect(p.locator('button.primary')).toHaveCount(0);
  await p.locator('#psName').fill('새 이름');
  await p.locator('#psName').press('Enter');
  await expect(p.locator('#psNameState')).toHaveText('저장했어요');
  expect(state.name).toBe('새 이름');
  await p.locator('[data-ps-back]').click();
  await expect(root(page).locator('[data-ps-open="name"] .sl-sum')).toHaveText('새 이름');
  // 빈 이름은 저장하지 않고 되돌린다.
  await open(page, 'name');
  await p.locator('#psName').fill('');
  await p.locator('[data-ps-back]').click();
  await expect(root(page)).toBeVisible();
  expect(state.name).toBe('새 이름');
  await open(page, 'home');
  const h = pageOf(page, 'home');
  const first = h.locator('[data-home-off-switch]').first();
  const id = await first.getAttribute('data-home-off-switch');
  await h.locator(`label:has([data-home-off-switch="${id}"])`).click();
  await expect.poll(() => state.viewPrefs?.home_off).toEqual([id]);
  await page.reload();
  await expect(pageOf(page, 'home')).toBeVisible({timeout: 15000});
  await expect(h.locator(`[data-home-off-switch="${id}"]`)).not.toBeChecked();
  expect(state.errors).toEqual([]);
});

test('운영자 아닌 사람: 사용 현황 줄 없음, 주소로 열어도 첫 화면 · Claude 연결 행이 없으면 그 줄도 없음', async ({page}) => {
  await boot(page, {features: [], mcp: false});
  await expect(root(page).locator('[data-ps-open="backup"]')).toBeVisible();
  await expect(root(page).locator('[data-ps-open="status"]')).toHaveCount(0);
  await expect(root(page).locator('[data-ps-open="mcp"]')).toHaveCount(0);
  await page.goto(appOrigin + '/app/?view=profile&pane=status');
  await expect(root(page)).toBeVisible({timeout: 15000});
  await expect(pageOf(page, 'status')).toBeHidden();
});

test('계정 삭제: 계정 장 따로 떨어진 묶음의 빨간 줄 → 누르면 확인 창(삭제 글자 넣기 전엔 못 누름)', async ({page}) => {
  const state = await boot(page);
  await open(page, 'account');
  const row = pageOf(page, 'account').locator('[data-account-delete]');
  await expect(row).toHaveClass(/sl-danger/);
  await expect(row).toContainText('내 기록이 모두 삭제돼요');
  await row.click();
  const dialog = page.locator('#accountDeleteDialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-acd-go]')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(pageOf(page, 'account')).toBeVisible();
  expect(state.errors).toEqual([]);
});
