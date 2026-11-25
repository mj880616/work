import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// AI-비용보기 4단계 DB: the approval files pass the DB workflow risk checks (extended rules).
// New insert-only table app_ai_usage_events (no content columns, owner read, column insert only) and
// app_ai_cost_entries kind/month checks gain cap·reload. No function, no anon/PUBLIC, no update/delete grant.
const version = '20261125235000';
const name = 'ai_usage_events';
const read = path => readFileSync(path, 'utf8');
test('ai usage events approval files pass risk checks and dry-run transformation', () => {
  for (const mode of ['apply', 'dry-run']) {
    const plan = prepareMigration({ mode, version, runId: '12345', root: process.cwd() });
    assert.equal(plan.name, name);
    assert.equal(plan.flow, 'full');
    assert.deepEqual([...plan.createdTables], ['app_ai_usage_events']);
    assert.deepEqual(plan.targets, ['app_ai_cost_entries']);
    assert.deepEqual(plan.functions, []);
    assert.equal(plan.summaryLines.length, 3);
    assert.equal(plan.checks.precheck.baselineNull, false);
    if (mode === 'dry-run') assert.equal(plan.checks.postcheck, undefined);
    else assert.equal(plan.checks.postcheck.baselineNull, false);
  }
  const sql = read(`supabase/migrations/${version}_${name}.sql`);
  assert.match(toDryRun(sql), /rollback;\s*$/);
  const code = sql.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /\bto\s+(anon|public)\b|disable row level security|security definer|create (or replace )?function|(?:alter|drop) policy|rtw_/i);
  assert.doesNotMatch(code, /grant\s+(update|delete|all|truncate)|grant\s+select[^;]*service_role/i);
  assert.match(code, /alter table public\.app_ai_usage_events enable row level security/);
  assert.match(code, /revoke all on table public\.app_ai_usage_events from public, anon, authenticated, service_role/);
  assert.match(code, /check \(kind in \('topup', 'bill', 'cap', 'reload'\)\)/);
  assert.match(code, /kind in \('topup', 'cap', 'reload'\) and month is null/);
  // No content column: only keys, numbers and time.
  const table = code.match(/create table public\.app_ai_usage_events \(([\s\S]*?)\n\);/)[1];
  const columns = table.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('constraint') && !l.startsWith("('") && !l.startsWith('and ')).map(l => l.split(/\s+/)[0]);
  assert.deepEqual(columns.sort(), ['calls', 'created_at', 'day', 'feature', 'id', 'input_tokens', 'model', 'output_tokens', 'provider', 'workspace_id']);
  const rollback = read(`docs/${version}_${name}.rollback.sql`);
  assert.match(rollback, /check \(kind in \('topup', 'bill'\)\)/);
  assert.match(rollback, /kind in \('cap', 'reload'\)\) then\s+raise exception/);
});
