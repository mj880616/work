// PHOTO-글속사진확대(S73-13): 사진 크게 보기 안 확대·축소 손동작 하나. [사진] 메뉴 크게 보기(photo-strip.js)에 있던 것을 그대로 꺼내
// 글 읽기 화면의 크게 보기(photo-view.js — 노트 본문·하루 기록 본문·노트 첨부·잊지 말기·조직 기록·사업 보고·자료 사진)도 함께 쓴다.
// 손동작(PHOTO-전체화면확대 그대로): 두 손가락 벌리기·오므리기, 두 번 톡(다시 두 번 톡 = 원래 크기), PC는 휠·더블클릭, 확대 중 한 손가락(마우스 끌기)으로 사진 안 옮기기.
// 배율·옮긴 거리는 메모리에만 둔다. 변형은 그 장의 그림 칸(.diary-photo)에 건다. 계산은 photo-viewer-model.mjs(단위 시험) 몫.
// area: 손동작을 받는 칸(크기 기준·가운데), photo(): 지금 보는 그림 칸, can(): 지금 확대할 수 있는지(동영상·그림 없음이면 false),
// onZoom(zoomed): 배율이 바뀔 때마다(확대됨 표시·원본 받기는 부르는 쪽 몫).
// 돌려주는 것: zoomed()(확대 중 또는 두 손가락 중), pinching(), reset()(다른 장으로 넘길 때·닫을 때), reclamp()(큰 그림이 늦게 뜬 뒤 범위 다시 맞춤),
// follow(ratio)·release()(글 속 사진에서 시작한 두 손가락 벌리기를 이어받기 — 열린 순간 손가락 거리 대비 지금 거리 비율).
import {ZOOM_ONE, isZoomed, clampPan, zoomAt, pinchTo, panBy, zoomToggle, wheelScale, isTap, isDoubleTap, settleZoom, zoomTransform} from './photo-viewer-model.mjs';

const still = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
const onControl = target => !!target?.closest?.('button,a,video,summary,[data-img-retry]');

