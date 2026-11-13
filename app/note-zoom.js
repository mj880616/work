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
