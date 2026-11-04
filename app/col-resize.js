import { viewPrefs, COL_WIDTH_MIN, COL_WIDTH_MAX } from './view-prefs.js';
// S49-4 FILES-칸폭(요청함 11/03 10:39 '이런 간격은 전부'): 표 머리 칸 경계를 끌어 칸 폭을 바꾸는 공용 부품. 두 칸 경계 부품(split-resize.js)과 짝이다.
// - 화면은 칸마다 CSS 변수 하나(예: --fx-w-day)로 폭을 받고, 이 부품은 그 변수만 px로 바꾼다. 줄 모양·그리드는 각 화면 CSS가 가진다.
// - 머리 칸 안에 <i class="col-grip" data-col-grip="칸이름"> 을 두면 그 칸의 한쪽 가장자리가 끌어 조절 손잡이가 된다(dir=-1: 왼쪽 가장자리, 왼쪽으로 끌면 넓어짐 —
//   오른쪽에 붙은 고정 폭 칸들 + 남는 폭을 먹는 이름 칸 구조 / dir=1: 오른쪽 가장자리).
// - 폭은 서버에 화면별로 기억한다(view-prefs.js col_widths.<화면>, 기기 저장 없음). 읽지 못했거나 칸이 없으면 화면 기본 폭이다.
// - 끌기(마우스·펜), 두 번 누르기 = 그 칸을 글 길이에 맞춤, 키보드: 손잡이에 초점 → ←/→ 8px, Home = 그 칸 기본 폭으로. role=separator.
const STEP = 8, PAD = 12;
let sheet = false;
export const clampWidth = w => Math.min(COL_WIDTH_MAX, Math.max(COL_WIDTH_MIN, Math.round(w)));
function ensureStyle() {
  if (sheet) return; sheet = true;
  const style = document.createElement('style'); style.dataset.kptuColResize = '';
  style.textContent = `.col-grip{position:absolute;top:0;bottom:0;width:10px;margin:0;padding:0;cursor:col-resize;touch-action:none;outline:none;z-index:2}
.col-grip[data-dir="-1"]{left:-8px}.col-grip[data-dir="1"]{right:-4px}
.col-grip::before{content:"";position:absolute;top:4px;bottom:4px;left:50%;width:1px;margin-left:-.5px;background:transparent;transition:background-color .12s}
.col-grip:hover::before,.col-grip.is-dragging::before{background:var(--kptu-border-strong)}
.col-grip:focus-visible::before{background:var(--kptu-info);width:2px}
html.col-resizing,html.col-resizing *{cursor:col-resize!important;user-select:none!important}
@media(max-width:760px){.col-grip{display:none!important}}`;
  document.head.append(style);
}
/**
 * @param {object} o
 * @param {HTMLElement} o.host 머리와 줄이 들어 있는 요소(안쪽을 다시 그려도 한 번만 붙인다). 변수는 여기에 둔다.
 * @param {string} o.name 화면 이름(저장 칸 col_widths.<name>)
 * @param {Record<string,string>} o.vars 칸 이름 → CSS 변수 이름
 * @param {(key:string) => number} o.fit 그 칸의 글 길이에 맞는 폭(px, 여백 제외)
 * @param {number} [o.dir] -1 왼쪽 가장자리(기본) · 1 오른쪽 가장자리
 * @param {Record<string,string>} [o.labels] 칸 이름 → 접근성 이름
 */
export function mountColResize(o) {
  const { host, name, vars, fit, dir = -1, labels = {} } = o;
  if (!host || host.dataset.colResize === name) return { apply: () => applyStored(host, name, vars) };
  host.dataset.colResize = name;
  ensureStyle();
  const stored = () => ({ ...(viewPrefs.getCols(name) || {}) });
  const save = (key, w) => {
    const next = stored();
    if (w == null) delete next[key]; else next[key] = clampWidth(w);
    viewPrefs.setCols(name, Object.keys(next).length ? next : null);
    applyStored(host, name, vars);
  };
  let drag = null;
  host.addEventListener('pointerdown', e => {
    const grip = e.target.closest?.('[data-col-grip]');
    if (!grip || e.button !== 0 || !host.contains(grip)) return;
    e.preventDefault();
    const cell = grip.parentElement, key = grip.dataset.colGrip;
    drag = { id: e.pointerId, grip, key, x: e.clientX, w: cell.getBoundingClientRect().width, moved: false, last: 0 };
    try { grip.setPointerCapture(e.pointerId); } catch { /* 캡처 못 해도 계속 */ }
    grip.classList.add('is-dragging'); document.documentElement.classList.add('col-resizing'); grip.focus({ preventScroll: true });
  });
  host.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.moved = true;
    drag.last = clampWidth(drag.w + (e.clientX - drag.x) * (dir === -1 ? -1 : 1));
    host.style.setProperty(vars[drag.key], `${drag.last}px`);
    drag.grip.setAttribute('aria-valuenow', String(drag.last));
  });
  const end = e => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const d = drag; drag = null;
    d.grip.classList.remove('is-dragging'); document.documentElement.classList.remove('col-resizing');
    if (d.moved && d.last) save(d.key, d.last);
  };
  host.addEventListener('pointerup', end); host.addEventListener('pointercancel', end); host.addEventListener('lostpointercapture', end);
  host.addEventListener('dblclick', e => {
    const grip = e.target.closest?.('[data-col-grip]'); if (!grip) return;
    e.preventDefault(); save(grip.dataset.colGrip, fit(grip.dataset.colGrip) + PAD);
  });
  host.addEventListener('keydown', e => {
    const grip = e.target.closest?.('[data-col-grip]'); if (!grip) return;
    const key = grip.dataset.colGrip, cur = grip.parentElement.getBoundingClientRect().width, wider = dir === -1 ? 'ArrowLeft' : 'ArrowRight';
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') save(key, cur + (e.key === wider ? STEP : -STEP));
    else if (e.key === 'Home') save(key, null);
    else return;
    e.preventDefault();
  });
  applyStored(host, name, vars);
  return { apply: () => applyStored(host, name, vars) };
}
// 저장된 폭을 변수로 옮긴다(없는 칸은 변수를 지워 화면 기본 폭).
export function applyStored(host, name, vars) {
  if (!host) return;
  const cols = viewPrefs.getCols(name) || {};
  for (const [key, v] of Object.entries(vars)) { if (cols[key] > 0) host.style.setProperty(v, `${cols[key]}px`); else host.style.removeProperty(v); }
}
// 머리 칸 안에 넣을 손잡이 글자(화면이 머리를 그릴 때 쓴다).
export const gripHtml = (key, label, dir = -1) => `<i class="col-grip" data-col-grip="${key}" data-dir="${dir}" role="separator" aria-orientation="vertical" aria-label="${label} 칸 폭 조절" aria-valuemin="${COL_WIDTH_MIN}" aria-valuemax="${COL_WIDTH_MAX}" tabindex="0" title="끌어서 폭 조절 · 두 번 누르면 글 길이에 맞춤"></i>`;
