import test from 'node:test';
import assert from 'node:assert/strict';
import {stripPhotoMeta, metaLeft, keepBytes, imageBoxSize, photoOnlyFile, photoTitle, isBoardImage, PHOTO_EDGE} from '../app/note-board-image-model.mjs';

// S70-32 ② 보드 이미지: 올리기 전 사진 정보(위치) 지우기, 칸 크기, 사진 한 장뿐인 노트, 제목. 바이트는 지어낸 것.
const seg = (marker, body) => { const len = body.length + 2; return [0xff, marker, len >> 8, len & 0xff, ...body]; };
const ascii = s => [...s].map(c => c.charCodeAt(0));
// GPS 칸이 든 EXIF(APP1) — 'Exif\0\0' + 'GPS' 글자(위치 칸을 흉내).
const EXIF = seg(0xe1, [...ascii('Exif'), 0, 0, ...ascii('MM GPSLatitude 37.5665 GPSLongitude 126.9780')]);
const XMP = seg(0xe1, ascii('http://ns.adobe.com/xap/1.0/ <exif:GPSLatitude>37,33N</exif:GPSLatitude>'));
const IPTC = seg(0xed, ascii('Photoshop 3.0 8BIM city'));
const COM = seg(0xfe, ascii('taken at home'));
const JFIF = seg(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const ICC = seg(0xe2, ascii('ICC_PROFILE abc'));
const DQT = seg(0xdb, [0, 1, 2, 3]);
const SOS = [0xff, 0xda, 0, 4, 1, 2, 0x11, 0x22, 0xff, 0x00, 0x33, 0xff, 0xd9];
const jpeg = (...parts) => new Uint8Array([0xff, 0xd8, ...parts.flat(), ...SOS]);
const has = (b, s) => Buffer.from(b).includes(Buffer.from(s));

test('JPEG: EXIF(위치)·XMP·IPTC·글 칸을 지우고 그림·색 칸은 그대로', () => {
  const src = jpeg(JFIF, EXIF, ICC, XMP, IPTC, COM, DQT);
  assert.ok(has(src, 'GPSLatitude'));
  assert.deepEqual(metaLeft(src), ['jpeg:e1', 'jpeg:e1', 'jpeg:ed', 'jpeg:fe']);
  const out = stripPhotoMeta(src);
  assert.equal(has(out, 'GPS'), false);
  assert.equal(has(out, 'Exif'), false);
  assert.equal(has(out, 'city'), false);
  assert.equal(has(out, 'taken at home'), false);
  assert.deepEqual(metaLeft(out), []);
  assert.deepEqual([...out], [0xff, 0xd8, ...JFIF, ...ICC, ...DQT, ...SOS]);
  // 이미 깨끗한 파일은 그대로.
  assert.deepEqual([...stripPhotoMeta(out)], [...out]);
});

const crc = () => [0, 0, 0, 0]; // 모델은 CRC를 읽지 않는다(칸을 통째로 빼므로 남은 칸의 CRC는 그대로 맞다)
const chunk = (type, data) => [data.length >>> 24, (data.length >> 16) & 255, (data.length >> 8) & 255, data.length & 255, ...ascii(type), ...data, ...crc()];
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = chunk('IHDR', [0, 0, 0, 4, 0, 0, 0, 3, 8, 6, 0, 0, 0]);
const IDAT = chunk('IDAT', [1, 2, 3]);
const IEND = chunk('IEND', []);

test('PNG: eXIf·글 칸(XMP 위치 포함)·시각 칸을 지우고 투명·그림 칸은 그대로', () => {
  const src = new Uint8Array([...PNG_SIG, ...IHDR, ...chunk('eXIf', ascii('MM GPSLatitude')), ...chunk('iTXt', ascii('XML:com.adobe.xmp GPSLongitude')), ...chunk('tEXt', ascii('Comment home')), ...chunk('tIME', [7, 234, 11, 25, 1, 2, 3]), ...IDAT, ...IEND]);
  assert.deepEqual(metaLeft(src), ['png:eXIf', 'png:iTXt', 'png:tEXt', 'png:tIME']);
  const out = stripPhotoMeta(src);
  assert.equal(has(out, 'GPS'), false);
  assert.deepEqual(metaLeft(out), []);
  assert.deepEqual([...out], [...PNG_SIG, ...IHDR, ...IDAT, ...IEND]);
});

test('모르는 형식·깨진 파일은 지우지 못함(null) — 남은 정보 판단은 unknown(올리지 않음)', () => {
  assert.equal(stripPhotoMeta(new Uint8Array([1, 2, 3])), null);
  assert.deepEqual(metaLeft(new Uint8Array([1, 2, 3])), ['unknown']);
  const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00, 1, 2]);
  assert.equal(stripPhotoMeta(broken), null);
  assert.deepEqual(metaLeft(broken), ['unknown']);
});

test('줄이지 않고 바이트만 지우는 건 작은 PNG뿐(JPEG은 바로 세워 다시 그림)', () => {
  assert.equal(keepBytes('image/png', 800, 600), true);
  assert.equal(keepBytes('image/png', PHOTO_EDGE + 1, 10), false);
  assert.equal(keepBytes('image/jpeg', 800, 600), false);
  assert.equal(keepBytes('image/webp', 800, 600), false);
});

test('새 이미지 칸 크기: 폭 240, 사진 비율, 범위 안', () => {
  assert.deepEqual(imageBoxSize(4000, 3000), {w:240, h:180});
  assert.deepEqual(imageBoxSize(1000, 4000), {w:240, h:600});
  assert.deepEqual(imageBoxSize(100, 20), {w:100, h:60});
  assert.deepEqual(imageBoxSize(0, 0), {w:240, h:240});
});

test('사진 한 장뿐인 노트만 보드에서 사진 칸', () => {
  const photo = {drive_file_id:'p1', mime_type:'image/jpeg', file_name:'a.jpg'};
  assert.equal(photoOnlyFile({raw_text:'', attachments:[photo]}), photo);
  assert.equal(photoOnlyFile({raw_text:'글', attachments:[photo]}), null);
  assert.equal(photoOnlyFile({raw_text:'', attachments:[photo, photo]}), null);
  assert.equal(photoOnlyFile({raw_text:'', attachments:[{...photo, mime_type:'application/pdf'}]}), null);
  assert.equal(photoOnlyFile({raw_text:'', attachments:[]}), null);
});

test('제목·파일 고르기', () => {
  assert.equal(photoTitle('회의 칠판.jpg'), '회의 칠판');
  assert.equal(photoTitle('image.png', new Date(2026, 10, 25, 9, 5)), '보드 사진 11월 25일 09:05');
  assert.equal(photoTitle('', new Date(2026, 0, 2, 13, 40)), '보드 사진 1월 2일 13:40');
  assert.equal(isBoardImage({type:'image/png'}), true);
  assert.equal(isBoardImage({type:'image/svg+xml'}), false);
  assert.equal(isBoardImage({type:'application/pdf'}), false);
});
