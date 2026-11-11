// S59-20 OPS-작은손보기: 화면에서 눈에 거슬린 작은 것 셋.
// ① 보고 상세의 빈 칸('후속 할 일'·자료·챙길 것 후보)에 '없음' 글을 따로 붙이지 않는다(사진 칸과 같은 규칙: 칸 제목만).
// ② 잊지 말기 글에 별표 두 개(**)가 그대로 보이던 것 — 별표만 걷고 글을 보인다(할 일 창으로 넘기는 제목도 같다).
// ③ 일정 메뉴의 빈 네모(그림 없는 칸) — 모든 항목에 그림이 있다.
// 서버는 흉내, 글·이름은 모두 지어낸 것. KPTU_SHOTS=1이면 docs/design/screens/s59-20/에 사진을 남긴다(PR 첨부용).
import {test, expect} from '@playwright/test';
import {baseState, mockApp, signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {openMeetingResult} from './helpers/meeting-open.mjs';
import {openHome} from './helpers/home-entry.mjs';
import {loginEntry} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';
import {makeState, openReportCalendar} from './helpers/report-calendar-plan-server.mjs';

test.use({timezoneId: 'Asia/Seoul'});
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const BASE = process.env.APP_E2E_ORIGIN || 'http://127.0.0.1:8123';
const SHOTS = process.env.KPTU_SHOTS === '1';
const shot = async (target, name) => { if (SHOTS) await target.screenshot({path: `docs/design/screens/s59-20/${name}.png`}); };
const WIDTHS = [412, 1280];
const tag = width => (width > 760 ? 'pc-1280' : 'phone-412');
const cid = n => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MEETING = 'd5920000-0000-4000-8000-000000000001';

// ---------- ① ② 보고 상세 ----------
function meetingState({candidates = []} = {}) {
  const s = baseState();
  s.spaces = []; s.docs = [];
  Object.assign(s, {candidates, googleCreates: [], candidatePatches: [],
    meetings: [{id: MEETING, workspace_id: 'workspace-1', title: '합성 점검 회의', series_name: '합성 점검 회의', round_no: 1, meeting_at: '2026-11-03T01:00:00Z', transcript_text: '합성 지난 결과', activity_kind: 'meeting', created_by: 'user-1'}]});
  return s;
}
async function meetingRoutes(page, s) {
  await mockApp(page, s);
  await page.route(`${SB}/functions/v1/google-tasks**`, route => {
    const req = route.request(), url = new URL(req.url()), action = url.searchParams.get('action');
    if (action === 'linked') return route.fulfill({json: {tasks: []}});
    if (action !== 'create') return route.fallback();
    const body = req.postDataJSON(); s.googleCreates.push(body);
    return route.fulfill({json: {ok: true, task: {id: `gt-${s.googleCreates.length}`, title: body.title, due: body.due || null, status: 'needsAction'}}});
  });
  await page.route(`${SB}/rest/v1/app_todo_candidates**`, route => {
    const req = route.request(), q = new URL(req.url()).searchParams;
    if (req.method() === 'PATCH') {
      const id = q.get('id').replace(/^eq\./, ''), body = req.postDataJSON(), row = s.candidates.find(c => c.id === id);
      s.candidatePatches.push({id, body}); if (!row) return route.fulfill({json: []});
      Object.assign(row, body); return route.fulfill({json: [{id, status: row.status, task_id: row.task_id, decided_at: row.decided_at}]});
    }
    let out = s.candidates;
    const src = q.get('source_id'), st = q.get('status');
    if (src) out = out.filter(c => 'eq.' + c.source_id === src);
    if (st === 'eq.open') out = out.filter(c => c.status === 'open');
    return route.fulfill({json: out});
  });
}
async function openDetail(page, s, width) {
  await page.setViewportSize({width, height: width > 760 ? 900 : 915});
  await meetingRoutes(page, s);
  await signIn(page, testOrigin + '/app/?view=reports');
  await page.waitForFunction(() => window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#meetingsView')).toBeVisible();
  await openMeetingResult(page, MEETING);
  await expect(page.locator('#mrdMeta').filter({visible: true})).toBeVisible();
}
const detail = page => page.locator('#mcolResult, #meetingRoundDetailModal').filter({visible: true}).first();
const candRow = (n, over = {}) => ({id: cid(n), kind: 'my_task', summary: `합성 후보 ${n}`, due: null, source_kind: 'meeting', source_id: MEETING, source_day: '2026-11-03', evidence: '근거', project_id: null, organization_id: null, status: 'open', task_id: null, task_due: null, created_at: '2026-11-03T02:00:00Z', decided_at: null, ...over});

for (const width of WIDTHS) test(`${width}: ① 보고 상세 — 후속 할 일·자료·사진·후보가 모두 비어도 '없음' 글을 따로 붙이지 않는다`, async ({page}) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const s = meetingState();
  await openDetail(page, s, width);
  const d = detail(page);
  // 칸 제목은 남고(자리·[+] 그대로), 칸 안에는 글자도 빈 표시도 없다.
  for (const sel of ['#mrdTasks', '#mrdTodoCand', '#mrdMaterials', '#mrdPhotos']) {
    const box = d.locator(sel);
    await expect(box).toHaveCount(1);
    await expect(box.locator('[data-wait-empty], [data-inbox-todo-empty]')).toHaveCount(0);
    await expect(box).not.toContainText('없음');
  }
  await expect(d.locator('#mrdTasks [data-mrd-task]')).toHaveCount(0);
  await expect(d.locator('[data-wait-empty]')).toHaveCount(0);
  await d.scrollIntoViewIfNeeded();
  await shot(page, `${tag(width)}-detail-empty`);
  expect(errors).toEqual([]);
});

for (const width of WIDTHS) test(`${width}: ①② 후보만 있고 할 일은 없는 보고 — 후보 줄 글에 ** 없음, 할 일 칸에 '없음' 글 없음, [할 일로]에 넘기는 제목도 별표 없이`, async ({page}) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const s = meetingState({candidates: [candRow(1, {summary: '**합성** 자료 정리', due: '2026-11-20'}), candRow(2, {summary: '합성 공문 **회신** 하기'})]});
  await openDetail(page, s, width);
  const cand = page.locator('#mrdTodoCand').filter({visible: true});
  await expect(cand.locator('.inbox-todo-row')).toHaveCount(2);
  await expect(cand).toContainText('합성 자료 정리');
  await expect(cand).toContainText('합성 공문 회신 하기');
  await expect(cand).not.toContainText('**');
  const d = detail(page);
  await expect(d.locator('#mrdTasks [data-wait-empty]')).toHaveCount(0);
  await expect(d.locator('#mrdTasks')).not.toContainText('없음');
  await expect(d.locator('[data-wait-empty]')).toHaveCount(0);
  await cand.scrollIntoViewIfNeeded();
  await shot(page, `${tag(width)}-detail-candidates`);
  // ⋯ [수정해서 할 일로]의 미리 채운 제목도 별표 없이.
  await cand.locator(`[data-inbox-todo-more="${cid(2)}"]`).click();
  await page.locator('#inboxTodoRowMenu [data-inbox-todo-menu="edit"]').click();
  await expect(cand.locator(`[data-inbox-todo-edit="${cid(2)}"] [data-inbox-todo-edit-title]`)).toHaveValue('합성 공문 회신 하기');
  // [할 일로]로 넘어가는 제목은 별표 없이 만들어진다.
  await cand.locator(`[data-inbox-todo-task="${cid(1)}"]`).click();
  await expect.poll(() => s.googleCreates.length).toBe(1);
  expect(s.googleCreates[0]).toMatchObject({action: 'create', title: '합성 자료 정리', due: '2026-11-20'});
  expect(JSON.stringify(s.googleCreates)).not.toContain('**');
  expect(errors).toEqual([]);
});

