import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

// EDGE-워크스페이스401: workspace-drive (verify_jwt=false, auth in code) answers 401 when the caller is not logged in
// (no token, malformed, forged, revoked, or expired) so runtime-client.js refreshes the session once and retries.
// Input errors keep 400 and an auth server outage keeps 400 (a second 401 would make the app drop a valid session).
// Runs the real handler against a mocked Supabase; no network calls.
const SOURCE = stripTypeScriptTypes(
  readFileSync(new URL('../../supabase/functions/workspace-drive/index.ts', import.meta.url), 'utf8').replace(/^import .*$/gm, ''),
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
      select: () => b, eq: () => b, is: () => b, gt: () => b, insert: async () => ({ error: null }), update: () => b, upsert: async () => ({ error: null }),
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
  new Function('Deno', 'createClient', 'readMultipartForm', 'fetch', 'console', SOURCE)(Deno, () => client, readMultipartForm, fetchMock, quiet);
  return { handler, calls };
}

async function send(h, { token = null, method = 'POST', action = '', body } = {}) {
  const u = new URL('https://sb.example/functions/v1/workspace-drive');
  if (action) u.searchParams.set('action', action);
  const headers = { 'Content-Type': 'application/json' };
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
      assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*', 'CORS headers stay on the 401');
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
  const pre = await h.handler(new Request('https://sb.example/functions/v1/workspace-drive', { method: 'OPTIONS' }));
  assert.equal(pre.status, 200);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), '*');
});
