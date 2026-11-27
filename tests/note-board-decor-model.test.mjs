// S69-91 ① 노트 보드 글자·도형·선 꾸미기 계산(note-board-decor-model.mjs)과 선 점 끝(note-board-links-model.mjs), 읽기·쓰기 길(note-board-links-data.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isFree, decorShape, decorStyle, shapeSvgPoints, zFront, zBack, zIndexes, duplicateSpec, newShapeSpec, newLineSpec, colorVar, lineVar, PALETTE, SHAPE_KINDS, NONE } from '../app/note-board-decor-model.mjs';
import { nodeShape, buildTree } from '../app/note-board-mindmap-model.mjs';
import { parseLink, parseText, linkGeometry, isPointEnd, pointRect, endPatch, flipPatch, linksOnBoard, hasLink, nearestSide } from '../app/note-board-links-model.mjs';
import { createBoardLinks } from '../app/note-board-links-data.js';

const node = (id, over = {}) => nodeShape(parseText({id, board_id:'all', body:over.body ?? id, x:over.x ?? 0, y:over.y ?? 0, kind:over.kind}), over);

test('글자·도형: S71-51부터 가지가 될 수 있음(서버 칸 없으면 옛 규칙 = 뿌리), 도형만 빈 글, 모양·색 범위', () => {
  const label = node('l', {kind:'label', parent_id:'p'}), shape = node('s', {kind:'shape', body:'', shape:'diamond', color:NONE});
  assert.equal(label.parent_id, 'p'); assert.equal(label.shape, 'plain'); assert.ok(isFree(label));
  assert.equal(shape.body, ''); assert.equal(shape.shape, 'diamond'); assert.equal(shape.color, -1); assert.ok(isFree(shape));
  assert.equal(parseText({id:'t', board_id:'all', body:'', x:0, y:0, kind:'topic'}), null, '주제는 빈 글 안 됨');
  assert.equal(parseText({id:'t', board_id:'all', body:'', x:0, y:0, kind:'label'}), null, '글자는 빈 글 안 됨');
  assert.equal(node('s2', {kind:'shape', body:'', shape:'star'}).shape, 'rect');
  assert.equal(node('c', {color:10}).color, null);
  assert.equal(isFree(node('t')), false);
  const old = buildTree([node('r'), {...label, parent_id:'r'}], {free:false}); // 옛 서버(가지 칸 없음): 글자는 뿌리
  assert.ok(old.roots.some(n => n.id === 'l'));
  const now = buildTree([node('r'), {...label, parent_id:'r'}, {...shape, parent_id:'l'}]); // 모든 칸 가지: 상자 → 글자 → 도형
  assert.equal(now.parentOf.get('l'), 'r'); assert.equal(now.parentOf.get('s'), 'l');
});

test('꾸미기 칸: 범위 밖은 기본, 색은 테마 변수로만(하드코딩 색 없음)', () => {
  assert.deepEqual(decorShape({}), {z:0, stroke:null, stroke_w:null, dash:false, alpha:null, bold:false, align:null, ink:null});
  assert.deepEqual(decorShape({z:200000, stroke:10, stroke_w:9, alpha:5, align:'middle', ink:-1, dash:'yes', bold:1}), {z:0, stroke:null, stroke_w:null, dash:false, alpha:null, bold:false, align:null, ink:null});
  const css = decorStyle({color:NONE, stroke:3, stroke_w:4, alpha:50, ink:9, align:'right'});
  assert.match(css, /--nb-fill:transparent/); assert.match(css, /--nb-stroke:var\(--nb-ink-3\)/); assert.match(css, /--nb-sw:4px/);
  assert.match(css, /opacity:0\.5/); assert.match(css, /--nb-ink:var\(--kptu-ink\)/); assert.match(css, /text-align:right/);
  assert.equal(decorStyle({color:null}), '');
  for (const c of PALETTE) { assert.match(colorVar(c.n), /^var\(--[a-z0-9-]+\)$/); assert.match(lineVar(c.n), /^var\(--[a-z0-9-]+\)$/); }
  for (const k of ['diamond', 'triangle', 'arrow']) assert.match(shapeSvgPoints(k), /^[\d, ]+$/);
  assert.equal(shapeSvgPoints('rect'), null);
  assert.deepEqual(SHAPE_KINDS, ['rect', 'round', 'ellipse', 'diamond', 'triangle', 'arrow']);
  const css2 = readFileSync(new URL('../app/basket.css', import.meta.url), 'utf8');
  for (let n = 0; n < 8; n++) assert.match(css2, new RegExp(`--nb-ink-${n}:color-mix`), `--nb-ink-${n} 정의`);
});

