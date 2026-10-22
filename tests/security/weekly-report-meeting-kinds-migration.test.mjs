import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// JOURNAL-주간정리다듬기 ③: one column + CHECK on app_profiles ("주간보고에 올리지 않을 회의 종류").
// No table grant, no policy or RLS change, no function. The screen writes its own row under the existing owner RLS.
const version = '20261022090000';
const name = 'weekly_report_meeting_kinds';
test('weekly report meeting kinds approval files pass risk checks and dry-run transformation', () => {
  for (const mode of ['apply', 'dry-run', 'rollback']) {
    const plan = prepareMigration({ mode, version, runId: '12345', root: process.cwd() });
    assert.equal(plan.name, name);
    assert.deepEqual(plan.targets, ['app_profiles']);
    assert.deepEqual(plan.functions, []);
    assert.equal(plan.summaryLines.length, 3);
    assert.equal(plan.checks.precheck.baselineNull, false);
    if (mode === 'dry-run') assert.equal(plan.checks.postcheck, undefined);
    else assert.equal(plan.checks.postcheck.baselineNull, false);
  }
  const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
  assert.match(toDryRun(sql), /rollback;\s*$/);
  const code = sql.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /\bgrant\b|\brevoke\b|(?:create|alter|drop) policy|row level security|security definer|create (?:or replace )?function|\bupdate public\.|\bdelete from public\./i);
  assert.match(code, /add column weekly_hidden_meeting_kinds text\[\] not null\s+default array\['궤도집행국회의', '본부집행위'\]::text\[\];/);
  assert.match(code, /add constraint app_profiles_weekly_hidden_meeting_kinds_check check \(/);
  // Default kinds are already name keys (no spaces, lower case) so they pass the CHECK and match meetingNameKey.
  for (const kind of ['궤도집행국회의', '본부집행위']) assert.equal(kind, kind.replace(/\s+/g, '').toLowerCase());
  // Prerequisite: the owner policies are unchanged before and after.
  assert.equal((code.match(/count\(\*\) from pg_policy where polrelid = 'public\.app_profiles'::regclass\) <> 2/g) || []).length, 2);
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.match(rollback, /is distinct from array\['궤도집행국회의', '본부집행위'\]::text\[\]\) then\s+raise exception/);
  assert.match(rollback, /drop constraint app_profiles_weekly_hidden_meeting_kinds_check,\s+drop column weekly_hidden_meeting_kinds;/);
  assert.doesNotMatch(rollback, /drop table|\bgrant\b|policy/i);
});
