import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// S58-4 BIZ-보고할일정 PR B: 일정 줄 앞 ✓(보고 씀)·□(보고할 일정) 표시 부품(app/report-plan-mark.js)을 가짜 화면·가짜 서버로 본다(가짜 데이터만).
// 보는 것: 읽기 전·표가 없는 서버 = 표시 없음(지금 그대로), 4-1 표시(보고 씀 → 보고할 일정 → 없음, '보고할까요?'는 여기서 그리지 않음),
// 표시 마디 모양(글자 없음·읽기 이름), 누름이 줄의 누름보다 먼저 받는 자리(문서 capture), □ 누름 = [결과 남기기]와 같은 길, 저장·기기 저장 없음.
const winListeners = new Map(), docListeners = [];
const win = {
  addEventListener: (type, fn) => { winListeners.set(type, [...(winListeners.get(type) || []), fn]); },
  dispatchEvent: event => { for (const fn of winListeners.get(event.type) || []) fn(event); return true; }
};
const element = () => {
  const attrs = new Map();
  return {className: '', dataset: {}, title: '', textContent: '', setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: k => attrs.get(k) ?? null, closest: () => null};
};
const doc = {
  addEventListener: (type, fn, capture) => docListeners.push({type, fn, capture}),
  createElement: () => element(),
  querySelector: () => null
};
globalThis.window = win;
globalThis.document = doc;
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(type) { this.type = type; } };

const {loadReportPlans, REPORT_PLANS_CHANGED} = await import('../app/report-plan-data.js');
const {planMarkOf, planMarkEl, planMarkSuffix, MARK_LABEL, REPORT_MARKS_CHANGED} = await import('../app/report-plan-mark.js');

const httpError = (status, message) => Object.assign(new Error(message), {status, code: 'http_' + status});
function fakeServer({plans = [], reports = [], missing = false, user = 'user-1'} = {}) {
  const state = {calls: [], epoch: 1};
  const api = async (path, opts = {}) => {
    const url = new URL('https://server.test' + path), method = opts.method || 'GET';
    state.calls.push({method, path});
    if (url.pathname === '/rest/v1/app_meetings') { if (missing) throw httpError(400, 'column app_meetings.google_event_id does not exist'); return reports.map(r => ({...r})); }
    if (url.pathname === '/rest/v1/app_calendar_report_plans') { if (missing) throw httpError(404, "Could not find the table 'public.app_calendar_report_plans' in the schema cache"); return plans.map(p => ({...p})); }
    throw httpError(404, 'unexpected ' + path);
  };
  const rt = {api, session: {epoch: () => state.epoch}, context: {read: () => ({user: {id: user}, workspace: {id: 'ws-1'}})}};
  win.KPTURuntime = rt;
  return {state, rt};
}
const ev = (id, title, extra = {}) => ({id, calendarId: 'cal-a', title, start: '2026-11-11T01:00:00.000Z', end: '2026-11-11T02:00:00.000Z', allDay: false, organizationIds: [], ...extra});
const row = (id, eventId, state, title, by = 'user') => ({id, google_event_id: eventId, google_calendar_id: 'cal-a', state, decided_by: by, decided_at: '2026-11-09T00:00:00.000Z', title, event_day: '2026-11-11', starts_at: '2026-11-11T01:00:00.000Z'});
const report = (id, eventId, title, at) => ({id, title, series_name: title, meeting_at: at, created_at: at, google_event_id: eventId, google_calendar_id: 'cal-a'});
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('읽기 전에는 표시 없음 — 한 번 읽기를 부탁하고, 다 읽으면 달력 주인에게 다시 그려 달라고 한다', async () => {
  const {state} = fakeServer({plans: [row('p1', 'e1', 'on', '시험 회의')], user: 'user-first'});
  let renders = 0, marksChanged = 0; win.__KPTU_RENDER_CALENDAR__ = () => { renders++; }; win.addEventListener(REPORT_MARKS_CHANGED, () => { marksChanged++; });
  assert.equal(planMarkOf(ev('e1', '시험 회의')), null);
  assert.equal(planMarkOf(ev('e1', '시험 회의')), null); // 같은 그리기 안에서 여러 줄이 물어도 읽기는 한 번
  await settle(); await settle();
  assert.equal(state.calls.filter(c => c.path.includes('app_calendar_report_plans')).length, 1);
  assert.equal(renders, 1);
  assert.equal(marksChanged, 1);
  // 같은 값을 다시 알려도(표시가 그대로면) 다시 그리지 않는다
  win.dispatchEvent(new CustomEvent(REPORT_PLANS_CHANGED));
  assert.equal(renders, 1);
  assert.deepEqual(planMarkOf(ev('e1', '시험 회의')), {status: 'todo', label: '보고할 일정', eventId: 'e1', calendarId: 'cal-a', reportId: ''});
  assert.equal(state.calls.filter(c => c.method !== 'GET').length, 0); // 그리기는 아무것도 저장하지 않는다
});

