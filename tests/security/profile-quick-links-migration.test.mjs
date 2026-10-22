import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// UI-자주가는링크: one jsonb column + CHECK on app_profiles (the sidebar "자주 가는 링크" list).
// No table grant, no policy or RLS change, no function. The screen writes its own row under the existing owner RLS.
const version = '20261022150000';
const name = 'profile_quick_links';
test('profile quick links approval files pass risk checks and dry-run transformation', () => {
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
  assert.doesNotMatch(code, /\bgrant\b|\brevoke\b|(?:create|alter|drop) policy|row level security|security definer|create (?:or replace )?function|\bupdate public\.|\bdelete from public\./i);
  assert.match(code, /add column quick_links jsonb;/);
  assert.match(code, /add constraint app_profiles_quick_links_check check \(/);
  // Only http/https addresses: the CHECK pins the scheme at the start of the url.
  assert.match(code, /\^\[hH\]\[tT\]\[tT\]\[pP\]\[sS\]\?:\/\//);
  assert.equal((code.match(/count\(\*\) from pg_policy where polrelid = 'public\.app_profiles'::regclass\) <> 2/g) || []).length, 2);
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.match(rollback, /where quick_links is not null\) then\s+raise exception/);
  assert.match(rollback, /drop constraint app_profiles_quick_links_check,\s+drop column quick_links;/);
  assert.doesNotMatch(rollback, /drop table|\bgrant\b|policy/i);
});
