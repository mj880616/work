import test from 'node:test';
import assert from 'node:assert/strict';
import {PICK_FOLDER, isFolderPick, folderPick, splitPicks, topPicked, pickCountLabel, folderMoveOk} from '../app/library-pick-folders.mjs';
// S69-69 LIB-사각형폴더: 자료실 사각형 고르기가 폴더 줄을 폴더째 고를 때 쓰는 순수 함수. 이름은 지어낸 것.

const F = (id, parent_id = null, project_id = null) => ({id, parent_id, project_id, name: '가상 ' + id});
// a ─ a1 ─ a11 / b / c
const FOLDERS = [F('a'), F('a1', 'a'), F('a11', 'a1'), F('b'), F('c')];

test('폴더 열쇠는 자료 id와 섞이지 않는다', () => {
  assert.equal(folderPick('a'), PICK_FOLDER + 'a');
  assert.equal(isFolderPick(folderPick('a')), true);
  assert.equal(isFolderPick('d-1'), false);
  assert.deepEqual(splitPicks(new Set(['d-1', folderPick('a'), 'd-2', folderPick('b')])), {docs: ['d-1', 'd-2'], folders: ['a', 'b']});
  assert.deepEqual(splitPicks(null), {docs: [], folders: []});
});

test('위 폴더를 함께 고르면 아래 폴더는 뺀다, 없는 폴더도 뺀다', () => {
  assert.deepEqual(topPicked(FOLDERS, ['a11', 'a', 'b', 'gone']), ['a', 'b']);
  assert.deepEqual(topPicked(FOLDERS, ['a1', 'a11']), ['a1']);
});

test('위 막대 개수: 폴더가 없으면 지금 말투, 있으면 폴더 줄 개수 말투', () => {
  assert.equal(pickCountLabel(0, 3), '3개 선택됨');
  assert.equal(pickCountLabel(0, 3, 1), '3개 선택됨 — 접힌 1개 포함');
  assert.equal(pickCountLabel(8, 0), '폴더 8 선택됨');
  assert.equal(pickCountLabel(2, 3), '폴더 2 · 파일 3 선택됨');
  assert.equal(pickCountLabel(2, 3, 1), '폴더 2 · 파일 3 선택됨 — 접힌 1개 포함');
});

test('옮길 곳: 고른 폴더·그 아래는 안 되고, 다른 폴더는 된다', () => {
  const m = folderMoveOk(FOLDERS, ['a1', 'b']);
  assert.equal(m.ok('a1'), false);
  assert.equal(m.ok('a11'), false);
  assert.equal(m.ok('b'), false);
  assert.equal(m.ok('a'), true);
  assert.equal(m.ok('c'), true);
  assert.equal(m.ok('none'), false);
  assert.equal(m.top, true); // a1은 위 폴더가 있다
  assert.equal(folderMoveOk(FOLDERS, ['b', 'c']).top, false); // 모두 맨 위
});

test('옮길 곳: 폴더 단 제한을 넘는 곳은 안 된다', () => {
  // a(1) ─ a1(2) ─ a11(3). 높이 3인 a를 깊이 2(a 아래가 아닌 x1)에 넣으면 5 > 4.
  const list = [...FOLDERS, F('x'), F('x1', 'x')];
  assert.equal(folderMoveOk(list, ['a'], {maxDepth: 4}).ok('x1'), false);
  assert.equal(folderMoveOk(list, ['a'], {maxDepth: 4}).ok('x'), true);
});

test('사업영역 묶기(free=false)는 같은 틀 안으로만', () => {
  const list = [F('p', null, 'P1'), F('q', null, 'P2'), F('p2', null, 'P1')];
  const m = folderMoveOk(list, ['p'], {free: false});
  assert.equal(m.ok('p2'), true);
  assert.equal(m.ok('q'), false);
  assert.equal(folderMoveOk(list, ['p', 'q'], {free: false}).ok('p2'), false); // 틀이 섞이면 아무 곳도
});
