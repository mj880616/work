// FOLDER-나무새기준(S51-12): 노트·파일·사진·자료실 공용 폴더 나무 부품(app/folder-tree-ui.mjs, app/folder-pinch.js)과
// 그 부품을 쓰는 노트 나무(note-tree.mjs treeRows의 'n개 더 보기')·자료실 나무(library-tree.js treeHtml)의 순수 부분 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ftIconHtml, ftFolderRowHtml, ftMoreRowHtml, ftTrashRowHtml, ftBoxHtml, ftLimit, FT_PREVIEW} from '../app/folder-tree-ui.mjs';
import {pinchStep, PINCH_OUT, PINCH_IN} from '../app/folder-pinch.js';
import {treeRows, OUTSIDE} from '../app/note-tree.mjs';
import * as lib from '../app/library-tree.js';

test('폴더 그림: 닫힌/열린 그림 하나, 색을 고른 폴더만 data-fc(1~8), 틀린 색은 기본', () => {
  assert.match(ftIconHtml(), /^<span class="ft-ico" data-ft-shape="closed" aria-hidden="true"><svg/);
  assert.match(ftIconHtml({open: true, color: 4}), /data-fc="4" data-ft-shape="open"/);
  assert.doesNotMatch(ftIconHtml({color: 9}), /data-fc/);
  assert.doesNotMatch(ftIconHtml(), /[▸▾›]|\u{1F4C1}|\u{1F4C2}/u);
});

test('폴더 줄: 맨 위 단계 ft-top·하위 ft-sub, 들여쓰기 4단까지, 이름 + 회색 개수 + ⋯, 빈 폴더는 늘 닫힌 그림, 꺼 둔 폴더는 끔', () => {
  const top = ftFolderRowHtml({name: '<가>', count: 8, countLabel: '노트 8개', depth: 0, open: true, rowAttrs: {'data-x': 'a'}, mainAttrs: {'data-open': 'a'}, more: {attrs: {'data-more': 'a'}, label: '가 메뉴'}});
  assert.match(top, /class="ft-row ft-folder ft-top ft-open"/);
  assert.match(top, /style="--ft-depth:0"/);
  assert.match(top, /<span class="ft-name">&lt;가&gt;<\/span><span class="ft-num" aria-label="노트 8개">8<\/span>/);
  assert.match(top, /data-ft-shape="open"/);
  assert.match(top, /aria-expanded="true"/);
  assert.match(top, /<button type="button" class="ft-btn ft-dots" data-more="a" aria-label="가 메뉴" aria-haspopup="true" aria-expanded="false"><span class="more-dots"/);
  const sub = ftFolderRowHtml({name: '나', depth: 9, open: true, hasContent: false});
  assert.match(sub, /ft-sub/); assert.match(sub, /--ft-depth:4/);
  assert.match(sub, /data-ft-shape="closed"/, '안이 빈 폴더는 펼쳐도 닫힌 그림');
  assert.doesNotMatch(sub, /aria-expanded/);
  assert.doesNotMatch(sub, /ft-dots/, '메뉴를 주지 않으면 ⋯ 없음');
  const off = ftFolderRowHtml({name: '다', off: true, count: 3});
  assert.match(off, /ft-off/); assert.match(off, /<span class="ft-offtag">끔<\/span>/);
});

