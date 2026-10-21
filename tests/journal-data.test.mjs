import { test } from 'node:test';
import assert from 'node:assert/strict';
// JOURNAL-일지 2단계: the only stored part is the day's lines (kind=work, one row a day); the materials are read and grouped on screen.
const mod = import('../app/journal-data.js');
function runtime(reply = () => []) {
  const calls = [];
  return {calls, context:{read:() => ({user:{id:'u'}, workspace:{id:'w'}})}, api:async (path, options = {}) => { calls.push({path, ...options}); return reply(path, options); }};
}
const params = call => new URL(call.path, 'https://x.invalid').searchParams;
// [주간보고 초안 복사] (2026-10-21: in the weekly report form's order — journal-weekly.js weeklyReportText over weeklySummary, the
// same grouping as [주간 정리]). The project tree and the two-week calendar read are ready and empty unless a test gives them.
const weekly = import('../app/journal-weekly.js');
const draftOf = async ({materials = {}, linesState = 'ok', ...rest}) => {
  const w = await weekly;
  return w.weeklyReportText(w.weeklySummary({linesState, ...rest, materials:{catalog:{status:'ok', items:[]}, upcoming:{status:'ok', items:[]}, ...materials}}));
};
// The lines of one numbered part of the draft (from its title to the next blank line).
const partOf = (text, title) => { const rows = text.split('\n'), at = rows.indexOf(title); assert.ok(at >= 0, title); const end = rows.indexOf('', at); return rows.slice(at + 1, end < 0 ? undefined : end); };

