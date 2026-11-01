// WEEKLY-한흐름확정 ⑤ 남은 부분(요청함 11/01 01:14·01:20·01:24, docs/design/weekly-one-flow.md 6.5절): 손으로 더한 줄 — 화면 없는 부분.
// - 자료: 그 주 주간보고 행(app_weekly_exec_requests, 주마다 1행)의 임시저장 칸 draft.hand {calendar:[줄], notes:[줄]}.
//   2) 주요 일정(draft.hq)·3) 상집 논의(draft.discuss)와 같은 자리·같은 쓰기(weekly-draft-store.js changeWeekDocs)라 DB 모양은 바뀌지 않는다.
//   - calendar: 5. 주요 일정에 손으로 더한 줄 [{id, day, time, title, place}] — 2) 주요 일정 줄과 같은 모양·같은 검사(weekly-schedule-rows.mjs cleanHqRow,
//     달력 일정 키 event 는 두지 않음). 날짜는 그 표의 2주 안 날만 표에 들어간다(밖이면 보이지 않고 남음).
//     화면 표·복사 글·한글 파일 5. 주요 일정 표에 달력 일정과 같은 줄로 들어간다(withHandCalendar). 달력 일정이 아니라서 칸별 고침·기억·빼기 대상이 아니다.
//   - notes: '참고 — 보고서 칸 밖 재료'에 손으로 더한 메모 줄 [{id, text}] — 화면·복사 글에만(한글 파일 칸 밖).
// - 동작 기록: 더하기·고치기·지우기는 같은 쓰기에 draft.picks 항목(kind 'line', 칸 'calendar'·'notes', act add·fix·cut — weekly-draft-store.js withLinePick).
// 브라우저 저장소에 아무것도 두지 않는다. 내용은 업무 글이라 로그에 쓰지 않는다.
import {readHq, withHqRow, withoutHqRow, hqLine} from './weekly-schedule-rows.mjs';
import {newId, formDay} from './weekly-exec-requests.js';

export const HAND_CALENDAR_MAX = 30;
export const HAND_NOTES_MAX = 30;
export const HAND_NOTE_MAX = 200;
export const HAND_PARTS = Object.freeze(['calendar', 'notes']);
// 화면 표의 작은 표시(달력 일정이 아니라 손으로 더한 줄).
export const HAND_TAG = '손';
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const one = s => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
const cut = (s, n) => [...one(s)].slice(0, n).join('');
const makeId = () => newId().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || `h${Date.now().toString(36)}`;

const readCalendar = list => readHq(list).filter(r => r.title).slice(0, HAND_CALENDAR_MAX).map(({event: _e, ...r}) => r);
export function cleanNote(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.id !== 'string' || !ID.test(r.id)) return null;
  const text = cut(r.text, HAND_NOTE_MAX);
  return text ? {id:r.id, text} : null;
}
function readNotes(list) {
  const seen = new Set(), out = [];
  for (const r of Array.isArray(list) ? list : []) { const c = cleanNote(r); if (c && !seen.has(c.id) && out.length < HAND_NOTES_MAX) { seen.add(c.id); out.push(c); } }
  return out;
}
// 서버에서 읽은 값(믿지 않는 입력) → 모양대로만. 둘 다 비면 null(칸을 두지 않음).
export function readHand(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const calendar = readCalendar(raw.calendar), notes = readNotes(raw.notes);
  if (!calendar.length && !notes.length) return null;
  return {...(calendar.length ? {calendar} : {}), ...(notes.length ? {notes} : {})};
}
export const handRows = (hand, part) => (part === 'calendar' ? readCalendar(hand?.calendar) : part === 'notes' ? readNotes(hand?.notes) : []);
const withPart = (hand, part, rows) => readHand({...(readHand(hand) ?? {}), [part]:rows});

// 줄 더하기·바꾸기(순수). 반환 {hand, row, before} — 비었거나 넘치면 null. before = 고치기 전 줄(고치기일 때).
export function withHandRow(hand, part, row) {
  if (!HAND_PARTS.includes(part)) return null;
  const rows = handRows(hand, part), id = row?.id && ID.test(row.id) ? row.id : makeId(), before = rows.find(r => r.id === id) ?? null;
  if (!before && rows.length >= (part === 'calendar' ? HAND_CALENDAR_MAX : HAND_NOTES_MAX)) return null;
  if (part === 'calendar') {
    const next = withHqRow(rows, {id, day:row.day, time:row.time, title:row.title, place:row.place});
    const c = next?.find(r => r.id === id);
    if (!c?.title) return null;
    return {hand:withPart(hand, part, next), row:c, before};
  }
  const c = cleanNote({id, text:row?.text});
  if (!c) return null;
  return {hand:withPart(hand, part, before ? rows.map(r => (r.id === id ? c : r)) : [...rows, c]), row:c, before};
}
export function withoutHandRow(hand, part, id) {
  const rows = handRows(hand, part), row = rows.find(r => r.id === id) ?? null;
  if (!row) return null;
  return {hand:withPart(hand, part, part === 'calendar' ? withoutHqRow(rows, id) : rows.filter(r => r.id !== id)), row};
}
// 동작 기록에 남길 줄 글(한글 파일·복사와 같은 모양).
export const handText = (part, row) => (!row ? '' : part === 'calendar' ? hqLine(row).replace(/^-\s*/, '') : row.text);
export const handKey = id => `hand:${id}`;
export const handId = key => (String(key ?? '').startsWith('hand:') ? String(key).slice(5) : '');

// 5. 주요 일정 표(journal-weekly.js upcomingSchedule 모양)에 손으로 더한 줄을 그날 줄에 넣는다. 그날 하루 일정 줄 안에서 시간 순(종일 먼저, 시간 없는 줄 끝).
// 2주 밖 날짜·날짜 없는 줄은 넣지 않는다. rows·allRows 둘 다. 달력을 아직 못 읽었으면(읽는 중·실패) 그대로.
const order = t => (t === '종일' ? '' : t || '99');
export function withHandCalendar(calendar, rows, whatOf) {
  const list = readCalendar(rows);
  if (!calendar || calendar.loading || calendar.failed?.length || !list.length) return calendar;
  const days = new Set(calendar.days ?? []);
  const put = base => {
    const out = (base ?? []).map(r => ({...r, items:[...r.items]}));
    for (const h of list) {
      if (!days.has(h.day)) continue;
      const item = {what:whatOf(h), multi:false, key:handKey(h.id), time:h.time, title:h.title, place:h.place, hand:h.id};
      let row = out.find(r => r.day === h.day && !r.items[0]?.multi);
      if (!row) { row = {day:h.day, label:formDay(h.day), items:[]}; out.push(row); }
      row.items.push(item);
    }
    for (const r of out) if (r.items.some(i => i.hand)) r.items = r.items.map((i, n) => [i, n]).sort((a, b) => order(a[0].time).localeCompare(order(b[0].time)) || a[1] - b[1]).map(([i]) => i);
    return out.sort((a, b) => a.day.localeCompare(b.day) || (a.items[0]?.multi ? 1 : 0) - (b.items[0]?.multi ? 1 : 0));
  };
  return {...calendar, rows:put(calendar.rows), ...(calendar.allRows ? {allRows:put(calendar.allRows)} : {}), handCount:list.filter(h => days.has(h.day)).length};
}