// ---------- ② 잊지 말기 ----------
const SB_PATH = (u, p) => u.origin === SB && u.pathname === p;
const noteBase = {workspace_id: 'w', kind: 'basket', title: null, created_at: '2026-10-06T00:00:00Z', updated_at: '2026-10-06T00:00:00Z', archived_at: null, ai_export_allowed: true, metadata: {}, attachments: []};
for (const width of WIDTHS) test(`${width}: ② 잊지 말기 — 텔레그램 요청·챙길 것·업데이트 줄에서(가족 줄은 같은 공용 줄 부품·단위 시험) ** 표시가 글자로 보이지 않는다`, async ({page}) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewportSize({width, height: 900});
  const cands = [
    {id: cid(1), kind: 'request', summary: '**가짜** 요청 하나', due: null, source_kind: 'telegram', source_id: cid(9), source_day: '2026-10-06', evidence: '근거', project_id: null, organization_id: null, status: 'open', task_id: null, task_due: null, created_at: '2026-10-06T01:00:00Z', decided_at: null},
    {id: cid(3), kind: 'my_task', summary: '지어낸 **챙길 것** 둘', due: null, source_kind: 'basket', source_id: cid(8), source_day: '2026-10-06', evidence: '근거', project_id: null, organization_id: null, status: 'open', task_id: null, task_due: null, created_at: '2026-10-06T03:00:00Z', decided_at: null}];
  const notes = [{...noteBase, id: '10000000-0000-4000-8000-000000000001', raw_text: '지어낸 **업데이트** 하나\n둘째 줄', occurred_at: '2026-10-06T04:00:00Z'}];
  await openHome(page, {beforeLoad: async () => {
    await page.route(u => SB_PATH(u, '/rest/v1/rpc/app_my_features'), r => r.fulfill({json: ['telegram']}));
    await page.route(u => SB_PATH(u, '/rest/v1/app_todo_candidates'), r => {
      const q = new URL(r.request().url()).searchParams, st = q.get('status');
      let out = cands;
      if (st === 'eq.open') out = out.filter(c => c.status === 'open'); else if (st?.startsWith('in.')) out = out.filter(c => c.status !== 'open');
      if (q.get('source_kind') === 'eq.telegram') out = out.filter(c => c.source_kind === 'telegram');
      return r.fulfill({json: out});
    });
    await page.route(u => SB_PATH(u, '/rest/v1/app_todo_feedback'), r => r.fulfill({json: []}));
    await page.route(u => SB_PATH(u, '/rest/v1/app_feed_items'), r => r.fulfill({json: [{id: cid(9), room_key: 'room-a', room_label: '가상 지부방'}]}));
    await page.route(u => SB_PATH(u, '/rest/v1/app_notes'), r => {
      const q = new URL(r.request().url()).searchParams;
      if (q.get('metadata')) return r.fulfill({json: []});
      return r.fulfill({json: notes.filter(n => !q.get('kind') || 'eq.' + n.kind === q.get('kind'))});
    });
    await page.route(u => SB_PATH(u, '/rest/v1/app_record_links'), r => r.fulfill({json: []}));
    await page.route(u => SB_PATH(u, '/rest/v1/app_journal_memorable'), r => r.fulfill({json: []}));
  }});
  await page.evaluate(() => window.KPTURouter.go('basket'));
  const list = page.locator('#basketView [data-forget-section] .nbx-list');
  await expect(list).toBeVisible();
  await expect(list.locator('[data-nbx-row]')).toHaveCount(3);
  // 별표만 걷고 글은 그대로.
  await expect(list).toContainText('가짜 요청 하나');
  await expect(list).toContainText('지어낸 챙길 것 둘');
  await expect(list).toContainText('지어낸 업데이트 하나');
  expect(await list.evaluate(el => el.textContent)).not.toContain('**');
  await expect(list.locator('[aria-label*="**"]')).toHaveCount(0);
  await shot(page.locator('#basketView [data-forget-section]'), `${tag(width)}-forget`);
  expect(errors).toEqual([]);
});

