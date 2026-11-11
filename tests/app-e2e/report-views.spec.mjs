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
    year: y, month: mo - 1, photoCalls: [], meetingOpens: [], patches: [], docs,
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
    if (path === '/rest/v1/app_meetings' && req.method() === 'PATCH') {
      // S57-8: 보고 수정과 같은 meeting_at PATCH. 지금 일시가 그대로인 내 보고 한 줄만 바꾼다(아니면 0줄).
      const id = (url.searchParams.get('id') || '').replace(/^eq\./, ''), filterAt = (url.searchParams.get('meeting_at') || '').replace(/^eq\./, '');
      const body = req.postDataJSON(), row = state.meetings.find(m => m.id === id);
      state.patches.push({id, filterAt, workspace: url.searchParams.get('workspace_id'), body});
      if (!row || (filterAt && new Date(row.meeting_at).getTime() !== new Date(filterAt).getTime())) return ok([]);
      Object.assign(row, body);
      return ok([row]);
    }
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
// UI-보기탭드롭다운(11/10): 보기는 위 줄 고르기 상자 [목록 ▾](#reportViewSelect). view(page,'달력') = 그 보기를 고르기.
const viewSelect = page => page.locator('#reportViewSelect');
const view = (page, label) => viewSelect(page).selectOption({label});
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1);

