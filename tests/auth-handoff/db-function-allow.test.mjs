// Fresh loopback PostgreSQL 17.6 cluster; synthetic objects only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { validateSQL } from '../../scripts/ops/db-migration-plan.mjs';
import { runMigrationPlan } from '../../scripts/ops/db-migration-run.mjs';
import { version, name, wrap, definition, revoke, grant } from '../security/helpers/db-function-fixture.mjs';

for (const key of Object.keys(process.env)) if (key.startsWith('PG')) delete process.env[key];

test('function workflow: local PostgreSQL dry-run, authenticated-only execution and paired rollback', { timeout: 90000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ops-function-isolated-pg-'));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'ops-function-isolated-pg-'));
  const socket = createServer();
  await new Promise(done => socket.listen(0, '127.0.0.1', done));
  const port = socket.address().port;
  await new Promise(done => socket.close(done));
  const password = randomBytes(24).toString('hex');
  const cluster = new EmbeddedPostgres({ databaseDir: directory, user: 'postgres', password, port,
    persistent: false, createPostgresUser: false, initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-h', '127.0.0.1', '-c', 'log_statement=none', '-c', 'log_min_error_statement=panic'],
    onLog: () => {}, onError: () => {} });
  let client;
  try {
    await cluster.initialise(); await cluster.start();
    client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres', ssl: false });
    await client.connect();
    await client.query(`create role anon nologin; create role authenticated nologin; create role visitor nologin;
      create schema private;
      grant usage on schema public, private to anon, authenticated, visitor;
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations(version text primary key, name text, statements text[]);
      -- Reproduce both PostgreSQL PUBLIC and explicit anon default execution.
      alter default privileges grant execute on functions to anon;`);
    const query = async (sql, { readOnly = false } = {}) => {
      try {
        if (readOnly) await client.query('begin read only');
        const result = await client.query(sql);
        if (readOnly) await client.query('commit');
        return Array.isArray(result) ? result.at(-1).rows : result.rows;
      } catch (error) { await client.query('rollback'); throw error; }
    };
    let runId = 300;
    for (const schema of ['public', 'private']) for (const language of ['sql', 'plpgsql'])
      for (const searchPath of ["''", 'public, pg_temp']) {
        await t.test(`${schema} ${language} search_path=${searchPath}`, async () => {
          const signature = `${schema}.ops_example(integer)`;
          const body = language === 'sql' ? 'select p_value + 1' : 'begin return p_value + 1; end;';
          const migrationSQL = wrap(`${definition({ schema, language, searchPath, body })}\n${revoke(signature)}\n${grant(signature)}`);
          const rollbackSQL = wrap(`drop function if exists ${signature};`, true);
          const plan = mode => {
            const sql = mode === 'rollback' ? rollbackSQL : migrationSQL;
            const precheck = { sql: `select 'exact signature count' as item, count(*)::text as value from pg_proc where oid=to_regprocedure('${signature}');` };
            return { mode, version, name, runId: String(++runId), file: { sql }, checks: mode === 'dry-run' ? { precheck } : {},
              ...validateSQL(sql, { mode, version, name, migrationSQL }) };
          };
          const lookup = async () => (await client.query('select to_regprocedure($1)::text as fn', [signature])).rows[0].fn;
          const dry = await runMigrationPlan(plan('dry-run'), query);
          assert.equal(dry.ok, true, dry.summary);
          assert.equal(dry.verification, 'complete');
          assert.equal(await lookup(), null);
          const applied = await runMigrationPlan(plan('apply'), query);
          assert.equal(applied.ok, true, applied.summary);
          assert.match(applied.summary, /대상 public 표 없음/);
          const metadata = (await client.query('select prosecdef, proconfig from pg_proc where oid=$1::regprocedure', [signature])).rows[0];
          assert.equal(metadata.prosecdef, false);
          assert.deepEqual(metadata.proconfig, [searchPath === "''" ? 'search_path=""' : 'search_path=public, pg_temp']);
          for (const role of ['anon', 'visitor', 'authenticated']) {
            await client.query(`set role ${role}`);
            try {
              const invocation = `select ${schema}.ops_example(41) as answer`;
              if (role === 'authenticated') assert.equal((await client.query(invocation)).rows[0].answer, 42);
              else await assert.rejects(client.query(invocation), { code: '42501' });
            } finally { await client.query('reset role'); }
          }
          // Exact overload rollback must leave a different signature intact.
          await client.query(`create function ${schema}.ops_example(text) returns text language sql as $$select $1;$$;`);
          const undone = await runMigrationPlan(plan('rollback'), query);
          assert.equal(undone.ok, true, undone.summary);
          assert.match(undone.summary, /대상 public 표 없음/);
          assert.equal(await lookup(), null);
          assert.equal((await client.query(`select ${schema}.ops_example('kept'::text) as answer`)).rows[0].answer, 'kept');
          await client.query(`drop function ${schema}.ops_example(text);`);
          assert.equal((await client.query('select count(*)::int as n from supabase_migrations.schema_migrations')).rows[0].n, 0);
        });
      }
  } finally {
    if (client) await client.end();
    await cluster.stop();
  }
});

