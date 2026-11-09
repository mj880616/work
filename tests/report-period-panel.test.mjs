// S54-34 ② BIZ-기간정하기·BIZ-주차고르기: 국제 표준 주차(ISO 8601)·기간 칩·작은 창 글 — 화면 없이.
import test from 'node:test';
import assert from 'node:assert/strict';
import {isoWeekOf, isoWeekStart, isoWeeksIn, isoWeekLabel, weekOf} from '../app/business-area-model.mjs';
import {PERIOD_CHOICES, quickRanges} from '../app/report-period-model.mjs';
import {rangePanelHtml, weekNumberPanelHtml, isoYears, isoWeekOptions, isoYearChanged, weekNumberName} from '../app/report-period-panel.mjs';

test('주차: 월~일, 1주차 = 그 해 첫 목요일이 든 주(연도 경계·53주차)', () => {
  assert.deepEqual(isoWeekOf('2026-11-09'), {year: 2026, week: 46, from: '2026-11-09'});
  assert.deepEqual(isoWeekOf('2026-11-15'), {year: 2026, week: 46, from: '2026-11-09'}); // 일요일
  assert.equal(isoWeekStart(2026, 1), '2025-12-29');
  assert.deepEqual(isoWeekOf('2025-12-29'), {year: 2026, week: 1, from: '2025-12-29'}); // 해 앞 주가 새해 1주차
  assert.deepEqual(isoWeekOf('2026-01-04'), {year: 2026, week: 1, from: '2025-12-29'});
  assert.deepEqual(isoWeekOf('2027-01-03'), {year: 2026, week: 53, from: '2026-12-28'}); // 새해 첫날들이 지난해 53주차
  assert.deepEqual(isoWeekOf('2021-01-03'), {year: 2020, week: 53, from: '2020-12-28'});
  assert.deepEqual(isoWeekOf('2025-01-01'), {year: 2025, week: 1, from: '2024-12-30'});
  assert.equal(isoWeeksIn(2026), 53); assert.equal(isoWeeksIn(2025), 52); assert.equal(isoWeeksIn(2027), 52); assert.equal(isoWeeksIn(2020), 53);
  // 모든 주에서 주차 시작 = 그 주 월요일(weekOf 하나로 계산)
  for (let y = 2019; y <= 2031; y++) for (let w = 1; w <= isoWeeksIn(y); w++) {
    const from = isoWeekStart(y, w);
    assert.equal(weekOf(from).from, from);
    assert.deepEqual(isoWeekOf(from), {year: y, week: w, from});
  }
  assert.equal(isoWeekLabel(2026, 46), '46주차 (11.09~11.15)');
  assert.equal(isoWeekLabel(2026, 1), '1주차 (12.29~01.04)');
  assert.equal(weekNumberName('2026-11-09'), '46주차');
});

test('주차 선택 창: 연도는 최근 해가 위(내년까지), 주차는 최근 주가 위·이번 주 표시, 연도를 바꾸면 이번 해는 이번 주', () => {
  assert.deepEqual(isoYears('2026-11-09'), [2027, 2026, 2025]);
  assert.deepEqual(isoYears('2026-11-09', '2024-03-02'), [2027, 2026, 2025, 2024]);
  const opts = isoWeekOptions(2026, '2026-11-09');
  assert.equal(opts.length, 53);
  assert.equal(opts[0].label, '53주차 (12.28~01.03)');
  assert.equal(opts.find(o => o.week === 46).label, '46주차 (11.09~11.15) · 이번 주');
  assert.ok(!isoWeekOptions(2025, '2026-11-09').some(o => o.label.includes('이번 주')));
  assert.equal(isoYearChanged(2026, 3, '2026-11-09'), 46);
  assert.equal(isoYearChanged(2025, 53, '2026-11-09'), 52);
  assert.equal(isoYearChanged(2020, 53, '2026-11-09'), 53);
  const html = weekNumberPanelHtml({year: 2026, week: 46}, '2026-11-09');
  assert.match(html, /data-report-period-panel="isoweek"/);
  assert.match(html, /<option value="2026" selected>2026년<\/option>/);
  assert.match(html, /<option value="46" selected>46주차 \(11\.09~11\.15\) · 이번 주<\/option>/);
  assert.match(html, /data-report-week="cancel">닫기<\/button><button type="button" class="mini primary" data-report-week="iso-apply">적용<\/button>/);
});

test('기간 메뉴·기간 정하기 창: 이번 주·주차 선택·전체 기간·기간 정하기 / 칩 다섯 개, 날짜 두 칸(글자 칸 없음), [닫기][적용]', () => {
  assert.deepEqual(PERIOD_CHOICES.map(([, t]) => t), ['이번 주', '주차 선택', '전체 기간', '기간 정하기']);
  const list = [{meeting_at: '2026-03-02T01:00:00Z'}, {meeting_at: null}, {meeting_at: '2026-10-28T01:00:00Z'}];
  const chips = quickRanges('2026-11-09', list);
  assert.deepEqual(chips.map(c => c.label), ['이번 주', '이번 달', '지난 달', '최근 3달', '전체']);
  assert.deepEqual(chips[0], {key: 'week', label: '이번 주', from: '2026-11-09', to: '2026-11-15'});
  assert.deepEqual(chips.at(-1), {key: 'all', label: '전체', from: '2026-03-02', to: '2026-11-09'});
  assert.deepEqual(quickRanges('2026-11-09', [{meeting_at: '2026-12-02T01:00:00Z'}]).at(-1), {key: 'all', label: '전체', from: '2026-11-09', to: '2026-12-02'});
  const html = rangePanelHtml({from: '2026-10-01', to: '2026-10-31', key: 'last-month'}, chips);
  assert.match(html, /class="ds-chip" data-report-quick="last-month" aria-pressed="true">지난 달/);
  assert.match(html, /data-report-quick="week" aria-pressed="false">이번 주/);
  assert.match(html, /<input type="date" data-report-from aria-label="시작 날짜" value="2026-10-01"><span class="report-period-tilde" aria-hidden="true">~<\/span><input type="date" data-report-to aria-label="끝 날짜" value="2026-10-31">/);
  assert.doesNotMatch(html, /<label/);
  assert.ok(html.indexOf('data-report-week="cancel"') < html.indexOf('data-report-week="apply"'));
});
