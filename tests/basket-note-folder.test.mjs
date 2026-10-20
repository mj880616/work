import test from 'node:test';
import assert from 'node:assert/strict';

// UI-노트폴더 1단계: a note's folder is metadata.folder in its existing row (no database change). Folder and pin share
// metadata, so every metadata write keeps the other keys and is guarded on updated_at, pinned_at and folder.
import {validateFolderName, noteFolder, noteFolders, newFolderName, setNoteFolder, setNotePinned, moveToBasket, NOTE_FOLDER_LIMITS} from '../app/basket-data.js';

function runtime(fresh) {
  const calls = [];
  const rt = {context: {read: () => ({workspace: {id: 'w'}})}, api: async (path, options = {}) => {
    calls.push({path, options});
    if (!options.method) return [structuredClone(fresh)];
    return [{...fresh, ...structuredClone(options.body)}];
  }};
  return {rt, calls};
}

test('folder names: 1~20 letters on one line, trimmed, not the two reserved chip names', () => {
  assert.deepEqual(NOTE_FOLDER_LIMITS, {name: 20, count: 30});
  assert.equal(validateFolderName('  가 폴더 '), '가 폴더');
  assert.equal(validateFolderName('나'.repeat(20)), '나'.repeat(20));
  assert.throws(() => validateFolderName('나'.repeat(21)), /20자까지/);
  assert.throws(() => validateFolderName('   '), /입력해 주세요/);
  assert.throws(() => validateFolderName(null), /입력해 주세요/);
  assert.throws(() => validateFolderName('가\n나'), /한 줄/);
  assert.throws(() => validateFolderName('전체'), /쓸 수 없어요/);
  assert.throws(() => validateFolderName('폴더 없음'), /쓸 수 없어요/);
});

test('the folder list is the names the notes hold, once each, by name; odd stored values count as no folder', () => {
  const notes = [{metadata: {folder: '나 폴더'}}, {metadata: {folder: '가 폴더'}}, {metadata: {folder: '나 폴더'}}, {metadata: {}}, {metadata: null}, {metadata: {folder: ' 띄움'}}, {metadata: {folder: 3}}, {metadata: {folder: '다'.repeat(21)}}];
  assert.deepEqual(noteFolders(notes), ['가 폴더', '나 폴더']);
  assert.deepEqual(noteFolders(notes, ['라 폴더', '가 폴더']), ['가 폴더', '나 폴더', '라 폴더']);
  assert.equal(noteFolder(notes[5]), null);
  assert.equal(noteFolder(notes[6]), null);
  assert.equal(noteFolder(notes[0]), '나 폴더');
});

test('a new folder counts toward 30; an existing name is reused', () => {
  const thirty = Array.from({length: 30}, (_, i) => `폴더 ${i}`);
  assert.throws(() => newFolderName('새 폴더', thirty), /30개까지/);
  assert.deepEqual(newFolderName(' 폴더 3 ', thirty), {name: '폴더 3', isNew: false});
  assert.deepEqual(newFolderName('새 폴더', thirty.slice(1)), {name: '새 폴더', isNew: true});
});

test('moving writes metadata only, keeps pin and tasks, never touches updated_at, and is guarded on both keys', async () => {
  const {rt, calls} = runtime({id: 'n1', updated_at: '2026-10-10T00:00:00.123456Z', metadata: {pinned_at: '2026-10-11T00:00:00.000Z', tasks: [{task_id: 't'}]}});
  const saved = await setNoteFolder({id: 'n1'}, ' 가 폴더 ', rt);
  assert.deepEqual(saved.metadata, {pinned_at: '2026-10-11T00:00:00.000Z', tasks: [{task_id: 't'}], folder: '가 폴더'});
  const patch = calls[1];
  assert.equal(patch.options.method, 'PATCH');
  assert.deepEqual(Object.keys(patch.options.body), ['metadata']);
  assert.match(patch.path, /kind=eq\.note/);
  assert.match(patch.path, /updated_at=eq\.2026-10-10T00%3A00%3A00\.123456Z/);
  assert.match(patch.path, /metadata->>pinned_at=eq\.2026-10-11T00%3A00%3A00\.000Z/);
  assert.match(patch.path, /metadata->>folder=is\.null/);
});

test('"폴더 없음" removes the key; a note already where it should be is not written again', async () => {
  const one = runtime({id: 'n1', updated_at: 'u', metadata: {folder: '가 폴더', other: 1}});
  const saved = await setNoteFolder({id: 'n1'}, null, one.rt);
  assert.deepEqual(saved.metadata, {other: 1});
  assert.match(one.calls[1].path, /metadata->>folder=eq\.%EA%B0%80%20%ED%8F%B4%EB%8D%94/);
  const same = runtime({id: 'n1', updated_at: 'u', metadata: {folder: '가 폴더'}});
  const kept = await setNoteFolder({id: 'n1'}, '가 폴더', same.rt, {from: '옛 폴더'});
  assert.deepEqual(kept.metadata, {folder: '가 폴더'});
  assert.equal(same.calls.length, 1);
});

test('rename/delete note by note: a note moved elsewhere in between is reported, not moved', async () => {
  const {rt, calls} = runtime({id: 'n1', updated_at: 'u', metadata: {folder: '다른 폴더'}});
  await assert.rejects(setNoteFolder({id: 'n1'}, '새 이름', rt, {from: '옛 이름'}), e => e.code === 'folder_moved');
  assert.equal(calls.length, 1);
});

test('a row changed in between is reported, not overwritten', async () => {
  const rt = {context: {read: () => ({workspace: {id: 'w'}})}, api: async (path, options = {}) => options.method ? [] : [{id: 'n1', updated_at: 'x', metadata: {}}]};
  await assert.rejects(setNoteFolder({id: 'n1'}, '가 폴더', rt), e => e.code === 'note_changed');
});

test('pinning keeps the folder and its guard also checks the folder', async () => {
  const {rt, calls} = runtime({id: 'n1', updated_at: 'u', metadata: {folder: '가 폴더'}});
  const saved = await setNotePinned({id: 'n1'}, true, rt, new Date('2026-10-20T01:02:03Z'));
  assert.deepEqual(saved.metadata, {folder: '가 폴더', pinned_at: '2026-10-20T01:02:03.000Z'});
  assert.match(calls[1].path, /metadata->>pinned_at=is\.null/);
  assert.match(calls[1].path, /metadata->>folder=eq\./);
});

test('back to the basket: a note in a folder loses the folder in the same guarded write; other notes as before', async () => {
  const {rt, calls} = runtime({id: 'n1', updated_at: 'u', metadata: {folder: '가 폴더', pinned_at: 'p'}});
  await moveToBasket({id: 'n1', raw_text: '본문', attachments: [], metadata: {folder: '가 폴더'}}, rt);
  const patch = calls[1];
  assert.equal(patch.options.method, 'PATCH');
  assert.deepEqual({...patch.options.body, updated_at: 'x'}, {kind: 'basket', title: null, metadata: {pinned_at: 'p'}, updated_at: 'x'});
  assert.match(patch.path, /kind=eq\.note/);
  assert.match(patch.path, /updated_at=eq\.u/);
  assert.match(patch.path, /metadata->>folder=eq\./);
  const plain = runtime({id: 'n2'});
  await moveToBasket({id: 'n2', raw_text: '본문', attachments: [], metadata: {}}, plain.rt);
  assert.equal(plain.calls.length, 1);
  assert.deepEqual(Object.keys(plain.calls[0].options.body).sort(), ['kind', 'title', 'updated_at']);
});
