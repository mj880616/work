import test from 'node:test';
import assert from 'node:assert/strict';

// NOTE-파일붙이기: files on a note use the existing app_notes.attachments (no new table). [빼기] takes one file off the note with
// the owner-RLS PATCH (guarded by the version read, attachments + updated_at only); the Drive file is never touched. Deleting a
// note removes it and its links and keeps its files in Drive. Uploads are the basket-files path with the note's id, no OCR.
globalThis.window = {dispatchEvent: () => true, addEventListener: () => {}};
const {detachNoteFile, readNoteDoc} = await import('../app/basket-data.js');
const {uploadNoteFiles, createUploadBatch, fileTitle} = await import('../app/basket-upload.js');
const {deleteNoteOriginal, noteDocDeleteConfirmText} = await import('../app/basket-record-delete.js');

const file = (id, name = id + '.pdf') => ({drive_file_id: id, file_name: name, mime_type: 'application/pdf', size_bytes: 10});
const rtWith = api => ({context: {read: () => ({user: {id: 'owner'}, workspace: {id: 'w'}})}, api});

test('[빼기] writes attachments and updated_at only, guarded by the version read, on this note kind only', async () => {
  const calls = [];
  const fresh = {id: 'n1', updated_at: '2026-10-22T01:00:00.123456Z', attachments: [file('a'), file('b'), file('c')]};
  const rt = rtWith(async (path, options = {}) => {
    calls.push({path, options});
    if (!options.method) return [fresh];
    return [{...fresh, ...options.body, title: '노트', metadata: {pinned_at: 'x'}}];
  });
  const {row, already} = await detachNoteFile('n1', 'b', rt, new Date('2026-10-22T02:00:00Z'));
  assert.equal(already, false);
  assert.deepEqual(row.attachments.map(f => f.drive_file_id), ['a', 'c']);
  const [read, patch] = calls;
  assert.match(read.path, /^\/rest\/v1\/app_notes\?id=eq\.n1&workspace_id=eq\.w&kind=eq\.note&select=id,updated_at,attachments$/);
  assert.equal(patch.options.method, 'PATCH');
  assert.deepEqual(Object.keys(patch.options.body).sort(), ['attachments', 'updated_at']);
  assert.deepEqual(patch.options.body.attachments, [file('a'), file('c')]);
  assert.equal(patch.options.body.updated_at, '2026-10-22T02:00:00.000Z');
  assert.match(patch.path, /kind=eq\.note/);
  assert.match(patch.path, /workspace_id=eq\.w/);
  assert.match(patch.path, /updated_at=eq\.2026-10-22T01%3A00%3A00\.123456Z/);
  // Nothing here reaches Google Drive or a function: the link only.
  assert.equal(calls.some(c => /functions|drive|googleapis/.test(c.path)), false);
});

test('[빼기] of a file already gone writes nothing; a row changed in between is reported, not overwritten', async () => {
  const writes = [];
  const gone = rtWith(async (path, options = {}) => { if (options.method) writes.push(path); return [{id: 'n1', updated_at: 't', attachments: [file('a')], title: '노트'}]; });
  const result = await detachNoteFile('n1', 'zzz', gone);
  assert.equal(result.already, true); assert.equal(result.row.id, 'n1'); assert.deepEqual(writes, []);
  const raced = rtWith(async (path, options = {}) => options.method ? [] : [{id: 'n1', updated_at: 't', attachments: [file('a')]}]);
  await assert.rejects(detachNoteFile('n1', 'a', raced), error => error.code === 'note_changed');
  const missing = rtWith(async () => []);
  await assert.rejects(detachNoteFile('n1', 'a', missing), error => error.code === 'note_missing');
  assert.equal(await readNoteDoc('n1', missing), null);
});

