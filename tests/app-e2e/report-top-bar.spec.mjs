import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// S52-22 TEAM-맨위한줄(요청 11/07 16:18, 시안 docs/design/mockups/report-top-bar.html): 사업 보고 맨 위는 언제나 한 줄 [종류 ▾][사업영역 ▾][녹음][⋯]
// + 기간 한 줄 '‹ 날짜 · n건 › [이번 주 ▾]', '거르기'라는 말이 없고, [목록|달력|사진]은 탭 자리 규칙(폰 아래 가운데·폴드 오른쪽 아래·PC 위).
// (가짜 서버·가짜 보고는 report-period.spec.mjs와 같은 틀. 모든 이름·번호는 합성 값.)
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
  await expect(page.locator('#reportViewSelect option')).toHaveCount(3);
  return prefs;
}
const tops = els => els.map(e => { const r = e.getBoundingClientRect(); return Math.round(r.top + r.height / 2); });
const visibleIn = sel => document.querySelectorAll(sel);
async function lineCenters(page, sel) {
  return page.locator(sel).evaluateAll(els => els.filter(e => e.getClientRects().length && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden').map(e => { const r = e.getBoundingClientRect(); return {mid: Math.round(r.top + r.height / 2), right: r.right, w: r.width}; }));
}
for (const width of [412, 884, 1280, 1440]) test(`${width}: 맨 위 한 줄 + 기간 한 줄, '거르기' 말 없음, 보기 탭 자리`, async ({page}) => {
  const state = makeState();
  await open(page, state, width);
  const bar = page.locator('#meetingsView .report-kind-bar');
  await expect(bar).toBeVisible();
  // 줄 안 보이는 것들이 모두 한 줄(가운데 높이 같음)이고 줄이 화면 안이다.
  // BIZ-위쪽정돈(11/09 01:22 확정안): [녹음][+][⋯]는 맨 윗줄(.report-top-line)로 올라가 이 둘째 줄은 종류·사업영역·[주 ▾]만이다.
  // BIZ-위쪽정돈PC(11/09 10:52 A안): PC(761px~)는 위쪽 세 줄이 한 줄 — 고르기·‹ 날짜 › · n건·[녹음][+][⋯]가 모두 같은 높이다.
  const pcOne = width >= 761 ? ', #reportWeekFilter .report-week-nav > *, #meetingsView .report-top-line .report-head-actions > :not([hidden])' : '';
  const items = await lineCenters(page, '#meetingsView .report-kind-bar > select, #meetingsView .report-kind-bar #reportPeriodPick select' + pcOne).then(xs => xs.filter(x => x.mid < 300));
  expect(items.length).toBeGreaterThanOrEqual(width >= 761 ? 7 : 2);
  const mids = items.map(x => x.mid);
  expect(Math.max(...mids) - Math.min(...mids)).toBeLessThanOrEqual(3);
  const box = await bar.boundingBox();
  expect(box.height).toBeLessThanOrEqual(48);
  for (const x of items) expect(x.right).toBeLessThanOrEqual(width + 1);
  await expect(page.locator('#meetingsView')).not.toContainText('거르기');
  // 종류: 모든 폭에서 고르기 상자 하나(BIZ-위쪽정돈PC: PC 칩 줄 없앰).
  await expect(page.locator('#reportKindSelect')).toBeVisible(); await expect(page.locator('#reportKindFilter')).toHaveCount(0);
  // 녹음·⋯는 맨 위 줄 안.
  await expect(page.locator('#meetingsView .report-top-line #reportMore')).toBeVisible();
  // BIZ-위쪽정돈(11/09, B안): 기간은 두 줄로 나뉜다 — [이번 주 ▾]는 둘째 줄(종류·사업영역 옆), '‹ 날짜 › · n건'은 셋째 줄(폰). PC(761px~)는 BIZ-위쪽정돈PC로 한 줄.
  const period = page.locator('#reportPeriodPick [data-report-period]');
  await expect(period).toBeVisible();
  await expect(period).toHaveValue('week');
  await expect(page.locator('#reportWeekFilter .report-week-label')).toContainText(/\(월\)~.*\(일\)/);
  await expect(page.locator('#reportWeekFilter .report-week-count')).toContainText(/· \d+건/);
  const pmids = (await lineCenters(page, '#reportWeekFilter .report-week-nav > *')).map(x => x.mid);
  expect(Math.max(...pmids) - Math.min(...pmids)).toBeLessThanOrEqual(3);
  // UI-보기탭드롭다운(11/10): 보기는 탭 줄이 아니라 기간 [이번 주 ▾] 바로 옆 고르기 상자 [목록 ▾] — 모든 폭에서 같은 줄, 같은 높이, 떠 있지 않음.
  const viewBox = await page.locator('#reportViewSelect').boundingBox(), periodBox = await page.locator('#reportPeriodPick').boundingBox();
  expect(Math.abs((viewBox.y + viewBox.height / 2) - (periodBox.y + periodBox.height / 2))).toBeLessThanOrEqual(2);
  expect(viewBox.x).toBeGreaterThanOrEqual(periodBox.x + periodBox.width - 0.5);
  expect(viewBox.x - (periodBox.x + periodBox.width)).toBeLessThanOrEqual(12);
  expect(Math.round(viewBox.height)).toBe(Math.round((await page.locator('#reportKindSelect').boundingBox()).height));
  await expect(page.locator('#reportViewSelect')).toHaveValue('list');
  await expect(page.locator('#reportViewSelect option')).toHaveText(['목록', '달력', '사진']);
  await expect(page.locator('#reportViewFilter')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1)).toBe(true);
  // 화면 칸 안에서도 옆으로 넘치지 않는다(button-sizing.spec와 같은 재기).
  expect(await page.locator('#meetingsView').evaluate(el => { const out = [...el.querySelectorAll('*')].filter(e => getComputedStyle(e).position !== 'fixed' && e.getBoundingClientRect().right > el.getBoundingClientRect().right + 1).map(e => e.id || e.className).slice(0, 5); return {over: el.scrollWidth > el.clientWidth, out}; })).toEqual({over: false, out: []});
  if (process.env.SHOT_DIR) await page.screenshot({path: `${process.env.SHOT_DIR}/report-top-${width}.png`});
});

test('412: [종류 ▾]로 선택하면 그 칸만 보이고 글자가 진해지며, [회의]일 때 회의명도 같은 상자에서 선택한다', async ({page}) => {
  const state = makeState();
  await open(page, state, 412);
  const kind = page.locator('#reportKindSelect');
  await expect(kind.locator('option').first()).toHaveText('종류 전체');
  await expect(kind).toHaveValue('kind:meeting');
  await expect(kind.locator('optgroup[label="회의명"] option')).toContainText(['○○ 대표자 회의']);
  await kind.selectOption('name:○○ 대표자 회의');
  await expect(page.locator('#meetingList .meeting-list-row')).toHaveCount(1);
  await kind.selectOption('kind:all');
  await expect(kind).toHaveValue('kind:all');
  await expect(kind).not.toHaveClass(/is-on/);
  await kind.selectOption('kind:struggle');
  await expect(kind).toHaveClass(/is-on/);
  await expect(page.locator('#meetingList .meeting-list-row')).toHaveCount(1);
  await expect(page.locator('#meetingList')).toContainText('◇◇ 결의대회');
});

test('412: [이번 주 ▾] — 전체 기간·기간 정하기·주 넘기면 주 단위, 이번 주로 돌아오기', async ({page}) => {
  const state = makeState();
  await open(page, state, 412);
  const period = page.locator('#reportPeriodPick [data-report-period]'), label = page.locator('#reportWeekFilter .report-week-nav');
  await expect(period.locator('option:not([hidden])')).toHaveText(['이번 주', '주차 선택', '전체 기간', '기간 정하기']);
  await page.locator('#reportWeekFilter [data-report-week="prev"]').click();
  await expect(period).toHaveValue('');
  await expect(period).toHaveClass(/is-on/);
  await period.selectOption('week');
  await expect(period).toHaveValue('week');
  await expect(period).not.toHaveClass(/is-on/);
  await period.selectOption('all');
  await expect(label).toContainText('전체');await expect(page.locator('#reportWeekFilter .report-week-count')).toContainText('건');
  await expect(page.locator('#reportWeekFilter [data-report-week="prev"]')).toHaveCount(0);
  await period.selectOption('range');
  await expect(page.locator('#reportWeekFilter [data-report-period-panel]')).toBeVisible();
});
