import test from 'node:test';
import assert from 'node:assert/strict';
import {scaleWidths, cleanDoc, widthsOfRow, tableLayout, LIMITS} from '../app/ed-schema.mjs';
// ED-표크기끌기: 표 크기 = 칸 폭(colwidth) 합. 모서리 끌기는 모든 칸에 같은 배율을 곱한다.
const sum = l => l.reduce((a, b) => a + b, 0);
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('scaling keeps the shares of the columns', () => {
  const r = scaleWidths([100, 200, 300], 900, {min: 32, max: 1000});
  assert.equal(r.total, sum(r.widths));
  assert.deepEqual(r.widths, [150, 300, 450]);
  const s = scaleWidths([120, 80, 200], 300, {min: 32, max: 1000});
  near(s.total, 300, 2);
  near(s.widths[0] / s.total, 0.3, 0.01); near(s.widths[1] / s.total, 0.2, 0.01); near(s.widths[2] / s.total, 0.5, 0.01);
});
test('the table never gets wider than the maximum (the editor width)', () => {
  const r = scaleWidths([200, 200], 5000, {min: 32, max: 600});
  assert.equal(r.total, 600); assert.deepEqual(r.widths, [300, 300]);
});
test('every column keeps at least the minimum, the table at least columns x minimum', () => {
  const r = scaleWidths([400, 40, 400], 10, {min: 32, max: 1000});
  assert.ok(r.widths.every(w => w >= 32));
  assert.equal(r.total, sum(r.widths));
  assert.ok(r.total >= 96);
  const small = scaleWidths([400, 20, 400], 150, {min: 32, max: 1000});
  assert.ok(small.widths.every(w => w >= 32));
  near(small.total, 150, 2);
  assert.ok(small.widths[0] > small.widths[1]);
});
test('a column without a width takes the minimum, bad targets keep the size', () => {
  assert.deepEqual(scaleWidths([0, 100], 132, {min: 32, max: 1000}).widths, [32, 100]);
  assert.equal(scaleWidths([100, 100], NaN, {min: 32, max: 1000}).total, 200);
  assert.deepEqual(scaleWidths([], 100, {}), {widths: [], total: 0});
});
test('a column stays under the saved limit', () => {
  const r = scaleWidths([1000, 1000], 100000, {min: 32, max: 100000});
  assert.ok(r.widths.every(w => w <= LIMITS.colWidth));
});
test('saved colwidth round trip: scaled widths survive cleanDoc and give the same layout for every reader', () => {
  const r = scaleWidths([100, 200, 300], 450, {min: 32, max: 1000});
  const cell = (t, i) => ({type: 'table_cell', attrs: {colspan: 1, rowspan: 1, colwidth: [r.widths[i]]}, content: [{type: 'paragraph', attrs: {style: 'body2'}, content: [{type: 'text', text: t}]}]});
  const row = () => ({type: 'table_row', content: [cell('a', 0), cell('b', 1), cell('c', 2)]});
  const saved = {v: 'ed1', doc: {type: 'doc', content: [{type: 'table', content: [row(), row()]}]}};
  const clean = cleanDoc(saved);
  const first = clean.doc.content[0].content[0].content.map(c => c.attrs);
  assert.deepEqual(widthsOfRow(first), r.widths);
  assert.equal(tableLayout(widthsOfRow(first)).width, r.total);
  // Dragging twice (grow then back) returns to the first sizes within rounding.
  const back = scaleWidths(r.widths, 600, {min: 32, max: 1000});
  const again = scaleWidths(back.widths, 450, {min: 32, max: 1000});
  again.widths.forEach((w, i) => near(w, r.widths[i], 2));
});
