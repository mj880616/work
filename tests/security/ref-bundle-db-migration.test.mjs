import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makePlan } from '../../scripts/ops/db-workflow.mjs';

// REF-참고묶음 1단계 DB. Expanded rules, single-approval flow; nothing that widens access.
const version = '20261023231500';
const name = 'ref_bundle_db';
const file = `${version}_${name}.sql`;
test('ref bundle db: approval plan passes expanded rules without widening access', () => {
  const plan = makePlan('apply', '1', 'refs/heads/main', file);
  assert.equal(plan.rules, 'expanded');
  assert.equal(plan.flow, 'full');
  assert.deepEqual(plan.targets, ['app_record_links']);
  assert.deepEqual(plan.functions, ['public.app_basket_confirm_links', 'public.app_basket_update_link_summary']);
  assert.equal(plan.review.restrictive, 1);
  assert.deepEqual(plan.review.definer, []);
  assert.equal(makePlan('dry-run', '1', 'refs/heads/main', file).flow, 'full');
  assert.throws(() => makePlan('rollback', '1', 'refs/heads/main', file));

  const code = readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /security definer|disable row level security|alter policy|drop policy|\bto (?:anon|public)\b|grant [^;]* to [^;]*(?:anon|public|service_role)/i);
  assert.match(code, /create policy reference_bundles_owner_all on public\.app_reference_bundles for all to authenticated\s+using \(private\.app_is_workspace_owner\(workspace_id\)\)\s+with check \(private\.app_is_workspace_owner\(workspace_id\)\)/);
  assert.match(code, /revoke all on table public\.app_reference_bundles from public, anon, authenticated, service_role;/);
  assert.match(code, /create policy record_links_bundle_ws on public\.app_record_links as restrictive\s+for all to authenticated/);
  assert.match(code, /references public\.app_reference_bundles\(id\) on delete restrict/);
  assert.match(code, /rename constraint app_record_links_unique_bundle to app_record_links_unique;/);
  for (const sig of ['public.app_basket_confirm_links(uuid,timestamptz,jsonb)', 'public.app_basket_update_link_summary(uuid,text,text)']) {
    const esc = sig.replace(/[().]/g, '\\$&');
    assert.match(code, new RegExp(`revoke all on function ${esc} from public, anon;\\ngrant execute on function ${esc} to authenticated;`));
  }
  assert.equal((code.match(/language plpgsql security invoker set search_path = ''/g) || []).length, 2);
  for (const kind of ['precheck', 'postcheck']) {
    const check = readFileSync(`docs/${version}_${name}.${kind}.sql`, 'utf8').replace(/--.*$/gm, '');
    assert.doesNotMatch(check, /information_schema/, kind);
  }
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.match(rollback, /bundle_id is not null\) then\s+raise exception 'REF_BUNDLE_DB_ROLLBACK_BLOCKED: reference links exist/);
  assert.match(rollback, /check \(num_nonnulls\(project_id, organization_id, meeting_id, document_id\) = 1\)/);
  assert.doesNotMatch(rollback, /\bgrant\b(?! execute on function)/i);
  assert.doesNotMatch(rollback, /delete from public\.app_record_links/i);
});
