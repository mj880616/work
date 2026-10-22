import { test } from 'node:test';
import assert from 'node:assert/strict';
// JOURNAL-회의종류표시: 회의 종류 키 맞추기·거르기·목록 바꾸기·내 프로필 칸 읽기/쓰기. Fake names only.
const mod = import('../app/journal-meeting-kinds.js');
const weekly = import('../app/journal-weekly.js');

test('종류 키: series_name(없으면 title)에서 띄어쓰기를 빼고 소문자로 — app/team.js meetingNameKey와 같은 규칙', async () => {
  const m = await mod;
  assert.equal(m.meetingKindKey('궤도 집행국 회의'), '궤도집행국회의');
  assert.equal(m.meetingKindKey(' Weekly  Sync\t'), 'weeklysync');
  assert.equal(m.meetingKindKey(null), '');
  assert.equal(m.meetingKindName({series_name:' 본부 집행위 ', title:'다른 제목'}), '본부 집행위');
  assert.equal(m.meetingKindName({series_name:null, title:'가상 기자회견'}), '가상 기자회견');
  assert.equal(m.meetingKindName({series_name:'', title:''}), '');
  // team.js is a classic script that cannot be imported: its rule is read from the source so the two cannot drift apart.
  const {readFileSync} = await import('node:fs');
  const src = readFileSync(new URL('../app/team.js', import.meta.url), 'utf8');
  const fn = src.match(/function meetingNameKey\(name\)\{return ([^}]*)\}/)?.[1];
  assert.ok(fn);
  const team = new Function('name', `return ${fn}`);
  for (const sample of ['궤도 집행국 회의', ' A  b\tC ', '', null, '본부집행위', '０１ Ａ']) assert.equal(m.meetingKindKey(sample), team(sample));
});

test('올림 판단: 목록에 든 종류만 빠지고, 새 종류·행사·이름 없는 회의는 올라간다, 목록을 못 읽으면(null) 전부 올린다', async () => {
  const m = await mod, hidden = ['궤도집행국회의', '본부집행위'];
  const meeting = (series_name, title = '') => ({series_name, title});
  assert.equal(m.reportsMeeting(meeting('궤도 집행국 회의'), hidden), false);
  assert.equal(m.reportsMeeting(meeting(null, '본부 집행위'), hidden), false);
  assert.equal(m.reportsMeeting(meeting('BON부집행위'), hidden), true);
  assert.equal(m.reportsMeeting(meeting('가상 기자회견'), hidden), true);
  assert.equal(m.reportsMeeting(meeting('새 회의 종류'), hidden), true);
  assert.equal(m.reportsMeeting(meeting('', ''), hidden), true);
  for (const none of [null, undefined, []]) assert.equal(m.reportsMeeting(meeting('궤도 집행국 회의'), none), true);
});

test('목록 읽기 검사: 데이터베이스 CHECK와 같은 모양만 받고, 아니면 null(= 전부 올림)', async () => {
  const m = await mod;
  assert.deepEqual(m.parseKinds(['궤도집행국회의', '본부집행위']), ['궤도집행국회의', '본부집행위']);
  assert.deepEqual(m.parseKinds([]), []);
  for (const bad of [undefined, null, '궤도집행국회의', {}, [''], ['a b'], ['a,b'], ['a\nb'], ['a', 'a'], [1], ['가'.repeat(101)], Array.from({length:101}, (_, i) => `k${i}`)]) assert.equal(m.parseKinds(bad), null, JSON.stringify(bad)?.slice(0, 30));
  assert.deepEqual(m.parseKinds(['가'.repeat(100)]), ['가'.repeat(100)]);
  assert.equal(m.validKindKey('운영위원회'), true);
  assert.equal(m.validKindKey('운영 위원회'), false);
});

