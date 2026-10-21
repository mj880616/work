// JOURNAL-일지 2단계(업무일지): the only stored part is the day's "오늘 한 줄" list — an app_notes row with kind=work, one per
// day (journal_day, app_notes_journal_day_unique), no attachments. JOURNAL-오늘한줄목록: raw_text holds the day's lines in
// saving order, joined by one "\n" (1~50 lines, each 1~300 characters, no empty line — app_notes_work_line_check after
// 20261020051027_journal_work_lines; before it the database takes one line only). A day that had one line keeps it as line 1.
// It goes through the existing owner-RLS REST path like the diary rows (diary-data.js); every edit of a known row is guarded
// by its updated_at, so two devices never overwrite each other's lines silently.
// The day's materials are never stored: the screen gathers them from the existing owner-RLS reads and only shows them.
// JOURNAL-일지카드정리: the four groups under the lines are 일정 (Google Calendar), 끝낸 할 일 (Google Tasks), 조직 소식 (that
// day's updates by organization) and 회의·행사 결과 (that day's meetings). An "update" is saved in one of three places
// (update-places.js): a basket row (app_notes kind=basket), an organization record (app_suborganization_updates) or a project
// progress record (app_project_progress_updates). No browser storage, no new save path.
// JOURNAL-주간보고허브 1단계 (docs/design/weekly-report-hub.md 4절): four more groups after those — 프로젝트 소식 (project
// records and basket updates sent to a project, by project name; they left 조직 소식's '미분류' so the day card follows the
// weekly report's 사업 요약 ② / 산하 조직 현황 ④ split), 할 일 예정 (pending Google tasks by due date, in the server's
// default range: overdue and up to 6 days ahead), 자료실 새 자료 (documents added that day, with their category) and
// 공유 페이지 (share pages changed that day). Every read is limited to the week, a few columns and a row cap; no long body
// (meeting text, document text, share page blocks) is read.
import {seoulParts, seoulDateKey, addSeoulDays, seoulClock, formatSeoulTime} from './meeting-time.js';
import {readBasket, filedOrganizations, filedProjects} from './basket-data.js';
import {categoryOf} from './document-categories.js';
import {myOrganizationIds, OTHERS} from './my-organizations.js';
import {noteRequests} from './update-requests.js';
import {noteJournalAt, MOVED_KEY} from './update-journal.js';

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
// Google Calendar events from the first day (Korea time) up to, not including, the end day — the same google-calendar read
// as the calendar screen (owner's selected calendars). One read per range.
async function readEventsBetween(first, end, rt) {
  const data = await rt.api(`/functions/v1/google-calendar?action=events&timeMin=${encode(dayStartIso(checkDay(first)))}&timeMax=${encode(dayStartIso(checkDay(end)))}`);
  const events = Array.isArray(data?.events) ? data.events : null;
  if (!events || data?.connected === false || data?.needs_reconnect || data?.authorized === false || (data?.warning && !events.length)) throw new Error('calendar');
  return events;
}
export const readWeekEvents = (start, rt = window.KPTURuntime) => readEventsBetween(weekDays(start)[0], shiftWeek(start, 1), rt);
// WEEKLY-주요일정 (2026-10-21 사용자 결정): the weekly report's "5. 주요 일정" is the two weeks (Monday to Sunday, twice) from the
// Monday after the shown week — the report is written at the end of the week (Friday), gathered on Sunday and reported on
// Monday, so it is "the reported week and the week after". The shown week, not today, sets it, so a past week stays the same.
export const SCHEDULE_WEEKS = 2;
export const scheduleDays = start => Array.from({length:SCHEDULE_WEEKS * 7}, (_, i) => seoulDateKey(addSeoulDays(shiftWeek(start, 1), i)));
export const readScheduleEvents = (start, rt = window.KPTURuntime) => readEventsBetween(shiftWeek(start, 1), shiftWeek(start, 1 + SCHEDULE_WEEKS), rt);
// JOURNAL-끝낸할일범위: the google-tasks Edge returns the tasks completed in the last `completed_days` days (whole number
// 1..8, capped by the server). An older Edge ignores the field and answers the last 3 days without echoing it, so the days
// actually covered are the echoed number or, without an echo, DONE_TASK_DAYS (3).
export const DONE_TASK_DAYS = 3;
export const DONE_TASK_DAYS_MAX = 8;
// The same answer also holds the pending tasks in the server's default range (overdue, and due up to 6 days ahead in Korea
// time — google-tasks pendingDueWindow; undated ones are not sent): 할 일 예정 uses them, so one read feeds both groups.
export async function readDoneTasksWindow(rt = window.KPTURuntime, ask = DONE_TASK_DAYS_MAX) {
  const data = await rt.api(`/functions/v1/google-tasks?action=tasks&completed_days=${ask}`);
  if (!Array.isArray(data?.tasks) || data?.needs_reconnect || data?.error) throw new Error('tasks');
  const echoed = Number(data.completed_days);
  const days = Number.isInteger(echoed) && echoed >= 1 && echoed <= DONE_TASK_DAYS_MAX ? echoed : DONE_TASK_DAYS;
  return {days, tasks:data.tasks.filter(isDone), pending:data.tasks.filter(task => task?.status !== 'completed' && !!dueDay(task))};
}
const isDone = task => task?.status === 'completed' && Number.isFinite(Date.parse(task.completed || ''));
// Google keeps a due date as midnight UTC of that date, so its day is the date part as written.
export const dueDay = task => { const key = String(task?.due || '').slice(0, 10); return dayKey.test(key) ? key : ''; };
// The last day whose pending tasks the server sends (today + 6, Korea time).
export const PENDING_DAYS = 7;
export const pendingCoverTo = (today = todayKey()) => seoulDateKey(addSeoulDays(today, PENDING_DAYS - 1));
export const readDoneTasks = async (rt = window.KPTURuntime) => (await readDoneTasksWindow(rt)).tasks;
// The first day (Korea time) that the covered days reach completely; earlier days may be missing tasks.
export const doneCoverFrom = (days = DONE_TASK_DAYS, today = todayKey()) => seoulDateKey(addSeoulDays(today, -((days || DONE_TASK_DAYS) - 1)));
// Basket updates with what shows where they went: confirmed record links (organization/project names) and [자료로 넣기]
// documents (basket-data.js readBasket, the same read as the basket screen; all rows of kind=basket, any state, paged).
export async function readBasketUpdates(rt = window.KPTURuntime) {
  const {notes, links, docs} = await readBasket(rt);
  return {notes, links, docs};
}
// A note that was moved here from the basket ([노트로 옮기기]) carries metadata.moved_from_update_at (basket-data.js moveToNote).
// Only those notes are read, and only id, title, the update's day (occurred_at) and that mark: never the text (raw_text) or the
// other metadata. A failed read hides just these lines; the rest of the journal is unaffected.
export async function readMovedNotes(rt = window.KPTURuntime) {
  return pages(`/rest/v1/app_notes?workspace_id=eq.${encode(workspace(rt))}&kind=eq.note&metadata->>${MOVED_KEY}=not.is.null&select=id,title,occurred_at,moved_at:metadata->>${MOVED_KEY}&order=occurred_at.asc,id.asc`, rt);
}
const PAGE = 100;
async function pages(path, rt) {
  const rows = [];
  for (let offset = 0;; offset += PAGE) {
    const page = await rt.api(`${path}&limit=${PAGE}&offset=${offset}`);
    if (!Array.isArray(page)) throw new Error('read');
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}
const inList = ids => `in.(${ids.map(encode).join(',')})`;
const chunks = list => Array.from({length:Math.ceil(list.length / PAGE)}, (_, i) => list.slice(i * PAGE, (i + 1) * PAGE));
// Organization records of the week (Korea time), only for this workspace's organizations, each with its organization's name.
// ORG-담당13기준: the list also carries `mine`, the ids of my organizations (my-organizations.js: my assignment rows crossed
// with active organizations; none or a failed assignment read → every active one). 조직 소식 keeps the others under "그 외".
export async function readOrgUpdates(start, rt = window.KPTURuntime) {
  const from = dayStartIso(weekDays(start)[0]), to = dayStartIso(shiftWeek(start, 1)), user = rt.context.read()?.user?.id;
  const [orgs, assignees] = await Promise.all([
    pages(`/rest/v1/app_suborganizations?workspace_id=eq.${encode(workspace(rt))}&select=id,name,active&order=id.asc`, rt),
    user ? pages(`/rest/v1/app_suborganization_assignees?user_id=eq.${encode(user)}&select=organization_id&order=organization_id.asc`, rt).catch(() => []) : [],
  ]);
  const names = new Map(orgs.map(org => [org.id, org.name || '']));
  const rows = [];
  for (const ids of chunks([...names.keys()]))
    rows.push(...await pages(`/rest/v1/app_suborganization_updates?organization_id=${inList(ids)}&occurred_at=gte.${encode(from)}&occurred_at=lt.${encode(to)}&select=id,organization_id,occurred_at,raw_text,detail_text&order=occurred_at.asc,id.asc`, rt));
  return Object.assign(rows.filter(row => names.has(row.organization_id)).map(row => ({...row, organization:{name:names.get(row.organization_id)}})),
    {mine:myOrganizationIds(orgs, assignees)});
}
// Project progress records of the week by their day (effective_on), only for this workspace's projects, with the project's name.
export async function readProjectUpdates(start, rt = window.KPTURuntime) {
  const days = weekDays(start);
  const rows = await pages(`/rest/v1/app_project_progress_updates?effective_on=gte.${days[0]}&effective_on=lte.${days[6]}&select=id,project_id,summary,effective_on,created_at&order=effective_on.asc,created_at.asc,id.asc`, rt);
  const names = new Map();
  for (const ids of chunks([...new Set(rows.map(row => row.project_id).filter(Boolean))]))
    for (const project of await pages(`/rest/v1/app_spaces?workspace_id=eq.${encode(workspace(rt))}&id=${inList(ids)}&select=id,name&order=id.asc`, rt)) names.set(project.id, project.name || '');
  return rows.filter(row => names.has(row.project_id)).map(row => ({...row, project:{name:names.get(row.project_id)}}));
}
// Meetings of the week by their date (meeting_at, the date the meeting list shows) in this workspace.
export async function readWeekMeetings(start, rt = window.KPTURuntime) {
  const from = dayStartIso(weekDays(start)[0]), to = dayStartIso(shiftWeek(start, 1));
  return pages(`/rest/v1/app_meetings?workspace_id=eq.${encode(workspace(rt))}&meeting_at=gte.${encode(from)}&meeting_at=lt.${encode(to)}&select=id,title,series_name,round_no,meeting_at&order=meeting_at.asc,id.asc`, rt);
}

// 자료실 새 자료: documents of this workspace added (created_at) in the week — the day they were put in the library, not the
// document's own date (an old document would land on an old day). Title, file name, category and links only; capped.
export const WEEK_READ_CAP = 300;
const capped = rows => { if (!Array.isArray(rows)) throw new Error('read'); return Object.assign(rows, {capped:rows.length >= WEEK_READ_CAP}); };
export async function readWeekDocuments(start, rt = window.KPTURuntime) {
  const from = dayStartIso(weekDays(start)[0]), to = dayStartIso(shiftWeek(start, 1));
  return capped(await rt.api(`/rest/v1/app_documents?workspace_id=eq.${encode(workspace(rt))}&created_at=gte.${encode(from)}&created_at=lt.${encode(to)}&select=id,title,file_name,category,meeting_id,created_at&order=created_at.asc,id.asc&limit=${WEEK_READ_CAP}`));
}
// 공유 페이지: share pages of this workspace changed (updated_at) in the week. Title and state only, never the blocks.
export async function readWeekSharePages(start, rt = window.KPTURuntime) {
  const from = dayStartIso(weekDays(start)[0]), to = dayStartIso(shiftWeek(start, 1));
  return capped(await rt.api(`/rest/v1/app_share_pages?workspace_id=eq.${encode(workspace(rt))}&updated_at=gte.${encode(from)}&updated_at=lt.${encode(to)}&select=id,title,status,updated_at&order=updated_at.asc,id.asc&limit=${WEEK_READ_CAP}`));
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
export const tasksOn = (tasks, day) => (tasks || []).filter(task => isDone(task) && seoulDateKey(task.completed) === day).sort((a, b) => String(a.completed).localeCompare(String(b.completed)));
const onDay = (value, day) => !!value && Number.isFinite(Date.parse(value)) && seoulDateKey(value) === day;
const byTime = (a, b) => Date.parse(a) - Date.parse(b);
export const memosOn = (memos, day) => (memos || []).filter(memo => onDay(memo?.occurred_at, day)).sort((a, b) => byTime(a.occurred_at, b.occurred_at));
// One update is one item: its first non-empty line (cut at 80 characters), never one item per line.
const SHORT = 80;
export function firstLine(text) {
  const first = String(text ?? '').split(/\r\n|\r|\n|\u2028|\u2029/).map(line => line.trim()).find(Boolean);
  if (!first) return '';
  return [...first].length > SHORT ? [...first].slice(0, SHORT).join('') + '…' : first;
}
export function memoLine(memo) {
  const first = firstLine(memo?.raw_text);
  if (first) return first;
  const files = Array.isArray(memo?.attachments) ? memo.attachments : [];
  if (!files.length) return '(빈 업데이트)';
  const name = String(files[0]?.file_name || '').trim();
  return name ? (files.length > 1 ? `첨부: ${name} 외 ${files.length - 1}개` : `첨부: ${name}`) : `첨부 ${files.length}개`;
}
export const UNSORTED = '미분류';
export {OTHERS};
// '그 외' (records of organizations that are not mine) comes after the named sections, '미분류' last.
const tail = name => name === UNSORTED ? 2 : name === OTHERS ? 1 : 0;
// JOURNAL-요청표시: a section whose items include a marked update also has `tags`, one list of request keys per item
// (update-requests.js), so the card can put the same small tags before those items. Without a mark there is no `tags`.
// ORG-묶음순서: 조직 소식 sections follow the app's one organization order (organization-order.js, window.KPTUOrganizationOrder:
// 철도 → 지하철 → 민자철도 → 민간도시철도 → 그 외 조직, the order of the picker and the lists). Names it does not know, and the
// whole list when that module is not loaded, stay 가나다순. Project sections have no such order (byName).
const orgCompare = (a, b) => {
  const order = globalThis.window?.KPTUOrganizationOrder;
  return typeof order?.compare === 'function' ? order.compare({name:a}, {name:b}) : a.localeCompare(b, 'ko');
};
const byName = (a, b) => a.localeCompare(b, 'ko');
// The order of 조직 소식 sections (named organizations in the app's order, then '그 외', then '미분류'); [주간 정리] uses it too.
export const compareOrgSections = (a, b) => tail(a.name) - tail(b.name) || orgCompare(a.name, b.name);
const sectionsOf = (entries, compare = byName) => {
  const sections = new Map();
  for (const entry of entries.sort((a, b) => byTime(a.at, b.at) || 0)) {
    if (!sections.has(entry.name)) sections.set(entry.name, {items:[], tags:[]});
    sections.get(entry.name).items.push(entry.text);
    sections.get(entry.name).tags.push(entry.requests || []);
  }
  return [...sections].map(([name, {items, tags}]) => tags.some(list => list.length) ? {name, items, tags} : {name, items})
    .sort((a, b) => tail(a.name) - tail(b.name) || compare(a.name, b.name));
};
// Where each basket update of the day went: {orgs:[{name, text}], projects:[name], line, at}.
function basketPlaces(basket, day) {
  const links = basket?.links || [], docs = basket?.docs || [];
  return memosOn(basket?.notes, day).map(memo => {
    const confirmed = links.filter(link => link.note_id === memo.id && link.status === 'confirmed');
    const orgs = new Map(), projects = [];
    for (const link of confirmed) {
      if (link.organization_id && !orgs.has(link.organization_id)) orgs.set(link.organization_id, {id:link.organization_id, name:link.organization?.name || '조직', summary:firstLine(link.summary)});
      else if (link.project_id && !link.organization_id && link.project?.name) projects.push({id:link.project_id, name:link.project.name, summary:firstLine(link.summary)});
    }
    for (const org of filedOrganizations(memo, docs)) if (!orgs.has(org.organization_id)) orgs.set(org.organization_id, {id:org.organization_id, name:org.name, summary:''});
    for (const project of filedProjects(memo, docs)) if (!projects.some(p => p.name === project.name)) projects.push({id:project.project_id, name:project.name, summary:''});
    return {memo, orgs:[...orgs.values()], projects, line:memoLine(memo), requests:noteRequests(memo), journal:!!noteJournalAt(memo)};
  });
}
// 조직 소식 of one day: [{name, items:[text]}] — one section per organization (by name), '미분류' last.
// A basket update goes under each organization it was sent to (a confirmed link, or its files filed as that organization's
// documents); the link's summary is shown when there is one. One sent to no organization and no project is '미분류'
// unless it is kept as a work-journal memo (기타 메모, journalMemosOn).
// An organization record goes under its organization. Project records and updates sent only to a project are 프로젝트 소식.
// ORG-담당13기준: when the organization read gave my organizations (orgUpdates.mine), only those get their own section; an
// update of any other organization goes under one '그 외' section as "조직 이름 · 내용", so it is still there. Without that
// read (it failed) every organization keeps its own section as before.
export function orgNewsOn({basket, orgUpdates} = {}, day) {
  const entries = [], mine = orgUpdates?.mine instanceof Set ? orgUpdates.mine : null;
  const add = (id, name, at, text, requests) => {
    const label = String(name || '').trim();
    if (id && mine && !mine.has(id)) entries.push({name:OTHERS, at, text:`${label || '조직'} · ${text}`, requests});
    else entries.push({name: label || UNSORTED, at, text, requests});
  };
  for (const {memo, orgs, projects, line, requests, journal} of basketPlaces(basket, day)) {
    if (orgs.length) for (const org of orgs) add(org.id, org.name, memo.occurred_at, org.summary || line, requests);
    else if (!projects.length && !journal) add(null, UNSORTED, memo.occurred_at, line, requests);
  }
  for (const row of orgUpdates || []) if (onDay(row?.occurred_at, day)) add(row.organization_id, row.organization?.name, row.occurred_at, firstLine(row.raw_text) || firstLine(row.detail_text) || '(빈 업데이트)');
  return sectionsOf(entries, orgCompare);
}
// 프로젝트 소식 of one day: [{name, items:[text]}] — one section per project (by name). A project progress record goes under
// its project on its day (effective_on); a basket update sent to a project and to no organization goes under each such
// project (an update sent to an organization stays in 조직 소식 only, so nothing shows twice).
// The same records one by one with their project id: [{id, name, at, text, requests}] ([주간 정리] places them in the project tree).
export function projectRecordsOn({basket, projectUpdates} = {}, day) {
  const entries = [];
  const add = (id, name, at, text, requests) => entries.push({id: id || null, name: String(name || '').trim() || UNSORTED, at, text, requests});
  for (const {memo, orgs, projects, line, requests} of basketPlaces(basket, day))
    if (!orgs.length) for (const project of projects) add(project.id, project.name, memo.occurred_at, project.summary || line, requests);
  for (const row of projectUpdates || []) if (row?.effective_on === day)
    add(row.project_id, row.project?.name, row.created_at || `${day}T23:59:59+09:00`, firstLine(row.summary) || '(빈 업데이트)');
  return entries;
}
export const projectNewsOn = (read = {}, day) => sectionsOf(projectRecordsOn(read, day));
// BASKET-일지로남기기: 기타 메모 of one day — the day's updates kept as work-journal memos ([업무일지에 남기기], metadata.journal_at)
// that went to no organization and no project, oldest first, one item each (its first line, as the other update groups).
// They leave 조직 소식's '미분류'; an update linked to an organization or a project later shows there instead, never twice.
export const journalMemosOn = (basket, day) => basketPlaces(basket, day)
  .filter(({orgs, projects, journal}) => journal && !orgs.length && !projects.length).map(({line}) => line);
// Moved notes of one day (the day the update sat on: occurred_at, Korea time, as memosOn): [{id, line}] oldest first, line =
// "노트: (title)" cut like the other update lines. A row without the mark is not shown. Not part of GROUPS, so the weekly draft
// does not carry it (a note is not weekly-report material).
export const movedNotesOn = (notes, day) => (notes || [])
  .filter(note => note?.id && typeof note.moved_at === 'string' && onDay(note.occurred_at, day))
  .sort((a, b) => byTime(a.occurred_at, b.occurred_at) || String(a.id).localeCompare(String(b.id)))
  .map(note => ({id:note.id, line:`노트: ${firstLine(note.title) || '(제목 없음)'}`}));
// 회의·행사 결과 of one day: every meeting row of this workspace whose meeting_at falls on that day (Korea time). Press
// conferences and forums are meeting rows too (their series name says so), so no kind is filtered out.
export const meetingsOn = (meetings, day) => (meetings || []).filter(meeting => onDay(meeting?.meeting_at, day)).sort((a, b) => byTime(a.meeting_at, b.meeting_at));
export function meetingLine(meeting) {
  const name = String(meeting?.series_name || meeting?.title || '').trim() || '회의';
  const round = Number(meeting?.round_no), clock = seoulClock(meeting.meeting_at);
  return `${clock && clock !== '00:00' ? clock + ' ' : ''}${name}${meeting?.round_no != null && meeting.round_no !== '' && Number.isFinite(round) ? ` ${round}차` : ''}`;
}
export const pendingOn = (tasks, day) => (tasks || []).filter(task => task?.status !== 'completed' && dueDay(task) === day)
  .sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ko'));
export const documentLine = doc => `[${categoryOf(doc?.category)}] ${String(doc?.title || doc?.file_name || '').trim() || '(제목 없음)'}${doc?.meeting_id ? ' · 회의자료' : ''}`;
export const sharePageLine = page => `${String(page?.title || '').trim() || '제목 없음'} · ${page?.status === 'published' ? '게시' : '초안'}`;
export const GROUPS = Object.freeze([
  ['events', '일정'], ['tasks', '끝낸 할 일'], ['orgs', '조직 소식'], ['meetings', '회의·행사 결과'],
  ['projects', '프로젝트 소식'], ['due', '할 일 예정'], ['docs', '자료실 새 자료'], ['shares', '공유 페이지'], ['memos', '기타 메모'],
]);
// The reads behind each group (journal.js reads each on its own; a group shows what it could read). One Google Tasks read
// feeds both 끝낸 할 일 and 할 일 예정; the basket read feeds both 조직 소식 and 프로젝트 소식.
export const GROUP_SOURCES = Object.freeze({events:['events'], tasks:['tasks'], orgs:['basket', 'orgUpdates'], meetings:['meetings'],
  projects:['basket', 'projectUpdates'], due:['tasks'], docs:['documents'], shares:['sharePages'], memos:['basket']});
const SECTIONED = new Set(['orgs', 'projects']);
// The items of one day: {key, label, items:[text]} per group (조직 소식·프로젝트 소식 also have sections:[{name, items}]),
// loading:true while a read is out, failed:[source keys] for reads that failed (a sectioned group still shows what its other
// read gave), capped:true when the week had more rows than one read takes (WEEK_READ_CAP).
export function dayMaterials(materials, day) {
  return GROUPS.map(([key, label]) => {
    const sources = GROUP_SOURCES[key], states = sources.map(source => materials?.[source]);
    if (states.some(state => !state || state.status === 'loading')) return {key, label, loading:true, items:[], sections:[]};
    const failed = sources.filter((_, i) => states[i].status !== 'ok');
    const ok = source => materials[source].status === 'ok' ? materials[source].items : null;
    let items = [], sections = [];
    if (key === 'events' && !failed.length) items = eventsOn(ok('events'), day).map(event => `${eventTime(event)} ${event.title || '(제목 없음)'}`);
    if (key === 'tasks' && !failed.length) items = tasksOn(ok('tasks'), day).map(task => task.title || '(제목 없음)');
    if (key === 'meetings' && !failed.length) items = meetingsOn(ok('meetings'), day).map(meetingLine);
    if (key === 'due' && !failed.length) items = pendingOn(ok('tasks'), day).map(task => task.title || '(제목 없음)');
    if (key === 'docs' && !failed.length) items = (ok('documents') || []).filter(doc => onDay(doc?.created_at, day)).map(documentLine);
    if (key === 'memos' && !failed.length) items = journalMemosOn(ok('basket'), day);
    if (key === 'shares' && !failed.length) items = (ok('sharePages') || []).filter(page => onDay(page?.updated_at, day)).map(sharePageLine);
    if (SECTIONED.has(key) && failed.length < sources.length) {
      const read = {basket:ok('basket'), orgUpdates:ok('orgUpdates'), projectUpdates:ok('projectUpdates')};
      sections = key === 'orgs' ? orgNewsOn(read, day) : projectNewsOn(read, day);
      items = sections.flatMap(section => section.items);
    }
    const cap = sources.some(source => materials[source].status === 'ok' && materials[source].items?.capped);
    return {key, label, items, sections, ...(failed.length ? {failed} : {}), ...(cap ? {capped:true} : {})};
  });
}
// A group with nothing on the day is folded into one "기록 없는 묶음" line, unless it is loading, failed, or has a range note
// (끝낸 할 일 before the covered days, 할 일 예정 after the server's range) — those keep their own box.
export function rangeNote(group, day, {doneDays = DONE_TASK_DAYS, today = todayKey()} = {}) {
  if (group.items.length || group.loading || group.failed) return '';
  if (group.key === 'tasks' && day < doneCoverFrom(doneDays, today)) return `Google 할 일은 최근 ${doneDays}일 안에 끝낸 것만 모여요.`;
  if (group.key === 'due' && day > pendingCoverTo(today)) return `할 일 예정은 오늘부터 ${PENDING_DAYS}일 안 마감만 모여요.`;
  return '';
}
// BASKET-일지로남기기: 기타 메모 is only there when something was kept for it, so on the day card an empty one (also while its
// read is out or after it failed — 조직 소식 shows those for the same basket read) is left out altogether (no box and not named
// in "기록 없는 묶음").
export const QUIET_WHEN_EMPTY = Object.freeze(['memos']);
export const isFolded = (group, day, range) => !group.items.length && !group.loading && !group.failed && !rangeNote(group, day, range);
export const shortDay = day => `${formatSeoulTime(day, {month:'long', day:'numeric'})}(${formatSeoulTime(day, {weekday:'short'})})`;
