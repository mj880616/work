// WEEKLY-메뉴짝짓기 P3(docs/design/weekly-menu-pairing.md 3·4·5절): 주별 조직보고 표(app_weekly_org_lines) 판정 한 곳 — 순수 함수만.
// 담당조직 '이번 주 조직보고'와 홈 [주간 정리] 4.·3.2)·한글 파일이 모두 이 함수들을 쓴다(그리기·읽기·쓰기는 weekly-org-lines.js).
// - 주 = 월~일, 표의 week_start는 월요일. 한 조직 칸 = 그 주 그 조직 줄들(state: in 넣은 줄 / suggested 흐린 제안 / dropped 뺀 줄 — 지우지 않음).
// - 줄 순서: 날짜 오름차순(날짜 없는 줄은 맨 뒤) → sort_order → id. 날짜 표기 '11.2.' / 기간 '11.2.~11.5.'(요일 없음).
// - 넣은 줄이 SHOWN(3)줄을 넘으면 '주간보고 3줄 넘음'(자르지 않음). 칸에는 가장 최근 3줄, 그 앞 줄은 '외 n줄 ▾'.
// - '부실' = 넣은 줄 THIN_MAX(1)줄 이하 → 주간 정리에서 지난주 줄을 펼쳐 [가져오기](16:58·17:34 결정).
import {cleanBody, similarBody} from './org-status-model.mjs';

export const SHOWN = 3;
export const THIN_MAX = 1;
export const LINES_MAX = 40; // DB 가드와 같은 (주 × 조직) 줄 수(제안·뺀 줄 포함)
export const BODY_MAX = 200;
export {cleanBody};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// 실제 있는 날짜인지(없는 날 '2026-13-01'도 오류 없이 false).
export const validDay = d => { if (typeof d !== 'string' || !DAY.test(d)) return false; const t = Date.parse(d + 'T00:00:00Z'); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d; };

const DAY_MS = 86400000;
const utc = d => Date.parse(d + 'T00:00:00Z');
const key = t => new Date(t).toISOString().slice(0, 10);
// 그 날이 든 주의 월요일.
export function mondayOf(day) {
  if (!validDay(day)) return '';
  const t = utc(day), dow = new Date(t).getUTCDay();
  return key(t - ((dow + 6) % 7) * DAY_MS);
}
export const shiftWeek = (week, n) => (validDay(week) ? key(utc(week) + n * 7 * DAY_MS) : '');
export const weekEnd = week => (validDay(week) ? key(utc(week) + 6 * DAY_MS) : '');
const md = d => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}.`;
// 주 표기 '11.2~11.8'(해가 다르면 '2026.12.28~2027.1.3').
export function weekLabel(week) {
  if (!validDay(week)) return '';
  const end = weekEnd(week), y = week.slice(0, 4) !== end.slice(0, 4);
  const f = d => `${y ? `${d.slice(0, 4)}.` : ''}${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
  return `${f(week)}~${f(end)}`;
}
// 날짜 표기: '11.2.' / '11.2.~11.5.' / 날짜 없으면 ''.
export function dayText(day, end) {
  if (!validDay(day)) return '';
  if (!validDay(end) || end <= day) return md(day);
  const y = day.slice(0, 4) !== end.slice(0, 4);
  return `${y ? `${day.slice(0, 4)}.` : ''}${md(day)}~${y ? `${end.slice(0, 4)}.` : ''}${md(end)}`;
}
// 끝나는 날: 비었거나, 시작일이 있고 같거나 뒤.
export const validEnd = (day, end) => end == null || end === '' || (validDay(day) && validDay(end) && end >= day);

export function sortLines(lines) {
  return [...(lines ?? [])].sort((a, b) => {
    const x = validDay(a.day) ? a.day : '9999-99-99', y = validDay(b.day) ? b.day : '9999-99-99';
    return x.localeCompare(y) || (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.id).localeCompare(String(b.id));
  });
}
// 한 조직 칸: 넣은 줄(보이는 최근 limit줄 + 그 앞 older), 제안 줄, 뺀 줄 수.
export function cellParts(lines, limit = SHOWN) {
  const all = sortLines(lines), placed = all.filter(l => l.state === 'in');
  const cut = Math.max(0, placed.length - limit);
  return {
    placed, shown: placed.slice(cut), older: placed.slice(0, cut),
    suggested: all.filter(l => l.state === 'suggested'), dropped: all.filter(l => l.state === 'dropped').length,
    over: placed.length > limit, thin: placed.length <= THIN_MAX,
  };
}
// 주간보고 줄(넣은 줄 전부, 자르지 않음): '- 11.2. 글'.
export const lineText = l => `- ${[dayText(l.day, l.end_day), cleanBody(l.body)].filter(Boolean).join(' ')}`;
export const reportLines = lines => cellParts(lines).placed.map(lineText);
// 새 줄 순서 번호(제안·뺀 줄 포함 가장 큰 값 다음, DB 검사 0..1000).
export const nextOrder = lines => Math.min(1000, (lines ?? []).reduce((m, l) => Math.max(m, Number.isFinite(l.sort_order) ? l.sort_order : 0), -1) + 1);
// 줄 넣을 자리가 있는지(DB 가드 40).
export const hasRoom = (lines, n = 1) => (lines ?? []).length + n <= LINES_MAX;

// 수기 줄 검사. 반환 {ok, field?, value?}. 날짜는 선택(없으면 날짜 없는 줄), 끝나는 날은 시작일이 있어야.
export function checkDraft(d) {
  const body = cleanBody(d?.body), day = d?.day || null, end = d?.end_day || null;
  if (day && !validDay(day)) return {ok: false, field: 'day'};
  if (!validEnd(day, end) || (end && !day)) return {ok: false, field: 'end_day'};
  if (!body) return {ok: false, field: 'body'};
  return {ok: true, value: {day, end_day: day && end && end > day ? end : null, body}};
}

// 지난주 가져오기 계획: 지난주 넣은 줄(또는 도입 주 현황 표 줄) 중 이번 주에 같은 글이 없는 것 → 새 줄(state in, origin last_week).
// from = [{day, end_day, body}], have = 이번 주 그 조직 줄(뺀 줄 포함 — 뺀 줄과 같은 글은 다시 넣지 않음).
export function importPlan(from, have) {
  const out = [], seen = [...(have ?? [])];
  let order = nextOrder(have);
  for (const l of sortLines(from)) {
    const body = cleanBody(l.body);
    if (!body || seen.some(x => similarBody(x.body, body))) continue;
    if (!hasRoom(seen)) break;
    const row = {day: validDay(l.day) ? l.day : null, end_day: validDay(l.day) && validDay(l.end_day) && l.end_day > l.day ? l.end_day : null, body, sort_order: Math.min(1000, order++)};
    seen.push(row); out.push(row);
  }
  return out;
}
// 다른 화면이 먼저 고쳤을 때 보여 줄 글(그 줄을 다시 읽은 값). 같으면 null(그냥 내 글로 다시 저장해도 됨).
export function conflictOf(mine, theirs) {
  if (!theirs) return {gone: true, body: ''};
  if (cleanBody(theirs.body) === cleanBody(mine?.body) && (theirs.day || null) === (mine?.day || null) && (theirs.end_day || null) === (mine?.end_day || null) && theirs.state === mine?.state) return null;
  return {gone: false, body: cleanBody(theirs.body), state: theirs.state};
}
