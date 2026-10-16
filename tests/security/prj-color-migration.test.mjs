import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// PRJ-색: the approval files pass the workflow risk checks; the change is one CHECK on the
// existing app_spaces.metadata, with no column, policy, RLS or grant change.
const version = '20261016201647';
const keys = ['green', 'blue', 'orange', 'purple', 'pink', 'yellow', 'red', 'gray'];
test('PRJ-color approval files pass risk checks and dry-run transformation', () => {
  for (const mode of ['apply', 'dry-run', 'rollback']) {
    const plan = prepareMigration({ mode, version, runId: '12345', root: process.cwd() });
    assert.deepEqual(plan.targets, ['app_spaces']);
    assert.equal(plan.summaryLines.length, 3);
    assert.equal(plan.checks.precheck.baselineNull, false);
    if (mode === 'dry-run') assert.equal(plan.checks.postcheck, undefined);
    else assert.equal(plan.checks.postcheck.baselineNull, false);
  }
  const sql = readFileSync(`supabase/migrations/${version}_prj_color_check.sql`, 'utf8');
  assert.match(toDryRun(sql), /rollback;\s*$/);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /grant |revoke |policy|disable row level security|add column|update public|delete from public/i);
  const check = sql.split('add constraint app_spaces_metadata_color_check')[1].split(');')[0];
  assert.deepEqual([...check.matchAll(/'"([a-z]+)"'::jsonb/g)].map(m => m[1]), keys);
});
test('screen color keys match the database allow-list and theme tokens', () => {
  const js = readFileSync('app/project-system-v3.js', 'utf8');
  const listed = [...js.match(/const PROJECT_COLORS=\[(.*?)\];/)[1].matchAll(/\['([a-z]+)','/g)].map(m => m[1]);
  assert.deepEqual(listed, keys);
  const tokens = readFileSync('app/theme-tokens.css', 'utf8');
  const dark = tokens.slice(tokens.indexOf('@media (prefers-color-scheme:dark)'));
  for (const key of keys) for (const name of [`--ds-project-${key}:`, `--ds-project-${key}-soft:`]) {
    assert.equal(tokens.split(name).length - 1, 2, `${name} light and dark`);
    assert.ok(dark.includes(name), `${name} dark`);
  }
});
