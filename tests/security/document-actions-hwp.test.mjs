// HWP-편집기 2단계: document-actions `hwp-open` and `hwp-overwrite` (../../supabase/functions/_shared/hwp-edit.ts).
// The real handler runs against mocked Auth/REST/Drive. Files and workspaces come from server rows only; overwrite
// needs the opened revision, a verified backup copy first, and is never retried or followed by a Drive delete.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { readBoundedJson } from '../../supabase/functions/_shared/bounded-json.mjs';
import { inspectBasketOriginal } from '../../supabase/functions/_shared/basket-file-origin.ts';
import { createHwpEdit, HwpEditError, backupName, stamp } from '../../supabase/functions/_shared/hwp-edit.ts';

const source = stripTypeScriptTypes(readFileSync(new URL('../../supabase/functions/document-actions/index.ts', import.meta.url), 'utf8'), { mode: 'strip' })
  .replace(/^import .*$/gm, '');
const DOC = '20000000-0000-4000-8000-000000000001', NOTE = '10000000-0000-4000-8000-000000000001', FILE = 'drive-hwp_1';
const HWP = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]), HWPX = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 9, 9]);
const MD5A = 'a'.repeat(32), MD5B = 'b'.repeat(32), MD5C = 'c'.repeat(32);

function harness(o = {}) {
  const state = {
    role: 'owner',
    document: { id: DOC, workspace_id: 'ws-1', file_id: FILE, file_name: '주간보고.hwp' },
    note: { id: NOTE, workspace_id: 'ws-1', attachments: [{ drive_file_id: FILE, file_name: '주간보고.hwp', mime_type: 'application/x-hwp', size_bytes: 8 }] },
    noteRefs: [], libraryRefs: [],
    content: HWP,
    drive: { id: FILE, name: '주간보고.hwp', mimeType: 'application/x-hwp', size: String(HWP.length), md5Checksum: MD5A, headRevisionId: 'rev-1', trashed: false, ownedByMe: true },
    folders: [{ id: 'backup-folder', ownedByMe: true, trashed: false }],
    ...o,
  };
  const calls = [];
  let handler, metaReads = 0;
  const fetchMock = async (url, init = {}) => {
    const u = new URL(String(url)), method = init.method || 'GET';
    calls.push({ path: u.pathname, search: u.searchParams, method, body: init.body });
    if (u.pathname === '/auth/v1/user') return Response.json({ id: 'owner-1' });
    if (u.pathname === '/token') return Response.json({ access_token: 'drive-token' });
    const table = u.pathname.startsWith('/rest/v1/') ? u.pathname.split('/').at(-1) : null;
    if (table === 'public_policy_drive_config') return Response.json([{ google_client_id: 'c', google_client_secret: 's', google_refresh_token: 'r' }]);
    if (table === 'app_workspace_members') return Response.json(state.role ? [{ role: state.role }] : []);
    if (table === 'app_documents') {
      if (u.searchParams.get('id')) return Response.json(state.document && u.searchParams.get('id') === 'eq.' + state.document.id ? [state.document] : []);
      return Response.json(state.libraryRefs);
    }
    if (table === 'app_notes') {
      if (u.searchParams.get('id')) return Response.json(state.note && u.searchParams.get('id') === 'eq.' + state.note.id ? [state.note] : []);
      assert.equal(u.searchParams.get('attachments'), `cs.${JSON.stringify([{ drive_file_id: FILE }])}`);
      return Response.json(state.noteRefs);
    }
    if (u.hostname === 'www.googleapis.com') {
      if (u.pathname === '/drive/v3/files' && method === 'GET') {
        if (state.folderSearchStatus) return Response.json({}, { status: state.folderSearchStatus });
        return Response.json({ files: state.folders });
      }
      if (u.pathname === '/drive/v3/files' && method === 'POST') { state.folders.push({ id: 'new-folder', ownedByMe: true, trashed: false }); return Response.json({ id: 'new-folder' }); }
      if (u.pathname === `/drive/v3/files/${FILE}/copy`) {
        if (state.copyStatus) return Response.json({}, { status: state.copyStatus });
        return Response.json({ id: 'backup-copy', name: JSON.parse(init.body).name, md5Checksum: state.copyMd5 ?? state.drive.md5Checksum });
      }
      if (u.pathname === `/upload/drive/v3/files/${FILE}`) {
        if (state.uploadThrows) throw new TypeError('network');
        if (state.uploadStatus) return Response.json({}, { status: state.uploadStatus });
        return Response.json(state.uploadBody ?? { id: FILE, headRevisionId: 'rev-2', md5Checksum: MD5B, size: String(init.body.length) });
      }
      if (u.pathname === `/drive/v3/files/${FILE}` && method === 'GET') {
        if (u.searchParams.get('alt') === 'media') return new Response(state.content);
        metaReads++;
        if (state.driveStatus) return Response.json({}, { status: state.driveStatus });
        return Response.json(typeof state.metaAt === 'function' ? state.metaAt(metaReads, state.drive) : state.drive);
      }
    }
    throw Error(`Unexpected ${method} ${u.href}`);
  };
  const Deno = { env: { get: k => ({ SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k] }, serve: fn => { handler = fn; } };
  new Function('Deno', 'fetch', 'console', 'inspectBasketOriginal', 'readBoundedJson', 'createHwpEdit', 'HwpEditError', source)(Deno, fetchMock, { error() {} }, inspectBasketOriginal, readBoundedJson, createHwpEdit, HwpEditError);
  const call = async init => {
    const r = await handler(new Request('https://sb.example/functions/v1/document-actions', { method: 'POST', ...init, headers: { Authorization: 'Bearer user-token', ...(init.headers || {}) } }));
    const info = r.headers.get('X-Web2-Hwp');
    if (info) return { status: r.status, info: JSON.parse(decodeURIComponent(info)), bytes: new Uint8Array(await r.arrayBuffer()), headers: r.headers };
    return { status: r.status, body: await r.json() };
  };
  return {
    state, calls,
    open: body => call({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'hwp-open', ...body }) }),
    overwrite: (fields, bytes = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 7, 7, 7])) => {
      const form = new FormData();
      form.set('action', 'hwp-overwrite');
      for (const [k, v] of Object.entries(fields)) form.set(k, v);
      if (bytes) form.set('file', new File([bytes], 'ignored-name.hwp', { type: 'application/x-hwp' }));
      return call({ body: form });
    },
  };
}
const drive = h => h.calls.filter(c => c.path.includes('/drive/v3/'));
const driveWrites = h => drive(h).filter(c => c.method !== 'GET');
const base = { base_revision: 'rev-1', base_md5: MD5A };