test('겹침 순서: 앞으로·뒤로(이미 맨 앞·뒤면 그대로), 화면 순서, 복제는 옆에 맨 앞', () => {
  const list = [{id:'a', z:0}, {id:'b', z:2}, {id:'c', z:-1}];
  assert.equal(zFront(list, 'a'), 3); assert.equal(zFront(list, 'b'), null);
  assert.equal(zBack(list, 'a'), -2); assert.equal(zBack(list, 'c'), null);
  assert.deepEqual([...zIndexes(list)], [['c', 1], ['a', 2], ['b', 3]]);
  const dup = duplicateSpec({id:'b', board_id:'all', body:'x', x:10, y:20, z:2, kind:'shape', shape:'ellipse', color:3, w:100, h:60, parent_id:'p', bold:false}, list);
  assert.deepEqual(dup, {board_id:'all', body:'x', x:26, y:36, parent_id:null, kind:'shape', color:3, shape:'ellipse', w:100, h:60, z:3});
  assert.deepEqual(newShapeSpec('all', 'triangle', {x:100, y:100}, 4), {board_id:'all', kind:'shape', shape:'triangle', body:'', x:40, y:60, w:120, h:80, z:4});
});

test('넣은 선: 양 끝 = 판 위 점, 끝을 상자에 붙이기·떼기, 꺾은선, 뒤집기, 이 보드 선', () => {
  const spec = newLineSpec('all', 'arrow', {x:200, y:100});
  assert.equal(spec.from_x, 120); assert.equal(spec.to_x, 280); assert.equal(spec.ends, 'end'); assert.equal(spec.shape, 'line');
  assert.equal(newLineSpec('all', 'elbow', {x:200, y:100}).shape, 'elbow');
  assert.ok(newLineSpec('all', 'curve', {x:200, y:100}).bend_x !== null);
  const l = parseLink({id:'x', board_id:'all', ...spec});
  assert.ok(isPointEnd(l, 'from') && isPointEnd(l, 'to'));
  assert.deepEqual(pointRect(l, 'to'), {x:280, y:100, w:0, h:0});
  assert.equal(linkGeometry(pointRect(l, 'from'), pointRect(l, 'to'), l).d, 'M120 100L280 100');
  assert.equal(linkGeometry({x:0, y:0, w:0, h:0}, {x:100, y:60, w:0, h:0}, {shape:'elbow'}).d, 'M0 0H50V60H100');
  assert.equal(typeof nearestSide({x:0, y:0, w:0, h:0}, {x:5, y:0}), 'string');
  // 끝을 상자에 붙이면 점 칸은 비고, 떼면 점만
  assert.deepEqual(endPatch('to', 'text', 't1'), {to_note:null, to_text:'t1', to_x:null, to_y:null, to_side:null});
  assert.deepEqual(endPatch('from', 'point', {x:-5, y:12.4}), {from_note:null, from_text:null, from_x:0, from_y:12, from_side:null});
  const half = parseLink({id:'h', board_id:'all', from_text:'t1', to_x:5, to_y:6});
  assert.ok(half && !isPointEnd(half, 'from') && isPointEnd(half, 'to'));
  const flipped = {...half, ...flipPatch(half)};
  assert.equal(flipped.to_text, 't1'); assert.equal(flipped.from_x, 5); assert.equal(flipped.to_x, null);
  // 끝이 둘(노트 + 점)이거나 점 반쪽이면 버린다
  assert.equal(parseLink({id:'z', board_id:'all', from_note:'a', from_x:1, from_y:1, to_note:'b'}), null);
  assert.equal(parseLink({id:'z', board_id:'all', from_x:1, to_note:'b'}), null);
  assert.equal(parseLink({id:'z', board_id:'all', from_x:1, from_y:1, to_note:'b', color:3, width:2}).width, 2);
  assert.equal(parseLink({id:'z', board_id:'all', from_x:1, from_y:1, to_note:'b', color:12, width:0}).color, null);
  assert.deepEqual(linksOnBoard([l, half], 'all', id => id === 't1').map(k => k.id), ['x', 'h']);
  assert.equal(hasLink([l], 'all', null, null), false);
});

