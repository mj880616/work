// LIB-AI자동분류: _shared/document-text.ts (the one place that reads a document file's text, shared later by global search)
// and document-actions `document-text`. Synthetic Drive and PostgREST only; no network, no OpenAI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { deflateRawSync } from 'node:zlib';
import { readBoundedJson } from '../../supabase/functions/_shared/bounded-json.mjs';
import { inspectBasketOriginal } from '../../supabase/functions/_shared/basket-file-origin.ts';
import { createHwpEdit, HwpEditError } from '../../supabase/functions/_shared/hwp-edit.ts';
import * as dt from '../../supabase/functions/_shared/document-text.ts';

// Minimal zip writer (stored or deflated entries) for synthetic HWPX files.
function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, text, deflate] of entries) {
    const raw = Buffer.from(text, 'utf8'), data = deflate ? deflateRawSync(raw) : raw, n = Buffer.from(name, 'utf8');
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(deflate ? 8 : 0, 8); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    local.push(h, n, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(deflate ? 8 : 0, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, cd, e]));
}
const section = paras => `<?xml version="1.0"?><hs:sec xmlns:hp="x">${paras.map(p => `<hp:p><hp:run><hp:t>${p}</hp:t></hp:run></hp:p>`).join('')}</hs:sec>`;

test('textKindOf: extension first, then Drive type; photos and others are not read', () => {
  assert.equal(dt.textKindOf('a.hwpx', ''), 'hwpx');
  assert.equal(dt.textKindOf('a.PDF', ''), 'convert');
  assert.equal(dt.textKindOf('a.hwp', ''), 'convert');
  assert.equal(dt.textKindOf('a.md', ''), 'text');
  for (const name of ['a.jpg', 'a.png', 'a.zip', 'a.xlsx', 'a.pptx']) assert.equal(dt.textKindOf(name, 'application/pdf'), 'none', name);
  assert.equal(dt.textKindOf('noext', 'application/pdf'), 'convert');
  assert.equal(dt.textKindOf('noext', 'image/jpeg'), 'none');
});

test('hwpxText reads section XML in order, decodes entities, ignores other parts', async () => {
  const bytes = zip([
    ['mimetype', 'application/hwp+zip', false],
    ['Contents/section1.xml', section(['둘째 쪽']), true],
    ['Contents/section0.xml', section(['2026년 임금교섭 요구안', 'A &amp; B &lt;회의&gt;']), true],
    ['Contents/header.xml', section(['머리 정보 HIDDEN']), false],
  ]);
  assert.equal(await dt.hwpxText(bytes), '2026년 임금교섭 요구안\nA & B <회의>\n둘째 쪽');
  await assert.rejects(dt.hwpxText(new Uint8Array([1, 2, 3])), /HWPX_NOT_ZIP/);
});

test('tidyText trims control characters and cuts to the limit with a flag', () => {
  assert.deepEqual(dt.tidyText('  가\u0000나\r\n\n\n\n다  '), { text: '가나\n\n다', cut: false });
  const long = dt.tidyText('가'.repeat(dt.DOCUMENT_TEXT_CHARS + 5));
  assert.equal([...long.text].length, dt.DOCUMENT_TEXT_CHARS); assert.equal(long.cut, true);
});

function drive({ copyStatus = 200, copyMime = 'application/vnd.google-apps.document', exportText = '표지 제목\n국토교통부', deleteStatus = 204, media = null } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(String(url)), method = init.method || 'GET';
    calls.push({ path: u.pathname + u.search, method, body: init.body });
    if (u.pathname.endsWith('/copy')) return copyStatus === 200 ? Response.json({ id: 'temp-1', mimeType: copyMime }) : Response.json({}, { status: copyStatus });
    if (u.pathname.endsWith('/export')) return new Response(exportText);
    if (method === 'DELETE') return new Response(null, { status: deleteStatus });
    if (u.searchParams.get('alt') === 'media') return new Response(media);
    throw Error('unexpected ' + method + ' ' + u.pathname);
  };
  return { calls, fetch };
}