test('4-1 표시: 이어진 보고 = ✓(가장 나중 보고), 결정 줄 on·같은 이름 기억 = □, 끔·빼기·그냥 일정 = 없음', async () => {
  const {rt} = fakeServer({user: 'user-rule',
    plans: [row('p1', 'on1', 'on', '분기 모임'), row('p2', 'off1', 'off', '자료 정리'), row('p3', 'skip1', 'skip', '주간 조회')],
    reports: [report('r-old', 'done1', '시험 회의', '2026-11-01T01:00:00.000Z'), report('r-new', 'done1', '시험 회의', '2026-11-05T01:00:00.000Z')]});
  await loadReportPlans({}, rt);
  assert.deepEqual(planMarkOf(ev('done1', '시험 회의')), {status: 'done', label: '보고 씀', eventId: 'done1', calendarId: 'cal-a', reportId: 'r-new'});
  assert.equal(planMarkOf(ev('on1', '분기 모임')).status, 'todo');
  // 같은 이름 기억: 그 이름으로 일정에 이어 쓴 보고가 있다 → 다음 회차는 줄이 없어도 □
  assert.equal(planMarkOf(ev('next1', '시험  회의')).status, 'todo');
  assert.equal(planMarkOf(ev('off1', '자료 정리')), null);
  assert.equal(planMarkOf(ev('skip1', '주간 조회')), null);
  assert.equal(planMarkOf(ev('skip2', '주간 조회')), null); // 빼기는 그 이름 전체
  assert.equal(planMarkOf(ev('plain1', '점심 약속')), null);
  // '보고할까요?'(담당조직이 연결된 일정, 점선 □)는 사업 보고 달력에서만 — 일정 달력·홈에서는 표시 없음
  assert.equal(planMarkOf(ev('org1', '조직 방문', {organizationIds: ['org-a']})), null);
  // 캘린더 id가 없으면 primary, 종일 일정도 같은 규칙
  assert.equal(planMarkOf({id: 'on1', title: '분기 모임', start: '2026-11-11', allDay: true}).calendarId, 'primary');
  assert.equal(planMarkOf(null), null);
  assert.equal(planMarkOf({title: 'id 없음'}), null);
});

test('빈 표(그릴 표시가 없음): 읽어도 아무도 다시 그리지 않는다 — 쓰지 않는 화면은 예전 그리는 순서 그대로', async () => {
  const {rt} = fakeServer({user: 'user-empty-a'});
  await loadReportPlans({}, rt); // 앞 시험의 값이 남지 않게 빈 값에서 시작
  let renders = 0, marksChanged = 0; win.__KPTU_RENDER_CALENDAR__ = () => { renders++; }; win.addEventListener(REPORT_MARKS_CHANGED, () => { marksChanged++; });
  const before = renders;
  fakeServer({user: 'user-empty-b'});
  assert.equal(planMarkOf(ev('e1', '시험 회의')), null);
  await settle(); await settle();
  assert.equal(renders, before);
  assert.equal(marksChanged, 0);
  assert.equal(planMarkOf(ev('e1', '시험 회의')), null);
});

test('읽기 실패(서버 오류): 그릴 때마다 다시 부르지 않는다', async () => {
  const {state, rt} = fakeServer({user: 'user-fail'});
  rt.api = async path => { state.calls.push({method: 'GET', path}); throw httpError(500, 'server error'); };
  assert.equal(planMarkOf(ev('e1', '시험 회의')), null);
  await settle(); await settle();
  const first = state.calls.length;
  assert.ok(first >= 1);
  for (let i = 0; i < 3; i++) { assert.equal(planMarkOf(ev('e1', '시험 회의')), null); await settle(); }
  assert.equal(state.calls.length, first);
  // 로그인이 바뀌면 다시 부탁할 수 있다
  win.dispatchEvent(new CustomEvent('kptu:session-changed'));
});

test('표·칸이 없는 서버(적용 전·되돌린 뒤): 표시 없음, 다시 그릴 때마다 서버를 다시 부르지 않는다', async () => {
  const {state} = fakeServer({missing: true, user: 'user-missing'});
  assert.equal(planMarkOf(ev('e1', '시험 회의')), null);
  await settle(); await settle();
  const first = state.calls.length;
  assert.equal(first, 2); // 줄 목록·이어진 보고 한 번씩
  assert.equal(planMarkOf(ev('e1', '시험 회의')), null);
  assert.equal(planMarkOf(ev('e2', '다른 회의')), null);
  await settle(); await settle();
  assert.equal(state.calls.length, first);
});