function fakeRt(handler) {
  const calls = [];
  return {calls, context:{read:() => ({workspace:{id:'w1'}})}, api:async (path, opts = {}) => { calls.push({path, ...opts}); return handler(path, opts, calls); }};
}

test('읽기·쓰기: 꾸미기·점 끝 칸이 없는 서버면 옛 칸으로 읽고, 글자·도형·선 넣기는 서버에 보내지 않고 준비 중', async () => {
  const toasts = [];
  const rt = fakeRt(path => {
    if (/select=[^&]*(z,stroke|from_x)/.test(path)) { const e = new Error('column does not exist'); e.status = 400; e.code = '42703'; throw e; }
    return [];
  });
  const store = createBoardLinks({rt, scope:() => 'w1', toast:t => toasts.push(t)});
  await store.load();
  assert.equal(store.ready(), true); assert.equal(store.frameReady(), true);
  assert.equal(store.decorReady(), false); assert.equal(store.linesReady(), false);
  const before = rt.calls.length;
  assert.equal(await store.addText({board_id:'all', body:'글', x:0, y:0, kind:'label'}), null);
  assert.equal(await store.add({board_id:'all', from_x:0, from_y:0, to_x:10, to_y:0}), null);
  await store.updateText('none', {stroke:3});
  assert.equal(rt.calls.length, before, '서버에 보내지 않음');
  assert.ok(toasts.some(t => /글자·도형·꾸미기/.test(t)) && toasts.some(t => /선 넣기/.test(t)));
});

test('읽기·쓰기: 칸이 있으면 글자·도형·점 끝 선을 보내고 받은 값으로 바꾼다(작업공간 칸을 늘 붙임)', async () => {
  const rt = fakeRt((path, opts) => {
    if (opts.method === 'POST' && path.includes('app_note_board_texts')) return [{id:'s1', board_id:'all', x:opts.body.x, y:opts.body.y, ...opts.body}];
    if (opts.method === 'POST' && path.includes('app_note_board_links')) return [{id:'l1', ...opts.body}];
    if (opts.method === 'PATCH' && path.includes('app_note_board_links')) return [{id:'l1', board_id:'all', from_x:0, from_y:0, to_x:null, to_y:null, to_text:'s1', ...opts.body}];
    return [];
  });
  const store = createBoardLinks({rt, scope:() => 'w1'});
  await store.load();
  assert.equal(store.decorReady(), true); assert.equal(store.linesReady(), true);
  assert.match(rt.calls[0].path, /from_x,from_y,to_x,to_y,color,width/);
  assert.ok(rt.calls.some(c => /z,stroke,stroke_w,dash,alpha,bold,align,ink/.test(c.path)));
  const shape = await store.addText(newShapeSpec('all', 'ellipse', {x:100, y:100}, 2));
  assert.equal(shape.kind, 'shape'); assert.equal(shape.body, ''); assert.equal(shape.z, 2);
  const sent = rt.calls.find(c => c.method === 'POST' && c.path.includes('texts')).body;
  assert.equal(sent.workspace_id, 'w1'); assert.equal(sent.kind, 'shape'); assert.equal(sent.z, 2);
  const line = await store.add(newLineSpec('all', 'elbow', {x:100, y:100}));
  assert.equal(line.shape, 'elbow'); assert.ok(isPointEnd(line, 'from'));
  const lsent = rt.calls.find(c => c.method === 'POST' && c.path.includes('links')).body;
  assert.equal(lsent.workspace_id, 'w1'); assert.equal(lsent.from_note, null); assert.equal(lsent.to_x, 180);
  await store.update('l1', endPatch('to', 'text', 's1'));
  const patch = rt.calls.find(c => c.method === 'PATCH').body;
  assert.deepEqual(patch, {to_note:null, to_text:'s1', to_x:null, to_y:null, to_side:null});
});
