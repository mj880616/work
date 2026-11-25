// S69-98 NOTE-에버노트 ⑥ 문서 스캔: 원근 펴기·밝기 보정·크기·이름의 순수 계산(app/doc-scan-model.mjs) + 화면 연결 정적 확인.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {defaultCorners, clampPoint, isConvexQuad, outputSize, homography, applyH, warp, levels, fitScale, scanName, OUT_MAX} from '../app/doc-scan-model.mjs';

test('처음 모서리·사진 안으로·꼬인 사각형', () => {
  assert.deepEqual(defaultCorners(1000, 500), [{x: 60, y: 30}, {x: 940, y: 30}, {x: 940, y: 470}, {x: 60, y: 470}]);
  assert.deepEqual(clampPoint({x: -5, y: 900.4}, 100, 800), {x: 0, y: 800});
  assert.equal(isConvexQuad(defaultCorners(100, 100)), true);
  assert.equal(isConvexQuad([{x: 0, y: 0}, {x: 100, y: 100}, {x: 100, y: 0}, {x: 0, y: 100}]), false); // 꼬임
  assert.equal(isConvexQuad([{x: 0, y: 0}, {x: 0, y: 0}, {x: 100, y: 0}, {x: 0, y: 100}]), false); // 넓이 없음
  assert.equal(isConvexQuad([{x: 0, y: 0}]), false);
});
test('원근 변환: 네 모서리가 정확히 옮겨지고, 크기는 긴 변 기준·상한', () => {
  const src = [{x: 10, y: 20}, {x: 300, y: 5}, {x: 320, y: 410}, {x: 0, y: 400}], dst = [{x: 0, y: 0}, {x: 300, y: 0}, {x: 300, y: 400}, {x: 0, y: 400}];
  const H = homography(src, dst);
  for (let i = 0; i < 4; i++) { const p = applyH(H, src[i].x, src[i].y); assert.ok(Math.abs(p.x - dst[i].x) < 1e-6 && Math.abs(p.y - dst[i].y) < 1e-6); }
  assert.deepEqual(outputSize(dst), {width: 300, height: 400});
  const big = outputSize([{x: 0, y: 0}, {x: 8000, y: 0}, {x: 8000, y: 4000}, {x: 0, y: 4000}]);
  assert.deepEqual(big, {width: OUT_MAX, height: 1000});
});
test('펴기: 기운 사각형 안 색이 결과를 채우고, 바깥 색은 들어오지 않는다', () => {
  const W = 120, Hh = 100, data = new Uint8ClampedArray(W * Hh * 4);
  const quad = [{x: 30, y: 10}, {x: 100, y: 20}, {x: 90, y: 90}, {x: 20, y: 80}];
  // 사각형 안은 흰색(250), 바깥은 검정(0)
  const inside = (x, y) => { let s = 0; for (let i = 0; i < 4; i++) { const a = quad[i], b = quad[(i + 1) % 4]; const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x); if (c < 0) return false; s++; } return s === 4; };
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4, v = inside(x + 0.5, y + 0.5) ? 250 : 0; data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255; }
  const out = warp({width: W, height: Hh, data}, quad, {width: 60, height: 60});
  assert.equal(out.width, 60); assert.equal(out.height, 60);
  let dark = 0; for (let y = 3; y < 57; y++) for (let x = 3; x < 57; x++) if (out.data[(y * 60 + x) * 4] < 200) dark++;
  assert.equal(dark, 0);
  assert.equal(warp({width: W, height: Hh, data}, [{x: 0, y: 0}, {x: 10, y: 10}, {x: 10, y: 0}, {x: 0, y: 10}]), null);
});
test('밝기 보정: 어두운 종이를 하얗게·글자를 진하게, 한 색이면 그대로', () => {
  const px = [];
  for (let i = 0; i < 90; i++) px.push(170, 170, 170, 255); // 회색 종이
  for (let i = 0; i < 10; i++) px.push(60, 60, 60, 255);    // 글자
  const data = new Uint8ClampedArray(px), r = levels(data);
  assert.equal(r.changed, true);
  assert.equal(data[0], 255); assert.equal(data[90 * 4], 0);
  const flat = new Uint8ClampedArray([100, 100, 100, 255, 101, 101, 101, 255]);
  assert.equal(levels(flat).changed, false); assert.equal(flat[0], 100);
});
test('표시 배율·파일 이름', () => {
  assert.equal(fitScale(4000, 3000, 400, 600), 0.1);
  assert.equal(fitScale(100, 100, 400, 600), 1);
  assert.equal(scanName(new Date('2026-11-25T01:05:00Z')), '스캔 2026-11-25 1005.jpg');
});
test('화면 연결: 노트만 [문서 스캔], 카메라로 찍기, 같은 [사진] 길, 기기 저장 없음', () => {
  const editor = readFileSync(new URL('../app/ed-editor.js', import.meta.url), 'utf8');
  assert.match(editor, /if \(key === 'scan' && !photos\?\.scan\) continue;/);
  assert.match(editor, /input\.setAttribute\('capture', 'environment'\)/);
  assert.match(editor, /openDocScan\(pictures\[0\]\)[\s\S]{0,200}return filesFrom\(\[made\], /);
  assert.match(readFileSync(new URL('../app/note-body.js', import.meta.url), 'utf8'), /max: 20,\n    scan: true,/);
  assert.match(readFileSync(new URL('../app/note-window.js', import.meta.url), 'utf8'), /photos: \{max: 20, scan: true,/);
  const scan = readFileSync(new URL('../app/doc-scan.js', import.meta.url), 'utf8');
  assert.doesNotMatch(scan, /(?:local|session)Storag[e]|indexedD[B]/); // 기기 저장 낱말(감사 검사에 걸리지 않게 글자를 나눔)
  assert.match(scan, /toBlob\(out, 'image\/jpeg'/);
});
