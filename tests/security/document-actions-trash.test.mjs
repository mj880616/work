import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const source = stripTypeScriptTypes(readFileSync(new URL('../../supabase/functions/document-actions/index.ts', import.meta.url), 'utf8'), { mode: 'strip' });

function harness({ trashed = false, patchStatus = 200, getStatus = 200, role = 'owner' } = {}) {
  const calls = [];
  let handler;
  const fetchMock = async (url, init = {}) => {
    const path = String(url), method = init.method || 'GET';
    calls.push({ path, method, body: init.body });
    if (path.endsWith('/auth/v1/user')) return Response.json({ id: 'owner-1' });
    if (path.includes('public_policy_drive_config')) return Response.json([{ google_client_id: 'c', google_client_secret: 's', google_refresh_token: 'r' }]);
    if (path.includes('app_documents?id=')) {
      if (method === 'GET') return Response.json([{ id: 'doc-1', workspace_id: 'ws-1', file_id: 'file-1' }]);
      return new Response(null, { status: 204 });
    }
    if (path.includes('app_workspace_members')) return Response.json(role ? [{ role }] : []);
    if (path.includes('app_drive_download_tokens')) return new Response(null, { status: 204 });
    if (path === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'drive-token' });
    if (path.endsWith('?fields=trashed')) return Response.json({ trashed }, { status: getStatus });
    if (path.endsWith('/drive/v3/files/file-1') && method === 'PATCH') return Response.json({ trashed: true }, { status: patchStatus });
    throw Error(`Unexpected ${method} ${path}`);
  };
  const Deno = { env: { get: key => ({ SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service' })[key] }, serve: fn => { handler = fn; } };
  new Function('Deno', 'fetch', 'console', source)(Deno, fetchMock, { error() {} });
  return { calls, send: async () => {
    const response = await handler(new Request('https://sb.example/functions/v1/document-actions', {
      method: 'POST', headers: { Authorization: 'Bearer user-token' },
      body: JSON.stringify({ action: 'delete', document_id: 'doc-1' }),
    }));
    return { status: response.status, body: await response.json() };
  } };
}

const drive = calls => calls.filter(c => c.path.includes('googleapis.com/drive/v3/files/'));
const recordDeletes = calls => calls.filter(c => c.method === 'DELETE' && c.path.includes('/rest/v1/'));

test('moves Drive file to trash before removing the library record, with no Drive DELETE', async () => {
  const h = harness();
  assert.equal((await h.send()).status, 200);
  assert.deepEqual(drive(h.calls).map(c => c.method), ['GET', 'PATCH']);
  assert.deepEqual(JSON.parse(drive(h.calls)[1].body), { trashed: true });
  assert.equal(drive(h.calls).filter(c => c.method === 'DELETE').length, 0);
  assert.equal(recordDeletes(h.calls).length, 2);
  assert.ok(h.calls.indexOf(drive(h.calls)[1]) < h.calls.indexOf(recordDeletes(h.calls)[0]));
});

test('failed trash move leaves the library record and returns an error', async () => {
  const h = harness({ patchStatus: 503 });
  const result = await h.send();
  assert.equal(result.status, 400);
  assert.match(result.body.error, /휴지통 이동에 실패/);
  assert.equal(recordDeletes(h.calls).length, 0);
  assert.equal(drive(h.calls).filter(c => c.method === 'DELETE').length, 0);
});

test('already trashed file removes only the library record', async () => {
  const h = harness({ trashed: true });
  assert.equal((await h.send()).status, 200);
  assert.deepEqual(drive(h.calls).map(c => c.method), ['GET']);
  assert.equal(recordDeletes(h.calls).length, 2);
});

test('missing Drive file at lookup removes the library record without Drive DELETE', async () => {
  const h = harness({ getStatus: 404 });
  assert.equal((await h.send()).status, 200);
  assert.deepEqual(drive(h.calls).map(c => c.method), ['GET']);
  assert.equal(drive(h.calls).filter(c => c.method === 'DELETE').length, 0);
  assert.equal(recordDeletes(h.calls).length, 2);
});

test('missing Drive file at trash move removes the library record', async () => {
  const h = harness({ patchStatus: 404 });
  assert.equal((await h.send()).status, 200);
  assert.deepEqual(drive(h.calls).map(c => c.method), ['GET', 'PATCH']);
  assert.equal(recordDeletes(h.calls).length, 2);
});

for (const getStatus of [500, 403]) test(`Drive lookup ${getStatus} leaves the library record`, async () => {
  const h = harness({ getStatus });
  const result = await h.send();
  assert.equal(result.status, 400);
  assert.match(result.body.error, /상태를 확인하지 못했습니다/);
  assert.equal(recordDeletes(h.calls).length, 0);
});

test('non-owner cannot touch Drive or remove a record', async () => {
  const h = harness({ role: 'member' });
  assert.equal((await h.send()).status, 400);
  assert.equal(drive(h.calls).length, 0);
  assert.equal(recordDeletes(h.calls).length, 0);
});

test('both delete entry points explain the Drive trash retention period', () => {
  for (const file of ['app/library-upload.js', 'app/project-files.js']) {
    const code = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    assert.match(code, /Drive 휴지통으로 이동합니다\. Drive 휴지통에서 30일 안에 복구할 수 있습니다\./);
  }
});
