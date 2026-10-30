import test from 'node:test';
import assert from 'node:assert/strict';
import { clampFollowTop } from '../app/follow-pane.js';

test('짧은 칸은 늘 위쪽 자리(top)에 붙는다', () => {
  assert.equal(clampFollowTop(-500, { top: 12, view: 800, height: 300 }), 12);
  assert.equal(clampFollowTop(12, { top: 48, view: 800, height: 300 }), 48);
});
test('긴 칸은 머리(top)와 끝(화면 높이 - 칸 높이 - 12) 사이에서만 움직인다', () => {
  const o = { top: 12, view: 800, height: 2000 };
  assert.equal(clampFollowTop(12, o), 12);
  assert.equal(clampFollowTop(-400, o), -400);
  assert.equal(clampFollowTop(-5000, o), 800 - 2000 - 12);
  assert.equal(clampFollowTop(300, o), 12);
});
test('화면 높이와 거의 같은 칸도 끝이 화면 안에 들어온다', () => {
  assert.equal(clampFollowTop(-100, { top: 12, view: 800, height: 790 }), 800 - 790 - 12);
});
