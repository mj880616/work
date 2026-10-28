import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// JOURNAL-다음주준비: screen-side rules of the [다음 주] box (next-week-sheet-model.mjs). Synthetic data only.
const m = await import('../app/next-week-sheet-model.mjs');
const {upcomingSchedule} = await import('../app/journal-weekly.js');

const THIS_MON = '2026-10-26', WEEK = '2026-11-02';
const ev = (id, title, day, extra = {}) => ({id, calendarId:'c', calendarName:'공공운수노조', title, start:`${day}T01:00:00Z`, end:`${day}T02:00:00Z`, ...extra});

test('① only work-calendar events of next week; personal, private and vacation events never reach the sheet or the AI', () => {
  const events = Object.assign([
    ev('w1', 'A 사업장 교섭', '2026-11-03', {location:'본부'}),
    ev('p1', '가족 모임', '2026-11-04', {calendarName:'개인'}),
    ev('d1', '일기 쓰기', '2026-11-04'),
    ev('v1', '연차', '2026-11-05'),
    ev('n1', '다다음 주 회의', '2026-11-10'),
  ], {calendarNames:['공공운수노조', '개인']});
  const items = m.buildItems({week:WEEK, schedule:upcomingSchedule(events, THIS_MON)});
  assert.deepEqual(items, [{group:'events', title:'10:00 A 사업장 교섭 · 본부', day:'2026-11-03', source_kind:'event', source_id:'w1', org:null}]);
  assert.ok(!JSON.stringify(items).includes('가족'));
});

test('②④ tasks by due day; ③ only waiting S0/S1 commitments of next week; ⑤ open todos not yet tasks; ⑥ last round of a matching meeting', () => {
  const tasks = [
    {id:'t1', title:'요구안 초안', status:'needsAction', due:'2026-11-04T00:00:00.000Z'},
    {id:'t2', title:'회의록 정리', status:'needsAction', due:'2026-10-28T00:00:00.000Z'},
    {id:'t3', title:'끝난 일', status:'completed', due:'2026-11-03T00:00:00.000Z'},
    {id:'t4', title:'다다음 주', status:'needsAction', due:'2026-11-12T00:00:00.000Z'},
    {id:'t5', title:'일요일 기한', status:'needsAction', due:'2026-11-08T00:00:00.000Z'},
  ];
  const ledger = [
    {id:'l1', kind:'commitment', title:'B 지부 자료 회신', validity:'current', sensitivity:'S1', counterparty:'B 지부', commitment_status:'waiting', follow_up_on:'2026-11-05'},
    {id:'l2', kind:'commitment', title:'전략 메모', validity:'current', sensitivity:'S2', commitment_status:'waiting', follow_up_on:'2026-11-05'},
    {id:'l3', kind:'commitment', title:'이행됨', validity:'current', sensitivity:'S0', commitment_status:'fulfilled', follow_up_on:'2026-11-05'},
  ];
  const todos = [
    {id:'c1', summary:'현수막 시안 확인', status:'open', task_id:null},
    {id:'c2', summary:'할 일로 보냄', status:'open', task_id:'t1'},
    {id:'c3', summary:'사측 안 검토', status:'open', task_id:null, source_kind:'meeting', source_id:'m2'},
  ];
  const meetings = [
    {id:'m2', series_name:'A 사업장 교섭', round_no:3, next_plan:'사측 안 검토\n둘째 줄'},
    {id:'m1', series_name:'A 사업장 교섭', round_no:2, next_plan:'예전'},
  ];
  const schedule = upcomingSchedule(Object.assign([ev('w1', 'A사업장 교섭', '2026-11-03')], {calendarNames:['공공운수노조']}), THIS_MON);
  const items = m.buildItems({week:WEEK, schedule, tasks, ledger, todos, meetings});
  const by = g => items.filter(i => i.group === g).map(i => [i.title, i.day, i.source_kind, i.source_id]);
  assert.deepEqual(by('tasks'), [['요구안 초안', '2026-11-04', 'task', 't1'], ['일요일 기한', '2026-11-08', 'task', 't5']]);
  assert.deepEqual(by('overdue'), [['회의록 정리', '2026-10-28', 'task', 't2']]);
  assert.deepEqual(by('commitments'), [['B 지부 자료 회신', '2026-11-05', 'ledger', 'l1']]);
  assert.deepEqual(by('todos'), [['현수막 시안 확인', null, 'todo', 'c1']]);
  assert.deepEqual(by('meetings'), [['A 사업장 교섭(지난 3차) 후속: 사측 안 검토', '2026-11-03', 'meeting', 'm2'], ['A 사업장 교섭 후속: 사측 안 검토', '2026-11-03', 'todo', 'c3']]);
  // Group order follows ①~⑥ and every item has only the six fields the server accepts.
  assert.deepEqual([...new Set(items.map(i => i.group))], ['events', 'tasks', 'commitments', 'overdue', 'todos', 'meetings']);
  for (const it of items) assert.deepEqual(Object.keys(it).sort(), ['day', 'group', 'org', 'source_id', 'source_kind', 'title']);
});

