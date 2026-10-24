import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';

// ED③ 1단계 PR A: a private backup table before the markdown note conversion. New table only, RLS on, every privilege revoked,
// the owner may read only the id/time columns (never raw_text or metadata), nobody writes, no function, no anon/PUBLIC.
const stem = '20261024190000_ed3_text_backup';
test('ed3 text backup migration: private table, id/time columns only to the owner, expanded single-approval flow', () => {
  const code = readFileSync(`supabase/migrations/${stem}.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /\bto\s+(?:anon|public)\b|security definer|create (?:or replace )?function|disable row level|alter policy|drop policy|rtw_|grant (?:insert|update|delete|all)/i);
  assert.match(code, /revoke all on table public\.app_ed3_text_backups from public, anon, authenticated, service_role;/);
  assert.match(code, /grant select \(id, workspace_id, source, row_id, row_updated_at, backed_up_at\) on table public\.app_ed3_text_backups to authenticated;/);
  assert.equal((code.match(/\bgrant\b/gi) || []).length, 1);
  assert.match(code, /create policy ed3_text_backups_owner_read on public\.app_ed3_text_backups for select to authenticated\s+using \(private\.app_is_workspace_owner\(workspace_id\)\);/);
  assert.match(code, /where n\.kind in \('note', 'basket', 'diary'\);/);
  assert.doesNotMatch(code, /\bupdate public\.app_(?:notes|suborganization_updates|project_progress_updates)\b|delete from public\./i);
  for (const mode of ['apply', 'dry-run']) {
    const plan = prepareMigration({mode, version: '20261024190000', runId: '1', root: process.cwd()});
    assert.equal(plan.rules, 'expanded'); assert.equal(plan.flow, 'full'); assert.equal(plan.summaryLines.length, 3);
    assert.deepEqual(plan.createdTables, ['app_ed3_text_backups']); assert.deepEqual(plan.functions, []);
  }
  const rollback = readFileSync(`docs/${stem}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.match(rollback, /where doc is not null\)\s+or exists[\s\S]*where doc is not null\)\s+or exists[\s\S]*where doc is not null\) then\s+raise exception/);
  assert.match(rollback, /drop table public\.app_ed3_text_backups;/);
  for (const f of ['snapshot', 'precheck', 'postcheck', 'rollback']) assert.match(readFileSync(`docs/${stem}.${f}.sql`, 'utf8'), /app_ed3_text_backups|20261024190000/);
});
