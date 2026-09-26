import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

// Runs the real google-calendar handler with mocked Supabase and Google Calendar so the events/status
// loading path can be checked for call count, bounded parallelism, partial failure, and owner scoping.
// No network calls. Each harness() evaluates the source again, so the in-memory colors cache starts empty.
const SOURCE = stripTypeScriptTypes(
  readFileSync(new URL('../../supabase/functions/google-calendar/index.ts', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, ''),
  { mode: 'strip' }
);

const PALETTE = { event: { 1: { background: '#a4bdfc', foreground: '#1d1d1d' }, 11: { background: '#dc2127', foreground: '#1d1d1d' } } };
const USERS = { 'token-a': 'user-a', 'token-b': 'user-b', 'token-c': 'user-c' };
const future = () => new Date(Date.now() + 3600_000).toISOString();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function harness({ connections = {}, delay = 0, calendarFail = {}, colorsFail = false, now = null } = {}) {
  const calls = { google: [], connectionLookups: [], updates: [] };
  let inFlight = 0, maxInFlight = 0;
  const rows = {
    'user-a': { user_id: 'user-a', enabled: true, calendar_ids: ['primary', 'work', 'family', 'club', 'holiday', 'team'], calendar_colors: { work: '#00aa00' }, google_email: 'a@example.test', access_token: 'google-a', refresh_token: 'r', token_expires_at: future() },
    'user-b': { user_id: 'user-b', enabled: true, calendar_ids: ['primary'], calendar_colors: {}, google_email: 'b@example.test', access_token: 'google-b', refresh_token: 'r', token_expires_at: future() },
    ...connections
  };
  const admin = {
    auth: { getUser: async token => USERS[token] ? { data: { user: { id: USERS[token] } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } } },
    from: table => {
      const filters = {};
      const b = {
        select: () => b,
        eq: (k, v) => { filters[k] = v; return b; },
        update: patch => { calls.updates.push({ table, patch }); return b; },
        maybeSingle: async () => {
          if (table !== 'app_google_calendar_connections') throw new Error('unexpected table ' + table);
          calls.connectionLookups.push(filters.user_id);
          return { data: rows[filters.user_id] || null, error: null };
        }
      };
      return b;
    }
  };
  const fetchMock = async (url, init = {}) => {
    const href = String(url), token = String(init.headers?.Authorization || '').replace('Bearer ', '');
    const u = new URL(href);
    calls.google.push({ path: u.pathname, token });
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (u.pathname === '/calendar/v3/colors') return colorsFail ? json({ error: { message: 'colors unavailable' } }, 500) : json(PALETTE);
      if (u.pathname === '/calendar/v3/users/me/calendarList') return json({ items: [{ id: 'primary', summary: 'Me', primary: true, accessRole: 'owner' }] });
      const m = u.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (calendarFail[id]) return json({ error: { message: calendarFail[id] } }, 404);
        return json({ items: [{ id: `${id}-ev`, summary: `${id} event`, start: { dateTime: '2026-09-26T09:00:00+09:00' }, end: { dateTime: '2026-09-26T10:00:00+09:00' }, colorId: '11' }] });
      }
      throw new Error('unexpected fetch ' + href);
    } finally { inFlight--; }
  };
  let handler = null;
  const Deno = {
    env: { get: key => ({ SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service' }[key]) },
    serve: fn => { handler = fn; }
  };
  const clock = { now: now ?? Date.now() };
  class FakeDate extends Date { static now() { return clock.now; } }
  new Function('Deno', 'createClient', 'fetch', 'Date', SOURCE)(Deno, () => admin, fetchMock, FakeDate);
  return { handler, calls, clock, get maxInFlight() { return maxInFlight; } };
}

async function get(h, action, { token = 'token-a', params = {} } = {}) {
  const u = new URL('https://sb.example/functions/v1/google-calendar');
  u.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const headers = token ? { Authorization: 'Bearer ' + token } : {};
  const response = await h.handler(new Request(u, { headers }));
  return { status: response.status, body: await response.json() };
}

const eventCalls = h => h.calls.google.filter(c => c.path.endsWith('/events'));
const colorCalls = h => h.calls.google.filter(c => c.path === '/calendar/v3/colors');

test('events: one request per selected calendar, bounded parallel, order and response shape preserved', async () => {
  const h = harness({ delay: 20 });
  const { status, body } = await get(h, 'events', { params: { timeMin: '2026-09-01T00:00:00Z', timeMax: '2026-10-01T00:00:00Z' } });
  assert.equal(status, 200);
  assert.equal(eventCalls(h).length, 6);
  assert.equal(colorCalls(h).length, 1);
  assert.ok(h.maxInFlight > 1, 'calendar requests overlap');
  assert.ok(h.maxInFlight <= 5, 'at most 4 calendar requests plus the colors request in flight');
  assert.deepEqual(body.events.map(e => e.calendarId), ['primary', 'work', 'family', 'club', 'holiday', 'team']);
  assert.equal(body.events[0].color, '#dc2127');
  assert.deepEqual(body.colors, { work: '#00aa00' });
  assert.equal(body.eventColors['11'].background, '#dc2127');
  assert.equal(body.warning, undefined);
  assert.equal(body.failedCalendars, undefined);
});

test('events: a failing calendar returns the other calendars and a warning naming the failure', async () => {
  const h = harness({ calendarFail: { family: 'Not Found' } });
  const { status, body } = await get(h, 'events');
  assert.equal(status, 200);
  assert.deepEqual(body.events.map(e => e.calendarId), ['primary', 'work', 'club', 'holiday', 'team']);
  assert.deepEqual(body.failedCalendars, [{ calendarId: 'family', error: 'Not Found' }]);
  assert.match(body.warning, /일부 캘린더를 불러오지 못했습니다\(1\/6\): Not Found/);
  assert.ok(body.eventColors, 'palette still returned');
});

test('events: when every calendar fails the warning is the Google error (client auth detection keeps working)', async () => {
  const h = harness({ calendarFail: { primary: 'Invalid Credentials' } });
  const { body } = await get(h, 'events', { token: 'token-b' });
  assert.deepEqual(body.events, []);
  assert.equal(body.warning, 'Invalid Credentials');
});

test('events: colors failure keeps events and omits eventColors so the client keeps its last palette', async () => {
  const h = harness({ colorsFail: true });
  const { body } = await get(h, 'events', { token: 'token-b' });
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].color, null);
  assert.equal('eventColors' in body, false);
  assert.match(body.warning, /일정 색상 정보를 불러오지 못했습니다/);
});