test('목록 바꾸기: 빼면 끝에 한 번만, 다시 올리면 지우고, 읽지 못한 목록이면 바꾸지 않는다', async () => {
  const m = await mod;
  assert.deepEqual(m.withKind(['a'], 'b', true), ['a', 'b']);
  assert.deepEqual(m.withKind(['a', 'b'], 'b', true), ['a', 'b']);
  assert.deepEqual(m.withKind(['a', 'b'], 'a', false), ['b']);
  assert.deepEqual(m.withKind(['a'], 'zz', false), ['a']);
  assert.equal(m.withKind(null, 'a', true), null);
  assert.equal(m.withKind(['a'], 'a b', true), null);
  assert.equal(m.withKind(Array.from({length:100}, (_, i) => `k${i}`), 'new', true), null);
});

const rtWith = (rows, {fail = false} = {}) => {
  const calls = [];
  return {calls, context:{read:() => ({user:{id:'u-1'}})}, api: async (path, options = {}) => {
    calls.push({path, ...options});
    if (fail) throw new Error('down');
    if (options.method === 'PATCH') { rows[0] = {...rows[0], ...options.body}; return [rows[0]]; }
    return rows.map(r => ({weekly_hidden_meeting_kinds:r.weekly_hidden_meeting_kinds}));
  }};
};

test('내 프로필 칸 읽기: 칸이 없거나(옛 응답) 읽기 실패·모양 이상이면 unknown', async () => {
  const m = await mod;
  assert.deepEqual(await m.readKinds(rtWith([{weekly_hidden_meeting_kinds:['a']}])), {status:'ok', list:['a']});
  assert.deepEqual(await m.readKinds(rtWith([{}])), {status:'unknown'});
  assert.deepEqual(await m.readKinds(rtWith([])), {status:'unknown'});
  assert.deepEqual(await m.readKinds(rtWith([{weekly_hidden_meeting_kinds:['a b']}])), {status:'unknown'});
  assert.deepEqual(await m.readKinds(rtWith([], {fail:true})), {status:'unknown'});
  assert.deepEqual(await m.readKinds({context:{read:() => ({})}, api: async () => []}), {status:'unknown'});
  assert.match((await (async () => { const rt = rtWith([{weekly_hidden_meeting_kinds:[]}]); await m.readKinds(rt); return rt.calls[0].path; })()), /app_profiles\?user_id=eq\.u-1&select=weekly_hidden_meeting_kinds&limit=1$/);
});

test('표시 바꾸기 저장: 내 행 이 칸 하나만 PATCH, 쓰기 직전에 다시 읽어 다른 기기 변경을 지키고, 실패하면 ok:false', async () => {
  const m = await mod, rows = [{weekly_hidden_meeting_kinds:['궤도집행국회의', '본부집행위'], display_name:'그대로'}];
  const rt = rtWith(rows);
  assert.deepEqual(await m.changeKind('운영위원회', true, rt), {ok:true, list:['궤도집행국회의', '본부집행위', '운영위원회']});
  const patch = rt.calls.filter(c => c.method === 'PATCH');
  assert.equal(patch.length, 1);
  assert.match(patch[0].path, /^\/rest\/v1\/app_profiles\?user_id=eq\.u-1$/);
  assert.deepEqual(Object.keys(patch[0].body), ['weekly_hidden_meeting_kinds']);
  assert.equal(rows[0].display_name, '그대로');
  assert.deepEqual(await m.changeKind('궤도집행국회의', false, rt), {ok:true, list:['본부집행위', '운영위원회']});
  // Already in the wanted state: nothing is written.
  const before = rt.calls.length;
  assert.deepEqual(await m.changeKind('본부집행위', true, rt), {ok:true, list:['본부집행위', '운영위원회']});
  assert.equal(rt.calls.slice(before).filter(c => c.method === 'PATCH').length, 0);
  // Cannot read the column / write fails / bad key: nothing is sent or reported saved.
  const old = rtWith([{}]);
  assert.deepEqual(await m.changeKind('a', true, old), {ok:false}); assert.equal(old.calls.filter(c => c.method === 'PATCH').length, 0);
  assert.deepEqual(await m.changeKind('a', true, rtWith([], {fail:true})), {ok:false});
  assert.deepEqual(await m.changeKind('a b', true, rt), {ok:false});
});

