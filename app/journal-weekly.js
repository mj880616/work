// JOURNAL-주간보고허브 2단계: [주간 정리] — one week of the journal's materials grouped in the order of the weekly report form
// (docs/design/weekly-report-hub.md 4절 2단계, 7절 결정; the form is docs/design/weekly-hwpx-draft.md 1.2·1.3절):
//   1. 요청사항 — 임원 일정 배정·논의 요청. There is no material for it yet (the request marks are not a group any more, PR 859;
//      how to enter it waits for decision W), so the box is kept and says "아직 재료 없음" — no input is made here.
//   2. 기본·영역·의제 사업 — 1) 요약: 사업영역(1단 project) → 세부 과제(2단) → 진행 상황 및 이후 계획 → 담당 팀원 (left empty,
//      결정 4). Records follow the project tree and its order (project-catalog tree, PRJ-3단); a 3단 (사안) record sits on its
//      2단 row as "세부과제 › 사안: 내용", a 2단 record as "세부과제: 내용", a 1단 record on the area's own row (project-3-levels.md
//      3절 D, 8절 ④). 2) 세부 내용: 회의·행사 결과 by the meeting's date.
//   1. 2) 주요 일정 — 본부 주요 일정 (the headquarters' press conferences, main meetings, forums, rallies, trainings; not one
//      workplace's own nor repeating ones). Its rule is not settled yet, so the box only says what goes there (2026-10-21).
//   4. 산하 조직 현황 — 조직 소식 in the app's organization order (13 조직 묶음, then 그 외, then 미분류; ORG-묶음순서 PR 864).
//   5. 주요 일정 — my own Google Calendar events of the two weeks from the Monday after the shown week (journal-data.js
//      scheduleDays: written on Friday, reported on Monday — "the reported week and the week after"), in the form's cells
//      (일 | 시간/내용/장소 | 참석자). A vacation (휴가·연차·반차 …) is not a row but one "※ 휴가: …" line under the table; an event
//      marked 일기·비공개 is left out (WEEKLY-주요일정, 2026-10-21).
//   참고 — the week's 한 줄, 끝낸 할 일, 할 일 예정, 자료실 새 자료, 공유 페이지, 기타 메모 (material the form has no box for).
//   [주간보고 초안 복사] copies this same grouping as text in the same order (weeklyReportText).
// Notes moved from the basket (노트로 옮긴 업데이트, PR 868) are not included. The tab only shows; it saves nothing and makes no file
// (WEEKLY-한글초안 2단계 builds the .hwpx from this grouping). journal.js stays the only renderer of #journalRoot and calls
// renderWeekly() into the box it owns.
import {weekDays, workLines, shortDay, reportDay, tasksOn, pendingOn, meetingsOn, meetingLine, orgNewsOn, projectRecordsOn, scheduleDays,
  compareOrgSections, journalMemosOn, documentLine, sharePageLine, UNSORTED, DONE_TASK_DAYS, doneCoverFrom, pendingCoverTo, PENDING_DAYS, todayKey, WEEK_READ_CAP} from './journal-data.js';
import {requestTagsHtml, requestPrefix} from './update-requests.js';
import {seoulDateKey, addSeoulDays, seoulClock} from './meeting-time.js';

// The reads behind each part (journal.js materials keys; 'lines' is the journal's own lines read).
// 'upcoming' is the two-week calendar read of 5. 주요 일정 (journal-data.js readScheduleEvents).
export const WEEKLY_SOURCES = Object.freeze({
  summary:['basket', 'projectUpdates', 'catalog'], meetings:['meetings'], orgs:['basket', 'orgUpdates'], calendar:['upcoming'],
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
    const item = {day:record.day, text:record.text, requests:record.requests || []};
    if (!node) {
      const name = record.name || UNSORTED;
      if (!others.has(name)) others.set(name, []);
      others.get(name).push(item);
      continue;
    }
    // The report line: "세부과제 › 사안: 내용" for a 3단 record, "세부과제: 내용" for a 2단 one (summaryLine). On screen the 세부 과제
    // column already names the 2단, so only a 사안 shows its label there (`issue`).
    item.label = node.task ? (node.issue ? `${node.task.name} › ${node.issue}` : node.task.name) : '';
    item.issue = !!node.issue;
    const key = node.task?.id || '';
    let row = node.area.rows.find(r => (r.task?.id || '') === key);
    if (!row) { row = {task:node.task, items:[]}; node.area.rows.push(row); }
    row.items.push(item);
  }
  for (const area of areas) {
    const at = id => id ? [...nodes.values()].find(n => n.task?.id === id && !n.issue)?.order ?? Infinity : -1;
    area.rows.sort((a, b) => at(a.task?.id) - at(b.task?.id));
  }
  return {areas:areas.filter(area => area.rows.length), others:[...others].map(([name, items]) => ({name, items})).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    quiet:areas.filter(area => !area.rows.length).map(area => area.name)};
}
// The text of one 요약 item as the report writes it: "세부과제: 내용", "세부과제 › 사안: 내용", or the bare text on the area row.
export const summaryLine = item => item.label ? `${item.label}: ${item.text}` : item.text;

