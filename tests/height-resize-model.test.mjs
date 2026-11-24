// S69-29 UI-창높이끌기: 상자 높이 저장 규칙(height-resize-model.mjs). 서버 칸(col_widths, 40~800 숫자) 안에서 높이 ÷ 2로 적는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampHeight, heightStored, heightOf, HEIGHT_MAX, COL_WIDTH_MIN, COL_WIDTH_MAX } from '../app/height-resize-model.mjs';
import { COL_WIDTH_MIN as VP_MIN, COL_WIDTH_MAX as VP_MAX } from '../app/view-prefs.js';

test('저장 칸 범위는 화면 기억(view-prefs.js = DB 검사)과 같다', () => {
  assert.equal(COL_WIDTH_MIN, VP_MIN); assert.equal(COL_WIDTH_MAX, VP_MAX);
});
test('높이 ↔ 저장 값: ÷2로 적고 ×2로 읽는다(80~1600px)', () => {
  assert.equal(heightStored(700), 350); assert.equal(heightOf(350), 700);
  assert.equal(heightStored(701), 351);
  assert.equal(heightStored(5000), 800); assert.equal(heightStored(10), 40);
  assert.equal(HEIGHT_MAX, 1600);
  for (const v of [null, undefined, 'x', 39, 801, NaN]) assert.equal(heightOf(v), null);
});
test('끈 높이는 가장 낮은 높이·1600px 사이 정수', () => {
  assert.equal(clampHeight(100, 240), 240); assert.equal(clampHeight(2000, 240), 1600); assert.equal(clampHeight(512.6, 240), 513);
  assert.equal(clampHeight('x', 240), 240);
});
