// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic.
// ED③ prerequisite: 20261023232000_project_records_policies_authenticated narrows the four production-only policies of
// app_project_progress_updates from PUBLIC to authenticated (same using/with check). Reproduces the run #58 stop
// (ED③ precheck `anon or public policy = 예`), then shows: owner read/write identical before and after, stranger and anon
// refused, guards stop on any other shape, ED③ applies unchanged afterwards, and the paired rollback restores PUBLIC.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {fixture,OWNER,STRANGER,WS_A,ORG_A,PROJECT_A} from './basket4-fixture.mjs';
const stem='20261023232000_project_records_policies_authenticated',edStem='20261023233000_ed_format_columns';
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Production shape (docs/web2-task-impl-plan.md, 2026-09-27: "roles=public, 공간 권한 함수 기반 4개"): four PUBLIC policies on the
// project records table, table grants for authenticated (and service_role) only. Policy names here are synthetic stand-ins.
const recordTables=`
  create table public.app_suborganization_updates(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, organization_id uuid not null,
    raw_text text not null check (length(raw_text) between 1 and 20000), occurred_at timestamptz);
  alter table public.app_suborganization_updates enable row level security;
  create policy task12a_owner_all on public.app_suborganization_updates for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke all on public.app_suborganization_updates from public, anon, authenticated;
  grant select, insert, update, delete on public.app_suborganization_updates to authenticated;
  create table public.app_project_progress_updates(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid not null,
    summary text check (length(summary) <= 500), effective_on date);
  alter table public.app_project_progress_updates enable row level security;
  create policy synthetic_progress_read on public.app_project_progress_updates for select using (private.app_is_workspace_owner(workspace_id));
  create policy synthetic_progress_insert on public.app_project_progress_updates for insert with check (private.app_is_workspace_owner(workspace_id));
  create policy synthetic_progress_update on public.app_project_progress_updates for update using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  create policy synthetic_progress_delete on public.app_project_progress_updates for delete using (private.app_is_workspace_owner(workspace_id));
  revoke all on public.app_project_progress_updates from public, anon, authenticated;
  grant select, insert, update, delete on public.app_project_progress_updates to authenticated;
  insert into supabase_migrations.schema_migrations(version,name) values('20261023180000','profile_view_prefs');
`;