test('caps, cleaning and unusable ids', () => {
  const tasks = Array.from({length:40}, (_, i) => ({id:`t${i}`, title:`할 일\n${i}`, status:'needsAction', due:'2026-11-03T00:00:00.000Z'}));
  tasks.push({id:'bad id', title:'빈칸 id', status:'needsAction', due:'2026-11-03T00:00:00.000Z'});
  const items = m.buildItems({week:WEEK, tasks});
  assert.equal(items.length, m.GROUP_CAP);
  assert.equal(items[0].title, '할 일 0');
  assert.ok(!items.some(i => i.source_id === 'bad id'));
  assert.equal(m.buildItems({week:WEEK, tasks:[{id:'x', title:'가'.repeat(200), status:'needsAction', due:'2026-11-03'}]})[0].title.length, m.TITLE_MAX);
});

test('auto time: Friday 15:00 KST onward and the weekend, only for this week, only once, only when the table exists and the sheet is missing', () => {
  const fri14 = new Date('2026-10-30T05:59:00Z'), fri15 = new Date('2026-10-30T06:00:00Z'), sat = new Date('2026-10-31T03:00:00Z'), mon = new Date('2026-11-02T00:00:00Z');
  assert.equal(m.isAutoTime(fri14), false); assert.equal(m.isAutoTime(fri15), true); assert.equal(m.isAutoTime(sat), true); assert.equal(m.isAutoTime(mon), false);
  assert.deepEqual(m.seoulNow(fri15), {day:'2026-10-30', isoDow:5, hour:15, thisMonday:THIS_MON, nextMonday:WEEK});
  const read = {status:'ok', items:{missing:false, sheet:null}};
  assert.equal(m.shouldAutoMake({shownStart:THIS_MON, now:fri15, read, asked:false}), true);
  assert.equal(m.shouldAutoMake({shownStart:THIS_MON, now:fri15, read, asked:true}), false);
  assert.equal(m.shouldAutoMake({shownStart:'2026-10-19', now:fri15, read, asked:false}), false, 'a past week is only shown');
  assert.equal(m.shouldAutoMake({shownStart:THIS_MON, now:fri14, read, asked:false}), false);
  assert.equal(m.shouldAutoMake({shownStart:THIS_MON, now:fri15, read:{status:'ok', items:{missing:true}}, asked:false}), false, 'before the DB step');
  assert.equal(m.shouldAutoMake({shownStart:THIS_MON, now:fri15, read:{status:'ok', items:{missing:false, sheet:{}}}, asked:false}), false);
});

test('sheet view: summaries, top lines pointing at real lines, AI notes, empty sheet; open targets', () => {
  const groups = [
    {group:'events', title:'A 교섭', day:'2026-11-03', source_kind:'event', source_id:'w1', org:null},
    {group:'events', title:'B 회의', day:'2026-11-03', source_kind:'event', source_id:'w2', org:null},
    {group:'events', title:'C 집회', day:'2026-11-06', source_kind:'event', source_id:'w3', org:null},
    {group:'tasks', title:'요구안', day:'2026-11-04', source_kind:'task', source_id:'t1', org:null},
    {group:'commitments', title:'자료 회신', day:'2026-11-05', source_kind:'ledger', source_id:'l1', org:'B 지부'},
    {group:'evil', title:'모르는 묶음', day:null, source_kind:'event', source_id:'x', org:null},
  ];
  const v = m.sheetView({top_lines:[{text:'화요일 교섭 준비 필요함.', refs:[0, 99]}, {text:'', refs:[1]}], groups, ai_status:'ok', updated_at:'2026-10-30T06:20:00Z'}, WEEK);
  assert.equal(v.range, '11/2(월)~11/8(일)');
  assert.equal(v.made, '10/30(금) 15:20 만듦');
  assert.deepEqual(v.top, [{text:'화요일 교섭 준비 필요함.', refs:[0]}]);
  assert.deepEqual(v.groups.map(g => [g.key, g.summary]), [['events', '3건 — 화 2 · 금 1'], ['tasks', '1건 — 가장 이른 것 11/4(수)'], ['commitments', '1건 — 11/5(목) 자료 회신']]);
  assert.equal(m.sheetView({groups:[], top_lines:[], ai_status:'limit'}, WEEK).aiNote, '핵심 세 가지는 이번 달 AI 한도로 만들지 못함.');
  assert.equal(m.sheetView({groups:[], top_lines:[], ai_status:'skipped'}, WEEK).empty, true);
  assert.deepEqual(m.openTarget(groups[0]), {type:'calendar-day', day:'2026-11-03'});
  assert.deepEqual(m.openTarget(groups[3]), {type:'task', id:'t1'});
  assert.deepEqual(m.openTarget(groups[4]), {type:'ledger', id:'l1'});
  assert.deepEqual(m.openTarget({source_kind:'todo', source_id:'c1'}), {type:'todos'});
  assert.deepEqual(m.openTarget({source_kind:'meeting', source_id:'m1'}), {type:'meeting', id:'m1'});
});

test('the data module only reads: no write method, no browser storage', () => {
  const src = readFileSync(new URL('../app/next-week-sheet-data.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /method\s*:\s*['"](POST|PATCH|PUT|DELETE)/);
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB/);
  // The only server write goes through ai-assist kind=next_week_sheet.
  assert.match(src, /kind:'next_week_sheet'/);
  assert.match(src, /pending_scope=all/);
  assert.match(src, /sensitivity=in\.\(S0,S1\)/);
});
