// Fresh local PostgreSQL 17 only. No Supabase, Google or production credentials.
// REF-참고묶음 1단계 DB: app_reference_bundles, app_record_links.bundle_id, restrictive workspace policy,
// app_basket_confirm_links / app_basket_update_link_summary accept 'reference' — through the approved DB workflow runner.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,PROJECT_B,ORG_A,MEETING_A,MEETING_B} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261023231500',name='ref_bundle_db',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Same production-like prerequisite chain as the bizreport meeting-links test (this migration builds on 20261023023500).
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
const NOTE_AT='2026-10-23T01:02:03.123456Z';

test('ref bundle db: precheck, dry-run, apply, reference links, owner/workspace boundary, guarded rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'ref-bundle-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  for(const file of ['20260927103344_task_impl2_notes_record_links.sql','20260928123601_task_meeting_followup_record_links.sql'])await pool.query(await read('supabase/migrations/'+file));
  await pool.query(spaces);
  for(const file of ['20261010120000_basket1_notes_links.sql','20261011180000_basket4a_confirm_links.sql','20261012100000_basket_link_view_db.sql'])await pool.query(await read('supabase/migrations/'+file));
  await pool.query(meetings);
  await pool.query(await read('supabase/migrations/20261023023500_bizreport_meeting_links.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,preserve]=await Promise.all(['precheck','postcheck','snapshot','rollback','preserve'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const stops=async sql=>{const c=await pool.connect();try{await assert.rejects(c.query(sql),/REF_BUNDLE_DB_PREREQUISITE_CHANGED/);await c.query('rollback');}finally{c.release();}};
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const note=async(ws=WS_A)=>(await pool.query("insert into public.app_notes(workspace_id,raw_text,updated_at) values ($1,'메모',$2) returning id",[ws,NOTE_AT])).rows[0].id;
  const confirm=(sub,noteId,targets)=>as('authenticated',sub,async c=>(await c.query('select public.app_basket_confirm_links($1,$2,$3::jsonb) r',[noteId,NOTE_AT,JSON.stringify(targets)])).rows[0].r);
  const bundleId=async(ws,n)=>(await pool.query('select id from public.app_reference_bundles where workspace_id=$1 and name=$2',[ws,n])).rows[0].id;
  const refLinks=async()=>(await pool.query('select count(*)::int n from public.app_record_links where bundle_id is not null')).rows[0].n;

  await t.test('approval plan: expanded rules, full flow; new table, two replaced functions; nothing widens access',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.targets,['app_record_links']);
   assert.deepEqual(plan.functions,['public.app_basket_confirm_links','public.app_basket_update_link_summary']);
   assert.deepEqual(plan.review.definer,[]);assert.equal(plan.review.restrictive,1);assert.equal(plan.review.triggers,0);
   assert.equal(prepareMigration({mode:'dry-run',version,runId:'1',root}).flow,'full');
   assert.match(toDryRun(migration),/rollback;\s*$/);
  });
  await t.test('precheck as the read-only role: expected values',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.deepEqual([v['reference bundles table count'],v['bundle column count'],v['record links policies'],v['workspaces']],['0','0','2','2']);
   assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('a changed prerequisite stops the migration before any change',async()=>{
   await pool.query("create policy extra_probe on public.app_record_links for select to authenticated using (false)");
   assert.equal(values(await readOnly(precheck))['record links policies'],'3');await stops(migration);
   await pool.query('drop policy extra_probe on public.app_record_links');
   await pool.query("alter function public.app_basket_confirm_links(uuid,timestamptz,jsonb) set search_path = public");
   assert.equal(values(await readOnly(precheck))['confirm function is the repository body, invoker, fixed path, no anon or public'],'아니오');await stops(migration);
   await pool.query("alter function public.app_basket_confirm_links(uuid,timestamptz,jsonb) set search_path = ''");
   await pool.query("grant execute on function public.app_basket_update_link_summary(uuid,text,text) to anon");
   await stops(migration);
   await pool.query("revoke execute on function public.app_basket_update_link_summary(uuid,text,text) from anon");
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9901');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await readOnly(precheck),beforeCheck);
  });
  await t.test('apply passes postcheck; three starter bundles per workspace; old links untouched',async()=>{
   const apply=await run('apply','9902');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck)),pre=values(beforeCheck);
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else if(pre[item]!==undefined&&!['record links policies'].includes(item))assert.equal(value,pre[item],item);
   }
   assert.equal(post['reference bundles rows'],'6');assert.equal(post['reference links'],'0');assert.equal(post['record links policies'],'3');
   assert.deepEqual((await pool.query("select name,sort_order from public.app_reference_bundles where workspace_id=$1 order by sort_order",[WS_A])).rows,
    [{name:'공공운수노조',sort_order:10},{name:'공공기관사업(본부)',sort_order:20},{name:'기타 조직',sort_order:30}]);
   assert.equal((await run('apply','9903')).ok,false);
  });
  await t.test('confirm links: reference alone, with an organization, duplicate, bad inputs',async()=>{
   const etc=await bundleId(WS_A,'기타 조직'),union=await bundleId(WS_A,'공공운수노조'),n=await note();
   assert.deepEqual(await confirm(OWNER,n,[{kind:'reference',target_id:etc,reason:'노조 전체 소식'}]),{ok:true,created:1,existing:0});
   assert.deepEqual(await confirm(OWNER,n,[{kind:'reference',target_id:etc,reason:'다시'}]),{ok:true,created:0,existing:1});
   assert.deepEqual((await pool.query('select organization_id,project_id,bundle_id,status,report_kind,note_id from public.app_record_links where bundle_id=$1',[etc])).rows,
    [{organization_id:null,project_id:null,bundle_id:etc,status:'confirmed',report_kind:null,note_id:n}]);
   // Organization + reference together are allowed; the organization line keeps its report kind, the reference line has none.
   const both=await note();
   assert.deepEqual(await confirm(OWNER,both,[{kind:'organization',target_id:ORG_A,reason:'조직'},{kind:'reference',target_id:union,reason:'참고'}]),{ok:true,created:2,existing:0});
   assert.deepEqual((await pool.query('select report_kind from public.app_record_links where note_id=$1 order by report_kind nulls last',[both])).rows.map(r=>r.report_kind),['organization',null]);
   // Another workspace's bundle is invisible to the owner: refused, nothing written.
   const otherBundle=await bundleId(WS_B,'기타 조직'),m=await note();
   assert.equal((await confirm(OWNER,m,[{kind:'reference',target_id:otherBundle,reason:'x'}])).error,'TARGET_MISSING');
   assert.equal((await confirm(OWNER,m,[{kind:'organization',target_id:ORG_A,reason:'x'},{kind:'reference',target_id:otherBundle,reason:'x'}])).error,'TARGET_MISSING');
   assert.equal((await pool.query('select count(*)::int n from public.app_record_links where note_id=$1',[m])).rows[0].n,0);
   assert.equal((await confirm(OWNER,m,[{kind:'reference',target_id:'29000000-0000-4000-8000-000000000999',reason:'x'}])).error,'TARGET_MISSING');
   assert.equal((await confirm(OWNER,m,[{kind:'reference',target_id:'not-a-uuid',reason:'x'}])).error,'INVALID_TARGETS');
   assert.equal((await confirm(OWNER,m,[{kind:'bundle',target_id:etc,reason:'x'}])).error,'INVALID_TARGETS');
   // A stranger cannot see the owner's note.
   assert.equal((await confirm(STRANGER,m,[{kind:'reference',target_id:etc,reason:'x'}])).error,'NOTE_MISSING');
   // Organization and project links keep working as before.
   assert.deepEqual(await confirm(OWNER,m,[{kind:'organization',target_id:ORG_A,reason:'x'},{kind:'project',target_id:PROJECT_A,reason:'x'}]),{ok:true,created:2,existing:0});
  });
  await t.test('summary edit works for a reference link; stale or foreign edits refused',async()=>{
   const link=(await pool.query('select id from public.app_record_links where bundle_id is not null order by created_at limit 1')).rows[0].id;
   const edit=(sub,expected,next)=>as('authenticated',sub,async c=>(await c.query('select public.app_basket_update_link_summary($1,$2,$3) r',[link,expected,next])).rows[0].r);
   assert.deepEqual(await edit(OWNER,null,'참고 요약'),{ok:true});
   assert.deepEqual(await edit(OWNER,null,'다시'),{ok:false,error:'SUMMARY_CHANGED'});
   assert.deepEqual(await edit(OWNER,'참고 요약','고친 요약'),{ok:true});
   assert.deepEqual(await edit(STRANGER,'고친 요약','남의 것'),{ok:false,error:'NOT_FOUND'});
   assert.equal((await pool.query('select summary from public.app_record_links where id=$1',[link])).rows[0].summary,'고친 요약');
  });
  await t.test('direct writes: owner/workspace boundary and shape rules',async()=>{
   const etc=await bundleId(WS_A,'기타 조직'),otherBundle=await bundleId(WS_B,'기타 조직'),n=await note();
   const ins=(sub,cols,vals)=>as('authenticated',sub,c=>c.query(`insert into public.app_record_links(${cols}) values (${vals.map((_,i)=>'$'+(i+1)).join(',')})`,vals));
   // Workspace A link pointing at workspace B's bundle: refused by the restrictive policy.
   await assert.rejects(ins(OWNER,'workspace_id,note_id,bundle_id',[WS_A,n,otherBundle]),{code:'42501'});
   // Stranger writes into workspace A: refused by the owner policy.
   await assert.rejects(ins(STRANGER,'workspace_id,note_id,bundle_id',[WS_A,n,etc]),{code:'42501'});
   // Stranger's own workspace with workspace A's bundle: refused (bundle not in that workspace).
   const sn=await note(WS_B);
   await assert.rejects(ins(STRANGER,'workspace_id,note_id,bundle_id',[WS_B,sn,etc]),{code:'42501'});
   // Shape: exactly one target; note source only; confirmed only; no report kind.
   await assert.rejects(ins(OWNER,'workspace_id,note_id,bundle_id,organization_id',[WS_A,n,etc,ORG_A]),{code:'23514'});
   await assert.rejects(ins(OWNER,'workspace_id,google_task_id,google_tasklist_id,task_completed,bundle_id',[WS_A,'t','l',false,etc]),{code:'23514'});
   await assert.rejects(ins(OWNER,'workspace_id,source_meeting_id,bundle_id',[WS_A,MEETING_A,etc]),{code:'23514'});
   await assert.rejects(ins(OWNER,'workspace_id,note_id,bundle_id,status',[WS_A,n,etc,'suggested']),{code:'23514'});
   await assert.rejects(ins(OWNER,'workspace_id,note_id,bundle_id,report_kind',[WS_A,n,etc,'business']),{code:'23514'});
   await assert.rejects(ins(OWNER,'workspace_id,note_id',[WS_A,n]),{code:'23514'});
   // Same note → same bundle is one row.
   await ins(OWNER,'workspace_id,note_id,bundle_id',[WS_A,n,etc]);
   await assert.rejects(ins(OWNER,'workspace_id,note_id,bundle_id',[WS_A,n,etc]),{code:'23505'});
   // A stranger sees none of workspace A's reference links.
   assert.equal((await as('authenticated',STRANGER,c=>c.query('select count(*)::int n from public.app_record_links where bundle_id is not null'))).rows[0].n,0);
  });
  await t.test('bundles table: owner only; names, columns and anon/stranger/delete rules',async()=>{
   await pool.query(await read('supabase/tests/authz_reference_bundles.sql'));
   const etc=await bundleId(WS_A,'기타 조직');
   // anon: no table privilege, no function execute.
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_reference_bundles')),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query("select public.app_basket_confirm_links($1,now(),'[]'::jsonb)",[etc])),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query("select public.app_basket_update_link_summary($1,null,'x')",[etc])),{code:'42501'});
   // Stranger sees only their own workspace's three bundles and cannot touch the owner's.
   assert.deepEqual((await as('authenticated',STRANGER,c=>c.query('select distinct workspace_id from public.app_reference_bundles'))).rows,[{workspace_id:WS_B}]);
   assert.equal((await as('authenticated',STRANGER,c=>c.query("update public.app_reference_bundles set name='가로채기' where id=$1",[etc]))).rowCount,0);
   assert.equal((await as('authenticated',STRANGER,c=>c.query('delete from public.app_reference_bundles where id=$1',[etc]))).rowCount,0);
   await assert.rejects(as('authenticated',STRANGER,c=>c.query("insert into public.app_reference_bundles(workspace_id,name) values ($1,'침입')",[WS_A])),{code:'42501'});
   // Owner: add, rename, reorder; name rules; no id/workspace edits.
   const added=(await as('authenticated',OWNER,c=>c.query("insert into public.app_reference_bundles(workspace_id,name,sort_order) values ($1,'새 묶음',40) returning id",[WS_A]))).rows[0].id;
   assert.equal((await as('authenticated',OWNER,c=>c.query("update public.app_reference_bundles set name='바꾼 이름',sort_order=5,updated_at=now() where id=$1",[added]))).rowCount,1);
   await assert.rejects(as('authenticated',OWNER,c=>c.query("update public.app_reference_bundles set name='기타 조직' where id=$1",[added])),{code:'23505'});
   for(const bad of ['','   ','가'.repeat(31)])await assert.rejects(as('authenticated',OWNER,c=>c.query('update public.app_reference_bundles set name=$1 where id=$2',[bad,added])),{code:'23514'});
   assert.equal((await as('authenticated',OWNER,c=>c.query('update public.app_reference_bundles set name=$1 where id=$2',['가'.repeat(30),added]))).rowCount,1);
   await assert.rejects(as('authenticated',OWNER,c=>c.query('update public.app_reference_bundles set workspace_id=$1 where id=$2',[WS_B,added])),{code:'42501'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query('update public.app_reference_bundles set id=gen_random_uuid() where id=$1',[added])),{code:'42501'});
   // Only empty bundles can be deleted: a bundle with a link is refused (restrict), an empty one goes.
   await assert.rejects(as('authenticated',OWNER,c=>c.query('delete from public.app_reference_bundles where id=$1',[etc])),{code:'23503'});
   assert.equal((await as('authenticated',OWNER,c=>c.query('delete from public.app_reference_bundles where id=$1',[added]))).rowCount,1);
   // Deleting a link frees the bundle.
   const n2=await note(),lone=await bundleId(WS_A,'공공기관사업(본부)');
   await confirm(OWNER,n2,[{kind:'reference',target_id:lone,reason:'x'}]);
   await assert.rejects(pool.query('delete from public.app_reference_bundles where id=$1',[lone]),{code:'23503'});
   await as('authenticated',OWNER,c=>c.query('delete from public.app_record_links where bundle_id=$1',[lone]));
   assert.equal((await as('authenticated',OWNER,c=>c.query('delete from public.app_reference_bundles where id=$1',[lone]))).rowCount,1);
   await pool.query("insert into public.app_reference_bundles(workspace_id,name,sort_order) values ($1,'공공기관사업(본부)',20)",[WS_A]);
  });
  await t.test('other link kinds are unaffected (org/project/task/meeting source rows still insert)',async()=>{
   const n=await note();
   await as('authenticated',OWNER,c=>c.query("insert into public.app_record_links(workspace_id,note_id,organization_id,report_kind) values ($1,$2,$3,'organization')",[WS_A,n,ORG_A]));
   await as('authenticated',OWNER,c=>c.query("insert into public.app_record_links(workspace_id,google_task_id,google_tasklist_id,task_completed,project_id) values ($1,'t2','l2',false,$2)",[WS_A,PROJECT_A]));
   await as('authenticated',OWNER,c=>c.query("insert into public.app_record_links(workspace_id,source_meeting_id,organization_id) values ($1,$2,$3)",[WS_A,MEETING_A,ORG_A]));
  });
  await t.test('rollback (SQL Editor): stops while reference links exist; preserve reads them; then the original schema and function bodies return',async()=>{
   assert.ok(await refLinks()>0);
   const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/REF_BUNDLE_DB_ROLLBACK_BLOCKED: reference links exist/);await c.query('rollback');}finally{c.release();}
   const kept=await readOnly(preserve);assert.ok(kept.some(r=>r.kind==='bundle'));assert.ok(kept.some(r=>r.kind==='link'&&r.bundle_id));
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,1);
   await pool.query('delete from public.app_record_links where bundle_id is not null');
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal(await pool.query("select to_regclass('public.app_reference_bundles') r").then(r=>r.rows[0].r),null);
   // Re-apply works after a rollback.
   const again=await run('apply','9904');assert.equal(again.ok,true,again.summary);
  });
  await t.test('workflow rollback mode is not used for this file (drop policy/table and function bodies are SQL Editor only)',()=>{
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
