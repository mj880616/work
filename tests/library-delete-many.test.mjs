// S70 LIB-묶음삭제: 자료실 여러 개 지우기 순수 규칙(app/library-delete-many.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LINKED_NOTES, isLinkedOriginal, chunks, deleteInChunks, confirmNote, resultLine, preservedNote, DELETE_CHUNK } from '../app/library-delete-many.mjs';

const ids = n => Array.from({ length: n }, (_, i) => 'd' + i);
// 가짜 서버: 받은 묶음을 모두 지우고, linked에 든 것은 드라이브를 두었다고 답한다.
const fakeServer = ({ linked = new Set(), fail = new Set(), stopAt = -1 } = {}) => {
  const sent = [];
  return { sent, send: async part => {
    sent.push(part);
    if (sent.length - 1 === stopAt) return { ok: true, stopped: true, results: part.map((id, i) => ({ id, ok: false, code: i ? 'SKIPPED' : 'DRIVE_AUTH' })) };
    return { ok: true, stopped: false, results: part.map(id => fail.has(id) ? { id, ok: false, code: 'FAILED' } : linked.has(id) ? { id, ok: true, drive_result: 'preserved', drive_preserved: true, reason: 'linked_original' } : { id, ok: true, drive_result: 'trashed', drive_preserved: false, reason: 'ordinary_library' }) };
  } };
};

test('2300 picked in a folder are all sent in chunks of at most 50 and all come back deleted', async () => {
  const all = ids(2302), server = fakeServer({ linked: new Set(all) }), progress = [];
  const r = await deleteInChunks(all, server.send, { onProgress: p => progress.push(p) });
  assert.equal(r.done.length, 2302);
  assert.deepEqual([r.failed, r.unknown, r.skipped], [[], [], []]);
  assert.equal(r.preserved, 2302);
  assert.ok(server.sent.every(p => p.length <= 50 && p.length <= DELETE_CHUNK));
  assert.deepEqual(server.sent.flat(), all); // 빠짐·겹침 없음, 화면 차례 그대로
  assert.equal(server.sent.length, Math.ceil(2302 / DELETE_CHUNK));
  assert.deepEqual(progress.at(-1), { index: 2302, total: 2302 });
  assert.equal(resultLine(r), '2302개를 삭제했어요.');
  assert.equal(preservedNote(r.preserved), '드라이브에서 가져온 2302개는 드라이브 원본을 그대로 뒀어요.');
});

test('a chunk with no answer is unknown (not restored), failures are reported, and other chunks still go', async () => {
  const all = ids(120);
  let n = 0;
  const r = await deleteInChunks(all, async part => { if (n++ === 1) throw new Error('timeout'); return { ok: true, results: part.map(id => ({ id, ok: id !== 'd3', code: id === 'd3' ? 'FAILED' : undefined })) }; });
  assert.equal(r.unknown.length, DELETE_CHUNK);
  assert.deepEqual(r.failed, ['d3']);
  assert.equal(r.done.length, 120 - DELETE_CHUNK - 1);
  assert.match(resultLine(r), /^79개를 삭제했고 1개는 삭제하지 못했어요\. 40개는 결과를 확인하지 못해/);
});

test('a Drive connection stop skips every later chunk without sending it', async () => {
  const all = ids(130), server = fakeServer({ stopAt: 1 });
  const r = await deleteInChunks(all, server.send);
  assert.equal(server.sent.length, 2);
  assert.equal(r.stopped, true);
  assert.equal(r.done.length, DELETE_CHUNK);
  assert.equal(r.failed.length + r.skipped.length, 130 - DELETE_CHUNK);
});

test('an answer that leaves out ids or names other ids counts those as unknown, never as deleted', async () => {
  const r = await deleteInChunks(['a', 'b'], async () => ({ ok: true, results: [{ id: 'a', ok: true }, { id: 'zzz', ok: true }] }));
  assert.deepEqual([r.done, r.unknown], [['a'], ['b']]);
});

test('leaving the login stops sending the rest', async () => {
  let live = true;
  const server = fakeServer();
  const r = await deleteInChunks(ids(100), async p => { const x = await server.send(p); live = false; return x; }, { isCurrent: () => live });
  assert.equal(server.sent.length, 1);
  assert.equal(r.skipped.length, 100 - DELETE_CHUNK);
});

test('linked originals are the Drive-import notes only, and the confirm line says the Drive original stays', () => {
  assert.equal(isLinkedOriginal({ file_id: 'f', classification_note: '드라이브에서 가져옴 · 파일명 기반 자동분류' }), true);
  assert.equal(isLinkedOriginal({ file_id: 'f', classification_note: '드라이브 정리 대기에서 등록 · 파일명 기반 자동분류' }), true);
  assert.equal(isLinkedOriginal({ file_id: 'f', classification_note: '파일명 기반 자동분류' }), false);
  assert.equal(isLinkedOriginal({ file_id: null, classification_note: '드라이브에서 가져옴' }), false);
  const linked = { file_id: 'f', classification_note: '드라이브에서 가져옴' }, own = { file_id: 'g', classification_note: '사용자 수정' };
  assert.match(confirmNote([linked, linked]), /^드라이브 원본은 그대로 둬요/);
  assert.equal(confirmNote([linked, own]), '드라이브에서 가져온 1개는 드라이브 원본을 그대로 둬요. 나머지 1개는 드라이브 휴지통으로 가요.');
  assert.match(confirmNote([own]), /휴지통/);
  assert.deepEqual(chunks(ids(5), 2).map(c => c.length), [2, 2, 1]);
});

test('server and screen use the same linked-original marks', () => {
  const src = readFileSync(new URL('../supabase/functions/document-actions/index.ts', import.meta.url), 'utf8');
  const m = src.match(/const LINKED_NOTES = \[([^\]]*)\]/);
  assert.ok(m);
  assert.deepEqual(m[1].split(',').map(x => x.trim().replace(/^'|'$/g, '')), [...LINKED_NOTES]);
  assert.match(src, /const DELETE_MANY_MAX = 50\b/);
  assert.ok(DELETE_CHUNK <= 50);
});
