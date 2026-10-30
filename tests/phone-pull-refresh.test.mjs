// APP-당겨서새로고침: 폰 앱 당겨서 새로고침을 켜고 끄는 웹 쪽(app/phone-pull-refresh.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pullAllowed, startPullRefresh} from '../app/phone-pull-refresh.js';

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
  allow = false;
  assert.equal(win.KPTUPullRefresh.run(), 'cancel');
  assert.equal(reloaded, 1);
});

test('확인 길은 새 버전 안내와 하나이고 로더는 앱에서만 붙인다', () => {
  const notice = readFileSync(new URL('../app/version-notice.js', import.meta.url), 'utf8');
  assert.match(notice, /window\.KPTUReloadGuard=\{allow:allowReload\};/);
  const loader = readFileSync(new URL('../app/loader-v2.js', import.meta.url), 'utf8');
  assert.match(loader, /if\(\/KPTUAndroid\/i\.test\(navigator\.userAgent\|\|''\)\)import\('\.\/phone-pull-refresh\.js'\)/);
});
