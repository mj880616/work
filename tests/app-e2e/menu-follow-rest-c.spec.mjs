import { test, expect } from '@playwright/test';
import { appOrigin, testOrigin } from './helpers/test-origin.mjs';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { openMeetingResult } from './helpers/meeting-open.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
// MENU-자리나머지(S61-15) 시험 C: 사업 보고 창 후속 할 일 ⋯, 창 밖 사업 보고 메뉴(달력 칸·그날 창 줄 우클릭), 할 일 줄 ⋯(홈 일지 할 일 칸·담당조직 연결 할 일)을
// 연 채 그 화면이 실제 길로 다시 그려져도 메뉴는 같은 칸의 새 칸 옆(우클릭이면 누른 자리 그대로)에 붙어 있고, 항목을 누르면 그 칸에 대해 실행된다.
// 칸이 없어지면 메뉴가 닫힌다. 공용 anchored-menu keepMenus(menu-follow-redraw.spec.mjs와 같은 모양). 가짜 서버·합성 이름만 쓴다.
// 사진: MENU_FOLLOW_SHOTS 폴더가 있으면 남긴다.
test.use({ timezoneId: 'Asia/Seoul' });
const SHOTS = process.env.MENU_FOLLOW_SHOTS || '';
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const shot = (page, name) => SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png` }) : null;

// 지금 그 칸에 표시를 달고 화면을 다시 그리게 한 뒤, 표시 없는 새 칸이 그려질 때까지 기다린다(정말 다시 그려졌는지).
async function redraw(trigger, fire) {
  await trigger.evaluate(el => { el.dataset.oldDraw = '1'; });
  await fire();
  await expect(trigger).toBeVisible();
  await expect(trigger).not.toHaveAttribute('data-old-draw', '1');
}
// 메뉴 상자가 그 칸 바로 옆(위·아래 24px 안)에 있는지.
async function nextTo(panel, trigger) {
  const p = await panel.boundingBox(), t = await trigger.boundingBox();
  return Math.min(Math.abs(p.y - (t.y + t.height)), Math.abs(p.y + p.height - t.y)) < 24;
}
// 우클릭 메뉴: 다시 그린 뒤에도 누른 자리 그대로(자리 다시 계산을 일부러 한 번 시킨다).
async function samePlace(page, panel, before) {
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  const after = await panel.boundingBox();
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeLessThan(4);
}
const errorsOf = page => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return errors;
};

// ---------- 사업 보고 창 후속 할 일 ⋯ (PC: 오른쪽 칸에 붙은 보고, kptu:tasks-changed로 다시 읽기) ----------
const meeting = { id: 'meeting-1', workspace_id: 'meeting-ws', project_id: null, title: '시험 회의', series_name: '시험 회의', round_no: 2,
  meeting_at: '2026-09-17T10:00:00Z', notes: '회의록 첫 줄', decisions: '', location: '', attendee_count: 1, transcript_text: '결과 본문 첫 줄',
  created_by: 'meeting-user', activity_kind: 'meeting' };
async function meetingSetup(page, tasks) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request(), u = new URL(req.url()), path = u.pathname;
    const ok = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data ?? null) });
    if (path === '/auth/v1/token') return ok({ access_token: 'a', refresh_token: 'r', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'meeting-user' } });
    if (path === '/auth/v1/user') return ok({ id: 'meeting-user', email: 'meeting@example.org', user_metadata: { display_name: 'QA' } });
    if (path === '/rest/v1/app_workspace_members') return ok([{ workspace_id: 'meeting-ws', user_id: 'meeting-user', role: 'owner', email: 'meeting@example.org', workspace: { id: 'meeting-ws', name: 'QA' } }]);
    if (path === '/rest/v1/app_workspaces') return ok([{ id: 'meeting-ws', name: 'QA' }]);
    if (path === '/rest/v1/app_profiles') return ok([{ user_id: 'meeting-user', display_name: 'QA' }]);
    if (path === '/rest/v1/app_meetings') return ok([meeting]);
    if (path === '/functions/v1/google-tasks' && u.searchParams.get('action') === 'linked') return ok({ connected: true, authorized: true, tasks: tasks.map(t => ({ ...t })) });
    if (path === '/functions/v1/google-calendar') return ok({ connected: false, enabled: false, selected: [], calendars: [], events: [] });
    if (path === '/functions/v1/google-tasks') return ok({ tasks: [], needs_reconnect: false });
    if (path === '/functions/v1/push-notifications') return ok({ enabled: false, web_enabled: false, native_enabled: false, public_key: 'qa' });
    if (path.startsWith('/rest/v1/') || path.startsWith('/functions/v1/')) return ok([]);
    return ok({});
  });
  await page.goto(`${testOrigin}/app/login/?return=${encodeURIComponent(`${testOrigin}/app/?view=meetings`)}`);
  await signInWithSession(page, 'meeting@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 15000 });
  await openMeetingResult(page, 'meeting-1');
}

test('사업 보고 후속 할 일 ⋯ 1280: 연 채 다시 읽어 그려도 같은 할 일 옆에 붙고 [수정]이 그 할 일로 · 할 일이 없어지면 닫힘', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = errorsOf(page);
  const tasks = [{ id: 't1', title: '가상 후속 일 하나', status: 'needsAction' }, { id: 't2', title: '가상 후속 일 둘', status: 'needsAction' }];
  await meetingSetup(page, tasks);
  const box = page.locator('#mrdTasks'), more = box.locator('[data-mrd-task-menu="t2"]'), panel = page.locator('#mrdTaskMenu');
  await expect(box.locator('[data-mrd-task]')).toHaveCount(2);
  await more.click();
  await expect(panel).toBeVisible();
  // 다른 화면에서 t1 이름이 바뀌었다 → 이 칸이 다시 읽어 그린다(전에는 메뉴를 닫았다).
  tasks[0].title = '가상 후속 일 하나 바뀜';
  await redraw(more, () => page.evaluate(() => window.dispatchEvent(new CustomEvent('kptu:tasks-changed'))));
  await expect(box.locator('[data-mrd-task="t1"]')).toContainText('가상 후속 일 하나 바뀜');
  await expect(panel).toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  expect(await nextTo(panel, more)).toBe(true);
  await shot(page, 'pc-1280-meeting-task-menu-kept');
  await panel.getByRole('button', { name: '수정', exact: true }).click();
  await expect(page.locator('#mrdTaskForm')).toBeVisible();
  await expect(page.locator('#mrdTaskTitle')).toHaveValue('가상 후속 일 둘');
  expect(errors).toEqual([]);
});

test('사업 보고 후속 할 일 ⋯ 1280: 연 채 그 할 일이 없어지면 메뉴가 닫힌다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = errorsOf(page);
  const tasks = [{ id: 't1', title: '가상 후속 일 하나', status: 'needsAction' }, { id: 't2', title: '가상 후속 일 둘', status: 'needsAction' }];
  await meetingSetup(page, tasks);
  const box = page.locator('#mrdTasks'), panel = page.locator('#mrdTaskMenu');
  await box.locator('[data-mrd-task-menu="t2"]').click();
  await expect(panel).toBeVisible();
  tasks.splice(1, 1);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('kptu:tasks-changed')));
  await expect(box.locator('[data-mrd-task]')).toHaveCount(1);
  await expect(panel).toBeHidden();
  expect(errors).toEqual([]);
});

// ---------- 창 밖 사업 보고 메뉴(달력 칸 제목·그날 창 줄 우클릭) — PC 우클릭 전용이라 1280만 ----------
const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const seoulKey = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const SIX = 8, FOUR = 9;
const TIMES = ['09:00', '10:30', '13:00', '14:00', '16:30', '19:00'];
function calState() {
  const [y, mo] = seoulKey(new Date()).split('-').map(Number);
  const key = day => `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const one = (n, title, day, time) => ({ id: ID(n), workspace_id: 'workspace-1', title, series_name: title, round_no: null, meeting_at: new Date(`${key(day)}T${time}:00+09:00`).toISOString(), activity_kind: 'meeting', created_by: 'user-1', notes: '', decisions: '', transcript_text: '원문' });
  const meetings = [];
  TIMES.forEach((t, i) => meetings.push(one(801 + i, `예시 보고 ${i + 1}`, SIX, t)));
  TIMES.slice(0, 4).forEach((t, i) => meetings.push(one(821 + i, `예시 넷 ${i + 1}`, FOUR, t)));
  return { key, meetings, patches: [], user: { id: 'user-1', email: 'owner@example.org', user_metadata: { display_name: '관리자' } }, workspace: { id: 'workspace-1', slug: 'team', name: '웹2' } };
}
async function calOpen(page, state) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installViewPrefsServer(page, { report_view: 'calendar' });
  await page.route(`${SB}/**`, async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const ok = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data ?? null) });
    if (path === '/auth/v1/token') return ok({ access_token: 'e2e-access', refresh_token: 'e2e-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: state.user });
    if (path === '/auth/v1/user') return ok(state.user);
    if (path === '/functions/v1/google-calendar') return ok({ connected: false, enabled: false, selected: [], calendars: [], events: [], eventColors: {} });
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path === '/rest/v1/app_workspace_members') return ok([{ workspace_id: 'workspace-1', user_id: state.user.id, role: 'owner', workspace: state.workspace, created_at: new Date().toISOString() }]);
    if (path === '/rest/v1/app_workspaces') return ok([state.workspace]);
    if (path === '/rest/v1/app_meetings' && req.method() === 'PATCH') {
      const id = (url.searchParams.get('id') || '').replace(/^eq\./, ''), body = req.postDataJSON(), row = state.meetings.find(m => m.id === id);
      state.patches.push({ id, body });
      if (!row) return ok([]);
      Object.assign(row, body);
      return ok([row]);
    }
    if (path === '/rest/v1/app_meetings' && req.method() === 'GET') {
      const id = url.searchParams.get('id') || '';
      if (!id || id.startsWith('in.(')) return ok(state.meetings);
      return ok(state.meetings.filter(m => 'eq.' + m.id === id));
    }
    if (path === '/rest/v1/app_profiles') return ok([{ user_id: state.user.id, display_name: '관리자' }]);
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
  await page.goto(`${appOrigin}/app/?view=meetings`);
  await enterLogin(page);
  await signInWithSession(page, 'owner@example.org');
  await page.waitForFunction(() => window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#reportViewSelect')).toHaveValue('calendar');
  const cal = page.locator('#meetingList .rv-cal');
  await expect(cal.locator(`[data-rv-cell="${state.key(FOUR)}"] [data-mrd-meeting]`)).toHaveCount(4);
  return cal;
}
const reload = page => () => page.evaluate(() => window.__KPTU_RELOAD_MEETINGS__());
async function pickKind(page, more) {
  await more.locator('[data-mrd-more="kind"]').click();
  const sheet = page.locator('#reportKindSheet');
  await expect(sheet).toBeVisible();
  await sheet.locator('[data-sheet-value="education"]').click();
}

test('창 밖 보고 메뉴 1280(달력 칸 제목 우클릭): 연 채 달력을 다시 그려도 누른 자리 그대로 · [종류 바꾸기]가 그 보고에 · 보고가 없어지면 닫힘', async ({ page }) => {
  const errors = errorsOf(page);
  const state = calState(), cal = await calOpen(page, state), more = page.locator('#mrdMoreMenu');
  const target = ID(822), title = () => cal.locator(`[data-rv-cell="${state.key(FOUR)}"] [data-mrd-meeting="${target}"]`);
  await title().click({ button: 'right' });
  await expect(more).toBeVisible();
  await expect(more.locator('button')).toHaveText(['수정', '종류 바꾸기', '삭제']);
  const before = await more.boundingBox();
  // 다른 곳에서 같은 날 다른 보고 이름이 바뀜 → 하나의 달력 그리기 주인이 다시 그린다.
  state.meetings.find(m => m.id === ID(821)).title = '예시 넷 바뀜';
  state.meetings.find(m => m.id === ID(821)).series_name = '예시 넷 바뀜';
  await redraw(title(), reload(page));
  await expect(cal.locator(`[data-mrd-meeting="${ID(821)}"]`)).toContainText('예시 넷 바뀜');
  await expect(more).toBeVisible();
  await expect(title()).toHaveAttribute('aria-expanded', 'true');
  await samePlace(page, more, before);
  await shot(page, 'pc-1280-report-calendar-menu-kept');
  await pickKind(page, more);
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toMatchObject({ id: target, body: { activity_kind: 'education' } });
  // 다시 연 채 그 보고가 없어지면 닫힌다.
  const other = () => cal.locator(`[data-mrd-meeting="${ID(823)}"]`);
  await other().click({ button: 'right' });
  await expect(more).toBeVisible();
  state.meetings = state.meetings.filter(m => m.id !== ID(823));
  await page.evaluate(() => window.__KPTU_RELOAD_MEETINGS__());
  await expect(other()).toHaveCount(0);
  await expect(more).toBeHidden();
  expect(errors).toEqual([]);
});

test('창 밖 보고 메뉴 1280(그날 창 줄 우클릭): 연 채 그날 창이 다시 채워져도 같은 보고 줄에 붙고 [종류 바꾸기]가 그 보고에', async ({ page }) => {
  const errors = errorsOf(page);
  const state = calState(), cal = await calOpen(page, state), more = page.locator('#mrdMoreMenu');
  await cal.locator(`.rv-cell[data-rv-cell="${state.key(SIX)}"] .rv-more`).click();
  await expect(page.locator('#calendarDayModal')).toBeVisible();
  const target = ID(804), row = () => page.locator(`#calendarDayList [data-mrd-meeting="${target}"]`);
  await row().click({ button: 'right' });
  await expect(more).toBeVisible();
  const before = await more.boundingBox();
  const m2 = state.meetings.find(m => m.id === ID(802));
  m2.title = m2.series_name = '예시 바뀐 이름';
  await redraw(row(), reload(page));
  await expect(page.locator(`#calendarDayList [data-mrd-meeting="${ID(802)}"]`)).toContainText('예시 바뀐 이름');
  await expect(more).toBeVisible();
  await expect(row()).toHaveAttribute('aria-expanded', 'true');
  await samePlace(page, more, before);
  await pickKind(page, more);
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toMatchObject({ id: target, body: { activity_kind: 'education' } });
  expect(errors).toEqual([]);
});

// ---------- 할 일 줄 ⋯(task-inline.js): 홈 일지 할 일 칸·담당조직 연결 할 일 ----------
for (const width of [412, 1280]) test.describe(`할 일 줄 메뉴 자리 ${width}`, () => {
  test('홈 할 일 칸 ⋯: 연 채 할 일을 다시 읽어 그려도 같은 줄 옆에 붙고 [수정]이 그 할 일로', async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = errorsOf(page);
    const c = await openHome(page);
    const card = page.locator('#homeView [data-journal-group="todo"]'), row = card.locator('li[data-journal-task="today"]'), more = row.locator('[data-journal-task-menu]');
    const panel = page.locator('#journalTaskMenu');
    await expect(row).toBeVisible();
    await row.hover(); await more.click();
    await expect(panel).toBeVisible();
    // 다른 화면에서 할 일이 바뀜(같은 알림) → 홈 할 일 칸이 다시 읽어 그린다.
    c.tasks.find(t => t.id === 'overdue').title = '지연 항목 바뀜';
    await redraw(more, () => page.evaluate(() => window.dispatchEvent(new CustomEvent('kptu:google-tasks-changed'))));
    await expect(panel).toBeVisible();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(await nextTo(panel, more)).toBe(true);
    await shot(page, `${width < 761 ? 'phone' : 'pc'}-${width}-journal-task-menu-kept`);
    await panel.getByRole('button', { name: '수정', exact: true }).click();
    await expect(page.locator('#gtTaskModal')).toBeVisible();
    await expect(page.locator('#gtEditTitle')).toHaveValue('오늘 항목');
    expect(errors).toEqual([]);
  });

  test('홈 할 일 칸 ⋯: 연 채 그 할 일이 없어지면 메뉴가 닫힌다', async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = errorsOf(page);
    const c = await openHome(page);
    const row = page.locator('#homeView [data-journal-group="todo"] li[data-journal-task="today"]'), panel = page.locator('#journalTaskMenu');
    await expect(row).toBeVisible();
    await row.hover(); await row.locator('[data-journal-task-menu]').click();
    await expect(panel).toBeVisible();
    c.tasks.splice(c.tasks.findIndex(t => t.id === 'today'), 1);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('kptu:google-tasks-changed')));
    await expect(row).toHaveCount(0);
    await expect(panel).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('담당조직 연결 할 일 ⋯: 연 채 다른 할 일이 저장돼 목록이 다시 그려져도 같은 줄 옆에 붙고 [수정]이 그 할 일로', async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = errorsOf(page);
    await openHome(page);
    const ORGS = [{ id: 'oa', workspace_id: 'w', name: '합성 가 지부', active: true, created_by: 'home-test', updated_at: '2026-09-15T01:00:00Z' }];
    const tasks = [
      { id: 'l-1', title: '합성 연결 할 일', taskListId: '@default', due: '2026-10-06T00:00:00.000Z', status: 'needsAction', source: 'google-task', notes: '' },
      { id: 'l-2', title: '합성 다른 일', taskListId: '@default', due: null, status: 'needsAction', source: 'google-task', notes: '' }];
    const list = (route, rows) => { const q = new URL(route.request().url()).searchParams; const o = Number(q.get('offset') || 0); return route.fulfill({ json: rows.slice(o, o + Number(q.get('limit') || rows.length || 1)) }); };
    await page.route(SB + '/rest/v1/app_suborganizations?**', route => { const id = new URL(route.request().url()).searchParams.get('id'); return route.fulfill({ json: id ? ORGS.filter(o => 'eq.' + o.id === id) : ORGS }); });
    await page.route(SB + '/rest/v1/app_suborganization_assignees?**', route => { const q = new URL(route.request().url()).searchParams; return route.fulfill({ json: q.get('user_id') ? [{ user_id: 'home-test' }] : ORGS.map(o => ({ organization_id: o.id, user_id: 'home-test' })) }); });
    await page.route(SB + '/rest/v1/app_suborganization_updates?**', route => list(route, []));
    await page.route(SB + '/rest/v1/app_documents?**', route => list(route, []));
    await page.route(SB + '/functions/v1/google-tasks?**', route => {
      const a = new URL(route.request().url()).searchParams.get('action');
      if (a === 'linked') return route.fulfill({ json: { tasks: tasks.map(t => ({ ...t })) } });
      return route.fallback();
    });
    await clickView(page, 'team');
    if (width < 761) await page.locator('#soOrganizationList [data-so-org="oa"]').click();
    const body = page.locator('#wdTaskBody'), row = body.locator('[data-google-task="l-1"]'), more = row.locator('[data-gt-linked-more]'), panel = page.locator('#gtLinkedMenu');
    await expect(row).toBeVisible();
    await row.hover(); await more.click();
    await expect(panel).toBeVisible();
    // 다른 화면(할 일 수정 창 등)에서 l-2가 저장됨 → 같은 할 일을 든 연결 목록이 다시 그린다(google-tasks.js taskSaved).
    await redraw(more, () => page.evaluate(() => window.KPTUGoogleTasks.taskSaved({ id: 'l-2', title: '합성 다른 일 바뀜', taskListId: '@default', due: null, status: 'needsAction', source: 'google-task', notes: '' })));
    await expect(body.locator('[data-google-task="l-2"]')).toContainText('합성 다른 일 바뀜');
    await expect(panel).toBeVisible();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(await nextTo(panel, more)).toBe(true);
    await shot(page, `${width < 761 ? 'phone' : 'pc'}-${width}-linked-task-menu-kept`);
    await panel.getByRole('button', { name: '수정', exact: true }).click();
    await expect(page.locator('#gtTaskModal')).toBeVisible();
    await expect(page.locator('#gtEditTitle')).toHaveValue('합성 연결 할 일');
    expect(errors).toEqual([]);
  });
});
