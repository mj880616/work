import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makePlan } from '../../scripts/ops/db-workflow.mjs';

// LEDGER-자동기록 DB. Expanded rules, single-approval flow; owner only, no widening, no service_role.
const version = '20261024120000';
const name = 'ledger_auto_record';
const file = `${version}_${name}.sql`;
test('ledger auto record db: approval plan passes expanded rules without widening access', () => {
  const plan = makePlan('apply', '1', 'refs/heads/main', file);
  assert.equal(plan.rules, 'expanded');
  assert.equal(plan.flow, 'full');
  assert.equal(plan.functions.length, 9);
  assert.equal(plan.review.policies, 4);
  assert.equal(plan.review.restrictive, 0);
  assert.deepEqual(plan.review.definer, []);
  assert.equal(makePlan('dry-run', '1', 'refs/heads/main', file).flow, 'full');
  assert.throws(() => makePlan('rollback', '1', 'refs/heads/main', file));

  const code = readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /security definer|disable row level security|alter policy|drop policy|\bto (?:anon|public)\b|grant [^;]* to [^;]*(?:anon|public|service_role)|using \(true\)|with check \(true\)/i);
  const policies = code.match(/create policy [\s\S]*?;/g) || [];
  assert.equal(policies.length, 4);
  for (const p of policies) {
    assert.match(p, /\bto authenticated\b/);
    assert.match(p, /private\.app_is_workspace_owner\(workspace_id\)/);
  }
  for (const t of ['app_ledger_auto_runs', 'app_ledger_auto_sources', 'app_ledger_fix_requests', 'app_ledger_record_changes']) {
    assert.match(code, new RegExp(`alter table public\\.${t} enable row level security;`));
  }
  assert.equal((code.match(/^security invoker/gim) || []).length, 9);
  for (const kind of ['precheck', 'postcheck']) {
    const check = readFileSync(`docs/${version}_${name}.${kind}.sql`, 'utf8').replace(/--.*$/gm, '');
    assert.doesNotMatch(check, /information_schema/, kind);
  }
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.match(rollback, /LEDGER_AUTO_RECORD_ROLLBACK_BLOCKED/);
  assert.doesNotMatch(rollback, /\bgrant\b/i);
});
