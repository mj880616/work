// Fresh local PostgreSQL 17 only. No Supabase, Google or production credentials. All data synthetic.
// MTG-한줄업데이트 DB: app_meetings_activity_kind_check accepts a ninth kind 'oneline' (one-line business area update)
// through the approved DB workflow runner (strict rules, full flow), with a guarded rollback.
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
const version='20261029160000',name='bizreport_oneline_kind',stem=version+'_'+name;
const area='20261028191500_bizreport_area_next_plan';
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const ONELINE='25000000-0000-4000-8000-0000000000b1';
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

test('bizreport one-line kind: plan, precheck, dry-run, apply, owner boundary, guarded rollback',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'bizreport-oneline-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  const addOneline=(sub=OWNER,ws=WS_A,tag=PROJECT_A,id=ONELINE)=>as('authenticated',sub,c=>c.query(
   "insert into public.app_meetings(id,workspace_id,title,activity_kind,business_area_id,meeting_at) values ($1,$2,'요구안 먼저 정돈하기로 함','oneline',$3,'2026-10-29T03:00:00Z')",[id,ws,tag]));
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('approval plan: strict rules, full flow, one table, no policy or grant; rollback mode allowed; summary has three lines',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'strict');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.targets,['app_meetings']);
   assert.equal(prepareMigration({mode:'dry-run',version,runId:'1',root}).flow,'full');
   assert.match(toDryRun(migration),/rollback;\s*$/);
   assert.equal(prepareMigration({mode:'rollback',version,runId:'1',root}).rules,'strict');
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);
   assert.match(lines[0],/^무엇이 바뀌나: /);assert.match(lines[1],/^잘못되면: /);assert.match(lines[2],/^되돌리는 법: /);
  });
  await t.test('precheck as the read-only role: expected values; owner sees the same',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,item==='anon or public table privilege'?'아니오':'예',item);
   assert.deepEqual([v['oneline rows'],v['kinds outside the eight'],v['meetings rows']],['0','0','2']);
   assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('before apply a one-line update is refused',async()=>{
   await assert.rejects(addOneline(),{code:'23514'});
  });
  await t.test('a second permissive policy stops the migration before any change',async()=>{
   await pool.query('create policy extra_read on public.app_meetings for select to authenticated using (private.app_is_workspace_owner(workspace_id))');
   assert.equal(values(await readOnly(precheck))['one permissive owner policy (task12a shape)'],'아니오');
   const c=await pool.connect();try{await assert.rejects(c.query(migration),/BIZREPORT_ONELINE_KIND_PREREQUISITE_CHANGED/);await c.query('rollback');}finally{c.release();}
   await pool.query('drop policy extra_read on public.app_meetings');
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9821');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await readOnly(precheck),beforeCheck);
  });
  await t.test('apply passes postcheck; existing rows untouched; second apply refused',async()=>{
   const apply=await run('apply','9822');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck)),pre=values(beforeCheck);
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else if(pre[item]!==undefined)assert.equal(value,pre[item],item);
   }
   assert.deepEqual((await pool.query('select activity_kind,title from public.app_meetings where id=$1',[MEETING_A])).rows,[{activity_kind:'meeting',title:'궤도집행국회의'}]);
   const again=await run('apply','9823');assert.equal(again.ok,false);
  });
  await t.test('owner saves a one-line update with a tag; unknown kinds still refused; workspace boundary unchanged',async()=>{
   assert.equal((await addOneline()).rowCount,1);
   await assert.rejects(as('authenticated',OWNER,c=>c.query("update public.app_meetings set activity_kind='line' where id=$1",[ONELINE])),{code:'23514'});
   // Another workspace's project as the tag: still refused by the same-workspace policy.
   await assert.rejects(addOneline(OWNER,WS_A,PROJECT_B,'25000000-0000-4000-8000-0000000000b2'),{code:'42501'});
   // A stranger cannot see or change it; anon cannot read the table.
   assert.equal((await as('authenticated',STRANGER,c=>c.query('select count(*)::int n from public.app_meetings where id=$1',[ONELINE]))).rows[0].n,0);
   assert.equal((await as('authenticated',STRANGER,c=>c.query("update public.app_meetings set title='x' where id=$1",[ONELINE]))).rowCount,0);
   await assert.rejects(as('anon','',c=>c.query('select activity_kind from public.app_meetings')),{code:'42501'});
   assert.equal((await as('authenticated',OWNER,c=>c.query("select activity_kind from public.app_meetings where id=$1",[ONELINE]))).rows[0].activity_kind,'oneline');
  });
  await t.test('rollback: blocked while a one-line update exists; preserve reads ids only; then the eight-kind check returns',async()=>{
   const blocked=await run('rollback','9824');assert.equal(blocked.ok,false);
   const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/BIZREPORT_ONELINE_KIND_ROLLBACK_BLOCKED: one-line updates saved/);await c.query('rollback');}finally{c.release();}
   const kept=await readOnly(preserve);assert.equal(kept.length,1);assert.deepEqual(Object.keys(kept[0]).sort(),['business_area_id','id','meeting_at']);
   await pool.query("update public.app_meetings set activity_kind='other' where id=$1",[ONELINE]);
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.equal(values(await readOnly(postcheck))['kind check and history agree'],'예');
   await assert.rejects(as('authenticated',OWNER,c=>c.query("update public.app_meetings set activity_kind='oneline' where id=$1",[ONELINE])),{code:'23514'});
   await pool.query('delete from public.app_meetings where id=$1',[ONELINE]);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const again=await run('apply','9826');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
