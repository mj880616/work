import {test} from 'node:test';
import assert from 'node:assert/strict';
import {edgeSpeed, moved, HOLD_MS, SLOP, EDGE} from '../app/touch-drag.js';
// S51-20 FILES-폰보기끌기 ③: 꾹 눌러 끌기 부품의 계산(화면 없이).
test('끝에 가까울수록 빠르게 저절로 굴리기, 가운데는 0', () => {
  assert.equal(edgeSpeed(400, 0, 800), 0);
  assert.ok(edgeSpeed(2, 0, 800) < 0);
  assert.ok(edgeSpeed(798, 0, 800) > 0);
  assert.ok(Math.abs(edgeSpeed(2, 0, 800)) > Math.abs(edgeSpeed(EDGE - 5, 0, 800)));
  assert.equal(edgeSpeed(EDGE + 1, 0, 800), 0);
  assert.equal(edgeSpeed(50, 0, 80), 0, '칸이 너무 작으면 굴리지 않음');
  assert.equal(edgeSpeed(NaN, 0, 800), 0);
});
test('움직임 판정과 기본값', () => {
  assert.equal(moved(0, 0, 3, 4), false);
  assert.equal(moved(0, 0, 8, 8), true);
  assert.ok(HOLD_MS >= 300 && HOLD_MS <= 500);
  assert.equal(SLOP, 10);
});
