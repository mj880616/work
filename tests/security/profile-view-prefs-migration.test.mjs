import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// SET-보기선택서버저장: one jsonb column + CHECK on app_profiles (theme, menu, calendar view, quick mode, note folder, split ratio, hidden date).
// No table grant, no policy or RLS change, no function. The screen writes its own row under the existing owner RLS.
const version = '20261023180000';
const name = 'profile_view_prefs';
test('profile view prefs approval files pass risk checks and dry-run transformation', () => {
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
  assert.match(code, /add column view_prefs jsonb;/);
  assert.match(code, /add constraint app_profiles_view_prefs_check check \(/);
  // Only the seven known keys and the known values are accepted.
  assert.match(code, /@\.key == "theme" \|\| @\.key == "nav_collapsed" \|\| @\.key == "calendar_view" \|\| @\.key == "home_quick_mode" \|\| @\.key == "note_folder" \|\| @\.key == "split_ratio" \|\| @\.key == "collect_hidden_on"/);
  assert.match(code, /in \('olive', 'navy', 'terracotta', 'sand'\)/);
  assert.equal((code.match(/count\(\*\) from pg_policy where polrelid = 'public\.app_profiles'::regclass\) <> 2/g) || []).length, 2);
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.match(rollback, /where view_prefs is not null\) then\s+raise exception/);
  assert.match(rollback, /drop constraint app_profiles_view_prefs_check,\s+drop column view_prefs;/);
  assert.doesNotMatch(rollback, /drop table|\bgrant\b|policy/i);
});
