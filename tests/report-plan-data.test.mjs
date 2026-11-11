import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// S57-20 BIZ-보고할일정 PR A: 읽고 쓰는 길(app/report-plan-data.js)을 가짜 서버로 본다(가짜 데이터만).
// 보는 것: 표·칸이 없는 서버 = 표시 없음, 넣기·고치기 길(4-3), 동시에 넣어 하나뿐 검사에 걸리면 다시 읽고 고치기, 고칠 수 없는 칸을 보내지 않기, 기기 저장 없음.
const listeners = new Map();
const win = {
  addEventListener: (type, fn) => { listeners.set(type, [...(listeners.get(type) || []), fn]); },
  dispatchEvent: event => { for (const fn of listeners.get(event.type) || []) fn(event); return true; }
};
globalThis.window = win;
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(type) { this.type = type; } };

const mod = await import('../app/report-plan-data.js');
const {loadReportPlans, reportPlanData, eventPlan, eventPlanById, setEventPlan, setEventPlanState, addRulePlans, syncEventCopies, syncEventCopy, dropEventPlan, reportLinkBody, REPORT_PLANS_CHANGED} = mod;

const httpError = (status, message) => Object.assign(new Error(message), {status, code: 'http_' + status});
// 가짜 서버: 줄 목록(plans)·일정에 이어진 보고(reports). plansMissing·linkMissing = 적용 전 서버.
function fakeServer({plans = [], reports = [], plansMissing = false, linkMissing = false, user = 'user-1', workspace = 'ws-1'} = {}) {
  const state = {plans: plans.map(p => ({...p})), reports, calls: [], epoch: 1, conflictOnce: false, seq: 0};
  const api = async (path, opts = {}) => {
    const url = new URL('https://server.test' + path), method = opts.method || 'GET';
    state.calls.push({method, path, body: opts.body ?? null, prefer: opts.prefer || ''});
    const eq = name => { const v = url.searchParams.get(name); return v && v.startsWith('eq.') ? v.slice(3) : null; };
    if (url.pathname === '/rest/v1/app_meetings') {
      if (linkMissing) throw httpError(400, 'column app_meetings.google_event_id does not exist');
      return state.reports.map(r => ({...r}));
    }
    if (url.pathname !== '/rest/v1/app_calendar_report_plans') throw httpError(404, 'unexpected ' + path);
    if (plansMissing) throw httpError(404, "Could not find the table 'public.app_calendar_report_plans' in the schema cache");
    if (method === 'GET') {
      const eventId = eq('google_event_id');
      return state.plans.filter(p => !eventId || p.google_event_id === eventId).map(p => ({...p}));
    }
    if (method === 'POST') {
      if (state.conflictOnce) {
        state.conflictOnce = false;
        state.plans.push({id: 'other-device', google_event_id: opts.body.google_event_id, google_calendar_id: opts.body.google_calendar_id, state: 'off', decided_by: 'user', decided_at: '2026-11-10T00:00:00.000Z', title: opts.body.title, event_day: opts.body.event_day, starts_at: opts.body.starts_at});
        throw httpError(409, 'duplicate key value violates unique constraint "app_calendar_report_plans_event_key"');
      }
      const row = {id: 'row-' + (++state.seq), ...opts.body};
      delete row.workspace_id;
      state.plans.push(row);
      return [{...row}];
    }
    if (method === 'PATCH') {
      const row = state.plans.find(p => p.id === eq('id'));
      if (!row) return [];
      Object.assign(row, opts.body);
      return [{...row}];
    }
    if (method === 'DELETE') {
      // 일정 하나의 줄 삭제(google_event_id) 또는 줄 여럿 삭제(id=in.(…), S58-10 [빼기]) — 같이 온 조건(decided_by·state)이 맞는 줄만 삭제한다.
      const one = eq('google_event_id'), many = (url.searchParams.get('id') || '').match(/^in\.\((.*)\)$/)?.[1]?.split(',').map(decodeURIComponent) || null;
      if (!one && !many) throw httpError(400, 'delete without a row filter');
      const by = eq('decided_by'), st = eq('state');
      state.plans = state.plans.filter(p => !((one ? p.google_event_id === one : many.includes(p.id)) && (!by || p.decided_by === by) && (!st || p.state === st)));
      return [];
    }
    throw httpError(405, 'method');
  };
  const rt = {api, session: {epoch: () => state.epoch}, context: {read: () => ({user: {id: user}, workspace: {id: workspace}})}};
  return {state, rt};
}
const ev = (id, title, extra = {}) => ({id, calendarId: 'cal-a', title, start: '2026-11-11T01:00:00.000Z', end: '2026-11-11T02:00:00.000Z', allDay: false, organizationIds: [], ...extra});
const writes = state => state.calls.filter(c => c.method !== 'GET');

