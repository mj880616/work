import {test, expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {signInWithSession} from './helpers/session-login.mjs';
// S57-23 UI-회의명창가로막대(CC가 1920 폭 운영 화면에서 확인): PC 사업 보고 추가 창의 [회의명] 고르기 창(meeting-name-panel.js·.css) 아래에 가로 스크롤 막대가 보였다.
// 원인은 줄 끝 ⋯(.icon-btn.mnp-more, 폭 30px)의 44px 누르는 자리(base-ui.css 공용 ::after)가 단추 양옆으로 7px씩 나와, 맨 오른쪽 7px이 이 창(overflow-y:auto → 가로도 auto)의
// 가로 넘침이 된 것이다. 이 시험은 창이 가로로 넘치지 않고(scrollWidth ≤ clientWidth), ⋯의 누르는 자리가 여전히 44×44이며 창 안 오른쪽 끝을 넘지 않는지 본다.
// 서버는 가짜, 회의·조직 이름은 모두 지어낸 값. 화면 사진은 UI_REVIEW_DIR(+UI_REVIEW_PHASE=before|after)을 줄 때만 찍는다(폰 412·폴드 884·PC 1280·1920).
// 클래식 가로·세로 막대가 보이는 PC처럼 돌리려고 headless 기본의 --hide-scrollbars를 뺀다(막대가 숨겨지면 사진에서 문제가 안 보인다).
test.use({timezoneId: 'Asia/Seoul', launchOptions: {ignoreDefaultArgs: ['--hide-scrollbars']}});
const BASE = process.env.APP_E2E_ORIGIN || 'http://127.0.0.1:8123';
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const A = 'gaaaaaa1', B = 'gbbbbbb2';
const PARENTS = [{id: A, name: '예시 조직 A'}, {id: B, name: '예시 조직 B'}];
const LONG = '예시 아주 긴 이름의 정기 점검 회의 및 후속 조치 협의 실무 대표단 합동 회의';
const row = (id, name, at) => ({id, workspace_id: 'mp-ws', project_id: null, activity_kind: 'meeting', title: name, series_name: name, meeting_at: at, notes: '', transcript_text: '', created_by: 'mp-user', result_status: 'final'});
const meetings = [row('m1', '예시 회의 1', '2026-11-01T01:00:00Z'), row('m2', '예시 회의 2', '2026-11-05T01:00:00Z'), row('m3', LONG, '2026-11-03T01:00:00Z'), row('m4', '예시 회의 4', '2026-10-01T01:00:00Z'),
  row('m5', '예시 회의 5', '2026-10-02T01:00:00Z'), row('m6', '예시 회의 5', '2026-10-03T01:00:00Z'), row('m7', '예시 회의 5', '2026-10-04T01:00:00Z')];
const key = s => s.replace(/\s+/g, '').toLowerCase();
const reviewDir = process.env.UI_REVIEW_DIR || '', phase = process.env.UI_REVIEW_PHASE || 'after';

async function mock(page, sorts) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    const ok = data => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data ?? null)});
    if (path === '/auth/v1/token') return ok({access_token: 'mp-access', refresh_token: 'mp-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: {id: 'mp-user'}});
    if (path === '/auth/v1/user') return ok({id: 'mp-user', email: 'mp@example.org', user_metadata: {display_name: '회의명 QA'}});
    if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id: 'mp-ws', user_id: 'mp-user', role: 'owner', workspace: {id: 'mp-ws', name: 'QA'}}]);
    if (path === '/rest/v1/app_workspaces') return ok([{id: 'mp-ws', name: 'QA'}]);
    if (path === '/rest/v1/app_profiles') {
      if (method === 'PATCH') return ok([{user_id: 'mp-user', meeting_name_sorts: sorts}]);
      if ((url.searchParams.get('select') || '').includes('meeting_name_sorts')) return ok([{meeting_name_sorts: sorts}]);
      return ok([{user_id: 'mp-user', display_name: '회의명 QA'}]);
    }
    if (path === '/rest/v1/app_meetings') return ok(method === 'GET' ? meetings : []);
    if (path === '/functions/v1/google-calendar') return ok({connected: false, enabled: false, selected: [], calendars: [], events: []});
    if (path === '/functions/v1/google-tasks') return ok({tasks: [], needs_reconnect: false});
    if (path === '/functions/v1/push-notifications') return ok({enabled: false, web_enabled: false, native_enabled: false, public_key: 'qa'});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path.startsWith('/rest/v1/') || path.startsWith('/functions/v1/')) return ok([]);
    return ok({});
  });
}

