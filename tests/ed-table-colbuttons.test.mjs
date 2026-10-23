import test from 'node:test';
import assert from 'node:assert/strict';
import {stepWidths, evenWidths} from '../app/ed-schema.mjs';
// ED-폰표칸버튼: 표 메뉴 [넓게][좁게][고르게]의 계산(칸 폭 colwidth 목록).
const sum = l => l.reduce((a, b) => a + b, 0);
const B = {min: 32, room: 600};

test('넓게: 자리가 남으면 그 열만 20px 늘고 다른 열은 그대로', () => {
  assert.deepEqual(stepWidths([100, 100, 100], 0, 20, B), [120, 100, 100]);
});
test('넓게: 표가 꽉 차 있으면 가장 넓은 다른 열에서 가져온다(전체 폭 유지)', () => {
  const r = stepWidths([300, 200, 100], 2, 20, B);
  assert.deepEqual(r, [280, 200, 120]);
  assert.equal(sum(r), 600);
});
test('넓게: 가져올 열이 최소 폭이면 더 넓어지지 않는다', () => {
  assert.deepEqual(stepWidths([100, 32], 0, 20, {min: 32, room: 132}), [100, 32]);
  assert.deepEqual(stepWidths([110, 40], 0, 20, {min: 32, room: 150}), [118, 32]);
});
test('좁게: 20px씩 줄고 최소 폭에서 멈춘다', () => {
  assert.deepEqual(stepWidths([100, 100], 1, -20, B), [100, 80]);
  assert.deepEqual(stepWidths([40, 100], 0, -20, B), [32, 100]);
  assert.deepEqual(stepWidths([32, 100], 0, -20, B), [32, 100]);
});
test('고르게: 전체 폭은 그대로 모든 열이 같은 폭', () => {
  const r = evenWidths([100, 50, 200], 32);
  assert.equal(sum(r), 350);
  assert.ok(Math.max(...r) - Math.min(...r) <= 2);
  assert.deepEqual(evenWidths([300, 100], 32), [200, 200]);
  assert.ok(evenWidths([10, 10, 10], 32).every(w => w >= 32));
});
