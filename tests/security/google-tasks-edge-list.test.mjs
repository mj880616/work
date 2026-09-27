import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

// Runs the real google-tasks handler (action=tasks) against a mocked Supabase and a mocked Google Tasks API.
// The mock follows the list filters the handler relies on: showCompleted=false drops completed tasks,
// showHidden gates hidden tasks, completedMin keeps only tasks completed at or after it (pending tasks have
// no completion date, so they are dropped), and maxResults/pageToken page through the list.
// Regression for 묶음C-1: with many completed tasks, pending tasks must still be returned. No network calls.
const SOURCE = stripTypeScriptTypes(
  readFileSync(new URL('../../supabase/functions/google-tasks/index.ts', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, ''),
  { mode: 'strip' }
);

const NOW = Date.parse('2026-09-27T03:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = ms => new Date(ms).toISOString();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function harness(lists) {
  const calls = [];
  const admin = {
    auth: { getUser: async token => token === 'token-a' ? { data: { user: { id: 'user-a' } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } } },
    from: table => {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => {
          if (table !== 'app_google_calendar_connections') throw new Error('unexpected table ' + table);
          return { data: { user_id: 'user-a', access_token: 'google-a', refresh_token: 'r', token_expires_at: iso(NOW + DAY) }, error: null };
        }
      };
      return b;
    }
  };
  const fetchMock = async url => {
    const u = new URL(String(url));
    if (u.pathname === '/tasks/v1/users/@me/lists') return json({ items: lists.map(l => ({ id: l.id, title: l.title })) });
    const m = u.pathname.match(/^\/tasks\/v1\/lists\/([^/]+)\/tasks$/);
    if (!m) throw new Error('unexpected fetch ' + url);
    const list = lists.find(l => l.id === decodeURIComponent(m[1]));
    const q = u.searchParams;
    calls.push({ list: list.id, showCompleted: q.get('showCompleted'), completedMin: q.get('completedMin'), pageToken: q.get('pageToken') });
    const completedMin = q.get('completedMin') ? Date.parse(q.get('completedMin')) : null;
    const matching = list.tasks.filter(t => {
      if (q.get('showCompleted') === 'false' && t.status === 'completed') return false;
      if (t.hidden && q.get('showHidden') !== 'true') return false;
      if (completedMin !== null && !(t.completed && Date.parse(t.completed) >= completedMin)) return false;
      return true;
    });
    const start = Number(q.get('pageToken') || 0), size = Number(q.get('maxResults') || 20);
    const next = start + size < matching.length ? String(start + size) : undefined;
    return json({ items: matching.slice(start, start + size), ...(next ? { nextPageToken: next } : {}) });
  };
  let handler = null;
  const Deno = {
    env: { get: key => ({ SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service' }[key]) },
    serve: fn => { handler = fn; }
  };
  class FakeDate extends Date {
    constructor(...a) { super(...(a.length ? a : [NOW])); }
    static now() { return NOW; }
  }
  new Function('Deno', 'createClient', 'fetch', 'Date', SOURCE)(Deno, () => admin, fetchMock, FakeDate);
  return { handler, calls };
}

async function listTasks(h) {
  const response = await h.handler(new Request('https://sb.example/functions/v1/google-tasks?action=tasks', { headers: { Authorization: 'Bearer token-a' } }));
  return { status: response.status, body: await response.json() };
}

const pending = (id, dueOffsetDays = 1) => ({ id, title: id, status: 'needsAction', due: iso(NOW + dueOffsetDays * DAY) });
const done = (id, completedAgoDays, extra = {}) => ({ id, title: id, status: 'completed', completed: iso(NOW - completedAgoDays * DAY), due: iso(NOW), ...extra });

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