test('표가 없는 서버(적용 전·되돌린 뒤): 표시 없음, 켜기는 거절, 보고 연결 칸도 보내지 않는다', async () => {
  const {state, rt} = fakeServer({plansMissing: true, linkMissing: true, user: 'user-missing'});
  const loaded = await loadReportPlans({}, rt);
  assert.equal(loaded.plans, null);
  assert.equal(reportPlanData(rt), null);
  assert.equal(eventPlan(ev('e1', '시험 회의'), rt), null);
  await assert.rejects(() => setEventPlan(ev('e1', '시험 회의'), true, rt), /아직 쓸 수 없어요/);
  assert.deepEqual(await reportLinkBody({id: 'e1', calendarId: 'cal-a'}, rt), {});
  assert.equal(writes(state).length, 0);
});

test('켜기 = 줄 넣기(작업공간은 넣을 자리만 가리킨다), 끄기 = 그 줄 고치기, 다시 읽어도 유지', async () => {
  const {state, rt} = fakeServer({user: 'user-toggle'});
  let changed = 0; win.addEventListener(REPORT_PLANS_CHANGED, () => { changed++; });
  await loadReportPlans({}, rt);
  assert.deepEqual(eventPlan(ev('e1', '시험 회의'), rt), {on: false, status: '', row: null});
  const on = await setEventPlan(ev('e1', '시험 회의'), true, rt);
  assert.equal(on.on, true);
  const post = writes(state)[0];
  assert.equal(post.method, 'POST');
  assert.equal(post.body.workspace_id, 'ws-1');
  assert.deepEqual([post.body.state, post.body.decided_by, post.body.google_event_id, post.body.title, post.body.event_day], ['on', 'user', 'e1', '시험 회의', '2026-11-11']);
  assert.ok(!('id' in post.body) && !('created_at' in post.body));
  assert.equal(eventPlan(ev('e1', '시험 회의'), rt).on, true);
  assert.equal(eventPlan(ev('e1', '시험 회의'), rt).status, 'todo');
  // 같은 이름의 다른 일정은 기억으로 켜져 보인다(줄은 아직 없음).
  assert.deepEqual(eventPlan(ev('e2', '시험 회의'), rt), {on: true, status: 'todo', row: null});
  const off = await setEventPlan(ev('e1', '시험 회의'), false, rt);
  assert.equal(off.on, false);
  const patch = writes(state)[1];
  assert.equal(patch.method, 'PATCH');
  assert.match(patch.path, /[?&]id=eq\.row-1(&|$)/);
  assert.deepEqual(Object.keys(patch.body).sort(), ['decided_at', 'decided_by', 'state']);
  assert.deepEqual([patch.body.state, patch.body.decided_by], ['off', 'user']);
  // 끔은 그 일정 하나만: e1은 꺼지고, 사람이 켠 기억이 없어졌으므로 e2도 기억이 없다.
  assert.equal(eventPlan(ev('e1', '시험 회의'), rt).on, false);
  assert.ok(changed >= 3);
  const again = await loadReportPlans({force: true}, rt);
  assert.equal(again.plans.length, 1);
  assert.equal(eventPlan(ev('e1', '시험 회의'), rt).on, false);
  assert.equal(eventPlanById('e1', rt).on, false);
  assert.equal(eventPlanById('none', rt), null);
});

test('다른 기기가 먼저 넣어 하나뿐 검사에 걸리면 다시 읽고 고친다(한 번에 넣기·고치기는 쓰지 않는다)', async () => {
  const {state, rt} = fakeServer({user: 'user-conflict'});
  await loadReportPlans({}, rt);
  state.conflictOnce = true;
  const saved = await setEventPlan(ev('e9', '겹친 일정'), true, rt);
  assert.equal(saved.on, true);
  assert.equal(saved.row.id, 'other-device');
  assert.deepEqual(writes(state).map(c => c.method), ['POST', 'PATCH']);
  assert.ok(state.calls.every(c => !/merge-duplicates/.test(c.prefer) && !/on_conflict/.test(c.path)));
  assert.equal(state.plans.filter(p => p.google_event_id === 'e9').length, 1);
});

