// UI-폴더줄크기(S69-99, 사용자 2026-11-25 08:23): 파일·자료실·노트·사진 폴더·항목 줄 크기 단계의 주인 하나.
// - 지금 단계는 서버 view_prefs.row_size 하나(모든 화면·모든 기기 같음, 기기 저장 없음). 없으면 보통(m = [파일] 줄 크기).
//   DB 적용 전(쓰기 400)이면 view-prefs가 서버 값으로 되돌리므로 이번 접속에서 고른 단계를 화면 메모리에만 들고 있는다(note-zoom.js와 같은 방식).
// - 화면에는 문서 뿌리(<html>)의 data-row-size 하나만 붙인다. 줄 높이·폴더 그림·글자 크기 값은 folder-tree.css 한 곳이 이 표시를 보고 정한다
//   (화면마다 따로 덮어쓰지 않는다. 다시 그리지 않음 — 받은 줄 그대로 CSS만 바뀐다).
// - 단계를 바꾸는 손짓(두 손가락·Ctrl+휠)은 folder-pinch.js가 받아 changeRowSize를 부른다.
import {viewPrefs} from './view-prefs.js';
import {ROW_SIZE_KEY, rowSizeOf, stepRowSize, ROW_SIZE_DEFAULT} from './row-size-model.mjs';

export const ROW_SIZE_EVENT = 'kptu:row-size';
let session = null, serverRefused = false;

export function rowSize() {
  if (serverRefused && session) return session;
  return rowSizeOf(viewPrefs.get(ROW_SIZE_KEY));
}
export function paintRowSize(size = rowSize()) {
  const root = globalThis.document?.documentElement;
  if (root && root.dataset.rowSize !== size) root.dataset.rowSize = size;
}
function tell() {
  paintRowSize();
  try { globalThis.dispatchEvent?.(new CustomEvent(ROW_SIZE_EVENT, {detail: {size: rowSize()}})); } catch { /* 알림만 */ }
}
globalThis.addEventListener?.('kptu:view-prefs-rejected', e => { if ((e.detail?.paths || []).includes(ROW_SIZE_KEY)) { serverRefused = true; tell(); } });
globalThis.addEventListener?.('kptu:view-prefs-ready', () => { if (!serverRefused) tell(); });
paintRowSize();

// 한 단계 바꾸고 서버에 저장한다. dir = +1 크게, -1 작게. 바뀌었으면 새 단계, 끝이라 그대로면 null.
export function changeRowSize(dir) {
  const now = rowSize(), next = stepRowSize(now, dir);
  if (next === now) return null;
  session = next;
  // 보통(m)은 '없음'(기본)으로 둔다 — 서버 값을 늘리지 않는다.
  viewPrefs.set(ROW_SIZE_KEY, next === ROW_SIZE_DEFAULT ? null : next, {rejectable: true});
  tell();
  return next;
}
