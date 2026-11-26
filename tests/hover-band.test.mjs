// S71-48 NOTE-연결점유지(B2): 올리면 나오는 손잡이의 띠 판정(app/hover-band.mjs).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bandOf, reachOf, inside, distTo, pickHover, BAND_PAD, HOVER_LEAVE_MS} from '../app/hover-band.mjs';

const R = (left, top, right, bottom) => ({left, top, right, bottom});
const box = R(100, 100, 200, 130);
// 오른쪽 동그라미: 변 바깥 20~32px.
const dot = R(220, 109, 232, 121);

test('띠 = 상자 + 보이는 손잡이를 덮고 여유를 더함, 안 보이는(크기 0) 손잡이는 뺌', () => {
  assert.deepEqual(bandOf(box, [dot, R(0, 0, 0, 0)]), R(100 - BAND_PAD, 100 - BAND_PAD, 232 + BAND_PAD, 130 + BAND_PAD));
  assert.equal(reachOf(box, bandOf(box, [dot])), 32 + BAND_PAD);
  assert.ok(HOVER_LEAVE_MS > 0 && HOVER_LEAVE_MS <= 300);
});
test('상자와 동그라미 사이 틈 = 그대로 올린 상자, 띠 밖 = 내림', () => {
  const current = {key:'A', rect:box, band:bandOf(box, [dot])};
  assert.equal(pickHover({point:{x:210, y:115}, current}), 'A');
  assert.equal(pickHover({point:{x:226, y:115}, current}), 'A');
  assert.equal(pickHover({point:{x:260, y:115}, current}), null);
  assert.equal(pickHover({point:{x:260, y:115}, current:null}), null);
});
test('커서 바로 아래 상자가 있으면 그것', () => {
  const current = {key:'A', rect:box, band:bandOf(box, [dot])};
  assert.equal(pickHover({point:{x:150, y:115}, direct:'B', current}), 'B');
});
test('띠가 이웃 상자와 겹치면 커서에 가까운 상자', () => {
  const below = R(100, 170, 200, 200), current = {key:'A', rect:box, band:bandOf(box, [R(144, 150, 156, 162)])};
  assert.equal(pickHover({point:{x:110, y:138}, current, others:[{key:'B', rect:below}]}), 'A');
  assert.equal(pickHover({point:{x:110, y:162}, current, others:[{key:'B', rect:below}]}), 'B');
  assert.equal(pickHover({point:{x:110, y:150}, current, others:[{key:'B', rect:below}]}), 'A'); // 같으면 지금 것
  assert.equal(distTo({x:150, y:115}, box), 0);
  assert.ok(inside({x:100, y:100}, box));
});
