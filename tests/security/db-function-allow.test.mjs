import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSQL, prepareMigration } from '../../scripts/ops/db-migration-plan.mjs';
import { buildBackup, runMigrationPlan } from '../../scripts/ops/db-migration-run.mjs';
import { version, name, signature, wrap, definition, revoke, grant, migration, rollback } from './helpers/db-function-fixture.mjs';

const options = mode => ({ mode, version, name, migrationSQL: migration });
const accepted = commands => { for (const mode of ['apply', 'dry-run']) assert.doesNotThrow(() => validateSQL(wrap(commands), options(mode))); };
const rejected = commands => { for (const mode of ['apply', 'dry-run']) assert.throws(() => validateSQL(wrap(commands), options(mode)), commands); };

// Removing any of the schema/language/path/signature/order checks must break
// these assertions on the actual validator, not on an imitation parser.
test('allows explicit INVOKER sql/plpgsql, both schemas, fixed paths and dollar delimiters', () => {
  for (const schema of ['public', 'private']) for (const language of ['sql', 'plpgsql'])
    for (const searchPath of ["''", 'public, pg_temp']) for (const tag of ['$$', '$body_1$']) {
      const sig = `${schema}.ops_example(integer)`;
      const body = language === 'sql' ? 'select p_value + 1;' : 'begin return p_value + 1; end;';
      accepted(`${definition({ schema, language, searchPath, tag, body })}\n${revoke(sig)}\n${grant(sig)}`);
    }
  accepted(`${definition().replace('create or replace', 'CREATE')}\n${revoke(signature, 'execute', 'anon, public')}\n${grant()}`);
  accepted(`${definition({ args: '' , body: 'select 1;' })}\n${revoke('public.ops_example()')}\n${grant('public.ops_example()')}`);
});

test('rejects DEFINER/omitted security, missing/unlisted/overridden path, schema, RTW, language and body parse failures', () => {
  const bad = [
    definition({ security: 'security definer' }), definition({ security: '' }),
    definition().replace('security invoker', 'security invoker security definer'),
    definition().replace("set search_path = ''", ''),
    ...['public', 'pg_temp, public', 'private, pg_temp', "'public, pg_temp'", 'default', '$$ $$'].map(searchPath => definition({ searchPath })),
    definition().replace("set search_path = ''", "set search_path = '' set search_path = public, pg_temp"),
    definition({ schema: 'other' }), definition({ functionName: 'rtw_example' }), definition({ language: 'plpython3u' }),
    definition().replace('$body$;', '$wrong$;'), definition().replace('as $body$select p_value + 1;$body$', "as 'select 1;'"),
    definition().replace('security invoker', "/* SECURITY INVOKER */"),
    definition().replace("set search_path = ''", "/* SET search_path = '' */"),
    definition({ args: 'p_value integer default public.side_effect()' }),
    definition().replace('public.ops_example', 'public."Ops_Example"'),
    definition().replace('returns integer', 'returns integer support public.side_effect'),
  ];
  for (const sql of bad) rejected(`${sql}\n${revoke()}\n${grant()}`);
});

test('applies existing risk rules inside function bodies including nested DML and dynamic EXECUTE', () => {
  const bodies = [
    'drop /* gap */ table public.app_notes;', 'drop schema public;', 'truncate public.app_notes;',
    'begin delete from public.app_notes; return 1; end;',
    'begin update public.app_notes set x=(select 1 where true); return 1; end;',
    'begin update public.app_notes set x=1; delete from public.app_notes where true; return 1; end;',
    'with gone as (delete from public.app_notes returning *) select 1 where true;',
    'with changed as (update public.app_notes set x=1 returning *) select 1 where true;',
    'declare r record; n integer; begin for r in delete from public.app_notes returning * loop select 1 into n where true; end loop; return 1; end;',
    'declare r record; begin for r in update public.app_notes set x=1 returning * loop delete from public.other_notes where true; end loop; return 1; end;',
    'alter role authenticated superuser;', 'create extension dblink;', 'alter extension plpgsql update;', 'drop extension plpgsql;',
    "begin execute 'drop table public.app_notes'; return 1; end;", 'begin execute p_value; return 1; end;',
    "select dblink('x','select 1');", "select pg_read_file('x');", "select set_config('search_path','other',false);",
    'select nextval(\'seq\');', "copy public.app_notes to program 'bad';", 'call public.side_effect();',
    'alter table public.app_notes disable row level security;', 'select * from public.rtw_notes;',
    'begin commit; return 1; end;', 'grant select on public.app_notes to authenticated;',
    "begin if true then execute $nested$select 1$nested$; end if; return 1; end;",
    "select 'unterminated;", 'delete from supabase_migrations.schema_migrations where true;',
  ];
  for (const body of bodies) rejected(`${definition({ language: 'plpgsql', body })}\n${revoke()}\n${grant()}`);
  accepted(`${definition({ language: 'plpgsql', body: 'begin update public.app_notes set x=1 where id=p_value; delete from public.app_notes where id=p_value; return 1; end;' })}\n${revoke()}\n${grant()}`);
  accepted(`${definition({ language: 'plpgsql', body: 'begin update public.app_notes set x=case when p_value=1 then 2 else 3 end where id=p_value; return 1; end;' })}\n${revoke()}\n${grant()}`);
  accepted(`${definition({ body: "-- drop table public.rtw_notes;\nselect p_value + 1;" })}\n${revoke()}\n${grant()}`);
});