test('hosted service_role default EXECUTE is revoked on the new RPC while existing uploads remain unchanged', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ops-default-acl-isolated-pg-'));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'ops-default-acl-isolated-pg-'));
  const socket = createServer();
  await new Promise(done => socket.listen(0, '127.0.0.1', done));
  const port = socket.address().port;
  await new Promise(done => socket.close(done));
  const password = randomBytes(24).toString('hex');
  const cluster = new EmbeddedPostgres({ databaseDir: directory, user: 'postgres', password, port,
    persistent: false, createPostgresUser: false, initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-h', '127.0.0.1', '-c', 'log_statement=none', '-c', 'log_min_error_statement=panic'],
    onLog: () => {}, onError: () => {} });
  let client;
  try {
    await cluster.initialise(); await cluster.start();
    client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres', ssl: false });
    await client.connect();
    // Synthetic baseline only: no product migration, policy or live upload is changed.
    await client.query(`create role anon nologin; create role authenticated nologin;
      create role service_role nologin bypassrls; create role visitor nologin;
      grant usage on schema public to anon, authenticated, service_role, visitor;
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations(version text primary key, name text, statements text[]);
      create table public.app_notes(id integer primary key, attachments jsonb not null);
      insert into public.app_notes values(1,'[{"file_id":"synthetic-original"}]'::jsonb);
      alter table public.app_notes enable row level security;
      revoke all on public.app_notes from public, anon, authenticated;
      grant insert, select on public.app_notes to service_role;
      create function public.ops_existing_upload(p_note integer, p_attachment jsonb) returns integer
        language sql security invoker set search_path='' as $$
          insert into public.app_notes(id,attachments) values(p_note,p_attachment) returning id;
        $$;
      revoke all on function public.ops_existing_upload(integer,jsonb) from public, anon, authenticated;
      grant execute on function public.ops_existing_upload(integer,jsonb) to service_role;
      alter default privileges for role postgres in schema public
        grant execute on functions to anon, authenticated, service_role;`);
    const asRole = async (role, sql, values = []) => {
      assert.ok(['anon', 'authenticated', 'service_role', 'visitor'].includes(role));
      await client.query(`set role ${role}`);
      try { return await client.query(sql, values); } finally { await client.query('reset role'); }
    };
    const snapshot = async () => ({
      defaults: (await client.query(`select defaclrole::regrole::text as owner, defaclnamespace::regnamespace::text as schema,
        defaclobjtype, defaclacl::text from pg_default_acl order by defaclrole,defaclnamespace,defaclobjtype`)).rows,
      table: (await client.query("select relacl::text,relrowsecurity from pg_class where oid='public.app_notes'::regclass")).rows,
      upload: (await client.query("select proacl::text,prosrc,prosecdef,proconfig from pg_proc where oid='public.ops_existing_upload(integer,jsonb)'::regprocedure")).rows,
      original: (await client.query('select attachments from public.app_notes where id=1')).rows,
    });
    const before = await snapshot();
    await client.query(definition({ functionName: 'ops_default_probe' }));
    for (const role of ['visitor', 'anon', 'authenticated', 'service_role']) {
      assert.equal((await client.query("select has_function_privilege($1,'public.ops_default_probe(integer)','EXECUTE') as allowed", [role])).rows[0].allowed, true);
      assert.equal((await asRole(role, 'select public.ops_default_probe(41) as answer')).rows[0].answer, 42);
    }
    await client.query('drop function public.ops_default_probe(integer);');
    assert.deepEqual(await snapshot(), before);
    const signature = 'public.ops_example(integer)';
    const migrationSQL = wrap(`${definition()}\n${revoke(signature, 'all', 'public, anon, service_role')}\n${grant(signature)}`);
    const rollbackSQL = wrap(`drop function if exists ${signature};`, true);
    let runId = 900, uploadId = 10;
    const plan = mode => {
      const sql = mode === 'rollback' ? rollbackSQL : migrationSQL;
      const precheck = { sql: `select 'exact signature count' as item, count(*)::text as value from pg_proc where oid=to_regprocedure('${signature}');` };
      return { mode, version, name, runId: String(++runId), file: { sql }, checks: mode === 'dry-run' ? { precheck } : {},
        ...validateSQL(sql, { mode, version, name, migrationSQL }) };
    };
    const query = async (sql, { readOnly = false } = {}) => {
      try {
        if (readOnly) await client.query('begin read only');
        const result = await client.query(sql);
        if (readOnly) await client.query('commit');
        return Array.isArray(result) ? result.at(-1).rows : result.rows;
      } catch (error) { await client.query('rollback'); throw error; }
    };
    const lookup = async () => (await client.query('select to_regprocedure($1)::text as fn', [signature])).rows[0].fn;
    const upload = async () => {
      assert.deepEqual(await snapshot(), before);
      const id = ++uploadId, attachments = [{ file_id: 'synthetic-photo', kind: 'image' }];
      assert.equal((await asRole('service_role', 'select public.ops_existing_upload($1,$2::jsonb) as id', [id, JSON.stringify(attachments)])).rows[0].id, id);
      assert.deepEqual((await asRole('service_role', 'select attachments from public.app_notes where id=$1', [id])).rows[0].attachments, attachments);
      for (const role of ['anon', 'authenticated', 'visitor']) {
        await assert.rejects(asRole(role, 'select public.ops_existing_upload($1,$2::jsonb)', [id + 1000, '[]']), { code: '42501' });
      }
    };
    await upload();
    // Before the allowlist change this fails on the actual guard, after the
    // fixture has proved the hosted service_role default execution path.
    const dry = await runMigrationPlan(plan('dry-run'), query);
    assert.equal(dry.ok, true, dry.summary);
    assert.equal(dry.verification, 'complete');
    assert.equal(await lookup(), null);
    assert.equal((await client.query('select count(*)::int as n from supabase_migrations.schema_migrations')).rows[0].n, 0);
    assert.equal((await client.query("select count(*)::int as n from pg_tables where schemaname='ops_backup'")).rows[0].n, 0);
    await upload();
    const applied = await runMigrationPlan(plan('apply'), query);
    assert.equal(applied.ok, true, applied.summary);
    const metadata = (await client.query('select prosecdef,proconfig from pg_proc where oid=$1::regprocedure', [signature])).rows[0];
    assert.equal(metadata.prosecdef, false);
    assert.deepEqual(metadata.proconfig, ['search_path=""']);
    // PostgreSQL owner privileges are retained; authenticated-only describes
    // the client entry roles, not an attempt to deny the database owner.
    const grants = (await client.query(`select a.grantee::regrole::text as role from pg_proc p,
      lateral aclexplode(p.proacl) a where p.oid=$1::regprocedure and a.privilege_type='EXECUTE' order by role`, [signature])).rows.map(row => row.role);
    assert.deepEqual(grants, ['authenticated', 'postgres']);
    for (const role of ['anon', 'visitor', 'service_role', 'authenticated']) {
      assert.equal((await client.query('select has_function_privilege($1,$2,\'EXECUTE\') as allowed', [role, signature])).rows[0].allowed, role === 'authenticated');
      if (role === 'authenticated') assert.equal((await asRole(role, 'select public.ops_example(41) as answer')).rows[0].answer, 42);
      else await assert.rejects(asRole(role, 'select public.ops_example(41)'), { code: '42501' });
    }
    await upload();
    await client.query("create function public.ops_example(text) returns text language sql as $$select $1;$$;");
    const undone = await runMigrationPlan(plan('rollback'), query);
    assert.equal(undone.ok, true, undone.summary);
    assert.equal(await lookup(), null);
    assert.equal((await client.query("select public.ops_example('kept'::text) as answer")).rows[0].answer, 'kept');
    assert.equal((await client.query('select count(*)::int as n from supabase_migrations.schema_migrations')).rows[0].n, 0);
    await upload();
    await client.query('drop function public.ops_example(text);');
  } finally {
    if (client) await client.end();
    await cluster.stop();
  }
});
