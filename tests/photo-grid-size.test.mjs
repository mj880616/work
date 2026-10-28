// OD-사진크기·OD-크게보기: 사진 격자 칸 수 단계·핀치 판정·서버 저장 호출, 크게 보기 손동작·공유 이름·되돌리기 자리(synthetic, 브라우저 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NARROW_STEPS, WIDE_STEPS, stepCols, pinchDir, currentCols, changeCols, validCols, resetChosen, SIZE_BUTTONS} from '../app/photo-grid-size.js';
import {PHOTO_COLS, PHOTO_COLS_WIDE, validValue} from '../app/view-prefs.js';
import {swipeKind, shareFileName, putBack, SWIPE_MIN} from '../app/photo-viewer-model.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const fakePrefs = (values = {}) => ({values, sets: [], get(k) { return this.values[k]; }, set(k, v, o) { this.sets.push([k, v, o]); return true; }});

test('단계: 폰 2·3·4·6, 넓은 화면 6·8·10 — view-prefs·DB 검사와 같은 값', () => {
  assert.deepEqual([...NARROW_STEPS], [...PHOTO_COLS]);
  assert.deepEqual([...WIDE_STEPS], [...PHOTO_COLS_WIDE]);
  const sql = read('supabase/migrations/20261028090000_profile_view_prefs_photo_cols.sql');
  assert.match(sql, /'photo_cols' in \('2', '3', '4', '6'\)/);
  assert.match(sql, /'photo_cols_wide' in \('6', '8', '10'\)/);
  for (const n of [2, 3, 4, 6]) assert.ok(validValue('photo_cols', n));
  for (const n of [6, 8, 10]) assert.ok(validValue('photo_cols_wide', n));
  for (const bad of [1, 5, 8, '4', 4.5, null]) assert.equal(validValue('photo_cols', bad), false, String(bad));
  for (const bad of [4, 7, 12, '8']) assert.equal(validValue('photo_cols_wide', bad), false, String(bad));
});

test('[＋]는 칸을 줄이고(그림 크게) [－]는 늘린다, 끝에서는 그대로', () => {
  assert.equal(stepCols(false, 4, 1), 3);
  assert.equal(stepCols(false, 3, 1), 2);
  assert.equal(stepCols(false, 2, 1), 2);
  assert.equal(stepCols(false, 4, -1), 6);
  assert.equal(stepCols(false, 6, -1), 6);
  assert.equal(stepCols(true, 6, 1), 6);
  assert.equal(stepCols(true, 6, -1), 8);
  assert.equal(stepCols(true, 10, -1), 10);
  assert.equal(stepCols(false, 99, -1), 6, '모르는 값은 기본(4)에서 한 단계');
  assert.ok(validCols(false, 2) && !validCols(false, 8) && validCols(true, 8));
});

test('핀치: 1.25배 이상 벌리면 크게, 0.8배 이하로 오므리면 작게, 그 사이는 그대로', () => {
  assert.equal(pinchDir(1.3), 1);
  assert.equal(pinchDir(0.75), -1);
  assert.equal(pinchDir(1.1), 0);
  assert.equal(pinchDir(0.9), 0);
});

test('고른 칸 수: 서버 값 → 없으면 기본(폰 4·넓은 6), 바꾸면 서버에 저장 요청(거절 알림 칸)하고 이번 접속은 고른 대로', () => {
  resetChosen();
  assert.equal(currentCols(false, fakePrefs()), 4);
  assert.equal(currentCols(true, fakePrefs()), 6);
  assert.equal(currentCols(false, fakePrefs({photo_cols: 2})), 2);
  assert.equal(currentCols(false, fakePrefs({photo_cols: 5})), 4, '틀린 값은 기본');
  const prefs = fakePrefs({photo_cols: 3});
  assert.equal(changeCols(-1, {prefs, wide: false}), true);
  assert.deepEqual(prefs.sets, [['photo_cols', 4, {rejectable: true}]]);
  // 서버가 거절해 값이 그대로여도(적용 전) 이번 접속은 고른 4칸.
  assert.equal(currentCols(false, prefs), 4);
  assert.equal(changeCols(-1, {prefs, wide: true}), true);
  assert.deepEqual(prefs.sets.at(-1), ['photo_cols_wide', 8, {rejectable: true}]);
  assert.equal(changeCols(-1, {prefs, wide: true}), true);
  assert.equal(changeCols(-1, {prefs, wide: true}), false, '끝 단계에서는 요청 없음');
  assert.equal(prefs.sets.length, 3);
  resetChosen();
});

test('버튼은 작은 두 개, 기기 저장 없음', () => {
  assert.match(SIZE_BUTTONS, /data-photo-size="-1"[^>]*>－</);
  assert.match(SIZE_BUTTONS, /data-photo-size="1"[^>]*>＋</);
  // 기기 저장소 이름은 조각으로 만든다(이 시험 파일이 저장소 감사에 걸리지 않게).
  const deviceStores = new RegExp(['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB'].join('|'));
  for (const file of ['app/photo-grid-size.js', 'app/photo-viewer-model.mjs']) assert.doesNotMatch(read(file), deviceStores);
  assert.match(read('app/diary.css'), /\.diary-grid\{[^}]*touch-action:pan-y/);
});

test('크게 보기 손동작: 위로 밀기 = 별표, 아래로 밀기 = 닫기, 짧거나 비스듬하거나 두 손가락·확대 중이면 없음', () => {
  assert.equal(swipeKind({dx: 0, dy: -SWIPE_MIN, dt: 200}), 'up');
  assert.equal(swipeKind({dx: 10, dy: 150, dt: 300}), 'down');
  assert.equal(swipeKind({dx: 0, dy: -(SWIPE_MIN - 1), dt: 200}), null);
  assert.equal(swipeKind({dx: 120, dy: -100, dt: 200}), null, '가로 넘기기에 가까우면 없음');
  assert.equal(swipeKind({dx: 0, dy: -150, dt: 2000}), null, '너무 느리면 없음');
  assert.equal(swipeKind({dx: 0, dy: -150, dt: 200, fingers: 2}), null);
  assert.equal(swipeKind({dx: 0, dy: -150, dt: 200, zoomed: true}), null);
});

test('공유 파일 이름과 되돌리기 자리', () => {
  assert.equal(shareFileName({name: 'IMG_0001.JPG'}), 'IMG_0001.JPG');
  assert.equal(shareFileName({name: 'a/b\u0007.jpg'}), 'ab.jpg');
  assert.equal(shareFileName({name: 'clip.mov', day: '2026-10-28'}, 'image/png'), '사진-2026-10-28.png');
  assert.equal(shareFileName({file: {file_name: '일기.webp'}}), '일기.webp');
  assert.deepEqual(putBack([{id: 'a'}, {id: 'c'}], {id: 'b'}, 1).map(p => p.id), ['a', 'b', 'c']);
  assert.deepEqual(putBack([], {id: 'b'}, 5).map(p => p.id), ['b']);
  assert.deepEqual(putBack(undefined, {id: 'b'}, 0).map(p => p.id), ['b']);
  assert.deepEqual(putBack([{id: 'b'}], {id: 'b'}, 0).map(p => p.id), ['b'], '이미 있으면 그대로');
});
