import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// PHOTO-크게보기정렬(S73-12): 크게 보기 가로 줄의 '보이는 칸' 계산. 칸 폭이 소수(폴드 411.43px)여도 뒤 칸까지 어긋나지 않는다.
const { slideAt } = await import('../app/photo-viewer-model.mjs');

test('소수 칸 폭: 1218번째 칸 자리에서 1217(0부터)을 준다 — 정수 폭으로 나누면 한두 장 어긋남', () => {
  const w = 411.43, left = 1217 * w;
  assert.equal(slideAt(left, w, 7308), 1217);
  assert.notEqual(Math.round(left / 411), 1217, '예전 계산(정수 clientWidth)은 어긋난다');
  for (const i of [0, 1, 11, 12, 119, 120, 3000, 7307]) assert.equal(slideAt(i * w + 0.6, w, 7308), i);
});
test('칸 수 밖·잘못된 값은 범위 안으로', () => {
  assert.equal(slideAt(-50, 400, 10), 0);
  assert.equal(slideAt(1e9, 400, 10), 9);
  assert.equal(slideAt(100, 0, 10), 0);
  assert.equal(slideAt(100, 400, 0), 0);
  assert.equal(slideAt(Number.NaN, 400, 10), 0);
});
test('크게 보기는 칸 자리를 정수 clientWidth × 번호로 잡지 않는다', () => {
  const src = readFileSync(new URL('../app/photo-strip.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\*\s*strip\.clientWidth|strip\.clientWidth\s*\*|scrollLeft\s*\/\s*Math\.max\(1,\s*strip\.clientWidth\)/);
  assert.match(src, /slideAt\(strip\.scrollLeft/);
});
