// S71-52 ② NOTE-큰생각지도 보기 계산(app/note-board-view-model.mjs): 멀리 보기 단계, 미니맵 자리, 이 가지만 보기, 찾은 주제로 갈 때 펼 윗가지.
import test from 'node:test';
import assert from 'node:assert/strict';
import { farOf, FAR_Z, miniLayout, fromMini, toMini, focusIds, ancestorsOf } from '../app/note-board-view-model.mjs';
import { nodeShape, buildTree } from '../app/note-board-mindmap-model.mjs';

test('멀리 보기: FAR_Z 아래에서만 켜지고, 큰 가지 글자는 화면에서 읽히게 키운다(계단마다 한 값, 상한 12배)', () => {
  assert.deepEqual(farOf(1), {on:false, step:null, scale:1});
  assert.equal(farOf(FAR_Z).on, false);
  const a = farOf(0.3), b = farOf(0.302), c = farOf(0.1);
  assert.equal(a.on, true); assert.equal(a.step, b.step); assert.equal(a.scale, b.scale);
  assert.ok(c.scale > a.scale); assert.ok(farOf(0.001).scale <= 12);
  assert.ok(Math.abs(14 * a.scale * 0.3 - 13) < 3, '화면 글자 약 13px');
});

test('미니맵: 모든 칸을 감싼 범위를 같은 비율로 가운데 맞춤, 오가는 좌표가 맞는다(음수 좌표도)', () => {
  assert.equal(miniLayout([], 160, 100), null);
  const m = miniLayout([{x:-1000, y:-500, w:100, h:50}, {x:900, y:400, w:100, h:100}], 168, 112, 6);
  const tl = toMini(m, {x:-1000, y:-500, w:0, h:0}), br = toMini(m, {x:1000, y:500, w:0, h:0});
  assert.ok(tl.x >= 0 && tl.y >= 0 && br.x <= 168 && br.y <= 112);
  assert.ok(Math.abs(br.x - tl.x - 2000 * m.s) < 1e-6);
  const back = fromMini(m, br.x, br.y); assert.ok(Math.abs(back.x - 1000) < 1e-6 && Math.abs(back.y - 500) < 1e-6);
});

test('이 가지만 보기 = 그 칸과 아래 전부, 찾은 주제로 갈 때 윗가지(가까운 것부터)', () => {
  const n = (id, parent = null) => nodeShape({id, board_id:'b1234567', body:id, x:0, y:0}, {parent_id:parent});
  const tree = buildTree([n('r'), n('a', 'r'), n('a1', 'a'), n('a2', 'a'), n('b', 'r'), n('z')]);
  assert.deepEqual([...focusIds(tree, 'a')].sort(), ['a', 'a1', 'a2']);
  assert.deepEqual(ancestorsOf(tree, 'a2'), ['a', 'r']);
  assert.deepEqual(ancestorsOf(tree, 'z'), []);
});
