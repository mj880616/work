// WEEKLY-임원요청정리 (2026-10-23 사용자 요청 12:13·12:15): 주간보고 "1. 요청사항 › 1) 임원 일정 배정·논의 요청" 표
// (일 | 시간/내용/장소 | 참석 요청)의 줄. 화면 없는 부분 — 줄 규칙·지난주 확정본에서 가져오기·양식 모양·서버 저장(같은 코드를 시험이 부른다).
// - 저장소: owner RLS 표 app_weekly_exec_requests(migration 20261023140000) — [주간 정리]가 보는 주(월요일)마다 1행, 줄 목록 items(jsonb)와
//   "직전 주 확정본에서 한 번 가져온 시각" carried_at. 지우기 권한은 없다(줄을 다 지워도 빈 목록으로 남아 다시 가져오지 않음).
// - 지난주에서 가져오기(carryOver): 직전 주 확정본 요청 표의 줄 가운데 ① 날짜가 기준일(상집 보고일과 오늘 중 늦은 날) 이후이고(그날 포함)
//   ② 내가 요청한 줄 — (가) 내 '임원 요청' 기록(업데이트의 임원 일정 배정 요청 표시 metadata.requests=exec_schedule, 또는 글에
//   '임원 요청'·'임원 일정 배정 요청'·'참석 요청'을 쓴 업데이트·조직·사업 기록, 2026-10-23 사용자 12:43)이 그 줄을 가리키거나(행사 이름이
//   기록 글에 그대로 있거나, 기록 글에 그 날짜(M.D·M/D·M월 D일)와 행사 이름 낱말이 함께 있음) (나) 내용·장소 글에 내 담당 사업장 이름·별칭
//   또는 내 사업(진행 중인 프로젝트, 확정본의 내 담당 줄 사업영역·세부 과제) 이름이 든 줄만 남긴다. 날짜를 읽지 못한 줄, 요일이 날짜와
//   다른 줄, 이름이 짧아(사업장 2자·사업 3자 미만) 확신할 수 없는 줄은 뺀다.
//   가져온 줄은 carried=true — 화면에만 '지난주에서' 표시, 한글 파일·복사에는 표시 없이 같은 모양으로 나간다.
// - 표가 아직 없으면(REST 404) {missing:true} — 화면은 입력칸 없이 안내하고, 한글 파일 요청 표는 걸러 낸 줄만 쓴다(저장 없음).
// 브라우저 저장소에 아무것도 두지 않는다.

const TABLE = '/rest/v1/app_weekly_exec_requests';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const encode = encodeURIComponent;
// The database rule (app_weekly_exec_requests_items_check): 30 rows; one-line text; these lengths in characters.
export const EXEC_MAX_ROWS = 30;
export const EXEC_LIMITS = Object.freeze({time:40, what:200, place:100, who:200});
export const EXEC_HEAD = Object.freeze(['일', '시간/내용/장소', '참석 요청']);
export const CARRIED_TAG = '지난주에서';
const FIELDS = ['time', 'what', 'place', 'who'];
const CONTROL = /[\u0000-\u001f\u007f]/;
// A name shorter than this (spaces and marks removed) is too unsure to match: 사업장 이름·별칭 2자, 사업 이름 3자.
export const MIN_NAME = Object.freeze({org:2, project:3});

