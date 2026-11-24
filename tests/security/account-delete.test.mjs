import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// S69 STORE-계정삭제: Edge 함수 account-delete. 실제 handler, 가짜 Supabase(가짜 fetch) — 운영 접속 없음.
// 지키는 것: 비로그인·위임 열쇠 401, 확인 글자 틀리면 DB를 부르지 않음, 화면이 보낸 id는 DB에 넘기지 않음,
// 파일은 DB가 돌려준 받는 모양만 서버 키로 지움, 지운 뒤 모든 로그인 끊기, 거절 이유는 이름만, 로그에 경로·토큰 없음.
const { createAccountDeleteHandler, filesByBucket, CONFIRM_WORD } = await import('../../supabase/functions/account-delete/handler.ts');
const SB = 'https://synthetic.supabase.test';
const USER = '20000000-0000-4000-8000-000000000001';
const PAGE = '31000000-0000-4000-8000-00000000000a', MEDIA = '32000000-0000-4000-8000-00000000000a', EVENT = '33000000-0000-4000-8000-00000000000a';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = payload => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
const LOGIN = jwt({ sub: USER, role: 'authenticated', aud: 'authenticated' });
const DELEGATED = jwt({ sub: USER, role: 'authenticated', aud: 'authenticated', client_id: 'outside-app' });
const env = key => ({ SUPABASE_URL: SB, SUPABASE_ANON_KEY: 'synthetic-anon', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-only' })[key];

function fake({ check = { ok: true }, del = { ok: true, files: [] }, delStatus = 200, storageStatus = 200 } = {}) {
  const calls = [];
  const fn = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
    calls.push({ url, method: init.method || 'GET', headers, body: init.body ? String(init.body) : '' });
    const out = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url === `${SB}/auth/v1/user`) return headers.authorization === 'Bearer bad' ? out({ msg: 'bad' }, 401) : out({ id: USER, role: 'authenticated' });
    if (url === `${SB}/rest/v1/rpc/app_account_delete_check`) return out(check);
    if (url === `${SB}/rest/v1/rpc/app_account_delete`) return out(del, delStatus);
    if (url.startsWith(`${SB}/storage/v1/object/`)) return out([], storageStatus);
    if (url === `${SB}/auth/v1/logout?scope=global`) return new Response(null, { status: 204 });
    return out({}, 404);
  };
  return { fn, calls };
}
const logs = [];
const make = f => createAccountDeleteHandler({ env, fetch: f.fn, log: c => logs.push(c) });
const post = (token, body, extra = {}) => new Request(`${SB}/functions/v1/account-delete`, {
  method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body),
});

test('no login, bad login and delegated key are 401 before any DB call', async () => {
  for (const token of ['', 'bad', DELEGATED]) {
    const f = fake(); const res = await make(f)(post(token, { action: 'delete', confirm: CONFIRM_WORD }));
    assert.equal(res.status, 401, token || 'none');
    assert.ok(!f.calls.some(c => c.url.includes('/rest/v1/') || c.url.includes('/storage/')), 'no DB or storage call');
  }
  const opt = await make(fake())(new Request(`${SB}/functions/v1/account-delete`, { method: 'OPTIONS' }));
  assert.equal(opt.status, 204);
  assert.equal((await make(fake())(new Request(`${SB}/functions/v1/account-delete`, { method: 'GET', headers: { Authorization: `Bearer ${LOGIN}` } }))).status, 405);
});

test('check passes the DB answer through with the user token only; refusal names only', async () => {
  let f = fake(); let res = await make(f)(post(LOGIN, { action: 'check', workspace_id: 'someone-else', user_id: 'someone-else' }));
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), { ok: true });
  const rpc = f.calls.find(c => c.url.endsWith('/rpc/app_account_delete_check'));
  assert.equal(rpc.headers.authorization, `Bearer ${LOGIN}`);
  assert.equal(rpc.headers.apikey, 'synthetic-anon');
  assert.equal(rpc.body, '{}', '화면이 보낸 id는 DB에 넘기지 않는다');
  f = fake({ check: { ok: false, code: 'ACCOUNT_OPERATOR_KEEP' } });
  assert.deepEqual(await (await make(f)(post(LOGIN, { action: 'check' }))).json(), { ok: false, code: 'ACCOUNT_OPERATOR_KEEP' });
  f = fake({ check: { ok: false, code: 'SOMETHING<script>' } });
  assert.deepEqual(await (await make(f)(post(LOGIN, { action: 'check' }))).json(), { ok: false, code: 'ACCOUNT_DELETE_UNAVAILABLE' });
});

test('delete needs the confirm word; wrong word never reaches the DB', async () => {
  for (const confirm of ['', '지우기', 'delete', null]) {
    const f = fake(); const res = await make(f)(post(LOGIN, { action: 'delete', confirm }));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { ok: false, code: 'ACCOUNT_CONFIRM_MISMATCH', error: 'ACCOUNT_CONFIRM_MISMATCH' });
    assert.ok(!f.calls.some(c => c.url.includes('/rest/v1/')));
  }
  const f = fake(); assert.equal((await make(f)(post(LOGIN, { action: 'wipe' }))).status, 400);
});

