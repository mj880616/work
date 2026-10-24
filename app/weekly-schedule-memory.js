// WEEKLY-환류 (docs/design/weekly-draft-feedback.md 3절, 명진 결정 Q3~Q7 추천대로): 주간보고 5. 주요 일정에서 [확정] 때 달력 제목과 다르게
// 고친 일정 이름·뺀 일정을 "원래 제목"을 열쇠로 내 프로필 칸 하나(app_profiles.weekly_schedule_memory, migration 20261024002000)에 기억하고,
// 다음 주 초안을 만들 때 먼저 적용한다. Google Calendar 원본은 건드리지 않는다. 회의 종류 빼기(journal-meeting-kinds.js)와 같은 모양이다.
// - 열쇠 = 원래 제목에서 띄어쓰기를 빼고 소문자로(회의 종류 열쇠와 같은 규칙). 일정 id가 아니라 제목이라 반복 일정·다음 주에 겹치는 둘째 주
//   일정을 모두 덮는다(설계 3.2).
// - 적용 순서: 이번 주 임시저장(일정 키 열쇠의 titles·drops) > 기억 > 달력(설계 3.6).
// - 칸 값이 틀렸거나 읽지 못하면(칸 준비 전 포함) "기억 없음" — 지금처럼 달력 제목 그대로다. 화면이 추측으로 빼지 않는다.
// - 쓰기는 쓰기 직전에 다시 읽고 바꿀 항목만 바꿔 이 칸만 PATCH한다(다른 기기 변경 보존, 내 행만 — 기존 owner 정책). 브라우저 저장소 없음.
export const MEMORY_MAX = 200;
export const MEMORY_BYTES = 65536;
export const KEY_MAX = 200;
export const TITLE_MAX = 200;
export const PLACE_MAX = 100;
const encode = encodeURIComponent;
const DAY = /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const FIELDS = new Set(['key', 'origin', 'title', 'place', 'drop', 'saved', 'used']);

export const scheduleMemoryKey = title => String(title ?? '').replace(/\s+/g, '').toLowerCase();
const one = s => String(s ?? '').replace(/\s+/g, ' ').trim();
// 서버 CHECK와 같은 글 규칙: 한 줄(제어문자 없음), 빈 글 아님, 길이 상한(글자 수).
const okText = (s, max) => typeof s === 'string' && /\S/.test(s) && !/[\u0001-\u001f\u007f]/.test(s) && [...s].length <= max;

// 항목 하나가 서버 CHECK를 지나는지(화면이 같은 규칙으로 미리 거른다).
export function validEntry(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
  if (Object.keys(e).some(k => !FIELDS.has(k))) return false;
  if (!okText(e.key, KEY_MAX) || !okText(e.origin, TITLE_MAX) || typeof e.saved !== 'string' || !DAY.test(e.saved)) return false;
  if (e.used !== undefined && (typeof e.used !== 'string' || !DAY.test(e.used))) return false;
  if (e.drop !== undefined && e.drop !== true) return false;
  if (e.title !== undefined && !okText(e.title, TITLE_MAX)) return false;
  if (e.place !== undefined && (!okText(e.place, PLACE_MAX) || e.title === undefined)) return false;
  return (e.title !== undefined) !== (e.drop === true);
}
// 칸 값 → 화면이 쓰는 목록(틀린 항목은 버리고, 같은 열쇠는 첫 항목만). 배열이 아니면 null(= 기억 없음).
export function parseMemory(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set(), out = [];
  for (const e of value) {
    if (!validEntry(e) || seen.has(e.key)) continue;
    seen.add(e.key); out.push({...e});
  }
  return out;
}

