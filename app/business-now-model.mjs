// BIZ-기록하나로 B-3(설계 docs/design/record-one.md 2-3·2-4·2-7·3-1·4절): 2. 1) 사업요약 '창' 순수 규칙 한 곳 — 화면·네트워크 없음.
// - 칸 = 그 사업의 '지금 상황'·담당(app_business_now). 그 주에 보이는 값 = 같은 사업의 week_start ≤ 그 주인 가장 나중 행(이어 쓰기).
//   그 주에 고치면 그 주 행을 만들거나 고친다(지난 주 행은 그대로 → 지난 주 표는 그때 글 그대로). 행은 통째로 이기므로 새 행은 앞 행의 다른 칸을 복사한다.
// - 처음 한 번 채우기: 지금 상황 행이 하나도 없는 사업만, 전환 주(RECORD_ONE_FROM) 행으로 한 번 넣는다(사람이 쓴 값은 덮지 않음).
// - 칸 아래 '이번 주 기록 n' = 그 주(월~일)에 걸친 사업 기록(app_business_records) + 그 주 사업 보고 줄(읽기만).
// 주 경계·전환 주·줄 날짜 모양은 조직보고 창 규칙(record-window-model.mjs)을 그대로 쓴다(새로 계산하지 않음).
import {RECORD_ONE_FROM, isOldWeek, shiftWeek, mondayOf, dayText, overlaps, cleanBody} from './record-window-model.mjs';
import {oneLine, recordOneLine} from './record-oneline.mjs';

export {RECORD_ONE_FROM, isOldWeek, shiftWeek, mondayOf, dayText, oneLine};
export const NOW_BODY_MAX = 1000;   // 지금 상황(DB 검사와 같음, 줄바꿈 허용)
export const OWNER_MAX = 100;       // 담당 글자(DB 검사와 같음)
export const RECORD_BODY_MAX = 300; // 사업 기록 한 줄(DB 검사와 같음)
export const RECORD_READ_BACK_DAYS = 90; // 그 주보다 이만큼 앞서 시작한 기간 기록까지 읽는다(조직 창 LONG_SPAN_DAYS와 같은 생각)

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const chars = s => [...String(s ?? '')].length;
const cut = (s, n) => [...String(s ?? '')].slice(0, n).join('');
// 줄바꿈만 남기고 제어문자(탭 포함)·보이지 않는 방향 글자는 띄어쓰기로. 줄마다 앞뒤 공백을 걷고 빈 줄은 뺀다.
const cleanLines = text => String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  .map(l => l.replace(/[\p{Cc}​-‏‪-‮⁠-⁩]/gu, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);

// 그 주(월~일) 범위 [from, to)(to 제외 — overlaps 모양).
export const weekRange = week => (DAY.test(String(week)) ? {from: week, to: addDays(week, 7)} : null);
export const sundayOf = week => addDays(week, 6);

// ---- 지금 상황 이어 쓰기 ----
// rows = app_business_now 행들. 그 주에 보이는 행 = 같은 사업의 week_start ≤ week인 가장 나중 행(없으면 null).
export function nowOf(rows, spaceId, week) {
  let best = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || String(r.space_id) !== String(spaceId) || !DAY.test(String(r.week_start)) || !(r.week_start <= week)) continue;
    if (!best || r.week_start > best.week_start) best = r;
  }
  return best;
}
// 보이는 값 {body, owner, from(그 행의 주, 없으면 ''), carried(지난 주에서 이어 온 값인가)}.
export function nowView(rows, spaceId, week) {
  const r = nowOf(rows, spaceId, week);
  return {body: String(r?.body ?? ''), owner: String(r?.owner_text ?? ''), from: r?.week_start ?? '', carried: !!r && r.week_start !== week};
}
// 지금 상황 글 검사(DB와 같은 규칙: 0~1000자, 앞뒤 공백 없음, 줄바꿈 말고 제어문자 없음). 빈 글 = '—'(허용).
export function checkNowBody(text) {
  const v = cleanLines(text).join('\n');
  if (chars(v) > NOW_BODY_MAX) return {ok: false, field: 'body', max: NOW_BODY_MAX};
  return {ok: true, value: v};
}
// 담당 검사(한 줄, 0~100자).
export function checkOwner(text) {
  const v = cleanBody(text);
  if (chars(v) > OWNER_MAX) return {ok: false, field: 'owner', max: OWNER_MAX};
  return {ok: true, value: v};
}
// 그 주에서 지금 상황·담당을 바꾼다. change = {body?, owner_text?}(바꾼 칸만, 검사한 값).
// 돌려주는 값: {op:'none'} | {op:'insert', row:{space_id, week_start, body, owner_text}} | {op:'update', id, row:{body?, owner_text?}}.
// 그 주 행이 있으면 그 행만 고치고(지난 주 행은 그대로), 없으면 앞 행 값을 복사해 그 주 행을 새로 만든다.
export function nextNow(rows, {spaceId, week}, change) {
  const cur = nowOf(rows, spaceId, week);
  const base = {body: String(cur?.body ?? ''), owner_text: String(cur?.owner_text ?? '')};
  const next = {...base, ...('body' in (change || {}) ? {body: String(change.body ?? '')} : {}), ...('owner_text' in (change || {}) ? {owner_text: String(change.owner_text ?? '')} : {})};
  if (next.body === base.body && next.owner_text === base.owner_text) return {op: 'none'};
  if (cur && cur.week_start === week) {
    const row = {};
    if (next.body !== base.body) row.body = next.body;
    if (next.owner_text !== base.owner_text) row.owner_text = next.owner_text;
    return {op: 'update', id: cur.id, row};
  }
  return {op: 'insert', row: {space_id: String(spaceId), week_start: week, ...next}};
}

