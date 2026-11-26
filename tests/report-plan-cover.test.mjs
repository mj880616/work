import test from 'node:test';
import assert from 'node:assert/strict';
import {titleMatch, titleWords, compactTitle} from '../app/title-match.mjs';
import {reportCover, coverCandidates, coverLevel, eventStatus, STATUS_DONE, STATUS_ASK, COVER_MINUTES} from '../app/report-plan-model.mjs';
import {planItems, overdueItems, itemMeta} from '../app/report-calendar-plan.mjs';
import {sameThing} from '../app/record-window-model.mjs';

// S67-40(사용자 11/20 20:22 "이미 보고를 했는데 중복된 일정 보고 제안"): 일정에서 시작하지 않고 따로 쓴 보고도 '보고함'으로 본다. 자료는 모두 가짜.
const at = (day, time) => new Date(`${day}T${time}:00+09:00`).toISOString();
const ev = (id, title, day, time, extra = {}) => ({id, calendarId: 'own', title, start: at(day, time), end: at(day, time), allDay: false, organizationIds: [], ...extra});
const rep = (id, title, day, time, extra = {}) => ({id, title, series_name: title, meeting_at: at(day, time), created_at: at(day, '20:00'), ...extra});
const D = '2026-11-18';
const PRESS = '예시 3개노조 안전운행 투쟁 돌입 기자회견';

test('제목 규칙: 띄어쓰기·숫자는 보지 않고, 한쪽 낱말이 모두 다른 쪽에 있으면 같은 일', () => {
  assert.equal(compactTitle('3개노조 안전 운행'), '개노조안전운행');
  assert.deepEqual(titleWords('11.18 가짜 기자회견 (가)'), ['가짜', '기자회견']);
  assert.equal(titleMatch('안전운행 투쟁 기자회견', PRESS), 'same');
  assert.equal(titleMatch(PRESS, '안전운행 투쟁 기자회견'), 'same');
  assert.equal(titleMatch('안전운행투쟁 기자회견', '예시 안전운행 투쟁 기자회견'), 'same'); // 붙여 쓴 것도 품기로 같다
  assert.equal(titleMatch('가짜 결의대회', '가짜결의대회 2차'), 'same');
  assert.equal(titleMatch('선포 안전운행 투쟁 기자회견', PRESS), 'same');                // 4낱말 중 3개(3/4)
  assert.equal(titleMatch('가짜 선포 안전운행 투쟁 기자회견', PRESS), 'near');           // 5낱말 중 3개는 사람이 고른다
  assert.equal(titleMatch('가짜 지부 간담회', '예시 지부 운영위'), 'near');               // '지부'만 겹침
  assert.equal(titleMatch('가짜 점심 약속', PRESS), '');
  assert.equal(titleMatch('', PRESS), '');
  assert.equal(titleMatch('123', '123'), '');                                              // 숫자뿐인 제목은 비교하지 않는다
});

test('제목 포함·시각 근접(±60분) → 보고함(done)이라 묻지 않는다', () => {
  const event = ev('press', '안전운행 투쟁 기자회견', D, '10:00');
  const allReports = [rep('r1', PRESS, D, '10:00', {activity_kind: 'press'})];
  assert.equal(reportCover(event, {reports: [], allReports})?.id, 'r1');
  assert.equal(eventStatus(event, {plans: [], reports: [], allReports}), STATUS_DONE);
  assert.equal(eventStatus(event, {plans: [], reports: []}), STATUS_ASK);                 // 따로 쓴 보고를 모르면 예전처럼 묻는다
  assert.equal(coverLevel(event, rep('r2', PRESS, D, '10:59')), 'same');
  assert.equal(coverLevel(event, rep('r3', PRESS, D, '11:01')), '');                       // 61분
  assert.equal(COVER_MINUTES, 60);
  // 시각을 고르지 않은 보고(서울 0시)·종일 일정은 날짜만 본다.
  assert.equal(coverLevel(event, rep('r4', PRESS, D, '00:00')), 'same');
  assert.equal(coverLevel({id: 'all', title: '안전운행 투쟁 기자회견', start: D, allDay: true}, rep('r5', PRESS, D, '15:00')), 'same');
});

test('다른 행사 → 제안 유지, 다른 날 → 제안 유지, 다른 일정에 이어진 보고는 덮지 않는다', () => {
  const event = ev('press', '안전운행 투쟁 기자회견', D, '10:00');
  assert.equal(eventStatus(event, {allReports: [rep('x', '가짜 임금 교섭 결과 보고', D, '10:00')]}), STATUS_ASK);
  assert.equal(eventStatus(event, {allReports: [rep('y', PRESS, '2026-11-17', '10:00')]}), STATUS_ASK);
  // 그 보고가 이미 다른 일정과 이어져 있으면(연결 목록에 있음·칸이 채워짐) 이 일정을 덮지 않는다.
  const linked = rep('z', PRESS, D, '10:00');
  assert.equal(eventStatus(event, {reports: [{...linked, google_event_id: 'other'}], allReports: [linked]}), STATUS_ASK);
  assert.equal(eventStatus(event, {allReports: [{...linked, google_event_id: 'other'}]}), STATUS_ASK);
});

