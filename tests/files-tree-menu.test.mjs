import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {treeMenuItems} from '../app/files-tree-menu.mjs';
import {rowMenuHtml} from '../app/row-menu.js';

const ids = (row, opt) => treeMenuItems(row, opt).map(x => x.id);
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('S51-22 나무 ⋯ 메뉴: 클라우드 파일·폴더는 예전 고르기 줄 기능 그대로, 휴지통 맨 아래', () => {
  assert.deepEqual(ids({source: 'od', is_folder: false}), ['open', 'copy', 'move', 'rename', 'star', 'trash']);
  assert.deepEqual(ids({source: 'gd', is_folder: false, starred: true}), ['open', 'copy', 'move', 'rename', 'unstar', 'trash']);
  assert.deepEqual(ids({source: 'od', is_folder: true}, {sibIndex: 1, sibCount: 3}), ['only', 'mkdir', 'upload', 'copy', 'move', 'rename', 'color', 'up', 'down', 'star', 'trash']);
  assert.deepEqual(ids({source: 'od', is_folder: true}, {sibIndex: 0, sibCount: 1}), ['only', 'mkdir', 'upload', 'copy', 'move', 'rename', 'color', 'star', 'trash']);
  const items = treeMenuItems({source: 'od'});
  assert.equal(items.at(-1).id, 'trash');
  assert.equal(items.at(-1).last, true);
  assert.equal(items.filter(x => x.last).length, 1);
});

test('S51-22 나무 ⋯ 메뉴: 이 폰은 클라우드에 복사(+쓸 수 있으면 이름·휴지통, 폴더는 지우지 않음), 내 PC는 보기·열기만', () => {
  assert.deepEqual(ids({source: 'ph'}), ['open', 'tocloud']);
  assert.deepEqual(ids({source: 'ph'}, {phoneWrite: true}), ['open', 'tocloud', 'rename', 'trash']);
  assert.deepEqual(ids({source: 'ph', is_folder: true}, {phoneWrite: true}), ['only', 'mkdir', 'tocloud', 'rename']);
  assert.deepEqual(ids({source: 'pc'}), ['open']);
  assert.deepEqual(ids({source: 'pc', is_folder: true}), ['only']);
  assert.deepEqual(ids(null), []);
});

test('S51-22 공용 줄 메뉴 HTML: 제목·항목·맨 아래 줄(빨강 없음)·글자 막기', () => {
  const html = rowMenuHtml({title: '<a>', items: [{id: 'open', label: '열기'}, {id: 'trash', label: '휴지통', last: true}]});
  assert.match(html, /<p class="row-menu-title">&lt;a&gt;<\/p>/);
  assert.match(html, /data-row-item="trash" class="row-menu-last"/);
  assert.doesNotMatch(html, /danger/);
});

test('S51-22 [파일] 나무 ⋯는 옛 고르기 길(폴더 안으로 + 고르기)로 가지 않는다', () => {
  const src = read('app/files.js');
  assert.doesNotMatch(src, /data-fx-tpick|treePick\(/);
  assert.match(src, /'data-fx-tmenu'/);
  assert.match(src, /openRowMenu\(b,/);
});
