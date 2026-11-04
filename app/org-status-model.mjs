// DESK-현황표: 담당조직 상세 [현황 표] 소탭과 주간보고 '3. 2) 투쟁 사업장 현황' 그 조직 칸이 함께 쓰는 판정(순수 함수만).
// 자료는 app_org_status_rows 한 곳(migration 20261030234000). 화면 그리기·서버 읽기/쓰기는 org-status-table.js.
// - 줄 순서(DESK-현황오름차순, 정렬 규칙은 sortRows 한 곳): 시작일(day) 오름차순, 같은 날이면 sort_order 적은 순, 그래도 같으면 id. 손으로 순서를 바꾸는 기능은 없다.
//   보이는 줄은 가장 최근 SHOWN줄(맨 끝 쪽)이고, 그 앞의 오래된 줄은 '펼치기'로 본다. 화면·[복사]·주간보고가 모두 이 함수들을 쓴다.
// - 날짜 표기(DESK-일정기간, periodLabel 한 곳): 하루 '10.29.(목)', 기간 '11.2.~11.5.'(요일 없음, 해가 다르면 해를 붙임). end_day(끝나는 날)는 비어 있거나 시작일 이후.
// - 주간보고 칸: 보이는 SHOWN줄을 '- 10.29.(목) 내용' 꼴로(표에 보이는 그대로). 표가 비면 주간보고는 예전처럼 직전 확정본 줄.
// - [기록에서 다시 채우기 (AI)]: AI가 뽑은 그대로인 줄(source=ai)만 지우고 새 줄로 바꾼다. 사람이 넣거나 고친 줄(source=user)은 그대로 두고,
//   같은 날·같은 글의 AI 줄은 다시 넣지 않는다. 새 AI 줄은 날짜 순서에 맞춰 사람 줄 사이에 끼운다(사람이 정한 순서는 유지).
export const SHOWN = 4;
export const ROWS_MAX = 30;
export const BODY_MAX = 200;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

