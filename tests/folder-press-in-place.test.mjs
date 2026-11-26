// UI-폴더이름펼치기(명진 11/24 18:09): 그 자리 펼치는 목록(자료실 폰 나무·두 칸 칸 안, [파일] 폰 나무·두 칸 칸 안, 노트 폰 폴더 목록, 사진 폰·폴드 나무)에서
// 폴더 이름 누르기 = 늘 그 자리 펼치기·접기. 빈 폴더도 펼쳐 안에 '빈 폴더' 한 줄. 들어가기는 ⋯ 첫 줄 [이 폴더로 들어가기]·두 손가락 벌리기만.
// 화면 없이 줄 만들기(순수 함수)와 소스 모양을 본다. 화면 동작은 tests/app-e2e/folder-press-leaf.spec.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {treeRows} from '../app/note-tree.mjs';
import {boxRows, folderKey} from '../app/files-model.mjs';
import {paneContent, paneRows} from '../app/library-two-pane.js';
import {treeHtml} from '../app/library-tree.js';
import {ftEmptyRowHtml, ftWaitRowHtml, ftFailRowHtml, FOLDER_EMPTY_TEXT} from '../app/folder-tree-ui.mjs';
import {treeMenuItems} from '../app/files-tree-menu.mjs';
import {FOLDER_ENTER_LABEL} from '../app/folder-tree-press.mjs';

const src = f => readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8');

test('공용 빈 폴더 줄: 들여쓰기 + 빈 폴더 글자 + 그 화면 표시', () => {
  const html = ftEmptyRowHtml({depth: 2, attrs: {'data-ft-parent': 'k'}});
  assert.match(html, /class="ft-row ft-item ft-empty-row"/);
  assert.match(html, /data-ft-parent="k"/);
  assert.match(html, /--ft-depth:2/);
  assert.match(html, /이 폴더는 비어 있어요/);
});

test('FILES-빈폴더줄(S70-70): 빈 폴더 글자는 한 곳, 읽는 중·못 읽음 줄은 같은 들여쓰기의 다른 줄', () => {
  assert.equal(FOLDER_EMPTY_TEXT, '이 폴더는 비어 있어요');
  const wait = ftWaitRowHtml({depth: 1, attrs: {'data-ft-parent': 'k'}}), fail = ftFailRowHtml({depth: 1, attrs: {'data-fx-fail-key': 'k'}, retry: 'data-x-retry', reason: '까닭'});
  assert.match(wait, /ft-empty-row ft-wait-row/); assert.match(wait, /<kptu-wait/); assert.doesNotMatch(wait, /비어 있어요|불러오지/);
  assert.match(fail, /ft-empty-row ft-fail-row/); assert.match(fail, /불러오지 못했어요/); assert.match(fail, /data-x-retry/); assert.match(fail, /까닭/); assert.doesNotMatch(fail, /비어 있어요/);
  // [파일] 폰 나무: 펼쳤는데 아직 못 읽은 폴더 = 뼈대 줄(pending), 못 읽은 폴더 = 실패 줄, 다 읽고 비었을 때만 빈 폴더 줄.
  const children = new Map([[folderKey('od', null), [{item_id: 'E', name: '빈', is_folder: true}, {item_id: 'U', name: '모름', is_folder: true}, {item_id: 'F', name: '실패', is_folder: true}]], [folderKey('od', 'E'), []]]);
  const rows = boxRows({source: 'od', children, files: new Map(), open: new Set(['E', 'U', 'F'].map(id => folderKey('od', id))), pending: true, failed: new Set([folderKey('od', 'F')])});
  assert.deepEqual(rows.map(r => r.type + (r.id ? ':' + r.id : '')), ['folder:E', 'empty', 'folder:U', 'wait', 'folder:F', 'fail']);
  assert.equal(rows[3].depth, 1); assert.equal(rows[5].parent, folderKey('od', 'F'));
  // 화면 코드: 나무가 못 읽은 폴더를 빈 목록([])으로 두지 않는다.
  assert.doesNotMatch(src('files.js'), /catch \{ if \(state\.scope === scope\) state\.children\.set\(key, \[\]\); \}/);
});

test('노트 폰 목록: 펼친 빈 폴더 아래 빈 폴더 한 줄(emptyRows를 켠 곳만), 안이 있는 폴더·닫힌 폴더는 없음', () => {
  const folders = [{id: 'a', parent_id: null, name: '가', sort_order: 1}, {id: 'b', parent_id: null, name: '나', sort_order: 2}];
  const notes = [{id: 'n1', f: 'a'}];
  const rows = treeRows({folders, notes, folderOf: n => n.f, isOpen: () => true, emptyRows: true});
  assert.deepEqual(rows.map(r => `${r.type}:${r.id}:${r.depth}`), ['folder:a:0', 'note:n1:1', 'folder:b:0', 'empty:b:1']);
  assert.equal(rows.find(r => r.type === 'empty').parent, 'b');
  assert.equal(treeRows({folders, notes, folderOf: n => n.f, isOpen: () => true}).some(r => r.type === 'empty'), false); // 다른 화면(PC 나무·보드)은 그대로
  assert.equal(treeRows({folders, notes, folderOf: n => n.f, isOpen: () => false, emptyRows: true}).some(r => r.type === 'empty'), false);
});

