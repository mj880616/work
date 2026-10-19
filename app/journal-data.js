// JOURNAL-일지 2단계(업무일지): the only stored part is the day's "오늘 한 줄" — an app_notes row with kind=work, one per day
// (journal_day, app_notes_journal_day_unique), raw_text one line of 1~300 characters, no attachments
// (app_notes_work_line_check). It goes through the existing owner-RLS REST path like the diary rows (diary-data.js).
// The day's materials are never stored: the screen gathers them from the existing reads — basket memos (readBasket),
// Google Calendar events and Google Tasks through their existing Edge calls, and notes by updated_at — and only shows them.
// No browser storage, no new save path, no database change.
import {seoulParts, seoulDateKey, addSeoulDays, seoulClock, formatSeoulTime} from './meeting-time.js';
import {readBasket} from './basket-data.js';

export const WORK_LINE_MAX = 300;
const FIELDS = 'id,journal_day,raw_text,updated_at';
const encode = encodeURIComponent;
const dayKey = /^\d{4}-\d{2}-\d{2}$/;

function workspace(rt) {
  const id = rt.context.read()?.workspace?.id;
  if (!id) throw new Error('업무 공간을 확인할 수 없습니다.');
  return id;
}
export const ownerScope = (rt = window.KPTURuntime) => { const c = rt.context.read(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
export const todayKey = () => seoulDateKey(new Date());
export function checkDay(day) {
  if (typeof day !== 'string' || !dayKey.test(day) || seoulDateKey(day) !== day) throw new Error('날짜를 확인해 주세요.');
  return day;
}
// Weeks run Monday to Sunday in Korea time (the same week as the home screen and the weekly report).
export function weekStart(day) { const weekday = seoulParts(checkDay(day)).weekday; return seoulDateKey(addSeoulDays(day, -((weekday + 6) % 7))); }
export const weekDays = start => Array.from({length:7}, (_, i) => seoulDateKey(addSeoulDays(checkDay(start), i)));
export const shiftWeek = (start, step) => seoulDateKey(addSeoulDays(checkDay(start), step * 7));
const dayStartIso = day => new Date(`${day}T00:00:00+09:00`).toISOString();

// The database checks the same rule (app_notes_work_line_check); this gives the plain message first.
export function validateWorkLine(text) {
  if (typeof text !== 'string') throw new Error('한 줄을 확인해 주세요.');
  if (/[\r\n]/.test(text)) throw Object.assign(new Error('한 줄로 써 주세요. 줄바꿈은 넣을 수 없어요.'), {code:'line_break'});
  const line = text.trim();
  if (!line) throw Object.assign(new Error('한 줄을 입력해 주세요.'), {code:'empty'});
  // PostgreSQL length(text) counts Unicode characters, not UTF-16 code units.
  if ([...line].length > WORK_LINE_MAX) throw Object.assign(new Error(`한 줄은 ${WORK_LINE_MAX}자까지 쓸 수 있어요.`), {code:'too_long'});
  return line;
}
const one = rows => {
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('저장 결과를 확인할 수 없습니다. 접근 권한을 확인해 주세요.');
  return rows[0];
};
const base = rt => `/rest/v1/app_notes?workspace_id=eq.${encode(workspace(rt))}&kind=eq.work`;

export async function readWorkWeek(start, rt = window.KPTURuntime) {
  const days = weekDays(start);
  const rows = await rt.api(`${base(rt)}&journal_day=gte.${days[0]}&journal_day=lte.${days[6]}&select=${FIELDS}&order=journal_day.asc&limit=7`);
  return Array.isArray(rows) ? rows : [];
}
export async function readWorkDay(day, rt = window.KPTURuntime) {
  const rows = await rt.api(`${base(rt)}&journal_day=eq.${checkDay(day)}&select=${FIELDS}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}
function patch(row, raw_text, rt) {
  return rt.api(`${base(rt)}&id=eq.${encode(row.id)}`, {method:'PATCH', prefer:'return=representation', body:{raw_text, updated_at:new Date().toISOString()}});
}
// Writing the same day again edits its line. A day the screen did not know yet (its week read failed, or another
// device wrote it meanwhile) is refused by the unique index with 409; that day's row is then read and edited.
export async function saveWorkLine({day, row = null, text}, rt = window.KPTURuntime) {
  const line = validateWorkLine(text);
  checkDay(day);
  if (row?.id) {
    const rows = await patch(row, line, rt);
    if (Array.isArray(rows) && !rows.length) throw Object.assign(new Error('이 날 한 줄이 그사이 지워졌어요. 다시 불러온 뒤 써 주세요.'), {code:'line_missing'});
    return one(rows);
  }
  try {
    return one(await rt.api('/rest/v1/app_notes', {method:'POST', prefer:'return=representation', body:{workspace_id:workspace(rt), kind:'work', journal_day:day, raw_text:line}}));
  } catch (error) {
    if (error?.status !== 409) throw error;
    const existing = await readWorkDay(day, rt);
    if (!existing) throw error;
    return one(await patch(existing, line, rt));
  }
}

// Materials of one week. Each reader fails on its own; the screen shows the rest and names the group that failed.
export async function readWeekEvents(start, rt = window.KPTURuntime) {
  const days = weekDays(start), end = shiftWeek(start, 1);
  const data = await rt.api(`/functions/v1/google-calendar?action=events&timeMin=${encode(dayStartIso(days[0]))}&timeMax=${encode(dayStartIso(end))}`);
  const events = Array.isArray(data?.events) ? data.events : null;
  if (!events || data?.connected === false || data?.needs_reconnect || data?.authorized === false || (data?.warning && !events.length)) throw new Error('calendar');
  return events;
}
// The google-tasks Edge returns pending tasks and the ones completed in the last 3 days only (RECENT_COMPLETED_MS).
export const DONE_TASK_DAYS = 3;
export async function readDoneTasks(rt = window.KPTURuntime) {
  const data = await rt.api('/functions/v1/google-tasks?action=tasks');
  if (!Array.isArray(data?.tasks) || data?.needs_reconnect || data?.error) throw new Error('tasks');
  return data.tasks.filter(task => task?.status === 'completed' && Number.isFinite(Date.parse(task.completed || '')));
}
export async function readBasketMemos(rt = window.KPTURuntime) {
  return (await readBasket(rt)).notes;
}
export async function readChangedNotes(start, rt = window.KPTURuntime) {
  const from = dayStartIso(weekDays(start)[0]), to = dayStartIso(shiftWeek(start, 1));
  const rows = await rt.api(`/rest/v1/app_notes?workspace_id=eq.${encode(workspace(rt))}&kind=eq.note&updated_at=gte.${encode(from)}&updated_at=lt.${encode(to)}&select=id,title,updated_at&order=updated_at.desc&limit=200`);
  return Array.isArray(rows) ? rows : [];
}

// One day's share of each material, already in display order.
const allDayKey = value => String(value || '').slice(0, 10);
export function eventsOn(events, day) {
  const from = new Date(dayStartIso(day)).getTime(), to = new Date(dayStartIso(seoulDateKey(addSeoulDays(day, 1)))).getTime();
  return (events || []).filter(event => {
    if (!event?.start) return false;
    if (event.allDay) { const s = allDayKey(event.start), e = allDayKey(event.end) || s; return s <= day && (e > day || (e === s && s === day)); }
    const s = Date.parse(event.start), e = Date.parse(event.end || event.start);
    return Number.isFinite(s) && (s >= from && s < to || s < from && e > from);
  }).sort((a, b) => (a.allDay === b.allDay ? String(a.start).localeCompare(String(b.start)) : a.allDay ? -1 : 1));
}
export const eventTime = event => event.allDay ? '종일' : seoulClock(event.start);
export const tasksOn = (tasks, day) => (tasks || []).filter(task => seoulDateKey(task.completed) === day).sort((a, b) => String(a.completed).localeCompare(String(b.completed)));
export const memosOn = (memos, day) => (memos || []).filter(memo => memo?.occurred_at && seoulDateKey(memo.occurred_at) === day).sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
export const notesOn = (notes, day) => (notes || []).filter(note => note?.updated_at && seoulDateKey(note.updated_at) === day);
export function memoLine(memo) {
  const first = String(memo?.raw_text || '').split(/\r?\n/).map(line => line.trim()).find(Boolean);
  if (first) return [...first].length > 80 ? [...first].slice(0, 80).join('') + '…' : first;
  const files = Array.isArray(memo?.attachments) ? memo.attachments.length : 0;
  return files ? `첨부 ${files}개` : '(빈 메모)';
}
export const GROUPS = Object.freeze([
  ['events', '일정'], ['tasks', '끝낸 할 일'], ['memos', '바구니 메모'], ['notes', '고친 노트'],
]);
// The items of one day: [{label, items:[text]}] per group, or failed:true for a group whose read failed.
export function dayMaterials(materials, day) {
  const pick = {
    events: list => eventsOn(list, day).map(event => `${eventTime(event)} ${event.title || '(제목 없음)'}`),
    tasks: list => tasksOn(list, day).map(task => task.title || '(제목 없음)'),
    memos: list => memosOn(list, day).map(memoLine),
    notes: list => notesOn(list, day).map(note => note.title || '(제목 없음)'),
  };
  return GROUPS.map(([key, label]) => {
    const state = materials?.[key];
    if (!state || state.status === 'loading') return {key, label, loading:true, items:[]};
    if (state.status !== 'ok') return {key, label, failed:true, items:[]};
    return {key, label, items:pick[key](state.items)};
  });
}
export const shortDay = day => `${formatSeoulTime(day, {month:'long', day:'numeric'})}(${formatSeoulTime(day, {weekday:'short'})})`;

// [주간보고 초안] (this stage: copy only): the week's seven lines and the materials list as plain text.
export function weeklyDraft({start, lines, materials}) {
  const days = weekDays(start);
  const out = [`주간 업무일지 ${shortDay(days[0])} ~ ${shortDay(days[6])}`, ''];
  for (const day of days) {
    out.push(`■ ${shortDay(day)}`);
    const line = lines?.get?.(day)?.raw_text;
    out.push(`한 줄: ${line || '(없음)'}`);
    for (const group of dayMaterials(materials, day)) for (const item of group.items) out.push(`- ${group.label}: ${item}`);
    out.push('');
  }
  const missing = GROUPS.filter(([key]) => materials?.[key]?.status !== 'ok').map(([, label]) => label);
  if (missing.length) out.push(`※ ${missing.join('·')}은(는) 불러오지 못해 빠졌어요.`);
  out.push(`※ 끝낸 할 일은 Google 할 일에서 최근 ${DONE_TASK_DAYS}일 안에 끝낸 것만 모여요.`);
  return out.join('\n').replace(/\n+$/, '') + '\n';
}