test('colors: cached palette is reused across requests and users, never the token; failures and expiry refetch', async () => {
  const h = harness({ colorsFail: true });
  await get(h, 'events', { token: 'token-b' });
  assert.equal(colorCalls(h).length, 1);
  await get(h, 'events', { token: 'token-b' });
  assert.equal(colorCalls(h).length, 2, 'failed palette fetch is not cached');

  const ok = harness();
  await get(ok, 'status');
  await get(ok, 'events');
  await get(ok, 'events', { token: 'token-b' });
  assert.equal(colorCalls(ok).length, 1, 'palette fetched once for status + events + another user');
  assert.deepEqual(ok.calls.google.filter(c => c.token !== 'google-a').map(c => c.token), ['google-b'], 'user B requests use only user B token');
  ok.clock.now += 31 * 60 * 1000;
  await get(ok, 'events', { token: 'token-b' });
  assert.equal(colorCalls(ok).length, 2, 'refetched after TTL');
});

test('status: calendarList and palette in parallel, palette from cache on the next call', async () => {
  const h = harness();
  const first = await get(h, 'status');
  assert.equal(first.body.connected, true);
  assert.equal(first.body.calendars[0].id, 'primary');
  assert.equal(first.body.eventColors['1'].background, '#a4bdfc');
  const second = await get(h, 'status');
  assert.deepEqual(second.body.eventColors, first.body.eventColors);
  assert.equal(colorCalls(h).length, 1);
  assert.equal(h.calls.google.filter(c => c.path.endsWith('/calendarList')).length, 2);
});

test('auth: missing or invalid session is rejected before any DB lookup, cache use, or Google call', async () => {
  const h = harness();
  for (const token of ['', 'forged-token']) {
    const { status, body } = await get(h, 'events', { token });
    assert.equal(status, 400);
    assert.match(body.error, token ? /로그인 세션을 확인할 수 없습니다/ : /로그인이 필요합니다/);
  }
  assert.deepEqual(h.calls.connectionLookups, []);
  assert.deepEqual(h.calls.google, []);
});

test('owner: events use only the caller connection; query params cannot select another user or calendar', async () => {
  const h = harness();
  const { body } = await get(h, 'events', { token: 'token-b', params: { user_id: 'user-a', calendarId: 'work', calendar_ids: 'work,family' } });
  assert.deepEqual(h.calls.connectionLookups, ['user-b']);
  assert.deepEqual(eventCalls(h).map(c => [c.path, c.token]), [['/calendar/v3/calendars/primary/events', 'google-b']]);
  assert.deepEqual(body.events.map(e => e.calendarId), ['primary']);
});

test('owner: a user without their own connection gets an error and no Google call, even with a warm cache', async () => {
  const h = harness();
  await get(h, 'events');
  const before = h.calls.google.length;
  const { status, body } = await get(h, 'events', { token: 'token-c' });
  assert.equal(status, 400);
  assert.match(body.error, /연결되지 않았습니다/);
  assert.equal(h.calls.google.length, before);
});
