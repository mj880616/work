// OD-공유고침: 사진 크게 보기 [공유] 공용 부품(app/photo-share.js) 단위 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {holdPhotoBlob, holdPhotoMaker, readyPhotoBlob, preparePhotoBlob, waitPhotoBlob, shareBlob, sharePhotoElement, localImageBlob, SHARE_TEXT} from '../app/photo-share.js';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const jpg = (n = 3) => new Blob([new Uint8Array(n)], {type: 'image/jpeg'});
const el = (state = 'loading') => ({dataset: {state}, isConnected: true});
const fakeDoc = () => { const clicks = []; return {clicks, createElement: () => ({hidden: false, click() { clicks.push(this.download); }, remove() {}}), body: {append() {}}}; };

test('뜬 그림의 바이트는 기다리지 않고 바로 넘긴다(다시 받지 않음)', async () => {
  const box = el('shown'), blob = jpg();
  holdPhotoBlob(box, blob);
  assert.equal(readyPhotoBlob(box), blob);
  const shared = [];
  const nav = {canShare: () => true, share: async d => { shared.push(d.files[0]); }};
  const r = await sharePhotoElement(box, () => '사진.jpg', {nav, note: () => {}});
  assert.equal(r, 'shared');
  assert.equal(shared.length, 1);
  assert.equal(shared[0].name, '사진.jpg');
  assert.equal(shared[0].type, 'image/jpeg');
});

test('주소로 뜬 칸은 바이트를 한 번만 받고 같은 요청을 함께 기다린다', async () => {
  const box = el('shown'); let calls = 0;
  holdPhotoMaker(box, async () => { calls++; return jpg(); });
  assert.equal(readyPhotoBlob(box), null);
  const [a, b] = await Promise.all([preparePhotoBlob(box), preparePhotoBlob(box)]);
  assert.equal(a, b); assert.equal(calls, 1);
  assert.equal(readyPhotoBlob(box), a);
});

test('바이트 받기에 실패하면 비워 두고 다음에 다시 받는다', async () => {
  const box = el('shown'); let calls = 0;
  holdPhotoMaker(box, async () => { calls++; if (calls === 1) throw new Error('x'); return jpg(); });
  assert.equal(await preparePhotoBlob(box), null);
  assert.ok(await preparePhotoBlob(box));
  assert.equal(calls, 2);
});

test('그림이 아니거나 빈 바이트는 넘기지 않는다', async () => {
  const box = el('shown');
  holdPhotoMaker(box, async () => new Blob(['<html>'], {type: 'text/html'}));
  assert.equal(await preparePhotoBlob(box), null);
  assert.equal(await shareBlob(null, 'a.jpg', {nav: {}, doc: fakeDoc()}), 'none');
});

test('아직 안 뜬 칸: 받는 중을 알리고, 뜨면 넘긴다', async () => {
  const box = el('loading'), notes = [];
  setTimeout(() => { holdPhotoBlob(box, jpg()); box.dataset.state = 'shown'; }, 30);
  const nav = {canShare: () => true, share: async () => {}};
  const r = await sharePhotoElement(box, () => 'a.jpg', {nav, note: t => notes.push(t)});
  assert.equal(r, 'shared');
  assert.equal(notes[0], SHARE_TEXT.waiting);
  assert.equal(notes.at(-1), '');
});

test('링크로 쉬는 칸·창을 닫은 경우는 기다리지 않는다', async () => {
  assert.equal(await waitPhotoBlob(el('link'), {sleep: async () => {}}), null);
  let n = 0;
  assert.equal(await waitPhotoBlob(el('loading'), {alive: () => n++ < 2, sleep: async () => {}}), null);
  const shown = el('shown'); holdPhotoMaker(shown, async () => null);
  let slept = 0;
  assert.equal(await waitPhotoBlob(shown, {sleep: async () => { slept++; }}), null);
  assert.equal(slept, 0, '그림은 떴는데 바이트를 못 받으면 더 기다리지 않는다');
});

test('공유 창을 닫으면 조용히, 시간이 지나 막히면 한 번 더 누르라고, 공유 창이 없으면 파일로 저장', async () => {
  const blob = jpg();
  assert.equal(await shareBlob(blob, 'a.jpg', {nav: {canShare: () => true, share: async () => { throw Object.assign(new Error(), {name: 'AbortError'}); }}, doc: fakeDoc()}), 'cancel');
  assert.equal(await shareBlob(blob, 'a.jpg', {nav: {canShare: () => true, share: async () => { throw Object.assign(new Error(), {name: 'NotAllowedError'}); }}, doc: fakeDoc()}), 'again');
  const doc = fakeDoc();
  assert.equal(await shareBlob(blob, 'a.jpg', {nav: {}, doc}), 'saved');
  assert.deepEqual(doc.clicks, ['a.jpg']);
});

test('다른 사이트 주소(원드라이브 임시 주소)는 읽지 않는다', async () => {
  let called = false;
  assert.equal(await localImageBlob('https://example.invalid/x.jpg', async () => { called = true; }), null);
  assert.equal(called, false);
  const blob = jpg();
  assert.equal(await localImageBlob('blob:https://desk/1', async () => ({blob: async () => blob})), blob);
});

test('일기 크게 보기 [공유]는 누를 때 다시 받지 않고, 임시 주소를 글자·링크로 넘기지 않는다', () => {
  const diary = read('app/diary.js');
  const share = diary.slice(diary.indexOf('function shareCurrent()'), diary.indexOf('// 한 손가락 세로 밀기'));
  assert.match(share, /sharePhotoElement\(/);
  assert.doesNotMatch(share, /odPhotoUrl|diaryPhotoUrl|grabThumb|fetch\(/);
  for (const f of ['app/diary.js', 'app/photo-share.js', 'app/photo-view.js']) assert.doesNotMatch(read(f), /navigator\.share\(\s*\{[^}]*\b(url|text)\s*:/);
  assert.match(read('app/photo-view.js'), /sharePhotoElement\(/);
  const deviceStores = new RegExp(['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB', 'caches' + '\\.'].join('|'));
  assert.doesNotMatch(read('app/photo-share.js'), deviceStores);
});

test('그림은 떴는데 바이트를 못 받으면 "지금 공유할 수 없어요"로 알린다', async () => {
  const box = el('shown'), notes = [];
  holdPhotoMaker(box, async () => null);
  assert.equal(await sharePhotoElement(box, () => 'a.jpg', {nav: {}, note: t => notes.push(t)}), 'unreadable');
  assert.equal(notes.at(-1), SHARE_TEXT.unreadable);
});
