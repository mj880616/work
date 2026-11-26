import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {holdPick} from '../app/select-mode.js';

// S69-84 목록 엔진 통일 ①(2026-11-24 23:57 사용자 "폴드 펼침 화면에서도 꾹 눌러 선택 등 움직임 통일 뭔가 지금 어설퍼"):
// 폰·폴드 펼침·PC 모두 같은 규칙 — 손가락 꾹 누르기 = 선택 모드 + 그 줄(이미 선택 모드면 더하기, 토글 아님), 선택 모드에서 손가락 누르기 = 더하기/빼기,
// 꾹 눌러 움직이면 끌기, 메뉴는 ⋯. 기기 폭이 아니라 손가락이냐 마우스냐(pointerType)로 가른다. 화면 시험은 tests/app-e2e/standard-interactions.spec.mjs P4·D5.
const read = f => readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8');
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, a); const j = src.indexOf(b, i + a.length); return src.slice(i, j < 0 ? i + 3000 : j); };

test('공용 규칙 holdPick: 이미 고른 줄을 다시 꾹 눌러도 풀리지 않고, 다른 줄은 더한다', () => {
  assert.deepEqual([...holdPick(null, ['a'])], ['a']);
  assert.deepEqual([...holdPick(new Set(['a']), ['a'])], ['a']);
  assert.deepEqual([...holdPick(new Set(['a']), ['b'])], ['a', 'b']);
});

test('자료실: 손가락 길게 누르기는 목록 상자 전체(왼쪽 나무 + 목록)에서 받고, 폴더 줄은 폴더째 고른다', () => {
  const folders = read('library-folders.js');
  const touch = between(folders, 'function bindTouch(list){', '  // F2 = ');
  assert.match(touch, /const area=list\.closest\?\.\('#libraryListCard'\)\|\|list;/);
  assert.match(touch, /'\+NAV_ROW/, '나무·두 칸 칸의 폴더 줄도 잡는다');
  assert.doesNotMatch(touch, /\blist\.addEventListener\(/, '손짓은 목록만이 아니라 상자 전체(area)에서');
  assert.doesNotMatch(touch, /matchMedia|min-width|max-width/, '폭으로 가르지 않는다');
  assert.match(folders, /const NAV_ROW='#libraryFolderNav \.ft-row,\[data-lu-pane-i\] \.ft-row';/);
  const lib = read('library-upload.js');
  const hold = between(lib, 'function luRowHold(el){', '\n}\n');
  assert.match(hold, /el\.matches\?\.\('\.ft-row'\)\)\{const id=luMqFolderId\(el\);return id\?luHoldIds\(\[folderPick\(id\)\]\):false\}/, '사각형 고르기와 같은 폴더 열쇠');
  const tap = between(lib, 'function luOnNavPickClick(e){', '\n}\n');
  assert.match(tap, /e\.pointerType!=='touch'&&e\.pointerType!=='pen'/, '선택 모드 나무 누르기 = 더하기/빼기는 손가락만(마우스는 들어가기 그대로)');
  assert.match(tap, /luPick\.toggle\(\[folderPick\(id\)\]\)/);
});

test('자료실: 왼쪽 나무·두 칸 칸 폴더 줄에 ⋯(그 폴더 메뉴) — 손가락 기기는 꾹 누르기가 고르기라 메뉴는 ⋯로', () => {
  const lib = read('library-upload.js'), two = read('library-two-pane.js'), folders = read('library-folders.js');
  assert.match(lib, /more:\{attrs:\{'data-lu-nav-more':n\.id\},label:`\$\{n\.label\} 폴더 메뉴`\}/);
  assert.match(two, /more: \{attrs: \{'data-lu-nav-more': n\.id\}, label: `\$\{n\.label\} 폴더 메뉴`\}/);
  assert.match(folders, /\(t\.dataset\.luNavMore\?'f:'\+t\.dataset\.luNavMore:''\)/, '같은 폴더 메뉴(열쇠 f:id)');
  assert.match(lib, /function luOnNavMore\(e\)\{const b=e\.target\.closest\?\.\('\[data-lu-nav-more\]'\)/);
});

test('사진: 선택 모드에서도 손가락 꾹 누르기 = 그 칸 더하기(풀지 않음)', () => {
  const photos = read('photos.js');
  const down = between(photos, '  if (select.active) {\n    drag = {anchor:item.id', '\n  const pid = e.pointerId;');
  assert.match(down, /if \(e\.pointerType !== 'mouse'\) hold = /);
  assert.match(down, /select\.hold\(\[item\.id\]\)/);
  assert.match(down, /ateClick = true/, '꾹 누른 뒤 따라오는 누르기(풀기)는 먹는다');
});
