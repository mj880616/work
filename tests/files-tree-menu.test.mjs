import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {treeMenuItems} from '../app/files-tree-menu.mjs';
import {rowMenuHtml} from '../app/row-menu.js';

const ids = (row, opt) => treeMenuItems(row, opt).map(x => x.id);
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('S51-22 나무 ⋯ 메뉴: 클라우드 파일·폴더는 예전 고르기 줄 기능 그대로, 휴지통 맨 아래', () => {
  // FILES-자료실로보내기(S52-26): 파일은 [자료실로 보내기], 이미 자료실에 있는 구글 드라이브 파일은 그 자리가 [자료실에서 보기].
  assert.deepEqual(ids({source: 'od', is_folder: false}), ['open', 'tolib', 'copy', 'move', 'rename', 'star', 'trash']);
  assert.deepEqual(ids({source: 'gd', is_folder: false, starred: true}), ['open', 'tolib', 'copy', 'move', 'rename', 'unstar', 'trash']);
  assert.deepEqual(ids({source: 'gd', is_folder: false, library_doc_id: 'd1'}), ['open', 'libview', 'copy', 'move', 'rename', 'star', 'trash']);
  assert.equal(treeMenuItems({source: 'gd'}).find(x => x.id === 'tolib').label, '자료실로 보내기');
  assert.equal(treeMenuItems({source: 'gd', library_doc_id: 'd1'}).find(x => x.id === 'libview').label, '자료실에서 보기');
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
  assert.deepEqual(ids({source: 'ph'}), ['open', 'tolib', 'tocloud']);
  assert.deepEqual(ids({source: 'ph'}, {phoneWrite: true}), ['open', 'tolib', 'tocloud', 'move', 'rename', 'trash']); // S52-43 ②: 폰 ↔ 클라우드 옮기기
  assert.deepEqual(ids({source: 'ph', is_folder: true}, {phoneWrite: true}), ['only', 'mkdir', 'tocloud', 'rename']);
  assert.deepEqual(ids({source: 'pc'}), ['open']);
  assert.deepEqual(ids({source: 'pc', is_folder: true}), ['only']);
  // S52-41: 바구니 문 0.4.0+면 내 PC 파일도 클라우드로 복사·옮기기(이름·휴지통은 다음 판이라 없음).
  assert.deepEqual(ids({source: 'pc'}, {pcWrite: true}), ['open', 'copy', 'move']);
  assert.deepEqual(ids({source: 'pc', is_folder: true}, {pcWrite: true}), ['only']);
  // S52-43 ① FILES-내PC쓰기: 0.5.0+ 문(pcEdit)이면 클라우드와 같은 항목(폴더째 복사는 다음 PR, 드라이브 줄은 이 폴더만·새 폴더).
  const edit = {pcWrite: true, pcEdit: true};
  assert.deepEqual(ids({source: 'pc', parent_id: 'C:\\'}, edit), ['open', 'copy', 'move', 'rename', 'trash']);
  assert.deepEqual(ids({source: 'pc', is_folder: true, parent_id: 'C:\\'}, edit), ['only', 'mkdir', 'move', 'rename', 'trash']);
  assert.deepEqual(ids({source: 'pc', is_folder: true, parent_id: null}, edit), ['only', 'mkdir']);
  assert.deepEqual(ids({source: 'pc', is_folder: true, parent_id: 'C:\\'}, {...edit, pinned: false}), ['only', 'mkdir', 'move', 'rename', 'pin', 'trash']);
  assert.equal(treeMenuItems({source: 'pc'}, edit).filter(x => x.last).map(x => x.id).join(), 'trash');
  assert.deepEqual(ids(null), []);
  // S52-43 ③: [경로 복사]는 화면이 클립보드를 쓸 수 있을 때 첫 묶음 끝(둘째 묶음·휴지통 앞).
  assert.deepEqual(ids({source: 'od', is_folder: false}, {copyPath: true}), ['open', 'tolib', 'copy', 'move', 'rename', 'path', 'star', 'trash']);
  assert.deepEqual(ids({source: 'pc', is_folder: true, parent_id: 'C:\\'}, {pcWrite: true, pcEdit: true, pinned: false, copyPath: true}), ['only', 'mkdir', 'move', 'rename', 'path', 'pin', 'trash']);
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
