// BRIEF-브리핑룸 ③: app/brief-room-model.mjs(화면 모델). DOM·네트워크 없음, 예시 자료만.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../app/brief-room-model.mjs';

test('rowState: start / making n/m / one-line lead / failed lines', () => {
  assert.equal(m.rowState(null).kind, 'start');
  assert.deepEqual(m.rowState({ status: 'running', step_no: 7, step_total: 12 }), { kind: 'making', text: '만드는 중 7/12', date: '' });
  const done = m.rowState({ status: 'done', brief: { lead: '인건비 배점이 늘어남.' }, finished_at: '2026-11-12T03:00:00Z' });
  assert.equal(done.text, '인건비 배점이 늘어남.'); assert.equal(done.date, '11/12');
  assert.equal(m.rowState({ status: 'failed', error_code: 'no_text' }).text, '글자를 읽을 수 없는 파일이에요');
  assert.equal(m.rowState({ status: 'failed', error_code: 'weird' }).text, '브리핑을 만들지 못했어요');
});

test('listRows: folder docs and briefed docs only, newest first', () => {
  const docs = [{ id: 'a', created_at: '2026-11-10T00:00:00Z' }, { id: 'b', created_at: '2026-11-11T00:00:00Z' }, { id: 'c', created_at: '2026-11-12T00:00:00Z' }];
  const briefs = m.latestByDocument([{ document_id: 'c', status: 'done', brief: { lead: 'x' }, created_at: '2026-11-13T00:00:00Z' }, { document_id: 'c', status: 'failed', created_at: '2026-11-01T00:00:00Z' }]);
  const rows = m.listRows({ docs, folderIds: new Set(['a']), briefs });
  assert.deepEqual(rows.map(r => r.doc.id), ['c', 'a']);
  assert.equal(rows[0].state.kind, 'done');
});

test('briefSections keeps four sections, drops bad quote fields', () => {
  const s = m.briefSections({ lead: 'x', touches: ['가', 3], todos: [], conflicts: ['나'], quotes: [{ text: '원문', page: 12, heading: '3.', why: '왜' }, { text: '' }, { text: '쪽 모름', page: 0 }] });
  assert.deepEqual(s.map(x => x.key), ['touches', 'todos', 'conflicts', 'quotes']);
  assert.deepEqual(s[0].lines, ['가']);
  assert.equal(s[3].quotes.length, 2); assert.equal(s[3].quotes[1].page, null);
});

test('fileBadge / sourceUrl / isStalled', () => {
  assert.equal(m.fileBadge('a.hwpx'), 'HWP'); assert.equal(m.fileBadge('b.PDF'), 'PDF'); assert.equal(m.fileBadge('c.docx'), 'DOC');
  assert.equal(m.sourceUrl({ file_id: 'FILE_abcdefghij', file_name: 'x.pdf' }, 31), 'https://drive.google.com/file/d/FILE_abcdefghij/view#page=31');
  assert.equal(m.sourceUrl({ file_id: 'FILE_abcdefghij', file_name: 'x.hwp' }, 31), 'https://drive.google.com/file/d/FILE_abcdefghij/view');
  assert.equal(m.sourceUrl({ file_id: 'bad id', drive_url: 'https://evil.example/' }), '');
  const now = Date.parse('2026-11-13T10:00:00Z');
  assert.equal(m.isStalled({ status: 'queued', lease_until: null, updated_at: '2026-11-13T09:59:00Z' }, now), true);
  assert.equal(m.isStalled({ status: 'running', lease_until: '2026-11-13T10:02:00Z', updated_at: '2026-11-13T09:59:00Z' }, now), false);
});

// BRIEF-브리핑룸삭제(S63-08): 두 가지 삭제 이름·확인 글·결과 글.
test('delete kinds: brief only / with document, confirm and result lines', () => {
  assert.deepEqual({ ...m.DELETE_KINDS }, { brief: '브리핑만 삭제', doc: '자료까지 삭제' });
  assert.equal(m.deleteConfirm('brief', 1, '예시 자료').text, '“예시 자료” 브리핑만 삭제할까요?');
  assert.match(m.deleteConfirm('brief', 1, '예시 자료').note, /자료실에 그대로/);
  assert.equal(m.deleteConfirm('doc', 3).text, '3개 자료까지 삭제할까요?');
  assert.match(m.deleteConfirm('doc', 3).note, /휴지통/);
  assert.equal(m.deleteConfirm('doc', 1).ok, '삭제');
  assert.deepEqual(m.deleteResult('brief', { done: 1 }), { text: '브리핑을 삭제했어요', error: false });
  assert.deepEqual(m.deleteResult('doc', { done: 2 }), { text: '2개 자료를 삭제했어요', error: false });
  assert.deepEqual(m.deleteResult('doc', { done: 1, failed: 1 }), { text: '1개는 삭제했고 1개는 삭제하지 못했어요', error: true });
  assert.deepEqual(m.deleteResult('brief', { failed: 1 }), { text: '브리핑을 삭제하지 못했어요', error: true });
});

test('brief-room.js: delete paths use the owner RPC, folder item delete and the shared document delete', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../app/brief-room.js', import.meta.url), 'utf8');
  assert.match(src, /\/rest\/v1\/rpc\/app_document_brief_delete/);
  assert.match(src, /app_library_folder_items\?workspace_id=eq\.\$\{enc\(ws\(\)\)\}&folder_id=eq\.\$\{enc\(state\.folderId\)\}&document_id=eq\./);
  assert.match(src, /import\('\.\/document-delete\.js'\)/);
  assert.match(src, /deleteSequentially/);
  assert.match(src, /createSelectMode/);
  // 기기 저장 금지는 CI audit이 본다. 브리핑 표에 직접 DELETE 요청은 없다(서버 함수로만).
  assert.doesNotMatch(src, /app_document_briefs\?[^`]*method:'DELETE'/);
});
