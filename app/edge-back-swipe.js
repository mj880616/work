// FILES-폰폴더위로(요청함 11/06 01:10) ④: 폰 '그 폴더만'에서 화면 왼쪽 끝에서 오른쪽으로 밀면 ‹와 같은 곳(한 단계 위, 길 처음이면 나무).
// 손가락 한 개, 화면 왼쪽 끝 EDGE_START px 안에서 시작한 것만 본다(줄 밀기·두 손가락·누르기·세로 굴리기는 건드리지 않는다).
// 탭 이동 밀기는 없다(UI-밀기탭이동삭제). 텔레그램 줄 밀기처럼 가장자리 24px 시작은 무시하는 줄 밀기와도 겹치지 않는다.

export const EDGE_START = 24; // 화면 왼쪽 끝에서 이 안에서 시작해야 한다(px)
export const EDGE_MIN = 64; // 오른쪽으로 이만큼 밀어야 한다(px)

// 판정(순수 함수, node --test로 시험). start·now: {x, y}(화면 기준). 'back' = 한 단계 위, 'cancel' = 이 손짓은 아님, null = 아직 모름.
export function edgeBackStep(start, now, {edge = EDGE_START, min = EDGE_MIN} = {}) {
  const sx = Number(start?.x), sy = Number(start?.y), nx = Number(now?.x), ny = Number(now?.y);
  if (![sx, sy, nx, ny].every(Number.isFinite)) return 'cancel';
  if (sx < 0 || sx > edge) return 'cancel';
  const dx = nx - sx, dy = Math.abs(ny - sy);
  // 세로로 더 움직였으면(굴리기) 이 손짓이 아니다.
  if (dy > 16 && dy >= Math.abs(dx)) return 'cancel';
  if (dx < -16) return 'cancel';
  return dx >= min && dx > dy * 1.5 ? 'back' : null;
}

// el: 손짓을 받을 칸(화면 칸 전체). enabled(): 지금 볼지('그 폴더만'일 때만). onBack(): 한 번의 손짓에 한 번만 부른다.
// 오른쪽으로 끄는 동안은 브라우저 자체 밀기(앞뒤 이동)가 같이 움직이지 않게 막는다. 돌려주는 함수를 부르면 떼어 낸다.
export function bindEdgeBack(el, {enabled = () => true, onBack = () => {}} = {}) {
  if (!el) return () => {};
  let p = null;
  const at = t => ({x: t.clientX, y: t.clientY});
  const start = e => {
    p = null;
    if (e.touches.length !== 1 || !enabled()) return;
    const s = at(e.touches[0]);
    if (s.x <= EDGE_START) p = {s, done: false};
  };
  const move = e => {
    if (!p || p.done) return;
    if (e.touches.length !== 1) { p = null; return; }
    const now = at(e.touches[0]), step = edgeBackStep(p.s, now);
    if (step === 'cancel') { p = null; return; }
    if (now.x - p.s.x > 8 && e.cancelable) e.preventDefault();
    if (step !== 'back') return;
    p.done = true;
    onBack();
  };
  const end = () => { p = null; };
  el.addEventListener('touchstart', start, {passive: true});
  el.addEventListener('touchmove', move, {passive: false});
  el.addEventListener('touchend', end, {passive: true});
  el.addEventListener('touchcancel', end, {passive: true});
  return () => {
    el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move);
    el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', end);
  };
}
