import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// BIZ-달력그날창(S58-2): PC 사업 보고 [달력] 칸에 이름 4줄까지, 넘는 날의 '+n'을 누르면 그 칸 자리에 그날 창(일정 달력 그날 창과 같은 부품).
// 그날 창 줄은 누르면 보고 열기, 우클릭 = 보고 메뉴(메뉴만, S58-16), 끌어 옮기기, 맨 아래 [+ 이날 사업 보고 추가]. 폰 폭(점 + 아래 목록)은 그대로. 모든 이름·번호는 합성 값.
test.use({timezoneId: 'Asia/Seoul'});
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = () => new Date().toISOString();
const seoulKey = d => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Seoul'}).format(d);
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
// 이번 달의 날: 8일 = 6건('+3'), 9일 = 4건('+n' 없음), 10일 = 5건('+2'), 22일 = 0건(끌어 놓을 칸).
const SIX = 8, FOUR = 9, FIVE = 10, EMPTY = 22;
const TIMES = ['09:00', '10:30', '13:00', '14:00', '16:30', '19:00'];

function makeState() {
  const [y, mo] = seoulKey(new Date()).split('-').map(Number);
  const key = day => `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const meeting = (n, title, day, time) => ({id: ID(n), workspace_id: 'workspace-1', title, series_name: title, round_no: null, meeting_at: new Date(`${key(day)}T${time}:00+09:00`).toISOString(), activity_kind: 'meeting', created_by: 'user-1', notes: '', decisions: '', transcript_text: '원문'});
  const meetings = [];
  // 일부러 늦은 시각부터 넣는다: 칸과 그날 창은 이른 순으로 보여야 한다.
  [...TIMES].reverse().forEach((t, i) => meetings.push(meeting(800 + TIMES.length - i, `예시 보고 ${TIMES.length - i}`, SIX, t)));
  TIMES.slice(0, 4).forEach((t, i) => meetings.push(meeting(821 + i, `예시 넷 ${i + 1}`, FOUR, t)));
  TIMES.slice(0, 5).forEach((t, i) => meetings.push(meeting(841 + i, `예시 다섯 ${i + 1}`, FIVE, t)));
  return {year: y, month: mo - 1, key, meetings, meetingOpens: [], patches: [],
    user: {id: 'user-1', email: 'owner@example.org', user_metadata: {display_name: '관리자'}}, workspace: {id: 'workspace-1', slug: 'team', name: '웹2'}};
}
const sixId = n => ID(800 + n);

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
    if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id: 'workspace-1', user_id: state.user.id, role: 'owner', workspace: state.workspace, created_at: now()}]);
    if (path === '/rest/v1/app_workspaces') return ok([state.workspace]);
    if (path === '/rest/v1/app_meetings' && req.method() === 'PATCH') {
      // 보고 수정과 같은 meeting_at PATCH: 지금 일시가 그대로인 내 보고 한 줄만 바꾼다(아니면 0줄).
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

// 고른 보기(달력)는 서버 기억에서 온다(view_prefs.report_view).
async function open(page, state, width, height = 900) {
  await page.setViewportSize({width, height});
  await installViewPrefsServer(page, {report_view: 'calendar'});
  await mock(page, state);
  await page.goto(`${appOrigin}/app/?view=meetings`);
  await enterLogin(page);
  await signInWithSession(page, 'owner@example.org');
  await page.waitForFunction(() => window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#reportViewSelect')).toHaveValue('calendar');
  const cal = page.locator('#meetingList .rv-cal');
  await expect(cal.locator(`[data-rv-cell="${state.key(SIX)}"] .rv-title`)).toHaveCount(3);
  return cal;
}
const cellOf = (cal, state, day) => cal.locator(`.rv-cell[data-rv-cell="${state.key(day)}"]`);
const moreOf = (cal, state, day) => cellOf(cal, state, day).locator('.rv-more');
const win = page => page.locator('#calendarDayModal');
const rows = page => page.locator('#calendarDayList .rv-pop-row');
const focusedOn = (page, selector) => page.evaluate(sel => !!document.activeElement && document.activeElement === document.querySelector(sel), selector);
const moreSel = (state, day) => `#meetingList [data-rv-more="${state.key(day)}"]`;
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1);
// 처음 읽기가 멈춘 뒤의 '열린 보고' 목록(그 뒤 새로 열린 것이 있는지 볼 기준).
async function settledOpens(state) {
  let last = -1;
  await expect.poll(async () => { const n = state.meetingOpens.length, same = n === last; last = n; return same; }).toBe(true);
  return [...state.meetingOpens];
}
async function openWindow(page, cal, state, day = SIX) {
  await moreOf(cal, state, day).click();
  await expect(win(page)).toBeVisible();
  await expect(win(page)).toHaveAttribute('data-day-kind', 'report');
}

