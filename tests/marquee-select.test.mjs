import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rectOf, overlaps, hitKeys, mergePick, passed, THRESHOLD, inBoxes, clipBox} from '../app/marquee-select.js';
// S69-17 UI-끌어고르기: 빈 곳 끌기 사각형 계산(화면 없이). 고른 상태 주인은 부르는 화면의 선택 모드.
test('두 점 → 사각형(어느 쪽으로 끌어도 같은 사각형)', () => {
  assert.deepEqual(rectOf({x: 10, y: 50}, {x: 30, y: 20}), {left: 10, top: 20, right: 30, bottom: 50});
  assert.deepEqual(rectOf({x: 30, y: 20}, {x: 10, y: 50}), rectOf({x: 10, y: 50}, {x: 30, y: 20}));
});
test('넓이 있게 겹칠 때만 닿음 · 크기 0인 숨은 줄은 아님', () => {
  const r = {left: 0, top: 0, right: 100, bottom: 100};
  assert.equal(overlaps(r, {left: 50, top: 50, right: 150, bottom: 150}), true);
  assert.equal(overlaps(r, {left: 100, top: 0, right: 200, bottom: 100}), false);
  assert.equal(overlaps(r, {left: 0, top: 0, right: 0, bottom: 0}), false);
  assert.equal(overlaps(r, null), false);
});
test('닿은 열쇠는 차례대로 겹침 없이', () => {
  const r = {left: 0, top: 15, right: 10, bottom: 45};
  const rows = [0, 1, 2, 3, 4].map(i => ({key: 'd' + i, box: {left: 0, right: 500, top: i * 20, bottom: i * 20 + 20}}));
  assert.deepEqual(hitKeys(r, rows), ['d0', 'd1', 'd2']);
  assert.deepEqual(hitKeys(r, [...rows, rows[1]]), ['d0', 'd1', 'd2']);
  assert.deepEqual(hitKeys(r, []), []);
});
test('Ctrl·Shift면 처음 고른 것에 더하기, 아니면 닿은 것만', () => {
  assert.deepEqual([...mergePick(['a', 'b'], ['c'], true)], ['a', 'b', 'c']);
  assert.deepEqual([...mergePick(['a', 'b'], ['c'], false)], ['c']);
  assert.deepEqual([...mergePick(['a'], ['a', 'c'], true)], ['a', 'c']);
});
test('문턱을 넘어야 사각형이 시작된다(그 전에 떼면 보통 클릭)', () => {
  assert.equal(THRESHOLD, 4);
  assert.equal(passed({x: 0, y: 0}, {x: 3, y: 4}), false);
  assert.equal(passed({x: 0, y: 0}, {x: 0, y: 5}), true);
});
// S69(명진 11/24 "창 밖에서도 창 안으로 드래그" · "어느곳에서든 자유롭게"): 보이는 사각형은 시작한 칸 경계가 아니라 창 기준으로만 자른다.
test('사각형은 창 기준(시작 칸 경계에 갇히지 않음) · 빈 곳 누르기는 입력칸 초점을 놓는다', async () => {
  const {readFileSync} = await import('node:fs');
  const src = readFileSync(new URL('../app/marquee-select.js', import.meta.url), 'utf8');
  assert.match(src, /const c = \{left: 0, top: 0, right: win\.innerWidth, bottom: win\.innerHeight\};/);
  assert.doesNotMatch(src, /clip:/);
  assert.match(src, /focused\.blur\(\)/);
});

// S71-45 STD-끌기시작: 줄의 잡는 곳(아이콘 + 이름 글자) 판정 계산.
test('잡는 곳: 아이콘·이름 글자 상자 안(넓힘 포함)만 참, 같은 줄 다른 칸은 거짓', () => {
  const icon = {left: 10, top: 0, right: 30, bottom: 20}, name = {left: 36, top: 2, right: 90, bottom: 18};
  assert.equal(inBoxes(20, 10, [icon, name]), true);
  assert.equal(inBoxes(60, 10, [icon, name]), true);
  assert.equal(inBoxes(91, 10, [icon, name]), true); // 2px 넓힘
  assert.equal(inBoxes(120, 10, [icon, name]), false); // 이름 오른쪽 빈 곳
  assert.equal(inBoxes(4, 10, [icon, name]), false); // 아이콘 왼쪽 띠
  assert.equal(inBoxes(20, 10, [{left: 10, top: 0, right: 10, bottom: 20}]), false); // 크기 0
  assert.equal(inBoxes(20, 10, []), false);
});
test('잘린 이름: 글자 상자는 보이는 칸 안까지만', () => {
  assert.deepEqual(clipBox({left: 36, top: 2, right: 400, bottom: 18}, {left: 36, top: 0, right: 200, bottom: 20}), {left: 36, top: 2, right: 200, bottom: 18});
  assert.equal(clipBox({left: 0, top: 0, right: 10, bottom: 10}, {left: 20, top: 0, right: 30, bottom: 10}), null);
});
