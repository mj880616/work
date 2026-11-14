// ORG-기록하나로 O-4(설계 docs/design/record-one.md 2-5~2-9): 조직보고 '창' 순수 규칙 한 곳 — 화면·네트워크 없음.
// 쓰는 곳은 조직 기록(app_suborganization_updates) 하나, 보고 표는 그 기록을 보여 주는 창이다.
// - 창 = 보고하는 주 월요일 M 기준 [M − 21일, M + 21일) = 지난 3주 + 이번 주 + 앞 2주. 기간 기록(end_day)은 창에 조금이라도 걸치면 나온다.
// - 후보 = 창 안 그 조직 기록 + 그 조직과 연결된 창 안 구글 캘린더 일정(읽기만, 같은 일이 기록에 있으면 일정 줄은 감춤) − 뺀 줄.
// - 늘 보임 = 이번 주·앞 2주 줄 + 이번 주에 걸친 기간 줄. 그다음 지난 줄을 최근 것부터 채워 조직당 7줄. 넘친 지난 줄은 '지난 기록 n'으로 접음.
// - 보고용 표시(app_report_line_marks)는 '그 주부터' 이어진다: 그 주에 쓰이는 표시 = 같은 (section, 줄)의 week_start ≤ 그 주인 가장 나중 행.
//   '뺀 줄 n'은 그 주 창 후보 가운데 뺀 줄만 센다(창 밖으로 나간 옛 표시는 세지도 보이지도 않음).
// - 확정 사진(app_report_snapshots)이 있는 주는 사진 줄 그대로 + 사진 뒤 새로 생긴 줄을 흐린 '확정 뒤 추가'로.
// - 전환 주(RECORD_ONE_FROM) 이전 주는 옛 주별 조직보고 표를 읽기 전용으로 보인다(화면 쪽, record-window-view.js).
import {dayText, validDay, shiftWeek, mondayOf} from './weekly-org-lines-model.mjs';
import {linkedOrgs, titleOrg} from './pre-meeting-sheet-model.mjs';
import {isOrgRefTitle, cleanTitle} from './calendar-ref-model.mjs';
import {oneLine, recordOneLine, plainLines} from './record-oneline.mjs';

export const ORG_PAST_WEEKS = 3;
export const ORG_AHEAD_WEEKS = 2;
export const ORG_MAX = 7;
export const SITE_MIN = 3;
export const SITE_MAX = 7;
export const SITE_EVENTS = false; // 3. 2)에는 일정 줄을 넣지 않는다(2-7). 켜고 싶으면 이 상수 하나.
export const LONG_SPAN_DAYS = 90; // 창 시작보다 이만큼 앞선 기간 기록까지만 읽는다(2-6)
export const BODY_MAX = 1000;     // 보고용 글(표시 표 DB 검사와 같음)
export const RECORD_MAX = 2000;   // 조직 기록 한 줄 글(화면 검사)
// 전환 주: 이 주부터 창 규칙, 그 앞 주는 옛 표 읽기 전용(설계 3-1). 2026-11-09 운영 DB O-2 적용 주.
export const RECORD_ONE_FROM = '2026-11-09';
export {dayText, shiftWeek, mondayOf, oneLine};

