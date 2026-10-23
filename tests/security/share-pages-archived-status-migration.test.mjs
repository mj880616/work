import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// SHARE-페이지삭제: app_share_pages_status_check accepts a third value "archived" (a deleted page stays as a record, hidden from
// the list; share-page-read already shows only status = published, so the public link stops without an Edge change).
// One CHECK replaced under the same name. No grant, policy, RLS, function or trigger change.
const version = '20261023160000';
const name = 'share_pages_archived_status';
test('share page archived status approval files pass risk checks and dry-run transformation', () => {
  for (const mode of ['apply', 'dry-run', 'rollback']) {
    const plan = prepareMigration({ mode, version, runId: '12345', root: process.cwd() });
    assert.equal(plan.name, name);
    assert.deepEqual(plan.targets, ['app_share_pages']);
    assert.deepEqual(plan.functions, []);
    assert.equal(plan.summaryLines.length, 3);
    assert.equal(plan.checks.precheck.baselineNull, false);
    if (mode === 'dry-run') assert.equal(plan.checks.postcheck, undefined);
    else assert.equal(plan.checks.postcheck.baselineNull, false);
  }
  const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
  assert.match(toDryRun(sql), /rollback;\s*$/);
  const code = sql.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /\bgrant\b|\brevoke\b|(?:create|alter|drop) policy|row level security|security definer|create (?:or replace )?function|\bupdate public\.|\bdelete from public\.|\binsert into public\./i);
  assert.match(code, /add constraint app_share_pages_status_check check \(status in \('draft', 'published', 'archived'\)\)/);
  assert.match(code, /count\(\*\) from pg_policy where polrelid = 'public\.app_share_pages'::regclass\) <> 1/);
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.match(rollback, /where status = 'archived'\) then\s+raise exception/);
  assert.match(rollback, /check \(status in \('draft', 'published'\)\)/);
  assert.doesNotMatch(rollback, /archived'\)\s*;|drop table|\bgrant\b|policy/i);
  // The precheck reads pg_constraint (the read-only role cannot see information_schema rows).
  const precheck = readFileSync(`docs/${version}_${name}.precheck.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.doesNotMatch(precheck, /information_schema/);
});
