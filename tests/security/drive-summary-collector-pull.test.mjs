import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../../supabase/functions/drive-summary/core.mjs';
import { parsePullBody, pullWakeUrlOk, pullTakeOutcome } from '../../supabase/functions/drive-summary/collector-pull.mjs';

// S52-46 FEED-최신화즉시수집 2/3: POST ?action=collector_pull(소유자 JWT만). 모든 HTTP는 모의 응답, 값은 지어낸 것.
const now = new Date('2026-11-08T01:00:00Z');
const WAKE = 'https://script.google.com/macros/s/' + 'A'.repeat(40) + '/exec';
const SECRET = 's'.repeat(48);
const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon', COLLECTOR_HEARTBEAT_SECRET: 'beat-secret', DRIVE_SUMMARY_CRON_SECRET: 'cron', COLLECTOR_PULL_URL: WAKE, COLLECTOR_PULL_SECRET: SECRET };
function harness({ featureWs = 'ws', take = { ok: true, left: 19 }, takeStatus = 200, wake = { ok: true }, wakeStatus = 200, wakeThrows = false, wakeText = null, envOver = {} } = {}) {
  const calls = [];
  const fetcher = async (input, init = {}) => {
    const url = new URL(input), method = init.method || 'GET';
    calls.push({ url: String(url), path: url.pathname, method, init });
    if (url.pathname === '/auth/v1/user') {
      if (init.headers.Authorization === 'Bearer owner-jwt') return Response.json({ id: 'owner' });
      if (init.headers.Authorization === 'Bearer other-jwt') return Response.json({ id: 'other' });
      return Response.json({}, { status: 401 });
    }
    if (url.pathname === '/rest/v1/app_workspaces') return Response.json([{ id: 'ws' }]);
    if (url.pathname === '/rest/v1/app_workspace_members') return Response.json(url.searchParams.get('user_id') === 'eq.owner' ? [{ user_id: 'owner', role: 'owner' }] : []);
    if (url.pathname === '/rest/v1/rpc/app_operator_feature_workspace') return Response.json(featureWs);
    if (url.pathname === '/rest/v1/rpc/app_feed_pull_take') return takeStatus === 200 ? Response.json(take) : Response.json({ code: 'PGRST202' }, { status: takeStatus });
    if (String(url) === WAKE) {
      if (wakeThrows === 'timeout') throw new DOMException('signal timed out', 'TimeoutError');
      if (wakeThrows) throw new TypeError('error sending request');
      if (wakeText !== null) return new Response(wakeText, { status: wakeStatus, headers: { 'Content-Type': 'text/html' } });
      return Response.json(wake, { status: wakeStatus });
    }
    return Response.json({ unexpected: true }, { status: 500 });
  };
  const handler = createHandler({ env: { ...env, ...envOver }, fetcher, now: () => now });
  const post = (headers, body = { source: 'telegram' }) => handler(new Request('https://edge.test/drive-summary?action=collector_pull', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
  return { calls, post, wakes: () => calls.filter(c => c.url === WAKE), takes: () => calls.filter(c => c.path === '/rest/v1/rpc/app_feed_pull_take') };
}
const owner = { Authorization: 'Bearer owner-jwt' };

test('몸통·주소·횟수 결과 모양', () => {
  assert.deepEqual(parsePullBody('{"source":"call"}'), { source: 'call' });
  for (const bad of ['', '[]', '{}', '{"source":"news"}', '{"source":"call","workspace_id":"x"}', '{"source":"call","url":"https://x"}', JSON.stringify({ source: 'call', pad: 'x'.repeat(300) })]) assert.equal(parsePullBody(bad), null, bad);
  assert.equal(pullWakeUrlOk(WAKE), true);
  for (const bad of ['http://script.google.com/macros/s/' + 'A'.repeat(40) + '/exec', 'https://evil.test/macros/s/' + 'A'.repeat(40) + '/exec', WAKE + '?x=1', '']) assert.equal(pullWakeUrlOk(bad), false, bad);
  assert.deepEqual(pullTakeOutcome({ ok: true, left: 3 }), { left: 3 });
  assert.throws(() => pullTakeOutcome({ ok: false, reason: 'cooldown', wait_s: 120, left: 5 }), e => e.status === 429 && e.message === 'PULL_COOLDOWN' && e.extra.wait_s === 120);
  assert.throws(() => pullTakeOutcome({ ok: false, reason: 'daily', left: 0 }), e => e.status === 429 && e.message === 'PULL_DAILY_LIMIT');
  assert.throws(() => pullTakeOutcome(null), e => e.status === 502);
});

test('비로그인·틀린 JWT·cron·수집 비밀 머리글은 401, 횟수·웹 앱 안 부름', async () => {
  for (const headers of [{}, { Authorization: 'Bearer bad' }, { 'x-drive-summary-cron-secret': 'cron' }, { ...owner, 'x-collector-heartbeat-secret': 'beat-secret' }, { ...owner, 'x-drive-summary-cron-secret': 'cron' }]) {
    const h = harness();
    const r = await h.post(headers);
    assert.equal(r.status, 401, JSON.stringify(headers));
    assert.equal(h.takes().length + h.wakes().length, 0);
  }
});

test('소유자가 아니거나 운영자 기능이 다른 작업공간이면 403, 몸통이 다르면 400', async () => {
  let h = harness();
  assert.equal((await h.post({ Authorization: 'Bearer other-jwt' })).status, 403);
  for (const featureWs of [null, 'ws-other']) {
    h = harness({ featureWs });
    const r = await h.post(owner);
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error, 'NOT_OPERATOR');
    assert.equal(h.takes().length + h.wakes().length, 0);
  }
  h = harness();
  const feature = [];
  const r = await h.post(owner, { source: 'call' });
  assert.equal(r.status, 200);
  for (const c of h.calls.filter(c => c.path === '/rest/v1/rpc/app_operator_feature_workspace')) feature.push(JSON.parse(c.init.body).p_feature);
  assert.deepEqual(feature, ['calls'], '통화는 calls 기능으로 본다');
  for (const body of [{ source: 'news' }, { source: 'telegram', workspace_id: 'ws-other' }, 'x']) {
    h = harness();
    assert.equal((await h.post(owner, body)).status, 400, JSON.stringify(body));
    assert.equal(h.takes().length + h.wakes().length, 0);
  }
});

test('성공: 서버 키로 횟수 한 줄, 웹 앱에 비밀값을 몸통으로 한 번, 응답에 주소·비밀값 없음', async () => {
  const h = harness();
  const r = await h.post(owner);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body, { ok: true, source: 'telegram', requested_at: now.toISOString(), left: 19 });
  const take = h.takes();
  assert.equal(take.length, 1);
  assert.equal(take[0].init.headers.Authorization, 'Bearer service');
  assert.deepEqual(JSON.parse(take[0].init.body), { p_user: 'owner', p_workspace: 'ws', p_source: 'telegram' });
  const wake = h.wakes();
  assert.equal(wake.length, 1);
  assert.equal(wake[0].method, 'POST');
  assert.deepEqual(JSON.parse(wake[0].init.body), { secret: SECRET, source: 'telegram' });
  assert.equal(Object.keys(wake[0].init.headers).some(k => /authorization/i.test(k)), false, '사용자 토큰을 웹 앱에 넘기지 않음');
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, /script\.google|sssss/);
});

