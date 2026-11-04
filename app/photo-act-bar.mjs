// PHOTO-크게보기메뉴통일(S49-23) · PHOTO-아래줄정돈(S49-34, 요청함 11/04 11:40·12:06 'A안'): 사진 아래 버튼줄을 그리는 코드 하나.
// 고르기 아래 줄(photos.js)과 크게 보기 아래 줄(photo-strip.js)이 같은 목록(photo-menu-items.mjs PHOTO_MENUS)·같은 선 아이콘·같은 이름을 여기서 받는다.
// 줄은 다섯 칸까지(PHOTO_BAR_MAX): [별표][공유 ▾][편집 ▾ | 옮기기][지우기][더보기]. 나머지 기능은 ▾·더보기 안 글자 항목(photo-bar-menu.js).
// 버튼이 보일지·눌릴지는 부르는 화면의 규칙 한 곳(photos.js actAvail)이 정한다. DOM 없이 읽히는 순수 모듈(시험이 그대로 읽는다).
import {ACT_ICON, actInner} from './action-bar.mjs';
import {PHOTO_ACT_TEXT} from './photo-menu-items.mjs';

// 아이콘은 모두 action-bar.mjs 선 아이콘(#1799 부품). caret = 글자 옆 ▾(누르면 아래 항목 메뉴가 뜸). menu = 메뉴 버튼(펼침 항목 있음).
export const PHOTO_ACT_DEF = Object.freeze({
  star: {icon: ACT_ICON.star},
  share: {icon: ACT_ICON.share, menu: true, caret: true},
  edit: {icon: ACT_ICON.edit, menu: true, caret: true, hidden: true},
  move: {icon: ACT_ICON.move, popup: true},
  delete: {icon: ACT_ICON.delete, danger: true},
  more: {icon: ACT_ICON.more, menu: true, hidden: true},
});

// 버튼 하나. attr = 그 화면이 이 버튼을 찾는 속성(예: data-photos-act-move).
export function photoActButton(id, attr) {
  const d = PHOTO_ACT_DEF[id], text = PHOTO_ACT_TEXT[id];
  const extra = `${d.popup || d.menu ? ' aria-haspopup="true" aria-expanded="false"' : ''}${d.hidden ? ' hidden' : ''}`;
  const tx = d.caret ? `${text}<span class="kptu-act-caret" aria-hidden="true">▾</span>` : text;
  return `<button type="button" class="kptu-act${d.danger ? ' kptu-act-danger' : ''}" ${attr}${extra}>${actInner(d.icon, tx)}</button>`;
}
// 줄 안쪽 전부. attrOf(id) → 속성.
export const photoActButtons = (ids, attrOf) => ids.map(id => photoActButton(id, attrOf(id))).join('');
