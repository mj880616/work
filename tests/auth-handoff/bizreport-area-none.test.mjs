// Fresh local PostgreSQL 17 only. No Supabase, Google or production credentials. All data synthetic.
// MTG-사업영역없음 DB: app_meetings.business_area_none boolean not null default false ('사업영역 없음' chosen by the owner)
// through the approved DB workflow runner (expanded rules, full flow), with a guarded SQL Editor rollback.
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
import {fixture,OWNER,STRANGER,WS_A,PROJECT_A,PROJECT_B,MEETING_A} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261030090000',name='bizreport_area_none',stem=version+'_'+name;
const area='20261028191500_bizreport_area_next_plan';
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Production-like app_spaces (owner RLS) and app_meetings (owner RLS + trash restrictive policy, eight-kind CHECK, anon revoked,
// updated_at touch trigger) — the shape after 20261022182319·20261023023500·20261025100000; then 20261028191500 applied as is.
const schema=`
  alter table public.app_spaces add column name text, add column parent_id uuid references public.app_spaces(id) on delete cascade;
  grant select, insert, update, delete on public.app_spaces to authenticated; alter table public.app_spaces enable row level security;
  create policy spaces_owner on public.app_spaces for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  update public.app_spaces set name='사업영역 가';
  alter table public.app_meetings
    add column series_name text, add column meeting_at timestamptz, add column project_id uuid references public.app_spaces(id) on delete set null,
    add column activity_kind text not null default 'meeting', add column deleted_at timestamptz,
    add column created_at timestamptz not null default now(), add column updated_at timestamptz not null default now();
  alter table public.app_meetings add constraint app_meetings_activity_kind_check check (activity_kind in
    ('meeting', 'policy', 'negotiation', 'press', 'assembly', 'struggle', 'education', 'other'));
  alter table public.app_meetings enable row level security;
  create policy task12a_owner_all on public.app_meetings for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  create policy app_meetings_trash_hidden on public.app_meetings as restrictive for all to authenticated
    using (deleted_at is null) with check (deleted_at is null);
  revoke all on public.app_meetings from public, anon, authenticated, service_role;
  grant select, insert, update, delete on public.app_meetings to authenticated, service_role;
  create function private.app_touch_meeting() returns trigger language plpgsql as $$ begin new.updated_at = clock_timestamp(); return new; end $$;
  create trigger app_meetings_touch before update on public.app_meetings for each row execute function private.app_touch_meeting();
  update public.app_meetings set title='궤도집행국회의' where id='${MEETING_A}';
  insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261022182319','bizreport_activity_kind',array['x']);
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;

test('bizreport area none: plan, precheck, dry-run, apply, owner boundary, guarded rollback',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'bizreport-area-none-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(schema);await pool.query(await read('supabase/migrations/'+area+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,preserve]=await Promise.all(['precheck','postcheck','snapshot','rollback','preserve'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const summary=await read('docs/'+stem+'.summary.md');
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const markNone=(sub=OWNER,id=MEETING_A)=>as('authenticated',sub,c=>c.query('update public.app_meetings set business_area_id=null,business_area_none=true where id=$1',[id]));
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('approval plan: expanded rules, full flow, one table; summary has three lines; workflow rollback refused (SQL Editor only)',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.targets,['app_meetings']);
   assert.equal(prepareMigration({mode:'dry-run',version,runId:'1',root}).flow,'full');
   assert.match(toDryRun(migration),/rollback;\s*$/);
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
   for(const file of [migration,precheck,postcheck,snapshot,rollbackSQL,preserve])assert.doesNotMatch(file,/information_schema/);
   assert.doesNotMatch(migration,/\b(grant|create policy|create function|create trigger|create index)\b/i);
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);
   assert.match(lines[0],/^무엇이 바뀌나: /);assert.match(lines[1],/^잘못되면: /);assert.match(lines[2],/^되돌리는 법: /);
  });
  await t.test('precheck as the read-only role: expected values; owner sees the same',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,item==='anon or public table privilege'?'아니오':'예',item);
   assert.deepEqual([v['new column count'],v['meetings rows']],['0','2']);
   assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('before apply the column does not exist',async()=>{
   await assert.rejects(markNone(),{code:'42703'});
  });
  await t.test('a second permissive policy stops the migration before any change',async()=>{
   await pool.query('create policy extra_read on public.app_meetings for select to authenticated using (private.app_is_workspace_owner(workspace_id))');
   assert.equal(values(await readOnly(precheck))['one permissive owner policy (task12a shape)'],'아니오');
   const c=await pool.connect();try{await assert.rejects(c.query(migration),/BIZREPORT_AREA_NONE_PREREQUISITE_CHANGED/);await c.query('rollback');}finally{c.release();}
   await pool.query('drop policy extra_read on public.app_meetings');
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9831');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await readOnly(precheck),beforeCheck);
  });
  await t.test('apply passes postcheck; existing rows false and untouched; second apply refused',async()=>{
   const apply=await run('apply','9832');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck)),pre=values(beforeCheck);
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else if(pre[item]!==undefined)assert.equal(value,pre[item],item);
   }
   assert.deepEqual((await pool.query('select title,business_area_none from public.app_meetings where id=$1',[MEETING_A])).rows,[{title:'궤도집행국회의',business_area_none:false}]);
   await assert.rejects(pool.query('update public.app_meetings set business_area_none=null where id=$1',[MEETING_A]),{code:'23502'});
   const again=await run('apply','9833');assert.equal(again.ok,false);
  });
  await t.test('owner marks none and back to an area; stranger and anon cannot; same-workspace tag policy unchanged',async()=>{
   assert.equal((await markNone()).rowCount,1);
   assert.equal((await as('authenticated',OWNER,c=>c.query('select business_area_none from public.app_meetings where id=$1',[MEETING_A]))).rows[0].business_area_none,true);
   assert.equal((await as('authenticated',OWNER,c=>c.query('update public.app_meetings set business_area_id=$2,business_area_none=false where id=$1',[MEETING_A,PROJECT_A]))).rowCount,1);
   await assert.rejects(as('authenticated',OWNER,c=>c.query('update public.app_meetings set business_area_id=$2,business_area_none=false where id=$1',[MEETING_A,PROJECT_B])),{code:'42501'});
   assert.equal((await markNone(STRANGER)).rowCount,0);
   assert.equal((await as('authenticated',STRANGER,c=>c.query('select count(*)::int n from public.app_meetings where business_area_none or id=$1',[MEETING_A]))).rows[0].n,0);
   await assert.rejects(as('anon','',c=>c.query('select business_area_none from public.app_meetings')),{code:'42501'});
   assert.equal((await markNone()).rowCount,1);
  });
  await t.test('rollback: blocked while a report is marked none; preserve reads ids only; then the column is gone',async()=>{
   const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/BIZREPORT_AREA_NONE_ROLLBACK_BLOCKED: reports marked none/);await c.query('rollback');}finally{c.release();}
   const kept=await readOnly(preserve);assert.equal(kept.length,1);assert.deepEqual(Object.keys(kept[0]),['id']);
   await pool.query('update public.app_meetings set business_area_none=false,business_area_id=null where id=$1',[MEETING_A]);
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.equal(values(await readOnly(postcheck))['column and history agree'],'예');
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const again=await run('apply','9836');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