// ---- 처음 한 번 채우기(설계 3-1) ----
// 줄 여러 개 → 지금 상황 글(1000자 안에서 줄 단위로 자르고, 첫 줄이 넘치면 그 줄만 자름).
export function bodyFromLines(lines) {
  const out = [];
  let n = 0;
  for (const l of cleanLines((Array.isArray(lines) ? lines : []).join('\n'))) {
    const add = chars(l) + (out.length ? 1 : 0);
    if (n + add > NOW_BODY_MAX) { if (!out.length) out.push(cut(l, NOW_BODY_MAX)); break; }
    out.push(l); n += add;
  }
  return out.join('\n');
}
// spaces = [{id, area, task}] 표의 줄. rows = 읽은 지금 상황 행 전부(모든 주). cellOf({area, task}) → {lines, owner}(화면이 임시저장에서 찾음).
// 지금 상황 행이 하나도 없는 사업만 전환 주 행을 만든다. 같은 사업이 두 번 나오면 한 번만.
export function fillRows({spaces = [], rows = [], cellOf = () => null, week = RECORD_ONE_FROM} = {}) {
  const have = new Set((Array.isArray(rows) ? rows : []).map(r => String(r?.space_id)));
  const out = [], seen = new Set();
  for (const s of Array.isArray(spaces) ? spaces : []) {
    const id = String(s?.id ?? '');
    if (!id || have.has(id) || seen.has(id)) continue;
    seen.add(id);
    const c = cellOf(s) || {};
    out.push({space_id: id, week_start: week, body: bodyFromLines(c.lines), owner_text: cut(cleanBody(c.owner), OWNER_MAX)});
  }
  return out;
}

// ---- 사업 나무: 세부 과제 아래(3단 사안)는 그 세부 과제 줄로 ----
// tree = [{project:{id}, depth}] 화면 순서. 돌려주는 Map(공간 id → 표 줄의 공간 id = 세부 과제 id, 사업영역 바로 아래면 사업영역 id).
export function rowSpaceMap(tree) {
  const out = new Map();
  let area = null, task = null;
  for (const n of Array.isArray(tree) ? tree : []) {
    const id = n?.project?.id;
    if (id == null) continue;
    if (n.depth === 0) { area = String(id); task = null; out.set(area, area); }
    else if (!area) continue;
    else if (n.depth === 1) { task = String(id); out.set(task, task); }
    else out.set(String(id), task || area);
  }
  return out;
}

// ---- 이번 주 기록 ----
// 사업 기록 행 → 줄 {kind:'biz_record', key, space, day, end_day, text(한 줄), full(원문 그대로)}. 날짜·글이 틀리면 null.
// RECORD-한줄: 표에는 한 줄만(record-oneline.mjs, 저장된 한 줄이 생기면 그 값). 원문은 full에.
export function bizRecordItem(row) {
  const day = String(row?.day ?? ''), text = recordOneLine(row, 'body');
  if (!row?.id || !row?.space_id || !DAY.test(day) || !text) return null;
  const end = DAY.test(String(row.end_day ?? '')) && row.end_day > day ? row.end_day : null;
  return {kind: 'biz_record', key: String(row.id), space: String(row.space_id), day, end_day: end, text, full: String(row.body ?? ''), source_kind: row.source_kind ?? null};
}
// 그 주에 걸친 사업 기록을 표 줄(공간 id)별로. map = rowSpaceMap 결과(없는 공간은 그 공간 그대로). 날짜 오름차순.
export function weekRecords(items, week, map = null) {
  const range = weekRange(week), out = new Map();
  if (!range) return out;
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || !overlaps(it, range)) continue;
    const row = map?.get?.(it.space) ?? it.space;
    if (!out.has(row)) out.set(row, []);
    out.get(row).push(it);
  }
  for (const list of out.values()) list.sort((a, b) => a.day.localeCompare(b.day) || a.text.localeCompare(b.text, 'ko') || a.key.localeCompare(b.key));
  return out;
}
// 서버에서 읽을 사업 기록 범위(그 주 일요일까지, 기간 기록은 RECORD_READ_BACK_DAYS 앞까지).
export const recordReadRange = week => (DAY.test(String(week)) ? {from: addDays(week, -RECORD_READ_BACK_DAYS), to: sundayOf(week)} : null);
// 사업 기록 한 줄 글(업데이트·소식 [사업]에서 옮겨 적을 때): 한 줄로, 300자를 넘으면 299자 + '…'. 빈 글이면 ''.
export function recordBody(text) {
  const v = cleanBody(text);
  return chars(v) > RECORD_BODY_MAX ? `${cut(v, RECORD_BODY_MAX - 1).trimEnd()}…` : v;
}
// 사업 기록 날짜(서울 날짜 'YYYY-MM-DD'). 틀리면 null.
export const recordDay = day => (DAY.test(String(day ?? '')) ? String(day) : null);
// 줄 글 '- 11.10. 글'(기간이면 '- 11.2.~12.5. 글').
export const recordLine = it => `- ${[dayText(it.day, it.end_day), cleanBody(it.text)].filter(Boolean).join(' ')}`;