test('저절로 켜진 줄(rule)을 끌 때 decided_by=user를 같이 보내고, 줄이 사라졌으면 다시 넣는다', async () => {
  const rule = {id: 'r1', google_event_id: 'e1', google_calendar_id: 'cal-a', state: 'on', decided_by: 'rule', decided_at: '2026-11-01T00:00:00.000Z', title: '시험 회의', event_day: '2026-11-11', starts_at: '2026-11-11T01:00:00.000Z'};
  const {state, rt} = fakeServer({plans: [rule], user: 'user-rule'});
  await loadReportPlans({}, rt);
  assert.equal(eventPlan(ev('e1', '시험 회의'), rt).on, true);
  await setEventPlan(ev('e1', '시험 회의'), false, rt);
  assert.deepEqual([writes(state)[0].body.state, writes(state)[0].body.decided_by], ['off', 'user']);
  state.plans.length = 0; // 다른 기기에서 줄이 삭제됨
  const saved = await setEventPlan(ev('e1', '시험 회의'), true, rt);
  assert.equal(saved.on, true);
  assert.deepEqual(writes(state).map(c => c.method), ['PATCH', 'PATCH', 'POST']);
});

test('사본 맞추기는 다른 칸만 고치고, 일정 삭제 때 그 줄만 삭제한다(보고는 건드리지 않는다)', async () => {
  const row = {id: 'r1', google_event_id: 'e1', google_calendar_id: 'cal-a', state: 'on', decided_by: 'user', decided_at: '2026-11-01T00:00:00.000Z', title: '옛 제목', event_day: '2026-11-11', starts_at: '2026-11-11T01:00:00.000Z'};
  const {state, rt} = fakeServer({plans: [row], reports: [{id: 'm1', google_event_id: 'e1', google_calendar_id: 'cal-a', series_name: '옛 제목', title: '옛 제목', meeting_at: '2026-11-11T01:00:00.000Z', created_at: '2026-11-11T03:00:00.000Z'}], user: 'user-copy'});
  await loadReportPlans({}, rt);
  assert.equal(eventPlan(ev('e1', '옛 제목'), rt).status, 'done');
  assert.equal(await syncEventCopy(ev('e1', '옛 제목'), rt), false);
  assert.equal(await syncEventCopy(ev('e1', '새 제목'), rt), true);
  assert.deepEqual(writes(state)[0].body, {title: '새 제목'});
  assert.equal(await syncEventCopy(ev('none', '새 제목'), rt), false);
  assert.deepEqual(await reportLinkBody({id: 'e1', calendarId: 'cal-a'}, rt), {google_calendar_id: 'cal-a', google_event_id: 'e1'});
  assert.deepEqual(await reportLinkBody({id: '나쁜 id', calendarId: 'cal-a'}, rt), {});
  assert.equal(await dropEventPlan('e1', rt), true);
  assert.equal(writes(state).at(-1).method, 'DELETE');
  assert.match(writes(state).at(-1).path, /^\/rest\/v1\/app_calendar_report_plans\?/);
  assert.equal(eventPlanById('e1', rt), null);
  assert.equal(await dropEventPlan('e1', rt), false);
  assert.ok(writes(state).every(c => c.path.startsWith('/rest/v1/app_calendar_report_plans')));
});

test('로그인 전에는 읽지 않고, 다른 계정의 값을 보여 주지 않는다', async () => {
  const a = fakeServer({user: 'user-a', plans: [{id: 'r1', google_event_id: 'e1', google_calendar_id: 'cal-a', state: 'on', decided_by: 'user', decided_at: '2026-11-01T00:00:00.000Z', title: '시험 회의', event_day: '2026-11-11', starts_at: null}]});
  await loadReportPlans({}, a.rt);
  assert.equal(eventPlanById('e1', a.rt).on, true);
  const b = fakeServer({user: 'user-b'});
  assert.equal(reportPlanData(b.rt), null);
  assert.equal(eventPlanById('e1', b.rt), null);
  const none = {api: async () => { throw new Error('must not be called'); }, session: {epoch: () => 1}, context: {read: () => null}};
  assert.equal(await loadReportPlans({}, none), null);
});