test('후보 순서: 같은 일 → 비슷함 → 같은 날 다른 보고(시각 가까운 순). 다른 날·이어진 보고는 빠진다', () => {
  const event = ev('e', '가짜 지부 간담회', D, '14:00');
  const list = coverCandidates(event, {reports: [{id: 'linked', google_event_id: 'x'}], allReports: [
    rep('other-far', '예시 교육', D, '09:00'), rep('near', '예시 지부 운영위', D, '14:30'), rep('other-close', '예시 교육 2', D, '13:00'),
    rep('linked', '가짜 지부 간담회', D, '14:00'), rep('nextday', '가짜 지부 간담회', '2026-11-19', '14:00')]});
  assert.deepEqual(list.map(c => [c.report.id, c.level]), [['near', 'near'], ['other-close', ''], ['other-far', '']]);
});

test('달력 놓기: 따로 쓴 보고가 덮는 점선 □·□·안 쓴 보고는 나오지 않고, 비슷하기만 하면 그대로 + 둘째 줄 안내', () => {
  const events = [ev('press', '안전운행 투쟁 기자회견', D, '10:00'), ev('rally', '가짜 결의대회', D, '15:00'), ev('meet', '가짜 지부 간담회', D, '18:00')];
  const plans = [{id: 'p1', google_event_id: 'meet', google_calendar_id: 'own', state: 'on', decided_by: 'user', decided_at: '2026-11-01T00:00:00Z', title: '가짜 지부 간담회', event_day: D, starts_at: at(D, '18:00')},
    {id: 'p2', google_event_id: 'old', google_calendar_id: 'own', state: 'on', decided_by: 'user', decided_at: '2026-11-01T00:00:00Z', title: '예시 운영위', event_day: '2026-11-05', starts_at: at('2026-11-05', '14:00')}];
  const allReports = [rep('r1', PRESS, D, '10:00'), rep('r2', '예시 지부 운영위', D, '18:30'), rep('r3', '예시 운영위 회의', '2026-11-05', '14:30')];
  const before = planItems({plans, reports: []}, events).filter(i => i.day === D);
  assert.deepEqual(before.map(i => [i.eventId, i.status]), [['press', 'ask'], ['rally', 'ask'], ['meet', 'todo']]);
  const after = planItems({plans, reports: [], allReports}, events).filter(i => i.day === D);
  assert.equal(planItems({plans, reports: [], allReports}, events).some(i => i.eventId === 'old'), false); // 줄 사본만 있는 □도 덮인다
  assert.deepEqual(after.map(i => [i.eventId, i.status]), [['rally', 'ask'], ['meet', 'todo']]);
  assert.equal(itemMeta(after.find(i => i.eventId === 'meet')), '일정 · 18:00 · 비슷한 보고 있음');
  assert.equal(itemMeta(after.find(i => i.eventId === 'rally')), '일정 · 15:00 · 주요 일정');
  // 안 쓴 보고: 11.5 '예시 운영위' □는 같은 날 따로 쓴 '예시 운영위 회의'(30분 뒤)가 덮는다.
  assert.deepEqual(overdueItems({plans, reports: []}, '2026-11-20').map(i => i.eventId), ['meet', 'old']);
  assert.deepEqual(overdueItems({plans, reports: [], allReports}, '2026-11-20').map(i => i.eventId), ['meet']);
});

test('조직 보고 창: 낱말이 떨어져 있어도 같은 조직·같은 날 기록이 일정 줄을 대신한다(같은 제목 규칙)', () => {
  const event = {org: 'o1', day: D, text: '안전운행 투쟁 기자회견'};
  assert.equal(sameThing(event, {org: 'o1', day: D, text: '안전운행 투쟁 돌입 기자회견 참석'}), true);
  assert.equal(sameThing(event, {org: 'o1', day: D, text: '안전운행 투쟁 기자회견 참석'}), true);   // 예전 규칙(통째 포함)도 그대로
  assert.equal(sameThing(event, {org: 'o1', day: D, text: '임금 교섭 상황 공유'}), false);
  assert.equal(sameThing(event, {org: 'o2', day: D, text: '안전운행 투쟁 돌입 기자회견'}), false);
  assert.equal(sameThing(event, {org: 'o1', day: '2026-11-19', text: '안전운행 투쟁 돌입 기자회견'}), false);
});
