import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makePlan } from '../../scripts/ops/db-workflow.mjs';

// S61-6 ORG-기록첨부표시이름 ① DB. Expanded rules, single-approval flow; nothing that widens access.
const version = '20261112204500';
const name = 'record_link_origin';
const file = `${version}_${name}.sql`;
test('record link origin db: approval plan passes expanded rules without widening access', () => {
  const plan = makePlan('apply', '1', 'refs/heads/main', file);
  assert.equal(plan.rules, 'expanded');
  assert.equal(plan.flow, 'full');
  assert.deepEqual(plan.targets, ['app_record_links']);
  assert.deepEqual(plan.functions, ['public.app_basket_confirm_links']);
  assert.deepEqual(plan.review.definer, []);
  assert.equal(makePlan('dry-run', '1', 'refs/heads/main', file).flow, 'full');
  assert.throws(() => makePlan('rollback', '1', 'refs/heads/main', file));

  const code = readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /security definer|disable row level security|create policy|alter policy|drop policy|\bto (?:anon|public)\b|grant [^;]* to [^;]*(?:anon|public|service_role)/i);
  assert.match(code, /add column origin text,\s+add constraint app_record_links_origin_check\s+check \(origin is null or \(origin in \('record_input', 'basket'\) and note_id is not null\)\);/);
  assert.doesNotMatch(code, /update public\.app_record_links/i, 'old rows are not filled');
  const sig = 'public.app_basket_confirm_links(uuid,timestamptz,jsonb)'.replace(/[().]/g, '\\$&');
  assert.match(code, new RegExp(`revoke all on function ${sig} from public, anon;\\ngrant execute on function ${sig} to authenticated;`));
  assert.equal((code.match(/language plpgsql security invoker set search_path = ''/g) || []).length, 1);
  for (const kind of ['precheck', 'postcheck']) {
    const check = readFileSync(`docs/${version}_${name}.${kind}.sql`, 'utf8').replace(/--.*$/gm, '');
    assert.doesNotMatch(check, /information_schema/, kind);
  }
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.match(rollback, /alter table public\.app_record_links drop column origin;/);
  assert.doesNotMatch(rollback, /record_input/);
  assert.doesNotMatch(rollback, /\bgrant\b(?! execute on function)/i);
  assert.doesNotMatch(rollback, /delete from public\.app_record_links/i);
});
