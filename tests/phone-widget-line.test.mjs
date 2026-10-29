// APP-폰앱새로 ③: 내 프로필의 [위젯 로그아웃] 줄(app/phone-widget-line.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {widgetStatus, mountWidgetLine} from '../app/phone-widget-line.js';

class El {
  constructor(tag, doc) { this.tag = tag; this.ownerDocument = doc; this.children = []; this.listeners = {}; this.className = ''; this.textContent = ''; this.disabled = false;
    const self = this; this.classList = {toggle(name, on) { const set = new Set(self.className.split(' ').filter(Boolean)); if (on) set.add(name); else set.delete(name); self.className = [...set].join(' '); }, contains(name) { return self.className.split(' ').includes(name); }}; }
  append(...kids) { this.children.push(...kids); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  querySelector(sel) { const name = sel.slice(1); const walk = el => { for (const c of el.children) { if (c.className?.split(' ').includes(name)) return c; const f = walk(c); if (f) return f; } return null; }; return walk(this); }
}

function setup(ua) {
  const doc = {listeners: {}, visibilityState: 'visible', createElement(tag) { return new El(tag, doc); }, addEventListener(t, fn) { this.listeners[t] = fn; }};
  const sent = [];
  let onMessage = null;
  const win = {navigator: {userAgent: ua}, document: doc, KPTUAppShell: {postMessage: m => sent.push(m), addEventListener: (t, fn) => { onMessage = fn; }}};
  const host = new El('div', doc);
  return {doc, win, host, sent, message: data => onMessage({data})};
}

test('widgetStatus는 앱이 보낸 두 글만 읽는다', () => {
  assert.equal(widgetStatus('widget:status:on'), true);
  assert.equal(widgetStatus('widget:status:off'), false);
  assert.equal(widgetStatus('share:list:{}'), null);
  assert.equal(widgetStatus(''), null);
});

test('웹 브라우저에서는 줄을 붙이지 않는다', () => {
  const s = setup('Mozilla/5.0 Chrome');
  assert.equal(mountWidgetLine(s.host, s.win), null);
  assert.equal(s.host.children.length, 0);
  assert.deepEqual(s.sent, []);
});

test('앱에서는 상태를 묻고, 켜짐일 때만 보이며, 누르면 widget:logout만 보낸다', () => {
  const s = setup('Mozilla/5.0 KPTUAndroid/0.3.0');
  const line = mountWidgetLine(s.host, s.win);
  assert.ok(line);
  assert.deepEqual(s.sent, ['widget:status']);
  const button = line.children[1];
  assert.ok(line.classList.contains('hidden') && button.classList.contains('hidden'));
  s.message('widget:status:on');
  assert.ok(!line.classList.contains('hidden') && !button.classList.contains('hidden'));
  button.listeners.click();
  assert.equal(button.disabled, true);
  assert.deepEqual(s.sent, ['widget:status', 'widget:logout']);
  s.message('widget:status:off');
  assert.ok(line.classList.contains('hidden') && button.classList.contains('hidden'));
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
