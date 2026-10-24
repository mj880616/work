import test from 'node:test';
import assert from 'node:assert/strict';

// WEEKLY-환류 (docs/design/weekly-draft-feedback.md 3절): 주간보고 기억 — 원래 제목 열쇠, 서버 CHECK와 같은 모양 검사, 초안 적용(이번 주 > 기억 > 달력),
// [확정] 뒤 기억 후보, 목록 바꾸기·내 프로필 칸 읽기/쓰기. 가짜 이름만.
const m = await import('../app/weekly-schedule-memory.js');
const w = await import('../app/journal-weekly.js');
const s = await import('../app/weekly-hwpx/schedule.mjs');
const d = await import('../app/weekly-draft-store.js');

const cal = Object.assign([
  {id:'a', calendarId:'k', calendarName:'공공운수노조', title:'가상 결의대회', start:'2026-10-27T14:00:00+09:00', end:'2026-10-27T15:00:00+09:00'},
  {id:'b', calendarId:'k', calendarName:'공공운수노조', title:'가상  결의 대회', start:'2026-11-03T14:00:00+09:00', end:'2026-11-03T15:00:00+09:00'},
  {id:'c', calendarId:'k', calendarName:'공공운수노조', title:'가상 정기 점검', location:'가상 회의실', start:'2026-10-28T10:00:00+09:00', end:'2026-10-28T12:00:00+09:00'},
  {id:'e', calendarId:'k', calendarName:'공공운수노조', title:'가상 다른 일정', start:'2026-10-29T10:00:00+09:00', end:'2026-10-29T11:00:00+09:00'},
], {calendarNames:['공공운수노조']});
const START = '2026-10-19';
const memo = [
  {key:'가상결의대회', origin:'가상 결의대회', title:'OO 결의대회', place:'가상 광장', saved:'2026-10-19'},
  {key:'가상정기점검', origin:'가상 정기 점검', drop:true, saved:'2026-10-19', used:'2026-10-19'},
];

test('열쇠: 띄어쓰기 없이·소문자 — 회의 종류 열쇠와 같은 규칙', async () => {
  const kinds = await import('../app/journal-meeting-kinds.js');
  for (const t of ['가상 결의대회', ' A  b\tC ', '', null]) assert.equal(m.scheduleMemoryKey(t), kinds.meetingKindKey(t));
});

test('모양 검사: 서버 CHECK와 같은 규칙(일곱 칸, key·origin·saved 필수, title과 drop 중 하나, place는 title이 있을 때만, 한 줄·길이·날짜)', () => {
  const ok = {key:'k', origin:'o', title:'t', saved:'2026-10-19'};
  assert.equal(m.validEntry(ok), true);
  assert.equal(m.validEntry({key:'k', origin:'o', drop:true, saved:'2026-10-19', used:'2026-10-26'}), true);
  assert.equal(m.validEntry({...ok, drop:true}), false);
  assert.equal(m.validEntry({key:'k', origin:'o', saved:'2026-10-19'}), false);
  assert.equal(m.validEntry({key:'k', origin:'o', drop:false, saved:'2026-10-19'}), false);
  assert.equal(m.validEntry({key:'k', origin:'o', drop:true, place:'p', saved:'2026-10-19'}), false);
  assert.equal(m.validEntry({...ok, extra:1}), false);
  assert.equal(m.validEntry({...ok, title:'두\n줄'}), false);
  assert.equal(m.validEntry({...ok, title:' '}), false);
  assert.equal(m.validEntry({...ok, saved:'2026-13-01'}), false);
  assert.equal(m.validEntry({...ok, key:'가'.repeat(201)}), false);
  assert.equal(m.validEntry({...ok, place:'가'.repeat(101)}), false);
  // 틀린 항목은 버리고 같은 열쇠는 첫 항목만; 배열이 아니면 기억 없음(null).
  assert.deepEqual(m.parseMemory([ok, {...ok, title:'두 번째'}, {bad:1}]), [ok]);
  assert.equal(m.parseMemory(null), null);
  assert.equal(m.parseMemory({}), null);
});

