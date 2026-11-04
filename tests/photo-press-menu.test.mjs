// S49-18 PHOTO-꾹누르기메뉴 · PHOTO-삼성공유 · PHOTO-정보수정버튼: 순수 규칙·다리 말·연결을 서버·폰 없이 시험한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {attachPhotoLongPress, LONG_PRESS_MS, LONG_PRESS_MOVE} from '../app/photo-longpress.js';
import {createAppShare} from '../app/app-share.js';
import {copyImage, shareRows} from '../app/share-menu.js';
import {holdPhotoBlob, holdPhotoMaker, sharePhotoElement, shareBlob, gestureExpired, SHARE_TEXT} from '../app/photo-share.js';
import {PHOTO_ACT_TEXT, PHOTO_MENUS, PHOTO_BAR_MENUS} from '../app/photo-menu-items.mjs';
import {ACT_ICON} from '../app/action-bar.mjs';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const jpg = (n = 5) => new Blob([new Uint8Array(n).fill(65)], {type: 'image/jpeg'});
const el = (state = 'shown') => ({dataset: {state}, isConnected: true});

// ---- 꾹 누르기: 가짜 box와 시계 ----
function fakeBox() {
  const on = {};
  return {on, addEventListener(type, fn) { (on[type] ||= []).push(fn); }, fire(type, event = {}) { const e = {preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...event}; (on[type] || []).forEach(fn => fn(e)); return e; }};
}
function clock() {
  let t = 0, timers = [];
  return {now: () => t, setTimer: (fn, ms) => { const h = {fn, at: t + ms}; timers.push(h); return h; }, clearTimer: h => { timers = timers.filter(x => x !== h); },
    advance(ms) { t += ms; const due = timers.filter(x => x.at <= t); timers = timers.filter(x => x.at > t); due.forEach(x => x.fn()); }};
}
const touch = (x, y, n = 1) => ({touches: Array.from({length: n}, () => ({clientX: x, clientY: y})), target: 'photo'});

function fakeWin() {
  const on = [];
  return {on, addEventListener(type, fn, cap) { if (type === 'click' && cap) on.push(fn); }, removeEventListener(type, fn) { const i = on.indexOf(fn); if (i >= 0) on.splice(i, 1); },
    click() { const e = {prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {}}; [...on].forEach(fn => fn(e)); return e; }};
}
test('꾹 누르기: 500ms 가만히 누르면 메뉴를 한 번 열고, 따라오는 클릭 하나는 창 맨 앞에서 삼킨다', () => {
  const box = fakeBox(), c = clock(), win = fakeWin(), opened = [];
  attachPhotoLongPress(box, {photoAt: t => t === 'photo', open: (x, y) => opened.push([x, y]), win, ...c});
  box.fire('touchstart', touch(30, 40));
  c.advance(LONG_PRESS_MS - 1); assert.equal(opened.length, 0);
  c.advance(1); assert.deepEqual(opened, [[30, 40]]);
  assert.equal(win.click().prevented, true, '손가락을 뗄 때의 클릭이 메뉴를 닫지 않게');
  assert.equal(win.click().prevented, false, '삼키는 건 한 번뿐');
  box.fire('touchstart', touch(30, 40)); c.advance(LONG_PRESS_MS); c.advance(1000);
  assert.equal(win.click().prevented, false, '시간이 지나면 삼키지 않는다');
});

test('꾹 누르기: 움직이거나 손가락이 둘이 되거나 일찍 떼면 취소(넘기기·확대와 겹치지 않음)', () => {
  const c = clock(); let opened = 0;
  const box = fakeBox(); attachPhotoLongPress(box, {photoAt: () => true, open: () => { opened++; }, ...c});
  box.fire('touchstart', touch(10, 10)); box.fire('touchmove', touch(10 + LONG_PRESS_MOVE + 1, 10)); c.advance(2000);
  box.fire('touchstart', touch(10, 10)); box.fire('touchmove', touch(10, 10, 2)); c.advance(2000);
  box.fire('touchstart', touch(10, 10)); c.advance(200); box.fire('touchend'); c.advance(2000);
  box.fire('touchstart', touch(10, 10, 2)); c.advance(2000);
  box.fire('touchstart', touch(10, 10)); box.fire('scroll'); c.advance(2000);
  assert.equal(opened, 0);
  box.fire('touchstart', touch(10, 10)); box.fire('touchmove', touch(13, 12)); c.advance(LONG_PRESS_MS);
  assert.equal(opened, 1, '손가락 떨림(10px 이내)은 괜찮다');
});

