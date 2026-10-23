import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharePhotos, shareIdOf, SHARE_PHOTO_EDGE} from '../app/share-photos.js';

// ED-통합편집기 ②: browser side of share photos. Synthetic runtime and fetch; nothing is stored in the browser.
const PAGE = '30000000-0000-4000-8000-000000000001', ID = '40000000-0000-4000-8000-000000000001', ID2 = '40000000-0000-4000-8000-000000000002';
const rt = {config: {url: 'https://x.supabase.co', key: 'anon'}, session: {ensure: async () => true, read: () => ({access_token: 'tok'})}};
const reply = (data, status = 200) => ({ok: status < 400, status, json: async () => data});

test('shareIdOf accepts only share:<uuid>', () => {
  assert.equal(shareIdOf('share:' + ID), ID);
  for (const bad of [null, '', 'drive:' + ID, 'share:x', 'https://x/' + ID, 'share:' + ID + '/..']) assert.equal(shareIdOf(bad), null);
});
test('add: shrinks with redraw at 1600px, sends the page id and the JPEG to the Edge function with the login, returns the src', async () => {
  const seen = {};
  const shrinkCalls = [];
  const photos = createSharePhotos({rt, getPageId: () => PAGE, shrink: async (f, o) => { shrinkCalls.push(o); return new File(['jpg'], 'a.jpg', {type: 'image/jpeg'}); },
    fetcher: async (url, init) => { Object.assign(seen, {url, init}); return reply({ok: true, id: ID, src: 'share:' + ID}); }});
  assert.deepEqual(await photos.add(new File(['x'], 'p.png', {type: 'image/png'})), {src: 'share:' + ID});
  assert.deepEqual(shrinkCalls, [{edge: SHARE_PHOTO_EDGE, quality: 0.86, redraw: true}]);
  assert.equal(SHARE_PHOTO_EDGE, 1600);
  assert.equal(seen.url, 'https://x.supabase.co/functions/v1/share-page-media');
  assert.equal(seen.init.headers.Authorization, 'Bearer tok');
  assert.equal(seen.init.body.get('page_id'), PAGE);
  assert.equal(seen.init.body.get('image').type, 'image/jpeg');
});
test('add: an unsaved page sends nothing; errors become plain messages', async () => {
  let sent = 0;
  const fetcher = async () => { sent++; return reply({error: 'x'}, 413); };
  await assert.rejects(createSharePhotos({rt, getPageId: () => null, shrink: async f => f, fetcher}).add(new File(['x'], 'a.jpg')), /먼저 \[저장\]/);
  assert.equal(sent, 0);
  await assert.rejects(createSharePhotos({rt, getPageId: () => PAGE, shrink: async f => f, fetcher}).add(new File(['x'], 'a.jpg')), /너무 커요/);
  await assert.rejects(createSharePhotos({rt, getPageId: () => PAGE, shrink: async f => f, fetcher: async () => { throw new Error('net'); }}).add(new File(['x'], 'a.jpg')), /올리지 못했어요/);
  const out = {...rt, session: {ensure: async () => false, read: () => null}};
  await assert.rejects(createSharePhotos({rt: out, getPageId: () => PAGE, shrink: async f => f, fetcher}).add(new File(['x'], 'a.jpg')), /로그인/);
});
test('url: photos asked in the same moment share one request; an address is reused until it is old; ids only', async () => {
  let t = 0; const bodies = [];
  const photos = createSharePhotos({rt, getPageId: () => PAGE, now: () => t,
    fetcher: async (u, init) => { const b = JSON.parse(init.body); bodies.push(b); return reply({ok: true, urls: Object.fromEntries(b.ids.map(i => [i, 'https://x.supabase.co/sign/' + i]))}); }});
  const [a, b] = await Promise.all([photos.url('share:' + ID), photos.url('share:' + ID2)]);
  assert.equal(a, 'https://x.supabase.co/sign/' + ID); assert.equal(b, 'https://x.supabase.co/sign/' + ID2);
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0], {action: 'sign', page_id: PAGE, ids: [ID, ID2]});
  await photos.url('share:' + ID); assert.equal(bodies.length, 1);
  t += 9 * 60 * 1000; await photos.url('share:' + ID); assert.equal(bodies.length, 2);
  assert.equal(await photos.url('drive:abc'), null); assert.equal(bodies.length, 2);
});
