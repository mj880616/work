// NOTE-글폭(S61-21, 요청함 11/13 10:40·11:04 "노트는 좌우 폭이 무작정 넓다고 좋은 건 아닌 거 같어" → "노트폭은 드래그 가능하게"): 글 줄 폭 규칙(순수 함수, node --test).
// 글 줄 기본 폭 = 한 줄 약 40자(40em, 글자 크기를 따라 같이 커짐). 손잡이로 끌어 바꾼 폭은 서버 view_prefs.col_widths.doc.line[_f]에 둔다
// (표 칸 너비와 같은 저장 길·같은 화면 종류 꼬리 col-widths-model.mjs, 기기 저장 없음, 새 DB 칸 없음).
// 저장 값은 px가 아니라 em의 10배(정수 200~800 = 20em~80em): 글자 크기·노트 배율이 바뀌어도 한 줄 글자 수가 그대로다. DB 검사(40~800 숫자) 안이다.
// 노트·일기·큰 쓰기 창이 값 하나를 함께 쓴다. 폰(600px 미만)은 손잡이도 폭 묶음도 없다(창 폭 그대로).
export const LINE_SCREEN = 'doc';
export const LINE_KEY = 'line';
export const LINE_DEFAULT_EM = 40, LINE_MIN_EM = 20, LINE_MAX_EM = 80, LINE_STEP_EM = 1;
// 한 번에 0.5em 단위로 맞춘다(끄는 동안 떨림이 저장 값을 흔들지 않게).
const snap = em => Math.round(em * 2) / 2;
// em을 [최소, 최대] 안으로. room = 지금 화면에서 글이 쓸 수 있는 폭(em), 최대는 그보다 넓지 않게(단, 최소보다 좁게 만들지는 않음).
export function clampEm(em, room = LINE_MAX_EM) {
  const top = Math.max(LINE_MIN_EM, Math.min(LINE_MAX_EM, Number.isFinite(room) ? room : LINE_MAX_EM));
  const v = Number(em);
  return snap(Math.min(top, Math.max(LINE_MIN_EM, Number.isFinite(v) ? v : LINE_DEFAULT_EM)));
}
// 저장 값 → em(없거나 이상하면 기본 40em).
export function lineEm(stored) {
  const v = Number(stored);
  return typeof stored === 'number' && Number.isFinite(v) && v >= LINE_MIN_EM * 10 && v <= LINE_MAX_EM * 10 ? snap(v / 10) : LINE_DEFAULT_EM;
}
// em → 저장 값(기본 40em이면 null = 저장 칸을 지워 기본으로).
export function lineStored(em) {
  if (em === null || em === undefined) return null;
  const v = clampEm(em);
  return v === LINE_DEFAULT_EM ? null : Math.round(v * 10);
}
