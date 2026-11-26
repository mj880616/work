// APP-폰앱새로 ③: 내 프로필의 [위젯 로그아웃] 줄(app/phone-widget-line.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {widgetStatus, mountWidgetLine} from '../app/phone-widget-line.js';

// S71-36: 줄은 공용 설정 줄 글자(innerHTML)로 그린다. 누르기는 host 한 곳에서 받는다.
class El {
  constructor(tag, doc) { this.tag = tag; this.ownerDocument = doc; this.innerHTML = ''; this.listeners = {}; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  querySelector(sel) { const m = /^\[([a-z-]+)\]$/.exec(sel); return m && this.innerHTML.includes(m[1]) ? {sel} : null; }
}

function setup(ua) {
  const doc = {listeners: {}, visibilityState: 'visible', createElement(tag) { return new El(tag, doc); }, addEventListener(t, fn) { this.listeners[t] = fn; }};
  const sent = [];
  let onMessage = null;
  const win = {navigator: {userAgent: ua}, document: doc, KPTUAppShell: {postMessage: m => sent.push(m), addEventListener: (t, fn) => { onMessage = fn; }}};
  const host = new El('div', doc);
  return {doc, win, host, sent, message: data => onMessage({data})};
}
const click = (s, attr) => s.host.listeners.click({target: {closest: sel => (sel === `[${attr}]` && s.host.innerHTML.includes(attr) ? {} : null)}});

test('widgetStatus는 앱이 보낸 두 글만 읽는다', () => {
  assert.equal(widgetStatus('widget:status:on'), true);
  assert.equal(widgetStatus('widget:status:off'), false);
  assert.equal(widgetStatus('share:list:{}'), null);
  assert.equal(widgetStatus(''), null);
});

test('웹 브라우저에서는 줄을 붙이지 않는다', () => {
  const s = setup('Mozilla/5.0 Chrome');
  assert.equal(mountWidgetLine(s.host, s.win), null);
  assert.equal(s.host.innerHTML, '');
  assert.deepEqual(s.sent, []);
});

test('앱에서는 상태를 묻고, 폰 위젯 줄(로그인됨/안 됨)을 보이며, 로그인됐을 때만 [위젯 로그아웃] 줄 — 누르면 widget:logout만 보낸다', () => {
  const s = setup('Mozilla/5.0 KPTUAndroid/0.3.0');
  assert.ok(mountWidgetLine(s.host, s.win));
  assert.deepEqual(s.sent, ['widget:status']);
  assert.equal(s.host.innerHTML, '', '답이 오기 전에는 아무 줄도 없다');
  s.message('widget:status:on');
  assert.match(s.host.innerHTML, /폰 위젯.*로그인됨/);
  assert.match(s.host.innerHTML, /data-ps-widget-logout[^>]*>.*위젯 로그아웃/);
  click(s, 'data-ps-widget-logout');
  assert.match(s.host.innerHTML, /data-ps-widget-logout disabled/);
  assert.deepEqual(s.sent, ['widget:status', 'widget:logout']);
  click(s, 'data-ps-widget-logout');
  assert.deepEqual(s.sent, ['widget:status', 'widget:logout'], '보내는 중에는 다시 보내지 않는다');
  s.message('widget:status:off');
  assert.match(s.host.innerHTML, /로그인 안 됨/);
  assert.doesNotMatch(s.host.innerHTML, /위젯 로그아웃/);
  s.doc.listeners.visibilitychange();
  assert.equal(s.sent.at(-1), 'widget:status');
  assert.equal(mountWidgetLine(s.host, s.win), null, '두 번 붙이지 않는다');
});

test('앱 다리는 widget: 글을 허용 Origin 최상위 화면에서만 받는다', () => {
  const kt = readFileSync(new URL('../android-app/app/src/main/java/kr/or/kptu/work/MainActivity.kt', import.meta.url), 'utf8');
  assert.match(kt, /if \(!isMainFrame \|\| sourceOrigin\.toString\(\) !in ShellRules\.ALLOWED_ORIGINS\) return@addWebMessageListener/);
  assert.match(kt, /else if \(data\.startsWith\("widget:"\)\) onWidgetMessage\(data, reply\)/);
  assert.doesNotMatch(kt, /postMessage\([^)]*(refresh|access)_?token/i, '위젯 토큰을 웹으로 보내지 않는다');
});