for (const width of [390, 1440]) {
  test(`report calendar shows the month, today's reports and opens one ${width}`, async ({page}) => {
    const state = makeState();
    const prefs = await open(page, state, width);
    await expect(viewSelect(page)).toHaveValue('list');
    await view(page, '달력');
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
      // 넓은 화면은 날짜 칸에 제목 4줄까지(BIZ-달력그날창): 3건인 날은 '+n' 없이 셋 다 보인다. 넘는 날의 '+n'은 report-calendar-day-window.spec.mjs.
      await expect(cal.locator('.rv-sel .rv-title')).toHaveCount(3);
      await expect(cal.locator('.rv-sel .rv-more')).toHaveCount(0);
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

  // S57-8 BIZ-달력우클릭끌기 ④(명진 폰 제보 "숫자를 눌러야 클릭이 됨, 터치 범위 넓혀요"): 숫자·점·제목 옆 빈 곳·'+n' 어디를 눌러도 그 칸 전체가 그날 고르기.
  test(`report calendar day cell is pressable all over, not only the number ${width}`, async ({page}) => {
    const state = makeState();
    await open(page, state, width);
    await view(page, '달력');
    const cal = page.locator('#meetingList .rv-cal');
    const today = cal.locator('.rv-cell.rv-now[data-rv-cell]');
    const todayKey = await today.getAttribute('data-rv-cell');
    await expect(today).toHaveClass(/rv-sel/);
    // 오늘이 아닌 이번 달 칸의 맨 아래 오른쪽 빈 곳(숫자·점이 없는 자리)을 누르면 그 날이 골라진다.
    const other = cal.locator('.rv-cell[data-rv-cell]:not(.rv-now)').first();
    const otherKey = await other.getAttribute('data-rv-cell');
    const box = await other.boundingBox();
    await other.click({position: {x: box.width - 5, y: box.height - 5}});
    await expect(cal.locator('.rv-cell.rv-sel')).toHaveAttribute('data-rv-cell', otherKey);
    await expect(cal.locator('.rv-cell.rv-sel [data-rv-day]')).toHaveAttribute('aria-pressed', 'true');
    await expect(cal.locator('.rv-day-list .rv-day-title')).toContainText(`${Number(otherKey.slice(8))}일`);
    // 숫자 단추는 그대로 눌린다(키보드·화면 읽기 길).
    await today.locator('[data-rv-day]').click();
    await expect(cal.locator('.rv-cell.rv-sel')).toHaveAttribute('data-rv-cell', todayKey);
    await other.click({position: {x: box.width - 5, y: box.height - 5}});
    await expect(cal.locator('.rv-cell.rv-sel')).toHaveAttribute('data-rv-cell', otherKey);
    if (width >= 761) {
      // 넓은 화면: 제목이 있는 칸도 제목 아래 빈 곳을 누르면 그 날이 골라지고 그날 목록이 바뀐다('+n'은 그날 창을 연다 — report-calendar-day-window.spec.mjs).
      await today.click({position: {x: box.width - 5, y: box.height - 4}});
      await expect(cal.locator('.rv-cell.rv-sel')).toHaveAttribute('data-rv-cell', todayKey);
      await expect(cal.locator('.rv-day-list .rv-row')).toHaveCount(3);
      // 칸 안 제목을 누르면 보고가 열릴 뿐 고른 날은 바뀌지 않는다.
      await other.click({position: {x: box.width - 5, y: box.height - 5}});
      await today.locator(`[data-mrd-meeting="${M1}"]`).click();
      await expect.poll(() => state.meetingOpens.some(x => x === 'eq.' + M1)).toBe(true);
      await expect(cal.locator('.rv-cell.rv-sel')).toHaveAttribute('data-rv-cell', otherKey);
    } else {
      // 폰: 점 줄(제목 대신 점만 보이는 자리)을 눌러도 그 날이 골라진다.
      await today.locator('.rv-dots').click();
      await expect(cal.locator('.rv-cell.rv-sel')).toHaveAttribute('data-rv-cell', todayKey);
      await expect(cal.locator('.rv-day-list .rv-row')).toHaveCount(3);
    }
    expect(await noOverflow(page)).toBe(true);
  });

  test(`report photo view groups photos by day and reuses the big viewer ${width}`, async ({page}) => {
    const state = makeState();
    await open(page, state, width);
    await view(page, '사진');
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
  await expect(viewSelect(page)).toHaveValue('photo');
  await expect(page.locator('#meetingList .rv-photos')).toBeVisible();
  await view(page, '목록');
  await expect(page.locator('#meetingList .rv-photos')).toHaveCount(0);
  await expect(page.locator('#meetingList .mcol-layout')).toBeVisible();
  await expect.poll(() => prefs.value?.report_view ?? 'list').toBe('list');
});

test('report view box works with the keyboard (Enter · ↓ · Enter, Esc only closes) and is remembered', async ({page}) => {
  const state = makeState();
  const prefs = await open(page, state, 1440);
  const sel = viewSelect(page);
  await expect(sel).toHaveValue('list');
  await sel.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#kptuSelectMenu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sel).toHaveValue('list');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(sel).toHaveValue('calendar');
  await expect(page.locator('#meetingList .rv-cal')).toBeVisible();
  await expect.poll(() => prefs.value?.report_view).toBe('calendar');
});

test('report views still switch when the server cannot remember the choice yet', async ({page}) => {
  const state = makeState();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const prefs = await open(page, state, 390, null, {missingColumn: true});
  await view(page, '달력');
  await expect(page.locator('#meetingList .rv-cal')).toBeVisible();
  await view(page, '사진');
  await expect(page.locator('#meetingList .rv-photos')).toBeVisible();
  expect(prefs.patches.length).toBe(0);
  expect(errors).toEqual([]);
});

// S57-8 BIZ-달력우클릭끌기 PR-2(요청함 할 일 1·2·3·6·7): PC 사업 보고 [달력]의 우클릭 메뉴와 끌어 옮기기. 모든 이름·번호는 합성 값.
const cellOf = (cal, n) => cal.locator('.rv-cell[data-rv-cell]:not(.rv-now)').nth(n);
const emptySpot = async cell => { const b = await cell.boundingBox(); return {x: b.width - 5, y: b.height - 5}; };
// 1440(PC) 목록 보기는 첫 칸의 첫 보고를 오른쪽 칸에 먼저 붙여 읽는다(달력·끌기와 무관한 읽기, 이 시험에서는 □□ 보고 하나). 끌기 시험은 그 읽기가 끝나 멈춘 뒤의 목록을
// 기준으로 삼고, 끌기·취소 뒤에 새로 읽은(= 보고가 열린) 것이 없는지 본다.
async function settledOpens(state) {
  let last = -1;
  await expect.poll(async () => { const n = state.meetingOpens.length, same = n > 0 && n === last; last = n; return same; }).toBe(true);
  return [...state.meetingOpens];
}

test('report calendar (PC): right click on an empty day gives [add report here]/[show day], add fills the day', async ({page}) => {
  const state = makeState();
  await open(page, state, 1440);
  await view(page, '달력');
  const cal = page.locator('#meetingList .rv-cal'), menu = page.locator('#rowMenu');
  const cell = cellOf(cal, 5), key = await cell.getAttribute('data-rv-cell');
  await cell.click({button: 'right', position: await emptySpot(cell)});
  await expect(menu).toBeVisible();
  await expect(menu.locator('.row-menu-title')).toHaveText(/^\d+월 \d+일 \([일월화수목금토]\)$/);
  await expect(menu.locator('button')).toHaveText(['이날 사업 보고 추가', '이날 보기']);
  // [이날 보기]: 칸을 누른 것과 같다.
  await menu.getByRole('button', {name: '이날 보기'}).click();
  await expect(cal.locator('.rv-cell.rv-sel')).toHaveAttribute('data-rv-cell', key);
  // [이날 사업 보고 추가]: 새 보고 창에 그 날짜(시각은 기본값 10:00).
  await cell.click({button: 'right', position: await emptySpot(cell)});
  await menu.getByRole('button', {name: '이날 사업 보고 추가'}).click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  await expect(page.locator('#meetingAt')).toHaveValue(`${key}T10:00`);
  await page.locator('#meetingModal [data-close="meetingModal"]').first().click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  // 키보드: 날짜 숫자 단추에서 Shift+F10도 같은 메뉴.
  await cell.locator('[data-rv-day]').focus();
  await page.keyboard.press('Shift+F10');
  await expect(menu.locator('button')).toHaveText(['이날 사업 보고 추가', '이날 보기']);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  expect(state.patches).toEqual([]);
});

test('report calendar (PC): right click or menu key on a report opens the same report menu as the list', async ({page}) => {
  const state = makeState();
  await open(page, state, 1440);
  await view(page, '달력');
  const cal = page.locator('#meetingList .rv-cal'), more = page.locator('#mrdMoreMenu');
  // 칸 안 제목.
  await cal.locator('.rv-cell.rv-now').locator(`[data-mrd-meeting="${M1}"]`).click({button: 'right'});
  await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();
  await expect(more).toBeVisible();
  await expect(more.locator('button')).toHaveText(['수정', '종류 바꾸기', '삭제']);
  await page.keyboard.press('Escape'); await expect(more).toBeHidden();
  await page.locator('#mrdClose').click(); await expect(page.locator('#meetingRoundDetailModal')).toBeHidden();
  // 그날 목록 줄. 메뉴가 실제로 뜬 것을 본 뒤에 Esc를 누른다: 닫힌 메뉴에 앞 단계의 단추가 남아 있어 글자 검사만으로는 바로 통과하고,
  // 그때 누른 Esc는 메뉴가 뜨기 전의 보고 창을 닫아 버린다(그 뒤 #mrdClose가 보이지 않아 시간 초과 — S58-2에서 원인 확인).
  await cal.locator(`.rv-day-list .rv-row[data-mrd-meeting="${M2}"]`).click({button: 'right', position: {x: 6, y: 6}});
  await expect(page.locator('#meetingRoundDetailModal')).toHaveAttribute('data-meeting-id', M2);
  await expect(more).toBeVisible();
  await expect(more.locator('button')).toHaveText(['수정', '종류 바꾸기', '삭제']);
  await page.keyboard.press('Escape'); await expect(more).toBeHidden();
  await page.locator('#mrdClose').click(); await expect(page.locator('#meetingRoundDetailModal')).toBeHidden();
  // 키보드 메뉴 키: 포커스 받은 칸 안 제목.
  await cal.locator('.rv-cell.rv-now').locator(`[data-mrd-meeting="${M1}"]`).focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('#meetingRoundDetailModal')).toHaveAttribute('data-meeting-id', M1);
  await expect(more).toBeVisible();
  await expect(more.locator('button')).toHaveText(['수정', '종류 바꾸기', '삭제']);
  expect(state.patches).toEqual([]);
});

test('report calendar (PC): drag a report to another day keeps its time, saves one meeting_at change, undo restores it', async ({page}) => {
  const state = makeState();
  await open(page, state, 1440);
  const opensBefore = await settledOpens(state);
  await view(page, '달력');
  const cal = page.locator('#meetingList .rv-cal'), today = cal.locator('.rv-cell.rv-now');
  const todayKey = await today.getAttribute('data-rv-cell'), target = cellOf(cal, 5), key = await target.getAttribute('data-rv-cell');
  const original = state.meetings.find(m => m.id === M1).meeting_at, title = today.locator(`[data-mrd-meeting="${M1}"]`);
  const from = await title.boundingBox(), to = await target.boundingBox();
  const x0 = from.x + from.width / 2, y0 = from.y + from.height / 2, x1 = to.x + to.width / 2, y1 = to.y + to.height / 2;
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6);
  await expect(target).toHaveClass(/rv-drop/);
  await expect(page.locator('.rv-ghost')).toHaveCount(1);
  await page.mouse.up();
  await expect.poll(() => state.patches.length).toBe(1);
  const days = (Date.parse(`${key}T00:00:00+09:00`) - Date.parse(`${todayKey}T00:00:00+09:00`)) / 86400000;
  const patch = state.patches[0];
  expect(patch.id).toBe(M1); expect(patch.workspace).toBe('eq.workspace-1');
  expect(new Date(patch.filterAt).getTime()).toBe(new Date(original).getTime());
  expect(Object.keys(patch.body).sort()).toEqual(['meeting_at', 'updated_at']);
  expect(new Date(patch.body.meeting_at).getTime()).toBe(new Date(original).getTime() + days * 86400000);
  // 화면: 놓은 칸에 보고가 있고 그 날이 골라지며, 끌기 뒤 클릭으로 보고가 열리지 않는다. 고침은 서버에서 다시 읽은 것(새로 고침과 같음).
  await expect(target.locator(`[data-mrd-meeting="${M1}"]`)).toHaveCount(1);
  await expect(today.locator(`[data-mrd-meeting="${M1}"]`)).toHaveCount(0);
  await expect(cal.locator('.rv-cell.rv-sel')).toHaveAttribute('data-rv-cell', key);
  await expect(page.locator('.rv-ghost')).toHaveCount(0);
  expect(state.meetingOpens).toEqual(opensBefore);
  await expect(page.locator('#meetingRoundDetailModal')).toBeHidden();
  // 옮겼어요 · 되돌리기 → 원래 일시로 같은 길 저장.
  const notice = page.locator('[data-undo-notice]');
  await expect(notice).toContainText('옮겼어요');
  await notice.getByRole('button', {name: '되돌리기'}).click();
  await expect.poll(() => state.patches.length).toBe(2);
  expect(new Date(state.patches[1].filterAt).getTime()).toBe(new Date(patch.body.meeting_at).getTime());
  expect(new Date(state.patches[1].body.meeting_at).getTime()).toBe(new Date(original).getTime());
  await expect(today.locator(`[data-mrd-meeting="${M1}"]`)).toHaveCount(1);
  await expect(cal.locator('.rv-cell.rv-sel')).toHaveAttribute('data-rv-cell', todayKey);
  expect(state.meetings.find(m => m.id === M1).meeting_at).toBe(original);
});

test('report calendar (PC): Esc cancels a drag and a same-day drop saves nothing', async ({page}) => {
  const state = makeState();
  await open(page, state, 1440);
  const opensBefore = await settledOpens(state);
  await view(page, '달력');
  const cal = page.locator('#meetingList .rv-cal'), today = cal.locator('.rv-cell.rv-now'), target = cellOf(cal, 5);
  const title = today.locator(`[data-mrd-meeting="${M1}"]`), from = await title.boundingBox(), to = await target.boundingBox();
  const x0 = from.x + from.width / 2, y0 = from.y + from.height / 2;
  await page.mouse.move(x0, y0); await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {steps: 5});
  await expect(target).toHaveClass(/rv-drop/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.rv-ghost')).toHaveCount(0);
  await page.mouse.up();
  // 같은 칸 안에서 끌었다 놓기.
  await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x0 + 8, y0 + 12, {steps: 4}); await page.mouse.up();
  expect(state.patches).toEqual([]);
  // 취소·같은 칸 놓기 뒤 손을 뗄 때 따라오는 클릭으로 보고가 열리지 않는다(새로 읽은 보고 없음, 보고 창도 닫힌 채).
  expect(state.meetingOpens).toEqual(opensBefore);
  await expect(page.locator('#meetingRoundDetailModal')).toBeHidden();
});

test('report calendar (phone): no app right-click menu and no drag, opening the report to edit is the way', async ({page}) => {
  const state = makeState();
  await open(page, state, 390);
  await view(page, '달력');
  const cal = page.locator('#meetingList .rv-cal'), cell = cellOf(cal, 5);
  await page.evaluate(() => { window.__prevented = []; document.addEventListener('contextmenu', e => window.__prevented.push(e.defaultPrevented), false); });
  await cell.click({button: 'right', position: await emptySpot(cell)});
  await expect(page.locator('#rowMenu')).toBeHidden();
  expect(await page.evaluate(() => window.__prevented)).toEqual([false]);
  expect(state.patches).toEqual([]);
});