test('n개 더 보기·휴지통·상자·자르기', () => {
  assert.match(ftMoreRowHtml({rest: 860, depth: 1, attrs: {'data-m': 'k'}}), /data-m="k" style="--ft-depth:1">860개 더 보기<span class="ft-hint"> · 두 손가락 벌리면 이 폴더만<\/span>/);
  assert.doesNotMatch(ftMoreRowHtml({rest: 2, hint: false}), /ft-hint/);
  assert.match(ftTrashRowHtml({count: 9, attrs: {'data-t': ''}}), /class="ft-row ft-trash ft-top"[\s\S]*휴지통[\s\S]*>9</);
  const box = ftBoxHtml({head: '원드라이브', collapsible: true, open: false, toggleAttrs: {'data-b': 'od'}, body: '<i>x</i>'});
  assert.match(box, /ft-box ft-box-closed/); assert.match(box, /aria-expanded="false"/); assert.match(box, /접힘/); assert.doesNotMatch(box, /<i>x<\/i>/);
  assert.match(ftBoxHtml({head: '최근', body: '<i>x</i>'}), /<span class="ft-box-title">최근<\/span>[\s\S]*<div class="ft-box-body"><i>x<\/i><\/div>/);
  const list = Array.from({length: 8}, (_, i) => i);
  assert.deepEqual(ftLimit(list), {shown: list.slice(0, FT_PREVIEW), rest: 8 - FT_PREVIEW});
  assert.deepEqual(ftLimit(list, true), {shown: list, rest: 0});
  assert.deepEqual(ftLimit(list.slice(0, 3)), {shown: [0, 1, 2], rest: 0});
});

test('두 손가락: 1.35배 벌리면 out, 0.75배 오므리면 in, 그 사이는 아무것도 안 함', () => {
  assert.equal(pinchStep(100, 100 * PINCH_OUT), 'out');
  assert.equal(pinchStep(100, 100 * PINCH_IN), 'in');
  assert.equal(pinchStep(100, 120), null);
  assert.equal(pinchStep(0, 50), null);
  assert.equal(pinchStep(NaN, 50), null);
});

test('노트 나무: 펼친 폴더 노트는 limit개 + more 줄, 폴더 줄 hasContent, 폴더 없음도 같음', () => {
  const folders = [{id: 'a', parent_id: null, name: '가', sort_order: 1}, {id: 'b', parent_id: null, name: '빈', sort_order: 2}];
  const notes = Array.from({length: 7}, (_, i) => ({id: 'n' + i, f: i < 6 ? 'a' : null}));
  const rows = treeRows({folders, notes, folderOf: n => n.f, isOpen: id => id === 'a' || id === OUTSIDE, limit: () => 5});
  assert.deepEqual(rows.map(r => r.type), ['folder', 'note', 'note', 'note', 'note', 'note', 'more', 'folder', 'outside', 'note']);
  assert.equal(rows[6].rest, 1); assert.equal(rows[6].id, 'a'); assert.equal(rows[1].parent, 'a');
  assert.equal(rows[0].hasContent, true); assert.equal(rows[7].hasContent, false);
  assert.equal(rows[9].parent, OUTSIDE);
  // 다 보기(Infinity)·찾는 중이면 자르지 않는다.
  assert.equal(treeRows({folders, notes, folderOf: n => n.f, isOpen: () => true}).filter(r => r.type === 'more').length, 0);
});

test('자료실 나무: 점(●) 없음, 폴더는 공용 닫힌/열린 그림, 빈 폴더는 닫힌 그림만', () => {
  const folders = [{id: 'f1', project_id: null, parent_id: null, name: '가', sort_order: 1}, {id: 'f2', project_id: null, parent_id: null, name: '빈', sort_order: 2}];
  const docs = [{id: 'd1', file_name: 'a.pdf', created_at: '2026-10-01T00:00:00Z'}, {id: 'd2', file_name: 'b.hwp', created_at: '2026-10-02T00:00:00Z'}];
  const nodes = lib.buildTree({groupBy: 'folder', docs, folders, items: [{document_id: 'd1', folder_id: 'f1'}, {document_id: 'd2', folder_id: 'f1'}], kindOf: d => lib.fileKindOf(d.file_name), sortKey: d => d.created_at, filtering: false});
  const html = lib.treeHtml(nodes, {isOpen: () => false, showAll: () => false, fileHtml: () => '', esc: s => String(s), kindKey: k => k, emoji: true});
  assert.doesNotMatch(html, /lu-kdot|lu-pdot|●/);
  const f1 = html.slice(html.indexOf('data-lu-node="f:f1"'), html.indexOf('data-lu-node="f:f2"'));
  assert.match(f1, /ft-ico lu-fe-closed" data-ft-shape="closed"/); assert.match(f1, /ft-ico lu-fe-open" data-ft-shape="open"/);
  const f2 = html.slice(html.indexOf('data-lu-node="f:f2"'));
  assert.match(f2, /lu-fe-only/); assert.doesNotMatch(f2, /data-ft-shape="open"/);
});

