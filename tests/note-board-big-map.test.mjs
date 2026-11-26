// S71-52 NOTE-큰생각지도(사용자 2026-11-26 "굉장히 광범위한 생각지도 … 무한정 뻗어나가는"): 판 좌표 범위(음수 포함)와
// 주제 1,000개 나무 계산 시간 상한(화면 없이 — 보드 열 때·가지째 끌기 뒤 다시 배치하는 계산).
import test from 'node:test';
import assert from 'node:assert/strict';
import { COORD_LIMIT, clampCoord, okCoord } from '../app/note-board-coord.mjs';
import { placeShape, clampPos } from '../app/note-board-model.mjs';
import { parseText, parseLink } from '../app/note-board-links-model.mjs';
import { nodeShape, buildTree, layoutMindmap, descendants } from '../app/note-board-mindmap-model.mjs';

test('판 좌표: 어느 방향으로나 ±1,000,000까지(서버 check와 같음), 넘으면 끝으로, 숫자가 아니면 0', () => {
  assert.equal(COORD_LIMIT, 1000000);
  assert.equal(clampCoord(-123.6), -124); assert.equal(clampCoord(5e6), COORD_LIMIT); assert.equal(clampCoord(-5e6), -COORD_LIMIT); assert.equal(clampCoord(NaN), 0);
  assert.ok(okCoord(-1000000) && okCoord(1000000) && !okCoord(1000001) && !okCoord('1'));
  assert.deepEqual(placeShape({x:-5000, y:-20, r:0, z:0}), {x:-5000, y:-20, r:0, z:0}, '노트 카드도 왼쪽·위 바깥에');
  assert.equal(placeShape({x:0, y:-1000001, r:0, z:0}), null);
  assert.equal(clampPos(-40), -40);
  assert.deepEqual(parseText({id:'t', board_id:'b1234567', body:'멀리', x:-250000, y:900000}), {id:'t', board_id:'b1234567', body:'멀리', x:-250000, y:900000});
  const l = parseLink({id:'l', board_id:'b1234567', from_x:-10, from_y:-20, to_x:30, to_y:40});
  assert.deepEqual([l.from_x, l.from_y, l.to_x, l.to_y], [-10, -20, 30, 40]);
});

// 뿌리 8개 · 넓게 퍼진 4단계 가지 1,000개(tests/app-e2e/helpers/big-board-seed.mjs와 같은 모양).
function bigTree(total = 1000) {
  const rows = [], queue = [], fan = [6, 5, 4, 3];
  const add = (parent, depth, ord, x = 0, y = 0) => { const t = nodeShape({id:`n${rows.length}`, board_id:'b1234567', body:`주제 ${rows.length}`, x, y}, {parent_id:parent?.id ?? null, ord}); t.depth = depth; rows.push(t); return t; };
  for (let i = 0; i < 8; i++) queue.push(add(null, 0, 0, (i % 4) * 5000 - 8000, Math.floor(i / 4) * 5000 - 3000));
  while (queue.length && rows.length < total) { const p = queue.shift(); for (let i = 0; i < (fan[p.depth] || 0) && rows.length < total; i++) queue.push(add(p, p.depth + 1, i)); }
  return rows;
}

test('주제 1,000개: 나무 만들기 + 자동 배치가 넉넉한 상한(300ms) 안, 모두 자리', () => {
  const rows = bigTree();
  assert.equal(rows.length, 1000);
  const t0 = performance.now();
  const tree = buildTree(rows);
  const lay = layoutMindmap(tree, () => ({w:96, h:26}));
  const ms = performance.now() - t0;
  assert.equal(lay.rects.size, 1000);
  assert.ok(ms < 300, `나무 계산 ${Math.round(ms)}ms`);
  assert.equal(descendants(tree, 'n0').length > 100, true);
  assert.ok([...lay.rects.values()].some(r => r.x < 0 && r.y < 0), '음수 쪽 뿌리 둘레에도 배치');
});
