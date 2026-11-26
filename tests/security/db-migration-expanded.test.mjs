// DB-승인형확장: expanded static rules for the approved DB workflow. Policies, table grants, triggers and functions are
// accepted only when they cannot widen access; every refusal below has a fixed reason code. No database, no production.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateExpanded, checkSnapshotSQL, parseExpectations, meetsExpectation, ExpandedRejection, REJECT_REASONS } from '../../scripts/ops/db-migration-expanded.mjs';
import { prepareMigration } from '../../scripts/ops/db-migration-plan.mjs';

const version = '20261099000000';
const name = 'expand_example';
const wrap = body => `begin;\nset local lock_timeout = '5s';\n${body}\ninsert into supabase_migrations.schema_migrations (version, name, statements) values ('${version}', '${name}', array['test']);\ncommit;\n`;
const table = `create table public.ex_items(id uuid primary key, workspace_id uuid not null, label text);\nalter table public.ex_items enable row level security;`;
const fn = (opts = 'security invoker set search_path = \'\'') => `create function public.ex_fn(p integer) returns integer language sql ${opts} as $$select p + 1;$$;`;
const revoke = 'revoke all on function public.ex_fn(integer) from public, anon;';
const reason = sql => {
  try { validateExpanded(sql, { version, name }); return 'accepted'; }
  catch (error) { assert.ok(error instanceof ExpandedRejection, error.message); return error.reason; }
};

// The refusal list shown to the user in the PR. Each entry: [pattern, SQL body, reason code].
const refusals = [
  // (a) grants to anon / PUBLIC
  ['table grant to anon', `${table}\ngrant select on table public.ex_items to anon;`, 'grant-anon-public'],
  ['table grant to PUBLIC', `${table}\ngrant select on table public.ex_items to public;`, 'grant-anon-public'],
  ['column grant to anon', `${table}\ngrant update (label) on table public.ex_items to anon;`, 'grant-anon-public'],
  ['grant to anon and authenticated together', `${table}\ngrant select on table public.ex_items to authenticated, anon;`, 'grant-anon-public'],
  ['function EXECUTE to anon', `${fn()}\n${revoke}\ngrant execute on function public.ex_fn(integer) to anon;`, 'grant-anon-public'],
  ['function EXECUTE to PUBLIC', `${fn()}\n${revoke}\ngrant execute on function public.ex_fn(integer) to public;`, 'grant-anon-public'],
  ['schema usage to anon', 'grant usage on schema private to anon;', 'grant-anon-public'],
  ['grant to another role', `${table}\ngrant select on table public.ex_items to authenticator;`, 'grant-anon-public'],
  ['role membership grant', 'grant authenticated to anon;', 'grant-bulk'],
  ['all tables in schema', 'grant select on all tables in schema public to authenticated;', 'grant-bulk'],
  ['schema grant to authenticated', 'grant usage on schema private to authenticated;', 'grant-bulk'],
  ['WITH GRANT OPTION', `${table}\ngrant select on table public.ex_items to authenticated with grant option;`, 'grant-option'],
  ['new grant on an existing table', 'grant delete on table public.app_notes to authenticated;', 'grant-existing'],
  ['EXECUTE on an existing function', 'grant execute on function public.app_existing(uuid) to authenticated;', 'grant-existing'],
  ['default privileges', 'alter default privileges in schema public grant all on tables to anon;', 'blocked-command'],
  // (b) RLS off
  ['disable RLS', 'alter table public.app_notes disable row level security;', 'rls-disable'],
  ['no force RLS', 'alter table public.app_notes no force row level security;', 'rls-disable'],
  ['new table without RLS (default anon ACL)', 'create table public.ex_items(id uuid primary key);', 'table-without-rls'],
  ['RLS off inside a function', `create function public.ex_fn(p integer) returns integer language plpgsql security invoker set search_path = '' as $$begin alter table public.app_notes disable row level security; return p; end$$;\n${revoke}`, 'rls-disable'],
  // (c) SECURITY DEFINER + anon/PUBLIC execute
  ['definer without revoke (default PUBLIC execute)', fn("security definer set search_path = ''"), 'function-revoke-missing'],
  ['definer revoked only from PUBLIC', `${fn("security definer set search_path = ''")}\nrevoke all on function public.ex_fn(integer) from public;`, 'function-revoke-missing'],
  ['definer granted to anon', `${fn("security definer set search_path = ''")}\n${revoke}\ngrant execute on function public.ex_fn(integer) to anon;`, 'grant-anon-public'],
  ['definer without fixed search_path', `${fn('security definer')}\n${revoke}`, 'function-definer-path'],
  ['create or replace without revoke', `create or replace function public.app_existing(p integer) returns integer language sql security invoker set search_path = '' as $$select p;$$;`, 'function-revoke-missing'],
  ['EXECUTE granted before revoke', `${fn()}\ngrant execute on function public.ex_fn(integer) to authenticated;\n${revoke}`, 'function-grant-order'],
  ['dynamic EXECUTE in body', `create function public.ex_fn(p text) returns void language plpgsql security invoker set search_path = '' as $$begin execute p; end$$;\nrevoke all on function public.ex_fn(text) from public, anon;`, 'function-body'],
  ['role switch in body', `create function public.ex_fn(p integer) returns integer language plpgsql security invoker set search_path = '' as $$begin set role postgres; return p; end$$;\n${revoke}`, 'blocked-command'],
  ['same function twice', `${fn()}\n${fn()}\n${revoke}`, 'function-duplicate'],
  // (d) drop / alter an existing policy, or add a wider one
  ['drop policy then wider policy', `drop policy app_notes_owner on public.app_notes;\ncreate policy app_notes_owner on public.app_notes for all to authenticated using (true);`, 'policy-drop-alter'],
  ['alter policy', 'alter policy app_notes_owner on public.app_notes using (true);', 'policy-drop-alter'],
  ['new permissive policy on an existing table', 'create policy extra_read on public.app_notes for select to authenticated using (private.app_is_workspace_owner(workspace_id));', 'policy-existing-table'],
  ['policy for anon', `${table}\ncreate policy ex_read on public.ex_items for select to anon using (private.app_is_workspace_owner(workspace_id));`, 'policy-roles'],
  ['policy without TO (defaults to PUBLIC)', `${table}\ncreate policy ex_read on public.ex_items for select using (private.app_is_workspace_owner(workspace_id));`, 'policy-roles'],
  ['policy using (true)', `${table}\ncreate policy ex_read on public.ex_items for select to authenticated using (true);`, 'policy-true'],
  ['policy with check (true)', `${table}\ncreate policy ex_ins on public.ex_items for insert to authenticated with check (true);`, 'policy-true'],
  // other guards kept from the strict rules
  ['trigger on a non-public table', `${fn()}\n${revoke}\ncreate trigger ex_t before insert on auth.users for each row execute function public.ex_fn();`, 'table-target'],
  ['trigger with a function not made in this file', 'create trigger ex_t before insert on public.app_notes for each row execute function private.app_existing();', 'trigger-shape'],
  ['disable trigger', 'alter table public.app_notes disable trigger all;', 'trigger-disable'],
  ['owner change', 'alter table public.app_notes owner to anon;', 'owner-change'],
  ['create view (bypasses RLS)', 'create view public.ex_view as select 1;', 'unknown-statement'],
  ['create schema', 'create schema ex_schema;', 'unknown-statement'],
  ['alter function', 'alter function public.app_existing(uuid) security definer;', 'unknown-statement'],
  ['drop function', 'drop function public.app_existing(uuid);', 'unknown-statement'],
  ['drop table', 'drop table public.app_notes;', 'blocked-command'],
  ['truncate', 'truncate public.app_notes;', 'blocked-command'],
  ['alter role', 'alter role anon bypassrls;', 'blocked-command'],
  ['create table as (data copy)', 'create table public.ex_copy as select * from public.app_notes;\nalter table public.ex_copy enable row level security;', 'create-table-as'],
  ['delete without WHERE', 'delete from public.app_notes;', 'where-missing'],
  ['RTW object', 'alter table public.rtw_notes add column x int;', 'rtw'],
  ['DO block that writes', "do $$begin insert into public.app_notes values (1); end$$;", 'do-block'],
  ['mid-file commit', 'commit;\nbegin;', 'transaction-control'],
  ['set role', 'set role postgres;', 'blocked-command'],
];