test('공용 모양 한 곳: folder-tree.css에 ft- 규칙, 노트·자료실이 공용 부품을 부르고 옛 점 규칙은 없음', () => {
  const css = readFileSync(new URL('../app/folder-tree.css', import.meta.url), 'utf8');
  for (const sel of ['.ft-box {', '.ft-main {', '.ft-top > .ft-main .ft-name', '.ft-off > .ft-main', '.ft-more-row {', '.ft-pinch {', '.ft-focus-bar {']) assert.ok(css.includes(sel), sel);
  const notes = readFileSync(new URL('../app/basket-notes.js', import.meta.url), 'utf8');
  assert.match(notes, /from '\.\/folder-tree-ui\.mjs'/); assert.match(notes, /bindFolderPinch\(/);
  const libJs = readFileSync(new URL('../app/library-upload.js', import.meta.url), 'utf8');
  assert.match(libJs, /bindFolderPinch\(luGestureArea,/); // S51-24: 손짓 칸 = 자료실 화면 전체(gesture-fill.js)
  const libCss = readFileSync(new URL('../app/library-upload.css', import.meta.url), 'utf8');
  assert.doesNotMatch(libCss, /\.lu-kdot|\.lu-pdot|\.lu-folder-icon/);
  assert.match(readFileSync(new URL('../app/view-loader.js', import.meta.url), 'utf8'), /library:\[[^\]]*'\.\/folder-tree\.css'/);
});

test('[파일] 폰 상자 나무 줄(boxRows): 맨 위 폴더부터, 펼친 폴더 안 하위 폴더 → 파일 limit개 + more, 뿌리 파일은 맨 끝', async () => {
  const {boxRows, folderKey} = await import('../app/files-model.mjs');
  const children = new Map([[folderKey('od', null), [{item_id: 'A', name: '가'}, {item_id: 'B', name: '나'}]], [folderKey('od', 'A'), [{item_id: 'C', name: '다'}]], [folderKey('od', 'B'), []]]);
  const files = new Map([[folderKey('od', 'A'), Array.from({length: 7}, (_, i) => ({item_id: 'f' + i, name: 'f' + i}))], [folderKey('od', 'B'), []], [folderKey('od', null), [{item_id: 'r', name: 'r'}]]]);
  const rows = boxRows({source: 'od', children, files, open: new Set([folderKey('od', 'A')]), limit: 5});
  assert.deepEqual(rows.map(r => r.type), ['folder', 'folder', 'file', 'file', 'file', 'file', 'file', 'more', 'folder', 'file']);
  assert.equal(rows[0].depth, 0); assert.equal(rows[1].depth, 1); assert.equal(rows[2].depth, 1); assert.equal(rows[7].rest, 2);
  assert.equal(rows[0].hasContent, true); assert.equal(rows[8].hasContent, false, '읽었는데 빈 폴더는 닫힌 그림');
  assert.equal(rows[1].hasContent, true, '아직 읽지 않은 폴더는 펼칠 수 있는 것으로');
  assert.equal(rows[2].parent, folderKey('od', 'A'));
  const all = boxRows({source: 'od', children, files, open: new Set([folderKey('od', 'A')]), more: new Set([folderKey('od', 'A')]), limit: 5});
  assert.equal(all.filter(r => r.type === 'more').length, 0);
});

test('[파일]·사진도 같은 공용 부품을 부른다(복사 없음)', () => {
  for (const f of ['files.js', 'photos.js']) {
    const src = readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8');
    assert.match(src, /from '\.\/folder-tree-ui\.mjs'/, f);
    assert.match(src, /bindFolderPinch\(/, f);
  }
});
