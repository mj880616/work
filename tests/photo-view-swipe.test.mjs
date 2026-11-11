import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {attachStageSwipe} from '../app/photo-view-swipe.js';
import {swipeKind, swipeSide, dragEndX, dragOffsetX, dragOffsetDown, dragEnd, dragAxis, STEP_DIST, SWIPE_MIN, SWIPE_RATIO, SWIPE_MAX_MS} from '../app/photo-viewer-model.mjs';

// PHOTO-크게보기밀기(S57-2): 사업 보고·바구니·노트가 함께 쓰는 사진 크게 보기(photo-view.js)의 손가락 밀기.
// 판정은 [사진] 메뉴와 같은 photo-viewer-model.mjs를 쓴다(새 판정 없음). 브라우저·서버 없이 가짜 칸으로 본다.
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('판정: swipeSide는 swipeKind의 축만 바꾼 같은 규칙(같은 거리·비율·시간·손가락·확대 조건)', () => {
  const base = {dt: 200, fingers: 1, zoomed: false};
  assert.equal(swipeSide({...base, dx: -SWIPE_MIN, dy: 0}), 'next');
  assert.equal(swipeSide({...base, dx: SWIPE_MIN, dy: 0}), 'prev');
  assert.equal(swipeSide({...base, dx: -(SWIPE_MIN - 1), dy: 0}), null, '거리가 모자람');
  assert.equal(swipeSide({...base, dx: -100, dy: 100 / SWIPE_RATIO + 1}), null, '비스듬함');
  assert.equal(swipeSide({...base, dx: -100, dy: 100 / SWIPE_RATIO}), 'next', '경계: 가로가 세로의 SWIPE_RATIO배');
  assert.equal(swipeSide({...base, dx: -100, dy: 0, dt: SWIPE_MAX_MS + 1}), null, '너무 느림');
  assert.equal(swipeSide({...base, dx: -100, dy: 0, fingers: 2}), null, '두 손가락');
  assert.equal(swipeSide({...base, dx: -100, dy: 0, zoomed: true}), null, '확대 중');
  // 같은 입력을 90도 돌리면 swipeKind와 같은 답이다.
  for (const [dx, dy] of [[-100, 0], [100, 0], [-30, 0], [-100, 80], [0, -100]]) {
    const k = swipeKind({dx: dy, dy: dx, dt: 100}), s = swipeSide({dx, dy, dt: 100});
    assert.equal(s, k === 'up' ? 'next' : k === 'down' ? 'prev' : null, `${dx},${dy}`);
  }
  assert.equal(swipeKind({dx: 0, dy: -100, dt: 100}), 'up', '[사진] 메뉴가 쓰는 세로 판정은 그대로');
  assert.equal(swipeKind({dx: 0, dy: 100, dt: 100}), 'down');
});
test('끌다 놓기: 가로는 STEP_DIST(=SWIPE_MIN) 넘게, 없는 쪽은 제자리, 세로는 [사진] 메뉴 dragEnd 그대로', () => {
  assert.equal(STEP_DIST, SWIPE_MIN);
  assert.equal(dragEndX(-(STEP_DIST - 1)), 'back'); assert.equal(dragEndX(-STEP_DIST), 'next');
  assert.equal(dragEndX(STEP_DIST - 1), 'back'); assert.equal(dragEndX(STEP_DIST), 'prev');
  assert.equal(dragEndX(-200, {hasNext: false}), 'back'); assert.equal(dragEndX(200, {hasPrev: false}), 'back');
  assert.equal(dragEndX(-200, {hasPrev: false}), 'next'); assert.equal(dragEndX(NaN), 'back');
  assert.equal(dragOffsetX(50), 50); assert.equal(dragOffsetX(-50), -50);
  assert.equal(dragOffsetX(100, {hasPrev: false}), 30, '앞이 없는 쪽은 무겁게'); assert.equal(dragOffsetX(-100, {hasNext: false}), -30);
  assert.equal(dragOffsetX(100, {hasNext: false}), 100, '있는 쪽은 그대로');
  assert.equal(dragOffsetDown(60), 60); assert.equal(dragOffsetDown(-60), 0, '위로는 움직이지 않는다(별표 없음)'); assert.equal(dragOffsetDown(NaN), 0);
  assert.equal(dragEnd(119), 'back'); assert.equal(dragEnd(120), 'close');
  assert.equal(dragAxis({dx: 30, dy: 5}), 'x'); assert.equal(dragAxis({dx: 3, dy: 40}), 'y');
});

