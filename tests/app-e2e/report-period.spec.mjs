import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// REPORT-기간고르기(S49-11): 사업 보고 기간 줄 [전체][주간 보기][기간 설정] — 고른 기간을 서버(view_prefs.report_period)에 기억하고 다시 열어도 유지.
// (가짜 서버·가짜 보고는 report-views.spec.mjs와 같은 틀.)
// 원래 설명: 사업 보고 화면의 [목록|달력|사진] 보기. 달력은 사업 보고 화면 안에서만, 사진은 날짜 묶음 격자(크게 보기 재사용),
// 고른 보기는 서버(프로필 view_prefs.report_view)에 기억하고 칸이 아직 없는 서버(적용 전)면 기억만 건너뛴다. 모든 이름·번호는 합성 값.
test.use({timezoneId: 'Asia/Seoul'});
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const M1 = ID(901), M2 = ID(902), M3 = ID(903), M4 = ID(904), M5 = ID(905);
const now = () => new Date().toISOString();
const seoulKey = d => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Seoul'}).format(d);

function makeState() {
  const at = new Date(Date.now()), today = at.toISOString();
  const [y, mo] = seoulKey(at).split('-').map(Number);
  const meeting = (id, title, kind, when) => ({id, workspace_id: 'workspace-1', title, series_name: title, round_no: null, meeting_at: when, activity_kind: kind, created_by: 'user-1', notes: '', decisions: '', transcript_text: '원문'});
  const doc = (n, mid, name = `s${n}.jpg`) => ({id: ID(n), workspace_id: 'workspace-1', project_id: null, title: '사진 ' + n, file_name: name, mime_type: 'image/jpeg', category: '회의', tags: [], meeting_id: mid, file_id: 'drive-' + n, created_at: `2026-10-0${n % 9 + 1}T00:00:00Z`, document_date: '2026-10-20'});
  const docs = [];
  for (let k = 1; k <= 5; k++) docs.push(doc(10 + k, M1));
  docs.push(doc(21, M2), doc(31, M5));
  return {
    year: y, month: mo - 1, photoCalls: [], meetingOpens: [], docs,
    user: {id: 'user-1', email: 'owner@example.org', user_metadata: {display_name: '관리자'}},
    workspace: {id: 'workspace-1', slug: 'team', name: '웹2'},
    meetings: [meeting(M1, '○○ 대표자 회의', 'meeting', today), meeting(M2, '□□ 실무 회의', 'meeting', today), meeting(M3, '△△ 점검 회의', 'meeting', today),
      meeting(M4, '지난 회의', 'meeting', new Date(Date.now() - 40 * 86400000).toISOString()), meeting(M5, '◇◇ 결의대회', 'struggle', today)]
  };
}

async function mock(page, state) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const ok = data => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data ?? null)});
    if (path === '/auth/v1/token') return ok({access_token: 'e2e-access', refresh_token: 'e2e-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: state.user});
    if (path === '/auth/v1/user') return ok(state.user);
    if (path === '/auth/v1/logout') return ok({});
    if (path === '/functions/v1/library-files' && req.method() === 'GET') {
      state.photoCalls.push({id: url.searchParams.get('document_id'), size: url.searchParams.get('size')});
      return route.fulfill({status: 200, contentType: 'image/png', body: PNG});
    }
    if (path === '/functions/v1/google-calendar') return ok({connected: false, enabled: false, selected: [], calendars: [], events: [], eventColors: {}});
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id: 'workspace-1', user_id: state.user.id, role: 'owner', workspace: state.workspace, created_at: now()}]);
    if (path === '/rest/v1/app_workspaces') return ok([state.workspace]);
    if (path === '/rest/v1/app_documents' && req.method() === 'GET') return ok(state.docs);
    if (path === '/rest/v1/app_meetings' && req.method() === 'GET') {
      const id = url.searchParams.get('id') || '';
      if (!id || id.startsWith('in.(')) return ok(state.meetings);
      state.meetingOpens.push(id);
      return ok(state.meetings.filter(m => 'eq.' + m.id === id));
    }
    if (path === '/rest/v1/app_profiles') return ok([{user_id: state.user.id, display_name: '관리자'}]);
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
}

