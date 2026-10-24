import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const { readMultipartForm } = await import('../../supabase/functions/_shared/multipart.ts');
const { DEFAULT_AI_MODEL, withReasoning } = await import('../../supabase/functions/_shared/ai-model.ts');

// LIB-수정파일교체: the real library-files handler, replace branch (replace_document_id), with mocked Supabase, Google Drive and AI. No network.
// The same document row gets the new file; title/category/links/marks stay; the old Drive file is never deleted and is recorded in previous_files.
const SOURCE = stripTypeScriptTypes(
  readFileSync(new URL('../../supabase/functions/library-files/index.ts', import.meta.url), 'utf8').replace(/^import .*$/gm, ''),
  { mode: 'strip' }
);
const DOC = 'e0000000-0000-4000-8000-000000000001', OTHER = 'e0000000-0000-4000-8000-000000000002';
const baseDoc = (over = {}) => ({
  id: DOC, workspace_id: 'workspace-1', title: '고친 제목', category: '교섭', source: '공공운수노조', document_date: '2026-10-20', description: '설명', tags: ['a'],
  project_id: 'project-1', meeting_id: 'meeting-1', organization_id: 'org-1', field_origin: { title: 'user' }, classification_note: '사용자 수정', auto_classified: false,
  file_id: 'oldDriveFile', file_name: '옛 파일.hwpx', mime_type: 'application/x-hwp', file_size: 111, drive_url: 'https://drive.google.com/file/d/oldDriveFile/view',
  previous_files: [], reclassify_needed: false, extracted_text: '옛 글자', extraction_status: 'ready', extraction_error: null, extracted_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over
});