// ---- 가짜 칸 ----
const noop = {closest: () => null};
function fakeStage({w = 400, h = 700} = {}) {
  const on = {}, photo = {style: {}, isConnected: true, getBoundingClientRect: () => ({})};
  const stage = {clientWidth: w, clientHeight: h, style: {}, addEventListener(t, fn) { (on[t] ||= []).push(fn); }, querySelector: () => photo, fire(t, e) { (on[t] || []).forEach(fn => fn(e)); }};
  return {stage, photo};
}
const T = (x, y) => ({clientX: x, clientY: y});
function slide(stage, from, to, {steps = 6, target = noop, ms = 120, tick, release = true} = {}) {
  stage.fire('touchstart', {touches: [T(...from)], target});
  for (let i = 1; i <= steps; i++) { tick?.(ms / steps); stage.fire('touchmove', {touches: [T(from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps)], target}); }
  if (release) stage.fire('touchend', {touches: [], changedTouches: [T(...to)], target});
}
function setup({count = 5, at = 2, w = 400} = {}) {
  const {stage, photo} = fakeStage({w}), st = {at, closed: 0, moves: []};
  const hooks = {at: () => st.at, count: () => count, goTo: to => { if (to < 0 || to >= count || to === st.at) return false; st.moves.push(to); st.at = to; return true; }};
  attachStageSwipe(stage, hooks, {closeNow: () => { st.closed++; }});
  return {stage, photo, st};
}
function withTime(fn) {
  mock.timers.enable({apis: ['setTimeout', 'Date']});
  try { fn({tick: ms => mock.timers.tick(ms)}); } finally { mock.timers.reset(); }
}
const reduced = on => { globalThis.matchMedia = () => ({matches: on}); };
test.beforeEach(() => { reduced(true); delete globalThis.visualViewport; });
test.after(() => { delete globalThis.matchMedia; });

