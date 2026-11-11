import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  nameKey, planTitle, eventNameKey, eventCopy, validEventId, validCalendarId, reportsOfEvent, planRowOf, rememberedState,
  planDecision, planIsOn, eventStatus, copyPatch, decisionWrite, ruleWrite, reportLink, isMissingStore, NO_TITLE, TITLE_MAX
} from '../app/report-plan-model.mjs';

// S57-20 BIZ-보고할일정 PR A: 설계 docs/design/biz-report-plan-link.md 4절 규칙(가짜 데이터만).
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ev = (id, title, extra = {}) => ({id, calendarId: 'cal-a', title, start: '2026-11-11T01:00:00.000Z', end: '2026-11-11T02:00:00.000Z', allDay: false, organizationIds: [], ...extra});
const row = (id, title, state, extra = {}) => ({id: 'row-' + id, google_event_id: id, google_calendar_id: 'cal-a', state, decided_by: 'user', decided_at: '2026-11-01T00:00:00.000Z', title, event_day: '2026-11-11', starts_at: '2026-11-11T01:00:00.000Z', ...extra});
const report = (id, eventId, name, extra = {}) => ({id, google_event_id: eventId, google_calendar_id: eventId ? 'cal-a' : null, series_name: name, title: name, meeting_at: '2026-11-04T01:00:00.000Z', created_at: '2026-11-04T03:00:00.000Z', ...extra});

test('이름 열쇠는 사업 보고 화면(team.js meetingNameKey)과 같은 규칙이다', () => {
  assert.equal(nameKey('  시험 회의  A '), '시험회의a');
  assert.equal(nameKey(null), '');
  // 같은 식을 쓰는지 원문으로 본다(한쪽만 바뀌면 같은 이름 판정이 어긋난다).
  assert.match(read('app/team.js'), /function meetingNameKey\(name\)\{return String\(name\|\|''\)\.replace\(\/\\s\+\/g,''\)\.toLowerCase\(\)\}/);
  assert.match(read('app/report-plan-model.mjs'), /nameKey = name => String\(name \?\? ''\)\.replace\(\/\\s\+\/g, ''\)\.toLowerCase\(\)/);
});

test('제목 사본: 제어 글자는 빈칸, 300자에서 자르고, 비면 (제목 없음)', () => {
  assert.equal(planTitle('가\n나\t다'), '가 나 다');
  assert.equal(planTitle('   '), NO_TITLE);
  assert.equal(planTitle(null), NO_TITLE);
  const long = planTitle('가'.repeat(400));
  assert.equal(Array.from(long).length, TITLE_MAX);
  assert.equal(Array.from(planTitle('😀'.repeat(301))).length, TITLE_MAX);
  assert.doesNotMatch(planTitle('a\u0000b\u007fc\u0085d'), /[\u0000-\u001f\u007f-\u009f]/);
  // 빈 제목 일정은 이름이 없어 같은 이름 기억에 들지 않는다.
  assert.equal(eventNameKey({title: ''}), '');
  assert.equal(eventNameKey({title: ' 시험 회의 '}), '시험회의');
});

test('일정 사본: 시각 있는 일정은 서울 날짜·시작 시각, 종일은 날짜만. 모양이 다르면 null', () => {
  assert.deepEqual(eventCopy(ev('e1', '시험 회의', {start: '2026-11-10T16:30:00.000Z'})), {google_event_id: 'e1', google_calendar_id: 'cal-a', title: '시험 회의', event_day: '2026-11-11', starts_at: '2026-11-10T16:30:00.000Z'});
  assert.deepEqual(eventCopy({id: 'e2', title: '', start: '2026-11-12', end: '2026-11-13', allDay: true}), {google_event_id: 'e2', google_calendar_id: 'primary', title: NO_TITLE, event_day: '2026-11-12', starts_at: null});
  assert.equal(eventCopy(ev('한글 id', '시험')), null);
  assert.equal(eventCopy(ev('e 3', '시험')), null);
  assert.equal(eventCopy(ev('e4', '시험', {start: 'x'})), null);
  assert.equal(eventCopy(ev('e5', '시험', {calendarId: 'a b'})), null);
  assert.equal(eventCopy(ev('e6', '시험', {start: '1999-12-31T00:00:00Z'})), null);
  assert.equal(validEventId('a'.repeat(1024)), true);
  assert.equal(validEventId('a'.repeat(1025)), false);
  assert.equal(validCalendarId('qa@example.org'), true);
  assert.equal(validCalendarId(''), false);
});

