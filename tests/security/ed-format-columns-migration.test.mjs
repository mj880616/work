import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// ED③-1 DB: one jsonb `doc` column + shape CHECK on app_notes, app_suborganization_updates, app_project_progress_updates.
// No table grant, no policy or RLS change, no function, no data copy. The rollback stops while any row holds a format.
const version = '20261023233000';
const name = 'ed_format_columns';
const tables = ['app_notes', 'app_project_progress_updates', 'app_suborganization_updates'];
test('ed format columns approval files pass risk checks and dry-run transformation', () => {
  for (const mode of ['apply', 'dry-run', 'rollback']) {
    const plan = prepareMigration({ mode, version, runId: '12345', root: process.cwd() });
    assert.equal(plan.name, name);
    assert.deepEqual(plan.targets, tables);
    assert.deepEqual(plan.functions, []);
    assert.equal(plan.summaryLines.length, 3);
    assert.equal(plan.checks.precheck.baselineNull, false);
  }
  const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
  assert.match(toDryRun(sql), /rollback;\s*$/);
  const code = sql.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /\bgrant\b|\brevoke\b|(?:create|alter|drop) policy|row level security|security definer|create (?:or replace )?function|create table|\bupdate public\.|\bdelete from public\.|\bnot valid\b/i);
  for (const table of tables) {
    assert.match(code, new RegExp(`alter table public\\.${table}\\s+add column doc jsonb,\\s+add constraint ${table}_doc_check check \\(`));
  }
  // The shape check never lets a NULL result through (a value missing an inner key is refused).
  assert.equal((code.match(/doc is null or coalesce\(/g) || []).length, 3);
  assert.equal((code.match(/octet_length\(doc::text\) <= 1048576, false\)\);/g) || []).length, 3);
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.match(rollback, /where doc is not null\)\s+or exists[\s\S]*where doc is not null\)\s+or exists[\s\S]*where doc is not null\) then\s+raise exception/);
  for (const table of tables) assert.match(rollback, new RegExp(`drop constraint ${table}_doc_check,\\s+drop column doc;`));
  assert.doesNotMatch(rollback, /drop table|\bgrant\b|policy/i);
  const precheck = readFileSync(`docs/${version}_${name}.precheck.sql`, 'utf8');
  assert.match(precheck, /-- expect: project records text column length limits = 기록/);
  assert.match(precheck, /-- expect: org updates text column length limits = 기록/);
});
