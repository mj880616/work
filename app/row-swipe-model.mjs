// UI-목록밀기(2026-10-30 명진 요청 "이런 목록은 스와이프해서 삭제 가능했으면"): 폰 목록 줄 밀기의 셈만 모은 곳(화면 없음, 단위 시험 대상).
// 텔레그램 소식 줄 밀기(tg-day-model.mjs)와 같은 손동작 기준을 쓴다: 가로로 12px 넘게, 세로의 1.5배를 넘게 민 뒤에만 밀기로 보고,
// 화면 왼쪽 가장자리 24px 안에서 시작한 밀기는 무시한다(뒤로가기 손동작과 겹침 방지. 오른쪽 끝은 막지 않음 — S68-53). 버튼 한 칸은 64px.
// UI-줄밀기 Raindrop식(S68-26, 명진 11/22 21:31 "좌우 스와이프. 이것도 곳곳에 따라해"):
// - 왼쪽으로 밀기(end) = 오른쪽 끝에 단추 여러 칸(최대 3). 왼쪽부터 덜 위험한 것 → 맨 오른쪽 위험한 것(삭제). 칸은 줄 높이만큼 꽉 찬다.
// - 오른쪽으로 밀기(start) = 왼쪽 끝에 [선택] 한 칸 → 그 줄이 골라진 채로 '여러 개 고르기'.
// - 조금 밀고 떼면(첫 칸 폭의 절반 이상) 칸만 보이고 멈춘다. 끝까지 쭉 밀면(줄 폭의 45% 이상, 적어도 140px) 그 쪽 맨 끝 칸을 바로 실행한다.
//   단, 맨 끝 칸이 삭제면(이름이 '삭제'인 칸 포함, S68-50) 끝까지 밀어도 바로 실행하지 않고 칸만 열어 둔다(누르면 그 목록의 휴지통 + '지웠어요 [되돌리기]' 길 그대로).
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
// 화면 왼쪽 가장자리에서 시작했는가(그러면 밀기를 보지 않는다 — 브라우저 뒤로가기·폴더 한 단계 위(edge-back-swipe.js) 손동작 몫).
// S68-53(명진 11/23 14:49 "우에서 좌로가 아예 스와이프가 안됨"): 오른쪽 가장자리는 막지 않는다. 오른쪽에서 왼쪽으로 미는 손가락은
// 거의 늘 화면 오른쪽 끝(⋯ 단추 자리)에서 시작하는데, 전에는 오른쪽 끝 24px도 막아서 줄이 움직이지 않고 그 밀기를 보기 탭 넘김이 가져갔다
// (390 폭에서는 ⋯ 단추 오른쪽 절반이 막힌 띠 안). 폰 시스템 뒤로가기 손동작(제스처 내비게이션)은 운영체제가 먼저 가져가므로 웹이 막을 필요가 없다.
// 두 번째 값(화면 폭)은 옛 부르는 곳과 맞추려고 받기만 한다.
export const swipeEdge = x => !(Number(x) >= SWIPE_EDGE);
// 끝까지 민 것으로 보는 거리.
export const fullDistance = rowWidth => Math.max(SWIPE_FULL_MIN, Math.round((Number(rowWidth) || 0) * SWIPE_FULL_RATIO));

// 삭제 칸인가(끝까지 밀어도 바로 실행하지 않는 칸).
export const isDanger = a => !!a && (a.key === 'delete' || a.tone === 'danger');
// 끝까지 밀어도 바로 하지 않는 칸: 삭제 칸(isDanger) + 이름이 '삭제'인 칸(S68-50, 명진 11/23 12:46 "좌우 스와이프 제대로 작동 안함 점검").
// News [저장한 글] 탭의 [삭제](저장 빼기, 되돌리기 있는 차분한 색 칸)는 isDanger가 아니라 끝까지 밀면 바로 지워졌다 — 삭제는 칸을 직접 누를 때만.
export const holdFull = a => isDanger(a) || /삭제/.test(String(a?.label || ''));
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
// UI-오른쪽밀기고르기(S70-64, 2026-11-26 07:44 명진 "오른쪽으로 밀면 선택이 되는데 이거는 복수선택 용이야"):
// 오른쪽 밀기는 고르기 하나뿐이다. start 칸이 [선택](key 'select')이면 startPick — 반 칸(32px) 넘게 밀고 떼면 칸을 열어 두지 않고 바로 그 줄을 고른다.
export const PICK_KEY = 'select';
export function sides(acts) {
  const ends = endCells(acts?.end), pick = acts?.start?.key === PICK_KEY;
  const out = {start: acts?.start ? 1 : 0, end: ends.length, startFull: !!acts?.start && !holdFull(acts.start), endFull: ends.length > 0 && !holdFull(ends.at(-1))};
  if (pick) out.startPick = true;
  return out;
}
// 줄이 따라가는 자리. 칸이 없는 쪽으로는 움직이지 않는다. 줄 폭보다 더 가지 않는다.
export function rowOffset(dx, open = 0, has = {start:true, end:true}, rowWidth = 360) {
  const x = (Number(open) || 0) + (Number(dx) || 0), max = Math.max(SWIPE_BTN, Number(rowWidth) || 0);
  return Math.max(count(has.end) ? -max : 0, Math.min(count(has.start) ? max : 0, x)) + 0;
}
// 손을 뗀 자리 → {side:'start'|'end'|'', run:boolean}. run이면 그쪽 맨 끝 칸을 바로 한다(누른 것과 같음).
// has.startFull/endFull이 false(맨 끝 칸이 삭제)면 끝까지 밀어도 열기만 한다. 옛 모양(startFull 없음)은 끝까지 밀기 허용.
// from: 손을 대기 전 줄 자리(열려 있던 줄이면 그 칸 폭만큼). 열린 줄을 닫는 쪽으로 반 칸(32px) 넘게 밀면 닫는다(S68-50) —
// 전에는 칸 3개(192px)가 열린 줄을 닫으려면 160px 넘게 되밀어야 해서, 짧게 밀면 다시 열린 채로 남았다.
export function rowSettle(offset, has = {start:true, end:true}, rowWidth = 360, from = 0) {
  const x = Number(offset) || 0, full = fullDistance(rowWidth), s = count(has.start), e = count(has.end), was = Number(from) || 0, half = SWIPE_BTN / 2;
  // 고르기(startPick): 반 칸 넘게 오른쪽으로 밀면 바로 고른다(열린 칸 없음). 열린 왼쪽 칸을 닫는 되밀기는 아래 닫기 규칙이 먼저.
  if (s && has.startPick && x >= SWIPE_BTN / 2 && !(was < 0 && x < half)) return {side:'start', run:true};
  if (s && x >= full) return {side:'start', run:has.startFull !== false};
  if (e && x <= -full) return {side:'end', run:has.endFull !== false};
  if (was < 0 && x >= was + half && x < half) return {side:'', run:false};
  if (was > 0 && x <= was - half && x > -half) return {side:'', run:false};
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
