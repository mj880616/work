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
