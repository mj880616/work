import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { openReportBoxes, closeReportBoxes, pickReportBox } from './helpers/report-boxes.mjs';

// S54-21 BIZ-위쪽정돈(요청함 11/09 00:10~01:22, 시안 docs/design/mockups/biz-report-top.html 확정안 01:22):
// 사업 보고 위쪽은 세 줄 — ① 제목 '사업 관리' ……… [녹음][+][⋯] ② [회의 ▾][사업영역 ▾][주 ▾] ③ ‹ 11.9~11.15 › · n건.
// BIZ-위쪽정돈PC(명진 11/09 10:52 A안, 시안 biz-report-top-pc.html): PC(761px~)는 같은 요소가 한 줄 — ② ③ ……… [녹음][+][⋯](작은 아이콘, 폰과 같은 버튼·순서).
// 주 고르기는 이 화면에 하나, '이번 주 주간보고'는 늘 펼친 채 같은 주를 따르고, 떠 있는 동그란 [+]는 없다. [목록|달력|사진]은 앞 자리 규칙 그대로(위로 올리지 않음).
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
    // MULTI-사업보고빈화면: 이 시험은 사업영역이 있는 계정(명진)의 위쪽 줄·주간보고 표를 본다. 사업영역 0개(새 계정)는 biz-week-none.spec.mjs.
    spaces: [{id: 'area-1', workspace_id: 'workspace-1', name: '합성 사업', description: null, parent_id: null, status: 'active', visibility: 'private', owner_id: 'user-1', sort_order: 10, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', metadata: {project_system: 'v2', management_version: 2}}],
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
    if (path === '/rest/v1/app_spaces' && req.method() === 'GET') return ok(state.spaces);
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

const mids = async (page, sel) => (await page.locator(sel).evaluateAll(els => els.filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').map(e => { const r = e.getBoundingClientRect(); return {mid: Math.round(r.top + r.height / 2), top: r.top, bottom: r.bottom, right: r.right, h: r.height}; })));
for (const width of [390, 884, 1280, 1440]) test(`${width}: 위쪽 세 줄(PC 한 줄) · 주 고르기 하나 · 이번 주 주간 보고 늘 펼침 · 떠 있는 버튼 없음`, async ({page}) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const state = makeState();
  await open(page, state, width);
  const vp = page.viewportSize();
  const pc = width >= 761;
  // ① 첫 줄: 오른쪽 끝 [+] 하나(BIZ-머리한줄 S71-23 — [녹음]·⋯는 [+] 메뉴 안). 폰 제목 '사업 관리'는 앱 머리 줄이고 첫 줄도 그 머리 줄 안.
  const line1 = await mids(page, '#reportTop .report-head-actions > :not([hidden])');
  expect(line1.length).toBe(1);
  expect(Math.max(...line1.map(x => x.mid)) - Math.min(...line1.map(x => x.mid))).toBeLessThanOrEqual(3);
  if (width < 761) await expect(page.locator('#appView > .mobile-shell-header [data-mobile-view-name]')).toHaveText('사업 관리');
  await expect(page.locator('#reportViewSelect option')).toHaveCount(3);
  await expect(page.locator('#reportTop #newMeetingBtn')).toBeVisible();
  await expect(page.locator('#reportMore, #reportRecordBtn, #phoneRecordBtn')).toHaveCount(0);
  // ② 둘째 줄: [회의 ▾](모든 폭 상자, 칩 줄 없음)·[사업영역 ▾]·[주 ▾]가 한 줄이고 폰은 첫 줄 아래, PC는 첫 줄과 같은 줄(아이콘 왼쪽).
  await expect(page.locator('#reportKindFilter, #reportNameSelect')).toHaveCount(0);
  // S67-75 UI-걸러보기칩하나(명진 A안): 폰은 고르기 상자들이 줄에 다 안 들어가면 칩 하나 — 그 칩이 둘째 줄 자리다.
  const inChip = !pc && await page.locator('#reportFilterChip').isVisible();
  const line2 = await mids(page, inChip ? '#reportFilterChip' : `#reportFilterBar > #reportKindSelect, #reportFilterBar > #reportAreaSelect, #reportFilterBar #reportPeriodPick select`);
  expect(line2.length).toBeGreaterThanOrEqual(inChip ? 1 : 2);
  expect(Math.max(...line2.map(x => x.mid)) - Math.min(...line2.map(x => x.mid))).toBeLessThanOrEqual(3);
  if (pc) { expect(Math.abs(line2[0].mid - line1[0].mid)).toBeLessThanOrEqual(3); expect(Math.max(...line2.map(x => x.right))).toBeLessThan(Math.min(...line1.map(x => x.right)) - 32); }
  // BIZ-머리한줄(S71-23): 폰은 앱 머리 줄 하나 — [W] 사업 관리 [고르기(넘치면 칩 하나)] n건 … [+] 찾기.
  else {
    expect(Math.abs(line2[0].mid - line1[0].mid)).toBeLessThanOrEqual(3);
    const [bar, add, name] = await Promise.all([page.locator(inChip ? '#reportFilterChip' : '#reportFilterBar').boundingBox(), page.locator('#newMeetingBtn').boundingBox(), page.locator('#appView > .mobile-shell-header [data-mobile-view-name]').boundingBox()]);
    expect(Math.abs((bar.y + bar.height / 2) - (name.y + name.height / 2))).toBeLessThanOrEqual(3);
    expect(bar.x).toBeGreaterThanOrEqual(name.x + name.width);
    expect(bar.x + bar.width).toBeLessThanOrEqual(add.x);
  }
  // [+]는 모든 폭에서 글자 없는 작은 아이콘(이름은 화면 읽기용).
  for (const b of await page.locator('#reportTop .report-head-actions > #newMeetingBtn').all()) { const r = await b.boundingBox(); expect(r.width).toBeLessThanOrEqual(34); expect(r.height).toBeLessThanOrEqual(34); }
  // 작은 버튼 상자 높이가 같다(고르기 상자끼리).
  if (inChip) await openReportBoxes(page);
  const selH = (await mids(page, '#reportFilterBar select.report-top-select')).map(x => Math.round(x.h));
  expect(new Set(selH).size).toBe(1);
  if (inChip) { expect(Math.round((await page.locator('#reportFilterChip').boundingBox()).height)).toBe(selH[0]); await closeReportBoxes(page); }
  // ③ BIZ-머리한줄(S71-23): 첫 줄에는 건수만(n건), 주 넘기기 ‹ 11.23~11.29 ›는 '이번 주 주간 보고' 상자 제목 줄 — 이름·‹ 날짜 ›·꺾쇠가 한 줄.
  await expect(page.locator('#reportCount .report-week-count')).toHaveText(/^\d+건/);
  const nav = page.locator('#bizWeekBox .biz-week-nav');
  await expect(nav.locator('.report-week-label')).toHaveText(/^\d{1,2}\.\d{1,2}~\d{1,2}\.\d{1,2}$/);
  const line3 = await mids(page, '#bizWeekBox .biz-week-title > *, #bizWeekBox .biz-week-nav > *');
  expect(Math.max(...line3.map(x => x.mid)) - Math.min(...line3.map(x => x.mid))).toBeLessThanOrEqual(3);
  expect(Math.min(...line3.map(x => x.mid))).toBeGreaterThan(line1[0].mid + 10);
  // 주 고르기는 이 화면에 하나(‹ › 짝 하나, 안쪽 [이번 주 ▾] 아닌 주 고르기 부품 없음).
  await expect(page.locator('#meetingsView [data-report-week="prev"]')).toHaveCount(1);
  await expect(page.locator('#meetingsView [data-report-week="next"]')).toHaveCount(1);
  await expect(page.locator('#meetingsView .week-pick, #meetingsView [data-week-pick], #meetingsView [data-week-step]')).toHaveCount(0);
  // '이번 주 주간보고'는 접는 칸이 아니라 늘 펼친 칸이다: summary·details 없음, 표가 바로 보인다.
  const week = page.locator('#meetingsView #bizWeekBox');
  await expect(week).toBeVisible();
  expect(await week.evaluate(el => el.tagName.toLowerCase())).not.toBe('details');
  await expect(week.locator(':scope > summary')).toHaveCount(0);
  await expect(week.locator('.biz-week-title > .biz-week-fold').first()).toHaveText('이번 주 주간 보고');
  await expect(week.locator('[data-bp-paper]')).toContainText('1) 사업요약표');
  // 위 주 고르기를 넘기면 이 칸도 같은 주를 보여 준다(이름이 그 주로 바뀐다).
  const label = page.locator('#bizWeekBox .biz-week-nav .report-week-label');
  const before = (await label.textContent()).trim();
  await page.locator('#bizWeekBox [data-report-week="prev"]').click();
  const after = (await label.textContent()).trim();
  expect(after).not.toBe(before);
  const dayOf = t => t.match(/(\d+)\.(\d+)/).slice(1).map(Number).join('.');
  await expect(week.locator('.biz-week-title')).toContainText(dayOf(after));
  await expect(week.locator('.biz-week-title > .biz-week-fold').first()).toHaveText('주간 보고');
  await page.locator('#bizWeekBox [data-report-week="next"]').click();
  await expect(week.locator('.biz-week-title > .biz-week-fold').first()).toHaveText('이번 주 주간 보고');
  // 떠 있는 버튼은 없다(보기는 위 줄 고르기 상자, 동그란 [+]도 없음: [+]는 첫 줄 안).
  const floating = await page.locator('#meetingsView').evaluate(el => [...el.querySelectorAll('button')].filter(e => getComputedStyle(e).position === 'fixed').map(e => e.id || e.className));
  expect(floating).toEqual([]);
  const add = await page.locator('#newMeetingBtn').boundingBox();
  expect(add.y).toBeLessThan(vp.height / 3);
  // UI-보기탭드롭다운(11/10): 보기 [목록 ▾]는 위 줄 고르기 상자(아래 떠 있는 탭 줄 없음).
  { const sel = await page.locator(inChip ? '#reportFilterChip' : '#reportViewSelect').boundingBox(); expect(sel.y).toBeLessThan(vp.height / 3); } // 폰 칩이면 보기도 칩 창 안
  // 옆으로 넘치지 않는다.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1)).toBe(true);
  expect(errors).toEqual([]);
  if (process.env.SHOT_DIR) await page.screenshot({path: `${process.env.SHOT_DIR}/biz-top-${width}.png`});
});

test('390: 달력·사진 보기에서는 기간 줄만 빠지고, 보기를 바꿔도 떠 있는 동그란 [+]가 없다', async ({page}) => {
  const state = makeState();
  await open(page, state, 390);
  await pickReportBox(page, '#reportViewSelect', 'calendar');
  await expect(page.locator('#reportViewSelect')).toHaveValue('calendar');
  await expect(page.locator('#meetingsView .report-week-bar')).toBeHidden();
  await expect(page.locator('#reportPeriodPick select')).toHaveCount(0);
  const floating = await page.locator('#meetingsView').evaluate(el => [...el.querySelectorAll('button')].filter(e => getComputedStyle(e).position === 'fixed').map(e => e.id || e.className));
  expect(floating).toEqual([]);
  await pickReportBox(page, '#reportViewSelect', 'list');
  await openReportBoxes(page);
  await expect(page.locator('#reportPeriodPick select')).toBeVisible();
});

test('390: 추가 + › 새 사업 보고를 누르면 종류를 고른 뒤 사업 보고 등록 창이 열리고, 작은 아이콘(글자 없음)이다', async ({page}) => {
  const state = makeState();
  await open(page, state, 390);
  const add = page.locator('#newMeetingBtn');
  const box = await add.boundingBox();
  expect(box.width).toBeLessThanOrEqual(34); expect(box.height).toBeLessThanOrEqual(34);
  await expect(add).toHaveAttribute('aria-label', '사업 관리 추가');
  // BIZ-머리한줄(S71-23): [+] › 새 사업 보고 → MTG-더하기늘고르기: 늘 종류 고르기 창부터.
  await add.click();
  await page.locator('#bizAddMenu [data-report-new]').click();
  await page.locator('#reportKindSheet [data-sheet-value="meeting"]').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
});

// BIZ-머리한줄(S71-23): 녹음은 [+] 메뉴 줄 — 녹음 중이면 이름 '녹음 중'·눌림(aria-pressed)·꺼짐·빨간 글자(전 ● 고리와 같은 정보). 기간 정하기 창은 첫 줄 아래 한 줄을 다 쓴다.
for (const width of [884, 1280]) test(`${width}: [+] 메뉴 녹음 중 표시 · 기간 정하기 창은 한 줄 아래`, async ({page}) => {
  const state = makeState();
  await open(page, state, width);
  // 녹음 상태 표시는 녹음기(meeting-recorder.js recordItem)가 정한다 — 여기서는 녹음 중 값을 넣어 메뉴 모양만 본다.
  await page.waitForFunction(() => !!window.KPTUMeetingRecorder); // 녹음기는 첫 화면 뒤에 붙는다(loader-v2.js)
  await page.evaluate(() => { window.KPTUMeetingRecorder.recordItem = () => ({shown: true, disabled: true, label: '녹음 중', pressed: true}); });
  await page.locator('#newMeetingBtn').click();
  const rec = page.locator('#bizAddMenu [data-report-rec]');
  await expect(rec).toHaveText('녹음 중');
  await expect(rec).toHaveAttribute('aria-pressed', 'true');
  await expect(rec).toBeDisabled();
  expect(await rec.evaluate(b => getComputedStyle(b).color)).not.toBe(await page.locator('#bizAddMenu [data-report-new]').evaluate(b => getComputedStyle(b).color));
  await page.keyboard.press('Escape');
  await expect(page.locator('#bizAddMenu')).toBeHidden();
  const lineMid = (await page.locator('#reportKindSelect').boundingBox());
  await page.locator('#reportPeriodPick select').selectOption('range');
  const panel = page.locator('#reportWeekFilter .report-period-panel');
  await expect(panel).toBeVisible();
  const [p, add] = await Promise.all([panel.boundingBox(), page.locator('#newMeetingBtn').boundingBox()]);
  expect(p.y).toBeGreaterThanOrEqual(lineMid.y + lineMid.height - 1);
  expect(Math.abs((add.y + add.height / 2) - (lineMid.y + lineMid.height / 2))).toBeLessThanOrEqual(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1)).toBe(true);
});