test('weeks run Monday to Sunday in Korea time and move by seven days', async () => {
  const m = await mod;
  assert.equal(m.weekStart('2026-10-06'), '2026-10-05');
  assert.equal(m.weekStart('2026-10-05'), '2026-10-05');
  assert.equal(m.weekStart('2026-10-11'), '2026-10-05');
  assert.deepEqual(m.weekDays('2026-09-28'), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  assert.equal(m.shiftWeek('2026-10-05', -1), '2026-09-28');
  assert.equal(m.shiftWeek('2026-12-28', 1), '2027-01-04');
  assert.throws(() => m.weekStart('2026-02-30'), /날짜/);
});

test('the line is one line of 1~300 characters, counted like PostgreSQL length()', async () => {
  const m = await mod;
  assert.equal(m.validateWorkLine('  회의 정리  '), '회의 정리');
  assert.throws(() => m.validateWorkLine('첫 줄\n둘째 줄'), e => e.code === 'line_break');
  assert.throws(() => m.validateWorkLine('a\rb'), e => e.code === 'line_break');
  assert.throws(() => m.validateWorkLine('   '), e => e.code === 'empty');
  assert.equal(m.validateWorkLine('가'.repeat(300)).length, 300);
  assert.throws(() => m.validateWorkLine('가'.repeat(301)), e => e.code === 'too_long');
  // 300 emoji are 600 UTF-16 units but 300 characters.
  assert.equal([...m.validateWorkLine('😀'.repeat(300))].length, 300);
});

test('week and day reads are kind=work in the signed-in workspace only', async () => {
  const m = await mod, rt = runtime();
  await m.readWorkWeek('2026-10-05', rt); await m.readWorkDay('2026-10-06', rt);
  const [week, day] = rt.calls.map(params);
  assert.equal(week.get('workspace_id'), 'eq.w'); assert.equal(week.get('kind'), 'eq.work');
  assert.deepEqual(week.getAll('journal_day'), ['gte.2026-10-05', 'lte.2026-10-11']);
  assert.equal(day.get('kind'), 'eq.work'); assert.equal(day.get('journal_day'), 'eq.2026-10-06');
});

test('a day holds its lines in saving order; an old one-line day is line 1; joining keeps the per-line rules', async () => {
  const m = await mod;
  assert.deepEqual(m.workLines({raw_text:'옛 한 줄'}), ['옛 한 줄']);
  assert.deepEqual(m.workLines({raw_text:'첫 줄\n둘째 줄\n셋째 줄'}), ['첫 줄', '둘째 줄', '셋째 줄']);
  assert.deepEqual(m.workLines(null), []);
  assert.equal(m.joinWorkLines(['가', '나']), '가\n나');
  assert.equal(m.joinWorkLines(['가'.repeat(300), '나'.repeat(300)]).length, 601);
  assert.throws(() => m.joinWorkLines(['가', '나'.repeat(301)]), e => e.code === 'too_long');
  assert.throws(() => m.joinWorkLines(['가', ' ']), e => e.code === 'empty');
  assert.throws(() => m.joinWorkLines(Array(51).fill('줄')), e => e.code === 'too_many');
  assert.equal(m.joinWorkLines(Array(50).fill('줄')).split('\n').length, 50);
  // Line changes find a moved line again by its text and refuse a line that is gone.
  assert.deepEqual(m.addLine(' 셋 ')(['하나', '둘']), ['하나', '둘', '셋']);
  assert.deepEqual(m.editLine(1, '둘', '둘 고침')(['하나', '둘', '셋']), ['하나', '둘 고침', '셋']);
  assert.deepEqual(m.editLine(1, '둘', '둘 고침')(['새 줄', '하나', '둘']), ['새 줄', '하나', '둘 고침']);
  assert.throws(() => m.editLine(1, '둘', 'x')(['하나']), e => e.code === 'line_missing');
  assert.deepEqual(m.removeLine(0, '하나')(['하나', '둘']), ['둘']);
  assert.deepEqual(m.restoreLine(0, '하나')(['둘']), ['하나', '둘']);
  assert.deepEqual(m.restoreLine(5, '끝')(['둘']), ['둘', '끝']);
  assert.throws(() => m.addLine('a\nb')([]), e => e.code === 'line_break');
});

test('save: a new day POSTs its first line; a known day PATCHes the joined lines guarded by updated_at', async () => {
  const m = await mod;
  let rt = runtime((path, o) => [{id:'k1', journal_day:'2026-10-06', updated_at:'u1', ...o.body}]);
  const first = await m.changeWorkDay({day:'2026-10-06', change:m.addLine(' 오늘 한 일 ')}, rt);
  assert.equal(rt.calls[0].path, '/rest/v1/app_notes'); assert.equal(rt.calls[0].method, 'POST');
  assert.deepEqual(rt.calls[0].body, {workspace_id:'w', kind:'work', journal_day:'2026-10-06', raw_text:'오늘 한 일'});
  assert.equal(first.row.raw_text, '오늘 한 일');
  rt = runtime((path, o) => [{id:'k1', journal_day:'2026-10-06', ...o.body}]);
  await m.changeWorkDay({day:'2026-10-06', row:{id:'k1', raw_text:'오늘 한 일', updated_at:'2026-10-06T01:00:00Z'}, change:m.addLine('둘째 줄')}, rt);
  const edit = params(rt.calls[0]);
  assert.equal(rt.calls[0].method, 'PATCH'); assert.equal(edit.get('id'), 'eq.k1'); assert.equal(edit.get('kind'), 'eq.work'); assert.equal(edit.get('workspace_id'), 'eq.w');
  assert.equal(edit.get('updated_at'), 'eq.2026-10-06T01:00:00Z');
  assert.equal(rt.calls[0].body.raw_text, '오늘 한 일\n둘째 줄'); assert.ok(rt.calls[0].body.updated_at);
  assert.deepEqual(Object.keys(rt.calls[0].body).sort(), ['raw_text', 'updated_at']);
  // Removing the last line deletes the day's row (same guard), so the day loses its dot.
  rt = runtime((path, o) => [{id:'k1'}]);
  const gone = await m.changeWorkDay({day:'2026-10-06', row:{id:'k1', raw_text:'하나', updated_at:'u'}, change:m.removeLine(0, '하나')}, rt);
  assert.equal(gone.row, null); assert.equal(rt.calls[0].method, 'DELETE'); assert.equal(params(rt.calls[0]).get('updated_at'), 'eq.u'); assert.equal(params(rt.calls[0]).get('kind'), 'eq.work');
  rt = runtime();
  await assert.rejects(m.changeWorkDay({day:'2026-10-06', change:m.addLine('a\nb')}, rt), e => e.code === 'line_break');
  assert.equal(rt.calls.length, 0);
});

test('another device: a 409 for a new day or a changed row is read again and the same change applied to its lines', async () => {
  const m = await mod;
  let rt = runtime((path, o) => {
    if (o.method === 'POST') throw Object.assign(new Error('dup'), {status:409});
    if (!o.method) return [{id:'k9', journal_day:'2026-10-06', raw_text:'다른 기기', updated_at:'u9'}];
    return [{id:'k9', journal_day:'2026-10-06', ...o.body}];
  });
  const saved = await m.changeWorkDay({day:'2026-10-06', change:m.addLine('이 기기')}, rt);
  assert.equal(saved.row.raw_text, '다른 기기\n이 기기');
  assert.deepEqual(rt.calls.map(c => c.method || 'GET'), ['POST', 'GET', 'PATCH']);
  assert.equal(params(rt.calls[2]).get('updated_at'), 'eq.u9');
  // A guarded PATCH that matched nothing (the row changed) reads the row again.
  let patches = 0;
  rt = runtime((path, o) => {
    if (!o.method) return [{id:'k1', journal_day:'2026-10-06', raw_text:'하나\n다른 기기 줄', updated_at:'u2'}];
    return ++patches === 1 ? [] : [{id:'k1', journal_day:'2026-10-06', ...o.body}];
  });
  const merged = await m.changeWorkDay({day:'2026-10-06', row:{id:'k1', raw_text:'하나', updated_at:'u1'}, change:m.addLine('이 기기 줄')}, rt);
  assert.equal(merged.row.raw_text, '하나\n다른 기기 줄\n이 기기 줄');
  // Editing a line another device removed is refused, not guessed.
  rt = runtime((path, o) => !o.method ? [{id:'k1', journal_day:'2026-10-06', raw_text:'남은 줄', updated_at:'u2'}] : []);
  await assert.rejects(m.changeWorkDay({day:'2026-10-06', row:{id:'k1', raw_text:'지워질 줄\n남은 줄', updated_at:'u1'}, change:m.editLine(0, '지워질 줄', '고침')}, rt), e => e.code === 'line_missing');
  // Before the database change (20261020051027) a second line is refused with 400: plain notice, nothing guessed.
  rt = runtime((path, o) => { if (o.method === 'PATCH') throw Object.assign(new Error('check'), {status:400}); return []; });
  await assert.rejects(m.changeWorkDay({day:'2026-10-06', row:{id:'k1', raw_text:'하나', updated_at:'u'}, change:m.addLine('둘')}, rt), e => e.code === 'lines_not_ready');
  assert.equal(rt.calls.length, 1);
});

test('materials: events of the week, done tasks, every basket update (kind=basket) and the week of organization/project records and meetings', async () => {
  const m = await mod;
  const rt = runtime(path => {
    if (path.includes('google-calendar')) return {events:[{id:'e', title:'회의', start:'2026-10-06T10:00:00+09:00', end:'2026-10-06T11:00:00+09:00'}]};
    if (path.includes('google-tasks')) return {tasks:[{id:'t1', title:'끝', status:'completed', completed:'2026-10-06T03:00:00Z'}, {id:'t2', title:'남음', status:'needsAction'}]};
    if (path.startsWith('/rest/v1/app_suborganizations?')) return [{id:'o1', name:'가 조직'}, {id:'o2', name:'나 조직'}];
    if (path.startsWith('/rest/v1/app_suborganization_updates?')) return [{id:'u1', organization_id:'o1', occurred_at:'2026-10-06T01:00:00Z', raw_text:'기록'}, {id:'u9', organization_id:'other', occurred_at:'2026-10-06T01:00:00Z', raw_text:'다른 공간'}];
    if (path.startsWith('/rest/v1/app_project_progress_updates?')) return [{id:'p1', project_id:'s1', summary:'진행', effective_on:'2026-10-06'}, {id:'p9', project_id:'s9', summary:'다른 공간', effective_on:'2026-10-06'}];
    if (path.startsWith('/rest/v1/app_spaces?')) return [{id:'s1', name:'사업 A'}];
    return [];
  });
  const events = await m.readWeekEvents('2026-10-05', rt);
  const tasks = await m.readDoneTasks(rt);
  const basket = await m.readBasketUpdates(rt);
  const orgs = await m.readOrgUpdates('2026-10-05', rt);
  const projects = await m.readProjectUpdates('2026-10-05', rt);
  await m.readWeekMeetings('2026-10-05', rt);
  const cal = params(rt.calls[0]);
  assert.equal(cal.get('action'), 'events');
  assert.equal(cal.get('timeMin'), '2026-10-04T15:00:00.000Z'); assert.equal(cal.get('timeMax'), '2026-10-11T15:00:00.000Z');
  assert.equal(events.length, 1);
  assert.deepEqual(tasks.map(t => t.id), ['t1']);
  // Every basket row (no state filter: 미분류, sent to an organization or a project, 보류 alike), with its links and filed documents.
  const memos = rt.calls.find(c => c.path.startsWith('/rest/v1/app_notes') && params(c).get('kind') === 'eq.basket');
  assert.ok(memos);
  assert.deepEqual([...params(memos).keys()].filter(k => !['workspace_id', 'kind', 'select', 'order', 'limit', 'offset'].includes(k)), []);
  assert.deepEqual(Object.keys(basket).sort(), ['docs', 'links', 'notes']);
  // Organization records: this workspace's organizations only, the week in Korea time.
  const orgRead = rt.calls.find(c => c.path.startsWith('/rest/v1/app_suborganizations?'));
  assert.equal(params(orgRead).get('workspace_id'), 'eq.w');
  const upd = params(rt.calls.find(c => c.path.startsWith('/rest/v1/app_suborganization_updates?')));
  assert.equal(upd.get('organization_id'), 'in.(o1,o2)');
  assert.deepEqual(upd.getAll('occurred_at'), ['gte.2026-10-04T15:00:00.000Z', 'lt.2026-10-11T15:00:00.000Z']);
  assert.deepEqual(orgs.map(r => [r.id, r.organization.name]), [['u1', '가 조직']]);
  // Project records by their day, named from this workspace's projects only.
  const prog = params(rt.calls.find(c => c.path.startsWith('/rest/v1/app_project_progress_updates?')));
  assert.deepEqual(prog.getAll('effective_on'), ['gte.2026-10-05', 'lte.2026-10-11']);
  const spaces = params(rt.calls.find(c => c.path.startsWith('/rest/v1/app_spaces?')));
  assert.equal(spaces.get('workspace_id'), 'eq.w'); assert.equal(spaces.get('id'), 'in.(s1,s9)');
  assert.deepEqual(projects.map(r => [r.id, r.project.name]), [['p1', '사업 A']]);
  // Meetings of the week in this workspace by meeting_at.
  const meet = params(rt.calls.find(c => c.path.startsWith('/rest/v1/app_meetings?')));
  assert.equal(meet.get('workspace_id'), 'eq.w');
  assert.deepEqual(meet.getAll('meeting_at'), ['gte.2026-10-04T15:00:00.000Z', 'lt.2026-10-11T15:00:00.000Z']);
  // Notes are not a group any more (고친 노트 was removed).
  assert.equal(rt.calls.some(c => c.path.startsWith('/rest/v1/app_notes') && params(c).get('kind') === 'eq.note'), false);
  // A disconnected calendar or a reconnect answer counts as a failed group, not as an empty day.
  await assert.rejects(m.readWeekEvents('2026-10-05', runtime(() => ({connected:false, events:[]}))));
  await assert.rejects(m.readWeekEvents('2026-10-05', runtime(() => ({events:[], warning:'Google Calendar 연결 실패'}))));
  await assert.rejects(m.readDoneTasks(runtime(() => ({tasks:[], needs_reconnect:true}))));
});

test('organization records are read in pages and in batches of 100 organizations, none dropped', async () => {
  const m = await mod;
  const orgs = Array.from({length:150}, (_, i) => ({id:`o${i}`, name:`조직 ${i}`}));
  const rt = runtime((path) => {
    const q = params({path});
    const offset = Number(q.get('offset') || 0);
    if (path.startsWith('/rest/v1/app_suborganizations?')) return orgs.slice(offset, offset + 100);
    if (path.startsWith('/rest/v1/app_suborganization_updates?')) {
      const ids = q.get('organization_id').slice(4, -1).split(',');
      const rows = ids.flatMap(id => [0, 1].map(n => ({id:`${id}-${n}`, organization_id:id, occurred_at:'2026-10-06T01:00:00Z', raw_text:'x'})));
      return rows.slice(offset, offset + 100);
    }
    return [];
  });
  const rows = await m.readOrgUpdates('2026-10-05', rt);
  assert.equal(rows.length, 300);
});

// ORG-담당13기준: 조직 소식 follows the one "내 담당 조직" rule (app/my-organizations.js). Only my organizations get their own
// section; every other organization's update stays, under one '그 외' section, before '미분류'. Fake names only.
test('organization read carries my organizations: my active assignments, or every active one when none or the read fails', async () => {
  const m = await mod;
  const orgs = [{id:'o1', name:'가상 담당 하나', active:true}, {id:'o2', name:'가상 담당 둘', active:null}, {id:'o3', name:'가상 다른 조직', active:true}, {id:'o4', name:'가상 비활성', active:false}];
  const read = assign => { const rt = runtime(path => {
    if (path.startsWith('/rest/v1/app_suborganizations?')) return orgs;
    if (path.startsWith('/rest/v1/app_suborganization_assignees?')) { if (assign === 'fail') throw Object.assign(new Error('x'), {status:500}); return assign.map(organization_id => ({organization_id})); }
    if (path.startsWith('/rest/v1/app_suborganization_updates?')) return orgs.map(o => ({id:'u' + o.id, organization_id:o.id, occurred_at:'2026-10-06T01:00:00Z', raw_text:o.name}));
    return [];
  }); return m.readOrgUpdates('2026-10-05', rt).then(rows => ({rows, rt})); };
  const {rows, rt} = await read(['o1', 'o2', 'o4']);
  assert.deepEqual([...rows.mine], ['o1', 'o2']);
  assert.equal(rows.length, 4); // no record is dropped by the read
  const org = params(rt.calls.find(c => c.path.startsWith('/rest/v1/app_suborganizations?')));
  assert.equal(org.get('select'), 'id,name,active'); assert.equal(org.get('workspace_id'), 'eq.w');
  const mine = params(rt.calls.find(c => c.path.startsWith('/rest/v1/app_suborganization_assignees?')));
  assert.equal(mine.get('user_id'), 'eq.u'); assert.equal(mine.get('select'), 'organization_id');
  assert.deepEqual([...(await read([])).rows.mine], ['o1', 'o2', 'o3']);
  assert.deepEqual([...(await read('fail')).rows.mine], ['o1', 'o2', 'o3']);
  assert.deepEqual([...(await read(['o4'])).rows.mine], ['o1', 'o2', 'o3']);
});

test('조직 소식: my organizations each by name, the others under one 그 외 (name · update), then 미분류; the weekly draft follows', async () => {
  const m = await mod, day = '2026-10-06';
  const basket = {
    notes:[
      {id:'n1', raw_text:'담당으로 보낸 메모', occurred_at:'2026-10-06T01:00:00Z'},
      {id:'n2', raw_text:'다른 조직으로 보낸 메모', occurred_at:'2026-10-06T02:00:00Z'},
      {id:'n3', raw_text:'아직 분류 안 함', occurred_at:'2026-10-06T03:00:00Z'},
      {id:'n4', raw_text:'', attachments:[{drive_file_id:'F1', file_name:'가상 자료.pdf'}], occurred_at:'2026-10-06T04:00:00Z'},
    ],
    links:[
      {note_id:'n1', status:'confirmed', organization_id:'o1', organization:{name:'가상 담당 하나'}},
      {note_id:'n2', status:'confirmed', organization_id:'o3', organization:{name:'가상 다른 조직'}},
    ],
    docs:[{id:'d1', file_id:'F1', organization_id:'o4', organization:{name:'가상 비활성'}}],
  };
  const orgUpdates = Object.assign([
    {id:'u1', organization_id:'o2', organization:{name:'가상 담당 둘'}, occurred_at:'2026-10-06T05:00:00Z', raw_text:'담당 조직 기록'},
    {id:'u2', organization_id:'o3', organization:{name:'가상 다른 조직'}, occurred_at:'2026-10-06T06:00:00Z', raw_text:'다른 조직 기록\n둘째'},
  ], {mine:new Set(['o1', 'o2'])});
  const sections = m.orgNewsOn({basket, orgUpdates}, day);
  assert.deepEqual(sections, [
    {name:'가상 담당 둘', items:['담당 조직 기록']},
    {name:'가상 담당 하나', items:['담당으로 보낸 메모']},
    {name:'그 외', items:['가상 다른 조직 · 다른 조직으로 보낸 메모', '가상 비활성 · 첨부: 가상 자료.pdf', '가상 다른 조직 · 다른 조직 기록']},
    {name:'미분류', items:['아직 분류 안 함']},
  ]);
  assert.equal(m.OTHERS, '그 외');
  // Without the organization read (it failed) nothing is regrouped: every organization keeps its own section.
  assert.deepEqual(m.orgNewsOn({basket}, day).map(s => s.name), ['가상 다른 조직', '가상 담당 하나', '가상 비활성', '미분류']);
  const empty = {status:'ok', items:[]};
  const text = await draftOf({start:'2026-10-05', lines:new Map(), today:day, materials:{events:empty, tasks:empty, basket:{status:'ok', items:basket},
    orgUpdates:{status:'ok', items:orgUpdates}, projectUpdates:empty, meetings:empty, documents:empty, sharePages:empty}});
  assert.deepEqual(partOf(text, '4. 산하 조직 현황'), ['1) 요약',
    '◦ 가상 담당 둘', '- 10월 6일(화) 담당 조직 기록',
    '◦ 가상 담당 하나', '- 10월 6일(화) 담당으로 보낸 메모',
    '◦ 그 외', '- 10월 6일(화) 가상 다른 조직 · 다른 조직으로 보낸 메모', '- 10월 6일(화) 가상 비활성 · 첨부: 가상 자료.pdf', '- 10월 6일(화) 가상 다른 조직 · 다른 조직 기록',
    '◦ 미분류', '- 10월 6일(화) 아직 분류 안 함',
  ]);
});

test('one day of materials in display order; a failed group is marked, the rest stay', async () => {
  const m = await mod;
  const materials = {
    events:{status:'ok', items:[
      {title:'오후', start:'2026-10-06T14:00:00+09:00', end:'2026-10-06T15:00:00+09:00'},
      {title:'종일', allDay:true, start:'2026-10-05', end:'2026-10-08'},
      {title:'다른 날', start:'2026-10-07T09:00:00+09:00', end:'2026-10-07T10:00:00+09:00'},
      {title:'새벽', start:'2026-10-05T15:30:00Z', end:'2026-10-05T16:00:00Z'},
    ]},
    tasks:{status:'failed'},
    basket:{status:'ok', items:{notes:[{id:'b1', raw_text:'\n  첫 줄 메모\n둘째', occurred_at:'2026-10-06T00:00:00Z'}, {id:'b2', raw_text:'', attachments:[{}, {}], occurred_at:'2026-10-06T01:00:00Z'}, {id:'b3', raw_text:'어제', occurred_at:'2026-10-05T14:59:00Z'}], links:[], docs:[]}},
    orgUpdates:{status:'ok', items:[]}, projectUpdates:{status:'ok', items:[]},
    meetings:{status:'ok', items:[{id:'m1', series_name:'기자회견', round_no:null, meeting_at:'2026-10-06T02:00:00Z'}, {id:'m2', title:'운영위', series_name:'운영위원회', round_no:3, meeting_at:'2026-10-05T23:30:00Z'}, {id:'m3', series_name:'다른 날', meeting_at:'2026-10-06T15:00:00Z'}]},
  };
  const day = m.dayMaterials(materials, '2026-10-06');
  assert.deepEqual(day.map(g => g.label), ['일정', '끝낸 할 일', '조직 소식', '회의·행사 결과', '프로젝트 소식', '할 일 예정', '자료실 새 자료', '공유 페이지', '기타 메모']);
  assert.deepEqual(day[0].items, ['종일 종일', '00:30 새벽', '14:00 오후']);
  assert.deepEqual(day[1].failed, ['tasks']);
  assert.deepEqual(day[2].sections, [{name:'미분류', items:['첫 줄 메모', '첨부 2개']}]);
  assert.deepEqual(day[3].items, ['08:30 운영위원회 3차', '11:00 기자회견']);
  assert.equal(m.dayMaterials({}, '2026-10-06')[0].loading, true);
  // 조직 소식 waits for its three reads, then shows what it could read and names the failed one.
  assert.equal(m.dayMaterials({...materials, orgUpdates:{status:'loading'}}, '2026-10-06')[2].loading, true);
  const partial = m.dayMaterials({...materials, orgUpdates:{status:'failed'}}, '2026-10-06')[2];
  assert.deepEqual(partial.failed, ['orgUpdates']); assert.deepEqual(partial.items, ['첫 줄 메모', '첨부 2개']);
  // Project records left 조직 소식: a failed project read no longer marks it, it marks 프로젝트 소식 (which waits for its own reads).
  const noProject = m.dayMaterials({...materials, projectUpdates:{status:'failed'}}, '2026-10-06');
  assert.equal(noProject[2].failed, undefined); assert.deepEqual(noProject[4].failed, ['projectUpdates']);
  // The new groups wait for their reads; a failed Google Tasks read marks both 끝낸 할 일 and 할 일 예정.
  assert.equal(day[6].loading, true); assert.equal(day[7].loading, true);
  assert.deepEqual(day[5].failed, ['tasks']);
});

test('조직 소식: every update of the day (basket, organization record, project record) by organization name, 미분류 last, one item each', async () => {
  const m = await mod;
  const day = '2026-10-06';
  const greeting = '안녕하세요, 위원장님.\n다음 주 간담회 일정 공유드립니다.\n출처: 가상 소식지';
  const basket = {
    notes:[
      {id:'n-org', raw_text:greeting, occurred_at:'2026-10-06T00:10:00Z', archived_at:null},
      {id:'n-two', raw_text:'두 조직 공동 소식', occurred_at:'2026-10-06T00:20:00Z'},
      {id:'n-sum', raw_text:'긴 원문 첫 줄\n둘째', occurred_at:'2026-10-06T00:30:00Z'},
      {id:'n-file', raw_text:'', attachments:[{drive_file_id:'F1', file_name:'회의자료.pdf'}], occurred_at:'2026-10-06T00:40:00Z'},
      {id:'n-proj', raw_text:'사업 진행 메모', occurred_at:'2026-10-06T00:50:00Z'},
      {id:'n-none', raw_text:'아직 분류 안 함', occurred_at:'2026-10-06T14:59:59Z'},
      {id:'n-kept', raw_text:'보류한 업데이트', occurred_at:'2026-10-06T01:00:00Z', archived_at:'2026-10-06T02:00:00Z'},
      {id:'n-next', raw_text:'다음 날 0시', occurred_at:'2026-10-06T15:00:00Z'},
      {id:'n-prev', raw_text:'전날 23:59', occurred_at:'2026-10-05T14:59:59Z'},
    ],
    links:[
      {note_id:'n-org', status:'confirmed', organization_id:'o1', organization:{name:'가 조직'}},
      {note_id:'n-two', status:'confirmed', organization_id:'o1', organization:{name:'가 조직'}},
      {note_id:'n-two', status:'confirmed', organization_id:'o2', organization:{name:'나 조직'}},
      {note_id:'n-sum', status:'confirmed', organization_id:'o2', organization:{name:'나 조직'}, summary:'요약 한 줄\n요약 둘째'},
      {note_id:'n-proj', status:'confirmed', project_id:'s1', project:{name:'사업 A'}},
      {note_id:'n-none', status:'suggested', organization_id:'o1', organization:{name:'가 조직'}},
    ],
    docs:[{id:'d1', file_id:'F1', organization_id:'o2', organization:{name:'나 조직'}}],
  };
  const orgUpdates = [{id:'u1', organization_id:'o3', organization:{name:'다 조직'}, occurred_at:'2026-10-06T03:00:00Z', raw_text:'조직에 바로 쓴 업데이트\n둘째 줄'}];
  const projectUpdates = [{id:'p1', project_id:'s2', project:{name:'사업 B'}, effective_on:day, created_at:'2026-10-06T04:00:00Z', summary:'프로젝트에 바로 쓴 업데이트\n둘째'}, {id:'p2', project:{name:'사업 B'}, effective_on:'2026-10-07', summary:'다른 날'}];
  const sections = m.orgNewsOn({basket, orgUpdates, projectUpdates}, day);
  assert.deepEqual(sections, [
    {name:'가 조직', items:['안녕하세요, 위원장님.', '두 조직 공동 소식']},
    {name:'나 조직', items:['두 조직 공동 소식', '요약 한 줄', '첨부: 회의자료.pdf']},
    {name:'다 조직', items:['조직에 바로 쓴 업데이트']},
    {name:'미분류', items:['보류한 업데이트', '아직 분류 안 함']},
  ]);
  // JOURNAL-주간보고허브: project records and updates sent only to a project are 프로젝트 소식, by project name, not 미분류.
  assert.deepEqual(m.projectNewsOn({basket, orgUpdates, projectUpdates}, day), [
    {name:'사업 A', items:['사업 진행 메모']},
    {name:'사업 B', items:['프로젝트에 바로 쓴 업데이트']},
  ]);
  assert.equal(sections.flatMap(s => s.items).some(item => item.includes('사업 진행 메모') || item.includes('프로젝트에 바로 쓴')), false);
  // One update with several lines is one item: its body lines never become items of their own.
  const all = sections.flatMap(s => s.items);
  for (const line of ['다음 주 간담회 일정 공유드립니다.', '출처: 가상 소식지', '둘째 줄', '요약 둘째']) assert.equal(all.includes(line), false);
  // Korea-time day boundaries: 00:00 next day and 23:59 the day before are not this day.
  assert.equal(all.includes('다음 날 0시'), false); assert.equal(all.includes('전날 23:59'), false);
  assert.deepEqual(m.orgNewsOn({basket}, '2026-10-07').flatMap(s => s.items), ['다음 날 0시']);
  // No cap on how many updates a day shows.
  const many = {notes:Array.from({length:60}, (_, i) => ({id:`x${i}`, raw_text:`업데이트 ${i}`, occurred_at:'2026-10-06T05:00:00Z'})), links:[], docs:[]};
  assert.equal(m.orgNewsOn({basket:many}, day)[0].items.length, 60);
});

test('one update, one line: the first non-empty line of any line break kind, cut at 80 characters', async () => {
  const m = await mod;
  assert.equal(m.firstLine('첫 줄\r\n둘째'), '첫 줄');
  assert.equal(m.firstLine('첫 줄\r둘째'), '첫 줄');
  assert.equal(m.firstLine('첫 줄 둘째'), '첫 줄');
  assert.equal(m.firstLine('가'.repeat(81)), '가'.repeat(80) + '…');
  assert.equal(m.memoLine({raw_text:'', attachments:[{file_name:'a.pdf'}, {file_name:'b.hwp'}]}), '첨부: a.pdf 외 1개');
  assert.equal(m.memoLine({raw_text:''}), '(빈 업데이트)');
  assert.equal(m.meetingLine({series_name:'토론회', round_no:2, meeting_at:'2026-10-05T15:00:00Z'}), '토론회 2차');
});

test('weekly draft: the form order (1 → 2 → 4 → 5 → 참고); lines in saving order under 참고; missing groups named', async () => {
  const lines = new Map([['2026-10-06', {raw_text:'현장 회의 정리'}], ['2026-10-07', {raw_text:'첫 줄\n둘째 줄\n셋째 줄'}]]);
  const text = await draftOf({start:'2026-10-05', lines, materials:{events:{status:'ok', items:[{title:'회의', start:'2026-10-06T10:00:00+09:00', end:'2026-10-06T11:00:00+09:00'}]}, tasks:{status:'failed'},
    basket:{status:'ok', items:{notes:[{id:'b', raw_text:'조직 소식 원문\n둘째', occurred_at:'2026-10-06T01:00:00Z'}], links:[{note_id:'b', status:'confirmed', organization_id:'o', organization:{name:'가 조직'}}], docs:[]}},
    orgUpdates:{status:'ok', items:[]}, projectUpdates:{status:'ok', items:[]}, meetings:{status:'ok', items:[{series_name:'기자회견', meeting_at:'2026-10-06T05:00:00Z'}]},
    documents:{status:'ok', items:[]}, sharePages:{status:'ok', items:[]}}, today:'2026-10-06'});
  const rows = text.split('\n');
  assert.deepEqual(rows.slice(0, 2), ['주간 업무일지 10월 5일(월) ~ 10월 11일(일)', '■ 일시 : 2026년 10월 12일(월)']);
  // The form's order, not day by day.
  const order = ['1. 요청사항', '2. 기본·영역·의제 사업', '4. 산하 조직 현황', '5. 주요 일정 (10월 12일(월) ~ 10월 25일(일))', '참고'].map(t => rows.indexOf(t));
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), JSON.stringify(order));
  // No day-by-day '■ 날짜' headers: the only ■ line is the report day (■ 일시).
  assert.deepEqual(rows.filter(r => r.startsWith('■ ')), ['■ 일시 : 2026년 10월 12일(월)']);
  assert.deepEqual(partOf(text, '1. 요청사항'), ['1) 임원 일정 배정·논의 요청: (아직 재료 없음)',
    '2) 주요 일정: (비워 둠) 본부 주요 일정 — 기자회견·주요 회의·토론회·집회·교육 등, 특정 사업장·반복 일정 제외. 자동 채우기는 나중에']);
  const ref = partOf(text, '참고');
  assert.deepEqual(ref.slice(0, 5), ['◦ 한 줄', '- 10월 6일(화) 현장 회의 정리', '- 10월 7일(수) 첫 줄', '- 10월 7일(수) 둘째 줄', '- 10월 7일(수) 셋째 줄']);
  // This week's events are the day card's 일정, not draft material (5. 주요 일정 is the two weeks after).
  assert.equal(rows.some(r => r.includes('10:00 회의')), false);
  assert.ok(partOf(text, '4. 산하 조직 현황').includes('- 10월 6일(화) 조직 소식 원문'));
  assert.ok(rows.includes('- 10월 6일(화) 14:00 기자회견'));
  assert.equal(rows.some(r => r.includes('바구니 업데이트') || r.includes('고친 노트') || (r.startsWith('- ') && r.includes('둘째 ') && !r.includes('둘째 줄'))), false);
  // One Google Tasks read feeds both task groups, so both are named.
  assert.ok(text.includes('※ 끝낸 할 일, 할 일 예정은(는) 불러오지 못해 빠졌어요.'));
});

