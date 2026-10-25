// JOURNAL-주간보고허브 2단계: [주간 정리] — one week of the journal's materials grouped in the order of the weekly report form
// (docs/design/weekly-report-hub.md 4절 2단계, 7절 결정; the form is docs/design/weekly-hwpx-draft.md 1.2·1.3절):
//   1. 요청사항 — 1) 임원 일정 배정·논의 요청 (WEEKLY-임원요청정리, 2026-10-23): the week's own request rows (일 | 시간/내용/장소 |
//      참석 요청), added, changed and removed here and saved on the server (weekly-exec-requests.js, app_weekly_exec_requests). Rows
//      carried from last week's confirmed report (journal-hwpx.js, filtered) show a small '지난주에서' tag on this screen only.
//   2. 기본·영역·의제 사업 — 1) 요약: 사업영역(1단 project) → 세부 과제(2단) → 진행 상황 및 이후 계획. The screen has no 담당 팀원
//      column (JOURNAL-주간정리다듬기 ②, 2026-10-22); the .hwpx keeps the form's column and fills it (journal-hwpx.js). Records follow the project tree and its order (project-catalog tree, PRJ-3단); a 3단 (사안) record sits on its
//      2단 row as "세부과제 › 사안: 내용", a 2단 record as "세부과제: 내용", a 1단 record on the area's own row (project-3-levels.md
//      3절 D, 8절 ④). 2) 세부 내용: 회의·활동 결과 by the meeting's date.
//   1. 2) 주요 일정 — 본부 주요 일정 (the headquarters' press conferences, main meetings, forums, rallies, trainings; not one
//      workplace's own nor repeating ones). Its rule is not settled yet, so the box only says what goes there (2026-10-21).
//   4. 산하 조직 현황 — 조직 소식 in the app's organization order (13 조직 묶음, then 그 외, then 미분류; ORG-묶음순서 PR 864).
//   5. 주요 일정 — my own Google Calendar events of the two weeks from the Monday after the shown week (journal-data.js
//      scheduleDays: written on Friday, reported on Monday — "the reported week and the week after"), in the form's cells
//      (일 | 시간/내용/장소 | 참석자). A vacation (휴가·연차·반차 …) is not a row but one "※ 휴가: …" line under the table; an event
//      marked 일기·비공개 is left out (WEEKLY-주요일정, 2026-10-21); only the work calendar named '공공운수노조' (REPORT_CALENDAR) is taken.
//   참고 — the week's 한 줄, 끝낸 할 일, 할 일 예정, 자료실 새 자료, 공유 페이지, 기타 메모 (material the form has no box for).
//   [주간보고 초안 복사] copies this same grouping as text in the same order (weeklyReportText).
// Notes moved from the basket (노트로 옮긴 업데이트, PR 868) are not included. The tab only shows; it saves nothing and makes no file
// (WEEKLY-한글초안 2단계 builds the .hwpx from this grouping) — except the request rows, which journal.js saves through
// weekly-exec-requests.js. journal.js stays the only renderer of #journalRoot and calls
// renderWeekly() into the box it owns.
import {weekDays, workLines, shortDay, reportDay, tasksOn, pendingOn, meetingsOn, meetingLine, orgNewsOn, projectRecordsOn, scheduleDays,
  compareOrgSections, journalMemosOn, documentLine, sharePageLine, UNSORTED, OTHERS, DONE_TASK_DAYS, doneCoverFrom, pendingCoverTo, PENDING_DAYS, todayKey, WEEK_READ_CAP} from './journal-data.js';
import {requestTagsHtml, requestPrefix} from './update-requests.js';
import {seoulDateKey, addSeoulDays, seoulClock} from './meeting-time.js';
import {meetingKindKey, meetingKindName, reportsMeeting, validKindKey} from './journal-meeting-kinds.js';
import {itemWhat} from './weekly-hwpx/schedule.mjs';
import {annotateCalendar, memoryTitle, idleWeeks} from './weekly-schedule-memory.js';
import {formDay, dayParts, dayLabel, whatCell, requestLine, sortItems, EXEC_HEAD, EXEC_LIMITS, EXEC_MAX_ROWS, CARRIED_TAG} from './weekly-exec-requests.js';
import {placeFiles, fileVerdict, fileItem, applyDocEdit, fileBucket} from './weekly-file-lines.mjs';
import {docEdits} from './weekly-draft-store.js';
import {refOfOpen, meetingRef, planOverlaps, reasonOf, OVERLAP_WEEK_TEXT as OV} from './overlap-weekly.mjs';

// The reads behind each part (journal.js materials keys; 'lines' is the journal's own lines read).
// 'upcoming' is the two-week calendar read of 5. 주요 일정 (journal-data.js readScheduleEvents).
export const WEEKLY_SOURCES = Object.freeze({
  requests:['execRequests'], summary:['basket', 'projectUpdates', 'catalog'], meetings:['meetings'], orgs:['basket', 'orgUpdates'], calendar:['upcoming'],
  lines:['lines'], tasks:['tasks'], due:['tasks'], docs:['documents'], shares:['sharePages'], memos:['basket'],
});
const state = (materials, sources) => {
  const states = sources.map(source => materials?.[source]);
  if (states.some(s => !s || s.status === 'loading')) return {loading:true, failed:[]};
  return {loading:false, failed:sources.filter((_, i) => states[i].status !== 'ok'), capped:states.some(s => s.status === 'ok' && s.items?.capped)};
};
const ok = (materials, source) => materials?.[source]?.status === 'ok' ? materials[source].items : null;

// 사업영역 → 세부 과제 rows of the week. tree: the project catalog's [{project, depth}] (null when it could not be read).
// records: [{id, name, day, at, text, requests}]. Returns {areas:[{id, name, rows:[{task, items}]}], others:[{name, items}],
// quiet:[area names without a record]}; without the tree every record goes under its project name in `others`.
export function placeRecords(records, tree) {
  const nodes = new Map(), areas = [], byArea = new Map();
  if (Array.isArray(tree)) {
    let area = null, task = null, order = 0;
    for (const {project, depth} of tree) {
      const name = String(project?.name || '').trim() || '이름 없는 프로젝트';
      if (depth === 0) { area = {id:project.id, name, rows:[]}; areas.push(area); byArea.set(project.id, area); task = null; }
      else if (depth === 1) task = {id:project.id, name};
      if (!area) continue;
      // Deeper than 3단 (the screen does not make it) is treated as a 사안 of the nearest 세부 과제.
      nodes.set(project.id, {area, task:depth === 0 ? null : task, issue:depth >= 2 ? name : null, order:order++});
    }
  }
  const others = new Map();
  const ordered = records.map((record, index) => ({record, index, node:nodes.get(record.id)}))
    .sort((a, b) => (a.node?.order ?? 0) - (b.node?.order ?? 0) || String(a.record.day).localeCompare(String(b.record.day)) || Date.parse(a.record.at) - Date.parse(b.record.at) || a.index - b.index);
  for (const {record, node} of ordered) {
    const item = {day:record.day, text:record.text, requests:record.requests || [], ...(record.file ? {file:record.file} : {})};
    if (!node) {
      const name = record.name || UNSORTED;
      if (!others.has(name)) others.set(name, {items:[], folded:[], dropped:[]});
      others.get(name)[item.file ? fileBucket(item) : 'items'].push(item);
      continue;
    }
    // The report line: "세부과제 › 사안: 내용" for a 3단 record, "세부과제: 내용" for a 2단 one (summaryLine). On screen the 세부 과제
    // column already names the 2단, so only a 사안 shows its label there (`issue`).
    item.label = node.task ? (node.issue ? `${node.task.name} › ${node.issue}` : node.task.name) : '';
    item.issue = !!node.issue;
    const key = node.task?.id || '';
    let row = node.area.rows.find(r => (r.task?.id || '') === key);
    if (!row) { row = {task:node.task, items:[], folded:[], dropped:[]}; node.area.rows.push(row); }
    // WEEKLY-자료요약: 기록과 같아 접힌 자료 줄은 그 줄의 folded에만(화면의 "기록과 같아 뺀 자료 N"; 복사·한글 파일 후보에는 없음).
    // 화면 ②: [빼기]한 자료 줄은 dropped("뺀 자료 N")에만.
    row[item.file ? fileBucket(item) : 'items'].push(item);
  }
  for (const area of areas) {
    const at = id => id ? [...nodes.values()].find(n => n.task?.id === id && !n.issue)?.order ?? Infinity : -1;
    area.rows.sort((a, b) => at(a.task?.id) - at(b.task?.id));
  }
  return {areas:areas.filter(area => area.rows.length), others:[...others].map(([name, {items, folded, dropped}]) => ({name, items, ...(folded.length ? {folded} : {}), ...(dropped.length ? {dropped} : {})})).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    quiet:areas.filter(area => !area.rows.length).map(area => area.name)};
}
// The text of one 요약 item as the report writes it: "세부과제: 내용", "세부과제 › 사안: 내용", or the bare text on the area row.
export const summaryLine = item => item.label ? `${item.label}: ${item.text}` : item.text;

