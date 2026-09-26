// Real PostgreSQL 17.6, local-only fresh cluster; no Supabase/production access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { harness, issue, json, SUBJECT, OTHER } from '../security/helpers/auth-handoff.mjs';

const migrationPath = '../../supabase/migrations/20260926154120_sec1_auth_handoff_once.sql';
const migration = await readFile(new URL(migrationPath, import.meta.url), 'utf8');
const rollback = await readFile(new URL('../../docs/security/sec1-auth-handoff-rollback.sql', import.meta.url), 'utf8');
const query = 'select public.app_consume_auth_handoff($1::uuid,$2::uuid,$3::timestamptz) as consumed';
for (const name of Object.keys(process.env)) if (name.startsWith('PG')) delete process.env[name];

test('SEC-1 real PostgreSQL permissions, independent instances, concurrency and rollback', { timeout: 90000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sec1-isolated-pg-'));
  // Persistent=false removes only this newly-created, verified temporary path.
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'sec1-isolated-pg-'));
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
    pool = new pg.Pool({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres', ssl: false, max: 24, connectionTimeoutMillis: 5000 });
    await pool.query(`
      create role anon nologin;
      create role authenticated nologin;
      create role public_probe nologin;
      create role service_role nologin bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      -- Reproduce the broad hosted default ACL; migration must remove it.
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text);
    `);
    await pool.query(migration);
    async function asRole(role, sql, params = []) {
      assert.ok(['anon', 'authenticated', 'service_role', 'public_probe'].includes(role));
      const client = await pool.connect();
      try {
        await client.query('set role ' + role);
        return await client.query(sql, params);
      } finally { await client.query('reset role'); client.release(); }
    }
    const expiry = () => new Date(Date.now() + 240000).toISOString();

    await t.test('SECURITY INVOKER succeeds with minimal service grants; client and PUBLIC grants denied', async () => {
      const { rows: [definition] } = await pool.query(`select p.prosecdef, c.relrowsecurity
        from pg_proc p cross join pg_class c where p.oid='public.app_consume_auth_handoff(uuid,uuid,timestamptz)'::regprocedure
        and c.oid='public.app_auth_handoff_consumptions'::regclass`);
      assert.deepEqual(definition, { prosecdef: false, relrowsecurity: true });
      for (const role of ['anon', 'authenticated', 'public_probe']) {
        await assert.rejects(asRole(role, query, [randomUUID(), SUBJECT, expiry()]), { code: '42501' });
        for (const sql of ['select * from public.app_auth_handoff_consumptions', 'delete from public.app_auth_handoff_consumptions', `insert into public.app_auth_handoff_consumptions(nonce,subject_id,expires_at) values('${randomUUID()}','${SUBJECT}',now()+interval '4 minutes')`])
          await assert.rejects(asRole(role, sql), { code: '42501' });
      }
      assert.equal((await asRole('service_role', query, [randomUUID(), SUBJECT, expiry()])).rows[0].consumed, true);
      await assert.rejects(asRole('service_role', 'select subject_id from public.app_auth_handoff_consumptions'), { code: '42501' });
      await assert.rejects(asRole('service_role', 'update public.app_auth_handoff_consumptions set expires_at=now()'), { code: '42501' });
      await assert.rejects(asRole('service_role', 'truncate public.app_auth_handoff_consumptions'), { code: '42501' });
    });

    let successes = 0;
    const consume = async p => {
      const r = await asRole('service_role', query, [p.p_nonce, p.p_subject, p.p_expires_at]);
      if (r.rows[0].consumed) successes++;
      return json(r.rows[0].consumed);
    };
    await t.test('sequential use and two independent Edge instances accept exactly once', async () => {
      const a = harness({ consume }), b = harness({ consume });
      const token = await issue(a);
      assert.equal((await a.send({ action: 'consume', token })).status, 200);
      assert.equal((await a.send({ action: 'consume', token })).ok, false);
      assert.equal(a.refreshes(), 1);
      const token2 = await issue(a);
      const responses = await Promise.all([a, b].map(h => h.send({ action: 'consume', token: token2 })));
      assert.equal(responses.filter(r => r.ok).length, 1);
      assert.equal(a.refreshes() + b.refreshes(), 2);
    });

    await t.test('20 simultaneous independent handlers/connections: one nonce claim and one Auth refresh', async () => {
      let arrived = 0, release;
      const ready = new Promise(resolve => { release = resolve; });
      const pids = new Set();
      const before = successes;
      const concurrentConsume = async p => {
        const client = await pool.connect();
        try {
          await client.query('set role service_role');
          const pid = await client.query('select pg_backend_pid() as pid');
          pids.add(pid.rows[0].pid);
          if (++arrived === 20) release();
          await ready;
          const result = await client.query(query, [p.p_nonce, p.p_subject, p.p_expires_at]);
          if (result.rows[0].consumed) successes++;
          return json(result.rows[0].consumed);
        } finally { await client.query('reset role'); client.release(); }
      };
      const instances = Array.from({ length: 20 }, () => harness({ consume: concurrentConsume }));
      const token = await issue(instances[0]);
      const responses = await Promise.all(instances.map(h => h.send({ action: 'consume', token })));
      const refreshes = instances.reduce((n, h) => n + h.refreshes(), 0);
      assert.equal(pids.size, 20);
      assert.equal(successes - before, 1);
      assert.equal(refreshes, 1);
      assert.equal(responses.filter(r => r.ok).length, 1);
      assert.equal(responses.filter(r => !r.ok).length, 19);
      assert.equal((await harness({ consume }).send({ action: 'consume', token })).ok, false);
      t.diagnostic('20 independent handlers / 20 PostgreSQL backends: nonce successes=1; Auth refresh calls=1; denied=19');
    });

    await t.test('expired and invalid nonce inputs rejected by actual RPC without ledger insertion', async () => {
      for (const params of [[randomUUID(), SUBJECT, new Date(Date.now()-1).toISOString()], [null, SUBJECT, expiry()], ['00000000-0000-1000-8000-000000000001', SUBJECT, expiry()], [randomUUID(), null, expiry()], [randomUUID(), SUBJECT, 'infinity'], [randomUUID(), SUBJECT, new Date(Date.now()+600000).toISOString()]])
        assert.equal((await asRole('service_role', query, params)).rows[0].consumed, false);
      await assert.rejects(asRole('service_role', query, ['bad', SUBJECT, expiry()]), { code: '22P02' });
    });

    await t.test('commit survives Auth failure, mismatched user, network loss and ambiguous DB response', async () => {
      for (const options of [{ refreshError: true }, { refreshThrows: true }, { refreshUser: OTHER }, { ambiguous: true }]) {
        const h = harness({ ...options, consume: async p => {
          const result = await consume(p);
          if (options.ambiguous) throw new Error('synthetic-lost-db-response-after-commit');
          return result;
        } });
        const token = await issue(h);
        assert.equal((await h.send({ action: 'consume', token })).ok, false);
        const retry = harness({ consume });
        assert.equal((await retry.send({ action: 'consume', token })).ok, false);
        assert.equal(retry.refreshes(), 0);
        assert.equal(h.refreshes(), options.ambiguous ? 0 : 1);
      }
    });

    await t.test('ledger contains only nonce metadata; rollback removes only new objects and supports reapply', async () => {
      const columns = await pool.query("select column_name from information_schema.columns where table_schema='public' and table_name='app_auth_handoff_consumptions' order by ordinal_position");
      assert.deepEqual(columns.rows.map(r => r.column_name), ['nonce', 'subject_id', 'expires_at', 'consumed_at']);
      assert.equal((await pool.query("select count(*)::int as n from supabase_migrations.schema_migrations where version='20260926154120' and name='sec1_auth_handoff_once'")).rows[0].n, 1);
      await pool.query(rollback);
      assert.equal((await pool.query("select to_regclass('public.app_auth_handoff_consumptions') as object")).rows[0].object, null);
      assert.equal((await pool.query("select count(*)::int as n from supabase_migrations.schema_migrations where version='20260926154120'")).rows[0].n, 0);
      await pool.query(migration);
      assert.equal((await asRole('service_role', query, [randomUUID(), SUBJECT, expiry()])).rows[0].consumed, true);
    });
  } finally {
    if (pool) await pool.end();
    await cluster.stop();
  }
});
