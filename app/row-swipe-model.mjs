// UI-목록밀기(2026-10-30 명진 요청 "이런 목록은 스와이프해서 삭제 가능했으면"): 폰 목록 줄 밀기의 셈만 모은 곳(화면 없음, 단위 시험 대상).
// 텔레그램 소식 줄 밀기(tg-day-model.mjs)와 같은 손동작 기준을 쓴다: 가로로 12px 넘게, 세로의 1.5배를 넘게 민 뒤에만 밀기로 보고,
// 화면 가장자리 24px 안에서 시작한 밀기는 무시한다(폰 뒤로가기 제스처와 겹침 방지). 버튼 한 칸은 64px.
// UI-줄밀기 Raindrop식(S68-26, 명진 11/22 21:31 "좌우 스와이프. 이것도 곳곳에 따라해"):
// - 왼쪽으로 밀기(end) = 오른쪽 끝에 단추 여러 칸(최대 3). 왼쪽부터 덜 위험한 것 → 맨 오른쪽 위험한 것(삭제). 칸은 줄 높이만큼 꽉 찬다.
// - 오른쪽으로 밀기(start) = 왼쪽 끝에 [선택] 한 칸 → 그 줄이 골라진 채로 '여러 개 고르기'.
// - 조금 밀고 떼면(첫 칸 폭의 절반 이상) 칸만 보이고 멈춘다. 끝까지 쭉 밀면(줄 폭의 45% 이상, 적어도 140px) 그 쪽 맨 끝 칸을 바로 실행한다.
//   단, 맨 끝 칸이 삭제면 끝까지 밀어도 바로 실행하지 않고 칸만 열어 둔다(누르면 그 목록의 휴지통 + '지웠어요 [되돌리기]' 길 그대로).
export const SWIPE_BTN = 64;
export const SWIPE_START = 12;
export const SWIPE_EDGE = 24;
export const SWIPE_FULL_MIN = 140;
export const SWIPE_FULL_RATIO = 0.45;
export const SWIPE_END_MAX = 3;

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

// 삭제 칸인가(끝까지 밀어도 바로 실행하지 않는 칸).
export const isDanger = a => !!a && (a.key === 'delete' || a.tone === 'danger');
// 그 목록이 준 end 칸들 → 실제로 그릴 칸(최대 3, 빈 것 빼기, 위험한 것은 맨 오른쪽으로). 하나만 준 옛 모양({…})도 받는다.
export function endCells(end) {
  const list = (Array.isArray(end) ? end : end ? [end] : []).filter(a => a && a.key);
  const safe = list.filter(a => !isDanger(a)), danger = list.filter(isDanger);
  const out = [...safe, ...danger];
  // 3칸이 넘으면 위험한 칸(삭제)은 남기고 덜 중요한 뒤쪽 칸부터 뺀다.
  while (out.length > SWIPE_END_MAX) out.splice(out.length - 1 - (danger.length ? 1 : 0), 1);
  return out;
}
// 줄에서 쓸 칸 수와 끝까지 밀기 허용. has.start/has.end는 칸 수(옛 true/false도 받음: true = 1칸).
const count = v => (v === true ? 1 : Math.max(0, Math.min(SWIPE_END_MAX, Number(v) || 0)));
export function sides(acts) {
  const ends = endCells(acts?.end);
  return {start: acts?.start ? 1 : 0, end: ends.length, startFull: !!acts?.start && !isDanger(acts.start), endFull: ends.length > 0 && !isDanger(ends.at(-1))};
}
// 줄이 따라가는 자리. 칸이 없는 쪽으로는 움직이지 않는다. 줄 폭보다 더 가지 않는다.
export function rowOffset(dx, open = 0, has = {start:true, end:true}, rowWidth = 360) {
  const x = (Number(open) || 0) + (Number(dx) || 0), max = Math.max(SWIPE_BTN, Number(rowWidth) || 0);
  return Math.max(count(has.end) ? -max : 0, Math.min(count(has.start) ? max : 0, x)) + 0;
}
// 손을 뗀 자리 → {side:'start'|'end'|'', run:boolean}. run이면 그쪽 맨 끝 칸을 바로 한다(누른 것과 같음).
// has.startFull/endFull이 false(맨 끝 칸이 삭제)면 끝까지 밀어도 열기만 한다. 옛 모양(startFull 없음)은 끝까지 밀기 허용.
export function rowSettle(offset, has = {start:true, end:true}, rowWidth = 360) {
  const x = Number(offset) || 0, full = fullDistance(rowWidth), s = count(has.start), e = count(has.end);
  if (s && x >= full) return {side:'start', run:has.startFull !== false};
  if (e && x <= -full) return {side:'end', run:has.endFull !== false};
  if (s && x >= SWIPE_BTN / 2) return {side:'start', run:false};
  if (e && x <= -SWIPE_BTN / 2) return {side:'end', run:false};
  return {side:'', run:false};
}
// 멈춘 자리: 그쪽 칸 수만큼.
export const openOffset = (side, cells = 1) => side === 'start' ? SWIPE_BTN : side === 'end' ? -SWIPE_BTN * Math.max(1, count(cells)) : 0;
// 밀고 있는 동안 칸 하나의 너비: 칸이 다 보이기 전에는 64px, 더 밀면 드러난 폭을 칸 수로 나눠 함께 넓어진다.
export const cellWidth = (offset, cells = 1) => Math.max(SWIPE_BTN, Math.round(Math.abs(Number(offset) || 0) / Math.max(1, count(cells) || 1)));
// 고르기 줄 글자: 'n개 선택됨'(노트 선택 줄과 같은 말).
export const pickedLabel = n => `${Math.max(0, Number(n) || 0)}개 선택됨`;
