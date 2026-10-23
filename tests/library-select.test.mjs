// LIB-여러개삭제: app/library-select.js(순수 함수). 화면·네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import {nodeDocumentIds,toggleAll,allSelected,someSelected,pruneSelected,deleteSequentially,confirmText,resultText} from '../app/library-select.js';

const tree={files:[{id:'a'}],children:[{files:[{id:'b'},{id:'a'}],children:[{files:[{id:'c'}],children:[]}]}]};

test('folder box selects every document inside, nested ones included, without duplicates', () => {
  assert.deepEqual(nodeDocumentIds(tree).sort(), ['a', 'b', 'c']);
  assert.deepEqual(nodeDocumentIds(null), []);
});
test('selecting: all chip selects everything visible, tapping again clears only those', () => {
  const ids = ['a', 'b', 'c'];
  const on = toggleAll(new Set(['x']), ids);
  assert.deepEqual([...on].sort(), ['a', 'b', 'c', 'x']);
  assert.equal(allSelected(on, ids), true);
  assert.deepEqual([...toggleAll(on, ids)], ['x']);
  assert.equal(allSelected(new Set(), []), false);
});
test('partial selection: folder box is indeterminate, tapping it selects the rest', () => {
  const ids = ['a', 'b', 'c'], s = new Set(['a']);
  assert.equal(someSelected(s, ids), true);
  assert.equal(allSelected(toggleAll(s, ids), ids), true);
});
test('documents no longer shown are dropped from the selection', () => {
  assert.deepEqual([...pruneSelected(new Set(['a', 'z']), ['a', 'b'])], ['a']);
});
test('delete runs one at a time, in order, and keeps only the failures', async () => {
  let running = 0, peak = 0;
  const order = [];
  const r = await deleteSequentially(['a', 'b', 'c', 'd'], async id => {
    running++; peak = Math.max(peak, running); order.push(id);
    await new Promise(r => setTimeout(r, 2)); running--;
    return {ok: id !== 'b' && id !== 'd'};
  });
  assert.equal(peak, 1);
  assert.deepEqual(order, ['a', 'b', 'c', 'd']);
  assert.deepEqual(r, {done: ['a', 'c'], failed: ['b', 'd'], skipped: []});
  assert.match(resultText(r), /^2개를 지웠고 2개는 지우지 못했어요/);
});
test('a login or Drive connection problem stops the rest instead of retrying each', async () => {
  const calls = [];
  const r = await deleteSequentially(['a', 'b', 'c'], async id => { calls.push(id); return id === 'a' ? {ok: true} : {ok: false, stop: true}; });
  assert.deepEqual(calls, ['a', 'b']);
  assert.deepEqual(r, {done: ['a'], failed: ['b'], skipped: ['c']});
});
test('leaving the screen stops further requests; a throwing delete counts as failure', async () => {
  let alive = true;
  const r = await deleteSequentially(['a', 'b', 'c'], async id => { if (id === 'a') { alive = false; throw new Error('x'); } return {ok: true}; }, {isCurrent: () => alive});
  assert.deepEqual(r, {done: [], failed: ['a'], skipped: ['b', 'c']});
});
test('messages', () => {
  assert.equal(confirmText(3), '3개를 지울까요?\nDrive 파일은 휴지통으로 이동해요(30일 뒤 사라짐).');
  assert.equal(resultText({done: ['a', 'b'], failed: [], skipped: []}), '2개를 지웠어요.');
});
