// TASK-29 migration rehearsal in an isolated temporary PostgreSQL cluster.
// No Supabase project or production database connection is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const migration = await readFile(new URL('../../supabase/migrations/20260929072329_task29_delete_app_tasks_rows.sql', import.meta.url), 'utf8');
for (const name of Object.keys(process.env)) if (name.startsWith('PG')) delete process.env[name];

test('TASK-29 deletes exactly 58 audited rows and stops on drift', { timeout: 90000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'task29-isolated-pg-'));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'task29-isolated-pg-'));
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
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
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations(version text primary key, name text, statements text[]);
      create table public.app_tasks(id bigint generated always as identity primary key,
        status text, updated_at timestamptz, completed_at timestamptz);
      create table public.app_record_links(id bigint generated always as identity primary key);
      insert into public.app_record_links default values;
    `);

    async function seed(count, status = 'done', recentColumn = null, missingCompleted = false) {
      await pool.query('truncate public.app_tasks restart identity');
      await pool.query(`insert into public.app_tasks(status, updated_at, completed_at)
        select case when g = 1 then $2 else 'done' end,
               case when g = 1 and $3 = 'updated_at' then timestamptz '2026-09-28 00:00:00+09'
                    else timestamptz '2026-09-27 12:00:00+09' end,
               case when g = 1 and $4 then null
                    when g = 1 and $3 = 'completed_at' then timestamptz '2026-09-28 00:00:00+09'
                    else timestamptz '2026-09-27 12:00:00+09' end
        from generate_series(1, $1::int) as g`, [count, status, recentColumn, missingCompleted]);
    }

    async function apply() {
      const client = await pool.connect();
      try {
        return await client.query(migration);
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }

    async function counts() {
      const { rows: [row] } = await pool.query(`select
        (select count(*)::int from public.app_tasks) as tasks,
        (select count(*)::int from public.app_record_links) as links,
        (select count(*)::int from supabase_migrations.schema_migrations
          where version = '20260929072329' and name = 'task29_delete_app_tasks_rows') as records`);
      return row;
    }

    for (const scenario of [
      { name: '57 rows', count: 57 },
      { name: 'one unfinished row', count: 58, status: 'pending' },
      { name: 'one recently updated row', count: 58, recentColumn: 'updated_at' },
      { name: 'one recently completed row', count: 58, recentColumn: 'completed_at' },
      { name: 'one missing completion timestamp', count: 58, missingCompleted: true },
    ]) {
      await t.test(`${scenario.name}: aborts without data or history changes`, async () => {
        await seed(scenario.count, scenario.status, scenario.recentColumn, scenario.missingCompleted);
        await assert.rejects(apply(), /TASK-29 precondition failed/);
        assert.deepEqual(await counts(), { tasks: scenario.count, links: 1, records: 0 });
      });
    }

    await t.test('unexpected short delete rolls the transaction back', async () => {
      await seed(58);
      await pool.query(`create function public.task29_skip_one_delete() returns trigger language plpgsql as $$
        begin if old.id = 1 then return null; end if; return old; end $$;
        create trigger task29_skip_one_delete before delete on public.app_tasks
          for each row execute function public.task29_skip_one_delete();`);
      try {
        await assert.rejects(apply(), /TASK-29 deleted 57 rows instead of 58/);
        assert.deepEqual(await counts(), { tasks: 58, links: 1, records: 0 });
      } finally {
        await pool.query('drop trigger task29_skip_one_delete on public.app_tasks');
        await pool.query('drop function public.task29_skip_one_delete()');
      }
    });

    await t.test('58 completed old rows: deletes tasks only and records migration once', async () => {
      await seed(58);
      await apply();
      assert.deepEqual(await counts(), { tasks: 0, links: 1, records: 1 });
      const { rows } = await pool.query(`select version, name from supabase_migrations.schema_migrations`);
      assert.deepEqual(rows, [{ version: '20260929072329', name: 'task29_delete_app_tasks_rows' }]);
    });
  } finally {
    if (pool) await pool.end();
    await cluster.stop();
  }
});
