// FILES-폰보기끌기 ③(S51-20, 요청함 11/06 01:12, 시안 docs/design/mockups/files-phone-grid-two-drag.html ③): 꾹 눌러 끌기 — 손가락 하나 터치 공용 부품.
// - 꾹 누르면(HOLD_MS, 그동안 SLOP 넘게 움직이면 보통 굴리기) 집어 든다. 그대로 떼면 hold(item)(지금처럼 고르기·메뉴), 움직이면 끌기:
//   손가락을 따라 작은 조각(.td-ghost)이 움직이고, 화면(또는 굴러가는 칸) 위·아래 끝 EDGE px 안이면 저절로 굴린다.
//   손가락 아래 요소를 over(item, el)로 알려 받는 화면이 점선 표시를 하고, 떼면 drop(item, el, x, y). 무엇을 집고 어디에 놓을지는 화면(상태 주인)이 정한다.
// - 브라우저의 길게 누르기 메뉴(contextmenu)는 화면이 holding()으로 물어 막는다(누르고 있는 동안은 이 부품이 맡음, armNow()로 바로 집어 듦).
// - 마우스·펜은 건드리지 않는다(PC는 HTML 끌어 놓기 그대로). 기기 저장 없음.
export const HOLD_MS = 380, SLOP = 10, EDGE = 56, EDGE_MAX = 16;
// 끝에 가까울수록 빠르게(1~EDGE_MAX px/프레임). 위쪽은 음수, 아래쪽은 양수, 그 밖은 0. 화면 없이 시험한다.
export function edgeSpeed(y, top, bottom, edge = EDGE, max = EDGE_MAX) {
  const Y = Number(y), T = Number(top), B = Number(bottom);
  if (![Y, T, B].every(Number.isFinite) || B - T < edge * 2) return 0;
  if (Y < T + edge) return -Math.max(1, Math.round(max * Math.min(1, (T + edge - Y) / edge)));
  if (Y > B - edge) return Math.max(1, Math.round(max * Math.min(1, (Y - (B - edge)) / edge)));
  return 0;
}
export const moved = (x0, y0, x, y, slop = SLOP) => Math.hypot(x - x0, y - y0) > slop;

// el: 손짓을 받을 칸. pick(target) → 집을 것({label, ...}) 또는 null. hold(item): 움직이지 않고 뗌. over(item, el|null): 끄는 동안 손가락 아래.
// drop(item, el|null, x, y): 놓음. cancel(item): 끄다가 취소. scroller(el) → 저절로 굴릴 칸(없으면 화면). enabled(): 지금 받을지.
export function bindTouchDrag(el, {pick = () => null, hold = () => {}, over = () => {}, drop = () => {}, cancel = () => {}, scroller = () => null, enabled = () => true, holdMs = HOLD_MS} = {}) {
  if (!el) return {holding: () => false, armNow: () => {}, off: () => {}};
  let s = null;
  const doc = el.ownerDocument || document, win = doc.defaultView || window;
  const under = () => { const g = s?.ghost; if (g) g.hidden = true; const t = doc.elementFromPoint(s.x, s.y); if (g) g.hidden = false; return t; };
  const arm = () => {
    if (!s || s.armed) return;
    clearTimeout(s.timer);
    const item = pick(s.target);
    if (!item) { s = null; return; }
    s.item = item; s.armed = true;
    try { win.navigator?.vibrate?.(12); } catch { /* 떨림 없음 */ }
  };
  const place = () => { if (s?.ghost) s.ghost.style.transform = `translate(${Math.round(s.x + 12)}px, ${Math.round(s.y - 28)}px)`; };
  const tick = () => {
    if (!s?.drag) return;
    const t = under(), box = scroller(t);
    const r = box ? box.getBoundingClientRect() : {top: 0, bottom: win.innerHeight};
    const v = edgeSpeed(s.y, r.top, r.bottom);
    if (v) { (box || win).scrollBy(0, v); over(s.item, under()); }
    s.raf = win.requestAnimationFrame(tick);
  };
  const clear = () => { if (!s) return; clearTimeout(s.timer); if (s.raf) win.cancelAnimationFrame(s.raf); s.ghost?.remove(); };
  const start = e => {
    if (s) { const was = s; clear(); s = null; if (was.drag) cancel(was.item); }
    if (e.touches.length !== 1 || !enabled()) return;
    const t = e.touches[0];
    s = {x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY, target: e.target, armed: false, drag: false};
    s.timer = setTimeout(arm, holdMs);
  };
  const move = e => {
    if (!s) return;
    if (e.touches.length !== 1) { const was = s; clear(); s = null; if (was.drag) cancel(was.item); return; }
    const t = e.touches[0]; s.x = t.clientX; s.y = t.clientY;
    if (!s.armed) { if (moved(s.x0, s.y0, s.x, s.y)) { clearTimeout(s.timer); s = null; } return; }
    if (e.cancelable) e.preventDefault();
    if (!s.drag) {
      if (!moved(s.x0, s.y0, s.x, s.y, SLOP / 2)) return;
      s.drag = true;
      const g = doc.createElement('div');
      g.className = 'td-ghost'; g.setAttribute('aria-hidden', 'true'); g.textContent = s.item.label || '';
      doc.body.append(g); s.ghost = g;
      s.raf = win.requestAnimationFrame(tick);
    }
    place();
    over(s.item, under());
  };
  const end = e => {
    if (!s) return;
    const was = s;
    if (was.drag) { const t = under(); clear(); s = null; if (e.cancelable) e.preventDefault(); drop(was.item, t, was.x, was.y); return; }
    clear(); s = null;
    if (was.armed) { if (e.cancelable) e.preventDefault(); hold(was.item); }
  };
  const stop = () => { if (!s) return; const was = s; clear(); s = null; if (was.drag) cancel(was.item); };
  el.addEventListener('touchstart', start, {passive: true});
  el.addEventListener('touchmove', move, {passive: false});
  el.addEventListener('touchend', end, {passive: false});
  el.addEventListener('touchcancel', stop, {passive: true});
  return {
    holding: () => !!s,
    armNow: arm,
    off: () => { stop(); el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', stop); },
  };
}
