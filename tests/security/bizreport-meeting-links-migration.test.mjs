import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makePlan } from '../../scripts/ops/db-workflow.mjs';

// MTG-사업보고 DB-2 + MEET-기록보내기 B1. Expanded rules, single-approval flow; nothing that widens access.
const version = '20261023023500';
const name = 'bizreport_meeting_links';
test('bizreport meeting links: approval plan passes expanded rules without widening access', () => {
  const plan = makePlan('apply', '1', 'refs/heads/main', `${version}_${name}.sql`);
  assert.equal(plan.rules, 'expanded');
  assert.equal(plan.flow, 'full');
  assert.deepEqual(plan.targets, ['app_meetings', 'app_record_links']);
  assert.deepEqual(plan.functions, ['public.app_meeting_set_links']);
  assert.deepEqual(plan.review, { definer: [], policies: 1, restrictive: 1, grants: 1, triggers: 0, revokes: 1 });
  assert.equal(makePlan('dry-run', '1', 'refs/heads/main', `${version}_${name}.sql`).flow, 'full');
  // drop policy/function are outside the workflow rollback grammar: rollback is SQL Editor only.
  assert.throws(() => makePlan('rollback', '1', 'refs/heads/main', `${version}_${name}.sql`));

  const code = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /security definer|disable row level security|alter policy|drop policy|\bto (?:anon|public)\b|grant [^;]* on table/i);
  assert.match(code, /create policy record_links_source_meeting_ws on public\.app_record_links as restrictive\s+for all to authenticated/);
  assert.match(code, /revoke all on function public\.app_meeting_set_links\(uuid,timestamptz,jsonb\) from public, anon, service_role;\ngrant execute on function public\.app_meeting_set_links\(uuid,timestamptz,jsonb\) to authenticated;/);
  assert.match(code, /language plpgsql security invoker set search_path = ''/);
  // The unique constraint keeps its name (app_basket_confirm_links uses ON CONFLICT ON CONSTRAINT app_record_links_unique).
  assert.match(code, /rename constraint app_record_links_unique_source_meeting to app_record_links_unique;/);
  // The production FK name the screen reads by must exist before apply (design 7.3).
  assert.match(code, /c\.conname = 'app_record_links_meeting_id_fkey'/);
  // Location column only if missing, with a 200-char check.
  assert.match(code, /add column if not exists location text;/);
  assert.match(code, /check \(location is null or char_length\(location\) <= 200\)/);
  for (const kind of ['precheck', 'postcheck']) {
    const check = readFileSync(`docs/${version}_${name}.${kind}.sql`, 'utf8').replace(/--.*$/gm, '');
    assert.doesNotMatch(check, /information_schema/, kind);
  }
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.match(rollback, /drop function public\.app_meeting_set_links\(uuid, timestamptz, jsonb\);/);
  assert.match(rollback, /check \(num_nonnulls\(google_task_id, note_id\) = 1\)/);
  assert.doesNotMatch(rollback, /drop column location|drop table|\bgrant\b/i);
});
