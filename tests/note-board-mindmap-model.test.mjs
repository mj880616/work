// S69-82 노트 보드 생각 지도 계산(app/note-board-mindmap-model.mjs): 옛 글 상자 읽기, 나무·고리 끊기, 자동 배치(양쪽·겹침 없음·접기),
// 놓을 곳·가까운 상자, 형제 순서 끼우기, 키보드 길 찾기, 가지 선.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeShape, buildTree, descendants, canAttach, rootOf, depthOf, layoutMindmap, branchPath, branchTone, dropTarget, nearestRect, ordAt,
  neighbor, lighterSide, stepFont, boundsOf, NODE_COLORS, FONT_MAX, ORD_STEP } from '../app/note-board-mindmap-model.mjs';

const base = (id, x = 0, y = 0) => ({id, board_id:'all', body:id, x, y});
const n = (id, parent = null, ord = 0, extra = {}) => nodeShape(base(id, extra.x ?? 0, extra.y ?? 0), {parent_id:parent, ord, ...extra});
const size = () => ({w:80, h:24});

test('옛 글 상자(새 칸 없음)는 혼자 선 기본 주제 상자로 읽힌다, 범위 밖 값은 기본값', () => {
  assert.deepEqual(nodeShape(base('a', 5, 6)), {id:'a', board_id:'all', body:'a', x:5, y:6, z:0, stroke:null, stroke_w:null, dash:false, alpha:null, bold:false, align:null, ink:null, parent_id:null, parent_card:false, ord:0, side:null, kind:'topic', color:null, shape:'round', font:2, w:null, h:null, collapsed:false, pinned:false});
  const odd = nodeShape(base('a'), {parent_id:'a', ord:-3, side:0, kind:'x', color:10, shape:'star', font:7, w:20, collapsed:'yes'});
  assert.equal(odd.parent_id, null); assert.equal(odd.ord, 0); assert.equal(odd.side, null); assert.equal(odd.kind, 'topic');
  assert.equal(odd.color, null); assert.equal(odd.shape, 'round'); assert.equal(odd.font, 2); assert.equal(odd.w, null); assert.equal(odd.collapsed, false);
  assert.deepEqual(nodeShape(base('a'), {parent_id:'p', ord:5, side:-1, kind:'sticky', color:7, shape:'pill', font:4, w:300, collapsed:true}),
    {...base('a'), z:0, stroke:null, stroke_w:null, dash:false, alpha:null, bold:false, align:null, ink:null, parent_id:'p', parent_card:false, ord:5, side:-1, kind:'sticky', color:7, shape:'pill', font:4, w:300, h:null, collapsed:true, pinned:false});
  assert.equal(nodeShape(null), null);
  assert.equal(NODE_COLORS.length, 8);
});

test('나무: 형제 순서, 없는 부모·고리는 뿌리, 아래 전부·옮겨 붙일 수 있나', () => {
  const t = buildTree([n('r'), n('b', 'r', 2), n('a', 'r', 1), n('a1', 'a'), n('x', 'gone'), n('c1', 'c2'), n('c2', 'c1')]);
  assert.deepEqual(t.kids.get('r').map(k => k.id), ['a', 'b']);
  assert.ok(t.roots.some(k => k.id === 'x'));
  assert.ok(t.roots.some(k => k.id === 'c1' || k.id === 'c2')); // 고리 하나는 끊긴다
  assert.deepEqual(descendants(t, 'r'), ['a', 'a1', 'b']);
  assert.equal(rootOf(t, 'a1'), 'r'); assert.equal(depthOf(t, 'a1'), 2);
  assert.equal(canAttach(t, 'a', 'b'), true);
  assert.equal(canAttach(t, 'a', 'a1'), false); // 자기 아래로는 못 붙음
  assert.equal(canAttach(t, 'a', 'a'), false);
  assert.equal(canAttach(t, 'a', 'nope'), false);
});