test('4-2 같은 이름 기억: 사람이 정한 on·skip 중 가장 나중, off·rule 줄은 기억이 아니다', () => {
  const plans = [
    row('a', '시험 회의', 'on', {decided_at: '2026-11-01T00:00:00Z'}),
    row('b', '시험회의', 'off', {decided_at: '2026-11-05T00:00:00Z'}),
    row('c', '다른 모임', 'on', {decided_by: 'rule'}),
    row('d', '빼는 모임', 'on', {decided_at: '2026-11-01T00:00:00Z'}),
    row('e', '빼는 모임', 'skip', {decided_at: '2026-11-03T00:00:00Z'})
  ];
  assert.equal(rememberedState(nameKey('시험 회의'), {plans}), 'on');
  assert.equal(rememberedState(nameKey('다른 모임'), {plans}), '');
  assert.equal(rememberedState(nameKey('빼는 모임'), {plans}), 'skip');
  assert.equal(rememberedState('', {plans}), '');
  assert.equal(rememberedState(nameKey('없는 이름'), {plans}), '');
});

test('4-2 일정에 이어 쓴 보고가 있는 이름은 기억이 없어도 on, 더 나중 skip이면 skip', () => {
  const reports = [report('r1', 'old', '주간 점검'), report('r2', null, '연결 없는 보고')];
  assert.equal(rememberedState(nameKey('주간 점검'), {reports}), 'on');
  assert.equal(rememberedState(nameKey('연결 없는 보고'), {reports}), '');
  const later = [row('x', '주간 점검', 'skip', {decided_at: '2026-11-05T00:00:00Z'})];
  assert.equal(rememberedState(nameKey('주간 점검'), {plans: later, reports}), 'skip');
  const earlier = [row('x', '주간 점검', 'skip', {decided_at: '2026-11-02T00:00:00Z'})];
  assert.equal(rememberedState(nameKey('주간 점검'), {plans: earlier, reports}), 'on');
});

test("4-1 표시 순서: 보고 씀 → 결정 줄 → 같은 이름 기억 → 담당조직 연결 일정 '보고할까요?' → 그냥 일정", () => {
  const plans = [row('on1', '켠 일정', 'on'), row('off1', '끈 일정', 'off'), row('skip1', '뺀 이름', 'skip'), row('done1', '쓴 일정', 'off')];
  const reports = [report('r1', 'done1', '쓴 일정')];
  const data = {plans, reports};
  assert.equal(eventStatus(ev('done1', '쓴 일정'), data), 'done');
  assert.equal(eventStatus(ev('on1', '켠 일정'), data), 'todo');
  assert.equal(eventStatus(ev('off1', '끈 일정', {organizationIds: ['o1']}), data), '');
  assert.equal(eventStatus(ev('new1', '켠 일정'), data), 'todo'); // 같은 이름 기억
  assert.equal(eventStatus(ev('new2', '뺀 이름', {organizationIds: ['o1']}), data), ''); // 빼기 = 다시 묻지 않음
  assert.equal(eventStatus(ev('new3', '처음 보는 일정', {organizationIds: ['o1']}), data), 'ask');
  assert.equal(eventStatus(ev('new4', '처음 보는 일정'), data), '');
  // '끔'은 그 일정 하나만: 같은 이름의 다른 일정은 기억(켬)을 따른다.
  const weekly = {plans: [row('w1', '매주 회의', 'on', {decided_at: '2026-11-01T00:00:00Z'}), row('w2', '매주 회의', 'off', {decided_at: '2026-11-08T00:00:00Z'})], reports: []};
  assert.equal(planIsOn(ev('w2', '매주 회의'), weekly), false);
  assert.equal(planIsOn(ev('w3', '매주 회의'), weekly), true);
  assert.deepEqual(planDecision(ev('w3', '매주 회의'), weekly), {state: 'on', row: null, from: 'memory'});
  assert.equal(planDecision(ev('zz', '모르는 일정'), weekly).from, '');
});

test('이어진 보고는 가장 나중에 쓴 것이 앞, 줄 찾기는 일정 id만으로', () => {
  const reports = [report('r1', 'e1', '가', {created_at: '2026-11-01T00:00:00Z'}), report('r2', 'e1', '가', {created_at: '2026-11-03T00:00:00Z'}), report('r3', 'e2', '나')];
  assert.deepEqual(reportsOfEvent('e1', reports).map(r => r.id), ['r2', 'r1']);
  assert.deepEqual(reportsOfEvent('', reports), []);
  assert.equal(planRowOf('a', [row('a', '가', 'on', {google_calendar_id: 'primary'})]).id, 'row-a');
  assert.equal(planRowOf('none', [row('a', '가', 'on')]), null);
});

