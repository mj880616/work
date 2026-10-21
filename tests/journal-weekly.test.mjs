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
  assert.deepEqual(w.notes.schedule.items, [{day:'2026-10-05', text:'10:00 월요일 일정'}]);
  assert.deepEqual(w.notes.lines.items.map(i => i.text), ['월요일 한 줄', '둘째 한 줄']);
  assert.deepEqual(w.notes.memos.items, [{day:'2026-10-08', text:'일지에 남긴 메모'}]);
  assert.deepEqual(w.notes.docs.items.map(i => i.day), ['2026-10-06']);
  assert.deepEqual(w.notes.shares.items.map(i => i.day), ['2026-10-07']);
  // No 요청사항 material is gathered (#859; the input waits for decision W).
  assert.equal('requests' in w, false);
});

test('an empty week: every part is ready and empty', async () => {
  const m = await mod;
  const all = {events:empty, tasks:empty, basket:ok({notes:[], links:[], docs:[]}), orgUpdates:empty, projectUpdates:empty, catalog:ok(tree), meetings:empty, documents:empty, sharePages:empty};
  const w = m.weeklySummary({...base, lines:new Map(), materials:all});
  assert.deepEqual([w.summary.areas, w.summary.others, w.orgs.sections, w.meetings.items], [[], [], [], []]);
  assert.equal(w.summary.count, 0);
  for (const part of Object.values(w.notes)) assert.deepEqual(part.items, []);
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
  assert.deepEqual(w.notes.schedule.failed, []);
  // A read still out is loading, not failed.
  const loading = m.weeklySummary({...base, materials:{...materials(), events:{status:'loading'}}});
  assert.equal(loading.notes.schedule.loading, true);
  assert.equal(m.weeklySummary({...base, linesState:'failed', lines:new Map()}).notes.lines.failed.length, 1);
});

test('a tree deeper than 3단 puts the deeper record on its 세부 과제 row', async () => {
  const m = await mod;
  const deep = [{project:{id:'A', name:'영역'}, depth:0}, {project:{id:'T', name:'과제'}, depth:1}, {project:{id:'I', name:'사안'}, depth:2}, {project:{id:'D', name:'더 깊은 것'}, depth:3}];
  const placed = m.placeRecords([{id:'D', name:'더 깊은 것', day:'2026-10-06', at:'2026-10-06T01:00:00Z', text:'깊은 기록'}], deep);
  assert.deepEqual(placed.areas[0].rows.map(r => [r.task.name, r.items.map(m.summaryLine)]), [['과제', ['과제 › 더 깊은 것: 깊은 기록']]]);
});