// ---- days ----
const WEEKDAY = '일월화수목금토';
const utc = day => { const [y, m, d] = String(day).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const realDay = day => DAY.test(String(day)) && utc(day).toISOString().slice(0, 10) === day;
export const dayParts = day => { const [, m, d] = String(day).split('-').map(Number); return {m, d, w:WEEKDAY[utc(day).getUTCDay()]}; };
// The form's day cell: "10.19.(월)" (5. 주요 일정 uses the same, journal-weekly.js).
export const formDay = day => { const {m, d, w} = dayParts(day); return `${m}.${d}.(${w})`; };
export const dayLabel = item => (item.until && item.until !== item.day ? `${formDay(item.day)} ~ ${formDay(item.until)}` : formDay(item.day));
const pad = n => String(n).padStart(2, '0');
const nearestYear = (m, d, near) => {
  const base = Number(String(near).slice(0, 4)), at = utc(near).getTime();
  let best = null;
  for (const y of [base - 1, base, base + 1]) {
    const day = `${y}-${pad(m)}-${pad(d)}`;
    if (!realDay(day)) continue;
    const gap = Math.abs(utc(day).getTime() - at);
    if (!best || gap < best.gap) best = {day, gap};
  }
  return best?.day ?? null;
};
// A form day cell ("10.21.(수)", "10.21(수)", "10. 21.", "10.14.(수) ~ 10.15.(목)") → {day, until?}, or null when it cannot be read
// for sure (other words in the cell, a weekday that is not that date's, more than two dates). near: the day the year is taken around.
export function parseFormDay(text, near) {
  const raw = String(text ?? '').trim();
  if (!raw || !realDay(near)) return null;
  const found = [], pattern = /(\d{1,2})\s*[./]\s*(\d{1,2})\s*\.?\s*(?:\(\s*([일월화수목금토])\s*\))?/g;
  let match, rest = raw;
  while ((match = pattern.exec(raw))) {
    const day = nearestYear(Number(match[1]), Number(match[2]), near);
    if (!day || (match[3] && WEEKDAY[utc(day).getUTCDay()] !== match[3])) return null;
    found.push(day); rest = rest.replace(match[0], ' ');
  }
  if (!found.length || found.length > 2 || /[^\s~\-–～]/.test(rest)) return null;
  const [day, until] = found;
  if (until && until < day) return null;
  return until && until !== day ? {day, until} : {day};
}

// ---- rows ----
const one = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const TIME = /^(?:\d{1,2}:\d{2}(?:\s*[~\-–]\s*\d{1,2}:\d{2})?|\d{1,2}시(?:\s*\d{1,2}분)?(?:\s*[~\-–]\s*\d{1,2}시(?:\s*\d{1,2}분)?)?|종일|오전|오후|미정)$/;
// The form's middle cell "HH:MM / 행사 / 장소" → {time, what, place}.
export function splitWhat(text) {
  const parts = one(text).split(/\s*\/\s*/).filter(Boolean);
  if (!parts.length) return {time:'', what:'', place:''};
  const timed = TIME.test(parts[0]);
  if (parts.length === 1) return timed ? {time:parts[0], what:'', place:''} : {time:'', what:parts[0], place:''};
  if (parts.length === 2) return timed ? {time:parts[0], what:parts[1], place:''} : {time:'', what:parts[0], place:parts[1]};
  return timed ? {time:parts[0], what:parts.slice(1, -1).join(' / '), place:parts.at(-1)} : {time:'', what:parts.slice(0, -1).join(' / '), place:parts.at(-1)};
}
export const whatCell = item => [item.time, item.what, item.place].map(one).filter(Boolean).join(' / ');
export const whoLines = who => String(who ?? '').split(/\s*[,，]\s*/).map(one).filter(Boolean);
export const newId = () => (globalThis.crypto?.randomUUID?.() ?? `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

const fail = (message, field) => { throw Object.assign(new Error(message), {code:'invalid', field}); };
// What an owner typed → one saved row (the database's rule). Throws {code:'invalid', field, message}.
export function cleanItem(input, {id = input?.id || newId()} = {}) {
  const out = {id: String(id)};
  if (!ID.test(out.id)) fail('줄을 확인할 수 없어요.', 'id');
  const day = String(input?.day ?? '').trim();
  if (!realDay(day)) fail('날짜를 골라 주세요.', 'day');
  out.day = day;
  const until = String(input?.until ?? '').trim();
  if (until) {
    if (!realDay(until)) fail('끝 날짜를 확인해 주세요.', 'until');
    if (until < day) fail('끝 날짜가 시작 날짜보다 빨라요.', 'until');
    if (until !== day) out.until = until;
  }
  for (const key of FIELDS) {
    const raw = String(input?.[key] ?? '');
    if (CONTROL.test(raw.replace(/[\t\r\n]/g, ' '))) fail('쓸 수 없는 글자가 들어 있어요.', key);
    const value = one(raw);
    if ([...value].length > EXEC_LIMITS[key]) fail(`${({time:'시간', what:'내용', place:'장소', who:'참석 요청'})[key]}은(는) ${EXEC_LIMITS[key]}자까지 쓸 수 있어요.`, key);
    out[key] = value;
  }
  if (!out.what) fail('내용을 써 주세요.', 'what');
  if (input?.carried === true) out.carried = true;
  return out;
}
// Saved rows as read back: anything that does not fit the rule is left out (the database already refuses it).
export function readItems(items) {
  const out = [];
  for (const item of Array.isArray(items) ? items : []) { try { out.push(cleanItem(item, {id:item?.id})); } catch { /* not a row */ } }
  return sortItems(out);
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// Rows by date, then time (a row without a time last on its day), then end date and text.
export const sortItems = items => [...items].sort((a, b) => cmp(a.day, b.day) || cmp(a.time ? 0 : 1, b.time ? 0 : 1) || cmp(a.time, b.time) || cmp(a.until ?? a.day, b.until ?? b.day) || cmp(a.what, b.what));
const sameKey = item => [item.day, item.until ?? '', item.time, item.what, item.place].map(s => String(s ?? '').replace(/\s+/g, '')).join('|');
// Carried rows not already on the list (same day, time, text, place) are added.
export function mergeCarried(items, carried) {
  const keys = new Set(items.map(sameKey));
  return sortItems([...items, ...carried.filter(item => !keys.has(sameKey(item)))]).slice(0, EXEC_MAX_ROWS);
}

// ---- carry over from last week's confirmed report ----
export const nameKey = s => String(s ?? '').toLowerCase().replace(/[\s·‧․.,()[\]{}<>「」『』'"“”‘’\-–_/]/g, '');
// names: {orgs:[이름·별칭], projects:[사업 이름]} → the keys long enough to be sure of.
export function relatedNames({orgs = [], projects = []} = {}) {
  const keys = [];
  for (const [list, min] of [[orgs, MIN_NAME.org], [projects, MIN_NAME.project]]) for (const name of list) { const key = nameKey(name); if ([...key].length >= min) keys.push(key); }
  return [...new Set(keys)];
}
export const relates = (item, keys) => { const text = nameKey(`${item.time} ${item.what} ${item.place}`); return keys.some(key => text.includes(key)); };
// 내 '임원 요청' 기록 글: 표시(exec_schedule)가 있거나 글에 그 말을 쓴 기록. (표시를 켜는 버튼은 UI-요청버튼삭제로 없고 글에 쓴다.)
export const EXEC_WORDS = /임원\s*(?:일정\s*배정\s*)?요청|참석\s*요청/;
export const isExecRecord = ({text = '', requests = []} = {}) => requests.includes('exec_schedule') || EXEC_WORDS.test(String(text));
const GENERIC = new Set(['임원', '요청', '참석', '일정', '배정', '행사', '회의', '종일', '오전', '오후']);
const dayPatterns = day => { const {m, d} = dayParts(day); return [new RegExp(`(^|[^0-9])${m}\\s*[./]\\s*${d}([^0-9]|$)`), new RegExp(`${m}\\s*월\\s*${d}\\s*일`)]; };
// A confirmed row I asked for: a request record names its event (the whole event name, 4자 이상), or holds its date with a word of it.
export function requestedBy(item, texts) {
  const name = nameKey(item.what), words = String(item.what).split(/[\s/·,()[\]]+/).map(nameKey).filter(w => [...w].length >= 2 && !GENERIC.has(w));
  const days = [item.day, ...(item.until && item.until !== item.day ? [item.until] : [])].flatMap(dayPatterns);
  return texts.some(raw => {
    const text = String(raw ?? ''), key = nameKey(text);
    if ([...name].length >= 4 && key.includes(name)) return true;
    return days.some(re => re.test(text)) && words.some(w => key.includes(w));
  });
}
// The cutoff: rows from this day on stay (the report day, or today when the report is written late).
export const carryCutoff = (reportDay, today) => (String(today) > String(reportDay) ? String(today) : String(reportDay));
// requests: the confirmed report's request table (report.mjs requestsFromTable: [{day:'10.21.(수)', items:[{what, who:[]}]}]).
// Returns {items (carried=true), counts:{kept, past, unrelated, unread}}.
// requested: my '임원 요청' record texts (isExecRecord). counts.requested = rows kept because a request record points at them.
export function carryOver(requests, {cutoff, near = cutoff, orgs = [], projects = [], requested = [], makeId = newId} = {}) {
  const keys = relatedNames({orgs, projects}), items = [], counts = {kept:0, requested:0, past:0, unrelated:0, unread:0};
  for (const group of Array.isArray(requests) ? requests : []) {
    const when = parseFormDay(group?.day, near);
    for (const entry of group?.items ?? []) {
      const parts = splitWhat(entry?.what);
      if (!when || !parts.what) { counts.unread++; continue; }
      if ((when.until ?? when.day) < cutoff) { counts.past++; continue; }
      const draft = {...when, ...parts, who:(entry.who ?? []).map(one).filter(Boolean).join(', '), carried:true};
      const asked = requested.length > 0 && requestedBy(draft, requested);
      if (!asked && !relates(draft, keys)) { counts.unrelated++; continue; }
      try { items.push(cleanItem(draft, {id:makeId()})); counts.kept++; if (asked) counts.requested++; } catch { counts.unread++; }
    }
  }
  return {items:sortItems(items).slice(0, EXEC_MAX_ROWS), counts};
}

// ---- outputs (the same rows everywhere; the carried mark is not part of any output) ----
// The .hwpx request table (report.mjs requests): one day cell per date (rows of the same day share it, as in the form).
export function formRequests(items) {
  const out = [];
  for (const item of sortItems(items)) {
    const day = dayLabel(item), row = {what:whatCell(item), who:whoLines(item.who)};
    if (out.at(-1)?.day === day) out.at(-1).items.push(row); else out.push({day, items:[row]});
  }
  return out;
}
// The draft copy ([복사]): one line a row.
export const requestLine = item => `- ${dayLabel(item)} ${whatCell(item)}${whoLines(item.who).length ? ` — 참석 요청: ${whoLines(item.who).join(', ')}` : ''}`;

// ---- server ----
const workspaceOf = rt => {
  const id = rt.context.read()?.workspace?.id;
  if (!id) throw new Error('업무 공간을 확인할 수 없습니다.');
  return id;
};
const SELECT = 'select=id,items,carried_at,updated_at';
const rowOf = row => (row && typeof row === 'object' ? {id:row.id, items:readItems(row.items), carried_at:row.carried_at ?? null, updated_at:row.updated_at} : null);
// The shown week's row: {row} (null when nothing is saved yet), or {missing:true} before the table exists.
export async function readExecRequests(start, rt = window.KPTURuntime) {
  if (!DAY.test(String(start))) throw new Error('week');
  let rows;
  try { rows = await rt.api(`${TABLE}?workspace_id=eq.${encode(workspaceOf(rt))}&week_start=eq.${start}&${SELECT}&limit=1`); }
  catch (error) { if (error?.status === 404) return {missing:true, row:null}; throw error; }
  if (!Array.isArray(rows)) throw new Error('read');
  return {missing:false, row:rowOf(rows[0])};
}
// One change of the week's rows. change(items, row) → the new rows, or null for "nothing to do" (then nothing is written).
// carry: also marks the week as carried (carried_at). A week another device wrote meanwhile (409 on a new row, or no row back
// from the guarded PATCH) is read again and the same change is applied once more on what is there now.
export async function changeExecRequests({start, row = null, change, carry = false}, rt = window.KPTURuntime) {
  if (!DAY.test(String(start))) throw new Error('week');
  const workspace = workspaceOf(rt);
  let current = row;
  for (let attempt = 0; attempt < 2; attempt++) {
    const next = change(current?.items ?? [], current);
    if (!next) return {row:current, skipped:true};
    const items = sortItems(next).map(item => cleanItem(item, {id:item.id}));
    if (items.length > EXEC_MAX_ROWS) throw Object.assign(new Error(`요청 줄은 ${EXEC_MAX_ROWS}줄까지예요.`), {code:'too_many'});
    const now = new Date().toISOString();
    const body = {items, updated_at:now, ...(carry ? {carried_at:now} : {})};
    try {
      if (!current) {
        const rows = await rt.api(`${TABLE}?${SELECT}`, {method:'POST', prefer:'return=representation', body:{workspace_id:workspace, week_start:start, ...body}});
        if (Array.isArray(rows) && rows.length === 1) return {row:rowOf(rows[0])};
      } else {
        const rows = await rt.api(`${TABLE}?workspace_id=eq.${encode(workspace)}&week_start=eq.${start}&updated_at=eq.${encode(current.updated_at)}&${SELECT}`, {method:'PATCH', prefer:'return=representation', body});
        if (Array.isArray(rows) && rows.length === 1) return {row:rowOf(rows[0])};
      }
    } catch (error) {
      if (error?.status === 404) throw Object.assign(new Error('요청 표 저장 칸이 아직 준비되지 않았어요.'), {code:'missing'});
      if (current || error?.status !== 409) throw error;
    }
    current = (await readExecRequests(start, rt)).row;
  }
  throw Object.assign(new Error('다른 곳에서 이 주 요청 표가 계속 바뀌고 있어요. 다시 불러온 표에서 확인해 주세요.'), {code:'changed', row:current});
}
