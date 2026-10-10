// BASKET-1: real PostgreSQL 17.6, local-only fresh cluster; no Supabase/production access.
// Stubs reproduce only what the migration depends on (repository definitions of the
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

const baseMigration = await readFile(new URL('../../supabase/migrations/20260927103344_task_impl2_notes_record_links.sql', import.meta.url), 'utf8');
const meetingMigration = await readFile(new URL('../../supabase/migrations/20260928123601_task_meeting_followup_record_links.sql', import.meta.url), 'utf8');
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
  -- Same bodies as existing local regression fixture; no production query here.
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

const migrationURL = new URL('../../supabase/migrations/20261010120000_basket1_notes_links.sql', import.meta.url);
const rollbackURL = new URL('../../docs/20261010120000_basket1_notes_links.rollback.sql', import.meta.url);
const DOC_A = '26000000-0000-4000-8000-000000000001';
const DOC_B = '26000000-0000-4000-8000-000000000002';
test('BASKET-1 schema apply, owner boundaries, old links, rollback and reapply', { timeout: 90000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'basket1-pg-'));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'basket1-pg-'));
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
    pool = new pg.Pool({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres', ssl: false, max: 4 });
    pool.on('connect', client => clientEnds.push(new Promise(done => client.once('end', done))));
    await pool.query(fixture);
    await pool.query(baseMigration);
    await pool.query(meetingMigration);
    await pool.query(`create table public.app_documents(id uuid primary key, workspace_id uuid not null references public.app_workspaces(id));
      alter table public.app_documents enable row level security;
      create policy task12a_owner_all on public.app_documents for all to authenticated
      using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
      insert into public.app_documents values ('${DOC_A}', '${WS_A}'), ('${DOC_B}', '${WS_B}');`);

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
    const attachment = {drive_file_id: 'synthetic-file', file_name: 'image.png', mime_type: 'image/png', size_bytes: 42};
    const noteSQL = `insert into public.app_notes(workspace_id,raw_text,attachments) values ('${WS_A}',$1,$2::jsonb) returning *`;
    const oldNote = (await pool.query(`insert into public.app_notes(workspace_id,raw_text) values ('${WS_A}', E'  preserved\n') returning *`)).rows[0];
    for (const [col, id] of [['project_id',PROJECT_A],['organization_id',ORG_A],['meeting_id',MEETING_A]]) {
      await pool.query(`insert into public.app_record_links(workspace_id,google_task_id,google_tasklist_id,task_completed,${col})
        values ('${WS_A}','seed-${col}','@default',false,'${id}')`);
      await pool.query(`insert into public.app_record_links(workspace_id,note_id,${col}) values ('${WS_A}','${oldNote.id}','${id}')`);
    }
    const existingRows = async () => (await pool.query(`select id,workspace_id,raw_text,occurred_at,created_at,updated_at from public.app_notes order by id`)).rows;
    const links = async () => (await pool.query(`select id,workspace_id,google_task_id,google_tasklist_id,note_id,project_id,organization_id,meeting_id,status,report_kind,task_completed,task_checked_at,created_at from public.app_record_links order by id`)).rows;
    const acl = async () => (await pool.query(`select relname,relacl::text from pg_class where oid in ('public.app_notes'::regclass,'public.app_record_links'::regclass) order by 1`)).rows;
    const baseline = {notes: await existingRows(), links: await links(), acl: await acl()};
    const schema = async () => (await pool.query(`select 'column' kind,attrelid::regclass::text tab,attname name,
      format_type(atttypid,atttypmod)||':'||attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'') def
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where attrelid in ('public.app_notes'::regclass,'public.app_record_links'::regclass) and attnum>0 and not attisdropped
      union all select 'constraint',conrelid::regclass::text,conname,pg_get_constraintdef(oid) from pg_constraint where conrelid in ('public.app_notes'::regclass,'public.app_record_links'::regclass)
      union all select 'policy',polrelid::regclass::text,polname,polroles::text||':'||polcmd::text||':'||pg_get_expr(polqual,polrelid)||':'||pg_get_expr(polwithcheck,polrelid) from pg_policy where polrelid in ('public.app_notes'::regclass,'public.app_record_links'::regclass)
      union all select 'index',tablename,indexname,indexdef from pg_indexes where schemaname='public' and tablename in ('app_notes','app_record_links') order by 1,2,3`)).rows;
    const beforeSchema = await schema();
    const precheck = await readFile(new URL('../../docs/20261010120000_basket1_notes_links.precheck.sql', import.meta.url),'utf8');
    const preRows = (await pool.query(precheck)).rows;
    for(const row of preRows.filter(r=>r.item.includes('(=0)'))) assert.equal(row.value,'0',row.item);
    await pool.query(await readFile(new URL('../../docs/20261010120000_basket1_notes_links.snapshot.sql', import.meta.url),'utf8'));
    // Regression must fail on the old schema because attachment-only notes are unavailable.
    const migration = await readFile(migrationURL, 'utf8');
    const rollback = await readFile(rollbackURL, 'utf8');
    await pool.query(migration);
    const postcheck = await readFile(new URL('../../docs/20261010120000_basket1_notes_links.postcheck.sql', import.meta.url),'utf8');
    const unsetPost = (await pool.query(postcheck)).rows;
    assert.equal(unsetPost.find(r=>r.item==='rows unchanged').expected,'아니오');
    const grants = preRows.find(r=>r.item==='notes/grants').value;
    const linkGrants = preRows.find(r=>r.item==='record_links/grants').value;
    const completedPost = postcheck.replace('null::bigint,null::bigint,null::text,null::text', `1::bigint,6::bigint,'${grants}'::text,'${linkGrants}'::text`);
    for(const row of (await pool.query(completedPost)).rows) assert.equal(row.expected,'예',row.item);
    const changedCountPost = completedPost.replace('1::bigint,6::bigint', '2::bigint,6::bigint');
    assert.equal((await pool.query(changedCountPost)).rows.find(r=>r.item==='rows unchanged').expected,'아니오');
    await t.test('existing rows, timestamps and ACL are identical; defaults and owner RLS retained', async () => {
      assert.deepEqual(await existingRows(), baseline.notes);
      assert.deepEqual(await links(), baseline.links);
      assert.deepEqual(await acl(), baseline.acl);
      const n = (await pool.query('select attachments,archived_at,ai_export_allowed,metadata from public.app_notes')).rows[0];
      assert.deepEqual(n, {attachments:[],archived_at:null,ai_export_allowed:true,metadata:{}});
      for (const role of ['anon','public_probe'])
        for (const table of ['app_notes','app_record_links']) await assert.rejects(as(role,null,`select * from public.${table}`), {code:'42501'});
      for (const subject of [null,STRANGER]) {
        assert.equal((await as('authenticated',subject,'select * from public.app_notes')).rowCount,0);
        assert.equal((await as('authenticated',subject,'update public.app_notes set ai_export_allowed=false')).rowCount,0);
        assert.equal((await as('authenticated',subject,'delete from public.app_record_links')).rowCount,0);
        await assert.rejects(as('authenticated',subject,noteSQL,['',JSON.stringify([attachment])]), {code:'42501'});
      }
    });
    await t.test('attachment-only notes, limits, JSON types, required keys and AI exclusion', async () => {
      const valid = await asOwner(c => c.query(noteSQL,['',JSON.stringify([attachment])]));
      assert.equal(valid.rows[0].raw_text,'');
      for (const files of [[{...attachment,size_bytes:104857600}],Array.from({length:20},(_,i)=>({...attachment,drive_file_id:'synthetic-'+i}))])
        assert.equal((await as('authenticated',OWNER,noteSQL,['',JSON.stringify(files)])).rowCount,1);
      for (const text of ['x','x'.repeat(20000),' \n ']) assert.equal((await as('authenticated',OWNER,noteSQL,[text,'[]'])).rowCount,1);
      for (const [text, files] of [['',[]],['x'.repeat(20001),[attachment]],['x',{}],['x',null],['x',[null]],['x',[{}]],
        ['x',[{...attachment,drive_file_id:''}]],['x',[{...attachment,file_name:null}]],['x',[{...attachment,mime_type:7}]],
        ['x',[{...attachment,size_bytes:0}]],['x',[{...attachment,size_bytes:104857601}]],['x',[{...attachment,size_bytes:1.5}]],
        ['x',[{...attachment,size_bytes:'42'}]],['x',[{...attachment,base64:'no'}]],['x',Array(21).fill(attachment)],['', [[]]],['x',[[attachment]]],['x',[Array(21).fill(attachment)]],['x',[attachment,[attachment]]],['x',[{...attachment,drive_file_id:['synthetic-file']}]],['x',[{...attachment,size_bytes:[42]}]]])
        await assert.rejects(as('authenticated',OWNER,noteSQL,[text,JSON.stringify(files)]), {code:'23514'});
      await assert.rejects(as('authenticated',OWNER,noteSQL,['x',null]), {code:'23502'});
      for (const metadata of ['[]','null','1','"x"']) await assert.rejects(as('authenticated',OWNER,
        `update public.app_notes set metadata=$1::jsonb`,[metadata]), {code:'23514'});
      await asOwner(async c => {
        await c.query(`update public.app_notes set ai_export_allowed=false,archived_at=now(),metadata='{"request_id":"synthetic"}'`);
        assert.equal((await c.query('select ai_export_allowed from public.app_notes')).rows[0].ai_export_allowed,false);
      });
      await assert.rejects(as('authenticated',OWNER,'update public.app_notes set ai_export_allowed=null'),{code:'23502'});
    });
    const docLink = `insert into public.app_record_links(workspace_id,note_id,document_id,status) values ('${WS_A}','${oldNote.id}','${DOC_A}','suggested')`;
    await t.test('document target, duplicate prevention, source/target/status and report regressions', async () => {
      assert.equal((await as('authenticated',OWNER,docLink)).rowCount,1);
      await assert.rejects(asOwner(async c => {await c.query(docLink); await c.query(docLink.replace("'suggested'","'confirmed'"));}),{code:'23505'});
      assert.equal((await as('authenticated',OWNER,`insert into public.app_record_links(workspace_id,google_task_id,google_tasklist_id,task_completed,document_id) values ('${WS_A}','doc-task','@default',false,'${DOC_A}')`)).rowCount,1);
      for (const [col,id] of [['project_id',PROJECT_A],['organization_id',ORG_A],['meeting_id',MEETING_A]]) {
        await assert.rejects(as('authenticated',OWNER,`update public.app_record_links set document_id='${DOC_A}' where ${col}='${id}'`),{code:'23514'});
        assert.equal((await as('authenticated',OWNER,`select * from public.app_record_links where ${col}='${id}'`)).rowCount,2);
      }
      for (const status of ['unclassified','archived','other']) await assert.rejects(as('authenticated',OWNER,docLink.replace("'suggested'",`'${status}'`)),{code:'23514'});
      for (const kind of ['business','organization',null]) await as('authenticated',OWNER,`update public.app_record_links set report_kind=$1`,[kind]);
      await assert.rejects(as('authenticated',OWNER,`update public.app_record_links set report_kind='library'`),{code:'23514'});
      await assert.rejects(as('authenticated',OWNER,`update public.app_record_links set note_id='${oldNote.id}' where google_task_id is not null`),{code:'23514'});
      await assert.rejects(as('authenticated',OWNER,docLink.replace(DOC_A,DOC_B)),{code:'42501'});
      await assert.rejects(as('authenticated',STRANGER,docLink),{code:'42501'});
      await assert.rejects(asOwner(async c => {await c.query(docLink); await c.query(`update public.app_record_links set document_id='${DOC_B}' where document_id is not null`);}),{code:'42501'});
      const c=await pool.connect();
      try {await c.query('begin'); await c.query(docLink); await c.query(`delete from public.app_documents where id='${DOC_A}'`);
        assert.equal((await c.query('select * from public.app_record_links where document_id is not null')).rowCount,0);
      } finally {await c.query('rollback'); c.release();}
    });
    await t.test('rollback refuses used columns atomically; immediate rollback restores schema and reapply succeeds', async () => {
      for (const sql of [`update public.app_notes set metadata='{"used":true}'`,`update public.app_notes set archived_at=now()`,
        'update public.app_notes set ai_export_allowed=false',`update public.app_notes set attachments='${JSON.stringify([attachment])}'`,docLink]) {
        await pool.query(sql);
        await assert.rejects(pool.query(rollback),/BASKET-1 rollback blocked/);
        await pool.query('rollback');
        assert.equal((await pool.query(`select count(*)::int n from supabase_migrations.schema_migrations where version='20261010120000'`)).rows[0].n,1);
        await pool.query(`update public.app_notes set metadata='{}',attachments='[]',archived_at=null,ai_export_allowed=true; delete from public.app_record_links where document_id is not null`);
      }
      await pool.query(rollback);
      assert.deepEqual(await schema(),beforeSchema);
      assert.deepEqual(await existingRows(),baseline.notes);
      assert.deepEqual(await links(),baseline.links);
      assert.deepEqual(await acl(),baseline.acl);
      await pool.query(migration);
      assert.equal((await pool.query(`select count(*)::int n from supabase_migrations.schema_migrations where version='20261010120000' and name='basket1_notes_links'`)).rows[0].n,1);
      assert.equal((await as('authenticated',OWNER,noteSQL,['',JSON.stringify([attachment])])).rowCount,1);
    });
  } finally {if(pool) {await pool.end(); await Promise.all(clientEnds);} await cluster.stop();}
});
