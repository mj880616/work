// TASK-29 rehearsal in an isolated temporary PostgreSQL cluster; no production access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const migration = await readFile(new URL('../../supabase/migrations/20260929081500_task29_block_writes_delete_app_tasks_rows.sql', import.meta.url), 'utf8');
const NEW_VERSION = '20260929081500';
const NEW_NAME = 'task29_block_writes_delete_app_tasks_rows';
for (const name of Object.keys(process.env)) if (name.startsWith('PG')) delete process.env[name];

test('TASK-29 deletes only the audited 63 rows and blocks client writes', { timeout: 90000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'task29-isolated-pg-'));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'task29-isolated-pg-'));
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
  try {
    await cluster.initialise();
    await cluster.start();
    pool = new pg.Pool({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres', ssl: false });
    await pool.query(`
      create role anon nologin;
      create role authenticated nologin;
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations(version text primary key, name text, statements text[]);
      create table public.app_tasks(id bigint generated always as identity primary key,
        status text, created_at timestamptz, updated_at timestamptz, completed_at timestamptz);
      create table public.app_record_links(id bigint generated always as identity primary key);
      insert into public.app_record_links default values;
      grant usage on schema public to anon, authenticated;
      grant select, insert, update, delete on public.app_tasks to authenticated;
      grant insert, update, delete on public.app_tasks to anon;
    `);

    async function seed(done = 58, todo = 5) {
      await pool.query('truncate public.app_tasks restart identity');
      await pool.query(`insert into public.app_tasks(status, created_at, updated_at, completed_at)
        select 'done', timestamptz '2026-09-27 12:00:00+09',
          timestamptz '2026-09-27 12:00:00+09', timestamptz '2026-09-27 12:00:00+09'
        from generate_series(1, $1::int)`, [done]);
      await pool.query(`insert into public.app_tasks(status, created_at, updated_at, completed_at)
        select 'todo', timestamptz '2026-09-29 16:24:03+09',
          timestamptz '2026-09-29 16:24:03+09', null
        from generate_series(1, $1::int)`, [todo]);
    }

    async function apply() {
      const client = await pool.connect();
      try {
        await client.query(migration);
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }

    async function snapshot() {
      const { rows: [row] } = await pool.query(`select
        (select count(*)::int from public.app_tasks) as tasks,
        (select count(*)::int from public.app_record_links) as links,
        (select count(*)::int from supabase_migrations.schema_migrations
          where version = '${NEW_VERSION}' and name = '${NEW_NAME}') as records,
        has_table_privilege('authenticated', 'public.app_tasks', 'SELECT') as auth_select,
        has_table_privilege('authenticated', 'public.app_tasks', 'INSERT') as auth_insert,
        has_table_privilege('authenticated', 'public.app_tasks', 'UPDATE') as auth_update,
        has_table_privilege('authenticated', 'public.app_tasks', 'DELETE') as auth_delete,
        has_table_privilege('anon', 'public.app_tasks', 'SELECT') as anon_select,
        has_table_privilege('anon', 'public.app_tasks', 'INSERT') as anon_insert,
        has_table_privilege('anon', 'public.app_tasks', 'UPDATE') as anon_update,
        has_table_privilege('anon', 'public.app_tasks', 'DELETE') as anon_delete`);
      return row;
    }

    const beforeRights = {
      auth_select: true, auth_insert: true, auth_update: true, auth_delete: true,
      anon_select: false, anon_insert: true, anon_update: true, anon_delete: true,
    };
    for (const scenario of [
      { name: '62 rows', done: 57, todo: 5 },
      { name: '64 rows', done: 59, todo: 5 },
      { name: 'only 4 unfinished rows', done: 58, todo: 4 },
    ]) {
      await t.test(`${scenario.name}: aborts without changing rows, rights or history`, async () => {
        await seed(scenario.done, scenario.todo);
        await assert.rejects(apply(), /TASK-29 precondition failed/);
        assert.deepEqual(await snapshot(), {
          tasks: scenario.done + scenario.todo, links: 1, records: 0, ...beforeRights,
        });
      });
    }

    for (const column of ['created_at', 'updated_at', 'completed_at']) {
      await t.test(`${column} at 16:25 KST: aborts atomically`, async () => {
        await seed();
        await pool.query(`update public.app_tasks set ${column} = timestamptz '2026-09-29 16:25:00+09'
          where id = (select min(id) from public.app_tasks where status = 'todo')`);
        await assert.rejects(apply(), /TASK-29 precondition failed/);
        assert.deepEqual(await snapshot(), { tasks: 63, links: 1, records: 0, ...beforeRights });
      });
    }

    await t.test('unfinished cohort outside the stated creation second aborts', async () => {
      await seed();
      await pool.query(`update public.app_tasks set created_at = timestamptz '2026-09-29 16:24:04+09'
        where id = (select min(id) from public.app_tasks where status = 'todo')`);
      await assert.rejects(apply(), /TASK-29 precondition failed/);
      assert.deepEqual(await snapshot(), { tasks: 63, links: 1, records: 0, ...beforeRights });
    });

    for (const column of ['updated_at', 'completed_at']) {
      await t.test(`old done row ${column} drift aborts`, async () => {
        await seed();
        await pool.query(`update public.app_tasks set ${column} = timestamptz '2026-09-28 00:00:00+09'
          where id = 1`);
        await assert.rejects(apply(), /TASK-29 precondition failed/);
        assert.deepEqual(await snapshot(), { tasks: 63, links: 1, records: 0, ...beforeRights });
      });
    }

    await t.test('short delete rolls back permission revocation and row deletion', async () => {
      await seed();
      await pool.query(`create function public.task29_skip_one_delete() returns trigger language plpgsql as $$
        begin if old.id = 1 then return null; end if; return old; end $$;
        create trigger task29_skip_one_delete before delete on public.app_tasks
          for each row execute function public.task29_skip_one_delete();`);
      try {
        await assert.rejects(apply(), /TASK-29 deleted 62 rows instead of 63/);
        assert.deepEqual(await snapshot(), { tasks: 63, links: 1, records: 0, ...beforeRights });
      } finally {
        await pool.query('drop trigger task29_skip_one_delete on public.app_tasks');
        await pool.query('drop function public.task29_skip_one_delete()');
      }
    });

    await t.test('old unapplied version must remain absent', async () => {
      await seed();
      await pool.query(`insert into supabase_migrations.schema_migrations(version, name)
        values ('20260929072329', 'task29_delete_app_tasks_rows')`);
      try {
        await assert.rejects(apply(), /TASK-29 .*migration version already recorded/);
        assert.deepEqual(await snapshot(), { tasks: 63, links: 1, records: 0, ...beforeRights });
      } finally {
        await pool.query(`delete from supabase_migrations.schema_migrations where version = '20260929072329'`);
      }
    });

    await t.test('63 audited rows: delete, preserve SELECT and deny client writes', async () => {
      await seed();
      await apply();
      assert.deepEqual(await snapshot(), {
        tasks: 0, links: 1, records: 1,
        auth_select: true, auth_insert: false, auth_update: false, auth_delete: false,
        anon_select: false, anon_insert: false, anon_update: false, anon_delete: false,
      });
      const { rows } = await pool.query('select version, name from supabase_migrations.schema_migrations');
      assert.deepEqual(rows, [{ version: NEW_VERSION, name: NEW_NAME }]);
      const client = await pool.connect();
      try {
        await client.query('set role authenticated');
        await assert.rejects(client.query("insert into public.app_tasks(status) values ('todo')"),
          error => error.code === '42501');
      } finally {
        await client.query('reset role');
        client.release();
      }
    });
  } finally {
    if (pool) await pool.end();
    await cluster.stop();
  }
});
