import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { withEdgeShared } from './helpers/edge-shared.mjs';
import { drivePlace, metaUrl, parsePlaceRequest } from '../../supabase/functions/workspace-drive/drive-place.mjs';
import { gatherCandidates, gatherFolders, gatherIntoNewRoot, GatherError, parseGatherRequest } from '../../supabase/functions/_shared/gather-folders.mjs';
import { DriveFail, MIRROR_BUDGET_MS, mirrorLibrary, parseMirrorBody } from '../../supabase/functions/_shared/library-mirror.mjs';

// EDGE-워크스페이스401: workspace-drive (verify_jwt=false, auth in code) answers 401 when the caller is not logged in
// (no token, malformed, forged, revoked, or expired) so runtime-client.js refreshes the session once and retries.
// Input errors keep 400 and an auth server outage keeps 400 (a second 401 would make the app drop a valid session).
// Runs the real handler against a mocked Supabase; no network calls.
const SOURCE = stripTypeScriptTypes(
  withEdgeShared(readFileSync(new URL('../../supabase/functions/workspace-drive/index.ts', import.meta.url), 'utf8')).replace(/^import .*$/gm, ''),
  { mode: 'strip' }
);

const AUTH = {
  'token-a': { data: { user: { id: 'user-a' } }, error: null },
  'not-a-jwt': { data: { user: null }, error: { status: 403, code: 'bad_jwt', message: 'invalid JWT' } },
  'expired-jwt': { data: { user: null }, error: { status: 403, code: 'bad_jwt', message: 'token is expired' } },
  'revoked-jwt': { data: { user: null }, error: { status: 401, message: 'Unauthorized' } },
  'no-status': { data: { user: null }, error: { message: 'invalid JWT' } },
  'no-user': { data: { user: null }, error: null },
  'auth-down': { data: { user: null }, error: { status: 503, message: 'Service Unavailable' } },
  'auth-offline': { data: { user: null }, error: { status: 0, message: 'fetch failed' } }
};