test('convert path (PDF/HWP): temporary Google Doc copy is exported then deleted; the original is never written', async () => {
  const d = drive();
  const reader = dt.createDocumentText({ fetch: d.fetch, driveToken: async () => 'tok' });
  const r = await reader.extract({ fileId: 'orig-1', name: '보고서.pdf', mime: 'application/pdf', size: 1000 });
  assert.deepEqual(r, { text: '표지 제목\n국토교통부', source: 'content', reason: 'ok', cut: false });
  assert.deepEqual(d.calls.map(c => c.method + ' ' + c.path.split('?')[0]), ['POST /drive/v3/files/orig-1/copy', 'GET /drive/v3/files/temp-1/export', 'DELETE /drive/v3/files/temp-1']);
  const copy = JSON.parse(d.calls[0].body);
  assert.equal(copy.mimeType, 'application/vnd.google-apps.document');
  // No write (PATCH/PUT/DELETE) to the original file id, so its name and place never change.
  assert.ok(!d.calls.some(c => c.path.includes('orig-1') && c.method !== 'POST' && c.method !== 'GET'));
  assert.ok(!d.calls.some(c => c.method === 'PATCH'));
});

test('convert failures: unsupported type, export failure still deletes the temp copy; photos are not downloaded', async () => {
  {const d = drive({ copyStatus: 400 }); const r = await dt.createDocumentText({ fetch: d.fetch, driveToken: async () => 't' }).extract({ fileId: 'o', name: 'a.hwp', mime: '', size: 10 });
   assert.equal(r.reason, 'unsupported'); assert.equal(r.text, '');}
  {const d = drive({ copyMime: 'application/pdf' }); const r = await dt.createDocumentText({ fetch: d.fetch, driveToken: async () => 't' }).extract({ fileId: 'o', name: 'a.pdf', mime: '', size: 10 });
   assert.equal(r.source, 'none'); assert.ok(d.calls.some(c => c.method === 'DELETE' && c.path.includes('temp-1')));}
  {const d = drive(); const r = await dt.createDocumentText({ fetch: d.fetch, driveToken: async () => 't' }).extract({ fileId: 'o', name: '사진.jpg', mime: 'image/jpeg', size: 10 });
   assert.equal(r.reason, 'unsupported'); assert.equal(d.calls.length, 0);}
  {const d = drive(); const r = await dt.createDocumentText({ fetch: d.fetch, driveToken: async () => 't' }).extract({ fileId: 'o', name: 'big.pdf', mime: '', size: dt.CONVERT_MAX_BYTES + 1 });
   assert.equal(r.reason, 'too_large'); assert.equal(d.calls.length, 0);}
});

test('hwpx and text files are downloaded and read without conversion', async () => {
  const d = drive({ media: zip([['Contents/section0.xml', section(['한글 표지 제목']), true]]) });
  const r = await dt.createDocumentText({ fetch: d.fetch, driveToken: async () => 't' }).extract({ fileId: 'h', name: '요구안.hwpx', mime: '', size: 100 });
  assert.equal(r.text, '한글 표지 제목'); assert.ok(!d.calls.some(c => c.path.includes('/copy')));
});

// document-actions `document-text`: the server reads the row, checks the owner, writes only the existing text columns.
const source = stripTypeScriptTypes(readFileSync(new URL('../../supabase/functions/document-actions/index.ts', import.meta.url), 'utf8'), { mode: 'strip' })
  .replace(/^import .*$/gm, '');
