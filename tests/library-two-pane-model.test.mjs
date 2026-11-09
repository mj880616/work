import test from 'node:test';
import assert from 'node:assert/strict';
import {paneContent, paneSorted, paneTrail, sendText} from '../app/library-two-pane.js';
// S55-11 LIB-두칸보기: 칸 하나의 내용(폴더 줄 + 자료 줄)·정렬·위치 줄·옮기기 막대 글자. 이름은 지어낸 것.
const doc = (id, title) => ({id, title});
const tree = [
  {kind: 'group', key: 'x:out', label: '폴더 밖', files: [doc('o1', '나'), doc('o2', '가')], children: []},
  {kind: 'folder', key: 'f:a', id: 'a', label: '하늘', files: [doc('a1', '자료')], children: [{kind: 'folder', key: 'f:c', id: 'c', label: '바다', files: [], children: []}]},
  {kind: 'folder', key: 'f:b', id: 'b', label: '가람', files: [], children: []},
];
test('맨 위 칸 = 맨 위 폴더 + 폴더 밖 자료(LIB-나무폴더밖 흡수) · 폴더 칸 = 안 폴더 + 그 폴더 자료 · 없는 폴더는 찾지 못함', () => {
  const top = paneContent(tree, null);
  assert.deepEqual(top.folders.map(n => n.id), ['a', 'b']);
  assert.deepEqual(top.files.map(d => d.id), ['o1', 'o2']);
  const a = paneContent(tree, 'a');
  assert.deepEqual(a.folders.map(n => n.id), ['c']); assert.deepEqual(a.files.map(d => d.id), ['a1']);
  assert.equal(paneContent(tree, 'c').found, true);
  assert.deepEqual(paneContent(tree, 'zz'), {found: false, folders: [], files: [], node: null});
  assert.deepEqual(paneContent(null, null).folders, []);
});
test('정렬: 날짜순은 나무 순서 그대로, 이름순은 폴더·자료 따로 가나다', () => {
  const top = paneContent(tree, null);
  assert.deepEqual(paneSorted(top, 'date').folders.map(n => n.id), ['a', 'b']);
  const byName = paneSorted(top, 'name');
  assert.deepEqual(byName.folders.map(n => n.id), ['b', 'a']);
  assert.deepEqual(byName.files.map(d => d.id), ['o2', 'o1']);
});
test('위치 줄: 자료실 › 위 폴더 › 지금 폴더, 없는 폴더는 자료실만, 고리는 끊음', () => {
  const folders = [{id: 'a', name: '하늘', parent_id: null}, {id: 'c', name: '바다', parent_id: 'a'}];
  assert.deepEqual(paneTrail(folders, 'c').map(t => t.name), ['자료실', '하늘', '바다']);
  assert.deepEqual(paneTrail(folders, null), [{id: '', name: '자료실'}]);
  assert.deepEqual(paneTrail(folders, 'zz').map(t => t.name), ['자료실']);
  const loop = [{id: 'x', name: 'X', parent_id: 'y'}, {id: 'y', name: 'Y', parent_id: 'x'}];
  assert.ok(paneTrail(loop, 'x').length <= 121);
});
test('옮기기 막대: 왼쪽 칸이면 → 오른쪽, 오른쪽 칸이면 ← 왼쪽', () => {
  assert.equal(sendText(0), '→ 오른쪽 폴더로 옮기기');
  assert.equal(sendText(1), '← 왼쪽 폴더로 옮기기');
});
