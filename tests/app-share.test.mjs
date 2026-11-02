// PHOTO-폰앱공유(요청함 11/01 21:26): 폰 앱 [공유] = 앱 다리(app/app-share.js) → 안드로이드 공유 창. 다리 있을 때·없을 때.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAppShare, phoneIdOf} from '../app/app-share.js';
import {sharePhotoElement, holdPhotoBlob, holdPhotoMaker, shareBlob, waitPhotoBlob, quietNote, SHARE_TEXT, SHARE_WAIT_MS} from '../app/photo-share.js';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.7';
const jpg = (n = 5) => new Blob([new Uint8Array(n).fill(65)], {type: 'image/jpeg'});

// 지어낸 앱: know=false면 옛 앱(out:hello에 답하지 않음). fail = 그 걸음에서 거절.
function fakeApp({know = true, ua = ANDROID, fail = '', silent = ''} = {}) {
  const sent = [], listeners = [];
  const say = data => setTimeout(() => listeners.forEach(fn => fn({data})), 0);
  const bridge = {
    postMessage(m) {
      m = String(m); sent.push(m.startsWith('out:part:') ? 'out:part' : m);
      if (!m.startsWith('out:') || !know) return;
      const step = m === 'out:go' ? 'sent' : m === 'out:hello' ? 'hello' : m.slice(4).split(':')[0];
      if (step === silent) return;
      if (step === 'hello') return say('out:state:{"v":1}');
      if (step === 'cancel') return;
      const ok = step !== fail;
      if (step === 'sent') return say(`out:sent:{"ok":${ok},"error":"${ok ? '' : 'noapp'}"}`);
      say(`out:ack:{"ok":${ok},"step":"${step}","error":"${ok ? '' : step === 'phone' ? 'none' : 'failed'}"}`);
    },
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
  };
  return {sent, win: {navigator: {userAgent: ua}, KPTUAppShell: bridge}};
}
const el = (id = '', state = 'shown') => ({dataset: {state, ...(id ? {diaryPhoto: id} : {})}, isConnected: true});

test('다리 있음(0.4.7+): 폰 사진은 번호만 넘기고 공유 창을 띄운다(바이트를 읽지 않음)', async () => {
  const {sent, win} = fakeApp();
  const app = createAppShare(win, {helloMs: 50, stepMs: 200});
  assert.equal(await app.ready(), true);
  const box = el('ph:42'); let read = 0;
  holdPhotoMaker(box, async () => { read++; return jpg(); });
  const notes = [];
  assert.equal(await sharePhotoElement(box, () => 'a.jpg', {app, note: t => notes.push(t)}), 'shared');
  assert.deepEqual(sent, ['out:hello', 'out:start:{"count":1}', 'out:phone:42', 'out:go']);
  assert.equal(read, 0);
  assert.equal(notes[0], SHARE_TEXT.waiting);
  assert.equal(notes.at(-1), '', '띄운 뒤에는 기다림 칸을 지운다');
});

test('다리 있음: 원드라이브·드라이브 사진은 받은 바이트를 조각으로 넘긴다', async () => {
  const {sent, win} = fakeApp();
  const app = createAppShare(win, {helloMs: 50, stepMs: 200});
  const box = el('od:1');
  holdPhotoBlob(box, jpg(7));
  assert.equal(await sharePhotoElement(box, () => '사진.jpg', {app, note: () => {}}), 'shared');
  assert.deepEqual(sent, ['out:hello', 'out:start:{"count":1}', 'out:begin:{"name":"사진.jpg","mime":"image/jpeg","size":7}', 'out:part', 'out:end', 'out:go']);
});

test('다리 있음: 여러 장(폰 + 원드라이브)도 한 묶음, 앱이 못 찾거나 시간이 지나면 실패 글', async () => {
  const a = fakeApp(); const app = createAppShare(a.win, {helloMs: 50, stepMs: 200});
  await app.ready();
  const file = new File([jpg(3)], 'b.jpg', {type: 'image/jpeg'});
  assert.equal(await app.share([{phoneId: '1'}, {phoneId: '2'}, {file}]), 'shared');
  assert.deepEqual(a.sent.slice(1), ['out:start:{"count":3}', 'out:phone:1', 'out:phone:2', 'out:begin:{"name":"b.jpg","mime":"image/jpeg","size":3}', 'out:part', 'out:end', 'out:go']);

  const b = fakeApp({fail: 'phone'}); const app2 = createAppShare(b.win, {helloMs: 50, stepMs: 200});
  const notes = [];
  assert.equal(await sharePhotoElement(el('ph:9'), () => 'a.jpg', {app: app2, note: t => notes.push(t)}), 'phoneGone');
  assert.equal(notes.at(-1), SHARE_TEXT.phoneGone);
  assert.ok(b.sent.includes('out:cancel'), '실패하면 앱의 묶음을 버린다');

  const c = fakeApp({silent: 'sent'}); const app3 = createAppShare(c.win, {helloMs: 50, stepMs: 60});
  const notes3 = [];
  assert.equal(await sharePhotoElement(el('ph:9'), () => 'a.jpg', {app: app3, note: t => notes3.push(t)}), 'failed');
  assert.equal(notes3.at(-1), SHARE_TEXT.failed, '답이 없으면 기다림 칸 대신 실패 글');
});