test('표시 마디: 글자 없이 모양만(제목 글자는 그대로), 읽기 이름·누를 때 쓸 값', () => {
  const done = planMarkEl({status: 'done', label: MARK_LABEL.done, eventId: 'e1', calendarId: 'cal-a', reportId: 'r1'}, doc);
  assert.equal(done.className, 'rp-mark rp-mark-done');
  assert.deepEqual(done.dataset, {reportMark: 'done', reportEvent: 'e1', reportCalendar: 'cal-a', reportId: 'r1'});
  assert.equal(done.textContent, '');
  assert.equal(done.getAttribute('role'), 'img');
  assert.equal(done.getAttribute('aria-label'), '보고 씀');
  const todo = planMarkEl({status: 'todo', label: MARK_LABEL.todo, eventId: 'e2', calendarId: 'primary', reportId: ''}, doc);
  assert.equal(todo.className, 'rp-mark rp-mark-todo');
  assert.deepEqual(todo.dataset, {reportMark: 'todo', reportEvent: 'e2', reportCalendar: 'primary'});
  assert.equal(todo.getAttribute('aria-label'), '보고할 일정');
  assert.equal(planMarkEl(null, doc), null);
  assert.equal(planMarkSuffix({label: '보고 씀'}), ', 보고 씀');
  assert.equal(planMarkSuffix(null), '');
});

test('누름: 줄의 누름보다 먼저 받는 자리(문서 capture) 하나, 표시가 아니면 그대로 지나간다, □ = [결과 남기기]와 같은 길', async () => {
  const clicks = docListeners.filter(l => l.type === 'click');
  assert.equal(clicks.length, 1);
  assert.equal(clicks[0].capture, true);
  const fire = target => { const e = {target, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }}; clicks[0].fn(e); return e; };
  // 표시가 아닌 곳
  const plain = fire({closest: () => null});
  assert.equal(plain.prevented, false); assert.equal(plain.stopped, false);
  // □: 달력의 일정 메뉴 [결과 남기기]가 부르는 KPTUCalendarEvents.act(id, 캘린더, 'report') 그대로
  const acts = [];
  win.KPTUViewLoader = {load: async () => {}};
  win.__KPTU_CALENDAR_PERSISTENCE_READY__ = Promise.resolve(true);
  win.KPTUCalendarEvents = {open() {}, act: async (...args) => { acts.push(args); }};
  const mark = {dataset: {reportMark: 'todo', reportEvent: 'e2', reportCalendar: 'cal-a'}, closest: sel => (sel === '[data-report-mark]' ? mark : null)};
  const hit = fire({closest: sel => (sel === '[data-report-mark]' ? mark : null)});
  assert.equal(hit.prevented, true); assert.equal(hit.stopped, true);
  for (let i = 0; i < 5; i++) await settle();
  assert.deepEqual(acts, [['e2', 'cal-a', 'report']]);
  // 폰 월 보기에서 옆으로 민 뒤 따라오는 누름은 달력이 막는다(같은 규칙) — 표시도 받지 않는다
  win.KPTUCalendarMonthView = {suppressClick: () => true};
  const inGrid = {dataset: mark.dataset, closest: sel => (sel === '[data-report-mark]' ? inGrid : sel === '#calendarGrid' ? {} : null)};
  const swiped = fire({closest: sel => (sel === '[data-report-mark]' ? inGrid : null)});
  assert.equal(swiped.prevented, false);
  for (let i = 0; i < 3; i++) await settle();
  assert.equal(acts.length, 1);
  delete win.KPTUCalendarMonthView;
});

test('원문: 규칙·읽는 길은 PR A 모듈 그대로, 저장·기기 저장·뒤에서 덧그리기 없음', () => {
  const src = readFileSync(new URL('../app/report-plan-mark.js', import.meta.url), 'utf8');
  assert.match(src, /from '\.\/report-plan-data\.js'/);
  assert.match(src, /from '\.\/report-plan-model\.mjs'/);
  // 서버를 직접 부르거나 쓰지 않는다(읽기는 report-plan-data.js 의 loadReportPlans 하나)
  assert.doesNotMatch(src, /\/rest\/v1\/|\.api\(|method:\s*'(POST|PATCH|DELETE)'|setEventPlan|dropEventPlan|syncEventCopy/);
  // 기기 저장 API 이름은 저장소 검사(browser-storage-audit)가 글자로 막으므로 조각으로 만든다.
  assert.doesNotMatch(src, new RegExp(['local', 'session'].map(x => x + 'Storage').concat('indexed' + 'DB', 'document\\.cookie').join('|')));
  // 한 화면 영역은 한 주인이 그린다: 늦게 덮어쓰기·지켜보다 덧그리기 없음
  assert.doesNotMatch(src, /MutationObserver|setTimeout|setInterval|requestAnimationFrame/);
  assert.match(readFileSync(new URL('../app/journal.js', import.meta.url), 'utf8'), /addEventListener\(REPORT_MARKS_CHANGED/);
  // 표시를 그리는 자리: 각 화면이 그 줄을 그리는 곳에서 함께 그린다
  for (const file of ['calendar-month-view.js', 'calendar-day-items.js', 'calendar-day-overflow.js', 'journal.js']) {
    const text = readFileSync(new URL('../app/' + file, import.meta.url), 'utf8');
    assert.match(text, /planMarkOf\(/, file);
    assert.match(text, /planMarkEl\(/, file);
  }
});