test('우클릭·기본 메뉴: 기본 이미지 메뉴는 늘 막고, 꾹 누르기가 이미 열었으면 또 열지 않는다', () => {
  const c = clock(); let opened = 0;
  const box = fakeBox(); attachPhotoLongPress(box, {photoAt: t => t === 'photo', open: () => { opened++; }, ...c});
  const other = box.fire('contextmenu', {target: 'x'}); assert.equal(other.prevented, undefined, '사진이 아닌 곳은 건드리지 않는다');
  const pc = box.fire('contextmenu', {target: 'photo', clientX: 5, clientY: 6}); assert.equal(pc.prevented, true); assert.equal(opened, 1);
  c.advance(2000);
  box.fire('touchstart', touch(1, 1)); c.advance(LONG_PRESS_MS); assert.equal(opened, 2);
  const after = box.fire('contextmenu', {target: 'photo', clientX: 1, clientY: 1}); assert.equal(after.prevented, true);
  assert.equal(opened, 2, '타이머가 연 뒤 브라우저가 보낸 contextmenu로 두 번 열지 않는다');
});

// ---- 사진 복사: 폰 앱 다리 ----
function fakeApp({know = true, fail = ''} = {}) {
  const sent = [], ls = [];
  const say = d => setTimeout(() => ls.forEach(f => f({data: d})), 0);
  const bridge = {postMessage(m) {
    m = String(m); sent.push(m.startsWith('out:part:') ? 'out:part' : m);
    if (!know) return;
    if (m === 'out:hello') return say('out:state:{"v":1}');
    if (m === 'out:cancel') return;
    const step = m === 'out:go' || m === 'out:clip' ? 'sent' : m.slice(4).split(':')[0];
    const ok = step !== fail;
    if (step === 'sent') return say(`out:sent:{"ok":${ok},"error":"${ok ? '' : 'failed'}"}`);
    say(`out:ack:{"ok":${ok},"step":"${step}","error":"${ok ? '' : 'failed'}"}`);
  }, addEventListener(t, f) { if (t === 'message') ls.push(f); }};
  return {sent, win: {navigator: {userAgent: 'Mozilla/5.0 Android KPTUAndroid/0.4.17'}, KPTUAppShell: bridge}};
}
const file = (n = 5) => new File([new Uint8Array(n).fill(66)], '사진.jpg', {type: 'image/jpeg'});

test('사진 복사(폰 앱): 공유 창 대신 out:clip으로 클립보드에 그림을 넣는다', async () => {
  const {sent, win} = fakeApp(), app = createAppShare(win, {helloMs: 50, stepMs: 300});
  assert.equal(await app.ready(), true);
  assert.equal(await app.copy(file()), 'copied');
  assert.deepEqual(sent.filter(m => m !== 'out:hello'), ['out:start:{"count":1}', 'out:begin:{"name":"사진.jpg","mime":"image/jpeg","size":5}', 'out:part', 'out:end', 'out:clip']);
  assert.ok(!sent.includes('out:go'));
});

test('사진 복사(폰 앱): 앱이 거절하면 failed, 바이트가 없으면 none — copyImage는 앱 길을 먼저 쓴다', async () => {
  const bad = fakeApp({fail: 'sent'}), a1 = createAppShare(bad.win, {helloMs: 50, stepMs: 300}); await a1.ready();
  assert.equal(await a1.copy(file()), 'failed');
  assert.equal(await a1.copy(null), 'none');
  const ok = fakeApp(), a2 = createAppShare(ok.win, {helloMs: 50, stepMs: 300}); await a2.ready();
  let clipboardUsed = false;
  const nav = {clipboard: {write: async () => { clipboardUsed = true; }}};
  assert.equal(await copyImage(async () => file(), {nav, Item: function () {}, app: a2}), 'copied');
  assert.equal(clipboardUsed, false, '앱 안에서는 WebView 클립보드를 쓰지 않는다');
  assert.equal(await copyImage(async () => null, {app: a2}), 'none');
  assert.equal(await copyImage(async () => file(), {app: a1}), 'failed');
});

test('옛 앱(out:clip을 모름 → bad)은 실패로 끝난다(조용히 멈추지 않음)', async () => {
  const sent = [], ls = [];
  const say = d => setTimeout(() => ls.forEach(f => f({data: d})), 0);
  const win = {navigator: {userAgent: 'Mozilla/5.0 KPTUAndroid/0.4.16'}, KPTUAppShell: {postMessage(m) {
    m = String(m); sent.push(m.slice(0, 9));
    if (m === 'out:hello') return say('out:state:{"v":1}');
    if (m === 'out:clip') return say('out:ack:{"ok":false,"step":"bad","error":"bad"}');
    if (m === 'out:cancel') return;
    say(`out:ack:{"ok":true,"step":"${m.slice(4).split(':')[0]}","error":""}`);
  }, addEventListener(t, f) { if (t === 'message') ls.push(f); }}};
  const app = createAppShare(win, {helloMs: 50, stepMs: 300}); await app.ready();
  assert.equal(await app.copy(file()), 'failed');
});

