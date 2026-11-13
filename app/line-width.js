import { viewPrefs } from './view-prefs.js';
import { colDevice, colsFor, withCol, isDoubleTap } from './col-widths-model.mjs';
import { ensureGripStyle } from './col-resize.js';
import { LINE_SCREEN, LINE_KEY, LINE_DEFAULT_EM, LINE_MIN_EM, LINE_MAX_EM, LINE_STEP_EM, clampEm, lineEm, lineStored } from './line-width-model.mjs';
// NOTE-글폭(S61-21): 노트·일기·큰 쓰기 창의 글 줄 폭 손잡이. 모양·잡는 범위는 표 칸 손잡이(col-resize.js .col-grip)와 같다.
// - 글 줄 폭은 CSS 변수 하나(--line-em, 문서 뿌리 html에 둠)로 정해지고, 줄을 묶는 규칙은 ed-doc.css .line-w가 가진다(표·사진·코드는 넘어도 됨).
// - 손잡이는 글 오른쪽 끝(=글 줄 끝)에 가는 세로 금. 끌면 넓어지고 좁아짐, 두 번 누르기 = 기본(한 줄 약 40자), 키보드 ←/→ 1자·Home = 기본.
// - 폭은 서버에 화면 종류별(PC·폴드 펼침 따로)로 기억(line-width-model.mjs). 모든 노트·일기·창이 같은 값. 폰(600px 미만)은 손잡이 없음.
const device = () => colDevice(globalThis.innerWidth || 0);
const phone = () => device() === 'p';
export const lineEmNow = () => lineEm(colsFor(viewPrefs.getCols(LINE_SCREEN), [LINE_KEY], device())[LINE_KEY]);
const setRootEm = em => document.documentElement.style.setProperty('--line-em', String(em));
const mounted = new Set();
let listening = false;
function applyAll() {
  setRootEm(lineEmNow());
  for (const m of [...mounted]) { if (!m.host.isConnected) { mounted.delete(m); continue; } m.place(); }
}
function listen() {
  if (listening) return; listening = true;
  let raf = 0;
  const again = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(applyAll); };
  globalThis.addEventListener?.('resize', again);
  globalThis.addEventListener?.('kptu:view-prefs-ready', again);
}
function save(em) {
  viewPrefs.setCols(LINE_SCREEN, withCol(viewPrefs.getCols(LINE_SCREEN), LINE_KEY, device(), em == null ? null : lineStored(em)));
  applyAll();
}
// 글이 실제로 놓이는 요소: .ed-doc 하나가 들어 있으면 그것, 아니면(마크다운·그냥 글) 자기 자신.
const docOf = target => target.querySelector(':scope > .ed-doc') || target;
// 지금 글 줄의 화면 위치(px, 화면 좌표). 배율(zoom)이 걸린 칸도 화면 좌표로 맞춘다.
function measure(target) {
  const d = docOf(target), cs = getComputedStyle(d), r = d.getBoundingClientRect();
  const scale = d.offsetWidth ? r.width / d.offsetWidth : 1;
  const padL = parseFloat(cs.paddingLeft) || 0;
  // 그냥 글은 오른쪽 여백으로 줄을 묶으므로(ed-doc.css) 원래 오른쪽 여백(--line-pr)을 쓴다.
  const plain = d === target && !d.classList.contains('md-body') && !d.classList.contains('ed-doc');
  const padR = plain ? parseFloat(cs.getPropertyValue('--line-pr')) || 0 : parseFloat(cs.paddingRight) || 0;
  const room = Math.max(0, d.clientWidth - padL - padR), em = parseFloat(cs.fontSize) || 15;
  const line = parseFloat(cs.getPropertyValue('--line-w')) || em * LINE_DEFAULT_EM;
  // 손잡이 높이는 글이 있는 데까지(빈 쓰기 칸 아래쪽을 누르면 손잡이가 아니라 글 칸이 눌리게). 그냥 글은 칸 전체.
  const last = [...d.children].reverse().find(el => !el.matches('[data-line-grip],.ed-measure,.ProseMirror-gapcursor'));
  const bottom = last ? Math.min(r.bottom, last.getBoundingClientRect().bottom + (parseFloat(cs.paddingTop) || 0) * scale) : r.bottom;
  return {left: r.left + (d.clientLeft + padL) * scale, vis: Math.min(line, room) * scale, emPx: em * scale, room: room * scale, top: r.top, height: Math.max(Math.min(r.height, 48 * scale), bottom - r.top)};
}
/**
 * 글 줄 폭 손잡이를 붙인다.
 * @param {object} o
 * @param {HTMLElement} o.host 손잡이를 넣을 요소(position:relative, 안 내용을 다시 그려도 지워지지 않는 곳)
 * @param {HTMLElement} o.target 글이 들어 있는 요소(.line-w)
 * @returns {{place():void, destroy():void}}
 */
