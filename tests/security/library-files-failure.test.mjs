import test from 'node:test';
import assert from 'node:assert/strict';
import { fileNameTitle, isMeaninglessName } from '../../supabase/functions/_shared/library-file-name.mjs';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { withEdgeShared } from './helpers/edge-shared.mjs';
const { readMultipartForm } = await import('../../supabase/functions/_shared/multipart.ts');
const { AI_REASONING_TOKEN_HEADROOM, DEFAULT_AI_MODEL, withReasoning } = await import('../../supabase/functions/_shared/ai-model.ts');
const { outputText } = await import('../../supabase/functions/_shared/openai-responses.ts');
const { createAiUsageMeter, recordAiDailyUsage } = await import('../../supabase/functions/_shared/ai-daily-usage.mjs');

// Runs the real library-files handler with mocked Supabase, Google Drive, and AI so each failure stage
// can be checked for its status, structured error body, and Drive orphan cleanup. No network calls.
const SOURCE = stripTypeScriptTypes(
  withEdgeShared(readFileSync(new URL('../../supabase/functions/library-files/index.ts', import.meta.url), 'utf8'))
    .replace(/^import .*$/gm, ''),
  { mode: 'strip' }
);

function query(result) {
  const builder = {
    select: () => builder, eq: () => builder, neq: () => builder,
    is: (col, val) => { (builder.isCalls ||= []).push([col, val]); return builder; },
    upsert: async (row, opts) => { builder.upserted = [row, opts]; return result(builder) ?? { error: null }; },
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
  openaiFetch = () => json({ output: [] }),
  usageError = null
} = {}) {
  const calls = { fetch: [], inserts: [], errors: [], spaceIs: [], usage: [] };
  const tables = {
    app_workspace_members: () => ({ data: role ? { workspace_id: 'workspace-1', role } : null }),
    app_spaces: b => {
      calls.spaceIs.push(b.isCalls || []);
      if (spacesThrow) throw new Error('raw internal detail');
      return b.inserted ? { data: null } : { data: b._list ? [] : project };
    },
    public_policy_drive_config: () => ({ data: { google_client_id: 'c', google_client_secret: 's', google_refresh_token: 'r' }, error: null }),
    app_drive_settings: () => ({ data: { library_folder_id: 'folder-1', root_folder_id: 'root-1' } }),
    app_ai_workspace_settings: () => ({ data: null }),
    app_ai_daily_usage: b => { if (b.upserted) { calls.usage.push(b.upserted); return { error: usageError }; } return { data: null, error: null }; },
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
  new Function('Deno', 'createClient', 'HwpxReader', 'hwpToText', 'readMultipartForm', 'AI_REASONING_TOKEN_HEADROOM', 'DEFAULT_AI_MODEL', 'outputText', 'withReasoning', 'fetch', 'console', 'AbortSignal', 'fileNameTitle', 'isMeaninglessName', 'createAiUsageMeter', 'recordAiDailyUsage', SOURCE)(
    Deno, () => admin, class {}, async () => '', readMultipartForm, AI_REASONING_TOKEN_HEADROOM, DEFAULT_AI_MODEL, outputText, withReasoning, fetchMock, quietConsole, fastSignal, fileNameTitle, isMeaninglessName, createAiUsageMeter, recordAiDailyUsage
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

test('app_spaces 읽기는 모두 휴지통 프로젝트(deleted_at)를 거른다', async () => {
  const h = harness();
  const { status } = await send(h);
  assert.equal(status, 200);
  assert.ok(h.calls.spaceIs.length >= 1);
  for (const is of h.calls.spaceIs) assert.deepEqual(is, [['deleted_at', null]]);
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

// LIB-파일이름그대로(2026-10-30 사용자 결정 A): 뜻 있는 파일 이름이면 그 이름 그대로(밑줄·확장자만 정리)가 제목이고, 이름의 날짜가 자료 날짜다.
// 본문에서 제목을 뽑으러 AI를 부르지 않는다. 뜻 없는 이름(공용 isMeaninglessName)일 때만 AI 제목을 시도한다.
test('meaningful file names keep their own title and date; only meaningless names ask the AI for a title', async () => {
  const ai = () => json({ output: [{ type: 'message', content: [{ type: 'output_text', text: '주간보고 2026.10.26. 본문 제목' }] }] });
  {
    const h = harness({ openai: 'test-key', openaiFetch: ai });
    const { status } = await send(h, { file: new File(['■ 일시: 2026.10.26.'], '주간보고_20261102_홍길동.hwpx', { type: 'application/hwp+zip' }) });
    assert.equal(status, 200);
    const row = h.calls.inserts[0];
    assert.equal(row.title, '주간보고 20261102 홍길동');
    assert.equal(row.document_date, '2026-11-02');
    assert.equal(h.calls.fetch.some(c => c.includes('api.openai.com')), false, 'no title inference for a meaningful name');
  }
  for (const name of ['KakaoTalk_20261030_1.txt', 'scan001.txt', '문서.txt', '최종.txt']) {
    const h = harness({ openai: 'test-key', openaiFetch: ai });
    const { status } = await send(h, { file: new File(['첫 줄 제목\n본문'], name, { type: 'text/plain' }) });
    assert.equal(status, 200, name);
    assert.equal(h.calls.fetch.filter(c => c.includes('api.openai.com')).length, 1, `${name}: AI title is allowed`);
  }
});

// S48-15(빠짐31): 제목 찾기에 부른 AI 토큰은 홈 'AI 사용량' 줄의 기존 표(app_ai_daily_usage)에 작업공간·로그인 사용자로 더한다.
// AI를 부르지 않으면 기록하지 않고, 기록이 실패해도 올리기는 그대로 된다.
test('title AI usage is added to app_ai_daily_usage; a usage write failure never blocks the upload', async () => {
  const ai = () => json({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"title":"본문 제목"}' }] }], usage: { input_tokens: 321, output_tokens: 12 } });
  {
    const h = harness({ openai: 'test-key', openaiFetch: ai });
    const { status } = await send(h, { file: new File(['첫 줄 제목\n본문'], 'scan001.txt', { type: 'text/plain' }) });
    assert.equal(status, 200);
    assert.equal(h.calls.usage.length, 1);
    const [row, opts] = h.calls.usage[0];
    assert.equal(opts.onConflict, 'workspace_id,user_id,day');
    assert.equal(row.workspace_id, 'workspace-1');
    assert.equal(row.user_id, 'user-1');
    assert.match(row.day, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual([row.requests, row.input_tokens, row.output_tokens, row.advanced_requests], [0, 321, 12, 0]);
    assert.deepEqual(Object.keys(row).sort(), ['advanced_requests', 'day', 'input_tokens', 'output_tokens', 'requests', 'updated_at', 'user_id', 'workspace_id']);
  }
  {
    const h = harness({ openai: 'test-key', openaiFetch: ai, usageError: { code: '42501', message: 'denied' } });
    const { status, body } = await send(h, { file: new File(['첫 줄 제목\n본문'], 'scan001.txt', { type: 'text/plain' }) });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(h.calls.inserts.length, 1);
  }
  {
    const h = harness({ openai: 'test-key', openaiFetch: ai });
    await send(h, { file: new File(['본문'], '주간보고_20261102.txt', { type: 'text/plain' }) });
    assert.equal(h.calls.usage.length, 0, 'no AI call, no usage row');
  }
});
