// MTG-프로젝트합치기 3단계: 사업 보고 주 단위 목록 규칙(business-area-model.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultReportWeek, inReportWeek, reportWeekLabel, reportDay} from '../app/business-area-model.mjs';

const m = (id, at) => ({id, meeting_at: at});

test('처음 주: 이번 주에 보고가 있으면 이번 주', () => {
  assert.equal(defaultReportWeek([m(1, '2026-10-20T01:00:00Z'), m(2, '2026-10-27T01:00:00Z')], '2026-10-28'), '2026-10-26');
});
test('처음 주: 이번 주에 없으면 오늘까지 가장 최근 보고의 주, 미래 보고만 있으면 그 주, 보고가 없으면 이번 주', () => {
  assert.equal(defaultReportWeek([m(1, '2026-10-06T01:00:00Z'), m(2, '2026-12-01T01:00:00Z')], '2026-10-28'), '2026-10-05');
  assert.equal(defaultReportWeek([m(2, '2026-12-01T01:00:00Z')], '2026-10-28'), '2026-11-30');
  assert.equal(defaultReportWeek([], '2026-10-28'), '2026-10-26');
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
