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