test('a note upload is the basket-files request with the note id, never OCR, and never another row\'s batch', async () => {
  const sent = [];
  const rt = {copyUploadFile: async f => new File([await f.arrayBuffer()], f.name, {type: f.type})};
  const batch = createUploadBatch();
  batch.entries = [{file: new File(['x'], '회의 자료.pdf', {type: 'application/pdf'}), kind: 'pending'}, {file: new File(['y'], 'photo.jpg', {type: 'image/jpeg'}), kind: 'pending'}];
  const ocr = {enabled: true, capabilities: async () => { throw new Error('OCR must not run for a note'); }};
  const request = async fd => { sent.push({note: fd.get('note_id'), text: fd.get('raw_text'), name: fd.get('file').name}); return {ok: true, note_id: 'note-1', attachments: sent.map((s, i) => ({drive_file_id: 'f' + i, file_name: s.name, mime_type: 'image/jpeg', size_bytes: 1}))}; };
  const result = await uploadNoteFiles('note-1', batch, {rt, request, ocr});
  assert.equal(result.note_id, 'note-1');
  assert.deepEqual(sent, [{note: 'note-1', text: null, name: '회의 자료.pdf'}, {note: 'note-1', text: null, name: 'photo.jpg'}]);
  const other = createUploadBatch('basket-row'); other.entries = [{file: new File(['x'], 'a.txt'), kind: 'pending'}];
  await assert.rejects(uploadNoteFiles('note-1', other, {rt, request}), error => error.code === 'batch_other_row');
  const unknown = createUploadBatch(); unknown.entries = [{file: new File(['x'], 'a.txt'), kind: 'pending'}];
  await assert.rejects(uploadNoteFiles('note-2', unknown, {rt, request: async () => { throw Object.assign(new Error('x'), {status: 503}); }}),
    error => error.code === 'note_save_result_unknown' && /노트를 다시 열어/.test(error.message) && !/바구니/.test(error.message));
  assert.equal(fileTitle('  보고서\r\n최종.hwp '), '보고서 최종.hwp');
  assert.equal([...fileTitle('가'.repeat(300))].length, 200);
});

test('deleting a note removes the row with the owner-RLS delete and never asks the server to trash its files', async () => {
  const calls = [];
  const rt = {config: {url: 'https://sb.invalid', key: 'anon'}, context: {read: () => ({user: {id: 'owner'}, workspace: {id: 'w'}})},
    session: {epoch: () => 1, ensure: async () => true, read: () => ({access_token: 'jwt', user: {id: 'owner'}})},
    api: async (path, options = {}) => {
      calls.push({path, method: options.method || 'GET'});
      if (path.startsWith('/rest/v1/app_notes') && !options.method) return [{id: 'n1', updated_at: 't', attachments: [file('a'), file('b')]}];
      if (path.startsWith('/rest/v1/app_record_links')) return [{id: 'l1', organization_id: 'o'}];
      if (options.method === 'DELETE') return [{id: 'n1'}];
      return [];
    }};
  const fetched = [];
  const asked = [];
  globalThis.confirm = text => { asked.push(text); return true; };
  try {
    const result = await deleteNoteOriginal('n1', {rt, keepFiles: true, describe: noteDocDeleteConfirmText, fetcher: async (...args) => { fetched.push(args); throw new Error('no server call'); }});
    assert.deepEqual(result, {status: 'deleted', message: '노트를 지웠어요. 첨부 파일은 Drive에 그대로 남아 있어요.'});
  } finally { delete globalThis.confirm; }
  assert.deepEqual(asked, ['노트 원문을 지웁니다. 연결된 조직·프로젝트 1곳에서도 사라집니다. 첨부 파일 2개는 노트에서만 빠지고 Drive에는 그대로 남아요.']);
  assert.deepEqual(fetched, []);
  assert.deepEqual(calls.filter(c => c.method !== 'GET').map(c => c.method), ['DELETE']);
  assert.equal(calls.some(c => /functions\/v1/.test(c.path)), false);
});