const DOC = '20000000-0000-4000-8000-000000000001';
function actions({ role = 'owner', doc = { id: DOC, workspace_id: 'ws-1', file_id: 'drive-1', file_name: '보고서.pdf', mime_type: 'application/pdf', file_size: 100, extraction_status: null } } = {}) {
  const calls = []; let handler;
  const fetchMock = async (url, init = {}) => {
    const u = new URL(String(url)), method = init.method || 'GET';
    calls.push({ path: u.pathname + u.search, method, body: typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body });
    if (u.pathname === '/auth/v1/user') return Response.json({ id: 'owner-1' });
    if (u.pathname === '/token') return Response.json({ access_token: 'drive-token' });
    const table = u.pathname.startsWith('/rest/v1/') ? u.pathname.split('/').at(-1) : null;
    if (table === 'public_policy_drive_config') return Response.json([{ google_client_id: 'c', google_client_secret: 's', google_refresh_token: 'r' }]);
    if (table === 'app_workspace_members') return Response.json(role ? [{ role }] : []);
    if (table === 'app_documents' && method === 'GET') return Response.json(doc ? [doc] : []);
    if (table === 'app_documents' && method === 'PATCH') return new Response(null, { status: 204 });
    if (u.pathname.endsWith('/copy')) return Response.json({ id: 'temp-9', mimeType: 'application/vnd.google-apps.document' });
    if (u.pathname.endsWith('/export')) return new Response('표지 제목');
    if (method === 'DELETE') return new Response(null, { status: 204 });
    throw Error(`Unexpected ${method} ${u.pathname}`);
  };
  const Deno = { env: { get: k => ({ SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k] }, serve: fn => { handler = fn; } };
  new Function('Deno', 'fetch', 'console', 'inspectBasketOriginal', 'readBoundedJson', 'createHwpEdit', 'HwpEditError', 'createDocumentText', source)(
    Deno, fetchMock, { error() {} }, inspectBasketOriginal, readBoundedJson, createHwpEdit, HwpEditError, opts => dt.createDocumentText({ ...opts, fetch: fetchMock }));
  return { calls, send: async body => { const r = await handler(new Request('https://sb.example/functions/v1/document-actions', { method: 'POST', headers: { Authorization: 'Bearer user-token' }, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; } };
}

test('document-text: owner reads text into the existing extracted_text columns; response carries no text', async () => {
  const h = actions();
  const r = await h.send({ action: 'document-text', document_id: DOC });
  assert.deepEqual(r, { status: 200, body: { ok: true, status: 'ready', reason: 'ok' } });
  const patch = h.calls.find(c => c.method === 'PATCH');
  assert.match(patch.path, /app_documents\?id=eq\.20000000-0000-4000-8000-000000000001&workspace_id=eq\.ws-1/);
  assert.deepEqual(Object.keys(patch.body).sort(), ['extracted_at', 'extracted_text', 'extraction_error', 'extraction_status']);
  assert.equal(patch.body.extracted_text, '표지 제목');
  // The original Drive file (drive-1) is copied but never renamed, moved or trashed.
  assert.ok(!h.calls.some(c => c.path.startsWith('/drive/v3/files/drive-1') && c.method !== 'POST'));
});

test('document-text: refuses non-owner, bad id, missing document; cached text is not read again', async () => {
  assert.equal((await actions({ role: 'editor' }).send({ action: 'document-text', document_id: DOC })).status, 400);
  assert.equal((await actions().send({ action: 'document-text', document_id: 'x' })).body.code, 'INVALID_REQUEST');
  assert.equal((await actions({ doc: null }).send({ action: 'document-text', document_id: DOC })).body.code, 'DOCUMENT_NOT_FOUND');
  const cached = actions({ doc: { id: DOC, workspace_id: 'ws-1', file_id: 'drive-1', file_name: 'a.pdf', extraction_status: 'ready' } });
  assert.deepEqual((await cached.send({ action: 'document-text', document_id: DOC })).body, { ok: true, status: 'ready', reason: 'cached' });
  assert.ok(!cached.calls.some(c => c.path.includes('/drive/') || c.method === 'PATCH'));
  const photo = actions({ doc: { id: DOC, workspace_id: 'ws-1', file_id: 'drive-1', file_name: '사진.jpg', mime_type: 'image/jpeg', file_size: 5, extraction_status: null } });
  assert.deepEqual((await photo.send({ action: 'document-text', document_id: DOC })).body, { ok: true, status: 'error', reason: 'unsupported' });
});