export function attachPhotoZoom(area, {photo, can = () => true, onZoom = () => {}}) {
  let zoom = {...ZOOM_ONE}, zoomEl = null, pinch = null, pan = null, tapStart = null, lastTap = null, lastTouchAt = -Infinity, mouse = null, handoff = null;
  const zoomable = () => !!can() && !!photo();
  const centerOf = () => { const r = area.getBoundingClientRect(); return {cx:r.left + r.width / 2, cy:r.top + r.height / 2}; };
  const focal = (x, y) => { const {cx, cy} = centerOf(); return {x:x - cx, y:y - cy}; };
  const zoomBox = () => {
    const el = photo(), pic = el?.querySelector('img.diary-viewer-hires') || el?.querySelector('img:not(.img-slot-preview):not(.diary-viewer-hires)');
    return {W:area.clientWidth, H:area.clientHeight, nw:pic?.naturalWidth || 0, nh:pic?.naturalHeight || 0};
  };
  function applyZoom(z, animate = false) {
    const el = photo();
    if (zoomEl && zoomEl !== el) { zoomEl.style.transform = ''; zoomEl.style.transition = ''; }
    zoom = z; zoomEl = el;
    if (el) { el.style.transition = animate && !still() ? 'transform .2s ease-out' : 'none'; el.style.transform = zoomTransform(z); }
    onZoom(isZoomed(z));
  }
  function reset() {
    pinch = pan = mouse = tapStart = lastTap = handoff = null;
    if (zoomEl) { zoomEl.style.transform = ''; zoomEl.style.transition = ''; }
    zoom = {...ZOOM_ONE}; zoomEl = null;
    onZoom(false);
  }
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = t => focal((t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2);
  area.addEventListener('touchstart', event => {
    lastTouchAt = Date.now();
    const t = event.touches;
    if (t.length === 2 && zoomable() && !onControl(event.target)) { pinch = {z0:{...zoom}, d0:dist(t), m0:mid(t)}; pan = tapStart = null; }
    else if (t.length === 1 && zoomable() && !onControl(event.target)) {
      tapStart = {x:t[0].clientX, y:t[0].clientY, t:Date.now()};
      pan = isZoomed(zoom) ? {z0:{...zoom}, x:t[0].clientX, y:t[0].clientY} : null;
    } else { pinch = pan = tapStart = null; }
  }, {passive:true});
  area.addEventListener('touchmove', event => {
    const t = event.touches;
    if (pinch && t.length === 2) { if (event.cancelable) event.preventDefault(); applyZoom(pinchTo(pinch.z0, pinch.d0, pinch.m0, dist(t), mid(t), zoomBox())); }
    else if (pan && t.length === 1) { if (event.cancelable) event.preventDefault(); applyZoom(panBy(pan.z0, t[0].clientX - pan.x, t[0].clientY - pan.y, zoomBox())); }
  }, {passive:false});
  area.addEventListener('touchend', event => {
    lastTouchAt = Date.now();
    const t = event.touches;
    if (pinch) {
      if (t.length >= 2) return;
      pinch = null; tapStart = lastTap = null;
      applyZoom(settleZoom(zoom, zoomBox()), true);
      pan = t.length === 1 && isZoomed(zoom) ? {z0:{...zoom}, x:t[0].clientX, y:t[0].clientY} : null;
      return;
    }
    if (t.length) return;
    pan = null;
    const s = tapStart, p = event.changedTouches[0]; tapStart = null;
    if (!s || !p) return;
    const cur = {x:p.clientX, y:p.clientY, t:Date.now()};
    if (!isTap({dx:cur.x - s.x, dy:cur.y - s.y, dt:cur.t - s.t})) { lastTap = null; return; }
    if (isDoubleTap(lastTap, cur)) {
      lastTap = null;
      if (event.cancelable) event.preventDefault(); // 두 번째 톡이 누르기·더블클릭으로 또 오지 않게
      const f = focal(cur.x, cur.y);
      applyZoom(zoomToggle(zoom, f.x, f.y, zoomBox()), true);
    } else lastTap = cur;
  }, {passive:false});
  area.addEventListener('touchcancel', () => { pinch = pan = tapStart = null; if (isZoomed(zoom)) applyZoom(settleZoom(zoom, zoomBox())); }, {passive:true});
  // PC: 휠 = 마우스 아래 점을 확대·축소(트랙패드 가로 밀기는 그대로 넘기기), 더블클릭 = 확대 ↔ 원래 크기, 확대 중 끌기 = 사진 안 움직이기.
  area.addEventListener('wheel', event => {
    if (!zoomable() || (!event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY))) return;
    event.preventDefault();
    const f = focal(event.clientX, event.clientY), s = wheelScale(zoom.s, event.deltaY, event.deltaMode);
    applyZoom(s < 1.02 ? {...ZOOM_ONE} : zoomAt(zoom, s, f.x, f.y, zoomBox()));
  }, {passive:false});
  area.addEventListener('dblclick', event => {
    if (Date.now() - lastTouchAt < 800 || !zoomable() || onControl(event.target)) return;
    event.preventDefault();
    const f = focal(event.clientX, event.clientY);
    applyZoom(zoomToggle(zoom, f.x, f.y, zoomBox()), true);
  });
  area.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !isZoomed(zoom) || onControl(event.target)) return;
    event.preventDefault();
    mouse = {z0:{...zoom}, x:event.clientX, y:event.clientY, id:event.pointerId};
    try { area.setPointerCapture(event.pointerId); } catch { /* 잡지 못해도 끌기는 된다 */ }
  });
  area.addEventListener('pointermove', event => { if (mouse && event.pointerId === mouse.id) applyZoom(panBy(mouse.z0, event.clientX - mouse.x, event.clientY - mouse.y, zoomBox())); });
  // 확대 중 끌기를 놓은 자리의 누르기(click)는 끌기 끝이지 누르기가 아니다 — 바탕 누르기 = 닫기인 크게 보기(photo-view.js)가 닫히지 않게 삼킨다.
  let draggedAt = -Infinity;
  const mouseUp = event => { if (mouse && event.pointerId === mouse.id) { if (Math.hypot(event.clientX - mouse.x, event.clientY - mouse.y) > 4) draggedAt = Date.now(); mouse = null; } };
  area.addEventListener('click', event => { if (Date.now() - draggedAt < 400) { draggedAt = -Infinity; event.stopPropagation(); event.preventDefault(); } }, true);
  area.addEventListener('pointerup', mouseUp); area.addEventListener('pointercancel', mouseUp);
  area.addEventListener('dragstart', event => { if (event.target?.tagName === 'IMG') event.preventDefault(); });
  return {
    zoomed:() => isZoomed(zoom) || !!pinch || !!handoff,
    pinching:() => !!pinch || !!handoff,
    reset,
    reclamp:() => applyZoom(clampPan(zoom, zoomBox())),
    // 글 속 사진에서 시작한 두 손가락: 손가락은 아직 글 속 사진 위에 있어(터치는 처음 닿은 곳으로만 온다) 그쪽이 비율을 넘겨준다.
    // 가운데를 기준으로 열린 순간의 크기(화면 맞춤)에서 이어 키운다. 놓으면 보통 두 손가락처럼 범위를 맞춘다.
    follow:ratio => { handoff ||= {z0:{...ZOOM_ONE}}; applyZoom(pinchTo(handoff.z0, 1, {x:0, y:0}, Math.max(0.2, Number(ratio) || 1), {x:0, y:0}, zoomBox())); },
    release:() => { if (!handoff) return; handoff = null; applyZoom(settleZoom(zoom, zoomBox()), true); },
  };
}
