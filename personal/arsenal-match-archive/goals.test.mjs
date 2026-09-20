import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const context = { window: {} };
runInNewContext(readFileSync(new URL('./matches.js', import.meta.url), 'utf8'), context);
const matches = context.window.ARSENAL_MATCHES;

test('every archived score has one structured entry per goal, on the credited side', () => {
  assert.equal(matches.length, 60);
  for (const match of matches) {
    assert.ok(Array.isArray(match.goals), `${match.id}: goals missing`);
    assert.match(match.goalsSource, /^https:\/\//, `${match.id}: scoring source`);
    assert.equal(match.goals.filter(goal => goal.side === 'home').length, match.homeScore, `${match.id}: home goals`);
    assert.equal(match.goals.filter(goal => goal.side === 'away').length, match.awayScore, `${match.id}: away goals`);
    for (const goal of match.goals) {
      assert.match(goal.minute, /^(?:[1-9]\d?|10[0-9]|11[0-9]|120)(?:\+\d+)?$/, `${match.id}: minute`);
      assert.ok(typeof goal.scorer === 'string' && goal.scorer.trim(), `${match.id}: scorer`);
      assert.ok(goal.assist === null || (typeof goal.assist === 'string' && goal.assist.trim()), `${match.id}: assist`);
      assert.ok(['goal', 'penalty', 'own-goal'].includes(goal.type), `${match.id}: type`);
    }
  }
});

test('official scoring distinctions survive representative fixtures', () => {
  const byDate = date => matches.find(match => match.date === date);
  assert.equal(byDate('2025-08-17').goals[0].minute, '13');
  assert.equal(byDate('2025-08-17').goals[0].assist, null);
  assert.equal(byDate('2025-12-13').goals.filter(goal => goal.type === 'own-goal').length, 2);
  assert.equal(byDate('2026-01-28').goals[0].minute, '3'); // UEFA official report, not PL syndication minute.
  assert.equal(byDate('2026-05-05').goals[0].minute, '45');
  assert.match(byDate('2026-01-28').goalsTimeSource, /^https:\/\/www\.uefa\.com\//);
  assert.match(byDate('2026-05-05').goalsTimeSource, /^https:\/\/www\.uefa\.com\//);
  assert.equal(byDate('2026-05-30').goals.length, 2); // Shootout goals do not enter the match score.
  assert.equal(byDate('2026-01-08').goals.length, 0);
});
