// FOLDER-나무새기준(S51-12) ④: 펼친 폴더 위에서 두 손가락을 벌리면 그 폴더만 크게, 오므리면 펼친 자리 그대로 나무로 돌아온다.
// 파일·노트·사진·자료실 폴더 나무가 함께 쓰는 손짓 부품 하나. 무엇을 보일지는 각 화면의 상태 주인이 정하고(onFocus·onExit),
// 이 부품은 두 손가락 거리만 잰다. 손가락 한 개 밀기·꾹 누르기·누르기는 건드리지 않는다.
// 나무 칸은 CSS(folder-tree.css .ft-pinch)가 touch-action:pan-x pan-y로 브라우저 확대를 막아 손짓이 화면 확대가 되지 않는다.

// 벌림·오므림 판정(순수 함수, node --test로 시험). start: 처음 두 손가락 거리, now: 지금 거리.
export const PINCH_OUT = 1.35;
export const PINCH_IN = 0.75;
export function pinchStep(start, now) {
  const a = Number(start), b = Number(now);
  if (!(a > 0) || !(b >= 0)) return null;
  const r = b / a;
  return r >= PINCH_OUT ? 'out' : r <= PINCH_IN ? 'in' : null;
}
const gap = (t1, t2) => Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

// el: 손짓을 받을 칸. folderAt(target): 두 손가락 가운데 있는 요소 → 그 폴더 열쇠(없으면 null). onOut(key)·onIn(): 벌림·오므림.
// enabled(): 지금 손짓을 볼지(선택 모드·끄는 중이면 false). 한 번의 손짓에 한 번만 부른다. 돌려주는 함수를 부르면 떼어 낸다.
export function bindFolderPinch(el, {folderAt = () => null, onOut = () => {}, onIn = () => {}, enabled = () => true} = {}) {
  if (!el) return () => {};
  el.classList.add('ft-pinch');
  // STAB-폴더상자시험(S61-10): 손가락 이벤트(touchmove·touchend)는 손가락을 댄 그 요소로만 간다. 손짓 도중 화면이 자료를 받아
  // 칸을 다시 그리면(innerHTML) 그 요소가 문서에서 떨어져 이벤트가 칸(el)까지 올라오지 않아 벌리기가 사라졌다.
  // 그래서 손짓이 시작되면 손가락을 댄 요소에도 직접 귀를 단다(떨어져도 그 요소에는 이벤트가 온다). 같은 이벤트는 한 번만 본다.
  let p = null, seen = null, hooked = [];
  const unhook = () => {
    for (const t of hooked) { t.removeEventListener('touchmove', move); t.removeEventListener('touchend', end); t.removeEventListener('touchcancel', end); }
    hooked = [];
  };
  const hook = targets => {
    unhook();
    for (const t of new Set(targets)) {
      if (!t?.addEventListener || t === el) continue;
      t.addEventListener('touchmove', move, {passive: true}); t.addEventListener('touchend', end, {passive: true}); t.addEventListener('touchcancel', end, {passive: true});
      hooked.push(t);
    }
  };
  const start = e => {
    if (e.touches.length !== 2 || !enabled()) { if (e.touches.length > 2) { p = null; unhook(); } return; }
    const [a, b] = e.touches, x = (a.clientX + b.clientX) / 2, y = (a.clientY + b.clientY) / 2;
    const target = document.elementFromPoint(x, y);
    // 두 손가락 가운데가 칸 밖이거나 비어 있으면 칸 자체를 넘긴다(화면이 손짓마다 새로 판정하게 — 지난 손짓의 판정이 남지 않게).
    p = {d: gap(a, b), key: folderAt(target && el.contains(target) ? target : el), done: false};
    hook([e.target, a.target, b.target]);
  };
  const move = e => {
    if (e === seen) return;
    seen = e;
    if (!p || p.done || e.touches.length !== 2) return;
    const step = pinchStep(p.d, gap(e.touches[0], e.touches[1]));
    if (!step) return;
    p.done = true;
    if (step === 'out') { if (p.key) onOut(p.key); } else onIn();
  };
  const end = e => { if (e.touches.length < 2) { p = null; unhook(); } };
  el.addEventListener('touchstart', start, {passive: true});
  el.addEventListener('touchmove', move, {passive: true});
  el.addEventListener('touchend', end, {passive: true});
  el.addEventListener('touchcancel', end, {passive: true});
  return () => {
    unhook();
    el.classList.remove('ft-pinch');
    el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move);
    el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', end);
  };
}
