// JOURNAL-주간보고허브 2단계: [주간 정리] — one week of the journal's materials grouped in the order of the weekly report form
// (docs/design/weekly-report-hub.md 4절 2단계, 7절 결정; the form is docs/design/weekly-hwpx-draft.md 1.2·1.3절):
//   1. 요청사항 — 1) 집회·행사 참가 요청 (not gathered: the request marks are not a group any more, #859), 2) 주요 일정 (the week's
//      calendar events)
//   2. 기본·영역·의제 사업 — 1) 요약: 사업영역(1단 project) → 세부 과제(2단) → 진행 상황 및 이후 계획 → 담당 팀원 (left empty,
//      결정 4). Records follow the project tree and its order (project-catalog tree, PRJ-3단); a 3단 (사안) record sits on its
//      2단 row as "세부과제 › 사안: 내용", a 2단 record as "세부과제: 내용", a 1단 record on the area's own row (project-3-levels.md
//      3절 D, 8절 ④). 2) 세부 내용: 회의·행사 결과 by the meeting's date.
//   4. 산하 조직 현황 — 조직 소식 in the app's organization order (13 조직 묶음, then 그 외, then 미분류; ORG-묶음순서 #864).
//   참고 — the week's 한 줄, 끝낸 할 일, 자료실 새 자료, 공유 페이지, 기타 메모 (material the form has no box for).
// Notes moved from the basket (노트로 옮긴 업데이트, #868) are not included. The tab only shows; it saves nothing and makes no file
// (WEEKLY-한글초안 2단계 builds the .hwpx from this grouping). journal.js stays the only renderer of #journalRoot and calls
// renderWeekly() into the box it owns.
import {weekDays, workLines, shortDay, eventsOn, eventTime, tasksOn, meetingsOn, meetingLine, orgNewsOn, projectRecordsOn,
  compareOrgSections, journalMemosOn, documentLine, sharePageLine, firstLine, UNSORTED, DONE_TASK_DAYS, doneCoverFrom, todayKey, WEEK_READ_CAP} from './journal-data.js';
import {requestTagsHtml} from './update-requests.js';
import {seoulDateKey} from './meeting-time.js';

// The reads behind each part (journal.js materials keys; 'lines' is the journal's own lines read).
export const WEEKLY_SOURCES = Object.freeze({
  schedule:['events'], summary:['basket', 'projectUpdates', 'catalog'], meetings:['meetings'], orgs:['basket', 'orgUpdates'],
  lines:['lines'], tasks:['tasks'], docs:['documents'], shares:['sharePages'], memos:['basket'],
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

// The whole week in report order. lines: Map(day → journal row) or null when they could not be read.
export function weeklySummary({start, lines, linesState = 'ok', materials = {}, doneDays = DONE_TASK_DAYS, today = todayKey()}) {
  const days = weekDays(start), m = {...materials, lines:{status:linesState === 'loading' ? 'loading' : linesState === 'ok' ? 'ok' : 'failed', items:lines}};
  const part = (key, build) => { const s = state(m, WEEKLY_SOURCES[key]); return {key, ...s, ...(s.loading ? {} : build(s))}; };
  const perDay = (source, pick) => { const read = ok(m, source); return read ? days.flatMap(day => pick(read, day).map(text => ({day, text}))) : []; };

  const schedule = part('schedule', () => {
    const seen = new Set(), items = [];
    const events = ok(m, 'events');
    if (events) for (const day of days) for (const event of eventsOn(events, day)) {
      const key = event.id ? `${event.calendarId || ''}:${event.id}` : null;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      items.push({day, text:`${eventTime(event)} ${event.title || '(제목 없음)'}`});
    }
    return {items};
  });

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

  const notes = {
    lines:part('lines', () => ({items:perDay('lines', (read, day) => workLines(read?.get?.(day)))})),
    tasks:part('tasks', () => ({items:perDay('tasks', (read, day) => tasksOn(read, day).map(task => task.title || '(제목 없음)')),
      ...(days[0] < doneCoverFrom(doneDays, today) ? {note:`Google 할 일은 최근 ${doneDays}일 안에 끝낸 것만 모여요.`} : {})})),
    docs:part('docs', () => ({items:perDay('documents', (read, day) => read.filter(doc => seoulDay(doc?.created_at) === day).map(documentLine))})),
    shares:part('shares', () => ({items:perDay('sharePages', (read, day) => read.filter(page => seoulDay(page?.updated_at) === day).map(sharePageLine))})),
    memos:part('memos', () => ({items:perDay('basket', (read, day) => journalMemosOn(read, day))})),
  };
  return {start, days, schedule, summary, meetings, orgs, notes};
}
const seoulDay = value => value && Number.isFinite(Date.parse(value)) ? seoulDateKey(value) : '';

// ---- screen (called by journal.js only) ----
export const NOTE_PARTS = Object.freeze([['lines', '한 줄'], ['tasks', '끝낸 할 일'], ['docs', '자료실 새 자료'], ['shares', '공유 페이지'], ['memos', '기타 메모']]);
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

  // 1. 요청사항
  const one = chapter('requests', '1. 요청사항');
  const ask = block('ask', '1) 집회·행사 참가 요청');
  ask.append(muted('업무일지 기록에서 모으지 않는 칸이에요. 한글 초안에서 직접 채워요.'));
  const schedule = block('schedule', '2) 주요 일정');
  if (!status(schedule, model.schedule, '일정') && !model.schedule.failed.length) schedule.append(model.schedule.items.length ? itemList(model.schedule.items) : empty('이 주 일정이 없어요.'));
  one.append(ask, schedule);

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

  host.replaceChildren(one, two, four, ref);
}
