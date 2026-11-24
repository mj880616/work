import {test} from 'node:test';
import assert from 'node:assert/strict';
import {edgeSpeed, canScroll, pickScroll, EDGE, EDGE_MAX} from '../app/drag-edge-scroll.js';
import {edgeSpeed as touchEdgeSpeed, EDGE as TOUCH_EDGE} from '../app/touch-drag.js';
import {EDGE as REORDER_EDGE} from '../app/reorder-drag.js';
// S69-15 UI-끌기가장자리스크롤: 끄는 동안 저절로 굴리기 계산(화면 없이). 모든 끌기가 이 하나를 쓴다.
test('가장자리 안이면 그쪽으로, 가까울수록 빠르게 · 가운데·작은 칸은 0', () => {
  assert.equal(EDGE, 48);
  assert.equal(edgeSpeed(400, 0, 800), 0);
  assert.ok(edgeSpeed(1, 0, 800) < 0 && edgeSpeed(799, 0, 800) > 0);
  assert.equal(edgeSpeed(0, 0, 800), -EDGE_MAX);
  assert.ok(Math.abs(edgeSpeed(EDGE - 2, 0, 800)) < Math.abs(edgeSpeed(4, 0, 800)));
  assert.equal(edgeSpeed(EDGE + 1, 0, 800), 0);
  assert.equal(edgeSpeed(50, 0, 80), 0);
  assert.equal(edgeSpeed(undefined, 0, 800), 0);
});
test('손가락·포인터 끌기 부품도 같은 계산을 쓴다', () => {
  assert.equal(touchEdgeSpeed, edgeSpeed);
  assert.equal(TOUCH_EDGE, EDGE);
  assert.equal(REORDER_EDGE, EDGE);
});
test('끝까지 구른 칸은 건너뛰고 바깥 칸(끝은 화면)을 굴린다', () => {
  const pane = {name: 'pane', top: 100, bottom: 600, scrollTop: 0, scrollHeight: 2000, clientHeight: 500};
  const page = {name: 'page', top: 0, bottom: 800, scrollTop: 0, scrollHeight: 3000, clientHeight: 800};
  assert.equal(pickScroll([pane, page], 590).box.name, 'pane', '칸 아래 가장자리 = 그 칸');
  assert.ok(pickScroll([pane, page], 590).v > 0);
  assert.equal(pickScroll([pane, page], 110), null, '칸 맨 위에서 위로는 못 구르고 화면도 맨 위');
  assert.equal(pickScroll([{...pane, scrollTop: 1500}, page], 590), null, '칸 끝 · 화면 가장자리 밖');
  assert.equal(pickScroll([{...pane, scrollTop: 1500}, page], 790).box.name, 'page', '칸 끝이면 화면 가장자리에서 화면');
  assert.equal(pickScroll([pane, page], 350), null);
  assert.equal(canScroll(pane, -1), false);
  assert.equal(canScroll(pane, 1), true);
  assert.equal(canScroll({...pane, scrollTop: 1500}, 1), false);
});
