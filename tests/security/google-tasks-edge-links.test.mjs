import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

// Runs the real google-tasks handler for the task link actions (TASK-구현 PR 3, docs/web2-task-impl-plan.md 4.2·4.3)
// against a mocked Google Tasks API and a mocked Supabase. The caller-JWT client follows the app_record_links RLS policy
// (owner of the workspace; project and organization in the same workspace) and its unique constraint. The service-role
// client refuses app_record_links, so links can only be reached through RLS. No network calls.
const SOURCE = stripTypeScriptTypes(
  readFileSync(new URL('../../supabase/functions/google-tasks/index.ts', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, ''),
  { mode: 'strip' }
);

const NOW = Date.parse('2026-09-27T03:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = ms => new Date(ms).toISOString();
const P1 = '11111111-1111-4111-8111-111111111111', P2 = '22222222-2222-4222-8222-222222222222';
const O1 = '33333333-3333-4333-8333-333333333333', PX = '44444444-4444-4444-8444-444444444444', OX = '55555555-5555-4555-8555-555555555555';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function harness({ tasks = [], links = [], connection = 'ok', failLinkUpdate = false } = {}) {
  const google = new Map(tasks.map(t => [t.id, { ...t }]));
  const state = {
    spaces: [{ id: P1, workspace_id: 'ws-a' }, { id: P2, workspace_id: 'ws-a' }, { id: PX, workspace_id: 'ws-b' }],
    orgs: [{ id: O1, workspace_id: 'ws-a' }, { id: OX, workspace_id: 'ws-b' }],
    links: links.map((l, i) => ({ id: 'seed-' + i, workspace_id: 'ws-a', google_tasklist_id: '@default', note_id: null, project_id: null, organization_id: null, status: 'confirmed', report_kind: null, task_checked_at: null, ...l }))
  };
  const googleCalls = [], logs = [];
  let nextId = 1;
  const admin = {
    auth: { getUser: async token => token === 'token-a' ? { data: { user: { id: 'user-a' } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } } },
    from: table => {
      if (table !== 'app_google_calendar_connections') throw new Error('service role must not read ' + table);
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => connection === 'none'
          ? { data: null, error: null }
          : { data: { user_id: 'user-a', google_email: 'owner@example.test', access_token: 'google-a', refresh_token: 'r', token_expires_at: iso(NOW + DAY) }, error: null }
      };
      return b;
    }
  };

  // Caller-JWT client: rows are visible only in workspaces the caller owns (private.app_is_workspace_owner).
  const userDb = authorization => {
    const owned = new Set(authorization === 'Bearer token-a' ? ['ws-a'] : []);
    const rowsOf = table => ({ app_spaces: state.spaces, app_suborganizations: state.orgs, app_record_links: state.links }[table]);
    return {
      from: table => {
        if (!rowsOf(table)) throw new Error('unexpected user table ' + table);
        const q = { op: 'select', filters: [], single: false };
        const match = r => owned.has(r.workspace_id) && q.filters.every(f => f(r));
        const run = () => {
          const rows = rowsOf(table);
          if (q.op === 'insert') {
            const r = { id: 'link-' + nextId++, note_id: null, status: 'confirmed', report_kind: null, ...q.row };
            const sameWs = (list, id) => id == null || list.some(x => x.id === id && x.workspace_id === r.workspace_id);
            if (!owned.has(r.workspace_id) || !sameWs(state.spaces, r.project_id) || !sameWs(state.orgs, r.organization_id)) {
              return { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
            }
            if ([r.project_id, r.organization_id].filter(v => v != null).length !== 1) return { data: null, error: { code: '23514', message: 'one target' } };
            const key = x => [x.google_task_id, x.note_id, x.project_id, x.organization_id].join('|');
            if (rows.some(x => key(x) === key(r))) return { data: null, error: { code: '23505', message: 'duplicate key' } };
            rows.push(r);
            return { data: null, error: null };
          }
          if (q.op === 'update') {
            if (failLinkUpdate) return { data: null, error: { code: 'XX000', message: 'update failed' } };
            rows.filter(match).forEach(r => Object.assign(r, q.values));
            return { data: null, error: null };
          }
          if (q.op === 'delete') {
            const keep = rows.filter(r => !match(r));
            rows.splice(0, rows.length, ...keep);
            return { data: null, error: null };
          }
          const found = rows.filter(match).map(r => ({ ...r }));
          return { data: q.single ? found[0] || null : found, error: null };
        };
        const b = {
          select: () => b,
          insert: row => { q.op = 'insert'; q.row = row; return b; },
          update: values => { q.op = 'update'; q.values = values; return b; },
          delete: () => { q.op = 'delete'; return b; },
          eq: (col, v) => { q.filters.push(r => r[col] === v); return b; },
          in: (col, vs) => { q.filters.push(r => vs.includes(r[col])); return b; },
          not: (col, op, v) => { assert.equal(op, 'is'); q.filters.push(r => r[col] !== v); return b; },
          maybeSingle: async () => { q.single = true; return run(); },
          then: (ok, fail) => Promise.resolve().then(run).then(ok, fail)
        };
        return b;
      }
    };
  };

  const fetchMock = async (url, init = {}) => {
    const u = new URL(String(url)), method = init.method || 'GET';
    if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/tokeninfo') return json({ scope: 'openid https://www.googleapis.com/auth/tasks' });
    googleCalls.push({ method, path: decodeURIComponent(u.pathname) });
    const listPath = u.pathname.match(/^\/tasks\/v1\/lists\/([^/]+)\/tasks$/);
    if (listPath) {
      assert.equal(decodeURIComponent(listPath[1]), '@default', 'only the default list is used');
      if (method === 'POST') {
        const body = JSON.parse(init.body);
        const t = { id: 'new-' + nextId++, status: 'needsAction', ...body };
        google.set(t.id, t);
        return json(t);
      }
      const q = u.searchParams;
      const items = [...google.values()].filter(t => !(q.get('showCompleted') === 'false' && t.status === 'completed'));
      return json({ items });
    }
    const one = u.pathname.match(/^\/tasks\/v1\/lists\/([^/]+)\/tasks\/([^/]+)$/);
    if (!one) throw new Error('unexpected fetch ' + url);
    const t = google.get(decodeURIComponent(one[2]));
    if (!t) return json({ error: { code: 404, message: 'Task not found.' } }, 404);
    if (method === 'GET') return json(t);
    if (method === 'DELETE') { google.delete(t.id); return new Response(null, { status: 204 }); }
    Object.assign(t, JSON.parse(init.body));
    return json(t);
  };

  let handler = null;
  const Deno = {
    env: { get: key => ({ SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon' }[key]) },
    serve: fn => { handler = fn; }
  };
  class FakeDate extends Date {
    constructor(...a) { super(...(a.length ? a : [NOW])); }
    static now() { return NOW; }
  }
  const consoleMock = { log: (...a) => logs.push(a.join(' ')), error: () => {}, warn: () => {} };
  const createClient = (_url, key, opts) => key === 'service' ? admin : userDb(opts?.global?.headers?.Authorization || '');
  new Function('Deno', 'createClient', 'fetch', 'Date', 'console', SOURCE)(Deno, createClient, fetchMock, FakeDate, consoleMock);

  const post = async (action, body = {}, token = 'token-a') => {
    const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) };
    const r = await handler(new Request('https://sb.example/functions/v1/google-tasks?action=' + action, { method: 'POST', headers, body: JSON.stringify({ action, ...body }) }));
    return { status: r.status, body: await r.json() };
  };
  const get = async (action, params = {}) => {
    const q = new URLSearchParams({ action, ...params });
    const r = await handler(new Request('https://sb.example/functions/v1/google-tasks?' + q, { headers: { Authorization: 'Bearer token-a' } }));
    return { status: r.status, body: await r.json() };
  };
  return { post, get, state, google, googleCalls, logs };
}

const pending = (id, due = null) => ({ id, title: id, status: 'needsAction', ...(due ? { due } : {}) });
const done = (id, completedAgoDays) => ({ id, title: id, status: 'completed', completed: iso(NOW - completedAgoDays * DAY) });
const targetsOf = rows => rows.map(r => r.project_id || r.organization_id).sort();

test('create: the task goes to the default list and is linked to every chosen project and organization', async () => {
  const h = harness();
  const r = await h.post('create', { title: 't', task_list_id: 'other-list', task_list_title: '다른 목록', links: [{ project_id: P1 }, { organization_id: O1 }, { project_id: P1 }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.task.taskListId, '@default');
  assert.equal(r.body.task.taskListTitle, '내 할 일');
  assert.deepEqual(h.googleCalls.map(c => c.path), ['/tasks/v1/lists/@default/tasks'], 'a list id sent by the app is ignored');
  assert.deepEqual(targetsOf(h.state.links), [P1, O1].sort(), 'duplicate targets are saved once');
  assert.ok(h.state.links.every(l => l.google_task_id === r.body.task.id && l.google_tasklist_id === '@default' && l.task_completed === false && l.workspace_id === 'ws-a'));
  assert.deepEqual(targetsOf(r.body.links), [P1, O1].sort());
});

test('create: no link is needed', async () => {
  const h = harness();
  const r = await h.post('create', { title: 't' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.links, []);
  assert.equal(h.state.links.length, 0);
});

test('create: a project or organization outside the caller\'s workspace is refused before the task is created', async () => {
  for (const links of [[{ project_id: PX }], [{ project_id: P1 }, { organization_id: OX }]]) {
    const h = harness();
    const r = await h.post('create', { title: 't', links });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /찾을 수 없습니다/);
    assert.equal(h.googleCalls.length, 0, 'no Google task is created');
    assert.equal(h.state.links.length, 0);
  }
});

test('create and link: malformed targets are refused without reaching Google', async () => {
  const bad = [
    { project_id: P1, organization_id: O1 },
    {},
    { project_id: 'not-a-uuid' },
    { organization_id: "' or 1=1 --" }
  ];
  for (const target of bad) {
    const h = harness({ tasks: [pending('a')] });
    assert.equal((await h.post('create', { title: 't', links: [target] })).status, 400);
    assert.equal((await h.post('link', { task_id: 'a', links: [target] })).status, 400);
    assert.equal(h.googleCalls.length, 0);
  }
  const h = harness();
  const many = Array.from({ length: 21 }, (_, i) => ({ project_id: `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111` }));
  assert.equal((await h.post('create', { title: 't', links: many })).status, 400);
  assert.equal((await h.post('create', { title: 't', links: { project_id: P1 } })).status, 400);
  assert.equal(h.googleCalls.length, 0);
});

test('link: reads the task once to fill the completion copy; linking twice keeps one row', async () => {
  const h = harness({ tasks: [done('a', 1)] });
  const r = await h.post('link', { task_id: 'a', links: [{ project_id: P1 }] });
  assert.equal(r.status, 200);
  assert.deepEqual(h.googleCalls, [{ method: 'GET', path: '/tasks/v1/lists/@default/tasks/a' }]);
  assert.deepEqual(h.state.links.map(l => [l.project_id, l.task_completed]), [[P1, true]]);
  const again = await h.post('link', { task_id: 'a', links: [{ project_id: P1 }, { project_id: P2 }] });
  assert.equal(again.status, 200);
  assert.deepEqual(targetsOf(h.state.links), [P1, P2].sort());
  assert.deepEqual(targetsOf(again.body.links), [P1, P2].sort());
});

test('link: a task Google does not have, or a target in another workspace, adds nothing', async () => {
  const h = harness({ tasks: [pending('a')] });
  const missing = await h.post('link', { task_id: 'gone', links: [{ project_id: P1 }] });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /찾을 수 없습니다/);
  const foreign = await h.post('link', { task_id: 'a', links: [{ project_id: PX }] });
  assert.equal(foreign.status, 400);
  assert.equal(h.state.links.length, 0);
});

test('links and unlink: list and remove one target; they work while Google is disconnected', async () => {
  const h = harness({ connection: 'none', links: [{ google_task_id: 'a', project_id: P1, task_completed: false }, { google_task_id: 'a', organization_id: O1, task_completed: false }, { google_task_id: 'b', project_id: P1, task_completed: false }] });
  const listed = await h.get('links', { task_id: 'a' });
  assert.equal(listed.status, 200);
  assert.deepEqual(targetsOf(listed.body.links), [P1, O1].sort());
  const r = await h.post('unlink', { task_id: 'a', links: [{ project_id: P1 }] });
  assert.equal(r.status, 200);
  assert.deepEqual(targetsOf(r.body.links), [O1]);
  assert.deepEqual(h.state.links.map(l => [l.google_task_id, l.project_id || l.organization_id]).sort(), [['a', O1], ['b', P1]]);
  assert.equal((await h.post('unlink', { task_id: 'a', links: [] })).status, 400);
  assert.equal(h.googleCalls.length, 0);
});

test('unlink: rows in another workspace are not touched', async () => {
  const h = harness({ links: [{ google_task_id: 'a', project_id: PX, workspace_id: 'ws-b', task_completed: false }] });
  const r = await h.post('unlink', { task_id: 'a', links: [{ project_id: PX }] });
  assert.equal(r.status, 200);
  assert.equal(h.state.links.length, 1);
  assert.deepEqual(r.body.links, []);
});

test('toggle and update: every link row of the task gets Google\'s completion state after the save', async () => {
  const h = harness({ tasks: [pending('a')], links: [{ google_task_id: 'a', project_id: P1, task_completed: false }, { google_task_id: 'a', organization_id: O1, task_completed: false }, { google_task_id: 'b', project_id: P1, task_completed: false }] });
  const r = await h.post('toggle', { task_id: 'a', completed: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.task.status, 'completed');
  assert.equal(r.body.task.taskListId, '@default', 'a missing list id means the default list');
  assert.deepEqual(h.state.links.map(l => [l.google_task_id, l.task_completed]), [['a', true], ['a', true], ['b', false]]);
  assert.ok(h.state.links.filter(l => l.google_task_id === 'a').every(l => l.task_checked_at));
  await h.post('toggle', { task_id: 'a', task_list_id: '@default', completed: false });
  assert.deepEqual(h.state.links.map(l => l.task_completed), [false, false, false]);
  h.google.get('a').status = 'completed';
  const u = await h.post('update', { task_id: 'a', title: 'renamed' });
  assert.equal(u.status, 200);
  assert.deepEqual(h.state.links.map(l => l.task_completed), [true, true, false]);
});

test('toggle: a failed copy update keeps the Google result and logs counts only', async () => {
  const h = harness({ tasks: [pending('secret-title')], links: [{ google_task_id: 'secret-title', project_id: P1, task_completed: false }], failLinkUpdate: true });
  const r = await h.post('toggle', { task_id: 'secret-title', completed: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.task.status, 'completed');
  assert.deepEqual(h.logs.map(l => JSON.parse(l)), [{ fn: 'google-tasks', action: 'toggle', link_sync: 'failed' }]);
});

test('toggle: a failed Google save leaves the copy unchanged', async () => {
  const h = harness({ links: [{ google_task_id: 'gone', project_id: P1, task_completed: false }] });
  const r = await h.post('toggle', { task_id: 'gone', completed: true });
  assert.equal(r.status, 400);
  assert.equal(h.state.links[0].task_completed, false);
});

test('delete: the task\'s links are removed with it', async () => {
  const h = harness({ tasks: [pending('a')], links: [{ google_task_id: 'a', project_id: P1, task_completed: false }, { google_task_id: 'b', project_id: P1, task_completed: false }] });
  const r = await h.post('delete', { task_id: 'a' });
  assert.equal(r.status, 200);
  assert.deepEqual(h.state.links.map(l => l.google_task_id), ['b']);
});

test('linked: pending (undated and overdue included) and last-3-day completed tasks; gone tasks lose their links; the copy is synced', async () => {
  const h = harness({
    tasks: [pending('undated'), pending('overdue', '2026-09-01T00:00:00.000Z'), pending('next', '2026-09-28T00:00:00.000Z'), done('recent', 1), done('old', 5), { ...pending('trashed'), deleted: true }, pending('elsewhere')],
    links: [
      ...['undated', 'overdue', 'next', 'old', 'trashed'].map(id => ({ google_task_id: id, project_id: P1, task_completed: false })),
      { google_task_id: 'recent', project_id: P1, task_completed: false },
      { google_task_id: 'gone', project_id: P1, task_completed: false },
      { google_task_id: 'gone', organization_id: O1, task_completed: false },
      { google_task_id: 'elsewhere', project_id: P2, task_completed: false },
      { google_task_id: 'undated', project_id: P1, status: 'suggested', task_completed: false, note_id: null, organization_id: null, id: 'dup-suggested' }
    ]
  });
  const r = await h.get('linked', { project_id: P1 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.tasks.map(t => t.id), ['overdue', 'next', 'undated', 'recent']);
  assert.ok(r.body.tasks.every(t => t.taskListId === '@default'));
  assert.equal(r.body.removed, 2);
  assert.ok(!h.state.links.some(l => l.google_task_id === 'gone' || l.google_task_id === 'trashed'), 'links of a task Google no longer has are removed for every target');
  assert.equal(h.state.links.find(l => l.google_task_id === 'recent').task_completed, true);
  assert.equal(h.state.links.find(l => l.google_task_id === 'old').task_completed, true);
  assert.equal(h.state.links.find(l => l.google_task_id === 'elsewhere').task_completed, false, 'other projects are not read');
  assert.ok(h.googleCalls.every(c => c.method === 'GET' && c.path.startsWith('/tasks/v1/lists/@default/tasks/')));
  assert.equal(new Set(h.googleCalls.map(c => c.path)).size, h.googleCalls.length, 'each task is read once');
});

test('linked: an organization works the same; a target in another workspace shows nothing and reaches no Google task', async () => {
  const h = harness({ tasks: [pending('a'), pending('b')], links: [{ google_task_id: 'a', organization_id: O1, task_completed: false }, { google_task_id: 'b', project_id: PX, workspace_id: 'ws-b', task_completed: false }] });
  const org = await h.get('linked', { organization_id: O1 });
  assert.deepEqual(org.body.tasks.map(t => t.id), ['a']);
  const before = h.googleCalls.length;
  const foreign = await h.get('linked', { project_id: PX });
  assert.equal(foreign.status, 200);
  assert.deepEqual(foreign.body.tasks, []);
  assert.equal(h.googleCalls.length, before);
  assert.equal((await h.get('linked', {})).status, 400);
});

test('unlinked: every pending task of the default list without a confirmed link, whatever the due date', async () => {
  const h = harness({
    tasks: [pending('free-undated'), pending('free-late', '2026-12-01T00:00:00.000Z'), pending('linked'), pending('suggested-only'), done('free-done', 1)],
    links: [{ google_task_id: 'linked', project_id: P1, task_completed: false }, { google_task_id: 'suggested-only', project_id: P1, status: 'suggested', task_completed: false }]
  });
  const r = await h.get('unlinked');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.tasks.map(t => t.id), ['free-late', 'free-undated', 'suggested-only']);
  assert.deepEqual(h.googleCalls.map(c => c.method + ' ' + c.path), ['GET /tasks/v1/lists/@default/tasks']);
});

test('overview: link rows of returned tasks get Google\'s completion state', async () => {
  const h = harness({
    tasks: [done('a', 1), pending('b', '2026-09-28T00:00:00.000Z')],
    links: [{ google_task_id: 'a', project_id: P1, task_completed: false }, { google_task_id: 'b', project_id: P1, task_completed: true }, { google_task_id: 'c', project_id: P1, task_completed: false }]
  });
  const r = await h.get('overview');
  assert.equal(r.status, 200);
  assert.deepEqual(h.state.links.map(l => [l.google_task_id, l.task_completed]), [['a', true], ['b', false], ['c', false]]);
});

test('link actions reject a missing or invalid login before reading links or Google', async () => {
  const h = harness({ tasks: [pending('a')], links: [{ google_task_id: 'a', project_id: P1, task_completed: false }] });
  for (const [action, body] of [['create', { title: 't', links: [{ project_id: P1 }] }], ['link', { task_id: 'a', links: [{ project_id: P1 }] }], ['unlink', { task_id: 'a', links: [{ project_id: P1 }] }], ['links', { task_id: 'a' }], ['linked', { project_id: P1 }], ['unlinked', {}]]) {
    for (const token of ['', 'forged']) {
      const r = await h.post(action, body, token);
      assert.notEqual(r.status, 200, `${action} without a valid login`);
      assert.ok(r.body.error);
    }
  }
  assert.equal(h.googleCalls.length, 0);
  assert.equal(h.state.links.length, 1);
});
