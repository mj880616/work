import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// JOURNAL-오늘한줄목록: the approval files pass the DB workflow risk checks. The change is the one work-line CHECK on
// app_notes — no column, index, function, grant, policy, RLS or row change; the one-row-a-day index stays.
const version = '20261020051027';
const name = 'journal_work_lines';
test('journal work lines approval files pass risk checks; only the work-line CHECK changes', () => {
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
  assert.doesNotMatch(code, /grant |revoke |(?:create|alter|drop) policy|row level security|create function|create (?:unique )?index|drop index|add column|drop column|update public|delete from public|insert into public/i);
  assert.equal((code.match(/alter table/gi) || []).length, 1);
  assert.match(code, /drop constraint app_notes_work_line_check,\s*add constraint app_notes_work_line_check check/);
  assert.match(code, /app_notes_journal_day_unique/);
  assert.match(code, /attachments = '\[\]'::jsonb/);
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8');
  assert.match(rollback, /JOURNAL_WORK_LINES_ROLLBACK_BLOCKED: multi-line work days exist/);
  // The rollback puts back the 20261017052234 rule text exactly.
  assert.ok(rollback.includes("kind <> 'work' or (length(btrim(raw_text)) between 1 and 300 and raw_text !~ '[\\r\\n]' and attachments = '[]'::jsonb)"));
  assert.ok(readFileSync('supabase/migrations/20261017052234_journal_memo_notes_kind.sql', 'utf8').includes("kind <> 'work' or (length(btrim(raw_text)) between 1 and 300 and raw_text !~ '[\\r\\n]' and attachments = '[]'::jsonb)"));
  assert.doesNotMatch(rollback.replace(/--.*$/gm, ''), /delete from public|update public|truncate|cascade/i);
});