const ok = items => ({status:'ok', items});
const meetings = [
  {id:'m1', title:'궤도 집행국 회의', series_name:'궤도 집행국 회의', round_no:12, meeting_at:'2026-10-05T01:00:00Z'},
  {id:'m2', title:'본부집행위', series_name:null, round_no:null, meeting_at:'2026-10-06T01:00:00Z'},
  {id:'m3', title:'운영위원회', series_name:'운영위원회', round_no:3, meeting_at:'2026-10-08T01:00:00Z'},
  {id:'m4', title:'가상 기자회견', series_name:'가상 기자회견', round_no:null, meeting_at:'2026-10-09T05:00:00Z'},
  {id:'m5', title:'궤도집행국회의', series_name:'궤도집행국회의', round_no:13, meeting_at:'2026-10-11T01:00:00Z'},
];
const sources = {events:ok([]), upcoming:ok([]), tasks:ok([]), basket:ok({notes:[], links:[], docs:[]}), orgUpdates:Object.assign([], {mine:new Set()}), projectUpdates:ok([]), catalog:ok([]), meetings:ok(meetings), documents:ok([]), sharePages:ok([])};
const base = {start:'2026-10-05', lines:new Map(), linesState:'ok', today:'2026-10-06', materials:sources};
const DEFAULT = {status:'ok', list:['궤도집행국회의', '본부집행위']};

test('주간 정리: 두 정기 회의(띄어쓰기·표기 달라도)는 빠지고 새 종류·행사는 남는다, 뺀 종류는 건수와 함께 알린다', async () => {
  const w = (await weekly).weeklySummary({...base, kinds:DEFAULT}).meetings;
  assert.deepEqual(w.items.map(i => i.text), ['10:00 운영위원회 3차', '14:00 가상 기자회견']);
  assert.deepEqual(w.items.map(i => i.kind), ['운영위원회', '가상기자회견']);
  assert.deepEqual(w.hidden, [{key:'궤도집행국회의', name:'궤도 집행국 회의', count:2}, {key:'본부집행위', name:'본부집행위', count:1}]);
  assert.equal(w.editable, true);
});

test('주간 정리: 목록이 비면 전부, 목록을 못 읽거나 주지 않으면 전부 올리고 바꾸기 표시는 없다, 읽는 중이면 불러오는 중', async () => {
  const {weeklySummary, weeklyReportText} = await weekly;
  assert.equal(weeklySummary({...base, kinds:{status:'ok', list:[]}}).meetings.items.length, 5);
  for (const kinds of [undefined, null, {status:'unknown'}]) {
    const w = weeklySummary({...base, kinds}).meetings;
    assert.equal(w.items.length, 5); assert.deepEqual(w.hidden, []); assert.equal(w.editable, false);
  }
  const loading = weeklySummary({...base, kinds:{status:'loading'}});
  assert.equal(loading.meetings.loading, true);
  assert.match(weeklyReportText(loading), /회의·행사 결과\n\(불러오는 중\)/);
});

test('주간보고 초안 복사: 뺀 종류의 회의는 글에도 없다', async () => {
  const {weeklySummary, weeklyReportText} = await weekly;
  const text = weeklyReportText(weeklySummary({...base, kinds:DEFAULT}));
  assert.match(text, /운영위원회 3차/); assert.match(text, /가상 기자회견/);
  assert.doesNotMatch(text, /집행국|집행위/);
  assert.match(weeklyReportText(weeklySummary({...base, kinds:null})), /궤도 집행국 회의 12차/);
  const none = weeklySummary({...base, materials:{...sources, meetings:ok([meetings[0], meetings[1]])}, kinds:DEFAULT});
  assert.deepEqual(none.meetings.items, []); assert.equal(none.meetings.hidden.length, 2);
});

test('주간 정리: 회의를 못 읽으면 지금처럼 못 읽음 표시(거르기와 무관)', async () => {
  const w = (await weekly).weeklySummary({...base, materials:{...sources, meetings:{status:'failed'}}, kinds:DEFAULT}).meetings;
  assert.deepEqual(w.failed, ['meetings']); assert.deepEqual(w.items, []);
});
