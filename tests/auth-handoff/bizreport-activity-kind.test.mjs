// Fresh local PostgreSQL 17 only. No Supabase, Google or production credentials.
// MTG-사업보고 DB-1: app_meetings.activity_kind text not null default 'meeting' + CHECK (8 kinds) through the approved DB workflow runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {trackPool,closePool} from './pg-close.mjs';
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,MEETING_A,MEETING_B} from './basket4-fixture.mjs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261022182319',name='bizreport_activity_kind',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const MEETING_A2='25000000-0000-4000-8000-000000000003';
const KINDS=['meeting','policy','negotiation','press','assembly','struggle','education','other'];
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Production-like prerequisites: app_meetings with the columns the app uses (incl. location), task12a owner RLS,
// authenticated table privileges only, anon revoked; app_record_links with a meeting FK; a workspace trigger.
// Read-only workflow requests run as a non-owner pg_read_all_data role (information_schema hides rows there, #978).
const prerequisites=`
  alter table public.app_meetings
    add column series_name text, add column meeting_at timestamptz, add column project_id uuid references public.app_spaces(id) on delete set null,
    add column location text, add column transcript_text text, add column notes text, add column decisions text,
    add column created_at timestamptz not null default now(), add column updated_at timestamptz not null default now();
  alter table public.app_meetings enable row level security;
  create policy task12a_owner_all on public.app_meetings for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke all on public.app_meetings from public, anon, authenticated, service_role;
  grant select, insert, update, delete on public.app_meetings to authenticated;
  grant select, insert, update, delete on public.app_meetings to service_role;
  create function private.app_touch_meeting() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
  create trigger app_meetings_touch before update on public.app_meetings for each row execute function private.app_touch_meeting();
  create table public.app_record_links(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id),
    google_task_id text, note_id uuid, meeting_id uuid references public.app_meetings(id) on delete cascade,
    project_id uuid references public.app_spaces(id) on delete cascade);
  alter table public.app_record_links enable row level security;
  create policy task12a_owner_all on public.app_record_links for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke all on public.app_record_links from public, anon;
  update public.app_meetings set title='회의', series_name='궤도집행국회의', meeting_at=now(), location='본부 회의실' where id='${MEETING_A}';
  insert into public.app_meetings(id, workspace_id, title, project_id) values ('${MEETING_A2}', '${WS_A}', '기자회견', '${PROJECT_A}');
  insert into public.app_record_links(workspace_id, google_task_id, meeting_id) values ('${WS_A}', 'task-1', '${MEETING_A}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
`;

