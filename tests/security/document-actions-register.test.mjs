// BASKET-4b-1 B: document-actions `register-basket-attachment` registers a basket
// note attachment in the library as a reference to the same Drive file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { readBoundedJson } from '../../supabase/functions/_shared/bounded-json.mjs';
import { inspectBasketOriginal } from '../../supabase/functions/_shared/basket-file-origin.ts';

const source = stripTypeScriptTypes(readFileSync(new URL('../../supabase/functions/document-actions/index.ts', import.meta.url), 'utf8'), { mode: 'strip' })
  .replace(/^import .*basket-file-origin\.ts.*;\s*$/m, '').replace(/^import .*bounded-json\.mjs.*;\s*$/m, '');
const NOTE = '10000000-0000-4000-8000-000000000001', FILE = 'drive-file_1';
const attachment = { drive_file_id: FILE, file_name: '회의 사진.jpg', mime_type: 'image/jpeg', size_bytes: 1234 };

function harness(o = {}) {
  const state = {
    role: 'owner',
    note: { id: NOTE, workspace_id: 'ws-1', attachments: [attachment] },
    documents: [],
    drive: { id: FILE, name: 'drive name.jpg', mimeType: 'image/jpeg', size: '1234', webViewLink: 'https://drive.google.com/file/d/drive-file_1/view', trashed: false, ownedByMe: true, parents: ['basket-1'] },
    ...o,
  };
  const calls = [];
  let handler;
  const fetchMock = async (url, init = {}) => {
    const u = new URL(String(url)), method = init.method || 'GET';
    calls.push({ path: u.pathname + u.search, method, body: typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body });
    if (u.pathname === '/auth/v1/user') return Response.json({ id: 'owner-1' });
    if (u.pathname === '/token') return Response.json({ access_token: 'drive-token' });
    const table = u.pathname.startsWith('/rest/v1/') ? u.pathname.split('/').at(-1) : null;
    if (table === 'public_policy_drive_config') return Response.json([{ google_client_id: 'c', google_client_secret: 's', google_refresh_token: 'r' }]);
    if (table === 'app_workspace_members') {
      if (u.searchParams.has('workspace_id')) return Response.json(state.role ? [{ role: state.role }] : []);
      return Response.json([{ workspace_id: 'ws-1', role: 'owner' }], { headers: { 'Content-Range': '0-0/1' } });
    }
    if (table === 'app_notes') {
      if (u.searchParams.get('id')) return Response.json(state.note && u.searchParams.get('id') === 'eq.' + state.note.id ? [state.note] : []);
      const rows = state.note ? [state.note] : [];
      return Response.json(rows, { headers: { 'Content-Range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' } });
    }
    if (table === 'app_drive_settings') return Response.json([], { headers: { 'Content-Range': '*/0' } });
    if (table === 'app_drive_download_tokens') return new Response(null, { status: 204 });
    if (table === 'app_documents') {
      if (method === 'GET') {
        const id = u.searchParams.get('id'), file = u.searchParams.get('file_id');
        if (id) return Response.json(state.documents.filter(d => 'eq.' + d.id === id));
        if (state.lookupStatus) return Response.json({ message: 'x' }, { status: state.lookupStatus });
        state.lookups = (state.lookups || 0) + 1;
        if (state.raceAt === state.lookups) state.documents.push({ id: 'doc-race', title: '먼저', workspace_id: 'ws-1', file_id: FILE });
        return Response.json(state.documents.filter(d => 'eq.' + d.file_id === file && 'eq.' + d.workspace_id === u.searchParams.get('workspace_id')).slice(0, 1).map(({ id, title }) => ({ id, title })));
      }
      if (method === 'POST') {
        if (state.insertThrows) throw new TypeError('network');
        if (state.insertStatus) return Response.json({ message: 'x' }, { status: state.insertStatus });
        const row = { id: 'doc-new', ...JSON.parse(init.body) };
        state.documents.push(row);
        return Response.json(state.insertBody ?? [{ id: row.id, title: row.title, workspace_id: row.workspace_id, file_id: row.file_id }], { status: 201 });
      }
      if (method === 'DELETE') {
        const id = u.searchParams.get('id');
        const removed = state.documents.filter(d => 'eq.' + d.id === id);
        state.documents = state.documents.filter(d => 'eq.' + d.id !== id);
        return Response.json(removed.map(({ id }) => ({ id })));
      }
    }
    if (u.pathname === '/drive/v3/files') return Response.json({ files: [] });
    if (u.pathname.startsWith('/drive/v3/files/')) {
      if (method !== 'GET') return Response.json({ trashed: true });
      if (state.driveThrows) throw new TypeError('network');
      if (state.driveStatus) return Response.json({}, { status: state.driveStatus });
      return Response.json(state.drive);
    }
    throw Error(`Unexpected ${method} ${u.pathname}`);
  };
  const Deno = { env: { get: k => ({ SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k] }, serve: fn => { handler = fn; } };
  new Function('Deno', 'fetch', 'console', 'inspectBasketOriginal', 'readBoundedJson', source)(Deno, fetchMock, { error() {} }, inspectBasketOriginal, readBoundedJson);
  return {
    state, calls,
    send: async body => {
      const r = await handler(new Request('https://sb.example/functions/v1/document-actions', { method: 'POST', headers: { Authorization: 'Bearer user-token' }, body: JSON.stringify(body) }));
      return { status: r.status, body: await r.json() };
    },
  };
}
const register = (h, extra = {}) => h.send({ action: 'register-basket-attachment', note_id: NOTE, drive_file_id: FILE, ...extra });
const posts = h => h.calls.filter(c => c.path.startsWith('/rest/v1/app_documents') && c.method === 'POST');
const driveWrites = h => h.calls.filter(c => c.path.startsWith('/drive/') && c.method !== 'GET');

test('registers the attachment as a private library document on the same Drive file', async () => {
  const h = harness();
  const r = await register(h);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, result: 'created', document: { id: 'doc-new', title: '회의 사진' } });
  assert.equal(posts(h).length, 1);
  assert.deepEqual(posts(h)[0].body, {
    workspace_id: 'ws-1', project_id: null, meeting_id: null, title: '회의 사진', category: '기타', source: null, document_date: null, description: null, tags: [],
    drive_url: 'https://drive.google.com/file/d/drive-file_1/view', file_id: FILE, file_name: '회의 사진.jpg', mime_type: 'image/jpeg', file_size: 1234,
    visibility: 'private', uploaded_by: 'owner-1', auto_classified: false, classification_note: '바구니 메모 첨부에서 등록(같은 Drive 원본)',
  });
  // No Drive copy, move, upload or trash.
  assert.deepEqual(driveWrites(h), []);
});