test('자동 배치: 뿌리 자리 기준, 양쪽 펼침, 형제가 겹치지 않음, 부모 가운데 높이, 접으면 아래가 숨음', () => {
  const nodes = [n('r', null, 0, {x:1000, y:500}), n('a', 'r', 0), n('b', 'r', 1), n('c', 'r', 2), n('a1', 'a', 0), n('a2', 'a', 1)];
  const {rects, hidden} = layoutMindmap(buildTree(nodes), size);
  const r = rects.get('r');
  assert.deepEqual([r.x, r.y], [1000, 500]);
  const sides = ['a', 'b', 'c'].map(id => rects.get(id).side);
  assert.ok(sides.includes(1) && sides.includes(-1)); // 양쪽
  for (const id of ['a', 'b', 'c']) { const k = rects.get(id); if (k.side === 1) assert.ok(k.x >= r.x + r.w); else assert.ok(k.x + k.w <= r.x); }
  // 같은 쪽 상자끼리 겹치지 않는다.
  const all = [...rects.values()];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const p = all[i], q = all[j], meet = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
    assert.equal(meet, false, `${i}-${j}`);
  }
  // a의 두 가지 가운데 = a 가운데.
  const a = rects.get('a'), a1 = rects.get('a1'), a2 = rects.get('a2');
  assert.equal(Math.round((a1.y + a2.y + a2.h) / 2), Math.round(a.y + a.h / 2));
  assert.equal(a1.side, a.side); assert.equal(hidden.size, 0);
  // 접기.
  const folded = layoutMindmap(buildTree(nodes.map(x => (x.id === 'a' ? {...x, collapsed:true} : x))), size);
  assert.equal(folded.rects.has('a1'), false); assert.deepEqual([...folded.hidden].sort(), ['a1', 'a2']);
  // 저장한 쪽을 따른다.
  const left = layoutMindmap(buildTree([n('r', null, 0, {x:500, y:0}), n('a', 'r', 0, {side:-1}), n('b', 'r', 1, {side:-1})]), size);
  assert.equal(left.rects.get('a').side, -1); assert.equal(left.rects.get('b').side, -1);
  assert.equal(lighterSide(buildTree([n('r'), n('a', 'r', 0, {side:-1})]), 'r', size), 1);
  assert.equal(lighterSide(buildTree([n('r'), n('a', 'r', 0, {side:1})]), 'r', size), -1);
});

test('가지 선·색: 오른쪽은 부모 오른 변 → 가지 왼 변, 색은 자기 → 위 → 뿌리 가지 순서', () => {
  assert.equal(branchPath({x:0, y:0, w:100, h:20}, {x:150, y:40, w:80, h:20}, 1), 'M100 10C125 10 125 50 150 50');
  assert.equal(branchPath({x:200, y:0, w:100, h:20}, {x:50, y:0, w:80, h:20}, -1), 'M200 10C165 10 165 10 130 10');
  const t = buildTree([n('r'), n('a', 'r', 0), n('b', 'r', 1, {color:5}), n('b1', 'b'), n('a1', 'a', 0)]);
  assert.equal(branchTone(t, 'a'), 0); assert.equal(branchTone(t, 'a1'), 0);
  assert.equal(branchTone(t, 'b'), 5); assert.equal(branchTone(t, 'b1'), 5);
  assert.equal(branchTone(t, 'r'), null);
});

test('놓을 곳: 위 1/4 앞·아래 1/4 뒤·가운데 아래로, 뿌리는 늘 아래로, 고른 가지 빼기 · 가까운 상자 붙이기', () => {
  const rects = new Map([['r', {x:0, y:0, w:100, h:40}], ['a', {x:200, y:0, w:100, h:40}]]);
  assert.deepEqual(dropTarget(rects, {x:250, y:4}), {id:'a', zone:'before'});
  assert.deepEqual(dropTarget(rects, {x:250, y:36}), {id:'a', zone:'after'});
  assert.deepEqual(dropTarget(rects, {x:250, y:20}), {id:'a', zone:'in'});
  assert.deepEqual(dropTarget(rects, {x:50, y:2}, new Set(), id => id === 'r'), {id:'r', zone:'in'});
  assert.equal(dropTarget(rects, {x:250, y:20}, new Set(['a'])), null);
  assert.equal(dropTarget(rects, {x:150, y:20}), null);
  assert.equal(nearestRect(rects, {x:150, y:20}), null);
  assert.equal(nearestRect(rects, {x:185, y:20}), 'a');
  assert.equal(nearestRect(rects, {x:110, y:20}), 'r');
  assert.equal(nearestRect(rects, {x:110, y:20}, new Set(['r'])), null);
});

