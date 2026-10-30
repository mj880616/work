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
import { attachmentName } from './attachment-name.mjs';
import { plainLines } from './note-preview.mjs';
import {seoulParts, seoulDateKey, addSeoulDays, seoulClock, formatSeoulTime} from './meeting-time.js';
import {eventColor, milestoneChips, ranges} from './home-read-model.js';
import {readBasket, filedOrganizations, filedProjects} from './basket-data.js';
import {categoryOf} from './document-categories.js';
import {myOrganizationIds, OTHERS} from './my-organizations.js';
import {noteRequests} from './update-requests.js';
import {noteJournalAt, MOVED_KEY} from './update-journal.js';
import {dueDay, shortDay, tomorrowKey, moveTaskToDay} from './task-due.mjs';
import {reportsMeeting, meetingKindKey, meetingKindName} from './journal-meeting-kinds.js';
import {reportKindOf, reportKindLabel, DEFAULT_KIND} from './report-kinds.mjs';
import {callLine} from './journal-draft-model.mjs';
import {callAiAssist} from './basket-ai-summary.js';

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

// JOURNAL-오늘한줄초안: the week's AI drafts of '오늘 한 줄' (app_journal_drafts, owner RLS, one row a day, read only here — the server
// ai-assist kind=journal_draft writes them). A draft is not a work line: the weekly report never reads this table. Before the DB step the
// table is missing ({missing:true}) and the screen works as before.
export async function readWeekDrafts(start, rt = window.KPTURuntime) {
  const days = weekDays(start);
  try {
    const rows = await rt.api(`/rest/v1/app_journal_drafts?workspace_id=eq.${encode(workspace(rt))}&journal_day=gte.${days[0]}&journal_day=lte.${days[6]}&select=journal_day,draft_text&order=journal_day.asc&limit=7`);
    return {missing:false, map:new Map((Array.isArray(rows) ? rows : []).filter(r => dayKey.test(r?.journal_day || '') && typeof r.draft_text === 'string' && r.draft_text.trim()).map(r => [r.journal_day, r.draft_text.trim()]))};
  } catch (error) {
    if (error?.status === 404) return {missing:true, map:new Map()};
    throw error;
  }
}
// Ask the server for today's draft once (it refuses before 18:00 KST, when a line or a draft is already there, and never overwrites).
// Returns the draft text or '' (skipped or failed — the screen then simply shows no draft).
export async function requestDayDraft(day, lines, rt = window.KPTURuntime) {
  if (!lines.length) return '';
  const result = await callAiAssist({kind:'journal_draft', day:checkDay(day), lines}, {rt});
  return result?.ok && typeof result.data?.draft === 'string' ? result.data.draft.trim() : '';
}
// JOURNAL-오늘한줄초안 ②: the week's work calls (업무 통화함 app_feed_items source=call — the same owner-RLS read as the 통화 screen; the
// personal call box table is never read here). Only short fields; no raw text.
export async function readWeekCalls(start, rt = window.KPTURuntime) {
  const days = weekDays(start);
  const rows = await rt.api(`/rest/v1/app_feed_items?workspace_id=eq.${encode(workspace(rt))}&source=eq.call&hidden_at=is.null&day=gte.${days[0]}&day=lte.${days[6]}&select=id,day,occurred_at,title,summary,counterpart&order=occurred_at.asc,id.asc&limit=${WEEK_READ_CAP}`);
  if (!Array.isArray(rows)) throw new Error('calls');
  return Object.assign(rows.filter(r => r?.id && dayKey.test(r.day || '')), rows.length >= WEEK_READ_CAP ? {capped:true} : {});
}
const callItemsOn = (calls, day) => (calls || []).filter(row => row.day === day)
  .map(row => ({text:callLine(row, row.occurred_at ? seoulClock(row.occurred_at) : ''), ...(row.summary ? {callSummary:String(row.summary)} : {})}))
  .filter(item => item.text);

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
// The report day (상집 보고일, "■ 일시"): the Monday after the shown week (2026-10-21 사용자 결정, WEEKLY-보고일).
export const reportDay = start => shiftWeek(start, 1);
export const scheduleDays = start => Array.from({length:SCHEDULE_WEEKS * 7}, (_, i) => seoulDateKey(addSeoulDays(reportDay(start), i)));
// The events carry only a calendar id (an account value), never its name, so the report's calendar rule (journal-weekly.js
// REPORT_CALENDAR '공공운수노조', by name) needs the id -> name list of the same Edge (action=status calendars[].summary). Each event gets
// calendarName, and the list keeps every calendar name (calendarNames) so the screen can tell "no such calendar" from "no event".
// The list is read with the events; when it cannot be read the whole read fails, so another calendar never slips in.
const readCalendarStatus = async rt => {
  const data = await rt.api('/functions/v1/google-calendar?action=status');
  if (!Array.isArray(data?.calendars) || data?.connected === false || data?.warning) throw new Error('calendar');
  return data;
};
async function readCalendarNames(rt) {
  return new Map((await readCalendarStatus(rt)).calendars.map(c => [c?.id, String(c?.summary ?? '')]));
}
// JOURNAL-하루일정다시: the [하루] card's 그날 일정 line. The same events read as the calendar screen (owner's selected calendars; a
// cancelled one is left out like the calendar does), each with the color the calendar paints it in (eventColor, home-read-model.js:
// own color → my calendar color → the calendar's color). The color needs the calendar list; when only that read fails the lines still
// come, in the page's own accent (displayColor '').
export async function readWeekScheduleEvents(start, rt = window.KPTURuntime) {
  const [events, status] = await Promise.all([readWeekEvents(start, rt), readCalendarStatus(rt).catch(() => null)]);
  return events.filter(event => event?.status !== 'cancelled').map(event => ({...event, displayColor:eventColor(event, status)}));
}
export async function readScheduleEvents(start, rt = window.KPTURuntime) {
  const [events, names] = await Promise.all([readEventsBetween(shiftWeek(start, 1), shiftWeek(start, 1 + SCHEDULE_WEEKS), rt), readCalendarNames(rt)]);
  return Object.assign(events.map(event => ({...event, calendarName:names.get(event.calendarId) ?? ''})), {calendarNames:[...names.values()]});
}
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
// dueDay / shortDay / tomorrowKey / moveTaskToDay live in task-due.mjs (TASK-바로처리통일: every task line shares them).
export {dueDay, shortDay, tomorrowKey, moveTaskToDay};
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
  // `orgs` (id·name of this workspace's organizations): [주간 정리] 4. 산하 조직 현황 finds an organization section's id by its name
  // (JOURNAL-조직현황AI요약: the summary is kept per organization id).
  return Object.assign(rows.filter(row => names.has(row.organization_id)).map(row => ({...row, organization:{name:names.get(row.organization_id)}})),
    {mine:myOrganizationIds(orgs, assignees), orgs:[...names].map(([id, name]) => ({id, name}))});
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
// JOURNAL-하루개편: the day card shows one line of each meeting's result under its title, so the result text (transcript_text,
// else the older decisions — the meeting screen's own order, meeting-columns.js resultText) comes with the week's meetings.
// A week has a handful of meetings; the text stays in this screen's memory only and is never stored.
// UPD-요약부품통일 ①: the summaries written on its 프로젝트·담당조직 links (app_record_links, 출처 회의) come along as link_summaries,
// so the weekly line uses a written summary before the result's first line. If that embed cannot be read, the plain read is used.
const MEETING_FIELDS = 'id,title,series_name,round_no,meeting_at,transcript_text,decisions,activity_kind,project_id';
const AREA_FIELDS = 'business_area_id,next_plan';
const MEETING_LINKS = 'links:app_record_links!app_record_links_source_meeting_id_fkey(summary,status,project_id,organization_id)';
export async function readWeekMeetings(start, rt = window.KPTURuntime) {
  const from = dayStartIso(weekDays(start)[0]), to = dayStartIso(shiftWeek(start, 1));
  const path = fields => `/rest/v1/app_meetings?workspace_id=eq.${encode(workspace(rt))}&meeting_at=gte.${encode(from)}&meeting_at=lt.${encode(to)}&select=${fields}&order=meeting_at.asc,id.asc`;
  // MTG-프로젝트합치기 2단계: 사업영역 꼬리표·다음 할 일(주간보고 ② 재료). 칸이 아직 없는 서버(400)는 그 둘 없이 지금처럼 읽는다.
  const read = async base => {
    try { return {rows:await pages(path(`${base},${MEETING_LINKS}`), rt), linked:true}; }
    catch (error) { if (Number(error?.status) !== 400) throw error; return {rows:await pages(path(base), rt), linked:false}; }
  };
  let got;
  try { got = await read(`${MEETING_FIELDS},${AREA_FIELDS}`); }
  catch (error) { if (Number(error?.status) !== 400) throw error; got = await read(MEETING_FIELDS); }
  if (!got.linked) return got.rows;
  const rows = got.rows;
  // MTG-기록겹침거르기 4단계: link_targets = 이 사업 보고에 이어진 프로젝트·조직(주간 정리가 겹침 후보를 줄 세울 때만 쓴다, 화면에 보이지 않음).
  const targets = (meeting, links) => [...new Set([meeting.project_id && `project:${meeting.project_id}`,
    ...links.filter(l => l?.status === 'confirmed').flatMap(l => [l.project_id && `project:${l.project_id}`, l.organization_id && `organization:${l.organization_id}`])].filter(Boolean))]
    .map(key => ({kind:key.slice(0, key.indexOf(':')), id:key.slice(key.indexOf(':') + 1)}));
  return rows.map(({links, ...meeting}) => { const list = Array.isArray(links) ? links : [];
    return {...meeting, link_targets:targets(meeting, list), link_summaries:list
      .filter(l => l?.status === 'confirmed' && typeof l.summary === 'string' && l.summary.trim()).map(l => l.summary)}; });
}