test('grants only created exact overloads to authenticated after both PUBLIC/anon revocations', () => {
  accepted(`${definition()}\n${revoke(signature, 'all', 'public')}\n${revoke(signature, 'execute', 'anon')}\n${grant()}`);
  const prefix = `${definition()}\n${revoke()}`;
  for (const role of ['anon', 'public', 'service_role', 'authenticated, anon', '"Authenticated"']) rejected(`${prefix}\n${grant(signature, role)}`);
  for (const bad of [
    `${definition()}\n${grant()}`, `${grant()}\n${definition()}\n${revoke()}`,
    `${definition()}\n${revoke(signature, 'all', 'public')}\n${grant()}`,
    `${definition()}\n${grant()}\n${revoke()}`, `${prefix}\n${grant('public.other(integer)')}`,
    `${prefix}\n${grant('public.ops_example(text)')}`, `${prefix}\n${grant().replace(';', ' with grant option;')}`,
    `${prefix}\ngrant all on function ${signature} to authenticated;`,
    `${prefix}\ngrant execute on all functions in schema public to authenticated;`,
    `${prefix}\nrevoke all on all functions in schema public from public, anon;`,
    `${prefix}\n${grant()}\nalter function ${signature} security definer;`,
    `${prefix}\ncomment on function ${signature} is 'description';`,
  ]) rejected(bad);
});

test('every created function revokes default PUBLIC and anon execution, even without an explicit grant', () => {
  accepted(`${definition()}\n${revoke()}`);
  rejected(definition());
  rejected(`${definition()}\n${revoke(signature, 'execute', 'anon')}`);
  rejected(`${definition()}\n${revoke(signature, 'all', 'public')}`);
});

test('optionally revokes hosted service_role execution only on the exact function defined in this file', () => {
  for (const privilege of ['all', 'all privileges', 'execute']) {
    accepted(`${definition()}\n${revoke(signature, privilege, 'public, anon, service_role')}\n${grant()}`);
    accepted(`${definition()}\n${revoke()}\n${revoke(signature, privilege, 'service_role')}\n${grant()}`);
  }
  accepted(`${definition()}\n${revoke(signature, 'execute', 'service_role, anon, public')}`);
  // Existing two-role migrations do not gain a new mandatory requirement.
  accepted(`${definition()}\n${revoke()}\n${grant()}`);
  const migrationSQL = wrap(`${definition()}\n${revoke(signature, 'all', 'public, anon, service_role')}\n${grant()}`);
  assert.doesNotThrow(() => validateSQL(rollback, { ...options('rollback'), migrationSQL }));
});

test('service_role revocation preserves required roles, exact signature, definition order and grant boundaries', () => {
  const complete = `${definition()}\n${revoke(signature, 'all', 'public, anon, service_role')}`;
  for (const bad of [
    `${definition()}\n${revoke(signature, 'all', 'service_role')}\n${grant()}`,
    `${definition()}\n${revoke(signature, 'all', 'public, service_role')}\n${grant()}`,
    `${definition()}\n${revoke(signature, 'all', 'anon, service_role')}\n${grant()}`,
    // The final definition check must still apply without an explicit GRANT.
    ...['service_role', 'public, service_role', 'anon, service_role']
      .map(roles => `${definition()}\n${revoke(signature, 'all', roles)}`),
    `${revoke(signature, 'all', 'service_role')}\n${definition()}\n${revoke()}\n${grant()}`,
    `${definition()}\n${grant()}\n${revoke(signature, 'all', 'public, anon, service_role')}`,
    `${complete}\n${revoke('public.other(integer)', 'all', 'service_role')}`,
    `${complete}\n${revoke('public.ops_example(text)', 'all', 'service_role')}`,
    `${complete}\nrevoke execute on all functions in schema public from service_role;`,
    `${complete}\nrevoke execute on function ${signature}, public.other(integer) from service_role;`,
    ...['authenticated', 'postgres', 'visitor', 'public, anon, service_role, service_role', 'service_role, other']
      .map(role => `${definition()}\n${revoke(signature, 'all', role)}\n${grant()}`),
    ...['service_role', 'anon', 'public', 'authenticated, service_role']
      .map(role => `${complete}\n${grant(signature, role)}`),
    `${complete}\n${grant().replace(';', ' with grant option;')}`,
  ]) rejected(bad);
  const migrationSQL = wrap(`${complete}\n${grant()}`);
  for (const command of [revoke(signature, 'all', 'service_role'), `drop function public.ops_example(text);`,
    `drop function public.other(integer);`, `drop function ${signature} cascade;`]) {
    assert.throws(() => validateSQL(wrap(command, true), { ...options('rollback'), migrationSQL }));
  }
});

