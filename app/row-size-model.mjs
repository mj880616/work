// UI-폴더줄크기(S69-99, 명진 2026-11-25 08:23 "오므리기 벌리기로 폴더 크기 다르게 보기 폴더 안으로 들어가기가 아니라 / 달력쪽 확대가 아니라 + - 느낌으로 사진 썸네일처럼"):
// 폴더·항목 줄 크기 단계. 화면 없이 시험하는 계산만(node --test).
// - 단계 넷: s(작게) · m(보통, 기본 = [파일] 줄 크기) · l(크게) · xl(아주 크게). 값은 서버 view_prefs.row_size 하나(모든 화면·모든 기기 같음, 기기 저장 없음).
// - 두 손가락 벌리기 = 한 단계 크게, 오므리기 = 한 단계 작게. 한 번의 손짓(손을 뗄 때)에 한 단계만. 끝 단계에서는 그대로.
// - 줄 높이·폴더 그림·글자 크기의 실제 값은 folder-tree.css의 [data-row-size] 한 곳이다.
export const ROW_SIZE_KEY = 'row_size';
export const ROW_SIZES = Object.freeze(['s', 'm', 'l', 'xl']);
export const ROW_SIZE_DEFAULT = 'm';
export const ROW_SIZE_NAME = Object.freeze({s: '작게', m: '보통', l: '크게', xl: '아주 크게'});
// 두 손가락 거리 비율 임계값: 처음보다 1.35배 이상 벌어지면 크게, 0.75배 이하로 오므라들면 작게(그 사이는 그대로 — 너무 민감하지 않게).
export const ROW_PINCH_OUT = 1.35;
export const ROW_PINCH_IN = 0.75;

export const validRowSize = v => ROW_SIZES.includes(v);
export const rowSizeOf = v => (validRowSize(v) ? v : ROW_SIZE_DEFAULT);
// 한 단계 옮긴 크기. dir = +1(크게)·-1(작게). 끝에서는 그대로.
export function stepRowSize(size, dir) {
  const i = ROW_SIZES.indexOf(rowSizeOf(size));
  const j = Math.max(0, Math.min(ROW_SIZES.length - 1, i + Math.sign(Number(dir) || 0)));
  return ROW_SIZES[j];
}
// 두 손가락 처음 거리(start)와 손짓 중 가장 멀어진 거리(max)·가장 가까워진 거리(min) → 손을 뗄 때 정할 방향(+1·-1·0).
// 벌렸다 다시 오므린 손짓은 마지막 거리(last)가 임계값 안으로 돌아왔으면 바꾸지 않는다(손을 뗄 때의 거리가 기준).
export function pinchRowDir(start, last) {
  const a = Number(start), b = Number(last);
  if (!(a > 0) || !(b >= 0)) return 0;
  const r = b / a;
  return r >= ROW_PINCH_OUT ? 1 : r <= ROW_PINCH_IN ? -1 : 0;
}
// Ctrl+휠 한 번(deltaY) → 방향. 위로 굴리면(음수) 크게, 아래로(양수) 작게. 아주 작은 움직임(터치패드 떨림)은 무시.
export const wheelRowDir = deltaY => (Number(deltaY) <= -4 ? 1 : Number(deltaY) >= 4 ? -1 : 0);