test('opens a library HWP from the server-read row with its Drive revision', async () => {
  const h = harness();
  const r = await h.open({ document_id: DOC, workspace_id: 'other-ws', file_id: 'client-file' });
  assert.equal(r.status, 200);
  assert.deepEqual([...r.bytes], [...HWP]);
  assert.deepEqual(r.info, { source: 'library', file_name: '주간보고.hwp', format: 'hwp', size: HWP.length, revision: 'rev-1', md5: MD5A, can_overwrite: true, shared: false });
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.match(r.headers.get('Access-Control-Expose-Headers'), /X-Web2-Hwp/);
  assert.ok(drive(h).every(c => c.path.endsWith(FILE)), 'only the server-read Drive file');
  assert.deepEqual(driveWrites(h), []);
});

test('opens a basket HWPX attachment: overwrite is not offered and library sharing is reported', async () => {
  const h = harness({ note: { id: NOTE, workspace_id: 'ws-1', attachments: [{ drive_file_id: FILE, file_name: '안건.hwpx' }] }, content: HWPX, drive: { id: FILE, size: String(HWPX.length), md5Checksum: MD5A, headRevisionId: 'rev-1', trashed: false, ownedByMe: true }, libraryRefs: [{ id: DOC }] });
  const r = await h.open({ note_id: NOTE, drive_file_id: FILE });
  assert.equal(r.status, 200);
  assert.equal(r.info.format, 'hwpx');
  assert.equal(r.info.can_overwrite, false);
  assert.equal(r.info.shared, true);
  assert.deepEqual(driveWrites(h), []);
});

test('refusals happen before Drive: not owner, not HWP, unknown or mixed sources', async () => {
  for (const [o, body, code] of [
    [{ role: 'member' }, { document_id: DOC }, 'HWP_REFUSED'],
    [{ document: { id: DOC, workspace_id: 'ws-1', file_id: FILE, file_name: '사진.jpg' } }, { document_id: DOC }, 'NOT_HWP'],
    [{}, { document_id: '20000000-0000-4000-8000-000000000009' }, 'DOCUMENT_NOT_FOUND'],
    [{}, { note_id: NOTE, drive_file_id: 'someone-else' }, 'ATTACHMENT_NOT_FOUND'],
    [{}, { document_id: DOC, note_id: NOTE, drive_file_id: FILE }, 'INVALID_REQUEST'],
    [{}, { document_id: 'not-a-uuid' }, 'INVALID_REQUEST'],
  ]) {
    const h = harness(o);
    const r = await h.open(body);
    assert.equal(r.status, 400, code);
    assert.equal(r.body.code, code);
    assert.deepEqual(drive(h), [], code);
  }
});

