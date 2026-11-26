import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { noteTrash } from './helpers/note-trash.mjs';
import { start as newsStart, openNews } from './helpers/news-server.mjs';
import { setup as librarySetup, openLibrary } from './helpers/library-multi-delete-scenario.mjs';
import { server as planServer, installServer as installPlanServer } from './helpers/report-plan-marks-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { loginEntry } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { openEmphasisFixture } from './helpers/calendar-task-emphasis.mjs';
import { baseState, mockApp, signIn } from './helpers/filter-chip-fixture.mjs';
import { testOrigin } from './helpers/test-origin.mjs';
import { openMeetingResult } from './helpers/meeting-open.mjs';
// UI-스와이프메뉴만(S70-60, 명진 2026-11-26 07:29 "스와이프 작동할 때 왼쪽으로 스와이프를 끝까지 한다고 해서 숨겨지면 안 돼.
// 스와이프 메뉴가 여러 개 있기 때문에 일단 메뉴가 펼쳐지고 스와이프 작동은 그 메뉴를 눌렀을 때 돼야 돼"):
// 공용 줄 밀기(app/row-swipe.js)를 쓰는 모든 폰 목록에서, 줄을 왼쪽으로 끝까지 밀었다 놓으면 칸(메뉴)만 펼쳐지고
// 어떤 일도 하지 않는다(숨기기·삭제·저장·보관 없음, 서버 쓰기 요청 없음). 일은 펼쳐진 칸을 눌렀을 때만 한다.
// 오른쪽 밀기는 칸 없이 바로 여러 개 고르기다(기준표 W3, S70-64) — 서버 쓰기는 여전히 없다.
// 기준표: docs/design/standard-interactions.md 8절 P5. 새 화면에 줄 밀기를 붙이면 아래 SCREENS 표에 한 줄 더한다.
// (휴지통 줄은 project-system-v3.spec.mjs 'TRASH 줄 밀기'가 같은 규칙을 본다 — 그 화면 흉내 서버가 그 파일 안에만 있다.)
// 서버는 모두 흉내, 글·이름은 모두 지어낸 것.
test.use({ timezoneId: 'Asia/Seoul' });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const BASE = process.env.APP_E2E_ORIGIN || 'http://127.0.0.1:8123';
const W = 390, H = 844;

