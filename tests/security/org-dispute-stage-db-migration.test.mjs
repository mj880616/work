import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makePlan } from '../../scripts/ops/db-workflow.mjs';

// ORG-쟁의단계 DB. Expanded rules, single-approval flow; nothing that widens access.
const version = '20261024100000';
const name = 'org_dispute_stage_db';
const file = `${version}_${name}.sql`;
test('org dispute stage db: approval plan passes expanded rules without widening access', () => {
  const plan = makePlan('apply', '1', 'refs/heads/main', file);
  assert.equal(plan.rules, 'expanded');
  assert.equal(plan.flow, 'full');
  assert.deepEqual(plan.functions, ['public.app_dispute_stage_delete']);
  assert.equal(plan.review.restrictive, 2);
  assert.deepEqual(plan.review.definer, []);
  assert.equal(makePlan('dry-run', '1', 'refs/heads/main', file).flow, 'full');
  assert.throws(() => makePlan('rollback', '1', 'refs/heads/main', file));

  const code = readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /security definer|disable row level security|alter policy|drop policy|\bto (?:anon|public)\b|grant [^;]* to [^;]*(?:anon|public|service_role)|using \(true\)|with check \(true\)/i);
  for (const table of ['app_dispute_stages', 'app_suborganization_dispute_stages']) {
    assert.match(code, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(code, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated, service_role;`));
  }
  // Every policy targets authenticated only.
  const policies = code.match(/create policy [\s\S]*?;/g) || [];
  assert.equal(policies.length, 4);
  for (const p of policies) assert.match(p, /\bto authenticated\b/);
  assert.match(code, /create policy dispute_stages_owner_all on public\.app_dispute_stages for all to authenticated\s+using \(private\.app_is_workspace_owner\(workspace_id\)\)\s+with check \(private\.app_is_workspace_owner\(workspace_id\)\)/);
  assert.match(code, /create policy dispute_stage_history_owner_all on public\.app_suborganization_dispute_stages for all to authenticated\s+using \(private\.app_is_owner_organization\(organization_id\)\)\s+with check \(private\.app_is_owner_organization\(organization_id\)\)/);
  assert.match(code, /check \(not \(is_struggle and is_ending\)\)/);
  assert.match(code, /create unique index app_dispute_stages_one_default on public\.app_dispute_stages\(workspace_id\) where is_default;/);
  // The default flag is set on insert only; history lines have no update grant.
  assert.doesNotMatch(code, /grant update \([^)]*is_default/);
  assert.doesNotMatch(code, /grant [^;]*update[^;]*app_suborganization_dispute_stages/);
  assert.match(code, /revoke all on function public\.app_dispute_stage_delete\(uuid,boolean\) from public, anon;\ngrant execute on function public\.app_dispute_stage_delete\(uuid,boolean\) to authenticated;/);
  assert.equal((code.match(/language plpgsql security invoker set search_path = ''/g) || []).length, 1);
  assert.doesNotMatch(code, /insert into public\.app_dispute_stages/); // starter stages are filled by the app, not by this migration
  for (const kind of ['precheck', 'postcheck']) {
    const check = readFileSync(`docs/${version}_${name}.${kind}.sql`, 'utf8').replace(/--.*$/gm, '');
    assert.doesNotMatch(check, /information_schema/, kind);
  }
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.match(rollback, /ORG_DISPUTE_STAGE_DB_ROLLBACK_BLOCKED: stage or history rows exist/);
  assert.doesNotMatch(rollback, /\bgrant\b/i);
  assert.doesNotMatch(rollback, /delete from public\./i);
});