test('expanded rules: every access-widening pattern is refused with its listed reason', () => {
  const seen = new Set();
  for (const [label, body, expected] of refusals) {
    assert.equal(reason(wrap(body)), expected, label);
    assert.ok(Object.hasOwn(REJECT_REASONS, expected), expected);
    seen.add(expected);
  }
  for (const key of ['grant-anon-public', 'rls-disable', 'function-revoke-missing', 'policy-drop-alter', 'policy-existing-table']) assert.ok(seen.has(key), key);
});

test('expanded rules: narrowing changes and owner-only objects on new tables are accepted', () => {
  const accepted = [
    `${table}\nrevoke all on table public.ex_items from public, anon, authenticated, service_role;\ngrant select, delete on table public.ex_items to authenticated;\ngrant insert (workspace_id, label) on table public.ex_items to authenticated;\ncreate policy ex_owner on public.ex_items for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));`,
    'revoke insert, update, delete, truncate, references, trigger on table public.app_notes from public, anon, authenticated;',
    'create policy notes_no_delete on public.app_notes as restrictive for delete to authenticated using (false);',
    `${fn("security definer set search_path = ''")}\nrevoke all on function public.ex_fn(integer) from public, anon, service_role;\ngrant execute on function public.ex_fn(integer) to authenticated;`,
    `create function private.ex_guard() returns trigger language plpgsql security invoker set search_path = '' as $$begin return new; end$$;\nrevoke all on function private.ex_guard() from public, anon, authenticated;\ncreate trigger ex_guard before insert or update on public.app_notes for each row execute function private.ex_guard();`,
    "do $$begin if not has_table_privilege('anon', 'public.app_notes', 'select') then raise exception 'X'; end if; end$$;",
  ];
  for (const body of accepted) assert.equal(reason(wrap(body)), 'accepted', body.slice(0, 80));
  const result = validateExpanded(wrap(`${table}\nalter table public.app_notes add column x int;`), { version, name });
  assert.deepEqual(result.targets, ['app_notes']); // backup only for existing tables; the new table has no rows
  assert.deepEqual(result.createdTables, ['ex_items']);
});

test('history record must match version/name and be the last statement', () => {
  assert.equal(reason(wrap(table).replace(`'${name}'`, "'other'")), 'history');
  assert.equal(reason(`begin;\n${table}\ncommit;\n`), 'history');
  assert.equal(reason(`begin;\ninsert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name}');\n${table}\ncommit;\n`), 'history');
  assert.equal(reason(wrap("update supabase_migrations.schema_migrations set name = 'x' where version = '1';")), 'history');
});