test('형제 순서 끼우기: 끝·앞·사이, 사이가 없으면 다시 번호', () => {
  const s = (...ords) => ords.map((ord, i) => ({id:`s${i}`, ord}));
  assert.deepEqual(ordAt([], 0), {ord:0, renumber:[]});
  assert.deepEqual(ordAt(s(0, 1024), 2), {ord:2048, renumber:[]});
  assert.deepEqual(ordAt(s(2048), 0), {ord:1024, renumber:[]});
  assert.deepEqual(ordAt(s(0, 1024), 1), {ord:512, renumber:[]});
  const tight = ordAt(s(0, 1), 1);
  assert.equal(tight.ord, ORD_STEP); assert.deepEqual(tight.renumber, [{id:'s1', ord:ORD_STEP * 2}]);
  const front = ordAt(s(0), 0);
  assert.equal(front.ord, 0); assert.deepEqual(front.renumber, [{id:'s0', ord:ORD_STEP}]);
});

test('키보드 길 찾기와 글자 크기·감싸는 칸', () => {
  const nodes = [n('r', null, 0, {x:1000, y:500}), n('a', 'r', 0, {side:1}), n('b', 'r', 1, {side:1}), n('l', 'r', 2, {side:-1}), n('a1', 'a')];
  const tree = buildTree(nodes), {rects} = layoutMindmap(tree, size);
  assert.equal(neighbor(tree, rects, 'r', 'ArrowRight'), 'a');
  assert.equal(neighbor(tree, rects, 'r', 'ArrowLeft'), 'l');
  assert.equal(neighbor(tree, rects, 'a', 'ArrowRight'), 'a1');
  assert.equal(neighbor(tree, rects, 'a', 'ArrowLeft'), 'r');
  assert.equal(neighbor(tree, rects, 'l', 'ArrowRight'), 'r');
  assert.equal(neighbor(tree, rects, 'a', 'ArrowDown'), 'b');
  assert.equal(neighbor(tree, rects, 'b', 'ArrowUp'), 'a');
  assert.equal(stepFont(2, 1), 3); assert.equal(stepFont(FONT_MAX, 1), FONT_MAX); assert.equal(stepFont(1, -1), 1);
  assert.deepEqual(boundsOf([{x:0, y:0, w:10, h:10}, {x:20, y:-5, w:10, h:10}]), {x:0, y:-5, w:30, h:15});
  assert.equal(boundsOf([]), null);
});

// S71-51 보드 위 모든 칸 가지 뻗기: 카드 부모(parent_note)·카드 칸(cardNode)·섞인 가지·옛 서버 규칙.
test('S71-51: 노트 카드 부모는 parent_note로 읽고 나무에서는 parent_id 하나로, 카드 칸은 늘 뿌리', async () => {
  const { cardNode, isCardNode } = await import('../app/note-board-mindmap-model.mjs');
  const kid = nodeShape(base('k'), {parent_note:'note1', ord:0});
  assert.equal(kid.parent_id, 'note1'); assert.equal(kid.parent_card, true);
  const both = nodeShape(base('b'), {parent_id:'t1', parent_note:'note1'}); // 둘 다 오면(서버는 막음) 글 상자 부모
  assert.equal(both.parent_id, 't1'); assert.equal(both.parent_card, false);
  const card = cardNode('note1', {x:100, y:50});
  assert.ok(isCardNode(card));
  const t = buildTree([card, kid, n('g', 'k'), {...cardNode('note2', {x:0, y:0}), parent_id:'k'}]);
  assert.equal(t.parentOf.get('k'), 'note1'); assert.equal(t.parentOf.get('g'), 'k');
  assert.ok(t.roots.some(r => r.id === 'note2'), '카드 칸은 가지가 되지 않는다');
  const lay = layoutMindmap(t, id => (id.startsWith('note') ? {w:128, h:34} : size()));
  assert.equal(lay.rects.get('note1').x, 100);
  assert.ok(lay.rects.get('k').x >= 100 + 128, '카드 오른쪽에 가지');
  const old = buildTree([card, kid], {free:false});
  assert.ok(old.roots.some(r => r.id === 'k'), '옛 서버: 카드 아래 가지 없음');
});