test('rejects truncating identifiers and unnamed output/variadic arguments with ambiguous signatures', () => {
  const longName = 'ops_' + 'x'.repeat(60);
  const sig = `public.${longName}(integer)`;
  rejected(`${definition({ functionName: longName })}\n${revoke(sig)}\n${grant(sig)}`);
  for (const args of ['out integer', 'inout integer', 'variadic integer[]']) {
    const sig = args.startsWith('variadic') ? 'public.ops_example(integer[])' : signature;
    rejected(`${definition({ args })}\n${revoke(sig)}\n${grant(sig)}`);
  }
});

test('supports SQL final statements without a semicolon and canonical built-in signatures', () => {
  accepted(`${definition({ body: 'select p_value + 1' })}\n${revoke()}\n${grant()}`);
  for (const [args, sig] of [
    ['IN p_value int4', 'public.ops_example(integer)'], ['p_value text[]', 'public.ops_example(text[])'],
    ['timestamp with time zone', 'public.ops_example(timestamptz)'],
    ['p_value double precision, p_other uuid', 'public.ops_example(double precision,uuid)'],
  ]) accepted(`${definition({ args, body: 'select 1;' })}\n${revoke(sig)}\n${grant(sig)}`);
});

test('rollback drops only exact signatures from a freshly validated paired migration, never CASCADE', () => {
  assert.doesNotThrow(() => validateSQL(rollback, options('rollback')));
  assert.doesNotThrow(() => validateSQL(rollback.replace('if exists ', ''), options('rollback')));
  for (const bad of [rollback.replace('integer', 'text'), rollback.replace('ops_example', 'other'),
    rollback.replace('public.', 'private.'), rollback.replace('integer);', 'integer) cascade;'),
    rollback.replace('drop function', 'alter function'), wrap(`drop function ${signature};`)]) {
    assert.throws(() => validateSQL(bad, options(bad.includes('insert into') ? 'apply' : 'rollback')));
  }
  assert.throws(() => validateSQL(rollback, { mode: 'rollback', version, name }));
  assert.throws(() => validateSQL(rollback, { ...options('rollback'), migrationSQL: migration.replace('security invoker', 'security definer') }));
});

test('prepareMigration checks the real file pair and function-only runner reports no public backup tables', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ops-function-plan-'));
  try {
    mkdirSync(join(root, 'supabase/migrations'), { recursive: true }); mkdirSync(join(root, 'docs'));
    const path = join(root, `supabase/migrations/${version}_${name}.sql`);
    writeFileSync(path, migration);
    writeFileSync(join(root, `docs/${version}_${name}.rollback.sql`), rollback);
    writeFileSync(join(root, `docs/${version}_${name}.summary.md`), '무엇이 바뀌나: 시험 함수입니다.\n잘못되면: 호출 실패입니다.\n되돌리는 법: 짝 함수를 삭제합니다.\n');
    for (const mode of ['apply', 'dry-run', 'rollback']) {
      const plan = prepareMigration({ mode, version, runId: '123', root });
      assert.deepEqual(plan.targets, []);
      assert.deepEqual(buildBackup(plan).tables, []);
      const calls = [];
      const query = async sql => {
        calls.push(sql);
        return sql.startsWith('select count') ? [{ count: calls.length === 1 ? (mode === 'rollback' ? 1 : 0) : (mode === 'apply' ? 1 : 0) }] : [];
      };
      const result = await runMigrationPlan(plan, query);
      assert.equal(result.ok, true);
      if (mode !== 'dry-run') assert.match(result.summary, /대상 public 표 없음/);
      assert.equal(calls.length, mode === 'dry-run' ? 3 : 4);
    }
    writeFileSync(path, migration.replace('ops_example', 'other'));
    assert.throws(() => prepareMigration({ mode: 'rollback', version, runId: '123', root }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BASKET-1 and BASKET-2 migration/rollback continue to pass unchanged', () => {
  for (const [v, n] of [['20261010120000', 'basket1_notes_links'], ['20261010180000', 'basket2_drive_folder']]) {
    const migrationSQL = readFileSync(new URL(`../../supabase/migrations/${v}_${n}.sql`, import.meta.url), 'utf8');
    for (const mode of ['apply', 'dry-run', 'rollback']) {
      const sql = mode === 'rollback' ? readFileSync(new URL(`../../docs/${v}_${n}.rollback.sql`, import.meta.url), 'utf8') : migrationSQL;
      assert.doesNotThrow(() => validateSQL(sql, { mode, version: v, name: n, migrationSQL }));
    }
  }
});

test('SELECT FOR UPDATE row locks are allowed while following unbounded DML stays rejected',()=>{
 const lock='begin perform n.id from public.app_notes n where n.id=p_value for update; return 1; end;';
 accepted(`${definition({language:'plpgsql',body:lock})}\n${revoke()}\n${grant()}`);
 for(const mutation of ['update public.app_notes set x=1;', 'delete from public.app_notes;']){
   const body=lock.replace('return 1;',mutation+' return 1;');
   rejected(`${definition({language:'plpgsql',body})}\n${revoke()}\n${grant()}`);
 }
});
