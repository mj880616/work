// NOTE-글폭(S61-21): 글 줄 폭 저장 규칙(line-width-model.mjs). 기본 40em, 20~80em, 서버 값은 em×10(표 칸 너비와 같은 저장 길·DB 검사 40~800 안).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_SCREEN, LINE_KEY, LINE_DEFAULT_EM, LINE_MIN_EM, LINE_MAX_EM, clampEm, lineEm, lineStored } from '../app/line-width-model.mjs';
import { colKey, withCol, colsFor } from '../app/col-widths-model.mjs';
import { COL_NAME_RE, COL_WIDTH_MIN, COL_WIDTH_MAX } from '../app/view-prefs.js';

test('기본 40em, 저장 값이 없거나 이상하면 기본', () => {
  assert.equal(LINE_DEFAULT_EM, 40);
  for (const v of [undefined, null, 'x', 0, 199, 801, NaN, Infinity, '500']) assert.equal(lineEm(v), 40);
  assert.equal(lineEm(355), 35.5); assert.equal(lineEm(200), 20); assert.equal(lineEm(800), 80);
});
test('저장: 기본(40em)은 지움(null), 0.5em 단위, 20~80em으로 묶음', () => {
  assert.equal(lineStored(null), null); assert.equal(lineStored(40), null); assert.equal(lineStored(40.2), null);
  assert.equal(lineStored(35.3), 355); assert.equal(lineStored(5), 200); assert.equal(lineStored(500), 800);
});
test('끄는 폭은 화면이 쓸 수 있는 폭(room)을 넘지 않되 최소보다 좁아지지 않음', () => {
  assert.equal(clampEm(70, 50), 50); assert.equal(clampEm(70, 10), LINE_MIN_EM); assert.equal(clampEm(10), LINE_MIN_EM); assert.equal(clampEm(90), LINE_MAX_EM);
  assert.equal(clampEm('x'), 40);
});
test('저장 칸 이름·값은 서버 검사(col_widths) 안: 화면 이름·칸 이름 규칙, 40~800 숫자', () => {
  assert.match(LINE_SCREEN, COL_NAME_RE);
  for (const d of ['', 'f', 'p']) assert.match(colKey(LINE_KEY, d), COL_NAME_RE);
  for (const em of [LINE_MIN_EM, 33, 61.5, LINE_MAX_EM]) { const v = lineStored(em); assert.ok(v >= COL_WIDTH_MIN && v <= COL_WIDTH_MAX && Number.isInteger(v)); }
  // PC·폴드 펼침 따로.
  const both = withCol(withCol(null, LINE_KEY, '', 500), LINE_KEY, 'f', 300);
  assert.deepEqual(both, {line: 500, line_f: 300});
  assert.deepEqual(colsFor(both, [LINE_KEY], 'f'), {line: 300});
  assert.deepEqual(colsFor(both, [LINE_KEY], 'p'), {});
});
