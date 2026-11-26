// S67-52 HOME-칸끄기(요청함 11/20 22:36 사용자 "이런 기록은 어때요 / 안쓸 거면 없앨 수 있게"): 홈에서 끌 수 있는 칸의 이름과 끈 칸 목록 계산.
// 끈 칸 목록은 서버 화면 기억 view_prefs.home_off(사람별 내 프로필 행, owner RLS — 기기 저장 없음)에 칸 이름 배열로 둔다.
// 칸 이름 모양(소문자 영문 1~30자)과 개수 상한은 DB 검사(migration 20261120230000_profile_view_prefs_home_off)와 같다.
// 끌 수 있는 칸은 아래 목록이 정한다. 다른 칸도 끄게 하려면 이 목록에 한 줄 더하고 그 칸의 renderer가 homeCardOff(id)를 보면 된다(공용 부품).
export const HOME_OFF_MAX = 12;
export const HOME_OFF_ID = /^[a-z][a-z0-9_-]{0,29}$/;
export const HOME_OFF_CARDS = Object.freeze([
  Object.freeze({id: 'suggests', name: '이런 기록은 어때요?'}),
]);
const KNOWN = new Set(HOME_OFF_CARDS.map(c => c.id));
export const homeOffCard = id => HOME_OFF_CARDS.find(c => c.id === id) || null;
// 서버 값 → 아는 칸 이름만, 같은 이름 한 번(모양이 틀리면 빈 목록 = 모두 켬).
export function offList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(id => typeof id === 'string' && HOME_OFF_ID.test(id) && KNOWN.has(id)))];
}
// 칸 하나를 끄거나 켠 새 목록. 모르는 칸이면 그대로. 저장 값은 빈 목록이면 null(= 기본, 모두 켬).
export function toggledOff(value, id, off) {
  const now = offList(value);
  if (!KNOWN.has(id)) return now;
  const next = off ? (now.includes(id) ? now : [...now, id]) : now.filter(x => x !== id);
  return next.slice(0, HOME_OFF_MAX);
}
export const savedOff = list => (list.length ? list : null);
