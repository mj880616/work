// S70-84 BRIEF-두칸폴더: 브리핑 룸 목록 모델(폴더 = 자료실 '브리핑 요청함' 아래 폴더, [파일] 줄 정렬). 자료 이름은 모두 예시.
import test from 'node:test';
import assert from 'node:assert/strict';
import {naturalCompare} from '../app/head-sort.mjs';
import {briefSubtree, folderOfDoc, treeRows, toggleOpen, sortBriefRows, canMoveFolder, cleanSort, cleanFolderName, kindText, NONE} from '../app/brief-folders-model.mjs';

const doc = (id, title, file, at, size = 100) => ({doc: {id, title, file_name: file, created_at: at, file_size: size}});
const rows = [doc('d1', '예시 연구 보고서', '예시.hwp', '2026-10-05T00:00:00Z', 900), doc('d2', '가 예시 계획', '가.pdf', '2026-10-06T00:00:00Z', 50), doc('d3', '예시 10번 공문', '공문.pdf', '2026-10-01T00:00:00Z'), doc('d4', '예시 2번 공문', '공문2.pdf', '2026-10-02T00:00:00Z')];
const folders = [{id: 'root', parent_id: null, name: '브리핑 요청함'}, {id: 'fa', parent_id: 'root', name: '나 회의'}, {id: 'fb', parent_id: 'root', name: '가 공문'}, {id: 'fc', parent_id: 'fa', name: '하위'},
  {id: 'other', parent_id: null, name: '다른 폴더'}, {id: 'gone', parent_id: 'root', name: '지운 폴더', deleted_at: '2026-11-01T00:00:00Z'}];

test('브리핑 폴더 = 브리핑 요청함 아래 폴더만(지운 것·다른 폴더 빼고), 맨 위 단계는 부모 없음', () => {
  const sub = briefSubtree(folders, 'root');
  assert.deepEqual(sub.map(f => [f.id, f.parent_id]), [['fa', null], ['fc', 'fa'], ['fb', null]]);
  assert.deepEqual(briefSubtree(folders, null), []);
});
test('폴더가 없으면 자료 줄만, 이름 자연 정렬(2번 < 10번)이 기본', () => {
  const t = treeRows({sub: [], rows});
  assert.deepEqual(t.map(r => r.type), ['file', 'file', 'file', 'file']);
  assert.deepEqual(t.map(r => r.row.doc.id), ['d2', 'd4', 'd3', 'd1']);
});
test('정렬: 넣은 날·크기·종류·내림', () => {
  assert.deepEqual(sortBriefRows(rows, {key: 'modified', dir: 'desc'}).map(r => r.doc.id), ['d2', 'd1', 'd4', 'd3']);
  assert.deepEqual(sortBriefRows(rows, {key: 'size', dir: 'asc'}).map(r => r.doc.id), ['d2', 'd4', 'd3', 'd1']);
  assert.deepEqual(sortBriefRows(rows, {key: 'name', dir: 'desc'}).map(r => r.doc.id), ['d1', 'd3', 'd4', 'd2']);
  assert.equal(kindText(rows[0].doc), '한글');
  const kinds = sortBriefRows(rows, {key: 'kind', dir: 'asc'}).map(r => kindText(r.doc));
  assert.deepEqual(kinds, [...kinds].sort((a, b) => naturalCompare(a, b)));
  assert.equal(new Set(kinds.slice(0, 3)).size === 1 || new Set(kinds.slice(1)).size === 1, true, '같은 종류끼리 모인다');
  assert.deepEqual(cleanSort({key: 'path', dir: 'asc'}), {key: 'name', dir: 'asc'});
});
test('폴더 나무: 폴더 위·이름순, 펼친 폴더 안 하위 폴더 → 자료, 빈 폴더 줄, 맨 아래 폴더 없음(처음 펼침)', () => {
  const sub = briefSubtree(folders, 'root');
  const itemFolder = new Map([['d1', 'fa'], ['d3', 'fc'], ['d4', 'root'], ['d2', 'other']]);
  let t = treeRows({sub, rows, itemFolder});
  assert.deepEqual(t.map(r => [r.type, r.id || r.row?.doc.id, r.depth]), [['folder', 'fb', 0], ['folder', 'fa', 0], ['none', NONE, 0], ['file', 'd2', 1], ['file', 'd4', 1]]);
  assert.equal(t.find(r => r.id === 'fa').count, 2);
  assert.equal(t.find(r => r.id === 'fb').hasContent, false);
  const open = toggleOpen(toggleOpen(new Set(), 'fa'), 'fb');
  t = treeRows({sub, rows, itemFolder, open});
  assert.deepEqual(t.map(r => [r.type, r.id || r.row?.doc.id, r.depth]), [['folder', 'fb', 0], ['empty', 'fb', 1], ['folder', 'fa', 0], ['folder', 'fc', 1], ['file', 'd1', 1], ['none', NONE, 0], ['file', 'd2', 1], ['file', 'd4', 1]]);
  t = treeRows({sub, rows, itemFolder, open: toggleOpen(new Set(), NONE)});
  assert.deepEqual(t.filter(r => r.type === 'file'), []);
  assert.equal(folderOfDoc('d4', itemFolder, new Set(sub.map(f => f.id))), null);
});
test('폴더 옮기기: 자기 자신·자기 아래로는 안 됨, 이름 규칙', () => {
  const sub = briefSubtree(folders, 'root');
  assert.equal(canMoveFolder(sub, 'fa', 'fc'), false);
  assert.equal(canMoveFolder(sub, 'fa', 'fa'), false);
  assert.equal(canMoveFolder(sub, 'fa', 'fb'), true);
  assert.equal(canMoveFolder(sub, 'fc', null), true);
  assert.equal(cleanFolderName('  가  나 '), '가 나');
  assert.equal(cleanFolderName(''), '');
  assert.equal(cleanFolderName('가'.repeat(41)), '');
});
