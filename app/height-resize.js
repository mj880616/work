import { viewPrefs } from './view-prefs.js';
import { colDevice, colsFor, withCol } from './col-widths-model.mjs';
import { heightStored, heightOf, clampHeight, HEIGHT_STEP } from './height-resize-model.mjs';
// S69-29 UI-창높이끌기(명진 11/24 "창 밑으로도 드래그 가능하게 · 정확히는 높이를· 드래그로 늘릴 수 있게"): 상자(카드) 아래 테두리를 끌어 높이를 정하는 공용 부품.
// 짝: 좌우 칸 경계(split-resize.js)·표 칸 너비(col-resize.js). 모양은 같은 가는 금(마우스를 올리면 보이는 2px 선), 커서만 ↕.
// - 상자 아래 테두리에 손잡이(role=separator, 가로). 끌면 높이가 늘고 줄며, 두 번 누르면(마우스 두 번 누르기·손가락 두 번 누르기) '내용만큼(자동)'으로 돌아간다.
//   키보드: 손잡이에 초점 → ↑/↓ 16px, Home = 자동.
// - 정한 높이는 사람별 화면 설정으로 서버에 둔다: view_prefs.col_widths.<화면>.<칸>[_f](PC·폴드 펼침 따로, col-widths-model.mjs). 그 칸은 40~800 숫자라
//   높이 ÷ 2로 적는다(80~1600px, height-resize-model.mjs). 기기 저장 없음. 읽지 못했거나 값이 없으면 자동.
// - 이 부품은 상자에 CSS 변수(o.varName)와 표시 속성(o.attr, 높이를 정했을 때만)을 두고, 안쪽을 그 높이에 맞추는 규칙(칸 안 굴림 등)은 화면 CSS가 가진다.
const device = () => colDevice(globalThis.innerWidth || 0);
let sheet = false;
function ensureStyle() {
  if (sheet) return; sheet = true;
  const style = document.createElement('style'); style.dataset.kptuHeightResize = '';
  style.textContent = `.height-resize-handle{position:absolute;left:0;right:0;bottom:-6px;height:12px;z-index:3;margin:0;padding:0;border:0;background:transparent;cursor:row-resize;touch-action:none;outline:none;-webkit-tap-highlight-color:transparent}
.height-resize-handle[hidden]{display:none}
.height-resize-handle::before{content:"";position:absolute;left:24px;right:24px;top:50%;height:2px;margin-top:-1px;border-radius:2px;background:transparent;transition:background-color .12s}
.height-resize-handle:hover::before,.height-resize-handle.is-dragging::before{background:var(--kptu-border-strong,var(--kptu-border))}
.height-resize-handle:focus-visible::before{background:var(--kptu-info);height:3px;margin-top:-1.5px}
html.height-resizing,html.height-resizing *{cursor:row-resize!important;user-select:none!important;-webkit-user-select:none!important}`;
  document.head.append(style);
}
const mounted = new WeakMap();
/**
 * @param {object} o
 * @param {HTMLElement} o.host 높이를 정할 상자(position이 static이면 relative로 둔다)
 * @param {string} o.name 화면 이름(저장 칸 col_widths.<name>)
 * @param {string} o.key 칸 이름(예: 'h2')
 * @param {string} o.varName 높이를 받을 CSS 변수(px)
 * @param {string} o.attr 높이를 정했을 때 상자에 붙일 속성(예: 'data-lu-fixed-h')
 * @param {() => boolean} o.active 손잡이를 보일 때(아니면 숨기고 자동 높이)
 * @param {number} [o.min] 가장 낮은 높이(px)
 * @param {string} [o.label] 읽기 프로그램용 이름
 * @returns {{update:() => void, handle:HTMLElement}|null}
 */
export function mountHeightResize(o) {
  const { host } = o; if (!host) return null;
  const known = mounted.get(host);
  if (known && known.handle.isConnected && known.handle.parentElement === host) { known.update(); return known; }
  ensureStyle();
  const min = o.min || 200;
  const handle = document.createElement('div');
  handle.className = 'height-resize-handle'; handle.tabIndex = 0; handle.hidden = true;
  handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'horizontal');
  handle.setAttribute('aria-label', o.label || '높이 조절');
  host.append(handle);
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const stored = () => heightOf(colsFor(viewPrefs.getCols(o.name), [o.key], device())[o.key]);
  let live = null; // 끄는 중 높이(px). 아니면 저장값.
  function paint(h) {
    if (h && o.active()) { host.style.setProperty(o.varName, `${Math.round(h)}px`); host.setAttribute(o.attr, ''); }
    else { host.style.removeProperty(o.varName); host.removeAttribute(o.attr); }
    handle.setAttribute('aria-valuetext', h ? `높이 ${Math.round(h)}px` : '내용만큼');
  }
  function update() { const on = !!o.active(); handle.hidden = !on; paint(on ? live ?? stored() : null); }
  const save = h => { viewPrefs.setCols(o.name, withCol(viewPrefs.getCols(o.name), o.key, device(), h == null ? null : heightStored(h))); live = null; update(); };
  let drag = null, lastTap = 0;
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0 || handle.hidden) return; e.preventDefault();
    drag = { id: e.pointerId, y: e.clientY, h: host.getBoundingClientRect().height, moved: false };
    try { handle.setPointerCapture(e.pointerId); } catch {}
    handle.classList.add('is-dragging'); document.documentElement.classList.add('height-resizing'); handle.focus({ preventScroll: true });
  });
  handle.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y; if (!drag.moved && Math.abs(dy) < 3) return;
    drag.moved = true; live = clampHeight(drag.h + dy, min); paint(live);
  });
  const end = e => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const { moved } = drag; drag = null;
    handle.classList.remove('is-dragging'); document.documentElement.classList.remove('height-resizing');
    if (moved) { save(live); return; }
    // 움직이지 않은 두 번 누르기(손가락 포함) = 자동. 마우스는 dblclick도 같은 일을 한다.
    const now = Date.now(); if (e?.pointerType === 'touch' && now - lastTap < 350) { lastTap = 0; save(null); } else lastTap = now;
  };
  handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end); handle.addEventListener('lostpointercapture', end);
  handle.addEventListener('dblclick', e => { e.preventDefault(); save(null); });
  handle.addEventListener('keydown', e => {
    let next;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') next = clampHeight(host.getBoundingClientRect().height + (e.key === 'ArrowDown' ? HEIGHT_STEP : -HEIGHT_STEP), min);
    else if (e.key === 'Home') next = null;
    else return;
    e.preventDefault(); save(next);
  });
  const again = () => { if (!host.isConnected) return; update(); };
  globalThis.addEventListener?.('kptu:view-prefs-ready', again);
  for (const q of ['(min-width:600px)', '(min-width:1200px)']) globalThis.matchMedia?.(q).addEventListener?.('change', again);
  const api = { update, handle };
  mounted.set(host, api);
  update();
  return api;
}
