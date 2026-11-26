// UI-폴더줄크기(S69-99, 사용자 2026-11-25 08:23 "오므리기 벌리기로 폴더 크기 다르게 보기 폴더 안으로 들어가기가 아니라 / 달력쪽 확대가 아니라 + - 느낌으로 사진 썸네일처럼"):
// 파일·노트·사진·자료실 폴더 나무·목록이 함께 쓰는 두 손가락 손짓 부품 하나. 두 손가락 벌리기 = 줄 크기 한 단계 크게, 오므리기 = 한 단계 작게
// (row-size.js, 사진 칸 수 바꾸듯 단계로 — 연속 확대가 아니다). 한 번의 손짓에 한 단계, 손을 뗄 때 한 번만 바뀐다.
// 그 폴더로 들어가기는 손짓이 아니라 ⋯ 첫 줄 [이 폴더로 들어가기]로만 한다(전의 FOLDER-나무새기준 ④ '벌리면 그 폴더만'을 대신함).
// 손가락 한 개 밀기·꾹 누르기·누르기는 건드리지 않는다. 손짓 칸은 CSS(folder-tree.css .ft-pinch)가 touch-action:pan-x pan-y로 브라우저 확대를 막는다.
// PC는 손짓 칸 위 Ctrl+휠 한 번 = 한 단계(브라우저 확대 대신).
import {pinchRowDir, wheelRowDir} from './row-size-model.mjs';
import {changeRowSize} from './row-size.js';

const gap = (t1, t2) => Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
const WHEEL_REST_MS = 250; // Ctrl+휠: 한 번 굴림(이어지는 휠 알림 묶음)에 한 단계

// el: 손짓을 받을 칸. enabled(at): 지금 손짓을 볼지(선택 모드·끄는 중이면 false). at = 두 손가락 가운데(Ctrl+휠이면 마우스 자리) 요소.
// onStep(dir, size): 단계가 바뀐 뒤 부른다(화면이 필요하면 자리 맞추기 — 보통은 CSS만 바뀌어 할 일 없음). 돌려주는 함수를 부르면 떼어 낸다.
export function bindFolderPinch(el, {enabled = () => true, onStep = () => {}} = {}) {
  if (!el) return () => {};
  el.classList.add('ft-pinch');
  // STAB-폴더상자시험(S61-10): 손가락 이벤트(touchmove·touchend)는 손가락을 댄 그 요소로만 간다. 손짓 도중 화면이 자료를 받아
  // 칸을 다시 그리면(innerHTML) 그 요소가 문서에서 떨어져 이벤트가 칸(el)까지 올라오지 않는다.
  // 그래서 손짓이 시작되면 손가락을 댄 요소에도 직접 귀를 단다(떨어져도 그 요소에는 이벤트가 온다). 같은 이벤트는 한 번만 본다.
  let p = null, seen = null, hooked = [];
  const unhook = () => {
    for (const t of hooked) { t.removeEventListener('touchmove', move); t.removeEventListener('touchend', end); t.removeEventListener('touchcancel', cancel); }
    hooked = [];
  };
  const hook = targets => {
    unhook();
    for (const t of new Set(targets)) {
      if (!t?.addEventListener || t === el) continue;
      t.addEventListener('touchmove', move, {passive: true}); t.addEventListener('touchend', end, {passive: true}); t.addEventListener('touchcancel', cancel, {passive: true});
      hooked.push(t);
    }
  };
  const start = e => {
    if (e.touches.length !== 2) { if (e.touches.length > 2) { p = null; unhook(); } return; }
    const [a, b] = e.touches, at = globalThis.document?.elementFromPoint?.((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    if (!enabled(at && el.contains(at) ? at : el)) return;
    p = {d: gap(a, b), last: gap(a, b)};
    hook([e.target, a.target, b.target]);
  };
  const move = e => {
    if (e === seen) return;
    seen = e;
    if (!p || e.touches.length !== 2) return;
    p.last = gap(e.touches[0], e.touches[1]);
  };
  // 손을 뗄 때(두 손가락 중 하나라도 떨어질 때) 한 번만 정한다: 처음 거리와 마지막 거리 비율이 임계값을 넘었을 때만 한 단계.
  const end = e => {
    if (e === seen) return;
    seen = e;
    if (e.touches.length >= 2) return;
    const g = p; p = null; unhook();
    if (!g) return;
    const dir = pinchRowDir(g.d, g.last);
    if (!dir) return;
    const size = changeRowSize(dir);
    if (size) onStep(dir, size);
  };
  const cancel = () => { p = null; unhook(); };
  let wheelAt = -Infinity;
  const wheel = e => {
    if (!e.ctrlKey || !enabled(e.target)) return;
    e.preventDefault(); // 이 칸 위 Ctrl+휠은 브라우저 확대 대신 줄 크기
    const now = e.timeStamp || Date.now(), rest = now - wheelAt > WHEEL_REST_MS;
    wheelAt = now;
    if (!rest) return;
    const dir = wheelRowDir(e.deltaY);
    if (!dir) { wheelAt = -Infinity; return; }
    const size = changeRowSize(dir);
    if (size) onStep(dir, size);
  };
  el.addEventListener('touchstart', start, {passive: true});
  el.addEventListener('touchmove', move, {passive: true});
  el.addEventListener('touchend', end, {passive: true});
  el.addEventListener('touchcancel', cancel, {passive: true});
  el.addEventListener('wheel', wheel, {passive: false});
  return () => {
    unhook();
    el.classList.remove('ft-pinch');
    el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move);
    el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', cancel);
    el.removeEventListener('wheel', wheel);
  };
}
