import { test } from 'node:test';
import assert from 'node:assert/strict';
// JOURNAL-일지 2단계: the only stored part is the day's lines (kind=work, one row a day); the materials are read and grouped on screen.
const mod = import('../app/journal-data.js');
function runtime(reply = () => []) {
  const calls = [];
  return {calls, context:{read:() => ({user:{id:'u'}, workspace:{id:'w'}})}, api:async (path, options = {}) => { calls.push({path, ...options}); return reply(path, options); }};
}
const params = call => new URL(call.path, 'https://x.invalid').searchParams;

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
  assert.deepEqual(day.map(g => g.label), ['일정', '끝낸 할 일', '조직 소식', '회의·행사 결과']);
  assert.deepEqual(day[0].items, ['종일 종일', '00:30 새벽', '14:00 오후']);
  assert.deepEqual(day[1].failed, ['tasks']);
  assert.deepEqual(day[2].sections, [{name:'미분류', items:['첫 줄 메모', '첨부 2개']}]);
  assert.deepEqual(day[3].items, ['08:30 운영위원회 3차', '11:00 기자회견']);
  assert.equal(m.dayMaterials({}, '2026-10-06')[0].loading, true);
  // 조직 소식 waits for its three reads, then shows what it could read and names the failed one.
  assert.equal(m.dayMaterials({...materials, orgUpdates:{status:'loading'}}, '2026-10-06')[2].loading, true);
  const partial = m.dayMaterials({...materials, projectUpdates:{status:'failed'}}, '2026-10-06')[2];
  assert.deepEqual(partial.failed, ['projectUpdates']); assert.deepEqual(partial.items, ['첫 줄 메모', '첨부 2개']);
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
    {name:'미분류', items:['사업 A · 사업 진행 메모', '보류한 업데이트', '사업 B · 프로젝트에 바로 쓴 업데이트', '아직 분류 안 함']},
  ]);
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

test('weekly draft: each day lines in saving order one per row, or (없음); materials under each day, missing groups named', async () => {
  const m = await mod;
  const lines = new Map([['2026-10-06', {raw_text:'현장 회의 정리'}], ['2026-10-07', {raw_text:'첫 줄\n둘째 줄\n셋째 줄'}]]);
  const text = m.weeklyDraft({start:'2026-10-05', lines, materials:{events:{status:'ok', items:[{title:'회의', start:'2026-10-06T10:00:00+09:00', end:'2026-10-06T11:00:00+09:00'}]}, tasks:{status:'failed'},
    basket:{status:'ok', items:{notes:[{id:'b', raw_text:'조직 소식 원문\n둘째', occurred_at:'2026-10-06T01:00:00Z'}], links:[{note_id:'b', status:'confirmed', organization_id:'o', organization:{name:'가 조직'}}], docs:[]}},
    orgUpdates:{status:'ok', items:[]}, projectUpdates:{status:'ok', items:[]}, meetings:{status:'ok', items:[{series_name:'기자회견', meeting_at:'2026-10-06T05:00:00Z'}]}}});
  const rows = text.split('\n');
  assert.equal(rows[0], '주간 업무일지 10월 5일(월) ~ 10월 11일(일)');
  assert.equal(rows.filter(r => r.startsWith('■ ')).length, 7);
  assert.equal(rows.filter(r => r.startsWith('한 줄: ')).length, 9);
  assert.equal(rows.filter(r => r === '한 줄: (없음)').length, 5);
  assert.ok(rows.includes('한 줄: 현장 회의 정리'));
  const wed = rows.indexOf('■ 10월 7일(수)');
  assert.deepEqual(rows.slice(wed + 1, wed + 4), ['한 줄: 첫 줄', '한 줄: 둘째 줄', '한 줄: 셋째 줄']);
  assert.ok(rows.includes('- 일정: 10:00 회의'));
  assert.ok(rows.includes('- 조직 소식 · 가 조직: 조직 소식 원문'));
  assert.ok(rows.includes('- 회의·행사 결과: 14:00 기자회견'));
  assert.equal(rows.some(r => r.includes('바구니 업데이트') || r.includes('고친 노트') || (r.startsWith('- ') && r.includes('둘째'))), false);
  assert.ok(text.includes('※ 끝낸 할 일은(는) 불러오지 못해 빠졌어요.'));
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
  const m = await mod;
  const base = {lines:new Map(), materials:{tasks:{status:'ok', items:[]}}};
  const noteOf = text => text.split('\n').find(l => l.startsWith('※ 끝낸 할 일은'));
  // Today Tuesday 10/6: the 8-day window covers from 9/29, so this week (starts 10/5) is complete and last week is not.
  assert.equal(noteOf(m.weeklyDraft({...base, start:'2026-10-05', doneDays:8, today:'2026-10-06'})), undefined);
  assert.equal(noteOf(m.weeklyDraft({...base, start:'2026-09-28', doneDays:8, today:'2026-10-06'})), '※ 끝낸 할 일은 Google 할 일에서 최근 8일 안에 끝낸 것만 모여요.');
  // An older Edge (3 days): Monday 10/5 is already covered on Tuesday 10/6; the week before is not.
  assert.equal(noteOf(m.weeklyDraft({...base, start:'2026-10-05', today:'2026-10-06'})), undefined);
  assert.equal(noteOf(m.weeklyDraft({...base, start:'2026-09-28', today:'2026-10-06'})), '※ 끝낸 할 일은 Google 할 일에서 최근 3일 안에 끝낸 것만 모여요.');
  // On a Sunday the 8-day window still holds the whole current week.
  assert.equal(noteOf(m.weeklyDraft({...base, start:'2026-10-05', doneDays:8, today:'2026-10-11'})), undefined);
});