function harness() {
  const calls = { db: [], fetch: [] };
  const query = table => {
    const b = {
      select: () => b, eq: () => b, is: () => b, gt: () => b, limit: async () => { calls.db.push(table); return { data: [], error: null }; }, insert: async () => ({ error: null }), update: () => b, upsert: async () => ({ error: null }),
      maybeSingle: async () => { calls.db.push(table); return { data: null, error: null }; },
      single: async () => { calls.db.push(table); return { data: null, error: { message: 'unexpected' } }; }
    };
    return b;
  };
  const client = { auth: { getUser: async token => AUTH[token] || AUTH['no-status'] }, from: query };
  let handler = null;
  const Deno = {
    env: { get: key => ({ SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service' }[key]) },
    serve: fn => { handler = fn; }
  };
  const quiet = { log: () => {}, error: () => {}, warn: () => {} };
  const readMultipartForm = async () => new FormData();
  const fetchMock = async url => { calls.fetch.push(String(url)); throw new Error('unexpected fetch ' + url); };
  new Function('Deno', 'createClient', 'readMultipartForm', 'fetch', 'console', 'drivePlace', 'metaUrl', 'parsePlaceRequest', 'DriveFail', 'MIRROR_BUDGET_MS', 'mirrorLibrary', 'parseMirrorBody', 'gatherCandidates', 'gatherFolders', 'gatherIntoNewRoot', 'GatherError', 'parseGatherRequest', SOURCE)(Deno, () => client, readMultipartForm, fetchMock, quiet, drivePlace, metaUrl, parsePlaceRequest, DriveFail, MIRROR_BUDGET_MS, mirrorLibrary, parseMirrorBody, gatherCandidates, gatherFolders, gatherIntoNewRoot, GatherError, parseGatherRequest);
  return { handler, calls };
}

async function send(h, { token = null, method = 'POST', action = '', body } = {}) {
  const u = new URL('https://sb.example/functions/v1/workspace-drive');
  if (action) u.searchParams.set('action', action);
  const headers = { 'Content-Type': 'application/json', Origin: 'https://desk.bokdoong.com' };
  if (token !== null) headers.Authorization = 'Bearer ' + token;
  const response = await h.handler(new Request(u, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await response.text();
  let data = null; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, body: data, headers: response.headers };
}

const REQUESTS = [
  { body: {} },
  { action: 'upload' },
  { action: 'download-token', body: { document_id: 'doc-1' } },
  { action: 'unknown', body: {} }
];

test('workspace-drive: no Authorization header or an empty bearer answers 401 before any DB or Drive call', async () => {
  for (const token of [null, '']) {
    for (const req of REQUESTS) {
      const h = harness();
      const r = await send(h, { token, ...req });
      assert.equal(r.status, 401, `${JSON.stringify(req)} with token ${JSON.stringify(token)}`);
      assert.match(r.body.error, /로그인/);
      assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://desk.bokdoong.com', 'CORS headers stay on the 401');
      assert.deepEqual(h.calls, { db: [], fetch: [] });
    }
  }
});

test('workspace-drive: malformed, forged, revoked, or expired tokens answer 401 before any DB or Drive call', async () => {
  for (const token of ['not-a-jwt', 'expired-jwt', 'revoked-jwt', 'no-status', 'no-user']) {
    for (const req of REQUESTS) {
      const h = harness();
      const r = await send(h, { token, ...req });
      assert.equal(r.status, 401, `${token} ${JSON.stringify(req)}`);
      assert.match(r.body.error, /로그인 세션을 확인할 수 없습니다/);
      assert.deepEqual(h.calls, { db: [], fetch: [] });
    }
  }
});

test('workspace-drive: an auth server outage keeps 400 so the app does not drop a valid session', async () => {
  for (const token of ['auth-down', 'auth-offline']) {
    const h = harness();
    const r = await send(h, { token, action: 'download-token', body: { document_id: 'doc-1' } });
    assert.equal(r.status, 400, token);
    assert.match(r.body.error, /로그인 세션을 확인할 수 없습니다/);
    assert.deepEqual(h.calls, { db: [], fetch: [] });
  }
});

test('workspace-drive: input errors of a logged-in caller stay 400', async () => {
  const h = harness();
  const missingDoc = await send(h, { token: 'token-a', action: 'download-token', body: {} });
  assert.equal(missingDoc.status, 400);
  assert.match(missingDoc.body.error, /document_id/);
  const missingFile = await send(h, { token: 'token-a', action: 'upload' });
  assert.equal(missingFile.status, 400);
  assert.match(missingFile.body.error, /프로젝트와 파일/);
  const unknown = await send(h, { token: 'token-a', action: 'nope', body: {} });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, 'Unknown action');
});

test('workspace-drive: a non-authentication failure of a logged-in caller stays 400 (not found is not a login problem)', async () => {
  const h = harness();
  const r = await send(h, { token: 'token-a', action: 'download-token', body: { document_id: 'missing' } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /파일을 찾을 수 없습니다/);
});

test('workspace-drive: the download link without a token keeps 400 and CORS preflight still answers', async () => {
  const h = harness();
  const dl = await send(h, { method: 'GET', action: 'download' });
  assert.equal(dl.status, 400);
  const pre = await h.handler(new Request('https://sb.example/functions/v1/workspace-drive', { method: 'OPTIONS', headers: { Origin: 'https://mj880616.github.io' } }));
  assert.equal(pre.status, 200);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), 'https://mj880616.github.io');
  const foreign = await h.handler(new Request('https://sb.example/functions/v1/workspace-drive', { method: 'OPTIONS', headers: { Origin: 'https://bokdoong.com.evil.example' } }));
  assert.equal(foreign.status, 200);
  assert.equal(foreign.headers.get('Access-Control-Allow-Origin'), null);
});

// S69-20 ①: 자료실 저장 위치(GET ?action=drive-place)도 같은 로그인 확인 뒤에만, 자기 owner 작업공간만. 남의 것·없는 작업공간은 드라이브를 부르지 않는다.
test('workspace-drive drive-place: 로그인 없으면 401(DB·드라이브 호출 없음), owner 작업공간이 없으면 403(드라이브 호출 없음), 다른 값이 붙으면 400', async () => {
  for (const token of [null, '', 'not-a-jwt', 'expired-jwt']) {
    const h = harness();
    const r = await send(h, { token, method: 'GET', action: 'drive-place' });
    assert.equal(r.status, 401, String(token));
    assert.deepEqual(h.calls, { db: [], fetch: [] });
  }
  const h = harness();
  const r = await send(h, { token: 'token-a', method: 'GET', action: 'drive-place' });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.deepEqual(h.calls.fetch, []);
  const extra = harness();
  const u = new URL('https://sb.example/functions/v1/workspace-drive?action=drive-place&folder_id=x');
  const res = await extra.handler(new Request(u, { method: 'GET', headers: { Authorization: 'Bearer token-a', Origin: 'https://desk.bokdoong.com' } }));
  assert.equal(res.status, 400);
  assert.deepEqual(extra.calls, { db: [], fetch: [] });
});

// S69-20 ③④⑤: 드라이브 폴더 맞추기(POST ?action=drive-mirror)도 로그인 확인 뒤, 자기 owner 작업공간만, 정해진 모양만.
test('workspace-drive drive-mirror: 로그인 없으면 401, owner 작업공간이 없으면 403(드라이브 호출 없음), 모양이 틀리면 400', async () => {
  for (const token of [null, '', 'not-a-jwt']) {
    const h = harness();
    const r = await send(h, { token, action: 'drive-mirror', body: { mode: 'auto' } });
    assert.equal(r.status, 401, String(token));
    assert.deepEqual(h.calls, { db: [], fetch: [] });
  }
  const h = harness();
  const r = await send(h, { token: 'token-a', action: 'drive-mirror', body: { mode: 'auto' } });
  assert.equal(r.status, 403, '남의 작업공간·owner 아님은 거절');
  assert.deepEqual(h.calls.fetch, []);
  // S70-76: [드라이브 폴더 맞추기]('align')는 지웠다 — 모양이 틀린 요청과 같이 400.
  for (const body of [{}, { mode: 'all' }, { mode: 'align' }, { mode: 'auto', workspace_id: 'x' }, null]) {
    const b = harness();
    const bad = await send(b, { token: 'token-a', action: 'drive-mirror', body });
    assert.equal(bad.status, 400, JSON.stringify(body));
    assert.deepEqual(b.calls, { db: [], fetch: [] });
  }
});

// S70-76: [드라이브와 맞는지 보기](POST ?action=drive-check)는 지웠다 — 로그인해도 알 수 없는 요청(400), DB·드라이브 호출 없음.
test('workspace-drive drive-check: 지운 갈래라 400(DB·드라이브 호출 없음)', async () => {
  for (const body of [{ op: 'scan' }, { op: 'fix', all: true }, { op: 'undo', batch: 'abcdefgh1' }]) {
    const h = harness();
    const r = await send(h, { token: 'token-a', action: 'drive-check', body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(h.calls.fetch, []);
  }
  assert.doesNotMatch(SOURCE, /drive-check'|scanLibrary|fixLibrary|undoLibrary/);
});

// S69-22: [앱 폴더 모으기](POST ?action=gather-folders)도 같은 로그인 확인 뒤에만, 자기 owner 작업공간만. 폴더 id 같은 다른 값은 400.
test('workspace-drive gather-folders: 로그인 없으면 401(DB·드라이브 호출 없음), owner 작업공간이 없으면 403(드라이브 호출 없음), 다른 값은 400', async () => {
  for (const token of [null, '', 'not-a-jwt', 'expired-jwt']) {
    const h = harness();
    const r = await send(h, { token, action: 'gather-folders', body: { dry_run: true } });
    assert.equal(r.status, 401, String(token));
    assert.deepEqual(h.calls, { db: [], fetch: [] });
  }
  const h = harness();
  const r = await send(h, { token: 'token-a', action: 'gather-folders', body: {} });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.deepEqual(h.calls.fetch, []);
  for (const body of [{ root_id: 'someone-else-folder' }, { dry_run: 'yes' }, []]) {
    const x = harness();
    const res = await send(x, { token: 'token-a', action: 'gather-folders', body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual(x.calls, { db: [], fetch: [] });
  }
  const getAsk = harness();
  assert.notEqual((await send(getAsk, { token: 'token-a', method: 'GET', action: 'gather-folders' })).status, 200, 'GET으로는 옮기지 않는다');
  assert.match(SOURCE, /if\(!dryRun\)return json\(\{error:'더 이상 쓰지 않는 요청입니다\.',code:'gone'\},410\);/, 'S70-29: 옮기기 요청(dry_run 없음)은 410 — 버튼이 없어졌고 맨 위 앱 폴더를 처음 만들 때 서버가 저절로 한다');
  assert.doesNotMatch(SOURCE, /if\(!root\)root=await ensureRoot\(own,token\)/, '세기 요청은 맨 위 앱 폴더를 만들지 않는다');
  assert.deepEqual(getAsk.calls.fetch, []);
});