test('왼쪽으로 밀면 다음 사진, 오른쪽으로 밀면 이전 사진(움직임 줄임 설정)', () => {
  const a = setup(); slide(a.stage, [300, 300], [150, 304]); assert.deepEqual(a.st.moves, [3]);
  const b = setup(); slide(b.stage, [100, 300], [260, 296]); assert.deepEqual(b.st.moves, [1]);
});
test('모자란 거리·비스듬한 밀기는 넘기지 않고 사진이 제자리로 돌아온다', () => {
  withTime(t => {
    reduced(false);
    const a = setup(); slide(a.stage, [300, 300], [300 - (STEP_DIST - 6), 300], {tick: t.tick}); assert.deepEqual(a.st.moves, []);
    assert.equal(a.photo.style.transform, '', '제자리');
    const b = setup(); slide(b.stage, [300, 300], [200, 400], {tick: t.tick}); assert.deepEqual(b.st.moves, [], '대각선 100/100은 가로도 세로도 아님');
    assert.equal(b.st.closed, 0);
  });
});
test('끌면 사진이 손가락을 따라 움직이고, 앞이 없는 쪽은 고무줄처럼 무겁다', () => {
  withTime(t => {
    reduced(false);
    const a = setup({at: 2}); slide(a.stage, [300, 300], [220, 300], {tick: t.tick, release: false});
    assert.equal(a.photo.style.transform, 'translate(-80px, 0px)'); assert.equal(a.photo.style.transition, 'none');
    const b = setup({at: 0}); slide(b.stage, [100, 300], [200, 300], {tick: t.tick, release: false});
    assert.equal(b.photo.style.transform, 'translate(30px, 0px)', '첫 사진에서 오른쪽으로: 앞 사진 없음');
    b.stage.fire('touchend', {touches: [], changedTouches: [T(200, 300)], target: noop});
    assert.deepEqual(b.st.moves, []); assert.equal(b.photo.style.transform, '');
    const c = setup({at: 4}); slide(c.stage, [300, 300], [100, 300], {tick: t.tick});
    assert.deepEqual(c.st.moves, [], '마지막 사진에서 왼쪽으로: 다음 사진 없음');
  });
});
test('넘길 때: 지금 사진이 밀려 나가고 0.14초 뒤 다음 사진이 반대쪽에서 들어온다', () => {
  withTime(t => {
    reduced(false);
    const a = setup(); slide(a.stage, [300, 300], [120, 300], {tick: t.tick});
    assert.deepEqual(a.st.moves, [], '아직 나가는 중');
    assert.equal(a.photo.style.transform, 'translate(-400px, 0px)');
    t.tick(140); assert.deepEqual(a.st.moves, [3]);
    assert.equal(a.photo.style.transform, '', '새 사진은 제자리(들어오는 움직임이 끝난 자리)');
  });
});
test('아래로 120px 넘게 밀면 닫기, 모자라면 제자리, 위로 밀면 아무 일도 없다(별표 없음)', () => {
  const a = setup(); slide(a.stage, [200, 200], [204, 200 + 120]); assert.equal(a.st.closed, 1);
  const b = setup(); slide(b.stage, [200, 200], [200, 200 + 60]); assert.equal(b.st.closed, 0);
  const c = setup(); slide(c.stage, [200, 400], [202, 400 - 200]); assert.equal(c.st.closed, 0); assert.deepEqual(c.st.moves, []);
  withTime(t => {
    reduced(false);
    const d = setup(); slide(d.stage, [200, 400], [200, 200], {tick: t.tick, release: false}); assert.equal(d.photo.style.transform, '', '위로는 따라 움직이지 않는다');
  });
});
test('닫기는 사진이 내려간 뒤 0.16초에 한 번만(움직임 켠 때)', () => {
  withTime(t => {
    reduced(false);
    const a = setup(); slide(a.stage, [200, 200], [200, 400], {tick: t.tick});
    assert.equal(a.st.closed, 0); assert.match(a.photo.style.transform, /translate\(0px, 700px\)/); assert.equal(a.photo.style.opacity, '0');
    t.tick(160); assert.equal(a.st.closed, 1);
  });
});
test('빠른 손짓(움직임이 잡히기 전에 끝남)도 같은 규칙: 가로 = 앞뒤, 아래 = 닫기', () => {
  const fast = (to, from = [300, 300]) => { const s = setup(); s.stage.fire('touchstart', {touches: [T(...from)], target: noop}); s.stage.fire('touchend', {touches: [], changedTouches: [T(...to)], target: noop}); return s; };
  assert.deepEqual(fast([180, 303]).st.moves, [3]); assert.deepEqual(fast([420, 297]).st.moves, [1]);
  assert.equal(fast([300, 300 + 90]).st.closed, 1); assert.equal(fast([300, 300 - 90]).st.closed, 0);
  assert.deepEqual(fast([300 - 30, 300]).st.moves, []);
});
test('두 손가락·확대 중·단추 위에서 시작한 손가락은 넘기지도 닫지도 않는다', () => {
  const two = setup(); two.stage.fire('touchstart', {touches: [T(300, 300), T(100, 300)], target: noop}); two.stage.fire('touchmove', {touches: [T(100, 300), T(300, 300)], target: noop}); two.stage.fire('touchend', {touches: [], changedTouches: [T(100, 300)], target: noop});
  assert.deepEqual(two.st.moves, []); assert.equal(two.st.closed, 0);
  // 한 손가락으로 시작해 중간에 두 번째 손가락이 닿으면 그 손동작은 끝까지 무효
  const late = setup(); late.stage.fire('touchstart', {touches: [T(300, 300)], target: noop}); late.stage.fire('touchmove', {touches: [T(250, 300), T(100, 300)], target: noop}); late.stage.fire('touchend', {touches: [], changedTouches: [T(100, 300)], target: noop});
  assert.deepEqual(late.st.moves, []);
  globalThis.visualViewport = {scale: 2, addEventListener() {}, removeEventListener() {}};
  const zoomed = setup(); slide(zoomed.stage, [300, 300], [100, 300]); assert.deepEqual(zoomed.st.moves, []); slide(zoomed.stage, [200, 200], [200, 400]); assert.equal(zoomed.st.closed, 0);
  delete globalThis.visualViewport;
  const btn = setup(); slide(btn.stage, [300, 300], [100, 300], {target: {closest: sel => (/button/.test(sel) ? {} : null)}}); assert.deepEqual(btn.st.moves, [], '‹ › 단추·링크·↻ 위');
});
test('앞뒤 사진이 없는 크게 보기(노트 사진 한 장)는 가로로 밀어도 제자리, 아래로 밀면 닫기', () => {
  const a = setup({count: 1, at: 0}); slide(a.stage, [300, 300], [100, 300]); slide(a.stage, [100, 300], [300, 300]);
  assert.deepEqual(a.st.moves, []); assert.equal(a.st.closed, 0);
  slide(a.stage, [200, 200], [200, 400]); assert.equal(a.st.closed, 1);
});
test('넘기는 사이에 다른 길(‹ ›·키)로 이미 바뀌었으면 겹쳐 넘기지 않는다', () => {
  withTime(t => {
    reduced(false);
    const a = setup(); slide(a.stage, [300, 300], [120, 300], {tick: t.tick});
    a.st.at = 4; // 그 사이 단추로 넘어감
    t.tick(140); assert.deepEqual(a.st.moves, [], '손동작이 한 번 더 넘기지 않는다');
  });
});
test('칸 터치 설정: 평소 두 손가락 확대만 브라우저(pinch-zoom), 화면을 이미 확대해 두었으면 auto, 닫으면 듣기를 거둔다', () => {
  const heard = [];
  globalThis.visualViewport = {scale: 1, addEventListener: (t, fn) => heard.push(['add', t, fn]), removeEventListener: (t, fn) => heard.push(['rm', t, fn])};
  const {stage} = fakeStage(), hooks = {at: () => 0, count: () => 1, goTo: () => false};
  const off = attachStageSwipe(stage, hooks, {closeNow() {}});
  assert.equal(stage.style.touchAction, 'pinch-zoom');
  globalThis.visualViewport.scale = 1.5; heard.find(h => h[0] === 'add')[2](); assert.equal(stage.style.touchAction, 'auto');
  off(); assert.equal(heard.filter(h => h[0] === 'rm').length, 1);
});

