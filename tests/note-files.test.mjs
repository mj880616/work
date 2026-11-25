import test from 'node:test';
import assert from 'node:assert/strict';

// NOTE-파일붙이기: files on a note use the existing app_notes.attachments (no new table). [빼기] takes one file off the note with
// the owner-RLS PATCH (guarded by the version read, attachments + updated_at only); the Drive file is never touched. Deleting a
// note removes it and its links and keeps its files in Drive. Uploads are the basket-files path with the note's id; new photos are read for letters afterwards (S69-98).
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

// S69-98 NOTE-에버노트 ④: 노트 첨부도 업데이트와 같이, 다 올린 뒤 새로 올라간 사진(JPEG·PNG)만 하나씩 글자를 읽는다(PDF·이미 있던 사진은 읽지 않음).
test('a note upload is the basket-files request with the note id, reads only its new photos after the upload, and never another row\'s batch', async () => {
  const sent = [], reads = [];
  const rt = {copyUploadFile: async f => new File([await f.arrayBuffer()], f.name, {type: f.type})};
  const batch = createUploadBatch('note-1', [{drive_file_id: 'old', file_name: 'old.jpg', mime_type: 'image/jpeg', size_bytes: 1}]);
  batch.entries = [{file: new File(['x'], '회의 자료.pdf', {type: 'application/pdf'}), kind: 'pending'}, {file: new File(['y'], 'photo.jpg', {type: 'image/jpeg'}), kind: 'pending'}];
  const ocr = {enabled: true, capabilities: async () => { assert.ok(batch.entries.every(e => e.kind === 'success'), 'OCR only after the whole upload'); return {ok: true}; },
    read: async (n, id) => { reads.push([n, id]); return {ok: false, code: 'OCR_FAILED', result_unknown: false}; }};
  const request = async fd => { sent.push({note: fd.get('note_id'), text: fd.get('raw_text'), name: fd.get('file').name}); return {ok: true, note_id: 'note-1', attachments: [{drive_file_id: 'old', file_name: 'old.jpg', mime_type: 'image/jpeg', size_bytes: 1}, ...sent.map((s, i) => ({drive_file_id: 'f' + i, file_name: s.name, mime_type: s.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg', size_bytes: 1}))]}; };
  const events = [], keep = globalThis.window;
  globalThis.window = {...keep, dispatchEvent: e => { if (e.type === 'kptu:note-files-sent') events.push(e.detail); return true; }};
  rt.context = {read: () => ({user: {id: 'u'}, workspace: {id: 'w'}})};
  let result;
  try {
    // 'later'(노트 화면 기본): 올리기가 먼저 끝나 돌아오고, 글자 읽기는 그 뒤에 따로 돈다.
    result = await uploadNoteFiles('note-1', batch, {rt, request, ocr});
    assert.deepEqual(reads, []);
    for (let i = 0; i < 20 && !reads.length; i++) await new Promise(r => setTimeout(r, 5));
    await new Promise(r => setTimeout(r, 5));
  } finally { globalThis.window = keep; }
  assert.equal(result.note_id, 'note-1');
  assert.deepEqual(sent, [{note: 'note-1', text: null, name: '회의 자료.pdf'}, {note: 'note-1', text: null, name: 'photo.jpg'}]);
  assert.deepEqual(reads, [['note-1', 'f1']]); // 새 사진 하나만(PDF·옛 사진 제외), 읽기 실패는 올리기 결과를 바꾸지 않는다
  assert.equal(result.attachments.length, 3);
  assert.deepEqual(events, []); // 읽기가 실패했으니 노트를 다시 읽으라는 알림도 없다
  // 'wait'(새 노트를 창 닫은 뒤 올림): 글자 읽기까지 끝난 뒤 돌아오고, 읽은 글자가 batch에 들어 있다.
  const read = {drive_file_id: 'f0', file_name: 'p.jpg', mime_type: 'image/jpeg', size_bytes: 1, ocr: {state: 'done', text: '사진 속 글', original_file_id: 'f0', attempt_id: '22222222-2222-4222-8222-222222222222', temp_document_id: 't0', cleanup_state: 'deleted'}};
  const b2 = createUploadBatch('note-2'); b2.entries = [{file: new File(['y'], 'p.jpg', {type: 'image/jpeg'}), kind: 'pending'}];
  const ocr2 = {enabled: true, capabilities: async () => ({ok: true}), read: async () => ({ok: true, attachment: read})};
  rt.context = {read: () => ({user: {id: 'u'}, workspace: {id: 'w'}})};
  await uploadNoteFiles('note-2', b2, {rt, ocr: ocr2, photoText: 'wait', request: async () => ({ok: true, note_id: 'note-2', attachments: [{...read, ocr: undefined}].map(({ocr, ...f}) => f)})});
  assert.equal(b2.attachments[0].ocr.text, '사진 속 글');
  // 'later'에서 글자를 읽어 저장했으면 노트 화면이 그 노트를 다시 읽는다(글은 바뀌지 않음 — text:false).
  const seen = [], keep2 = globalThis.window;
  globalThis.window = {...keep2, dispatchEvent: e => { if (e.type === 'kptu:note-files-sent') seen.push(e.detail); return true; }};
  try {
    const b3 = createUploadBatch('note-3'); b3.entries = [{file: new File(['y'], 'p.jpg', {type: 'image/jpeg'}), kind: 'pending'}];
    await uploadNoteFiles('note-3', b3, {rt, ocr: ocr2, request: async () => ({ok: true, note_id: 'note-3', attachments: [{drive_file_id: 'f0', file_name: 'p.jpg', mime_type: 'image/jpeg', size_bytes: 1}]})});
    for (let i = 0; i < 20 && !seen.length; i++) await new Promise(r => setTimeout(r, 5));
  } finally { globalThis.window = keep2; }
  assert.deepEqual(seen, [{id: 'note-3', text: false}]);
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
  const ask = async text => { asked.push(text); return true; };
  try {
    const result = await deleteNoteOriginal('n1', {rt, ask, keepFiles: true, describe: noteDocDeleteConfirmText, fetcher: async (...args) => { fetched.push(args); throw new Error('no server call'); }});
    assert.deepEqual(result, {status: 'deleted', message: '노트를 삭제했어요. 첨부 파일은 Drive에 그대로 남아 있어요.'});
  } finally { /* 확인은 ask 주입(S48-28) */ }
  assert.deepEqual(asked, ['노트 원문을 지웁니다. 연결된 조직·사업영역 1곳에서도 사라집니다. 첨부 파일 2개는 노트에서만 빠지고 Drive에는 그대로 남아요.']);
  assert.deepEqual(fetched, []);
  assert.deepEqual(calls.filter(c => c.method !== 'GET').map(c => c.method), ['DELETE']);
  assert.equal(calls.some(c => /functions\/v1/.test(c.path)), false);
});