test('done tasks: the widest window is requested; the echoed days are used, an older Edge without an echo counts as 3 days', async () => {
  const m = await mod;
  const done = [{id:'t1', title:'끝', status:'completed', completed:'2026-10-01T03:00:00Z'}, {id:'t2', status:'needsAction'}, {id:'t3', status:'completed', completed:'not a date'}];
  const wide = runtime(() => ({tasks:done, completed_days:8}));
  const result = await m.readDoneTasksWindow(wide);
  assert.equal(params(wide.calls[0]).get('action'), 'tasks');
  assert.equal(params(wide.calls[0]).get('completed_days'), '8');
  assert.equal(result.days, 8);
  assert.deepEqual(result.tasks.map(t => t.id), ['t1']);
  // An older Edge ignores the field and sends no echo: only the old 3 days can be trusted.
  const old = await m.readDoneTasksWindow(runtime(() => ({tasks:done})));
  assert.equal(old.days, 3);
  // A nonsense echo is not trusted either.
  for (const echo of [0, 9, 'x', null, 2.5]) assert.equal((await m.readDoneTasksWindow(runtime(() => ({tasks:done, completed_days:echo})))).days, 3);
  // readDoneTasks keeps returning the list only, and still fails on a reconnect or error answer.
  assert.deepEqual((await m.readDoneTasks(runtime(() => ({tasks:done, completed_days:8})))).map(t => t.id), ['t1']);
  await assert.rejects(m.readDoneTasksWindow(runtime(() => ({tasks:[], error:'x'}))));
  assert.equal(m.DONE_TASK_DAYS_MAX, 8);
});