// ---- 5. 주요 일정 ----
const WEEKDAY = '일월화수목금토';
const parts_ = day => { const [y, m, d] = String(day).split('-').map(Number); return {m, d, w:WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}; };
// "■ 일시" of the report: the report day (상집 보고일 — the Monday after the shown week) as "2026년 10월 12일(월)", the form's
// date line (weekly-hwpx draft.mjs reportDate writes the same).
export const reportDateText = start => { const day = reportDay(start), {m, d, w} = parts_(day); return `${day.slice(0, 4)}년 ${m}월 ${d}일(${w})`; };
// The form's day cell: "10.19.(월)"; the screen's vacation line: "10/19(월)".
export const formDay = day => { const {m, d, w} = parts_(day); return `${m}.${d}.(${w})`; };
const slashDay = day => { const {m, d, w} = parts_(day); return `${m}/${d}(${w})`; };
const span = (first, last, one, joint) => first === last ? one(first) : `${one(first)}${joint}${one(last)}`;
// A vacation is told by its title (휴가·연차·반차·반반차·월차·병가·공가·휴무). An event whose title or memo says 일기 or 비공개 is
// not report material and is left out. (The calendar read carries no Google "private" visibility, so the mark is in the text.)
export const VACATION_WORDS = /휴가|연차|반차|월차|병가|공가|휴무/;
export const PRIVATE_WORDS = /일기|비공개/;
export const isVacation = event => VACATION_WORDS.test(String(event?.title ?? ''));
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
    if (isPrivateEvent(event)) continue;
    const {first, last} = eventDays(event);
    if (!first || last < from || first > to) continue;
    const title = String(event.title || '').trim() || '(제목 없음)';
    if (isVacation(event)) { vacations.push({first, last, title}); continue; }
    const time = event.allDay ? '종일' : seoulClock(event.start), place = String(event.location || '').trim();
    list.push({day:first < from ? from : first, first, last, multi:first !== last, allDay:!!event.allDay, at:event.allDay ? 0 : Date.parse(event.start), title,
      what:[time, title, place].filter(Boolean).join(' / ')});
  }
  list.sort((a, b) => a.day.localeCompare(b.day) || a.multi - b.multi || (a.multi && a.last.localeCompare(b.last)) || b.allDay - a.allDay || a.at - b.at || a.title.localeCompare(b.title, 'ko'));
  const rows = [];
  for (const item of list) {
    const label = span(item.first, item.last, formDay, ' ~ ');
    const row = rows.at(-1)?.label === label ? rows.at(-1) : (rows.push({day:item.day, label, items:[]}), rows.at(-1));
    row.items.push({what:item.what, multi:item.multi});
  }
  vacations.sort((a, b) => a.first.localeCompare(b.first) || a.last.localeCompare(b.last));
  return {days, rows, vacations};
}
// "※ 휴가: 10/23(금) 연차, 10/27(화)~10/28(수) 휴가" (screen and copy), or '' without one.
export const vacationLine = vacations => vacations?.length ? `※ 휴가: ${vacations.map(v => `${span(v.first, v.last, slashDay, '~')} ${v.title}`).join(', ')}` : '';
// The form's 5. 주요 일정 table (weekly-hwpx report.mjs calendar/calendarNotes): every one of the 14 days in a row of its own, as
// the personal reports write it (a day without an event keeps its date with empty cells), a several-day event on its own row
// after its first day, 참석자 = my name. Vacations become "※ 10.23.(금) 이름 연차" lines under the table.
export function scheduleForm(calendar, me = '') {
  const who = me ? [me] : [];
  const out = [];
  const ready = calendar && !calendar.loading && !calendar.failed?.length;
  for (const day of calendar?.days || []) {
    const rows = ready ? calendar.rows.filter(r => r.day === day) : [];
    const single = rows.filter(r => !r.items[0]?.multi);
    out.push({day:formDay(day), items:single.flatMap(r => r.items.map(i => ({what:i.what, who:[...who]})))});
    for (const r of rows.filter(r => r.items[0]?.multi)) out.push({day:r.label, items:r.items.map(i => ({what:i.what, who:[...who]}))});
  }
  const notes = ready ? calendar.vacations.map(v => `※ ${span(v.first, v.last, formDay, '~')} ${me && !v.title.includes(me) ? `${me} ` : ''}${v.title}`) : [];
  return {calendar:out, calendarNotes:notes};
}

