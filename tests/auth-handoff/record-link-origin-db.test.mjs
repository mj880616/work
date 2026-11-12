// Fresh local PostgreSQL 17 only. No Supabase, Google or production credentials. All data synthetic.
// S61-6 ORG-기록첨부표시이름 ① DB(20261112204500_record_link_origin): app_record_links.origin + app_basket_confirm_links stores it
// — after REF-참고묶음(20261023231500), through the approved DB workflow runner.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,PROJECT_B,ORG_A,ORG_B,MEETING_A,MEETING_B} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261112204500',name='record_link_origin',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Same production-like prerequisite chain as the ref bundle test (this migration builds on 20261023231500).
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
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const NOTE_AT='2026-11-12T01:02:03.123456Z';

test('record link origin db: precheck, dry-run, apply, origin stored per target, guards, owner boundary, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'record-link-origin-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  for(const file of ['20260927103344_task_impl2_notes_record_links.sql','20260928123601_task_meeting_followup_record_links.sql'])await pool.query(await read('supabase/migrations/'+file));
  await pool.query(spaces);
  for(const file of ['20261010120000_basket1_notes_links.sql','20261011180000_basket4a_confirm_links.sql','20261012100000_basket_link_view_db.sql'])await pool.query(await read('supabase/migrations/'+file));
  await pool.query(meetings);
  for(const file of ['20261023023500_bizreport_meeting_links.sql','20261023231500_ref_bundle_db.sql'])await pool.query(await read('supabase/migrations/'+file));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL]=await Promise.all(['precheck','postcheck','snapshot','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const stops=async sql=>{const c=await pool.connect();try{await assert.rejects(c.query(sql),/RECORD_LINK_ORIGIN_PREREQUISITE_CHANGED/);await c.query('rollback');}finally{c.release();}};
  const note=async(ws=WS_A)=>(await pool.query("insert into public.app_notes(workspace_id,raw_text,updated_at) values ($1,'합성 메모',$2) returning id",[ws,NOTE_AT])).rows[0].id;
  const confirm=(sub,noteId,targets)=>as('authenticated',sub,async c=>(await c.query('select public.app_basket_confirm_links($1,$2,$3::jsonb) r',[noteId,NOTE_AT,JSON.stringify(targets)])).rows[0].r);
  const origins=async n=>(await pool.query('select organization_id,project_id,origin from public.app_record_links where note_id=$1 order by organization_id nulls last',[n])).rows;

  // A link made before this migration (the basket path) stays with no origin after apply.
  const oldNote=await note();
  assert.deepEqual(await confirm(OWNER,oldNote,[{kind:'organization',target_id:ORG_A,reason:'직접 연결'}]),{ok:true,created:1,existing:0});
  const earlyNote=await note();
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('approval plan: expanded rules, full flow; one replaced invoker function; nothing widens access',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.targets,['app_record_links']);
   assert.deepEqual(plan.functions,['public.app_basket_confirm_links']);
   assert.deepEqual(plan.review.definer,[]);assert.equal(plan.review.triggers,0);
   assert.equal(prepareMigration({mode:'dry-run',version,runId:'1',root}).flow,'full');
   assert.match(toDryRun(migration),/rollback;\s*$/);
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
  });
  await t.test('precheck as the read-only role: all yes, origin absent, three policies',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.deepEqual([v['origin column count'],v['record links policies']],['0','3']);
  });
  await t.test('a changed prerequisite stops the migration before any change',async()=>{
   await pool.query("create policy extra_probe on public.app_record_links for select to authenticated using (false)");
   assert.equal(values(await readOnly(precheck))['record links policies'],'4');await stops(migration);
   await pool.query('drop policy extra_probe on public.app_record_links');
   await pool.query("alter function public.app_basket_confirm_links(uuid,timestamptz,jsonb) set search_path = public");
   assert.equal(values(await readOnly(precheck))['confirm function is the repository body, invoker, fixed path, no anon or public'],'아니오');await stops(migration);
   await pool.query("alter function public.app_basket_confirm_links(uuid,timestamptz,jsonb) set search_path = ''");
   await pool.query("grant execute on function public.app_basket_confirm_links(uuid,timestamptz,jsonb) to anon");
   await stops(migration);
   await pool.query("revoke execute on function public.app_basket_confirm_links(uuid,timestamptz,jsonb) from anon");
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await readOnly(precheck),beforeCheck);
  });
  await t.test('before apply the function refuses an origin key (screen must wait for this DB)',async()=>{
   assert.deepEqual(await confirm(OWNER,earlyNote,[{kind:'organization',target_id:ORG_A,reason:'직접 연결',origin:'record_input'}]),{ok:false,error:'INVALID_TARGETS',created:0,existing:0});
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9911');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await readOnly(precheck),beforeCheck);
  });
  await t.test('apply passes postcheck; old link keeps no origin; second apply refused',async()=>{
   const apply=await run('apply','9912');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck)),pre=values(beforeCheck);
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else if(pre[item]!==undefined&&item!=='origin column count')assert.equal(value,pre[item],item);
   }
   assert.deepEqual([post['origin column count'],post['origin marked rows'],post['record links policies']],['1','0','3']);
   assert.deepEqual(await origins(oldNote),[{organization_id:ORG_A,project_id:null,origin:null}]);
   assert.equal((await run('apply','9913')).ok,false);
  });
  await t.test('confirm links stores origin per target; missing or null stays null; existing links unchanged',async()=>{
   const n=await note();
   assert.deepEqual(await confirm(OWNER,n,[{kind:'organization',target_id:ORG_A,reason:'직접 연결',origin:'record_input'},{kind:'project',target_id:PROJECT_A,reason:'직접 연결',origin:'record_input',summary:'사진 3장'}]),{ok:true,created:2,existing:0});
   assert.deepEqual(await origins(n),[{organization_id:ORG_A,project_id:null,origin:'record_input'},{organization_id:null,project_id:PROJECT_A,origin:'record_input'}]);
   // Same place again with another origin: the link already exists and keeps its first mark.
   assert.deepEqual(await confirm(OWNER,n,[{kind:'organization',target_id:ORG_A,reason:'직접 연결',origin:'basket'}]),{ok:true,created:0,existing:1});
   assert.equal((await origins(n))[0].origin,'record_input');
   const b=await note();
   assert.deepEqual(await confirm(OWNER,b,[{kind:'organization',target_id:ORG_A,reason:'직접 연결',origin:'basket'}]),{ok:true,created:1,existing:0});
   assert.equal((await origins(b))[0].origin,'basket');
   const none=await note();
   assert.deepEqual(await confirm(OWNER,none,[{kind:'organization',target_id:ORG_A,reason:'직접 연결'},{kind:'project',target_id:PROJECT_A,reason:'직접 연결',origin:null}]),{ok:true,created:2,existing:0});
   assert.deepEqual((await origins(none)).map(r=>r.origin),[null,null]);
  });
  await t.test('bad origin refuses the whole note (nothing written)',async()=>{
   const n=await note();
   for(const bad of ['ai','',1,true,['basket'],{v:'basket'},'RECORD_INPUT'])
    assert.deepEqual(await confirm(OWNER,n,[{kind:'organization',target_id:ORG_A,reason:'직접 연결',origin:'record_input'},{kind:'project',target_id:PROJECT_A,reason:'직접 연결',origin:bad}]),{ok:false,error:'INVALID_TARGETS',created:0,existing:0},JSON.stringify(bad));
   assert.deepEqual(await origins(n),[]);
  });
  await t.test('table check: only the two values, only on note links; owner RLS unchanged',async()=>{
   const n=await note();
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_record_links(workspace_id,note_id,organization_id,status,origin) values ($1,$2,$3,'confirmed','other')",[WS_A,n,ORG_A])),e=>e.code==='23514');
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_record_links(workspace_id,source_meeting_id,organization_id,origin) values ($1,$2,$3,'basket')",[WS_A,MEETING_A,ORG_A])),e=>e.code==='23514');
   // A stranger cannot use this path on another owner's note, with or without origin.
   assert.deepEqual((await confirm(STRANGER,n,[{kind:'organization',target_id:ORG_A,reason:'직접 연결',origin:'record_input'}])).error,'NOTE_MISSING');
   const other=await note(WS_B);
   assert.equal((await confirm(OWNER,other,[{kind:'organization',target_id:ORG_B,reason:'직접 연결',origin:'record_input'}])).ok,false);
   // The stranger cannot read or change origin on the owner's links.
   assert.equal(await as('authenticated',STRANGER,async c=>(await c.query('select count(*)::int n from public.app_record_links where origin is not null')).rows[0].n),0);
   assert.equal(await as('authenticated',STRANGER,async c=>(await c.query("update public.app_record_links set origin='basket' where origin='record_input'")).rowCount),0);
   assert.equal(await as('anon','',async c=>c.query('select origin from public.app_record_links').then(()=>'read',e=>e.code)),'42501');
  });
  await t.test('rollback (SQL Editor): previous body and schema return; links and notes stay; re-apply works',async()=>{
   const links=(await pool.query('select count(*)::int n from public.app_record_links')).rows[0].n;
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal((await pool.query('select count(*)::int n from public.app_record_links')).rows[0].n,links);
   const again=await run('apply','9914');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
