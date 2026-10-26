import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// ACT-사진 6단계: 사업 보고 화면의 [목록|달력|사진] 보기. 달력은 사업 보고 화면 안에서만, 사진은 날짜 묶음 격자(크게 보기 재사용),
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
    year: y, month: mo, photoCalls: [], meetingOpens: [], docs,
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
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1);

for (const width of [390, 1440]) {
  test(`report calendar shows the month, today's reports and opens one ${width}`, async ({page}) => {
    const state = makeState();
    const prefs = await open(page, state, width);
    await expect(view(page, '목록')).toHaveAttribute('aria-checked', 'true');
    await view(page, '달력').click();
    const cal = page.locator('#meetingList .rv-cal');
    await expect(cal.locator('.rv-cal-title')).toHaveText(`${state.year}년 ${state.month + 1}월`);
    const days = new Date(state.year, state.month + 1, 0).getDate();
    await expect(cal.locator('[data-rv-day]')).toHaveCount(days);
    // 칸 칩 [회의]가 그대로 걸린다: 투쟁 칸 건은 보이지 않는다.
    await expect(cal.locator(`[data-mrd-meeting="${M5}"]`)).toHaveCount(0);
    // 오늘 고른 날 목록에 회의 셋, 사진 있는 줄은 작은 그림 3장 + 외 2장.
    const list = cal.locator('.rv-day-list .rv-row');
    await expect(list).toHaveCount(3);
    const row1 = cal.locator(`.rv-day-list .rv-row[data-mrd-meeting="${M1}"]`);
    await expect(row1.locator('.report-photo-thumb')).toHaveCount(3);
    await expect(row1.locator('[data-report-photo-more]')).toHaveText('외 2장');
    await expect(row1.locator('.report-photo-thumb[data-state="shown"] img')).toHaveCount(3);
    expect(state.photoCalls.every(c => c.size === 'small')).toBe(true);
    if (width >= 761) {
      // 넓은 화면은 날짜 칸에 제목 둘 + '+1'.
      await expect(cal.locator('.rv-sel .rv-title')).toHaveCount(2);
      await expect(cal.locator('.rv-sel .rv-more')).toHaveText('+1');
    }
    expect(await noOverflow(page)).toBe(true);
    // 보기는 서버에 기억한다.
    await expect.poll(() => prefs.value?.report_view).toBe('calendar');
    // 달 넘기기와 오늘.
    await cal.locator('[data-rv-nav="prev"]').click();
    const prev = new Date(state.year, state.month - 1, 1);
    await expect(cal.locator('.rv-cal-title')).toHaveText(`${prev.getFullYear()}년 ${prev.getMonth() + 1}월`);
    await cal.locator('[data-rv-nav="today"]').click();
    await expect(cal.locator('.rv-cal-title')).toHaveText(`${state.year}년 ${state.month + 1}월`);
    // 목록 줄을 누르면 그 사업 보고 결과 창이 열린다.
    await cal.locator(`.rv-day-list .rv-row[data-mrd-meeting="${M2}"]`).click();
    await expect.poll(() => state.meetingOpens.some(x => x === 'eq.' + M2)).toBe(true);
  });

  test(`report photo view groups photos by day and reuses the big viewer ${width}`, async ({page}) => {
    const state = makeState();
    await open(page, state, width);
    await view(page, '사진').click();
    const box = page.locator('#meetingList .rv-photos');
    await expect(box.locator('.rv-photo-day')).toHaveCount(1);
    await expect(box.locator(`[data-rv-set="${M1}"] .act-photo-thumb`)).toHaveCount(5);
    await expect(box.locator(`[data-rv-set="${M2}"] .act-photo-thumb`)).toHaveCount(1);
    await expect(box.locator(`[data-rv-set="${M3}"]`)).toHaveCount(0);
    await expect(box.locator(`[data-rv-set="${M5}"]`)).toHaveCount(0);
    await expect(box.locator(`[data-rv-set="${M1}"] .rv-set-meta`)).toHaveText('회의 · 사진 5');
    await expect(box.locator(`[data-rv-set="${M1}"] .act-photo-thumb[data-state="shown"] img`)).toHaveCount(5);
    expect(await noOverflow(page)).toBe(true);
    // 크게 보기: 좌우 넘기기와 ⋯ [사업 보고 열기].
    await box.locator(`[data-rv-set="${M1}"] .act-photo-thumb`).nth(1).click();
    const big = page.locator('.basket-photo-view');
    await expect(big.locator('.basket-photo-count')).toHaveText('2/5');
    await big.locator('.basket-photo-step[data-dir="1"]').click();
    await expect(big.locator('.basket-photo-count')).toHaveText('3/5');
    await big.locator('.basket-photo-more-btn').click();
    await big.locator('.basket-photo-more-panel').getByText('사업 보고 열기').click();
    await expect(big).toHaveCount(0);
    await expect.poll(() => state.meetingOpens.some(x => x === 'eq.' + M1)).toBe(true);
  });
}

test('report view choice is remembered on the server and restored', async ({page}) => {
  const state = makeState();
  const prefs = await open(page, state, 1440, {report_view: 'photo'});
  await expect(view(page, '사진')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#meetingList .rv-photos')).toBeVisible();
  await view(page, '목록').click();
  await expect(page.locator('#meetingList .rv-photos')).toHaveCount(0);
  await expect(page.locator('#meetingList .mcol-layout')).toBeVisible();
  await expect.poll(() => prefs.value?.report_view ?? 'list').toBe('list');
});

test('report views still switch when the server cannot remember the choice yet', async ({page}) => {
  const state = makeState();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const prefs = await open(page, state, 390, null, {missingColumn: true});
  await view(page, '달력').click();
  await expect(page.locator('#meetingList .rv-cal')).toBeVisible();
  await view(page, '사진').click();
  await expect(page.locator('#meetingList .rv-photos')).toBeVisible();
  expect(prefs.patches.length).toBe(0);
  expect(errors).toEqual([]);
});
