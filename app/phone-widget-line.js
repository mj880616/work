// APP-폰앱새로 ③ 폰 위젯 로그아웃 줄(설계 docs/design/phone-widget-auth.md 5절 폐기 1, 결정 W-D5).
// 폰 앱(KPTUAndroid)에서만, 내 프로필 '계정' 장에 줄 묶음으로 보인다. 웹 브라우저에서는 아무것도 하지 않는다.
// 앱의 바 색 다리(KPTUAppShell, 허용 Origin의 최상위 화면에만 보임)로 'widget:status'를 묻고 'widget:logout'을 보낸다.
// 위젯 토큰은 앱(Android Keystore)에만 있고 이 화면은 켜짐/꺼짐만 받는다. 이 화면의 로그인(웹 세션)은 건드리지 않는다.
import {groupHtml, infoRow, actionRow} from './settings-list.mjs';

const BRIDGE = 'KPTUAppShell';

/** 앱이 보낸 글 → true(위젯 로그인됨) / false(없음) / null(위젯 소식이 아님). */
export function widgetStatus(data) {
  if (data === 'widget:status:on') return true;
  if (data === 'widget:status:off') return false;
  return null;
}

// S71-36: '계정' 장의 줄 묶음(공용 설정 줄): '폰 위젯 · 로그인됨/로그인 안 됨' 한 줄, 로그인돼 있을 때만 '위젯 로그아웃' 줄.
export function mountWidgetLine(host, win = window) {
  if (!host || host.querySelector?.('[data-ps-widget-state]')) return null;
  if (!/KPTUAndroid/i.test(win.navigator?.userAgent || '')) return null;
  const bridge = win[BRIDGE];
  if (!bridge || typeof bridge.postMessage !== 'function' || typeof bridge.addEventListener !== 'function') return null;
  const doc = host.ownerDocument || win.document;
  const send = message => { try { bridge.postMessage(message); } catch { /* 다리가 사라진 화면 */ } };
  let on = null, busy = false;
  const render = () => {
    if (on === null) { host.innerHTML = ''; return; }
    host.innerHTML = groupHtml([
      infoRow({label: '폰 위젯', desc: on ? '로그인됨' : '로그인 안 됨', attrs: {'data-ps-widget-state': on ? 'on' : 'off'}}),
      on && actionRow({label: '위젯 로그아웃', disabled: busy, attrs: {class: 'ps-widget-logout', 'data-ps-widget-logout': true}}),
    ]);
  };
  bridge.addEventListener('message', event => {
    const next = widgetStatus(typeof event?.data === 'string' ? event.data : '');
    if (next !== null) { on = next; busy = false; render(); }
  });
  host.addEventListener('click', event => {
    if (!event.target.closest?.('[data-ps-widget-logout]') || busy) return;
    busy = true; render(); send('widget:logout');
  });
  // 프로필을 다시 볼 때(앱으로 돌아옴) 위젯 로그인이 바뀌었을 수 있다: 다시 묻는다.
  doc.addEventListener?.('visibilitychange', () => { if (doc.visibilityState === 'visible') send('widget:status'); });
  send('widget:status');
  return host;
}
