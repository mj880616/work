// S50-8 MULTI-노조사용자(사용자 결정 11/05 '가'): Drive 연결 권한 범위를 작업공간 기준으로 서버가 정한다.
// 실제 public-policy-drive 함수를 지어낸 Supabase(PostgREST)·지어낸 Google로 돌린다. 네트워크·비밀값 없음(모두 가짜 글자).
// - S62-11부터 모든 작업공간: drive.file + drive 요청, 받은 권한으로 full_drive, 빠지면 사진 안내. 운영자가 아니면 옛 자리(id=1)를 건드리지 않는다.
// - 운영자: 지금과 같다(drive.file + drive, 받은 권한으로 full_drive, 빠지면 사진 안내, id=1도 갱신).
import test from 'node:test';
import assert from 'node:assert/strict';

const SB = 'https://sb.example.test';
const OP_WS = 'a0000000-0000-4000-8000-000000000001', OTHER_WS = 'a0000000-0000-4000-8000-000000000002';
const OP_USER = 'b0000000-0000-4000-8000-000000000001', OTHER_USER = 'b0000000-0000-4000-8000-000000000002';
const JWT = { 'synthetic-op-jwt': OP_USER, 'synthetic-other-jwt': OTHER_USER };
const WS_OF = { [OP_USER]: OP_WS, [OTHER_USER]: OTHER_WS };
const FILE = 'https://www.googleapis.com/auth/drive.file', FULL = 'https://www.googleapis.com/auth/drive';

// 바뀌는 상태(시험마다 새로)
let W;
function reset({ operatorFeatures = ['calls', 'gdrive_photos', 'files'], grantedScope = `${FILE} ${FULL}`, stateUser = OTHER_USER } = {}) {
  W = { operatorFeatures, grantedScope, stateUser, states: [], conn: [], id1: [], calls: [] };
}
reset();

