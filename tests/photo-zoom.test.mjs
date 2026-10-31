// PHOTO-전체화면확대(요청함 10/31 19:23): 크게 보기 안 확대·축소의 순수 판정과 연결(소스) 검사.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ZOOM_ONE, ZOOM_MAX, ZOOM_TAP, clampScale, isZoomed, fitSize, clampPan, zoomAt, pinchTo, panBy, zoomToggle, wheelScale, isTap, isDoubleTap, settleZoom, zoomTransform,
  dragAxis, swipeKind} from '../app/photo-viewer-model.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const BOX = {W:400, H:800, nw:4000, nh:3000}; // 가로 사진: 칸 안에서 400×300

test('배율은 1~5배, 1배 근처는 원래 크기', () => {
  assert.equal(clampScale(0.3), 1); assert.equal(clampScale(9), ZOOM_MAX); assert.equal(clampScale(NaN), 1);
  assert.equal(isZoomed(ZOOM_ONE), false); assert.equal(isZoomed({s:1.01}), false); assert.equal(isZoomed({s:1.5}), true);
  assert.deepEqual(settleZoom({s:1.04, x:30, y:5}, BOX), {s:1, x:0, y:0});
  assert.equal(zoomTransform(ZOOM_ONE), '');
  assert.equal(zoomTransform({s:2, x:-10, y:4}), 'translate(-10.0px, 4.0px) scale(2.000)');
});

test('칸 안 사진 크기(contain)와 옮기기 한계', () => {
  assert.deepEqual(fitSize(BOX), {cw:400, ch:300});
  assert.deepEqual(fitSize({W:400, H:800}), {cw:400, ch:800});
  // 2배: 가로 800 → 좌우 200씩 움직일 수 있고, 세로 600 < 800 → 가운데 고정.
  assert.deepEqual(clampPan({s:2, x:999, y:999}, BOX), {s:2, x:200, y:0});
  assert.deepEqual(clampPan({s:2, x:-999, y:-999}, BOX), {s:2, x:-200, y:0});
  assert.deepEqual(clampPan({s:1, x:50, y:50}, BOX), {s:1, x:0, y:0});
});

test('두 번 톡: 누른 점을 2.5배로, 다시 두 번 톡이면 원래 크기', () => {
  const z = zoomToggle(ZOOM_ONE, 100, 0, BOX);
  assert.equal(z.s, ZOOM_TAP);
  assert.equal(z.x, -150); // 누른 점(가운데에서 오른쪽 100)이 그 자리에 남는다
  assert.deepEqual(zoomToggle(z, 0, 0, BOX), {s:1, x:0, y:0});
});

test('두 손가락: 벌리면 커지고 오므리면 작아지며, 손가락 사이 점이 따라간다', () => {
  const big = pinchTo(ZOOM_ONE, 100, {x:0, y:0}, 250, {x:0, y:0}, BOX);
  assert.equal(big.s, 2.5);
  const small = pinchTo(big, 250, {x:0, y:0}, 100, {x:0, y:0}, BOX);
  assert.equal(small.s, 1);
  const moved = pinchTo(ZOOM_ONE, 100, {x:0, y:0}, 200, {x:40, y:0}, BOX);
  assert.deepEqual(moved, {s:2, x:40, y:0});
  assert.deepEqual(pinchTo({s:2, x:10, y:0}, 0, {x:0, y:0}, 50, {x:0, y:0}, BOX), {s:2, x:10, y:0});
  // 끝까지 벌려도 5배까지.
  assert.equal(pinchTo(ZOOM_ONE, 10, {x:0, y:0}, 1000, {x:0, y:0}, BOX).s, ZOOM_MAX);
});

test('확대 중 끌기와 휠', () => {
  assert.deepEqual(panBy({s:2, x:0, y:0}, 50, 30, BOX), {s:2, x:50, y:0});
  assert.ok(wheelScale(1, -100) > 1); // 위로 굴리면 크게
  assert.ok(wheelScale(2, 100) < 2); // 아래로 굴리면 작게
  assert.equal(wheelScale(1, 500), 1);
  assert.ok(wheelScale(1, -3, 1) > 1); // 줄 단위 휠
  const z = zoomAt(ZOOM_ONE, 2, -100, 0, BOX);
  assert.deepEqual(z, {s:2, x:100, y:0});
});

test('톡·두 번 톡 판정', () => {
  assert.equal(isTap({dx:3, dy:4, dt:120}), true);
  assert.equal(isTap({dx:30, dy:0, dt:120}), false);
  assert.equal(isTap({dx:0, dy:0, dt:600}), false);
  assert.equal(isDoubleTap({x:100, y:100, t:1000}, {x:110, y:105, t:1250}), true);
  assert.equal(isDoubleTap({x:100, y:100, t:1000}, {x:110, y:105, t:1500}), false);
  assert.equal(isDoubleTap({x:100, y:100, t:1000}, {x:200, y:100, t:1100}), false);
  assert.equal(isDoubleTap(null, {x:0, y:0, t:1}), false);
});

test('확대 중에는 세로 밀기(별표·닫기)가 쉰다', () => {
  assert.equal(dragAxis({dx:0, dy:-120, zoomed:true}), 'none');
  assert.equal(swipeKind({dx:0, dy:-150, dt:200, zoomed:true}), null);
});

test('연결: 크게 보기가 확대를 붙이고, 화면 전체 확대 대신 사진 안 확대, 원본 해상도 경로 재사용', () => {
  const strip = read('app/photo-strip.js'), css = read('app/diary.css'), photos = read('app/photos.js'), diary = read('app/diary.js');
  assert.match(strip, /addEventListener\('wheel'[\s\S]*passive:false/);
  assert.match(strip, /addEventListener\('dblclick'/);
  assert.match(strip, /zoomed:zoomedNow\(\)/);
  assert.match(strip, /resetZoom\(\); at = next; show\(\);/); // 다른 장으로 넘기면 원래 크기
  assert.match(css, /\.diary-viewer-strip\{[^}]*touch-action:pan-x; \}/);
  assert.doesNotMatch(css, /pinch-zoom/);
  assert.match(css, /\.diary-viewer\[data-strip-zoom\] \.diary-viewer-strip\{[^}]*overflow-x:hidden; touch-action:none/);
  assert.match(photos, /hires:hiresOf/);
  assert.match(photos, /phone\.mediaUrl\(item\)[\s\S]*gdMediaBlob\(rt, item\.gdId\)[\s\S]*odMediaUrl\(rt, item\.id, 'download'\)/);
  assert.match(diary, /hires:item => \(item\.kind === 'od'/);
  // 기기 저장 없음.
  for (const src of [strip, read('app/photo-viewer-model.mjs')]) assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB/);
});
