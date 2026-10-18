import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// UI-바구니첨부메모 PR 2a: one nullable column, one index and the app_documents owner WITH CHECK (USING kept).
// No function, grant, new policy or RLS change. The abandoned 20261018023753 cannot be chosen by the workflow.
const version = '20261018032038';
const name = 'doc_organization_link';
test('doc/organization link approval files pass risk checks and dry-run transformation', () => {
  for (const mode of ['apply', 'dry-run', 'rollback']) {
    const plan = prepareMigration({ mode, version, runId: '12345', root: process.cwd() });
    assert.equal(plan.name, name);
    assert.deepEqual(plan.targets, ['app_documents']);
    assert.deepEqual(plan.functions, []);
    assert.equal(plan.summaryLines.length, 3);
    assert.equal(plan.checks.precheck.baselineNull, false);
    if (mode === 'dry-run') assert.equal(plan.checks.postcheck, undefined);
    else assert.equal(plan.checks.postcheck.baselineNull, false);
  }
  const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
  assert.match(toDryRun(sql), /rollback;\s*$/);
  const code = sql.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /grant |revoke |(?:create|drop) policy|disable row level security|create function|update public|delete from public/i);
  assert.match(code, /alter policy task12a_owner_all on public\.app_documents\s+with check \(\s+private\.app_is_workspace_owner\(workspace_id\)\s+and \(organization_id is null or exists/);
  assert.doesNotMatch(code, /alter policy[^;]*\busing\b/i);
  assert.match(code, /references public\.app_suborganizations\(id\) on delete set null/);
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8');
  assert.match(rollback, /where organization_id is not null/);
  assert.match(rollback, /with check \(private\.app_is_workspace_owner\(workspace_id\)\);/);
});
test('the abandoned 20261018023753 has no approval files left', () => {
  assert.equal(readdirSync('supabase/migrations').some(f => f.startsWith('20261018023753_')), false);
  assert.equal(readdirSync('docs').some(f => f.startsWith('20261018023753_')), false);
  assert.throws(() => prepareMigration({ mode: 'dry-run', version: '20261018023753', runId: '1', root: process.cwd() }));
  assert.equal(existsSync('supabase/migrations/20261018023753_doc_org_categories.sql'), false);
});
