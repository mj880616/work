import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// UI-바구니첨부메모 PR 2: the approval files pass the DB workflow risk checks. The change is two columns, one CHECK,
// one index, the app_documents owner WITH CHECK (USING kept) and four SECURITY INVOKER functions for authenticated only.
const version = '20261018023753';
const name = 'doc_org_categories';
const functions = [
  'private.app_document_categories_valid(text[])',
  'public.app_document_category_add(uuid,text)',
  'public.app_document_category_delete(uuid,text,text[])',
  'public.app_document_category_rename(uuid,text,text,text[])',
];
test('doc/org/categories approval files pass risk checks and dry-run transformation', () => {
  for (const mode of ['apply', 'dry-run', 'rollback']) {
    const plan = prepareMigration({ mode, version, runId: '12345', root: process.cwd() });
    assert.equal(plan.name, name);
    assert.deepEqual(plan.targets, ['app_documents', 'app_workspaces']);
    assert.deepEqual(plan.functions, mode === 'rollback' ? [] : functions);
    assert.equal(plan.summaryLines.length, 3);
    assert.equal(plan.checks.precheck.baselineNull, false);
    if (mode === 'dry-run') assert.equal(plan.checks.postcheck, undefined);
    else assert.equal(plan.checks.postcheck.baselineNull, false);
  }
  const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
  assert.match(toDryRun(sql), /rollback;\s*$/);
  const code = sql.replace(/--.*$/gm, '');
  // No table grant, new policy, RLS change, definer function or data rewrite outside the functions.
  assert.doesNotMatch(code, /grant (?:select|insert|update|delete|all)|(?:create|drop) policy|disable row level security|security definer/i);
  assert.equal((code.match(/security invoker/g) || []).length, 4);
  for (const signature of functions) {
    const args = signature.slice(signature.indexOf('(') + 1, -1).replaceAll(',', ', ');
    const sig = `${signature.slice(0, signature.indexOf('('))}(${args})`;
    assert.match(code, new RegExp(`revoke all on function ${sig.replace(/[()[\]]/g, '\\$&')} from public, anon;`));
    assert.match(code, new RegExp(`grant execute on function ${sig.replace(/[()[\]]/g, '\\$&')} to authenticated;`));
  }
  // Same owner USING; WITH CHECK keeps the owner test and adds the same-workspace organization.
  assert.match(code, /alter policy task12a_owner_all on public\.app_documents\s+with check \(\s+private\.app_is_workspace_owner\(workspace_id\)\s+and \(organization_id is null or exists/);
  assert.doesNotMatch(code, /alter policy[^;]*\busing\b/i);
  assert.match(code, /references public\.app_suborganizations\(id\) on delete set null/);
  assert.match(code, /default array\['교섭', '투쟁', '교육', '선전', '정책', '회의', '기타'\]::text\[\]/);
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8');
  assert.match(rollback, /where organization_id is not null/);
  assert.match(rollback, /with check \(private\.app_is_workspace_owner\(workspace_id\)\);/);
});
