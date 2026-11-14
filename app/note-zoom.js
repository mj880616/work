// S61-16 NOTE-내용확대축소(요청함 11/12 14:34): 노트 보기에서 글과 HTML 첨부 내용만 키우고 줄이는 배율 하나.
// 화면 틀(메뉴·목록·머리 줄)은 그대로다 — 앱 창 전체 확대(브라우저 100%·110%)와 다르다.
// - 배율은 서버 화면 기억 view_prefs.note_zoom 하나(모든 기기·모든 노트 같음, 기기 저장 없음). 없으면 100.
//   DB 적용 전(쓰기 400)이면 view-prefs가 서버 값으로 되돌리므로 이번 접속에서 고른 값을 화면 메모리에만 들고 있는다(box-fold.js와 같은 방식).
// - 단계: 80·90·100·110·125·150(%). [−]·[+]는 한 단계, 가운데 숫자는 100%로.
// - 바뀌면 'kptu:note-zoom' 하나를 알린다. 노트 글은 CSS 값(--note-zoom)으로, HTML 칸막이는 html-frame.js가 칸막이 안 문서에
//   배율을 넣어 다시 그린다(칸막이의 sandbox·CSP는 그대로 — 바깥에서 안을 만지지 않는다).
import {viewPrefs, NOTE_ZOOMS} from './view-prefs.js';

export {NOTE_ZOOMS};
export const NOTE_ZOOM_EVENT = 'kptu:note-zoom';
let session = null, serverRefused = false;
globalThis.addEventListener?.('kptu:view-prefs-rejected', e => { if ((e.detail?.paths || []).includes('note_zoom')) serverRefused = true; });
globalThis.addEventListener?.('kptu:view-prefs-ready', () => { if (!serverRefused) tell(); });

export function noteZoom() {
  const v = serverRefused && session != null ? session : viewPrefs.get('note_zoom');
  return NOTE_ZOOMS.includes(v) ? v : 100;
}
function tell() { try { globalThis.dispatchEvent?.(new CustomEvent(NOTE_ZOOM_EVENT, {detail: {zoom: noteZoom()}})); } catch { /* 알림만 */ } }
export function setNoteZoom(value) {
  if (!NOTE_ZOOMS.includes(value) || value === noteZoom()) return noteZoom();
  session = value;
  // 100은 '없음'(기본)으로 둔다 — 서버 값을 늘리지 않는다.
  viewPrefs.set('note_zoom', value === 100 ? null : value, {rejectable: true});
  tell();
  return value;
}
// dir: +1 한 단계 크게, -1 한 단계 작게, 0 = 100%.
export function stepNoteZoom(dir) {
  if (!dir) return setNoteZoom(100);
  const at = NOTE_ZOOMS.indexOf(noteZoom());
  return setNoteZoom(NOTE_ZOOMS[Math.min(NOTE_ZOOMS.length - 1, Math.max(0, at + (dir > 0 ? 1 : -1)))]);
}
export const zoomScale = (zoom = noteZoom()) => zoom / 100;

// [−] 100% [+] 작은 묶음. 모든 묶음이 같은 값을 보인다(하나를 누르면 다른 곳도 바뀜).
export function zoomControl() {
  const node = document.createElement('span');
  node.className = 'nz-zoom ds-seg'; node.dataset.noteZoom = ''; node.setAttribute('role', 'group'); node.setAttribute('aria-label', '내용 크기');
  const make = (key, text, label) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ds-seg-btn'; b.dataset[key] = ''; b.textContent = text; b.setAttribute('aria-label', label); b.title = label; return b; };
  const out = make('noteZoomOut', '−', '내용 작게'), reset = make('noteZoomReset', '100%', '내용 크기 100%로'), into = make('noteZoomIn', '+', '내용 크게');
  node.append(out, reset, into);
  const paint = () => {
    const z = noteZoom();
    reset.textContent = z + '%';
    out.disabled = z === NOTE_ZOOMS[0]; into.disabled = z === NOTE_ZOOMS[NOTE_ZOOMS.length - 1];
  };
  out.addEventListener('click', () => stepNoteZoom(-1));
  into.addEventListener('click', () => stepNoteZoom(1));
  reset.addEventListener('click', () => stepNoteZoom(0));
  globalThis.addEventListener(NOTE_ZOOM_EVENT, paint);
  paint();
  return {node, paint, destroy: () => globalThis.removeEventListener(NOTE_ZOOM_EVENT, paint)};
}