// ---- 적용 ----
// upcomingSchedule 결과에 기억을 단다: 제목 열쇠가 맞는 일정 줄에 memo({key, title?, place?, drop?}). 화면·복사용 what은 기억한 이름으로.
// rows = 기억으로 뺀 일정을 뺀 줄(화면·복사), allRows = 전부(한글 파일 상자가 [이번 주만 넣기]를 보여 주려고), memoryDropped = 뺀 일정 수.
// memory가 null이거나 비었으면 calendar를 그대로 돌려준다.
export function annotateCalendar(calendar, memory) {
  if (!calendar || calendar.loading || calendar.failed?.length || !Array.isArray(calendar.rows)) return calendar;
  if (!memory?.length) return {...calendar, allRows:calendar.rows, memoryDropped:0};
  const index = new Map(memory.map(e => [e.key, e]));
  let dropped = 0;
  const allRows = calendar.rows.map(row => ({...row, items:row.items.map(item => {
    if (item.time === undefined) return item;
    const e = index.get(scheduleMemoryKey(item.title));
    if (!e) return item;
    const memo = e.drop ? {key:e.key, drop:true} : {key:e.key, title:e.title, ...(e.place ? {place:e.place} : {})};
    if (memo.drop) { dropped++; return {...item, memo}; }
    const place = memo.place ?? item.place;
    return {...item, memo, what:[item.time, memo.title, place].filter(Boolean).join(' / ')};
  })}));
  const rows = allRows.map(row => ({...row, items:row.items.filter(i => !i.memo?.drop)})).filter(row => row.items.length);
  return {...calendar, rows, allRows, memoryDropped:dropped};
}
// 이 주에 빠지는 일정인지. drops: Map(일정 키 → 'drop' | 'keep') = 이번 주만 뺀 것·이번 주만 넣은 것(임시저장). 이번 주 값이 기억보다 앞선다.
export function isDropped(item, drops) {
  const d = drops?.get?.(item?.key);
  if (d === 'drop') return true;
  if (d === 'keep') return false;
  return !!item?.memo?.drop;
}
// 기억이 정한 제목·장소(없으면 null).
export const memoryTitle = item => (item?.memo?.title ? {title:item.memo.title, place:item.memo.place ?? item.place} : null);
// 칸에 들어갈 제목·장소의 바탕 = 기억(있으면) 아니면 달력.
export const defaultTitle = item => memoryTitle(item) ?? {title:item.title, place:item.place};
// 파일·다름 목록이 쓰는 일정 달력: 이 주에 빠지는 일정을 뺀 줄(한글 파일 상자가 넘기는 allRows 기준).
export function visibleCalendar(calendar, drops) {
  if (!calendar || calendar.loading || calendar.failed?.length) return calendar;
  const all = calendar.allRows ?? calendar.rows ?? [];
  return {...calendar, rows:all.map(row => ({...row, items:row.items.filter(i => !isDropped(i, drops))})).filter(row => row.items.length)};
}
// 파일 칸 글에 넣을 제목 값: 이번 주에 고친 값(titles) > 기억 > 없음(달력 그대로). Map(일정 키 → {title, place}).
export function effectiveOverrides(items, titles) {
  const out = new Map();
  for (const item of items ?? []) {
    const t = titles?.get?.(item.key) ?? memoryTitle(item);
    if (t) out.set(item.key, t);
  }
  return out;
}

// ---- [확정] 뒤 기억 후보(설계 3.3) ----
// items: 상자 확인 목록(scheduleItems(allRows) — memo 포함). titles·drops: 이번 주 값. 돌려주는 것:
//   candidates: [{key, origin, title?, place?, drop?, label, checked}] — 달력 제목과 다르게 확정한 일정·이번 주에 뺀 일정(이미 같은 기억이면 없음).
//     2자 이하 제목은 체크를 풀어 둔다(설계 위험 2 — "회의"처럼 흔한 제목을 기억하면 다른 일정도 바뀜).
//   used: 이 주에 실제 적용된 기억 열쇠(마지막 적용일 갱신용).
export function memoryCandidates(items, {titles, drops} = {}) {
  const out = new Map(), used = new Set();
  for (const item of items ?? []) {
    const key = scheduleMemoryKey(item.title), origin = one(item.title);
    const ownDrop = drops?.get?.(item.key);
    if (item.memo?.drop) { if (ownDrop !== 'keep') used.add(item.memo.key); continue; }
    const o = titles?.get?.(item.key), label = `${item.label} ${item.time}`;
    const fits = key && okText(key, KEY_MAX) && okText(origin, TITLE_MAX) && !out.has(key);
    if (ownDrop === 'drop') { if (fits) out.set(key, {key, origin, drop:true, label, checked:[...key].length > 2}); continue; }
    if (!o) { if (item.memo?.title) used.add(item.memo.key); continue; }
    if (!fits) continue;
    const title = one(o.title) || origin, place = one(o.place);
    if (title === one(item.title) && place === one(item.place)) continue; // 이번 주만 원래대로(또는 고치지 않음)
    const mt = memoryTitle(item);
    if (mt && title === one(mt.title) && place === one(mt.place)) { used.add(item.memo.key); continue; }
    if (!okText(title, TITLE_MAX)) continue;
    const entry = {key, origin, title, label, checked:[...key].length > 2};
    if (place && place !== one(item.place) && okText(place, PLACE_MAX)) entry.place = place;
    out.set(key, entry);
  }
  return {candidates:[...out.values()], used:[...used]};
}

