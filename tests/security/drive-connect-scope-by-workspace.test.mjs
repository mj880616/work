// S71-01 AUTH-구글권한나누기(명진 2026-11-26 'ㄱ', S62-11을 바꿈): Drive 연결 창구·권한을 서버가 정한다.
// 실제 public-policy-drive 함수를 지어낸 Supabase(PostgREST)·지어낸 Google로 돌린다. 네트워크·비밀값 없음(모두 가짜 글자).
// - 운영자 아님: 늘 심사용 창구·drive.file만(화면 값 무시). include_granted_scopes 없음. 옛 자리(id=1)를 건드리지 않는다.
// - 운영자 + 명진 전용 창구 비밀값 있음: 명진 전용 클라이언트 ID·drive 하나. 콜백은 그 창구로 코드를 바꾸고 창구 기록 'full', id=1도 갱신.
// - 운영자 + 비밀값 없음: 심사용 창구·drive.file 그대로.
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
const FULL_ID = 'synthetic-full-client.apps.googleusercontent.com', FULL_SECRET = 'synthetic-full-secret';
function reset({ operatorFeatures = ['calls', 'gdrive_photos', 'files'], grantedScope = FILE, stateUser = OTHER_USER, fullSecrets = true } = {}) {
  W = { operatorFeatures, grantedScope, stateUser, fullSecrets, states: [], conn: [], id1: [], clients: [], tokenClients: [], calls: [] };
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
    if (p === '/rest/v1/app_drive_connection_clients' && method === 'PATCH') return ok([]);
    if (p === '/rest/v1/app_drive_connection_clients' && method === 'POST') { W.clients.push(JSON.parse(init.body)); return ok(null, 201); }
  }
  if (u.host === 'oauth2.googleapis.com' && p === '/token') {
    W.tokenClients.push(new URLSearchParams(String(init.body)).get('client_id'));
    return ok({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh-token', scope: W.grantedScope });
  }
  if (u.host === 'www.googleapis.com' && p === '/drive/v3/about') return ok({ user: {} });
  throw new Error('unexpected fetch ' + method + ' ' + u.host + p);
}

let handler;
globalThis.Deno = {
  env: { get: k => ({ SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
    ...(W.fullSecrets ? { GOOGLE_DRIVE_FULL_CLIENT_ID: FULL_ID, GOOGLE_DRIVE_FULL_CLIENT_SECRET: FULL_SECRET } : {}) })[k] },
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
  const u = d.url ? new URL(d.url) : null;
  return { status: r.status, scopes: u ? u.searchParams.get('scope').split(' ').sort() : null, client: u?.searchParams.get('client_id'), params: u?.searchParams, d };
}
async function callback(state = 'drive.synthetic-state') {
  const r = await handler(new Request(`${SB}/functions/v1/public-policy-drive/callback?code=synthetic-code&state=${state}`));
  assert.equal(r.status, 302);
  return new URL(r.headers.get('location'));
}

test('운영자 아님: 늘 심사용 창구·drive.file만, include_granted_scopes 없음(화면 값 무시)', async () => {
  reset();
  const r = await start('synthetic-other-jwt');
  assert.equal(r.status, 200);
  assert.deepEqual(r.scopes, [FILE]);
  assert.equal(r.client, 'synthetic-client');
  assert.equal(r.params.get('include_granted_scopes'), null);
  assert.equal(r.params.get('access_type'), 'offline');
  assert.doesNotMatch(r.params.get('state'), /\.full\./);
  const forged = await start('synthetic-other-jwt', { action: 'drive-start', full: true, scope: FULL, scopes: [FULL, 'https://www.googleapis.com/auth/gmail.readonly'], workspace_id: OP_WS, client: 'full' });
  assert.deepEqual(forged.scopes, [FILE]);
  assert.equal(forged.client, 'synthetic-client');
});

test('운영자 + 명진 전용 창구 비밀값: 명진 전용 클라이언트 ID·drive 하나, state에 창구 표시', async () => {
  reset({ stateUser: OP_USER });
  const r = await start('synthetic-op-jwt');
  assert.equal(r.status, 200);
  assert.deepEqual(r.scopes, [FULL]);
  assert.equal(r.client, FULL_ID);
  assert.equal(r.params.get('include_granted_scopes'), null);
  assert.match(r.params.get('state'), /^drive\.full\./);
  assert.doesNotMatch(r.d.url, /synthetic-full-secret/);
  assert.ok(W.calls.some(c => c.path === '/rest/v1/rpc/app_operator_feature_workspace'), 'operator is decided by the server allow-list');
});

test('운영자 + 비밀값 없음: 심사용 창구·drive.file 그대로(깨지지 않음)', async () => {
  reset({ fullSecrets: false });
  const r = await start('synthetic-op-jwt');
  assert.deepEqual(r.scopes, [FILE]);
  assert.equal(r.client, 'synthetic-client');
  assert.doesNotMatch(r.params.get('state'), /\.full\./);
});

test('로그인 없음·작업공간 없음은 연결 요청 거절', async () => {
  reset();
  assert.equal((await start('synthetic-unknown-jwt')).status, 403);
  assert.equal(W.states.length, 0);
});

test('콜백 운영자 아님(심사용 창구): 자기 작업공간 행에 full_drive=false·창구 review, id=1 그대로, 사진 안내 없음', async () => {
  reset({ stateUser: OTHER_USER, grantedScope: FILE });
  const loc = await callback();
  assert.equal(loc.searchParams.get('drive'), 'connected');
  assert.equal(loc.searchParams.get('photos'), null);
  assert.deepEqual(W.tokenClients, ['synthetic-client']);
  assert.equal(W.conn.length, 1);
  assert.equal(W.conn[0].workspace_id, OTHER_WS);
  assert.equal(W.conn[0].full_drive, false);
  assert.deepEqual(W.clients.map(c => [c.workspace_id, c.oauth_client]), [[OTHER_WS, 'review']]);
  assert.equal(W.id1.length, 0, 'never writes the operator id=1 row');
  // 심사용 창구에 drive가 섞여 와도 full로 적지 않는다.
  reset({ stateUser: OTHER_USER, grantedScope: `${FILE} ${FULL}` });
  await callback();
  assert.equal(W.conn[0].full_drive, false);
});

test('콜백 운영자(명진 전용 창구): 그 창구로 코드 교환, full_drive=true·창구 full, id=1도 갱신', async () => {
  reset({ stateUser: OP_USER, grantedScope: FULL });
  const loc = await callback('drive.full.synthetic-state');
  assert.equal(loc.searchParams.get('drive'), 'connected');
  assert.equal(loc.searchParams.get('photos'), null);
  assert.deepEqual(W.tokenClients, [FULL_ID]);
  assert.equal(W.conn[0].workspace_id, OP_WS);
  assert.equal(W.conn[0].full_drive, true);
  assert.deepEqual(W.clients.map(c => [c.workspace_id, c.oauth_client]), [[OP_WS, 'full']]);
  assert.equal(W.id1.length, 1);
  // drive.readonly처럼 비슷한 이름은 전체 권한이 아니다 → 사진 안내.
  reset({ stateUser: OP_USER, grantedScope: `${FULL}.readonly` });
  const loc2 = await callback('drive.full.synthetic-state');
  assert.equal(W.conn[0].full_drive, false);
  assert.equal(loc2.searchParams.get('photos'), 'scope_missing');
});

test('콜백: 명진 전용 창구 state인데 운영자가 아니거나 비밀값이 없으면 저장하지 않는다', async () => {
  reset({ stateUser: OTHER_USER, grantedScope: FULL });
  const loc = await callback('drive.full.synthetic-state');
  assert.equal(loc.searchParams.get('drive'), 'error');
  assert.equal(W.conn.length + W.clients.length + W.id1.length, 0);
  reset({ stateUser: OP_USER, grantedScope: FULL, fullSecrets: false });
  const loc2 = await callback('drive.full.synthetic-state');
  assert.equal(loc2.searchParams.get('drive'), 'error');
  assert.equal(W.tokenClients.length, 0, 'no code exchange without the full client');
  assert.equal(W.conn.length + W.clients.length, 0);
});

test('운영자 + 비밀값 없음 콜백: 심사용 창구로 저장, 사진 안내(전체 권한 없음)', async () => {
  reset({ stateUser: OP_USER, grantedScope: FILE, fullSecrets: false });
  const loc = await callback();
  assert.equal(loc.searchParams.get('drive'), 'connected');
  assert.equal(loc.searchParams.get('photos'), 'scope_missing');
  assert.deepEqual(W.tokenClients, ['synthetic-client']);
  assert.deepEqual(W.clients.map(c => c.oauth_client), ['review']);
});

test('토큰·비밀값을 응답 주소에 싣지 않는다', async () => {
  reset({ stateUser: OP_USER, grantedScope: FULL });
  const loc = await callback('drive.full.synthetic-state');
  assert.doesNotMatch(loc.toString(), /synthetic-(refresh|access|secret|full-secret)/);
});