test('[파일] 폰 나무: 다 읽은 빈 폴더를 펼치면 빈 폴더 한 줄, 아직 못 읽었으면 없음(펼치며 읽기)', () => {
  const children = new Map([[folderKey('od', null), [{item_id: 'E', name: '빈', is_folder: true}, {item_id: 'U', name: '모름', is_folder: true}]], [folderKey('od', 'E'), []]]);
  const rows = boxRows({source: 'od', children, files: new Map(), open: new Set([folderKey('od', 'E'), folderKey('od', 'U')])});
  assert.deepEqual(rows.map(r => r.type + (r.id ? ':' + r.id : '')), ['folder:E', 'empty', 'folder:U']);
  assert.equal(rows[1].depth, 1);
  assert.equal(rows[1].parent, folderKey('od', 'E'));
});

test('자료실 두 칸 칸 안: 펼친 빈 폴더 아래 빈 폴더 한 줄', () => {
  const tree = [{kind: 'folder', key: 'f:e', id: 'e', label: '빈', files: [], children: []}];
  const rows = paneRows(paneContent(tree, null), k => k === 'f:e');
  assert.deepEqual(rows.map(r => `${r.kind}:${r.depth}:${r.open ?? ''}`), ['folder:0:true', 'empty:1:']);
});

test('자료실 나무(폰 맨 위 목록): 빈 폴더 안에 빈 폴더 한 줄 — 펼치면 보이고(details) 들어가지 않는다', () => {
  const n = (id, extra = {}) => ({kind: 'folder', key: 'f:' + id, label: id, depth: 0, count: 0, files: [], children: [], ...extra});
  const html = treeHtml([n('e'), n('f', {count: 1, files: [{id: 'd1'}]})], {isOpen: () => false, showAll: () => false, fileHtml: d => `<i>${d.id}</i>`, esc: s => s, emoji: true});
  const bodies = html.split('<details').slice(1);
  assert.match(bodies[0], /lu-node-empty[^]*이 폴더는 비어 있어요/);
  assert.doesNotMatch(bodies[1], /lu-node-empty/);
});

test('그 자리 펼치는 목록의 폴더 누르기는 들어가지 않는다(소스) — 하위 없는 폴더 = 열기 판정이 남아 있지 않다', () => {
  for (const f of ['library-upload.js', 'library-two-pane.js', 'files.js', 'basket-notes.js', 'photos.js']) {
    assert.doesNotMatch(src(f), /folderPressAction|FOLDER_PRESS_ENTER|createLeafWait/, f);
  }
  // 자료실 폰 맨 위 나무: 이름 누르기 = 들어가기였던 길(폴더 그림 자리 재기)을 없앴다.
  // S69-68(명진 11/24 20:09): 탐색기 칸 줄(data-lu-enter)도 누르면 그 자리 펼치기 — 머리 누르기에서 들어가는 길이 남아 있지 않다.
  assert.doesNotMatch(src('library-upload.js'), /luOnFolderIcon/);
  assert.doesNotMatch(src('library-upload.js'), /hasAttribute\('data-lu-enter'\)\)\{e\.preventDefault\(\);luPressEnter/);
  // [파일] 목록 칸 그 자리 펼치기는 한 칸·두 칸·폰 '그 폴더만' 모두(두 칸만이 아님).
  assert.match(src('files.js'), /const xable = p => orderable\(p\);/);
  // 노트 PC 오른쪽 칸 폴더 줄 = 그 자리 펼치기(왼쪽 나무 openSet과 따로 paneOpen).
  assert.match(src('basket-notes.js'), /if \(paneOpen\.has\(id\)\) paneOpen\.delete\(id\); else paneOpen\.add\(id\);/);
});

test('⋯ 메뉴 첫 줄 = [이 폴더로 들어가기] — 자료실·[파일]·노트·사진', () => {
  // [파일]: 모든 저장소 폴더 메뉴 첫 항목
  for (const row of [{source: 'od', is_folder: true}, {source: 'gd', is_folder: true}, {source: 'ph', is_folder: true}, {source: 'pc', is_folder: true, parent_id: 'x'}]) {
    const items = treeMenuItems(row, {phoneWrite: true, pcWrite: true, pcEdit: row.source === 'pc'});
    assert.equal(items[0].label, FOLDER_ENTER_LABEL, row.source);
  }
  // 자료실: 폴더 메뉴 render가 들어가기 단추로 시작한다.
  assert.match(src('library-folders.js'), /return \(enter&&s\(\)\.free\?'<button type="button" data-lu-folder-action="enter">이 폴더로 들어가기<\/button>':''\)\+top\+/);
  // 노트: 폴더 메뉴 항목 배열의 첫 줄.
  assert.match(src('basket-notes.js'), /return \[\['data-nx-enter', '이 폴더로 들어가기'\], \['data-nx-new-note'/);
  // 사진: 원드라이브·폰 저장소 폴더 메뉴는 폰에서도 들어가기 줄이 맨 앞(treeWide 조건 없음).
  const ph = src('photos.js');
  assert.match(ph, /const enter = !top \? menuBtn\('data-fm-enter', FOLDER_ENTER_LABEL\) : '';/);
  assert.match(ph, /return \[enter, sw, can \? menuBtn\('data-fm-new'/);
  assert.match(ph, /const enter = f \? menuBtn\('data-pfm-enter', FOLDER_ENTER_LABEL\) : '';/);
  assert.match(ph, /return \[enter, sw, can \? menuBtn\('data-pfm-new'/);
});