const ok = (v, status = 200) => new Response(v === null ? null : JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
async function fakeFetch(url, init = {}) {
  const u = new URL(url), method = init.method || 'GET', h = init.headers || {};
  const p = u.pathname, q = u.search;
  W.calls.push({ method, host: u.host, path: p, search: q });
  if (u.host === 'sb.example.test') {
    if (p === '/auth/v1/user') {
      const id = JWT[String(h.Authorization || '').replace(/^Bearer\s+/, '')];
      return id ? ok({ id }) : ok({ msg: 'no' }, 401);
    }
    if (p === '/rest/v1/app_workspace_members') {
      const id = new URLSearchParams(q).get('user_id').replace(/^eq\./, '');
      return ok(WS_OF[id] ? [{ workspace_id: WS_OF[id], role: 'owner' }] : []);
    }
    if (p === '/rest/v1/rpc/app_operator_feature_workspace') {
      const f = JSON.parse(init.body).p_feature;
      return ok(W.operatorFeatures.includes(f) ? OP_WS : null);
    }
    if (p === '/rest/v1/public_policy_drive_config' && method === 'GET') return ok([{ google_client_id: 'synthetic-client', google_client_secret: 'synthetic-secret' }]);
    if (p === '/rest/v1/public_policy_drive_config' && method === 'PATCH') { W.id1.push(JSON.parse(init.body)); return ok(null, 204); }
    if (p === '/rest/v1/app_google_oauth_states' && method === 'POST') { W.states.push(JSON.parse(init.body)); return ok(null, 201); }
    if (p === '/rest/v1/app_google_oauth_states' && method === 'GET') return ok([{ user_id: W.stateUser }]);
    if (p === '/rest/v1/app_google_oauth_states' && method === 'DELETE') return ok(null, 204);
    if (p === '/rest/v1/app_drive_settings') return ok([]);
    if (p === '/rest/v1/app_drive_connections' && method === 'PATCH') return ok([]);
    if (p === '/rest/v1/app_drive_connections' && method === 'POST') { W.conn.push(JSON.parse(init.body)); return ok(null, 201); }
  }
  if (u.host === 'oauth2.googleapis.com' && p === '/token') {
    return ok({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh-token', scope: W.grantedScope });
  }
  if (u.host === 'www.googleapis.com' && p === '/drive/v3/about') return ok({ user: {} });
  throw new Error('unexpected fetch ' + method + ' ' + u.host + p);
}

let handler;
globalThis.Deno = {
  env: { get: k => ({ SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key' })[k] },
  serve: h => { handler = h; },
};
globalThis.fetch = fakeFetch;
await import('../../supabase/functions/public-policy-drive/index.ts');
assert.equal(typeof handler, 'function');

async function start(jwt, body = { action: 'drive-start' }) {
  const r = await handler(new Request(`${SB}/functions/v1/public-policy-drive`, {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', Origin: 'https://bokdoong.com' },
    body: JSON.stringify(body),
  }));
  const d = await r.json();
  return { status: r.status, scopes: d.url ? new URL(d.url).searchParams.get('scope').split(' ').sort() : null, d };
}
async function callback() {
  const r = await handler(new Request(`${SB}/functions/v1/public-policy-drive/callback?code=synthetic-code&state=drive.synthetic-state`));
  assert.equal(r.status, 302);
  return new URL(r.headers.get('location'));
}

// S62-11 MULTI-구글드라이브사진모두(사용자 11/14 '가'·11/15 결정 1 '가'): 모든 작업공간이 drive.file + drive를 요청한다.
test('S62-11 모든 작업공간: 연결 요청은 drive.file + drive(운영자 기능 키 판정 없음)', async () => {
  reset();
  const r = await start('synthetic-other-jwt');
  assert.equal(r.status, 200);
  assert.deepEqual(r.scopes, [FULL, FILE].sort());
  reset({ operatorFeatures: [] });
  assert.deepEqual((await start('synthetic-op-jwt')).scopes, [FULL, FILE].sort());
  assert.ok(!W.calls.some(c => c.path === '/rest/v1/rpc/app_operator_feature_workspace'), 'start does not ask operator features');
});

test('S62-11 화면이 무엇을 보내도 범위는 같다(drive.file + drive만, 다른 범위 없음)', async () => {
  reset();
  const r = await start('synthetic-other-jwt', { action: 'drive-start', full: false, scope: FILE, scopes: ['https://www.googleapis.com/auth/gmail.readonly'], workspace_id: OP_WS });
  assert.deepEqual(r.scopes, [FULL, FILE].sort());
});

test('로그인 없음·작업공간 없음은 연결 요청 거절', async () => {
  reset();
  assert.equal((await start('synthetic-unknown-jwt')).status, 403);
  assert.equal(W.states.length, 0);
});

test('S62-11 콜백 다른 작업공간: 받은 권한 그대로 자기 작업공간 행에(전체 받음 → true, 빠짐 → false + 사진 안내), id=1 그대로', async () => {
  reset({ stateUser: OTHER_USER, grantedScope: `${FILE} ${FULL}` });
  const loc = await callback();
  assert.equal(loc.searchParams.get('drive'), 'connected');
  assert.equal(loc.searchParams.get('photos'), null);
  assert.equal(W.conn.length, 1);
  assert.equal(W.conn[0].workspace_id, OTHER_WS);
  assert.equal(W.conn[0].full_drive, true);
  assert.equal(W.id1.length, 0, 'never writes the operator id=1 row');

  reset({ stateUser: OTHER_USER, grantedScope: FILE });
  const loc2 = await callback();
  assert.equal(loc2.searchParams.get('photos'), 'scope_missing');
  assert.equal(W.conn[0].full_drive, false);
  assert.equal(W.id1.length, 0);
  // drive.readonly처럼 비슷한 이름은 전체 권한이 아니다.
  reset({ stateUser: OTHER_USER, grantedScope: `${FILE} ${FULL}.readonly` });
  await callback();
  assert.equal(W.conn[0].full_drive, false);
});

test('콜백 운영자: 받은 권한 그대로(전체 받음 → true, 빠짐 → false + 사진 안내), id=1도 갱신', async () => {
  reset({ stateUser: OP_USER, grantedScope: `${FILE} ${FULL}` });
  const loc = await callback();
  assert.equal(loc.searchParams.get('photos'), null);
  assert.equal(W.conn[0].workspace_id, OP_WS);
  assert.equal(W.conn[0].full_drive, true);
  assert.equal(W.id1.length, 1);

  reset({ stateUser: OP_USER, grantedScope: FILE });
  const loc2 = await callback();
  assert.equal(loc2.searchParams.get('drive'), 'connected');
  assert.equal(loc2.searchParams.get('photos'), 'scope_missing');
  assert.equal(W.conn[0].full_drive, false);
});

test('토큰·비밀값을 응답 주소에 싣지 않는다', async () => {
  reset({ stateUser: OP_USER });
  const loc = await callback();
  assert.doesNotMatch(loc.toString(), /synthetic-(refresh|access|secret)/);
});
