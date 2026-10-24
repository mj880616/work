import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMigration } from '../../scripts/ops/db-migration-plan.mjs';
import { ExpandedRejection } from '../../scripts/ops/db-migration-expanded.mjs';

// ED③ prerequisite: the four production-only PUBLIC policies of app_project_progress_updates are narrowed to authenticated.
// Only the target role changes (ALTER POLICY ... TO authenticated). No grant, revoke, new/dropped policy, RLS, function or data change.
// The approved DB workflow refuses an existing-policy change, so this one is applied in the SQL Editor (폰 경로 C).
const version = '20261023232000';
const name = 'project_records_policies_authenticated';
test('project records policies migration: roles-only narrowing, pair files, SQL Editor path', () => {
  for (const mode of ['apply', 'dry-run']) {
    assert.throws(() => prepareMigration({ mode, version, runId: '12345', root: process.cwd() }),
      error => error instanceof ExpandedRejection && /do-block/.test(error.message), mode);
  }
  const code = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.match(code, /^begin;/);
  assert.match(code, /commit;\s*$/);
  assert.doesNotMatch(code, /\bgrant\b|\brevoke\b|(?:create|drop) policy|disable row level security|security definer|create (?:or replace )?function|\busing\s*\(|with check\s*\(|\bupdate public\.|\bdelete from public\.|rtw_/i);
  const alters = code.match(/alter policy[^;]*/gi) || [];
  assert.deepEqual(alters, ["alter policy %I on public.app_project_progress_updates to authenticated', p.polname)"]);
  assert.match(code, /polroles <> array\[0::oid\]\) then\s+raise exception 'PROJECT_RECORDS_POLICIES_PREREQUISITE_CHANGED/);
  assert.match(code, /after_hash is distinct from before_hash then\s+raise exception 'PROJECT_RECORDS_POLICIES_CONDITION_CHANGED/);
  assert.match(code, new RegExp(`values \\('${version}', '${name}',`));
  for (const suffix of ['precheck.sql', 'snapshot.sql', 'postcheck.sql', 'rollback.sql', 'summary.md']) {
    assert.ok(readFileSync(`docs/${version}_${name}.${suffix}`, 'utf8').length > 0, suffix);
  }
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.deepEqual(rollback.match(/alter policy[^;]*/gi), ["alter policy %I on public.app_project_progress_updates to public', p.polname)"]);
  assert.doesNotMatch(rollback, /\bgrant\b|\brevoke\b|(?:create|drop) policy|\busing\s*\(|with check\s*\(/i);
  for (const file of ['precheck', 'postcheck', 'snapshot']) {
    assert.doesNotMatch(readFileSync(`docs/${version}_${name}.${file}.sql`, 'utf8').replace(/--.*$/gm, '').replace(/'[^']*'/g, "''"), /\b(insert|update|delete|alter|create|drop|grant|revoke)\b/i, file);
  }
  // ED③ file name is unchanged (it must match the production record it will insert).
  assert.ok(readFileSync('supabase/migrations/20261023233000_ed_format_columns.sql', 'utf8').includes("values ('20261023233000', 'ed_format_columns'"));
  const summary = readFileSync(`docs/${version}_${name}.summary.md`, 'utf8').trim().split('\n');
  assert.equal(summary.length, 3);
});
