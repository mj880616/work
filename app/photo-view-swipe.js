// PHOTO-크게보기밀기(S57-2): 사진 크게 보기(photo-view.js) 칸 위 한 손가락 밀기. 화면 부품(DOM) 없이 칸 하나와 hooks만 받아서 단위 시험이 가짜 칸으로 돌린다.
import {swipeKind, swipeSide, dragAxis, dragEnd, dragEndX, dragOffsetX, dragOffsetDown} from './photo-viewer-model.mjs';

// PHOTO-크게보기밀기(S57-2): 크게 보기 칸 위 한 손가락 밀기. 방향은 [사진] 메뉴와 같은 dragAxis(세로가 가로의 1.6배 이상이면 세로)로 한 번 정하고, 사진이 손가락을 따라 움직인다.
// 놓을 때: 가로 = 72px 넘게 밀면 앞뒤 사진(없는 쪽은 고무줄처럼 제자리), 세로 = 아래로 120px 넘게(또는 빠른 손짓) 닫기. 움직임이 잡히기 전에 끝난 빠른 손짓은 swipeKind·swipeSide로 본다.
// hooks = {at(), count(), goTo(i)}: 앞뒤 사진이 없는 크게 보기(노트 사진 한 장)는 at 0·count 1이라 가로로 밀면 제자리로 돌아온다.
const still = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
const pageZoomed = () => (globalThis.visualViewport?.scale || 1) > 1.05;
const onControl = target => !!target?.closest?.('button,a,summary,[data-img-retry]');
export function attachStageSwipe(stage, hooks, {closeNow}) {
  let touch = null, busy = false;
  const photo = () => stage.querySelector('.diary-photo');
  const edges = () => ({hasPrev: hooks.at() > 0, hasNext: hooks.at() < hooks.count() - 1});
  const place = (x, y) => { const el = photo(); if (!el) return; el.style.transition = 'none'; el.style.transform = x || y ? `translate(${Math.round(x)}px, ${Math.round(y)}px)` : ''; };
  const settle = () => {
    const el = photo(); if (!el || !(el.style.transform || el.style.opacity)) return;
    el.style.transition = still() ? 'none' : 'transform .18s ease-out'; el.style.transform = ''; el.style.opacity = '';
    setTimeout(() => { if (el.isConnected) el.style.transition = ''; }, 200);
  };
  const closeDown = () => {
    const el = photo();
    if (still() || !el) { closeNow(); return; }
    busy = true;
    el.style.transition = 'transform .16s ease-in, opacity .16s ease-in'; el.style.transform = `translate(0px, ${Math.round(stage.clientHeight || 400)}px)`; el.style.opacity = '0';
    setTimeout(() => { busy = false; closeNow(); }, 160);
  };
  const slideIn = from => {
    const el = photo(); if (!el || still()) return;
    el.style.transition = 'none'; el.style.transform = `translate(${from}px, 0px)`; el.getBoundingClientRect();
    el.style.transition = 'transform .16s ease-out'; el.style.transform = '';
    setTimeout(() => { if (el.isConnected) el.style.transition = ''; }, 200);
  };
  const stepBy = dir => {
    const from = hooks.at(), to = from + dir;
    if (to < 0 || to >= hooks.count()) { settle(); return; }
    const el = photo(), w = Math.round(stage.clientWidth || 360);
    if (still() || !el) { hooks.goTo(to); return; }
    busy = true;
    el.style.transition = 'transform .14s ease-in'; el.style.transform = `translate(${-dir * w}px, 0px)`;
    setTimeout(() => { busy = false; if (hooks.at() === from && hooks.goTo(to)) slideIn(dir * w); else settle(); }, 140);
  };
  const onStart = event => {
    if (busy) { touch = null; return; }
    touch = event.touches.length === 1 && !onControl(event.target) ? {x: event.touches[0].clientX, y: event.touches[0].clientY, t: Date.now(), fingers: 1, axis: null} : null;
    if (!touch) settle();
  };
  const onMove = event => {
    if (!touch) return;
    if (event.touches.length > 1) { touch.fingers = event.touches.length; touch.axis = 'none'; settle(); return; }
    const p = event.touches[0], dx = p.clientX - touch.x, dy = p.clientY - touch.y;
    if (touch.axis === null) touch.axis = dragAxis({dx, dy, fingers: touch.fingers, zoomed: pageZoomed()});
    if (touch.axis === 'y') place(0, dragOffsetDown(dy));
    else if (touch.axis === 'x') place(dragOffsetX(dx, edges()), 0);
  };
  const onEnd = event => {
    const start = touch; touch = null;
    const end = event.changedTouches[0];
    if (!start || !end) { settle(); return; }
    const dx = end.clientX - start.x, dy = end.clientY - start.y;
    if (start.axis === 'y') { if (dragEnd(dy) === 'close') closeDown(); else settle(); return; }
    if (start.axis === 'x') { const k = dragEndX(dx, edges()); if (k === 'back') settle(); else stepBy(k === 'next' ? 1 : -1); return; }
    // 움직임이 잡히기 전에 끝난 빠른 손짓은 [사진] 메뉴와 같은 swipeKind(세로)·swipeSide(가로)로 본다.
    const quick = {dx, dy, dt: Date.now() - start.t, fingers: start.fingers, zoomed: pageZoomed()};
    if (start.axis === null && swipeKind(quick) === 'down') { closeDown(); return; }
    const side = start.axis === null ? swipeSide(quick) : null;
    if (side) stepBy(side === 'next' ? 1 : -1); else settle();
  };
  const onCancel = () => { touch = null; settle(); };
  const opt = {passive: true};
  stage.addEventListener('touchstart', onStart, opt); stage.addEventListener('touchmove', onMove, opt);
  stage.addEventListener('touchend', onEnd, opt); stage.addEventListener('touchcancel', onCancel, opt);
  // 브라우저는 두 손가락 확대만 맡고(touch-action) 한 손가락 끌기는 이 화면이 받는다. 화면을 이미 확대해 둔 때만 브라우저가 끌기도 맡는다.
  const vv = globalThis.visualViewport;
  const area = () => { stage.style.touchAction = pageZoomed() ? 'auto' : 'pinch-zoom'; };
  area(); vv?.addEventListener('resize', area);
  return () => { vv?.removeEventListener('resize', area); };
}
