import { test } from 'node:test';
import assert from 'node:assert/strict';
// JOURNAL-일지 2단계: the only stored part is the day's line (kind=work); the materials are read and grouped on screen.
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

test('save posts a new line, edits a known one, and turns a 409 for the same day into an edit', async () => {
  const m = await mod;
  let rt = runtime((path, o) => [{id:'k1', journal_day:'2026-10-06', ...o.body}]);
  await m.saveWorkLine({day:'2026-10-06', text:' 오늘 한 일 '}, rt);
  assert.equal(rt.calls[0].path, '/rest/v1/app_notes'); assert.equal(rt.calls[0].method, 'POST');
  assert.deepEqual(rt.calls[0].body, {workspace_id:'w', kind:'work', journal_day:'2026-10-06', raw_text:'오늘 한 일'});
  rt = runtime((path, o) => [{id:'k1', journal_day:'2026-10-06', ...o.body}]);
  await m.saveWorkLine({day:'2026-10-06', row:{id:'k1'}, text:'고친 줄'}, rt);
  const edit = params(rt.calls[0]);
  assert.equal(rt.calls[0].method, 'PATCH'); assert.equal(edit.get('id'), 'eq.k1'); assert.equal(edit.get('kind'), 'eq.work');
  assert.equal(rt.calls[0].body.raw_text, '고친 줄'); assert.ok(rt.calls[0].body.updated_at);
  assert.deepEqual(Object.keys(rt.calls[0].body).sort(), ['raw_text', 'updated_at']);
  rt = runtime((path, o) => {
    if (o.method === 'POST') throw Object.assign(new Error('dup'), {status:409});
    if (!o.method) return [{id:'k9', journal_day:'2026-10-06', raw_text:'다른 기기'}];
    return [{id:'k9', journal_day:'2026-10-06', ...o.body}];
  });
  const saved = await m.saveWorkLine({day:'2026-10-06', text:'이 기기'}, rt);
  assert.equal(saved.id, 'k9'); assert.equal(saved.raw_text, '이 기기');
  assert.deepEqual(rt.calls.map(c => c.method || 'GET'), ['POST', 'GET', 'PATCH']);
  rt = runtime();
  await assert.rejects(m.saveWorkLine({day:'2026-10-06', text:'a\nb'}, rt), e => e.code === 'line_break');
  assert.equal(rt.calls.length, 0);
});

test('materials: events of the week, done tasks, basket memos (kind=basket) and notes changed that week', async () => {
  const m = await mod;
  const rt = runtime(path => {
    if (path.includes('google-calendar')) return {events:[{id:'e', title:'회의', start:'2026-10-06T10:00:00+09:00', end:'2026-10-06T11:00:00+09:00'}]};
    if (path.includes('google-tasks')) return {tasks:[{id:'t1', title:'끝', status:'completed', completed:'2026-10-06T03:00:00Z'}, {id:'t2', title:'남음', status:'needsAction'}]};
    return [];
  });
  const events = await m.readWeekEvents('2026-10-05', rt);
  const tasks = await m.readDoneTasks(rt);
  await m.readBasketMemos(rt);
  await m.readChangedNotes('2026-10-05', rt);
  const cal = params(rt.calls[0]);
  assert.equal(cal.get('action'), 'events');
  assert.equal(cal.get('timeMin'), '2026-10-04T15:00:00.000Z'); assert.equal(cal.get('timeMax'), '2026-10-11T15:00:00.000Z');
  assert.equal(events.length, 1);
  assert.deepEqual(tasks.map(t => t.id), ['t1']);
  const basket = rt.calls.find(c => c.path.startsWith('/rest/v1/app_notes') && params(c).get('kind') === 'eq.basket');
  assert.ok(basket);
  const notes = params(rt.calls.at(-1));
  assert.equal(notes.get('kind'), 'eq.note');
  assert.deepEqual(notes.getAll('updated_at'), ['gte.2026-10-04T15:00:00.000Z', 'lt.2026-10-11T15:00:00.000Z']);
  // A disconnected calendar or a reconnect answer counts as a failed group, not as an empty day.
  await assert.rejects(m.readWeekEvents('2026-10-05', runtime(() => ({connected:false, events:[]}))));
  await assert.rejects(m.readWeekEvents('2026-10-05', runtime(() => ({events:[], warning:'Google Calendar 연결 실패'}))));
  await assert.rejects(m.readDoneTasks(runtime(() => ({tasks:[], needs_reconnect:true}))));
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
    memos:{status:'ok', items:[{raw_text:'\n  첫 줄 메모\n둘째', occurred_at:'2026-10-06T00:00:00Z'}, {raw_text:'', attachments:[{}, {}], occurred_at:'2026-10-06T01:00:00Z'}, {raw_text:'어제', occurred_at:'2026-10-05T14:59:00Z'}]},
    notes:{status:'ok', items:[{title:'노트 A', updated_at:'2026-10-06T05:00:00Z'}]},
  };
  const day = m.dayMaterials(materials, '2026-10-06');
  assert.deepEqual(day.map(g => g.label), ['일정', '끝낸 할 일', '바구니 메모', '고친 노트']);
  assert.deepEqual(day[0].items, ['종일 종일', '00:30 새벽', '14:00 오후']);
  assert.equal(day[1].failed, true);
  assert.deepEqual(day[2].items, ['첫 줄 메모', '첨부 2개']);
  assert.deepEqual(day[3].items, ['노트 A']);
  assert.equal(m.dayMaterials({}, '2026-10-06')[0].loading, true);
});

test('weekly draft: seven days with the line or (없음), materials under each day, missing groups named', async () => {
  const m = await mod;
  const lines = new Map([['2026-10-06', {raw_text:'현장 회의 정리'}]]);
  const text = m.weeklyDraft({start:'2026-10-05', lines, materials:{events:{status:'ok', items:[{title:'회의', start:'2026-10-06T10:00:00+09:00', end:'2026-10-06T11:00:00+09:00'}]}, tasks:{status:'failed'}, memos:{status:'ok', items:[]}, notes:{status:'ok', items:[]}}});
  const rows = text.split('\n');
  assert.equal(rows[0], '주간 업무일지 10월 5일(월) ~ 10월 11일(일)');
  assert.equal(rows.filter(r => r.startsWith('■ ')).length, 7);
  assert.equal(rows.filter(r => r.startsWith('한 줄: ')).length, 7);
  assert.ok(rows.includes('한 줄: 현장 회의 정리'));
  assert.ok(rows.includes('- 일정: 10:00 회의'));
  assert.ok(text.includes('※ 끝낸 할 일은(는) 불러오지 못해 빠졌어요.'));
});