test('project records policies: PUBLIC -> authenticated, same conditions, ED③ unblocked, rollback',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'prj-policies-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false});
  await pool.query(fixture);
  for(const file of ['20260927103344_task_impl2_notes_record_links.sql','20260928123601_task_meeting_followup_record_links.sql'])await pool.query(await read('supabase/migrations/'+file));
  await pool.query(`create table public.app_documents(id uuid primary key,workspace_id uuid);alter table public.app_spaces add column owner_id uuid default '${OWNER}',add column name text,add column parent_id uuid,add column status text default 'active',add column metadata jsonb default '{"project_system":"v2"}';grant select,update on public.app_spaces to authenticated;alter table public.app_spaces enable row level security;create policy synthetic_spaces_owner on public.app_spaces for all to authenticated using(private.app_is_workspace_owner(workspace_id)) with check(private.app_is_workspace_owner(workspace_id));`);
  for(const file of ['20261010120000_basket1_notes_links.sql','20261011180000_basket4a_confirm_links.sql','20261012100000_basket_link_view_db.sql','20261013034836_basket_photo_ocr_db.sql','20261017052234_journal_memo_notes_kind.sql'])await pool.query(await read('supabase/migrations/'+file));
  await pool.query(recordTables);
  await pool.query("insert into public.app_project_progress_updates(workspace_id,project_id,summary) values($1,$2,'기존 기록')",[WS_A,PROJECT_A]);
  await pool.query("insert into public.app_suborganization_updates(workspace_id,organization_id,raw_text) values($1,$2,'조직 기록')",[WS_A,ORG_A]);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const edMigration=await read('supabase/migrations/'+edStem+'.sql'),edPrecheck=await read('docs/'+edStem+'.precheck.sql');
  const v=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('rollback');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const expectStop=async(sql,pattern,label)=>{const c=await pool.connect();try{await assert.rejects(c.query(sql),pattern,label);}finally{await c.query('rollback').catch(()=>{});c.release();}};
  // Owner/stranger/anon behaviour, each statement inside a rolled-back transaction (no data left behind).
  const behaviour=async()=>{
   const out={};
   out.ownerRead=(await as('authenticated',OWNER,c=>c.query('select summary from public.app_project_progress_updates order by summary'))).rows.map(r=>r.summary);
   out.ownerInsert=(await as('authenticated',OWNER,c=>c.query("insert into public.app_project_progress_updates(workspace_id,project_id,summary) values($1,$2,'새 기록')",[WS_A,PROJECT_A]))).rowCount;
   out.ownerUpdate=(await as('authenticated',OWNER,c=>c.query("update public.app_project_progress_updates set summary='고친 기록'"))).rowCount;
   out.ownerDelete=(await as('authenticated',OWNER,c=>c.query('delete from public.app_project_progress_updates'))).rowCount;
   out.strangerRead=(await as('authenticated',STRANGER,c=>c.query('select 1 from public.app_project_progress_updates'))).rowCount;
   out.strangerUpdate=(await as('authenticated',STRANGER,c=>c.query("update public.app_project_progress_updates set summary='남'"))).rowCount;
   out.strangerDelete=(await as('authenticated',STRANGER,c=>c.query('delete from public.app_project_progress_updates'))).rowCount;
   await assert.rejects(as('authenticated',STRANGER,c=>c.query("insert into public.app_project_progress_updates(workspace_id,project_id,summary) values($1,$2,'남의 기록')",[WS_A,PROJECT_A])),{code:'42501'});
   for(const sql of ['select 1 from public.app_project_progress_updates',"update public.app_project_progress_updates set summary='x'",'delete from public.app_project_progress_updates'])
    await assert.rejects(as('anon','',c=>c.query(sql)),{code:'42501'},'anon '+sql);
   out.serviceRead=(await as('service_role','',c=>c.query('select 1 from public.app_project_progress_updates'))).rowCount;
   return out;
  };
  const before=await behaviour(),beforeCheck=v((await pool.query(precheck)).rows),beforeSnapshot=(await pool.query(snapshot)).rows;

  await t.test('reproduces run #58: ED③ precheck reports a PUBLIC policy and the ED③ migration stops',async()=>{
   const ed=v((await pool.query(edPrecheck)).rows);
   assert.equal(ed['anon or public table privilege'],'아니오');assert.equal(ed['anon or public policy'],'예');
   assert.equal(ed['project records policies count'],'4');assert.equal(ed['org updates policies count'],'1');assert.equal(ed['notes policies count'],'1');
   await expectStop(edMigration,/ED_FORMAT_COLUMNS_PREREQUISITE_CHANGED/,'ED③ stops');
  });
  await t.test('precheck: four PUBLIC-only policies, no anon policy, no anon/PUBLIC table grant',()=>{
   for(const k of ['prerequisite recorded','new migration absent','table exists','RLS enabled and not forced','table grants only owner authenticated service_role or bypass roles'])assert.equal(beforeCheck[k],'예',k);
   for(const k of ['anon or public table privilege','anon policy'])assert.equal(beforeCheck[k],'아니오',k);
   assert.deepEqual([beforeCheck['policies count'],beforeCheck['public-only policies count'],beforeCheck['authenticated-only policies count'],beforeCheck.rows],['4','4','0','1']);
   assert.ok(beforeSnapshot.filter(r=>r.kind==='policy').every(r=>/:roles=PUBLIC:/.test(r.definition)));
  });
  await t.test('any other shape stops the migration without change',async()=>{
   const attempts=[
    ["create policy synthetic_fifth on public.app_project_progress_updates for select to authenticated using (false)",'drop policy synthetic_fifth on public.app_project_progress_updates'],
    ['alter policy synthetic_progress_read on public.app_project_progress_updates to anon','alter policy synthetic_progress_read on public.app_project_progress_updates to public'],
    ['alter policy synthetic_progress_read on public.app_project_progress_updates to authenticated','alter policy synthetic_progress_read on public.app_project_progress_updates to public'],
    ['alter policy synthetic_progress_read on public.app_project_progress_updates to authenticated, public_probe','alter policy synthetic_progress_read on public.app_project_progress_updates to public'],
    ['alter table public.app_project_progress_updates force row level security','alter table public.app_project_progress_updates no force row level security'],
    ['alter table public.app_project_progress_updates disable row level security','alter table public.app_project_progress_updates enable row level security'],
    ['grant select on public.app_project_progress_updates to anon','revoke select on public.app_project_progress_updates from anon'],
    ['grant select on public.app_project_progress_updates to public_probe','revoke select on public.app_project_progress_updates from public_probe'],
    ["delete from supabase_migrations.schema_migrations where version='20261023180000'","insert into supabase_migrations.schema_migrations(version,name) values('20261023180000','profile_view_prefs')"],
   ];
   for(const [breakIt,fixIt] of attempts){
    await pool.query(breakIt);
    try{await expectStop(migration,/PROJECT_RECORDS_POLICIES_PREREQUISITE_CHANGED/,breakIt);}finally{await pool.query(fixIt);}
   }
   assert.deepEqual((await pool.query(snapshot)).rows,beforeSnapshot);assert.deepEqual(v((await pool.query(precheck)).rows),beforeCheck);
  });
  await t.test('apply narrows only the roles: conditions, grants and rows identical; owner same, stranger and anon refused',async()=>{
   await pool.query(migration);
   const post=v((await pool.query(postcheck)).rows);
   for(const [k,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',k);else assert.equal(value,beforeCheck[k],k);
   }
   const pre=v((await pool.query(precheck)).rows);
   assert.deepEqual([pre['public-only policies count'],pre['authenticated-only policies count'],pre['anon policy']],['0','4','아니오']);
   assert.equal(pre['policy conditions hash'],beforeCheck['policy conditions hash']);
   assert.ok((await pool.query(snapshot)).rows.filter(r=>r.kind==='policy').every(r=>/:roles=authenticated:/.test(r.definition)));
   assert.deepEqual(await behaviour(),before);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version='20261023232000' and name='project_records_policies_authenticated'")).rows[0].n,1);
   await expectStop(migration,/PROJECT_RECORDS_POLICIES_PREREQUISITE_CHANGED/,'second apply stops');
  });
  await t.test('ED③ precheck now passes and the unchanged ED③ migration applies',async()=>{
   const ed=v((await pool.query(edPrecheck)).rows);
   assert.equal(ed['anon or public policy'],'아니오');assert.equal(ed['anon or public table privilege'],'아니오');
   await pool.query(edMigration);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version='20261023233000'")).rows[0].n,1);
   assert.deepEqual(await behaviour(),before);
  });
  await t.test('rollback restores the four PUBLIC policies with the same conditions and removes the record',async()=>{
   await pool.query("alter policy synthetic_progress_read on public.app_project_progress_updates to public");
   await expectStop(rollbackSQL,/PROJECT_RECORDS_POLICIES_ROLLBACK_BLOCKED: policies changed after apply/,'changed policy blocks rollback');
   await pool.query("alter policy synthetic_progress_read on public.app_project_progress_updates to authenticated");
   await pool.query(rollbackSQL);
   const back=v((await pool.query(precheck)).rows);
   for(const k of ['public-only policies count','authenticated-only policies count','policy conditions hash','policy names hash','owner RLS grants hash','triggers hash','indexes hash'])assert.equal(back[k],beforeCheck[k],k);
   // ED③ (applied above) added the doc column and its CHECK, so only those hashes differ from the first precheck.
   assert.equal(back['new migration absent'],'예');
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   await expectStop(rollbackSQL,/PROJECT_RECORDS_POLICIES_ROLLBACK_BLOCKED: migration record differs/,'second rollback stops');
   await pool.query(migration);
   assert.equal(v((await pool.query(precheck)).rows)['authenticated-only policies count'],'4');
  });
 }finally{
  if(pool)await pool.end();await cluster.stop().catch(()=>{});
 }
});
