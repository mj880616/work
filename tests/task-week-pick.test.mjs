// S46-30(2026-10-31 명진 결정): 할 일 기한 [다음주] → 다음 주 월~일 요일 목록, 빠른 기한 줄 하나를 모든 곳이 같이 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nextWeekDays, weekdayLabel, quickDueDay, QUICK_DUES} from '../app/task-due.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('다음 주는 다음 월요일부터 일요일까지 일곱 날, 토·일은 주말 표시', () => {
  const days = nextWeekDays('2026-10-31');
  assert.deepEqual(days.map(d => d.label), ['월 11.2', '화 11.3', '수 11.4', '목 11.5', '금 11.6', '토 11.7', '일 11.8']);
  assert.deepEqual(days.map(d => d.weekend), [false, false, false, false, false, true, true]);
  assert.equal(days[0].day, '2026-11-02');
  assert.equal(days[6].day, '2026-11-08');
});

test('일요일이면 내일(월)부터, 월요일이면 일주일 뒤 월요일부터, 해 경계도 맞다', () => {
  assert.equal(nextWeekDays('2026-11-01')[0].day, '2026-11-02');
  assert.equal(nextWeekDays('2026-11-02')[0].day, '2026-11-09');
  assert.equal(nextWeekDays('2026-12-31')[0].day, '2027-01-04');
  assert.equal(nextWeekDays('2026-12-31')[6].label, '일 1.10');
});

test('빠른 기한 줄은 [오늘][내일][모레][다음주][기한 없음], 날짜는 한국 날짜 그대로 센다', () => {
  assert.deepEqual(QUICK_DUES.map(([, label]) => label), ['오늘', '내일', '모레', '다음주', '기한 없음']);
  assert.equal(quickDueDay('0', '2026-10-31'), '2026-10-31');
  assert.equal(quickDueDay('2', '2026-12-30'), '2027-01-01');
  assert.equal(weekdayLabel('2026-11-04'), '수 11.4');
  assert.equal(weekdayLabel(''), '');
});

test('빠른 기한 줄·[다음주] 목록은 공용 부품 하나를 쓴다(수정 창, ⋯ 기한 바꾸기, 홈 빠른 쓰기, 정리함 할 일 만들기)', () => {
  const editor = read('app/google-tasks.js');
  assert.match(editor, /QUICK_DUES\.map/);
  assert.match(editor, /openWeekPick\(q,/);
  assert.doesNotMatch(editor, /data-gt-due-quick="7"/);
  const inline = read('app/task-inline.js');
  assert.match(inline, /QUICK_DUES\.map/);
  assert.match(inline, /openWeekPick\(anchor,/);
  for (const file of ['app/home-quick.js', 'app/basket-manual-link.js']) {
    const src = read(file);
    assert.match(src, /openWeekPick\(b,/, file);
    assert.match(src, />모레</, file);
    assert.match(src, /다음주/, file);
  }
  const pick = read('app/task-week-pick.js');
  assert.match(pick, /createAnchoredMenu/);
});
