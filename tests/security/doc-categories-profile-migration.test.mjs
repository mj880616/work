import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// UI-바구니첨부메모 PR 2b: one column + CHECK on app_profiles and three INVOKER category functions (own profile only).
// No table grant, no policy or RLS change. The functions run under the existing owner RLS.
const version = '20261018112943';
const name = 'doc_categories_profile';
const functions = [
  'public.app_document_category_add(text)',
  'public.app_document_category_delete(text,text[])',
  'public.app_document_category_rename(text,text,text[])',
];
test('doc categories profile approval files pass risk checks and dry-run transformation', () => {
  for (const mode of ['apply', 'dry-run', 'rollback']) {
    const plan = prepareMigration({ mode, version, runId: '12345', root: process.cwd() });
    assert.equal(plan.name, name);
    assert.deepEqual(plan.targets, ['app_profiles']);
    assert.deepEqual(plan.functions, mode === 'rollback' ? [] : functions);
    assert.equal(plan.summaryLines.length, 3);
    assert.equal(plan.checks.precheck.baselineNull, false);
    if (mode === 'dry-run') assert.equal(plan.checks.postcheck, undefined);
    else assert.equal(plan.checks.postcheck.baselineNull, false);
  }
  const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
  assert.match(toDryRun(sql), /rollback;\s*$/);
  const code = sql.replace(/--.*$/gm, '');
  // No table grants, policies or RLS changes; only function EXECUTE to authenticated after revoking PUBLIC/anon.
  assert.doesNotMatch(code, /grant [^;]* on (?:table )?public\.app_|(?:create|alter|drop) policy|row level security|security definer/i);
  assert.equal((code.match(/security invoker set search_path = ''/g) || []).length, 3);
  assert.equal((code.match(/revoke all on function public\.app_document_category_\w+\([^)]*\) from public, anon, service_role;/g) || []).length, 3);
  assert.equal((code.match(/grant execute on function public\.app_document_category_\w+\([^)]*\) to authenticated;/g) || []).length, 3);
  // Every write targets the caller's own profile row; document updates stay under the owner workspace check.
  assert.equal((code.match(/update public\.app_profiles set document_categories = [^;]*\n\s+where user_id = v_uid;/g) || []).length, 3);
  assert.equal((code.match(/and private\.app_is_workspace_owner\(workspace_id\);/g) || []).length, 2);
  assert.doesNotMatch(code, /p_workspace_id|p_user_id/);
  // 기타 is locked in both functions and the CHECK.
  assert.equal((code.match(/= '기타' then\s+return pg_catalog\.jsonb_build_object\('ok', false, 'error', 'CATEGORY_LOCKED'\)/g) || []).length, 2);
  assert.match(code, /array_position\(document_categories, '기타'\) is not null/);
  // Precheck proves the existing UPDATE privilege and own-row owner policy instead of granting them.
  assert.match(code, /authenticated=\[a-zA-Z\]\*w/);
  assert.match(code, /'private\.app_is_owner_profileuser_id'/);
  const precheck = readFileSync(`docs/${version}_${name}.precheck.sql`, 'utf8');
  assert.match(precheck, /has_table_privilege\('authenticated','public\.app_profiles','UPDATE'\)/);
  assert.match(precheck, /'owner can update own profile row'/);
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8');
  assert.match(rollback, /document_categories is distinct from array\['교섭', '투쟁', '교육', '선전', '정책', '회의', '기타'\]::text\[\]/);
  assert.doesNotMatch(rollback.replace(/--.*$/gm, ''), /update public|delete from public/);
});
