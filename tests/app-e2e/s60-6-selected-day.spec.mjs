import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// UI-고른날진하게(S60-6, 명진 2026-11-12): 고른 날이 있는 달력(홈 [하루] 날짜 줄·일기 달력·사업 보고 달력)은 모두
// 공용 규칙 하나(ui-standard.css .ds-day-sel .ds-day-num)로 날짜 숫자를 진한 채운 동그라미·흰 숫자로 그린다.
// 칸 옅은 바탕은 없고, 골라도 칸·숫자 크기는 그대로, 오늘 표시(일기·사업 보고 = 칸 네모 선, 홈 = 동그라미 선)는 그대로.
// 사진: SHOT_DIR=<폴더>를 주면 PC 1280·폰 412 사진을 거기에도 남긴다(PR 첨부용).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const SHOT_DIR = process.env.SHOT_DIR || '';
const WIDTHS = [1280, 412];
const shot = async (page, name, clip) => {
  const opts = clip ? {clip} : {};
  await page.screenshot({path: test.info().outputPath(name), ...opts});
  if (SHOT_DIR) await page.screenshot({path: `${SHOT_DIR}/${name}`, ...opts});
};
const token = (page, scope, name, prop) => page.evaluate(([s, n, p]) => { const e = document.createElement('span'); e.style[p] = `var(${n})`; document.querySelector(s).append(e); const c = getComputedStyle(e)[p]; e.remove(); return c; }, [scope, name, prop]);
const look = (loc, num) => loc.evaluate((el, n) => { const x = el.querySelector(n), c = getComputedStyle(x), r = x.getBoundingClientRect(), cr = el.getBoundingClientRect();
  return {bg: c.backgroundColor, fg: c.color, w: Math.round(r.width), h: Math.round(r.height), cellH: Math.round(cr.height), cellBg: getComputedStyle(el).backgroundColor, frame: getComputedStyle(el, '::before').borderTopWidth}; }, num);

for (const width of WIDTHS) {
  test(`${width}: 일기 달력 — 다른 날을 누르면 숫자가 진한 채운 동그라미, 칸·숫자 크기 그대로, 오늘 네모 선 그대로`, async ({page}) => {
    await page.setViewportSize({width, height: 900});
    await openHome(page);
    const at = '2026-10-05T01:00:00Z';
    const rows = [{id: 'd4', workspace_id: 'w', kind: 'diary', title: null, journal_day: '2026-10-04', raw_text: '글만 쓴 날', occurred_at: at, created_at: at, updated_at: at, archived_at: null, ai_export_allowed: false, attachments: [], metadata: {}}];
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({json: new URL(r.request().url()).searchParams.get('metadata') ? [] : rows}) : r.fulfill({status: 500, json: {}}));
    await page.evaluate(() => window.KPTURouter.go('diary'));
    await expect(page.locator('#diaryRoot [data-diary-status] [data-wait]')).toHaveCount(0);
    const cell = day => page.locator(`#diaryRoot [data-diary-day="${day}"]`);
    const fill = await token(page, '#diaryView', '--ds-day-sel-bg', 'backgroundColor'), onFill = await token(page, '#diaryView', '--ds-day-sel-ink', 'color'), soft = await token(page, '#diaryView', '--ds-select-bg', 'backgroundColor');
    // 달력 칸은 읽기가 끝날 때마다 새로 그려진다: 잴 때마다 그 순간의 칸을 찾아 잰다(빈 값이면 다시).
    const measure = async () => { let v; await expect.poll(async () => (v = await look(cell('2026-10-08'), '.diary-num')).bg).not.toBe(''); return v; };
    const before = await measure();
    expect(before.bg).toBe('rgba(0, 0, 0, 0)');
    await cell('2026-10-08').click();
    await expect(cell('2026-10-08')).toHaveClass(/ds-day-sel/);
    const after = await measure();
    expect([after.bg, after.fg]).toEqual([fill, onFill]);
    expect(after.cellBg).not.toBe(soft);
    expect([after.w, after.h, after.cellH]).toEqual([before.w, before.h, before.cellH]);
    expect(after.h).toBeLessThanOrEqual(20);
    // 오늘(10/6)은 네모 선 그대로, 바탕 없음.
    const today = await look(cell('2026-10-06'), '.diary-num');
    expect(today.frame).toBe('2px');expect(today.bg).toBe('rgba(0, 0, 0, 0)');
    // 일요일 머리 빨강 그대로.
    expect(await page.locator('#diaryRoot .diary-week-head .sunday').evaluate(e => getComputedStyle(e).color)).toBe(await token(page, '#diaryView', '--kptu-danger', 'color'));
    // 고른 날 창이 열려 있어도 달력이 보이게 달력 칸만 찍는다.
    const box = await page.locator('#diaryRoot [data-diary-cal]').boundingBox();
    await shot(page, `s60-6-diary-${width}.png`, {x: 0, y: Math.max(0, box.y - 60), width, height: Math.min(box.height + 70, 900)});
  });
}

