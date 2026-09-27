import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

// Runs the real google-tasks handler (action=tasks / action=overview) against a mocked Supabase and a mocked Google Tasks API.
// The mock follows the list filters the handler relies on: showCompleted=false drops completed tasks,
// showHidden gates hidden tasks, completedMin keeps only tasks completed at or after it (pending tasks have
// no completion date, so they are dropped), dueMin/dueMax bound the due date, and maxResults/pageToken page through the list.
// Google does not document how dueMin/dueMax compare, so the mock can apply several readings (dueCompare) and the
// due-window tests must hold under all of them (묶음C-3: a task due on the last day was dropped in production).
// Regression for 묶음C-1 (pending tasks behind many completed ones), 묶음C-2 (due window, bounded parallel reads,
// combined status+tasks request, count-only timing log) and 묶음C-4 (overdue pending tasks are kept). No network calls.
const SOURCE = stripTypeScriptTypes(
  readFileSync(new URL('../../supabase/functions/google-tasks/index.ts', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, ''),
  { mode: 'strip' }
);

const NOW = Date.parse('2026-09-27T03:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = ms => new Date(ms).toISOString();

// Readings of dueMin/dueMax: exact timestamps (inclusive), bounds cut to their UTC date (inclusive or exclusive), and
// exclusive date bounds taken in Korean time (the account time zone). Each takes the due and the bound in ms.
const dayStart = ms => Math.floor(ms / DAY) * DAY;
const KST = 9 * 60 * 60 * 1000;
const DUE_COMPARE = {
  exact: { min: (d, b) => d >= b, max: (d, b) => d <= b },
  dateInclusive: { min: (d, b) => d >= dayStart(b), max: (d, b) => d <= dayStart(b) },
  dateExclusive: { min: (d, b) => d > dayStart(b), max: (d, b) => d < dayStart(b) },
  kstDateExclusive: { min: (d, b) => d > dayStart(b + KST), max: (d, b) => d < dayStart(b + KST) }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function harness(lists, { connection = 'ok', scope = 'openid https://www.googleapis.com/auth/tasks', delay = 0, now = NOW, dueCompare = 'exact' } = {}) {
  const calls = [], logs = [];
  let inFlight = 0, maxInFlight = 0, tokeninfo = 0;
  const admin = {
    auth: { getUser: async token => token === 'token-a' ? { data: { user: { id: 'user-a' } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } } },
    from: table => {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => {
          if (table !== 'app_google_calendar_connections') throw new Error('unexpected table ' + table);
          if (connection === 'none') return { data: null, error: null };
          return { data: { user_id: 'user-a', google_email: 'owner@example.test', access_token: 'google-a', refresh_token: 'r', token_expires_at: iso(now + DAY) }, error: null };
        }
      };
      return b;
    }
  };
  const fetchMock = async url => {
    const u = new URL(String(url));
    if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/tokeninfo') { tokeninfo++; return json({ scope }); }
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (u.pathname === '/tasks/v1/users/@me/lists') return json({ items: lists.map(l => ({ id: l.id, title: l.title })) });
      const m = u.pathname.match(/^\/tasks\/v1\/lists\/([^/]+)\/tasks$/);
      if (!m) throw new Error('unexpected fetch ' + url);
      const list = lists.find(l => l.id === decodeURIComponent(m[1]));
      const q = u.searchParams;
      calls.push({ list: list.id, showCompleted: q.get('showCompleted'), completedMin: q.get('completedMin'), dueMin: q.get('dueMin'), dueMax: q.get('dueMax'), pageToken: q.get('pageToken') });
      const completedMin = q.get('completedMin') ? Date.parse(q.get('completedMin')) : null;
      const dueMin = q.get('dueMin') ? Date.parse(q.get('dueMin')) : null, dueMax = q.get('dueMax') ? Date.parse(q.get('dueMax')) : null;
      const matching = list.tasks.filter(t => {
        if (q.get('showCompleted') === 'false' && t.status === 'completed') return false;
        if (t.hidden && q.get('showHidden') !== 'true') return false;
        if (completedMin !== null && !(t.completed && Date.parse(t.completed) >= completedMin)) return false;
        if ((dueMin !== null || dueMax !== null) && !t.due) return false;
        if (dueMin !== null && !DUE_COMPARE[dueCompare].min(Date.parse(t.due), dueMin)) return false;
        if (dueMax !== null && !DUE_COMPARE[dueCompare].max(Date.parse(t.due), dueMax)) return false;
        return true;
      });
      const start = Number(q.get('pageToken') || 0), size = Number(q.get('maxResults') || 20);
      const next = start + size < matching.length ? String(start + size) : undefined;
      return json({ items: matching.slice(start, start + size), ...(next ? { nextPageToken: next } : {}) });
    } finally { inFlight--; }
  };
  let handler = null;
  const Deno = {
    env: { get: key => ({ SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service' }[key]) },
    serve: fn => { handler = fn; }
  };
  class FakeDate extends Date {
    constructor(...a) { super(...(a.length ? a : [now])); }
    static now() { return now; }
  }
  const consoleMock = { log: (...a) => logs.push(a.join(' ')), error: () => {}, warn: () => {} };
  new Function('Deno', 'createClient', 'fetch', 'Date', 'console', SOURCE)(Deno, () => admin, fetchMock, FakeDate, consoleMock);
  return { handler, calls, logs, get maxInFlight() { return maxInFlight; }, get tokeninfo() { return tokeninfo; } };
}

async function call(h, action = 'tasks') {
  const response = await h.handler(new Request('https://sb.example/functions/v1/google-tasks?action=' + action, { headers: { Authorization: 'Bearer token-a' } }));
  return { status: response.status, body: await response.json() };
}
const listTasks = h => call(h, 'tasks');

// Google keeps a due date as midnight UTC of the date. NOW is 2026-09-27 12:00 in Korea.
const dueDay = offsetDays => iso(Date.parse('2026-09-27T00:00:00.000Z') + offsetDays * DAY);
const pending = (id, dueOffsetDays = 1) => ({ id, title: id, status: 'needsAction', due: dueDay(dueOffsetDays) });
const done = (id, completedAgoDays, extra = {}) => ({ id, title: id, status: 'completed', completed: iso(NOW - completedAgoDays * DAY), due: dueDay(0), ...extra });

test('tasks: pending tasks behind many completed tasks are returned; completed stay limited to the last 3 days', async () => {
  // Completed tasks come first in list order and span several 100-item pages, then the pending ones.
  const tasks = [
    ...Array.from({ length: 230 }, (_, i) => done(`old-${i}`, 10, { hidden: i % 2 === 0 })),
    ...Array.from({ length: 120 }, (_, i) => done(`recent-${i}`, 1, { hidden: i % 3 === 0 })),
    ...Array.from({ length: 5 }, (_, i) => pending(`pending-${i}`, i))
  ];
  const h = harness([{ id: 'default', title: '내 할 일', tasks }]);
  const { status, body } = await listTasks(h);
  assert.equal(status, 200);
  const ids = body.tasks.map(t => t.id);
  assert.equal(ids.filter(id => id.startsWith('pending-')).length, 5, 'every pending task is returned');
  assert.equal(ids.filter(id => id.startsWith('recent-')).length, 120, 'recent completed tasks across pages, hidden included');
  assert.equal(ids.filter(id => id.startsWith('old-')).length, 0, 'completed tasks older than 3 days are excluded');
  assert.equal(new Set(ids).size, ids.length, 'no duplicates');
  assert.ok(body.tasks.slice(0, 5).every(t => t.status === 'needsAction'), 'pending tasks sort first');
  const completedCalls = h.calls.filter(c => c.completedMin);
  assert.ok(completedCalls.length >= 2, 'completed query follows nextPageToken');
  assert.ok(completedCalls.every(c => c.showCompleted === 'true'));
  assert.ok(h.calls.filter(c => !c.completedMin).every(c => c.showCompleted === 'false'), 'pending query has no completion-date filter');
});

test('tasks: pending tasks spanning more than one page are all returned', async () => {
  const tasks = [...Array.from({ length: 150 }, (_, i) => pending(`p-${i}`, i % 7)), done('d-1', 0.5)];
  const h = harness([{ id: 'default', title: '내 할 일', tasks }]);
  const { body } = await listTasks(h);
  assert.equal(body.tasks.filter(t => t.status === 'needsAction').length, 150);
  assert.equal(body.tasks.filter(t => t.status === 'completed').length, 1);
  assert.equal(h.calls.filter(c => !c.completedMin).length, 2, 'pending query read two pages');
});

test('tasks: every task list is still read and tagged with its list', async () => {
  const h = harness([
    { id: 'default', title: '내 할 일', tasks: [pending('a-1'), done('a-2', 1)] },
    { id: 'other', title: '다른 목록', tasks: [pending('b-1')] }
  ]);
  const { body } = await listTasks(h);
  assert.deepEqual(body.tasks.map(t => [t.id, t.taskListId]).sort(), [['a-1', 'default'], ['a-2', 'default'], ['b-1', 'other']]);
  assert.equal(body.needs_reconnect, false);
});

test('tasks: pending query has no lower due bound and ends one day past the Korean-time last day; undated and later tasks are dropped', async () => {
  const tasks = [pending('today', 0), pending('last', 6), pending('late', 7), pending('overdue', -1), pending('overdue-30', -30), { id: 'undated', title: 'undated', status: 'needsAction' }];
  const h = harness([{ id: 'default', title: '내 할 일', tasks }]);
  const { body } = await listTasks(h);
  assert.deepEqual(body.tasks.map(t => t.id), ['overdue-30', 'overdue', 'today', 'last'], 'overdue first, oldest due first');
  const pendingCall = h.calls.find(c => c.showCompleted === 'false');
  assert.equal(pendingCall.dueMin, null, 'overdue tasks are requested');
  assert.equal(pendingCall.dueMax, '2026-10-05T00:00:00.000Z', 'one day wider than the last day');
  assert.ok(h.calls.filter(c => c.completedMin).every(c => c.dueMin === null && c.dueMax === null), 'recent completed query keeps its 3-day rule only');
});

test('tasks: the due window follows the Korean date, not the UTC date', async () => {
  // 2026-09-27 16:30 UTC is already 2026-09-28 01:30 in Korea.
  // 10-04 is +6 days in Korea (kept); 10-05 is +7 days in Korea (dropped).
  const h = harness([{ id: 'default', title: '내 할 일', tasks: [pending('sep27', 0), pending('sep28', 1), pending('oct04', 7), pending('oct05', 8)] }], { now: Date.parse('2026-09-27T16:30:00.000Z') });
  const { body } = await listTasks(h);
  assert.deepEqual(body.tasks.map(t => t.id), ['sep27', 'sep28', 'oct04'], '09-27 is overdue in Korea and still returned');
  const pendingCall = h.calls.find(c => c.showCompleted === 'false');
  assert.equal(pendingCall.dueMin, null);
  assert.equal(pendingCall.dueMax, '2026-10-06T00:00:00.000Z');
  assert.equal(JSON.parse(h.logs[0]).overdue, 1);
});

for (const dueCompare of Object.keys(DUE_COMPARE)) {
  test(`tasks: overdue days and the 7-day window up to the last day are kept; later days are dropped (Google comparison: ${dueCompare})`, async () => {
    // Today in Korea is 2026-09-27; overdue tasks and 09-27..10-03 (last day included) are kept.
    const tasks = [-30, -2, -1, 0, 1, 5, 6, 7, 8].map(d => pending('d' + d, d));
    const h = harness([{ id: 'default', title: '내 할 일', tasks }], { dueCompare });
    const { body } = await listTasks(h);
    assert.deepEqual(body.tasks.map(t => t.id), ['d-30', 'd-2', 'd-1', 'd0', 'd1', 'd5', 'd6']);
    assert.equal(JSON.parse(h.logs[0]).overdue, 3);
    assert.equal(body.tasks.at(-1).due, '2026-10-03T00:00:00.000Z', 'the last day (10-03) is returned');
  });

  test(`tasks: due window moves at Korean midnight (Google comparison: ${dueCompare})`, async () => {
    const tasks = [-1, 0, 6, 7].map(d => pending('d' + d, d));
    // 09-27 23:59:59 in Korea: overdue up to 09-26, window 09-27..10-03.
    const beforeH = harness([{ id: 'default', title: '내 할 일', tasks }], { dueCompare, now: Date.parse('2026-09-27T14:59:59.000Z') });
    const before = await listTasks(beforeH);
    assert.deepEqual(before.body.tasks.map(t => t.id), ['d-1', 'd0', 'd6']);
    assert.equal(JSON.parse(beforeH.logs[0]).overdue, 1);
    // 09-28 00:00 in Korea: 09-27 becomes overdue, window 09-28..10-04.
    const afterH = harness([{ id: 'default', title: '내 할 일', tasks }], { dueCompare, now: Date.parse('2026-09-27T15:00:00.000Z') });
    const after = await listTasks(afterH);
    assert.deepEqual(after.body.tasks.map(t => t.id), ['d-1', 'd0', 'd6', 'd7']);
    assert.equal(JSON.parse(afterH.logs[0]).overdue, 2);
  });
}

test('tasks: list reads run in parallel with at most 4 Google requests in flight', async () => {
  const lists = Array.from({ length: 5 }, (_, i) => ({ id: 'l' + i, title: 'list ' + i, tasks: [pending('p' + i, 1), done('d' + i, 1)] }));
  const h = harness(lists, { delay: 20 });
  const { body } = await listTasks(h);
  assert.equal(body.tasks.length, 10);
  assert.equal(h.calls.length, 10, 'one pending and one completed read per list');
  assert.ok(h.maxInFlight > 1, 'reads overlap');
  assert.ok(h.maxInFlight <= 4, 'bounded parallelism');
  assert.deepEqual(body.tasks.slice(0, 5).map(t => t.status), Array(5).fill('needsAction'));
});

test('overview: one request returns connection state and tasks; timing log has counts only', async () => {
  const h = harness([{ id: 'default', title: '내 할 일', tasks: [pending('secret-title-1', 1), done('secret-title-2', 1, { notes: 'secret-note' })] }]);
  const { status, body } = await call(h, 'overview');
  assert.equal(status, 200);
  assert.equal(body.connected, true);
  assert.equal(body.authorized, true);
  assert.equal(body.needs_reconnect, false);
  assert.deepEqual(body.tasks.map(t => t.id), ['secret-title-1', 'secret-title-2']);
  assert.equal(h.tokeninfo, 1);
  assert.equal(h.logs.length, 1);
  const log = JSON.parse(h.logs[0]);
  assert.deepEqual(Object.keys(log).sort(), ['action', 'fn', 'google_requests', 'lists', 'ms', 'overdue']);
  assert.equal(log.overdue, 0);
  assert.equal(log.action, 'overview');
  assert.equal(log.lists, 1);
  assert.equal(log.google_requests, 4, 'lists + pending + completed + tokeninfo');
  assert.doesNotMatch(h.logs[0], /secret|google-a|token-a|example\.test/);
});

test('overview: not connected and missing Tasks write scope return the same states action=status did', async () => {
  const none = await call(harness([], { connection: 'none' }), 'overview');
  assert.equal(none.status, 200);
  assert.deepEqual(none.body, { connected: false, authorized: false, needs_reconnect: false, tasks: [] });
  const readonly = await call(harness([{ id: 'default', title: '내 할 일', tasks: [pending('a', 1)] }], { scope: 'openid https://www.googleapis.com/auth/tasks.readonly' }), 'overview');
  assert.equal(readonly.body.connected, true);
  assert.equal(readonly.body.authorized, false);
  assert.equal(readonly.body.needs_reconnect, true);
  assert.deepEqual(readonly.body.tasks, []);
});

test('overview: an unauthenticated request is rejected without reaching Google', async () => {
  const h = harness([{ id: 'default', title: '내 할 일', tasks: [pending('a', 1)] }]);
  const response = await h.handler(new Request('https://sb.example/functions/v1/google-tasks?action=overview'));
  assert.equal(response.status, 400);
  assert.equal(h.calls.length + h.tokeninfo, 0);
});

test('status and tasks actions stay available for older app versions', async () => {
  const h = harness([{ id: 'default', title: '내 할 일', tasks: [pending('a', 1)] }]);
  const status = await call(h, 'status');
  assert.equal(status.body.authorized, true);
  const tasks = await call(h, 'tasks');
  assert.deepEqual(tasks.body.tasks.map(t => t.id), ['a']);
});
