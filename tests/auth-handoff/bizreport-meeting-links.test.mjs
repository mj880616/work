// Fresh local PostgreSQL 17 only. No Supabase, Google or production credentials.
// MTG-사업보고 DB-2 + MEET-기록보내기 B1: app_record_links.source_meeting_id, restrictive workspace policy,
// app_meeting_set_links (INVOKER), project_id backfill, app_meetings.location if missing — through the approved DB workflow runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,PROJECT_A2,PROJECT_B,ORG_A,ORG_B,MEETING_A,MEETING_B} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261023023500',name='bizreport_meeting_links',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const MEETING_A2='25000000-0000-4000-8000-000000000003';
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Production-like app_meetings (owner RLS, anon revoked, updated_at touch trigger, no location column) and
// the record-links chain from the repository migrations (task → meeting target → document target → summary).
const spaces=`create table public.app_documents(id uuid primary key, workspace_id uuid);
  alter table public.app_spaces add column owner_id uuid default '${OWNER}', add column name text, add column parent_id uuid,
    add column status text default 'active', add column metadata jsonb default '{"project_system":"v2"}';
  grant select, update on public.app_spaces to authenticated; alter table public.app_spaces enable row level security;
  create policy spaces_owner on public.app_spaces for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));`;
const meetings=`
  alter table public.app_meetings
    add column series_name text, add column project_id uuid references public.app_spaces(id) on delete set null,
    add column created_at timestamptz not null default now(), add column updated_at timestamptz not null default now();
  alter table public.app_meetings enable row level security;
  create policy task12a_owner_all on public.app_meetings for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke all on public.app_meetings from public, anon, authenticated, service_role;
  grant select, insert, update, delete on public.app_meetings to authenticated, service_role;
  create function private.app_touch_meeting() returns trigger language plpgsql as $$ begin new.updated_at = clock_timestamp(); return new; end $$;
  create trigger app_meetings_touch before update on public.app_meetings for each row execute function private.app_touch_meeting();
  update public.app_meetings set project_id='${PROJECT_A}' where id='${MEETING_A}';
  update public.app_meetings set project_id='${PROJECT_B}' where id='${MEETING_B}';
  insert into public.app_meetings(id, workspace_id, title) values ('${MEETING_A2}', '${WS_A}', '기자회견');
  insert into public.app_record_links(workspace_id, google_task_id, google_tasklist_id, task_completed, meeting_id)
    values ('${WS_A}', 'task-1', 'list-1', false, '${MEETING_A}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;

test('bizreport meeting links: precheck, dry-run, apply, function, owner/workspace boundary, guarded rollback',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'bizreport-links-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false});
  await pool.query(fixture);
  for(const file of ['20260927103344_task_impl2_notes_record_links.sql','20260928123601_task_meeting_followup_record_links.sql'])await pool.query(await read('supabase/migrations/'+file));
  await pool.query(spaces);
  for(const file of ['20261010120000_basket1_notes_links.sql','20261011180000_basket4a_confirm_links.sql','20261012100000_basket_link_view_db.sql'])await pool.query(await read('supabase/migrations/'+file));
  await pool.query(meetings);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,preserve]=await Promise.all(['precheck','postcheck','snapshot','rollback','preserve'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const rawStamp=async id=>(await pool.query("select to_char(updated_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') s from public.app_meetings where id=$1",[id])).rows[0].s;
  const setLinks=(meeting,updated,targets,sub=OWNER)=>as('authenticated',sub,async c=>(await c.query('select public.app_meeting_set_links($1,$2,$3::jsonb) r',[meeting,updated,JSON.stringify(targets)])).rows[0].r);
  const sourceLinks=async id=>(await pool.query('select organization_id,project_id,status,report_kind,summary from public.app_record_links where source_meeting_id=$1 order by organization_id nulls last,project_id',[id])).rows;
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('approval plan: expanded rules, full flow, review counts; plan input by file name',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.targets,['app_meetings','app_record_links']);assert.deepEqual(plan.functions,['public.app_meeting_set_links']);
   assert.deepEqual(plan.review,{definer:[],policies:1,restrictive:1,grants:1,triggers:0,revokes:1});
   assert.equal(prepareMigration({mode:'dry-run',version,runId:'1',root}).flow,'full');
   assert.match(toDryRun(migration),/rollback;\s*$/);
  });
  await t.test('precheck as the read-only role: expected values; owner sees the same',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.deepEqual([v['source meeting column count'],v['record links FKs to meetings'],v['location column count'],v['location over 200 rows'],
    v['meetings rows'],v['meetings with project rows'],v['record links rows']],['0','1','0','0','3','2','1']);
   assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('a different meeting FK name stops the migration before any change',async()=>{
   await pool.query('alter table public.app_record_links rename constraint app_record_links_meeting_id_fkey to app_record_links_meeting_fk');
   assert.equal(values(await readOnly(precheck))['meeting FK name is app_record_links_meeting_id_fkey'],'아니오');
   const c=await pool.connect();try{await assert.rejects(c.query(migration),/BIZREPORT_MEETING_LINKS_PREREQUISITE_CHANGED/);await c.query('rollback');}finally{c.release();}
   await pool.query('alter table public.app_record_links rename constraint app_record_links_meeting_fk to app_record_links_meeting_id_fkey');
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('an existing location column is kept (not re-added); a long location stops the migration',async()=>{
   await pool.query("alter table public.app_meetings add column location text; update public.app_meetings set location='본부 회의실' where id='"+MEETING_A+"'");
   await pool.query(toDryRun(migration));
   await pool.query("update public.app_meetings set location=repeat('가',201) where id='"+MEETING_A+"'");
   const c=await pool.connect();try{await assert.rejects(c.query(migration),/BIZREPORT_MEETING_LINKS_PREREQUISITE_CHANGED/);await c.query('rollback');}finally{c.release();}
   await pool.query('alter table public.app_meetings drop column location');
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9801');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await readOnly(precheck),beforeCheck);
  });
  await t.test('apply passes postcheck; project_id backfilled once; location added; old links untouched',async()=>{
   const apply=await run('apply','9802');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck)),pre=values(beforeCheck);
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else if(pre[item]!==undefined)assert.equal(value,pre[item],item);
   }
   assert.equal(post['meeting source links'],'2');assert.equal(post['record links rows without meeting source'],'1');
   assert.deepEqual(await sourceLinks(MEETING_A),[{organization_id:null,project_id:PROJECT_A,status:'confirmed',report_kind:'business',summary:null}]);
   assert.equal((await pool.query("select count(*)::int n from public.app_record_links where google_task_id='task-1' and meeting_id=$1",[MEETING_A])).rows[0].n,1);
   assert.equal((await pool.query("select data_type from information_schema.columns where table_name='app_meetings' and column_name='location'")).rows[0].data_type,'text');
   assert.deepEqual((await pool.query("select conname from pg_constraint where conrelid='public.app_record_links'::regclass and contype='f' and confrelid='public.app_meetings'::regclass order by 1")).rows.map(r=>r.conname),
    ['app_record_links_meeting_id_fkey','app_record_links_source_meeting_id_fkey']);
   const again=await run('apply','9803');assert.equal(again.ok,false);
  });
  await t.test('location: blank allowed, 200 chars ok, 201 refused',async()=>{
   for(const v of [null,'',"가".repeat(200)])assert.equal((await as('authenticated',OWNER,c=>c.query('update public.app_meetings set location=$1 where id=$2',[v,MEETING_A2]))).rowCount,1);
   await assert.rejects(as('authenticated',OWNER,c=>c.query('update public.app_meetings set location=$1 where id=$2',['가'.repeat(201),MEETING_A2])),{code:'23514'});
  });
  await t.test('app_meeting_set_links: add, keep, summary, remove, first project, version, limits',async()=>{
   let r=await setLinks(MEETING_A2,await rawStamp(MEETING_A2),[{kind:'organization',target_id:ORG_A},{kind:'project',target_id:PROJECT_A2},{kind:'project',target_id:PROJECT_A}]);
   assert.equal(r.ok,true,JSON.stringify(r));assert.deepEqual([r.created,r.existing,r.removed,r.project_id],[3,0,0,PROJECT_A2]);
   assert.equal((await pool.query('select project_id from public.app_meetings where id=$1',[MEETING_A2])).rows[0].project_id,PROJECT_A2);
   // Stale version is refused without change.
   assert.deepEqual(await setLinks(MEETING_A2,'2000-01-01T00:00:00Z',[]),{ok:false,error:'MEETING_CHANGED'});
   // Summary (보낸 기록) is set only when sent; re-selecting without summary keeps it.
   r=await setLinks(MEETING_A2,r.updated_at,[{kind:'organization',target_id:ORG_A,summary:'보낸 글'},{kind:'project',target_id:PROJECT_A2},{kind:'project',target_id:PROJECT_A}]);
   assert.deepEqual([r.ok,r.created,r.existing,r.removed],[true,0,3,0]);
   r=await setLinks(MEETING_A2,r.updated_at,[{kind:'project',target_id:PROJECT_A},{kind:'organization',target_id:ORG_A}]);
   assert.deepEqual([r.ok,r.created,r.existing,r.removed,r.project_id],[true,0,2,1,PROJECT_A]);
   assert.deepEqual(await sourceLinks(MEETING_A2),[
    {organization_id:ORG_A,project_id:null,status:'confirmed',report_kind:'organization',summary:'보낸 글'},
    {organization_id:null,project_id:PROJECT_A,status:'confirmed',report_kind:'business',summary:null}]);
   // Invalid inputs: other workspace, duplicate, unknown key, bad kind, blank summary, more than 20, archived project.
   const now=await rawStamp(MEETING_A2);
   // Another workspace's organization/project is invisible under owner RLS (INVOKER), so it is missing, never linked.
   assert.equal((await setLinks(MEETING_A2,now,[{kind:'organization',target_id:ORG_B}])).error,'TARGET_MISSING');
   assert.equal((await setLinks(MEETING_A2,now,[{kind:'project',target_id:PROJECT_B}])).error,'TARGET_MISSING');
   for(const bad of [[{kind:'project',target_id:PROJECT_A},{kind:'project',target_id:PROJECT_A}],[{kind:'project',target_id:PROJECT_A,reason:'x'}],
     [{kind:'meeting',target_id:MEETING_A}],[{kind:'project',target_id:PROJECT_A,summary:'  '}],
     Array.from({length:21},(_,i)=>({kind:'organization',target_id:'23000000-0000-4000-8000-'+String(100+i).padStart(12,'0')}))])
    assert.equal((await setLinks(MEETING_A2,now,bad)).error,'INVALID_TARGETS');
   await pool.query("update public.app_spaces set status='archived' where id=$1",[PROJECT_A2]);
   assert.equal((await setLinks(MEETING_A2,now,[{kind:'project',target_id:PROJECT_A2}])).error,'TARGET_UNSELECTABLE');
   await pool.query("update public.app_spaces set status='active' where id=$1",[PROJECT_A2]);
   assert.equal(await rawStamp(MEETING_A2),now);
   assert.equal((await sourceLinks(MEETING_A2)).length,2);
   // Empty list clears every link and the single project column.
   r=await setLinks(MEETING_A2,now,[]);assert.deepEqual([r.ok,r.removed,r.project_id],[true,2,null]);
   assert.deepEqual(await sourceLinks(MEETING_A2),[]);
  });
  await t.test('owner/workspace boundary: stranger, anon, direct cross-workspace rows, shapes',async()=>{
   assert.deepEqual(await setLinks(MEETING_A2,await rawStamp(MEETING_A2),[],STRANGER),{ok:false,error:'MEETING_MISSING'});
   await assert.rejects(as('anon','',c=>c.query("select public.app_meeting_set_links($1,now(),'[]'::jsonb)",[MEETING_A2])),{code:'42501'});
   // A row in workspace A whose source meeting is in workspace B: refused by the restrictive policy.
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_record_links(workspace_id,source_meeting_id,organization_id) values ($1,$2,$3)",[WS_A,MEETING_B,ORG_A])),{code:'42501'});
   // Shape: one source; no meeting/document target; confirmed only.
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_record_links(workspace_id,source_meeting_id,google_task_id,google_tasklist_id,task_completed,organization_id) values ($1,$2,'t','l',false,$3)",[WS_A,MEETING_A2,ORG_A])),{code:'23514'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_record_links(workspace_id,source_meeting_id,meeting_id) values ($1,$2,$3)",[WS_A,MEETING_A2,MEETING_A])),{code:'23514'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_record_links(workspace_id,source_meeting_id,organization_id,status) values ($1,$2,$3,'suggested')",[WS_A,MEETING_A2,ORG_A])),{code:'23514'});
   // One meeting → one place is one row.
   await as('authenticated',OWNER,c=>c.query("insert into public.app_record_links(workspace_id,source_meeting_id,organization_id) values ($1,$2,$3)",[WS_A,MEETING_A2,ORG_A]));
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_record_links(workspace_id,source_meeting_id,organization_id) values ($1,$2,$3)",[WS_A,MEETING_A2,ORG_A])),{code:'23505'});
   // Stranger (owner of workspace B) sees only workspace B's backfilled row, never workspace A's.
   assert.equal((await as('authenticated',STRANGER,c=>c.query('select count(*)::int n from public.app_record_links where source_meeting_id is not null and workspace_id=$1',[WS_A]))).rows[0].n,0);
   assert.equal((await as('authenticated',STRANGER,c=>c.query('select count(*)::int n from public.app_record_links where source_meeting_id=$1',[MEETING_B]))).rows[0].n,1);
   // Deleting the meeting removes its links (on delete cascade).
   const temp='25000000-0000-4000-8000-00000000000b';
   await pool.query("insert into public.app_meetings(id,workspace_id,title) values ($1,$2,'임시')",[temp,WS_A]);
   await setLinks(temp,await rawStamp(temp),[{kind:'organization',target_id:ORG_A}]);
   await pool.query('delete from public.app_meetings where id=$1',[temp]);
   assert.equal((await sourceLinks(temp)).length,0);
  });
  await t.test('app_basket_confirm_links still works through the same-named unique constraint',async()=>{
   const at='2026-10-23T01:02:03.123456Z',note=(await pool.query("insert into public.app_notes(workspace_id,raw_text,updated_at) values ($1,'메모',$2) returning id",[WS_A,at])).rows[0];
   const call=()=>as('authenticated',OWNER,async c=>(await c.query('select public.app_basket_confirm_links($1,$2,$3::jsonb) r',[note.id,at,JSON.stringify([{kind:'organization',target_id:ORG_A,reason:'이유'}])])).rows[0].r);
   assert.deepEqual(await call(),{ok:true,created:1,existing:0});
   assert.deepEqual(await call(),{ok:true,created:0,existing:1});
  });
  await t.test('rollback (SQL Editor): preserve reads links, then the original schema returns except the kept location column',async()=>{
   const kept=await readOnly(preserve);assert.ok(kept.length>=2);assert.ok(kept.every(r=>r.source_meeting_id));
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   const now=(await pool.query(snapshot)).rows.filter(r=>r.name!=='app_meetings.location');
   assert.deepEqual(now,before);
   assert.equal((await pool.query("select count(*)::int n from public.app_record_links where google_task_id='task-1'")).rows[0].n,1);
   // Re-apply works with the location column now present (not re-added).
   await pool.query("delete from public.app_record_links where note_id is not null");
   const again=await run('apply','9804');assert.equal(again.ok,true,again.summary);
  });
  await t.test('workflow rollback mode is not used for this file (drop policy/function are SQL Editor only)',()=>{
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
  });
 }finally{
  if(pool)await pool.end();await cluster.stop().catch(()=>{});
 }
});