test('Drive problems on open are refusals that change nothing', async () => {
  for (const [o, status, code] of [
    [{ driveStatus: 404 }, 400, 'DRIVE_FILE_MISSING'],
    [{ drive: { id: FILE, size: '8', md5Checksum: MD5A, headRevisionId: 'rev-1', trashed: true, ownedByMe: true } }, 400, 'DRIVE_FILE_TRASHED'],
    [{ drive: { id: FILE, size: '8', md5Checksum: MD5A, headRevisionId: 'rev-1', trashed: false, ownedByMe: false } }, 400, 'DRIVE_FILE_INVALID'],
    [{ drive: { id: FILE, size: String(31 * 1024 * 1024), md5Checksum: MD5A, headRevisionId: 'rev-1', trashed: false, ownedByMe: true } }, 400, 'FILE_TOO_LARGE'],
    [{ metaAt: (n, d) => n === 1 ? d : { ...d, headRevisionId: 'rev-9' } }, 409, 'DRIVE_FILE_CHANGING'],
    [{ content: HWPX }, 409, 'DRIVE_FILE_CHANGING'],
    [{ content: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]) }, 400, 'NOT_HWP'],
  ]) {
    const h = harness(o);
    const r = await h.open({ document_id: DOC });
    assert.equal(r.status, status, code);
    assert.equal(r.body.code, code);
    assert.deepEqual(driveWrites(h), [], code);
  }
});

test('overwrite keeps a dated backup copy of the opened revision first, then writes the HWP once', async () => {
  const h = harness({ now: true });
  const r = await h.overwrite({ document_id: DOC, ...base, workspace_id: 'other-ws', folder_id: 'client-folder' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.result, 'overwritten');
  assert.equal(r.body.revision, 'rev-2');
  assert.equal(r.body.backup.id, 'backup-copy');
  assert.match(r.body.backup.name, /^주간보고 편집 전 백업 \d{4}-\d{2}-\d{2} \d{4}\.hwp$/);
  const writes = driveWrites(h).map(c => `${c.method} ${c.path}`);
  assert.deepEqual(writes, [`POST /drive/v3/files/${FILE}/copy`, `PATCH /upload/drive/v3/files/${FILE}`]);
  const copy = driveWrites(h)[0];
  assert.deepEqual(JSON.parse(copy.body).parents, ['backup-folder']);
  const search = drive(h).find(c => c.path === '/drive/v3/files' && c.method === 'GET');
  assert.match(search.search.get('q'), /name = 'Web2 편집 백업'.*'root' in parents and 'me' in owners and trashed = false/);
  // Drive revision checked before the copy and again right before the write.
  const order = drive(h).map(c => c.method + (c.path.endsWith('/copy') ? ' copy' : c.path.startsWith('/upload') ? ' upload' : c.path === '/drive/v3/files' ? ' folder' : ' meta'));
  assert.deepEqual(order, ['GET meta', 'GET folder', 'POST copy', 'GET meta', 'PATCH upload']);
  assert.equal(drive(h).some(c => c.method === 'DELETE'), false);
});

test('the backup folder is created once in My Drive root when missing', async () => {
  const h = harness({ folders: [] });
  const r = await h.overwrite({ note_id: NOTE, drive_file_id: FILE, ...base });
  assert.equal(r.status, 200);
  const created = driveWrites(h).find(c => c.path === '/drive/v3/files');
  assert.deepEqual(JSON.parse(created.body), { name: 'Web2 편집 백업', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] });
  assert.deepEqual(JSON.parse(driveWrites(h).find(c => c.path.endsWith('/copy')).body).parents, ['new-folder']);
});