test('연결: photo-view.js가 이 손동작을 쓰고, 새 판정·기기 저장을 만들지 않는다', () => {
  const view = read('app/photo-view.js'), swipe = read('app/photo-view-swipe.js'), model = read('app/photo-viewer-model.mjs');
  assert.match(view, /import \{attachStageSwipe\} from '\.\/photo-view-swipe\.js'/);
  assert.match(view, /attachStageSwipe\(stage, hooks/);
  assert.match(view, /goTo: to => \{[^}]*step\(to - index\)/, '‹ ›와 같은 step 하나로 넘긴다');
  assert.match(view, /offSwipe\?\.\(\)/, '닫을 때 듣기를 거둔다');
  assert.match(swipe, /from '\.\/photo-viewer-model\.mjs'/);
  assert.doesNotMatch(swipe, /\b(SWIPE_MIN|STEP_DIST|SWIPE_RATIO|DRAG_START)\s*=|>=\s*\d{2,}|<\s*\d{2,}/, '거리·비율 숫자를 새로 두지 않는다(모델 상수만)');
  assert.match(view, /basket-photo-step/, '‹ › 단추는 그대로');
  assert.match(view, /fromBack/, '폰 뒤로 가기 = 닫기 그대로');
  const deviceStores = new RegExp(['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB', 'cach' + 'es\\s*\\.'].join('|'));
  for (const src of [view, swipe, model]) assert.doesNotMatch(src, deviceStores);
});

// ORG-빠진일2차 5번(S59-3): 맨 끝·맨 처음 사진에서 ›·‹가 잠겨도 ←→·Esc가 먹는다 — 사진·잊지 말기·사업 보고 사진 줄이 모두 쓰는 껍데기(photo-view.js) 하나에서 고친다.
test('연결: 보기 창이 초점을 받을 수 있고(tabindex -1), 그림을 다시 그릴 때 잠긴 단추·사라진 메뉴에 있던 초점을 보기 창으로 옮긴다', () => {
  const view = read('app/photo-view.js'), css = read('app/ui-standard.css');
  assert.match(view, /box\.tabIndex = -1;/, '창 자신이 초점을 받는다(사진을 눌러도 키가 이 창에 닿음)');
  assert.match(view, /paintMenu\(\);\n    keepFocus\(\);/, '그림을 다시 그린 뒤 초점을 지킨다');
  assert.match(view, /function keepFocus\(\) \{[^}]*a\.disabled \|\| a\.closest\('\[hidden\]'\)\)\s*box\.focus\(\{preventScroll: true\}\)/, '잠기거나 숨은 단추·창 밖·body에 있으면 보기 창으로');
  assert.match(view, /box\.addEventListener\('keydown', e => \{ if \(e\.key === 'ArrowLeft'\)/, '←→ 는 그대로 보기 창이 받는다');
  assert.match(view, /box\.addEventListener\('keydown', e => \{ if \(e\.key === 'Escape'\)/, 'Esc 도 보기 창이 받는다');
  assert.match(css, /\.basket-photo-view:focus\{ outline:none; \}/, '창 자신이 초점을 받아도 전체 화면 테두리 없음');
  // 사진 크게 보기를 여는 모든 곳은 이 껍데기 하나로 들어온다(따로 만든 보기 창 없음).
  for (const [file, name] of [['app/basket.js', 'openPhotoView'], ['app/basket-notes.js', 'openPhotoView'], ['app/record-files.js', 'openPhotoView'], ['app/file-actions.js', 'openDocumentPhotoView']]) {
    assert.match(read(file), new RegExp(`${name}[^\\n]*photo-view\\.js|photo-view\\.js[^\\n]*${name}`), file);
  }
  assert.match(read('app/report-photo-row.js'), /viewDocumentPhotos[^\n]*file-actions\.js/, '사업 보고 사진 줄 → file-actions → photo-view.js');
});
