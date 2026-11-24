import test from 'node:test';
import assert from 'node:assert/strict';
import { previewLine, previewNote, applyBatches, resultLine, undoLine } from '../app/library-same-content-model.mjs';

test('previewLine·previewNote: 묶음 수·휴지통 갈 개수·건너뜀', () => {
  assert.equal(previewLine({ totals: { groups: 0 } }), '같은 내용 자료 없음');
  assert.equal(previewLine({ totals: { groups: 3, trash: 4, skipped: 1 } }), '같은 내용 묶음 3개 · 휴지통으로 4개 · 건너뜀 1묶음(기록 연결을 옮길 수 없음)');
  assert.equal(previewNote({ more: false, partial: true }), '자료가 많아 일부만 견줬어요(정리한 뒤 다시 열면 나머지)');
});

test('applyBatches: 건너뜀 묶음은 빼고, 한 번에 300개까지로 나눈다', () => {
  const g = (k, d, skip = null) => ({ keep: { id: k }, drop: d.map(id => ({ id })), skip });
  assert.deepEqual(applyBatches([g('a', ['b']), g('c', ['d'], 'linked')]), [[{ keep: 'a', drop: ['b'] }]]);
  const many = Array.from({ length: 200 }, (_, i) => g('k' + i, ['d' + i]));
  const parts = applyBatches(many);
  assert.deepEqual(parts.map(p => p.length), [150, 50]);
});

test('resultLine·undoLine', () => {
  assert.equal(resultLine({ trashed: 4, skipped: 1 }), '휴지통 4 · 건너뜀 1');
  assert.equal(undoLine({ restored: 4, missed: 0 }), '되돌렸어요 · 4개를 원래 폴더로');
});
