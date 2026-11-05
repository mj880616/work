// S50-35(2026-11-05 명진 결정): 홈에서 새로 넣는 할 일의 기한 기본값(task-due.mjs newTaskDue) — 고르지 않으면 오늘, 고르면 그날.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {newTaskDue} from '../app/task-due.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('고르지 않으면 오늘, 고른 날이 있으면 그날(시각이 붙어도 날짜만)', () => {
  assert.equal(newTaskDue('', '2026-11-05'), '2026-11-05');
  assert.equal(newTaskDue(null, '2026-11-05'), '2026-11-05');
  assert.equal(newTaskDue(undefined, '2026-11-05'), '2026-11-05');
  assert.equal(newTaskDue('잘못된 값', '2026-11-05'), '2026-11-05');
  assert.equal(newTaskDue('2026-11-09', '2026-11-05'), '2026-11-09');
  assert.equal(newTaskDue('2026-11-09T00:00:00.000Z', '2026-11-05'), '2026-11-09');
});

test('기본값을 정하는 곳은 한 군데: 홈 입력칸은 newTaskDue로만 기한을 정하고 기한 없음(null)을 보내지 않는다', () => {
  const src = read('app/home-quick.js');
  assert.match(src, /due:newTaskDue\(/);
  assert.doesNotMatch(src, /due:taskOnly\?dayKey\(Date\.now\(\)\):due\|\|null/);
});
