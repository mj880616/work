// S51-24 FOLDER-그폴더만같은모양 ④(요청함 11/06 21:52, 시안 docs/design/mockups/folder-focus-continuity.html '전환'):
// 나무 ⇄ '그 폴더만'을 0.2초 움직임으로 잇는 공용 부품 하나(파일·노트·사진·자료실). 무엇을 그릴지는 각 화면의 상태 주인이 정하고,
// 이 부품은 다 그린 뒤의 요소에 잠깐 움직임(Web Animations)만 얹는다. 스타일을 남기지 않고, 기기 '움직임 줄이기'면 아무것도 하지 않는다.
export const FOCUS_MS = 200;
const still = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
const play = (el, frames, ms = FOCUS_MS) => { try { el?.animate?.(frames, {duration: ms, easing: 'cubic-bezier(.2,.7,.2,1)'}); } catch { /* 움직임 없이 그대로 */ } };

// 벌리기: from = 벌리기 전 그 폴더 줄의 화면 위치(getBoundingClientRect().top), box = 다 그린 '그 폴더만' 상자.
// 상자 머리와 그 아래 하위 폴더 줄은 그 줄 자리에서 위로 올라오고, 파일 줄(격자)은 아래에서 나타난다.
export function riseFromRow(from, box, {follow = '.ft-box-body > .ft-folder', appear = '.ft-box-body > :not(.ft-folder)'} = {}) {
  if (still() || typeof from !== 'number' || !box) return;
  const head = box.querySelector('.ft-focus-head');
  if (!head) return;
  const dy = from - head.getBoundingClientRect().top;
  if (Math.abs(dy) < 2) return;
  const move = [{transform: `translateY(${dy}px)`}, {transform: 'none'}];
  play(head, move);
  for (const el of box.querySelectorAll(follow)) play(el, move);
  for (const el of box.querySelectorAll(appear)) play(el, [{opacity: 0, transform: 'translateY(12px)'}, {opacity: 1, transform: 'none'}]);
  play(box.querySelector('.ft-focus-anc'), [{opacity: 0}, {opacity: 1}]);
}
// 오므리기: 나무로 돌아온 뒤 그 줄(row)이 '그 폴더만' 상자 머리가 있던 자리(from)에서 제자리로 내려오고, 나무의 다른 칸(others)은 빨리 나타난다.
export function sinkToRow(from, row, others = []) {
  if (still() || typeof from !== 'number' || !row) return;
  const dy = from - row.getBoundingClientRect().top;
  if (Math.abs(dy) >= 2) play(row, [{transform: `translateY(${dy}px)`}, {transform: 'none'}]);
  for (const el of others) if (el && el !== row && !el.contains(row)) play(el, [{opacity: 0}, {opacity: 1}], FOCUS_MS * 0.6);
}
// 위치 재기(그리기 전에): 그 요소의 화면 위 끝, 없으면 null.
export const topOf = el => (el ? el.getBoundingClientRect().top : null);
