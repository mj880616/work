// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic (09xx ids, made-up names).
// S56-27 LEDGER-사업기록재료: 20261110213000_ledger_biz_records — the ledger auto-record accepts one more source kind, biz_record
// (사업 기록 app_business_records), from the one kind helper (CHECK + helper agree). Same signature, same grants, no definer, no table/policy change.
// Another workspace cannot record into this workspace's run or processing table; rollback is refused while biz_record rows exist.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,PROJECT_B} from './basket4-fixture.mjs';
import {prerequisites as recordOnePrereq} from './record-one-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261110213000',name='ledger_biz_records',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const NINE=['basket','note','work','meeting','org_update','project_update','call','weekly_personal','calendar_ref'],TEN=[...NINE,'biz_record'];
const T='2026-11-10T01:00:00Z';

// app_profiles (ledger_sources prerequisite), same shape as tests/auth-handoff/ledger-sources.test.mjs.
const profiles=`
  create function private.app_is_owner_profile(p_user uuid)
  returns boolean language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select exists (select 1 from public.app_workspace_members subject join public.app_workspace_members owner
      on owner.workspace_id = subject.workspace_id and owner.role = 'owner' and owner.user_id = (select auth.uid()) where subject.user_id = p_user)
  $$;
  revoke all on function private.app_is_owner_profile(uuid) from public, anon, authenticated;
  grant execute on function private.app_is_owner_profile(uuid) to authenticated, service_role;
  create table public.app_profiles(user_id uuid primary key,display_name text,job_title text,created_at timestamptz default now(),updated_at timestamptz default now());
  alter table public.app_profiles enable row level security;
  create policy task12a_owner_all on public.app_profiles for all to authenticated
    using (private.app_is_owner_profile(user_id)) with check (private.app_is_owner_profile(user_id));
  create policy task12a_profile_self_select on public.app_profiles for select to authenticated using (user_id = (select auth.uid()));
  revoke all on public.app_profiles from public, anon, authenticated;
  grant select, update on public.app_profiles to authenticated;
  insert into public.app_profiles(user_id,display_name) values ('${OWNER}','소유자'),('${STRANGER}','남');
  grant select on public.app_spaces to authenticated; alter table public.app_spaces enable row level security;
  create policy synthetic_owner on public.app_spaces for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));`;

