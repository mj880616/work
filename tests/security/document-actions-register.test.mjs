// BASKET-4b-1 B: document-actions `register-basket-attachment` registers a basket
// note attachment in the library as a reference to the same Drive file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { readBoundedJson } from '../../supabase/functions/_shared/bounded-json.mjs';
import { inspectBasketOriginal } from '../../supabase/functions/_shared/basket-file-origin.ts';
import { createHwpEdit, HwpEditError } from '../../supabase/functions/_shared/hwp-edit.ts';
import { withEdgeShared } from './helpers/edge-shared.mjs';

const source = stripTypeScriptTypes(withEdgeShared(readFileSync(new URL('../../supabase/functions/document-actions/index.ts', import.meta.url), 'utf8')), { mode: 'strip' })
  .replace(/^import .*basket-file-origin\.ts.*;\s*$/m, '').replace(/^import .*bounded-json\.mjs.*;\s*$/m, '').replace(/^import .*hwp-edit\.ts.*;\s*$/m, '').replace(/^import .*document-text\.ts.*;\s*$/m, '').replace(/^import .*file-rename\.ts.*;\s*$/m, '').replace(/^import .*dev-inbox\.ts.*;\s*$/m, '');
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
    if (table === 'public_policy_drive_config') return Response.json([{ google_client_id: 'c', google_client_secret: 's' }]);
    if (table === 'app_drive_connections') return Response.json([{ google_refresh_token: 'r' }]);
    if (table === 'app_workspace_members') {
      if (u.searchParams.has('workspace_id')) return Response.json(state.role ? [{ role: state.role }] : []);
      return Response.json(state.ownerRows ?? [{ workspace_id: 'ws-1', role: 'owner' }], { headers: { 'Content-Range': '0-0/1' } });
    }
    if (table === 'app_notes') {
      // TRASH-다른삭제 5단계: noTrashColumn = DB 적용 전(deleted_at 칸 없음, PostgREST 42703 거절). deleted_at=is.null이 오면 휴지통 노트(deleted_at 있음)는 빠진다.
      if (u.searchParams.has('deleted_at') && state.noTrashColumn) return Response.json({ code: '42703', details: null, hint: null, message: 'column app_notes.deleted_at does not exist' }, { status: 400 });
      if (u.searchParams.has('deleted_at') && state.note?.deleted_at) return Response.json([]);
      if (u.searchParams.get('id')) return Response.json(state.note && u.searchParams.get('id') === 'eq.' + state.note.id ? [state.note] : []);
      const rows = state.note ? [state.note] : [];
      return Response.json(rows, { headers: { 'Content-Range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' } });
    }
    // FILES-자료실로보내기: [파일] 색인(서버만 씀). 그 작업공간·구글·그 id만 돌려준다.
    if (table === 'app_cloud_items') return Response.json((state.cloudItems || []).filter(i => 'eq.' + i.workspace_id === u.searchParams.get('workspace_id') && 'eq.' + i.source === u.searchParams.get('source') && 'eq.' + i.item_id === u.searchParams.get('item_id')).slice(0, 1));
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
  new Function('Deno', 'fetch', 'console', 'inspectBasketOriginal', 'readBoundedJson', 'createHwpEdit', 'HwpEditError', 'createDocumentText', source)(Deno, fetchMock, { error() {} }, inspectBasketOriginal, readBoundedJson, createHwpEdit, HwpEditError, () => { throw Error('document-text not used here'); });
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
    assert.equal(r.status, 503);
    assert.equal(posts(h).length, 1);
  }
  const rejected = harness({ insertStatus: 409 });
  const refused = await register(rejected);
  assert.equal(refused.body.code, 'REGISTER_REJECTED');
  assert.equal(refused.status, 400);
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

// ---- TRASH-다른삭제 5단계: 서버 키로 읽는 노트에서 휴지통 노트를 뺀다 ----
const noteReads = h => h.calls.filter(c => c.path.startsWith('/rest/v1/app_notes'));

test('a trashed note is not found: nothing is registered and Drive is not touched', async () => {
  const h = harness({ note: { id: NOTE, workspace_id: 'ws-1', attachments: [attachment], deleted_at: '2026-10-26T00:00:00Z' } });
  const r = await register(h);
  assert.equal(r.body.code, 'NOTE_NOT_FOUND');
  assert.equal(posts(h).length, 0);
  assert.equal(h.calls.some(c => c.path.startsWith('/drive/')), false);
  assert.match(noteReads(h)[0].path, /&deleted_at=is\.null/);
});

test('before the database has deleted_at the note is read once more without the filter and registers as before', async () => {
  const h = harness({ noTrashColumn: true });
  const r = await register(h);
  assert.equal(r.status, 200);
  assert.equal(r.body.result, 'created');
  const reads = noteReads(h);
  assert.equal(reads.length, 2);
  assert.match(reads[0].path, /&deleted_at=is\.null/);
  assert.doesNotMatch(reads[1].path, /deleted_at/);
});