for (const [label, size] of [['폰 412', {width: 412, height: 915}], ['폴드 펼침 884', {width: 884, height: 900}], ['PC 1280', {width: 1280, height: 900}], ['PC 1920', {width: 1920, height: 1000}]]) {
  test(`${label}: 회의명 고르기 창은 가로로 넘치지 않고(가로 막대 없음) ⋯의 누르는 자리는 그대로 44×44다`, async ({page}) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize(size);
    await mock(page, {parents: PARENTS, orgs: {[key('예시 회의 2')]: A, [key(LONG)]: A, [key('예시 회의 1')]: B}, presets: ['예시 미리 넣은 회의'], order: []});
    await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(`${BASE}/app/?view=meetings`)}`);
    await signInWithSession(page, 'mp@example.org');
    await expect(page.locator('#meetingsView')).toBeVisible({timeout: 15000});
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, {timeout: 15000});
    await page.locator('#newMeetingBtn').click();
    await expect(page.locator('#meetingModal')).toBeVisible();
    await expect(page.locator('#meetingNameSelect')).toHaveAttribute('data-name-panel', '1');
    await page.locator('#meetingNameSelect').selectOption('__other__');
    await page.locator('#meetingNameSelect').click();
    const panel = page.locator('#kptuNamePanel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.mnp-more').first()).toBeVisible();
    if (reviewDir) { mkdirSync(reviewDir, {recursive: true}); await page.screenshot({path: `${reviewDir}/${phase}-name-panel-${size.width}.png`}); }
    // 가로로 넘치지 않는다(막대 없음). 세로 목록이 길면 세로로만 내린다.
    const fit = await panel.evaluate(el => ({scroll: el.scrollWidth, client: el.clientWidth, barBelow: el.offsetHeight - el.clientHeight - 2 * (parseFloat(getComputedStyle(el).borderTopWidth) || 0)}));
    expect(fit.scroll, `가로 넘침 ${fit.scroll - fit.client}px`).toBeLessThanOrEqual(fit.client);
    // 넘침을 숨겨 덮지 않았다: 창은 지금도 세로 스크롤(overflow-y:auto) 규칙 그대로고, 가로만 보이지 않게 잘라 두지 않는다.
    expect(await panel.evaluate(el => getComputedStyle(el).overflowX)).not.toBe('hidden');
    // 모든 줄의 ⋯: 누르는 자리(::after) 44×44는 그대로, 오른쪽 끝은 단추 끝에 맞고 왼쪽으로만 넓어진다.
    const hit = await panel.locator('.mnp-more').evaluateAll(buttons => buttons.map(b => { const a = getComputedStyle(b, '::after'), r = b.getBoundingClientRect(); return {w: parseFloat(a.width), h: parseFloat(a.height), right: parseFloat(a.right), left: parseFloat(a.left), btnW: Math.round(r.width)}; }));
    expect(hit.length).toBeGreaterThan(3);
    for (const h of hit) { expect(h.w).toBe(44); expect(h.h).toBe(44); expect(h.right).toBe(0); expect(h.left).toBe(h.btnW - 44); }
    // 모든 줄이 창 안에 있고, 긴 이름도 가로로 밀지 않는다(PC는 창 폭이 가장 긴 이름에 맞고, 폰은 줄바꿈).
    const box = await panel.boundingBox();
    for (const r of await panel.locator('.mnp-row').all()) { const b = await r.boundingBox(); expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}