export const validDay = d => typeof d === 'string' && DAY.test(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
// 글 다듬기: 제어문자·줄바꿈은 빈칸으로, 앞뒤 빈칸 없앰, 200자까지(DB 검사와 같음).
export function cleanBody(text) {
  return [...String(text ?? '').replace(/[\p{Cc}​-‏‪-‮⁠-⁩]/gu, ' ').replace(/\s+/g, ' ').trim()].slice(0, BODY_MAX).join('').trim();
}
// '2026-10-29' → '10.29.(목)'
export function dayLabel(day) {
  if (!validDay(day)) return '';
  const d = new Date(day + 'T00:00:00Z');
  return `${d.getUTCMonth() + 1}.${d.getUTCDate()}.(${WEEK[d.getUTCDay()]})`;
}
// 끝나는 날 판정: 비어 있으면 하루 일정(통과), 있으면 실제 날짜이고 시작일과 같거나 뒤.
export const validEnd = (day, end) => end == null || end === '' || (validDay(end) && validDay(day) && end >= day);
// 날짜 표기 한 곳(화면·[복사]·주간보고 공통): 하루 '10.29.(목)', 기간 '11.2.~11.5.'(요일 없음). 끝이 비었거나 시작일과 같으면 하루.
export function periodLabel(day, end) {
  if (!validDay(day)) return '';
  if (!validDay(end) || end <= day) return dayLabel(day);
  const yearDiff = day.slice(0, 4) !== end.slice(0, 4);
  const md = d => `${yearDiff ? `${d.slice(0, 4)}.` : ''}${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}.`;
  return `${md(day)}~${md(end)}`;
}
// 정렬 규칙 한 곳: 시작일 오름차순 → 같은 날은 sort_order 적은 순 → id.
export function sortRows(rows) {
  return [...(rows ?? [])].sort((a, b) => String(a.day).localeCompare(String(b.day)) || (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.id).localeCompare(String(b.id)));
}
// 보이는 줄 = 가장 최근 limit줄(오름차순 그대로), 나머지 오래된 줄 = older(오름차순).
export function splitRows(rows, limit = SHOWN) {
  const all = sortRows(rows), cut = Math.max(0, all.length - limit);
  return {shown: all.slice(cut), older: all.slice(0, cut)};
}
// 새 줄의 sort_order: 지금 가장 큰 값 다음(같은 날 줄은 넣은 순서). DB 검사 0..1000.
export const nextOrder = rows => Math.min(1000, (rows ?? []).reduce((m, r) => Math.max(m, r.sort_order ?? 0), -1) + 1);
// 주간보고 칸 줄(표에 보이는 줄 그대로).
export function weeklyLines(rows) {
  return splitRows(rows).shown.map(r => `- ${periodLabel(r.day, r.end_day)} ${cleanBody(r.body)}`.replace(/\s+$/, '')).filter(l => l !== '-');
}
// 같은 줄 판정(DESK-전체현황표 ⑩): 날짜가 하루 안쪽이고 내용이 비슷하면 같은 일로 본다. 서버(supabase/functions/ai-assist/org-status-rows.ts)도 같은 규칙으로 한 번 더 거른다.
// 내용: 글자·숫자만 남긴 글이 서로 들어 있거나(4자 이상, 끝맺음 '승인'/'승인함'), 두 글자 조각이 60% 이상 겹치면 비슷하다.
const squash = t => String(t ?? '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const pairs = t => { const out = new Set(); for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2)); return out; };
export function similarBody(a, b) {
  const x = squash(a), y = squash(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 4 && long.includes(short)) return true;
  const p = pairs(x), q = pairs(y);
  if (p.size < 3 || q.size < 3) return false;
  let both = 0;
  for (const k of p) if (q.has(k)) both++;
  return both / (p.size + q.size - both) >= 0.6;
}
const dayGap = (a, b) => (validDay(a) && validDay(b) ? Math.abs(Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000 : Infinity);
export const sameLine = (x, y) => dayGap(x?.day, y?.day) <= 1 && similarBody(x?.body, y?.body);

// 다시 채우기 계획. ai = [{day, end_day?, text, evidence}](서버 답). 반환 {remove:[id], add:[{day, end_day, body, evidence, sort_order}], rows(결과 줄들)}
// 사람이 넣거나 고친 줄(source!=ai)과 같은 일(sameLine)인 AI 줄, 이번 답 안에서 서로 같은 일인 AI 줄은 더하지 않는다. 순서는 날짜가 정하므로 사람 줄의 sort_order는 건드리지 않는다.
export function refillPlan(rows, ai) {
  const keep = sortRows(rows).filter(r => r.source !== 'ai');
  const remove = (rows ?? []).filter(r => r.source === 'ai').map(r => r.id);
  const list = keep.map(r => ({...r}));
  const seen = [];
  let order = nextOrder(keep);
  for (const a of ai ?? []) {
    const body = cleanBody(a?.text), day = a?.day, end_day = validEnd(day, a?.end_day) && validDay(a?.end_day) && a.end_day > day ? a.end_day : null;
    if (!body || !validDay(day)) continue;
    const cand = {day, body};
    if (keep.some(r => sameLine(r, cand)) || seen.some(r => sameLine(r, cand))) continue;
    if (list.length >= ROWS_MAX) break;
    seen.push(cand);
    const evidence = Array.isArray(a.evidence) ? a.evidence.filter(v => typeof v === 'string').slice(0, 10) : [];
    list.push({id: null, day, end_day, body, source: 'ai', evidence, sort_order: Math.min(1000, order++)});
  }
  return {
    remove,
    add: list.filter(r => !r.id).map(({day, end_day, body, evidence, sort_order}) => ({day, end_day, body, evidence, sort_order})),
    rows: sortRows(list),
  };
}
// 전체 표 한 조직 칸: 가장 최근 limit줄(오름차순)과 그 앞의 오래된 줄(펼치기로 보임, 오름차순).
export const overviewRows = (rows, limit = 3) => splitRows(rows, limit).shown;
export const overviewOlder = (rows, limit = 3) => splitRows(rows, limit).older;
// 주간보고: 조직(id) → 표 줄들. 표가 있는 조직의 칸은 [단계 줄(있으면)] + 표 줄로 시작한다(바탕의 지난 확정본 줄 대신).
export function siteLinesFromTable(stageLines, tableRows, isStageLine = () => false) {
  const table = weeklyLines(tableRows);
  if (!table.length) return null;
  return [...(stageLines ?? []).filter(l => isStageLine(l)), ...table];
}
