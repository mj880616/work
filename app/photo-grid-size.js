// OD-사진크기 (명진 요청 2026-10-28 07:28): 사진 격자의 한 줄 칸 수를 [－][＋]와 두 손가락 벌리기·오므리기로 바꾼다.
// - 단계: 좁은 화면(폰·접은 폴드)은 2·3·4·6칸(기본 4), 넓은 화면(761px 이상: 펼친 폴드·PC)은 6·8·10칸(기본 6). 넓이 기준은 diary.css의 격자 기준과 같다.
// - 고른 값은 서버(view-prefs.js의 photo_cols·photo_cols_wide, 내 프로필 행)에만 저장한다. 기기 저장 없음.
//   서버가 아직 두 칸을 모르면(DB 적용 전) 쓰기가 거절되어 서버 값은 기본으로 남고, 이번 접속 동안만 고른 칸 수를 메모리에 들고 있다.
// - 화면은 격자에 CSS 변수(--photo-cols, --photo-cols-wide) 두 개만 붙인다. 화면 폭이 바뀌면 CSS가 알맞은 쪽을 고른다(다시 그리지 않음, 받은 그림 그대로).
// - 핀치는 격자 위에서만 받는다: 격자는 touch-action:pan-y(세로 넘기기만 브라우저가 처리)라 그 위의 두 손가락은 화면 확대가 되지 않고 여기로 온다.
//   격자 밖은 지금처럼 브라우저의 화면 확대 그대로다. 한 손가락 넘기기·사진 누르기는 건드리지 않는다.
import {viewPrefs} from './view-prefs.js';

export const NARROW_STEPS = Object.freeze([2, 3, 4, 6]);
export const WIDE_STEPS = Object.freeze([6, 8, 10]);
export const NARROW_DEFAULT = 4, WIDE_DEFAULT = 6;
export const WIDE_QUERY = '(min-width:761px)';
// 두 손가락 사이 거리가 처음보다 이만큼 벌어지면(오므라들면) 한 단계. 한 번의 손동작에서 단계마다 기준을 다시 잡는다.
export const PINCH_IN = 0.8, PINCH_OUT = 1.25;

const stepsOf = wide => (wide ? WIDE_STEPS : NARROW_STEPS);
const keyOf = wide => (wide ? 'photo_cols_wide' : 'photo_cols');
export const validCols = (wide, n) => stepsOf(wide).includes(n);
// 한 단계 옮긴 칸 수. dir=+1이면 그림이 커짐(칸이 줄어듦), -1이면 작아짐(칸이 늘어남). 끝에서는 그대로.
export function stepCols(wide, cols, dir) {
  const steps = stepsOf(wide);
  let at = steps.indexOf(cols);
  if (at < 0) at = steps.indexOf(wide ? WIDE_DEFAULT : NARROW_DEFAULT);
  const next = Math.max(0, Math.min(steps.length - 1, at - Math.sign(dir)));
  return steps[next];
}
// 두 손가락 거리 비율 → 단계 방향(+1 크게, -1 작게, 0 그대로).
export const pinchDir = ratio => (ratio >= PINCH_OUT ? 1 : ratio <= PINCH_IN ? -1 : 0);

// 이번 접속의 선택(서버가 거절해도 화면은 고른 대로). 메모리만.
const chosen = {narrow: null, wide: null};
export function currentCols(wide, prefs = viewPrefs) {
  const mine = chosen[wide ? 'wide' : 'narrow'];
  if (validCols(wide, mine)) return mine;
  const saved = prefs?.get?.(keyOf(wide));
  return validCols(wide, saved) ? saved : wide ? WIDE_DEFAULT : NARROW_DEFAULT;
}
export const isWide = () => !!globalThis.matchMedia?.(WIDE_QUERY)?.matches;

