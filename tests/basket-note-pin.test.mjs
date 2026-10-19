import test from 'node:test';
import assert from 'node:assert/strict';

// UI-노트고정: pin state lives in the existing metadata jsonb (metadata.pinned_at); no new column.
import {sortNotes, notePinnedAt, setNotePinned} from '../app/basket-data.js';
const note = (id, updated_at, pinned_at) => ({id, updated_at, metadata: pinned_at === undefined ? {} : {pinned_at, tasks: [{task_id: 't'}]}});

test('pinned notes come first, most recently pinned on top, then by last change', () => {
  const rows = [note('a', '2026-10-10T00:00:00Z'), note('b', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'), note('c', '2026-10-12T00:00:00Z'), note('d', '2026-09-01T00:00:00Z', '2026-10-05T00:00:00Z')];
  assert.deepEqual(sortNotes(rows).map(n => n.id), ['d', 'b', 'c', 'a']);
  assert.equal(notePinnedAt({metadata: {pinned_at: 'nope'}}), null);
  assert.equal(notePinnedAt({metadata: []}), null);
});

test('pin writes metadata only, keeps other keys, never touches updated_at, and is guarded', async () => {
  const calls = [];
  const fresh = {id: 'n1', updated_at: '2026-10-10T00:00:00.123456Z', metadata: {tasks: [{task_id: 't'}]}};
  const rt = {context: {read: () => ({workspace: {id: 'w'}})}, api: async (path, options = {}) => {
    calls.push({path, options});
    if (!options.method) return [fresh];
    return [{...fresh, metadata: options.body.metadata}];
  }};
  const saved = await setNotePinned({id: 'n1'}, true, rt, new Date('2026-10-20T01:02:03Z'));
  assert.deepEqual(saved.metadata, {tasks: [{task_id: 't'}], pinned_at: '2026-10-20T01:02:03.000Z'});
  const patch = calls[1];
  assert.equal(patch.options.method, 'PATCH');
  assert.deepEqual(Object.keys(patch.options.body), ['metadata']);
  assert.match(patch.path, /kind=eq\.note/);
  assert.match(patch.path, /updated_at=eq\.2026-10-10T00%3A00%3A00\.123456Z/);
  assert.match(patch.path, /metadata->>pinned_at=is\.null/);

  fresh.metadata = {pinned_at: '2026-10-20T01:02:03.000Z', other: 1};
  calls.length = 0;
  const unpinned = await setNotePinned({id: 'n1'}, false, rt);
  assert.deepEqual(unpinned.metadata, {other: 1});
  assert.match(calls[1].path, /metadata->>pinned_at=eq\.2026-10-20T01%3A02%3A03\.000Z/);
});

test('a row changed in between is reported, not overwritten', async () => {
  const rt = {context: {read: () => ({workspace: {id: 'w'}})}, api: async (path, options = {}) => options.method ? [] : [{id: 'n1', updated_at: 'x', metadata: {}}]};
  await assert.rejects(setNotePinned({id: 'n1'}, true, rt), e => e.code === 'note_changed');
});
