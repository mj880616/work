// JOURNAL-일지 2단계(업무일지): the only stored part is the day's "오늘 한 줄" list — an app_notes row with kind=work, one per
// day (journal_day, app_notes_journal_day_unique), no attachments. JOURNAL-오늘한줄목록: raw_text holds the day's lines in
// saving order, joined by one "\n" (1~50 lines, each 1~300 characters, no empty line — app_notes_work_line_check after
// 20261020051027_journal_work_lines; before it the database takes one line only). A day that had one line keeps it as line 1.
// It goes through the existing owner-RLS REST path like the diary rows (diary-data.js); every edit of a known row is guarded
// by its updated_at, so two devices never overwrite each other's lines silently.
// The day's materials are never stored: the screen gathers them from the existing reads — basket memos (readBasket),
// Google Calendar events and Google Tasks through their existing Edge calls, and notes by updated_at — and only shows them.
// No browser storage, no new save path.
import {seoulParts, seoulDateKey, addSeoulDays, seoulClock, formatSeoulTime} from './meeting-time.js';
import {readBasket} from './basket-data.js';

export const WORK_LINE_MAX = 300;
export const WORK_LINES_PER_DAY = 50;
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

// The database checks the same rule per line (app_notes_work_line_check); this gives the plain message first.
export function validateWorkLine(text) {
  if (typeof text !== 'string') throw new Error('한 줄을 확인해 주세요.');
  if (/[\r\n]/.test(text)) throw Object.assign(new Error('한 줄로 써 주세요. 줄바꿈은 넣을 수 없어요.'), {code:'line_break'});
  const line = text.trim();
  if (!line) throw Object.assign(new Error('한 줄을 입력해 주세요.'), {code:'empty'});
  // PostgreSQL counts Unicode characters, not UTF-16 code units.
  if ([...line].length > WORK_LINE_MAX) throw Object.assign(new Error(`한 줄은 ${WORK_LINE_MAX}자까지 쓸 수 있어요.`), {code:'too_long'});
  return line;
}
// The day's lines in saving order (oldest first). A row written before the list keeps its one line as line 1.
export const workLines = row => String(row?.raw_text ?? '').split('\n').map(line => line.trim()).filter(Boolean);
export function joinWorkLines(lines) {
  if (lines.length > WORK_LINES_PER_DAY) throw Object.assign(new Error(`하루에 ${WORK_LINES_PER_DAY}줄까지 쓸 수 있어요.`), {code:'too_many'});
  return lines.map(validateWorkLine).join('\n');
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
// Line changes. Each takes the day's current lines and returns the new ones; a line is found again by its text when
// another device moved it, and a line that is gone is reported instead of guessed.
function locate(lines, index, before) {
  if (lines[index] === before) return index;
  const found = lines.indexOf(before);
  if (found < 0) throw Object.assign(new Error('이 줄이 그사이 바뀌거나 지워졌어요. 다시 불러온 목록에서 확인해 주세요.'), {code:'line_missing'});
  return found;
}
export const addLine = text => lines => [...lines, validateWorkLine(text)];
export const editLine = (index, before, text) => lines => { const next = [...lines]; next[locate(lines, index, before)] = validateWorkLine(text); return next; };
export const removeLine = (index, before) => lines => { const next = [...lines]; next.splice(locate(lines, index, before), 1); return next; };
export const restoreLine = (index, text) => lines => { const next = [...lines]; next.splice(Math.min(index, next.length), 0, validateWorkLine(text)); return next; };

// One change of one day. Returns {row} — the saved row, or null when the day has no line left (its row is deleted).
// A new day that another device wrote meanwhile (409), or a known row that changed (no row back from the guarded
// write), is read again and the same change is applied once more on its current lines.
export async function changeWorkDay({day, row = null, change}, rt = window.KPTURuntime) {
  checkDay(day);
  let current = row;
  for (let attempt = 0; attempt < 2; attempt++) {
    const next = change(workLines(current));
    const raw_text = next.length ? joinWorkLines(next) : '';
    try {
      if (!current) {
        if (!next.length) return {row:null};
        return {row:one(await rt.api('/rest/v1/app_notes', {method:'POST', prefer:'return=representation', body:{workspace_id:workspace(rt), kind:'work', journal_day:day, raw_text}}))};
      }
      const path = `${base(rt)}&id=eq.${encode(current.id)}&updated_at=eq.${encode(current.updated_at)}`;
      const rows = next.length
        ? await rt.api(path, {method:'PATCH', prefer:'return=representation', body:{raw_text, updated_at:new Date().toISOString()}})
        : await rt.api(path, {method:'DELETE', prefer:'return=representation'});
      if (Array.isArray(rows) && rows.length) return {row:next.length ? one(rows) : null};
    } catch (error) {
      // Before 20261020051027 the database takes one line a day only (app_notes_work_line_check).
      if (error?.status === 400 && next.length > 1) throw Object.assign(new Error('두 번째 줄부터는 서버 준비가 끝난 뒤 저장할 수 있어요. 지금은 하루 한 줄만 저장돼요.'), {code:'lines_not_ready'});
      if (current || error?.status !== 409) throw error;
    }
    current = await readWorkDay(day, rt);
  }
  throw Object.assign(new Error('다른 기기에서 이 날 기록이 계속 바뀌고 있어요. 다시 불러온 목록에서 확인해 주세요.'), {code:'day_changed', row:current});
}

// Materials of one week. Each reader fails on its own; the screen shows the rest and names the group that failed.
export async function readWeekEvents(start, rt = window.KPTURuntime) {
  const days = weekDays(start), end = shiftWeek(start, 1);
  const data = await rt.api(`/functions/v1/google-calendar?action=events&timeMin=${encode(dayStartIso(days[0]))}&timeMax=${encode(dayStartIso(end))}`);
  const events = Array.isArray(data?.events) ? data.events : null;
  if (!events || data?.connected === false || data?.needs_reconnect || data?.authorized === false || (data?.warning && !events.length)) throw new Error('calendar');
  return events;
}
// JOURNAL-끝낸할일범위: the google-tasks Edge returns the tasks completed in the last `completed_days` days (whole number
// 1..8, capped by the server). An older Edge ignores the field and answers the last 3 days without echoing it, so the days
// actually covered are the echoed number or, without an echo, DONE_TASK_DAYS (3).
export const DONE_TASK_DAYS = 3;
export const DONE_TASK_DAYS_MAX = 8;
export async function readDoneTasksWindow(rt = window.KPTURuntime, ask = DONE_TASK_DAYS_MAX) {
  const data = await rt.api(`/functions/v1/google-tasks?action=tasks&completed_days=${ask}`);
  if (!Array.isArray(data?.tasks) || data?.needs_reconnect || data?.error) throw new Error('tasks');
  const echoed = Number(data.completed_days);
  const days = Number.isInteger(echoed) && echoed >= 1 && echoed <= DONE_TASK_DAYS_MAX ? echoed : DONE_TASK_DAYS;
  return {days, tasks:data.tasks.filter(task => task?.status === 'completed' && Number.isFinite(Date.parse(task.completed || '')))};
}
export const readDoneTasks = async (rt = window.KPTURuntime) => (await readDoneTasksWindow(rt)).tasks;
// The first day (Korea time) that the covered days reach completely; earlier days may be missing tasks.
export const doneCoverFrom = (days = DONE_TASK_DAYS, today = todayKey()) => seoulDateKey(addSeoulDays(today, -((days || DONE_TASK_DAYS) - 1)));
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
  return files ? `첨부 ${files}개` : '(빈 업데이트)';
}
export const GROUPS = Object.freeze([
  ['events', '일정'], ['tasks', '끝낸 할 일'], ['memos', '바구니 업데이트'], ['notes', '고친 노트'],
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

// [주간보고 초안] (this stage: copy only): each day's lines in saving order (one "한 줄:" row each) and the materials list.
export function weeklyDraft({start, lines, materials, doneDays = DONE_TASK_DAYS, today = todayKey()}) {
  const days = weekDays(start);
  const out = [`주간 업무일지 ${shortDay(days[0])} ~ ${shortDay(days[6])}`, ''];
  for (const day of days) {
    out.push(`■ ${shortDay(day)}`);
    const list = workLines(lines?.get?.(day));
    if (list.length) for (const line of list) out.push(`한 줄: ${line}`);
    else out.push('한 줄: (없음)');
    for (const group of dayMaterials(materials, day)) for (const item of group.items) out.push(`- ${group.label}: ${item}`);
    out.push('');
  }
  const missing = GROUPS.filter(([key]) => materials?.[key]?.status !== 'ok').map(([, label]) => label);
  if (missing.length) out.push(`※ ${missing.join('·')}은(는) 불러오지 못해 빠졌어요.`);
  if (days[0] < doneCoverFrom(doneDays, today)) out.push(`※ 끝낸 할 일은 Google 할 일에서 최근 ${doneDays}일 안에 끝낸 것만 모여요.`);
  return out.join('\n').replace(/\n+$/, '') + '\n';
}
