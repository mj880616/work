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
// S70-10 UI-끌기자동스크롤: 'n개 더 보기'로 접힌 목록 — 아래 가장자리에서 더 굴러갈 칸이 없으면 그 칸 안 '더 보기' 단추를 찾는다(화면 없이 가짜 칸으로).
test('아래 가장자리 · 칸 안에 보이는 \'더 보기\'만 고른다', async () => {
  const {moreVisible, moreAtEdge, MORE_DWELL, MORE_SEL} = await import('../app/drag-edge-scroll.js');
  assert.ok(MORE_DWELL >= 300 && MORE_DWELL <= 1000);
  assert.match(MORE_SEL, /ft-more-row/);
  const box = {top: 0, bottom: 800};
  const r = (top, left = 0, right = 400) => ({top, bottom: top + 30, left, right, height: 30});
  assert.equal(moreVisible(r(760), box, 100), true);
  assert.equal(moreVisible(r(820), box, 100), false, '칸 밖(아래)');
  assert.equal(moreVisible(r(760), box, 500), false, '포인터가 그 줄 폭 밖(다른 칸)');
  assert.equal(moreVisible({...r(760), height: 0}, box, 100), false, '숨은 단추');
  const btn = (top, extra = {}) => ({...extra, parentElement: null, getBoundingClientRect: () => r(top)});
  const near = btn(760), far = btn(1200), off = btn(700, {disabled: true});
  const doc = {scrollingElement: {}, querySelectorAll: () => [off, far, near]};
  const page = {node: doc.scrollingElement, top: 0, bottom: 800};
  assert.equal(moreAtEdge([page], 100, 790, doc), near, '아래 가장자리 → 보이는 단추');
  assert.equal(moreAtEdge([page], 100, 400, doc), null, '가운데 → 없음');
  assert.equal(moreAtEdge([page], 100, 10, doc), null, '위 가장자리 → 없음');
  const pane = {node: {nodeType: 1, querySelectorAll: () => []}, top: 100, bottom: 600};
  assert.equal(moreAtEdge([pane, page], 100, 590, doc), null, '칸 아래 가장자리지만 그 칸 안에 단추 없음, 화면 가장자리 밖');
});
test('손가락 끌기: 누른 칸이 빠진 동안만 그 칸에서 받고, 떼면 받지 않는다(followTouch)', async () => {
  const {followTouch} = await import('../app/drag-edge-scroll.js');
  const on = {};
  const t = {isConnected: true, addEventListener: (k, f) => { on[k] = f; }, removeEventListener: k => { delete on[k]; }};
  const got = [];
  const off = followTouch(t, {move: () => got.push('move'), end: () => got.push('end'), cancel: () => got.push('cancel')});
  on.touchmove({}); assert.deepEqual(got, [], '붙어 있으면 받는 곳이 받는다');
  t.isConnected = false; on.touchmove({}); on.touchend({}); assert.deepEqual(got, ['move', 'end']);
  off(); assert.deepEqual(Object.keys(on), []);
  assert.equal(typeof followTouch(null), 'function');
});
