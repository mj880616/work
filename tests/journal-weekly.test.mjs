import { test } from 'node:test';
import assert from 'node:assert/strict';
// JOURNAL-주간보고허브 2단계: [주간 정리] groups one week of the journal's reads in the weekly report form's order
// (docs/design/weekly-report-hub.md, docs/design/weekly-hwpx-draft.md). Fake names only.
const mod = import('../app/journal-weekly.js');
const ok = items => ({status:'ok', items});
const empty = ok([]);
// 사업영역 A › 세부 과제 A-1 › 사안 A-1-가, 세부 과제 A-2; 사업영역 B (no record); 사업영역 C › 세부 과제 C-1.
const tree = [
  {project:{id:'A', name:'사업영역 A'}, depth:0},
  {project:{id:'A1', name:'세부 과제 A-1'}, depth:1},
  {project:{id:'A1x', name:'사안 A-1-가'}, depth:2},
  {project:{id:'A2', name:'세부 과제 A-2'}, depth:1},
  {project:{id:'B', name:'사업영역 B'}, depth:0},
  {project:{id:'C', name:'사업영역 C'}, depth:0},
  {project:{id:'C1', name:'세부 과제 C-1'}, depth:1},
];
const progress = [
  {id:'p1', project_id:'C1', project:{name:'세부 과제 C-1'}, summary:'C-1 월요일 기록', effective_on:'2026-10-05', created_at:'2026-10-05T01:00:00Z'},
  {id:'p2', project_id:'A1x', project:{name:'사안 A-1-가'}, summary:'사안 기록\n둘째 줄', effective_on:'2026-10-07', created_at:'2026-10-07T01:00:00Z'},
  {id:'p3', project_id:'A2', project:{name:'세부 과제 A-2'}, summary:'A-2 기록', effective_on:'2026-10-06', created_at:'2026-10-06T01:00:00Z'},
  {id:'p4', project_id:'A1', project:{name:'세부 과제 A-1'}, summary:'A-1 기록', effective_on:'2026-10-08', created_at:'2026-10-08T01:00:00Z'},
  {id:'p5', project_id:'A', project:{name:'사업영역 A'}, summary:'영역 전체 기록', effective_on:'2026-10-06', created_at:'2026-10-06T02:00:00Z'},
  {id:'p6', project_id:'gone', project:{name:'보관된 프로젝트'}, summary:'보관 기록', effective_on:'2026-10-06', created_at:'2026-10-06T03:00:00Z'},
  {id:'p9', project_id:'A1', project:{name:'세부 과제 A-1'}, summary:'다음 주 기록', effective_on:'2026-10-12', created_at:'2026-10-12T01:00:00Z'},
];
const basket = {
  notes:[
    {id:'b1', raw_text:'프로젝트로 보낸 업데이트', occurred_at:'2026-10-06T00:30:00Z'},
    {id:'b2', raw_text:'조직으로 보낸 업데이트', occurred_at:'2026-10-06T00:40:00Z'},
    {id:'b3', raw_text:'미분류 업데이트', occurred_at:'2026-10-07T00:40:00Z'},
    {id:'b4', raw_text:'일지에 남긴 메모', occurred_at:'2026-10-08T00:40:00Z', metadata:{journal_at:'2026-10-08T00:41:00Z'}},
  ],
  links:[
    {note_id:'b1', status:'confirmed', project_id:'A1x', project:{name:'사안 A-1-가'}},
    {note_id:'b2', status:'confirmed', organization_id:'o2', organization:{name:'나 조직'}},
  ],
  docs:[],
};
const orgUpdates = Object.assign([
  {id:'u1', organization_id:'o1', organization:{name:'가 조직'}, occurred_at:'2026-10-09T01:00:00Z', raw_text:'가 조직 기록'},
  {id:'u2', organization_id:'o9', organization:{name:'다른 조직'}, occurred_at:'2026-10-05T01:00:00Z', raw_text:'담당 밖 기록'},
], {mine:new Set(['o1', 'o2'])});
const materials = () => ({
  events:ok([{id:'e1', calendarId:'c', title:'월요일 일정', start:'2026-10-05T10:00:00+09:00', end:'2026-10-05T11:00:00+09:00'}]),
  tasks:ok([{id:'t1', title:'끝낸 일', status:'completed', completed:'2026-10-06T01:00:00Z'}]),
  basket:ok(basket), orgUpdates:ok(orgUpdates), projectUpdates:ok(progress), catalog:ok(tree),
  meetings:ok([{id:'m2', title:'운영위원회', series_name:'운영위원회', round_no:3, meeting_at:'2026-10-08T01:00:00Z'},
    {id:'m1', title:'가상 간담회', series_name:null, round_no:null, meeting_at:'2026-10-06T05:00:00Z'}]),
  documents:ok([{id:'d1', title:'가상 자료', category:'교육', created_at:'2026-10-06T01:00:00Z'}]),
  sharePages:ok([{id:'s1', title:'가상 페이지', status:'published', updated_at:'2026-10-07T01:00:00Z'}]),
});
const lines = new Map([['2026-10-05', {raw_text:'월요일 한 줄\n둘째 한 줄'}]]);
const base = {start:'2026-10-05', lines, linesState:'ok', today:'2026-10-06'};

