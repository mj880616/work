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

// PHOTO-전체화면확대(요청함 10/31 19:23): 크게 보기 안 사진 확대·축소(갤럭시 갤러리와 같은 손동작). 화면 없는 순수 함수(단위 시험 대상).
// 상태 z = {s, x, y}: s = 배율(1 = 원래 크기), x·y = 사진 가운데가 칸 가운데에서 옮겨 간 거리(px). 기기 저장 없음(메모리만).
// - 두 손가락 벌리기·오므리기 / 휠 = 손가락(마우스) 아래 점을 그 자리에 둔 채 배율만 바꾼다(zoomAt).
// - 두 번 톡 / 더블클릭 = 원래 크기면 ZOOM_TAP배로 그 점을 확대, 확대 중이면 원래 크기(zoomToggle).
// - 확대 중에는 한 손가락(마우스 끌기)으로 사진 안을 움직이고, 사진 끝이 칸 끝을 넘어 비지 않게 막는다(clampPan).
export const ZOOM_MIN = 1, ZOOM_MAX = 5, ZOOM_TAP = 2.5, ZOOM_EPS = 0.02;
export const TAP_MS = 300, TAP_MOVE = 12, DOUBLE_TAP_MS = 320, DOUBLE_TAP_DIST = 40;
export const ZOOM_ONE = Object.freeze({s: 1, x: 0, y: 0});
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
export const clampScale = s => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, num(s, 1)));
export const isZoomed = z => num(z?.s, 1) > 1 + ZOOM_EPS;
// 사진이 칸 안에서 차지하는 크기(object-fit:contain): 그림 원래 크기를 모르면 칸 크기 그대로.
export function fitSize({W = 0, H = 0, nw = 0, nh = 0} = {}) {
  if (!(W > 0 && H > 0)) return {cw: 0, ch: 0};
  if (!(nw > 0 && nh > 0)) return {cw: W, ch: H};
  const f = Math.min(W / nw, H / nh);
  return {cw: nw * f, ch: nh * f};
}
// 옮긴 거리를 사진 끝이 칸 끝 안으로 들어오지 않을 만큼으로 막는다(사진이 칸보다 작은 쪽은 가운데 고정).
export function clampPan(z, box = {}) {
  const s = clampScale(z?.s);
  if (s <= 1 + ZOOM_EPS) return {s: 1, x: 0, y: 0};
  const {cw, ch} = fitSize(box);
  const mx = Math.max(0, (cw * s - num(box.W)) / 2), my = Math.max(0, (ch * s - num(box.H)) / 2);
  return {s, x: Math.max(-mx, Math.min(mx, num(z?.x))) || 0, y: Math.max(-my, Math.min(my, num(z?.y))) || 0}; // -0 → 0
}
// 칸 가운데 기준 점 (fx, fy)를 그 자리에 둔 채 배율을 s1로.
export function zoomAt(z, s1, fx = 0, fy = 0, box = {}) {
  const s0 = clampScale(z?.s), s = clampScale(s1), k = s / s0;
  return clampPan({s, x: fx - (fx - num(z?.x)) * k, y: fy - (fy - num(z?.y)) * k}, box);
}
// 두 손가락: 시작 상태 z0, 시작 거리 d0·가운데 m0 → 지금 거리 d·가운데 m. 손가락 사이 점이 손가락을 따라간다.
export function pinchTo(z0, d0, m0, d, m, box = {}) {
  if (!(d0 > 0 && d > 0)) return clampPan(z0, box);
  const s0 = clampScale(z0?.s), s = clampScale(s0 * d / d0), k = s / s0;
  return clampPan({s, x: num(m?.x) - (num(m0?.x) - num(z0?.x)) * k, y: num(m?.y) - (num(m0?.y) - num(z0?.y)) * k}, box);
}
// 끌기: 시작 상태 z0에서 손가락이 (dx, dy) 움직였을 때.
export const panBy = (z0, dx, dy, box = {}) => clampPan({s: z0?.s, x: num(z0?.x) + num(dx), y: num(z0?.y) + num(dy)}, box);
// 두 번 톡·더블클릭.
export const zoomToggle = (z, fx = 0, fy = 0, box = {}) => (isZoomed(z) ? {...ZOOM_ONE} : zoomAt(ZOOM_ONE, ZOOM_TAP, fx, fy, box));
// 마우스 휠 한 번의 배율(deltaMode 1 = 줄 단위, 2 = 쪽 단위). 아래로 굴리면 작게, 위로 굴리면 크게.
export function wheelScale(s, deltaY = 0, deltaMode = 0) {
  const px = num(deltaY) * (deltaMode === 1 ? 40 : deltaMode === 2 ? 800 : 1);
  return clampScale(clampScale(s) * Math.exp(-Math.max(-300, Math.min(300, px)) * 0.002));
}
// 한 손가락 톡인가(짧고 거의 안 움직임).
export const isTap = ({dx = 0, dy = 0, dt = 0} = {}) => dt >= 0 && dt <= TAP_MS && Math.hypot(dx, dy) <= TAP_MOVE;
// 앞 톡(prev = {x, y, t})과 이번 톡(cur)이 두 번 톡인가.
export const isDoubleTap = (prev, cur) => !!prev && !!cur && cur.t - prev.t >= 0 && cur.t - prev.t <= DOUBLE_TAP_MS && Math.hypot(cur.x - prev.x, cur.y - prev.y) <= DOUBLE_TAP_DIST;
// 다 놓았을 때: 원래 크기 가까이면 원래 크기로 붙인다.
export const settleZoom = (z, box = {}) => (clampScale(z?.s) < 1.05 ? {...ZOOM_ONE} : clampPan(z, box));
export const zoomTransform = z => (isZoomed(z) ? `translate(${num(z.x).toFixed(1)}px, ${num(z.y).toFixed(1)}px) scale(${clampScale(z.s).toFixed(3)})` : '');