test('다리 없음(PC·폰 브라우저)·옛 앱: 앱 길을 쓰지 않는다. 옛 앱에서는 틀린 "저장했어요" 대신 업데이트 안내', async () => {
  const pc = createAppShare({navigator: {userAgent: 'Mozilla/5.0 (Windows NT 10.0)'}}, {helloMs: 20});
  assert.equal(pc.usable, false);
  assert.equal(await pc.ready(), false);
  const box = el('od:2'); holdPhotoBlob(box, jpg());
  const shared = [];
  const nav = {canShare: () => true, share: async d => { shared.push(d.files[0].name); }};
  assert.equal(await sharePhotoElement(box, () => 'x.jpg', {app: pc, nav, note: () => {}}), 'shared');
  assert.deepEqual(shared, ['x.jpg'], '브라우저는 지금처럼 기기 공유 창');

  const old = fakeApp({know: false}); const oldApp = createAppShare(old.win, {helloMs: 20});
  assert.equal(await oldApp.ready(), false);
  assert.equal(oldApp.known(), false);
  const prev = globalThis.window;
  globalThis.window = {navigator: {userAgent: ANDROID}};
  try { assert.equal(await shareBlob(jpg(), 'a.jpg', {nav: {}, doc: null}), 'oldApp'); }
  finally { globalThis.window = prev; }
  assert.ok(SHARE_TEXT.oldApp.includes('업데이트'));
});

test('기다림 칸은 끝없이 남지 않는다(15초 제한 → 실패 글)', async () => {
  assert.ok(SHARE_WAIT_MS <= 15000);
  // 그림이 끝내 안 뜨는 칸: 시간 제한이 지나면 그만 기다린다(sharePhotoElement는 그 뒤 '아직 뜨지 않았어요' 글).
  const t0 = Date.now();
  assert.equal(await waitPhotoBlob(el('', 'loading'), {ms: 40, step: 10}), null);
  assert.ok(Date.now() - t0 < 1000);
  assert.match(SHARE_TEXT.none, /뜨지 않았어요/);
});

test('폰 사진 칸 번호 읽기', () => {
  assert.equal(phoneIdOf(el('ph:123')), '123');
  assert.equal(phoneIdOf(el('od:123')), '');
  assert.equal(phoneIdOf(el('ph:12a')), '');
  assert.equal(phoneIdOf(null), '');
});

test('알림 줄을 누르면 아무 일 없다(누름이 아래 버튼줄로 가지 않음), 줄 안 [되돌리기]만 그대로', () => {
  const handlers = [];
  const note = {dataset: {}, addEventListener: (t, fn) => handlers.push([t, fn])};
  quietNote(note, '[data-diary-undo]');
  quietNote(note, '[data-diary-undo]');
  assert.equal(handlers.length, 1, '한 번만 붙인다');
  const ev = target => ({target, stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; }});
  const onGrey = ev({closest: sel => (sel === '[data-diary-undo]' ? null : {})});
  handlers[0][1](onGrey);
  assert.ok(onGrey.stopped && onGrey.prevented);
  const onUndo = ev({closest: sel => (sel === '[data-diary-undo]' ? {} : null)});
  handlers[0][1](onUndo);
  assert.ok(!onUndo.stopped, '되돌리기는 위로 올라가 처리된다');
  // 화면 연결: 크게 보기(사진·일기)와 문서 사진 보기 모두.
  assert.match(read('app/photo-strip.js'), /quietNote\(box\.querySelector\('\[data-diary-viewer-note\]'\), '\[data-diary-undo\]'\)/);
  assert.match(read('app/photo-view.js'), /quietNote\(noteEl\)/);
  // 버튼줄의 넓힌 누르는 곳은 위로 알림 줄을 덮지 않는다.
  assert.match(read('app/diary.css'), /\.diary-viewer-actions button::after\{ content:""; position:absolute; left:0; right:0; top:-2px;/);
});

test('[공유]가 있는 화면 모두 같은 길: 크게 보기·문서 사진·여러 장', () => {
  assert.match(read('app/photo-share.js'), /if \(await app\.ready\(\)\) return shareInApp\(/);
  assert.match(read('app/photos.js'), /if \(appShare\(\)\.known\(\)\) return sharePickedInApp\(list\)/);
  assert.match(read('app/share-menu.js'), /typeof nav\?\.share === 'function' \|\| app\.known\(\)/);
  const deviceStores = new RegExp(['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB', 'caches' + '\\.'].join('|'));
  assert.doesNotMatch(read('app/app-share.js'), deviceStores);
});