test('done tasks: the first fully covered day follows the days the Edge covered', async () => {
  const m = await mod;
  assert.equal(m.doneCoverFrom(3, '2026-10-06'), '2026-10-04');
  assert.equal(m.doneCoverFrom(8, '2026-10-06'), '2026-09-29');
  assert.equal(m.doneCoverFrom(undefined, '2026-10-06'), '2026-10-04');
});

test('weekly draft: the done-task note appears only when the week reaches before the covered days', async () => {
  const base = {lines:new Map(), materials:{tasks:{status:'ok', items:[]}}};
  const noteOf = text => text.split('\n').find(l => l.startsWith('※ Google 할 일은'));
  // Today Tuesday 10/6: the 8-day window covers from 9/29, so this week (starts 10/5) is complete and last week is not.
  assert.equal(noteOf(await draftOf({...base, start:'2026-10-05', doneDays:8, today:'2026-10-06'})), undefined);
  assert.equal(noteOf(await draftOf({...base, start:'2026-09-28', doneDays:8, today:'2026-10-06'})), '※ Google 할 일은 최근 8일 안에 끝낸 것만 모여요.');
  // An older Edge (3 days): Monday 10/5 is already covered on Tuesday 10/6; the week before is not.
  assert.equal(noteOf(await draftOf({...base, start:'2026-10-05', today:'2026-10-06'})), undefined);
  assert.equal(noteOf(await draftOf({...base, start:'2026-09-28', today:'2026-10-06'})), '※ Google 할 일은 최근 3일 안에 끝낸 것만 모여요.');
  // On a Sunday the 8-day window still holds the whole current week.
  assert.equal(noteOf(await draftOf({...base, start:'2026-10-05', doneDays:8, today:'2026-10-11'})), undefined);
});

