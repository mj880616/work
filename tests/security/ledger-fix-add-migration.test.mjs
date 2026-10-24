import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makePlan } from '../../scripts/ops/db-workflow.mjs';

// LEDGER-수정요청 DB. Expanded rules, single-approval flow; one function body widened (do:'add'), no widening of access.
const version = '20261024200000';
const name = 'ledger_fix_add';
const file = `${version}_${name}.sql`;
test('ledger fix add db: approval plan passes expanded rules without widening access', () => {
  const plan = makePlan('apply', '1', 'refs/heads/main', file);
  assert.equal(plan.rules, 'expanded');
  assert.equal(plan.flow, 'full');
  assert.deepEqual(plan.functions, ['public.app_apply_ledger_fix']);
  assert.equal(plan.review.policies, 0);
  assert.deepEqual(plan.review.definer, []);
  assert.equal(makePlan('dry-run', '1', 'refs/heads/main', file).flow, 'full');
  assert.throws(() => makePlan('rollback', '1', 'refs/heads/main', file));

  const code = readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /security definer|disable row level security|create policy|alter policy|drop policy|\bto (?:anon|public)\b|grant [^;]* to [^;]*(?:anon|public|service_role)|using \(true\)|with check \(true\)|create table/i);
  assert.equal((code.match(/^security invoker/gim) || []).length, 1);
  assert.match(code, /create or replace function public\.app_apply_ledger_fix\(p_workspace_id uuid, p_request jsonb, p_dry_run boolean\)/);
  for (const kind of ['precheck', 'postcheck']) {
    const check = readFileSync(`docs/${version}_${name}.${kind}.sql`, 'utf8').replace(/--.*$/gm, '');
    assert.doesNotMatch(check, /information_schema/, kind);
  }
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.doesNotMatch(rollback, /\bgrant\b|delete from public|drop /i);
});
