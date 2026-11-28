// S70-83 READ-저장한글폴더: 폴더 순수 규칙(app/reading-folders-model.mjs) 시험.
// 2026-11-28 사용자 결정: 폴더 안 폴더(여러 단계) · 맨 위 '전체' 줄(기본 선택, 모든 글).
import test from 'node:test';
import assert from 'node:assert/strict';
import {OUTSIDE, OUTSIDE_NAME, ALL, ALL_NAME, keepFolder, folderOfRow, inFolder, folderTreeRows, sortFolders, nextSort, folderName, nameTaken, isFolderId,
  parentOf, childrenOf, folderChain, descendantIds, moveBlocked, canMakeIn, FOLDER_DEPTH_LIMIT} from '../app/reading-folders-model.mjs';

const A = 'f7083000-0000-4000-8000-0000000000a1', B = 'f7083000-0000-4000-8000-0000000000b1', GONE = 'f7083000-0000-4000-8000-0000000000c1';
const A1 = 'f7083000-0000-4000-8000-0000000000a2', A2 = 'f7083000-0000-4000-8000-0000000000a3';
const folders = [{id: B, name: '둘', parent_id: null, sort_order: 2048, created_at: '2026-11-26T02:00:00Z'}, {id: A, name: '하나', parent_id: null, sort_order: 1024, created_at: '2026-11-26T01:00:00Z'}];
const nested = [...folders, {id: A1, name: '하나-안', parent_id: A, sort_order: 1024}, {id: A2, name: '하나-안-안', parent_id: A1, sort_order: 1024}];
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

test('folderOfRow·inFolder: 없는 폴더를 가리키는 글은 폴더 없음, 전체는 모두, 폴더는 바로 든 글만', () => {
  assert.deepEqual(rows.map(r => folderOfRow(r, folders)), [A, OUTSIDE, OUTSIDE, A]);
  assert.deepEqual(rows.filter(r => inFolder(r, A, folders)).map(r => r.id), ['1', '4']);
  assert.deepEqual(rows.filter(r => inFolder(r, OUTSIDE, folders)).map(r => r.id), ['2', '3']);
  assert.equal(rows.filter(r => inFolder(r, '', folders)).length, 4);
  const deep = [{id: '5', folder_id: A2}];
  assert.deepEqual(deep.filter(r => inFolder(r, A, nested)).map(r => r.id), [], '위 폴더를 골라도 아래 폴더 글은 안 보임');
  assert.deepEqual(deep.filter(r => inFolder(r, A2, nested)).map(r => r.id), ['5']);
});

test('folderTreeRows: 맨 위 전체(글 모두) + 폴더 나무(펼친 것만) + 맨 아래 폴더 없음', () => {
  const flat = folderTreeRows({folders, rows});
  assert.deepEqual(flat.map(r => [r.key, r.name, r.count, r.depth]), [[ALL, ALL_NAME, '4', 0], [A, '하나', '2', 0], [B, '둘', '0', 0], [OUTSIDE, OUTSIDE_NAME, '2', 0]]);
  assert.deepEqual(folderTreeRows({folders: [], rows}).map(r => [r.key, r.count]), [[ALL, '4'], [OUTSIDE, '4']]);
  // 접힘: 하위 폴더 줄 없음, 개수는 '폴더 N · 글 M'.
  const shut = folderTreeRows({folders: nested, rows});
  assert.deepEqual(shut.map(r => r.key), [ALL, A, B, OUTSIDE]);
  assert.equal(shut[1].count, '폴더 1 · 글 2');
  assert.equal(shut[1].countLabel, '폴더 1개 · 글 2개');
  assert.equal(shut[1].hasKids, true);
  assert.equal(shut[1].open, false);
  // 펼침: 들여쓰기 한 단씩.
  const opened = folderTreeRows({folders: nested, rows, open: new Set([A, A1])});
  assert.deepEqual(opened.map(r => [r.key, r.depth]), [[ALL, 0], [A, 0], [A1, 1], [A2, 2], [B, 0], [OUTSIDE, 0]]);
  // 고른 폴더의 위 폴더는 저절로 펼친다(새로고침·주소로 들어와도 그 줄이 보임 — T2).
  assert.deepEqual(folderTreeRows({folders: nested, rows, selected: A2}).map(r => r.key), [ALL, A, A1, A2, B, OUTSIDE]);
});

test('나무 규칙: 상위·하위·경로, 자기 자신·자기 아래로 옮기기 거절, 100단', () => {
  assert.equal(parentOf(nested, A2), A1);
  assert.equal(parentOf([{id: A1, parent_id: GONE}], A1), null, '목록에 없는 상위는 맨 위로');
  assert.deepEqual(childrenOf(nested, null).map(f => f.id), [A, B]);
  assert.deepEqual(childrenOf(nested, A).map(f => f.id), [A1]);
  assert.deepEqual(folderChain(nested, A2).map(f => f.id), [A, A1, A2]);
  assert.deepEqual([...descendantIds(nested, A)].sort(), [A, A1, A2].sort());
  assert.equal(moveBlocked(nested, A, A), '자기 자신 안으로는 옮길 수 없어요');
  assert.equal(moveBlocked(nested, A, A2), '자기 아래 폴더로는 옮길 수 없어요');
  assert.equal(moveBlocked(nested, A1, B), '');
  assert.equal(moveBlocked(nested, A2, null), '');
  const deep = []; for (let i = 0; i < FOLDER_DEPTH_LIMIT; i++) deep.push({id: `f7083000-0000-4000-8000-${String(i).padStart(12, '0')}`, name: `단${i}`, parent_id: i ? deep[i - 1].id : null});
  assert.equal(canMakeIn(deep, deep[FOLDER_DEPTH_LIMIT - 2].id), true);
  assert.equal(canMakeIn(deep, deep[FOLDER_DEPTH_LIMIT - 1].id), false);
  assert.match(moveBlocked([...deep, {id: B, name: 'x', parent_id: null}, {id: A, name: 'y', parent_id: B}], B, deep[FOLDER_DEPTH_LIMIT - 2].id), /100단/);
  assert.deepEqual(sortFolders(folders).map(f => f.id), [A, B]);
  assert.equal(nextSort(folders), 3072);
  assert.equal(nextSort([]), 1024);
});

test('folderName·nameTaken: DB 검사와 같은 이름 규칙, 같은 자리 같은 이름 막기', () => {
  assert.deepEqual(folderName('  교섭   자료 '), {ok: true, name: '교섭 자료'});
  assert.equal(folderName('').ok, false);
  assert.equal(folderName('   ').ok, false);
  assert.equal(folderName('가'.repeat(41)).ok, false);
  assert.equal(folderName('가'.repeat(40)).ok, true);
  assert.equal(folderName('a\u0007b').ok, false);
  assert.equal(nameTaken(folders, ' 하나 '), true);
  assert.equal(nameTaken(folders, '하나', A), false);
  assert.equal(nameTaken(folders, '셋'), false);
  assert.equal(nameTaken(nested, '하나', '', A), false, '다른 자리(하위)는 같은 이름 가능');
  assert.equal(nameTaken(nested, '하나-안', '', A), true);
});
