// MCP-Claude읽기 M-5(설계 docs/design/mcp-claude-read.md 4.6·6·7.1절): 내 프로필 'Claude 읽기 연결' 칸과 동의 화면.
// - 칸: 설정 행이 있을 때만 보인다. 스위치는 enabled 한 칸, [모든 연결 끊기]는 revoked_before 한 칸만 PATCH. 기록은 읽기만.
// - 3판(설계 15.2): 읽을 영역 스위치 다섯(area_*), 가족 방만 기본 꺼짐. 하나씩 그 칸만 PATCH.
// - 표가 아직 없을 때(DB 적용 전, 404)·행이 없을 때: 칸 없음, 화면 오류 없음.
// - 동의 화면: [허락]은 consent action=approve 하나, 받은 claude.ai 주소로만 간다. 되돌아갈 곳·클라이언트가 다르거나 설정 행이 없으면 버튼 없이 거절 글.
// 네트워크 없음(지어낸 서버). 캡처는 docs/design/screens/s67-22/.
import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { signInWithSession } from './helpers/session-login.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co/**';
const SHOTS = 'docs/design/screens/s67-22';
const user = {id: 'mcp-user', email: 'mcp@example.org'}, workspace = {id: 'mcp-workspace', name: 'QA', slug: 'qa'};
const ROW = {workspace_id: workspace.id, enabled: false, revoked_before: null, area_diary: true, area_calls: true, area_recordings: true, area_basket: true, area_family: false};
const LOGS = [
  {called_at: '2026-11-19T01:12:00Z', tool: 'web2_org_status', status: 'ok', result_count: 3},
  {called_at: '2026-11-19T01:10:00Z', tool: 'ledger_search', status: 'ok', result_count: 12},
  {called_at: '2026-11-18T23:40:00Z', tool: 'web2_notes_search', status: 'limited', result_count: 0},
];
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const AUTH_ID = 'auth-0123456789abcdef';

async function boot(page, {settings = 'row', row = ROW, logs = LOGS, monthCount = 42, details = null, consent = null} = {}) {
  const state = {patches: [], consents: [], errors: [], current: row ? {...row} : null};
  page.on('pageerror', e => state.errors.push(e.message));
  await page.route('https://claude.ai/**', route => route.fulfill({status: 200, contentType: 'text/html', body: '<p>claude</p>'}));
  await page.route(SB, async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    let data = [], status = 200;
    if (path === '/auth/v1/token') data = {access_token: 'qa', refresh_token: 'qa-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user};
    else if (path === '/auth/v1/user') data = user;
    else if (path === '/rest/v1/rpc/app_my_features') data = [];
    else if (path === '/rest/v1/app_workspace_members') data = [{workspace_id: workspace.id, user_id: user.id, role: 'owner'}];
    else if (path === '/rest/v1/app_workspaces') data = [workspace];
    else if (path === '/rest/v1/app_profiles') data = [{user_id: user.id, display_name: 'QA'}];
    else if (path === '/rest/v1/app_mcp_settings') {
      if (settings === 'missing') { status = 404; data = {code: 'PGRST205', message: 'Could not find the table'}; }
      else if (method === 'PATCH') {
        const body = JSON.parse(req.postData() || '{}');
        state.patches.push(body);
        state.current = {...state.current, ...body};
        data = [state.current];
      } else if ((url.searchParams.get('select') || '').includes('allowed_client_id')) { status = 403; data = {message: 'permission denied'}; }
      else data = state.current ? [state.current] : [];
    }
    else if (path === '/rest/v1/app_mcp_read_log') {
      if (method !== 'GET') { status = 403; data = {message: 'no'}; }
      else if (url.searchParams.get('select') === 'id') data = Array.from({length: monthCount}, (_, i) => ({id: 'l' + i}));
      else data = logs;
    }
    else if (path === `/auth/v1/oauth/authorizations/${AUTH_ID}` && method === 'GET') data = details;
    else if (path === `/auth/v1/oauth/authorizations/${AUTH_ID}/consent` && method === 'POST') {
      state.consents.push(JSON.parse(req.postData() || '{}'));
      data = consent || {redirect_url: `${CALLBACK}?code=fake-code&state=s`};
    }
    else if (path.startsWith('/functions/')) data = {connected: false, enabled: false, tasks: [], events: [], calendars: [], ok: false};
    return route.fulfill({status, contentType: 'application/json', body: JSON.stringify(data)});
  });
  return state;
}

// S71-36 PROFILE-설정화면: 내 프로필 첫 화면의 'Claude 읽기 연결 ›' 줄을 눌러 그 장으로 들어간다(설정 행이 있을 때만 줄이 있다).
async function openProfile(page, {enter = true} = {}) {
  await page.goto(appOrigin + '/app/login/?return=' + encodeURIComponent(appOrigin + '/app/?view=profile'));
  await signInWithSession(page, user.email);
  await expect(page.locator('#profileView')).toBeVisible({timeout: 15000});
  if (!enter) return;
  await page.locator('#psRoot [data-ps-open="mcp"]').click({timeout: 15000});
  await expect(page.locator('#profileView [data-ps-page="mcp"]')).toBeVisible();
}
const panel = page => page.locator('#psMcpReadPanel');

