import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// ED-통합편집기 ①b: app_share_pages_blocks_check accepts a 7th block type "doc" (new editor document, ed1 outer shape).
// One CHECK replaced under the same name. No grant, policy, RLS, function or trigger change; share-page-read unchanged.
const version = '20261022130000';
const name = 'share_pages_doc_block';
test('share page doc block approval files pass risk checks and dry-run transformation', () => {
  for (const mode of ['apply', 'dry-run', 'rollback']) {
    const plan = prepareMigration({ mode, version, runId: '12345', root: process.cwd() });
    assert.equal(plan.name, name);
    assert.deepEqual(plan.targets, ['app_share_pages']);
    assert.deepEqual(plan.functions, []);
    assert.equal(plan.summaryLines.length, 3);
    assert.equal(plan.checks.precheck.baselineNull, false);
    if (mode === 'dry-run') assert.equal(plan.checks.postcheck, undefined);
    else assert.equal(plan.checks.postcheck.baselineNull, false);
  }
  const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
  assert.match(toDryRun(sql), /rollback;\s*$/);
  const code = sql.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /\bgrant\b|\brevoke\b|(?:create|alter|drop) policy|row level security|security definer|create (?:or replace )?function|\bupdate public\.|\bdelete from public\.|\binsert into public\./i);
  // Same outer limits; the old six kinds stay; "doc" is the only new kind; the doc block's outer shape is checked.
  assert.match(code, /jsonb_array_length\(blocks\) <= 60/);
  assert.match(code, /octet_length\(blocks::text\) <= 262144/);
  assert.match(code, /@ == "summary" \|\| @ == "stages" \|\| @ == "schedule" \|\| @ == "issues" \|\| @ == "links" \|\| @ == "updates" \|\| @ == "doc"\)/);
  assert.match(code, /@\.doc\.v != "ed1"/);
  assert.match(code, /@\.doc\.doc\.type != "doc"/);
  assert.match(code, /@\.key != "type" && @\.key != "doc"/);
  // The prerequisite pins the original 6-kind CHECK text and the one owner policy.
  assert.match(code, /@ == "links"\) \|\| @ == "updates"\)''::jsonpath/);
  // The migration guard runs in the write request as the table owner, so information_schema sees the CHECK there
  // (and the strict grammar allows only text helpers in DO). The precheck runs as a read-only, non-owner role where
  // information_schema hides the row (2026-10-22 apply precheck stopped on this): it reads pg_constraint instead.
  const precheck = readFileSync(`docs/${version}_${name}.precheck.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.doesNotMatch(precheck, /information_schema/);
  assert.match(precheck, /regexp_replace\(pg_get_constraintdef\(oid\),'\\s\+',' ','g'\)\)=btrim\(regexp_replace\('CHECK \(\(\(jsonb_typeof/);
  assert.match(precheck, /@ == "links"\) \|\| @ == "updates"\)''::jsonpath/);
  assert.equal((code.match(/count\(\*\) from pg_policy where polrelid = 'public\.app_share_pages'::regclass\) <> 1/g) || []).length, 2);
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.match(rollback, /blocks @> '\[\{"type":"doc"\}\]'::jsonb\) then\s+raise exception/);
  assert.match(rollback, /@ == "links" \|\| @ == "updates"\)',/);
  assert.doesNotMatch(rollback, /"doc"\)'|drop table|\bgrant\b|policy/i);
});