// ---------- 화면 열기 ----------
// 각 화면: {row: 밀 줄, list: 줄 밀기 칸이 생기는 목록, picked: 오른쪽으로 밀면 보이는 선택 막대, act: 왼쪽 칸 하나를 누르면 일어날 일}
async function homeReads(page) {
  const uid = n => `00000000-0000-4000-8000-00000000000${n}`;
  const READS = [1, 2, 3].map(n => ({ id: uid(n), title: `가상 소식 ${n}`, what: `가상 일 ${n}`, why: `담당 가상지부 ${n}`, source: '가상신문', at: '2026-10-06T00:10:00Z', url: `https://news.example.test/${n}` }));
  const ROW = { day: '2026-10-06', reads: READS, reads_at: '2026-10-06T10:00:00Z', suggests: [], suggests_at: null, suggests_done: [] };
  const beforeLoad = async () => {
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/ai-assist', async r => {
      let body = null; try { body = r.request().postDataJSON(); } catch { body = null; }
      if (body?.kind !== 'home_day_picks') return r.fallback();
      return r.fulfill({ json: { ok: true, kind: 'home_day_picks', day: body.day, picks: ROW } });
    });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_home_day_picks', r => r.fulfill({ json: [ROW] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/rpc/app_news_article_of', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && (u.pathname === '/rest/v1/app_news_items' || u.pathname === '/rest/v1/app_now_signals'), r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_news_marks', r => {
      const req = r.request();
      if (req.method() === 'GET') return r.fulfill({ json: [] });
      const id = (new URL(req.url()).searchParams.get('article_id') || '').replace(/^eq\./, '');
      return r.fulfill({ json: [{ article_id: id, folder_id: null, hidden_at: req.postDataJSON()?.hidden_at ?? null }] });
    });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_reading_items', r => r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.fallback());
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/rpc/app_reading_keep', r => r.fulfill({ json: { ok: true, on: true, id: 'r1', saved_at: '2026-10-06T10:00:00Z', created: true } }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_news_now_signals', r => r.fulfill({ status: 201, body: '' }));
  };
  await openHome(page, { beforeLoad, now: '2026-10-06T10:30:00Z' });
  const row = page.locator(`#journalRoot [data-journal-read="${uid(1)}"]`);
  await expect(row).toBeVisible();
  return { row, list: page.locator('#journalRoot'), picked: page.locator('#journalRoot .row-swipe-pickbar, .row-swipe-pickbar:visible').first(),
    act: { key: 'hide', done: async () => expect(row).toHaveCount(0) } };
}
async function nowNews(page) {
  await newsStart(page, W);
  await openNews(page, W);
  const row = page.locator('#newsRoot [data-nc-item="c1"]');
  await expect(row).toBeVisible();
  return { row, list: page.locator('#newsRoot'), picked: page.locator('#newsRoot .row-swipe-pickbar'), act: { key: 'hide', done: async () => expect(row).toHaveCount(0) } };
}
async function reading(page) {
  const id = n => `a6900000-0000-4000-8000-00000000000${n}`;
  const rowOf = n => ({ id: id(n), workspace_id: 'w', url: `https://example.com/${n}`, title: `가짜 글 ${n}`, site: 'example.com', saved_at: `2026-11-2${n}T01:00:00Z`, read_at: null, body_state: 'ok', body_at: '2026-11-21T01:00:10Z', business_area_id: null, updated_at: '2026-11-21T01:00:10Z', body: '가짜 본문이에요.' });
  const rows = [rowOf(1), rowOf(2), rowOf(3)];
  await openHome(page);
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url());
    if (u.pathname !== '/rest/v1/app_reading_items') return route.fallback();
    const ok = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    const one = (u.searchParams.get('id') || '').replace(/^eq\./, '');
    const pick = r => { const { workspace_id, body, ...rest } = r; return rest; };
    if (req.method() === 'PATCH') { const r = rows.find(x => x.id === one); if (r) Object.assign(r, req.postDataJSON()); return ok(r ? [pick(r)] : []); }
    if (req.method() === 'DELETE') return route.fulfill({ status: 204 });
    return ok((one ? rows.filter(x => x.id === one) : rows).map(pick));
  });
  await page.locator('#mobileMenuTab').click();
  await page.locator('#mobileMenu nav button:visible', { hasText: '저장한 글' }).click();
  const list = page.locator('#readingView [data-rd-list]');
  await list.locator('.rd-switch [data-filter-value="all"]').click();
  const row = list.locator(`.rd-row[data-rd-open="${id(1)}"]`);
  await expect(row).toBeVisible();
  return { row, list, picked: page.locator('#readingView .row-swipe-pickbar'),
    act: { key: 'read', done: async () => expect.poll(() => rows[0].read_at).toBeTruthy() } };
}
async function library(page) {
  await librarySetup(page, W);
  await openLibrary(page, BASE);
  const list = page.locator('#documentList');
  const row = list.locator('.lu-row[data-lu-document="n1"]');
  await expect(row).toBeVisible();
  return { row, list, picked: page.locator('#librarySelectBar'), act: { key: 'delete', done: async () => expect(row).toHaveCount(0) } };
}
async function calendarList(page) {
  await page.clock.setFixedTime(new Date('2026-11-10T00:00:00Z'));
  await installViewPrefsServer(page, { calendar_view: 'list' });
  const state = planServer();
  await installPlanServer(page, state, { base: BASE });
  await page.goto(loginEntry(BASE + '/app/?view=calendar'));
  await signInWithSession(page, 'qa@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  const list = page.locator('#calendarList');
  await expect(list.locator('[data-google-event="todo2"] .rp-mark')).toHaveCount(1); // 보고할 일정 표시까지 읽은 뒤에 칸이 생긴다
  const row = list.locator('.clv-event[data-google-event="none1"]').first();
  await expect(row).toBeVisible();
  // 목록은 연 뒤 한 번 더 다시 그려진다(늦게 온 읽기). 다시 그리면 열린 칸도 닫히므로 그 뒤에 민다.
  await page.waitForTimeout(2000);
  return { row, list, picked: page.locator('.row-swipe-pickbar:visible').first(), act: { key: 'plan-on', done: async () => expect.poll(() => state.planWrites.length).toBe(1) } };
}
// 잊지 말기(업데이트)·노트: 같은 app_notes 흉내(detail-head-menu-swipe.spec.mjs와 같은 모양).
async function notesServer(page, rows) {
  const trash = await noteTrash(page, SB);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id'))
      && (!q.has('metadata->>pinned_at') || (q.get('metadata->>pinned_at') === 'is.null' ? x.metadata.pinned_at == null : 'eq.' + x.metadata.pinned_at === q.get('metadata->>pinned_at')));
    if (req.method() === 'GET') { if (q.get('metadata')) return r.fulfill({ json: [] }); return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)) }); }
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, body, { updated_at: '2026-10-06T02:00:00Z' })); return r.fulfill({ json: hit }); }
    if (req.method() === 'DELETE') { const hit = rows.filter(pick); hit.forEach(x => { rows.splice(rows.indexOf(x), 1); trash.take(x, 0); }); return r.fulfill({ json: hit }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') || q.has('google_task_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  for (const t of ['app_documents', 'app_suborganizations', 'app_suborganization_assignees', 'app_spaces']) await page.route(SB + '/rest/v1/' + t + '?**', r => r.fulfill({ json: [] }));
}
async function updates(page) {
  const stamp = '2026-10-06T01:00:00Z', A = '10000000-0000-4000-8000-0000000000a1';
  const base = { workspace_id: 'w', kind: 'basket', title: null, created_at: stamp, updated_at: stamp, archived_at: null, ai_export_allowed: true, metadata: {}, attachments: [] };
  const rows = [{ ...base, id: A, raw_text: '합성 교섭 결과 공유', occurred_at: '2026-10-06T03:00:00Z' }, { ...base, id: 'b', raw_text: '합성 둘째 업데이트', occurred_at: '2026-10-06T02:00:00Z' }];
  await openHome(page);
  await notesServer(page, rows);
  await page.evaluate(() => window.KPTURouter.go('basket'));
  const row = page.locator(`[data-basket-row="${A}"]`);
  await expect(row).toBeVisible();
  return { row, list: page.locator('#basketRows'), picked: page.locator('.row-swipe-pickbar:visible').first(),
    act: { key: 'hold', done: async () => expect.poll(() => rows.find(x => x.id === A)?.archived_at).toBeTruthy() } };
}
async function notes(page) {
  const at = '2026-10-16T01:00:00Z';
  const row = (id, title) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 글', occurred_at: at, created_at: at, updated_at: at, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {} });
  const rows = [row('n-one', '첫 노트'), row('n-two', '둘째 노트')];
  await openHome(page);
  await notesServer(page, rows);
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  const el = page.locator('[data-note-row="n-one"]');
  await expect(el).toBeVisible();
  return { row: el, list: page.locator('[data-note-list]'), picked: page.locator('[data-nx-select-bar]'),
    act: { key: 'pin', done: async () => expect.poll(() => rows.find(x => x.id === 'n-one')?.metadata?.pinned_at).toBeTruthy() } };
}
async function tasks(page) {
  const list = [{ id: 'a', title: '할 일 a', taskListId: '@default', taskListTitle: '내 할 일', due: null, status: 'needsAction', notes: '' }, { id: 'b', title: '할 일 b', taskListId: '@default', taskListTitle: '내 할 일', due: null, status: 'needsAction', notes: '' }];
  await openEmphasisFixture(page, { view: 'list', now: Date.parse('2026-10-08T03:00:00Z'), events: [], tasks: list });
  const done = [];
  await page.route('**/functions/v1/google-tasks**', async route => {
    const url = new URL(route.request().url()), action = url.searchParams.get('action'), body = route.request().postDataJSON?.() || null;
    const ok = json => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
    if (action === 'links') return ok({ links: [], meeting_links: [] });
    if (body?.task_id) { done.push(body); const t = list.find(x => x.id === body.task_id); if (t && body.status) t.status = body.status; return ok({ ok: true, task: t }); }
    return ok({ connected: true, authorized: true, needs_reconnect: false, tasks: list, pending_scope: 'all' });
  });
  await page.evaluate(() => window.KPTURouter.go('tasks'));
  const row = page.locator('#gtTaskBody .gt-row[data-google-task="a"]');
  await expect(row).toBeVisible();
  return { row, list: page.locator('#gtTaskBody'), picked: page.locator('.row-swipe-pickbar:visible').first(), act: { key: 'toggle', done: async () => expect.poll(() => done.length).toBeGreaterThan(0) } };
}
// 챙길 것(보고 상세 '잊지 말기 후보' 줄, s59-20-small-fixes.spec.mjs와 같은 흉내).
async function todoCandidates(page) {
  const MEETING = 'd5960000-0000-4000-8000-000000000001', cid = n => `c6000000-0000-4000-8000-00000000000${n}`;
  const s = baseState();
  s.spaces = []; s.docs = [];
  const cand = n => ({ id: cid(n), kind: 'my_task', summary: `합성 후보 ${n}`, due: null, source_kind: 'meeting', source_id: MEETING, source_day: '2026-11-03', evidence: '근거', project_id: null, organization_id: null, status: 'open', task_id: null, task_due: null, created_at: '2026-11-03T02:00:00Z', decided_at: null });
  Object.assign(s, { candidates: [cand(1), cand(2)], patches: [],
    meetings: [{ id: MEETING, workspace_id: 'workspace-1', title: '합성 점검 회의', series_name: '합성 점검 회의', round_no: 1, meeting_at: '2026-11-03T01:00:00Z', transcript_text: '합성 지난 결과', activity_kind: 'meeting', created_by: 'user-1' }] });
  await mockApp(page, s);
  await page.route(`${SB}/functions/v1/google-tasks**`, route => { const action = new URL(route.request().url()).searchParams.get('action'); return action === 'linked' ? route.fulfill({ json: { tasks: [] } }) : route.fallback(); });
  await page.route(`${SB}/rest/v1/app_todo_candidates**`, route => {
    const req = route.request(), q = new URL(req.url()).searchParams;
    if (req.method() === 'PATCH') { const id = q.get('id').replace(/^eq\./, ''), body = req.postDataJSON(), row = s.candidates.find(c => c.id === id); s.patches.push({ id, body }); if (row) Object.assign(row, body); return route.fulfill({ json: row ? [{ id, status: row.status, task_id: row.task_id, decided_at: row.decided_at }] : [] }); }
    const src = q.get('source_id'), st = q.get('status');
    let out = s.candidates; if (src) out = out.filter(c => 'eq.' + c.source_id === src); if (st === 'eq.open') out = out.filter(c => c.status === 'open');
    return route.fulfill({ json: out });
  });
  await signIn(page, testOrigin + '/app/?view=reports');
  await page.waitForFunction(() => window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#meetingsView')).toBeVisible();
  await openMeetingResult(page, MEETING);
  await expect(page.locator('#mrdMeta').filter({ visible: true })).toBeVisible();
  const list = page.locator('#mrdTodoCand').filter({ visible: true });
  const row = list.locator(`[data-inbox-todo-row="${cid(1)}"], [data-inbox-todo-row]`).first();
  await expect(row).toBeVisible();
  return { row, list, picked: page.locator('.row-swipe-pickbar:visible').first(), act: { key: 'dismiss', done: async () => expect.poll(() => s.patches.length).toBeGreaterThan(0) } };
}

const SCREENS = [
  ['홈 읽을 만한 글', homeReads], ['Now 뉴스', nowNews], ['저장한 글', reading], ['자료실', library], ['일정 목록', calendarList],
  ['잊지 말기', updates], ['노트', notes], ['할 일', tasks], ['챙길 것 후보', todoCandidates],
];

// ---------- 손동작 ----------
// 손가락 밀기(합성 터치 포인터, 한 evaluate 안에서 동기로 다 보낸다). 목록이 다시 그려져 줄이 빠졌으면 다시 찾아 민다.
async function swipe(locator, dx) {
  await expect(async () => {
    await expect(locator).toBeVisible();
    const sent = await locator.evaluate((el, { dx }) => {
      if (!el.isConnected) return false;
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const fire = (type, cx) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: y }));
      fire('pointerdown', x); for (let i = 1; i <= 12; i++) fire('pointermove', x + dx * i / 12); fire('pointerup', x + dx);
      return true;
    }, { dx });
    expect(sent).toBe(true);
  }).toPass({ timeout: 10000 });
}
// 손가락 한 번 누르기(누름 → click). 칸에 바로 보낸다(보이게 스크롤이 열린 칸을 닫지 않게).
async function touchTap(locator) {
  await locator.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, bubbles: true });
  await locator.dispatchEvent('click');
}
// 끝까지 밀어 칸이 보일 때까지(민 뒤 늦게 온 읽기로 목록이 다시 그려지면 열린 칸도 닫히므로 다시 민다).
async function swipeOpen(row, dx, cell) {
  await expect(async () => {
    await swipe(row, dx);
    await expect(cell).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
}
const tick = async page => { try { await page.clock.setFixedTime(await page.evaluate(() => Date.now() + 1000)); } catch { /* 시계를 멈추지 않은 화면 */ } };
// 서버 쓰기 = 흉내 서버(Supabase 주소)로 가는 GET 아닌 요청 가운데 읽기 함수가 아닌 것.
// 화면 틀이 뒤에서 늘 보내는 상태 읽기(회의 받아쓰기 진행·사진 상태)도 쓰기가 아니다.
const READ_CALLS = /\/functions\/v1\/(ai-assist|meeting-transcribe|onedrive-photos)$|\/rest\/v1\/rpc\/(app_news_article_of|app_view_prefs_get|app_workspace_start|app_operator_features_mine|app_workspace_has_feature)$/;
function watchWrites(page) {
  const all = [];
  page.on('request', req => {
    const u = new URL(req.url());
    if (u.origin !== SB || ['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return;
    if (req.method() === 'POST' && READ_CALLS.test(u.pathname)) return;
    if (u.pathname === '/functions/v1/google-tasks' && !(req.postData() || '').includes('task_id')) return; // 할 일 목록 읽기(작업 지정 없음)
    if (u.pathname === '/functions/v1/google-calendar' && !/"action":"(update|delete|create|move)/.test(req.postData() || '')) return;
    all.push(req.method() + ' ' + u.pathname);
  });
  return all;
}

for (const [name, open] of SCREENS) {
  test(`P5 ${name} 폰 ${W}: 끝까지 밀었다 놓으면 메뉴(칸)만 펼쳐지고 아무 일도 하지 않는다, 펼쳐진 칸을 눌러야 동작`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: W, height: H });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const s = await open(page);
    const writes = watchWrites(page);
    await page.waitForTimeout(800);
    writes.length = 0;
    const ends = s.list.locator('[data-row-swipe-act="end"]'), pickCell = s.list.locator('[data-row-swipe-key="select"]');

    // ① 왼쪽으로 줄 폭보다 길게(끝까지) 밀었다 놓는다 → 오른쪽 끝 칸만 펼쳐져 멈춘다. 줄·데이터 그대로, 쓰기 없음, 묻는 창 없음.
    await swipeOpen(s.row, -(W + 40), ends.first());
    await page.waitForTimeout(900);
    await expect(s.row).toBeAttached();
    expect(writes, '왼쪽 끝까지 밀기만으로 서버 쓰기').toEqual([]);
    await expect(page.locator('.kptu-ask')).toHaveCount(0);
    await expect(page.locator('#kptuNotice:not([hidden]) .kptu-notice-undo:visible, [data-undo-notice]:not([hidden]) [data-undo-action]:visible')).toHaveCount(0);

    // ② 열린 줄을 누르면 닫히기만 한다.
    await touchTap(s.row);
    await expect(ends).toHaveCount(0);
    expect(writes).toEqual([]);

    // ③ 오른쪽으로 끝까지 → 칸을 열어 두지 않고 바로 고르기(W3 S70-64: 오른쪽 밀기 = 여러 개 고르기). 고르기는 데이터 일이 아니라 서버 쓰기 없음.
    await tick(page);
    await swipeOpen(s.row, W + 40, s.picked);
    await expect(pickCell).toHaveCount(0);
    expect(writes).toEqual([]);
    // 선택 끝내기: S70-64b — 막대에 [✕]·[그만]이 없다. 어느 화면이든 Esc(폰은 뒤로가기)로 고르기만 끝(창·화면은 그대로).
    await page.keyboard.press('Escape');
    await expect(s.picked).toBeHidden();

    // ④ 왼쪽 칸 하나를 누르면 그때 그 일을 한다(그 목록의 기존 길).
    await tick(page);
    const cell = s.list.locator(`[data-row-swipe-key="${s.act.key}"]`);
    await swipeOpen(s.row, -(W + 40), cell);
    expect(writes).toEqual([]);
    await touchTap(cell);
    await s.act.done();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