// JOURNAL-주간보고허브 1단계: 프로젝트 소식·할 일 예정·자료실 새 자료·공유 페이지.
test('hub reads: new documents and changed share pages of the week, this workspace, a few columns, capped, no long body', async () => {
  const m = await mod;
  const rt = runtime(path => path.startsWith('/rest/v1/app_documents?') ? [{id:'d1', created_at:'2026-10-06T00:00:00Z'}] : []);
  const docs = await m.readWeekDocuments('2026-10-05', rt);
  await m.readWeekSharePages('2026-10-05', rt);
  const [doc, share] = rt.calls.map(params);
  assert.ok(rt.calls[0].path.startsWith('/rest/v1/app_documents?')); assert.ok(rt.calls[1].path.startsWith('/rest/v1/app_share_pages?'));
  assert.equal(doc.get('workspace_id'), 'eq.w'); assert.equal(share.get('workspace_id'), 'eq.w');
  // The week in Korea time: Monday 00:00 KST up to (not including) next Monday 00:00 KST.
  assert.deepEqual(doc.getAll('created_at'), ['gte.2026-10-04T15:00:00.000Z', 'lt.2026-10-11T15:00:00.000Z']);
  assert.deepEqual(share.getAll('updated_at'), ['gte.2026-10-04T15:00:00.000Z', 'lt.2026-10-11T15:00:00.000Z']);
  assert.equal(doc.get('select'), 'id,title,file_name,category,meeting_id,created_at');
  assert.equal(share.get('select'), 'id,title,status,updated_at');
  for (const q of [doc, share]) { assert.equal(q.get('limit'), String(m.WEEK_READ_CAP)); assert.equal(/blocks|content|text|\*/.test(q.get('select')), false); }
  assert.equal(docs.capped, false);
  const full = await m.readWeekDocuments('2026-10-05', runtime(() => Array.from({length:m.WEEK_READ_CAP}, (_, i) => ({id:`d${i}`}))));
  assert.equal(full.capped, true);
  await assert.rejects(m.readWeekSharePages('2026-10-05', runtime(() => ({message:'x'}))));
});