test('요약: 사업영역 → 세부 과제 rows in the project tree order; a 사안 record is "세부과제 › 사안: 내용"', async () => {
  const m = await mod, w = m.weeklySummary({...base, materials:materials()});
  const s = w.summary;
  assert.equal(s.loading, false); assert.deepEqual(s.failed, []); assert.equal(s.ordered, true);
  assert.deepEqual(s.areas.map(a => a.name), ['사업영역 A', '사업영역 C']);
  const [a, c] = s.areas;
  // The area's own row first, then 세부 과제 in tree order (A-1 before A-2), whatever the record days.
  assert.deepEqual(a.rows.map(r => r.task?.name || ''), ['', '세부 과제 A-1', '세부 과제 A-2']);
  // In one row: the 2단 record and its 3단 records by tree order (2단 first), then by day.
  assert.deepEqual(a.rows[1].items.map(m.summaryLine), ['세부 과제 A-1: A-1 기록', '세부 과제 A-1 › 사안 A-1-가: 프로젝트로 보낸 업데이트', '세부 과제 A-1 › 사안 A-1-가: 사안 기록']);
  assert.deepEqual(a.rows[1].items.map(i => i.issue), [false, true, true]);
  assert.deepEqual(a.rows[0].items.map(m.summaryLine), ['영역 전체 기록']);
  assert.deepEqual(c.rows.map(r => r.items.map(m.summaryLine)), [['세부 과제 C-1: C-1 월요일 기록']]);
  // Records of another week are not here; a project outside the tree goes under its name.
  assert.equal(JSON.stringify(s).includes('다음 주 기록'), false);
  assert.deepEqual(s.others, [{name:'보관된 프로젝트', items:[{day:'2026-10-06', text:'보관 기록', requests:[]}]}]);
  assert.deepEqual(s.quiet, ['사업영역 B']);
  assert.equal(s.count, 7);
});

test('조직 소식 in the organization order (named, then 그 외, then 미분류); 기타 메모 and notes stay in 참고', async () => {
  const m = await mod, w = m.weeklySummary({...base, materials:materials()});
  assert.deepEqual(w.orgs.sections.map(s => s.name), ['가 조직', '나 조직', '그 외', '미분류']);
  assert.deepEqual(w.orgs.sections.find(s => s.name === '그 외').items, [{day:'2026-10-05', text:'다른 조직 · 담당 밖 기록', requests:[]}]);
  // A project record never shows in 조직 소식, and an organization update never in 요약.
  assert.equal(JSON.stringify(w.orgs).includes('프로젝트로 보낸'), false);
  assert.equal(JSON.stringify(w.summary).includes('조직으로 보낸'), false);
  // 회의·행사 결과 by the meeting's date.
  assert.deepEqual(w.meetings.items, [{day:'2026-10-06', text:'14:00 가상 간담회'}, {day:'2026-10-08', text:'10:00 운영위원회 3차'}]);
  // This week's events are not 참고 any more (WEEKLY-주요일정): 5. 주요 일정 reads the two weeks after.
  assert.equal('schedule' in w.notes, false);
  assert.equal(JSON.stringify(w).includes('월요일 일정'), false);
  assert.deepEqual(w.notes.lines.items.map(i => i.text), ['월요일 한 줄', '둘째 한 줄']);
  assert.deepEqual(w.notes.memos.items, [{day:'2026-10-08', text:'일지에 남긴 메모'}]);
  assert.deepEqual(w.notes.docs.items.map(i => i.day), ['2026-10-06']);
  assert.deepEqual(w.notes.shares.items.map(i => i.day), ['2026-10-07']);
  // No 요청사항 material is gathered (#859; the input waits for decision W).
  assert.equal('requests' in w, false);
});

