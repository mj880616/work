// APP-당겨서새로고침: 폰 앱 당겨서 최신화를 켜고 끄는 웹 쪽(app/phone-pull-refresh.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pullAllowed, startPullRefresh, sideways, SIDE_PX} from '../app/phone-pull-refresh.js';

function el({tag = 'DIV', scrollTop = 0, matches = [], parent = null} = {}) {
  return {tagName: tag, scrollTop, parentElement: parent, hidden: false, matches: sel => matches.some(m => sel.split(',').includes(m)), closest: () => null, getClientRects: () => [1]};
}
function docWith({scrollTop = 0, active = null, layers = []} = {}) {
  const body = {tagName: 'BODY'}, html = {tagName: 'HTML'};
  return {body, documentElement: html, scrollingElement: {scrollTop}, activeElement: active || body, querySelectorAll: () => layers, listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; }};
}

test('맨 위·평범한 곳이면 켠다', () => {
  const doc = docWith();
  const target = el({parent: el({parent: doc.body})});
  assert.equal(pullAllowed(target, doc, {scrollY: 0}), true);
});

test('페이지가 내려가 있으면 끈다', () => {
  const doc = docWith({scrollTop: 40});
  assert.equal(pullAllowed(el(), doc, {scrollY: 40}), false);
});

test('칸 안 스크롤 목록이 내려가 있으면 끈다', () => {
  const doc = docWith();
  const list = el({scrollTop: 120, parent: doc.body});
  assert.equal(pullAllowed(el({parent: list}), doc, {scrollY: 0}), false);
});

test('포스트잇 판 안이면 끈다', () => {
  const doc = docWith();
  const board = el({matches: ['.nb-board'], parent: doc.body});
  assert.equal(pullAllowed(el({parent: board}), doc, {scrollY: 0}), false);
});

test('열린 창(아래에서 올라온 창 포함)·메뉴가 있으면 끈다', () => {
  const sheet = el();
  assert.equal(pullAllowed(el(), docWith({layers: [sheet]}), {scrollY: 0}), false);
  const hidden = {...el(), getClientRects: () => []};
  assert.equal(pullAllowed(el(), docWith({layers: [hidden]}), {scrollY: 0}), true);
  assert.equal(pullAllowed(el(), docWith(), {scrollY: 0, KPTUMobileMenu: {isOpen: () => true}}), false);
});

test('글 쓰는 중이면 끈다', () => {
  assert.equal(pullAllowed(el(), docWith({active: {tagName: 'TEXTAREA'}}), {scrollY: 0}), false);
  assert.equal(pullAllowed(el(), docWith({active: {tagName: 'DIV', isContentEditable: true}}), {scrollY: 0}), false);
});

test('앱에서만 붙고, 손가락마다 pull:on/off를 보내고, 새로고침 전에 저장 안 한 글을 묻는다', () => {
  assert.equal(startPullRefresh({navigator: {userAgent: 'Chrome'}, KPTUAppShell: {postMessage() {}}}), false);
  const sent = [], doc = docWith();
  let reloaded = 0, allow = true;
  const win = {navigator: {userAgent: 'KPTUAndroid/0.3.7'}, document: doc, scrollY: 0, location: {reload: () => { reloaded++; }}, KPTUAppShell: {postMessage: m => sent.push(m)}, KPTUReloadGuard: {allow: () => allow}};
  assert.equal(startPullRefresh(win), true);
  assert.equal(startPullRefresh(win), false);
  doc.listeners.touchstart({touches: [1], target: el({parent: doc.body})});
  doc.listeners.touchstart({touches: [1, 2], target: el({parent: doc.body})});
  win.scrollY = 10;
  doc.listeners.touchstart({touches: [1], target: el({parent: doc.body})});
  assert.deepEqual(sent, ['pull:on', 'pull:off', 'pull:off']);
  assert.equal(win.KPTUPullRefresh.run(), 'reload');
  assert.equal(sent.at(-1), 'reopen:mark:pull', 'APP-다시열림: 다시 열기 전에 까닭(종류만)을 앱에 알린다');
  allow = false;
  assert.equal(win.KPTUPullRefresh.run(), 'cancel');
  assert.equal(reloaded, 1);
  assert.equal(sent.filter(m => m === 'reopen:mark:pull').length, 1, '취소하면 알리지 않는다');
});

