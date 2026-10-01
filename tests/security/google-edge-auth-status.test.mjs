import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

// 일정 인증-1: google-calendar and google-tasks (both verify_jwt=false, auth in code) answer 401 when the caller is not
// logged in (no token, malformed, forged, or expired), so runtime-client.js refreshes the session once and retries.
// Everything else keeps its old status: bad requests and Google connection problems 400, missing Tasks scope 403,
// and an auth server outage 400 (a second 401 would make the app drop the session). No network calls.
const load = name => stripTypeScriptTypes(
  readFileSync(new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8').replace(/^import .*$/gm, ''),
  { mode: 'strip' }
);
const SOURCES = { 'google-calendar': load('google-calendar'), 'google-tasks': load('google-tasks') };

const DAY = 24 * 60 * 60 * 1000;
const iso = ms => new Date(ms).toISOString();
// What supabase-js auth.getUser returns for each token: GoTrue rejects bad and expired JWTs with 401/403,
// and a network failure or 5xx comes back as AuthRetryableFetchError with status 0 or 5xx.
const AUTH = {
  'token-a': { data: { user: { id: 'user-a' } }, error: null },
  'token-none': { data: { user: { id: 'user-none' } }, error: null },
  'token-stale': { data: { user: { id: 'user-stale' } }, error: null },
  'not-a-jwt': { data: { user: null }, error: { status: 403, code: 'bad_jwt', message: 'invalid JWT: unable to parse or verify signature' } },
  'expired-jwt': { data: { user: null }, error: { status: 403, code: 'bad_jwt', message: 'invalid JWT: token is expired' } },
  'revoked-jwt': { data: { user: null }, error: { status: 401, message: 'Unauthorized' } },
  'no-status': { data: { user: null }, error: { message: 'invalid JWT' } },
  'no-user': { data: { user: null }, error: null },
  'auth-down': { data: { user: null }, error: { status: 503, message: 'Service Unavailable' } },
  'auth-offline': { data: { user: null }, error: { status: 0, message: 'fetch failed' } }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function harness(name, { scope = 'openid https://www.googleapis.com/auth/tasks' } = {}) {
  const calls = { db: [], google: [] };
  const connections = {
    'user-a': { user_id: 'user-a', enabled: true, calendar_ids: ['primary'], calendar_colors: {}, google_email: 'a@example.test', access_token: 'google-a', refresh_token: 'r', token_expires_at: iso(Date.now() + DAY) },
    'user-stale': { user_id: 'user-stale', enabled: true, calendar_ids: ['primary'], access_token: 'old', refresh_token: null, token_expires_at: iso(Date.now() - DAY) }
  };
  const query = table => {
    const filters = {};
    const b = {
      select: () => b, eq: (k, v) => { filters[k] = v; return b; }, in: () => b, not: () => b, update: () => b, insert: async () => ({ error: null }), delete: () => b,
      maybeSingle: async () => { calls.db.push(table); return { data: table === 'app_google_calendar_connections' ? connections[filters.user_id] || null : null, error: null }; },
      single: async () => { calls.db.push(table); return { data: null, error: { message: 'unexpected' } }; },
      then: (ok, fail) => { calls.db.push(table); return Promise.resolve({ data: [], error: null }).then(ok, fail); }
    };
    return b;
  };
  const client = { auth: { getUser: async token => AUTH[token] || AUTH['no-status'] }, from: query };
  const fetchMock = async url => {
    const u = new URL(String(url));
    calls.google.push(u.pathname);
    if (u.pathname === '/tokeninfo') return json({ scope });
    if (u.pathname === '/calendar/v3/colors') return json({ event: {} });
    if (u.pathname.endsWith('/calendarList')) return json({ items: [{ id: 'primary', summary: 'me', primary: true }] });
    if (u.pathname.endsWith('/events')) return json({ items: [] });
    if (u.pathname.startsWith('/tasks/v1/')) {
      if (!scope.includes('/auth/tasks')) return json({ error: { message: 'Request had insufficient authentication scopes.' } }, 403);
      return json({ items: [] });
    }
    throw new Error('unexpected fetch ' + url);
  };
  let handler = null;
  const Deno = {
    env: { get: key => ({ SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon' }[key]) },
    serve: fn => { handler = fn; }
  };
  const quiet = { log: () => {}, error: () => {}, warn: () => {} };
  new Function('Deno', 'createClient', 'fetch', 'console', SOURCES[name])(Deno, () => client, fetchMock, quiet);
  return { handler, calls };
}

async function send(h, name, { token = null, method = 'GET', action = '', body } = {}) {
  const u = new URL(`https://sb.example/functions/v1/${name}`);
  if (action) u.searchParams.set('action', action);
  const headers = { 'Content-Type': 'application/json' };
  if (token !== null) headers.Authorization = 'Bearer ' + token;
  const response = await h.handler(new Request(u, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await response.text();
  let data = null; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, body: data, headers: response.headers };
}

// Read and write entry points of each function, as the app calls them.
const REQUESTS = {
  'google-calendar': [
    { action: 'status' }, { action: 'events' }, { action: 'start' },
    { method: 'POST', body: { action: 'create-event', title: 't', all_day: true, start_date: '2026-10-01', end_date: '2026-10-01' } },
    { method: 'POST', body: { action: 'delete-event', event_id: 'e1' } }
  ],
  'google-tasks': [
    { action: 'overview' }, { action: 'tasks' }, { action: 'links' },
    { method: 'POST', body: { action: 'create', title: 't' } },
    { method: 'POST', body: { action: 'toggle', task_id: 't1', completed: true } }
  ]
};

for (const name of Object.keys(SOURCES)) {
  test(`${name}: no Authorization header or an empty bearer answers 401 before any DB or Google call`, async () => {
    for (const token of [null, '']) {
      for (const req of REQUESTS[name]) {
        const h = harness(name);
        const r = await send(h, name, { token, ...req });
        assert.equal(r.status, 401, `${JSON.stringify(req)} with token ${JSON.stringify(token)}`);
        // A bare "Bearer " reaches the handler trimmed to "Bearer" and fails the session check instead.
        assert.match(r.body.error, token === null ? /로그인이 필요합니다/ : /로그인/);
        assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*', 'CORS headers stay on the 401');
        assert.deepEqual(h.calls, { db: [], google: [] });
      }
    }
  });

  test(`${name}: malformed, forged, revoked, or expired tokens answer 401 before any DB or Google call`, async () => {
    for (const token of ['not-a-jwt', 'expired-jwt', 'revoked-jwt', 'no-status', 'no-user']) {
      for (const req of REQUESTS[name]) {
        const h = harness(name);
        const r = await send(h, name, { token, ...req });
        assert.equal(r.status, 401, `${token} ${JSON.stringify(req)}`);
        assert.match(r.body.error, /로그인 세션을 확인할 수 없습니다/);
        assert.deepEqual(h.calls, { db: [], google: [] });
      }
    }
  });

  test(`${name}: an auth server outage keeps 400 so the app does not drop a valid session`, async () => {
    for (const token of ['auth-down', 'auth-offline']) {
      const h = harness(name);
      const r = await send(h, name, { token, action: name === 'google-tasks' ? 'overview' : 'status' });
      assert.equal(r.status, 400, token);
      assert.match(r.body.error, /로그인 세션을 확인할 수 없습니다/);
      assert.deepEqual(h.calls, { db: [], google: [] });
    }
  });

  test(`${name}: CORS preflight still answers without a token`, async () => {
    const h = harness(name);
    const r = await send(h, name, { method: 'OPTIONS' });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
  });

  test(`${name}: a logged-in caller keeps the old answers (200, unknown action 400, Google reconnect 400)`, async () => {
    const ok = await send(harness(name), name, { token: 'token-a', action: name === 'google-tasks' ? 'overview' : 'status' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.connected, true);

    const unknown = await send(harness(name), name, { token: 'token-a', method: 'POST', action: 'no-such-action', body: { action: 'no-such-action' } });
    assert.equal(unknown.status, 400);
    if (name === 'google-calendar') assert.equal(unknown.body.error, 'Unknown action');

    // Google problems are not Web2 login failures: they must not send the app through a session refresh.
    const notConnected = await send(harness(name), name, { token: 'token-none', action: name === 'google-tasks' ? 'tasks' : 'events' });
    assert.equal(notConnected.status, 400);
    assert.match(notConnected.body.error, /연결되지 않았습니다/);
    const stale = await send(harness(name), name, { token: 'token-stale', action: name === 'google-tasks' ? 'tasks' : 'events' });
    assert.equal(stale.status, 400);
    assert.match(stale.body.error, /Google 재인증이 필요합니다/);
  });
}

test('google-tasks: bad request 400 and missing Tasks scope 403 are unchanged for a logged-in caller', async () => {
  const bad = await send(harness('google-tasks'), 'google-tasks', { token: 'token-a', method: 'POST', body: { action: 'toggle' } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Google 할 일 ID가 없습니다/);

  const scope = await send(harness('google-tasks', { scope: 'openid' }), 'google-tasks', { token: 'token-a', action: 'lists' });
  assert.equal(scope.status, 403);
  assert.deepEqual(scope.body, { error: 'TASKS_SCOPE_REQUIRED', needs_reconnect: true });
});

test('google-calendar: bad request 400 is unchanged for a logged-in caller', async () => {
  const r = await send(harness('google-calendar'), 'google-calendar', { token: 'token-a', method: 'POST', body: { action: 'delete-event' } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /일정 ID가 없습니다/);
});
