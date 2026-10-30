// WIDGET-여러개 ①: 폰 앱 홈 위젯 [업데이트]·[할 일]·[노트] 칸이 여는 쓰기 창.
// 폰 앱(KPTUAndroid)에서만 붙는다. 웹 브라우저에서는 아무것도 하지 않는다.
// 1) 앱이 웹2를 새로 열 때는 주소 ?write=<종류>로 온다. 읽은 뒤 주소에서 지운다(새로고침해도 다시 열리지 않게).
// 2) 웹2가 이미 떠 있으면 앱이 다리(KPTUAppShell, 허용 Origin의 최상위 화면에만 보임)로 'write:open:<종류>'를 보낸다
//    (화면을 다시 불러오지 않아 쓰던 글이 사라지지 않는다). 이 화면은 붙을 때 'write:hello'로 받을 준비를 알린다.
// 창은 상단 [+ 추가]와 같은 것(topbar-actions.js의 KPTUQuickWrite)이고 저장 길도 그대로다. 앱은 토큰·글을 보지 않는다.
const BRIDGE = 'KPTUAppShell';
const KINDS = ['update', 'task', 'note'];
const OPEN = /^write:open:([a-z]{1,16})$/;

/** 허용된 종류만 돌려준다. */
export function writeKind(value) {
  return KINDS.includes(value) ? value : null;
}

/** 앱이 보낸 글에서 종류를 꺼낸다. 모양이 다르면 null. */
export function bridgeKind(data) {
  const m = OPEN.exec(typeof data === 'string' ? data : '');
  return m ? writeKind(m[1]) : null;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function startWidgetWrite(win = window, {wait = sleep, tries = 100} = {}) {
  if (win.__KPTU_WIDGET_WRITE__) return false;
  if (!/KPTUAndroid/i.test(win.navigator?.userAgent || '')) return false;
  win.__KPTU_WIDGET_WRITE__ = true;
  let busy = false;
  // 첫 화면·로그인 확인이 끝나기 전에 오면(앱을 막 연 경우) 작업공간이 준비될 때까지 기다린다(최대 약 10초).
  async function open(kind) {
    if (busy) return;
    busy = true;
    try {
      for (let i = 0; i < tries && !(win.KPTUQuickWrite && win.__KPTU_TEAM_READY_STATE__ === 'workspace'); i++) await wait(100);
      if (win.KPTUQuickWrite && win.__KPTU_TEAM_READY_STATE__ === 'workspace') await win.KPTUQuickWrite.open(kind);
    } catch { /* 창을 열지 못하면 [+ 추가]의 안내 줄이 알린다. */ }
    finally { busy = false; }
  }
  try {
    const url = new URL(win.location.href);
    if (url.searchParams.has('write')) {
      const kind = writeKind(url.searchParams.get('write'));
      url.searchParams.delete('write');
      win.history.replaceState(win.history.state, '', url);
      if (kind) void open(kind);
    }
  } catch { /* 주소를 못 읽어도 다리 길은 그대로 쓴다. */ }
  const bridge = win[BRIDGE];
  if (bridge && typeof bridge.postMessage === 'function' && typeof bridge.addEventListener === 'function') {
    bridge.addEventListener('message', event => { const kind = bridgeKind(event?.data); if (kind) void open(kind); });
    try { bridge.postMessage('write:hello'); } catch { /* 다리가 사라진 화면 */ }
  }
  return true;
}

if (typeof window !== 'undefined' && window.document) startWidgetWrite();
