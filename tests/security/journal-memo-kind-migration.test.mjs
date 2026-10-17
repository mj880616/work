import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// MEMO-노트·JOURNAL-일지 0단계: the approval files pass the DB workflow risk checks. The change is
// columns, CHECKs and indexes on app_notes only — no function, grant, policy or RLS change.
const version = '20261017052234';
const name = 'journal_memo_notes_kind';
test('journal/memo kind approval files pass risk checks and dry-run transformation', () => {
  for (const mode of ['apply', 'dry-run', 'rollback']) {
    const plan = prepareMigration({ mode, version, runId: '12345', root: process.cwd() });
    assert.equal(plan.name, name);
    assert.deepEqual(plan.targets, ['app_notes']);
    assert.deepEqual(plan.functions, []);
    assert.equal(plan.summaryLines.length, 3);
    assert.equal(plan.checks.precheck.baselineNull, false);
    if (mode === 'dry-run') assert.equal(plan.checks.postcheck, undefined);
    else assert.equal(plan.checks.postcheck.baselineNull, false);
  }
  const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
  assert.match(toDryRun(sql), /rollback;\s*$/);
  const code = sql.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /grant |revoke |(?:create|alter|drop) policy|disable row level security|create function|update public|delete from public/i);
  for (const constraint of ['kind', 'title', 'journal_day', 'work_line', 'diary_private']) assert.match(code, new RegExp(`add constraint app_notes_${constraint}_check`));
  assert.match(code, /kind text not null default 'basket'/);
  assert.match(code, /kind <> 'diary' or ai_export_allowed = false/);
  assert.match(code, /when 'note' then length\(raw_text\) <= 100000/);
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8');
  assert.match(rollback, /kind <> 'basket' or title is not null or journal_day is not null/);
});