test('LEDGER-사업기록재료 DB: plan, apply, biz_record in helper and CHECK, other workspace refused, guarded rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'ledger-biz-records-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(recordOnePrereq);await pool.query(profiles);
  for(const file of ['20261021082000_ledger_schema','20261021150000_ledger_import','20261021190000_ledger_candidates','20261021234000_ledger_candidate_undo','20261024120000_ledger_auto_record','20261025110000_ledger_sources','20261109100000_record_one_org','20261109110000_record_one_biz'])
   await pool.query(await read('supabase/migrations/'+file+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  async function asCancelled(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);return await fn(c);}finally{await c.query('rollback').catch(()=>{});c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),anon=fn=>as('anon','',fn),service=fn=>as('service_role','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const one=async(sql,args=[])=>(await pool.query(sql,args)).rows[0];
  const quoted=s=>[...s.matchAll(/'([a-z_]+)'/g)].map(m=>m[1]);
  const kindList=sql=>quoted(sql.replace(/--.*$/gm,'').match(/select coalesce\(p_kind in \(([^)]*)\), false\)/)[1]);
  const checkList=sql=>quoted(sql.replace(/--.*$/gm,'').match(/add constraint app_ledger_auto_sources_kind_check check \(source_kind in \(([^)]*)\)\)/)[1]);

  // A confirmed ledger import gives the ledger ID prefixes (same as ledger-sources.test.mjs).
  await owner(c=>c.query('select public.app_import_ledger_apply($1,$2,false)',[WS_A,JSON.stringify({format:'kptu-ledger-import',version:1,kind:'sheet',label:'가상 원장',sha256:'5'.repeat(64),
   id_prefixes:{event:'EVT',change:'CHG',decision:'DEC',evidence:'EVD',commitment:'COM',source:'SRC',organization:'ORG',topic:'TOP'},
   topics:[],organizations:[],sources:[],records:[{kind:'event',ledger_id:'EVT-0901',title:'가상 기존 사건',event_status:'tracking'}]})]));
  await pool.query("update public.app_ledger_imports set status='confirmed',decided_at=now() where status='applied'");
  // Real business records: one in each workspace (owner RLS path, like the screen).
  const bizA=(await owner(c=>c.query("insert into public.app_business_records(workspace_id,space_id,day,body,source_kind) values ($1,$2,'2026-11-10','가상 사업 기록 가','user') returning id",[WS_A,PROJECT_A]))).rows[0].id;
  const bizB=(await stranger(c=>c.query("insert into public.app_business_records(workspace_id,space_id,day,body,source_kind) values ($1,$2,'2026-11-10','가상 남의 사업 기록','user') returning id",[WS_B,PROJECT_B]))).rows[0].id;
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules pass; only the kind helper is replaced (same grants); rollback carries the earlier body; lists agree with the server; summary 3 lines',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual(plan.createdTables,[]);assert.deepEqual([...plan.functions],['private.app_auto_ledger_source_kind_ok']);
    assert.equal(plan.review.definer.length,0);assert.equal(plan.review.policies,0);assert.equal(plan.review.triggers,0);
   }
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|disable row level security|(?:create|drop|alter) policy|\bto (?:anon|public|service_role)\b|rtw_|set_config|create table/i);
   assert.match(code,/revoke all on function private\.app_auto_ledger_source_kind_ok\(text\) from public, anon, service_role;\s*grant execute on function private\.app_auto_ledger_source_kind_ok\(text\) to authenticated;/);
   assert.doesNotMatch(code,/\bgrant [^;]* on (?:table )?public\./i);
   // Lists: the new helper and CHECK are the ten; the rollback restores the nine of 20261025110000 verbatim.
   assert.deepEqual(kindList(migration),TEN);assert.deepEqual(checkList(migration),TEN);
   assert.deepEqual(kindList(rollbackSQL),NINE);assert.deepEqual(checkList(rollbackSQL),NINE);
   const prev=await read('supabase/migrations/20261025110000_ledger_sources.sql');
   const body=(s,sig)=>{const i=s.indexOf(sig);const a=s.indexOf('as $$',i);return s.slice(a,s.indexOf('\n$$',a));};
   assert.equal(body(rollbackSQL,'function private.app_auto_ledger_source_kind_ok('),body(prev,'function private.app_auto_ledger_source_kind_ok('));
   assert.equal(body(migration,'function private.app_auto_ledger_source_kind_ok('),body(prev,"function private.app_auto_ledger_source_kind_ok(").replace("'calendar_ref')","'calendar_ref', 'biz_record')"));
   // The server reads biz_record and every server kind is known to the DB.
   const server=await read('supabase/functions/ai-assist/ledger-auto.ts');
   const serverKinds=quoted(server.match(/AUTO_SOURCE_KINDS[^=]*=\s*Object\.freeze\(\[([^\]]*)\]/)[1].replace(/"/g,"'"));
   assert.ok(serverKinds.includes('biz_record'));for(const k of serverKinds)assert.ok(TEN.includes(k),'server kind '+k+' unknown to the DB');
  });
  await t.test('precheck as the read-only role; a changed helper stops the migration before any change',async()=>{
   for(const [item,value] of Object.entries(values(beforeCheck)))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   const stops=async()=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),/LEDGER_BIZ_RECORDS_PREREQUISITE_CHANGED/);await c.query('rollback');}finally{c.release();}};
   const orig=(await one("select pg_get_functiondef('private.app_auto_ledger_source_kind_ok(text)'::regprocedure) d")).d;
   await pool.query(orig.replace("'calendar_ref')","'calendar_ref', 'telegram')"));
   assert.equal(values(await readOnly(precheck))['kind helper keeps the earlier body'],'아니오');await stops();
   await pool.query(orig);
   assert.deepEqual(await readOnly(precheck),beforeCheck);
  });
  await t.test('before apply biz_record is refused by the DB',async()=>{
   await asCancelled('authenticated',OWNER,async c=>{
    const begun=(await c.query('select public.app_auto_ledger_begin($1) r',[WS_A])).rows[0].r;
    const r=(await c.query('select public.app_auto_ledger_record($1,$2) r',[begun.run_id,JSON.stringify({sources:[{kind:'biz_record',id:bizA,updated_at:T}],items:[]})])).rows[0].r;
    assert.equal(r.ok,false);assert.equal(r.error,'LEDGER_AUTO_BAD_BATCH');
   });
  });
  await t.test('dry-run leaves schema and history unchanged',async()=>{
   const dry=await run('dry-run','9941');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await readOnly(precheck),beforeCheck);
  });
  await t.test('apply passes postcheck; same counts and hashes; second apply refused',async()=>{
   const apply=await run('apply','9942');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck)),pre=values(beforeCheck);
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else assert.equal(value,pre[item],item);
   }
   assert.equal((await run('apply','9943')).ok,false);
   // Helper grants unchanged: authenticated only.
   assert.equal((await one("select has_function_privilege('authenticated','private.app_auto_ledger_source_kind_ok(text)','execute') a,has_function_privilege('anon','private.app_auto_ledger_source_kind_ok(text)','execute') b,has_function_privilege('service_role','private.app_auto_ledger_source_kind_ok(text)','execute') c")).a,true);
   assert.deepEqual(await one("select has_function_privilege('anon','private.app_auto_ledger_source_kind_ok(text)','execute') b,has_function_privilege('service_role','private.app_auto_ledger_source_kind_ok(text)','execute') c"),{b:false,c:false});
  });

  const batch=(kind,id,extra={})=>({sources:[{kind,id,updated_at:T}],items:[{op:'new',kind:'event',title:'가상 사업 기록 사건',sensitivity:'S1',dedup_key:'web2:'+kind+':'+id+':가상',record:{summary:'가상 요지'},
   source:{kind,id,title:'Web2 사업 기록 2026-11-10',doc_type:'internal_doc',source_date:'2026-11-10'}}],needs_check:[],excluded:0,tokens_in:0,tokens_out:0,...extra});
  await t.test('biz_record records through the same functions (source web2:biz_record:<id>); the old kinds still work; unknown kinds refused',async()=>{
   await asCancelled('authenticated',OWNER,async c=>{
    const begun=(await c.query('select public.app_auto_ledger_begin($1) r',[WS_A])).rows[0].r;
    const r=(await c.query('select public.app_auto_ledger_record($1,$2) r',[begun.run_id,JSON.stringify(batch('biz_record',bizA))])).rows[0].r;
    assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.records_new,1);
    assert.equal((await c.query("select count(*)::int n from public.app_ledger_auto_sources where source_kind='biz_record' and source_id=$1",[bizA])).rows[0].n,1);
    assert.equal((await c.query('select count(*)::int n from public.app_ledger_sources where location=$1',['web2:biz_record:'+bizA])).rows[0].n,1);
    const begun2=(await c.query('select public.app_auto_ledger_begin($1) r',[WS_A])).rows[0].r;
    const old=(await c.query('select public.app_auto_ledger_record($1,$2) r',[begun2.run_id,JSON.stringify(batch('project_update','36000000-0000-4000-8000-000000000009'))])).rows[0].r;
    assert.equal(old.ok,true,JSON.stringify(old));
    for(const bad of ['biz','Biz_record','telegram']){
     const b=(await c.query('select public.app_auto_ledger_begin($1) r',[WS_A])).rows[0].r;
     const x=(await c.query('select public.app_auto_ledger_record($1,$2) r',[b.run_id,JSON.stringify({sources:[{kind:bad,id:bizA,updated_at:T}],items:[]})])).rows[0].r;
     assert.equal(x.ok,false,bad);assert.equal(x.error,'LEDGER_AUTO_BAD_BATCH',bad);
    }
   });
   assert.equal((await one("select count(*)::int n from public.app_ledger_auto_sources where source_kind='biz_record'")).n,0);
   // The processing table itself accepts only the ten (CHECK), also for a direct superuser write.
   const run1=(await owner(c=>c.query('select public.app_auto_ledger_begin($1) r',[WS_A]))).rows[0].r.run_id;
   await assert.rejects(pool.query("insert into public.app_ledger_auto_sources(workspace_id,source_kind,source_id,seen_updated_at,last_run_id) values ($1,'telegram',$2,now(),$3)",[WS_A,bizA,run1]),{code:'23514'});
   await pool.query("update public.app_ledger_auto_runs set status='failed',finished_at=now(),fail_code='TEST_CLEANUP' where status='running'");
  });
  await t.test('another workspace cannot record biz_record into this workspace (run, processing table); anon and service_role have nothing',async()=>{
   const runA=(await owner(c=>c.query('select public.app_auto_ledger_begin($1) r',[WS_A]))).rows[0].r.run_id;
   // A stranger cannot see or use the owner's run, cannot begin a run for WS_A, cannot write WS_A's processing table.
   await assert.rejects(stranger(c=>c.query('select public.app_auto_ledger_record($1,$2) r',[runA,JSON.stringify(batch('biz_record',bizA))])),/LEDGER_AUTO_RUN_NOT_FOUND|LEDGER_AUTO_NOT_OWNER/);
   await assert.rejects(stranger(c=>c.query('select public.app_auto_ledger_begin($1) r',[WS_A])),e=>['42501','P0001'].includes(e.code)||/NOT_OWNER/.test(e.message));
   await assert.rejects(stranger(c=>c.query("insert into public.app_ledger_auto_sources(workspace_id,source_kind,source_id,seen_updated_at,last_run_id) values ($1,'biz_record',$2,now(),$3)",[WS_A,bizB,runA])),e=>['42501','23514','23503'].includes(e.code));
   assert.equal((await stranger(c=>c.query("select count(*)::int n from public.app_ledger_auto_sources where workspace_id=$1",[WS_A]))).rows[0].n,0);
   await assert.rejects(anon(c=>c.query('select public.app_auto_ledger_record($1,$2)',[runA,'{}'])),{code:'42501'});
   await assert.rejects(service(c=>c.query("select private.app_auto_ledger_source_kind_ok('biz_record')")),{code:'42501'});
   await assert.rejects(anon(c=>c.query("select private.app_auto_ledger_source_kind_ok('biz_record')")),{code:'42501'});
   await pool.query("update public.app_ledger_auto_runs set status='failed',finished_at=now(),fail_code='TEST_CLEANUP' where status='running'");
   assert.equal((await one("select count(*)::int n from public.app_ledger_auto_sources where source_kind='biz_record'")).n,0);
  });
  await t.test('rollback is refused while biz_record rows exist; then restores the earlier state',async()=>{
   const blocked=async()=>{const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/LEDGER_BIZ_RECORDS_ROLLBACK_BLOCKED: biz_record rows exist/);await c.query('rollback');}finally{c.release();}};
   const src=(await one("insert into public.app_ledger_sources(workspace_id,title,doc_type,location) values ($1,'Web2 사업 기록','internal_doc',$2) returning id",[WS_A,'web2:biz_record:'+bizA])).id;
   await blocked();await pool.query('delete from public.app_ledger_sources where id=$1',[src]);
   const run1=(await owner(c=>c.query('select public.app_auto_ledger_begin($1) r',[WS_A]))).rows[0].r.run_id;
   await pool.query("insert into public.app_ledger_auto_sources(workspace_id,source_kind,source_id,seen_updated_at,last_run_id) values ($1,'biz_record',$2,now(),$3)",[WS_A,bizA,run1]);
   await blocked();await pool.query("delete from public.app_ledger_auto_sources where source_kind='biz_record'");
   await pool.query("update public.app_ledger_auto_runs set status='failed',finished_at=now(),fail_code='TEST_CLEANUP' where status='running'");
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(await readOnly(precheck),beforeCheck);
   await asCancelled('authenticated',OWNER,async c=>{
    const begun=(await c.query('select public.app_auto_ledger_begin($1) r',[WS_A])).rows[0].r;
    const bad=(await c.query('select public.app_auto_ledger_record($1,$2) r',[begun.run_id,JSON.stringify(batch('biz_record',bizA))])).rows[0].r;
    assert.equal(bad.ok,false);assert.equal(bad.error,'LEDGER_AUTO_BAD_BATCH');
   });
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
