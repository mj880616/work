import test from 'node:test';
import assert from 'node:assert/strict';
import {pictureTypeOf, sniffPictureType, asPicture, splitPictures} from '../app/picture-file.mjs';

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1];
const HEIC = [0, 0, 0, 0x18, ...'ftypheic'].map(x => typeof x === 'string' ? x.charCodeAt(0) : x);

test('type 먼저, 비면 이름 끝, 그다음 첫 바이트', async () => {
  assert.equal(pictureTypeOf({type: 'image/png', name: 'a'}), 'image/png');
  assert.equal(pictureTypeOf({type: '', name: 'IMG_1.JPG'}), 'image/jpeg');
  assert.equal(pictureTypeOf({type: 'application/octet-stream', name: 'x.heic'}), 'image/heic');
  assert.equal(pictureTypeOf({type: 'application/pdf', name: 'x.jpg'}), '');
  assert.equal(pictureTypeOf({type: '', name: '1000012345'}), '');
  assert.equal(sniffPictureType(JPEG), 'image/jpeg');
  assert.equal(sniffPictureType(HEIC), 'image/heic');
  assert.equal(sniffPictureType([0x25, 0x50, 0x44, 0x46]), '');
});

test('type 빈 폰 앱 사진은 사진으로 받고 type을 채운다', async () => {
  const noExt = new File([new Uint8Array(JPEG)], '1000012345', {type: ''});
  const p = await asPicture(noExt);
  assert.equal(p.type, 'image/jpeg');
  assert.equal(p.name, '1000012345.jpg');
  const named = new File([new Uint8Array(JPEG)], 'IMG_2.jpg', {type: ''});
  assert.equal((await asPicture(named)).type, 'image/jpeg');
  const real = new File([new Uint8Array(JPEG)], 'a.jpg', {type: 'image/jpeg'});
  assert.equal(await asPicture(real), real);
  const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'doc', {type: ''});
  assert.equal(await asPicture(pdf), null);
  const {pictures, others} = await splitPictures([noExt, pdf, real]);
  assert.deepEqual(pictures.map(f => f.type), ['image/jpeg', 'image/jpeg']);
  assert.deepEqual(others, [pdf]);
});