test('delete: DB with user token, only accepted file shapes removed with the server key, then every login ends', async () => {
  logs.length = 0;
  const files = [
    { b: 'share-page-media', p: `${PAGE}/${MEDIA}.jpg` },
    { b: 'team-event-media', p: `${EVENT}/p1.jpg` },
    { b: 'team-event-media', p: `${EVENT}/p1-thumb.jpg` },
    { b: 'team-event-media', p: `${EVENT}/p1.jpg` },
    { b: 'other-bucket', p: `${PAGE}/${MEDIA}.jpg` },
    { b: 'share-page-media', p: `../${PAGE}/x.jpg` },
    { b: 'share-page-media', p: `${PAGE}/${MEDIA}.png` },
  ];
  const f = fake({ del: { ok: true, files } });
  const res = await make(f)(post(LOGIN, { action: 'delete', confirm: CONFIRM_WORD, workspace_id: 'someone-else' }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, files_left: 0 });
  const rpc = f.calls.find(c => c.url.endsWith('/rpc/app_account_delete'));
  assert.equal(rpc.headers.authorization, `Bearer ${LOGIN}`);
  assert.deepEqual(JSON.parse(rpc.body), { p_confirm: '삭제' });
  const storage = f.calls.filter(c => c.url.includes('/storage/'));
  assert.deepEqual(storage.map(c => [c.method, c.url.slice(SB.length), JSON.parse(c.body)]), [
    ['DELETE', '/storage/v1/object/share-page-media', { prefixes: [`${PAGE}/${MEDIA}.jpg`] }],
    ['DELETE', '/storage/v1/object/team-event-media', { prefixes: [`${EVENT}/p1.jpg`, `${EVENT}/p1-thumb.jpg`] }],
  ]);
  for (const c of storage) assert.equal(c.headers.authorization, 'Bearer synthetic-service-only');
  const out = f.calls.at(-1);
  assert.equal(out.url, `${SB}/auth/v1/logout?scope=global`);
  assert.equal(out.headers.authorization, `Bearer ${LOGIN}`);
  // 서버 키는 버킷 요청에만, 사용자 토큰은 Auth·DB에만.
  for (const c of f.calls.filter(c => !c.url.includes('/storage/'))) assert.notEqual(c.headers.authorization, 'Bearer synthetic-service-only');
  assert.ok(logs.every(l => /^[a-z_]+$/.test(l)), 'logs are codes only');
});

test('delete: refusal names and failures; storage failure still reports done with a count', async () => {
  let f = fake({ del: { message: 'ACCOUNT_GROUP_ADMIN_MOVE' }, delStatus: 400 });
  let res = await make(f)(post(LOGIN, { action: 'delete', confirm: CONFIRM_WORD }));
  assert.equal(res.status, 409); assert.deepEqual(await res.json(), { ok: false, code: 'ACCOUNT_GROUP_ADMIN_MOVE', error: 'ACCOUNT_GROUP_ADMIN_MOVE' });
  assert.ok(!f.calls.some(c => c.url.includes('/storage/') || c.url.includes('/logout')));
  f = fake({ del: { message: 'function public.app_account_delete(text) does not exist' }, delStatus: 404 });
  res = await make(f)(post(LOGIN, { action: 'delete', confirm: CONFIRM_WORD }));
  assert.equal(res.status, 503); assert.deepEqual(await res.json(), { ok: false, code: 'NOT_READY', error: 'NOT_READY' });
  f = fake({ del: { message: 'boom' }, delStatus: 500 });
  res = await make(f)(post(LOGIN, { action: 'delete', confirm: CONFIRM_WORD }));
  assert.equal(res.status, 502); assert.deepEqual(await res.json(), { ok: false, code: 'DB_FAILED', error: 'DB_FAILED' });
  f = fake({ del: { ok: true, files: [{ b: 'share-page-media', p: `${PAGE}/${MEDIA}.jpg` }] }, storageStatus: 500 });
  res = await make(f)(post(LOGIN, { action: 'delete', confirm: CONFIRM_WORD }));
  assert.deepEqual(await res.json(), { ok: true, files_left: 1 });
  assert.ok(f.calls.some(c => c.url.endsWith('/logout?scope=global')));
});

test('filesByBucket keeps only known buckets and shapes, without duplicates', () => {
  assert.deepEqual([...filesByBucket([{ b: 'share-page-media', p: `${PAGE}/${MEDIA}.jpg` }, { b: 'x', p: 'y' }, null, 'z']).entries()], [['share-page-media', [`${PAGE}/${MEDIA}.jpg`]]]);
  assert.equal(filesByBucket('nope').size, 0);
});

test('static: index wires only env, web CORS and the handler; no new secret names', () => {
  const index = readFileSync('supabase/functions/account-delete/index.ts', 'utf8');
  assert.match(index, /withWebCors\(createAccountDeleteHandler\(\{ env: \(name: string\) => Deno\.env\.get\(name\) \}\)\)/);
  const handler = readFileSync('supabase/functions/account-delete/handler.ts', 'utf8');
  const names = [...new Set([...handler.matchAll(/env\("([A-Z_]+)"\)/g)].map(m => m[1]))].sort();
  assert.deepEqual(names, ['SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL']);
  assert.doesNotMatch(handler, /console\.log|admin\.auth|deleteUser|\/admin\/users/);
});