test('3분 안 두 번째·하루 21번째는 429, 웹 앱 안 부름', async () => {
  let h = harness({ take: { ok: false, reason: 'cooldown', wait_s: 150, left: 18 } });
  let r = await h.post(owner);
  assert.equal(r.status, 429);
  assert.deepEqual(await r.json(), { ok: false, error: 'PULL_COOLDOWN', wait_s: 150, retry_after: 150, left: 18, checked_at: now.toISOString() });
  assert.equal(h.wakes().length, 0);
  h = harness({ take: { ok: false, reason: 'daily', left: 0 } });
  r = await h.post(owner);
  assert.equal(r.status, 429);
  assert.equal((await r.json()).error, 'PULL_DAILY_LIMIT');
  assert.equal(h.wakes().length, 0);
});

test('웹 앱 실패는 까닭별 코드로 502, 비밀값·주소 없음은 503, 표 없음은 503', async () => {
  // S53-11: 까닭별 코드 — 거절({ok:false}) / 시간 초과 / 연결 안 됨 / HTTP 오류·알아볼 수 없는 답. 상태 번호는 모두 502.
  const cases = [
    [{ wake: { ok: false } }, 'PULL_WAKE_REFUSED'],
    [{ wakeThrows: 'timeout' }, 'PULL_WAKE_TIMEOUT'],
    [{ wakeThrows: 'net' }, 'PULL_WAKE_UNREACHABLE'],
    [{ wakeStatus: 500, wake: { ok: true } }, 'PULL_WAKE_HTTP'],
    [{ wakeStatus: 403, wake: { ok: false } }, 'PULL_WAKE_HTTP'],
    [{ wake: '<html>' }, 'PULL_WAKE_HTTP'],
    [{ wake: [{ ok: false }] }, 'PULL_WAKE_HTTP'],
    [{ wakeText: '<html><body>sign in</body></html>' }, 'PULL_WAKE_HTTP'],
  ];
  for (const [over, code] of cases) {
    const h = harness(over);
    const r = await h.post(owner);
    assert.equal(r.status, 502, JSON.stringify(over));
    const body = await r.json();
    assert.equal(body.error, code, JSON.stringify(over));
    assert.deepEqual(Object.keys(body).sort(), ['checked_at', 'error', 'ok'], '코드 말고 다른 칸(원문·주소)을 싣지 않음');
    assert.doesNotMatch(JSON.stringify(body), /html|sign in|script\.google|timed out|sending/);
    assert.equal(JSON.stringify(body).includes(SECRET), false);
  }
  for (const envOver of [{ COLLECTOR_PULL_URL: undefined }, { COLLECTOR_PULL_SECRET: undefined }, { COLLECTOR_PULL_SECRET: 'short' }, { COLLECTOR_PULL_URL: 'https://evil.test/x' }]) {
    const h = harness({ envOver });
    const r = await h.post(owner);
    assert.equal(r.status, 503, JSON.stringify(envOver));
    assert.equal((await r.json()).error, 'SERVER_CONFIG_MISSING');
    assert.equal(h.takes().length + h.wakes().length, 0, '설정이 없으면 횟수도 세지 않음');
  }
  const h = harness({ takeStatus: 404 });
  const r = await h.post(owner);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, 'PULL_NOT_READY');
  assert.equal(h.wakes().length, 0);
});

test('OPTIONS 204, 다른 경로는 그대로(collector_pull이 사본 갱신으로 새지 않음)', async () => {
  const h = harness();
  const handler = createHandler({ env, fetcher: async () => Response.json({}), now: () => now });
  assert.equal((await handler(new Request('https://edge.test/drive-summary?action=collector_pull', { method: 'OPTIONS' }))).status, 204);
  await h.post(owner);
  assert.equal(h.calls.some(c => /googleapis/.test(c.url)), false, 'Drive를 건드리지 않음');
});