export function mountLineWidth({host, target}) {
  ensureGripStyle(); listen();
  host.classList.add('line-w-host'); target.classList.add('line-w');
  setRootEm(lineEmNow());
  const grip = document.createElement('i');
  grip.className = 'col-grip line-grip'; grip.dataset.lineGrip = '';
  Object.assign(grip, {tabIndex: 0, title: '끌어서 글 폭 조절 · 두 번 누르면 기본 폭(한 줄 약 40자)'});
  for (const [k, v] of Object.entries({role: 'separator', 'aria-orientation': 'vertical', 'aria-label': '글 폭 조절', 'aria-valuemin': LINE_MIN_EM, 'aria-valuemax': LINE_MAX_EM})) grip.setAttribute(k, String(v));
  host.append(grip);
  const place = () => {
    if (!grip.isConnected || !target.isConnected) return;
    grip.setAttribute('aria-valuenow', String(lineEmNow()));
    if (phone()) return;
    const m = measure(target), h = host.getBoundingClientRect(), hs = host.offsetWidth ? h.width / host.offsetWidth : 1;
    grip.style.left = `${(m.left + m.vis - h.left) / hs - host.clientLeft - 12}px`;
    grip.style.top = `${(m.top - h.top) / hs - host.clientTop}px`;
    grip.style.height = `${m.height / hs}px`;
  };
  let raf = 0;
  const soon = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); };
  const ro = globalThis.ResizeObserver ? new ResizeObserver(soon) : null;
  ro?.observe(target); if (host !== target) ro?.observe(host);
  // 쓰는 동안 글 높이가 바뀌어도(칸 크기는 그대로인 큰 창) 손잡이 높이를 맞춘다.
  const typed = ['input', 'keyup', 'paste', 'drop'];
  for (const t of typed) target.addEventListener(t, soon);
  let drag = null, lastTap = null;
  const onDown = e => {
    if ((e.pointerType === 'mouse' && e.button !== 0) || phone()) return;
    e.preventDefault(); e.stopPropagation();
    const m = measure(target);
    drag = {id: e.pointerId, x: e.clientX, m, moved: false, em: null};
    try { grip.setPointerCapture(e.pointerId); } catch { /* 캡처 못 해도 계속 */ }
    grip.classList.add('is-dragging'); document.documentElement.classList.add('col-resizing'); grip.focus({preventScroll: true});
  };
  const onMove = e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x) < 3) return; // 손가락 떨림은 두 번 누르기로 본다
    drag.moved = true;
    const {m} = drag;
    drag.em = clampEm((m.vis + e.clientX - drag.x) / m.emPx, m.room / m.emPx);
    setRootEm(drag.em);
    for (const x of mounted) x.place();
  };
  const onEnd = e => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const d = drag; drag = null;
    grip.classList.remove('is-dragging'); document.documentElement.classList.remove('col-resizing');
    if (d.moved && d.em != null) { lastTap = null; save(d.em); return; }
    if (e?.type !== 'pointerup') return;
    // 움직이지 않고 두 번 누르면 기본 폭(손가락은 dblclick이 오지 않는 브라우저가 있어 직접 센다).
    const tap = {key: LINE_KEY, at: e.timeStamp || Date.now()};
    if (isDoubleTap(lastTap, tap)) { lastTap = null; grip.dataset.lineResetAt = String(tap.at); save(null); } else lastTap = tap;
  };
  const onDbl = e => {
    e.preventDefault(); e.stopPropagation();
    if (grip.dataset.lineResetAt) { delete grip.dataset.lineResetAt; return; } // 위 두 번 누르기가 이미 되돌렸다
    save(null);
  };
  const onKey = e => {
    if (phone()) return;
    const m = measure(target), now = m.vis / m.emPx;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') save(clampEm(Math.round(now) + (e.key === 'ArrowRight' ? LINE_STEP_EM : -LINE_STEP_EM), m.room / m.emPx));
    else if (e.key === 'Home') save(null);
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  // 손잡이 누름이 글 칸(편집기 초점·읽기 칸 눌림)으로 번지지 않게.
  const onClick = e => { e.preventDefault(); e.stopPropagation(); };
  grip.addEventListener('pointerdown', onDown); grip.addEventListener('pointermove', onMove);
  grip.addEventListener('pointerup', onEnd); grip.addEventListener('pointercancel', onEnd); grip.addEventListener('lostpointercapture', onEnd);
  grip.addEventListener('dblclick', onDbl); grip.addEventListener('keydown', onKey); grip.addEventListener('click', onClick);
  grip.addEventListener('mousedown', e => e.preventDefault()); // 편집기가 글자 고르기를 시작하지 않게
  const entry = {host, place};
  mounted.add(entry);
  place(); soon();
  return {place: soon, destroy() { mounted.delete(entry); ro?.disconnect(); for (const t of typed) target.removeEventListener(t, soon); cancelAnimationFrame(raf); grip.remove(); }};
}
