// S48-18 저녁 '새 성명 n건'(설계 docs/design/outside-statements.md 3.4·4절 '알림') — 알림 줄 손님의 순수 함수.
// 저녁 18:07 예약 수집이 끝난 뒤(서울 18:10부터 그날 자정 전까지) 사회운동 Now [새로 온 것]을 마지막으로 본 뒤 들어온 글이 있으면 한 줄.
export const EVENING_FROM_KST = '18:10';
export const COUNT_CAP = 99;
const kst = now => new Date(now + 9 * 3600e3);
// 서울 시각이 18:10~23:59인가.
export function eveningOpen(now = Date.now()) {
  const d = kst(now), [h, m] = EVENING_FROM_KST.split(':').map(Number);
  return d.getUTCHours() * 60 + d.getUTCMinutes() >= h * 60 + m;
}
// 문구: '새 성명 3건' · 100건 넘게 읽히면 '새 성명 99건+'. 0이면 ''(줄 없음).
export function outsideNoticeText(n) {
  const c = Math.max(0, Math.floor(Number(n) || 0));
  if (!c) return '';
  return c > COUNT_CAP ? `새 성명 ${COUNT_CAP}건+` : `새 성명 ${c}건`;
}
