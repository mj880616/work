// PHOTO-크게보기메뉴통일(S49-23, 요청함 11/04 07:36): 사진 아래 버튼줄을 그리는 코드 하나.
// 고르기 아래 줄(photos.js)과 크게 보기 아래 줄(photo-strip.js)이 같은 목록(photo-menu-items.mjs PHOTO_MENUS)·같은 아이콘·같은 이름을 여기서 받는다.
// 버튼이 보일지·눌릴지는 부르는 화면의 규칙 한 곳(photos.js actAvail)이 정한다. DOM 없이 읽히는 순수 모듈(시험이 그대로 읽는다).
import {ACT_ICON, actInner} from './action-bar.mjs';
import {PHOTO_ACT_TEXT, PHOTO_ACT_SHORT} from './photo-menu-items.mjs';

// 아이콘은 action-bar.mjs 선 아이콘이거나 글자 모양. popup은 누르면 작은 메뉴가 뜨는 버튼. danger는 표시만(색은 같음).
export const PHOTO_ACT_DEF = Object.freeze({
  star: {icon: ACT_ICON.star},
  share: {icon: ACT_ICON.share, hidden: true},
  down: {icon: ACT_ICON.download},
  diary: {icon: '✚'},
  basket: {icon: '↥'},
  rename: {icon: ACT_ICON.edit, hidden: true},
  move: {icon: ACT_ICON.move, popup: true},
  tag: {icon: '#', popup: true},
  untag: {icon: '−', hidden: true},
  restore: {icon: '↩', hidden: true},
  edit: {icon: ACT_ICON.edit, hidden: true},
  info: {icon: ACT_ICON.infoEdit, hidden: true},
  detail: {icon: ACT_ICON.info, expand: true},
  delete: {icon: ACT_ICON.delete, danger: true},
});

// 버튼 하나. attr = 그 화면이 이 버튼을 찾는 속성(예: data-photos-act-move). 칸이 좁아 보이는 글자는 PHOTO_ACT_SHORT(앞부분), 읽는 이름·마우스 올림은 온이름.
export function photoActButton(id, attr) {
  const d = PHOTO_ACT_DEF[id], full = PHOTO_ACT_TEXT[id], shown = PHOTO_ACT_SHORT[id] || full;
  const extra = `${d.popup ? ' aria-haspopup="true" aria-expanded="false"' : ''}${d.expand ? ' aria-expanded="false"' : ''}${d.hidden ? ' hidden' : ''}`;
  const name = shown === full ? '' : ` aria-label="${full}" title="${full}"`;
  return `<button type="button" class="kptu-act${d.danger ? ' kptu-act-danger' : ''}" ${attr}${name}${extra}>${actInner(d.icon, shown)}</button>`;
}
// 줄 안쪽 전부. attrOf(id) → 속성.
export const photoActButtons = (ids, attrOf) => ids.map(id => photoActButton(id, attrOf(id))).join('');
