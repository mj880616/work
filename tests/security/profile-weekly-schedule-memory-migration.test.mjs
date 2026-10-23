import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// WEEKLY-환류 DB: one jsonb column (not null default []) + CHECK on app_profiles (원래 제목 → 고친 이름·장소 / 빼기).
// No table grant, no policy or RLS change, no function. The screen writes its own row under the existing owner RLS.
const version = '20261024002000';
const name = 'profile_weekly_schedule_memory';
test('profile weekly schedule memory approval files pass risk checks and dry-run transformation', () => {
  for (const mode of ['apply', 'dry-run', 'rollback']) {
    const plan = prepareMigration({ mode, version, runId: '12345', root: process.cwd() });
    assert.equal(plan.name, name);
    assert.deepEqual(plan.targets, ['app_profiles']);
    assert.deepEqual(plan.functions, []);
    assert.equal(plan.summaryLines.length, 3);
    assert.equal(plan.checks.precheck.baselineNull, false);
  }
  const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
  assert.match(toDryRun(sql), /rollback;\s*$/);
  const code = sql.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /\bgrant\b|\brevoke\b|(?:create|alter|drop) policy|row level security|security definer|create (?:or replace )?function|\bupdate public\.|\bdelete from public\.|rtw_/i);
  assert.match(code, /add column weekly_schedule_memory jsonb not null default '\[\]'::jsonb;/);
  assert.match(code, /add constraint app_profiles_weekly_schedule_memory_check check \(/);
  // Only the seven known keys are accepted; at most 200 items and 64 KiB.
  assert.match(code, /@\.key == "key" \|\| @\.key == "origin" \|\| @\.key == "title" \|\| @\.key == "place" \|\| @\.key == "drop" \|\| @\.key == "saved" \|\| @\.key == "used"/);
  assert.match(code, /jsonb_array_length\(weekly_schedule_memory\) <= 200\s+and octet_length\(weekly_schedule_memory::text\) <= 65536/);
  assert.equal((code.match(/count\(\*\) from pg_policy where polrelid = 'public\.app_profiles'::regclass\) <> 2/g) || []).length, 2);
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.match(rollback, /where weekly_schedule_memory <> '\[\]'::jsonb\) then\s+raise exception/);
  assert.match(rollback, /drop constraint app_profiles_weekly_schedule_memory_check,\s+drop column weekly_schedule_memory;/);
  assert.doesNotMatch(rollback, /drop table|\bgrant\b|policy/i);
});