test('확인 길은 새 버전 안내와 하나이고 로더는 앱에서만 붙인다', () => {
  const notice = readFileSync(new URL('../app/version-notice.js', import.meta.url), 'utf8');
  // S48-28: 같은 allowReload를 쓰고, 물어야 하면 일단 막은 뒤 작은 확인창에서 [버리기]면 'pull' 표시로 새로고침한다.
  assert.match(notice, /window\.KPTUReloadGuard=\{allow\(\)\{\n\s+const ok=allowReload\(\);if\(ok!=='ask'\)return ok;/);
  assert.match(notice, /reopen:mark:pull'\)\}catch\{\}location\.reload\(\)\}\);\n\s+return false;/);
  const loader = readFileSync(new URL('../app/loader-v2.js', import.meta.url), 'utf8');
  assert.match(loader, /if\(\/KPTUAndroid\/i\.test\(navigator\.userAgent\|\|''\)\)import\('\.\/phone-pull-refresh\.js'\)/);
});

// S68-59(사용자 11/23 16:17 "왼쪽으로 스와이프 여전히 안됨"): 오른손 엄지로 왼쪽으로 밀면 손끝이 아래로 조금 내려간다.
// 앱 껍데기가 그것을 당기기로 가져가지 않게, 옆으로 가는 손가락은 처음 움직인 순간 pull:off로 바꾼다.
test('갈래 판정: 처음 6px을 넘은 순간 가로가 크면 옆, 세로가 크거나 같으면 위아래', () => {
  assert.equal(SIDE_PX, 6);
  assert.equal(sideways(-3, 2), null, '아직 모름');
  assert.equal(sideways(-12, 4), true, '왼쪽 + 아래로 조금(엄지 호)');
  assert.equal(sideways(12, -4), true, '오른쪽 + 위로 조금');
  assert.equal(sideways(2, 14), false, '아래로 당기기');
  assert.equal(sideways(8, 8), false, '대각선은 당기기 쪽(앱 기본과 같음)');
});

test('맨 위에서 옆으로 미는 손가락은 pull:off를 한 번 더 보내고, 아래로 당기는 손가락은 그대로 둔다', () => {
  const sent = [], doc = docWith();
  const win = {navigator: {userAgent: 'KPTUAndroid/0.5.26'}, document: doc, scrollY: 0, location: {reload() {}}, KPTUAppShell: {postMessage: m => sent.push(m)}};
  assert.equal(startPullRefresh(win), true);
  const target = el({parent: doc.body});
  const touch = (x, y) => ({touches: [{clientX: x, clientY: y}], target});
  // 왼쪽 밀기(엄지 호: 왼쪽으로 가며 아래로 내려감)
  doc.listeners.touchstart(touch(300, 200));
  doc.listeners.touchmove(touch(297, 201));
  doc.listeners.touchmove(touch(290, 203));
  doc.listeners.touchmove(touch(250, 215));
  doc.listeners.touchmove(touch(200, 230));
  assert.deepEqual(sent, ['pull:on', 'pull:off'], '옆으로 가는 순간 한 번만 끈다');
  // 아래로 당기기: 켠 채로 둔다.
  sent.length = 0;
  doc.listeners.touchstart(touch(200, 100));
  doc.listeners.touchmove(touch(203, 120));
  doc.listeners.touchmove(touch(205, 200));
  assert.deepEqual(sent, ['pull:on']);
  // 처음부터 꺼진 손가락(페이지가 내려가 있음)은 움직여도 더 보내지 않는다.
  sent.length = 0; win.scrollY = 30;
  doc.listeners.touchstart(touch(300, 200));
  doc.listeners.touchmove(touch(200, 210));
  assert.deepEqual(sent, ['pull:off']);
});
