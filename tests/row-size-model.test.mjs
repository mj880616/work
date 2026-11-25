// UI-폴더줄크기(S69-99, 명진 2026-11-25 08:23): 폴더·항목 줄 크기 단계 계산(app/row-size-model.mjs).
// 두 손가락 벌리기 = 한 단계 크게, 오므리기 = 한 단계 작게, 한 번의 손짓(손을 뗄 때)에 한 단계, 임계값 사이는 그대로. Ctrl+휠 한 번도 한 단계.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ROW_SIZES, ROW_SIZE_DEFAULT, ROW_SIZE_KEY, ROW_PINCH_IN, ROW_PINCH_OUT, rowSizeOf, stepRowSize, pinchRowDir, wheelRowDir, validRowSize} from '../app/row-size-model.mjs';

test('단계: 작게·보통(기본)·크게·아주 크게, 서버 칸 이름 row_size', () => {
  assert.deepEqual(ROW_SIZES, ['s', 'm', 'l', 'xl']);
  assert.equal(ROW_SIZE_DEFAULT, 'm');
  assert.equal(ROW_SIZE_KEY, 'row_size');
  assert.equal(rowSizeOf(undefined), 'm'); assert.equal(rowSizeOf('zz'), 'm'); assert.equal(rowSizeOf('xl'), 'xl');
  assert.equal(validRowSize('l'), true); assert.equal(validRowSize('M'), false);
});

test('한 단계씩: 크게(+1)·작게(-1), 끝에서는 그대로, 틀린 값은 보통에서', () => {
  assert.equal(stepRowSize('m', 1), 'l');
  assert.equal(stepRowSize('l', 1), 'xl');
  assert.equal(stepRowSize('xl', 1), 'xl');
  assert.equal(stepRowSize('m', -1), 's');
  assert.equal(stepRowSize('s', -1), 's');
  assert.equal(stepRowSize('??', 1), 'l');
  assert.equal(stepRowSize('m', 5), 'l', '한 번에 한 단계만');
  assert.equal(stepRowSize('m', 0), 'm');
});

test('두 손가락 임계값: 1.35배 이상 벌리면 +1, 0.75배 이하 오므리면 -1, 그 사이·틀린 값은 0', () => {
  assert.equal(ROW_PINCH_OUT, 1.35); assert.equal(ROW_PINCH_IN, 0.75);
  assert.equal(pinchRowDir(100, 135), 1);
  assert.equal(pinchRowDir(100, 300), 1, '많이 벌려도 한 단계(부르는 쪽은 손을 뗄 때 한 번만)');
  assert.equal(pinchRowDir(100, 75), -1);
  assert.equal(pinchRowDir(100, 120), 0);
  assert.equal(pinchRowDir(100, 80), 0);
  assert.equal(pinchRowDir(0, 50), 0);
  assert.equal(pinchRowDir(NaN, 50), 0);
});

test('Ctrl+휠: 위로 = 크게, 아래로 = 작게, 아주 작은 떨림은 무시', () => {
  assert.equal(wheelRowDir(-100), 1);
  assert.equal(wheelRowDir(100), -1);
  assert.equal(wheelRowDir(2), 0);
  assert.equal(wheelRowDir(-3), 0);
});

test('손짓 부품: 손을 뗄 때 한 번만 바꾸고, 그 폴더로 들어가는 길(folderAt·onOut)이 없다', () => {
  const src = readFileSync(new URL('../app/folder-pinch.js', import.meta.url), 'utf8');
  assert.match(src, /const end = e =>[\s\S]*pinchRowDir\(g\.d, g\.last\)[\s\S]*changeRowSize\(dir\)/);
  assert.doesNotMatch(src, /folderAt|onOut|onIn/);
  for (const f of ['files.js', 'basket-notes.js', 'photos.js', 'library-upload.js']) {
    const s = readFileSync(new URL('../app/' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(s, /bindFolderPinch\([^)]*folderAt/, f + ': 두 손가락으로 폴더에 들어가지 않는다');
  }
});

test('줄 크기 값은 folder-tree.css 한 곳(단계마다), 보통은 [파일] 값 44·40·14px', () => {
  const css = readFileSync(new URL('../app/folder-tree.css', import.meta.url), 'utf8');
  assert.match(css, /:root \{ --ft-row-h:44px; --ft-sub-h:40px; --ft-item-h:40px; --ft-font:14px; --ft-ico:20px;/);
  for (const s of ['s', 'l', 'xl']) assert.match(css, new RegExp(`:root\\[data-row-size="${s}"\\] \\{ --ft-row-h:`));
  assert.doesNotMatch(css, /ft-hint/);
});
