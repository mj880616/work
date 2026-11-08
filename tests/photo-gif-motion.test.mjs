import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isGifPhoto } from '../app/photo-viewer-model.mjs';
// PHOTO-GIF움직임(요청함 11/06 01:24): 크게 보기에서 GIF를 알아보는 규칙 하나, 그리고 그 규칙을 쓰는 두 길(사진 탭 크게 보기·파일/노트/자료실 크게 보기)이 이어져 있는지.

test('GIF 판정: 이름 .gif(대소문자 무시) 또는 mime image/gif', () => {
  assert.equal(isGifPhoto({ name: 'move.GIF' }), true);
  assert.equal(isGifPhoto({ file_name: 'a.gif' }), true);
  assert.equal(isGifPhoto({ name: 'x', mime: 'image/gif' }), true);
  assert.equal(isGifPhoto({ name: 'x', mime_type: 'image/gif' }), true);
  assert.equal(isGifPhoto({ name: 'p.jpg', mime: 'image/jpeg' }), false);
  assert.equal(isGifPhoto({ name: 'gif.png' }), false);
  assert.equal(isGifPhoto(null), false);
});

test('두 길이 같은 판정을 쓴다', () => {
  const strip = readFileSync(new URL('../app/photo-strip.js', import.meta.url), 'utf8');
  assert.match(strip, /if \(isGifPhoto\(item\)\) loadHires\(\);/);
  const files = readFileSync(new URL('../app/file-actions.js', import.meta.url), 'utf8');
  assert.match(files, /if \(isGifPhoto\(file\)\) \{ try \{ return await documentTokenUrl/);
  assert.equal((files.match(/documentPhotoUrl\([^)]*, api, (file|list\[i\])\)/g) || []).length, 2);
});
