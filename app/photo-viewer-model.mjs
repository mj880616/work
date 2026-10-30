// OD-크게보기 (명진 요청 2026-10-28 07:28·07:45): 사진 크게 보기의 손동작 판정과 공유 파일 이름. 화면 없는 순수 함수(단위 시험 대상).
// 손동작: 위로 밀기 = 별표 토글, 아래로 밀기 = 닫기, 좌우 = 앞뒤 사진(가로 넘기기는 브라우저 스크롤이 맡는다).
// 실수 방지: 세로로 SWIPE_MIN px 이상, 세로가 가로의 SWIPE_RATIO배 이상, SWIPE_MAX_MS 안에 끝난 한 손가락 손동작만 센다.
export const SWIPE_MIN = 72, SWIPE_RATIO = 1.6, SWIPE_MAX_MS = 900;
// 지우기 뒤 '되돌리기'를 보여 주는 시간. 이 시간이 지나야(또는 크게 보기를 닫거나 화면을 떠나면) 원드라이브 휴지통으로 보낸다.
export const UNDO_MS = 5000;

export function swipeKind({dx = 0, dy = 0, dt = 0, fingers = 1, zoomed = false} = {}) {
  if (fingers !== 1 || zoomed || !(dt >= 0 && dt <= SWIPE_MAX_MS)) return null;
  const ay = Math.abs(dy), ax = Math.abs(dx);
  if (ay < SWIPE_MIN || ay < ax * SWIPE_RATIO) return null;
  return dy < 0 ? 'up' : 'down';
}
// 공유할 사진 파일 이름: 원래 이름이 그림 확장자로 끝나면 그대로, 아니면 '사진-날짜.jpg'. 경로·제어문자는 뺀다.
export function shareFileName(item, type = 'image/jpeg') {
  const raw = String(item?.name || item?.file?.file_name || '').replace(/[\\/\p{Cc}]/gu, '').trim();
  if (/\.(jpe?g|png|gif|webp|heic|heif|avif)$/i.test(raw) && raw.length <= 120) return raw;
  const ext = /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : /gif/.test(type) ? 'gif' : 'jpg';
  return `사진-${/^\d{4}-\d{2}-\d{2}$/.test(item?.day || '') ? item.day : 'photo'}.${ext}`;
}
// 지운 사진을 원래 자리로 되돌린 목록(같은 id가 이미 있으면 그대로).
export function putBack(list, photo, index) {
  const out = Array.isArray(list) ? list.slice() : [];
  if (!photo || out.some(p => p?.id === photo.id)) return out;
  out.splice(Math.max(0, Math.min(out.length, index)), 0, photo);
  return out;
}

// PHOTO-스와이프안내(2026-10-30 명진 결정 "스와이프 모션 좋아"): 손가락을 따라 사진이 움직이는 세로 밀기.
// - 손가락이 DRAG_START px 넘게 움직이면 방향을 정한다: 세로가 가로의 SWIPE_RATIO배 이상이면 세로(사진이 따라 움직임), 아니면 가로(넘기기는 브라우저).
//   두 손가락·확대 중이면 none(움직이지 않음).
// - 놓을 때: 위로 STAR_DIST 넘게 = 별표 토글, 아래로 CLOSE_DIST 넘게 = 닫기, 그 밖 = 제자리(별표 안 됨).
export const DRAG_START = 10, STAR_DIST = 96, CLOSE_DIST = 120;
export function dragAxis({dx = 0, dy = 0, fingers = 1, zoomed = false} = {}) {
  if (fingers !== 1 || zoomed) return 'none';
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (Math.max(ax, ay) < DRAG_START) return null;
  return ay >= ax * SWIPE_RATIO ? 'y' : 'x';
}
export function dragEnd(dy = 0) {
  if (!Number.isFinite(dy)) return 'back';
  if (-dy >= STAR_DIST) return 'star';
  if (dy >= CLOSE_DIST) return 'close';
  return 'back';
}
// 위로 민 거리만큼 별이 차오르는 정도(0~1).
export const starFill = dy => (Number.isFinite(dy) ? Math.max(0, Math.min(1, -dy / STAR_DIST)) : 0);
// 사진이 손가락을 따라가는 거리: 위로는 별표 거리를 조금 넘어서부터 무겁게(고무줄), 아래로는 그대로.
export function dragOffset(dy = 0) {
  if (!Number.isFinite(dy)) return 0;
  if (dy >= 0) return dy;
  const lim = STAR_DIST * 1.25;
  return -dy <= lim ? dy : -(lim + (-dy - lim) * 0.35);
}
// 손동작 안내: 처음 HINT_TIMES번 크게 보기를 열 때만. 본 횟수는 서버(view_prefs.photo_hint, 0~9 정수)에 둔다(기기 저장 없음).
export const HINT_TIMES = 3, HINT_MAX = 9;
export const hintSeen = v => (Number.isInteger(v) && v >= 0 ? Math.min(HINT_MAX, v) : 0);
export const hintDue = (v, times = HINT_TIMES) => hintSeen(v) < times;
export const hintNext = v => Math.min(HINT_MAX, hintSeen(v) + 1);
export const HINT_TEXT = '↑ 위로 밀면 별표 · 아래로 밀면 닫기';
// [ⓘ 정보] '불러오기' 한 줄(PHOTO-크게보기빨리): t = {start, url, shown}(밀리초, 같은 시계). 다 뜨기 전이면 빈 값(줄 없음, 뜨면 다시 그린다).
const sec = ms => (Math.max(0, ms) / 1000).toFixed(1);
export function loadTimeText(t) {
  if (!t || !Number.isFinite(t.start)) return '';
  if (!Number.isFinite(t.shown)) return '';
  const total = sec(t.shown - t.start);
  if (!Number.isFinite(t.url)) return `${total}초`;
  return `${total}초 (주소 ${sec(t.url - t.start)} · 사진 ${sec(t.shown - t.url)})`;
}
