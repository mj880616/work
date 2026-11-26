// S67-53 ORG-여러개삭제(사용자 11/20 22:48·22:54): 조직 관리 목록의 '여러 개 선택해 삭제' 글자와 판정(순수 함수, 화면·서버 없음).
// (참고 묶음 목록의 여러 개 삭제는 ORG-참고묶음삭제 S71-22에서 화면과 함께 없앴다.)
// 담당조직은 한 개 삭제와 같은 규칙(TRASH-화면2): 휴지통으로 옮기고, 연결된 조직 보고·담당자는 그대로 남으며 휴지통에서 되돌릴 수 있다.

import {word} from './brand/brand.mjs'; // 사람마다 고친 이름(담당조직·조직 보고 등)으로 보인다(APP-기록+이름바꾸기)

// 조직 보고 개수를 셀 때 한 번에 묻는 조직 수(주소 길이를 넘지 않게).
export const COUNT_CHUNK = 40;
export function chunks(ids, size = COUNT_CHUNK) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
export const orgRecordCountPath = ids => `/rest/v1/app_suborganization_updates?organization_id=in.(${ids.map(encodeURIComponent).join(',')})&select=id`;

export const ORG_PICK_TEXT = Object.freeze({
  MENU: '여러 개 선택해 삭제',
  ALL: '모두 선택',
  DELETE: '삭제',
  CANCEL: '취소',
  COUNT_FAILED: word('연결된 조직 보고 개수를 확인하지 못해 삭제하지 않았어요. 잠시 뒤 다시 시도해 주세요.'),
});
export const orgPickCount = n => `${n}곳 선택됨`;

// 확인 창: 조직 n곳, 연결된 조직 보고 m건(기존 한 개 삭제 규칙대로 남고, 휴지통에서 되돌릴 수 있음).
export function orgBulkConfirmText(n, records) {
  const kept = records > 0 ? word(`연결된 조직 보고 ${records}건과 담당자는 그대로 남고`) : word('연결된 조직 보고는 없고');
  return word(`담당조직 ${n}곳을 휴지통으로 옮길까요?\n${kept}, 휴지통에서 되돌릴 수 있어요.`);
}
// 결과 줄: 옮긴 수(휴지통 목록으로 확인한 것만) + 옮기지 못한 수.
export function orgBulkMovedText(moved, left) {
  if (!left) return word(`담당조직 ${moved}곳을 휴지통으로 옮겼어요.`);
  return word(`담당조직 ${moved}곳을 휴지통으로 옮겼고 ${left}곳은 옮기지 못했어요. 옮기지 못한 곳은 그대로 선택해 두었어요.`);
}
export function orgBulkUndoText(restored, failed) {
  if (!failed) return word(`담당조직 ${restored}곳을 되돌렸어요.`);
  return word(`담당조직 ${restored}곳을 되돌렸고 ${failed}곳은 되돌리지 못했어요. 보관 창의 휴지통을 확인해 주세요.`);
}