// 자료실 새 자료: documents of this workspace added (created_at) in the week — the day they were put in the library, not the
// document's own date (an old document would land on an old day). Title, file name, category and links only; capped.
export const WEEK_READ_CAP = 300;
const capped = rows => { if (!Array.isArray(rows)) throw new Error('read'); return Object.assign(rows, {capped:rows.length >= WEEK_READ_CAP}); };
// WEEKLY-자료요약 화면 ① (docs/design/weekly-file-summary.md 3.1·4.3·5.1절): 담당조직·프로젝트 연결과 Drive 파일 id도 읽고, 그 주 자료의
// 한두 줄 요약(자료별 AI 요약 표 app_document_ai_index의 'b1:' 행만)을 자료 id 목록으로 한 번 더 읽어 doc.brief = {summary, hash}로 붙인다.
// 같은 글자 지문이 이 주보다 앞에 올린 다른 자료에 있으면 doc.repeat = true(다시 올림 — 화면이 접는다). 요약 읽기가 실패하면
// 요약 없이 자료만 돌려준다(제목만 보임, 깨지지 않는 조건). 글자(extracted_text)·옛 요약 행('b1:' 아님)은 읽지 않는다.
export const BRIEF_HASH_RE = /^b1:[0-9a-f]{32}$/;
export async function readWeekDocuments(start, rt = window.KPTURuntime) {
  const from = dayStartIso(weekDays(start)[0]), to = dayStartIso(shiftWeek(start, 1)), ws = encode(workspace(rt));
  const docs = capped(await rt.api(`/rest/v1/app_documents?workspace_id=eq.${ws}&created_at=gte.${encode(from)}&created_at=lt.${encode(to)}&select=id,title,file_name,category,meeting_id,created_at,organization_id,project_id,file_id&order=created_at.asc,id.asc&limit=${WEEK_READ_CAP}`));
  try { await attachBriefs(docs, {ws, from, rt}); } catch { for (const doc of docs) { delete doc.brief; delete doc.repeat; } }
  return docs;
}
async function attachBriefs(docs, {ws, from, rt}) {
  const ids = docs.map(doc => doc?.id).filter(id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id));
  if (!ids.length) return;
  const byDoc = new Map();
  for (const part of chunks(ids)) {
    const rows = await rt.api(`/rest/v1/app_document_ai_index?workspace_id=eq.${ws}&document_id=${inList(part)}&content_hash=like.${encode('b1:*')}&select=document_id,content_hash,summary&limit=${part.length + 1}`);
    if (!Array.isArray(rows)) throw new Error('read');
    for (const row of rows) if (BRIEF_HASH_RE.test(String(row?.content_hash || '')) && typeof row.summary === 'string') byDoc.set(String(row.document_id).toLowerCase(), {summary:row.summary, hash:row.content_hash});
  }
  for (const doc of docs) { const brief = byDoc.get(String(doc?.id || '').toLowerCase()); if (brief) doc.brief = brief; }
  // 다시 올림: 이 주 지문과 같은 지문의 다른 자료 중 이 주보다 앞에 올린 것이 있는지(자료 id만 읽음).
  const hashes = [...new Set([...byDoc.values()].map(b => b.hash))];
  if (!hashes.length) return;
  const mine = new Set(ids.map(id => id.toLowerCase())), others = new Map();
  for (const part of chunks(hashes)) {
    const rows = await rt.api(`/rest/v1/app_document_ai_index?workspace_id=eq.${ws}&content_hash=${inList(part)}&select=document_id,content_hash&limit=${WEEK_READ_CAP}`);
    if (!Array.isArray(rows)) throw new Error('read');
    for (const row of rows) { const id = String(row?.document_id || '').toLowerCase(); if (id && !mine.has(id)) others.set(id, row.content_hash); }
  }
  if (!others.size) return;
  const earlier = new Set();
  for (const part of chunks([...others.keys()])) {
    const rows = await rt.api(`/rest/v1/app_documents?workspace_id=eq.${ws}&id=${inList(part)}&created_at=lt.${encode(from)}&select=id&limit=${part.length + 1}`);
    if (!Array.isArray(rows)) throw new Error('read');
    for (const row of rows) earlier.add(others.get(String(row?.id || '').toLowerCase()));
  }
  for (const doc of docs) if (doc.brief && earlier.has(doc.brief.hash)) doc.repeat = true;
}
// 공유 페이지: share pages of this workspace changed (updated_at) in the week. Title and state only, never the blocks.
// SHARE-페이지삭제: a deleted (archived) page is left out.
export async function readWeekSharePages(start, rt = window.KPTURuntime) {
  const from = dayStartIso(weekDays(start)[0]), to = dayStartIso(shiftWeek(start, 1));
  return capped(await rt.api(`/rest/v1/app_share_pages?workspace_id=eq.${encode(workspace(rt))}&updated_at=gte.${encode(from)}&updated_at=lt.${encode(to)}&status=neq.archived&select=id,title,status,updated_at&order=updated_at.asc,id.asc&limit=${WEEK_READ_CAP}`));
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
  // BUG-미리보기기호: the line is shown as plain letters (shared note-preview rules: no #·|·** marks, entities decoded).
  const first = plainLines(String(text ?? '').replace(/\u2028|\u2029/g, '\n'))[0];
  if (!first) return '';
  return [...first].length > SHORT ? [...first].slice(0, SHORT).join('') + '…' : first;
}
export function memoLine(memo) {
  const first = firstLine(memo?.raw_text);
  if (first) return first;
  const files = Array.isArray(memo?.attachments) ? memo.attachments : [];
  if (!files.length) return '(빈 업데이트)';
  const name = attachmentName(files[0], '');
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
// whole list when that module is not loaded, stay 가나다순. Project sections follow the project order (projectNewsOn).
const orgCompare = (a, b) => {
  const order = globalThis.window?.KPTUOrganizationOrder;
  return typeof order?.compare === 'function' ? order.compare({name:a}, {name:b}) : a.localeCompare(b, 'ko');
};
const byName = (a, b) => a.localeCompare(b, 'ko');
// The order of 조직 소식 sections (named organizations in the app's order, then '그 외', then '미분류'); [주간 정리] uses it too.
export const compareOrgSections = (a, b) => tail(a.name) - tail(b.name) || orgCompare(a.name, b.name);
// JOURNAL-하루개편: with {open:true} each section also has `opens`, one place per item where its original is shown (see OPEN below).
const sectionsOf = (entries, compare = byName, {open = false} = {}) => {
  const sections = new Map();
  for (const entry of entries.sort((a, b) => byTime(a.at, b.at) || 0)) {
    if (!sections.has(entry.name)) sections.set(entry.name, {items:[], tags:[], opens:[]});
    sections.get(entry.name).items.push(entry.text);
    sections.get(entry.name).tags.push(entry.requests || []);
    sections.get(entry.name).opens.push(entry.open || null);
  }
  return [...sections].map(([name, {items, tags, opens}]) => ({name, items, ...(tags.some(list => list.length) ? {tags} : {}), ...(open ? {opens} : {})}))
    .sort((a, b) => tail(a.name) - tail(b.name) || compare(a.name, b.name));
};
// JOURNAL-하루개편 ⑥: where a day-card line opens. Every line of an update points at the place it was filed and the record there:
//   {type:'org', org, record:'up:<id>' | 'link:<id>' | null, note}  — an organization record, or a basket update linked to it
//   {type:'project', project, record:'progress:<id>' | 'link:<id>' | null, note}
//   {type:'note', note} a basket update itself · {type:'notedoc', note} a note · {type:'meeting', id} · {type:'task', id}
// `note` (a basket update's id) is what ⋯ [원래 업데이트 보기] opens. A record reached only through filed documents has no record.
const orgOpen = (org, record, note = null) => ({type:'org', org, record, note});
const projectOpen = (project, record, note = null) => ({type:'project', project, record, note});
// Where each basket update of the day went: {orgs:[{name, text}], projects:[name], refs:[{id, name}], line, at}.
// REF-참고묶음 (docs/design/ref-bundle.md 4절): a confirmed link to a reference bundle (bundle_id) goes to `refs` only, never to
// orgs or projects. Rule: a reference link counts in "where it went", never in a report group (조직 소식·사업 소식·미분류·기타 메모).
function basketPlaces(basket, day) {
  const links = basket?.links || [], docs = basket?.docs || [];
  return memosOn(basket?.notes, day).map(memo => {
    const confirmed = links.filter(link => link.note_id === memo.id && link.status === 'confirmed');
    const orgs = new Map(), projects = [], refs = [];
    for (const link of confirmed) {
      if (link.organization_id && !orgs.has(link.organization_id)) orgs.set(link.organization_id, {id:link.organization_id, name:link.organization?.name || '조직', summary:firstLine(link.summary), link:link.id || null});
      else if (link.project_id && !link.organization_id && link.project?.name) projects.push({id:link.project_id, name:link.project.name, summary:firstLine(link.summary), link:link.id || null});
      else if (link.bundle_id && !link.organization_id && !link.project_id && !refs.some(ref => ref.id === link.bundle_id))
        refs.push({id:link.bundle_id, name:String(link.bundle?.name || '').trim() || '참고 묶음', summary:firstLine(link.summary), link:link.id || null});
    }
    for (const org of filedOrganizations(memo, docs)) if (!orgs.has(org.organization_id)) orgs.set(org.organization_id, {id:org.organization_id, name:org.name, summary:'', link:null});
    for (const project of filedProjects(memo, docs)) if (!projects.some(p => p.name === project.name)) projects.push({id:project.project_id, name:project.name, summary:'', link:null});
    return {memo, orgs:[...orgs.values()], projects, refs, line:memoLine(memo), requests:noteRequests(memo), journal:!!noteJournalAt(memo)};
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
// JOURNAL-하루개편: the day card passes {open:true, unsorted:false} — its sections carry `opens`, and an update sent nowhere is
// not a section here (it is "어디에도 안 보낸 업데이트" under 그 밖의 기록, unsentUpdatesOn). [주간 정리] keeps '미분류'.
export function orgNewsOn({basket, orgUpdates} = {}, day, {open = false, unsorted = true} = {}) {
  const entries = [], mine = orgUpdates?.mine instanceof Set ? orgUpdates.mine : null;
  const add = (id, name, at, text, requests, place = null) => {
    const label = String(name || '').trim();
    if (id && mine && !mine.has(id)) entries.push({name:OTHERS, at, text:`${label || '조직'} · ${text}`, requests, open:place});
    else entries.push({name: label || UNSORTED, at, text, requests, open:place});
  };
  for (const {memo, orgs, projects, refs, line, requests, journal} of basketPlaces(basket, day)) {
    if (orgs.length) for (const org of orgs) add(org.id, org.name, memo.occurred_at, org.summary || line, requests, orgOpen(org.id, org.link ? `link:${org.link}` : null, memo.id));
    // REF-참고묶음: an update put only in a reference bundle is not '미분류' (so not in [주간 정리]·[복사]·한글 파일 후보).
    else if (unsorted && !projects.length && !refs.length && !journal) add(null, UNSORTED, memo.occurred_at, line, requests, {type:'note', note:memo.id});
  }
  for (const row of orgUpdates || []) if (onDay(row?.occurred_at, day)) add(row.organization_id, row.organization?.name, row.occurred_at, firstLine(row.raw_text) || firstLine(row.detail_text) || '(빈 업데이트)', undefined, orgOpen(row.organization_id, `up:${row.id}`));
  return sectionsOf(entries, orgCompare, {open});
}
// 프로젝트 소식 of one day: [{name, items:[text]}] — one section per project (by name). A project progress record goes under
// its project on its day (effective_on); a basket update sent to a project and to no organization goes under each such
// project (an update sent to an organization stays in 조직 소식 only, so nothing shows twice).
// The same records one by one with their project id: [{id, name, at, text, requests}] ([주간 정리] places them in the project tree).
export function projectRecordsOn({basket, projectUpdates} = {}, day) {
  const entries = [];
  const add = (id, name, at, text, requests, open) => entries.push({id: id || null, name: String(name || '').trim() || UNSORTED, at, text, requests, open});
  for (const {memo, orgs, projects, line, requests} of basketPlaces(basket, day))
    if (!orgs.length) for (const project of projects) add(project.id, project.name, memo.occurred_at, project.summary || line, requests, projectOpen(project.id, project.link ? `link:${project.link}` : null, memo.id));
  for (const row of projectUpdates || []) if (row?.effective_on === day)
    add(row.project_id, row.project?.name, row.created_at || `${day}T23:59:59+09:00`, firstLine(row.summary) || '(빈 업데이트)', undefined, projectOpen(row.project_id, `progress:${row.id}`));
  return entries;
}
// PRJ-순서바꾸기: with the project tree (project-catalog tree, [{project, depth}]) the sections follow the app's one project order
// (the project screen's order, the same as [주간 정리]); a project the tree does not have, and every section without the tree
// (its read failed or is still out), stays 가나다순 after them. '미분류' stays last.
export const projectNewsOn = (read = {}, day, tree = null, {open = false} = {}) => {
  const entries = projectRecordsOn(read, day);
  if (!Array.isArray(tree)) return sectionsOf(entries, byName, {open});
  const at = new Map(tree.map(({project}, i) => [project?.id, i])), place = new Map();
  for (const entry of entries) place.set(entry.name, Math.min(place.get(entry.name) ?? Infinity, at.get(entry.id) ?? Infinity));
  const rank = name => place.get(name) ?? Infinity;
  return sectionsOf(entries, (a, b) => (rank(a) === rank(b) ? 0 : rank(a) < rank(b) ? -1 : 1) || byName(a, b), {open});
};
// BASKET-일지로남기기: 기타 메모 of one day — the day's updates kept as work-journal memos ([업무일지에 남기기], metadata.journal_at)
// that went to no organization and no project, oldest first, one item each (its first line, as the other update groups).
// They leave 조직 소식's '미분류'; an update linked to an organization or a project later shows there instead, never twice.
// REF-참고묶음: one put in a reference bundle is not a 기타 메모 either (it shows under 참고, referenceItemsOn).
export const journalMemoItemsOn = (basket, day) => basketPlaces(basket, day)
  .filter(({orgs, projects, refs, journal}) => journal && !orgs.length && !projects.length && !refs.length).map(({memo, line}) => ({text:line, open:{type:'note', note:memo.id}}));
export const journalMemosOn = (basket, day) => journalMemoItemsOn(basket, day).map(item => item.text);
// JOURNAL-하루개편: 어디에도 안 보낸 업데이트 — the day's updates sent to no organization and no project and not kept as a
// work-journal memo (what 조직 소식 showed as '미분류' before). Pressing one opens it in the basket.
export const unsentUpdatesOn = (basket, day) => basketPlaces(basket, day)
  .filter(({orgs, projects, refs, journal}) => !journal && !orgs.length && !projects.length && !refs.length)
  .map(({memo, line, requests}) => ({text:line, requests, open:{type:'note', note:memo.id}}));
// REF-참고묶음 (질문 2, 추천안): 참고 of one day under the day card's 그 밖의 기록 — the day's updates put in a reference bundle and
// in no organization and no project (one also sent to an organization or a project shows there only, never twice), one item per
// bundle: "묶음 이름 · 첫 줄" (the link's summary when there is one), oldest first. Pressing one opens the update in the basket.
// Not part of [주간 정리] (weeklySummary never reads it), so never in the weekly draft, [복사] or the 한글 file candidates.
export const referenceItemsOn = (basket, day) => basketPlaces(basket, day)
  .filter(({orgs, projects, refs}) => refs.length && !orgs.length && !projects.length)
  .flatMap(({memo, refs, line, requests}) => refs.map(ref => ({text:`${ref.name} · ${ref.summary || line}`, requests, open:{type:'note', note:memo.id}})));
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
// MTG-사업보고 8단계 (설계 결정 3-가): 회의가 아닌 칸(정책·교섭·언론·국회·투쟁·교육·기타)은 줄 맨 앞에 [칸 이름]을 붙인다. 칸 없는 옛 행·회의 칸은 그대로.
export const activityTag = meeting => { const kind = reportKindOf(meeting); return kind === DEFAULT_KIND ? '' : `[${reportKindLabel(kind)}] `; };
export function meetingLine(meeting) {
  const name = String(meeting?.series_name || meeting?.title || '').trim() || '회의';
  const round = Number(meeting?.round_no), clock = seoulClock(meeting.meeting_at);
  return `${activityTag(meeting)}${clock && clock !== '00:00' ? clock + ' ' : ''}${name}${meeting?.round_no != null && meeting.round_no !== '' && Number.isFinite(round) ? ` ${round}차` : ''}`;
}
export const pendingOn = (tasks, day) => (tasks || []).filter(task => task?.status !== 'completed' && dueDay(task) === day)
  .sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ko'));
export const documentLine = doc => `[${categoryOf(doc?.category)}] ${String(doc?.title || doc?.file_name || '').trim() || '(제목 없음)'}${doc?.meeting_id ? ' · 회의자료' : ''}`;
export const sharePageLine = page => `${String(page?.title || '').trim() || '제목 없음'} · ${page?.status === 'published' ? '게시' : '초안'}`;

// JOURNAL-하루개편 (2026-10-22 요청함 14:26·12:55): the [하루] card from top to bottom —
//   ① 오늘 한 줄 (journal.js) → ② 할 일 / 한 일 → ③ 그날 나온 챙길 것 (todo-radar.js, its own renderer) → ④ 주간보고 재료 in the
//   report's order: 회의·활동 결과 → 사업 소식 → 조직 소식 → ⑤ 그 밖의 기록 (folded): 일정·자료실 새 자료·공유 페이지·노트로 옮긴 것·
//   기타 메모·참고(REF-참고묶음)·어디에도 안 보낸 업데이트. '할 일 예정' and 조직 소식's '미분류' are gone from the day card ([주간 정리] keeps its own).
// Every item can carry `open` (where its original is shown, see OPEN above); the screen only draws what this returns.

// ② 할 일 / 한 일. todo = pending tasks due that day; overdue = pending tasks due before it (one folded line on screen);
// done = tasks finished that day. A task item is {id, text, task} (task: the Google task as read, for [내일로]).
const taskItem = task => ({id:task.id, text:task.title || '(제목 없음)', task, open:{type:'task', id:task.id}});
export function tasksPart(tasks, day) {
  const pending = (tasks || []).filter(task => task?.id && task.status !== 'completed' && dueDay(task));
  return {
    todo: pending.filter(task => dueDay(task) === day).sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ko')).map(taskItem),
    overdue: pending.filter(task => dueDay(task) < day).sort((a, b) => dueDay(a).localeCompare(dueDay(b)) || String(a.title || '').localeCompare(String(b.title || ''), 'ko')).map(taskItem),
    done: tasksOn(tasks, day).map(taskItem),
  };
}
export const moveTaskToTomorrow = (task, rt = window.KPTURuntime, today = todayKey()) => moveTaskToDay(task, tomorrowKey(today), rt);

// ④ 회의·활동 결과 — ONE source function. Today it is the day's meetings; when '사업 보고' (요청 13:04, not started) arrives this is
// the only place to change. An item: {text, summary, hidden, open}. summary = the first line of the meeting's result ('' when none —
// the screen shows "결과 아직 없음"); hidden = a kind left out of the weekly report (app_profiles.weekly_hidden_meeting_kinds,
// journal-meeting-kinds.js; the screen dims it and says '보고 안 함'). hidden list null/unknown → nothing is dimmed.
export const ACTIVITY_SOURCES = Object.freeze(['meetings']);
const meetingResult = meeting => firstLine(meeting?.link_summaries?.[0]) || firstLine(meeting?.transcript_text) || firstLine(meeting?.decisions);
export function activityResultsOn(materials, day, hiddenKinds = null) {
  const meetings = materials?.meetings?.status === 'ok' ? materials.meetings.items : [];
  return meetingsOn(meetings, day).map(meeting => ({text:meetingLine(meeting), summary:meetingResult(meeting),
    hidden:!reportsMeeting(meeting, hiddenKinds), open:{type:'meeting', id:meeting.id, kind:meetingKindKey(meetingKindName(meeting))}}));
}

const stateOf = (materials, sources) => {
  const states = sources.map(source => materials?.[source]);
  if (states.some(state => !state || state.status === 'loading')) return {loading:true, failed:[]};
  return {loading:false, failed:sources.filter((_, i) => states[i].status !== 'ok'), capped:states.some(s => s.status === 'ok' && s.items?.capped)};
};
const okItems = (materials, source) => materials?.[source]?.status === 'ok' ? materials[source].items : null;
// The parts of the day card and their reads (journal.js [다시 시도] uses these keys).
export const DAY_SOURCES = Object.freeze({
  tasks:['tasks'], activities:ACTIVITY_SOURCES, business:['basket', 'projectUpdates'], orgs:['basket', 'orgUpdates'],
  events:['events'], docs:['documents'], shares:['sharePages'], movedNotes:['movedNotes'], memos:['basket'], refs:['basket'], unsent:['basket'], calls:['calls'],
});
export const REPORT_PARTS = Object.freeze([['activities', '회의·활동 결과'], ['business', '사업 소식'], ['orgs', '조직 소식']]);
export const OTHER_PARTS = Object.freeze([['docs', '자료실 새 자료'], ['shares', '공유 페이지'], ['movedNotes', '노트로 옮긴 것'],
  ['memos', '기타 메모'], ['refs', '참고'], ['unsent', '어디에도 안 보낸 업데이트'],
  // JOURNAL-오늘한줄초안 ②: 그날 업무 통화(업무 통화함만, 개인 통화 제외). 주간보고 재료가 아니라 그 밖의 기록에 두고, 오늘 한 줄 초안 재료로 쓴다.
  ['calls', '업무 통화']]);
// The whole day card: {tasks:{todo, overdue, done, ...state}, events:part, report:[part], others:[part]}; a part is {key, label, loading, failed,
// capped, items:[{text, open, ...}], sections:[{name, items, opens, tags?}]}. kinds: journal-meeting-kinds readKinds() result.
export function dayCard(materials, day, {kinds = null, tree = null} = {}) {
  const part = (key, label, build) => {
    const s = stateOf(materials, DAY_SOURCES[key]);
    if (s.loading) return {key, label, loading:true, items:[], sections:[]};
    // A failed read gives nothing (okItems → null), so build() shows what the other reads gave. 노트로 옮긴 것 stays quiet when its
    // read fails (as before, journal-moved-note): it is not report material and its failure must not alarm the rest of the card.
    const failed = key === 'movedNotes' ? [] : s.failed;
    return {key, label, items:[], sections:[], ...build(), ...(failed.length ? {failed} : {}), ...(s.capped ? {capped:true} : {})};
  };
  const basket = okItems(materials, 'basket');
  // JOURNAL-하루일정다시: 그날 일정 sits above 오늘 한 줄 (it was a group of the day card before JOURNAL-하루개편, then only a count in
  // 그 밖의 기록, which no longer lists it). One line per event: {time, title, color, text, open:{type:'event', id, calendarId}}.
  const events = part('events', '일정', () => ({items:eventsOn(okItems(materials, 'events'), day).map(event => {
    const title = event.title || '(제목 없음)', calendarId = event.calendarId || 'primary';
    return {id:event.id, time:eventTime(event), title, color:event.displayColor || '', text:`${eventTime(event)} ${title}`, open:{type:'event', id:event.id, calendarId}};
  })}));
  const tasks = part('tasks', '할 일', () => tasksPart(okItems(materials, 'tasks'), day));
  const hidden = kinds?.status === 'ok' ? kinds.list : null;
  const sectioned = sections => ({sections, items:sections.flatMap(section => section.items)});
  const report = [
    part('activities', '회의·활동 결과', () => ({items:activityResultsOn(materials, day, hidden)})),
    part('business', '사업 소식', () => (basket || okItems(materials, 'projectUpdates')) ? sectioned(projectNewsOn({basket, projectUpdates:okItems(materials, 'projectUpdates')}, day, tree, {open:true})) : {}),
    part('orgs', '조직 소식', () => (basket || okItems(materials, 'orgUpdates')) ? sectioned(orgNewsOn({basket, orgUpdates:okItems(materials, 'orgUpdates')}, day, {open:true, unsorted:false})) : {}),
  ];
  const others = OTHER_PARTS.map(([key, label]) => part(key, label, () => {
    if (key === 'calls') return {items:callItemsOn(okItems(materials, 'calls'), day)};
    if (key === 'docs') return {items:(okItems(materials, 'documents') || []).filter(doc => onDay(doc?.created_at, day)).map(doc => ({text:documentLine(doc), open:{type:'library'}}))};
    if (key === 'shares') return {items:(okItems(materials, 'sharePages') || []).filter(page => onDay(page?.updated_at, day)).map(page => ({text:sharePageLine(page), open:{type:'pages'}}))};
    if (key === 'movedNotes') return {items:movedNotesOn(okItems(materials, 'movedNotes'), day).map(note => ({text:note.line, open:{type:'notedoc', note:note.id}, noteMark:true}))};
    if (key === 'memos') return {items:journalMemoItemsOn(basket, day)};
    if (key === 'refs') return {items:referenceItemsOn(basket, day)};
    return {items:unsentUpdatesOn(basket, day)};
  }));
  return {tasks, events, report, others};
}
// The count line of 그 밖의 기록 ("일정 2 · 자료실 새 자료 1"): parts with items only.
export const othersCount = others => others.filter(part => part.items.length).map(part => `${part.label} ${part.items.length}`).join(' · ');
// 할 일 / 한 일 with nothing: the line under the empty column says when the reason is the reads' range, not the day.
export function dayRangeNote(key, day, {doneDays = DONE_TASK_DAYS, today = todayKey()} = {}) {
  if (key === 'done' && day < doneCoverFrom(doneDays, today)) return `Google 할 일은 최근 ${doneDays}일 안에 끝낸 것만 모여요.`;
  if (key === 'todo' && day > pendingCoverTo(today)) return `할 일은 오늘부터 ${PENDING_DAYS}일 안 마감만 모여요.`;
  return '';
}

// HOME-업무일지홈 B: 할 일 줄 끝에 붙는 연결된 사업 보고 이름(옛 홈 '사업 보고 후속' 칸·파란 꼬리표 대신). 확인된 연결(app_record_links,
// meeting_id)과 그 사업 보고 제목만 읽는다(소유자 RLS REST 읽기 둘, 새 표·함수 없음). 못 읽으면 빈 지도(이름 없이 줄은 그대로).
export async function readTaskMeetingNames(taskIds, rt = window.KPTURuntime) {
  const ids = [...new Set((taskIds || []).filter(Boolean))], links = [];
  for (let i = 0; i < ids.length; i += 50) {
    const query = ids.slice(i, i + 50).map(encodeURIComponent).join(',');
    links.push(...await rt.api(`/rest/v1/app_record_links?google_task_id=in.(${query})&status=eq.confirmed&meeting_id=not.is.null&select=google_task_id,meeting_id`));
  }
  const meetingIds = [...new Set(links.map(l => l.meeting_id).filter(Boolean))], meetings = new Map();
  for (let i = 0; i < meetingIds.length; i += 50) {
    const query = meetingIds.slice(i, i + 50).map(encodeURIComponent).join(',');
    for (const m of await rt.api(`/rest/v1/app_meetings?id=in.(${query})&select=id,title,series_name`)) meetings.set(m.id, String(m.series_name || m.title || '').trim() || '사업 보고');
  }
  const out = new Map();
  for (const l of links) { const name = meetings.get(l.meeting_id); if (!name) continue; const list = out.get(l.google_task_id) || []; if (!list.includes(name)) list.push(name); out.set(l.google_task_id, list); }
  return out;
}
// HOME-업무일지홈: 옛 홈 '주요 일정'(D-day) 칩 — 오늘부터 다가오는 사업영역 주요 일정 3개(옛 홈과 같은 조건·같은 읽기, home-read-model.js milestoneChips).
// 홈 '그날 일정' 칸 안에 오늘을 볼 때만 그린다. 프로젝트 목록은 공용 project-catalog.js.
export async function readUpcomingMilestones(rt = window.KPTURuntime) {
  const ctx = rt.context.read(), catalog = window.KPTUProjectCatalog;
  if (!catalog?.load || !ctx?.workspace?.id) return [];
  const projects = (await catalog.load({workspaceId:ctx.workspace.id, userId:ctx.user?.id}))?.projects || [];
  const ids = projects.filter(p => p.status === 'active').map(p => p.id);
  if (!ids.length) return [];
  const rows = await rt.api(`/rest/v1/app_project_milestones?project_id=in.(${ids.map(encodeURIComponent).join(',')})&start_at=gte.${encodeURIComponent(new Date(ranges().start).toISOString())}&or=(status.is.null,status.not.in.(done,completed,cancelled,canceled))&select=id,project_id,title,status,start_at,google_calendar_id,google_event_id&order=start_at.asc&limit=3`);
  return milestoneChips(projects, Array.isArray(rows) ? rows : []);
}