test('an empty week: every part is ready and empty', async () => {
  const m = await mod;
  const all = {events:empty, upcoming:empty, tasks:empty, basket:ok({notes:[], links:[], docs:[]}), orgUpdates:empty, projectUpdates:empty, catalog:ok(tree), meetings:empty, documents:empty, sharePages:empty};
  const w = m.weeklySummary({...base, lines:new Map(), materials:all});
  assert.deepEqual([w.summary.areas, w.summary.others, w.orgs.sections, w.meetings.items], [[], [], [], []]);
  assert.equal(w.summary.count, 0);
  for (const part of Object.values(w.notes)) assert.deepEqual(part.items, []);
  assert.deepEqual([w.calendar.rows, w.calendar.vacations, w.calendar.days.length], [[], [], 14]);
});

test('one failed read marks only its own part; without the project tree records go under project names', async () => {
  const m = await mod;
  const w = m.weeklySummary({...base, materials:{...materials(), orgUpdates:{status:'failed'}, catalog:{status:'failed'}, meetings:{status:'failed'}}});
  assert.deepEqual(w.orgs.failed, ['orgUpdates']);
  // The basket half of 조직 소식 is still there.
  assert.deepEqual(w.orgs.sections.map(s => s.name), ['나 조직', '미분류']);
  assert.deepEqual(w.meetings.failed, ['meetings']);
  assert.deepEqual(w.summary.failed, ['catalog']); assert.equal(w.summary.ordered, false); assert.deepEqual(w.summary.areas, []);
  assert.deepEqual(w.summary.others.map(o => o.name), ['보관된 프로젝트', '사안 A-1-가', '사업영역 A', '세부 과제 A-1', '세부 과제 A-2', '세부 과제 C-1']);
  assert.deepEqual(w.notes.docs.failed, []);
  // A read still out is loading, not failed; the two-week calendar read fails on its own.
  const loading = m.weeklySummary({...base, materials:{...materials(), upcoming:{status:'loading'}}});
  assert.equal(loading.calendar.loading, true);
  const off = m.weeklySummary({...base, materials:{...materials(), upcoming:{status:'failed'}}});
  assert.deepEqual([off.calendar.failed, off.orgs.failed], [['upcoming'], []]);
  assert.equal(m.weeklySummary({...base, linesState:'failed', lines:new Map()}).notes.lines.failed.length, 1);
});

test('a tree deeper than 3단 puts the deeper record on its 세부 과제 row', async () => {
  const m = await mod;
  const deep = [{project:{id:'A', name:'영역'}, depth:0}, {project:{id:'T', name:'과제'}, depth:1}, {project:{id:'I', name:'사안'}, depth:2}, {project:{id:'D', name:'더 깊은 것'}, depth:3}];
  const placed = m.placeRecords([{id:'D', name:'더 깊은 것', day:'2026-10-06', at:'2026-10-06T01:00:00Z', text:'깊은 기록'}], deep);
  assert.deepEqual(placed.areas[0].rows.map(r => [r.task.name, r.items.map(m.summaryLine)]), [['과제', ['과제 › 더 깊은 것: 깊은 기록']]]);
});

// WEEKLY-주요일정 (2026-10-21 사용자 결정): 5. 주요 일정 = the two weeks (Monday to Sunday twice) from the Monday after the shown
// week; a vacation is a "※ 휴가" line, not a row; an event marked 일기·비공개 is left out. Fake titles and places only.
const upcoming = [
  {id:'u1', calendarId:'c', title:'가상 회의', location:'가상 장소', start:'2026-10-13T10:30:00+09:00', end:'2026-10-13T12:00:00+09:00'},
  {id:'u1', calendarId:'c', title:'가상 회의', location:'가상 장소', start:'2026-10-13T10:30:00+09:00', end:'2026-10-13T12:00:00+09:00'},
  {id:'u2', calendarId:'c', title:'가상 아침 일정', start:'2026-10-13T09:00:00+09:00', end:'2026-10-13T09:30:00+09:00'},
  {id:'u3', calendarId:'c', title:'가상 수련회', location:'가상 연수원', allDay:true, start:'2026-10-13', end:'2026-10-15'},
  {id:'u4', calendarId:'c', title:'가상 종일 행사', allDay:true, start:'2026-10-13', end:'2026-10-14'},
  {id:'u5', calendarId:'c', title:'연차', allDay:true, start:'2026-10-23', end:'2026-10-24'},
  {id:'u6', calendarId:'c', title:'여름 휴가', allDay:true, start:'2026-10-19', end:'2026-10-22'},
  {id:'u7', calendarId:'c', title:'오후 반차', start:'2026-10-16T13:00:00+09:00', end:'2026-10-16T18:00:00+09:00'},
  {id:'u8', calendarId:'c', title:'일기 쓰기', start:'2026-10-14T21:00:00+09:00', end:'2026-10-14T22:00:00+09:00'},
  {id:'u9', calendarId:'c', title:'가상 약속', description:'비공개', start:'2026-10-15T19:00:00+09:00', end:'2026-10-15T20:00:00+09:00'},
  {id:'u10', calendarId:'c', title:'이번 주 일정', start:'2026-10-11T10:00:00+09:00', end:'2026-10-11T11:00:00+09:00'},
  {id:'u11', calendarId:'c', title:'셋째 주 일정', start:'2026-10-26T00:00:00+09:00', end:'2026-10-26T01:00:00+09:00'},
  {id:'u12', calendarId:'c', title:'걸친 출장', allDay:true, start:'2026-10-10', end:'2026-10-13'},
  {id:'u13', calendarId:'c', title:'가상 마지막 날', start:'2026-10-25T23:00:00+09:00', end:'2026-10-25T23:30:00+09:00'},
];