// 격자 하나에 지금 칸 수를 입힌다(두 폭 모두).
export function paintGrid(grid) {
  if (!grid) return;
  grid.style.setProperty('--photo-cols', String(currentCols(false)));
  grid.style.setProperty('--photo-cols-wide', String(currentCols(true)));
}
// [－][＋] 상태(끝 단계면 누를 수 없음)와 안내 글.
export function paintButtons(root) {
  const wide = isWide(), cols = currentCols(wide);
  root?.querySelectorAll?.('[data-photo-size]').forEach(button => {
    const dir = Number(button.dataset.photoSize);
    button.disabled = stepCols(wide, cols, dir) === cols;
    button.title = `한 줄 ${cols}칸`;
  });
}
// 한 단계 바꾸고 서버에 저장한다. 바뀌었으면 true.
export function changeCols(dir, {prefs = viewPrefs, wide = isWide()} = {}) {
  const cols = currentCols(wide, prefs), next = stepCols(wide, cols, dir);
  if (next === cols) return false;
  chosen[wide ? 'wide' : 'narrow'] = next;
  prefs?.set?.(keyOf(wide), next, {rejectable: true});
  return true;
}
// [－][＋] 두 버튼(작고 낮게). 격자 줄 오른쪽 끝에 붙인다.
export const SIZE_BUTTONS = '<span class="photo-size" role="group" aria-label="사진 크기"><button type="button" data-photo-size="-1" aria-label="사진 작게(한 줄 칸 늘리기)">－</button><button type="button" data-photo-size="1" aria-label="사진 크게(한 줄 칸 줄이기)">＋</button></span>';

// 격자 위 두 손가락 벌리기·오므리기. onChange(dir)는 단계가 바뀐 뒤 부른다. 떼어 낼 함수를 돌려준다.
export function attachPinch(grid, onChange, change = changeCols) {
  if (!grid?.addEventListener) return () => {};
  let base = 0, active = false;
  const dist = touches => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
  const start = event => {
    if (event.touches.length === 2) { base = dist(event.touches); active = base > 0; }
    else if (event.touches.length > 2) active = false;
  };
  const move = event => {
    if (!active || event.touches.length !== 2) return;
    event.preventDefault(); // 격자 위 두 손가락은 화면 확대 대신 칸 수를 바꾼다(touch-action:pan-y와 함께)
    const d = dist(event.touches), dir = pinchDir(d / base);
    if (!dir) return;
    base = d;
    if (change(dir)) onChange?.(dir);
  };
  const end = event => { if (event.touches.length < 2) active = false; };
  grid.addEventListener('touchstart', start, {passive: true});
  grid.addEventListener('touchmove', move, {passive: false});
  grid.addEventListener('touchend', end, {passive: true});
  grid.addEventListener('touchcancel', end, {passive: true});
  return () => {
    grid.removeEventListener('touchstart', start); grid.removeEventListener('touchmove', move);
    grid.removeEventListener('touchend', end); grid.removeEventListener('touchcancel', end);
  };
}
// PHOTO-사진메뉴 2차: 다른 칸 수 규칙을 쓰는 격자(사진 메뉴 = view_prefs.photo_view.cols, 폰 3~6·PC 5~12)도 같은 [－][＋]·핀치를 쓴다.
// current(wide) → 지금 칸 수, step(wide, cols, dir) → 다음 칸 수, save(wide, cols) → 서버 저장(부르는 쪽). 돌려주는 함수 모양은 위 기본 것과 같다.
export function createGridSizer({current, step, save}) {
  const paint = grid => {
    if (!grid) return;
    grid.style.setProperty('--photo-cols', String(current(false)));
    grid.style.setProperty('--photo-cols-wide', String(current(true)));
  };
  const buttons = root => {
    const wide = isWide(), cols = current(wide);
    root?.querySelectorAll?.('[data-photo-size]').forEach(button => {
      button.disabled = step(wide, cols, Number(button.dataset.photoSize)) === cols;
      button.title = `한 줄 ${cols}칸`;
    });
  };
  const change = (dir, wide = isWide()) => {
    const cols = current(wide), next = step(wide, cols, dir);
    if (next === cols) return false;
    save(wide, next);
    return true;
  };
  return {paintGrid: paint, paintButtons: buttons, changeCols: change, attachPinch: (grid, onChange) => attachPinch(grid, onChange, dir => change(dir))};
}
// 테스트용: 이번 접속의 선택을 비운다.
export function resetChosen() { chosen.narrow = null; chosen.wide = null; }
