import test from 'node:test';
import assert from 'node:assert/strict';
import {recentSplit, splitPictures, isPictureFile} from '../app/photo-fold-model.mjs';

// LIB-사진숨김나머지(S61-1): '최근' 목록은 사진 아닌 줄 limit개 그대로 + 그 사이 시간의 사진만 [사진 n]. 이름은 지어낸 것.
const pic = name => isPictureFile({name});
test('recentSplit: 사진은 줄 수에 들지 않고, 마지막 줄보다 옛 사진은 세지 않는다', () => {
  const list = ['a.jpg', 'b.pdf', 'c.png', 'd.hwp', 'e.jpg', 'f.txt'];
  assert.deepEqual(recentSplit(list, pic, 2), {rest: ['b.pdf', 'd.hwp'], pictures: ['a.jpg', 'c.png'], more: true});
  assert.deepEqual(recentSplit(list, pic, 3), {rest: ['b.pdf', 'd.hwp', 'f.txt'], pictures: ['a.jpg', 'c.png', 'e.jpg'], more: false});
});
test('recentSplit: 사진뿐이거나 비어 있어도 안전하다', () => {
  assert.deepEqual(recentSplit(['a.jpg', 'b.png'], pic, 5), {rest: [], pictures: ['a.jpg', 'b.png'], more: false});
  assert.deepEqual(recentSplit(null, pic, 5), {rest: [], pictures: [], more: false});
});
test('splitPictures: 차례 그대로 나눈다', () => {
  assert.deepEqual(splitPictures(['a.jpg', 'b.pdf', 'c.heic'], pic), {rest: ['b.pdf'], pictures: ['a.jpg', 'c.heic']});
});
