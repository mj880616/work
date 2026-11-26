import test from 'node:test';
import assert from 'node:assert/strict';
import {folderFileText, folderFileLabel} from '../app/folder-count.mjs';
import {folderCountText} from '../app/files-model.mjs';
import {ftFocusCount} from '../app/folder-tree-ui.mjs';
import {buildTree, folderCountOf, treeHtml} from '../app/library-tree.js';
import {pickerRows} from '../app/library-move.mjs';

// LIB-폴더개수(사용자 11/24 18:04): 폴더 줄 개수 글자는 한 곳(folder-count.mjs) — 파일 화면·'그 폴더만' 머리·자료실이 같은 말.
test('folderFileText: 하위 폴더가 있으면 폴더 N · 파일 M, 파일 0이면 폴더 N, 하위 없으면 alone', () => {
  assert.equal(folderFileText(13, 0), '폴더 13');
  assert.equal(folderFileText(3, 1), '폴더 3 · 파일 1');
  assert.equal(folderFileText(0, 5), '5');
  assert.equal(folderFileText(0, 0), '0');
  assert.equal(folderFileText(1200, 3), '폴더 1,200 · 파일 3');
  assert.equal(folderFileText(0, 4, {alone: n => `${n}개`}), '4개');
  assert.equal(folderFileLabel(13, 0), '폴더 13개');
  assert.equal(folderFileLabel(3, 1, {fileWord: '자료', unit: '건'}), '폴더 3개 · 자료 1건');
  assert.equal(folderFileLabel(0, 2, {fileWord: '자료', unit: '건'}), '자료 2건');
});

test('파일 화면·그 폴더만 머리도 같은 글자(전과 같은 결과)', () => {
  assert.equal(folderCountText({folders: 3, files: 4}), '폴더 3 · 파일 4');
  assert.equal(folderCountText({folders: 2, files: 0}), '폴더 2');
  assert.equal(folderCountText({folders: 0, files: 7}), '7개');
  assert.equal(ftFocusCount(1, 3), '폴더 1 · 파일 3');
  assert.equal(ftFocusCount(0, 3, '노트'), '노트 3');
  assert.equal(ftFocusCount(0, 0), '');
  assert.equal(ftFocusCount(2, 0, '사진'), '폴더 2');
});

const F = (id, parent_id = null, name = id) => ({id, parent_id, name, sort_order: 1, project_id: null});
const folders = [F('g03', null, '03'), F('meet', 'g03', '회의'), F('org', 'g03', '조직'), ...Array.from({length: 13}, (_, i) => F('o' + i, 'org', '조직 ' + i))];
const docs = [{id: 'd1'}, {id: 'd2'}, {id: 'd3'}];
const items = [{document_id: 'd1', folder_id: 'g03'}, {document_id: 'd2', folder_id: 'o1'}];

test('자료실 폴더 줄: 하위 폴더 수 + 바로 안 자료 수, 폴더가 아닌 묶음은 안의 자료 모두', () => {
  const tree = buildTree({groupBy: 'folder', docs, folders, items, sortKey: () => ''});
  const g03 = tree.find(n => n.key === 'f:g03'), org = g03.children.find(n => n.key === 'f:org'), meet = g03.children.find(n => n.key === 'f:meet');
  assert.deepEqual(folderCountOf(g03), {text: '폴더 2 · 파일 1', label: '폴더 2개 · 자료 1건'});
  assert.deepEqual(folderCountOf(org), {text: '폴더 13', label: '폴더 13개'});
  assert.deepEqual(folderCountOf(meet), {text: '0', label: '자료 0건'});
  const out = tree.find(n => n.key === 'x:out');
  assert.deepEqual(folderCountOf(out), {text: '1', label: '자료 1건'});
  const html = treeHtml(tree, {isOpen: () => true, showAll: () => true, fileHtml: d => `<i>${d.id}</i>`, esc: v => String(v), emoji: true});
  assert.match(html, /<span class="lu-node-count" aria-label="폴더 13개">폴더 13<\/span>/);
  assert.match(html, /<span class="lu-node-count" aria-label="폴더 2개 · 자료 1건">폴더 2 · 파일 1<\/span>/);
});

// LIB-폴더창들어가기: 고르기 창 줄은 위 폴더(parent)를 갖는다 — 창이 '그 안으로 들어가기'를 이 값으로 그린다.
test('pickerRows: 줄마다 parent(맨 위 null)', () => {
  const {all} = pickerRows({folders, free: true});
  assert.equal(all.find(r => r.id === 'g03').parent, null);
  assert.equal(all.find(r => r.id === 'org').parent, 'g03');
  assert.equal(all.find(r => r.id === 'o3').parent, 'org');
  const found = pickerRows({folders, free: true, query: '조직 1'}).all;
  assert.ok(found.length >= 1 && found.every(r => 'parent' in r));
});
