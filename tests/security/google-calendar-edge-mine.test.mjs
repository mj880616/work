import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

// 원장 재료 C-2: google-calendar 일정에 `mine`(참/거짓 한 칸)이 붙고, `events`가 캘린더 하나만 읽을 수 있다.
// 진짜 핸들러를 가짜 Supabase·Google로 돌린다(네트워크 없음). 주소·이름은 모두 지어낸 값이다.
const SOURCE = stripTypeScriptTypes(
  readFileSync(new URL('../../supabase/functions/google-calendar/index.ts', import.meta.url), 'utf8').replace(/^import .*$/gm, ''),
  { mode: 'strip' }
);
const SECRETS = ['creator-secret@example.test', 'organizer-secret@example.test', 'guest-secret@example.test', 'Creator Secret Name', 'Guest Secret Name'];
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });

function googleEvent(id, extra = {}) {
  return {
    id, summary: `title ${id}`, start: { dateTime: '2026-10-20T14:00:00+09:00' }, end: { dateTime: '2026-10-20T15:00:00+09:00' }, colorId: '3',
    creator: { email: SECRETS[0], displayName: SECRETS[3], self: true },
    organizer: { email: SECRETS[1], displayName: SECRETS[3], self: false },
    attendees: [{ email: SECRETS[2], displayName: SECRETS[4], responseStatus: 'accepted' }],
    ...extra
  };
}

function harness({ perCalendar }) {
  const calls = [];
  const admin = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }) },
    from: () => {
      const b = { select: () => b, eq: () => b, update: () => b, maybeSingle: async () => ({ data: { user_id: 'user-a', enabled: true, calendar_ids: ['primary', 'work'], calendar_colors: {}, google_email: SECRETS[0], access_token: 'google-a', refresh_token: 'r', token_expires_at: new Date(Date.now() + 3600_000).toISOString() }, error: null }) };
      return b;
    }
  };
  const fetchMock = async url => {
    const u = new URL(String(url));
    calls.push(decodeURIComponent(u.pathname));
    if (u.pathname === '/calendar/v3/colors') return json({ event: { 3: { background: '#8e24aa', foreground: '#fff' } } });
    const m = u.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events$/);
    if (m) return json({ items: perCalendar(decodeURIComponent(m[1])) });
    throw new Error('unexpected fetch ' + u.pathname);
  };
  let handler = null;
  const Deno = { env: { get: k => ({ SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service' }[k]) }, serve: fn => { handler = fn; } };
  new Function('Deno', 'createClient', 'fetch', SOURCE)(Deno, () => admin, fetchMock);
  return { calls, get: async (params = {}) => {
    const u = new URL('https://sb.example/functions/v1/google-calendar?action=events');
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const r = await handler(new Request(u, { headers: { Authorization: 'Bearer token-a' } }));
    return { status: r.status, raw: await r.text() };
  } };
}

test('events: 만든 사람·주최자·참석자의 이메일과 이름은 응답 어디에도 없다', async () => {
  const h = harness({ perCalendar: id => [googleEvent(id + '-1'), googleEvent(id + '-2', { creator: { email: SECRETS[0] } })] });
  const { status, raw } = await h.get();
  assert.equal(status, 200);
  for (const s of SECRETS) assert.equal(raw.includes(s), false, 'leaked: ' + s);
  const body = JSON.parse(raw);
  for (const e of body.events) for (const k of ['creator', 'organizer', 'attendees']) assert.equal(k in e, false, k);
});

test('events: mine은 creator.self가 true일 때만 true, 나머지는 모두 false(항상 boolean)', async () => {
  const items = [
    googleEvent('a'),
    googleEvent('b', { creator: { email: SECRETS[0], self: false } }),
    googleEvent('c', { creator: { email: SECRETS[0] } }),
    googleEvent('d', { creator: undefined }),
    googleEvent('e', { creator: { self: 'true' } })
  ];
  const h = harness({ perCalendar: () => items });
  const { raw } = await h.get({ onlyCalendarId: 'only' });
  const mine = Object.fromEntries(JSON.parse(raw).events.map(e => [e.id, e.mine]));
  assert.deepEqual(mine, { a: true, b: false, c: false, d: false, e: false });
});

test('events: 기존 응답 모양은 그대로이고 mine 한 칸만 늘었다(달력 화면이 쓰는 칸)', async () => {
  const h = harness({ perCalendar: () => [googleEvent('x', { location: 'room', description: 'memo', htmlLink: 'https://calendar.example/e', recurringEventId: 'r' })] });
  const body = JSON.parse((await h.get()).raw);
  assert.deepEqual(Object.keys(body.events[0]).sort(), ['allDay', 'calendarId', 'color', 'colorId', 'description', 'end', 'htmlLink', 'id', 'location', 'mine', 'organizationIds', 'recurring', 'source', 'start', 'title'].sort());
  assert.equal(body.events[0].color, '#8e24aa');
  assert.equal(body.events[0].recurring, true);
  assert.deepEqual(body.events.map(e => e.calendarId), ['primary', 'work']);
  assert.deepEqual(Object.keys(body).sort(), ['colors', 'eventColors', 'events']);
});

test('events: onlyCalendarId를 주면 저장된 목록 대신 그 캘린더 하나만 읽는다', async () => {
  const h = harness({ perCalendar: id => [googleEvent(id)] });
  const body = JSON.parse((await h.get({ onlyCalendarId: 'shared-one' })).raw);
  assert.deepEqual(h.calls.filter(p => p.endsWith('/events')), ['/calendar/v3/calendars/shared-one/events']);
  assert.deepEqual(body.events.map(e => e.calendarId), ['shared-one']);
});

test('events: 잘못된 onlyCalendarId(빈 값·201자·제어문자)는 Google을 부르지 않는다', async () => {
  for (const bad of ['', 'x'.repeat(201), 'a\u0007b', 'a\nb']) {
    const h = harness({ perCalendar: () => [] });
    const { raw } = await h.get({ onlyCalendarId: bad });
    const body = JSON.parse(raw);
    assert.deepEqual(body.events, []);
    assert.match(body.warning, /캘린더 ID가 올바르지 않습니다/);
    assert.equal(h.calls.some(p => p.endsWith('/events')), false);
  }
});