test('snapshot must read only system catalogs (artifact may be public)', () => {
  for (const file of ['20261021053502_prj_depth_guard', '20261021075034_todo_radar_candidates', '20261021082000_ledger_schema',
    '20261021150000_ledger_import', '20261021190000_ledger_candidates', '20261021200000_web1_archive_state_readonly']) {
    checkSnapshotSQL(readFileSync(new URL(`../../docs/${file}.snapshot.sql`, import.meta.url), 'utf8'));
  }
  for (const bad of [
    "select 'rows' as kind, card_key as name, '' as definition from public.main_project_archive_state;",
    "select 'n' as kind, (select string_agg(raw_text, ',') from public.app_notes) as name;",
    "select 'n' as kind, public.app_ledger_search('x') as name;",
    "select 'n' as kind, app_ledger_search('x') as name;",
    "select 'n' as kind, most_common_vals::text as name from pg_stats;",
    "select 'n' as kind, query_to_xml('select * from public.app_notes', true, true, '')::text as name;",
    "select rolpassword from pg_authid;",
    "select query from pg_stat_activity;",
  ]) assert.throws(() => checkSnapshotSQL(bad), ExpandedRejection, bad);
});

test('expect comments: 예 / 아니오 / 기록 / number / range, nothing else', () => {
  const map = parseExpectations("-- expect: max depth = 1~3\n-- expect: recent migrations = 기록\n-- expect: rows deeper (=0) = 0\nselect 1;");
  assert.deepEqual([...map], [['max depth', '1~3'], ['recent migrations', '기록'], ['rows deeper (=0)', '0']]);
  assert.ok(meetsExpectation('2', '1~3')); assert.ok(!meetsExpectation('4', '1~3')); assert.ok(!meetsExpectation('abc', '1~3'));
  assert.ok(meetsExpectation('anything', '기록')); assert.ok(meetsExpectation('0', '0')); assert.ok(!meetsExpectation('1', '0'));
  for (const bad of ['-- expect: x = maybe', '-- expect: x = 1\n-- expect: x = 2', "-- expect: x;drop = 1"]) assert.throws(() => parseExpectations(bad), ExpandedRejection);
});

test('pair files are required for the expanded path; already-strict migrations keep their path', () => {
  const root = mkdtempSync(join(tmpdir(), 'db-expand-'));
  try {
    mkdirSync(join(root, 'supabase/migrations'), { recursive: true }); mkdirSync(join(root, 'docs'));
    const stem = '20261021200000_web1_archive_state_readonly';
    copyFileSync(new URL(`../../supabase/migrations/${stem}.sql`, import.meta.url), join(root, `supabase/migrations/${stem}.sql`));
    const files = ['summary.md', 'precheck.sql', 'snapshot.sql', 'postcheck.sql', 'rollback.sql'];
    for (const f of files) copyFileSync(new URL(`../../docs/${stem}.${f}`, import.meta.url), join(root, `docs/${stem}.${f}`));
    const plan = prepareMigration({ mode: 'apply', version: '20261021200000', runId: '1', root });
    assert.equal(plan.rules, 'expanded'); assert.equal(plan.flow, 'full');
    for (const f of ['precheck.sql', 'snapshot.sql', 'postcheck.sql', 'rollback.sql']) {
      const path = join(root, `docs/${stem}.${f}`); const body = readFileSync(path);
      rmSync(path);
      assert.throws(() => prepareMigration({ mode: 'apply', version: '20261021200000', runId: '1', root }), /DB plan rejected/, f);
      writeFileSync(path, body);
    }
    writeFileSync(join(root, `docs/${stem}.snapshot.sql`), "select 'rows' as kind, card_key as name from public.main_project_archive_state;");
    assert.throws(() => prepareMigration({ mode: 'dry-run', version: '20261021200000', runId: '1', root }), e => e.reason === 'snapshot-rows');
  } finally { rmSync(root, { recursive: true, force: true }); }
  // The strict-grammar migrations still pass the strict rules (unchanged), now with the full flow.
  const repo = new URL('../../', import.meta.url).pathname;
  for (const v of ['20261021150000', '20261021190000']) {
    const plan = prepareMigration({ mode: 'apply', version: v, runId: '1', root: repo });
    assert.equal(plan.rules, 'strict'); assert.equal(plan.flow, 'full');
  }
  for (const v of ['20261021053502', '20261021075034', '20261021082000', '20261021200000']) {
    const plan = prepareMigration({ mode: 'apply', version: v, runId: '1', root: repo });
    assert.equal(plan.rules, 'expanded'); assert.equal(plan.flow, 'full');
  }
});

test('workflow input accepts the migration file name and refuses a mismatched name', async () => {
  const { makePlan } = await import('../../scripts/ops/db-workflow.mjs');
  const repo = new URL('../../', import.meta.url).pathname;
  assert.equal(makePlan('dry-run', '5', 'refs/heads/main', '20261021200000_web1_archive_state_readonly.sql', repo).version, '20261021200000');
  assert.throws(() => makePlan('dry-run', '5', 'refs/heads/main', '20261021200000_other_name.sql', repo));
  assert.throws(() => makePlan('dry-run', '5', 'refs/heads/main', '../20261021200000_web1_archive_state_readonly.sql', repo));
});

