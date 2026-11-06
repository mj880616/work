// FILES-통합 2-③ 두 칸(S49-30, 설계 docs/design/files-unified-plan.md D-3·D-4·J절 H-2, 시안 files-unified-mockup.html ⑥⑧): 화면 없이 시험하는 계산.
// - 두 칸 켬은 서버 view_prefs.files_two에 기기 종류별로 둔다(files_sources와 같은 모양: {app?: {...}, phone?: {...}, pc?: {...}}, migration 20261104190000).
//   기기 칸 안은 화면 폭 종류마다 참·거짓: fold = 폴드 펼침(600~1199, 공용 판정 screen-width.mjs), wide = PC(1200~). 칸이 없으면 기본값 — 한 칸(왼쪽 나무 + 오른쪽 목록). S50-33(명진 결정, 시안 승인): 폴드 펼침도 PC처럼 한 칸이 기본(H-2의 '폴드 기본 두 칸'을 바꿈). [두 칸 보기]로 켠 값은 그대로 기억.
// - 폰(600px 미만)은 늘 한 칸(이 계산을 부르지 않는다).
export const FILES_TWO_KEY = 'files_two';
export const FILES_TWO_LAYOUTS = Object.freeze(['fold', 'wide']);
export const FILES_TWO_DEFAULT = Object.freeze({fold: false, wide: false});
// 폭 종류. wide = 1200 이상인가.
export const twoLayout = wide => (wide ? 'wide' : 'fold');
// 서버 값(이 기기 칸) → 이 폭에서 두 칸인가. 모양이 틀리면 기본값.
export function twoOn(devValue, layout) {
  if (!FILES_TWO_LAYOUTS.includes(layout)) return false;
  const v = devValue && typeof devValue === 'object' && !Array.isArray(devValue) ? devValue[layout] : undefined;
  return typeof v === 'boolean' ? v : FILES_TWO_DEFAULT[layout];
}
// 이 폭의 켬을 바꾼 이 기기 칸 값(다른 폭 칸은 아는 것만 그대로 둔다).
export function twoValue(devValue, layout, on) {
  const out = {};
  for (const k of FILES_TWO_LAYOUTS) if (devValue && typeof devValue[k] === 'boolean') out[k] = devValue[k];
  if (FILES_TWO_LAYOUTS.includes(layout)) out[layout] = !!on;
  return out;
}
export const PANE_SIDE = Object.freeze(['왼쪽', '오른쪽']);
export const paneSide = i => PANE_SIDE[i === 1 ? 1 : 0];
// 고르기 막대 동작 이름: 받을 곳 = 반대 칸. 왼쪽 칸에서 고르면 '→ 오른쪽에 복사', 오른쪽 칸이면 '← 왼쪽에 복사'.
export function sendLabel(i, mode) {
  const arrow = i === 1 ? '←' : '→';
  return mode === 'move' ? `${arrow} 옮기기` : `${arrow} ${paneSide(i === 1 ? 0 : 1)}에 복사`;
}
// 반대 칸이 받을 수 있는 곳(폴더를 연 칸, 찾는 중·묶음 아님). 없으면 null.
export function paneDest(pane) {
  const w = pane?.where;
  return w?.source && !pane.query ? {source: w.source, parent: w.parent ?? null} : null;
}
// 두 칸을 처음 켤 때 오른쪽 칸의 첫 위치: 왼쪽과 다른 켜진 저장소의 맨 위(없으면 같은 저장소 맨 위).
export function otherStart(leftWhere, on) {
  const list = Array.isArray(on) ? on : [];
  if (!list.length) return null;
  const src = leftWhere?.source || '';
  return {source: list.find(s => s !== src) || list[0], parent: null};
}
// 끌어 놓기 받을 곳 묻기 글자(시안 ⑥ drop-hint).
export const DROP_ASK_TEXT = '여기에 놓으면';
