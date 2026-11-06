import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FILES_LOOKS, lookLayout, lookOf, lookValue, stepLook, lookCols, thumbWanted} from '../app/files-look-model.mjs';
// S51-20 FILES-폰보기끌기 ①: 두 손가락 보기 단계·칸 수·서버 칸 모양.
test('벌리면 목록 → 격자 → 큰 격자, 오므리면 반대, 끝에서는 그대로', () => {
  assert.deepEqual(FILES_LOOKS, ['list', 'grid', 'big']);
  assert.equal(stepLook('list', 'out'), 'grid');
  assert.equal(stepLook('grid', 'out'), 'big');
  assert.equal(stepLook('big', 'out'), 'big');
  assert.equal(stepLook('big', 'in'), 'grid');
  assert.equal(stepLook('grid', 'in'), 'list');
  assert.equal(stepLook('list', 'in'), 'list');
  assert.equal(stepLook('이상한 값', 'out'), 'grid');
  assert.equal(stepLook('grid', null), 'grid');
});
test('칸 수: 폰·두 칸의 칸은 3·2, 폴드·PC 한 칸은 하나 더(4·3), 목록은 0', () => {
  assert.equal(lookCols('grid', false), 3); assert.equal(lookCols('big', false), 2);
  assert.equal(lookCols('grid', true), 4); assert.equal(lookCols('big', true), 3);
  assert.equal(lookCols('list', true), 0); assert.equal(lookCols('list', false), 0);
});
test('폭 종류와 서버 값(기기 칸 안 폭 칸, 없으면 목록)', () => {
  assert.equal(lookLayout({narrow: true, wide: false}), 'narrow');
  assert.equal(lookLayout({narrow: false, wide: false}), 'fold');
  assert.equal(lookLayout({narrow: false, wide: true}), 'wide');
  assert.equal(lookOf(undefined, 'narrow'), 'list');
  assert.equal(lookOf({narrow: 'big'}, 'narrow'), 'big');
  assert.equal(lookOf({narrow: 'big'}, 'fold'), 'list');
  assert.equal(lookOf({fold: 'g3'}, 'fold'), 'list');
  assert.equal(lookOf(['grid'], 'narrow'), 'list');
  assert.deepEqual(lookValue({narrow: 'big', wide: 'nope'}, 'fold', 'grid'), {narrow: 'big', fold: 'grid'});
  assert.deepEqual(lookValue(undefined, 'narrow', 'list'), {narrow: 'list'});
  assert.deepEqual(lookValue({fold: 'grid'}, 'tablet', 'big'), {fold: 'grid'});
});
test('작은 그림은 사진 파일만', () => {
  assert.equal(thumbWanted('image', false), true);
  assert.equal(thumbWanted('image', true), false);
  assert.equal(thumbWanted('pdf', false), false);
  assert.equal(thumbWanted('folder', true), false);
});