// ---- 5. 주요 일정 ----
const parts_ = dayParts;
// "■ 일시" of the report: the report day (상집 보고일 — the Monday after the shown week) as "2026년 10월 12일(월)", the form's
// date line (weekly-hwpx draft.mjs reportDate writes the same).
export const reportDateText = start => { const day = reportDay(start), {m, d, w} = parts_(day); return `${day.slice(0, 4)}년 ${m}월 ${d}일(${w})`; };
// The form's day cell: "10.19.(월)" (weekly-exec-requests.js formDay, shared with the request table); the screen's vacation line: "10/19(월)".
export {formDay};
const slashDay = day => { const {m, d, w} = parts_(day); return `${m}/${d}(${w})`; };
const span = (first, last, one, joint) => first === last ? one(first) : `${one(first)}${joint}${one(last)}`;
// A vacation is told by its title (휴가·연차·반차·반반차·월차·병가·공가·휴무). An event whose title or memo says 일기 or 비공개 is
// not report material and is left out. (The calendar read carries no Google "private" visibility, so the mark is in the text.)
export const VACATION_WORDS = /휴가|연차|반차|월차|병가|공가|휴무/;
export const PRIVATE_WORDS = /일기|비공개/;
export const isVacation = event => VACATION_WORDS.test(String(event?.title ?? ''));
// 주요 일정 takes only the work calendar (WEEKLY-출력정리 ③, 2026-10-23 사용자 지적 12:25 — 업무 일정은 '공공운수노조' 달력에 있음). Before,
// two personal calendars were left out by name (RPT-개인일정빼기); every other calendar — and an event whose calendar name was unknown —
// still came in, so personal events and matches from any other calendar reached the table. Now: by calendar NAME (the id is an account
// value and this repository is public; the id → name list is read with the events every time, journal-data.js readScheduleEvents),
// compared without case and spacing differences. No calendar → the table is empty and the screen (only) says so. The calendar screen
// itself is unchanged. One rule for the screen table and the .hwpx draft (both read upcomingSchedule).
export const REPORT_CALENDAR = '공공운수노조';
const calendarKey = name => String(name ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
const REPORT_KEY = calendarKey(REPORT_CALENDAR);
export const isReportCalendar = event => calendarKey(event?.calendarName) === REPORT_KEY;
// events.calendarNames (readScheduleEvents): every calendar name of the account; when it is known and holds no 공공운수노조, noCalendar.
export const hasReportCalendar = events => (Array.isArray(events?.calendarNames) ? events.calendarNames.some(name => calendarKey(name) === REPORT_KEY) : null);
export const isPrivateEvent = event => PRIVATE_WORDS.test(`${event?.title ?? ''}\n${event?.description ?? ''}`);
// The days an event covers (Korea time): an all-day event ends the day before its (exclusive) end date.
function eventDays(event) {
  if (event.allDay) {
    const first = String(event.start).slice(0, 10), end = String(event.end || '').slice(0, 10);
    return {first, last:end > first ? seoulDateKey(addSeoulDays(end, -1)) : first};
  }
  const s = Date.parse(event.start), e = Date.parse(event.end || event.start);
  if (!Number.isFinite(s)) return {first:'', last:''};
  const first = seoulDateKey(new Date(s));
  return {first, last:Number.isFinite(e) && e > s ? seoulDateKey(new Date(e - 1)) : first};
}
// The two weeks' events in the form's order: by day; on one day the one-day events (종일 first, then by time), then those that
// run over several days (their day cell is "첫날 ~끝날", as the confirmed reports write it). An event that began before the two
// weeks sits on the first day. Returns {days, rows:[{day, label, items:[{what, multi}]}], vacations:[{first, last, title}]}.
export function upcomingSchedule(events, start) {
  const days = scheduleDays(start), from = days[0], to = days[days.length - 1];
  const seen = new Set(), list = [], vacations = [];
  for (const event of events || []) {
    if (!event?.start) continue;
    const key = event.id ? `${event.calendarId || ''}:${event.id}` : null;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    if (!isReportCalendar(event) || isPrivateEvent(event)) continue;
    const {first, last} = eventDays(event);
    if (!first || last < from || first > to) continue;
    const title = String(event.title || '').trim() || '(제목 없음)';
    if (isVacation(event)) { vacations.push({first, last, title}); continue; }
    const time = event.allDay ? '종일' : seoulClock(event.start), place = String(event.location || '').trim();
    // key: the event's own id (WEEKLY-일정다듬기 — the .hwpx title check keeps what was confirmed per event); time/title/place: the parts
    // of the form cell (weekly-hwpx/schedule.mjs formWhat). `what` stays the screen and copy text as before.
    list.push({day:first < from ? from : first, first, last, multi:first !== last, allDay:!!event.allDay, at:event.allDay ? 0 : Date.parse(event.start), title, time, place,
      key:key || `${first}|${time}|${title}`, what:[time, title, place].filter(Boolean).join(' / ')});
  }
  list.sort((a, b) => a.day.localeCompare(b.day) || a.multi - b.multi || (a.multi && a.last.localeCompare(b.last)) || b.allDay - a.allDay || a.at - b.at || a.title.localeCompare(b.title, 'ko'));
  const rows = [];
  for (const item of list) {
    const label = span(item.first, item.last, formDay, ' ~ ');
    const row = rows.at(-1)?.label === label ? rows.at(-1) : (rows.push({day:item.day, label, items:[]}), rows.at(-1));
    row.items.push({what:item.what, multi:item.multi, key:item.key, time:item.time, title:item.title, place:item.place});
  }
  vacations.sort((a, b) => a.first.localeCompare(b.first) || a.last.localeCompare(b.last));
  return {days, rows, vacations, noCalendar:hasReportCalendar(events) === false};
}
// "※ 휴가: 10/23(금) 연차, 10/27(화)~10/28(수) 휴가" (screen and copy), or '' without one.
export const vacationLine = vacations => vacations?.length ? `※ 휴가: ${vacations.map(v => `${span(v.first, v.last, slashDay, '~')} ${v.title}`).join(', ')}` : '';
// The form's 5. 주요 일정 table (weekly-hwpx report.mjs calendar/calendarNotes): every one of the 14 days in a row of its own, as
// the personal reports write it (a day without an event keeps its date with empty cells), a several-day event on its own row
// after its first day, 참석자 = my name. Vacations become "※ 10.23.(금) 이름 연차" lines under the table.
// WEEKLY-일정다듬기 ③(2026-10-23 사용자 요청 12:43 ④): the cell is always "시간 / 내용 / 장소" (no place → '미정'); titles·places the owner
// confirmed on the .hwpx screen (overrides: Map(event key → {title, place})) replace the calendar's (weekly-hwpx/schedule.mjs itemWhat).
// WEEKLY-환류: an event without an override takes its remembered title (item.memo, weekly-schedule-memory.js annotateCalendar); events
// left out (remembered or this week only) are not in calendar.rows — a day left with none keeps its date and empty cells.
export function scheduleForm(calendar, me = '', overrides = null) {
  const what = i => { const own = overrides?.get?.(i.key), memo = own ? null : memoryTitle(i); return itemWhat(i, own || !memo ? overrides : new Map([[i.key, memo]])); };
  const who = me ? [me] : [];
  const out = [];
  const ready = calendar && !calendar.loading && !calendar.failed?.length;
  for (const day of calendar?.days || []) {
    const rows = ready ? calendar.rows.filter(r => r.day === day) : [];
    const single = rows.filter(r => !r.items[0]?.multi);
    out.push({day:formDay(day), items:single.flatMap(r => r.items.map(i => ({what:what(i), who:[...who]})))});
    for (const r of rows.filter(r => r.items[0]?.multi)) out.push({day:r.label, items:r.items.map(i => ({what:what(i), who:[...who]}))});
  }
  const notes = ready ? calendar.vacations.map(v => `※ ${span(v.first, v.last, formDay, '~')} ${me && !v.title.includes(me) ? `${me} ` : ''}${v.title}`) : [];
  return {calendar:out, calendarNotes:notes};
}

// The whole week in report order. lines: Map(day → journal row) or null when they could not be read.
// kinds: JOURNAL-회의종류표시 — {status:'ok', list} = the kinds left out of 회의·활동 결과 (journal-meeting-kinds.js); {status:'loading'} keeps
// that part "loading" until the list is read; anything else (not given, unreadable) reports every meeting as before.
// memory: WEEKLY-환류 — {status:'ok', list} = 주간보고 기억(weekly-schedule-memory.js), applied to 5. 주요 일정 (renamed, left out);
// {status:'loading'} keeps that part loading; anything else = no memory (the calendar's titles as before).
export function weeklySummary({start, lines, linesState = 'ok', materials = {}, doneDays = DONE_TASK_DAYS, today = todayKey(), kinds = null, memory = null}) {
  const days = weekDays(start), m = {...materials, lines:{status:linesState === 'loading' ? 'loading' : linesState === 'ok' ? 'ok' : 'failed', items:lines}};
  const part = (key, build) => { const s = state(m, WEEKLY_SOURCES[key]); return {key, ...s, ...(s.loading ? {} : build(s))}; };
  const perDay = (source, pick) => { const read = ok(m, source); return read ? days.flatMap(day => pick(read, day).map(text => ({day, text}))) : []; };
  const files = weekFiles(m, days);
  // MTG-기록겹침거르기 4단계(docs/design/record-overlap.md 4.2절): 이 주에 보이는 줄에 겹침 참조를 달고, 저장된 same 판정(m.overlaps)으로
  // 겹친 줄을 한 곳에서 뺀다. 요약·조직 소식·화면·초안 복사·한글 파일이 모두 이 모델을 쓰므로 한 번에 같은 결과가 된다.
  const rawRecords = (ok(m, 'basket') || ok(m, 'projectUpdates')) ? days.flatMap(day => projectRecordsOn({basket:ok(m, 'basket'), projectUpdates:ok(m, 'projectUpdates')}, day).map(r => ({...r, day, ref:refOfOpen(r.open)}))) : [];
  const rawOrg = days.flatMap(day => orgNewsOn({basket:ok(m, 'basket'), orgUpdates:ok(m, 'orgUpdates')}, day, {open:true}).flatMap(section =>
    section.items.map((text, i) => ({day, name:section.name, text, requests:section.tags?.[i] || [], ref:refOfOpen(section.opens?.[i]), open:section.opens?.[i] || null}))));
  const rawMeetings = kinds?.status === 'loading' ? [] : (() => {
    const list = kinds?.status === 'ok' ? kinds.list : null, read = ok(m, 'meetings'), items = [], off = new Map();
    for (const day of days) for (const meeting of read ? meetingsOn(read, day) : []) {
      const name = meetingKindName(meeting), key = meetingKindKey(name);
      if (!reportsMeeting(meeting, list)) { const entry = off.get(key) || off.set(key, {key, name, count:0}).get(key); entry.count++; continue; }
      items.push({day, text:meetingLine(meeting), kind:key, kindName:name, ref:meetingRef(meeting.id), targets:meeting.link_targets || []});
    }
    return {items, off:[...off.values()]};
  })();
  const ovRows = m.overlaps?.status === 'ok' && !m.overlaps.items?.missing ? m.overlaps.items.rows : null;
  const shownRefs = new Set([...rawRecords, ...rawOrg, ...(rawMeetings.items || [])].map(i => i.ref).filter(Boolean));
  const gone = ovRows ? planOverlaps(shownRefs, ovRows) : new Map();
  const meetingText = new Map((rawMeetings.items || []).map(i => [i.ref, i]));
  // 뺀 줄 → 화면 [보기] 한 줄: 남긴 사업 보고(들)와 AI 이유 한 줄. 되살리기는 ref로 journal.js가 처리한다.
  const goneItem = (item, part) => { const entry = gone.get(item.ref); const kept = entry.keep.map(ref => meetingText.get(ref)).filter(Boolean);
    return {ref:item.ref, part, day:item.day, text:item.text, label:item.label || item.name || '', kept:kept.map(k => ({day:k.day, text:k.text})), reason:reasonOf(entry)}; };
  const dropped = {summary:[], orgs:[]};
  const keep = (item, part) => { if (!item.ref || !gone.has(item.ref)) return true; if (!dropped[part].some(x => x.ref === item.ref)) dropped[part].push(goneItem(item, part)); return false; };
  // WEEKLY-자료요약 화면 ②: 그 주 임시저장의 자료 줄 고침(빼기·고치기·넣기). 칸이 없거나 읽지 못하면 고침 없음·버튼 없음.
  const draftRead = m.weekDraft?.status === 'ok' ? m.weekDraft.items : null;
  const edits = draftRead && !draftRead.missing ? docEdits(draftRead.row?.draft) : new Map();
  const fileEdits = {editable:!!draftRead && !draftRead.missing, loading:!m.weekDraft || m.weekDraft.status === 'loading', row:draftRead?.row ?? null};
  const editFile = item => applyDocEdit(item, edits.get(item.file.id));

  const summary = part('summary', s => {
    const all = rawRecords, records = all.filter(r => keep(r, 'summary'));
    const tree = ok(m, 'catalog');
    // WEEKLY-자료요약: 프로젝트에만 연결된 자료 → 그 프로젝트 줄(placeRecords가 자리를 찾음). 같은 프로젝트의 그 주 기록과 비교한다.
    const fileRecords = files.projects.map(({doc, id, name}) => {
      const day = seoulDay(doc.created_at);
      const item = editFile(fileItem(doc, day, fileVerdict(doc, {records:all.filter(r => r.id === id).map(r => r.text), attached:files.attachedProjects.get(id)})));
      return {id, name, day, at:doc.created_at, text:item.text, requests:[], file:item.file};
    });
    const shown = fileRecords.filter(r => fileBucket(r) === 'items').length;
    return {...placeRecords([...records, ...fileRecords], tree), ordered:!!tree, count:records.length + shown, failed:s.failed, overlapped:dropped.summary};
  });

  // 회의·활동 결과: a meeting whose kind (series name, else title, without spaces, lower-case) is in my "not reported" list is left out
  // here, in the draft copy and wherever else this grouping is used. Items carry their kind so the screen can offer the switch;
  // `hidden` = the kinds left out this week (name, count) so they can be put back; `editable` only when the list was read.
  const meetings = part('meetings', () => {
    if (kinds?.status === 'loading') return {loading:true, items:[], hidden:[], editable:false};
    return {items:rawMeetings.items.map(({targets, ref, ...item}) => ref ? {...item, ref} : item), hidden:rawMeetings.off, editable:kinds?.status === 'ok' && !!kinds.list};
  });

  // JOURNAL-조직현황AI요약: a named organization section (its id found by name in the organization read) carries the week's
  // saved summary (journal-org-summary.js) when there is one. `summaries`: 'loading' | 'ok' | 'failed' | 'missing' (no table yet —
  // the part shows the records as before, without the summary button).
  const orgs = part('orgs', s => {
    const read = {basket:ok(m, 'basket'), orgUpdates:ok(m, 'orgUpdates')};
    const sections = new Map();
    if (s.failed.length < WEEKLY_SOURCES.orgs.length) for (const entry of rawOrg) {
      if (!keep(entry, 'orgs')) continue;
      if (!sections.has(entry.name)) sections.set(entry.name, {name:entry.name, items:[], folded:[], dropped:[]});
      sections.get(entry.name).items.push({day:entry.day, text:entry.text, requests:entry.requests});
    }
    // 자료 읽기는 이 묶음의 재료가 아니다(읽는 중·실패면 자료 줄 없이 기록만, 자료는 '참고 › 자료실 새 자료'가 상태를 보여 줌).
    // WEEKLY-자료요약: 담당조직에 연결된 자료 → 그 조직 칸에만(프로젝트에도 연결돼 있어도, Q3 ①). 내 담당이 아니면 '그 외'에 "조직 이름 · …".
    // 비교는 그 칸의 그 주 기록(자료 줄을 넣기 전)과 한다. 같으면 접고, 날짜·올린 시각 순으로 기록 뒤에 둔다.
    const recordsOf = new Map([...sections].map(([name, sec]) => [name, sec.items.map(item => item.text)]));
    for (const {doc, id, name, others} of files.orgs) {
      const key = others ? OTHERS : name, day = seoulDay(doc.created_at);
      if (!sections.has(key)) sections.set(key, {name:key, items:[], folded:[], dropped:[]});
      const item = editFile(fileItem(doc, day, fileVerdict(doc, {records:recordsOf.get(key) || [], attached:files.attachedOrgs.get(id)})));
      if (others) { item.text = `${name} · ${item.text}`; if (item.file.original) item.file.original = `${name} · ${item.file.original}`; }
      const sec = sections.get(key);
      sec[fileBucket(item)].push(item);
    }
    for (const sec of sections.values()) sec.items.sort((a, b) => String(a.day).localeCompare(String(b.day)));
    const sm = m.orgSummaries, saved = sm?.status === 'ok' && !sm.items?.missing ? sm.items : null;
    const summaries = !sm || sm.status === 'loading' ? 'loading' : sm.status !== 'ok' ? 'failed' : sm.items?.missing ? 'missing' : 'ok';
    const ids = new Map();
    for (const org of read.orgUpdates?.orgs || []) if (org?.id && !ids.has(String(org.name || '').trim())) ids.set(String(org.name || '').trim(), String(org.id).toLowerCase());
    for (const section of sections.values()) {
      const id = section.name !== UNSORTED && section.name !== OTHERS ? ids.get(section.name) : null;
      if (!id) continue;
      section.id = id;
      const row = saved?.get?.(id);
      if (row) section.summary = {text:row.summary, edited:row.edited};
    }
    return {sections:[...sections.values()].sort(compareOrgSections), summaries, overlapped:dropped.orgs};
  });

  const calendar = part('calendar', () => memory?.status === 'loading' ? {loading:true}
    : annotateCalendar(upcomingSchedule(ok(m, 'upcoming'), start), memory?.status === 'ok' ? memory.list : null));
  // 주간보고 기억 목록(맨 아래 접힘): 일정 이름·일정 빼기(내 프로필 칸) + 회의 종류 빼기 전체(지금은 그 주에 걸린 것만 보이던 것).
  const remembered = {ready:memory?.status === 'ok', entries:memory?.status === 'ok' ? memory.list : [], kinds:kinds?.status === 'ok' ? kinds.list : null, today};
  // 1. 요청사항 › 1) 임원 일정 배정·논의 요청: the week's saved rows (weekly-exec-requests.js readExecRequests → {missing, row}).
  const requests = part('requests', () => {
    const read = ok(m, 'execRequests');
    return {missing:!!read?.missing, row:read?.row ?? null, items:sortItems(read?.row?.items ?? [])};
  });

  const notes = {
    lines:part('lines', () => ({items:perDay('lines', (read, day) => workLines(read?.get?.(day)))})),
    tasks:part('tasks', () => ({items:perDay('tasks', (read, day) => tasksOn(read, day).map(task => task.title || '(제목 없음)')),
      ...(days[0] < doneCoverFrom(doneDays, today) ? {note:`Google 할 일은 최근 ${doneDays}일 안에 끝낸 것만 모여요.`} : {})})),
    // 할 일 예정 by due day in this week (the server sends overdue and up to 6 days ahead only).
    due:part('due', () => ({items:perDay('tasks', (read, day) => pendingOn(read, day).map(task => task.title || '(제목 없음)')),
      ...(days[6] > pendingCoverTo(today) ? {note:`할 일 예정은 오늘부터 ${PENDING_DAYS}일 안 마감만 모여요.`} : {})})),
    // 조직 칸·프로젝트 줄로 간 자료는 여기서 뺀다(두 번 안 보이게). 회의자료·연결 없는 자료는 그대로.
    docs:part('docs', () => ({items:perDay('documents', (read, day) => read.filter(doc => !files.placed.has(doc?.id) && seoulDay(doc?.created_at) === day).map(documentLine))})),
    shares:part('shares', () => ({items:perDay('sharePages', (read, day) => read.filter(page => seoulDay(page?.updated_at) === day).map(sharePageLine))})),
    memos:part('memos', () => ({items:perDay('basket', (read, day) => journalMemosOn(read, day))})),
  };
  // overlap: checking = 겹침 확인 중(그동안은 아무것도 빼지 않는다), count = 이번 주에 뺀 줄 수.
  const overlap = {checking:m.overlaps?.status === 'loading', count:dropped.summary.length + dropped.orgs.length};
  // 겹침 확인 재료(journal.js가 AI에 물을 짝을 고를 때만 쓴다): 이 주에 보이는 줄의 참조와, 서로 이어질 만한지 보는 글·곳.
  const target = (kind, id) => id ? {kind, id} : null;
  const overlapSource = {refs:[...shownRefs], meetings:(rawMeetings.items || []).filter(i => i.ref).map(i => ({ref:i.ref, day:i.day, title:i.text, targets:i.targets})),
    records:[...rawRecords.map(r => ({ref:r.ref, day:r.day, text:r.text, title:'', target:target('project', r.id)})),
      ...rawOrg.map(r => ({ref:r.ref, day:r.day, text:r.text, title:'', target:target('organization', r.open?.org)}))].filter(r => r.ref)};
  return {start, days, requests, summary, meetings, orgs, calendar, notes, remembered, fileEdits, overlap, overlapSource};
}
const seoulDay = value => value && Number.isFinite(Date.parse(value)) ? seoulDateKey(value) : '';

// WEEKLY-자료요약: 그 주 자료의 자리(weekly-file-lines.mjs placeFiles). 조직 이름은 조직 읽기(orgUpdates.orgs·mine), 프로젝트는 트리에서.
// 그 칸에 이미 보이는 바구니 업데이트의 첨부 파일 id(조직·프로젝트별)도 모은다('비슷한 기록 있음' 판단). 읽지 못한 재료가 있으면
// 그 자료는 지금처럼 '참고'에 남는다(어느 경우에도 빠지지 않음).
function weekFiles(m, days) {
  const docs = ok(m, 'documents') || [], updates = ok(m, 'orgUpdates'), tree = ok(m, 'catalog'), basket = ok(m, 'basket');
  const names = new Map((updates?.orgs || []).map(org => [String(org.id).toLowerCase(), String(org.name || '').trim() || '조직']));
  const projects = new Map((Array.isArray(tree) ? tree : []).map(({project}) => [String(project?.id), String(project?.name || '').trim() || '이름 없는 프로젝트']));
  const week = docs.filter(doc => days.includes(seoulDay(doc?.created_at)));
  const placed = placeFiles(week, {orgs:{names, mine:updates?.mine instanceof Set ? new Set([...updates.mine].map(id => String(id).toLowerCase())) : null}, projects});
  const attachedOrgs = new Map(), attachedProjects = new Map();
  const put = (map, id, file) => { if (!id || !file) return; const key = String(id); if (!map.has(key)) map.set(key, new Set()); map.get(key).add(String(file)); };
  const byFile = new Map((basket?.docs || []).map(doc => [doc.file_id, doc]));
  for (const memo of basket?.notes || []) {
    if (!days.includes(seoulDay(memo?.occurred_at))) continue;
    const files = (Array.isArray(memo.attachments) ? memo.attachments : []).map(f => String(f?.drive_file_id || '')).filter(Boolean);
    if (!files.length) continue;
    const links = (basket.links || []).filter(link => link.note_id === memo.id && link.status === 'confirmed');
    const orgIds = new Set([...links.map(l => l.organization_id), ...files.map(f => byFile.get(f)?.organization_id)].filter(Boolean).map(id => String(id).toLowerCase()));
    const projectIds = new Set([...links.filter(l => !l.organization_id).map(l => l.project_id), ...files.map(f => byFile.get(f)?.project_id)].filter(Boolean).map(String));
    for (const file of files) { for (const id of orgIds) put(attachedOrgs, id, file); for (const id of projectIds) put(attachedProjects, id, file); }
  }
  // 같은 지문으로 합쳐 줄이 안 된 자료도 '참고'에 다시 나오지 않게 지문으로 같이 뺀다.
  const placedHashes = new Set([...placed.orgs, ...placed.projects].map(p => p.doc.brief?.hash).filter(Boolean));
  const placedIds = new Set([...placed.orgs, ...placed.projects].map(p => p.doc.id));
  for (const doc of week) if (!doc.meeting_id && doc.brief?.hash && placedHashes.has(doc.brief.hash)) placedIds.add(doc.id);
  return {orgs:placed.orgs, projects:placed.projects, placed:placedIds, attachedOrgs, attachedProjects};
}

export const orgSummaryLines = text => String(text ?? '').split('\n').map(line => line.trim()).filter(Boolean);

// ---- [주간보고 초안 복사] (2026-10-21 사용자 승인: 날짜순이 아니라 양식 순서) ----
// The same grouping as the tab, as text in the form's order: 1. 요청사항 → 2. 사업 → 4. 산하 조직 → 5. 주요 일정 → 참고. A part
// that is still loading or failed says so in its place, and the end names what could not be read.
const LABELS = Object.freeze({requests:'임원 일정 배정·논의 요청', summary:'프로젝트 기록', meetings:'회의·활동 결과', orgs:'조직 소식', calendar:'달력 일정', lines:'한 줄'});
export function weeklyReportText(model) {
  const {days} = model, out = [`주간 업무일지 ${shortDay(days[0])} ~ ${shortDay(days[6])}`, `■ 일시 : ${reportDateText(model.start)}`, ''];
  const item = (i, text = i.text) => `- ${shortDay(i.day)} ${requestPrefix(i.requests)}${text}`;
  const gap = (part, key) => part.loading ? '(불러오는 중)' : !part.failed?.length ? '' : part.failed.length < WEEKLY_SOURCES[key].length ? '(일부를 불러오지 못함)' : '(불러오지 못함)';
  const missing = [];
  const note = (key, part, label = LABELS[key]) => { const g = gap(part, key); if (g) { out.push(g); if (!part.loading) missing.push(label); } return !!part.loading || (part.failed?.length || 0) >= WEEKLY_SOURCES[key].length; };
  out.push('1. 요청사항', `1) 임원 일정 배정·논의 요청 (${EXEC_HEAD.join(' | ')})`);
  // The saved rows in the form's order and cells; the carried mark is not copied.
  const r = model.requests;
  if (!note('requests', r)) { for (const i of r.items) out.push(requestLine(i)); if (!r.items.length) out.push(r.missing ? '(요청 표 저장 칸 준비 전)' : '(요청 없음)'); }
  out.push(`2) 주요 일정: (비워 둠) ${HQ_SCHEDULE_GUIDE}`, '');
  out.push('2. 기본·영역·의제 사업', '1) 요약');
  const s = model.summary;
  if (!note('summary', s)) {
    for (const area of s.areas) { out.push(`◦ ${area.name}`); for (const row of area.rows) for (const i of row.items) out.push(item(i, summaryLine(i))); }
    for (const other of s.others) { out.push(`◦ ${s.ordered ? '사업영역 밖 · ' : ''}${other.name}`); for (const i of other.items) out.push(item(i)); }
    if (!s.count && !s.failed.some(k => k !== 'catalog')) out.push('(이 주 프로젝트 기록 없음)');
  }
  out.push('2) 세부 내용 — 회의·활동 결과');
  if (!note('meetings', model.meetings)) { for (const i of model.meetings.items) out.push(item(i)); if (!model.meetings.items.length) out.push('(이 주 회의·활동 없음)'); }
  out.push('', '4. 산하 조직 현황', '1) 요약');
  // An organization with a summary (JOURNAL-조직현황AI요약) gives its summary lines (no day); the others give their records.
  if (!note('orgs', model.orgs)) {
    for (const section of model.orgs.sections) {
      out.push(`◦ ${section.name}`);
      if (section.summary) for (const line of orgSummaryLines(section.summary.text)) out.push(`- ${line}`);
      else for (const i of section.items) out.push(item(i));
    }
    if (!model.orgs.sections.length) out.push('(이 주 조직 소식 없음)');
  }
  const c = model.calendar;
  out.push('', `5. 주요 일정 (${c.days?.length ? `${shortDay(c.days[0])} ~ ${shortDay(c.days.at(-1))}` : '다음 주 월요일부터 2주'})`);
  if (!note('calendar', c)) {
    for (const row of c.rows) for (const i of row.items) out.push(`- ${row.label} ${i.what}`);
    if (!c.rows.length) out.push('(이 2주 달력 일정 없음)');
    const off = vacationLine(c.vacations); if (off) out.push(off);
  }
  out.push('', '참고');
  for (const [key, label] of NOTE_PARTS) {
    const part = model.notes[key];
    if (part.loading || part.failed?.length) { out.push(`◦ ${label}`); out.push(gap(part, key)); if (!part.loading) missing.push(label); continue; }
    if (!part.items.length && !part.note) continue;
    out.push(`◦ ${label}`);
    for (const i of part.items) out.push(item(i));
    if (part.note) out.push(`※ ${part.note}`);
  }
  out.push('');
  if (missing.length) out.push(`※ ${[...new Set(missing)].join(', ')}은(는) 불러오지 못해 빠졌어요.`);
  const capped = [...[['summary', LABELS.summary], ['orgs', LABELS.orgs], ['meetings', LABELS.meetings]].map(([k, l]) => [model[k], l]), ...NOTE_PARTS.map(([k, l]) => [model.notes[k], l])]
    .filter(([part]) => part?.capped).map(([, l]) => l);
  if (capped.length) out.push(`※ ${capped.join(', ')}은(는) 이 주에 ${WEEK_READ_CAP}개가 넘어 앞의 ${WEEK_READ_CAP}개만 모였어요.`);
  return out.join('\n').replace(/\n+$/, '') + '\n';
}

// ---- screen (called by journal.js only) ----
export const FILE_TAG = '자료';
export const NOTE_PARTS = Object.freeze([['lines', '한 줄'], ['tasks', '끝낸 할 일'], ['due', '할 일 예정'], ['docs', '자료실 새 자료'], ['shares', '공유 페이지'], ['memos', '기타 메모']]);
// 1. 2) 주요 일정: what goes there (its rule is not settled; nothing is filled in yet).
export const HQ_SCHEDULE_GUIDE = '본부 주요 일정 — 기자회견·주요 회의·토론회·집회·교육 등, 특정 사업장·반복 일정 제외. 자동 채우기는 나중에';
const rangeTitle = calendar => `${shortDay(calendar.days[0])} ~ ${shortDay(calendar.days.at(-1))} · 다음 주 월요일부터 2주`;
// orgUi (JOURNAL-조직현황AI요약, journal.js keeps it): {busy, status, error, editing:{id, value, status, invalid, saving}, open:Set(names)}.
export const ORG_EDIT_MAX_LINES = 8;
// execUi (WEEKLY-임원요청정리, journal.js keeps it): {editing:null | 'new' | row id, draft:{day, until, time, what, place, who},
// status, error, invalid (field name), saving}.
export const EXEC_FIELDS = Object.freeze([['day', '일', 'date'], ['until', '끝 날(여러 날이면)', 'date'], ['time', '시간', 'text'], ['what', '내용', 'text'], ['place', '장소', 'text'], ['who', '참석 요청', 'text']]);
// fileUi (WEEKLY-자료요약 화면 ②, journal.js keeps it): {editing:자료 id | null, value, saving, status, error}.
export const FILE_EDIT_MAX = 200;
export function renderWeekly(host, model, esc, orgUi = {}, execUi = {}, memoryUi = {}, fileUi = {}, overlapUi = {}) {
  const doc = host.ownerDocument;
  const el = (tag, cls, text) => { const node = doc.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };
  const muted = text => el('p', 'journal-muted', text);
  const dayTag = day => el('span', 'journal-weekly-day', shortDay(day));
  const itemList = (items, inTable = false, line = item => item.text) => {
    const list = el('ul', 'journal-weekly-list');
    for (const item of items) {
      const li = el('li');
      li.append(dayTag(item.day));
      if (item.requests?.length) li.insertAdjacentHTML('beforeend', requestTagsHtml(item.requests, esc));
      if (item.label && (item.issue || !inTable)) li.append(el('span', 'journal-weekly-label', `${item.label}: `));
      if (item.file) fileLine(li, item, line(item)); else li.append(doc.createTextNode(line(item)));
      list.append(li);
    }
    return list;
  };
  // WEEKLY-자료요약: 자료 줄은 작은 '자료' 꼬리표(화면에만, Q5 ①) + 누르면 자료실의 그 자료가 열리는 글. 비슷한 기록이 있으면 작게 표시만.
  // 화면 ②: 줄 끝 작은 ⋯ 안에 [고치기]·[빼기](그 주 임시저장 칸이 있을 때만). 고친 줄은 작은 '고침' 표시(원래 줄은 표시의 title).
  const fe = model.fileEdits ?? {}, canEdit = !!fe.editable && !fileUi.saving;
  function fileLine(li, item, text) {
    li.dataset.journalWeeklyFile = item.file.id;
    const tag = el('span', 'journal-file-tag', FILE_TAG); tag.dataset.journalFileTag = ''; li.append(tag, ' ');
    if (fileUi.editing === item.file.id) { li.append(fileEditForm(item)); return; }
    const open = el('button', 'journal-file-open', text); open.type = 'button'; open.dataset.journalWeeklyFileOpen = item.file.id;
    open.setAttribute('aria-label', `${text} (자료실에서 열기)`); li.append(open);
    if (item.file.edited) { const n = el('span', 'journal-file-note', '고침'); n.title = `원래: ${item.file.original}`; n.dataset.journalFileEdited = ''; li.append(' ', n); }
    if (item.file.same > 1) { const n = el('span', 'journal-file-note', `같은 파일 ${item.file.same}번`); n.dataset.journalFileSame = ''; li.append(' ', n); }
    if (item.file.verdict === 'similar') { const n = el('span', 'journal-file-note', '비슷한 기록 있음'); n.dataset.journalFileSimilar = ''; li.append(' ', n); }
    if (item.file.kept) { const n = el('span', 'journal-file-note', '넣음'); n.dataset.journalFileKept = ''; li.append(' ', n); }
    if (!fe.editable || item.file.dropped || (item.file.verdict === 'same' && !item.file.kept)) return;
    const more = el('details', 'journal-kind-more'); more.dataset.journalFileMore = item.file.id;
    const sum = el('summary', null, '⋯'); sum.setAttribute('aria-label', `${text} 자료 줄 고치기·빼기`);
    const edit = el('button', 'mini', '고치기'); edit.type = 'button'; edit.dataset.journalFileEdit = item.file.id; edit.disabled = !canEdit;
    const drop = el('button', 'mini', '빼기'); drop.type = 'button'; drop.dataset.journalFileDrop = item.file.id; drop.disabled = !canEdit;
    drop.setAttribute('aria-label', `이번 주 보고에서 빼기: ${text}`);
    more.append(sum, edit, drop);
    if (item.file.kept) { const back = el('button', 'mini', '다시 접기'); back.type = 'button'; back.dataset.journalFileUnkeep = item.file.id; back.disabled = !canEdit; more.append(back); }
    li.append(' ', more);
  }
  // [고치기]: 그 줄 자리의 한 줄 칸 + [저장][취소]([원래대로]는 고친 줄일 때). Enter 저장·Escape 취소는 journal.js.
  function fileEditForm(item) {
    const box = el('span', 'journal-file-edit'); box.dataset.journalFileEditRow = item.file.id;
    const input = el('input'); input.type = 'text'; input.maxLength = FILE_EDIT_MAX; input.value = fileUi.value ?? item.text; input.dataset.journalFileEditInput = item.file.id;
    input.setAttribute('aria-label', '자료 줄 고치기(이번 주 보고 글만)'); input.disabled = !!fileUi.saving;
    const save = el('button', 'mini primary', '저장'); save.type = 'button'; save.dataset.journalFileEditSave = item.file.id; save.disabled = !!fileUi.saving;
    const cancel = el('button', 'mini', '취소'); cancel.type = 'button'; cancel.dataset.journalFileEditCancel = item.file.id; cancel.disabled = !!fileUi.saving;
    box.append(input, ' ', save, cancel);
    if (item.file.edited) { const reset = el('button', 'mini', '원래대로'); reset.type = 'button'; reset.dataset.journalFileEditReset = item.file.id; reset.disabled = !!fileUi.saving; box.append(reset); }
    return box;
  }
  // 기록과 같아 접은 자료: 칸 맨 아래 늘 보이는 접힘 한 줄("기록과 같아 뺀 자료 N"). 펼치면 그 자료 줄과 [넣기](화면 ②).
  const fileFold = (items, kind) => {
    if (!items?.length) return null;
    const box = el('details', 'journal-org-raw journal-file-folded');
    box.dataset[kind === 'dropped' ? 'journalFileDropped' : 'journalFileFolded'] = String(items.length);
    if (fileUi.open?.has(`${kind}:${items.map(i => i.file.id).join(',')}`)) box.open = true;
    box.dataset.journalFileFoldKey = `${kind}:${items.map(i => i.file.id).join(',')}`;
    box.append(el('summary', null, `${kind === 'dropped' ? '뺀 자료' : '기록과 같아 뺀 자료'} ${items.length}`));
    const list = itemList(items);
    if (fe.editable) [...list.children].forEach((li, i) => {
      const b = el('button', 'mini', kind === 'dropped' ? '다시 넣기' : '넣기'); b.type = 'button'; b.disabled = !canEdit;
      b.dataset[kind === 'dropped' ? 'journalFileUndrop' : 'journalFileKeep'] = items[i].file.id;
      b.setAttribute('aria-label', `${kind === 'dropped' ? '다시 넣기' : '이번 주 보고에 넣기'}: ${items[i].text}`);
      li.append(' ', b);
    });
    box.append(list);
    return box;
  };
  const foldedFiles = items => fileFold(items, 'folded');
  const droppedFiles = items => fileFold(items, 'dropped');
  // MTG-기록겹침거르기 4단계: 겹쳐서 뺀 줄은 그 묶음 맨 아래 접힘 한 줄("겹쳐서 n건 뺐어요 · 보기"). 펼치면 뺀 줄·남긴 사업 보고·AI 이유 한 줄과 줄마다 [되살리기]
  // (사용자 판정 '같은 일 아님'으로 서버에 저장). 아무것도 지우지 않는다.
  const overlapFold = (items, part) => {
    if (!items?.length) return null;
    const box = el('details', 'journal-org-raw journal-overlap-folded');
    box.dataset.journalOverlapFold = part; box.dataset.journalOverlapCount = String(items.length);
    if (overlapUi.open?.has(part)) box.open = true;
    box.append(el('summary', null, `${OV.count(items.length)} · ${OV.show}`));
    const list = el('ul', 'journal-weekly-list');
    for (const item of items) {
      const li = el('li'); li.dataset.journalOverlapItem = item.ref;
      li.append(dayTag(item.day));
      if (item.label) li.append(el('span', 'journal-weekly-label', `${item.label}: `));
      li.append(doc.createTextNode(item.text));
      for (const k of item.kept) { const n = el('span', 'journal-file-note', `${OV.kept}: ${shortDay(k.day)} ${k.text}`); n.dataset.journalOverlapKept = ''; li.append(' ', n); }
      if (item.reason) { const n = el('span', 'journal-file-note', item.reason); n.dataset.journalOverlapReason = ''; li.append(' ', n); }
      const back = el('button', 'mini', overlapUi.busy === item.ref ? OV.reviving : OV.revive); back.type = 'button'; back.dataset.journalOverlapRevive = item.ref;
      back.disabled = !!overlapUi.busy; back.setAttribute('aria-label', `같은 일 아님, 이번 주 보고에 되살리기: ${item.text}`);
      li.append(' ', back); list.append(li);
    }
    box.append(list);
    if (overlapUi.status) { const say = el('p', 'journal-line-status', overlapUi.status); say.dataset.journalOverlapStatus = ''; say.setAttribute('role', 'status'); say.setAttribute('aria-live', 'polite'); if (overlapUi.error) say.classList.add('journal-failed'); box.append(say); }
    return box;
  };
  // A part's own loading / failure line ([다시 시도] reads only what failed); the other parts are unaffected.
  const status = (box, part, label) => {
    if (part.loading) { box.append(muted('불러오는 중…')); return true; }
    if (part.failed?.length) {
      const note = muted(`${label}${part.failed.length < WEEKLY_SOURCES[part.key].length ? ' 일부를' : '을(를)'} 불러오지 못했어요.`);
      note.classList.add('journal-failed'); note.dataset.journalFailed = '';
      const retry = el('button', 'mini', '다시 시도'); retry.type = 'button'; retry.dataset.journalWeeklyRetry = part.failed.join(' ');
      box.dataset.failed = ''; box.append(note, retry);
    }
    if (part.capped) box.append(muted(`이 주에 ${WEEK_READ_CAP}개가 넘어 앞의 ${WEEK_READ_CAP}개만 모였어요.`));
    return false;
  };
  const block = (key, title, level = 'h5') => { const box = el('section', 'journal-weekly-part'); box.dataset.journalWeekly = key; box.append(el(level, 'journal-weekly-sub', title)); return box; };
  const chapter = (key, title) => { const box = el('section', 'journal-weekly-chapter'); box.dataset.journalWeeklyChapter = key; box.append(el('h4', 'journal-heading', title)); return box; };
  const empty = text => { const p = muted(text); p.dataset.journalWeeklyEmpty = ''; return p; };

  // ■ 일시: the report day (상집 보고일), the same date the .hwpx and the draft write.
  const when = el('p', 'journal-weekly-date', `■ 일시 : ${reportDateText(model.start)} (상집 보고일)`); when.dataset.journalWeeklyDate = '';
  // 1. 요청사항: 1) the week's request rows (일 | 시간/내용/장소 | 참석 요청), each with a small [고치기]; one small [줄 추가] under the
  // table opens the same edit row (date picker, time, text, place, attendees). 2) 주요 일정 only says what goes there.
  const one = chapter('requests', '1. 요청사항');
  const ask = block('ask', '1) 임원 일정 배정·논의 요청');
  const r = model.requests;
  if (!status(ask, r, '요청 표') && !r.failed.length) {
    if (r.missing) { const p = muted('요청 표 저장 칸이 아직 준비되지 않았어요(서버 적용 전). 한글 파일에는 지난주 확정본에서 날짜가 안 지났고 내 사업장·사업과 관련된 줄만 들어가요.'); p.dataset.journalExecMissing = ''; ask.append(p); }
    else ask.append(...execTable(doc, el, r.items, execUi));
  }
  const hq = block('hq-schedule', '2) 주요 일정');
  const guide = muted(HQ_SCHEDULE_GUIDE); guide.dataset.journalWeeklyGuide = '';
  hq.append(guide);
  one.append(ask, hq);

  // 2. 기본·영역·의제 사업
  const two = chapter('business', '2. 기본·영역·의제 사업');
  const summary = block('summary', '1) 요약');
  const s = model.summary;
  if (!status(summary, s, '프로젝트 기록')) {
    if (model.overlap?.checking) { const p = muted(OV.checking); p.dataset.journalOverlapChecking = ''; p.setAttribute('role', 'status'); summary.append(p); }
    if (s.failed.includes('catalog')) summary.append(muted('프로젝트 순서를 불러오지 못해 프로젝트 이름별로 보여요.'));
    if (s.areas.length) {
      const table = el('table', 'journal-weekly-table');
      table.className += ' journal-weekly-summary';
      table.innerHTML = '<thead><tr><th scope="col">사업영역</th><th scope="col">세부 과제</th><th scope="col">진행 상황 및 이후 계획</th></tr></thead>';
      const body = el('tbody');
      for (const area of s.areas) area.rows.forEach((row, index) => {
        const tr = el('tr'); tr.dataset.journalArea = area.name; tr.dataset.journalTask = row.task?.name || '';
        if (!index) { const th = el('th', 'journal-weekly-area', area.name); th.scope = 'rowgroup'; th.rowSpan = area.rows.length; tr.append(th); }
        tr.append(el('td', 'journal-weekly-task', row.task?.name || '—'));
        const cell = el('td', 'journal-weekly-progress'); cell.append(itemList(row.items, true));
        const fold = foldedFiles(row.folded); if (fold) cell.append(fold);
        const gone = droppedFiles(row.dropped); if (gone) cell.append(gone);
        tr.append(cell);
        body.append(tr);
      });
      table.append(body); summary.append(table);
    }
    if (s.others.length) {
      const rest = el('div', 'journal-weekly-others'); rest.dataset.journalWeeklyOthers = '';
      if (s.ordered) rest.append(el('p', 'journal-org-name', '사업영역 밖 프로젝트(보관·삭제된 프로젝트 등)'));
      for (const section of s.others) {
        const part = el('div', 'journal-org'); part.dataset.journalOrg = section.name;
        part.append(el('p', 'journal-org-name', section.name), itemList(section.items));
        const fold = foldedFiles(section.folded); if (fold) part.append(fold);
        const gone = droppedFiles(section.dropped); if (gone) part.append(gone);
        rest.append(part);
      }
      summary.append(rest);
    }
    if (!s.count && !s.failed.some(k => k !== 'catalog')) summary.append(empty('이 주 프로젝트 기록이 없어요.'));
    if (s.ordered && s.quiet.length && s.count) { const q = muted(`이 주 기록 없는 사업영역: ${s.quiet.join(', ')}`); q.dataset.journalWeeklyQuiet = ''; summary.append(q); }
    const sGone = overlapFold(s.overlapped, 'summary'); if (sGone) summary.append(sGone);
  }
  const meet = block('meetings', '2) 세부 내용 — 회의·활동 결과');
  if (!status(meet, model.meetings, '회의·활동 결과') && !model.meetings.failed.length) {
    const mt = model.meetings, off = mt.hidden || [];
    if (mt.items.length) {
      const list = itemList(mt.items);
      // 주간보고에 올림 표시: a small ⋯ after the line opens one small text button for that line's kind (only when my list was read).
      if (mt.editable) [...list.children].forEach((li, i) => {
        const item = mt.items[i]; if (!validKindKey(item.kind)) return;
        const more = el('details', 'journal-kind-more'); more.dataset.journalKindMore = item.kind;
        const summaryEl = el('summary', null, '⋯'); summaryEl.setAttribute('aria-label', `${item.kindName} 종류 설정`);
        const toggle = el('button', 'mini', '주간보고에서 빼기'); toggle.type = 'button';
        toggle.dataset.journalKindToggle = item.kind; toggle.dataset.journalKindHide = '1'; toggle.dataset.journalKindName = item.kindName;
        toggle.setAttribute('aria-label', `${item.kindName} 종류를 주간보고에서 빼기`);
        more.append(summaryEl, toggle); li.append(more);
      });
      meet.append(list);
    } else meet.append(empty(off.length ? '이 주 회의·활동은 모두 주간보고에서 뺀 종류예요.' : '이 주 회의·활동이 없어요.'));
    if (off.length) {
      const box = el('div', 'journal-kinds-off'); box.dataset.journalKindsOff = '';
      box.append(el('p', 'journal-muted', '주간보고에서 뺀 회의 종류(이 주)'));
      const ul = el('ul', 'journal-kinds-off-list');
      for (const k of off) {
        const li = el('li'); li.dataset.journalKindOff = k.key; li.append(el('span', null, `${k.name} · ${k.count}건`));
        if (mt.editable) {
          const back = el('button', 'mini', '다시 올리기'); back.type = 'button';
          back.dataset.journalKindToggle = k.key; back.dataset.journalKindHide = '0'; back.dataset.journalKindName = k.name;
          back.setAttribute('aria-label', `${k.name} 종류를 주간보고에 다시 올리기`); li.append(back);
        }
        ul.append(li);
      }
      box.append(ul); meet.append(box);
    }
  }
  two.append(summary, meet);

  // 4. 산하 조직 현황 (the form has no 3절 for one person's report — 투쟁 사업 is the team's)
  const four = chapter('orgs', '4. 산하 조직 현황');
  const orgs = block('orgs', '1) 요약');
  if (!status(orgs, model.orgs, '조직 소식')) {
    const o = model.orgs, can = o.summaries === 'ok' && !o.failed.includes('orgUpdates');
    const named = (o.sections || []).filter(section => section.id);
    // JOURNAL-조직현황AI요약: one small [요약 만들기] for the shown organizations (only when pressed; edited summaries stay).
    if (can && named.length) {
      const row = el('div', 'journal-org-ai'); row.dataset.journalOrgAi = '';
      const run = el('button', 'mini', orgUi.busy ? '요약 만드는 중…' : '요약 만들기'); run.type = 'button'; run.dataset.journalOrgAiRun = '';
      run.setAttribute('aria-label', '조직별 요약 만들기(AI)');
      if (orgUi.busy) { run.disabled = true; run.setAttribute('aria-busy', 'true'); }
      const say = el('span', 'journal-org-ai-status', orgUi.status || ''); say.dataset.journalOrgAiStatus = ''; say.setAttribute('role', 'status'); say.setAttribute('aria-live', 'polite');
      if (orgUi.error) say.classList.add('journal-failed');
      row.append(run, say); orgs.append(row);
    }
    if (o.summaries === 'failed' && named.length) orgs.append(muted('저장한 조직 요약을 불러오지 못해 기록만 보여요.'));
    for (const section of o.sections || []) {
      const part = el('div', 'journal-org'); part.dataset.journalOrg = section.name;
      part.append(el('p', 'journal-org-name', section.name));
      const editing = can && section.id && orgUi.editing?.id === section.id ? orgUi.editing : null;
      if (editing) {
        const box = el('div', 'journal-org-edit'); box.dataset.journalOrgEdit = section.id;
        const id = `journalOrgEdit-${section.id}`;
        const label = el('label', 'journal-muted', `${section.name} 요약 고치기 (한 줄에 한 사안, ${ORG_EDIT_MAX_LINES}줄까지)`); label.htmlFor = id;
        const area = el('textarea', 'journal-org-edit-input'); area.id = id; area.rows = Math.min(8, Math.max(3, editing.value.split('\n').length + 1));
        area.value = editing.value; area.dataset.journalOrgEditInput = section.id; area.disabled = !!editing.saving;
        if (editing.invalid) area.setAttribute('aria-invalid', 'true');
        const note = el('p', 'journal-line-status', editing.status || ''); note.dataset.journalOrgEditStatus = ''; note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite');
        const actions = el('div', 'journal-edit-actions');
        const save = el('button', 'mini primary', '저장'); save.type = 'button'; save.dataset.journalOrgEditSave = section.id;
        const cancel = el('button', 'mini', '취소'); cancel.type = 'button'; cancel.dataset.journalOrgEditCancel = section.id;
        if (editing.saving) { save.disabled = true; cancel.disabled = true; }
        actions.append(save, cancel); box.append(label, area, note, actions); part.append(box);
      } else if (section.summary) {
        const lines = el('ul', 'journal-weekly-list journal-org-summary'); lines.dataset.journalOrgSummary = section.id;
        for (const line of orgSummaryLines(section.summary.text)) lines.append(el('li', null, line));
        part.append(lines);
      }
      if (section.summary || editing) {
        // The records the summary came from stay folded underneath (native disclosure, keyboard accessible).
        const raw = el('details', 'journal-org-raw'); raw.dataset.journalOrgRaw = section.name;
        if (orgUi.open?.has(section.name)) raw.open = true;
        raw.append(el('summary', null, `원문 ${section.items.length}건`), itemList(section.items));
        part.append(raw);
      } else part.append(itemList(section.items));
      const fold = foldedFiles(section.folded); if (fold) part.append(fold);
      const gone = droppedFiles(section.dropped); if (gone) part.append(gone);
      if (can && section.id && !editing) {
        const tools = el('div', 'journal-org-tools');
        if (section.summary?.edited) { const tag = el('span', 'journal-org-edited', '고친 요약'); tag.dataset.journalOrgEdited = ''; tools.append(tag); }
        const edit = el('button', 'mini', section.summary ? '요약 고치기' : '요약 쓰기'); edit.type = 'button'; edit.dataset.journalOrgEditOpen = section.id;
        edit.setAttribute('aria-label', `${section.name} ${section.summary ? '요약 고치기' : '요약 쓰기'}`);
        tools.append(edit); part.append(tools);
      }
      orgs.append(part);
    }
    if (!o.sections.length && !o.failed.length) orgs.append(empty('이 주 조직 소식이 없어요.'));
    const oGone = overlapFold(o.overlapped, 'orgs'); if (oGone) orgs.append(oGone);
  }
  four.append(orgs);

  // 5. 주요 일정: the two weeks from the next Monday in the form's cells; vacations as one line under the table.
  const five = chapter('calendar', '5. 주요 일정');
  const c = model.calendar;
  const cal = block('calendar', c.days?.length ? rangeTitle(c) : '다음 주 월요일부터 2주');
  if (!status(cal, c, '달력 일정') && !c.failed.length) {
    if (c.rows.length) {
      const table = el('table', 'journal-weekly-table journal-weekly-schedule');
      table.innerHTML = '<thead><tr><th scope="col">일</th><th scope="col">시간/내용/장소</th><th scope="col">참석자</th></tr></thead>';
      const body = el('tbody');
      for (const row of c.rows) row.items.forEach((item, index) => {
        const tr = el('tr'); tr.dataset.journalScheduleDay = row.day;
        if (!index) { const th = el('th', 'journal-weekly-area', row.label); th.scope = 'rowgroup'; th.rowSpan = row.items.length; tr.append(th); }
        const what = el('td', 'journal-weekly-what', item.what);
        if (item.memo?.title) { const tag = el('span', 'journal-exec-carried', MEMORY_TAG); tag.title = `원래 제목: ${item.title}`; tag.dataset.journalScheduleMemory = ''; what.append(' ', tag); }
        tr.append(what, el('td', 'journal-weekly-owner'));
        body.append(tr);
      });
      table.append(body); cal.append(table);
    } else cal.append(empty('이 2주에 달력 일정이 없어요.'));
    const off = vacationLine(c.vacations);
    if (off) { const p = el('p', 'journal-weekly-vacation', off); p.dataset.journalWeeklyVacation = ''; cal.append(p); }
    // 기억으로 뺀 일정은 늘 한 줄로 보인다(흔한 제목을 빼 다른 일정까지 빠지는 것을 알아보게, 설계 위험 2).
    const gone = memoryDroppedItems(c);
    if (gone.length) { const p = muted(`기억으로 뺀 일정 ${gone.length}개: ${gone.map(i => `${i.label} ${i.title}`).join(', ')} — 맨 아래 '주간보고 기억'에서 지울 수 있어요.`); p.dataset.journalScheduleMemoryDropped = String(gone.length); cal.append(p); }
    if (c.noCalendar) { const p = muted(`'${REPORT_CALENDAR}' 달력을 찾지 못해 표를 비워요. 달력 화면의 Google 달력 목록을 확인해 주세요.`); p.dataset.journalWeeklyNoCalendar = ''; cal.append(p); }
    cal.append(muted(`참석자 칸은 한글 파일에서 내 이름으로 채워요. '${REPORT_CALENDAR}' 달력 일정만 넣고, 일기·비공개 표시 일정은 빼요.`));
  }
  five.append(cal);

  // 참고
  const ref = chapter('notes', '참고 — 보고서 칸 밖 재료');
  const quiet = [];
  for (const [key, label] of NOTE_PARTS) {
    const part = model.notes[key];
    if (!part.loading && !part.failed.length && !part.items.length && !part.note) { if (key !== 'memos') quiet.push(label); continue; }
    const box = block(`note-${key}`, label);
    if (!status(box, part, label) && !part.failed.length) { if (part.items.length) box.append(itemList(part.items)); if (part.note) box.append(muted(part.note)); }
    ref.append(box);
  }
  if (quiet.length) { const q = muted(`기록 없는 묶음: ${quiet.join(', ')}`); q.classList.add('journal-empty'); q.dataset.journalWeeklyQuietNotes = ''; ref.append(q); }

  host.replaceChildren(when, one, two, four, five, ref, ...memoryBox(doc, el, model.remembered, memoryUi));
}

// WEEKLY-환류 (설계 3.7, Q6 ①): [주간 정리] 맨 아래 접힌 '주간보고 기억' — 일정 이름·일정 빼기(지우기)·회의 종류 빼기 전체(다시 올리기).
// memoryUi (journal.js keeps it): {open, busy, status, error, undo:{entry}}. 기억 칸을 읽지 못했으면 일정 기억 줄은 없다.
export const MEMORY_TAG = '기억';
const memoryDroppedItems = c => (c?.allRows ?? []).flatMap(row => row.items.filter(i => i.memo?.drop).map(i => ({label:row.label, title:i.title})));
const slash = day => { const [, m, d] = String(day ?? '').split('-'); return m ? `${Number(m)}/${Number(d)}` : ''; };
function memoryBox(doc, el, r, ui = {}) {
  if (!r || (!r.ready && !r.kinds)) return [];
  const names = r.entries.filter(e => e.title), drops = r.entries.filter(e => e.drop), kinds = r.kinds ?? [];
  const box = el('details', 'journal-weekly-chapter journal-weekly-memory'); box.dataset.journalWeeklyMemory = '';
  if (ui.open) box.open = true;
  const head = [r.ready ? `일정 이름 ${names.length}` : '', r.ready ? `일정 빼기 ${drops.length}` : '', r.kinds ? `회의 종류 빼기 ${kinds.length}` : ''].filter(Boolean).join(' · ');
  const sum = el('summary'); sum.append(el('span', 'journal-heading', '주간보고 기억'), ' ', el('small', 'journal-others-count', head)); box.append(sum);
  const used = e => `${e.used ? `마지막 적용 ${slash(e.used)}` : '아직 적용 안 됨'}${idleWeeks(e, r.today) >= 1 ? ` · ${idleWeeks(e, r.today)}주 안 쓰임` : ''}`;
  const list = (title, entries, line) => {
    const part = el('section', 'journal-weekly-part'); part.dataset.journalMemoryPart = title;
    part.append(el('h5', 'journal-weekly-sub', title));
    if (!entries.length) { part.append(el('p', 'journal-muted', '없어요.')); return part; }
    const ul = el('ul', 'journal-kinds-off-list');
    for (const e of entries) {
      const li = el('li'); li.dataset.journalMemoryEntry = e.key;
      li.append(el('span', null, line(e)), ' ', el('small', 'journal-muted', used(e)));
      const del = el('button', 'mini', '지우기'); del.type = 'button'; del.dataset.journalMemoryDelete = e.key; del.disabled = !!ui.busy;
      del.setAttribute('aria-label', `기억 지우기: ${e.origin}`); li.append(del); ul.append(li);
    }
    part.append(ul); return part;
  };
  if (r.ready) {
    box.append(list('일정 이름', names, e => `${e.origin} → ${e.title}${e.place ? `(${e.place})` : ''}`), list('일정 빼기', drops, e => e.origin));
  } else box.append(el('p', 'journal-muted', '일정 기억을 읽지 못했어요(준비 중이면 기억 없이 달력 제목 그대로 써요).'));
  if (r.kinds) {
    const part = el('section', 'journal-weekly-part'); part.dataset.journalMemoryPart = '회의 종류 빼기';
    part.append(el('h5', 'journal-weekly-sub', '회의 종류 빼기'));
    if (!kinds.length) part.append(el('p', 'journal-muted', '없어요.'));
    else {
      const ul = el('ul', 'journal-kinds-off-list');
      for (const k of kinds) {
        const li = el('li'); li.dataset.journalMemoryKind = k; li.append(el('span', null, k));
        const back = el('button', 'mini', '다시 올리기'); back.type = 'button';
        back.dataset.journalKindToggle = k; back.dataset.journalKindHide = '0'; back.dataset.journalKindName = k;
        back.setAttribute('aria-label', `${k} 종류를 주간보고에 다시 올리기`); li.append(back); ul.append(li);
      }
      part.append(ul);
    }
    box.append(part);
  }
  const say = el('p', 'journal-line-status'); say.dataset.journalMemoryStatus = ''; say.setAttribute('role', 'status'); say.setAttribute('aria-live', 'polite');
  if (ui.error) say.classList.add('journal-failed');
  if (ui.status) say.append(ui.status);
  if (ui.undo) { const undo = el('button', 'mini', '되돌리기'); undo.type = 'button'; undo.dataset.journalMemoryUndo = ''; undo.disabled = !!ui.busy; say.append(' ', undo); }
  box.append(say);
  return [box];
}

// 1. 요청사항 › 1) the request rows and their edit row. Returns the nodes for the box (table, edit row for a new line, tools, status).
function execTable(doc, el, items, ui) {
  const editing = ui.editing ?? null, busy = !!ui.saving;
  const table = el('table', 'journal-weekly-table journal-exec-table'); table.dataset.journalExecTable = '';
  const head = el('thead'), hr = el('tr');
  for (const name of EXEC_HEAD) { const th = el('th', null, name); th.scope = 'col'; hr.append(th); }
  const tools = el('th', 'journal-exec-tools-head'); tools.scope = 'col'; tools.setAttribute('aria-label', '고치기'); hr.append(tools);
  head.append(hr); table.append(head);
  const body = el('tbody');
  for (const item of items) {
    if (editing === item.id) { body.append(execEditRow(doc, el, ui, item)); continue; }
    const tr = el('tr'); tr.dataset.journalExecRow = item.id;
    const th = el('th', 'journal-weekly-area', dayLabel(item)); th.scope = 'row';
    const what = el('td', 'journal-weekly-what', whatCell(item));
    if (item.carried) { const tag = el('span', 'journal-exec-carried', CARRIED_TAG); tag.title = '지난주 확정본에서 가져온 줄'; tag.dataset.journalExecCarried = ''; what.append(' ', tag); }
    const who = el('td', 'journal-exec-who', item.who);
    const cell = el('td', 'journal-exec-tools');
    const edit = el('button', 'mini', '고치기'); edit.type = 'button'; edit.dataset.journalExecEdit = item.id;
    edit.setAttribute('aria-label', `${dayLabel(item)} ${item.what} 고치기`);
    if (busy || editing) edit.disabled = true;
    cell.append(edit);
    tr.append(th, what, who, cell); body.append(tr);
  }
  if (editing === 'new') body.append(execEditRow(doc, el, ui, null));
  table.append(body);
  const out = [table];
  if (!items.length && editing !== 'new') { const p = el('p', 'journal-muted', '요청 줄이 없어요.'); p.dataset.journalWeeklyEmpty = ''; p.dataset.journalExecEmpty = ''; out.push(p); }
  if (!editing) {
    const add = el('button', 'mini', '+ 줄 추가'); add.type = 'button'; add.dataset.journalExecAdd = '';
    add.setAttribute('aria-label', '요청 줄 추가');
    if (busy || items.length >= EXEC_MAX_ROWS) add.disabled = true;
    const row = el('div', 'journal-exec-bar'); row.append(add); out.push(row);
  }
  const say = el('p', 'journal-line-status', ui.status || ''); say.dataset.journalExecStatus = ''; say.setAttribute('role', 'status'); say.setAttribute('aria-live', 'polite');
  if (ui.error) say.classList.add('journal-failed');
  out.push(say);
  return out;
}
function execEditRow(doc, el, ui, item) {
  const tr = el('tr', 'journal-exec-edit-row'); tr.dataset.journalExecEditRow = item?.id ?? 'new';
  const td = el('td'); td.colSpan = 4;
  const form = el('div', 'journal-exec-form'); form.dataset.journalExecForm = item?.id ?? 'new';
  const draft = ui.draft ?? {}, key = item?.id ?? 'new';
  for (const [name, label, type] of EXEC_FIELDS) {
    const wrap = el('label', `journal-exec-field journal-exec-${name}`); wrap.append(el('span', null, label));
    const input = el('input'); input.type = type; input.value = draft[name] ?? ''; input.dataset.journalExecField = name;
    input.id = `journalExec-${key}-${name}`;
    if (type === 'text') { input.maxLength = EXEC_LIMITS[name]; input.autocomplete = 'off'; }
    if (name === 'time') input.placeholder = '10:30';
    if (ui.invalid === name) input.setAttribute('aria-invalid', 'true');
    if (ui.saving) input.disabled = true;
    wrap.append(input); form.append(wrap);
  }
  const actions = el('div', 'journal-edit-actions');
  const save = el('button', 'mini primary', '저장'); save.type = 'button'; save.dataset.journalExecSave = key;
  const cancel = el('button', 'mini', '취소'); cancel.type = 'button'; cancel.dataset.journalExecCancel = key;
  actions.append(save, cancel);
  if (item) { const del = el('button', 'mini journal-delete', '삭제'); del.type = 'button'; del.dataset.journalExecDelete = item.id; actions.append(del); }
  if (ui.saving) for (const b of actions.children) b.disabled = true;
  form.append(actions); td.append(form); tr.append(td);
  return tr;
}