for (const width of [1280, 1440]) {
  test(`report calendar cell shows up to four lines, '+n' only on days with more (${width})`, async ({page}) => {
    const state = makeState(), cal = await open(page, state, width);
    // 4건인 날: '+n' 없이 넷 다(이른 순).
    const four = cellOf(cal, state, FOUR);
    await expect(four.locator('.rv-title')).toHaveText(['예시 넷 1', '예시 넷 2', '예시 넷 3', '예시 넷 4']);
    await expect(four.locator('.rv-more')).toHaveCount(0);
    // 6건·5건인 날: 앞 셋 + 마지막 줄 자리에 '+n'(단추, 날짜와 전체 건수를 읽어 준다).
    const six = cellOf(cal, state, SIX);
    await expect(six.locator('.rv-title')).toHaveText(['예시 보고 1', '예시 보고 2', '예시 보고 3']);
    await expect(six.locator('.rv-more')).toHaveText('+3');
    await expect(six.locator('.rv-more')).toHaveAttribute('aria-label', new RegExp(`^${state.month + 1}월 ${SIX}일 \\([일월화수목금토]\\) 사업 보고 6건 모두 보기$`));
    await expect(cellOf(cal, state, FIVE).locator('.rv-title')).toHaveCount(3);
    await expect(cellOf(cal, state, FIVE).locator('.rv-more')).toHaveText('+2');
    // 칸 높이는 4줄에 맞춰 한 곳에서 고정: 모든 주의 높이가 같고(줄 수 때문에 늘어나지 않음), 넷째 줄이 칸 안에 다 들어온다.
    const geo = await page.evaluate(([fourKey, sixKey]) => {
      const rowHeights = [...document.querySelectorAll('#meetingList .rv-table tbody tr')].map(r => Math.round(r.getBoundingClientRect().height * 10) / 10);
      const inside = key => { const cell = document.querySelector(`#meetingList [data-rv-cell="${key}"]`), last = cell.querySelector('.rv-titles li:last-child'); return cell.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom; };
      const lines = key => document.querySelectorAll(`#meetingList [data-rv-cell="${key}"] .rv-titles li`).length;
      return {rowHeights, fourInside: inside(fourKey), sixInside: inside(sixKey), fourLines: lines(fourKey), sixLines: lines(sixKey)};
    }, [state.key(FOUR), state.key(SIX)]);
    expect(new Set(geo.rowHeights).size).toBe(1);
    expect(geo.rowHeights[0]).toBe(96);
    expect(geo.fourLines).toBe(4); expect(geo.sixLines).toBe(4);
    expect(geo.fourInside).toBeGreaterThanOrEqual(0); expect(geo.sixInside).toBeGreaterThanOrEqual(0);
    expect(await noOverflow(page)).toBe(true);
  });

  test(`'+n' opens the day window on that cell with every report, a row opens the report (${width})`, async ({page}) => {
    const state = makeState(), cal = await open(page, state, width);
    const before = await settledOpens(state);
    const tableY = (await cal.locator('.rv-table').boundingBox()).y;
    await openWindow(page, cal, state);
    // 그날이 골라지고(달력 아래 그날 목록도 그날), 달력은 아래로 내려가지 않는다.
    await expect(cal.locator('.rv-cell.rv-sel')).toHaveAttribute('data-rv-cell', state.key(SIX));
    await expect(cal.locator('.rv-day-list .rv-row')).toHaveCount(6);
    expect((await cal.locator('.rv-table').boundingBox()).y).toBe(tableY);
    // 머리: '11.13.(금)' 모양 날짜 + '사업 보고 6', ✕. 줄: 색 점·이름·시각(이른 순). 맨 아래 [+ 이날 사업 보고 추가].
    const weekday = WEEKDAYS[new Date(Date.UTC(state.year, state.month, SIX)).getUTCDay()];
    await expect(page.locator('#calendarDayTitle')).toHaveText(`${state.month + 1}.${SIX}.(${weekday}) 사업 보고 6`);
    await expect(page.locator('#calendarDayTitle .kptu-day-note')).toHaveText('사업 보고 6');
    await expect(win(page).locator('[data-close="calendarDayModal"]')).toBeVisible();
    await expect(rows(page).locator('.rv-pop-name')).toHaveText([1, 2, 3, 4, 5, 6].map(n => `예시 보고 ${n}`));
    await expect(rows(page).locator('.rv-pop-time')).toHaveText(TIMES);
    await expect(rows(page).locator('.rv-dot')).toHaveCount(6);
    await expect(page.locator('#calendarDayList .rv-pop-add')).toHaveText('+ 이날 사업 보고 추가');
    // 자리: 그 칸 자리(화면 밖으로 나가지 않게만 당김), 어두운 바탕 없음(달력이 그대로 보임).
    const geo = await page.evaluate(key => {
      const modal = document.querySelector('#calendarDayModal'), card = modal.querySelector('.kptu-day-card').getBoundingClientRect(), cell = document.querySelector(`#meetingList [data-rv-cell="${key}"]`).getBoundingClientRect();
      return {at: modal.classList.contains('kptu-day-at'), bg: getComputedStyle(modal).backgroundColor, card: {left: card.left, top: card.top, right: card.right, bottom: card.bottom, width: card.width}, cell: {left: cell.left, top: cell.top}, vw: innerWidth, vh: innerHeight};
    }, state.key(SIX));
    expect(geo.at).toBe(true);
    expect(geo.bg).toBe('rgba(0, 0, 0, 0)');
    expect(Math.abs(geo.card.top - geo.cell.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(geo.card.left - Math.min(geo.cell.left, geo.vw - geo.card.width - 8))).toBeLessThanOrEqual(1);
    expect(geo.card.left).toBeGreaterThanOrEqual(0); expect(geo.card.right).toBeLessThanOrEqual(geo.vw); expect(geo.card.bottom).toBeLessThanOrEqual(geo.vh);
    expect(await noOverflow(page)).toBe(true);
    // 아직 아무 보고도 열리지 않았다. 줄을 누르면 창이 닫히고 그 보고가 열린다.
    expect(state.meetingOpens).toEqual(before);
    await rows(page).nth(4).click();
    await expect(win(page)).toBeHidden();
    await expect.poll(() => state.meetingOpens.filter(x => x === 'eq.' + sixId(5)).length).toBeGreaterThan(0);
    await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();
    // 보고 창을 닫으면 초점은 '+n'으로 돌아온다(다시 Enter로 그날 창).
    await page.locator('#mrdClose').click();
    await expect(page.locator('#meetingRoundDetailModal')).toBeHidden();
    await expect.poll(() => focusedOn(page, moreSel(state, SIX))).toBe(true);
  });
}

test('day window closes with X, Esc and an outside press, focus goes back to "+n" and nothing under it is pressed', async ({page}) => {
  const state = makeState(), cal = await open(page, state, 1440);
  const before = await settledOpens(state);
  // ✕
  await openWindow(page, cal, state);
  await win(page).locator('[data-close="calendarDayModal"]').click();
  await expect(win(page)).toBeHidden();
  await expect.poll(() => focusedOn(page, moreSel(state, SIX))).toBe(true);
  // Esc
  await openWindow(page, cal, state);
  await page.keyboard.press('Escape');
  await expect(win(page)).toBeHidden();
  await expect.poll(() => focusedOn(page, moreSel(state, SIX))).toBe(true);
  // 바깥 누르기: 다른 날 칸의 보고 이름 위를 눌러도 창만 닫힌다(그 보고가 열리지 않고 고른 날도 그대로).
  await openWindow(page, cal, state);
  const card = await win(page).locator('.kptu-day-card').boundingBox();
  const targets = [];
  for (const title of await cal.locator('.rv-title').all()) { const b = await title.boundingBox(); if (b && (b.x > card.x + card.width + 4 || b.x + b.width < card.x - 4 || b.y > card.y + card.height + 4)) targets.push(b); }
  expect(targets.length).toBeGreaterThan(0);
  await page.mouse.click(targets[0].x + targets[0].width / 2, targets[0].y + targets[0].height / 2);
  await expect(win(page)).toBeHidden();
  await expect.poll(() => focusedOn(page, moreSel(state, SIX))).toBe(true);
  await expect(cal.locator('.rv-cell.rv-sel')).toHaveAttribute('data-rv-cell', state.key(SIX));
  await expect(page.locator('#meetingRoundDetailModal')).toBeHidden();
  expect(state.meetingOpens).toEqual(before);
  expect(state.patches).toEqual([]);
});

test('day window works with the keyboard: Enter on "+n", Tab through rows, Enter opens, Esc returns to "+n"', async ({page}) => {
  const state = makeState(), cal = await open(page, state, 1440);
  await moreOf(cal, state, SIX).focus();
  await page.keyboard.press('Enter');
  await expect(win(page)).toBeVisible();
  const rowSel = n => `#calendarDayList [data-mrd-meeting="${sixId(n)}"]`;
  await expect.poll(() => focusedOn(page, rowSel(1))).toBe(true);
  await page.keyboard.press('Tab');
  await expect.poll(() => focusedOn(page, rowSel(2))).toBe(true);
  // 줄 6개를 지나 [+ 이날 사업 보고 추가], 그다음은 창 안에서 돈다(✕).
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  await expect.poll(() => focusedOn(page, rowSel(6))).toBe(true);
  await page.keyboard.press('Tab');
  await expect.poll(() => focusedOn(page, '#calendarDayList .rv-pop-add')).toBe(true);
  await page.keyboard.press('Tab');
  await expect.poll(() => focusedOn(page, '#calendarDayModal [data-close="calendarDayModal"]')).toBe(true);
  await page.keyboard.press('Escape');
  await expect(win(page)).toBeHidden();
  await expect.poll(() => focusedOn(page, moreSel(state, SIX))).toBe(true);
  // 다시 열어 둘째 줄에서 Enter: 그 보고가 열리고, 보고 창을 Esc로 닫으면 '+n'.
  await page.keyboard.press('Enter');
  await expect(win(page)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect.poll(() => focusedOn(page, rowSel(2))).toBe(true);
  await page.keyboard.press('Enter');
  await expect(win(page)).toBeHidden();
  await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();
  await expect.poll(() => state.meetingOpens.includes('eq.' + sixId(2))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#meetingRoundDetailModal')).toBeHidden();
  await expect.poll(() => focusedOn(page, moreSel(state, SIX))).toBe(true);
});

test('day window [add report on this day] opens the new report window with that date', async ({page}) => {
  const state = makeState(), cal = await open(page, state, 1440);
  await openWindow(page, cal, state);
  await page.locator('#calendarDayList .rv-pop-add').click();
  await expect(win(page)).toBeHidden();
  // MTG-더하기늘고르기: 새 보고는 늘 종류 고르기 창부터.
  await page.locator('#reportKindSheet [data-sheet-value="meeting"]').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  await expect(page.locator('#meetingAt')).toHaveValue(`${state.key(SIX)}T10:00`);
  await page.locator('#meetingModal [data-close="meetingModal"]').first().click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  expect(state.patches).toEqual([]);
});

// S58-16 BIZ-달력우클릭창뜸: 그날 창 줄 우클릭·메뉴 키도 메뉴만 — 그날 창은 메뉴 뒤에 그대로, 보고 창은 뜨지 않는다.
// [종류 바꾸기]는 그 자리에서(그날 창이 다시 채워짐), [수정]은 줄을 왼쪽으로 누를 때처럼 그날 창을 닫고 그때 수정 창.
test('day window row: right click or menu key opens only the report menu over the window; [종류 바꾸기] in place, [수정] closes the window and opens the edit window', async ({page}) => {
  const state = makeState(), cal = await open(page, state, 1440), more = page.locator('#mrdMoreMenu'), detail = page.locator('#meetingRoundDetailModal');
  await page.evaluate(() => { window.__rvOpened = []; window.addEventListener('kptu:dialog-opened', e => { if (e.detail?.modal?.id === 'meetingRoundDetailModal') window.__rvOpened.push(e.detail.modal.dataset.meetingId || ''); }); });
  await openWindow(page, cal, state);
  await rows(page).nth(3).click({button: 'right'});
  await expect(more).toBeVisible();
  await expect(more.locator('button')).toHaveText(['수정', '종류 바꾸기', '삭제']);
  await expect(win(page)).toBeVisible();
  await expect(detail).toBeHidden();
  // Esc는 메뉴만 닫고 초점은 누른 줄로. 그날 창은 그대로.
  await page.keyboard.press('Escape'); await expect(more).toBeHidden();
  await expect(win(page)).toBeVisible();
  await expect(rows(page).nth(3)).toBeFocused();
  // [종류 바꾸기]: 고르기 창에서 다른 종류 → 저장. 그날 창은 열린 채 다시 채워진다([회의] 칩이라 그 보고가 빠져 5줄).
  await rows(page).nth(3).click({button: 'right'});
  await expect(more).toBeVisible();
  await more.locator('[data-mrd-more="kind"]').click();
  const sheet = page.locator('#reportKindSheet');
  await expect(sheet).toBeVisible();
  await sheet.locator('[data-sheet-value="education"]').click();
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toMatchObject({id: sixId(4), workspace: 'eq.workspace-1', body: {activity_kind: 'education'}});
  await expect(win(page)).toBeVisible();
  await expect(rows(page)).toHaveCount(5);
  await expect(page.locator(`#calendarDayList [data-mrd-meeting="${sixId(4)}"]`)).toHaveCount(0);
  await expect(detail).toBeHidden();
  // 키보드 메뉴 키 → [수정](Enter): 그날 창을 닫고 수정 창.
  await rows(page).nth(1).focus();
  await page.keyboard.press('Shift+F10');
  await expect(more).toBeVisible();
  await expect(more.locator('button')).toHaveText(['수정', '종류 바꾸기', '삭제']);
  await expect(detail).toBeHidden();
  await expect(more.locator('[data-mrd-more="edit"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(win(page)).toBeHidden();
  await expect(detail).toBeVisible();
  await expect(detail).toHaveAttribute('data-meeting-id', sixId(2));
  await expect(detail.locator('#mrdEditor')).toBeVisible();
  expect(await page.evaluate(() => window.__rvOpened)).toEqual([sixId(2)]);
  expect(state.patches).toHaveLength(1);
});

test('day window row: drag to another day closes the window, keeps the time, saves one change, undo restores', async ({page}) => {
  const state = makeState(), cal = await open(page, state, 1440);
  const before = await settledOpens(state);
  await openWindow(page, cal, state);
  const id = sixId(5), original = state.meetings.find(m => m.id === id).meeting_at;
  const target = cellOf(cal, state, EMPTY), from = await rows(page).nth(4).boundingBox(), to = await target.boundingBox();
  const x0 = from.x + from.width / 2, y0 = from.y + from.height / 2, x1 = to.x + to.width / 2, y1 = to.y + to.height / 2;
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6);
  // 끌기가 시작되면 창이 닫혀 달력 칸이 보이고, 끄는 줄의 복제 조각이 따라오며 놓을 칸이 표시된다.
  await expect(win(page)).toBeHidden();
  await expect(page.locator('.rv-ghost')).toHaveCount(1);
  await expect(target).toHaveClass(/rv-drop/);
  await page.mouse.up();
  await expect.poll(() => state.patches.length).toBe(1);
  const patch = state.patches[0];
  expect(patch.id).toBe(id); expect(patch.workspace).toBe('eq.workspace-1');
  expect(new Date(patch.filterAt).getTime()).toBe(new Date(original).getTime());
  expect(Object.keys(patch.body).sort()).toEqual(['meeting_at', 'updated_at']);
  expect(new Date(patch.body.meeting_at).getTime()).toBe(new Date(original).getTime() + (EMPTY - SIX) * 86400000);
  // 화면: 놓은 칸에 보고, 원래 날은 5건('+2'), 끌기 뒤 클릭으로 보고가 열리지 않는다.
  await expect(target.locator(`[data-mrd-meeting="${id}"]`)).toHaveCount(1);
  await expect(moreOf(cal, state, SIX)).toHaveText('+2');
  await expect(cal.locator('.rv-cell.rv-sel')).toHaveAttribute('data-rv-cell', state.key(EMPTY));
  await expect(page.locator('.rv-ghost')).toHaveCount(0);
  await expect(win(page)).toBeHidden();
  expect(state.meetingOpens).toEqual(before);
  await expect(page.locator('#meetingRoundDetailModal')).toBeHidden();
  // 옮겼어요 · 되돌리기.
  const notice = page.locator('[data-undo-notice]');
  await expect(notice).toContainText('옮겼어요');
  await notice.getByRole('button', {name: '되돌리기'}).click();
  await expect.poll(() => state.patches.length).toBe(2);
  expect(new Date(state.patches[1].body.meeting_at).getTime()).toBe(new Date(original).getTime());
  await expect(moreOf(cal, state, SIX)).toHaveText('+3');
  expect(state.meetings.find(m => m.id === id).meeting_at).toBe(original);
});

test('day window row: Esc cancels a drag, nothing is saved or opened', async ({page}) => {
  const state = makeState(), cal = await open(page, state, 1440);
  const before = await settledOpens(state);
  await openWindow(page, cal, state);
  const from = await rows(page).nth(0).boundingBox(), to = await cellOf(cal, state, EMPTY).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {steps: 5});
  await expect(page.locator('.rv-ghost')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.rv-ghost')).toHaveCount(0);
  await page.mouse.up();
  expect(state.patches).toEqual([]);
  expect(state.meetingOpens).toEqual(before);
  await expect(page.locator('#meetingRoundDetailModal')).toBeHidden();
  await expect(moreOf(cal, state, SIX)).toHaveText('+3');
});

test('day window is refilled by the one calendar renderer when reports change, and closes when "+n" is gone', async ({page}) => {
  const state = makeState(), cal = await open(page, state, 1440);
  await moreOf(cal, state, SIX).focus();
  await page.keyboard.press('Enter');
  await expect(win(page)).toBeVisible();
  await page.keyboard.press('Tab');
  const second = `#calendarDayList [data-mrd-meeting="${sixId(2)}"]`;
  await expect.poll(() => focusedOn(page, second)).toBe(true);
  // 다른 곳에서 이름이 바뀐 뒤 새로 읽기: 창은 열린 채 같은 길로 다시 채워지고 초점 줄도 그대로다.
  const m2 = state.meetings.find(m => m.id === sixId(2));
  m2.title = m2.series_name = '예시 바뀐 이름';
  await page.evaluate(() => window.__KPTU_RELOAD_MEETINGS__());
  await expect(rows(page).nth(1).locator('.rv-pop-name')).toHaveText('예시 바뀐 이름');
  await expect(win(page)).toBeVisible();
  await expect(rows(page)).toHaveCount(6);
  await expect.poll(() => focusedOn(page, second)).toBe(true);
  // 그날 보고가 4건으로 줄어 '+n'이 없어지면 창도 닫힌다(칸에 넷 다 보인다).
  state.meetings = state.meetings.filter(m => m.id !== sixId(5) && m.id !== sixId(6));
  await page.evaluate(() => window.__KPTU_RELOAD_MEETINGS__());
  await expect(win(page)).toBeHidden();
  await expect(cellOf(cal, state, SIX).locator('.rv-title')).toHaveCount(4);
  await expect(moreOf(cal, state, SIX)).toHaveCount(0);
});

test('schedule calendar day window keeps its own look after the report day window was used (same part, centered, dimmed)', async ({page}) => {
  const state = makeState(), cal = await open(page, state, 1440);
  const cardWidth = () => page.evaluate(() => document.querySelector('#calendarDayModal .kptu-day-card').getBoundingClientRect().width);
  await openWindow(page, cal, state);
  expect(await cardWidth()).toBe(264);
  await page.keyboard.press('Escape');
  await expect(win(page)).toBeHidden();
  // 일정 달력을 먼저 다녀와 그 화면의 CSS(calendar-ui.css — 이 창의 폭을 우선순위 표시와 함께 정함)가 실려 있어도 사업 보고 그날 창은 같은 작은 폭이다.
  await page.addStyleTag({url: `${appOrigin}/app/calendar-ui.css`});
  await openWindow(page, cal, state);
  expect(await cardWidth()).toBe(264);
  await page.keyboard.press('Escape');
  await expect(win(page)).toBeHidden();
  // 같은 창 부품을 일정 달력 방식(날짜·일정 목록)으로 연다: 가운데, 어두운 바탕, 긴 날짜 제목, 사업 보고 줄 없음.
  await page.evaluate(() => window.KPTUCalendarDayOverflow.open(new Date(), []));
  await expect(win(page)).toBeVisible();
  await expect(win(page)).not.toHaveClass(/kptu-day-at/);
  await expect(win(page)).not.toHaveAttribute('data-day-kind', /.*/);
  await expect(page.locator('#calendarDayTitle')).toHaveText(/^\d+월 \d+일 [일월화수목금토]요일$/);
  await expect(page.locator('#calendarDayTitle .kptu-day-note')).toHaveCount(0);
  await expect(rows(page)).toHaveCount(0);
  const geo = await page.evaluate(() => { const modal = document.querySelector('#calendarDayModal'), card = modal.querySelector('.kptu-day-card'), r = card.getBoundingClientRect(); return {bg: getComputedStyle(modal).backgroundColor, left: card.style.left, top: card.style.top, position: getComputedStyle(card).position, mid: Math.abs((r.left + r.right) / 2 - innerWidth / 2)}; });
  expect(geo.bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(geo.left).toBe(''); expect(geo.top).toBe('');
  expect(geo.position).not.toBe('absolute');
  expect(geo.mid).toBeLessThanOrEqual(1);
  expect(await cardWidth()).toBe(520);
  await page.keyboard.press('Escape');
  await expect(win(page)).toBeHidden();
});

test('fold width (884) shows names like the PC and "+n" opens the same day window inside the screen', async ({page}) => {
  const state = makeState(), cal = await open(page, state, 884, 1104);
  await expect(cellOf(cal, state, FOUR).locator('.rv-title')).toHaveCount(4);
  await expect(cellOf(cal, state, FOUR).locator('.rv-title').first()).toBeVisible();
  await openWindow(page, cal, state);
  await expect(rows(page)).toHaveCount(6);
  const geo = await page.evaluate(() => { const r = document.querySelector('#calendarDayModal .kptu-day-card').getBoundingClientRect(); return {left: r.left, right: r.right, bottom: r.bottom, vw: innerWidth, vh: innerHeight}; });
  expect(geo.left).toBeGreaterThanOrEqual(0); expect(geo.right).toBeLessThanOrEqual(geo.vw); expect(geo.bottom).toBeLessThanOrEqual(geo.vh);
  expect(await noOverflow(page)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(win(page)).toBeHidden();
});

test('phone width (412) is unchanged: dots and the day list under the calendar, no names, no "+n", no day window', async ({page}) => {
  const state = makeState(), cal = await open(page, state, 412, 915);
  const six = cellOf(cal, state, SIX);
  await expect(six.locator('.rv-dots .rv-dot')).toHaveCount(3);
  await expect(six.locator('.rv-dots')).toBeVisible();
  await expect(six.locator('.rv-titles')).toBeHidden();
  await expect(six.locator('.rv-more')).toBeHidden();
  expect(await page.evaluate(() => [...document.querySelectorAll('#meetingList .rv-table tbody tr')].map(r => r.getBoundingClientRect().height))).toEqual(Array(await cal.locator('.rv-table tbody tr').count()).fill(56));
  // 칸을 누르면 그날이 골라지고 달력 아래 그날 목록에 6건.
  await six.click();
  await expect(cal.locator('.rv-cell.rv-sel')).toHaveAttribute('data-rv-cell', state.key(SIX));
  await expect(cal.locator('.rv-day-list .rv-row')).toHaveCount(6);
  await expect(page.locator('#calendarDayModal:not(.hidden)')).toHaveCount(0);
  expect(await noOverflow(page)).toBe(true);
});