test('5. 주요 일정: the two weeks after the shown week, form cells, vacations apart, 일기·비공개 left out', async () => {
  const m = await mod;
  const c = m.upcomingSchedule(upcoming, '2026-10-05');
  assert.deepEqual([c.days[0], c.days.at(-1), c.days.length], ['2026-10-12', '2026-10-25', 14]);
  assert.deepEqual(c.rows.map(r => [r.label, r.items.map(i => i.what)]), [
    // Began before the two weeks: on the first day, with its own dates.
    ['10.10.(토) ~ 10.12.(월)', ['종일 / 걸친 출장']],
    // One day: 종일 first, then by time (the duplicate read once); then the several-day event on its own row.
    ['10.13.(화)', ['종일 / 가상 종일 행사', '09:00 / 가상 아침 일정', '10:30 / 가상 회의 / 가상 장소']],
    ['10.13.(화) ~ 10.14.(수)', ['종일 / 가상 수련회 / 가상 연수원']],
    ['10.25.(일)', ['23:00 / 가상 마지막 날']],
  ]);
  assert.deepEqual(c.vacations.map(v => [v.first, v.last, v.title]), [['2026-10-16', '2026-10-16', '오후 반차'], ['2026-10-19', '2026-10-21', '여름 휴가'], ['2026-10-23', '2026-10-23', '연차']]);
  assert.equal(m.vacationLine(c.vacations), '※ 휴가: 10/16(금) 오후 반차, 10/19(월)~10/21(수) 여름 휴가, 10/23(금) 연차');
  assert.equal(m.vacationLine([]), '');
  assert.equal(JSON.stringify(c).match(/일기|비공개|가상 약속|이번 주 일정|셋째 주 일정/), null);
  assert.equal(m.isPrivateEvent({title:'가상', description:'메모 — 비공개'}), true);
  assert.equal(m.isVacation({title:'병가'}), true);
  assert.equal(m.isVacation({title:'가상 회의'}), false);
  // The shown week sets the range (a past week stays the same whatever today is).
  assert.deepEqual(m.upcomingSchedule([], '2026-09-28').days.slice(0, 1), ['2026-10-05']);
  // In the week model: one part with its own read.
  const w = m.weeklySummary({...base, materials:{...materials(), upcoming:ok(upcoming)}});
  assert.equal(w.calendar.rows.length, 4);
  assert.deepEqual(m.WEEKLY_SOURCES.calendar, ['upcoming']);
});