test('적용: 같은 원래 제목(띄어쓰기 달라도) 일정은 기억한 이름·장소, 뺀 제목은 화면·파일에서 빠지고 그날은 날짜만 남는다', () => {
  const plain = w.upcomingSchedule(cal, START);
  const c = m.annotateCalendar(plain, memo);
  assert.equal(c.memoryDropped, 1);
  assert.deepEqual(c.rows.flatMap(r => r.items.map(i => i.what)), ['14:00 / OO 결의대회 / 가상 광장', '10:00 / 가상 다른 일정', '14:00 / OO 결의대회 / 가상 광장']);
  // 파일 칸: 기억 이름, 뺀 날(10/28)은 칸 비움.
  const form = w.scheduleForm(c, '가상 담당');
  const day = form.calendar.find(x => x.day.startsWith('10.28.'));
  assert.deepEqual(day.items, []);
  assert.deepEqual(form.calendar.flatMap(x => x.items.map(i => i.what)), ['14:00 / OO 결의대회 / 가상 광장', '10:00 / 가상 다른 일정 / 미정', '14:00 / OO 결의대회 / 가상 광장']);
  // 이번 주에 고친 값이 기억보다 앞선다.
  const items = s.scheduleItems({...c, rows:c.allRows});
  const own = new Map([[items[0].key, {title:'이번 주만 이름', place:''}]]);
  assert.equal(w.scheduleForm(c, '', own).calendar.flatMap(x => x.items.map(i => i.what))[0], '14:00 / 이번 주만 이름 / 미정');
  // 기억 없음(null·빈 목록)이면 달력 그대로.
  assert.deepEqual(m.annotateCalendar(plain, null), {...plain, allRows:plain.rows, memoryDropped:0});
  assert.deepEqual(m.annotateCalendar(plain, []).rows, plain.rows);
  assert.deepEqual(m.annotateCalendar({loading:true}, memo), {loading:true});
  // weeklySummary: memory loading → 5번 묶음 loading, 'unknown' → 그대로.
  const mats = {upcoming:{status:'ok', items:cal}};
  assert.equal(w.weeklySummary({start:START.replace('19', '12'), lines:new Map(), materials:mats, memory:{status:'loading'}}).calendar.loading, true);
});

test('이번 주 빼기·넣기: drops가 기억보다 앞선다, 파일 달력은 그 결과', () => {
  const c = m.annotateCalendar(w.upcomingSchedule(cal, START), memo);
  const items = s.scheduleItems({...c, rows:c.allRows});
  const point = items.find(i => i.title === '가상 정기 점검'), other = items.find(i => i.title === '가상 다른 일정');
  assert.equal(m.isDropped(point, new Map()), true);
  assert.equal(m.isDropped(point, new Map([[point.key, 'keep']])), false);
  assert.equal(m.isDropped(other, new Map([[other.key, 'drop']])), true);
  const shown = m.visibleCalendar(c, new Map([[point.key, 'keep'], [other.key, 'drop']]));
  assert.deepEqual(shown.rows.flatMap(r => r.items.map(i => i.title)), ['가상 결의대회', '가상 정기 점검', '가상  결의 대회']);
  // 다름 목록·AI가 쓰는 제목 값: 이번 주 > 기억.
  const eff = m.effectiveOverrides(items, new Map([[items[0].key, {title:'X', place:''}]]));
  assert.deepEqual(eff.get(items[0].key), {title:'X', place:''});
  assert.deepEqual(eff.get(items.at(-1).key), {title:'OO 결의대회', place:'가상 광장'});
});

test('[확정] 뒤 후보: 달력과 다르게 확정한 일정·이번 주 뺀 일정만, 같은 열쇠는 한 번, 2자 이하는 체크 풀림, 이미 같은 기억은 "적용됨"', () => {
  const c = m.annotateCalendar(w.upcomingSchedule(Object.assign([...cal,
    {id:'f', calendarId:'k', calendarName:'공공운수노조', title:'회의', start:'2026-10-30T10:00:00+09:00', end:'2026-10-30T11:00:00+09:00'}], {calendarNames:['공공운수노조']}), START), memo);
  const items = s.scheduleItems({...c, rows:c.allRows});
  const by = t => items.filter(i => i.title === t);
  const titles = new Map([[by('가상 다른 일정')[0].key, {title:'가상 다른 일정 (고침)', place:'곳'}]]);
  const drops = new Map([[by('회의')[0].key, 'drop']]);
  const r = m.memoryCandidates(items, {titles, drops});
  assert.deepEqual(r.candidates.map(x => [x.key, x.title ?? null, x.place ?? null, !!x.drop, x.checked]),
    [['가상다른일정', '가상 다른 일정 (고침)', '곳', false, true], ['회의', null, null, true, false]]);
  // 기억으로 이름이 바뀐 결의대회(두 회차)·기억으로 뺀 점검은 적용된 기억.
  assert.deepEqual(r.used.sort(), ['가상결의대회', '가상정기점검']);
  // 이번 주만 원래대로(달력 제목으로 확정) → 후보 없음, 적용도 아님.
  const back = m.memoryCandidates(items, {titles:new Map([[by('가상 결의대회')[0].key, {title:'가상 결의대회', place:''}]]), drops:new Map()});
  assert.equal(back.candidates.length, 0);
  // 기억으로 뺀 일정을 이번 주만 넣었으면 적용 안 됨.
  assert.ok(!m.memoryCandidates(items, {titles:new Map(), drops:new Map([[by('가상 정기 점검')[0].key, 'keep']])}).used.includes('가상정기점검'));
});

