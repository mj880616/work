// S52-11 CAL-폰달력핀치(명진 11/07 10:59·11:05, 시안 docs/design/mockups/calendar-phone-pinch.html): 폰 월 보기 달력 칸 위
// 두 손가락 벌리기 = 칸이 가로·세로 같은 비율로 함께 커짐(지도 확대처럼). 이 파일은 계산만 한다(화면·서버 없음, node --test로 시험).
// 화면(calendar-month-view.js)이 손가락 거리·화면 자리를 넘기고, 여기서 정한 배율로 CSS 변수 --cmv-zoom 하나만 바꾼다.
// 공용 두 손가락 부품(folder-pinch.js bindFolderPinch·photo-grid-size.js attachPinch)은 '한 번 넘으면 한 단계'만 알려 주므로
// 벌린 만큼 이어서 커지는 이 손짓에는 맞지 않아, 배율 계산만 따로 둔다. 크기는 기억하지 않는다(메모리만, 달 바꾸기·화면 떠나기에 처음 크기).
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 2.5;
// 손가락이 이만큼(4%)은 벌어지거나 오므려져야 손짓으로 본다(두 손가락을 대기만 한 떨림은 무시).
export const ZOOM_DEAD = 0.04;
// 손을 뗄 때 배율이 이보다 작으면 처음 크기로 돌아간다.
export const ZOOM_SNAP = 1.08;
// 처음 크기로 돌아가는 시간(시안: 0.2초).
export const ZOOM_BACK_MS = 200;

export const clampZoom = z => {
  const n = Number(z);
  return Number.isFinite(n) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)) : ZOOM_MIN;
};
// 손짓 동안의 배율: 손가락이 처음 닿을 때 배율 × (지금 거리 / 처음 거리). 떨림(ZOOM_DEAD 안쪽)이면 null.
export function pinchZoom(startZoom, startGap, nowGap) {
  const a = Number(startGap), b = Number(nowGap);
  if (!(a > 0) || !(b >= 0)) return null;
  const r = b / a;
  if (Math.abs(r - 1) < ZOOM_DEAD) return null;
  return clampZoom(clampZoom(startZoom) * r);
}
// 손을 뗀 뒤의 배율. 오므린 손짓(처음보다 작아짐)이거나 거의 처음 크기면 1(처음 한 화면 크기), 아니면 그대로.
export function releaseZoom(startZoom, endZoom) {
  const s = clampZoom(startZoom), e = clampZoom(endZoom);
  if (e < ZOOM_SNAP) return ZOOM_MIN;
  if (e < s - 0.001) return ZOOM_MIN;
  return e;
}
// 글자 배율: 칸보다 덜 커진다(최대 배율 2.5에서 약 1.5배) — '글자도 조금 커지고'.
export const fontScale = z => 1 + (clampZoom(z) - 1) * 0.35;
// 두 손가락 가운데 아래의 달력 자리가 그대로 있게 스크롤 자리를 옮긴다. scroll: 지금 스크롤, focal: 칸 안 손가락 가운데(칸 왼쪽·위 기준),
// before·after: 바뀌기 전·뒤 내용 크기(scrollWidth·scrollHeight), view: 보이는 크기(clientWidth·clientHeight).
export function focalScroll(scroll, focal, before, after, view = 0) {
  const s = Number(scroll) || 0, f = Number(focal) || 0, b = Number(before), a = Number(after);
  if (!(b > 0) || !(a > 0)) return Math.max(0, s);
  const next = (s + f) * (a / b) - f;
  const max = Math.max(0, a - (Number(view) || 0));
  return Math.round(Math.min(max, Math.max(0, next)));
}