test('4-3 누를 때 저장: 줄이 없으면 넣기, 있으면 고치기. 저절로 켜진 줄을 끌 때 decided_by=user를 같이 보낸다', () => {
  const now = new Date('2026-11-11T02:00:00.000Z');
  const post = decisionWrite(null, 'on', ev('e1', '시험 회의'), now);
  assert.equal(post.method, 'POST');
  assert.deepEqual(post.body, {google_event_id: 'e1', google_calendar_id: 'cal-a', title: '시험 회의', event_day: '2026-11-11', starts_at: '2026-11-11T01:00:00.000Z', state: 'on', decided_by: 'user', decided_at: '2026-11-11T02:00:00.000Z'});
  assert.ok(!('workspace_id' in post.body) && !('id' in post.body) && !('created_at' in post.body));
  const ruleRow = row('e1', '시험 회의', 'on', {decided_by: 'rule'});
  const patch = decisionWrite(ruleRow, 'off', ev('e1', '시험 회의'), now);
  assert.deepEqual(patch, {method: 'PATCH', id: 'row-e1', body: {state: 'off', decided_by: 'user', decided_at: '2026-11-11T02:00:00.000Z'}});
  assert.equal(decisionWrite(ruleRow, 'skip', ev('e1', '시험 회의'), now).body.state, 'skip');
  // 고칠 수 없는 칸(workspace_id·google_event_id)은 보내지 않는다.
  const moved = decisionWrite(row('e1', '옛 제목', 'off'), 'on', ev('e1', '새 제목', {start: '2026-11-12T01:00:00.000Z'}), now);
  assert.deepEqual(Object.keys(moved.body).sort(), ['decided_at', 'decided_by', 'event_day', 'starts_at', 'state', 'title']);
  assert.equal(decisionWrite(null, 'maybe', ev('e1', '시험'), now), null);
  assert.equal(decisionWrite(null, 'on', ev('나쁜 id', '시험'), now), null);
});

test('4-3 같은 이름 기억으로 저절로 켜진 일정을 처음 볼 때만 rule 줄(on)을 넣는다', () => {
  const now = new Date('2026-11-11T02:00:00.000Z');
  const data = {plans: [row('a', '매주 회의', 'on')], reports: []};
  const write = ruleWrite(ev('b', '매주 회의'), data, now);
  assert.equal(write.method, 'POST');
  assert.equal(write.body.state, 'on');
  assert.equal(write.body.decided_by, 'rule');
  assert.equal(ruleWrite(ev('a', '매주 회의'), data, now), null); // 이미 줄이 있음
  assert.equal(ruleWrite(ev('c', '다른 일정'), data, now), null); // 기억 없음
});

test('4-5 사본 맞추기: 다른 칸만, decided_at은 건드리지 않고, 실제 캘린더 주소를 primary로 되돌리지 않는다', () => {
  const base = row('e1', '시험 회의', 'on');
  assert.deepEqual(copyPatch(base, ev('e1', '시험 회의')), {});
  assert.deepEqual(copyPatch(base, ev('e1', '시험 회의', {start: '2026-11-11T01:00:00Z'})), {}); // 같은 시각의 다른 표기
  assert.deepEqual(copyPatch(base, ev('e1', '바뀐 제목')), {title: '바뀐 제목'});
  assert.deepEqual(copyPatch(base, ev('e1', '시험 회의', {start: '2026-11-12', allDay: true})), {event_day: '2026-11-12', starts_at: null});
  assert.deepEqual(copyPatch(base, ev('e1', '시험 회의', {calendarId: 'primary'})), {});
  assert.deepEqual(copyPatch({...base, google_calendar_id: 'primary'}, ev('e1', '시험 회의')), {google_calendar_id: 'cal-a'});
  assert.deepEqual(copyPatch(base, ev('other', '바뀐 제목')), {});
  assert.ok(!('decided_at' in copyPatch(base, ev('e1', '바뀐 제목'))));
});

test('보고 줄에 넣을 일정 연결은 둘 다 채우거나 둘 다 비운다', () => {
  assert.deepEqual(reportLink({id: 'e1', calendarId: 'cal-a'}), {google_calendar_id: 'cal-a', google_event_id: 'e1'});
  assert.deepEqual(reportLink({eventId: 'e1'}), {google_calendar_id: 'primary', google_event_id: 'e1'});
  assert.deepEqual(reportLink({id: '나쁜 id', calendarId: 'cal-a'}), {});
  assert.deepEqual(reportLink(null), {});
});

test('새 표·새 칸이 없는 서버의 응답을 알아본다(그때 화면은 표시 없이 지금 그대로)', () => {
  assert.equal(isMissingStore({status: 404, message: 'Not Found'}), true);
  assert.equal(isMissingStore({status: 400, message: 'column app_meetings.google_event_id does not exist'}), true);
  assert.equal(isMissingStore({status: 404, message: "Could not find the table 'public.app_calendar_report_plans' in the schema cache"}), true);
  assert.equal(isMissingStore({status: 401, message: 'JWT expired'}), false);
  assert.equal(isMissingStore({status: 500, message: 'server error'}), false);
  assert.equal(isMissingStore({status: 0, message: 'Failed to fetch'}), false);
});

test('규칙 모듈은 DOM·네트워크·기기 저장을 쓰지 않는다', () => {
  const src = read('app/report-plan-model.mjs').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /\b(document|window|fetch|localStorage|sessionStorage|indexedDB)\b/);
});