for (const width of [412, 884, 1280]) test(`칸: 꺼짐·최근 기록·이번 달 호출 수, 넘치지 않음 (${width}px)`, async ({page}) => {
  await page.setViewportSize({width, height: 900});
  const state = await boot(page);
  await openProfile(page);
  const p = panel(page);
  await expect(p).toBeVisible({timeout: 15000});
  await expect(page.locator('#profileView [data-ps-page="mcp"] .sl-page-title')).toHaveText('Claude 읽기 연결');
  await expect(p.locator('[data-mr-enabled]')).not.toBeChecked();
  await expect(p.locator('[data-mr-month]')).toHaveText('42번');
  await expect(p.locator('.mr-log li')).toHaveCount(3);
  await p.locator('[data-mr-log] > summary').click(); // 최근 읽은 기록 ›(접힌 줄)
  await expect(p.locator('.mr-log li').first()).toContainText('조직 현황');
  await expect(p.locator('.mr-log li').nth(2)).toContainText('잠깐 멈춤');
  await expect(p.locator('[data-mr-revoke] .sl-label')).toHaveText('모든 연결 끊기');
  expect(state.patches).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await p.scrollIntoViewIfNeeded();
  await p.screenshot({path: `${SHOTS}/settings-${width}.png`});
  expect(state.errors).toEqual([]);
});

test('칸: 스위치는 enabled만, [모든 연결 끊기]는 revoked_before만 저장', async ({page}) => {
  const state = await boot(page);
  await openProfile(page);
  const p = panel(page);
  await p.locator('[data-mr-enabled]').check();
  await expect.poll(() => state.patches.length).toBe(1);
  await expect(p.locator('[data-mr-enabled]')).toBeChecked();
  await p.locator('[data-mr-revoke]').click();
  await page.locator('.kptu-ask-actions button', {hasText: '끊기'}).click();
  await expect(p.locator('[data-mr-revoke] .sl-desc')).toContainText('마지막으로 모두 끊은 때');
  expect(state.patches.length).toBe(2);
  expect(state.patches[0]).toEqual({enabled: true});
  expect(Object.keys(state.patches[1])).toEqual(['revoked_before']);
  expect(Number.isFinite(Date.parse(state.patches[1].revoked_before))).toBe(true);
  expect(state.errors).toEqual([]);
});

test('칸: 읽을 영역 스위치 다섯 — 가족 방만 꺼짐, 하나씩 그 칸만 저장, 처음 보일 때부터 다섯 줄', async ({page}) => {
  const state = await boot(page);
  const selects = [];
  page.on('request', req => { const u = new URL(req.url()); if (u.pathname === '/rest/v1/app_mcp_settings' && req.method() === 'GET') selects.push(u.searchParams.get('select')); });
  await openProfile(page);
  const p = panel(page);
  const areas = p.locator('[data-mr-area]');
  // 화면 열 때 한 번에 그린다: 연결 스위치가 보이는 순간 영역 줄도 이미 다섯 개.
  await expect(p.locator('[data-mr-enabled]')).toBeVisible({timeout: 15000});
  expect(await areas.count()).toBe(5);
  expect(await areas.evaluateAll(list => list.map(i => i.getAttribute('data-mr-area')))).toEqual(['diary', 'calls', 'recordings', 'basket', 'family']);
  for (const key of ['diary', 'calls', 'recordings', 'basket']) await expect(p.locator(`[data-mr-area="${key}"]`)).toBeChecked();
  await expect(p.locator('[data-mr-area="family"]')).not.toBeChecked();
  await expect(p.locator('.sl-group-title', {hasText: '읽을 영역'})).toBeVisible();
  await expect(p).not.toContainText('읽지 않아요: 하루 기록');
  expect(selects.some(s => /area_diary.*area_family/.test(s || ''))).toBe(true);
  expect(selects.some(s => /allowed_client_id/.test(s || ''))).toBe(false);
  await p.locator('[data-mr-area="family"]').check();
  await expect.poll(() => state.patches.length).toBe(1);
  await expect(p.locator('[data-mr-area="family"]')).toBeChecked();
  await p.locator('[data-mr-area="calls"]').uncheck();
  await expect.poll(() => state.patches.length).toBe(2);
  expect(state.patches).toEqual([{area_family: true}, {area_calls: false}]);
  await expect(p.locator('[data-mr-area="calls"]')).not.toBeChecked();
  await expect(p.locator('[data-mr-enabled]')).not.toBeChecked(); // 연결 스위치는 그대로
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(state.errors).toEqual([]);
});

