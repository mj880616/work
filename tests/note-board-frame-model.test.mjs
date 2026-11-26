// S69-88 노트 보드 상자·카드 틀 계산(app/note-board-frame-model.mjs): 크기 손잡이(범위 자르기·반대편 고정), 맞춤선, 화살표 걸음, 저장 값.
// 자동 배치가 손으로 둔 가지 자리를 지키는지(note-board-mindmap-model.mjs), 카드 별명·크기 저장 모양(note-board-model.mjs·note-boards-model.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeRect, snapMove, arrowStep, sizePatch, clampSize, HANDLES, FRAME_LIMITS } from '../app/note-board-frame-model.mjs';
import { nodeShape, buildTree, layoutMindmap, H_MIN, H_MAX } from '../app/note-board-mindmap-model.mjs';
import { placeShape, placeFields, validateCardLabel, cardLabel, cardRect, movedTo, CARD_W, CARD_H, CARD_LABEL_MAX } from '../app/note-board-model.mjs';
import { withBoardPlace, boardPlaceOf } from '../app/note-boards-model.mjs';
import { rectOf } from '../app/note-board-links-model.mjs';

const R = {x:100, y:100, w:120, h:40};

test('크기 손잡이 8개: 모서리 = 폭·높이, 변 = 그 방향만, 왼쪽·위는 반대편 고정', () => {
  assert.deepEqual(HANDLES, ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
  assert.deepEqual(resizeRect(R, 'se', 30, 20), {x:100, y:100, w:150, h:60});
  assert.deepEqual(resizeRect(R, 'e', 30, 20), {x:100, y:100, w:150, h:40}); // 높이 그대로
  assert.deepEqual(resizeRect(R, 's', 30, 20), {x:100, y:100, w:120, h:60}); // 폭 그대로
  // 왼쪽 위: 오른쪽(220)·아래(140) 변은 그대로.
  const nw = resizeRect(R, 'nw', -20, -10);
  assert.deepEqual(nw, {x:80, y:90, w:140, h:50});
  assert.equal(nw.x + nw.w, 220); assert.equal(nw.y + nw.h, 140);
  const w = resizeRect(R, 'w', 50, 0);
  assert.deepEqual(w, {x:150, y:100, w:70, h:40});
  const ne = resizeRect(R, 'ne', 10, 15);
  assert.deepEqual(ne, {x:100, y:110, w:130, h:30}); // 높이는 최소 30에서 멈추고 아래 변(140)은 그대로
});

test('크기 범위 자르기: 폭 60~600·높이 30~1200, 줄일 때도 반대편은 그대로, S71-52 판은 왼쪽·위로도 뻗음', () => {
  assert.equal(resizeRect(R, 'e', -500, 0).w, 60);
  assert.equal(resizeRect(R, 'e', 5000, 0).w, 600);
  assert.equal(resizeRect(R, 's', 0, -500).h, 30);
  assert.equal(resizeRect(R, 's', 0, 5000).h, 1200);
  const small = resizeRect(R, 'nw', 500, 500); // 너무 줄임 → 최소 크기, 오른쪽·아래 변 고정
  assert.deepEqual(small, {x:160, y:110, w:60, h:30});
  const edge = resizeRect({x:10, y:5, w:100, h:40}, 'nw', -200, -200); // S71-52: 0을 넘어 음수 쪽으로도 늘림(최대 크기까지)
  assert.equal(edge.x, -190); assert.equal(edge.y, -195); assert.equal(edge.w, 300); assert.equal(edge.h, 240);
  assert.equal(clampSize(NaN, 60, 600), 60);
  assert.equal(H_MIN, FRAME_LIMITS.hMin); assert.equal(H_MAX, FRAME_LIMITS.hMax);
});

test('맞춤선: 가장자리·가운데가 threshold 안이면 붙고 선을 돌려준다, 멀면 그대로', () => {
  const other = {x:300, y:100, w:100, h:40};
  // 왼쪽 끝 297 → 300에 붙음(세로 선 x=300), 위 끝 102 → 100에 붙음(가로 선 y=100).
  const s = snapMove({x:297, y:102, w:80, h:30}, [other], 6);
  assert.equal(s.dx, 3); assert.equal(s.dy, -2);
  assert.equal(s.guides.length, 2);
  assert.ok(s.guides.some(g => g.x1 === 300 && g.x2 === 300));
  assert.ok(s.guides.some(g => g.y1 === 100 && g.y2 === 100));
  // 가운데끼리(350).
  const c = snapMove({x:308, y:500, w:80, h:30}, [other], 6);
  assert.equal(c.dx, 2); assert.equal(c.dy, 0); assert.equal(c.guides.length, 1);
  assert.deepEqual(snapMove({x:600, y:600, w:80, h:30}, [other], 6), {dx:0, dy:0, guides:[]});
  assert.deepEqual(snapMove(R, [], 6), {dx:0, dy:0, guides:[]});
});

test('화살표 걸음 1px·Shift 10px, 크기 저장 값은 끈 손잡이 축만', () => {
  assert.deepEqual(arrowStep('ArrowRight', false), {dx:1, dy:0});
  assert.deepEqual(arrowStep('ArrowUp', true), {dx:0, dy:-10});
  assert.equal(arrowStep('Enter', false), null);
  assert.deepEqual(sizePatch('se', {w:150, h:60}, {w:null, h:null}), {w:150, h:60});
  assert.deepEqual(sizePatch('e', {w:150, h:44}, {w:null, h:null}), {w:150, h:null}); // 높이는 글 길이만큼 그대로
  assert.deepEqual(sizePatch('n', {w:120, h:80}, {w:200, h:null}), {w:200, h:80});
});

test('자동 배치는 손으로 둔 가지 자리를 덮어쓰지 않는다(그 아래 가지는 그 자리에서 자동), 형제 자리에서도 빠진다', () => {
  const size = () => ({w:80, h:24});
  const nodes = [
    nodeShape({id:'r', board_id:'b1', body:'r', x:100, y:100}, {}),
    nodeShape({id:'a', board_id:'b1', body:'a', x:0, y:0}, {parent_id:'r', ord:0, side:1}),
    nodeShape({id:'p', board_id:'b1', body:'p', x:700, y:500}, {parent_id:'r', ord:1, side:1, pinned:true}),
    nodeShape({id:'k', board_id:'b1', body:'k', x:0, y:0}, {parent_id:'p', ord:0}),
    nodeShape({id:'q', board_id:'b1', body:'q', x:20, y:400}, {parent_id:'r', ord:2, side:1, pinned:true}),
  ];
  const lay = layoutMindmap(buildTree(nodes), size);
  assert.deepEqual([lay.rects.get('p').x, lay.rects.get('p').y], [700, 500]); // 손으로 둔 자리 그대로
  assert.equal(lay.rects.get('p').pinned, true);
  assert.equal(lay.rects.get('p').side, 1);
  assert.equal(lay.rects.get('q').side, -1); // 부모 가운데보다 왼쪽이면 왼쪽 가지
  const k = lay.rects.get('k');
  assert.equal(k.x, 700 + 80 + 44); assert.equal(k.y + k.h / 2, 500 + 12); // 그 아래 가지는 옮긴 자리 옆에서 자동
  // 형제(a)는 손으로 둔 가지가 없는 것처럼 뿌리 가운데 높이에 홀로.
  const a = lay.rects.get('a');
  assert.equal(a.y + a.h / 2, 100 + 12);
  // 잠깐 자리(posOf): 크기를 바꾸는 중인 뿌리.
  const live = layoutMindmap(buildTree(nodes), size, {posOf:id => (id === 'r' ? {x:90, y:95} : null)});
  assert.deepEqual([live.rects.get('r').x, live.rects.get('r').y], [90, 95]);
  // 뿌리의 손으로 둔 표시는 뜻이 없다(뿌리는 늘 자기 자리).
  assert.equal(nodeShape({id:'z', board_id:'b1', body:'z', x:0, y:0}, {pinned:true}).pinned, false);
  assert.equal(nodeShape({id:'z', board_id:'b1', body:'z', x:0, y:0}, {h:29}).h, null);
  assert.equal(nodeShape({id:'z', board_id:'b1', body:'z', x:0, y:0}, {h:1200}).h, 1200);
});

test('카드 자리: 크기·별명(보드에 보일 글자)을 함께 읽고 쓰고, 비우면 노트 제목, 옮겨도 크기·별명 그대로', () => {
  const p = placeShape({x:10, y:20, r:1, z:3, w:200, h:80, label:'산별 요약'});
  assert.deepEqual(p, {x:10, y:20, r:1, z:3, w:200, h:80, label:'산별 요약'});
  assert.deepEqual(placeShape({x:10, y:20, r:1, z:3, w:59, h:1201, label:' 앞빈칸'}), {x:10, y:20, r:1, z:3}); // 범위 밖은 버림
  assert.equal(placeShape({x:10, y:20, r:1, z:3, label:'가'.repeat(CARD_LABEL_MAX + 1)}).label, undefined);
  assert.deepEqual(cardRect(p), {x:10, y:20, w:200, h:80});
  assert.deepEqual(cardRect({x:1, y:2}), {x:1, y:2, w:CARD_W, h:CARD_H});
  assert.deepEqual(rectOf(p), {x:10, y:20, w:200, h:80});
  assert.equal(cardLabel(p, '노트 제목'), '산별 요약');
  assert.equal(cardLabel({x:0, y:0}, '노트 제목'), '노트 제목');
  assert.equal(validateCardLabel('  두 줄\n글  '), '두 줄 글');
  assert.equal(validateCardLabel('   '), null);
  assert.throws(() => validateCardLabel('가'.repeat(CARD_LABEL_MAX + 1)), /100자/);
  const moved = movedTo({...p, saved:true}, 5, 5, 9);
  assert.deepEqual(moved, {x:15, y:25, r:1, z:10, w:200, h:80, label:'산별 요약'});
  assert.deepEqual(placeFields({...p, saved:false}), p);
  // 노트 metadata.boards 쓰기: 별명만 바꿔도 바뀐 것으로 보고, 지우면 그 칸만 빠진다(다른 보드·다른 칸 그대로).
  const meta = {folder:'f', boards:{b1:{x:10, y:20, r:1, z:3}, b2:{x:1, y:1, r:0, z:0}}};
  const next = withBoardPlace(meta, 'b1', {x:10, y:20, r:1, z:3, label:'별명'});
  assert.deepEqual(next.boards.b1, {x:10, y:20, r:1, z:3, label:'별명'});
  assert.deepEqual(next.boards.b2, meta.boards.b2); assert.equal(next.folder, 'f');
  assert.equal(withBoardPlace(next, 'b1', {x:10, y:20, r:1, z:3, label:'별명'}), null);
  const cleared = withBoardPlace(next, 'b1', {x:10, y:20, r:1, z:3});
  assert.deepEqual(cleared.boards.b1, {x:10, y:20, r:1, z:3});
  assert.deepEqual(boardPlaceOf({metadata:next}, 'b1').label, '별명');
});
