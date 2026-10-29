// TASK-내일칸(2026-10-29): 할 일 기한 묶음 하나(task-due.mjs dueGroup)와 그것을 쓰는 곳.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dueGroup, DUE_GROUPS} from '../app/task-due.mjs';
import {dueTasks} from '../app/home-read-model.js';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('묶음 순서: 기한 지남 → 오늘 → 내일 → 일주일 안(모레~7일) → 나중 → 기한 없음', () => {
  assert.deepEqual(DUE_GROUPS.map(([, label]) => label), ['기한 지남', '오늘', '내일', '일주일 안', '나중', '기한 없음']);
  const today = '2026-10-29';
  assert.equal(dueGroup('2026-10-28', today), 'overdue');
  assert.equal(dueGroup('2026-10-29', today), 'today');
  assert.equal(dueGroup('2026-10-29T00:00:00.000Z', today), 'today');
  assert.equal(dueGroup('2026-10-30', today), 'tomorrow');
  assert.equal(dueGroup('2026-10-31', today), 'week');
  assert.equal(dueGroup('2026-11-05', today), 'week');
  assert.equal(dueGroup('2026-11-06', today), 'later');
  assert.equal(dueGroup('', today), 'undated');
  assert.equal(dueGroup(null, today), 'undated');
});

test('달·해 경계에서도 내일·일주일 안이 맞다', () => {
  assert.equal(dueGroup('2027-01-01', '2026-12-31'), 'tomorrow');
  assert.equal(dueGroup('2027-01-07', '2026-12-31'), 'week');
  assert.equal(dueGroup('2027-01-08', '2026-12-31'), 'later');
  assert.equal(dueGroup('2026-11-01', '2026-10-31'), 'tomorrow');
});

test('홈 [오늘 할 일]은 같은 묶음의 기한 지남·오늘만(내일은 빠짐)', () => {
  const now = Date.parse('2026-10-29T03:00:00Z');
  const t = (id, due, status = 'needsAction') => ({id, due, status});
  const rows = dueTasks([t('a', '2026-10-30T00:00:00.000Z'), t('b', '2026-10-29T00:00:00.000Z'), t('c', '2026-10-27T00:00:00.000Z'), t('d', null), t('e', '2026-10-29T00:00:00.000Z', 'completed')], now);
  assert.deepEqual(rows.map(r => r.id), ['c', 'b']);
});

test('할 일 화면(폰 목록·PC 두 칸)은 공용 묶음 함수로 고르고 내일 묶음을 그린다', () => {
  const src = read('app/google-tasks.js');
  assert.match(src, /import \{dueGroup\} from '\.\/task-due\.mjs'/);
  assert.match(src, /group\('tomorrow','내일',tomorrow\)/);
  assert.match(src, /gt-col-sub gt-col-sub-top">내일 \$\{tomorrow\.length\}/);
  assert.doesNotMatch(src, /inSevenDayWindow/);
});
