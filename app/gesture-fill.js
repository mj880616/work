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
const barTopOf = viewH => { const bar = document.querySelector('nav.mobile-tabs'); const r = bar?.getClientRects().length ? bar.getBoundingClientRect() : null; return r && r.top < viewH ? r.top : viewH; };
function paint(el) {
  if (!el.isConnected) { hosts.delete(el); return; }
  const on = !!TOUCH?.matches && el.getClientRects().length > 0;
  el.style.removeProperty('min-height'); el.style.removeProperty('margin-bottom');
  if (!on) return;
  const rect = el.getBoundingClientRect(), viewH = window.visualViewport?.height || window.innerHeight;
  const {h, pull} = fillHeight({viewH, barTop: barTopOf(viewH), top: rect.top + window.scrollY, own: rect.height, ...belowOf(el)});
  // 높이·아래 여백 당김은 이 부품만 쓰는 칸의 inline min-height·margin-bottom 한 곳(화면 CSS의 min-height보다 앞선다).
  if (h) el.style.minHeight = h + 'px';
  if (pull) el.style.marginBottom = (px(getComputedStyle(el).marginBottom) - pull) + 'px';
}
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
  return () => { hosts.delete(el); el.classList.remove('gesture-fill'); el.style.removeProperty('min-height'); el.style.removeProperty('margin-bottom'); };
}
