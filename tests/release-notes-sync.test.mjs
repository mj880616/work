// UPDATE-운영자전용기록업데이트소식 PR1: Edge release-notes-sync 입구 검사(네트워크 없음, 가짜 GitHub 키·가짜 DB).
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createReleaseNotesSyncHandler,claimProblem,notesProblem,ISSUER,AUDIENCE,WORKFLOW_REF} from '../supabase/functions/release-notes-sync/handler.mjs';

const subtle = webcrypto.subtle;
const enc = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
const SHA = 'a'.repeat(40);
const NOW = 1_800_000_000;
const good = {iss: ISSUER, aud: AUDIENCE, exp: NOW + 300, nbf: NOW - 10, repository: 'mj880616/work', ref: 'refs/heads/main',
  job_workflow_ref: WORKFLOW_REF, event_name: 'push', sha: SHA};
const NOTES = {schema: 1, current: '11/15-1', notes: [{v: '11/15-1', date: '2026-11-15', changes: ['가상 바뀐 점'], checks: []}]};

async function setup() {
  const pair = await subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, true, ['sign', 'verify']);
  const other = await subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, true, ['sign', 'verify']);
  const pub = await subtle.exportKey('jwk', pair.publicKey);
  const sign = async (claims, key = pair.privateKey, kid = 'k1') => {
    const head = enc({alg: 'RS256', kid, typ: 'JWT'}), body = enc(claims);
    const sig = Buffer.from(await subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`))).toString('base64url');
    return `${head}.${body}.${sig}`;
  };
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({url, init});
    if (url.endsWith('/.well-known/jwks')) return new Response(JSON.stringify({keys: [{...pub, kid: 'k1', alg: 'RS256', use: 'sig'}]}));
    if (url.endsWith('/rest/v1/rpc/app_release_notes_put')) return new Response('{"ok":true}');
    return new Response('no', {status: 404});
  };
  const env = name => ({SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service-key'})[name];
  const handle = createReleaseNotesSyncHandler({env, fetchImpl, subtle, now: () => NOW});
  const post = (token, body = NOTES) => handle(new Request('https://x/functions/v1/release-notes-sync', {method: 'POST', headers: token ? {authorization: `Bearer ${token}`} : {}, body: JSON.stringify(body)}));
  return {sign, other, calls, handle, post};
}

test('토큰 없음·틀린 서명·다른 저장소·다른 가지·다른 workflow는 401, 저장 안 함', async () => {
  const {sign, other, calls, post} = await setup();
  assert.equal((await post(null)).status, 401);
  assert.equal((await post('a.b.c')).status, 401);
  assert.equal((await post(await sign(good, other.privateKey))).status, 401);
  for (const bad of [{repository: 'someone/work'}, {ref: 'refs/heads/feature'}, {job_workflow_ref: 'mj880616/work/.github/workflows/other.yml@refs/heads/main', workflow_ref: 'x'},
    {event_name: 'pull_request'}, {aud: 'other'}, {iss: 'https://evil.invalid'}, {exp: NOW - 100}, {sha: 'main'}])
    assert.equal((await post(await sign({...good, ...bad}))).status, 401, JSON.stringify(bad));
  assert.equal(calls.filter(c => c.url.includes('/rpc/')).length, 0);
});

test('맞는 토큰이면 토큰의 커밋으로 service_role 저장 함수를 부른다', async () => {
  const {sign, calls, post} = await setup();
  const res = await post(await sign(good));
  assert.equal(res.status, 200);
  const rpc = calls.find(c => c.url.endsWith('/rest/v1/rpc/app_release_notes_put'));
  assert.ok(rpc);
  assert.deepEqual(JSON.parse(rpc.init.body), {p_notes: NOTES, p_commit: SHA});
  assert.equal(rpc.init.headers.authorization, 'Bearer service-key');
});

test('모양이 틀린 내용은 400, 저장 안 함', async () => {
  const {sign, calls, post} = await setup();
  assert.equal((await post(await sign(good), {schema: 2, notes: []})).status, 400);
  assert.equal((await post(await sign(good), {schema: 1, notes: [{v: 1}]})).status, 400);
  assert.equal(calls.filter(c => c.url.includes('/rpc/')).length, 0);
});

test('OPTIONS 204, GET 405', async () => {
  const {handle} = await setup();
  assert.equal((await handle(new Request('https://x/', {method: 'OPTIONS'}))).status, 204);
  assert.equal((await handle(new Request('https://x/', {method: 'GET'}))).status, 405);
});

test('claimProblem·notesProblem', () => {
  assert.equal(claimProblem(good, NOW), '');
  assert.equal(claimProblem({...good, aud: [AUDIENCE, 'x']}, NOW), '');
  assert.equal(claimProblem({...good, job_workflow_ref: undefined, workflow_ref: WORKFLOW_REF}, NOW), '');
  assert.equal(notesProblem(NOTES), '');
  assert.equal(notesProblem([]), 'shape');
});
