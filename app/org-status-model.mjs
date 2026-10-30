// DESK-현황표: 담당조직 상세 [현황 표] 소탭과 주간보고 '3. 2) 투쟁 사업장 현황' 그 조직 칸이 함께 쓰는 판정(순수 함수만).
// 자료는 app_org_status_rows 한 곳(migration 20261030234000). 화면 그리기·서버 읽기/쓰기는 org-status-table.js.
// - 줄 순서: sort_order 오름차순, 같으면 날짜 최신 먼저. 처음 SHOWN줄만 보이고 나머지는 '지난 줄 펼치기'.
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
export function sortRows(rows) {
  return [...(rows ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(b.day).localeCompare(String(a.day)) || String(a.id).localeCompare(String(b.id)));
}
export function splitRows(rows) {
  const all = sortRows(rows);
  return {shown: all.slice(0, SHOWN), older: all.slice(SHOWN)};
}
// 주간보고 칸 줄(표에 보이는 줄 그대로).
export function weeklyLines(rows) {
  return splitRows(rows).shown.map(r => `- ${dayLabel(r.day)} ${cleanBody(r.body)}`.replace(/\s+$/, '')).filter(l => l !== '-');
}
// 순서 바꾸기: index 줄을 dir(-1 위, +1 아래)로. 반환 = 새 순서의 줄 목록(sort_order 0..n-1을 붙임). 바뀐 것이 없으면 null.
export function moveRow(rows, id, dir) {
  const all = sortRows(rows), i = all.findIndex(r => r.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= all.length) return null;
  [all[i], all[j]] = [all[j], all[i]];
  return all.map((r, k) => ({...r, sort_order: k}));
}
// 순서를 0..n-1로 다시 붙였을 때 sort_order가 바뀌는 줄만(PATCH할 것).
export function orderChanges(next, prev) {
  const old = new Map((prev ?? []).map(r => [r.id, r.sort_order]));
  return next.filter(r => r.id && old.get(r.id) !== r.sort_order).map(r => ({id: r.id, sort_order: r.sort_order}));
}
// 새 줄을 넣을 자리: 날짜가 가장 최신이면 맨 위(0)…, 사람이 정한 순서 사이에서 그 날짜보다 오래된 첫 줄 앞.
function placeByDay(list, row) {
  const i = list.findIndex(r => String(r.day) < String(row.day));
  return i < 0 ? list.length : i;
}
export function insertRow(rows, row) {
  const all = sortRows(rows), at = placeByDay(all, row);
  all.splice(at, 0, row);
  return all.map((r, k) => ({...r, sort_order: k}));
}
// 다시 채우기 계획. ai = [{day, text, evidence}](서버 답). 반환 {remove:[id], add:[{day, body, evidence, sort_order}], order:[{id, sort_order}], rows(결과 순서)}
export function refillPlan(rows, ai) {
  const keep = sortRows(rows).filter(r => r.source !== 'ai');
  const remove = (rows ?? []).filter(r => r.source === 'ai').map(r => r.id);
  const same = new Set(keep.map(r => r.day + '|' + cleanBody(r.body)));
  let list = keep.map(r => ({...r}));
  const seen = new Set();
  for (const a of ai ?? []) {
    const body = cleanBody(a?.text), day = a?.day;
    if (!body || !validDay(day)) continue;
    const key = day + '|' + body;
    if (same.has(key) || seen.has(key)) continue;
    if (list.length >= ROWS_MAX) break;
    seen.add(key);
    const evidence = Array.isArray(a.evidence) ? a.evidence.filter(v => typeof v === 'string').slice(0, 10) : [];
    list.splice(placeByDay(list, {day}), 0, {id: null, day, body, source: 'ai', evidence});
  }
  list = list.map((r, k) => ({...r, sort_order: k}));
  return {
    remove,
    add: list.filter(r => !r.id).map(({day, body, evidence, sort_order}) => ({day, body, evidence, sort_order})),
    order: orderChanges(list.filter(r => r.id), keep),
    rows: list,
  };
}
// 주간보고: 조직(id) → 표 줄들. 표가 있는 조직의 칸은 [단계 줄(있으면)] + 표 줄로 시작한다(바탕의 지난 확정본 줄 대신).
export function siteLinesFromTable(stageLines, tableRows, isStageLine = () => false) {
  const table = weeklyLines(tableRows);
  if (!table.length) return null;
  return [...(stageLines ?? []).filter(l => isStageLine(l)), ...table];
}
