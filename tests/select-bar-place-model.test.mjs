// S70-16 UI-고른글메뉴: '선택한 글' 막대 자리 고르기(순수 계산) — 고른 글과 앞뒤 한 줄을 가리지 않는 곳.
// S70-80 READ-형광펜안됨: 옛 '글 칸 옆 여백' 자리(두 칸 보기에서 목록 칸 위에 뜸)를 없애고 고른 글 바로 위·아래만 쓴다. 가로는 글 칸 안.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pickBarSpot, overlaps} from '../app/select-bar-place-model.mjs';

const view = {w: 1280, h: 800}, bar = {w: 360, h: 34}, line = 22;
const rect = ({left, top, w, h}) => ({left, top, right: left + w, bottom: top + h});
const barRect = spot => rect({left: spot.left, top: spot.top, w: bar.w, h: bar.h});
const grown = sel => ({...sel, top: sel.top - line, bottom: sel.bottom + line});

test('two-pane: the bar sits right above the selection inside the text column — never over the list pane on the left', () => {
  // 두 칸 보기: 왼쪽 목록 칸(0~420) + 오른쪽 글 칸(440~1260). 옛 계산은 글 칸 왼쪽 '여백'(= 목록 칸)에 띄웠다.
  const col = rect({left: 440, top: 80, w: 820, h: 700}), sel = rect({left: 460, top: 300, w: 500, h: 44});
  const s = pickBarSpot({sel, col, bar, view, line});
  assert.equal(s.side, 'top');
  assert.equal(s.top, sel.top - line - bar.h);
  assert.equal(s.left, sel.left);
  assert.ok(s.left >= col.left && s.left + bar.w <= col.right);
  assert.equal(overlaps(barRect(s), grown(sel)), false);
});

test('wide margins beside a narrow column are not used any more: still above the selection', () => {
  const col = rect({left: 300, top: 80, w: 560, h: 700}), sel = rect({left: 320, top: 300, w: 500, h: 60});
  const s = pickBarSpot({sel, col, bar, view, line});
  assert.equal(s.side, 'top');
  assert.ok(s.left >= col.left && s.left + bar.w <= col.right);
});

test('above with one free line, else below with one free line — never over the text or the next line', () => {
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

test('phone order: below first (room for the selection handles), else above', () => {
  const pv = {w: 390, h: 760}, pb = {w: 374, h: 64}, col = rect({left: 16, top: 0, w: 358, h: 2000});
  const sel = rect({left: 40, top: 300, w: 200, h: 22});
  const down = pickBarSpot({sel, col, bar: pb, view: pv, line, order: 'below', handle: 24});
  assert.equal(down.side, 'bottom');
  assert.equal(down.top, sel.bottom + line + 24);
  assert.equal(down.left, 8); // 막대가 글 칸보다 넓으면 화면 안(8px)
  const low = rect({left: 40, top: 680, w: 200, h: 22});
  const up = pickBarSpot({sel: low, col, bar: pb, view: pv, line, order: 'below', handle: 24});
  assert.equal(up.side, 'top');
  assert.equal(up.top, low.top - line - pb.h);
});

test('no room anywhere or selection off screen → null (caller docks at the bottom)', () => {
  const col = rect({left: 8, top: 0, w: 1264, h: 800});
  assert.equal(pickBarSpot({sel: rect({left: 20, top: 20, w: 1000, h: 760}), col, bar, view, line}), null);
  assert.equal(pickBarSpot({sel: rect({left: 20, top: 900, w: 100, h: 20}), col, bar, view, line}), null);
  assert.equal(pickBarSpot({sel: null, col, bar, view, line}), null);
  assert.equal(pickBarSpot({sel: rect({left: 20, top: 20, w: 100, h: 20}), col, bar: {w: 0, h: 0}, view, line}), null);
});

test('left edge is kept inside the column (and the window) above/below', () => {
  const col = rect({left: 0, top: 0, w: 1280, h: 800}), sel = rect({left: 1200, top: 300, w: 60, h: 22});
  const s = pickBarSpot({sel, col, bar, view, line});
  assert.equal(s.side, 'top');
  assert.equal(s.left, view.w - 8 - bar.w);
  const col2 = rect({left: 440, top: 0, w: 600, h: 800}), sel2 = rect({left: 1000, top: 300, w: 30, h: 22});
  assert.equal(pickBarSpot({sel: sel2, col: col2, bar, view, line}).left, col2.right - bar.w);
});
