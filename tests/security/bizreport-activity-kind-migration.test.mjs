import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';
import { validateExpanded } from '../../scripts/ops/db-migration-expanded.mjs';

// MTG-사업보고 DB-1: app_meetings.activity_kind text not null default 'meeting' + CHECK (8 kinds incl. 'other', 결정 1 = 가).
// No table grant, no policy or RLS change, no function or trigger, no location column. Strict workflow rules pass.
const version = '20261022182319';
const name = 'bizreport_activity_kind';
const KINDS = ['meeting', 'policy', 'negotiation', 'press', 'assembly', 'struggle', 'education', 'other'];
test('bizreport activity kind approval files pass strict risk checks and dry-run transformation', () => {
  for (const mode of ['apply', 'dry-run', 'rollback']) {
    const plan = prepareMigration({ mode, version, runId: '12345', root: process.cwd() });
    assert.equal(plan.name, name);
    assert.equal(plan.rules, 'strict');
    assert.deepEqual(plan.targets, ['app_meetings']);
    assert.deepEqual(plan.functions, []);
    assert.equal(plan.summaryLines.length, 3);
    assert.equal(plan.checks.precheck.baselineNull, false);
    if (mode === 'dry-run') assert.equal(plan.checks.postcheck, undefined);
    else assert.equal(plan.checks.postcheck.baselineNull, false);
  }
  const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
  // The expanded rules would also accept it, with nothing to review (no policy, grant, trigger, definer).
  const expanded = validateExpanded(sql, { version, name });
  assert.deepEqual(expanded.review, { definer: [], policies: 0, restrictive: 0, grants: 0, triggers: 0, revokes: 0 });
  assert.match(toDryRun(sql), /rollback;\s*$/);
  const code = sql.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /\bgrant\b|\brevoke\b|(?:create|alter|drop) policy|row level security|security definer|create (?:or replace )?function|create trigger|\bupdate public\.|\bdelete from public\.|\binsert into public\./i);
  assert.match(code, /add column activity_kind text not null default 'meeting';/);
  assert.match(code, new RegExp(`add constraint app_meetings_activity_kind_check check \\(activity_kind in\\s+\\(${KINDS.map(k => `'${k}'`).join(', ')}\\)\\);`));
  // No location column is added (task: no "add only if missing" branching). The precheck records it instead.
  assert.doesNotMatch(code, /\blocation\b/);
  // The owner policy is pinned before and after.
  assert.equal((code.match(/count\(\*\) from pg_policy where polrelid = 'public\.app_meetings'::regclass\) <> 1/g) || []).length, 2);
  // The post guard accepts exactly the PostgreSQL 17 and 16 check_clause texts (#980).
  assert.match(code, /check_clause, '\\s\+', ' ', 'g'\)\) in \(/);
  assert.match(code, /^\s+'\(\(activity_kind = ANY \(ARRAY\[[^\n]*''other''::text\]\)\)\)',$/m);
  assert.match(code, /^\s+'\(activity_kind = ANY \(ARRAY\[[^\n]*''other''::text\]\)\)'\)\) <> 1 then$/m);
  // Read-only checks run as a non-owner role: no information_schema (#978); both PG16/17 constraint texts in the postcheck.
  for (const kind of ['precheck', 'postcheck']) {
    const check = readFileSync(`docs/${version}_${name}.${kind}.sql`, 'utf8').replace(/--.*$/gm, '');
    assert.doesNotMatch(check, /information_schema/, kind);
  }
  const postcheck = readFileSync(`docs/${version}_${name}.postcheck.sql`, 'utf8');
  assert.match(postcheck, /'CHECK \(\(activity_kind = ANY/);
  assert.match(postcheck, /'CHECK \(\(\(activity_kind = ANY/);
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.match(rollback, /where activity_kind <> 'meeting'\) then\s+raise exception 'BIZREPORT_ACTIVITY_KIND_ROLLBACK_BLOCKED: non-meeting kinds saved/);
  assert.match(rollback, /drop constraint app_meetings_activity_kind_check,\s+drop column activity_kind;/);
  assert.doesNotMatch(rollback, /drop table|\bgrant\b|policy|\bupdate public\./i);
  const preserve = readFileSync(`docs/${version}_${name}.preserve.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.match(preserve, /^\s*select id, activity_kind\s+from public\.app_meetings\s+where activity_kind <> 'meeting'/m);
});
