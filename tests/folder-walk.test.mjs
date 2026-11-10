// FILES-폰폴더위로(요청함 11/06 01:10): 폰 '그 폴더만' 한 단계 위 규칙(app/folder-walk.mjs)과 화면 왼쪽 끝 밀기 판정(app/edge-back-swipe.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {walkTo, walkUp, walkUpLabel} from '../app/folder-walk.mjs';
import {edgeBackStep, EDGE_START, EDGE_MIN} from '../app/edge-back-swipe.js';

test('길: 들어온 폴더부터 하위 폴더를 눌러 내려온 만큼만 한 단계씩 나온다', () => {
  let w = walkTo([], 'od:A');
  assert.deepEqual(w, ['od:A']);
  w = walkTo(w, 'od:B', {down: true});
  w = walkTo(w, 'od:C', {down: true});
  assert.deepEqual(w, ['od:A', 'od:B', 'od:C']);
  assert.equal(walkUpLabel(w), '위 폴더');
  let u = walkUp(w);
  assert.deepEqual(u, {to: 'od:B', walk: ['od:A', 'od:B']});
  // 위 폴더로 가면 길이 거기까지 줄어든다(같은 폴더를 다시 그려도 그대로).
  w = walkTo(w, u.to);
  assert.deepEqual(w, ['od:A', 'od:B']);
  assert.deepEqual(walkTo(w, 'od:B'), ['od:A', 'od:B']);
  u = walkUp(walkUp(w).walk);
  assert.deepEqual(u, {to: null, walk: []});
  assert.equal(walkUpLabel(['od:A']), '폴더 나무');
});

test('길: 위치 줄로 고른 단계 · 길 밖 폴더 · 비우기', () => {
  const w = ['od:A', 'od:B', 'od:C'];
  assert.deepEqual(walkTo(w, 'od:A'), ['od:A']);
  // 길 처음보다 위(저장소 맨 위 등)를 고르면 그 폴더가 새 길 처음(거기서 ‹ = 나무).
  assert.deepEqual(walkTo(w, 'od:'), ['od:']);
  // 내려온 것이 아니면(다른 곳으로 바로 감) 새 길.
  assert.deepEqual(walkTo(w, 'gd:X'), ['gd:X']);
  assert.deepEqual(walkTo([], 'od:B', {down: true}), ['od:B']);
  assert.deepEqual(walkTo(w, ''), []);
  assert.deepEqual(walkTo(null, 'od:A'), ['od:A']);
  assert.deepEqual(walkUp(null), {to: null, walk: []});
});

test('왼쪽 끝 밀기: 끝에서 시작해 오른쪽으로 충분히 민 것만', () => {
  const s = {x: 4, y: 300};
  assert.equal(edgeBackStep(s, {x: 4 + EDGE_MIN, y: 300}), 'back');
  assert.equal(edgeBackStep(s, {x: 40, y: 302}), null);
  // 끝이 아닌 곳에서 시작
  assert.equal(edgeBackStep({x: EDGE_START + 1, y: 300}, {x: 200, y: 300}), 'cancel');
  // 세로 굴리기·왼쪽으로 밀기·비스듬히 많이
  assert.equal(edgeBackStep(s, {x: 20, y: 380}), 'cancel');
  assert.equal(edgeBackStep({x: 20, y: 300}, {x: 0, y: 300}), 'cancel');
  assert.equal(edgeBackStep(s, {x: 90, y: 360}), null);
  assert.equal(edgeBackStep(s, {x: NaN, y: 1}), 'cancel');
});
