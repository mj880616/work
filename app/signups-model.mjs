// OPS-가입자현황(S62-29): 운영자 '가입자 현황' 화면의 숫자 한 줄과 칸 글자. 순수 함수(화면·서버 없음).
// 서버 app_signup_list(운영자만)가 돌려주는 배열 한 줄 = {email, signed_up_at, last_seen_at}
// (migration 20261123170000_operator_info_three). 숫자 셋은 이 배열에서 센다: 전체 · 이번 주 새로(한국 시각 월요일 0시부터) · 최근 7일 쓴 사람.
// 칸은 사용자 확정 문장 그대로(S68-58, 11/23 15:53 "운영자에게 제공되는 정보: 이메일주소, 가입일, 마지막 사용 시각."): 이메일 · 가입일 · 마지막 사용.
// 조직·부서·이름·직책은 운영자에게 가지 않는다(서버도 돌려주지 않음). 그 밖의 칸은 그리지 않는다.
export const COLUMNS = Object.freeze([
  ['email', '이메일'], ['signed_up_at', '가입일'], ['last_seen_at', '마지막 사용']
]);
const DAY = 86400000, KST = 9 * 3600000;
const ms = value => { const t = Date.parse(String(value ?? '')); return Number.isFinite(t) ? t : null; };

// 한국 시각으로 이번 주 월요일 0시(UTC 밀리초).
export function weekStart(nowMs) {
  const k = nowMs + KST, day = Math.floor(k / DAY), weekday = (new Date(day * DAY).getUTCDay() + 6) % 7; // 월=0
  return (day - weekday) * DAY - KST;
}

export function summarize(items, nowMs = Date.now()) {
  const list = Array.isArray(items) ? items : [];
  const from = weekStart(nowMs), active = nowMs - 7 * DAY;
  let fresh = 0, used = 0;
  for (const item of list) {
    const joined = ms(item?.signed_up_at), seen = ms(item?.last_seen_at);
    if (joined !== null && joined >= from) fresh++;
    if (seen !== null && seen >= active) used++;
  }
  return {total: list.length, newThisWeek: fresh, active7d: used};
}

export const summaryText = s => `전체 ${s.total}명 · 이번 주 새로 ${s.newThisWeek}명 · 최근 7일 쓴 사람 ${s.active7d}명`;

const parts = (value, opts) => {
  const t = ms(value); if (t === null) return null;
  return Object.fromEntries(new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', hourCycle: 'h23', ...opts}).formatToParts(new Date(t)).map(p => [p.type, p.value]));
};
export function dayText(value) { const p = parts(value, {year: '2-digit', month: 'numeric', day: 'numeric'}); return p ? `${p.year}.${p.month}.${p.day}` : ''; }
export function timeText(value) { const p = parts(value, {year: '2-digit', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'}); return p ? `${p.year}.${p.month}.${p.day} ${p.hour}:${p.minute}` : ''; }

const line = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
// 한 사람 줄의 칸 글자(빈 칸은 ''). COLUMNS 셋만 — 서버가 다른 칸을 보내도 그리지 않는다.
export function cells(item) {
  return {email: line(item?.email, 254), signed_up_at: dayText(item?.signed_up_at), last_seen_at: timeText(item?.last_seen_at)};
}
