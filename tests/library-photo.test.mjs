import test from 'node:test';
import assert from 'node:assert/strict';
import {isLibraryPhoto, libraryPhotoUrl, cachedLibraryPhotoUrl, clearLibraryPhotoCache} from '../app/library-photo.js';

// ACT-사진 2단계: 그림 판단은 자료실 '그림' 형식(fileKindOf) 하나, 작은·큰 그림은 library-files photo 동작으로 받는다.
const ID = '00000000-0000-4000-8000-000000000001';
const rt = (token = 'tok') => ({
  config: {url: 'https://x.test', key: 'anon'},
  context: {read: () => ({user: {id: 'u'}, workspace: {id: 'w'}})},
  session: {ensure: async () => !!token, read: () => ({access_token: token})}
});
globalThis.URL.createObjectURL = () => 'blob:fake-' + Math.random();
globalThis.URL.revokeObjectURL = () => {};

test('isLibraryPhoto: 그림 형식이고 Drive 파일이 있는 자료만', () => {
  assert.equal(isLibraryPhoto({id: 'a', file_id: 'f', file_name: 'x.JPG'}), true);
  assert.equal(isLibraryPhoto({id: 'a', file_id: 'f', file_name: 'x', mime_type: 'image/heic'}), true);
  assert.equal(isLibraryPhoto({id: 'a', file_id: 'f', file_name: 'x.pdf'}), false);
  assert.equal(isLibraryPhoto({id: 'a', file_id: '', file_name: 'x.png'}), false);
  assert.equal(isLibraryPhoto(null), false);
});

test('libraryPhotoUrl: 소유자 로그인으로 photo 동작을 부르고 같은 그림은 한 번만 받는다', async () => {
  clearLibraryPhotoCache();
  const calls = [];
  const fetcher = async (url, o) => { calls.push({url, o}); return {ok: true, headers: {get: () => 'image/jpeg'}, blob: async () => new Blob(['x'])}; };
  const a = await libraryPhotoUrl(ID, 'small', {rt: rt(), fetcher}), b = await libraryPhotoUrl(ID, 'small', {rt: rt(), fetcher});
  assert.equal(a, b); assert.equal(cachedLibraryPhotoUrl(ID, 'small'), a); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://x.test/functions/v1/library-files?action=photo&document_id=${ID}&size=small`);
  assert.deepEqual(calls[0].o.headers, {apikey: 'anon', Authorization: 'Bearer tok'});
  await libraryPhotoUrl(ID, 'large', {rt: rt(), fetcher}); assert.equal(calls.length, 2);
});

test('libraryPhotoUrl: 잘못된 번호·크기, 로그인 없음, 그림이 아닌 응답은 거절하고 저장하지 않는다', async () => {
  clearLibraryPhotoCache();
  await assert.rejects(libraryPhotoUrl('nope', 'small', {rt: rt(), fetcher: async () => { throw new Error('no call'); }}));
  await assert.rejects(libraryPhotoUrl(ID, 'huge', {rt: rt(), fetcher: async () => { throw new Error('no call'); }}));
  await assert.rejects(libraryPhotoUrl(ID, 'small', {rt: rt(''), fetcher: async () => { throw new Error('no call'); }}));
  const bad = async () => ({ok: true, headers: {get: () => 'application/json'}, blob: async () => new Blob(['{}'])});
  await assert.rejects(libraryPhotoUrl(ID, 'small', {rt: rt(), fetcher: bad}));
  const ok = async () => ({ok: true, headers: {get: () => 'image/png'}, blob: async () => new Blob(['x'])});
  assert.ok(await libraryPhotoUrl(ID, 'small', {rt: rt(), fetcher: ok})); // 실패는 기억하지 않아 다시 받는다
});