// 사업 보고 달력: 이번 달 5일·12일에 보고 하나씩(점·제목 표시 유지 확인).
function reportState() {
  const seoulKey = d => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Seoul'}).format(d);
  const [y, mo] = seoulKey(new Date()).split('-').map(Number);
  const key = day => `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const meeting = (n, title, day) => ({id: ID(n), workspace_id: 'workspace-1', title, series_name: title, round_no: null, meeting_at: new Date(`${key(day)}T10:00:00+09:00`).toISOString(), activity_kind: 'meeting', created_by: 'user-1', notes: '', decisions: '', transcript_text: '원문'});
  return {key, todayKey: seoulKey(new Date()), meetings: [meeting(901, '예시 보고', 5), meeting(902, '예시 회의', 12)],
    user: {id: 'user-1', email: 'owner@example.org', user_metadata: {display_name: '관리자'}}, workspace: {id: 'workspace-1', slug: 'team', name: '웹2'}};
}
async function mockReports(page, state) {
  const now = () => new Date().toISOString();
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
    if (path === '/rest/v1/app_meetings' && req.method() === 'GET') { const id = url.searchParams.get('id') || ''; return ok(!id || id.startsWith('in.(') ? state.meetings : state.meetings.filter(m => 'eq.' + m.id === id)); }
    if (path === '/rest/v1/app_profiles') return ok([{user_id: state.user.id, display_name: '관리자'}]);
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
}

for (const width of WIDTHS) {
  test(`${width}: 사업 보고 달력 — 다른 날을 누르면 숫자가 진한 채운 동그라미, 칸 높이·숫자 크기 그대로, 오늘 네모 선 그대로`, async ({page}) => {
    const state = reportState();
    await page.setViewportSize({width, height: 900});
    await installViewPrefsServer(page, {report_view: 'calendar'});
    await mockReports(page, state);
    await page.goto(`${appOrigin}/app/?view=meetings`);
    await enterLogin(page);
    await signInWithSession(page, 'owner@example.org');
    await page.waitForFunction(() => window.KPTUViewLoader?.isLoaded('meetings'));
    const cal = page.locator('#meetingList .rv-cal');
    await expect(cal.locator(`[data-rv-cell="${state.key(5)}"] .rv-dots, [data-rv-cell="${state.key(5)}"] .rv-title`).first()).toBeAttached();
    const other = state.todayKey === state.key(12) ? state.key(5) : state.key(12);
    const cell = cal.locator(`.rv-cell[data-rv-cell="${other}"]`);
    const fill = await token(page, '#meetingsView', '--ds-day-sel-bg', 'backgroundColor'), onFill = await token(page, '#meetingsView', '--ds-day-sel-ink', 'color'), soft = await token(page, '#meetingsView', '--ds-select-bg', 'backgroundColor');
    const before = await look(cell, '.rv-num');
    expect(before.bg).toBe('rgba(0, 0, 0, 0)');
    await cell.click();
    await expect(cal.locator('.rv-cell.rv-sel')).toHaveAttribute('data-rv-cell', other);
    const after = await look(cal.locator(`.rv-cell[data-rv-cell="${other}"]`), '.rv-num');
    expect([after.bg, after.fg]).toEqual([fill, onFill]);
    expect(after.cellBg).not.toBe(soft);
    expect([after.w, after.h, after.cellH]).toEqual([before.w, before.h, before.cellH]);
    // 숫자 동그라미는 칸 폭 전체로 번지지 않는다.
    expect(after.w).toBeLessThanOrEqual(30);
    // 오늘은 네모 선 그대로(고르지 않은 오늘 숫자는 칠하지 않음).
    const today = await look(cal.locator(`.rv-cell[data-rv-cell="${state.todayKey}"]`), '.rv-num');
    expect(today.frame).toBe('2px');expect(today.bg).toBe('rgba(0, 0, 0, 0)');
    // 표시 점·제목은 그대로.
    await expect(cal.locator(`[data-rv-cell="${state.key(12)}"] .rv-dot`).first()).toBeAttached();
    const box = await cal.boundingBox();
    await shot(page, `s60-6-report-${width}.png`, {x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: Math.min(box.width + 16, width), height: Math.min(box.height + 16, 900)});
  });
}

for (const width of WIDTHS) {
  test(`${width}: 홈 [하루] 날짜 줄 — 같은 공용 규칙(채운 동그라미), 오늘은 동그라미 선`, async ({page}) => {
    await page.setViewportSize({width, height: 900});
    await openHome(page);
    const date = day => page.locator(`#journalRoot [data-journal-date="${day}"]`);
    const fill = await token(page, '#homeView', '--ds-day-sel-bg', 'backgroundColor'), onFill = await token(page, '#homeView', '--ds-day-sel-ink', 'color');
    await date('2026-10-08').click();
    await expect(date('2026-10-08')).toHaveClass(/ds-day-sel/);
    const after = await look(date('2026-10-08'), '.journal-num');
    expect([after.bg, after.fg]).toEqual([fill, onFill]);
    expect(await date('2026-10-06').locator('.journal-num').evaluate(e => getComputedStyle(e).borderTopColor)).not.toBe('rgba(0, 0, 0, 0)');
    const box = await page.locator('#journalRoot .journal-days').boundingBox();
    await shot(page, `s60-6-home-${width}.png`, {x: 0, y: Math.max(0, box.y - 70), width, height: box.height + 90});
  });
}