for (const [name, opts] of [['표가 아직 없을 때(DB 적용 전)', {settings: 'missing'}], ['설정 행이 없을 때(다른 사용자)', {row: null}]]) test(`칸: ${name} 칸 없음, 화면 그대로`, async ({page}) => {
  const state = await boot(page, opts);
  await openProfile(page, {enter: false});
  await expect(page.locator('#psPushPanel')).toBeAttached({timeout: 15000});
  await page.waitForTimeout(300);
  await expect(panel(page)).toBeHidden();
  await expect(page.locator('#psRoot [data-ps-open="mcp"]')).toHaveCount(0); // 첫 화면 줄도 없다
  expect(state.patches).toEqual([]);
  expect(state.errors).toEqual([]);
});

const DETAILS = {authorization_id: AUTH_ID, redirect_uri: CALLBACK, scope: 'openid email profile', client: {client_id: 'claude-client', name: 'Claude'}};
async function openConsent(page, {stay = true} = {}) {
  await page.goto(`${appOrigin}/app/oauth-consent/?authorization_id=${AUTH_ID}`);
  await signInWithSession(page, user.email);
  if (stay) await expect(page).toHaveURL(/\/app\/oauth-consent\/\?authorization_id=/, {timeout: 15000});
}

for (const width of [412, 884, 1280]) test(`동의 화면: 읽기만·볼 수 있는 것·볼 수 없는 것·되돌아갈 곳 (${width}px)`, async ({page}) => {
  await page.setViewportSize({width, height: 900});
  const state = await boot(page, {details: DETAILS});
  await openConsent(page);
  await expect(page.locator('[data-mc="approve"]')).toHaveText('허락', {timeout: 15000});
  await expect(page.locator('[data-mc="deny"]')).toHaveText('거절');
  await expect(page.locator('.mc-lead')).toContainText('읽기만');
  await expect(page.locator('.mc-row')).toHaveCount(3);
  await expect(page.locator('.mc-row').nth(2)).toContainText('claude.ai');
  // 3판(설계 15절): 켠 영역만 보이고, 가족 방은 따로 켜야 한다는 것을 허락 전에 보여 준다.
  await expect(page.locator('.mc-row').nth(0)).toContainText('가족 방은 따로 켜야 해요');
  await expect(page.locator('.mc-row').nth(1)).toContainText('꺼 둔 영역');
  await expect(page.locator('.mc-note').first()).toContainText('켜야 읽기가 시작돼요');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({path: `${SHOTS}/consent-${width}.png`});
  expect(state.consents).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('동의 화면: [허락]은 approve 하나 보내고 claude.ai 되돌아올 주소로 간다', async ({page}) => {
  const state = await boot(page, {details: DETAILS});
  await openConsent(page);
  await page.locator('[data-mc="approve"]').click();
  await page.waitForURL(/^https:\/\/claude\.ai\/api\/mcp\/auth_callback\?code=fake-code/);
  expect(state.consents).toEqual([{action: 'approve'}]);
});

test('동의 화면: Supabase가 claude.ai 아닌 주소를 주면 따라가지 않는다', async ({page}) => {
  const state = await boot(page, {details: DETAILS, consent: {redirect_url: 'https://evil.example/cb?code=x'}});
  await openConsent(page);
  await page.locator('[data-mc="deny"]').click();
  await expect(page.locator('.mc-status.is-error')).toHaveText(/claude\.ai가 아니에요/);
  expect(page.url()).toContain('/app/oauth-consent/');
  expect(state.consents).toEqual([{action: 'deny'}]);
});

for (const [name, opts, text] of [
  ['되돌아갈 곳이 claude.ai가 아님', {details: {...DETAILS, redirect_uri: 'https://evil.example/cb'}}, /claude\.ai가 아니에요/],
  ['등록된 Claude가 아님', {details: {...DETAILS, client: {client_id: 'x', name: 'Other App'}}}, /등록된 Claude 연결이 아니에요/],
  ['설정 행 없음', {details: DETAILS, row: null}, /쓰지 않아요/],
]) test(`동의 화면: ${name} → 버튼 없이 거절 글`, async ({page}) => {
  const state = await boot(page, opts);
  await openConsent(page);
  await expect(page.locator('.mc-status.is-error')).toHaveText(text, {timeout: 15000});
  await expect(page.locator('[data-mc]')).toHaveCount(0);
  expect(state.consents).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('동의 화면: 이미 허락한 연결이면 받은 claude.ai 주소로 바로 간다', async ({page}) => {
  await boot(page, {details: {redirect_url: `${CALLBACK}?code=again`}});
  await openConsent(page, {stay: false});
  await page.waitForURL(/^https:\/\/claude\.ai\/api\/mcp\/auth_callback\?code=again/);
});
