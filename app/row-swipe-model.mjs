// UI-목록밀기(2026-10-30 명진 요청 "이런 목록은 스와이프해서 삭제 가능했으면"): 폰 목록 줄 밀기의 셈만 모은 곳(화면 없음, 단위 시험 대상).
// 텔레그램 소식 줄 밀기(tg-day-model.mjs)와 같은 손동작 기준을 쓴다: 가로로 12px 넘게, 세로의 1.5배를 넘게 민 뒤에만 밀기로 보고,
// 화면 가장자리 24px 안에서 시작한 밀기는 무시한다(폰 뒤로가기 제스처와 겹침 방지). 버튼 한 칸은 64px.
// 왼쪽으로 밀기 = 오른쪽 끝에 [삭제](end), 오른쪽으로 밀기 = 왼쪽 끝에 그 목록의 대표 처리 하나(start).
// 조금 밀고 떼면(버튼 폭의 절반 이상) 버튼만 보이고 멈춘다. 끝까지 쭉 밀면(줄 폭의 45% 이상, 적어도 140px) 손을 떼는 순간 바로 실행한다.
export const SWIPE_BTN = 64;
export const SWIPE_START = 12;
export const SWIPE_EDGE = 24;
export const SWIPE_FULL_MIN = 140;
export const SWIPE_FULL_RATIO = 0.45;

// 'wait'(아직 모름) | 'scroll'(세로, 밀기 아님) | 'swipe'(가로가 세로의 1.5배를 넘고 12px 이상)
export function swipeIntent(dx, dy) {
  const ax = Math.abs(Number(dx) || 0), ay = Math.abs(Number(dy) || 0);
  if (Math.max(ax, ay) < SWIPE_START) return 'wait';
  return ax >= SWIPE_START && ax > ay * 1.5 ? 'swipe' : 'scroll';
}
// 화면 가장자리에서 시작했는가(그러면 밀기를 보지 않는다).
export const swipeEdge = (x, width) => !(x >= SWIPE_EDGE && x <= width - SWIPE_EDGE);
// 끝까지 민 것으로 보는 거리.
export const fullDistance = rowWidth => Math.max(SWIPE_FULL_MIN, Math.round((Number(rowWidth) || 0) * SWIPE_FULL_RATIO));
// 줄이 따라가는 자리. has: {start, end} 그쪽 버튼이 있는가. 버튼이 없는 쪽으로는 움직이지 않는다. 줄 폭보다 더 가지 않는다.
export function rowOffset(dx, open = 0, has = {start:true, end:true}, rowWidth = 360) {
  const x = (Number(open) || 0) + (Number(dx) || 0), max = Math.max(SWIPE_BTN, Number(rowWidth) || 0);
  return Math.max(has.end ? -max : 0, Math.min(has.start ? max : 0, x)) + 0;
}
// 손을 뗀 자리 → {side:'start'|'end'|'', run:boolean}. run이면 그쪽 처리를 바로 한다(버튼을 누른 것과 같음).
export function rowSettle(offset, has = {start:true, end:true}, rowWidth = 360) {
  const x = Number(offset) || 0, full = fullDistance(rowWidth);
  if (has.start && x >= full) return {side:'start', run:true};
  if (has.end && x <= -full) return {side:'end', run:true};
  if (has.start && x >= SWIPE_BTN / 2) return {side:'start', run:false};
  if (has.end && x <= -SWIPE_BTN / 2) return {side:'end', run:false};
  return {side:'', run:false};
}
export const openOffset = side => side === 'start' ? SWIPE_BTN : side === 'end' ? -SWIPE_BTN : 0;
