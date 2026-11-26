// S69-68 UI-오른쪽목록펼치기·UI-두칸따로(사용자 11/24 20:09·20:14): 탐색기 오른쪽 칸 폴더 줄도 그 자리 펼치기·접기,
// 두 칸은 칸마다 펼침을 따로 가진다. 화면 없이 줄 만들기(순수 함수)와 소스 모양을 본다. 화면 동작은 tests/app-e2e/standard-interactions.spec.mjs T5·T6·T7.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {treeHtml} from '../app/library-tree.js';

const src = f => readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8');
const n = (id, extra = {}) => ({kind: 'folder', key: 'f:' + id, label: id, depth: 3, count: 0, files: [], children: [], ...extra});
const opts = open => ({isOpen: k => open.includes(k), showAll: () => false, fileHtml: d => `<i data-doc="${d.id}"></i>`, esc: s => s, emoji: true});

test('자료실 탐색기 칸(flat): 폴더 줄이 펼치는 줄 — 펼침 상태·안쪽 줄·이 칸 기준 단(0부터)', () => {
  const kid = n('k', {depth: 4, count: 1, files: [{id: 'd2'}]});
  const list = [n('a', {count: 2, files: [{id: 'd1'}], children: [kid]}), n('b')];
  const html = treeHtml(list, {...opts(['f:a']), flat: {node: {key: 'f:here', files: [{id: 'd0'}]}}});
  // 맨 위 줄 표시(data-lu-enter)는 0단 줄에만, 속성 모양이 깨지지 않는다(map 순번이 섞이지 않음).
  assert.equal((html.match(/data-lu-enter/g) || []).length, 2);
  assert.doesNotMatch(html, /"folder"[01]/);
  assert.match(html, /<details class="lu-node lu-enter" data-lu-node="f:a" data-lu-node-kind="folder" data-lu-enter[^>]*--lu-depth:0[^>]* open>/);
  // 펼친 폴더 안: 하위 폴더 줄(1단) + 자료 줄. 하위 폴더 줄은 맨 위 줄 표시가 없다.
  assert.match(html, /<details class="lu-node" data-lu-node="f:k" data-lu-node-kind="folder" style="--lu-depth:1"/);
  assert.match(html, /data-doc="d1"/);
  // 접힌 폴더는 안쪽을 그려 두지 않는다(보이는 줄만). 빈 폴더를 펼치면 '빈 폴더' 한 줄.
  assert.match(html, /data-lu-node="f:b"[^>]*><summary[^]*?<\/summary><div class="lu-node-body"><\/div><\/details>/);
  const openB = treeHtml(list, {...opts(['f:b']), flat: {node: null}});
  assert.match(openB, /data-lu-node="f:b"[^]*lu-node-empty[^]*빈 폴더/);
  assert.doesNotMatch(openB, /data-doc="d1"/); // 접힌 a 안 자료는 그리지 않음
  // 지금 폴더 자료 줄은 폴더 줄 다음에 감싸지 않고.
  assert.ok(html.indexOf('data-doc="d0"') > html.lastIndexOf('</details>'));
});

test('자료실 탐색기 칸 머리 누르기 = 펼치기만(들어가기 길 없음), 두 번 누르기도 들어가지 않음', () => {
  const s = src('library-upload.js');
  assert.doesNotMatch(s, /data-lu-enter'\)\)\{e\.preventDefault\(\);luPressEnter/);
  // S69-76: 탐색기 칸만 빼던 폴더 줄 dblclick 들어가기 처리 자체를 지웠다(모든 폴더 줄 두 번 누르기 = 들어가지 않음).
  assert.doesNotMatch(s, /addEventListener\('dblclick'/);
});

test('자료실 두 칸: 칸마다 펼침(own[i]) — 칸 안 누르기·메뉴 펼치기·모두 펴기가 그 칸(들)만 바꾸고, 옮긴 뒤 저절로 펼치지 않음', () => {
  const two = src('library-two-pane.js');
  assert.match(two, /const own = \[new Map\(\), new Map\(\)\];/);
  assert.match(two, /const paneOpen = i => k => \(own\[i\]\.has\(k\) \? own\[i\]\.get\(k\) : !!isOpen\(k\)\);/);
  assert.match(two, /toggleIn\(i, 'f:' \+ fid,/);
  assert.doesNotMatch(two, /h\.toggle\(/);
  const up = src('library-upload.js');
  assert.match(up, /function luRevealKeys\(keys\)\{if\(luTwoActive\(\)\|\|\(luExplorerNow&&LU_SPLIT\?\.matches\)\)\{luRenderLibrary\(\);return\}/);
  assert.match(up, /function luToggleNode\(key\)\{if\(luTwoActive\(\)\)\{luTwo\.toggle\(key\);return\}/);
});

test('[파일] 목록 칸 펼침은 칸마다(p.xopen), 한 칸·두 칸·폰 그 폴더만 모두 그 자리 펼치기', () => {
  const s = src('files.js');
  assert.match(s, /const xable = p => orderable\(p\);/);
  assert.match(s, /function pressListFolder\(p, r\) \{[\s\S]{0,400}?xToggle\(p, r\);/);
});
