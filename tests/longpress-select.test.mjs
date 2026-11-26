import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSelectMode, holdPick} from '../app/select-mode.js';

// S69 LONGPRESS-선택(2026-11-24 사용자): 폰에서 줄을 꾹 누르면 선택 모드 + 그 줄 선택, 메뉴는 ⋯로만.
test('holdPick: 더하기만 하고 넘겨받은 Set은 바꾸지 않는다', () => {
  const before = new Set(['a']);
  const next = holdPick(before, ['b']);
  assert.deepEqual([...next].sort(), ['a', 'b']);
  assert.deepEqual([...before], ['a']);
  assert.deepEqual([...holdPick(null, ['x'])], ['x']);
  assert.deepEqual([...holdPick(new Set(['x']), ['x'])], ['x'], '다시 꾹 눌러도 풀리지 않는다(토글 아님)');
});

test('select mode hold: 꺼져 있으면 켜고 그 줄을 고르고, 켜져 있으면 더한다', () => {
  const s = createSelectMode({router: () => null});
  s.hold(['a']);
  assert.equal(s.active, true); assert.deepEqual([...s.items], ['a']); assert.equal(s.anchor, 'a');
  s.hold(['b']);
  assert.deepEqual([...s.items].sort(), ['a', 'b']); assert.equal(s.anchor, 'b');
  s.hold(['a']);
  assert.deepEqual([...s.items].sort(), ['a', 'b'], '이미 고른 줄을 꾹 눌러도 그대로');
  s.hold(['c', 'd']);
  assert.equal(s.size, 4); assert.equal(s.anchor, 'a', '여럿(폴더 안 자료 모두)이면 anchor는 그대로');
});

test('select mode hold: 라우터 한 겹을 한 번만 연다(뒤로가기로 선택 끄기)', () => {
  let opened = 0;
  const router = () => ({layer: {open: () => { opened++; return {close() {}}; }}});
  const s = createSelectMode({layer: 'x', router});
  s.hold(['a']); s.hold(['b']);
  assert.equal(opened, 1);
});

// 화면마다 꾹 누르기가 메뉴가 아니라 공용 규칙(hold/holdPick)을 쓰는지 본다.
test('자료실·노트·파일이 꾹 누르기에 공용 선택 규칙을 쓴다', () => {
  const lib = readFileSync(new URL('../app/library-upload.js', import.meta.url), 'utf8');
  const folders = readFileSync(new URL('../app/library-folders.js', import.meta.url), 'utf8');
  const notes = readFileSync(new URL('../app/basket-notes.js', import.meta.url), 'utf8');
  const files = readFileSync(new URL('../app/files.js', import.meta.url), 'utf8');
  assert.match(lib, /luPick\.hold\(/);
  assert.match(folders, /onHold\(el\)/);
  assert.doesNotMatch(folders, /움직이지 않고 뗌 = 우클릭과 같은 메뉴/);
  assert.match(notes, /pick\.hold\(/);
  assert.match(files, /holdPick\(/);
});
