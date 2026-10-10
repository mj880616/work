// Only an isolated local PostgreSQL cluster; synthetic rows, no production.
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
import { buildBackup, runMigrationPlan } from '../../scripts/ops/db-migration-run.mjs';
import { DbQueryError } from '../../scripts/ops/db-query.mjs';

for (const name of Object.keys(process.env)) if (name.startsWith('PG')) delete process.env[name];

test('DB workflow: real dry-run/apply/rollback, private backup copies and revoked default grants', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ops-db-isolated-pg-'));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'ops-db-isolated-pg-'));
  const socket = createServer();
  await new Promise(done => socket.listen(0, '127.0.0.1', done));
  const port = socket.address().port;
  await new Promise(done => socket.close(done));
  const password = randomBytes(24).toString('hex');
  const cluster = new EmbeddedPostgres({ databaseDir: directory, user: 'postgres', password, port,
    persistent: false, createPostgresUser: false, initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-h', '127.0.0.1', '-c', 'log_statement=none', '-c', 'log_min_error_statement=panic'],
    onLog: () => {}, onError: () => {} });
  let pool;
  const clientEnds = [];
  try {
    await cluster.initialise();
    await cluster.start();
    pool = new pg.Pool({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres', ssl: false });
    pool.on('connect', client => clientEnds.push(new Promise(done => client.once('end', done))));
    await pool.query(`create role anon nologin; create role authenticated nologin; create role visitor nologin;
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations(version text primary key, name text, statements text[]);
      create table public.app_notes(id int primary key, raw_text text);
      insert into public.app_notes values(1,'synthetic-sensitive-row'),(2,'synthetic-second-row');
      create schema ops_backup;
      grant usage on schema ops_backup to public, anon, authenticated;
      alter default privileges grant select on tables to public, anon, authenticated;`);

    // Mirror read_only transport semantics; all writes are explicit SQL requests.
    const query = async (sql, { readOnly = false } = {}) => {
      const client = await pool.connect();
      try {
        if (readOnly) await client.query('begin read only');
        const result = await client.query(sql);
        if (readOnly) await client.query('commit');
        return Array.isArray(result) ? result.at(-1).rows : result.rows;
      } catch (error) {
        await client.query('rollback');
        throw new DbQueryError('local SQL', { sqlState: error.code });
      } finally { client.release(); }
    };
    const version = '20261011120000', name = 'notes_example';
    const apply = `begin;\nalter table public.app_notes add column example int;\ninsert into supabase_migrations.schema_migrations(version,name) values('${version}','${name}');\ncommit;\n`;
    const rollback = `begin;\nalter table public.app_notes drop column example;\ndelete from supabase_migrations.schema_migrations where version='${version}' and name='${name}';\ncommit;\n`;
    const plan = (mode, runId) => {
      const sql = mode === 'rollback' ? rollback : apply;
      return { mode, version, name, runId, file: { sql }, checks: {}, ...validateSQL(sql, { mode, version, name }) };
    };
    const hasColumn = async () => (await pool.query("select count(*)::int as n from information_schema.columns where table_schema='public' and table_name='app_notes' and column_name='example'")).rows[0].n;
    const dry = await runMigrationPlan(plan('dry-run', '12344'), query);
    assert.equal(dry.ok, true);
    assert.equal(await hasColumn(), 0);
    assert.equal((await pool.query('select count(*)::int as n from supabase_migrations.schema_migrations')).rows[0].n, 0);
    assert.equal((await pool.query("select count(*)::int as n from pg_tables where schemaname='ops_backup'")).rows[0].n, 0);

    const p = plan('apply', '12345');
    const applied = await runMigrationPlan(p, query);
    assert.equal(applied.ok, true);
    assert.equal(await hasColumn(), 1);
    assert.doesNotMatch(applied.summary, /synthetic-sensitive-row|synthetic-second-row/);
    const backup = buildBackup(p);
    const table = `ops_backup."${backup.tables[0].name}"`;
    assert.deepEqual((await pool.query(`select id,raw_text from ${table} order by id`)).rows,
      (await pool.query('select id,raw_text from public.app_notes order by id')).rows);
    for (const role of ['anon', 'authenticated', 'visitor']) {
      const privileges = (await pool.query('select has_schema_privilege($1, $2, \'USAGE\') as usage, has_table_privilege($1, $3, \'SELECT\') as read', [role, 'ops_backup', table])).rows[0];
      assert.deepEqual(privileges, { usage: false, read: false });
      const client = await pool.connect();
      try {
        await client.query(`set role ${role}`);
        await assert.rejects(client.query(`select * from ${table}`), error => error.code === '42501');
      } finally { await client.query('reset role'); client.release(); }
    }
    // Same run ID never overwrites an existing recovery copy.
    await assert.rejects(query(backup.sql), error => error.sqlState === '42P07');
    assert.equal((await pool.query(`select count(*)::int as n from ${table}`)).rows[0].n, 2);
    await pool.query('update public.app_notes set example=42 where id=1');
    const undone = await runMigrationPlan(plan('rollback', '12346'), query);
    assert.equal(undone.ok, true);
    assert.equal(await hasColumn(), 0);
    assert.equal((await pool.query(`select example from ops_backup."${version}_app_notes_12346" where id=1`)).rows[0].example, 42);
    assert.equal((await pool.query('select count(*)::int as n from supabase_migrations.schema_migrations')).rows[0].n, 0);
  } finally {
    if (pool) { await pool.end(); await Promise.all(clientEnds); }
    await cluster.stop();
  }
});