test('5. 주요 일정 in the .hwpx form: 14 day rows (empty days keep their date), several-day rows after their first day, my name, ※ vacation lines', async () => {
  const m = await mod;
  const w = m.weeklySummary({...base, materials:{...materials(), upcoming:ok(upcoming)}});
  const f = m.scheduleForm(w.calendar, '가상 담당');
  assert.deepEqual(f.calendar.map(d => d.day), ['10.12.(월)', '10.10.(토) ~ 10.12.(월)', '10.13.(화)', '10.13.(화) ~ 10.14.(수)', '10.14.(수)', '10.15.(목)', '10.16.(금)', '10.17.(토)', '10.18.(일)',
    '10.19.(월)', '10.20.(화)', '10.21.(수)', '10.22.(목)', '10.23.(금)', '10.24.(토)', '10.25.(일)']);
  assert.deepEqual(f.calendar[0].items, []);
  assert.deepEqual(f.calendar[2].items, [{what:'종일 / 가상 종일 행사', who:['가상 담당']}, {what:'09:00 / 가상 아침 일정', who:['가상 담당']}, {what:'10:30 / 가상 회의 / 가상 장소', who:['가상 담당']}]);
  assert.deepEqual(f.calendarNotes, ['※ 10.16.(금) 가상 담당 오후 반차', '※ 10.19.(월)~10.21.(수) 가상 담당 여름 휴가', '※ 10.23.(금) 가상 담당 연차']);
  // Without a name the cells stay empty; a failed read keeps the 14 dates with empty cells and no vacation line.
  assert.deepEqual(m.scheduleForm(w.calendar, '').calendar[2].items[0].who, []);
  const failed = m.scheduleForm(m.weeklySummary({...base, materials:{...materials(), upcoming:{status:'failed'}}}).calendar, '가상 담당');
  assert.deepEqual([failed.calendar.length, failed.calendar.every(d => !d.items.length), failed.calendarNotes], [14, true, []]);
});

test('[주간보고 초안 복사]: the tab as text in the form order (1 → 2 → 4 → 5 → 참고)', async () => {
  const m = await mod;
  const text = m.weeklyReportText(m.weeklySummary({...base, materials:{...materials(), upcoming:ok(upcoming)}}));
  const rows = text.split('\n');
  const heads = rows.filter(r => /^(\d\. |참고$)/.test(r));
  assert.deepEqual(heads, ['1. 요청사항', '2. 기본·영역·의제 사업', '4. 산하 조직 현황', '5. 주요 일정 (10월 12일(월) ~ 10월 25일(일))', '참고']);
  assert.ok(rows.includes(`2) 주요 일정: (비워 둠) ${m.HQ_SCHEDULE_GUIDE}`));
  // 요약 in the project tree order with the record's day.
  const sum = rows.indexOf('1) 요약');
  assert.deepEqual(rows.slice(sum + 1, sum + 4), ['◦ 사업영역 A', '- 10월 6일(화) 영역 전체 기록', '- 10월 8일(목) 세부 과제 A-1: A-1 기록']);
  const five = rows.indexOf('5. 주요 일정 (10월 12일(월) ~ 10월 25일(일))');
  assert.deepEqual(rows.slice(five + 1, five + 9), ['- 10.10.(토) ~ 10.12.(월) 종일 / 걸친 출장', '- 10.13.(화) 종일 / 가상 종일 행사', '- 10.13.(화) 09:00 / 가상 아침 일정',
    '- 10.13.(화) 10:30 / 가상 회의 / 가상 장소', '- 10.13.(화) ~ 10.14.(수) 종일 / 가상 수련회 / 가상 연수원', '- 10.25.(일) 23:00 / 가상 마지막 날',
    '※ 휴가: 10/16(금) 오후 반차, 10/19(월)~10/21(수) 여름 휴가, 10/23(금) 연차', '']);
  assert.equal(/일기 쓰기|가상 약속/.test(text), false);
  // A failed calendar read is said in its place and at the end; the rest stays.
  const off = m.weeklyReportText(m.weeklySummary({...base, materials:{...materials(), upcoming:{status:'failed'}}}));
  assert.ok(off.includes('5. 주요 일정 (10월 12일(월) ~ 10월 25일(일))\n(불러오지 못함)\n'));
  assert.ok(off.includes('※ 달력 일정은(는) 불러오지 못해 빠졌어요.'));
});

test('■ 일시 = 상집 보고일: the Monday after the shown week (tab, draft and .hwpx write the same day)', async () => {
  const m = await mod, data = await import('../app/journal-data.js');
  assert.equal(data.reportDay('2026-10-05'), '2026-10-12');
  assert.equal(data.reportDay('2026-12-28'), '2027-01-04');
  assert.equal(m.reportDateText('2026-10-05'), '2026년 10월 12일(월)');
  assert.equal(m.reportDateText('2026-12-28'), '2027년 1월 4일(월)');
  // The same text as the .hwpx form's date line.
  const draft = await import('../app/weekly-hwpx/draft.mjs');
  assert.equal(draft.reportDate(data.reportDay('2026-10-19')), m.reportDateText('2026-10-19'));
  // 5. 주요 일정 starts on the report day.
  assert.equal(m.upcomingSchedule([], '2026-10-19').days[0], data.reportDay('2026-10-19'));
  const text = m.weeklyReportText(m.weeklySummary({...base, materials:materials()}));
  assert.equal(text.split('\n')[1], '■ 일시 : 2026년 10월 12일(월)');
});
