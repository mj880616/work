// NOTE-보기3가지 → S68-38: 보드 보기(옛 이름 포스트잇) 자리·판 보기 계산(app/note-board-model.mjs)과 화면 연결의 약속.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {boardOf, layoutBoard, boardExtent, movedTo, stepZoom, folderTone, tiltFor, topZ, CARD_W, CARD_H, BOARD_MAX, MIN_W, MIN_H, ZOOM_MIN, ZOOM_MAX, TONES, zoomAt, toBoard, fitView, visibleArea, rectsMeet, cardRect, clampZoom} from '../app/note-board-model.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const note = (id, folder = null, updated = '2026-10-29T01:00:00Z', board) => ({id, updated_at:updated, metadata:{...(folder ? {folder_id:folder} : {}), ...(board ? {board} : {})}});
const folderOf = n => n.metadata.folder_id || null;
const overlap = (a, b) => a.x < b.x + CARD_W && b.x < a.x + CARD_W && a.y < b.y + CARD_H && b.y < a.y + CARD_H;

test('저장된 자리는 모양이 맞을 때만 쓴다', () => {
  assert.deepEqual(boardOf(note('a', null, undefined, {x:10, y:20, r:-2, z:3})), {x:10, y:20, r:-2, z:3});
  for (const bad of [{x:'1', y:0, r:0, z:0}, {x:-1000001, y:0, r:0, z:0}, {x:0, y:1000001, r:0, z:0}, {x:0, y:0, r:30, z:0}, {x:0, y:0, r:0, z:1.5}, {x:0, y:0, r:0}, [1, 2], 'x'])
    assert.equal(boardOf(note('a', null, undefined, bad)), null, JSON.stringify(bad));
  assert.equal(boardOf({id:'a'}), null);
});
test('처음 배치: 저장된 자리가 없으면 폴더끼리 모으고, 같은 목록이면 늘 같은 자리', () => {
  const notes = [note('a1', 'A', '2026-10-29T05:00:00Z'), note('b1', 'B', '2026-10-29T04:00:00Z'), note('a2', 'A', '2026-10-29T03:00:00Z'), note('n1', null, '2026-10-29T02:00:00Z'), note('b2', 'B', '2026-10-29T01:00:00Z')];
  const one = layoutBoard(notes, folderOf), two = layoutBoard([...notes].reverse(), folderOf);
  assert.equal(one.size, 5);
  for (const n of notes) { assert.deepEqual(one.get(n.id), two.get(n.id), n.id); assert.equal(one.get(n.id).saved, false); }
  const center = id => ({x:one.get(id).x, y:one.get(id).y});
  const d = (p, q) => Math.hypot(center(p).x - center(q).x, center(p).y - center(q).y);
  assert.ok(d('a1', 'a2') < d('a1', 'b1') && d('b1', 'b2') < d('b1', 'a2'), '같은 폴더가 가깝다');
  const z = notes.map(n => one.get(n.id).z); assert.equal(new Set(z).size, 5, '겹친 순서가 모두 다르다');
  for (const n of notes) { const r = one.get(n.id).r; assert.ok(r !== 0 && Math.abs(r) <= 4, '살짝 기울어짐'); assert.equal(r, tiltFor(n.id)); }
});
test('새 노트는 저장된 칸과 겹치지 않는 왼쪽 위 빈 곳에, 맨 위 순서로', () => {
  const saved = [note('s1', 'A', undefined, {x:24, y:24, r:2, z:5}), note('s2', 'A', undefined, {x:500, y:300, r:-1, z:9})];
  const fresh = [note('n1', 'B', '2026-10-29T09:00:00Z'), note('n2', null, '2026-10-29T08:00:00Z')];
  const places = layoutBoard([...saved, ...fresh], folderOf);
  assert.deepEqual(places.get('s1'), {x:24, y:24, r:2, z:5, saved:true});
  const n1 = places.get('n1'), n2 = places.get('n2');
  assert.equal(n1.saved, false);
  for (const p of [n1, n2]) for (const s of saved) assert.equal(overlap(p, places.get(s.id)), false);
  assert.equal(overlap(n1, n2), false);
  assert.ok(n1.y <= n2.y && (n1.y < n2.y || n1.x < n2.x), '가장 최근 노트가 더 왼쪽 위');
  assert.ok(n1.y < 200, '왼쪽 위 줄에서 찾는다');
  assert.ok(n1.z > 9 && n2.z > 9);
});
test('끌어 놓기: 옮긴 만큼(S71-52 음수 쪽으로도), 저장 범위 안으로, 맨 위로(기울기는 그대로)', () => {
  assert.deepEqual(movedTo({x:100, y:100, r:3, z:2}, 40.4, -30, 7), {x:140, y:70, r:3, z:8});
  assert.deepEqual(movedTo({x:10, y:10, r:-2, z:0}, -500, -500, 0), {x:-490, y:-490, r:-2, z:1});
  assert.equal(movedTo({x:BOARD_MAX, y:0, r:0, z:0}, 100, 0, 0).x, BOARD_MAX + 100, '옛 판 끝(20000)을 넘어 뻗음');
  assert.equal(movedTo({x:0, y:999990, r:0, z:0}, 0, 100, 0).y, 1000000 - CARD_H);
  assert.equal(movedTo({x:-999990, y:0, r:0, z:0}, -100, 0, 0).x, -1000000);
  const places = new Map([['a', {z:3}], ['b', {z:11}]]); assert.equal(topZ(places), 11); assert.equal(topZ(new Map()), -1);
});
test('보드는 화면보다 넓다(최소 크기 + 놓인 칸 바깥 여유)', () => {
  assert.deepEqual(boardExtent(new Map()), {w:MIN_W, h:MIN_H});
  const e = boardExtent(new Map([['a', {x:3000, y:2000}]])); assert.ok(e.w > 3000 + CARD_W && e.h > 2000 + CARD_H);
});
test('크게·작게 단계(연속 배율, 끝에서 멈춤)와 폴더 색', () => {
  assert.equal(stepZoom(1, 1), 1.25); assert.equal(stepZoom(1, -1), 0.8); assert.equal(stepZoom(ZOOM_MIN, -1), ZOOM_MIN); assert.equal(stepZoom(ZOOM_MAX, 1), ZOOM_MAX); assert.equal(stepZoom(7, 1), ZOOM_MAX);
  assert.equal(clampZoom(NaN), 1); assert.equal(clampZoom(0.01), ZOOM_MIN);
  assert.equal(folderTone(null), 'none'); assert.equal(folderTone('f1'), folderTone('f1'));
  for (const id of ['a', 'b', 'c', 'd', 'e']) assert.ok(Number(folderTone(id)) < TONES);
});
test('색은 테마 파일 토큰 여덟 가지 + 폴더 없음, 노랑 계열 없음', () => {
  const tokens = read('app/theme-tokens.css');
  for (const k of [0, 1, 2, 3, 4, 5, 6, 7, 'none']) assert.match(tokens, new RegExp(`--ds-note-paper-${k}:#[0-9a-f]{6}`));
  const css = read('app/basket.css');
  for (let k = 0; k < TONES; k++) assert.match(css, new RegExp(`\\[data-tone="${k}"\\] \\{ --nb-paper:var\\(--ds-note-paper-${k}\\)`));
  // 노랑(색상 45~65도, 채도 있음) 바탕이 없다.
  for (const [, hex] of tokens.matchAll(/--ds-note-paper-[0-9a-z]+:#([0-9a-f]{6})/g)) {
    const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255), max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min < 0.04) continue;
    let h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4; h = (h * 60 + 360) % 360;
    assert.ok(h < 40 || h > 70, `노랑 계열 #${hex}`);
  }
});
test('화면 연결: 세 보기 전환·서버 기억·자리 저장 길(기기 저장 없음)', () => {
  const js = read('app/basket-notes.js'), board = read('app/note-board.js'), data = read('app/basket-data.js');
  for (const v of ['folder', 'list', 'board']) assert.match(js, new RegExp(`data-note-view="${v}"`));
  assert.match(js, /viewPrefs\.set\('note_view', view, \{rejectable:true\}\)/);
  // S69-83: [전체](metadata.board 저장)는 없앴다 — 저장 길은 보드별 setNoteBoardPlace 하나.
  assert.doesNotMatch(js, /setNoteBoard\b(?!Place)/); assert.doesNotMatch(data, /export function setNoteBoard\(/);
  assert.match(data, /export function setNoteBoardPlace\(/);
  assert.match(board, /import \{ multiTouchActive, onMultiTouch \} from '\.\/photo-grid-size\.js'/, '판 밖 두 손가락 지킴이는 사진 격자 공용 부품(판 안 두 손가락은 연속 확대)');
  // 기기 저장 이름은 조각으로 만든다(저장소 감사 workflow가 시험 파일의 낱말도 세므로).
  const deviceStore = new RegExp(['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB'].join('|'));
  for (const src of [js, board, read('app/note-board-model.mjs')]) assert.doesNotMatch(src, deviceStore);
});

test('판 보기: 손가락 자리를 그대로 둔 확대, 전체 보기, 보이는 영역만 그리기', () => {
  const v = {x:10, y:20, z:1};
  const z2 = zoomAt(v, 2, 110, 120); // 화면 (110,120) = 판 (100,100)
  assert.deepEqual(toBoard(z2, 110, 120), {x:100, y:100}); assert.equal(z2.z, 2);
  assert.equal(zoomAt(v, 99, 0, 0).z, ZOOM_MAX);
  const fit = fitView([{x:100, y:100, w:CARD_W, h:CARD_H}, {x:900, y:500, w:CARD_W, h:CARD_H}], 400, 300);
  const tl = {x:100 * fit.z + fit.x, y:100 * fit.z + fit.y}, br = {x:(900 + CARD_W) * fit.z + fit.x, y:(500 + CARD_H) * fit.z + fit.y};
  assert.ok(tl.x >= 23 && tl.y >= 23 && br.x <= 377 && br.y <= 277, JSON.stringify({tl, br}));
  assert.ok(fitView([{x:0, y:0, w:CARD_W, h:CARD_H}], 1000, 800).z <= 1, '카드 하나여도 1배 넘게 키우지 않는다');
  assert.deepEqual(fitView([], 400, 300), {x:0, y:0, z:1});
  const area = visibleArea({x:-1000, y:-500, z:1}, 400, 300, 0);
  assert.deepEqual(area, {x:1000, y:500, w:400, h:300});
  assert.equal(rectsMeet(cardRect({x:1100, y:600}), area), true);
  assert.equal(rectsMeet(cardRect({x:100, y:100}), area), false);
});