// FILES-자료실로보내기(S52-26): [파일]의 구글 드라이브 파일을 사본 없이 자료실 자료로 연결한다(register-drive-file).
const GD = 'gd-file_9';
const gdItem = (o = {}) => ({ workspace_id: 'ws-1', source: 'gd', item_id: GD, name: '가상 회의록.pdf', is_folder: false, mime: 'application/pdf', size_bytes: 4321, trashed: false, ...o });
const gdHarness = (o = {}) => harness({ cloudItems: [gdItem()], drive: { id: GD, name: 'drive 이름.pdf', mimeType: 'application/pdf', size: '4321', webViewLink: 'https://drive.google.com/file/d/gd-file_9/view', trashed: false, ownedByMe: true }, ...o });
const link = (h, extra = {}) => h.send({ action: 'register-drive-file', drive_file_id: GD, ...extra });

test('register-drive-file: a [파일] Google Drive file becomes a private library document on the same Drive file (no copy)', async () => {
  const h = gdHarness();
  const r = await link(h);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, result: 'created', document: { id: 'doc-new', title: '가상 회의록' } });
  assert.equal(posts(h).length, 1);
  assert.deepEqual(posts(h)[0].body, {
    workspace_id: 'ws-1', project_id: null, meeting_id: null, title: '가상 회의록', category: '기타', source: null, document_date: null, description: null, tags: [],
    drive_url: 'https://drive.google.com/file/d/gd-file_9/view', file_id: GD, file_name: '가상 회의록.pdf', mime_type: 'application/pdf', file_size: 4321,
    visibility: 'private', uploaded_by: 'owner-1', auto_classified: false, classification_note: '[파일]의 구글 드라이브에서 연결(같은 Drive 원본)',
  });
  // 사본·옮기기·올리기·휴지통 없음: Drive에는 읽기(GET)만.
  assert.deepEqual(driveWrites(h), []);
  // 색인은 부른 사람의 owner 작업공간(ws-1)으로만 찾는다.
  assert.ok(h.calls.some(c => c.path.startsWith('/rest/v1/app_cloud_items?workspace_id=eq.ws-1&source=eq.gd&item_id=eq.gd-file_9')));
});

test('register-drive-file: the same Drive file twice returns exists and makes nothing new', async () => {
  const h = gdHarness({ documents: [{ id: 'doc-had', title: '이미 있는 자료', workspace_id: 'ws-1', file_id: GD }] });
  const r = await link(h);
  assert.deepEqual(r.body, { ok: true, result: 'exists', document: { id: 'doc-had', title: '이미 있는 자료' } });
  assert.equal(posts(h).length, 0);
  assert.equal(h.calls.some(c => c.path.startsWith('/drive/')), false);
});

test('register-drive-file: refuses files outside this workspace\'s [파일] index, folders, trashed files, OneDrive items and non-owners — nothing written', async () => {
  const cases = [
    [{ cloudItems: [] }, 'FILE_NOT_FOUND'],
    [{ cloudItems: [gdItem({ workspace_id: 'ws-other' })] }, 'FILE_NOT_FOUND'],
    [{ cloudItems: [gdItem({ is_folder: true })] }, 'FILE_NOT_FOUND'],
    [{ cloudItems: [gdItem({ trashed: true })] }, 'FILE_NOT_FOUND'],
    [{ cloudItems: [gdItem({ source: 'od' })] }, 'FILE_NOT_FOUND'],
    [{ ownerRows: [] }, 'FORBIDDEN'],
    [{ ownerRows: [{ workspace_id: 'ws-1', role: 'owner' }, { workspace_id: 'ws-2', role: 'owner' }] }, 'FORBIDDEN'],
  ];
  for (const [o, code] of cases) {
    const h = gdHarness(o);
    const r = await link(h, { workspace_id: 'ws-other' }); // 화면이 보낸 작업공간 값은 쓰지 않는다
    assert.equal(r.status, 400, JSON.stringify(o));
    assert.equal(r.body.code, code, JSON.stringify(o));
    assert.equal(posts(h).length, 0);
    assert.equal(h.calls.some(c => c.path.startsWith('/drive/')), false);
  }
  for (const bad of ['', '../x', 'a b', 'x'.repeat(256)]) {
    const h = gdHarness();
    const r = await link(h, { drive_file_id: bad });
    assert.equal(r.body.code, 'INVALID_REQUEST');
    assert.equal(posts(h).length, 0);
  }
});

test('register-drive-file: a Drive original that is not mine or is in the trash is not linked', async () => {
  for (const [drive, code] of [[{ ownedByMe: false }, 'DRIVE_FILE_INVALID'], [{ trashed: true }, 'DRIVE_FILE_TRASHED']]) {
    const h = gdHarness();
    h.state.drive = { ...h.state.drive, ...drive };
    const r = await link(h);
    assert.equal(r.body.code, code);
    assert.equal(posts(h).length, 0);
  }
});

test('register-drive-file: an unknown write result is reported (503) and not sent again', async () => {
  const h = gdHarness({ insertStatus: 503 });
  const r = await link(h);
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'RESULT_UNKNOWN');
  assert.equal(posts(h).length, 1);
});
