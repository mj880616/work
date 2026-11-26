import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { pickReportBox } from './helpers/report-boxes.mjs';
import { pickReportFilter } from './helpers/report-filter.mjs';

// S71-10 사업 관리 주 이동 한 줄(사용자 11/26 14:41 "한 줄에 우겨넣고 싶어"): 사업 관리 첫 줄 =
// [고르기(폰은 칩 하나)] ‹ 11.23(월)~11.29(일) › · n건 ……… [녹음][+][⋯]. 둘째 줄은 없다(폰·폴드·PC 모두).
// 줄이 모자라면 ① 요일을 빼고(11.23~11.29) ② 건수를 짧게(n건) ③ 그래도 넘치면 칩 끝 말줄임 — 글자 겹침·잘림·가로 넘침 없음.
// ‹ › 누르기는 그대로 주를 넘긴다. (가짜 서버·가짜 보고는 biz-top-tidy.spec.mjs와 같은 틀. 모든 이름은 합성 값.)
test.use({timezoneId: 'Asia/Seoul'});
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function makeState(undated = false) {
  const today = new Date().toISOString();
  const meeting = (id, title, when) => ({id, workspace_id: 'workspace-1', title, series_name: title, round_no: null, meeting_at: when, activity_kind: 'meeting', created_by: 'user-1', notes: '', decisions: '', transcript_text: '원문'});
  const LONG = '합성 대표자 회의 이름이 꽤 긴 경우';
  const meetings = [meeting(ID(1), LONG, today), meeting(ID(2), '합성 실무 회의', today), meeting(ID(3), '합성 점검 회의', today)];
  if (undated) meetings.push(meeting(ID(4), LONG, null));
  return {
    user: {id: 'user-1', email: 'owner@example.org', user_metadata: {display_name: '관리자'}},
    workspace: {id: 'workspace-1', slug: 'team', name: '웹2'},
    spaces: [{id: 'area-1', workspace_id: 'workspace-1', name: '합성 사업', description: null, parent_id: null, status: 'active', visibility: 'private', owner_id: 'user-1', sort_order: 10, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', metadata: {project_system: 'v2', management_version: 2}}],
    meetings
  };
}

async function mock(page, state) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const ok = data => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data ?? null)});
    if (path === '/auth/v1/token') return ok({access_token: 'e2e-access', refresh_token: 'e2e-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: state.user});
    if (path === '/auth/v1/user') return ok(state.user);
    if (path === '/auth/v1/logout') return ok({});
    if (path === '/functions/v1/google-calendar') return ok({connected: false, enabled: false, selected: [], calendars: [], events: [], eventColors: {}});
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id: 'workspace-1', user_id: state.user.id, role: 'owner', workspace: state.workspace, created_at: new Date().toISOString()}]);
    if (path === '/rest/v1/app_workspaces') return ok([state.workspace]);
    if (path === '/rest/v1/app_spaces' && req.method() === 'GET') return ok(state.spaces);
    if (path === '/rest/v1/app_meetings' && req.method() === 'GET') return ok(state.meetings);
    if (path === '/rest/v1/app_profiles') return ok([{user_id: state.user.id, display_name: '관리자'}]);
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
}

