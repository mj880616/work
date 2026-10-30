// PC공유메뉴(요청함 10/30): 넓은 화면 [공유] → Web2 작은 메뉴. 줄 고르기·사진 복사(image/png)·정리함 넣기(기존 저장 길)·좁은 화면은 기기 공유 창 그대로.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {shareRows, copyImage, putInBasket, wideShare, WIDE_SHARE_QUERY, SHARE_ROW_TEXT, shareFrom} from '../app/share-menu.js';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const blob = (type = 'image/jpeg') => new Blob([new Uint8Array([1, 2, 3])], {type});

test('메뉴 줄: 사진 4줄, 동영상은 복사·정리함 없음, 여러 장은 복사 없음, 기기 공유 창이 없으면 그 줄 없음', () => {
  assert.deepEqual(shareRows({native: true}), ['copy', 'basket', 'download', 'native']);
  assert.deepEqual(shareRows({native: true}).map(r => SHARE_ROW_TEXT[r]), ['사진 복사', '정리함에 넣기', '다운로드', '다른 앱으로 공유…']);
  assert.deepEqual(shareRows({video: true, native: true}), ['download', 'native']);
  assert.deepEqual(shareRows({count: 3, native: true}), ['basket', 'download', 'native']);
  assert.deepEqual(shareRows({native: false}), ['copy', 'basket', 'download']);
});

test('넓은 화면 기준은 761px(폰 ≤760px은 기기 공유 창 그대로)', () => {
  assert.equal(WIDE_SHARE_QUERY, '(min-width:761px)');
  assert.equal(wideShare(q => ({matches: q === '(min-width:761px)'})), true);
  assert.equal(wideShare(() => ({matches: false})), false);
  assert.equal(wideShare(undefined), false);
  let called = 0;
  assert.equal(shareFrom({}, {native: () => { called++; }}, {wide: false}), 'native');
  assert.equal(called, 1, '좁은 화면은 바로 native()');
});

test('사진 복사: clipboard.write에 image/png 한 장, PNG가 아니면 바꿔서, 바이트가 없으면 none', async () => {
  const writes = [];
  class Item { constructor(data) { this.data = data; this.types = Object.keys(data); } }
  const nav = {clipboard: {write: async list => { for (const it of list) writes.push({types: it.types, blob: await it.data['image/png']}); }}};
  const converted = [];
  const toPng = async b => { converted.push(b.type); return b.type === 'image/png' ? b : blob('image/png'); };
  assert.equal(await copyImage(async () => blob('image/jpeg'), {nav, Item, toPng}), 'copied');
  assert.deepEqual(writes[0].types, ['image/png']); assert.equal(writes[0].blob.type, 'image/png');
  assert.deepEqual(converted, ['image/jpeg']);
  assert.equal(await copyImage(async () => null, {nav, Item, toPng}), 'none');
  assert.equal(await copyImage(async () => blob(), {nav: {}, Item, toPng}), 'unsupported');
  assert.equal(await copyImage(async () => blob(), {nav: {clipboard: {write: async () => { throw new Error('denied'); }}}, Item, toPng}), 'failed');
});

test('정리함에 넣기: 기존 basket-upload uploadBatch 한 번(파일마다 대기 줄), 끝나면 정리함 새로고침 알림', async () => {
  const calls = [], events = [];
  const load = async () => ({createUploadBatch: () => ({note_id: null, attachments: [], entries: [], blocked: null}),
    uploadBatch: async (batch, opts) => { calls.push({n: batch.entries.length, kinds: batch.entries.map(e => e.kind), raw: opts.raw_text}); batch.note_id = 'n1'; return {ok: true}; }});
  const files = [new File([blob()], 'a.jpg', {type: 'image/jpeg'}), new File([blob()], 'b.jpg', {type: 'image/jpeg'})];
  const out = await putInBasket(files, {load, emit: name => events.push(name)});
  assert.deepEqual(out, {ok: true, count: 2, note_id: 'n1'});
  assert.deepEqual(calls, [{n: 2, kinds: ['pending', 'pending'], raw: ''}]);
  assert.deepEqual(events, ['kptu:basket-note-created']);
  assert.deepEqual(await putInBasket([], {load}), {ok: false, code: 'none'});
});

test('화면 연결: [공유]가 있는 곳 모두(사진 크게 보기·문서 사진 보기·사진 여러 장) 같은 메뉴, 공용 anchored-menu, 기기 저장 없음', () => {
  const menu = read('app/share-menu.js');
  assert.match(menu, /createAnchoredMenu\(\{id:'shareMenu'/);
  assert.match(menu, /import\('\.\/basket-upload\.js'\)/, '정리함 기존 저장 길');
  const deviceStores = new RegExp(['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB', 'caches' + '\\.'].join('|'));
  assert.ok(!deviceStores.test(menu), '기기 저장 없음');
  assert.match(read('app/photo-strip.js'), /shareFrom\(trigger, \{video:!!item\.video/);
  assert.match(read('app/photo-view.js'), /shareFrom\(trigger, \{count:1/);
  assert.match(read('app/photos.js'), /shareFrom\(trigger, \{count:list\.length/);
  // navigator.share를 직접 부르는 곳은 기존 두 곳뿐(넓은 화면에서는 메뉴의 '다른 앱으로 공유…'로만 닿는다)
  const direct = ['app/photo-share.js', 'app/photos.js'].filter(p => /navigator\.share\(|nav\.share\(/.test(read(p)));
  assert.deepEqual(direct, ['app/photo-share.js', 'app/photos.js']);
});