test('check labels: a label outside the shared rule is refused at plan time, not after apply', async () => {
  const { CHECK_LABEL_RE, extractItemLabels, unsafeCheckLabels } = await import('../../scripts/ops/db-migration-plan.mjs');
  assert.ok(CHECK_LABEL_RE.test('authenticated: select, insert columns, delete, no update'));
  assert.ok(!CHECK_LABEL_RE.test('authenticated: select, insert columns, delete; no update'));
  // Parsed shapes: `as item` anywhere, first literal of a union branch; casts allowed.
  const sql = "select 'a; b' as item, 1 as ok union all select 'c'::text, 1 union all select 'ok label',1 union all select x || 'y; z', 1";
  assert.deepEqual(extractItemLabels(sql), ['a; b', 'c', 'ok label']);
  assert.deepEqual(unsafeCheckLabels(sql), ['a; b']);
  // Every committed precheck/postcheck label passes the same rule.
  const docs = new URL('../../docs/', import.meta.url);
  for (const f of readdirSync(docs).filter(n => /(pre|post)check\.sql$/.test(n))) {
    assert.deepEqual(unsafeCheckLabels(readFileSync(new URL(f, docs), 'utf8')), [], f);
  }
  const root = mkdtempSync(join(tmpdir(), 'db-label-'));
  try {
    mkdirSync(join(root, 'supabase/migrations'), { recursive: true }); mkdirSync(join(root, 'docs'));
    const stem = '20261022003000_task_attachments';
    copyFileSync(new URL(`../../supabase/migrations/${stem}.sql`, import.meta.url), join(root, `supabase/migrations/${stem}.sql`));
    for (const f of ['summary.md', 'precheck.sql', 'snapshot.sql', 'postcheck.sql', 'rollback.sql']) {
      copyFileSync(new URL(`../../docs/${stem}.${f}`, import.meta.url), join(root, `docs/${stem}.${f}`));
    }
    const run = mode => prepareMigration({ mode, version: '20261022003000', runId: '1', root });
    assert.equal(run('apply').flow, 'full');
    const post = join(root, `docs/${stem}.postcheck.sql`);
    const good = readFileSync(post, 'utf8');
    writeFileSync(post, good.replace('delete, no update', 'delete; no update'));
    for (const mode of ['dry-run', 'apply']) {
      assert.throws(() => run(mode), e => e instanceof ExpandedRejection && e.reason === 'check-label' && !/;/.test(e.message));
    }
    assert.match(REJECT_REASONS['check-label'], /항목 이름/);
    writeFileSync(post, good);
    const pre = join(root, `docs/${stem}.precheck.sql`);
    writeFileSync(pre, readFileSync(pre, 'utf8').replace(/'([^']+)' as item/, "'$1; x' as item"));
    assert.throws(() => run('apply'), e => e.reason === 'check-label');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('check SQL label/shape failure is reported as a SQL format error, not a DB request failure', async () => {
  const { queryErrorSummary, CheckFormatError } = await import('../../scripts/ops/db-query.mjs');
  const text = queryErrorSummary(new CheckFormatError());
  assert.match(text, /^확인 SQL 형식 오류\(항목 이름·열 모양\)/);
  assert.doesNotMatch(text, /DB 요청·응답 확인 실패|HTTP/);
  assert.match(queryErrorSummary(new Error('x')), /DB 요청·응답 확인 실패/);
  const { runFullPlan } = await import('../../scripts/ops/db-migration-run.mjs');
  const repo = new URL('../../', import.meta.url).pathname;
  const plan = prepareMigration({ mode: 'apply', version: '20261022003000', runId: '1', root: repo });
  // A fake DB whose precheck rows carry a ';' label: the failure text must be the format error.
  const query = async sql => sql === plan.checks.precheck.sql ? [{ item: 'bad; label', value: '1' }] : [{ count: 0 }];
  const result = await runFullPlan(plan, query);
  assert.equal(result.ok, false);
  assert.match(result.summary, /사전 확인\(precheck\): 실패\. 확인 SQL 형식 오류\(항목 이름·열 모양\)/);
  assert.doesNotMatch(result.summary, /DB 요청·응답 확인 실패|bad; label|HTTP/);
});

// S68-42: column grants on an existing table, only for columns this same file added.
const addCols = 'alter table public.app_items add column c_new uuid;\nalter table public.app_items add column c_two real;';
test('new-column grant on an existing table: accepted only for columns added in this file, authenticated only', () => {
  const ok = [
    `${addCols}\ngrant insert (c_new, c_two) on table public.app_items to authenticated;\ngrant update (c_new, c_two) on table public.app_items to authenticated;`,
    `${addCols}\ngrant select (c_new), update (c_two) on public.app_items to authenticated;`,
    'alter table public.app_items add column c_new uuid, add column c_two real;\ngrant insert (c_new, c_two) on table public.app_items to authenticated;',
  ];
  for (const body of ok) assert.equal(reason(wrap(body)), 'accepted', body);
  const result = validateExpanded(wrap(ok[0]), { version, name });
  assert.deepEqual(result.newColumnGrantTables, ['app_items']);
  assert.deepEqual(validateExpanded(wrap(`${table}\ngrant select on table public.ex_items to authenticated;`), { version, name }).newColumnGrantTables, []);
  const refused = [
    ['existing column mixed in', `${addCols}\ngrant update (c_new, label) on table public.app_items to authenticated;`, 'grant-existing'],
    ['only an existing column', `${addCols}\ngrant update (label) on table public.app_items to authenticated;`, 'grant-existing'],
    ['to anon', `${addCols}\ngrant insert (c_new) on table public.app_items to anon;`, 'grant-anon-public'],
    ['to PUBLIC', `${addCols}\ngrant insert (c_new) on table public.app_items to public;`, 'grant-anon-public'],
    ['to authenticated and anon', `${addCols}\ngrant insert (c_new) on table public.app_items to authenticated, anon;`, 'grant-anon-public'],
    ['to service_role', `${addCols}\ngrant insert (c_new) on table public.app_items to service_role;`, 'grant-existing'],
    ['to authenticated and service_role', `${addCols}\ngrant insert (c_new) on table public.app_items to authenticated, service_role;`, 'grant-existing'],
    ['table-wide grant', `${addCols}\ngrant insert on table public.app_items to authenticated;`, 'grant-existing'],
    ['table-wide mixed with column grant', `${addCols}\ngrant insert (c_new), delete on table public.app_items to authenticated;`, 'grant-existing'],
    ['all privileges on columns', `${addCols}\ngrant all (c_new) on table public.app_items to authenticated;`, 'grant-existing'],
    ['references on a new column', `${addCols}\ngrant references (c_new) on table public.app_items to authenticated;`, 'grant-existing'],
    ['with grant option', `${addCols}\ngrant insert (c_new) on table public.app_items to authenticated with grant option;`, 'grant-option'],
    ['grant before the column is added', `grant insert (c_new) on table public.app_items to authenticated;\n${addCols}`, 'grant-existing'],
    ['drop then re-add (name reuse)', `alter table public.app_items drop column c_new;\n${addCols}\ngrant insert (c_new) on table public.app_items to authenticated;`, 'grant-existing'],
    ['add, drop, re-add', `${addCols}\nalter table public.app_items drop column c_new;\nalter table public.app_items add column c_new uuid;\ngrant insert (c_new) on table public.app_items to authenticated;`, 'grant-existing'],
    ['rename an existing column onto the new name', `${addCols}\nalter table public.app_items rename column c_new to c_old;\nalter table public.app_items rename column label to c_new;\ngrant update (c_new) on table public.app_items to authenticated;`, 'grant-existing'],
    ['rename without COLUMN keyword', `${addCols}\ngrant update (c_new) on table public.app_items to authenticated;\nalter table public.app_items rename c_new to c_x;`, 'alter-table'], // already refused by the ALTER TABLE rule
    ['add column if not exists (may skip an existing column)', 'alter table public.app_items add column if not exists c_new uuid;\ngrant insert (c_new) on table public.app_items to authenticated;', 'grant-existing'],
    ['new column name borrowed from another table', `alter table public.app_other add column c_new uuid;\ngrant insert (c_new) on table public.app_items to authenticated;`, 'grant-existing'],
    ['two tables in one grant', `${addCols}\nalter table public.app_other add column c_new uuid;\ngrant insert (c_new) on table public.app_items, public.app_other to authenticated;`, 'grant-existing'],
    ['generated column copies an existing column', 'alter table public.app_items add column c_new text generated always as (label) stored;\ngrant select (c_new) on table public.app_items to authenticated;', 'grant-existing'],
    ['set expression on the new column', `${addCols}\nalter table public.app_items alter column c_two set expression as (1);\ngrant select (c_two) on table public.app_items to authenticated;`, 'grant-existing'],
    ['update copies existing values into the new column', `${addCols}\nupdate public.app_items set c_new = id where id is not null;\ngrant select (c_new) on table public.app_items to authenticated;`, 'grant-existing'],
    ['trigger on that table could fill the new column', `${addCols}\ncreate function private.ex_fill() returns trigger language plpgsql security invoker set search_path = '' as $$begin return new; end$$;\nrevoke all on function private.ex_fill() from public, anon, authenticated;\ncreate trigger ex_fill before insert or update on public.app_items for each row execute function private.ex_fill();\ngrant select (c_new) on table public.app_items to authenticated;`, 'grant-existing'],
    ['RLS turned off in the file', `${addCols}\nalter table public.app_items disable row level security;\ngrant insert (c_new) on table public.app_items to authenticated;`, 'rls-disable'],
    ['RLS force removed in the file', `${addCols}\nalter table public.app_items no force row level security;\ngrant insert (c_new) on table public.app_items to authenticated;`, 'rls-disable'],
  ];
  for (const [label, body, expected] of refused) assert.equal(reason(wrap(body)), expected, label);
});

test('new-column grant: the S68-38c migration passes plan (dry-run) and production RLS is checked before any write', async () => {
  const { makePlan } = await import('../../scripts/ops/db-workflow.mjs');
  const { rlsLookupSQL, rlsAllOn, policyLookupSQL } = await import('../../scripts/ops/db-migration-expanded.mjs');
  const { runFullPlan } = await import('../../scripts/ops/db-migration-run.mjs');
  const repo = new URL('../../', import.meta.url).pathname;
  const plan = makePlan('dry-run', '7', 'refs/heads/main', '20261123120000_note_board_texts.sql', repo);
  assert.equal(plan.rules, 'expanded'); assert.equal(plan.flow, 'full');
  assert.deepEqual(plan.newColumnGrantTables, ['app_note_board_links']);
  assert.deepEqual(plan.createdTables, ['app_note_board_texts']);
  assert.ok(rlsAllOn(['app_note_board_links'], [{ tbl: 'app_note_board_links', rls: true }]));
  for (const rows of [[], [{ tbl: 'app_note_board_links', rls: false }], [{ tbl: 'app_note_board_links', rls: 'true' }],
    [{ tbl: 'app_note_board_links', rls: true }, { tbl: 'app_note_board_links', rls: true }], null]) {
    assert.ok(!rlsAllOn(['app_note_board_links'], rows), JSON.stringify(rows));
  }
  assert.throws(() => rlsLookupSQL(["x'; drop"]));
  const lookup = rlsLookupSQL(plan.newColumnGrantTables);
  const sent = [];
  const query = async (sql, opts = {}) => {
    sent.push({ sql, readOnly: Boolean(opts.readOnly) });
    if (sql === lookup) return [{ tbl: 'app_note_board_links', rls: false }];
    if (sql === policyLookupSQL(plan.policyReplacements)) {
      return [{ tbl: 'app_note_board_links', name: 'note_board_links_owner_all', permissive: 'PERMISSIVE', cmd: 'ALL', roles: 'authenticated' }];
    }
    return [{ count: 0 }];
  };
  const result = await runFullPlan(plan, query);
  assert.equal(result.ok, false);
  assert.match(result.summary, /RLS가 켜져 있지 않거나/);
  assert.ok(sent.every(s => s.readOnly), 'no write before the RLS check passes');
  assert.ok(!sent.some(s => s.sql === plan.checks.precheck.sql));
  assert.match(result.summary, /정책 교체 비교: 1개 모두 같거나 좁음/);
  // RLS on: the run goes on to the precheck (here the fake precheck rows then stop it, still before any write).
  sent.length = 0;
  const onQuery = async (sql, opts) => (sql === lookup ? [{ tbl: 'app_note_board_links', rls: true }] : query(sql, opts));
  const second = await runFullPlan(plan, onQuery);
  assert.match(second.summary, /새 칸 권한 표 RLS 켜짐: 1개 모두 예/);
  assert.ok(sent.some(s => s.sql === plan.checks.precheck.sql));
});

// OPS-DB적용cron받기(S70-01, 2026-11-25 사용자 결정): cron 예약 등록은 좁은 조건으로만 받는다.
const cronName = 'ex_job';
const cronOf = (command, jobName = `'${cronName}'`) => `select cron.schedule(${jobName}, '43 18 * * *', $cmd$${command}$cmd$);`;
const cronTrim = "delete from cron.job_run_details where end_time < now() - interval '3 days'";

test('cron: the 20261124220000_cron_history_trim migration passes the expanded rules and plan (dry-run·apply); rollback mode stays strict', () => {
  const repo = new URL('../../', import.meta.url).pathname;
  const sql = readFileSync(join(repo, 'supabase/migrations/20261124220000_cron_history_trim.sql'), 'utf8');
  const result = validateExpanded(sql, { version: '20261124220000', name: 'cron_history_trim' });
  assert.deepEqual(result.review.cron, ['web2_cron_history_trim']);
  assert.deepEqual(result.targets, []);
  for (const mode of ['dry-run', 'apply']) {
    const plan = prepareMigration({ mode, version: '20261124220000', runId: '1', root: repo });
    assert.equal(plan.flow, 'full', mode);
  }
  assert.throws(() => prepareMigration({ mode: 'rollback', version: '20261124220000', runId: '1', root: repo }));
});

test('cron: accepted shapes — fixed name, existing function call, same-name re-register (unschedule then schedule)', () => {
  assert.equal(reason(wrap(cronOf(cronTrim))), 'accepted');
  assert.equal(reason(wrap(cronOf('select private.app_feed_tidy()'))), 'accepted');
  assert.equal(reason(wrap(`select cron.schedule('${cronName}', '43 18 * * *', 'select public.app_x(1)');`)), 'accepted');
  assert.equal(reason(wrap(`select cron.unschedule('${cronName}');\n${cronOf(cronTrim)}`)), 'accepted');
  assert.equal(reason(wrap(cronOf("delete from public.app_feed_runs where created_at < now() - interval '7 days'"))), 'accepted');
});

test('cron: forbidden commands inside the job command are refused (cron-command)', () => {
  const bad = [
    ['GRANT', 'grant select on table public.app_notes to authenticated'],
    ['REVOKE', 'revoke all on table public.app_notes from authenticated'],
    ['anon privilege', 'grant usage on schema public to anon'],
    ['anon word', 'select public.app_x(anon)'],
    ['ALTER ROLE', 'alter role authenticated bypassrls'],
    ['ALTER ROLE (plain)', 'alter role anon set statement_timeout = 0'],
    ['RLS off', 'alter table public.app_notes disable row level security'],
    ['policy widen', 'create policy p on public.app_notes for all to authenticated using (true)'],
    ['definer function', "create function public.f() returns void language sql security definer as 'select 1'"],
    ['net.http_post', "select net.http_post(url := 'https://example.com', body := '{}'::jsonb)"],
    ['net.http_get', 'select net.http_get(public.app_url())'],
    ['unqualified http_post', "select http_post('x', 'y')"],
    ['extensions.http', "select extensions.http_get('x')"],
    ['address in a string', "select public.app_x('https://example.com')"],
    ['vault', 'select vault.decrypted_secret()'],
    ['another cron job', "select cron.schedule('other', '* * * * *', 'select 1')"],
    ['cron.job delete', "delete from cron.job where jobname = 'x'"],
    ['delete without WHERE', 'delete from cron.job_run_details'],
    ['delete from auth', "delete from auth.users where id = '1'"],
    ['update', "update public.app_notes set title = 'x' where id = '1'"],
    ['insert', "insert into public.app_notes(id) values ('1')"],
    ['select into', 'select 1 into public.t'],
    ['truncate', 'truncate public.app_notes'],
    ['set role', 'set role postgres'],
    ['set_config', "select set_config('role', 'postgres', true)"],
    ['dblink', "select dblink_exec('x', 'y')"],
    ['DO block', 'do $x$ begin perform 1; end $x$'],
    ['unknown builtin call', "select pg_sleep(1)"],
    ['schema-qualified other schema', 'select storage.foo()'],
  ];
  for (const [label, command] of bad) {
    const body = command.includes('$x$') ? `select cron.schedule('${cronName}', '* * * * *', '${command.replaceAll("'", "''")}');` : cronOf(command);
    const got = reason(wrap(body));
    assert.ok(['cron-command', 'blocked-command', 'rls-disable', 'history', 'rtw'].includes(got), `${label}: ${got}`);
    assert.notEqual(got, 'accepted', label);
  }
});

test('cron: job name must be one fixed literal; other shapes are refused (cron-shape)', () => {
  const bad = [
    ['concatenated name', cronOf(cronTrim, "'ex_' || 'job'")],
    ['name from function', cronOf(cronTrim, "format('%s', 'ex_job')")],
    ['name from variable', cronOf(cronTrim, 'job_name')],
    ['name from current_setting', cronOf(cronTrim, "current_setting('app.job')")],
    ['dollar-quoted name', cronOf(cronTrim, '$n$ex_job$n$')],
    ['E-string name', cronOf(cronTrim, "E'ex_job'")],
    ['bad name characters', cronOf(cronTrim, "'Ex-Job'")],
    ['unnamed two-argument schedule', `select cron.schedule('43 18 * * *', $cmd$${cronTrim}$cmd$);`],
    ['other database', `select cron.schedule_in_database('${cronName}', '43 18 * * *', $cmd$${cronTrim}$cmd$, 'postgres');`],
    ['bad schedule text', `select cron.schedule('${cronName}', 'every day', $cmd$${cronTrim}$cmd$);`],
    ['schedule from expression', `select cron.schedule('${cronName}', '43 ' || '18 * * *', $cmd$${cronTrim}$cmd$);`],
    ['command from expression', `select cron.schedule('${cronName}', '43 18 * * *', 'select ' || 'public.app_x()');`],
    ['same name twice', `${cronOf(cronTrim)}\n${cronOf(cronTrim)}`],
    ['unschedule only (job removal)', `select cron.unschedule('${cronName}');`],
    ['unschedule other name', `select cron.unschedule('other_job');\n${cronOf(cronTrim)}`],
    ['unschedule after schedule', `${cronOf(cronTrim)}\nselect cron.unschedule('${cronName}');`],
    ['unschedule by job id', `select cron.unschedule(42);\n${cronOf(cronTrim)}`],
    ['alter_job', `select cron.alter_job(1, active := false);`],
    ['extra select', `select cron.schedule('${cronName}', '43 18 * * *', $cmd$${cronTrim}$cmd$), 1;`],
  ];
  for (const [label, body] of bad) {
    const got = reason(wrap(body));
    assert.notEqual(got, 'accepted', label);
    assert.ok(['cron-shape', 'cron-command', 'unknown-statement'].includes(got), `${label}: ${got}`);
  }
  // Plain SELECT that is not a cron call stays refused.
  assert.equal(reason(wrap('select 1;')), 'cron-shape');
  // cron calls inside a DO block stay refused (DO blocks are read-only guards).
  assert.equal(reason(wrap(`do $$ begin perform cron.schedule('${cronName}', '* * * * *', 'select 1'); end $$;`)), 'do-block');
});

test('cron: DO guard may compare with a nested $tag$ literal only after =; snapshot reads cron.job command only as md5', () => {
  assert.equal(reason(wrap(`${cronOf(cronTrim)}\ndo $$ begin if not exists (select 1 from cron.job where command = $c$x$c$) then raise exception 'x'; end if; end $$;`)), 'accepted');
  assert.equal(reason(wrap(`${cronOf(cronTrim)}\ndo $$ begin if $c$x$c$ is null then raise exception 'x'; end if; end $$;`)), 'do-block');
  checkSnapshotSQL("select jobname as name, schedule || md5(command) as definition from cron.job");
  checkSnapshotSQL("select j.jobname as name, md5(j.command) as definition from cron.job j");
  for (const sql of ['select jobname, command from cron.job', 'select md5(command) || command from cron.job',
    'select jobid::text from cron.job_run_details', 'select return_message from cron.job_run_details']) {
    assert.throws(() => checkSnapshotSQL(sql), ExpandedRejection, sql);
  }
});

test('cron: approved apply flow for 20261124220000 runs to the end with production-shaped answers (no DB)', async () => {
  const { makePlan } = await import('../../scripts/ops/db-workflow.mjs');
  const { runFullPlan } = await import('../../scripts/ops/db-migration-run.mjs');
  const repo = new URL('../../', import.meta.url).pathname;
  const plan = makePlan('apply', '7', 'refs/heads/main', '20261124220000_cron_history_trim.sql', repo);
  assert.equal(plan.rules, 'expanded'); assert.equal(plan.flow, 'full');
  let applied = false;
  const writes = [];
  const pre = [['pg_cron ready', '예'], ['cron timezone UTC', '예'], ['trim job absent', '예'], ['new migration absent', '예'],
    ['cron jobs', '4'], ['other cron jobs hash', 'a'.repeat(32)], ['retention daily job present', '아니오']];
  const post = [['trim job 1', '예'], ['trim job schedule 18:43 UTC active', '예'], ['trim job command', '예'], ['migration recorded', '예'],
    ['other cron jobs hash', 'a'.repeat(32)], ['trim ran ok (next day)', '아니오(첫 실행 전이면 정상)'], ['finished rows older than 3 days', '1200']];
  const query = async (sql, opts = {}) => {
    if (sql.startsWith('select count(*)::int as count from supabase_migrations')) return [{ count: applied ? 1 : 0 }];
    if (sql === plan.checks.precheck.sql) return pre.map(([item, value]) => ({ item, value }));
    if (sql === plan.checks.postcheck.sql) return post.map(([item, value]) => ({ item, value }));
    if (sql === plan.snapshot.sql) return [{ kind: 'cron job', name: 'web2_feed_tick', definition: '* * * * *:active=true' }];
    assert.ok(!opts.readOnly, 'unexpected read');
    writes.push(sql);
    if (sql === plan.file.sql) applied = true;
    return [];
  };
  const result = await runFullPlan(plan, query, { saveSnapshot: async () => {} });
  assert.equal(result.ok, true, result.summary);
  assert.equal(writes.length, 2, 'dry-run then apply, no backup (no public table target)');
  assert.match(writes[0], /rollback;\s*$/);
  assert.equal(writes[1], plan.file.sql);
  // A changed set of other jobs is a failed postcheck (not auto-reverted).
  applied = false; writes.length = 0;
  post[4] = ['other cron jobs hash', 'b'.repeat(32)];
  const changed = await runFullPlan(plan, query, { saveSnapshot: async () => {} });
  assert.equal(changed.ok, false);
  assert.match(changed.summary, /사후 확인 실패/);
});

// S70-01b: 운영 dry-run(20261124220000)이 '시험 적용'에서 '쓰기 요청이 결과 행을 돌려줌'으로 멈췄다.
// `select cron.schedule(...)`이 작업 번호 행 하나를 돌려주기 때문. cron 문장으로 판정된 파일의 migration 본문 쓰기에서만
// 그 단일 값 행을 받고, 다른 쓰기 요청의 결과 행(update … returning, insert … returning 등)은 그대로 실패한다.
const cronFlow = async ({ planFile = '20261124220000_cron_history_trim.sql', writeRows }) => {
  const { makePlan } = await import('../../scripts/ops/db-workflow.mjs');
  const { runFullPlan } = await import('../../scripts/ops/db-migration-run.mjs');
  const repo = new URL('../../', import.meta.url).pathname;
  const plan = makePlan('dry-run', '8', 'refs/heads/main', planFile, repo);
  const pre = [['pg_cron ready', '예'], ['cron timezone UTC', '예'], ['trim job absent', '예'], ['new migration absent', '예'],
    ['cron jobs', '4'], ['other cron jobs hash', 'a'.repeat(32)], ['retention daily job present', '아니오']];
  const query = async (sql, opts = {}) => {
    if (sql.startsWith('select count(*)::int as count from supabase_migrations')) return [{ count: 0 }];
    if (sql === plan.checks.precheck.sql) return pre.map(([item, value]) => ({ item, value }));
    if (plan.checks.dryRunPostcheck && sql === plan.checks.dryRunPostcheck.sql) return [{ item: 'x', value: '예' }];
    if (sql === plan.snapshot.sql) return [{ kind: 'cron job', name: 'web2_feed_tick', definition: '* * * * *:active=true' }];
    assert.ok(!opts.readOnly, 'unexpected read');
    return writeRows(sql, plan);
  };
  return { plan, result: await runFullPlan(plan, query, { saveSnapshot: async () => {} }) };
};

test('cron result row: the job id row from cron.schedule passes the dry-run write check (number or digit string)', async () => {
  for (const id of [12, '12']) {
    const { result } = await cronFlow({ writeRows: () => [{ schedule: id }] });
    assert.equal(result.ok, true, `${id}: ${result.summary}`);
    assert.doesNotMatch(result.summary, /쓰기 요청이 결과 행을 돌려줌/);
  }
});

test('cron result row: any other row shape from a cron file write still fails (no widening)', async () => {
  const bad = [
    [{ schedule: 12 }, { schedule: 13 }], // more schedule rows than schedule calls
    [{ unschedule: true }], // no unschedule in the file
    [{ schedule: 12, command: 'x' }], // extra column
    [{ jobid: 12 }], // other column name
    [{ schedule: 0 }], [{ schedule: -1 }], [{ schedule: '12; drop' }], [{ schedule: null }], [{ schedule: true }],
    [{ id: 1, workspace_id: 'w' }], // update … returning / insert … returning shaped rows
    [{ schedule: 12 }, { id: 1 }],
  ];
  for (const rows of bad) {
    const { result } = await cronFlow({ writeRows: () => rows });
    assert.equal(result.ok, false, JSON.stringify(rows));
    assert.match(result.summary, /쓰기 요청이 결과 행을 돌려줌/, JSON.stringify(rows));
  }
});

test('cron result row: unit — only expanded cron plans, only fixed single-value rows within the call count', async () => {
  const { cronResultRows } = await import('../../scripts/ops/db-migration-run.mjs');
  const cronPlan = { expanded: true, review: { cron: ['a'] } };
  const reRegister = { expanded: true, review: { cron: ['a'], cronUnscheduled: ['a'] } };
  assert.equal(cronResultRows(cronPlan, [{ schedule: 1 }]), true);
  assert.equal(cronResultRows(reRegister, [{ unschedule: true }, { schedule: '7' }]), true);
  assert.equal(cronResultRows(reRegister, [{ unschedule: false }]), false);
  assert.equal(cronResultRows(cronPlan, [{ unschedule: true }]), false);
  // Plans that are not cron files (strict, or expanded without cron) never accept rows: update/insert … returning stays refused.
  for (const plan of [{ rules: 'strict', review: { cron: ['a'] } }, { expanded: true, review: {} }, { expanded: true }, null]) {
    assert.equal(cronResultRows(plan, [{ schedule: 1 }]), false, JSON.stringify(plan));
    assert.equal(cronResultRows(plan, [{ id: 1 }]), false, JSON.stringify(plan));
  }
  // The re-register migration form records the unschedule name for the run step.
  const re = validateExpanded(wrap(`select cron.unschedule('${cronName}');\n${cronOf(cronTrim)}`), { version, name });
  assert.deepEqual(re.review.cron, [cronName]); assert.deepEqual(re.review.cronUnscheduled, [cronName]);
  assert.equal(validateExpanded(wrap(cronOf(cronTrim)), { version, name }).review.cronUnscheduled, undefined);
});

test('write result row: the same flow without the cron judgment refuses every result row, even the schedule shape', async () => {
  // 같은 흐름에서 plan을 cron 아닌 파일로 바꿔 보면(review.cron 없음) cron.schedule 모양 행도, returning 모양 행도 실패한다.
  const { makePlan } = await import('../../scripts/ops/db-workflow.mjs');
  const repo = new URL('../../', import.meta.url).pathname;
  const original = makePlan('dry-run', '8', 'refs/heads/main', '20261124220000_cron_history_trim.sql', repo);
  assert.deepEqual(original.review.cron, ['web2_cron_history_trim']);
  for (const rows of [[{ schedule: 12 }], [{ id: 1 }], [{ count: 3 }]]) {
    const { result } = await cronFlow({ writeRows: (sql, plan) => { delete plan.review.cron; return rows; } });
    assert.equal(result.ok, false, JSON.stringify(rows));
    assert.match(result.summary, /쓰기 요청이 결과 행을 돌려줌/, JSON.stringify(rows));
  }
});