test('hub reads: one Google Tasks read gives done tasks and pending tasks with a due day (server range as it is)', async () => {
  const m = await mod;
  const read = await m.readDoneTasksWindow(runtime(() => ({completed_days:8, tasks:[
    {id:'done', title:'끝', status:'completed', completed:'2026-10-06T03:00:00Z'},
    {id:'due', title:'마감 있음', status:'needsAction', due:'2026-10-07T00:00:00.000Z'},
    {id:'undated', title:'마감 없음', status:'needsAction', due:null},
  ]})));
  assert.deepEqual(read.tasks.map(t => t.id), ['done']);
  assert.deepEqual(read.pending.map(t => t.id), ['due']);
  assert.equal(m.dueDay({due:'2026-10-07T00:00:00.000Z'}), '2026-10-07');
  assert.equal(m.dueDay({due:'x'}), '');
  // Done tasks never show as pending, pending never as done (the screen keeps both in one list).
  const all = [...read.tasks, ...read.pending];
  assert.deepEqual(m.tasksOn(all, '2026-10-06').map(t => t.id), ['done']);
  assert.deepEqual(m.pendingOn(all, '2026-10-07').map(t => t.id), ['due']);
  assert.deepEqual(m.pendingOn(all, '2026-10-06'), []);
  assert.equal(m.pendingCoverTo('2026-10-06'), '2026-10-12');
});