test('a changed Drive original is never overwritten', async () => {
  for (const o of [
    { drive: { id: FILE, size: '8', md5Checksum: MD5C, headRevisionId: 'rev-1', trashed: false, ownedByMe: true } },
    { drive: { id: FILE, size: '8', md5Checksum: MD5A, headRevisionId: 'rev-7', trashed: false, ownedByMe: true } },
    { metaAt: (n, d) => n === 1 ? d : { ...d, headRevisionId: 'rev-8' } },
    { copyMd5: MD5C },
  ]) {
    const h = harness(o);
    const r = await h.overwrite({ document_id: DOC, ...base });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'VERSION_CHANGED');
    assert.match(r.body.error, /새 파일로 저장/);
    assert.equal(driveWrites(h).some(c => c.path.startsWith('/upload')), false);
    assert.equal(drive(h).some(c => c.method === 'DELETE'), false, 'a backup copy is never removed');
  }
});

test('without a verified backup the original is not overwritten', async () => {
  for (const o of [{ folderSearchStatus: 500 }, { copyStatus: 403 }, { copyStatus: 500 }]) {
    const h = harness(o);
    const r = await h.overwrite({ document_id: DOC, ...base });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'BACKUP_FAILED');
    assert.equal(driveWrites(h).some(c => c.path.startsWith('/upload')), false);
  }
});

test('HWPX originals, bad content and missing versions are refused before any Drive call', async () => {
  for (const [o, fields, bytes, code] of [
    [{ document: { id: DOC, workspace_id: 'ws-1', file_id: FILE, file_name: '안건.hwpx' } }, { document_id: DOC, ...base }, undefined, 'OVERWRITE_HWP_ONLY'],
    [{}, { document_id: DOC, ...base }, Uint8Array.from([0x50, 0x4b, 0x03, 0x04]), 'NOT_HWP'],
    [{}, { document_id: DOC, ...base }, null, 'FILE_MISSING'],
    [{}, { document_id: DOC, base_revision: 'rev-1' }, undefined, 'INVALID_REQUEST'],
    [{ role: 'member' }, { document_id: DOC, ...base }, undefined, 'HWP_REFUSED'],
  ]) {
    const h = harness(o);
    const r = await h.overwrite(fields, bytes);
    assert.equal(r.status, 400, code);
    assert.equal(r.body.code, code);
    assert.deepEqual(drive(h), [], code);
  }
});

test('a file both the library and the basket use needs the shared confirmation', async () => {
  for (const [o, fields] of [[{ noteRefs: [{ id: NOTE }] }, { document_id: DOC }], [{ libraryRefs: [{ id: DOC }] }, { note_id: NOTE, drive_file_id: FILE }]]) {
    const refused = harness(o);
    const r = await refused.overwrite({ ...fields, ...base });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'SHARED_CONFIRM_REQUIRED');
    assert.deepEqual(drive(refused), []);
    const confirmed = harness(o);
    assert.equal((await confirmed.overwrite({ ...fields, ...base, confirm_shared: '1' })).status, 200);
  }
});

test('an unknown write result is reported once with the backup and never sent again', async () => {
  for (const o of [{ uploadThrows: true }, { uploadStatus: 500 }, { uploadStatus: 502 }, { uploadBody: { id: FILE } }, { uploadBody: { id: FILE, headRevisionId: 'rev-2', md5Checksum: MD5B, size: '1' } }]) {
    const h = harness(o);
    const r = await h.overwrite({ document_id: DOC, ...base });
    assert.equal(r.status, 503, JSON.stringify(o));
    assert.equal(r.body.code, 'RESULT_UNKNOWN');
    assert.deepEqual(r.body.backup.id, 'backup-copy');
    assert.equal(driveWrites(h).filter(c => c.path.startsWith('/upload')).length, 1);
    assert.equal(drive(h).some(c => c.method === 'DELETE'), false);
  }
  const rejected = harness({ uploadStatus: 403 });
  const r = await rejected.overwrite({ document_id: DOC, ...base });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'OVERWRITE_REJECTED');
});

test('backup names carry the Korean date and time', () => {
  const at = new Date('2026-10-15T05:30:00Z');
  assert.equal(stamp(at), '2026-10-15 1430');
  assert.equal(backupName('주간보고.HWP', at), '주간보고 편집 전 백업 2026-10-15 1430.hwp');
});

test('the existing JSON actions are unchanged by the HWP routes', async () => {
  const h = harness();
  const r = await h.open({ action: 'something-else', document_id: DOC });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'Unknown action');
  const form = harness();
  const f = new FormData(); f.set('action', 'delete'); f.set('document_id', DOC);
  const other = await form.overwrite({ action: 'delete', document_id: DOC });
  assert.equal(other.status, 400);
  assert.equal(other.body.error, 'Unknown action');
  assert.deepEqual(drive(form), []);
});
