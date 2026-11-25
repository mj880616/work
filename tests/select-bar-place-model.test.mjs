// S70-16 UI-고른글메뉴: '선택한 글' 막대 자리 고르기(순수 계산) — 고른 글과 앞뒤 한 줄을 가리지 않는 곳.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pickBarSpot, overlaps} from '../app/select-bar-place-model.mjs';

const view = {w: 1280, h: 800}, bar = {w: 360, h: 34}, line = 22;
const rect = ({left, top, w, h}) => ({left, top, right: left + w, bottom: top + h});
const barRect = spot => rect({left: spot.left, top: spot.top, w: bar.w, h: bar.h});
const grown = sel => ({...sel, top: sel.top - line, bottom: sel.bottom + line});

test('wide margin beside the text column: right first, then left', () => {
  const col = rect({left: 300, top: 80, w: 560, h: 700}), sel = rect({left: 320, top: 300, w: 500, h: 60});
  const right = pickBarSpot({sel, col, bar, view, line});
  assert.equal(right.side, 'right');
  assert.equal(right.left, col.right + 8);
  assert.equal(right.top, sel.top);
  assert.equal(overlaps(barRect(right), col), false);
  const leftCol = rect({left: 420, top: 80, w: 800, h: 700}), sel2 = rect({left: 430, top: 300, w: 700, h: 60});
  const left = pickBarSpot({sel: sel2, col: leftCol, bar, view, line});
  assert.equal(left.side, 'left');
  assert.equal(left.left + bar.w, leftCol.left - 8);
});

test('no margin: above with one free line, else below with one free line — never over the text or the next line', () => {
  const col = rect({left: 8, top: 0, w: 1264, h: 800});
  const mid = rect({left: 100, top: 300, w: 900, h: 66});
  const up = pickBarSpot({sel: mid, col, bar, view, line});
  assert.equal(up.side, 'top');
  assert.equal(up.top, mid.top - line - bar.h);
  assert.equal(overlaps(barRect(up), grown(mid)), false);
  const nearTop = rect({left: 100, top: 30, w: 900, h: 66});
  const down = pickBarSpot({sel: nearTop, col, bar, view, line});
  assert.equal(down.side, 'bottom');
  assert.equal(down.top, nearTop.bottom + line);
  assert.equal(overlaps(barRect(down), grown(nearTop)), false);
});

test('side spot stays inside the window when the selection starts above the top', () => {
  const col = rect({left: 300, top: -400, w: 560, h: 1400}), sel = rect({left: 320, top: -200, w: 500, h: 400});
  const s = pickBarSpot({sel, col, bar, view, line});
  assert.equal(s.side, 'right');
  assert.equal(s.top, 8);
});

test('no room anywhere or selection off screen → null (caller docks at the bottom)', () => {
  const col = rect({left: 8, top: 0, w: 1264, h: 800});
  assert.equal(pickBarSpot({sel: rect({left: 20, top: 20, w: 1000, h: 760}), col, bar, view, line}), null);
  assert.equal(pickBarSpot({sel: rect({left: 20, top: 900, w: 100, h: 20}), col, bar, view, line}), null);
  assert.equal(pickBarSpot({sel: null, col, bar, view, line}), null);
  assert.equal(pickBarSpot({sel: rect({left: 20, top: 20, w: 100, h: 20}), col, bar: {w: 0, h: 0}, view, line}), null);
});

test('left edge is kept inside the window above/below', () => {
  const col = rect({left: 0, top: 0, w: 1280, h: 800}), sel = rect({left: 1200, top: 300, w: 60, h: 22});
  const s = pickBarSpot({sel, col, bar, view, line});
  assert.equal(s.side, 'top');
  assert.equal(s.left, view.w - 8 - bar.w);
});