const hubMaterials = () => ({
  events:{status:'ok', items:[]}, tasks:{status:'ok', items:[
    {id:'t1', title:'끝낸 일', status:'completed', completed:'2026-10-06T01:00:00Z'},
    {id:'t2', title:'나 예정', status:'needsAction', due:'2026-10-06T00:00:00.000Z'},
    {id:'t3', title:'가 예정', status:'needsAction', due:'2026-10-06T00:00:00.000Z'},
    {id:'t4', title:'다음 날 예정', status:'needsAction', due:'2026-10-07T00:00:00.000Z'},
  ]},
  basket:{status:'ok', items:{notes:[{id:'b1', raw_text:'사업으로 보낸 메모\n둘째', occurred_at:'2026-10-06T02:00:00Z'}],
    links:[{note_id:'b1', status:'confirmed', project_id:'s1', project:{name:'가상 사업'}}], docs:[]}},
  orgUpdates:{status:'ok', items:[]},
  projectUpdates:{status:'ok', items:[{id:'p1', project_id:'s1', project:{name:'가상 사업'}, summary:'진행 기록\n둘째', effective_on:'2026-10-06', created_at:'2026-10-06T03:00:00Z'}]},
  meetings:{status:'ok', items:[]},
  documents:{status:'ok', items:[
    {id:'d1', title:'교섭 요구안', category:'교섭자료', created_at:'2026-10-05T15:00:00Z'},
    {id:'d2', title:'', file_name:'회의록.hwp', category:null, meeting_id:'m1', created_at:'2026-10-06T14:59:59Z'},
    {id:'d3', title:'전날 23:59', category:'교육', created_at:'2026-10-05T14:59:59Z'},
    {id:'d4', title:'다음 날 0시', category:'교육', created_at:'2026-10-06T15:00:00Z'},
  ]},
  sharePages:{status:'ok', items:[{id:'s1', title:'가상 안내 페이지', status:'published', updated_at:'2026-10-06T04:00:00Z'}, {id:'s2', title:'', status:'draft', updated_at:'2026-10-06T05:00:00Z'}]},
});

test('hub groups: each day shows its own items (Korea-time day edges), categories named, projects by name', async () => {
  const m = await mod;
  const day = m.dayMaterials(hubMaterials(), '2026-10-06');
  const by = Object.fromEntries(day.map(g => [g.key, g]));
  assert.deepEqual(by.projects.sections, [{name:'가상 사업', items:['사업으로 보낸 메모', '진행 기록']}]);
  assert.deepEqual(by.orgs.items, []);
  assert.deepEqual(by.due.items, ['가 예정', '나 예정']);
  assert.deepEqual(by.tasks.items, ['끝낸 일']);
  assert.deepEqual(by.docs.items, ['[교섭] 교섭 요구안', '[기타] 회의록.hwp · 회의자료']);
  assert.deepEqual(by.shares.items, ['가상 안내 페이지 · 게시', '제목 없음 · 초안']);
  assert.deepEqual(m.dayMaterials(hubMaterials(), '2026-10-05').find(g => g.key === 'docs').items, ['[교육] 전날 23:59']);
  assert.deepEqual(m.dayMaterials(hubMaterials(), '2026-10-07').find(g => g.key === 'docs').items, ['[교육] 다음 날 0시']);
  // Each group fails on its own: a failed document read leaves the others as they are.
  const failed = m.dayMaterials({...hubMaterials(), documents:{status:'failed'}}, '2026-10-06');
  assert.deepEqual(failed.find(g => g.key === 'docs').failed, ['documents']);
  assert.deepEqual(failed.find(g => g.key === 'shares').items.length, 2);
  // A capped week is marked on its group.
  const many = Object.assign([...hubMaterials().documents.items], {capped:true});
  assert.equal(m.dayMaterials({...hubMaterials(), documents:{status:'ok', items:many}}, '2026-10-06').find(g => g.key === 'docs').capped, true);
});

test('hub groups: an empty group is folded unless it is loading, failed or has a range note', async () => {
  const m = await mod;
  const range = {doneDays:3, today:'2026-10-06'};
  const fold = (materials, day) => m.dayMaterials(materials, day).filter(g => m.isFolded(g, day, range)).map(g => g.key);
  assert.deepEqual(fold(hubMaterials(), '2026-10-06'), ['events', 'orgs', 'meetings', 'memos']);
  assert.deepEqual(fold({...hubMaterials(), meetings:{status:'failed'}, events:{status:'loading'}}, '2026-10-06'), ['orgs', 'memos']);
  // Before the covered days, 끝낸 할 일 keeps its box with the range note; after the server's range, 할 일 예정 does.
  const old = m.dayMaterials(hubMaterials(), '2026-10-01').find(g => g.key === 'tasks');
  assert.equal(m.rangeNote(old, '2026-10-01', range), 'Google 할 일은 최근 3일 안에 끝낸 것만 모여요.');
  assert.equal(m.isFolded(old, '2026-10-01', range), false);
  const later = m.dayMaterials(hubMaterials(), '2026-10-13').find(g => g.key === 'due');
  assert.equal(m.rangeNote(later, '2026-10-13', range), '할 일 예정은 오늘부터 7일 안 마감만 모여요.');
  assert.equal(m.isFolded(m.dayMaterials(hubMaterials(), '2026-10-12').find(g => g.key === 'due'), '2026-10-12', range), true);
});

