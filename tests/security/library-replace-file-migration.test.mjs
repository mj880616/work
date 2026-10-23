import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// LIB-수정파일교체 DB: two columns on app_documents (previous_files jsonb + shape CHECK, reclassify_needed boolean).
// No table grant, no policy or RLS change, no function, no trigger, no data copy. The rollback stops while any row holds a replaced-file record.
const version = '20261024030000';
const name = 'library_replace_file';
test('library replace file approval files pass risk checks and dry-run transformation', () => {
  for (const mode of ['apply', 'dry-run', 'rollback']) {
    const plan = prepareMigration({ mode, version, runId: '12345', root: process.cwd() });
    assert.equal(plan.name, name);
    assert.deepEqual(plan.targets, ['app_documents']);
    assert.deepEqual(plan.functions, []);
    assert.equal(plan.summaryLines.length, 3);
    assert.equal(plan.checks.precheck.baselineNull, false);
  }
  const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
  assert.match(toDryRun(sql), /rollback;\s*$/);
  const code = sql.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /\bgrant\b|\brevoke\b|(?:create|alter|drop) policy|row level security|security definer|create (?:or replace )?function|create table|create trigger|\bupdate public\.|\bdelete from public\.|\bnot valid\b/i);
  assert.match(code, /add column previous_files jsonb not null default '\[\]'::jsonb,\s+add column reclassify_needed boolean not null default false;/);
  // The shape check never lets a NULL result through.
  assert.match(code, /check \(\s+coalesce\(/);
  assert.match(code, /false\)\);/);
  assert.match(code, /jsonb_array_length\(previous_files\) <= 50/);
  assert.match(code, /octet_length\(previous_files::text\) <= 65536/);
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.match(rollback, /previous_files <> '\[\]'::jsonb or reclassify_needed\) then\s+raise exception/);
  assert.match(rollback, /drop constraint app_documents_previous_files_check,\s+drop column previous_files,\s+drop column reclassify_needed;/);
  assert.doesNotMatch(rollback, /drop table|\bgrant\b|policy/i);
});
