import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

// Runs the real library-files handler with mocked Supabase, Google Drive, and AI so each failure stage
// can be checked for its status, structured error body, and Drive orphan cleanup. No network calls.
const SOURCE = stripTypeScriptTypes(
  readFileSync(new URL('../../supabase/functions/library-files/index.ts', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, ''),
  { mode: 'strip' }
);

function query(result) {
  const builder = {
    select: () => builder, eq: () => builder, neq: () => builder,
    upsert: async () => ({ error: null }),
    insert: payload => { builder.inserted = payload; return builder; },
    maybeSingle: async () => result(builder),
    single: async () => result(builder),
    then: (resolve, reject) => Promise.resolve(result(builder)).then(resolve, reject)
  };
  return builder;
}

function harness({
  openai = '',
  user = { data: { user: { id: 'user-1' } }, error: null },
  role = 'owner',
  project = { id: 'project-1', workspace_id: 'workspace-1' },
  insert = { data: { id: 'doc-1', project_id: null }, error: null },
  spacesThrow = false,
  driveToken = () => json({ access_token: 'drive-token' }),
  uploadPut = () => json({ id: 'drive-file-1', webViewLink: 'https://drive.example/file' }),
  driveDelete = () => new Response(null, { status: 204 }),
  openaiFetch = () => json({ output: [] })
} = {}) {
  const calls = { fetch: [], inserts: [], errors: [] };
  const tables = {
    app_workspace_members: () => ({ data: role ? { workspace_id: 'workspace-1', role } : null }),
    app_spaces: b => {
      if (spacesThrow) throw new Error('raw internal detail');
      return b.inserted ? { data: null } : { data: b._list ? [] : project };
    },
    public_policy_drive_config: () => ({ data: { google_client_id: 'c', google_client_secret: 's', google_refresh_token: 'r' }, error: null }),
    app_drive_settings: () => ({ data: { library_folder_id: 'folder-1', root_folder_id: 'root-1' } }),
    app_ai_workspace_settings: () => ({ data: null }),
    app_documents: b => { calls.inserts.push(b.inserted); return insert; }
  };
  const admin = {
    auth: { getUser: async () => user },
    from: table => {
      const b = query(builder => tables[table](builder));
      if (table === 'app_spaces') { const neq = b.neq; b.neq = (...a) => { b._list = true; return neq(...a); }; }
      return b;
    }
  };
  const fetchMock = async (url, init = {}) => {
    const href = String(url), method = init.method || 'GET';
    calls.fetch.push(`${method} ${href}`);
    if (href.startsWith('https://oauth2.googleapis.com/token')) return driveToken();
    if (href.startsWith('https://www.googleapis.com/upload/drive/v3/files')) return new Response('{}', { status: 200, headers: { location: 'https://upload.example/session-1' } });
    if (href === 'https://upload.example/session-1') return uploadPut();
    if (href.startsWith('https://www.googleapis.com/drive/v3/files/') && method === 'DELETE') return driveDelete(href);
    if (href.startsWith('https://api.openai.com/')) return openaiFetch(init);
    throw new Error('unexpected fetch ' + href);
  };
  let handler = null;
  const Deno = {
    env: { get: key => ({ SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', OPENAI_API_KEY: openai }[key]) },
    serve: fn => { handler = fn; }
  };
  const quietConsole = { ...console, error: (...a) => calls.errors.push(a), warn: () => {}, log: () => {} };
  const fastSignal = { timeout: () => { const c = new AbortController(); setTimeout(() => c.abort(new DOMException('timed out', 'TimeoutError')), 30); return c.signal; } };
  new Function('Deno', 'createClient', 'HwpxReader', 'hwpToText', 'fetch', 'console', 'AbortSignal', SOURCE)(
    Deno, () => admin, class {}, async () => '', fetchMock, quietConsole, fastSignal
  );
  return { handler, calls };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

async function send(h, { file = new File(['hello'], 'budget-plan-2026.txt', { type: 'text/plain' }), fields = {}, auth = 'Bearer user-token' } = {}) {
  const form = new FormData();
  if (file) form.append('file', file);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const headers = auth ? { Authorization: auth } : {};
  const response = await h.handler(new Request('https://sb.example/functions/v1/library-files', { method: 'POST', headers, body: form }));
  return { status: response.status, body: await response.json() };
}

function assertStructured(body, code, stage, retryable) {
  assert.equal(body.code, code);
  assert.equal(body.stage, stage);
  assert.equal(body.retryable, retryable);
  assert.equal(typeof body.error, 'string', 'legacy {error} field is kept for existing callers');
  assert.equal(body.message, body.error);
}

test('successful upload stores a private document and never deletes the Drive file', async () => {
  const h = harness();
  const { status, body } = await send(h);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(h.calls.inserts[0].visibility, 'private');
  assert.equal(h.calls.inserts[0].file_id, 'drive-file-1');
  assert.equal(h.calls.fetch.some(c => c.startsWith('DELETE ')), false);
});

test('DB insert failure removes only the Drive file created by this request and hides the raw DB error', async () => {
  const h = harness({ insert: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint secret_idx' } } });
  const { status, body } = await send(h);
  assert.equal(status, 500);
  assertStructured(body, 'document_record_failed', 'db_insert', true);
  assert.doesNotMatch(JSON.stringify(body), /duplicate key|secret_idx/);
  assert.deepEqual(h.calls.fetch.filter(c => c.startsWith('DELETE ')), ['DELETE https://www.googleapis.com/drive/v3/files/drive-file-1']);
});

test('orphan cleanup failure is logged separately and does not replace the original error', async () => {
  for (const driveDelete of [() => new Response('boom', { status: 500 }), () => { throw new Error('socket closed'); }]) {
    const h = harness({ insert: { data: null, error: { code: 'XX000', message: 'db down' } }, driveDelete });
    const { status, body } = await send(h);
    assert.equal(status, 500);
    assertStructured(body, 'document_record_failed', 'db_insert', true);
    assert.ok(h.calls.errors.some(([label]) => label === 'library-files orphan cleanup failed'));
  }
});

test('expired Google Drive grant is a non-retryable 424 that the existing reconnect matcher still recognises', async () => {
  const h = harness({ driveToken: () => json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400) });
  const { status, body } = await send(h);
  assert.equal(status, 424);
  assertStructured(body, 'drive_auth_expired', 'drive_token', false);
  assert.match(body.error, /Google Drive 토큰 갱신/);
  assert.equal(h.calls.fetch.some(c => c.includes('/upload/drive/')), false);
  assert.equal(h.calls.inserts.length, 0);
});

test('temporary Drive failures are retryable 503s and never create a document row', async () => {
  const cases = [
    [{ driveToken: () => json({ error: 'backend_error' }, 503) }, 'drive_token_failed', 'drive_token'],
    [{ driveToken: () => { throw new TypeError('fetch failed'); } }, 'drive_token_failed', 'drive_token'],
    [{ uploadPut: () => json({ error: { message: 'Rate Limit Exceeded' } }, 403) }, 'drive_upload_failed', 'drive_upload']
  ];
  for (const [options, code, stage] of cases) {
    const h = harness(options);
    const { status, body } = await send(h);
    assert.equal(status, 503);
    assertStructured(body, code, stage, true);
    assert.doesNotMatch(body.error, /Rate Limit|backend_error|fetch failed/);
    assert.equal(h.calls.inserts.length, 0);
  }
});

test('input validation failures return distinct statuses before any Drive request', async () => {
  const empty = harness();
  let r = await send(empty, { file: new File([], 'empty.txt') });
  assert.equal(r.status, 400);
  assertStructured(r.body, 'file_empty', 'validate', false);

  const missing = harness();
  r = await send(missing, { file: null });
  assert.equal(r.status, 400);
  assertStructured(r.body, 'file_missing', 'validate', false);

  const large = harness();
  r = await send(large, { file: new File([new Uint8Array(100 * 1024 * 1024 + 1)], 'large.pdf') });
  assert.equal(r.status, 413);
  assertStructured(r.body, 'file_too_large', 'validate', false);
  for (const h of [empty, missing, large]) assert.equal(h.calls.fetch.length, 0);
});

test('session, owner, and project failures keep sole-owner enforcement with explicit statuses', async () => {
  let r = await send(harness(), { auth: '' });
  assert.equal(r.status, 401);
  assertStructured(r.body, 'session_required', 'auth', false);

  r = await send(harness({ user: { data: { user: null }, error: { status: 401, message: 'invalid JWT' } } }));
  assert.equal(r.status, 401);
  assertStructured(r.body, 'session_required', 'auth', false);

  r = await send(harness({ user: { data: { user: null }, error: { status: 500, message: 'auth outage' } } }));
  assert.equal(r.status, 503);
  assertStructured(r.body, 'auth_unavailable', 'auth', true);

  for (const role of ['admin', 'editor', 'member', null]) {
    const h = harness({ role });
    r = await send(h);
    assert.equal(r.status, 403, `role ${role}`);
    assertStructured(r.body, 'forbidden', 'authorize', false);
    assert.equal(h.calls.fetch.length, 0);
  }

  const h = harness({ project: null });
  r = await send(h, { fields: { project_id: 'gone-project' } });
  assert.equal(r.status, 404);
  assertStructured(r.body, 'project_not_found', 'project', false);
  assert.equal(h.calls.fetch.length, 0);
});

test('title inference failure or timeout falls back to the filename title and still uploads', async () => {
  const weak = () => new File(['첫 줄 제목\n본문'], 'scan.txt', { type: 'text/plain' });
  const hanging = init => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal.reason)));
  for (const openaiFetch of [hanging, () => json({ error: { message: 'quota' } }, 429)]) {
    const h = harness({ openai: 'test-key', openaiFetch });
    const { status, body } = await send(h, { file: weak() });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(h.calls.inserts.length, 1);
    assert.equal(h.calls.fetch.filter(c => c.includes('api.openai.com')).length, 1);
  }
});

test('unexpected exceptions return a generic 500 without leaking internal messages', async () => {
  const h = harness({ spacesThrow: true });
  const { status, body } = await send(h);
  assert.equal(status, 500);
  assertStructured(body, 'internal_error', 'unknown', true);
  assert.doesNotMatch(JSON.stringify(body), /raw internal detail/);
});
