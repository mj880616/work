// TASK-구현 PR 2: real PostgreSQL 17.6, local-only fresh cluster; no Supabase/production access.
// Stubs reproduce only what the migration depends on (production definitions of the two
// private helpers, owner membership, hosted default ACL). Apply → RLS/grants → rollback → reapply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const migration = await readFile(new URL('../../supabase/migrations/20260927103344_task_impl2_notes_record_links.sql', import.meta.url), 'utf8');
const rollback = await readFile(new URL('../../docs/web2-task-impl2-rollback.sql', import.meta.url), 'utf8');
const meetingMigration = await readFile(new URL('../../supabase/migrations/20260928123601_task_meeting_followup_record_links.sql', import.meta.url), 'utf8');
const meetingRollback = await readFile(new URL('../../docs/web2-task-meeting-followup-rollback.sql', import.meta.url), 'utf8');
const meetingAuthz = await readFile(new URL('../../supabase/tests/authz_task_impl2_record_links.sql', import.meta.url), 'utf8');
for (const name of Object.keys(process.env)) if (name.startsWith('PG')) delete process.env[name];

const OWNER = '20000000-0000-4000-8000-000000000001';
const STRANGER = '20000000-0000-4000-8000-000000000002';
const WS_A = '21000000-0000-4000-8000-000000000001';
const WS_B = '21000000-0000-4000-8000-000000000002';
const PROJECT_A = '22000000-0000-4000-8000-000000000001';
const PROJECT_A2 = '22000000-0000-4000-8000-000000000002';
const PROJECT_B = '22000000-0000-4000-8000-000000000003';
const ORG_A = '23000000-0000-4000-8000-000000000001';
const ORG_B = '23000000-0000-4000-8000-000000000002';
const MEETING_A = '25000000-0000-4000-8000-000000000001';
const MEETING_B = '25000000-0000-4000-8000-000000000002';

const fixture = `
  create role anon nologin;
  create role authenticated nologin;
  create role public_probe nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  -- Hosted default ACL: every new public table grants ALL to anon/authenticated/service_role.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text);
  create schema auth;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  create table public.app_workspaces(id uuid primary key, slug text, name text);
  create table public.app_workspace_members(workspace_id uuid references public.app_workspaces(id), user_id uuid, role text);
  create table public.app_spaces(id uuid primary key, workspace_id uuid not null references public.app_workspaces(id));
  create table public.app_suborganizations(id uuid primary key, workspace_id uuid not null references public.app_workspaces(id), name text, created_by uuid);
  create table public.app_meetings(id uuid primary key, workspace_id uuid not null references public.app_workspaces(id), title text, created_by uuid);
  create schema private;
  grant usage on schema private to authenticated, service_role;
  -- Same bodies as production (checked read-only 2026-09-27).
  create function private.app_is_workspace_owner(p_workspace uuid) returns boolean
    language sql stable security definer set search_path = pg_catalog, public as $$
    select exists (select 1 from public.app_workspace_members wm
      where wm.workspace_id = p_workspace and wm.user_id = (select auth.uid()) and wm.role = 'owner') $$;
  create function private.app_space_in_workspace(p_space uuid, p_workspace uuid) returns boolean
    language sql stable security definer set search_path = pg_catalog, public as $$
    select p_space is null or exists (select 1 from public.app_spaces s
      where s.id = p_space and s.workspace_id = p_workspace) $$;
  create function private.app_meeting_in_workspace(p_meeting uuid, p_workspace uuid) returns boolean
    language sql stable security definer set search_path = pg_catalog, public as $$
    select p_meeting is null or exists (select 1 from public.app_meetings m
      where m.id = p_meeting and m.workspace_id = p_workspace) $$;
  revoke all on function private.app_is_workspace_owner(uuid), private.app_space_in_workspace(uuid,uuid) from public;
  grant execute on function private.app_is_workspace_owner(uuid), private.app_space_in_workspace(uuid,uuid) to authenticated, service_role;
  revoke all on function private.app_meeting_in_workspace(uuid,uuid) from public;
  grant execute on function private.app_meeting_in_workspace(uuid,uuid) to authenticated, service_role;
  alter table public.app_suborganizations enable row level security;
  create policy task12a_owner_all on public.app_suborganizations for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke all on public.app_workspaces, public.app_workspace_members, public.app_spaces from anon, authenticated;
  insert into public.app_workspaces values ('${WS_A}'), ('${WS_B}');
  insert into public.app_workspace_members values ('${WS_A}', '${OWNER}', 'owner'), ('${WS_B}', '${STRANGER}', 'owner');
  insert into public.app_spaces values ('${PROJECT_A}', '${WS_A}'), ('${PROJECT_A2}', '${WS_A}'), ('${PROJECT_B}', '${WS_B}');
  insert into public.app_suborganizations values ('${ORG_A}', '${WS_A}'), ('${ORG_B}', '${WS_B}');
  insert into public.app_meetings values ('${MEETING_A}', '${WS_A}'), ('${MEETING_B}', '${WS_B}');
`;

