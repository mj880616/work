import { viewPrefs, COL_WIDTH_MIN, COL_WIDTH_MAX } from './view-prefs.js';
import { colDevice, colsFor, withCol, isDoubleTap } from './col-widths-model.mjs';
// S49-4 FILES-칸폭(요청함 11/03 10:39 '이런 간격은 전부') → S51-33 UI-칸너비끌기(요청함 11/06 22:33): 표 머리 칸 경계를 끌어 칸 너비를 바꾸는 공용 부품.
// 두 칸 경계 부품(split-resize.js)과 짝이다. 머리줄 있는 모든 표가 이 하나를 쓴다(파일 목록·큰 파일·찾기 결과·두 칸, 담당조직 전체 표·현황 표).
// - 화면은 칸마다 CSS 변수 하나(예: --fx-w-name)로 너비를 받고, 이 부품은 그 변수만 px로 바꾼다. 줄 모양·그리드는 각 화면 CSS가 가진다.
// - 머리 칸 안에 gripHtml(칸, 이름, dir)을 두면 그 칸 가장자리에 가는 세로 금(손잡이)이 늘 보인다. 보이는 금은 2px, 잡는 범위는 손가락 크기(24px).
//   dir=1(기본): 칸 오른쪽 금 — 끌면 그 칸(금의 왼쪽 칸)이 넓어지거나 좁아진다. dir=-1: 칸 왼쪽 금(옛 모양, 왼쪽으로 끌면 넓어짐).
// - 끄는 동안 금 자리에서 표 아래까지 세로 안내선. 금 두 번 누르기(손가락·마우스) = 그 칸 글자 길이에 맞춤.
//   키보드: 손잡이에 초점 → ←/→ 8px, Home = 그 칸 기본 너비로. role=separator.
// - 너비는 서버에 화면별·화면 종류별(폰·폴드 펼침·PC 따로)로 기억한다(view_prefs.col_widths.<화면>.<칸>[_f|_p], col-widths-model.mjs). 기기 저장 없음.
//   읽지 못했거나 칸이 없으면 화면 기본 너비. 화면 종류가 바뀌면(폴드를 펼치거나 접으면) 그 종류의 너비로 다시 맞춘다.
// - 최소 COL_WIDTH_MIN(글자 몇 자는 보임). 칸 합이 화면보다 넓어지면 표는 옆으로 밀어 본다(화면 CSS의 overflow-x).
const STEP = 8, PAD = 12;
let sheet = false;
export const clampWidth = w => Math.min(COL_WIDTH_MAX, Math.max(COL_WIDTH_MIN, Math.round(w)));
const device = () => colDevice(globalThis.innerWidth || 0);
function ensureStyle() {
  if (sheet) return; sheet = true;
  const style = document.createElement('style'); style.dataset.kptuColResize = '';
  style.textContent = `.col-grip{position:absolute;top:0;bottom:0;width:24px;margin:0;padding:0;cursor:col-resize;touch-action:none;outline:none;z-index:2;-webkit-tap-highlight-color:transparent}
.col-grip[data-dir="-1"]{left:-12px}.col-grip[data-dir="1"]{right:-12px}
.col-grip::before{content:"";position:absolute;top:4px;bottom:4px;left:50%;width:2px;margin-left:-1px;border-radius:2px;background:var(--kptu-border-strong,var(--kptu-border));transition:background-color .12s,width .12s}
.col-grip:hover::before{background:var(--kptu-muted)}
.col-grip.is-dragging::before{width:3px;margin-left:-1.5px;background:var(--kptu-primary-ink,var(--kptu-primary))}
.col-grip:focus-visible::before{background:var(--kptu-info);width:3px;margin-left:-1.5px}
.col-guide{position:fixed;width:2px;margin-left:-1px;background:var(--kptu-primary-ink,var(--kptu-primary));opacity:.6;pointer-events:none;z-index:60}
html.col-resizing,html.col-resizing *{cursor:col-resize!important;user-select:none!important;-webkit-user-select:none!important}`;
  document.head.append(style);
}
// NOTE-글폭(S61-21): 글 줄 폭 손잡이(line-width.js)도 같은 금 모양을 쓴다.
export const ensureGripStyle = () => ensureStyle();
// 붙인 표들: 화면 종류가 바뀌면 다시 맞춘다(한 번만 듣는다).
const mounted = new Set();
let listening = false;
function listen() {
  if (listening || !globalThis.matchMedia) return; listening = true;
  const again = () => { for (const m of [...mounted]) { if (!m.host.isConnected) { mounted.delete(m); continue; } applyStored(m.host, m.name, m.vars); } };
  for (const q of ['(min-width:600px)', '(min-width:1200px)']) matchMedia(q).addEventListener?.('change', again);
  globalThis.addEventListener?.('kptu:view-prefs-ready', again);
}
/**
 * @param {object} o
 * @param {HTMLElement} o.host 머리와 줄이 들어 있는 요소(안쪽을 다시 그려도 한 번만 붙인다). 변수는 여기에 둔다.
 * @param {string} o.name 화면 이름(저장 칸 col_widths.<name>)
 * @param {Record<string,string>} o.vars 칸 이름 → CSS 변수 이름
 * @param {(key:string) => number} o.fit 그 칸의 글 길이에 맞는 너비(px, 여백 제외)
 * @param {number} [o.dir] 손잡이에 data-dir이 없을 때: 1 오른쪽 가장자리(기본) · -1 왼쪽 가장자리
 * @param {Record<string,string>} [o.labels] 칸 이름 → 접근성 이름
 */
