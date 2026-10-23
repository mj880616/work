import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// WEEKLY-임시저장 DB: two columns (draft jsonb, draft_saved_at) + shape CHECK on app_weekly_exec_requests. No new table, policy, function or RLS change.
// The only grants are insert/update on the two NEW columns for authenticated (the table uses column grants, so a new column is unwritable without them).
// The approved DB workflow's expanded rules refuse a grant on an existing table (grant-existing), so this file is applied as written (SQL Editor, phone path C)
// unless that gate is widened by a separate decision. The rollback stops while any row holds a draft.
const version = '20261024001000';
const name = 'weekly_draft';
test('weekly draft migration files are narrow and carry the guards', () => {
  const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
  assert.match(toDryRun(sql), /rollback;\s*$/);
  const code = sql.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /security definer|create (?:or replace )?function|create table|(?:create|alter|drop) policy|row level security|\brevoke\b|to anon|to public|to service_role|grant delete|grant all|\bupdate public\.|\bdelete from public\.|\bnot valid\b|rtw_/i);
  assert.deepEqual(code.match(/\bgrant\b[^;]*;/gi), [
    'grant insert (draft, draft_saved_at) on table public.app_weekly_exec_requests to authenticated;',
    'grant update (draft, draft_saved_at) on table public.app_weekly_exec_requests to authenticated;',
  ]);
  assert.match(code, /add column draft jsonb,\s+add column draft_saved_at timestamptz,\s+add constraint app_weekly_exec_requests_draft_check check \(/);
  // A value with a missing inner key never passes as NULL; the size is counted in bytes.
  assert.match(code, /coalesce\(\s*jsonb_typeof\(draft\) = 'object'\s+and draft -> 'v' = '1'::jsonb\s+and octet_length\(draft::text\) <= 204800, false\)\s+and draft_saved_at is not null/);
  for (const file of ['precheck.sql', 'snapshot.sql', 'postcheck.sql', 'rollback.sql', 'summary.md']) readFileSync(`docs/${version}_${name}.${file}`, 'utf8');
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.match(rollback, /where draft is not null\) then\s+raise exception/);
  assert.match(rollback, /drop constraint app_weekly_exec_requests_draft_check,\s+drop column draft_saved_at,\s+drop column draft;/);
  assert.doesNotMatch(rollback, /drop table|\bgrant\b|policy/i);
  const precheck = readFileSync(`docs/${version}_${name}.precheck.sql`, 'utf8');
  assert.match(precheck, /-- expect: draft column count = 0/);
  assert.match(precheck, /-- expect: authenticated delete privilege = 아니오/);
});