// The whole week in report order. lines: Map(day → journal row) or null when they could not be read.
export function weeklySummary({start, lines, linesState = 'ok', materials = {}, doneDays = DONE_TASK_DAYS, today = todayKey()}) {
  const days = weekDays(start), m = {...materials, lines:{status:linesState === 'loading' ? 'loading' : linesState === 'ok' ? 'ok' : 'failed', items:lines}};
  const part = (key, build) => { const s = state(m, WEEKLY_SOURCES[key]); return {key, ...s, ...(s.loading ? {} : build(s))}; };
  const perDay = (source, pick) => { const read = ok(m, source); return read ? days.flatMap(day => pick(read, day).map(text => ({day, text}))) : []; };

  const summary = part('summary', s => {
    const read = {basket:ok(m, 'basket'), projectUpdates:ok(m, 'projectUpdates')};
    const records = (read.basket || read.projectUpdates) ? days.flatMap(day => projectRecordsOn(read, day).map(r => ({...r, day}))) : [];
    const tree = ok(m, 'catalog');
    return {...placeRecords(records, tree), ordered:!!tree, count:records.length, failed:s.failed};
  });

  const meetings = part('meetings', () => ({items:perDay('meetings', (read, day) => meetingsOn(read, day).map(meetingLine))}));

  const orgs = part('orgs', s => {
    const read = {basket:ok(m, 'basket'), orgUpdates:ok(m, 'orgUpdates')};
    const sections = new Map();
    if (s.failed.length < WEEKLY_SOURCES.orgs.length) for (const day of days) for (const section of orgNewsOn(read, day)) {
      if (!sections.has(section.name)) sections.set(section.name, {name:section.name, items:[]});
      section.items.forEach((text, i) => sections.get(section.name).items.push({day, text, requests:section.tags?.[i] || []}));
    }
    return {sections:[...sections.values()].sort(compareOrgSections)};
  });

  const calendar = part('calendar', () => upcomingSchedule(ok(m, 'upcoming'), start));

  const notes = {
    lines:part('lines', () => ({items:perDay('lines', (read, day) => workLines(read?.get?.(day)))})),
    tasks:part('tasks', () => ({items:perDay('tasks', (read, day) => tasksOn(read, day).map(task => task.title || '(제목 없음)')),
      ...(days[0] < doneCoverFrom(doneDays, today) ? {note:`Google 할 일은 최근 ${doneDays}일 안에 끝낸 것만 모여요.`} : {})})),
    // 할 일 예정 by due day in this week (the server sends overdue and up to 6 days ahead only).
    due:part('due', () => ({items:perDay('tasks', (read, day) => pendingOn(read, day).map(task => task.title || '(제목 없음)')),
      ...(days[6] > pendingCoverTo(today) ? {note:`할 일 예정은 오늘부터 ${PENDING_DAYS}일 안 마감만 모여요.`} : {})})),
    docs:part('docs', () => ({items:perDay('documents', (read, day) => read.filter(doc => seoulDay(doc?.created_at) === day).map(documentLine))})),
    shares:part('shares', () => ({items:perDay('sharePages', (read, day) => read.filter(page => seoulDay(page?.updated_at) === day).map(sharePageLine))})),
    memos:part('memos', () => ({items:perDay('basket', (read, day) => journalMemosOn(read, day))})),
  };
  return {start, days, summary, meetings, orgs, calendar, notes};
}
const seoulDay = value => value && Number.isFinite(Date.parse(value)) ? seoulDateKey(value) : '';

