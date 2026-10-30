// APP-당겨서새로고침(요청함 10/30 14:07): 폰 앱(KPTUAndroid)의 '당겨서 새로고침'을 웹이 켜고 끈다. 웹 브라우저에서는 아무것도 하지 않는다.
// 앱(SwipeRefreshLayout)은 손가락을 댈 때마다 당기기를 끄고, 이 화면이 그 손가락에 대해 'pull:on'을 보낼 때만 당기기를 받는다.
// 켜는 때: 화면 맨 위이고, 손가락 아래 칸 안 스크롤 목록이 내려가 있지 않고, 포스트잇 판·열린 창(아래에서 올라온 창 포함)이 없고, 글을 쓰는 중이 아닐 때.
// 당긴 뒤에는 앱이 KPTUPullRefresh.run()을 부른다: 저장 안 한 글이 있으면 먼저 묻고(새 버전 안내 [새로고침]과 같은 확인, version-notice.js),
// 같은 주소로 다시 연다(location.reload). 다리는 기존 KPTUAppShell(허용 Origin 최상위 화면만)이다.
const BRIDGE = 'KPTUAppShell';
const EDITABLE = /^(INPUT|TEXTAREA|SELECT)$/;
const NO_PULL = '.nb-board,.nb-scroll,.nb-card,[data-no-pull]';
const OPEN_LAYER = 'dialog[open],[role="dialog"],[aria-modal="true"],.modal:not(.hidden),#edWindow:not(.hidden)';

const shown = el => !!el && !el.hidden && !el.closest?.('.hidden,[hidden]') && el.getClientRects?.().length > 0;

/** 이 손가락(target)에 당겨서 새로고침을 켜도 되는지. */
export function pullAllowed(target, doc = document, win = window) {
  if ((win.scrollY || doc.scrollingElement?.scrollTop || 0) > 0) return false;
  const active = doc.activeElement;
  if (active && active !== doc.body && (active.isContentEditable || EDITABLE.test(active.tagName || ''))) return false;
  if ([...doc.querySelectorAll(OPEN_LAYER)].some(shown)) return false;
  if (win.KPTUMobileMenu?.isOpen?.()) return false;
  for (let el = target; el && el !== doc.body && el !== doc.documentElement; el = el.parentElement) {
    if (el.matches?.(NO_PULL)) return false;
    if (el.scrollTop > 0) return false;
  }
  return true;
}

export function startPullRefresh(win = window) {
  if (win.__KPTU_PULL_REFRESH__) return false;
  if (!/KPTUAndroid/i.test(win.navigator?.userAgent || '')) return false;
  const bridge = win[BRIDGE];
  if (!bridge || typeof bridge.postMessage !== 'function') return false;
  win.__KPTU_PULL_REFRESH__ = true;
  const doc = win.document;
  doc.addEventListener('touchstart', event => {
    let on = false;
    try { on = event.touches?.length === 1 && pullAllowed(event.target, doc, win); } catch { on = false; }
    try { bridge.postMessage(on ? 'pull:on' : 'pull:off'); } catch { /* 다리가 사라진 화면 */ }
  }, {capture: true, passive: true});
  win.KPTUPullRefresh = {
    run() {
      const guard = win.KPTUReloadGuard?.allow;
      if (typeof guard === 'function' && !guard()) return 'cancel';
      win.location.reload();
      return 'reload';
    },
  };
  return true;
}

if (typeof window !== 'undefined' && window.document) startPullRefresh();