const DAY_MS = 86400000;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const seoulDay = value => { const t = Date.parse(String(value ?? '')); return Number.isFinite(t) ? new Date(t + 9 * 3600000).toISOString().slice(0, 10) : ''; };
// 한 줄 글: 제어문자·줄바꿈을 띄어쓰기로, 겹친 띄어쓰기를 하나로(자르지 않음 — 길이는 DB가 본다).
export const cleanBody = text => String(text ?? '').replace(/[\p{Cc}\u200b-\u200f\u202a-\u202e\u2060-\u2069]/gu, ' ').replace(/\s+/g, ' ').trim();
const compact = text => String(text ?? '').normalize('NFC').replace(/[\s·‧․.,()[\]{}<>「」『』'"“”‘’\-–_/~]/g, '').toLowerCase();
export const lineId = (kind, key) => `${kind}:${key}`;

export const isOldWeek = week => validDay(week) && week < RECORD_ONE_FROM;
// 조직 창 [from, to)(to 제외).
export function orgWindow(week) {
  if (!validDay(week)) return null;
  return {from: addDays(week, -7 * ORG_PAST_WEEKS), to: addDays(week, 7 * (ORG_AHEAD_WEEKS + 1))};
}
// 서버에서 읽을 기록 범위: 이 주와 앞 주('지난주' 표시)의 창을 덮고, 기간 기록은 LONG_SPAN_DAYS 앞까지.
export function readRange(week) {
  const w = orgWindow(week), p = orgWindow(shiftWeek(week, -1));
  if (!w || !p) return null;
  return {from: addDays(p.from, -LONG_SPAN_DAYS), to: w.to};
}
// 일정을 읽을 두 범위(한 범위가 길어 읽기 상한에 걸리지 않게 나눔, 2-9).
export function eventRanges(week) {
  const w = orgWindow(week);
  return w ? [{from: w.from, to: week}, {from: week, to: w.to}] : [];
}
// 줄이 창(또는 [from,to))에 걸치는가.
export const overlaps = (item, range) => !!(item && range && validDay(item.day) && item.day < range.to && (validDay(item.end_day) && item.end_day > item.day ? item.end_day : item.day) >= range.from);

// ---- 후보 만들기 ----
// 조직 기록 행 → 줄 {kind:'org_update', key, org, day, end_day, text(한 줄), full(원문 그대로), created_at, source_kind}. 날짜가 없거나 글이 비면 null.
// RECORD-한줄: 표에는 한 줄만(record-oneline.mjs). 원문은 full에 그대로 두고 [원문 보기]·같은 일 찾기에 쓴다.
export function recordItem(row) {
  const day = seoulDay(row?.occurred_at), text = recordOneLine(row);
  if (!row?.id || !row?.organization_id || !validDay(day) || !text) return null;
  const end = validDay(row.end_day) && row.end_day > day ? row.end_day : null;
  const none = row.day_none === true; // ORG-기록날짜고치기: 날짜 '없음' 기록(줄에는 '-'만, 창 계산은 쓴 날 occurred_at 그대로)
  return {kind: 'org_update', key: String(row.id), org: String(row.organization_id), day, end_day: none ? null : end, none, at: String(row.occurred_at ?? ''), text, full: String(row.raw_text ?? ''), created_at: row.created_at ?? null, source_kind: row.source_kind ?? null};
}
// 줄 날짜 글: '11.2.' / '11.2.~12.5.', 날짜 '없음' 기록은 ''(줄에는 '-'만).
export const lineDay = l => (l?.none ? '' : dayText(l?.day, l?.end_day));

// ---- 기록 날짜 수정(ORG-기록날짜고치기, 시안 docs/design/mockups/org-record-day-edit.html) ----
// 칸 = [하루|기간|없음] + 달력. 하루·기간은 occurred_at의 날짜만 바꾸고 서울 시각은 그대로, 기간은 end_day.
// 없음 = 쓴 날(created_at 서울 날짜, 없으면 지금 날짜)로 occurred_at을 두고 day_none=true — 줄에는 '-'만, 쓴 주에 보인다.
export const DAY_MODES = Object.freeze(['day', 'range', 'none']);
export function dayDraft(item) {
  if (item?.none) return {mode: 'none', day: item.day || '', end_day: ''};
  return {mode: item?.end_day ? 'range' : 'day', day: item?.day || '', end_day: item?.end_day || ''};
}
const seoulClock = at => { const t = Date.parse(String(at ?? '')); return Number.isFinite(t) ? new Date(t + 9 * 3600000).toISOString().slice(11, 19) : '12:00:00'; };
// 날짜만 바꾼 저장 시각: 그 기록의 서울 시각을 그대로 두고 날짜만 day로.
export const movedAt = (at, day) => `${day}T${seoulClock(at)}+09:00`;
// 저장 값 검사. 돌려주는 값: {ok:false, field:'day'|'end_day'} | {ok:true, value:{occurred_at, end_day, day_none}} | {ok:true, value:null}(바뀐 것 없음).
// noneOn=false(서버에 day_none 칸이 아직 없을 때)면 '없음'은 거절하고 day_none을 보내지 않는다.
export function checkDayEdit(item, draft, {noneOn = true, today = ''} = {}) {
  const mode = DAY_MODES.includes(draft?.mode) ? draft.mode : 'day';
  let day, end = null, none = false;
  if (mode === 'none') {
    if (!noneOn) return {ok: false, field: 'mode'};
    day = seoulDay(item?.created_at) || (validDay(today) ? today : item?.day);
    if (!validDay(day)) return {ok: false, field: 'mode'};
    none = true;
  } else {
    day = draft?.day;
    if (!validDay(day)) return {ok: false, field: 'day'};
    if (mode === 'range') {
      if (!validDay(draft?.end_day) || draft.end_day < day) return {ok: false, field: 'end_day'};
      end = draft.end_day > day ? draft.end_day : null;
    }
  }
  if (day === item?.day && (end || null) === (item?.none ? null : item?.end_day || null) && none === !!item?.none) return {ok: true, value: null};
  const value = {occurred_at: movedAt(item?.at, day), end_day: end};
  if (noneOn) value.day_none = none;
  return {ok: true, value};
}

// 일정 날짜: 종일 = 시작 날(여러 날이면 끝 날 − 1일을 end_day), 시각 일정 = 서울 날짜.
export function eventSpan(event) {
  const s = String(event?.start ?? ''), e = String(event?.end ?? '');
  const isDay = /^\d{4}-\d{2}-\d{2}$/;
  if (event?.allDay || isDay.test(s)) {
    const day = s.slice(0, 10);
    if (!validDay(day)) return null;
    const last = isDay.test(e.slice(0, 10)) && validDay(e.slice(0, 10)) ? addDays(e.slice(0, 10), -1) : day;
    return {day, end_day: last > day ? last : null};
  }
  const day = seoulDay(s);
  if (!validDay(day)) return null;
  const last = seoulDay(e);
  return {day, end_day: validDay(last) && last > day ? last : null};
}
// 일정 → 그 조직 칸 줄들(2-9 연결 판정 ① 일정에 붙인 조직 → ② 제목의 조직 이름(한 조직만) → ③ 조직 참고 캘린더(주요 일정 낱말)).
// orgs = 내 담당조직 [{id, name, aliases}], ref = {calendar, org}(조직 참고 캘린더, 없으면 null). 취소 일정·내 목록에 없는 연결은 버린다.
// 같은 일정 id가 두 캘린더에서 오면 한 줄로 친다.
export function eventItems(events, orgs, ref = null) {
  const list = Array.isArray(orgs) ? orgs : [], out = [], seen = new Set();
  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev || ev.status === 'cancelled' || !ev.id) continue;
    const span = eventSpan(ev), text = cleanTitle(ev.title);
    if (!span || !text) continue;
    let targets = [];
    const linked = Array.isArray(ev.organizationIds) && ev.organizationIds.length;
    if (linked) targets = linkedOrgs(ev, list);
    else {
      const hit = titleOrg(ev, list);
      if (hit) targets = [hit];
      else if (ref?.calendar && ref?.org && ev.calendarId === ref.calendar && isOrgRefTitle(text)) { const o = list.find(x => String(x.id) === String(ref.org)); if (o) targets = [o]; }
    }
    for (const o of targets) {
      const k = `${o.id}|${ev.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({kind: 'event', key: String(ev.id), org: String(o.id), day: span.day, end_day: span.end_day, text, cal: String(ev.calendarId || 'primary')});
    }
  }
  return out;
}
// 같은 일: 같은 조직 칸에 같은 날(기간 기록이면 그 기간 안)이고 일정 제목이 기록 글에 들어 있으면 기록이 이긴다.
export function sameThing(event, record) {
  if (!event || !record || event.org !== record.org) return false;
  const end = record.end_day || record.day;
  if (!(event.day >= record.day && event.day <= end)) return false;
  const t = compact(event.text);
  return t.length >= 2 && compact(record.full || record.text).includes(t);
}

// ---- 표시 이어짐 ----
// marks = 표시 행들. 그 주에 쓰이는 표시 = 같은 (section, kind, key)의 week_start ≤ week인 가장 나중 행.
export function markOf(marks, section, kind, key, week) {
  let best = null;
  for (const m of Array.isArray(marks) ? marks : []) {
    if (!m || m.section !== section || m.ref_kind !== kind || String(m.ref_key) !== String(key) || !(m.week_start <= week)) continue;
    if (!best || m.week_start > best.week_start) best = m;
  }
  return best;
}
const valuesOf = m => ({report_body: m?.report_body ?? null, choice: m?.choice ?? null, detail: m?.detail ?? null});
const sameValues = (a, b) => a.report_body === b.report_body && a.choice === b.choice && a.detail === b.detail;
const EMPTY = valuesOf(null);
// 그 주에서 표시를 바꾼다. change = {report_body?, choice?, detail?}(바꾼 칸만). 행은 통째로 이기므로 앞 행 값을 복사하고 바꾼 칸만 고친다.
// 돌려주는 값: {op:'none'} | {op:'insert', row} | {op:'update', id, row} | {op:'delete', id}.
// 그 주 행이 바로 앞 행(없으면 '표시 없음')과 같은 값이 되면 그 주 행을 지운다(기록은 그대로).
export function nextMark(marks, {section, kind, key, week}, change) {
  const cur = markOf(marks, section, kind, key, week);
  const own = cur && cur.week_start === week ? cur : null;
  const before = markOf((Array.isArray(marks) ? marks : []).filter(m => m !== own), section, kind, key, addDays(week, -1));
  const next = {...valuesOf(cur), ...change};
  if (next.report_body != null) next.report_body = String(next.report_body).trim() || null;
  const base = before ? valuesOf(before) : EMPTY;
  if (own) {
    if (sameValues(next, base)) return {op: 'delete', id: own.id};
    if (sameValues(next, valuesOf(own))) return {op: 'none'};
    return {op: 'update', id: own.id, row: next};
  }
  if (sameValues(next, valuesOf(cur))) return {op: 'none'};
  return {op: 'insert', row: {week_start: week, section, ref_kind: kind, ref_key: String(key), ...next}};
}
// 보고용 글 검사(DB와 같은 규칙: 1~1000자, 앞뒤 공백 없음, 줄바꿈 말고 제어문자 없음).
export function checkReportBody(text) {
  const v = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!v) return {ok: false, field: 'body'};
  if ([...v].length > BODY_MAX || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(v)) return {ok: false, field: 'body'};
  return {ok: true, value: v};
}
// ORG-기록입력날짜(11/14): 새 기록 날짜 칸 = 수정 칸과 같은 [하루|기간|없음]. d = {mode?, day, end_day}(mode가 없으면 끝 날이 있을 때 기간).
// 없음 = 쓴 날(today)에 두고 none:true(서버에 day_none 칸이 있을 때만, noneOn). 돌려주는 값 {ok:false, field} | {ok:true, value:{day, end_day[, none]}}.
export function checkNewDay(d, {noneOn = false, today = ''} = {}) {
  const mode = DAY_MODES.includes(d?.mode) ? d.mode : d?.end_day ? 'range' : 'day';
  if (mode === 'none') return noneOn && validDay(today) ? {ok: true, value: {day: today, end_day: null, none: true}} : {ok: false, field: 'mode'};
  if (!validDay(d?.day)) return {ok: false, field: 'day'};
  if (mode === 'range' && (!validDay(d?.end_day) || d.end_day < d.day)) return {ok: false, field: 'end_day'};
  return {ok: true, value: {day: d.day, end_day: mode === 'range' && d.end_day > d.day ? d.end_day : null}};
}
// 새 기록 검사: 날짜(checkNewDay)·글.
export function checkRecord(d, opts = {}) {
  const body = String(d?.body ?? '').trim();
  const day = checkNewDay(d, opts);
  if (!day.ok) return day;
  if (!body || [...body].length > RECORD_MAX) return {ok: false, field: 'body'};
  return {ok: true, value: {...day.value, body}};
}
// 새 기록의 서버 칸(occurred_at·end_day·day_none) — saveOrganizationUpdate에 그대로 넘긴다.
export const newRecordFields = v => ({occurred_at: occurredAt(v.day), end_day: v.end_day || null, ...(v.none ? {day_none: true} : {})});
// 기록 날짜 → 저장 시각(서울 정오, 날짜 경계 흔들림 없게 — 2-2).
export const occurredAt = day => `${day}T12:00:00+09:00`;

// ---- 줄 순서 ----
const byDayAsc = (a, b) => a.day.localeCompare(b.day) || (a.kind === b.kind ? 0 : a.kind === 'event' ? 1 : -1) || a.text.localeCompare(b.text, 'ko') || a.key.localeCompare(b.key);
// ORG-줄순서(요청함 11/09): 표 줄 순서 'asc'(오래된 것 위, 기본)·'desc'(최신 위). 고른 값은 서버 화면 설정 org_row_order(view-prefs.js)에 있다.
// 어떤 줄이 보이고 접히는지(조직당 7줄 상한)는 순서와 상관없이 그대로(최근 것이 보임) — 순서는 보이는 줄·접힌 줄·뺀 줄이 늘어서는 방향만 정한다.
export const ROW_ORDERS = Object.freeze(['asc', 'desc']);
export const rowOrderOf = v => (v === 'desc' ? 'desc' : 'asc');
const byRecent = (a, b) => b.day.localeCompare(a.day) || (b.end_day || b.day).localeCompare(a.end_day || a.day) || byDayAsc(a, b);
const sortBy = (list, order) => [...list].sort(rowOrderOf(order) === 'desc' ? byRecent : byDayAsc);
// 이미 정해진 순서(확정 사진·옛 보고 줄)에 고른 순서만 입힌다: asc는 저장된 순서 그대로, desc는 거꾸로.
export const orderLines = (lines, order) => (rowOrderOf(order) === 'desc' ? [...lines].reverse() : lines);
// RECORD-보고용글잘림(요청함 11/10): 보고용 글(report_body)은 명진이 직접 쓴 글이라 자르지 않는다 — 줄바꿈·겹친 띄어쓰기만 한 칸으로(cleanBody).
// 60자 한 줄 규칙(record-oneline.mjs)은 AI·원문에서 만든 한 줄에만 쓴다. 표·복사·한글 파일·확정 사진이 모두 이 text를 쓴다.
export const reportLine = body => cleanBody(body);
// 줄 글: 보고용 글이 있으면 그 글 전체. 다만 예전 [보고용으로 수정]이 원문을 통째로 채워 그대로 저장된 보고용 글(원문과 같은 글)은
// 명진이 쓴 글이 아니라 원문이므로 원문 한 줄 규칙대로(item.text). 저장된 값은 그대로.
export function reportText(item, report) {
  if (report == null) return item.text;
  const full = reportLine(report);
  if (!full) return item.text;
  return item.full != null && String(item.full).trim() && full === cleanBody(item.full) ? item.text : full;
}
// 줄 하나에 그 주 표시를 입힌다. report = 저장된 보고용 글 원래 모양(줄바꿈 포함, [보고용으로 수정] 칸에 그대로 채움).
export const lineOf = (item, mark) => {
  const report = mark?.report_body != null ? String(mark.report_body) : null;
  return {...item, orig: item.text, text: reportText(item, report), report, edited: report != null, choice: mark?.choice ?? null, id: lineId(item.kind, item.key)};
};
// [보고용으로 수정] 칸에 채울 글: 저장된 보고용 글 전체 → 없으면 원문(표시 기호만 걷어낸 줄들, 자르지 않음) → 원문이 없는 줄(일정·사업 보고)은 줄 글.
// '…'를 붙여 자른 한 줄은 칸에 넣지 않는다(그대로 저장하면 뒷부분이 사라지므로).
export function editBase(line) {
  if (line?.report != null) return line.report;
  const raw = plainLines(line?.full).join('\n');
  return raw || String(line?.orig ?? line?.text ?? '');
}
// [저장] 값: 칸 글을 검사하고, 처음 채운 글(editBase) 그대로이거나 원래 줄 글과 같으면 report_body null(표시 지움 = 원문 한 줄로).
// 돌려주는 값: {ok:false, field} | {ok:true, value: 보고용 글 또는 null}.
export function reportChange(line, body) {
  const base = editBase(line);
  const v = checkReportBody(body ?? base);
  if (!v.ok) return v;
  if (line?.report != null) return {ok: true, value: v.value === line.orig ? null : v.value};
  return {ok: true, value: v.value === line?.orig || v.value === String(base).replace(/\r\n?/g, '\n').trim() ? null : v.value};
}

// 한 조직 칸 후보(창 안 기록 + 창 안 일정 − 같은 일). withEvents=false면 기록만.
export function candidates({org, week, records = [], events = [], withEvents = true}) {
  const win = orgWindow(week);
  if (!win) return [];
  const recs = records.filter(r => r && r.org === String(org) && overlaps(r, win));
  const evs = withEvents ? events.filter(e => e && e.org === String(org) && overlaps(e, win) && !recs.some(r => sameThing(e, r))) : [];
  return [...recs, ...evs];
}

// 4. 1) 한 조직 칸(창 규칙). marks = 표시 행, section 'org'. prevIds = 앞 주 표에 보인 줄 id 집합('지난주' 작은 표시).
// 돌려주는 값: {shown:[줄], folded:[줄], out:[줄]} — 셋 모두 order('asc' 오래된 것 위 = 기본, 'desc' 최신 위)를 따른다.
export function orgCell({org, week, records = [], events = [], marks = [], prevIds = null, section = 'org', max = ORG_MAX, withEvents = true, order = 'asc'}) {
  const cands = candidates({org, week, records, events, withEvents}).map(item => lineOf(item, markOf(marks, section, item.kind, item.key, week)));
  const out = sortBy(cands.filter(l => l.choice === 'out'), order);
  const rest = cands.filter(l => l.choice !== 'out');
  const always = rest.filter(l => (l.end_day || l.day) >= week);
  const forced = rest.filter(l => !always.includes(l) && l.choice === 'in');
  const past = rest.filter(l => !always.includes(l) && !forced.includes(l)).sort(byRecent);
  const room = Math.max(0, max - always.length); // 접힌 줄을 [넣기]한 줄은 상한과 상관없이 더 보인다
  const mark = l => ({...l, last: !!prevIds?.has?.(l.id)});
  return {
    shown: sortBy([...always, ...forced, ...past.slice(0, room)], order).map(mark),
    folded: sortBy(past.slice(room), order).map(mark),
    out: out.map(mark),
  };
}
// 3. 2) 투쟁 사업장 한 조직 칸: 같은 창 후보(일정은 SITE_EVENTS일 때만)에서 3~7줄, 모자라면 창 이전 기록(before, 최근 것부터)으로 3줄 채움.
// 채우다가 건너뛴 뺀 줄도 '뺀 줄'에 센다(3줄을 채우면 멈추므로 끝없이 늘지 않음).
export function siteCell({org, week, records = [], events = [], marks = [], order = 'asc'}) {
  const cell = orgCell({org, week, records, events, marks, section: 'site', max: SITE_MAX, withEvents: SITE_EVENTS, order});
  const win = orgWindow(week);
  if (!win || cell.shown.length >= SITE_MIN) return cell;
  const fill = [], out = [...cell.out];
  const before = records.filter(r => r && r.org === String(org) && validDay(r.day) && (r.end_day || r.day) < win.from).sort(byRecent);
  for (const r of before) {
    if (cell.shown.length + fill.length >= SITE_MIN) break;
    const l = lineOf(r, markOf(marks, 'site', r.kind, r.key, week));
    if (l.choice === 'out') { out.push({...l, last: false}); continue; }
    fill.push({...l, last: false});
  }
  return {shown: sortBy([...fill, ...cell.shown], order), folded: cell.folded, out: sortBy(out, order)};
}

// ---- 확정 사진 ----
// 사진 행에서 그 조직 칸 {lines, seen_events} 찾기(section 'org', ref_key = 조직 id). 없으면 null.
// marks·week를 주면 그 주 보고용 글이 있는 줄은 자르지 않는다(사진 글이 그 보고용 글이거나, 예전 규칙으로 잘린 한 줄이면 보고용 글 전체로).
export function snapshotCell(snapshot, org, section = 'org', {marks = null, week = '', records = []} = {}) {
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  const row = rows.find(r => r && r.section === section && String(r.ref_key) === String(org));
  if (!row) return null;
  const textOf = l => {
    const m = marks && week ? markOf(marks, section, String(l.ref_kind || ''), String(l.ref_key || ''), week) : null;
    const short = oneLine(l.text);
    if (m?.report_body != null) {
      const full = reportLine(m.report_body), t = cleanBody(l.text);
      const rec = (Array.isArray(records) ? records : []).find(r => r && r.kind === String(l.ref_kind || '') && r.key === String(l.ref_key || ''));
      if (full && (t === full || t === oneLine(m.report_body) || t === oneLine(full))) return reportText({text: short, full: rec?.full}, m.report_body);
    }
    return short;
  };
  const lines = (Array.isArray(row.lines) ? row.lines : []).filter(l => l && typeof l.text === 'string' && l.text.trim())
    .map(l => ({kind: String(l.ref_kind || ''), key: String(l.ref_key || ''), day: validDay(l.day) ? l.day : '', end_day: validDay(l.end_day) ? l.end_day : null, text: textOf(l), full: String(l.text), id: lineId(l.ref_kind, l.ref_key)}))
    .filter(l => l.text); // 확정 사진에 원문이 통째로 들어간 줄도 표에는 한 줄로(사진 원본은 그대로) — 보고용 글은 예외(위)
  return {lines, seen: new Set((Array.isArray(row.seen_events) ? row.seen_events : []).map(String))};
}
// 사진이 있는 주: 사진 줄 그대로 + '확정 뒤 추가' = 그 주 창 후보(뺀 줄 제외) 중 사진에 없는 것 가운데
// 기록은 created_at > confirmed_at, 일정은 확정 때 후보가 아니었던 것(seen_events에 없음). 사진에 그 조직 칸이 없으면 lines 빈 목록.
export function snapshotView({org, week, snapshot, records = [], events = [], marks = [], order = 'asc'}) {
  const cell = snapshotCell(snapshot, org, 'org', {marks, week, records}) || {lines: [], seen: new Set()};
  const have = new Set(cell.lines.map(l => l.id));
  const at = Date.parse(String(snapshot?.confirmed_at ?? ''));
  const cands = candidates({org, week, records, events}).map(item => lineOf(item, markOf(marks, 'org', item.kind, item.key, week))).filter(l => l.choice !== 'out' && !have.has(l.id));
  const after = cands.filter(l => l.kind === 'event' ? !cell.seen.has(l.key) : Number.isFinite(at) && Date.parse(String(l.created_at ?? '')) > at);
  return {lines: orderLines(cell.lines, order), after: sortBy(after, order)};
}
// 앞 주 표에 보인 줄 id들('지난주' 표시): 앞 주 사진이 있으면 그 줄, 없으면 앞 주 창 결과(보인 줄).
export function shownIds({org, week, snapshot = null, records = [], events = [], marks = []}) {
  const snap = snapshot ? snapshotCell(snapshot, org) : null;
  if (snap) return new Set(snap.lines.map(l => l.id));
  return new Set(orgCell({org, week, records, events, marks}).shown.map(l => l.id));
}

// 줄 글(복사·한글 파일): '- 11.2. 글' / '- 11.2.~12.5. 글'.
export const lineText = l => `- ${[lineDay(l), cleanBody(l.text)].filter(Boolean).join(' ')}`;

// ---- 한글 파일·확정 사진(ORG-기록하나로 O-6, 설계 2-8) ----
// 한글 파일 4. 1)·3. 2)와 확정 사진에 들어가는 줄 = 화면에 보이는 그대로, 날짜 오름차순.
// 창 = 보인 줄, 사진 주 = 사진 줄 + '확정 뒤 추가'(새 판으로 확정하면 정식 줄이 된다, 2-8 규칙 3), 옛 주 = 옛 넣은 줄.
export function fileLines(cell) {
  if (!cell) return [];
  if (cell.mode === 'window') return sortBy(cell.shown || [], 'asc');
  return sortBy([...(cell.lines || []), ...(cell.after || [])], 'asc');
}
// 사진 한 칸: {section, ref_kind:'organization', ref_key:조직 id, label, lines:[{ref_kind, ref_key, day, end_day, text}], seen_events:[일정 id]}.
// seen = 확정 때 그 조직 칸 후보였던 일정 id 전부(보인 줄·접힌 줄·뺀 줄). 화면 읽기(snapshotCell)와 같은 모양.
export function snapshotRow({section = 'org', org, label = '', lines = [], seen = []}) {
  return {
    section: section === 'site' ? 'site' : 'org', ref_kind: 'organization', ref_key: String(org), label: cleanBody(label),
    lines: lines.filter(l => l && l.kind && l.key != null && cleanBody(l.text)).map(l => ({ref_kind: String(l.kind), ref_key: String(l.key), day: !l.none && validDay(l.day) ? l.day : null, end_day: !l.none && validDay(l.end_day) ? l.end_day : null, text: cleanBody(l.text)})),
    seen_events: [...new Set(seen.map(String))],
  };
}
export const SNAPSHOT_MAX_BYTES = 131072; // DB 검사(app_report_snapshots_rows_check)와 같음
// 그 조직 칸 후보 일정 id 전부(뺀 줄 포함).
export const seenEvents = ({org, week, events = []}) => events.filter(e => e && e.kind === 'event' && e.org === String(org) && overlaps(e, orgWindow(week))).map(e => String(e.key));