// ---- 삼성 인터넷 공유: 기다린 뒤 누른 효력이 끝났으면 share()를 부르지 않고 한 번 더 누르라고 알림 ----
test('공유(브라우저): 바이트가 이미 있으면 기다림 없이 바로 share()', async () => {
  const box = el(); holdPhotoBlob(box, jpg());
  const calls = [];
  const nav = {userActivation: {isActive: true}, canShare: () => true, share: async d => { calls.push(d.files.length); }};
  assert.equal(await sharePhotoElement(box, () => 'a.jpg', {nav, note: () => {}}), 'shared');
  assert.deepEqual(calls, [1]);
});

test('공유(브라우저): 받느라 기다려 누른 효력이 끝났으면 share()를 부르지 않고 "한 번 더" 안내, 두 번째 누름은 바로 넘어감', async () => {
  const box = el('loading');
  let release; holdPhotoMaker(box, () => new Promise(r => { release = () => r(jpg()); }));
  const calls = [], notes = [];
  const nav = {userActivation: {isActive: true}, canShare: () => true, share: async d => { calls.push(d.files.length); }};
  const first = sharePhotoElement(box, () => 'a.jpg', {nav, note: (t, ms) => notes.push(t)});
  await new Promise(r => setTimeout(r, 20));
  nav.userActivation.isActive = false; // 기다리는 사이 효력이 끝남
  box.dataset.state = 'shown'; release();
  assert.equal(await first, 'again');
  assert.deepEqual(calls, [], '막힐 줄 아는 share()를 부르지 않는다');
  assert.equal(notes.at(-1), SHARE_TEXT.again);
  nav.userActivation.isActive = true; // 다시 누름
  assert.equal(await sharePhotoElement(box, () => 'a.jpg', {nav, note: () => {}}), 'shared');
  assert.deepEqual(calls, [1]);
});

test('공유(브라우저): 효력을 알 수 없는 브라우저는 일단 share()를 부르고, 막히면(NotAllowedError) 한 번 더 안내 / 다른 오류는 조용히 저장하지 않고 실패 안내', async () => {
  assert.equal(gestureExpired({}), false);
  assert.equal(gestureExpired({userActivation: {isActive: false}}), true);
  const blob = jpg(), doc = {createElement: () => { throw new Error('저장하면 안 됨'); }, body: {}};
  const err = name => ({canShare: () => true, share: async () => { throw Object.assign(new Error(), {name}); }});
  assert.equal(await shareBlob(blob, 'a.jpg', {nav: err('NotAllowedError'), doc}), 'again');
  assert.equal(await shareBlob(blob, 'a.jpg', {nav: err('TypeError'), doc}), 'failed');
  const box = el(); holdPhotoBlob(box, blob); const notes = [];
  assert.equal(await sharePhotoElement(box, () => 'a.jpg', {nav: err('DataError'), doc, note: t => notes.push(t)}), 'failed');
  assert.equal(notes.at(-1), SHARE_TEXT.failed);
});

// ---- 연결·이름 ----
test('메뉴 목록: 꾹 누르기 메뉴는 PC 공유 메뉴와 같은 항목([사진 복사]·[일기에 넣기]·[업데이트로 보내기]·[다운로드]·[다른 앱으로 공유…])', () => {
  assert.deepEqual(shareRows({native: true, diary: true}), PHOTO_MENUS.viewerShare);
  const strip = read('app/photo-strip.js'), view = read('app/photo-view.js');
  assert.match(strip, /attachPhotoLongPress\(box/);
  assert.match(strip, /shareCurrent\(pointAnchor\(box, x, y\), \{menu:true\}\)/);
  assert.match(view, /attachPhotoLongPress\(box/);
  assert.match(view, /\{wide:true\}\)/);
  assert.match(read('app/diary.css'), /-webkit-touch-callout:none/);
});

test('정보수정: 이름 하나, ⋯ 없음, 선 아이콘 공용 부품에 있음, 보이는 조건 그대로(폰 사진·앱 meta·휴지통 아님)', () => {
  assert.equal(PHOTO_ACT_TEXT.info, '정보수정');
  // PHOTO-아래줄정돈(S49-34): 걸친 아이콘은 버렸다. 정보수정은 아래 줄 [편집 ▾]·[더보기] 안 글자 항목, 우클릭 메뉴는 지금처럼 펼친 목록.
  assert.ok(PHOTO_BAR_MENUS.selectBar.more.includes('info') && PHOTO_BAR_MENUS.viewBar.edit.includes('info') && PHOTO_MENUS.context.includes('info'));
  assert.equal(ACT_ICON.infoEdit, undefined);
  const photos = read('app/photos.js');
  assert.doesNotMatch(read('app/photo-act-bar.mjs'), /infoEdit/);
  assert.match(photos, /case 'info': return \{hidden: !\(on && canInfo\(group\)\)/);
  assert.doesNotMatch(photos, /photosSelMenu|정보 고치기…/);
});
