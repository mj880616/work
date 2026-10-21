// DB-승인형확장: expanded static rules for the approved DB workflow. Policies, table grants, triggers and functions are
// accepted only when they cannot widen access; every refusal below has a fixed reason code. No database, no production.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, copyFileSync } from 'node:fs';
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
