// S70-83 READ-저장한글폴더: 폴더 순수 규칙(app/reading-folders-model.mjs) 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import {OUTSIDE, OUTSIDE_NAME, keepFolder, folderOfRow, inFolder, folderRows, sortFolders, nextSort, folderName, nameTaken, isFolderId} from '../app/reading-folders-model.mjs';

const A = 'f7083000-0000-4000-8000-0000000000a1', B = 'f7083000-0000-4000-8000-0000000000b1', GONE = 'f7083000-0000-4000-8000-0000000000c1';
const folders = [{id: B, name: '둘', sort_order: 2048, created_at: '2026-11-26T02:00:00Z'}, {id: A, name: '하나', sort_order: 1024, created_at: '2026-11-26T01:00:00Z'}];
const rows = [{id: '1', folder_id: A}, {id: '2', folder_id: null}, {id: '3', folder_id: GONE}, {id: '4', folder_id: A}];

test('keepFolder: 전체·폴더 없음·있는 폴더만, 그 밖은 전체', () => {
  assert.equal(keepFolder('', folders), '');
  assert.equal(keepFolder(OUTSIDE, folders), OUTSIDE);
  assert.equal(keepFolder(A, folders), A);
  assert.equal(keepFolder(GONE, folders), '');
  assert.equal(keepFolder('x<script>', folders), '');
  assert.equal(isFolderId(A), true);
  assert.equal(isFolderId('out'), false);
});

test('folderOfRow·inFolder: 없는 폴더를 가리키는 글은 폴더 없음, 전체는 모두', () => {
  assert.deepEqual(rows.map(r => folderOfRow(r, folders)), [A, OUTSIDE, OUTSIDE, A]);
  assert.deepEqual(rows.filter(r => inFolder(r, A, folders)).map(r => r.id), ['1', '4']);
  assert.deepEqual(rows.filter(r => inFolder(r, OUTSIDE, folders)).map(r => r.id), ['2', '3']);
  assert.equal(rows.filter(r => inFolder(r, '', folders)).length, 4);
});

test('folderRows: 순서대로 폴더 + 맨 아래 폴더 없음, 개수', () => {
  assert.deepEqual(folderRows(folders, rows).map(r => [r.key, r.name, r.count]), [[A, '하나', 2], [B, '둘', 0], [OUTSIDE, OUTSIDE_NAME, 2]]);
  assert.deepEqual(folderRows([], rows).map(r => [r.key, r.count]), [[OUTSIDE, 4]]);
  assert.deepEqual(sortFolders(folders).map(f => f.id), [A, B]);
  assert.equal(nextSort(folders), 3072);
  assert.equal(nextSort([]), 1024);
});

test('folderName·nameTaken: DB 검사와 같은 이름 규칙, 같은 이름 막기', () => {
  assert.deepEqual(folderName('  교섭   자료 '), {ok: true, name: '교섭 자료'});
  assert.equal(folderName('').ok, false);
  assert.equal(folderName('   ').ok, false);
  assert.equal(folderName('가'.repeat(41)).ok, false);
  assert.equal(folderName('가'.repeat(40)).ok, true);
  assert.equal(folderName('a\u0007b').ok, false);
  assert.equal(nameTaken(folders, ' 하나 '), true);
  assert.equal(nameTaken(folders, '하나', A), false);
  assert.equal(nameTaken(folders, '셋'), false);
});
