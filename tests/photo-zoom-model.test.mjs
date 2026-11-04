import test from 'node:test';
import assert from 'node:assert/strict';
import {stepZoom, canStep, groupMonths, pickReps, yearSampleMonths, stripCount, zoomOf} from '../app/photo-zoom-model.mjs';

test('단계: 일별 칸 수 끝에서 [－]는 월 → 연, [＋]는 그 반대(칸 수가 남으면 칸 수만)', () => {
  assert.deepEqual(stepZoom('day', -1, () => true), {level: 'day', moved: true, cols: true});
  assert.deepEqual(stepZoom('day', -1, () => false), {level: 'month', moved: true});
  assert.deepEqual(stepZoom('month', -1, () => false), {level: 'year', moved: true});
  assert.deepEqual(stepZoom('year', -1, () => false), {level: 'year', moved: false});
  assert.deepEqual(stepZoom('year', 1, () => false), {level: 'month', moved: true});
  assert.deepEqual(stepZoom('month', 1, () => false), {level: 'day', moved: true});
  assert.deepEqual(stepZoom('day', 1, () => false), {level: 'day', moved: false});
  assert.equal(stepZoom('day', 0, () => true).moved, false);
  assert.equal(zoomOf('week'), 'day');
});
test('[－][＋] 누를 수 있는지: 연에서는 [－], 일별 가장 큰 사진에서는 [＋]가 끝', () => {
  assert.equal(canStep('year', -1, true), false);
  assert.equal(canStep('year', 1, false), true);
  assert.equal(canStep('month', -1, false), true);
  assert.equal(canStep('month', 1, false), true);
  assert.equal(canStep('day', -1, false), true);
  assert.equal(canStep('day', 1, false), false);
  assert.equal(canStep('day', 1, true), true);
});
test('줄 사진 수: 월 폰 6·PC 10, 연 폰 2·PC 4', () => {
  assert.deepEqual([stripCount('month', false), stripCount('month', true), stripCount('year', false), stripCount('year', true)], [6, 10, 2, 4]);
});
test('해별 묶음: 최근 해·최근 달 먼저, 장수 0·잘못된 키는 뺀다', () => {
  const g = groupMonths([{key: '2025-03', n: 4}, {key: '2026-08', n: 1}, {key: '2026-10', n: 3}, {key: 'bad', n: 5}, {key: '2024-01', n: 0}, {key: '2026-13', n: 2}]);
  assert.deepEqual(g.map(x => [x.year, x.n]), [[2026, 4], [2025, 4]]);
  assert.deepEqual(g[0].months.map(m => [m.key, m.month]), [['2026-10', 9], ['2026-08', 7]]);
});
test('대표 사진: 별표 먼저, 그다음 이른 날, 사진 없는 날은 뺀다', () => {
  const cells = [{day: 'd1', count: 0, rep: null}, {day: 'd2', count: 2, rep: {id: 'a'}}, {day: 'd3', count: 1, rep: {id: 'b'}}, {day: 'd4', count: 1, rep: {id: 'c'}}];
  assert.deepEqual(pickReps(cells, 2).map(r => r.id), ['a', 'b']);
  assert.deepEqual(pickReps(cells, 2, r => r.id === 'c').map(r => r.id), ['c', 'a']);
  assert.deepEqual(pickReps(cells, 0), []);
  assert.deepEqual(pickReps(null, 3), []);
});
test('연 보기 대표 달: 사진 있는 달을 고르게 뽑는다', () => {
  const months = ['01', '02', '03', '04', '05', '06'].map(m => ({key: `2026-${m}`}));
  assert.deepEqual(yearSampleMonths(months, 2).map(m => m.key), ['2026-01', '2026-06']);
  assert.equal(yearSampleMonths(months, 4).length, 4);
  assert.deepEqual(yearSampleMonths(months.slice(0, 1), 4).map(m => m.key), ['2026-01']);
});
