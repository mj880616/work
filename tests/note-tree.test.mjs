// NOTE-탐색기: 노트 폴더 나무의 순수 부분(app/note-tree.mjs). 화면·네트워크 없음. 예시는 가짜 이름만.
import test from 'node:test';
import assert from 'node:assert/strict';
import {noteFolderId, foldersFromNames, noteFolderIdLegacy, noteLineTitle, noteLineDate, treeRows, folderContents, folderPath, canMoveFolder, noteFolderErrorText, OUTSIDE} from '../app/note-tree.mjs';
import {FOLDER_DEPTH_LIMIT} from '../app/folder-limits.mjs';

const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const F = [{id:U(1), parent_id:null, name:'가', sort_order:1024}, {id:U(2), parent_id:U(1), name:'가-1', sort_order:1024}, {id:U(3), parent_id:null, name:'나', sort_order:2048}];
const N = [
  {id:'a', title:'제목 A', metadata:{folder_id:U(2), folder:'가-1'}, updated_at:'2026-10-28T01:00:00Z'},
  {id:'b', title:'', raw_text:'## 첫 줄 **굵게**\n둘째', metadata:{folder:'나'}, updated_at:'2026-10-27T01:00:00Z'},
  {id:'c', title:'밖', metadata:{}, updated_at:'2026-10-26T01:00:00Z'},
  {id:'d', title:'지운 폴더', metadata:{folder_id:U(9), folder:'나'}, updated_at:'2026-10-25T01:00:00Z'},
];
const of = n => noteFolderId(n, F);

test('노트 → 폴더: folder_id 먼저, 없으면 같은 이름의 맨 위 폴더, 없는 id는 폴더 밖', () => {
  assert.deepEqual(N.map(of), [U(2), U(3), null, null]);
  assert.equal(noteFolderId({metadata:{folder:'가-1'}}, F), null, '이름은 맨 위 폴더만 본다');
});

test('표가 없을 때: 이름 폴더 읽기 전용', () => {
  const legacy = foldersFromNames(N);
  assert.deepEqual(legacy.map(f => f.name), ['가-1', '나']);
  assert.equal(noteFolderIdLegacy(N[1], legacy), 'name:나');
});

test('한 줄 제목·날짜: 직접 쓴 제목 → AI 제목 → 첫 줄(기호 없이), 올해는 MM.DD', () => {
  assert.equal(noteLineTitle(N[0]), '제목 A');
  assert.equal(noteLineTitle(N[1]), '첫 줄 굵게');
  assert.equal(noteLineTitle({title:'', raw_text:'x', metadata:{ai_title:'요약 제목'}}), '요약 제목');
  assert.equal(noteLineTitle({title:'', raw_text:'', attachments:[{name:'f.pdf'}]}), 'f.pdf');
  const now = new Date('2026-10-28T03:00:00Z');
  assert.equal(noteLineDate('2026-10-27T20:00:00Z', now), '10.28', '서울 날짜');
  assert.equal(noteLineDate('2025-01-02T00:00:00Z', now), '25.01.02');
  assert.equal(noteLineDate('x', now), '');
});

test('폰 한 화면 나무: 닫힌 폴더 안은 만들지 않고, 열면 들여쓰기, 폴더 밖은 맨 아래', () => {
  const closed = treeRows({folders:F, notes:N, folderOf:of});
  assert.deepEqual(closed.map(r => `${r.type}:${r.name || r.id}:${r.count ?? ''}`), ['folder:가:1', 'folder:나:1', 'outside:폴더 밖:2']);
  const open = treeRows({folders:F, notes:N, folderOf:of, isOpen:id => id === U(1) || id === U(2) || id === OUTSIDE});
  assert.deepEqual(open.map(r => `${r.type}:${r.id}:${r.depth}`), [`folder:${U(1)}:0`, `folder:${U(2)}:1`, 'note:a:2', `folder:${U(3)}:0`, 'outside:out:0', 'note:c:1', 'note:d:1']);
  const entered = treeRows({folders:F, notes:N, folderOf:of, root:U(1)});
  assert.deepEqual(entered.map(r => r.id), [U(2)], '들어간 폴더: 그 안만');
  const found = treeRows({folders:F, notes:N, folderOf:of, matches:n => n.id === 'a'});
  assert.deepEqual(found.map(r => r.id), [U(1), U(2), 'a'], '찾는 중이면 맞는 노트가 든 폴더만 열림');
});

test('PC 오른쪽: 지금 폴더의 아래 폴더 + 그 폴더 노트, 찾는 중이면 경로와 함께', () => {
  assert.deepEqual(folderContents({folders:F, notes:N, folderOf:of, at:U(1)}).map(r => r.id), [U(2)]);
  assert.deepEqual(folderContents({folders:F, notes:N, folderOf:of, at:null}).map(r => r.id), [U(1), U(3), 'c', 'd']);
  assert.deepEqual(folderContents({folders:F, notes:N, folderOf:of, matches:n => n.id === 'a'}).map(r => r.path), ['가 › 가-1']);
});

test('위치 줄·옮기기 규칙: 자기 안으로 못 옮김, 100단 한도', () => {
  assert.deepEqual(folderPath(F, U(2)).map(f => f.name), ['가', '가-1']);
  assert.equal(canMoveFolder(F, U(1), U(2), FOLDER_DEPTH_LIMIT), false);
  assert.equal(canMoveFolder(F, U(3), U(2), FOLDER_DEPTH_LIMIT), true);
  const chain = []; for (let i = 1; i <= 100; i++) chain.push({id:U(100 + i), parent_id:i > 1 ? U(99 + i) : null, name:'d' + i});
  chain.push({id:U(500), parent_id:null, name:'x'});
  assert.equal(canMoveFolder(chain, U(500), U(199), FOLDER_DEPTH_LIMIT), true, '100단째로');
  assert.equal(canMoveFolder(chain, U(500), U(200), FOLDER_DEPTH_LIMIT), false, '101단은 안 됨');
  assert.match(noteFolderErrorText({message:'NOTE_FOLDER_DEPTH: folders are limited to 100 levels'}), /100단/);
  assert.match(noteFolderErrorText({message:'NOTE_FOLDER_CYCLE: x'}), /자기 안/);
});