test('bizreport activity kind: read-only precheck, dry-run, apply, CHECK, owner RLS and guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'bizreport-kind-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  assert.match((await pool.query('show server_version')).rows[0].server_version,/^17\./);
  await pool.query(fixture);
  await pool.query(prerequisites);
  const rollbackSQL=await read('docs/'+stem+'.rollback.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql'),preserve=await read('docs/'+stem+'.preserve.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  // Read-only requests as the non-owner read-only role, like the production SQL endpoint.
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  const saveSnapshot=async()=>{};
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('precheck as the read-only role: expected values and the design 9 records',()=>{
   const v=values(beforeCheck);
   assert.deepEqual([v['new migration absent'],v['meetings table exists'],v['new column count'],v['new check count'],v['RLS enabled'],
    v['anon or public table privilege'],v['owner policy only (task12a shape)']],['예','예','0','0','예','아니오','예']);
   assert.deepEqual([v['location column count'],v['location column is text'],v['location filled rows'],v['updated_at has default'],
    v['meetings rows'],v['meetings with project rows'],v['record links rows'],v['record links FKs to meetings'],v['record links source_meeting_id column count']],
    ['1','예','1','예','3','1','1','1','0']);
   // The read-only role sees the same values as the table owner (no information_schema dependence).
   return pool.query(precheck).then(r=>assert.deepEqual(r.rows,beforeCheck));
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9701');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await readOnly(precheck),beforeCheck);
  });
  await t.test('apply passes postcheck (read-only role); every meeting is meeting; grants, policies, triggers unchanged',async()=>{
   const apply=await run('apply','9702');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck)),pre=values(beforeCheck);
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);else assert.equal(value,pre[item],item);
   }
   assert.deepEqual((await pool.query('select distinct activity_kind from public.app_meetings')).rows,[{activity_kind:'meeting'}]);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid='public.app_meetings'::regclass")).rows[0].n,1);
   // PostgreSQL 17 constraint texts (production is 17). The migration guard and postcheck also accept the 16 shape (one more outer pair, #980).
   const list="ARRAY['meeting'::text, 'policy'::text, 'negotiation'::text, 'press'::text, 'assembly'::text, 'struggle'::text, 'education'::text, 'other'::text]";
   assert.equal((await pool.query("select check_clause from information_schema.check_constraints where constraint_name='app_meetings_activity_kind_check'")).rows[0].check_clause,`(activity_kind = ANY (${list}))`);
   assert.equal((await pool.query("select pg_get_constraintdef(oid) d from pg_constraint where conname='app_meetings_activity_kind_check'")).rows[0].d,`CHECK ((activity_kind = ANY (${list})))`);
   // Location column untouched (not added, not changed).
   assert.equal((await pool.query("select location from public.app_meetings where id=$1",[MEETING_A])).rows[0].location,'본부 회의실');
  });
  await t.test('re-apply is refused by the history check',async()=>{
   const again=await run('apply','9703');assert.equal(again.ok,false);
  });
  await t.test('the CHECK accepts exactly the eight kinds; owner RLS stays the boundary',async()=>{
   for(const kind of KINDS)assert.equal((await as('authenticated',OWNER,c=>c.query('update public.app_meetings set activity_kind=$1 where id=$2',[kind,MEETING_A]))).rowCount,1,kind);
   for(const bad of ['Meeting','기타','',' meeting','meeting ','rally'])
    await assert.rejects(as('authenticated',OWNER,c=>c.query('update public.app_meetings set activity_kind=$1 where id=$2',[bad,MEETING_A])),{code:'23514'},bad);
   await assert.rejects(as('authenticated',OWNER,c=>c.query('update public.app_meetings set activity_kind=null where id=$1',[MEETING_A])),{code:'23502'});
   // A save that does not know the column (today's screen/Edge) still lands as meeting.
   const id='25000000-0000-4000-8000-000000000009';
   await as('authenticated',OWNER,c=>c.query("insert into public.app_meetings(id,workspace_id,title) values ($1,$2,'새 회의')",[id,WS_A]));
   assert.equal((await pool.query('select activity_kind from public.app_meetings where id=$1',[id])).rows[0].activity_kind,'meeting');
   await pool.query('delete from public.app_meetings where id=$1',[id]);
   // Another workspace's meeting is neither visible nor writable; anon has no access.
   assert.equal((await as('authenticated',OWNER,c=>c.query("update public.app_meetings set activity_kind='press' where id=$1",[MEETING_B]))).rowCount,0);
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_meetings(id,workspace_id,activity_kind) values ('25000000-0000-4000-8000-00000000000a',$1,'press')",[WS_B])),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query('select activity_kind from public.app_meetings limit 1')),{code:'42501'});
   assert.equal((await as('authenticated',STRANGER,c=>c.query("update public.app_meetings set activity_kind='press' where id=$1",[MEETING_A]))).rowCount,0);
   await pool.query("update public.app_meetings set activity_kind='meeting' where id=$1",[MEETING_A]);
  });
  await t.test('rollback refuses while a non-meeting kind is saved; preserve reads id and kind only',async()=>{
   await pool.query("update public.app_meetings set activity_kind='press' where id=$1",[MEETING_A2]);
   const result=await run('rollback','9704');assert.equal(result.ok,false,result.summary);
   const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/BIZREPORT_ACTIVITY_KIND_ROLLBACK_BLOCKED: non-meeting kinds saved/);await c.query('rollback');}finally{c.release();}
   assert.equal((await pool.query('select activity_kind from public.app_meetings where id=$1',[MEETING_A2])).rows[0].activity_kind,'press');
   const kept=await readOnly(preserve);
   assert.deepEqual(kept,[{id:MEETING_A2,activity_kind:'press'}]);
  });
  await t.test('rollback restores the original schema once every kind is meeting; re-apply works',async()=>{
   await pool.query("update public.app_meetings set activity_kind='meeting' where activity_kind<>'meeting'");
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const post=values(await readOnly(postcheck));
   assert.equal(post['column check and history agree'],'예');assert.equal(post['every meeting is the meeting kind (or no column)'],'예');
   const again=await run('apply','9705');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