export function mountColResize(o) {
  const { host, name, vars, fit, dir: baseDir = 1 } = o;
  if (!host || host.dataset.colResize === name) { applyStored(host, name, vars); return { apply: () => applyStored(host, name, vars) }; }
  host.dataset.colResize = name;
  ensureStyle(); listen();
  mounted.add({ host, name, vars });
  const dirOf = grip => Number(grip.dataset.dir) === -1 ? -1 : Number(grip.dataset.dir) === 1 ? 1 : baseDir;
  const save = (key, w) => {
    viewPrefs.setCols(name, withCol(viewPrefs.getCols(name), key, device(), w == null ? null : clampWidth(w)));
    applyStored(host, name, vars);
  };
  const fitTo = key => save(key, fit(key) + PAD);
  let drag = null, guide = null, lastTap = null;
  const placeGuide = grip => {
    if (!guide) { guide = document.createElement('div'); guide.className = 'col-guide'; guide.setAttribute('aria-hidden', 'true'); document.body.append(guide); }
    const g = grip.getBoundingClientRect(), h = host.getBoundingClientRect();
    guide.style.left = `${g.left + g.width / 2}px`;
    guide.style.top = `${Math.max(0, h.top)}px`;
    guide.style.height = `${Math.max(0, Math.min(globalThis.innerHeight || h.bottom, h.bottom) - Math.max(0, h.top))}px`;
  };
  const dropGuide = () => { guide?.remove(); guide = null; };
  host.addEventListener('pointerdown', e => {
    const grip = e.target.closest?.('[data-col-grip]');
    if (!grip || (e.pointerType === 'mouse' && e.button !== 0) || !host.contains(grip)) return;
    e.preventDefault(); e.stopPropagation();
    const cell = grip.parentElement, key = grip.dataset.colGrip;
    drag = { id: e.pointerId, grip, key, dir: dirOf(grip), x: e.clientX, w: cell.getBoundingClientRect().width, moved: false, last: 0 };
    try { grip.setPointerCapture(e.pointerId); } catch { /* 캡처 못 해도 계속 */ }
    grip.classList.add('is-dragging'); document.documentElement.classList.add('col-resizing'); grip.focus({ preventScroll: true });
    placeGuide(grip);
  });
  host.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x) < 3) return; // 손가락 떨림은 두 번 누르기로 본다
    drag.moved = true;
    drag.last = clampWidth(drag.w + (e.clientX - drag.x) * drag.dir);
    host.style.setProperty(vars[drag.key], `${drag.last}px`);
    drag.grip.setAttribute('aria-valuenow', String(drag.last));
    placeGuide(drag.grip);
  });
  const end = e => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const d = drag; drag = null;
    d.grip.classList.remove('is-dragging'); document.documentElement.classList.remove('col-resizing'); dropGuide();
    if (d.moved && d.last) { lastTap = null; save(d.key, d.last); return; }
    if (e?.type !== 'pointerup') return;
    // 움직이지 않고 두 번 누르면 글자 길이에 맞춤(손가락은 dblclick이 오지 않는 브라우저가 있어 직접 센다).
    const tap = { key: d.key, at: e.timeStamp || Date.now() };
    if (isDoubleTap(lastTap, tap)) { lastTap = null; d.grip.dataset.colFitAt = String(tap.at); fitTo(d.key); } else lastTap = tap;
  };
  host.addEventListener('pointerup', end); host.addEventListener('pointercancel', end); host.addEventListener('lostpointercapture', end);
  // 손잡이 누름이 줄·머리 칸의 눌림(정렬·열기)으로 번지지 않게.
  host.addEventListener('click', e => { if (e.target.closest?.('[data-col-grip]')) { e.preventDefault(); e.stopPropagation(); } }, true);
  host.addEventListener('dblclick', e => {
    const grip = e.target.closest?.('[data-col-grip]'); if (!grip) return;
    e.preventDefault();
    if (grip.dataset.colFitAt) { delete grip.dataset.colFitAt; return; } // 위 두 번 누르기가 이미 맞췄다
    fitTo(grip.dataset.colGrip);
  });
  host.addEventListener('keydown', e => {
    const grip = e.target.closest?.('[data-col-grip]'); if (!grip) return;
    const key = grip.dataset.colGrip, cur = grip.parentElement.getBoundingClientRect().width, wider = dirOf(grip) === -1 ? 'ArrowLeft' : 'ArrowRight';
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') save(key, cur + (e.key === wider ? STEP : -STEP));
    else if (e.key === 'Home') save(key, null);
    else return;
    e.preventDefault();
  });
  applyStored(host, name, vars);
  return { apply: () => applyStored(host, name, vars) };
}
// 저장된 너비(이 화면 종류)를 변수로 옮긴다(없는 칸은 변수를 지워 화면 기본 너비).
export function applyStored(host, name, vars) {
  if (!host) return;
  const cols = colsFor(viewPrefs.getCols(name), Object.keys(vars), device());
  for (const [key, v] of Object.entries(vars)) { if (cols[key] > 0) host.style.setProperty(v, `${cols[key]}px`); else host.style.removeProperty(v); }
}
// 머리 칸 안에 넣을 손잡이 글자(화면이 머리를 그릴 때 쓴다). dir=1: 그 칸 오른쪽 금(기본).
export const gripHtml = (key, label, dir = 1) => `<i class="col-grip" data-col-grip="${key}" data-dir="${dir}" role="separator" aria-orientation="vertical" aria-label="${label} 칸 너비 조절" aria-valuemin="${COL_WIDTH_MIN}" aria-valuemax="${COL_WIDTH_MAX}" tabindex="0" title="끌어서 너비 조절 · 두 번 누르면 글자 길이에 맞춤"></i>`;
