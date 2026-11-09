// MTG-프로젝트합치기 3단계: 사업 보고 주 단위 목록 규칙(business-area-model.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {shownReportWeek, inReportWeek, undatedCount, reportWeekLabel, reportDay} from '../app/business-area-model.mjs';

const m = (id, at) => ({id, meeting_at: at});

// BIZ-주간표이번주(11/09): 처음 주는 보고가 있든 없든 늘 이번 주(오늘이 든 월~일). 월요일(주 첫날)에 지난주 보고만 있어도 이번 주.
test('처음 주: 늘 이번 주 — 보고 유무와 상관없이, 월요일·일요일에도', () => {
  assert.equal(shownReportWeek(null, '', '2026-10-28'), '2026-10-26');
  assert.equal(shownReportWeek(null, '', '2026-11-09'), '2026-11-09'); // 월요일
  assert.equal(shownReportWeek(null, '', '2026-11-15'), '2026-11-09'); // 일요일
  assert.equal(shownReportWeek(null, '', '2027-01-01'), '2026-12-28'); // 해 넘김
});
test('‹ ›로 고른 주는 같은 주 안에서만, 새 주가 되면 이번 주로 돌아온다', () => {
  assert.equal(shownReportWeek('2026-11-02', '2026-11-09', '2026-11-12'), '2026-11-02');
  assert.equal(shownReportWeek('2026-11-02', '2026-11-02', '2026-11-09'), '2026-11-09');
  assert.equal(shownReportWeek('2026-11-02', '', '2026-11-09'), '2026-11-09');
});
test('주 거르기는 서울 날짜 월~일, 빈 주(전체)는 모두', () => {
  const list = [m(1, '2026-10-25T15:30:00Z'), m(2, '2026-11-01T14:59:00Z'), m(3, '2026-11-01T15:00:00Z')];
  assert.equal(reportDay(list[0]), '2026-10-26');
  assert.deepEqual(inReportWeek(list, '2026-10-26').map(x => x.id), [1, 2]);
  assert.deepEqual(inReportWeek(list, null).map(x => x.id), [1, 2, 3]);
});
test('주 이름', () => {
  assert.equal(reportWeekLabel('2026-10-26'), '10.26(월)~11.1(일)');
});
// MTG-프로젝트합치기 ⑤: 일시가 없는 보고는 어느 주에서도 빠지지 않는다(주 줄에는 '일시 없음 n'으로 따로 센다).
test('일시가 없는 보고는 모든 주에 함께 보이고 따로 센다', () => {
  const list = [m(1, '2026-10-27T01:00:00Z'), m(2, null), m(3, ''), m(4, '2026-11-03T01:00:00Z')];
  assert.deepEqual(inReportWeek(list, '2026-10-26').map(x => x.id), [1, 2, 3]);
  assert.deepEqual(inReportWeek(list, '2026-11-02').map(x => x.id), [2, 3, 4]);
  assert.equal(undatedCount(inReportWeek(list, '2026-10-26')), 2);
  assert.equal(undatedCount([m(1, '2026-10-27T01:00:00Z')]), 0);
});