async function open(page, width, state = makeState()) {
  await page.setViewportSize({width, height: 860});
  await installViewPrefsServer(page, null, {});
  await mock(page, state);
  await page.goto(`${appOrigin}/app/?view=meetings`);
  await enterLogin(page);
  await signInWithSession(page, 'owner@example.org');
  await page.waitForFunction(() => window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#reportWeekFilter .report-week-label')).toBeVisible();
}

// 첫 줄에 보이는 것들을 왼쪽부터: 고르기(칩 또는 상자들) / 주 줄(‹ 날짜 › · n건) / [녹음][+][⋯].
function measure(page) {
  return page.evaluate(() => {
    const vis = e => e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
    const box = e => { const r = e.getBoundingClientRect(); return {left: r.left, right: r.right, mid: r.top + r.height / 2, w: r.width}; };
    const top = document.querySelector('#meetingsView .report-top');
    const chip = document.querySelector('#reportFilterChip');
    const filters = (vis(chip) ? [chip] : [...document.querySelectorAll('#meetingsView .report-kind-bar > select, #meetingsView .report-kind-bar #reportPeriodPick select')]).filter(vis).map(box);
    const week = [...document.querySelectorAll('#reportWeekFilter .report-week-nav > *')].filter(vis).map(box);
    const acts = [...document.querySelectorAll('#meetingsView .report-head-actions > :not([hidden])')].filter(vis).map(box);
    const label = document.querySelector('#reportWeekFilter .report-week-label');
    const count = document.querySelector('#reportWeekFilter .report-week-count');
    const topBox = top.getBoundingClientRect();
    return {filters, week, acts, top: {left: topBox.left, right: topBox.right, scroll: top.scrollWidth, client: top.clientWidth},
      page: {scroll: document.documentElement.scrollWidth, inner: innerWidth},
      label: label.innerText.trim(), labelFits: label.scrollWidth <= label.clientWidth + 1, count: count.innerText.trim(),
      steps: ['is-week-short', 'is-week-tight', 'is-week-squeeze'].filter(c => top.classList.contains(c))};
  });
}

function expectOneLine(m) {
  expect(m.filters.length).toBeGreaterThanOrEqual(1);
  expect(m.week.length).toBeGreaterThanOrEqual(3);
  expect(m.acts.length).toBeGreaterThanOrEqual(2);
  const all = [...m.filters, ...m.week, ...m.acts], mids = all.map(x => x.mid);
  // 한 줄: 가운데 높이가 모두 같다.
  expect(Math.max(...mids) - Math.min(...mids)).toBeLessThanOrEqual(3);
  // 차례·겹침 없음: 고르기 → 주 줄 → 아이콘.
  expect(Math.max(...m.filters.map(x => x.right))).toBeLessThanOrEqual(Math.min(...m.week.map(x => x.left)) + 0.5);
  expect(Math.max(...m.week.map(x => x.right))).toBeLessThanOrEqual(Math.min(...m.acts.map(x => x.left)) + 0.5);
  // 줄 안·화면 안(가로 넘침 없음).
  for (const x of all) { expect(x.left).toBeGreaterThanOrEqual(m.top.left - 0.5); expect(x.right).toBeLessThanOrEqual(m.top.right + 0.5); }
  expect(m.top.scroll).toBeLessThanOrEqual(m.top.client + 1);
  expect(m.page.scroll).toBeLessThanOrEqual(m.page.inner);
  // 날짜 글자는 잘리지 않는다(요일을 빼도 날짜 둘은 그대로).
  expect(m.labelFits).toBe(true);
  expect(m.label).toMatch(/^\d{1,2}\.\d{1,2}(\(월\))?~\d{1,2}\.\d{1,2}(\(일\))?$/);
}

// 390 폰, 344 폴드 접힘(바깥 화면), 320 가장 좁은 폰, 884 폴드 펼침, 1280 PC.
for (const width of [390, 344, 320, 884, 1280]) test(`${width}: 주 이동이 첫 줄 [고르기]와 [+][⋯] 사이에 한 줄로 서고, 넘침·겹침이 없으며 ‹ ›는 그대로 주를 넘긴다`, async ({page}) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await open(page, width);
  // 둘째 줄이 따로 없다: 주 줄 상자가 첫 줄(.report-top) 높이 안에 있다.
  await expect.poll(async () => { const m = await measure(page); const mids = [...m.filters, ...m.week, ...m.acts].map(x => x.mid); return Math.max(...mids) - Math.min(...mids); }).toBeLessThanOrEqual(3);
  const first = await measure(page);
  expectOneLine(first);
  // 넓은 화면(PC)은 줄이지 않는다: 요일과 '· 3건' 그대로.
  if (width >= 884) { expect(first.steps).toEqual([]); expect(first.label).toContain('(월)'); expect(first.count).toBe('· 3건'); }
  // 칩 '전체'처럼 짧은 고른 값은 가장 좁은 폰(320)에서도 잘리지 않는다(칩 끝 말줄임 단계까지 가지 않음).
  expect(first.steps).not.toContain('is-week-squeeze');
  // 건수는 줄여도 숫자는 남는다.
  expect(first.count).toMatch(/3건/);
  // 글자 원문은 그대로(화면 읽기·다른 시험이 보는 글자).
  await expect(page.locator('#reportWeekFilter .report-week-label')).toHaveText(/^\d{1,2}\.\d{1,2}\(월\)~\d{1,2}\.\d{1,2}\(일\)$/);
  // ‹ 누르면 지난 주, 여전히 한 줄. › 누르면 이번 주로 돌아온다.
  const label = page.locator('#reportWeekFilter .report-week-label');
  const now = await label.textContent();
  await page.locator('#reportWeekFilter [data-report-week="prev"]').click();
  await expect(label).not.toHaveText(now);
  expectOneLine(await measure(page));
  await page.locator('#reportWeekFilter [data-report-week="next"]').click();
  await expect(label).toHaveText(now);
  expectOneLine(await measure(page));
  expect(errors).toEqual([]);
});

// 폰 좁은 폭에서 칩 글자가 길고 '일시 없음'까지 있어도 한 줄 — 단계(요일 빼기 → 건수 짧게 → 칩 끝 말줄임)로 줄인다.
for (const width of [344, 390]) test(`${width}: 고른 값이 길고 일시 없는 보고가 있어도 한 줄 유지(요일 빼기·건수 짧게·칩 말줄임 차례)`, async ({page}) => {
  await open(page, width, makeState(true));
  await pickReportFilter(page, 'name', '합성 대표자 회의 이름이 꽤 긴 경우');
  await expect(page.locator('#reportFilterChip')).toContainText('합성 대표자 회의');
  await expect.poll(async () => (await measure(page)).week.length).toBeGreaterThanOrEqual(3);
  const m = await measure(page);
  expectOneLine(m);
  // 단계는 앞에서부터 차례로만 붙는다.
  const order = ['is-week-short', 'is-week-tight', 'is-week-squeeze'];
  expect(m.steps).toEqual(order.slice(0, m.steps.length));
  if (m.steps.includes('is-week-short')) expect(m.label).not.toContain('(');
  if (m.steps.includes('is-week-tight')) expect(m.count).toMatch(/^\d+건$/);
  // 글자 원문(일시 없음 포함)은 그대로 남는다.
  await expect(page.locator('#reportWeekFilter .report-week-count')).toHaveText('· 3건 · 일시 없음 1');
});

// 기간 정하기 창이 열리면 그 창(과 주 줄)만 아래 한 줄을 다 쓴다(앞 결정 그대로).
test('390: 기간 정하기 창은 첫 줄 아래 한 칸', async ({page}) => {
  await open(page, 390);
  await pickReportBox(page, '#reportPeriodPick [data-report-period]', 'range');
  const panel = page.locator('#reportWeekFilter .report-period-panel');
  await expect(panel).toBeVisible();
  const [p, add] = await Promise.all([panel.boundingBox(), page.locator('#newMeetingBtn').boundingBox()]);
  expect(p.y).toBeGreaterThanOrEqual(add.y + add.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
