// APP-당겨서새로고침(요청함 10/30 14:07): 폰 앱(KPTUAndroid)의 '당겨서 새로고침'을 웹이 켜고 끈다. 웹 브라우저에서는 아무것도 하지 않는다.
// 앱(SwipeRefreshLayout)은 손가락을 댈 때마다 당기기를 끄고, 이 화면이 그 손가락에 대해 'pull:on'을 보낼 때만 당기기를 받는다.
// 켜는 때: 화면 맨 위이고, 손가락 아래 칸 안 스크롤 목록이 내려가 있지 않고, 포스트잇 판·열린 창(아래에서 올라온 창 포함)이 없고, 글을 쓰는 중이 아닐 때.
// 당긴 뒤에는 앱이 KPTUPullRefresh.run()을 부른다: 저장 안 한 글이 있으면 먼저 묻고(새 버전 안내 [새로고침]과 같은 확인, version-notice.js),
// 같은 주소로 다시 연다(location.reload). 다리는 기존 KPTUAppShell(허용 Origin 최상위 화면만)이다.
const BRIDGE = 'KPTUAppShell';
const EDITABLE = /^(INPUT|TEXTAREA|SELECT)$/;
const NO_PULL = '.nb-board,.nb-scroll,.nb-card,[data-no-pull]';
const OPEN_LAYER = 'dialog[open],[role="dialog"],[aria-modal="true"],.modal:not(.hidden),#edWindow:not(.hidden)';

// S68-59(사용자 11/23 16:17 "왼쪽으로 스와이프 여전히 안됨"): 옆으로 미는 손가락은 당기기가 아니다.
// 오른손 엄지로 줄을 왼쪽으로 밀면 손끝이 호를 그리며 조금씩 아래로 내려간다(오른쪽으로 밀면 위로 올라간다). 앱 껍데기(SwipeRefreshLayout)는
// 가로·세로를 견주지 않고 아래로 몇 px만 내려가도 '당기기'로 보고 손가락을 웹에서 빼앗았다(웹에는 pointercancel) — 그래서 맨 위에서
// 왼쪽 밀기만 늘 끊겼다. 손가락이 SIDE_PX 넘게 움직인 첫 순간 가로가 세로보다 크면 그 손가락은 'pull:off'로 바꿔 앱이 가져가지 않게 한다.
// (새 앱은 껍데기에서도 같은 판정을 한다 — ShellRules.pullAxis. 이 쪽은 옛 앱에서도 바로 듣게 하는 길.)
export const SIDE_PX = 6;
/** 이 손가락이 옆으로 가는 중인지: 아직 모름(null) · 옆(true) · 위아래(false). 처음 SIDE_PX를 넘은 순간 정한다. */
export function sideways(dx, dy) {
  const ax = Math.abs(Number(dx) || 0), ay = Math.abs(Number(dy) || 0);
  if (Math.max(ax, ay) < SIDE_PX) return null;
  return ax > ay;
}

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
  // 지금 손가락: pull:on을 보냈을 때만 시작점을 적고, 갈래(옆·위아래)를 한 번 정한다.
  let finger = null;
  doc.addEventListener('touchstart', event => {
    let on = false;
    try { on = event.touches?.length === 1 && pullAllowed(event.target, doc, win); } catch { on = false; }
    const t = event.touches?.[0];
    finger = on && t ? {x: t.clientX, y: t.clientY} : null;
    try { bridge.postMessage(on ? 'pull:on' : 'pull:off'); } catch { /* 다리가 사라진 화면 */ }
  }, {capture: true, passive: true});
  doc.addEventListener('touchmove', event => {
    const t = event.touches?.[0];
    if (!finger || !t) return;
    const side = sideways(t.clientX - finger.x, t.clientY - finger.y);
    if (side === null) return;
    finger = null;
    if (side) { try { bridge.postMessage('pull:off'); } catch { /* 다리가 사라진 화면 */ } }
  }, {capture: true, passive: true});
  win.KPTUPullRefresh = {
    run() {
      const guard = win.KPTUReloadGuard?.allow;
      if (typeof guard === 'function' && !guard()) return 'cancel';
      // APP-다시열림: 앱 기록에 '당겨서 새로고침'으로 남긴다(종류만).
      try { bridge.postMessage('reopen:mark:pull'); } catch { /* 다리가 사라진 화면 */ }
      win.location.reload();
      return 'reload';
    },
  };
  return true;
}

if (typeof window !== 'undefined' && window.document) startPullRefresh();