// ---- [주간보고 초안 복사] (2026-10-21 사용자 승인: 날짜순이 아니라 양식 순서) ----
// The same grouping as the tab, as text in the form's order: 1. 요청사항 → 2. 사업 → 4. 산하 조직 → 5. 주요 일정 → 참고. A part
// that is still loading or failed says so in its place, and the end names what could not be read.
const LABELS = Object.freeze({summary:'프로젝트 기록', meetings:'회의·행사 결과', orgs:'조직 소식', calendar:'달력 일정', lines:'한 줄'});
export function weeklyReportText(model) {
  const {days} = model, out = [`주간 업무일지 ${shortDay(days[0])} ~ ${shortDay(days[6])}`, `■ 일시 : ${reportDateText(model.start)}`, ''];
  const item = (i, text = i.text) => `- ${shortDay(i.day)} ${requestPrefix(i.requests)}${text}`;
  const gap = (part, key) => part.loading ? '(불러오는 중)' : !part.failed?.length ? '' : part.failed.length < WEEKLY_SOURCES[key].length ? '(일부를 불러오지 못함)' : '(불러오지 못함)';
  const missing = [];
  const note = (key, part, label = LABELS[key]) => { const g = gap(part, key); if (g) { out.push(g); if (!part.loading) missing.push(label); } return !!part.loading || (part.failed?.length || 0) >= WEEKLY_SOURCES[key].length; };
  out.push('1. 요청사항', '1) 임원 일정 배정·논의 요청: (아직 재료 없음)', `2) 주요 일정: (비워 둠) ${HQ_SCHEDULE_GUIDE}`, '');
  out.push('2. 기본·영역·의제 사업', '1) 요약');
  const s = model.summary;
  if (!note('summary', s)) {
    for (const area of s.areas) { out.push(`◦ ${area.name}`); for (const row of area.rows) for (const i of row.items) out.push(item(i, summaryLine(i))); }
    for (const other of s.others) { out.push(`◦ ${s.ordered ? '사업영역 밖 · ' : ''}${other.name}`); for (const i of other.items) out.push(item(i)); }
    if (!s.count && !s.failed.some(k => k !== 'catalog')) out.push('(이 주 프로젝트 기록 없음)');
  }
  out.push('2) 세부 내용 — 회의·행사 결과');
  if (!note('meetings', model.meetings)) { for (const i of model.meetings.items) out.push(item(i)); if (!model.meetings.items.length) out.push('(이 주 회의·행사 없음)'); }
  out.push('', '4. 산하 조직 현황', '1) 요약');
  if (!note('orgs', model.orgs)) { for (const section of model.orgs.sections) { out.push(`◦ ${section.name}`); for (const i of section.items) out.push(item(i)); } if (!model.orgs.sections.length) out.push('(이 주 조직 소식 없음)'); }
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
export const NOTE_PARTS = Object.freeze([['lines', '한 줄'], ['tasks', '끝낸 할 일'], ['due', '할 일 예정'], ['docs', '자료실 새 자료'], ['shares', '공유 페이지'], ['memos', '기타 메모']]);
// 1. 2) 주요 일정: what goes there (its rule is not settled; nothing is filled in yet).
export const HQ_SCHEDULE_GUIDE = '본부 주요 일정 — 기자회견·주요 회의·토론회·집회·교육 등, 특정 사업장·반복 일정 제외. 자동 채우기는 나중에';
const rangeTitle = calendar => `${shortDay(calendar.days[0])} ~ ${shortDay(calendar.days.at(-1))} · 다음 주 월요일부터 2주`;
export function renderWeekly(host, model, esc) {
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
      li.append(doc.createTextNode(line(item)));
      list.append(li);
    }
    return list;
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
  // 1. 요청사항: the boxes only (임원 일정 배정·논의 요청 has no material yet — no input until decision W; 2) 주요 일정 only says
  // what goes there).
  const one = chapter('requests', '1. 요청사항');
  const ask = block('ask', '1) 임원 일정 배정·논의 요청');
  const none = muted('아직 재료 없음'); none.dataset.journalWeeklyNoMaterial = '';
  ask.append(none);
  const hq = block('hq-schedule', '2) 주요 일정');
  const guide = muted(HQ_SCHEDULE_GUIDE); guide.dataset.journalWeeklyGuide = '';
  hq.append(guide);
  one.append(ask, hq);

  // 2. 기본·영역·의제 사업
  const two = chapter('business', '2. 기본·영역·의제 사업');
  const summary = block('summary', '1) 요약');
  const s = model.summary;
  if (!status(summary, s, '프로젝트 기록')) {
    if (s.failed.includes('catalog')) summary.append(muted('프로젝트 순서를 불러오지 못해 프로젝트 이름별로 보여요.'));
    if (s.areas.length) {
      const table = el('table', 'journal-weekly-table');
      table.innerHTML = '<thead><tr><th scope="col">사업영역</th><th scope="col">세부 과제</th><th scope="col">진행 상황 및 이후 계획</th><th scope="col">담당 팀원</th></tr></thead>';
      const body = el('tbody');
      for (const area of s.areas) area.rows.forEach((row, index) => {
        const tr = el('tr'); tr.dataset.journalArea = area.name; tr.dataset.journalTask = row.task?.name || '';
        if (!index) { const th = el('th', 'journal-weekly-area', area.name); th.scope = 'rowgroup'; th.rowSpan = area.rows.length; tr.append(th); }
        tr.append(el('td', 'journal-weekly-task', row.task?.name || '—'));
        const cell = el('td', 'journal-weekly-progress'); cell.append(itemList(row.items, true)); tr.append(cell);
        tr.append(el('td', 'journal-weekly-owner'));
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
        rest.append(part);
      }
      summary.append(rest);
    }
    if (!s.count && !s.failed.some(k => k !== 'catalog')) summary.append(empty('이 주 프로젝트 기록이 없어요.'));
    if (s.ordered && s.quiet.length && s.count) { const q = muted(`이 주 기록 없는 사업영역: ${s.quiet.join(', ')}`); q.dataset.journalWeeklyQuiet = ''; summary.append(q); }
    summary.append(muted('담당 팀원 칸은 비워 둬요(손으로 채움).'));
  }
  const meet = block('meetings', '2) 세부 내용 — 회의·행사 결과');
  if (!status(meet, model.meetings, '회의·행사 결과') && !model.meetings.failed.length) meet.append(model.meetings.items.length ? itemList(model.meetings.items) : empty('이 주 회의·행사가 없어요.'));
  two.append(summary, meet);

  // 4. 산하 조직 현황 (the form has no 3절 for one person's report — 투쟁 사업 is the team's)
  const four = chapter('orgs', '4. 산하 조직 현황');
  const orgs = block('orgs', '1) 요약');
  if (!status(orgs, model.orgs, '조직 소식')) {
    for (const section of model.orgs.sections || []) {
      const part = el('div', 'journal-org'); part.dataset.journalOrg = section.name;
      part.append(el('p', 'journal-org-name', section.name), itemList(section.items));
      orgs.append(part);
    }
    if (!model.orgs.sections.length && !model.orgs.failed.length) orgs.append(empty('이 주 조직 소식이 없어요.'));
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
        tr.append(el('td', 'journal-weekly-what', item.what), el('td', 'journal-weekly-owner'));
        body.append(tr);
      });
      table.append(body); cal.append(table);
    } else cal.append(empty('이 2주에 달력 일정이 없어요.'));
    const off = vacationLine(c.vacations);
    if (off) { const p = el('p', 'journal-weekly-vacation', off); p.dataset.journalWeeklyVacation = ''; cal.append(p); }
    cal.append(muted('참석자 칸은 한글 파일에서 내 이름으로 채워요. 일기·비공개 표시 일정은 빼요.'));
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

  host.replaceChildren(when, one, two, four, five, ref);
}