test('목록 바꾸기: 같은 열쇠는 바꾸고, 200개 넘으면 가장 오래 안 쓰인 것부터, 지우기·되돌리기·마지막 적용일', () => {
  const next = m.withEntries(memo, [{key:'가상결의대회', origin:'가상 결의대회', drop:true}, {key:'새', origin:'새 일정', title:'새 이름'}], '2026-10-26');
  assert.deepEqual(next.map(e => [e.key, e.drop ?? e.title, e.saved]), [['가상정기점검', true, '2026-10-19'], ['가상결의대회', true, '2026-10-26'], ['새', '새 이름', '2026-10-26']]);
  const many = Array.from({length:200}, (_, i) => ({key:`k${i}`, origin:`o${i}`, title:'t', saved:'2026-10-19', ...(i === 7 ? {} : {used:'2026-10-26'})}));
  const capped = m.withEntries(many, [{key:'new', origin:'n', title:'t'}], '2026-10-26');
  assert.equal(capped.length, 200);
  assert.ok(!capped.some(e => e.key === 'k7') && capped.at(-1).key === 'new');
  assert.deepEqual(m.withoutKey(memo, '가상결의대회').map(e => e.key), ['가상정기점검']);
  assert.deepEqual(m.withRestored(m.withoutKey(memo, '가상결의대회'), memo[0]).map(e => e.key), ['가상정기점검', '가상결의대회']);
  assert.equal(m.withUsed(memo, ['가상결의대회'], '2026-11-02')[0].used, '2026-11-02');
  assert.equal(m.idleWeeks(memo[1], '2026-11-16'), 4);
  assert.equal(m.idleWeeks(memo[0], '2026-10-20'), 0);
  // 크기 어림은 서버 jsonb 글보다 작지 않다.
  assert.ok(m.memoryBytes(memo) >= JSON.stringify(memo).length + 10);
});

test('임시저장 draft: 뺀 일정·이번 주만 넣은 일정이 dropped·kept로 저장·복원·3자 비교된다(없으면 옛 모양 그대로)', () => {
  const draft = d.makeDraft({drops:new Map([['k:a', 'drop'], ['k:c', 'keep']])});
  assert.deepEqual([draft.dropped, draft.kept], [['k:a'], ['k:c']]);
  assert.equal(d.hasContent(draft), true);
  assert.equal('dropped' in d.makeDraft({}), false);
  const back = d.readDraft(JSON.parse(JSON.stringify({...draft, dropped:['k:a', 'k:a', 3], kept:['k:a', 'k:c']})));
  assert.deepEqual([back.dropped, back.kept], [['k:a'], ['k:c']]);
  assert.deepEqual([...d.placeDraft(back, new Set()).drops], [['k:c', 'keep'], ['k:a', 'drop']]);
  // 한쪽만 뺀 일정은 합치고, 같은 일정을 서로 다르게 하면 묻는다.
  const base = d.makeDraft({}), mine = d.makeDraft({drops:new Map([['k:a', 'drop']])}), theirs = d.makeDraft({drops:new Map([['k:e', 'drop']])});
  assert.deepEqual(d.merge3(base, mine, theirs).draft.dropped.sort(), ['k:a', 'k:e']);
  const clash = d.merge3(d.makeDraft({drops:new Map([['k:c', 'drop']])}), d.makeDraft({drops:new Map([['k:c', 'keep']])}), d.makeDraft({}));
  assert.deepEqual(clash.conflicts, [{cell:'drop:k:c', mine:'keep', theirs:null}]);
});

// 내 프로필 행, 이 칸만. 쓰기 직전에 다시 읽는다.
function fakeRt(initial, {fail = false} = {}) {
  const calls = [];
  let value = initial;
  return {calls, get value() { return value; }, context:{read:() => ({user:{id:'u-1'}})},
    async api(url, opts = {}) {
      calls.push({url, method:opts.method ?? 'GET', body:opts.body});
      if (fail) throw Object.assign(new Error('x'), {status:400});
      if (opts.method === 'PATCH') { value = opts.body.weekly_schedule_memory; return [{weekly_schedule_memory:value}]; }
      return value === undefined ? [] : [{weekly_schedule_memory:value}];
    }};
}
test('서버: 읽기(칸 준비 전·실패 = unknown), 다시 읽고 이 칸만 PATCH, 바뀐 것 없으면 쓰지 않음', async () => {
  const rt = fakeRt(memo);
  assert.deepEqual(await m.readMemory(rt), {status:'ok', list:memo});
  assert.equal(rt.calls[0].url, '/rest/v1/app_profiles?user_id=eq.u-1&select=weekly_schedule_memory&limit=1');
  const r = await m.changeMemory(list => m.withoutKey(list, '가상결의대회'), rt);
  assert.deepEqual(r, {ok:true, list:[memo[1]]});
  const patch = rt.calls.find(c => c.method === 'PATCH');
  assert.equal(patch.url, '/rest/v1/app_profiles?user_id=eq.u-1');
  assert.deepEqual(Object.keys(patch.body), ['weekly_schedule_memory']);
  const before = rt.calls.length;
  assert.deepEqual(await m.changeMemory(list => [...list], rt), {ok:true, list:[memo[1]]});
  assert.equal(rt.calls.slice(before).filter(c => c.method === 'PATCH').length, 0);
  assert.deepEqual(await m.readMemory(fakeRt(undefined)), {status:'unknown'});
  assert.deepEqual(await m.readMemory(fakeRt(memo, {fail:true})), {status:'unknown'});
  assert.deepEqual(await m.changeMemory(list => list, fakeRt(memo, {fail:true})), {ok:false});
  assert.deepEqual(await m.changeMemory(() => null, fakeRt(memo)), {ok:false});
});
