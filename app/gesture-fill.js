// S51-24 UI-빈칸손짓(요청함 11/06 21:52, 시안 docs/design/mockups/folder-focus-continuity.html 왼쪽 두 화면 점선 칸):
// 손짓(두 손가락 벌리기·오므리기, 좌우 밀기)을 받는 칸을 내용이 끝난 아래 빈 곳까지 — 화면 아래(아래 바 바로 위)까지 — 채우는 공용 부품 하나.
// 칸 아래에 있는 것(다른 줄·화면 아래 여백)은 그대로 두고 남는 높이만 칸에 준다(min-height). 내용이 화면보다 길면 아무것도 하지 않는다.
// 손짓 자체는 각 화면의 손짓 부품(folder-pinch.js·밀기)이 그대로 맡고, 이 부품은 칸의 높이만 정한다. 브라우저 확대는 손짓 칸의
// touch-action(folder-tree.css .ft-pinch)이 막으므로, 칸이 아래까지 오면 빈 곳의 두 손가락도 화면 확대가 아니라 그 칸의 손짓이 된다.
const TOUCH = globalThis.matchMedia?.('(pointer:coarse), (max-width:760px)');
const hosts = new Set();
let watching = false;

// 칸 높이 계산(순수 함수, node --test로 시험).
//  viewH: 화면 높이, barTop: 아래 바 위 끝(없으면 viewH), top: 칸 위 끝(문서 기준), own: 칸 내용 높이,
//  sib: 칸 아래에 쌓인 형제 줄 높이, pad: 감싼 칸들의 아래 안쪽 여백 합(하단바 자리 포함).
// 칸 아래에 다른 줄이 없으면 칸을 아래 바 위 끝까지 늘리고, 감싼 칸들의 여백 중 아래 바 자리보다 많은 만큼은 칸 아래 여백을 당겨(음수) 화면이 더 길어지지 않게 한다.
// 아래에 다른 줄이 있으면 그 줄들까지 화면 안에 들어오는 만큼만 늘린다. 내용이 이미 길면 그대로(0).
export function fillHeight({viewH, barTop = viewH, top, own, sib = 0, pad = 0}) {
  const reserve = Math.max(0, viewH - barTop);
  const h = Math.floor(sib > 0 ? viewH - top - sib - pad : barTop - top);
  if (!Number.isFinite(h) || h <= own) return {h: 0, pull: 0};
  return {h, pull: sib > 0 ? 0 : Math.max(0, Math.ceil(pad - reserve))};
}
const px = v => parseFloat(v) || 0;
// 칸 아래에 쌓인 것: 칸 뒤에 오는(아래에 놓인) 형제 줄 높이(sib)와 감싼 칸들의 아래 안쪽 여백(pad). 화면을 채우려고 늘어난 빈 높이(min-height)는 세지 않는다.
function belowOf(el) {
  let sib = 0, pad = 0;
  for (let e = el; e.parentElement && e !== document.body; e = e.parentElement) {
    const eb = e.getBoundingClientRect().bottom;
    if (e !== el) pad += px(getComputedStyle(e).marginBottom);
    for (let s = e.nextElementSibling; s; s = s.nextElementSibling) {
      const cs = getComputedStyle(s);
      if (cs.display === 'none' || cs.position === 'fixed' || cs.position === 'absolute' || !s.getClientRects().length) continue;
      const r = s.getBoundingClientRect();
      if (r.top >= eb - 1 && r.height > 0) sib += r.height + px(cs.marginTop) + px(cs.marginBottom);
    }
    const ps = getComputedStyle(e.parentElement);
    pad += px(ps.paddingBottom) + px(ps.borderBottomWidth);
  }
  return {sib, pad};
}
// 아래 바 위 끝: 맨 아래 탭바만이 아니라 그 위에 겹쳐 놓인 고정 줄(노트·홈의 입력 줄, 보기 바꾸기 줄 등)까지 — 화면 아래에 쌓인 고정 줄 묶음의 맨 위.
// S52-16 NOTE-폴더스크롤: 탭바만 보면 칸을 입력 줄 뒤까지 늘리고 화면 아래 여백을 당겨, 그 사이에 든 마지막 줄들이 입력 줄에 가린 채 스크롤되지 않았다.
// 칸 왼쪽·가운데·오른쪽에서 지금 위 끝 바로 위(2·10·18px, 줄 사이 틈 건너기)를 짚어 맨 위 요소가 고정 줄 안이면 그 줄 위 끝으로 올린다(화면 위 1/3보다 아래인 것만 — 전체 덮는 창은 아님).
const fixedOf = e => { for (; e && e !== document.body && e !== document.documentElement; e = e.parentElement) if (getComputedStyle(e).position === 'fixed') return e; return null; };
function barTopOf(viewH, el) {
  const bar = document.querySelector('nav.mobile-tabs'), r = bar?.getClientRects().length ? bar.getBoundingClientRect() : null;
  let top = r && r.top < viewH ? r.top : viewH;
  const er = el.getBoundingClientRect(), xs = [er.left + 12, (er.left + er.right) / 2, er.right - 12].filter(x => x >= 0 && x < window.innerWidth);
  for (let guard = 0; guard < 8; guard++) {
    let next = top;
    for (const x of xs) for (const d of [2, 10, 18]) {
      const f = fixedOf(document.elementFromPoint(x, top - d));
      if (!f || el.contains(f) || f.contains(el)) continue;
      const fr = f.getBoundingClientRect();
      if (fr.top > viewH / 3 && fr.top < next && fr.bottom >= top - d) next = fr.top;
    }
    if (next >= top) break;
    top = next;
  }
  return top;
}
// 칸 안 내용 높이(늘린 높이 말고): 마지막으로 보이는 안 줄의 아래 끝 + 칸 아래 안쪽 여백. 칸을 줄였다 늘리며 재지 않는다(그러면 화면 스크롤이 잘려 위치가 튄다).
function contentHeight(el, rect) {
  const cs = getComputedStyle(el);
  let bottom = rect.top + px(cs.borderTopWidth) + px(cs.paddingTop);
  for (const c of el.children) {
    const ccs = getComputedStyle(c);
    if (ccs.position === 'fixed' || ccs.position === 'absolute' || !c.getClientRects().length) continue;
    bottom = Math.max(bottom, c.getBoundingClientRect().bottom + px(ccs.marginBottom));
  }
  return bottom + px(cs.paddingBottom) + px(cs.borderBottomWidth) - rect.top;
}
const pulled = new WeakMap();
function paint(el) {
  if (!el.isConnected) { hosts.delete(el); return; }
  const on = !!TOUCH?.matches && el.getClientRects().length > 0;
  const was = pulled.get(el) || 0;
  let h = 0, pull = 0;
  if (on) {
    const rect = el.getBoundingClientRect(), viewH = window.visualViewport?.height || window.innerHeight;
    // 목표 높이를 먼저 정하고(내용 0으로 계산), 내용이 그보다 길 때만 늘리지 않는다. 늘린 칸 안에서 같이 늘어난 줄(1px 안)은 내용으로 치지 않아 늘렸다 줄였다 되풀이하지 않는다.
    const t = fillHeight({viewH, barTop: barTopOf(viewH, el), top: rect.top + window.scrollY, own: 0, ...belowOf(el)});
    if (t.h && contentHeight(el, rect) <= t.h + 1) ({h, pull} = t);
  }
  // 높이·아래 여백 당김은 이 부품만 쓰는 칸의 inline min-height·margin-bottom 한 곳(화면 CSS의 min-height보다 앞선다). 같은 값이면 건드리지 않는다.
  const mh = h ? h + 'px' : '';
  if (el.style.minHeight !== mh) el.style.minHeight = mh;
  if (pull !== was) {
    const base = px(getComputedStyle(el).marginBottom) + was;
    if (pull) { el.style.marginBottom = (base - pull) + 'px'; pulled.set(el, pull); }
    else { el.style.removeProperty('margin-bottom'); pulled.delete(el); }
  }
}
// 화면이 내용을 새로 그린 뒤 스크롤 자리를 되돌리기 직전에 부른다: 칸 높이·여백 당김을 지금 내용에 맞춰 바로 다시 잰다
// (짧은 화면에서 당겨 둔 여백이 남은 채 긴 화면으로 돌아오면 되돌릴 스크롤 자리가 잘리므로).
export function settleGestureAreas() { for (const el of [...hosts]) paint(el); }
let queued = 0;
const paintAll = () => { cancelAnimationFrame(queued); queued = requestAnimationFrame(() => { for (const el of [...hosts]) paint(el); }); };
function watch() {
  if (watching) return;
  watching = true;
  window.addEventListener('resize', paintAll, {passive: true});
  window.visualViewport?.addEventListener?.('resize', paintAll, {passive: true});
  window.addEventListener('kptu:view-changed', paintAll);
  TOUCH?.addEventListener?.('change', paintAll);
  // 내용이 바뀌어 높이가 달라지면 다시 잰다(칸 높이를 바꾼 뒤 같은 값이면 더 바꾸지 않는다).
  if (typeof ResizeObserver === 'function') new ResizeObserver(paintAll).observe(document.body);
}
// el: 손짓을 받는 칸. 한 번 부르면 화면 크기·내용이 바뀔 때마다 다시 잰다. 돌려주는 함수를 부르면 뗀다.
export function fillGestureArea(el) {
  if (!el) return () => {};
  el.classList.add('gesture-fill');
  hosts.add(el); watch(); paintAll();
  return () => { hosts.delete(el); pulled.delete(el); el.classList.remove('gesture-fill'); el.style.removeProperty('min-height'); el.style.removeProperty('margin-bottom'); };
}