// ---- 목록 바꾸기(순수) ----
const stamp = e => e.used || e.saved;
// 항목을 열쇠로 넣거나 바꾼다(같은 열쇠는 새 것으로, 자리는 뒤로). 200개가 넘으면 가장 오래 안 쓰인 것부터 뺀다.
export function withEntries(list, entries, day) {
  if (!Array.isArray(list) || !DAY.test(String(day))) return null;
  const add = [];
  for (const c of entries ?? []) {
    const e = {key:c.key, origin:c.origin, ...(c.drop ? {drop:true} : {title:c.title, ...(c.place ? {place:c.place} : {})}), saved:day};
    if (validEntry(e)) add.push(e);
  }
  const keys = new Set(add.map(e => e.key));
  let next = [...list.filter(e => !keys.has(e.key)), ...add];
  while (next.length > MEMORY_MAX) {
    let oldest = 0;
    next.forEach((e, i) => { if (!keys.has(e.key) && (keys.has(next[oldest].key) || stamp(e) < stamp(next[oldest]))) oldest = i; });
    next = next.filter((_, i) => i !== oldest);
  }
  return next;
}
export const withoutKey = (list, key) => (Array.isArray(list) ? list.filter(e => e.key !== key) : null);
// 지운 항목을 되돌릴 때(같은 열쇠가 그사이 생겼으면 그대로 둔다).
export const withRestored = (list, entry) => (!Array.isArray(list) ? null : list.some(e => e.key === entry?.key) || !validEntry(entry) ? [...list] : [...list, {...entry}]);
export function withUsed(list, keys, day) {
  if (!Array.isArray(list) || !DAY.test(String(day))) return null;
  const set = new Set(keys ?? []);
  return list.map(e => (set.has(e.key) ? {...e, used:day} : e));
}
// 목록에 보일 "N주 안 쓰임"(마지막 적용일, 없으면 기억한 날 기준). 1주 미만이면 0.
export function idleWeeks(entry, today) {
  const from = Date.parse(`${stamp(entry)}T00:00:00Z`), to = Date.parse(`${today}T00:00:00Z`);
  return Number.isFinite(from) && Number.isFinite(to) && to > from ? Math.floor((to - from) / (7 * 86400000)) : 0;
}

// 서버가 재는 크기(jsonb 글 모양은 ':'·',' 뒤에 빈칸이 하나씩 붙는다)보다 작지 않게 어림한다.
export const memoryBytes = list => new TextEncoder().encode(JSON.stringify(list)).length + list.reduce((n, e) => n + 2 * Object.keys(e).length, 0) + list.length;

// ---- 서버(내 프로필 행, 이 칸만) ----
const profileUrl = rt => {
  const user = rt?.context?.read?.()?.user?.id;
  return user ? `/rest/v1/app_profiles?user_id=eq.${encode(user)}` : '';
};
// {status:'ok', list} 또는 {status:'unknown'}(프로필 행 없음, 칸 준비 전, 읽기 실패).
export async function readMemory(rt = window.KPTURuntime) {
  const url = profileUrl(rt);
  if (!url) return {status:'unknown'};
  try {
    const rows = await rt.api(`${url}&select=weekly_schedule_memory&limit=1`);
    const list = Array.isArray(rows) && rows.length ? parseMemory(rows[0]?.weekly_schedule_memory) : null;
    return list ? {status:'ok', list} : {status:'unknown'};
  } catch { return {status:'unknown'}; }
}
// change(list) → 새 목록(null이면 쓰지 않음). 쓰기 직전에 다시 읽는다. 크기 상한은 화면이 먼저 본다. {ok:true, list} | {ok:false}.
export async function changeMemory(change, rt = window.KPTURuntime) {
  const url = profileUrl(rt);
  if (!url) return {ok:false};
  try {
    const fresh = await readMemory(rt);
    if (fresh.status !== 'ok') return {ok:false};
    const next = change(fresh.list);
    if (!Array.isArray(next) || next.length > MEMORY_MAX || memoryBytes(next) > MEMORY_BYTES) return {ok:false};
    if (JSON.stringify(next) === JSON.stringify(fresh.list)) return {ok:true, list:next};
    const saved = await rt.api(url, {method:'PATCH', prefer:'return=representation', body:{weekly_schedule_memory:next}});
    const list = Array.isArray(saved) && saved.length === 1 ? parseMemory(saved[0]?.weekly_schedule_memory) : null;
    return list ? {ok:true, list} : {ok:false};
  } catch { return {ok:false}; }
}