// ---------- ③ 일정 메뉴의 빈 네모 ----------
// 메뉴 줄마다 그림(svg path)이 있고 속이 비지 않았는지: 그림 칸만 있고 그림이 없으면 빈 네모 자리가 된다.
const menuIcons = page => page.locator('#rowMenu').evaluate(menu => [...menu.querySelectorAll('button')].map(b => ({
  label: b.textContent.trim(), svg: b.querySelectorAll('svg').length, d: [...b.querySelectorAll('svg path')].map(p => p.getAttribute('d') || '').join('')})));
const allDrawn = list => list.length > 0 && list.every(x => x.svg === 1 && x.d.length > 0);

const iso = (d, t) => new Date(`${d}T${t}:00+09:00`).toISOString();
const ev = (id, title, day, extra = {}) => ({id, calendarId: 'own', title, start: iso(day, '10:00'), end: iso(day, '11:00'), allDay: false, description: '', location: '', organizationIds: [], recurring: false, source: 'google', ...extra});
async function openCalendar(page) {
  const state = {store: true, plans: [], reports: [], seq: 0, events: [ev('wk1', '합성 주간 점검', '2026-11-11'), ev('etc1', '합성 자료 정리', '2026-11-12')]};
  await page.setViewportSize({width: 1280, height: 844});
  await page.clock.setFixedTime(new Date('2026-11-10T00:00:00Z'));
  await installViewPrefsServer(page, {calendar_view: 'month'});
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    if (url.origin === BASE) return route.continue();
    if (url.origin !== SB) return route.abort();
    const ok = (body, status = 200) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
    const user = {id: 'rp-user', email: 'qa@example.org', user_metadata: {display_name: 'QA'}};
    if (url.pathname === '/auth/v1/token') return ok({access_token: 'synthetic', refresh_token: 'synthetic', expires_at: 4102444800, user});
    if (url.pathname === '/auth/v1/user') return ok(user);
    if (url.pathname === '/rest/v1/app_workspace_members') return ok([{workspace_id: 'rp-ws', user_id: user.id, role: 'owner'}]);
    if (url.pathname === '/rest/v1/app_workspaces') return ok([{id: 'rp-ws', name: 'QA'}]);
    if (url.pathname === '/rest/v1/app_profiles') return ok([{user_id: user.id, display_name: 'QA'}]);
    if (url.pathname === '/rest/v1/app_calendar_report_plans') return ok(method === 'GET' ? state.plans : [], method === 'POST' ? 201 : 200);
    if (url.pathname === '/functions/v1/google-calendar') {
      const action = url.searchParams.get('action');
      if (method === 'POST') return ok({ok: true});
      if (action === 'event') return ok({event: state.events.find(e => e.id === url.searchParams.get('eventId')), eventColors: {}});
      const status = {connected: true, enabled: true, selected: ['own'], calendars: [{id: 'own', summary: '내 캘린더', accessRole: 'owner', backgroundColor: '#336699'}]};
      return ok(action === 'events' ? {...status, events: state.events.map(e => ({...e}))} : status);
    }
    if (url.pathname === '/functions/v1/google-tasks') return ok({connected: true, authorized: true, needs_reconnect: false, tasks: [], links: [], meeting_links: [], pending_scope: 'all'});
    return ok([]);
  });
  await page.goto(loginEntry(BASE + '/app/?view=calendar'));
  await signInWithSession(page, 'qa@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  const bar = id => page.locator(`#calendarGrid [data-google-event="${id}"]`).first();
  await expect(bar('wk1')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!window.__KPTU_CALENDAR_CONTEXT_MENU__ && window.KPTUCalendarEvents?.planOf?.('wk1', 'own') !== null)).toBe(true);
  return {bar, state};
}
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

