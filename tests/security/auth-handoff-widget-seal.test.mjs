// 폰 위젯 자동 로그인: auth-handoff widget_seal(docs/design/phone-widget-auth.md 12절).
// 실제 Edge 코드를 독립 JS 환경에서 돌리고 Auth·REST 전송만 가짜로 바꾼다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { webcrypto } from 'node:crypto';

const SUBJECT = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const SB = 'https://auth.example.invalid';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const raw = readFileSync(new URL('../../supabase/functions/auth-handoff/index.ts', import.meta.url), 'utf8');
const source = stripTypeScriptTypes(raw.replace(/^import .*\r?\n/gm, ''), { mode: 'strip' });

function harness({ user = { id: SUBJECT, email: 'owner@example.invalid' }, userStatus = 200, link = null, linkStatus = 200, verify = null, verifyStatus = 200, claim = true } = {}) {
  let handler;
  const calls = [];
  const Deno = {
    env: { get: key => ({ SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-test-only', SUPABASE_ANON_KEY: 'synthetic-public' })[key] },
    serve: fn => { handler = fn; }
  };
  const fetch = async (url, init = {}) => {
    calls.push(url);
    if (url === SB + '/auth/v1/user') {
      assert.equal(init.headers.Authorization, 'Bearer synthetic-access');
      assert.equal(init.headers.apikey, 'synthetic-public');
      return json(user, userStatus);
    }
    if (url === SB + '/auth/v1/admin/generate_link') {
      // 서비스 키는 서버 안에서만 Auth 관리자 요청에 쓴다. 메일을 보내지 않는 링크 만들기이고, 주소는 Auth가 확인한 사용자 것만.
      assert.equal(init.headers.Authorization, 'Bearer synthetic-test-only');
      const body = JSON.parse(init.body);
      assert.deepEqual(body, { type: 'magiclink', email: user.email });
      return json(link ?? { id: SUBJECT, email: user.email, hashed_token: 'synthetic-hash', action_link: 'https://synthetic-private-link' }, linkStatus);
    }
    if (url === SB + '/auth/v1/verify') {
      assert.equal(init.headers.apikey, 'synthetic-public');
      assert.deepEqual(JSON.parse(init.body), { type: 'magiclink', token_hash: 'synthetic-hash' });
      return json(verify ?? { access_token: 'synthetic-widget-access', refresh_token: 'synthetic-widget-refresh', expires_in: 3600, user: { id: SUBJECT } }, verifyStatus);
    }
    if (url === SB + '/rest/v1/rpc/app_consume_auth_handoff') return json(claim);
    if (url === SB + '/auth/v1/token?grant_type=refresh_token') {
      assert.equal(JSON.parse(init.body).refresh_token, 'synthetic-widget-refresh');
      return json({ access_token: 'synthetic-access-2', refresh_token: 'synthetic-refresh-2', expires_in: 3600, user: { id: SUBJECT } });
    }
    throw new Error('unexpected ' + url);
  };
  new Function('Deno', 'fetch', 'crypto', 'Date', source)(Deno, fetch, webcrypto, Date);
  const send = (body, { origin = 'https://bokdoong.com', auth = true } = {}) => handler(new Request('https://edge.example.invalid/auth-handoff', {
    method: 'POST',
    headers: { ...(origin === null ? {} : { Origin: origin }), 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer synthetic-access' } : {}) },
    body: JSON.stringify(body)
  }));
  return { send, calls };
}

test('로그인된 사용자는 위젯 전용 새 세션을 봉인으로만 받고, consume으로 그 세션이 열린다', async () => {
  const h = harness();
  const r = await h.send({ action: 'widget_seal', user: OTHER, email: 'other@example.invalid' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  const text = await r.text();
  // 원문 토큰·링크·메일 주소는 응답에 없다.
  assert.doesNotMatch(text, /synthetic-|access_token|refresh_token|example\.invalid/);
  const { token } = JSON.parse(text);
  assert.match(token, /^[A-Za-z0-9_-]{16,}$/);
  const c = await h.send({ action: 'consume', token }, { auth: false });
  assert.equal(c.status, 200);
  assert.equal((await c.json()).session.user.id, SUBJECT);
});

test('허용 Origin이 아니거나 로그인이 없으면 Auth 관리자 요청을 하지 않는다', async () => {
  for (const origin of ['https://evil.example', null, 'null', 'https://www.bokdoong.com']) {
    const h = harness();
    assert.equal((await h.send({ action: 'widget_seal' }, { origin })).status, 403);
    assert.deepEqual(h.calls, []);
  }
  const noAuth = harness();
  assert.equal((await noAuth.send({ action: 'widget_seal' }, { auth: false })).status, 400);
  assert.deepEqual(noAuth.calls, []);
  const badAccess = harness({ userStatus: 401 });
  assert.equal((await badAccess.send({ action: 'widget_seal' })).status, 401);
  assert.deepEqual(badAccess.calls, [SB + '/auth/v1/user']);
});

test('익명·메일 없는 사용자는 거절하고 링크를 만들지 않는다', async () => {
  for (const user of [{ id: SUBJECT, email: 'a@example.invalid', is_anonymous: true }, { id: SUBJECT, email: '' }, { id: SUBJECT }, { id: 'bad', email: 'a@example.invalid' }]) {
    const h = harness({ user });
    assert.equal((await h.send({ action: 'widget_seal' })).status, 401);
    assert.deepEqual(h.calls, [SB + '/auth/v1/user']);
  }
});

test('링크·확인 결과가 다른 사용자이거나 실패하면 봉인을 주지 않고 내부 내용을 내보내지 않는다', async () => {
  const cases = [
    { linkStatus: 500, link: { msg: 'synthetic-private-detail' } },
    { link: { id: OTHER, hashed_token: 'synthetic-hash' } },
    { link: { id: SUBJECT } },
    { verifyStatus: 400, verify: { error_description: 'synthetic-private-detail' } },
    { verify: { access_token: 'x', refresh_token: 'synthetic-widget-refresh', user: { id: OTHER } } },
    { verify: { access_token: 'x', user: { id: SUBJECT } } }
  ];
  for (const options of cases) {
    const h = harness(options);
    const r = await h.send({ action: 'widget_seal' });
    assert.equal(r.status, 502);
    const text = await r.text();
    assert.doesNotMatch(text, /synthetic-|access_token|refresh_token|hashed/);
    assert.equal(h.calls.includes(SB + '/rest/v1/rpc/app_consume_auth_handoff'), false);
  }
});

test('supabase-js 모양(properties.hashed_token, user.id)의 링크 응답도 받는다', async () => {
  const h = harness({ link: { properties: { hashed_token: 'synthetic-hash' }, user: { id: SUBJECT } } });
  assert.equal((await h.send({ action: 'widget_seal' })).status, 200);
});
