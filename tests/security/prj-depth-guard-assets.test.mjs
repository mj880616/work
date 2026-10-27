import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkSQL, prepareMigration } from '../../scripts/ops/db-migration-plan.mjs';

// PRJ-3단 DB 안전망: the migration's fixed error codes are the ones the project screen turns into plain words, and the
// companion files exist. The real PostgreSQL behaviour is in tests/auth-handoff/prj-depth-guard.test.mjs.
const stem = '20261021053502_prj_depth_guard';
test('PRJ depth guard files: SQL Editor only, read-only checks, three-line summary', () => {
  const sql = readFileSync(`supabase/migrations/${stem}.sql`, 'utf8');
  assert.match(sql, /^begin;\n/);
  assert.match(sql, /\ncommit;\n$/);
  // DB-승인형확장: CREATE TRIGGER on a function made in the same file passes the expanded rules (single-approval flow).
  assert.equal(prepareMigration({ mode: 'dry-run', version: '20261021053502', runId: '1', root: process.cwd() }).rules, 'expanded');
  for (const suffix of ['precheck', 'postcheck', 'snapshot']) checkSQL(readFileSync(`docs/${stem}.${suffix}.sql`, 'utf8'));
  const summary = readFileSync(`docs/${stem}.summary.md`, 'utf8').trim().split('\n');
  assert.deepEqual(summary.map(l => l.split(':')[0]), ['무엇이 바뀌나', '잘못되면', '되돌리는 법']);
  const rollback = readFileSync(`docs/${stem}.rollback.sql`, 'utf8');
  assert.match(rollback, /drop trigger if exists app_spaces_depth_guard on public\.app_spaces;\ndrop function if exists private\.app_enforce_space_depth\(\);/);
  assert.match(rollback, /delete from supabase_migrations\.schema_migrations where version = '20261021053502' and name = 'prj_depth_guard';\ncommit;\n$/);
});
test('the project screen shows the database refusal in plain words and does not ask to re-check the save', () => {
  const sql = readFileSync(`supabase/migrations/${stem}.sql`, 'utf8');
  const codes = [...new Set([...sql.matchAll(/message = '(PRJ_[A-Z_]+):/g)].map(m => m[1]))].sort();
  assert.deepEqual(codes, ['PRJ_DEPTH_LIMIT', 'PRJ_PARENT_CYCLE']);
  const js = readFileSync('app/project-system-v3.js', 'utf8');
  assert.match(js, /\/\^PRJ_\(DEPTH_LIMIT\|PARENT_CYCLE\):\/\.exec/);
  const text = js.match(/const PRJ_GUARD_TEXT=\{DEPTH_LIMIT:'([^']+)',PARENT_CYCLE:'([^']+)'\};/);
  assert.ok(text);
  assert.match(text[1], /^프로젝트는 3단까지만 둘 수 있어요\./);
  assert.match(text[2], /^자기 자신이나 그 아래 프로젝트 밑으로는 옮길 수 없어요\./);
  // A refusal is a known "not saved" result, like 401/403: no "could not confirm" review prompt.
  assert.match(js, /rejected=\[401,403\]\.includes\(error\?\.status\)\|\|!!guard/);
});
