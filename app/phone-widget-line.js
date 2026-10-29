// APP-폰앱새로 ③ 폰 위젯 로그아웃 줄(설계 docs/design/phone-widget-auth.md 5절 폐기 1, 결정 W-D5).
// 폰 앱(KPTUAndroid)에서만, 내 프로필 '계정' 칸에 작은 줄 하나로 보인다. 웹 브라우저에서는 아무것도 하지 않는다.
// 앱의 바 색 다리(KPTUAppShell, 허용 Origin의 최상위 화면에만 보임)로 'widget:status'를 묻고 'widget:logout'을 보낸다.
// 위젯 토큰은 앱(Android Keystore)에만 있고 이 화면은 켜짐/꺼짐만 받는다. 이 화면의 로그인(웹 세션)은 건드리지 않는다.
const BRIDGE = 'KPTUAppShell';

/** 앱이 보낸 글 → true(위젯 로그인됨) / false(없음) / null(위젯 소식이 아님). */
export function widgetStatus(data) {
  if (data === 'widget:status:on') return true;
  if (data === 'widget:status:off') return false;
  return null;
}

export function mountWidgetLine(host, win = window) {
  if (!host || host.querySelector?.('.ps-widget-line')) return null;
  if (!/KPTUAndroid/i.test(win.navigator?.userAgent || '')) return null;
  const bridge = win[BRIDGE];
  if (!bridge || typeof bridge.postMessage !== 'function' || typeof bridge.addEventListener !== 'function') return null;
  const doc = host.ownerDocument || win.document;
  const line = doc.createElement('span');
  line.className = 'ps-widget-line hidden';
  const label = doc.createElement('span');
  label.className = 'ps-widget-label';
  label.textContent = '폰 위젯 로그인됨';
  const button = doc.createElement('button');
  button.type = 'button';
  // '계정' 칸은 보이는 버튼이 있을 때만 보인다(profile-settings.css). 위젯 로그인이 없으면 버튼도 숨긴다.
  button.className = 'secondary ps-widget-logout hidden';
  button.textContent = '위젯 로그아웃';
  line.append(label, button);
  host.append(line);
  const send = message => { try { bridge.postMessage(message); } catch { /* 다리가 사라진 화면 */ } };
  const show = on => {
    line.classList.toggle('hidden', !on);
    button.classList.toggle('hidden', !on);
    button.disabled = false;
  };
  bridge.addEventListener('message', event => {
    const on = widgetStatus(typeof event?.data === 'string' ? event.data : '');
    if (on !== null) show(on);
  });
  button.addEventListener('click', () => { button.disabled = true; send('widget:logout'); });
  // 프로필을 다시 볼 때(앱으로 돌아옴) 위젯 로그인이 바뀌었을 수 있다: 다시 묻는다.
  doc.addEventListener?.('visibilitychange', () => { if (doc.visibilityState === 'visible') send('widget:status'); });
  send('widget:status');
  return line;
}