test('1280: ③ 일정(달력) 막대 우클릭 메뉴 — 모든 항목에 그림이 있고 보고할 일정은 깃발(빈 네모 없음)', async ({page}) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const {bar} = await openCalendar(page);
  await settle(page);
  let b = null; await expect.poll(async () => (b = await bar('etc1').boundingBox()) !== null).toBe(true);
  const x = Math.round(b.x + b.width / 2), y = Math.round(b.y + b.height / 2);
  await page.mouse.move(x, y); await page.mouse.click(x, y, {button: 'right'});
  const menu = page.locator('#rowMenu');
  await expect(menu).toBeVisible();
  const icons = await menuIcons(page);
  expect(icons.map(i => i.label)).toEqual(['수정', '보고할 일정', '담당조직 연결', '결과 남기기', '삭제']);
  expect(allDrawn(icons), JSON.stringify(icons)).toBe(true);
  const box = await menu.boundingBox();
  if (SHOTS) await page.screenshot({path: 'docs/design/screens/s59-20/pc-1280-calendar-menu.png', clip: {x: box.x - 10, y: box.y - 10, width: box.width + 20, height: box.height + 20}});
  expect(errors).toEqual([]);
});

test('1280: ③ 왼쪽 메뉴 우클릭 — [숨기기]·[메뉴 수정] 모두 그림이 있다', async ({page}) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await openCalendar(page);
  const nav = page.locator('#appNav [data-view="calendar"]').first();
  const nb = await nav.boundingBox();
  await page.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2, {button: 'right'});
  const menu = page.locator('#rowMenu');
  await expect(menu).toBeVisible();
  const icons = await menuIcons(page);
  expect(icons.map(i => i.label)).toEqual(['숨기기', '메뉴 수정']);
  expect(allDrawn(icons), JSON.stringify(icons)).toBe(true);
  const box = await menu.boundingBox();
  if (SHOTS) await page.screenshot({path: 'docs/design/screens/s59-20/pc-1280-nav-menu.png', clip: {x: box.x - 10, y: box.y - 10, width: box.width + 20, height: box.height + 20}});
  expect(errors).toEqual([]);
});

test('412: ③ 사업 보고 달력 줄 ⋯ 메뉴(폰) — [보고할 일정 ✓]·[빼기] 모두 그림이 있다', async ({page}) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const state = makeState();
  const cal = await openReportCalendar(page, state, {width: 412, height: 915});
  await expect(cal.locator('.rv-day-list [data-rv-plan="ev-todo"]')).toBeVisible();
  await cal.locator('.rv-day-list [data-rv-plan="ev-todo"] [data-rv-plan-more]').click();
  await expect(page.locator('#rowMenu')).toBeVisible();
  const icons = await menuIcons(page);
  expect(icons.map(i => i.label)).toEqual(['보고할 일정 ✓', '빼기']);
  expect(allDrawn(icons), JSON.stringify(icons)).toBe(true);
  const box = await page.locator('#rowMenu').boundingBox();
  if (SHOTS) await page.screenshot({path: 'docs/design/screens/s59-20/phone-412-plan-menu.png', clip: {x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 10), width: box.width + 20, height: box.height + 20}});
  expect(errors).toEqual([]);
});