test('weekly draft with the hub groups: form order, project records in 요약, the rest under 참고, range and cap notes', async () => {
  const m = await mod;
  const text = await draftOf({start:'2026-10-05', lines:new Map([['2026-10-06', {raw_text:'한 줄'}]]), materials:hubMaterials(), doneDays:8, today:'2026-10-06'});
  const rows = text.split('\n');
  // Project records go to 2. 1) 요약 (a project outside the tree under its name), the rest under 참고 in the tab's order.
  assert.deepEqual(partOf(text, '2. 기본·영역·의제 사업'), ['1) 요약', '◦ 사업영역 밖 · 가상 사업', '- 10월 6일(화) 사업으로 보낸 메모', '- 10월 6일(화) 진행 기록',
    '2) 세부 내용 — 회의·행사 결과', '(이 주 회의·행사 없음)']);
  assert.deepEqual(partOf(text, '참고'), ['◦ 한 줄', '- 10월 6일(화) 한 줄', '◦ 끝낸 할 일', '- 10월 6일(화) 끝낸 일',
    '◦ 할 일 예정', '- 10월 6일(화) 가 예정', '- 10월 6일(화) 나 예정', '- 10월 7일(수) 다음 날 예정',
    '◦ 자료실 새 자료', '- 10월 5일(월) [교육] 전날 23:59', '- 10월 6일(화) [교섭] 교섭 요구안', '- 10월 6일(화) [기타] 회의록.hwp · 회의자료', '- 10월 7일(수) [교육] 다음 날 0시',
    '◦ 공유 페이지', '- 10월 6일(화) 가상 안내 페이지 · 게시', '- 10월 6일(화) 제목 없음 · 초안']);
  assert.equal(rows.some(r => r.includes('◦ 미분류')), false);
  // The week ends on 10/11, inside today + 6 (10/12): no pending note. The next week reaches past it.
  assert.equal(rows.some(r => r.startsWith('※ 할 일 예정은')), false);
  const next = await draftOf({start:'2026-10-12', lines:new Map(), materials:hubMaterials(), doneDays:8, today:'2026-10-06'});
  assert.ok(next.includes('※ 할 일 예정은 오늘부터 7일 안 마감만 모여요.'));
  const many = Object.assign([...hubMaterials().documents.items], {capped:true});
  const full = await draftOf({start:'2026-10-05', lines:new Map(), materials:{...hubMaterials(), documents:{status:'ok', items:many}}, doneDays:8, today:'2026-10-06'});
  assert.ok(full.includes(`※ 자료실 새 자료은(는) 이 주에 ${m.WEEK_READ_CAP}개가 넘어 앞의 ${m.WEEK_READ_CAP}개만 모였어요.`));
  const failed = await draftOf({start:'2026-10-05', lines:new Map(), materials:{...hubMaterials(), sharePages:{status:'failed'}}, doneDays:8, today:'2026-10-06'});
  assert.ok(failed.includes('※ 공유 페이지은(는) 불러오지 못해 빠졌어요.'));
});

test('조직 소식 sections follow the shared organization order (organization-order.js); projects and the tail do not', async () => {
  const m = await mod, day = '2026-10-06';
  const saved = globalThis.window;
  const mk = (id, name, at) => ({id, organization_id:id, organization:{name}, occurred_at:`2026-10-06T0${at}:00:00Z`, raw_text:`${name} 기록`});
  const projects = [{id:'p1', project:{name:'가 프로젝트'}, effective_on:day, summary:'가'}, {id:'p2', project:{name:'나 프로젝트'}, effective_on:day, summary:'나'}];
  try {
    globalThis.window = globalThis;
    await import('../app/organization-order.js');
    const groups = globalThis.KPTUOrganizationOrder.GROUPS;
    // Known names are taken from the shared table itself: last of the last group, first of the first group, and one between.
    const late = groups[3][3], mid = groups[1][0], first = groups[0][0];
    const rows = [mk('o1', late, 1), mk('o2', '가상 모르는 조직', 2), mk('o3', first, 3), mk('o4', mid, 4), mk('o5', '가상 가나다 앞', 5)];
    const names = sections => sections.map(s => s.name);
    const mine = new Set(rows.map(row => row.id));
    const ordered = m.orgNewsOn({basket:{notes:[], links:[], docs:[]}, orgUpdates:Object.assign(rows, {mine})}, day);
    assert.deepEqual(names(ordered), [first, mid, late, '가상 가나다 앞', '가상 모르는 조직']);
    assert.deepEqual(names(m.projectNewsOn({projectUpdates:projects}, day)), ['가 프로젝트', '나 프로젝트']);
    // The weekly draft lists the same sections in the same order.
    const empty = {status:'ok', items:[]};
    const text = await draftOf({start:'2026-10-05', lines:new Map(), today:day, materials:{events:empty, tasks:empty, basket:{status:'ok', items:{notes:[], links:[], docs:[]}},
      orgUpdates:{status:'ok', items:Object.assign(rows, {mine})}, projectUpdates:empty, meetings:empty, documents:empty, sharePages:empty}});
    const lines = partOf(text, '4. 산하 조직 현황').filter(row => row.startsWith('◦ ')).map(row => row.slice(2));
    assert.deepEqual(lines, [first, mid, late, '가상 가나다 앞', '가상 모르는 조직']);
    // Not loaded: every organization stays in 가나다순, as before.
    delete globalThis.KPTUOrganizationOrder;
    assert.deepEqual(names(m.orgNewsOn({orgUpdates:Object.assign(rows, {mine})}, day)), [...[first, mid, late, '가상 가나다 앞', '가상 모르는 조직']].sort((a, b) => a.localeCompare(b, 'ko')));
  } finally { if (saved === undefined) delete globalThis.window; else globalThis.window = saved; }
});

// 5-2 A: a note moved from the basket shows as one "노트: (title)" line on the update's day; only marked notes, never the text.
test('moved notes are read as id, title, day and the mark only, in the signed-in workspace', async () => {
  const m = await mod, rt = runtime(() => []);
  await m.readMovedNotes(rt);
  const p = params(rt.calls[0]);
  assert.equal(p.get('workspace_id'), 'eq.w'); assert.equal(p.get('kind'), 'eq.note');
  assert.equal(p.get('metadata->>moved_from_update_at'), 'not.is.null');
  assert.equal(p.get('select'), 'id,title,occurred_at,moved_at:metadata->>moved_from_update_at');
  assert.doesNotMatch(p.get('select'), /raw_text/);
});

test('moved notes of a day: marked ones only, on the update day in Korea time, title line, oldest first', async () => {
  const m = await mod;
  const rows = [
    {id:'b', title:'둘째 노트', occurred_at:'2026-10-06T03:00:00Z', moved_at:'2026-10-07T00:00:00Z'},
    {id:'a', title:'첫째 노트', occurred_at:'2026-10-05T16:00:00Z', moved_at:'2026-10-07T00:00:00Z'},
    {id:'c', title:'표시 없음', occurred_at:'2026-10-06T01:00:00Z', moved_at:null},
    {id:'d', title:'다른 날', occurred_at:'2026-10-07T01:00:00Z', moved_at:'2026-10-07T00:00:00Z'},
    {id:'e', title:'', occurred_at:'2026-10-06T04:00:00Z', moved_at:'2026-10-07T00:00:00Z'},
  ];
  assert.deepEqual(m.movedNotesOn(rows, '2026-10-06'), [{id:'a', line:'노트: 첫째 노트'}, {id:'b', line:'노트: 둘째 노트'}, {id:'e', line:'노트: (제목 없음)'}]);
  assert.deepEqual(m.movedNotesOn(rows, '2026-10-07'), [{id:'d', line:'노트: 다른 날'}]);
  assert.deepEqual(m.movedNotesOn(null, '2026-10-06'), []);
});

test('the weekly draft does not carry moved notes', async () => {
  const m = await mod;
  const materials = {movedNotes:{status:'ok', items:[{id:'a', title:'제목', occurred_at:'2026-10-06T01:00:00Z', moved_at:'2026-10-07T00:00:00Z'}]}};
  assert.doesNotMatch(await draftOf({start:'2026-10-05', lines:new Map(), materials, today:'2026-10-06'}), /노트: 제목/);
});