async function open(page, state, width, prefsInitial = null, prefsOptions = {}) {
  await page.setViewportSize({width, height: 900});
  const prefs = await installViewPrefsServer(page, prefsInitial, prefsOptions);
  await mock(page, state);
  await page.goto(`${appOrigin}/app/?view=meetings`);
  await enterLogin(page);
  await signInWithSession(page, 'owner@example.org');
  await page.waitForFunction(() => window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#reportViewFilter [data-filter-value]')).toHaveCount(3);
  return prefs;
}
const view = (page, label) => page.locator('#reportViewFilter').getByRole('radio', {name: label});
const chip = (page, v) => page.locator(`#reportWeekFilter [data-report-week="${v}"]`);
const label = page => page.locator('#reportWeekFilter .report-week-label');
const kindNamesIn = page => page.locator('#meetingList .mcol-kinds .mcol-name, #meetingList .meeting-list-title h3');
const daysAgo = n => seoulKey(new Date(Date.now() - n * 86400000));

for (const width of [1440, 390]) test(`${width}: 기간 칩 세 개 한 줄 — 기본은 주간 보기, [전체]는 ‹ › 없이 '전체 n건'`, async ({page}) => {
  const state = makeState();
  await open(page, state, width);
  await expect(page.locator('#reportWeekFilter .report-period-chips button')).toHaveText(['전체', '주간 보기', '기간 설정']);
  await expect(chip(page, 'week')).toHaveAttribute('aria-checked', 'true');
  await expect(chip(page, 'prev')).toBeVisible();
  const tops = await page.locator('#reportWeekFilter .report-period-chips > *').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
  await chip(page, 'all').click();
  await expect(chip(page, 'all')).toHaveAttribute('aria-checked', 'true');
  await expect(chip(page, 'week')).toHaveAttribute('aria-checked', 'false');
  await expect(label(page)).toContainText('전체');
  await expect(chip(page, 'prev')).toHaveCount(0);
  await expect(chip(page, 'next')).toHaveCount(0);
  await chip(page, 'week').click();
  await expect(chip(page, 'prev')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1)).toBe(true);
});

test('기간 설정: 달력으로 시작·끝 날을 고르면 그 기간 보고만 보이고, 서버에 기억해 다시 열어도 같다', async ({page}) => {
  const state = makeState();
  const prefs = await open(page, state, 1440);
  const from = daysAgo(41), to = daysAgo(39);
  await chip(page, 'range').click();
  const panel = page.locator('[data-report-period-panel]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('input[type="date"]')).toHaveCount(2);
  await expect(panel.locator('[data-report-quick]')).toHaveText(['이번 달', '지난 달', '최근 3달']);
  // 시작이 끝보다 늦으면 적용되지 않는다.
  await panel.locator('[data-report-from]').fill(to);
  await panel.locator('[data-report-to]').fill(from);
  await panel.locator('[data-report-week="apply"]').click();
  await expect(panel).toBeVisible();
  await panel.locator('[data-report-from]').fill(from);
  await panel.locator('[data-report-to]').fill(to);
  await panel.locator('[data-report-week="apply"]').click();
  await expect(panel).toHaveCount(0);
  await expect(chip(page, 'range')).toHaveAttribute('aria-checked', 'true');
  await expect(label(page)).toContainText('1건');
  await expect(chip(page, 'prev')).toHaveCount(0);
  await expect(page.locator('#meetingList')).toContainText('지난 회의');
  await expect(page.locator('#meetingList')).not.toContainText('○○ 대표자 회의');
  await expect.poll(() => prefs.value?.report_period).toEqual({mode: 'range', from, to});
  // 다시 열어도 고른 기간 그대로(서버 기억).
  const saved = prefs.value;
  const page2 = await page.context().newPage();
  await open(page2, makeState(), 1440, saved);
  await expect(chip(page2, 'range')).toHaveAttribute('aria-checked', 'true');
  await expect(page2.locator('#meetingList')).toContainText('지난 회의');
  await expect(page2.locator('#meetingList')).not.toContainText('○○ 대표자 회의');
  // × 로 지우면 주간 보기로 돌아가고 기억도 비운다.
  await page2.locator('#reportWeekFilter [data-report-week="clear"]').click();
  await expect(chip(page2, 'week')).toHaveAttribute('aria-checked', 'true');
});

test('빠른 칩 [최근 3달]은 바로 적용된다', async ({page}) => {
  const state = makeState();
  const prefs = await open(page, state, 1440);
  await chip(page, 'range').click();
  await page.locator('[data-report-quick="last-3"]').click();
  await expect(chip(page, 'range')).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => prefs.value?.report_period?.mode).toBe('range');
  await expect(page.locator('#meetingList')).toContainText('지난 회의');
});
