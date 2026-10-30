// APP-폰앱새로 ③ 위젯 자동 로그인(설계 docs/design/phone-widget-auth.md 12절).
// 폰 앱(KPTUAndroid)에서만, 로그인된 웹2 화면이 뜬 뒤 붙는다. 웹 브라우저에서는 아무것도 하지 않는다.
// 앱의 다리(KPTUAppShell, 허용 Origin의 최상위 화면에만 보임)로 'widget:ready'(이 화면은 로그인됨)를 알리고,
// 앱이 'widget:mint'를 보내면 auth-handoff widget_seal로 위젯 전용 새 세션의 봉인만 받아 'widget:handoff:<봉인>'으로 넘긴다.
// 이 화면의 세션(웹 세션)은 넘기지도 바꾸지도 않는다. 봉인은 서버 키로만 열리고 1회용·5분이다. 원문 토큰은 다루지 않는다.
const BRIDGE = 'KPTUAppShell';
const ENDPOINT = 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/auth-handoff';
const HANDOFF = /^[A-Za-z0-9_-]{16,32768}$/;

/** 서버 응답에서 봉인만 꺼낸다. 모양이 다르면 null. */
export function sealedToken(data) {
  const token = data && typeof data === 'object' ? data.token : null;
  return typeof token === 'string' && HANDOFF.test(token) ? token : null;
}

export function startWidgetAuth(win = window) {
  if (win.__KPTU_WIDGET_AUTH__) return false;
  if (!/KPTUAndroid/i.test(win.navigator?.userAgent || '')) return false;
  const bridge = win[BRIDGE];
  if (!bridge || typeof bridge.postMessage !== 'function' || typeof bridge.addEventListener !== 'function') return false;
  win.__KPTU_WIDGET_AUTH__ = true;
  const send = message => { try { bridge.postMessage(message); } catch { /* 다리가 사라진 화면 */ } };
  let busy = false;
  async function mint() {
    if (busy) return;
    busy = true;
    try {
      const runtime = win.KPTURuntime?.session;
      const ok = runtime ? await runtime.ensure().catch(() => false) : false;
      const access = ok ? runtime.read()?.access_token : '';
      if (!access) { send('widget:mint:fail'); return; }
      const r = await win.fetch(ENDPOINT, {
        method: 'POST', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: {Authorization: 'Bearer ' + access, 'Content-Type': 'application/json'},
        body: JSON.stringify({action: 'widget_seal'})
      });
      const token = r.ok ? sealedToken(await r.json().catch(() => null)) : null;
      send(token ? 'widget:handoff:' + token : 'widget:mint:fail');
    } catch {
      send('widget:mint:fail');
    } finally {
      busy = false;
    }
  }
  bridge.addEventListener('message', event => {
    if (event?.data === 'widget:mint') mint();
  });
  send('widget:ready');
  return true;
}

if (typeof window !== 'undefined') startWidgetAuth();