test('an existing registration of the same Drive file returns exists and writes nothing', async () => {
  const h = harness({ documents: [{ id: 'doc-old', title: '예전 등록', workspace_id: 'ws-1', file_id: FILE }] });
  const r = await register(h);
  assert.deepEqual(r.body, { ok: true, result: 'exists', document: { id: 'doc-old', title: '예전 등록' } });
  assert.equal(posts(h).length, 0);
  assert.equal(h.calls.some(c => c.path.startsWith('/drive/')), false);
});

test('a registration that appears while checking Drive returns exists without a second row', async () => {
  const h = harness({ raceAt: 2 });
  const r = await register(h);
  assert.deepEqual(r.body, { ok: true, result: 'exists', document: { id: 'doc-race', title: '먼저' } });
  assert.equal(posts(h).length, 0);
});

test('an unknown write result is reported once and never sent again', async () => {
  for (const extra of [{ insertThrows: true }, { insertStatus: 503 }, { insertBody: [] }, { insertBody: 'odd' }]) {
    const h = harness(extra);
    const r = await register(h);
    assert.equal(r.body.code, 'RESULT_UNKNOWN', JSON.stringify(extra));
    assert.equal(posts(h).length, 1);
  }
  const rejected = harness({ insertStatus: 409 });
  assert.equal((await register(rejected)).body.code, 'REGISTER_REJECTED');
  assert.equal(posts(rejected).length, 1);
});

test('the server decides workspace, owner and attachment; client values are not trusted', async () => {
  const notOwner = harness({ role: 'editor' });
  assert.match((await register(notOwner)).body.error, /소유자/);
  assert.equal(posts(notOwner).length, 0);
  const otherFile = harness();
  assert.equal((await register(otherFile, { drive_file_id: 'someone-elses-file' })).body.code, 'ATTACHMENT_NOT_FOUND');
  const missing = harness({ note: null });
  assert.equal((await register(missing)).body.code, 'NOTE_NOT_FOUND');
  for (const bad of [{ note_id: 'x' }, { drive_file_id: '../x' }, { drive_file_id: '' }]) {
    assert.equal((await register(harness(), bad)).body.code, 'INVALID_REQUEST');
  }
  const injected = harness();
  await register(injected, { workspace_id: 'ws-evil', title: 'x', visibility: 'public', file_name: 'evil' });
  assert.equal(posts(injected)[0].body.workspace_id, 'ws-1');
  assert.equal(posts(injected)[0].body.visibility, 'private');
  assert.equal(posts(injected)[0].body.file_name, '회의 사진.jpg');
});

test('a missing, trashed, foreign or unreachable Drive original is not registered', async () => {
  const cases = [
    [{ driveStatus: 404 }, 'DRIVE_FILE_MISSING'],
    [{ driveStatus: 500 }, 'DRIVE_UNAVAILABLE'],
    [{ driveThrows: true }, 'DRIVE_UNAVAILABLE'],
    [{ drive: { id: FILE, trashed: true, ownedByMe: true } }, 'DRIVE_FILE_TRASHED'],
    [{ drive: { id: FILE, trashed: false, ownedByMe: false } }, 'DRIVE_FILE_INVALID'],
    [{ drive: { id: 'other', trashed: false, ownedByMe: true } }, 'DRIVE_FILE_INVALID'],
    [{ lookupStatus: 500 }, undefined],
  ];
  for (const [extra, code] of cases) {
    const h = harness(extra);
    const r = await register(h);
    assert.equal(r.body.ok, undefined, JSON.stringify(extra));
    if (code) assert.equal(r.body.code, code, JSON.stringify(extra));
    assert.equal(posts(h).length, 0);
    assert.deepEqual(driveWrites(h), []);
  }
});

test('deleting the registered library document keeps the basket original out of the Drive trash', async () => {
  const h = harness();
  const created = await register(h);
  assert.equal(created.body.result, 'created');
  const r = await h.send({ action: 'delete', document_id: 'doc-new' });
  assert.equal(r.status, 200);
  assert.equal(r.body.drive_preserved, true);
  assert.equal(r.body.reason, 'note_reference');
  assert.equal(r.body.drive_result, 'preserved');
  assert.deepEqual(driveWrites(h), []);
  assert.deepEqual(h.state.documents, []);
});

test('the existing delete contract still needs a document id', async () => {
  const r = await harness().send({ action: 'delete' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'document_id가 필요합니다.');
});
