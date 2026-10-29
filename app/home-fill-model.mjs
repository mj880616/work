// HOME-모바일홈채우기: 폰·중간 폭 홈(한 칸 홈)에 더해지는 칸들의 순수 계산. DOM·네트워크 없음. 그리는 곳은 home-fill.js 하나.
import {overdue, overdueDays} from './ledger-browse-model.mjs';

export const TASK_LIMIT = 2;
export const MISSED_LIMIT = 3;

const count = v => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
// 날짜 줄 옆 한 줄: '새 소식 12 · 나한테 온 요청 2'. 아직 모르는 값(null)과 새 소식이 없는 곳(null)은 뺀다.
// 나한테 온 요청(TG-요청강조)은 1건 이상일 때만 붙인다.
// UI-전수디자인점검 F15: 일정·할 일 개수는 바로 아래 칸 제목('오늘 일정 N'·'오늘 할 일 N')이 이미 보이므로 이 줄에서 뺀다(같은 수 두 번).
export function summaryText({news, asks} = {}) {
  const parts = [['새 소식', count(news)], ['나한테 온 요청', count(asks) || null]]
    .filter(([, n]) => n !== null).map(([name, n]) => `${name} ${n}`);
  return parts.join(' · ');
}
// 할 일은 limit건만 보이고 나머지는 '+ n건 더'.
export function limitRows(rows, limit = TASK_LIMIT) {
  const list = Array.isArray(rows) ? rows : [];
  return {shown: list.slice(0, limit), more: Math.max(0, list.length - limit)};
}
// 놓친 약속: 원장 화면과 같은 기준(ledger-browse-model.mjs overdue)으로 고르고 오래된 확인일 먼저, 최대 limit건.
export function pickMissed(rows, now = new Date(), limit = MISSED_LIMIT) {
  return (Array.isArray(rows) ? rows : []).filter(r => overdue(r, now))
    .sort((a, b) => String(a.follow_up_on).localeCompare(String(b.follow_up_on)) || String(a.ledger_id).localeCompare(String(b.ledger_id)))
    .slice(0, limit);
}
// 작은 꼬리표: 확인일이 지난 날수 'n일째'. 같은 날이면 '오늘'.
export function missedTag(row, now = new Date()) {
  const n = overdueDays(row?.follow_up_on, now);
  return n > 0 ? `${n}일째` : '오늘';
}
// 내일 한 줄: 첫 일정 '09:00 제목' + 나머지 건수. 일정이 없으면 null(칸은 '없음'을 보인다).
export function tomorrowLine(rows, timeOf = () => '') {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  const first = list[0];
  return {time: first.allDay ? '종일' : timeOf(first.start), title: String(first.title || '(제목 없음)'), more: list.length - 1};
}