function harness({ rows = [baseDoc(), baseDoc({ id: OTHER, workspace_id: 'workspace-2', file_id: 'otherFile' })], role = 'owner', readError = null, updateError = null, raceFileId = null,
  uploadPut = () => json({ id: 'newDriveFile', webViewLink: 'https://drive.example/new' }), driveDelete = () => new Response(null, { status: 204 }) } = {}) {
  const calls = { fetch: [], updates: [], errors: [], selects: [] };
  const filters = [];
  const documents = () => {
    const b = {
      _f: [], _op: 'select', _patch: null,
      select(cols) { if (b._op === 'select') calls.selects.push(cols); return b; },
      eq(k, v) { b._f.push([k, '=', v]); return b; }, is(k, v) { b._f.push([k, 'is', v]); return b; },
      update(patch) { b._op = 'update'; b._patch = patch; return b; },
      maybeSingle: async () => {
        if (readError) return { data: null, error: readError };
        const r = rows.find(x => b._f.every(([k, , v]) => x[k] === v));
        return { data: r ? structuredClone(r) : null, error: null };
      },
      then(resolve, reject) {
        return Promise.resolve((() => {
          if (updateError) return { data: null, error: updateError };
          if (raceFileId) for (const r of rows) r.file_id = raceFileId; // another replace won in between
          const hit = rows.filter(x => b._f.every(([k, op, v]) => op === 'is' ? (x[k] ?? null) === null : x[k] === v));
          calls.updates.push({ filters: b._f.map(f => `${f[0]} ${f[1]} ${f[2]}`), patch: b._patch });
          hit.forEach(r => Object.assign(r, b._patch));
          return { data: hit.map(r => structuredClone(r)), error: null };
        })()).then(resolve, reject);
      }
    };
    return b;
  };
  const simple = result => { const b = { select: () => b, eq: () => b, neq: () => b, single: async () => result(), maybeSingle: async () => result(), then: (res, rej) => Promise.resolve(result()).then(res, rej) }; return b; };
  const tables = {
    app_workspace_members: () => simple(() => ({ data: role ? { workspace_id: 'workspace-1', role } : null })),
    public_policy_drive_config: () => simple(() => ({ data: { google_client_id: 'c', google_client_secret: 's', google_refresh_token: 'r' }, error: null })),
    app_drive_settings: () => simple(() => ({ data: { library_folder_id: 'folder-1', root_folder_id: 'root-1' } })),
    app_documents: documents
  };
  const admin = { auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) }, from: t => tables[t]() };
  const fetchMock = async (url, init = {}) => {
    const href = String(url), method = init.method || 'GET';
    calls.fetch.push(`${method} ${href}`);
    if (href.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'drive-token' });
    if (href.startsWith('https://www.googleapis.com/upload/drive/v3/files')) return new Response('{}', { status: 200, headers: { location: 'https://upload.example/session-1' } });
    if (href === 'https://upload.example/session-1') return uploadPut();
    if (href.startsWith('https://www.googleapis.com/drive/v3/files/') && method === 'DELETE') return driveDelete(href);
    throw new Error('unexpected fetch ' + href);
  };
  let handler = null;
  const Deno = { env: { get: key => ({ SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', OPENAI_API_KEY: '' }[key]) }, serve: fn => { handler = fn; } };
  const quietConsole = { ...console, error: (...a) => calls.errors.push(a), warn: () => {}, log: () => {} };
  new Function('Deno', 'createClient', 'HwpxReader', 'hwpToText', 'readMultipartForm', 'DEFAULT_AI_MODEL', 'withReasoning', 'fetch', 'console', SOURCE)(Deno, () => admin, class {}, async () => '', readMultipartForm, DEFAULT_AI_MODEL, withReasoning, fetchMock, quietConsole);
  return { handler, calls, rows };
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
async function send(h, { file = new File(['새 내용'], '새 파일.pdf', { type: 'application/pdf' }), fields = { replace_document_id: DOC } } = {}) {
  const form = new FormData();
  if (file) form.append('file', file);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const response = await h.handler(new Request('https://sb.example/functions/v1/library-files', { method: 'POST', headers: { Authorization: 'Bearer user-token' }, body: form }));
  return { status: response.status, body: await response.json() };
}
const deletes = h => h.calls.fetch.filter(c => c.startsWith('DELETE '));

test('replace: only the file columns change; title, category, links, marks and note stay; the old file is recorded and never deleted', async () => {
  const h = harness();
  const { status, body } = await send(h);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.replaced, true);
  const row = h.rows[0];
  assert.deepEqual([row.file_id, row.file_name, row.mime_type, row.file_size, row.drive_url], ['newDriveFile', '새 파일.pdf', 'application/pdf', 10, 'https://drive.example/new']);
  assert.deepEqual([row.title, row.category, row.source, row.document_date, row.description, row.tags, row.project_id, row.meeting_id, row.organization_id, row.field_origin, row.classification_note, row.auto_classified],
    ['고친 제목', '교섭', '공공운수노조', '2026-10-20', '설명', ['a'], 'project-1', 'meeting-1', 'org-1', { title: 'user' }, '사용자 수정', false]);
  assert.equal(row.previous_files.length, 1);
  const prev = row.previous_files[0];
  assert.deepEqual([prev.file_id, prev.file_name, prev.mime_type, prev.file_size, prev.drive_url], ['oldDriveFile', '옛 파일.hwpx', 'application/x-hwp', 111, 'https://drive.google.com/file/d/oldDriveFile/view']);
  assert.match(prev.replaced_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(row.reclassify_needed, true);
  assert.deepEqual([row.extracted_text, row.extraction_status, row.extraction_error, row.extracted_at], [null, null, null, null]);
  // The update is guarded by id, workspace and the file the server read, and writes only these keys.
  const upd = h.calls.updates[0];
  assert.deepEqual(upd.filters, ['id = ' + DOC, 'workspace_id = workspace-1', 'file_id = oldDriveFile']);
  assert.deepEqual(Object.keys(upd.patch).sort(), ['drive_url', 'extracted_at', 'extracted_text', 'extraction_error', 'extraction_status', 'file_id', 'file_name', 'file_size', 'mime_type', 'previous_files', 'reclassify_needed', 'updated_at']);
  assert.equal(deletes(h).length, 0, 'the old Drive file stays');
});

test('replace: a second replace appends to the old list in order; the new file goes to the library folder', async () => {
  const h = harness({ rows: [baseDoc({ previous_files: [{ file_id: 'firstOld', file_name: '처음.hwp', replaced_at: '2026-10-02T00:00:00Z' }] })] });
  const { status } = await send(h);
  assert.equal(status, 200);
  assert.deepEqual(h.rows[0].previous_files.map(p => p.file_id), ['firstOld', 'oldDriveFile']);
  assert.ok(h.calls.fetch.some(c => c.startsWith('POST https://www.googleapis.com/upload/drive/v3/files')));
});

test('replace: other workspace documents, unknown ids and bad ids are refused before any Drive upload', async () => {
  for (const [id, code, st] of [[OTHER, 'document_not_found', 404], ['e0000000-0000-4000-8000-0000000000ff', 'document_not_found', 404], ['not-a-uuid', 'invalid_request', 400]]) {
    const h = harness();
    const { status, body } = await send(h, { fields: { replace_document_id: id } });
    assert.equal(status, st, id);
    assert.equal(body.code, code);
    assert.equal(h.calls.fetch.some(c => c.includes('/upload/drive/')), false, 'no upload');
    assert.equal(h.calls.updates.length, 0);
  }
  const h = harness({ role: 'editor' });
  const { status, body } = await send(h);
  assert.equal(status, 403);
  assert.equal(body.code, 'forbidden');
  assert.equal(h.calls.fetch.length, 0);
});

test('replace: the project, title, category fields sent along are ignored (the row keeps its own)', async () => {
  const h = harness();
  const { status } = await send(h, { fields: { replace_document_id: DOC, title: '덮어쓰기', category: '선전', project_id: 'project-9', source: 'x' } });
  assert.equal(status, 200);
  assert.deepEqual([h.rows[0].title, h.rows[0].category, h.rows[0].project_id, h.rows[0].source], ['고친 제목', '교섭', 'project-1', '공공운수노조']);
});

test('replace: DB not ready (columns missing) → 503 before any upload; update failure removes only the new Drive file', async () => {
  {
    const h = harness({ readError: { code: '42703', message: 'column app_documents.previous_files does not exist' } });
    const { status, body } = await send(h);
    assert.equal(status, 503);
    assert.equal(body.code, 'replace_unavailable');
    assert.equal(h.calls.fetch.some(c => c.includes('/upload/drive/')), false);
    assert.doesNotMatch(JSON.stringify(body), /previous_files|does not exist/);
  }
  {
    const h = harness({ updateError: { code: '23514', message: 'violates check constraint app_documents_previous_files_check' } });
    const { status, body } = await send(h);
    assert.equal(status, 500);
    assert.equal(body.code, 'document_record_failed');
    assert.equal(body.retryable, true);
    assert.doesNotMatch(JSON.stringify(body), /constraint|previous_files/);
    assert.deepEqual(deletes(h), ['DELETE https://www.googleapis.com/drive/v3/files/newDriveFile']);
  }
});

test('replace: a row whose file changed after it was read (another replace or delete) is not overwritten and the new upload is cleaned up', async () => {
  const h = harness({ raceFileId: 'someoneElsesFile' });
  const { status, body } = await send(h);
  assert.equal(status, 409);
  assert.equal(body.code, 'document_changed');
  assert.equal(h.rows[0].file_id, 'someoneElsesFile');
  assert.deepEqual(deletes(h), ['DELETE https://www.googleapis.com/drive/v3/files/newDriveFile']);
});

test('replace: at 50 old files it stops with a plain message before uploading; a link-only row (no file) can still get its first file', async () => {
  {
    const h = harness({ rows: [baseDoc({ previous_files: Array.from({ length: 50 }, (_, i) => ({ file_id: 'f' + i })) })] });
    const { status, body } = await send(h);
    assert.equal(status, 409);
    assert.equal(body.code, 'too_many_replacements');
    assert.equal(h.calls.fetch.some(c => c.includes('/upload/drive/')), false);
  }
  {
    const h = harness({ rows: [baseDoc({ file_id: null, file_name: null, mime_type: null, file_size: null, drive_url: null })] });
    const { status } = await send(h);
    assert.equal(status, 200);
    assert.deepEqual(h.calls.updates[0].filters, ['id = ' + DOC, 'workspace_id = workspace-1', 'file_id is null']);
    assert.deepEqual(h.rows[0].previous_files, []);
    assert.equal(h.rows[0].file_id, 'newDriveFile');
  }
});

test('replace: an empty file is refused by the existing checks; a plain upload without replace_document_id still takes the old path', async () => {
  const h = harness();
  const empty = await send(h, { file: new File([''], 'x.pdf', { type: 'application/pdf' }) });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.code, 'file_empty');
  assert.equal(h.calls.updates.length, 0);
  assert.match(SOURCE, /if\(replaceId\)return await replaceDocument\(wm\.workspace_id,file,replaceId\)/);
});
