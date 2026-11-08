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
  // S53-8 ②: 클라우드 폴더도 [자료실로 보내기](폴더째, 안의 파일).
  assert.deepEqual(ids({source: 'od', is_folder: true}, {sibIndex: 1, sibCount: 3}), ['only', 'mkdir', 'upload', 'tolib', 'copy', 'move', 'rename', 'star', 'color', 'up', 'down', 'trash']);
  assert.deepEqual(ids({source: 'od', is_folder: true}, {sibIndex: 0, sibCount: 1}), ['only', 'mkdir', 'upload', 'tolib', 'copy', 'move', 'rename', 'star', 'color', 'trash']);
  const folder = treeMenuItems({source: 'od', is_folder: true}, {sibIndex: 1, sibCount: 3});
  assert.deepEqual(folder.filter(x => x.sep).map(x => x.id), ['star']);
  const items = treeMenuItems({source: 'od'});
  assert.equal(items.at(-1).id, 'trash');
  assert.equal(items.at(-1).last, true);
  assert.equal(items.filter(x => x.last).length, 1);
});

test('S51-22 나무 ⋯ 메뉴: 이 폰은 클라우드에 복사(+쓸 수 있으면 이름·휴지통), 내 PC는 보기·열기만 — S53-10 휴지통은 늘 맨 아래(못 하면 흐리게)', () => {
  assert.deepEqual(ids({source: 'ph'}), ['open', 'tolib', 'tocloud', 'trash']);
  // S52-43 ②: 폰 ↔ 클라우드 옮기기. S53-8: 폰에 쓸 수 있으면 받을 곳에 이 폰도 있어 [복사], 폴더도 [옮기기]·[자료실로 보내기](폴더째).
  assert.deepEqual(ids({source: 'ph'}, {phoneWrite: true}), ['open', 'tolib', 'copy', 'move', 'rename', 'trash']);
  assert.deepEqual(ids({source: 'ph', is_folder: true}, {phoneWrite: true}), ['only', 'mkdir', 'tolib', 'copy', 'move', 'rename', 'trash']);
  assert.deepEqual(ids({source: 'ph', is_folder: true}), ['only', 'tolib', 'tocloud', 'trash']);
  assert.deepEqual(ids({source: 'pc'}), ['open', 'trash']);
  assert.deepEqual(ids({source: 'pc', is_folder: true}), ['only', 'trash']);
  // S52-41: 바구니 문 0.4.0+면 내 PC 파일도 클라우드로 복사·옮기기(이름·휴지통은 다음 판이라 없음). S53-8: 폴더째·자료실로 보내기도.
  assert.deepEqual(ids({source: 'pc'}, {pcWrite: true}), ['open', 'tolib', 'copy', 'move', 'trash']);
  assert.deepEqual(ids({source: 'pc', is_folder: true, parent_id: 'C:\\'}, {pcWrite: true}), ['only', 'tolib', 'copy', 'move', 'trash']);
  assert.deepEqual(ids({source: 'pc', is_folder: true, parent_id: null}, {pcWrite: true}), ['only', 'trash']);
  // S52-43 ① FILES-내PC쓰기: 0.5.0+ 문(pcEdit)이면 클라우드와 같은 항목(S53-8: 폴더째 복사도, 드라이브 줄은 이 폴더만·새 폴더).
  const edit = {pcWrite: true, pcEdit: true};
  assert.deepEqual(ids({source: 'pc', parent_id: 'C:\\'}, edit), ['open', 'tolib', 'copy', 'move', 'rename', 'trash']);
  assert.deepEqual(ids({source: 'pc', is_folder: true, parent_id: 'C:\\'}, edit), ['only', 'mkdir', 'tolib', 'copy', 'move', 'rename', 'trash']);
  assert.deepEqual(ids({source: 'pc', is_folder: true, parent_id: null}, edit), ['only', 'mkdir', 'trash']);
  assert.deepEqual(ids({source: 'pc', is_folder: true, parent_id: 'C:\\'}, {...edit, pinned: false}), ['only', 'mkdir', 'tolib', 'copy', 'move', 'rename', 'pin', 'trash']);
  assert.equal(treeMenuItems({source: 'pc'}, edit).filter(x => x.last).map(x => x.id).join(), 'trash');
  assert.deepEqual(ids(null), []);
  // S52-43 ③: [경로 복사]는 화면이 클립보드를 쓸 수 있을 때 첫 묶음 끝(둘째 묶음·휴지통 앞).
  assert.deepEqual(ids({source: 'od', is_folder: false}, {copyPath: true}), ['open', 'tolib', 'copy', 'move', 'rename', 'path', 'star', 'trash']);
  assert.deepEqual(ids({source: 'pc', is_folder: true, parent_id: 'C:\\'}, {pcWrite: true, pcEdit: true, pinned: false, copyPath: true}), ['only', 'mkdir', 'tolib', 'copy', 'move', 'rename', 'path', 'pin', 'trash']);
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

test('S52-44 ⑤ 여러 개 골랐을 때만 첫 묶음 끝에 [여러 개 받기](받기 아이콘)', () => {
  const file = {source: 'od', is_folder: false, name: '가짜.pdf'};
  const ids = o => treeMenuItems(file, o).map(it => it.id);
  assert.equal(ids({}).includes('zip'), false);
  const list = ids({zip: true, copyPath: true});
  assert.ok(list.indexOf('zip') > list.indexOf('path') && list.indexOf('zip') < list.indexOf('star'), list.join(','));
  assert.equal(treeMenuItems(file, {zip: true}).find(it => it.id === 'zip').label, '여러 개 받기');
  assert.match(rowMenuHtml({items: [{id: 'zip', label: '여러 개 받기'}]}), /row-menu-ico/);
});

test('S53-10 FILES-이폰지우기 덧붙임: 모든 저장소·파일·폴더 ⋯에 [휴지통]이 맨 아래 같은 자리, 못 지우면 흐리게(off) — 이유는 화면이', () => {
  const trashOf = (row, opt) => treeMenuItems(row, opt).find(x => x.id === 'trash');
  const rows = [
    {source: 'od'}, {source: 'od', is_folder: true}, {source: 'gd'}, {source: 'gd', is_folder: true},
    {source: 'ph'}, {source: 'ph', is_folder: true}, {source: 'pc', parent_id: 'C:\\'}, {source: 'pc', is_folder: true, parent_id: 'C:\\'}, {source: 'pc', is_folder: true, parent_id: null}
  ];
  const opts = [{}, {phoneWrite: true}, {pcWrite: true}, {pcWrite: true, pcEdit: true}, {copyPath: true, zip: true, pinned: false}];
  for (const row of rows) for (const opt of opts) {
    const items = treeMenuItems(row, opt);
    assert.equal(items.at(-1).id, 'trash', JSON.stringify([row, opt]));
    assert.equal(items.filter(x => x.id === 'trash').length, 1);
    assert.equal(items.at(-1).label, '휴지통');
  }
  // 지울 수 있으면 off 없음.
  for (const [row, opt] of [[{source: 'od'}, {}], [{source: 'gd', is_folder: true}, {}], [{source: 'ph'}, {phoneWrite: true}], [{source: 'ph', is_folder: true}, {phoneWrite: true}],
    [{source: 'pc', parent_id: 'C:\\'}, {pcWrite: true, pcEdit: true}], [{source: 'pc', is_folder: true, parent_id: 'C:\\'}, {pcWrite: true, pcEdit: true}]]) assert.equal(trashOf(row, opt).off, undefined, JSON.stringify(row));
  // 못 지우면 이유 코드: 폰에 쓸 수 없음·PC 앱 옛 판·드라이브 줄.
  assert.equal(trashOf({source: 'ph'}).off, 'ph');
  assert.equal(trashOf({source: 'ph', is_folder: true}).off, 'ph');
  assert.equal(trashOf({source: 'pc'}).off, 'pc');
  assert.equal(trashOf({source: 'pc', is_folder: true, parent_id: 'C:\\'}, {pcWrite: true}).off, 'pc');
  assert.equal(trashOf({source: 'pc', is_folder: true, parent_id: null}, {pcWrite: true, pcEdit: true}).off, 'drive');
  // 흐린 항목: 숨기지 않고 aria-disabled(누르면 run이 불림 — disabled 아님).
  const html = rowMenuHtml({items: treeMenuItems({source: 'ph', is_folder: true})});
  assert.match(html, /data-row-item="trash" class="row-menu-last row-menu-off" aria-disabled="true"/);
  assert.doesNotMatch(html, /data-row-item="trash"[^>]* disabled/);
  assert.match(read('app/od-link.css'), /\.row-menu \.row-menu-off/);
  // 화면: 두 ⋯ 메뉴(나무·목록 우클릭) 모두 흐린 항목을 누르면 지우지 않고 이유 한 줄(offStop), 폰 폴더 휴지통은 안 파일을 휴지통으로.
  const src = read('app/files.js');
  assert.equal((src.match(/if \(!?offStop\(items, id\)\)/g) || []).length, 2);
  assert.doesNotMatch(src, /폰 폴더는 지우지 않아요/);
  assert.match(src, /phoneTrashAsk\(/);
  assert.match(src, /PHONE_TRASH_BATCH/);
});