test('읽고 쓰는 길은 서버 저장만 쓴다(기기 저장·Google 호출 없음)', () => {
  const src = readFileSync(new URL('../app/report-plan-data.js', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  // 기기 저장 API 이름은 저장소 검사(browser-storage-audit)가 글자로 막으므로 조각으로 만든다(app/ 전체는 그 검사가 본다).
  assert.doesNotMatch(src, new RegExp(['local', 'session'].map(x => x + 'Storage').concat('indexed' + 'DB', 'document\\.cookie').join('|')));
  assert.doesNotMatch(src, /functions\/v1|google-calendar/);
  assert.doesNotMatch(src, /merge-duplicates|on_conflict/);
});

// ── S58-10 BIZ-보고할일정 PR C: [빼기](skip)·저절로 골라 주기(rule 줄 넣기)·읽은 일정 여럿의 사본 맞추기 ──
const pRow = (id, eventId, title, state, extra = {}) => ({id, google_event_id: eventId, google_calendar_id: 'cal-a', state, decided_by: 'user', decided_at: '2026-11-01T00:00:00.000Z', title, event_day: '2026-11-11', starts_at: '2026-11-11T01:00:00.000Z', ...extra});

test('[빼기]는 skip을 저장하고, 같은 이름의 저절로 켜진 줄(rule·보고 없음)만 같이 삭제한다', async () => {
  const plans = [
    pRow('r1', 'e1', '시험 정례 회의', 'on', {decided_by: 'rule'}),
    pRow('r2', 'e2', '시험 정례회의', 'on', {decided_by: 'rule'}),            // 같은 이름(띄어쓰기만 다름), 저절로 켜짐 → 삭제
    pRow('r3', 'e3', '시험 정례 회의', 'on', {decided_by: 'rule'}),            // 이 일정에는 보고를 이미 썼다 → 그대로
    pRow('u4', 'e4', '시험 정례 회의', 'on'),                                  // 사람이 켠 줄 → 그대로
    pRow('r5', 'e5', '다른 회의', 'on', {decided_by: 'rule'})                  // 다른 이름 → 그대로
  ];
  const reports = [{id: 'm3', google_event_id: 'e3', google_calendar_id: 'cal-a', series_name: '시험 정례 회의', title: '시험 정례 회의', meeting_at: '2026-11-04T01:00:00.000Z', created_at: '2026-11-04T02:00:00.000Z'}];
  const {state, rt} = fakeServer({plans, reports, user: 'user-skip'});
  await loadReportPlans({}, rt);
  let announced = 0; win.addEventListener(REPORT_PLANS_CHANGED, () => { announced++; });
  const saved = await setEventPlanState(ev('e1', '시험 정례 회의'), 'skip', rt);
  assert.deepEqual([saved.on, saved.state, saved.row.decided_by], [false, 'skip', 'user']);
  const done = writes(state);
  assert.deepEqual(done.map(c => c.method), ['PATCH', 'DELETE']);
  // 저절로 켜진 줄을 뺄 때도 decided_by=user를 같이 보낸다(rule 줄은 on만 되는 검사).
  assert.deepEqual([done[0].body.state, done[0].body.decided_by], ['skip', 'user']);
  // 삭제는 내 작업공간·저절로 켜진 줄·켜짐 그대로인 줄만(서버에서 다시 건다), 줄 id로 가리킨다.
  assert.match(done[1].path, /workspace_id=eq\.ws-1&decided_by=eq\.rule&state=eq\.on&id=in\.\(r2\)$/);
  assert.deepEqual(state.plans.map(p => [p.id, p.state]), [['r1', 'skip'], ['r3', 'on'], ['u4', 'on'], ['r5', 'on']]);
  assert.deepEqual(reportPlanData(rt).plans.map(p => p.id).sort(), ['r1', 'r3', 'r5', 'u4']);
  assert.equal(announced, 1, '저장과 정리를 마친 뒤 한 번만 알린다');
  // 같은 이름의 새 일정은 이제 표시도 물음도 없다(다시 묻지 않음).
  assert.deepEqual([eventPlan(ev('e9', '시험 정례 회의', {organizationIds: ['o1']}), rt).on, eventPlan(ev('e9', '시험 정례 회의', {organizationIds: ['o1']}), rt).status], [false, '']);
});

test('[빼기]: 줄이 없던 일정(보고할까요?)은 skip 줄을 넣고, 모르는 값은 거절한다', async () => {
  const {state, rt} = fakeServer({user: 'user-skip-new'});
  await loadReportPlans({}, rt);
  const saved = await setEventPlanState(ev('a1', '시험 기자회견', {organizationIds: ['o1']}), 'skip', rt);
  assert.equal(saved.state, 'skip');
  assert.deepEqual(writes(state).map(c => c.method), ['POST']);
  assert.deepEqual([writes(state)[0].body.state, writes(state)[0].body.decided_by, writes(state)[0].body.workspace_id], ['skip', 'user', 'ws-1']);
  await assert.rejects(setEventPlanState(ev('a2', '시험'), 'maybe', rt), /표시할 수 없어요/);
  assert.equal(writes(state).length, 1);
});

test('저절로 골라 주기: 같은 이름 기억이 켜진 일정만 rule 줄을 넣고, 이미 줄이 있거나 보고를 쓴 일정은 넣지 않는다', async () => {
  const plans = [pRow('u1', 'old', '시험 주간 회의', 'on', {event_day: '2026-11-04'}), pRow('x1', 'has-row', '시험 주간 회의', 'off')];
  const reports = [{id: 'm1', google_event_id: 'wrote', google_calendar_id: 'cal-a', series_name: '시험 주간 회의', title: '시험 주간 회의', meeting_at: '2026-11-05T01:00:00.000Z', created_at: '2026-11-05T02:00:00.000Z'}];
  const {state, rt} = fakeServer({plans, reports, user: 'user-rule-add'});
  await loadReportPlans({}, rt);
  const events = [
    ev('new1', '시험 주간 회의', {start: '2026-11-18T01:00:00.000Z'}),   // 기억 on → 넣는다
    ev('new1', '시험 주간 회의'),                                         // 같은 일정이 두 번 와도 한 번
    ev('has-row', '시험 주간 회의'),                                      // 줄이 있다(off) → 넣지 않는다
    ev('wrote', '시험 주간 회의'),                                        // 보고를 썼다 → 넣지 않는다
    ev('org', '다른 일정', {organizationIds: ['o1']}),                    // 기억 없음(보고할까요?) → 넣지 않는다
    ev('한글', '시험 주간 회의')                                          // 넣을 수 없는 id
  ];
  assert.equal(await addRulePlans(events, rt), 1);
  const posts = writes(state);
  assert.deepEqual(posts.map(c => [c.method, c.body.google_event_id, c.body.state, c.body.decided_by, c.body.event_day]), [['POST', 'new1', 'on', 'rule', '2026-11-18']]);
  assert.equal(eventPlan(ev('new1', '시험 주간 회의'), rt).row.decided_by, 'rule');
  // 다시 봐도 더 넣지 않는다.
  assert.equal(await addRulePlans(events, rt), 0);
  assert.equal(writes(state).length, 1);
  // 다른 기기가 먼저 넣었으면(하나뿐 검사) 그 줄을 읽어 두고 고치지 않는다.
  state.conflictOnce = true;
  assert.equal(await addRulePlans([ev('new2', '시험 주간 회의')], rt), 1);
  assert.deepEqual(writes(state).map(c => c.method), ['POST', 'POST']);
  assert.equal(reportPlanData(rt).plans.find(p => p.google_event_id === 'new2').id, 'other-device');
  // 표가 없는 서버·아직 안 읽은 계정이면 아무것도 하지 않는다.
  const none = fakeServer({plansMissing: true, user: 'user-rule-none'});
  await loadReportPlans({}, none.rt);
  assert.equal(await addRulePlans(events, none.rt), 0);
  assert.equal(writes(none.state).length, 0);
});

test('읽은 일정 여럿의 사본 맞추기: 줄이 있고 다른 칸이 있는 일정만 그 칸만 고친다', async () => {
  const plans = [pRow('s1', 'e1', '옛 제목', 'on'), pRow('s2', 'e2', '그대로', 'on')];
  const {state, rt} = fakeServer({plans, user: 'user-sync-many'});
  await loadReportPlans({}, rt);
  const fixed = await syncEventCopies([ev('e1', '새 제목', {start: '2026-11-12T01:00:00.000Z'}), ev('e2', '그대로'), ev('none', '줄 없는 일정')], rt);
  assert.equal(fixed, 1);
  const done = writes(state);
  assert.deepEqual(done.map(c => c.method), ['PATCH']);
  assert.deepEqual(done[0].body, {title: '새 제목', event_day: '2026-11-12', starts_at: '2026-11-12T01:00:00.000Z'});
  assert.equal(state.plans.find(p => p.id === 's1').decided_at, '2026-11-01T00:00:00.000Z', '결정한 때는 그대로');
});
