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
  // S51-31: 세 묶음 — 올리기·복사·옮기기·이름 바꾸기 | 별표·색·위로·아래로 | 휴지통.
  assert.deepEqual(ids({source: 'od', is_folder: true}, {sibIndex: 1, sibCount: 3}), ['only', 'mkdir', 'upload', 'copy', 'move', 'rename', 'star', 'color', 'up', 'down', 'trash']);
  assert.deepEqual(ids({source: 'od', is_folder: true}, {sibIndex: 0, sibCount: 1}), ['only', 'mkdir', 'upload', 'copy', 'move', 'rename', 'star', 'color', 'trash']);
  const folder = treeMenuItems({source: 'od', is_folder: true}, {sibIndex: 1, sibCount: 3});
  assert.deepEqual(folder.filter(x => x.sep).map(x => x.id), ['star']);
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

test('S51-31 공용 줄 메뉴 HTML: 제목(줄 수 있을 때)·선 아이콘·묶음 선·맨 아래 줄·글자 막기', () => {
  const html = rowMenuHtml({title: '<a>', items: [{id: 'open', label: '열기'}, {id: 'star', label: '별표', sep: true}, {id: 'trash', label: '휴지통', last: true}]});
  assert.match(html, /<p class="row-menu-title">&lt;a&gt;<\/p>/);
  assert.match(html, /data-row-item="star" class="row-menu-sep"/);
  assert.match(html, /data-row-item="trash" class="row-menu-last"/);
  assert.equal((html.match(/<svg class="row-menu-ico"[^>]*aria-hidden="true"/g) || []).length, 3);
  assert.match(html, /<span>휴지통<\/span>/);
  // 아이콘을 모르는 항목뿐이면 아이콘 칸 없이 글자만.
  assert.doesNotMatch(rowMenuHtml({items: [{id: 'zz', label: '가'}]}), /row-menu-ico/);
});

test('S51-31 화면 아래를 덮는 판(sheet) 없음 — 폰·폴드·PC 같은 작은 상자, 누른 줄 표시', () => {
  for (const p of ['app/anchored-menu.js', 'app/row-menu.js', 'app/od-link.css']) assert.doesNotMatch(read(p), /am-sheet|sheet:|sheet\(/);
  assert.match(read('app/row-menu.js'), /boxWidth: 180/);
  assert.match(read('app/od-link.css'), /\.row-menu-owner\{/);
});

test('S51-22 [파일] 나무 ⋯는 옛 고르기 길(폴더 안으로 + 고르기)로 가지 않는다', () => {
  const src = read('app/files.js');
  assert.doesNotMatch(src, /data-fx-tpick|treePick\(/);
  assert.match(src, /'data-fx-tmenu'/);
  assert.match(src, /openRowMenu\(b,/);
});