test('TASK-impl PR 2 notes/record links: grants, owner RLS, constraints, rollback and reapply', { timeout: 90000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'task-impl2-pg-'));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'task-impl2-pg-'));
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
    pool = new pg.Pool({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres', ssl: false, max: 4 });
    await pool.query(fixture);
    await pool.query(migration);

    // Runs sql as role (with optional JWT subject) inside a transaction that is always rolled back.
    async function as(role, sub, sql, params = []) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query("select set_config('request.jwt.claim.sub', $1, true)", [sub || '']);
        await client.query('set local role ' + role);
        return await client.query(sql, params);
      } finally { await client.query('rollback'); client.release(); }
    }
    // Runs several statements as the owner in one rolled-back transaction.
    async function asOwner(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query("select set_config('request.jwt.claim.sub', $1, true)", [OWNER]);
        await client.query('set local role authenticated');
        return await fn(client);
      } finally { await client.query('rollback'); client.release(); }
    }
    const link = (cols, values) => `insert into public.app_record_links(workspace_id, ${cols}) values ('${WS_A}', ${values}) returning id`;
    const taskTo = (task, target, col = 'project_id', done = 'false') =>
      link(`google_task_id, google_tasklist_id, task_completed, ${col}`, `'${task}', '@default', ${done}, '${target}'`);

    await t.test('RLS on; anon and PUBLIC have nothing; authenticated has only select/insert/update/delete', async () => {
      const { rows } = await pool.query(`select c.relname, c.relrowsecurity,
          has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as crud,
          has_table_privilege('authenticated', c.oid, 'TRUNCATE') as auth_truncate,
          has_table_privilege('authenticated', c.oid, 'REFERENCES') as auth_references,
          has_table_privilege('authenticated', c.oid, 'TRIGGER') as auth_trigger,
          has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anon_any,
          has_table_privilege('public_probe', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as public_any
        from pg_class c where c.oid in ('public.app_notes'::regclass, 'public.app_record_links'::regclass) order by 1`);
      for (const row of rows) assert.deepEqual({ ...row, relname: undefined }, { relname: undefined, relrowsecurity: true,
        crud: true, auth_truncate: false, auth_references: false, auth_trigger: false, anon_any: false, public_any: false });
      for (const table of ['app_notes', 'app_record_links']) {
        await assert.rejects(as('anon', null, `select * from public.${table}`), { code: '42501' });
        await assert.rejects(as('public_probe', null, `select * from public.${table}`), { code: '42501' });
        await assert.rejects(as('authenticated', OWNER, `truncate public.${table} cascade`), { code: '42501' });
      }
      const policies = await pool.query(`select polrelid::regclass::text as t, polname, polcmd::text as cmd, polroles::regrole[]::text as roles
        from pg_policy where polrelid in ('public.app_notes'::regclass, 'public.app_record_links'::regclass) order by 1`);
      assert.deepEqual(policies.rows, [
        { t: 'app_notes', polname: 'notes_owner_all', cmd: '*', roles: '{authenticated}' },
        { t: 'app_record_links', polname: 'record_links_owner_all', cmd: '*', roles: '{authenticated}' }]);
    });

    await t.test('owner links one task to several projects/organizations, notes too, and counts open tasks', async () => {
      await asOwner(async c => {
        const note = (await c.query(`insert into public.app_notes(workspace_id, raw_text) values ('${WS_A}', 'x') returning id`)).rows[0].id;
        await c.query(taskTo('task-1', PROJECT_A));
        await c.query(taskTo('task-1', PROJECT_A2));
        await c.query(taskTo('task-1', ORG_A, 'organization_id'));
        await c.query(taskTo('task-2', PROJECT_A, 'project_id', 'true'));
        await c.query(taskTo('task-3', PROJECT_A));
        await c.query(link('note_id, project_id', `'${note}', '${PROJECT_A}'`));
        await c.query(link('note_id, organization_id', `'${note}', '${ORG_A}'`));
        const counts = await c.query(`select project_id::text, count(*)::int as n from public.app_record_links
          where google_task_id is not null and task_completed = false and project_id is not null group by project_id order by 1`);
        assert.deepEqual(counts.rows, [{ project_id: PROJECT_A, n: 2 }, { project_id: PROJECT_A2, n: 1 }]);
        const updated = await c.query(`update public.app_record_links set task_completed = true, task_checked_at = now() where google_task_id = 'task-1'`);
        assert.equal(updated.rowCount, 3);
        assert.equal((await c.query(`delete from public.app_record_links where google_task_id = 'task-3'`)).rowCount, 1);
        const row = (await c.query(`select status, report_kind from public.app_record_links where google_task_id = 'task-2'`)).rows[0];
        assert.deepEqual(row, { status: 'confirmed', report_kind: null });
      });
    });

    await t.test('constraints reject malformed and duplicate links', async () => {
      const cases = [
        [link('project_id', `'${PROJECT_A}'`), '23514'],                                                     // no source
        [link('google_task_id, google_tasklist_id, task_completed', `'t', '@default', false`), '23514'],       // no target
        [link('google_task_id, google_tasklist_id, task_completed, project_id, organization_id',
          `'t', '@default', false, '${PROJECT_A}', '${ORG_A}'`), '23514'],                                     // two targets
        [link('google_task_id, task_completed, project_id', `'t', false, '${PROJECT_A}'`), '23514'],           // list missing
        [link('google_task_id, google_tasklist_id, project_id', `'t', '@default', '${PROJECT_A}'`), '23514'],  // completion copy missing
        [link('google_task_id, google_tasklist_id, task_completed, status, project_id',
          `'t', '@default', false, 'other', '${PROJECT_A}'`), '23514'],
        [link('google_task_id, google_tasklist_id, task_completed, report_kind, project_id',
          `'t', '@default', false, 'other', '${PROJECT_A}'`), '23514'],
      ];
      for (const [sql, code] of cases) await assert.rejects(asOwner(c => c.query(sql)), { code }, sql);
      // two sources
      await assert.rejects(asOwner(async c => {
        const note = (await c.query(`insert into public.app_notes(workspace_id, raw_text) values ('${WS_A}', 'x') returning id`)).rows[0].id;
        await c.query(link('google_task_id, google_tasklist_id, task_completed, note_id, project_id', `'t', '@default', false, '${note}', '${PROJECT_A}'`));
      }), { code: '23514' });
      await assert.rejects(asOwner(async c => { await c.query(taskTo('dup', PROJECT_A)); await c.query(taskTo('dup', PROJECT_A)); }), { code: '23505' });
      await assert.rejects(asOwner(async c => {
        const note = (await c.query(`insert into public.app_notes(workspace_id, raw_text) values ('${WS_A}', 'x') returning id`)).rows[0].id;
        await c.query(link('note_id, organization_id', `'${note}', '${ORG_A}'`));
        await c.query(link('note_id, organization_id', `'${note}', '${ORG_A}'`));
      }), { code: '23505' });
      for (const text of ['', 'x'.repeat(20001)])
        await assert.rejects(as('authenticated', OWNER, `insert into public.app_notes(workspace_id, raw_text) values ('${WS_A}', $1)`, [text]), { code: '23514' });
    });

    await t.test('non-owners and cross-workspace targets are rejected by RLS', async () => {
      // Seed as superuser (committed) so read isolation can be checked, then remove.
      await pool.query(`insert into public.app_notes(id, workspace_id, raw_text) values ('24000000-0000-4000-8000-000000000001', '${WS_A}', 'x')`);
      await pool.query(`insert into public.app_record_links(workspace_id, google_task_id, google_tasklist_id, task_completed, project_id)
        values ('${WS_A}', 'seed', '@default', false, '${PROJECT_A}')`);
      try {
        for (const sub of [STRANGER, null]) {
          assert.equal((await as('authenticated', sub, 'select * from public.app_record_links')).rowCount, 0);
          assert.equal((await as('authenticated', sub, 'select * from public.app_notes')).rowCount, 0);
          assert.equal((await as('authenticated', sub, `update public.app_record_links set task_completed = true`)).rowCount, 0);
          assert.equal((await as('authenticated', sub, `delete from public.app_notes`)).rowCount, 0);
          await assert.rejects(as('authenticated', sub, taskTo('x', PROJECT_A)), { code: '42501' });
          await assert.rejects(as('authenticated', sub, `insert into public.app_notes(workspace_id, raw_text) values ('${WS_A}', 'x')`), { code: '42501' });
        }
        assert.equal((await as('authenticated', OWNER, 'select * from public.app_record_links')).rowCount, 1);
        // Owner of A cannot attach A's link to B's project/organization, nor write into B.
        await assert.rejects(as('authenticated', OWNER, taskTo('x', PROJECT_B)), { code: '42501' });
        await assert.rejects(as('authenticated', OWNER, taskTo('x', ORG_B, 'organization_id')), { code: '42501' });
        await assert.rejects(as('authenticated', OWNER, `insert into public.app_record_links(workspace_id, google_task_id, google_tasklist_id, task_completed, project_id)
          values ('${WS_B}', 'x', '@default', false, '${PROJECT_B}')`), { code: '42501' });
        await assert.rejects(as('authenticated', OWNER, `update public.app_record_links set project_id = '${PROJECT_B}'`), { code: '42501' });
        await assert.rejects(as('authenticated', OWNER, `update public.app_record_links set workspace_id = '${WS_B}'`), { code: '42501' });
        // The other workspace's owner cannot use A's project either.
        await assert.rejects(as('authenticated', STRANGER, `insert into public.app_record_links(workspace_id, google_task_id, google_tasklist_id, task_completed, project_id)
          values ('${WS_B}', 'x', '@default', false, '${PROJECT_A}')`), { code: '42501' });
      } finally {
        await pool.query('delete from public.app_record_links; delete from public.app_notes');
      }
    });

    await t.test('a note from another workspace cannot be linked', async () => {
      const NOTE_B = '24000000-0000-4000-8000-000000000002';
      const NOTE_A = '24000000-0000-4000-8000-000000000003';
      await pool.query(`insert into public.app_notes(id, workspace_id, raw_text) values ('${NOTE_B}', '${WS_B}', 'x'), ('${NOTE_A}', '${WS_A}', 'x')`);
      try {
        // Owner of A links B's note under A's workspace and A's project/organization.
        await assert.rejects(as('authenticated', OWNER, link('note_id, project_id', `'${NOTE_B}', '${PROJECT_A}'`)), { code: '42501' });
        await assert.rejects(as('authenticated', OWNER, link('note_id, organization_id', `'${NOTE_B}', '${ORG_A}'`)), { code: '42501' });
        // Owner of B links A's note under B's workspace and B's project.
        await assert.rejects(as('authenticated', STRANGER, `insert into public.app_record_links(workspace_id, note_id, project_id)
          values ('${WS_B}', '${NOTE_A}', '${PROJECT_B}')`), { code: '42501' });
        // Moving an existing A link onto B's note is rejected as well.
        await assert.rejects(asOwner(async c => {
          await c.query(link('note_id, project_id', `'${NOTE_A}', '${PROJECT_A}'`));
          await c.query(`update public.app_record_links set note_id = '${NOTE_B}' where note_id = '${NOTE_A}'`);
        }), { code: '42501' });
        // Same-workspace note still links.
        assert.equal((await as('authenticated', OWNER, link('note_id, project_id', `'${NOTE_A}', '${PROJECT_A}'`))).rowCount, 1);
      } finally {
        await pool.query('delete from public.app_record_links; delete from public.app_notes');
      }
    });

    await t.test('deleting a project, organization or note removes its links', async () => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const note = (await client.query(`insert into public.app_notes(workspace_id, raw_text) values ('${WS_A}', 'x') returning id`)).rows[0].id;
        await client.query(taskTo('a', PROJECT_A2));
        await client.query(taskTo('b', ORG_A, 'organization_id'));
        await client.query(link('note_id, project_id', `'${note}', '${PROJECT_A}'`));
        await client.query(`delete from public.app_spaces where id = '${PROJECT_A2}'`);
        await client.query(`delete from public.app_suborganizations where id = '${ORG_A}'`);
        await client.query(`delete from public.app_notes where id = '${note}'`);
        assert.equal((await client.query('select count(*)::int as n from public.app_record_links')).rows[0].n, 0);
      } finally { await client.query('rollback'); client.release(); }
    });

    await t.test('meeting migration preserves old links, enforces owner and target rules, and rolls back', async () => {
      await pool.query(taskTo('before-meeting', PROJECT_A));
      await pool.query(meetingMigration);
      const prior = await pool.query(`select meeting_id from public.app_record_links where google_task_id = 'before-meeting'`);
      assert.equal(prior.rowCount, 1);
      assert.equal(prior.rows[0].meeting_id, null);
      assert.equal((await pool.query(`select count(*)::int as n from supabase_migrations.schema_migrations
        where version = '20260928123601' and name = 'task_meeting_followup_record_links'`)).rows[0].n, 1);
      await pool.query(meetingAuthz);
      assert.equal((await as('authenticated', OWNER, taskTo('owner-meeting', MEETING_A, 'meeting_id'))).rowCount, 1);
      assert.equal((await as('authenticated', STRANGER, `insert into public.app_record_links
        (workspace_id, google_task_id, google_tasklist_id, task_completed, meeting_id)
        values ('${WS_B}', 'other-owner-meeting', '@default', false, '${MEETING_B}')`)).rowCount, 1);
      await assert.rejects(as('authenticated', OWNER, taskTo('cross-meeting', MEETING_B, 'meeting_id')), { code: '42501' });
      await assert.rejects(as('authenticated', OWNER, link('google_task_id, google_tasklist_id, task_completed, project_id, meeting_id',
        `'two-targets', '@default', false, '${PROJECT_A}', '${MEETING_A}'`)), { code: '23514' });
      await assert.rejects(asOwner(async c => {
        await c.query(taskTo('duplicate-meeting', MEETING_A, 'meeting_id'));
        await c.query(taskTo('duplicate-meeting', MEETING_A, 'meeting_id'));
      }), { code: '23505' });
      await pool.query(taskTo('visible-meeting', MEETING_A, 'meeting_id'));
      assert.equal((await as('authenticated', STRANGER, `select * from public.app_record_links where google_task_id = 'visible-meeting'`)).rowCount, 0);
      assert.equal((await as('authenticated', STRANGER, `update public.app_record_links set task_completed = true
        where google_task_id = 'visible-meeting'`)).rowCount, 0);
      await assert.rejects(as('authenticated', STRANGER, taskTo('wrong-owner', MEETING_A, 'meeting_id')), { code: '42501' });
      await pool.query(meetingRollback);
      assert.equal((await pool.query(`select count(*)::int as n from public.app_record_links
        where google_task_id = 'before-meeting'`)).rows[0].n, 1);
      assert.equal((await pool.query(`select count(*)::int as n from public.app_record_links
        where google_task_id = 'visible-meeting'`)).rows[0].n, 0);
      assert.equal((await pool.query(`select count(*)::int as n from supabase_migrations.schema_migrations
        where version = '20260928123601'`)).rows[0].n, 0);
      assert.equal((await pool.query(`select to_regclass('public.app_record_links_meeting_idx') as meeting_idx`)).rows[0].meeting_idx, null);
      await pool.query('delete from public.app_record_links');
    });

    await t.test('migration record; rollback removes only the two tables and its record; reapply works', async () => {
      const record = "select count(*)::int as n from supabase_migrations.schema_migrations where version='20260927103344' and name='task_impl2_notes_record_links'";
      assert.equal((await pool.query(record)).rows[0].n, 1);
      await pool.query(`insert into supabase_migrations.schema_migrations(version, name) values ('20260926154120', 'sec1_auth_handoff_once')`);
      await pool.query(rollback);
      const objects = await pool.query(`select to_regclass('public.app_notes') as notes, to_regclass('public.app_record_links') as links,
        (select count(*)::int from public.app_spaces) as spaces, (select count(*)::int from public.app_suborganizations) as orgs,
        (select count(*)::int from supabase_migrations.schema_migrations) as records`);
      assert.deepEqual(objects.rows[0], { notes: null, links: null, spaces: 3, orgs: 2, records: 1 });
      assert.equal((await pool.query(record)).rows[0].n, 0);
      await pool.query(migration);
      assert.equal((await pool.query(record)).rows[0].n, 1);
      assert.equal((await as('authenticated', OWNER, taskTo('again', PROJECT_A))).rowCount, 1);
    });
  } finally {
    if (pool) await pool.end();
    await cluster.stop();
  }
});