// NOTE-배율자리(S61-45, 시안 B): 노트 읽기 머리 줄용. 폰 폭(~599px)에서는 글 크기 아이콘(큰 '가'·작은 '가') 한 칸만 보이고,
// 누르면 그 아래로 [−] 100% [+]가 펼쳐진다. 다시 누르기·바깥 누르기·Esc면 접힌다. 600px 이상(폴드 펼침·PC)은 아이콘 없이 묶음 그대로(CSS).
// 펼침 상태는 이 단추 하나가 갖는다(aria-expanded + 감싼 칸의 nz-open). 배율 저장은 위와 같은 서버 화면 기억.
export function zoomFoldControl() {
  const wrap = document.createElement('span');
  wrap.className = 'nz-fold'; wrap.dataset.noteZoomFold = '';
  const zoom = zoomControl();
  const id = 'nzPop' + Math.random().toString(36).slice(2, 8);
  zoom.node.id = id;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'basket-icon-button nz-fold-btn'; btn.dataset.noteZoomToggle = '';
  btn.setAttribute('aria-label', '글 크기'); btn.title = '글 크기';
  btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', id);
  btn.innerHTML = '<span class="nz-fz" aria-hidden="true"><b>가</b><i>가</i></span>';
  wrap.append(btn, zoom.node);
  const set = open => { wrap.classList.toggle('nz-open', open); btn.setAttribute('aria-expanded', String(open)); };
  const isOpen = () => wrap.classList.contains('nz-open');
  btn.addEventListener('click', () => set(!isOpen()));
  const outside = e => { if (isOpen() && !wrap.contains(e.target)) set(false); };
  // 펼친 묶음만 접는다 — 같은 Esc가 노트 닫기(뒤로)까지 가지 않게 여기서 멈춘다.
  const esc = e => { if (e.key === 'Escape' && isOpen()) { e.preventDefault(); e.stopPropagation(); set(false); btn.focus({preventScroll: true}); } };
  document.addEventListener('pointerdown', outside, true);
  wrap.addEventListener('keydown', esc);
  return {node: wrap, paint: zoom.paint, close: () => set(false), destroy: () => { zoom.destroy(); document.removeEventListener('pointerdown', outside, true); }};
}

// PC: 노트 칸 위에서만 Ctrl(맥 ⌘)+휠·Ctrl+(+ − 0)이 이 배율을 바꾼다(앱 전체 확대 대신). 칸 밖에서는 브라우저 확대 그대로.
// 칸막이(iframe) 위의 휠은 칸막이 문서로 가므로 여기서 받지 못한다(그 자리는 브라우저 확대).
export function bindZoomKeys(el, {active = () => true} = {}) {
  let wheelAt = 0;
  const wheel = e => {
    if (!(e.ctrlKey || e.metaKey) || !active()) return;
    e.preventDefault();
    const now = Date.now(); if (now - wheelAt < 120) return; wheelAt = now;
    stepNoteZoom(e.deltaY < 0 ? 1 : -1);
  };
  const key = e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || !active()) return;
    const dir = e.key === '+' || e.key === '=' ? 1 : e.key === '-' || e.key === '_' ? -1 : e.key === '0' ? 0 : null;
    if (dir === null) return;
    e.preventDefault(); stepNoteZoom(dir);
  };
  el.addEventListener('wheel', wheel, {passive: false});
  el.addEventListener('keydown', key);
  return () => { el.removeEventListener('wheel', wheel); el.removeEventListener('keydown', key); };
}
