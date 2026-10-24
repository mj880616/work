// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// CALL-TG 보정: 20261024210000_feed_item_guard_public — the insert guard trigger no longer calls private.* functions, so service_role
// (which has no schema private USAGE in production) can insert feed rows. Checks stay the same for every role. No grant is widened.
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
import {fixture,OWNER,WS_A,PROJECT_A,PROJECT_B,ORG_A,ORG_B} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261024210000',name='feed_item_guard_public',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const CALL={workspace_id:WS_A,source:'call',day:'2026-10-24',occurred_at:'2026-10-24T01:10:00Z',title:'가상 통화',points:'[]',source_ref:'call:guardfake1'};
const TG={workspace_id:WS_A,source:'telegram',day:'2026-10-24',occurred_at:'2026-10-24T00:05:00Z',room_key:'room-a1',room_label:'가상 단체방',summary:'가상 소식',raw_text:'A: 가상',raw_count:1,points:'[]',source_ref:'tg:guardfake1'};

test('feed guard without private calls: production-like service_role insert fails before, works after; checks unchanged; rollback restores',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'feed-guard-public-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  // Production: service_role has no USAGE on schema private (authenticated does). The shared fixture grants both, so take it away here.
  await pool.query('revoke usage on schema private from service_role');
  // Production: the Web2 owner reads app_spaces through RLS (owner policy); the shared fixture revokes that grant, so restore it here.
  await pool.query('grant select on public.app_spaces to authenticated');
  await pool.query('alter table public.app_spaces enable row level security');
  await pool.query('create policy fake_owner_read on public.app_spaces for select to authenticated using (private.app_is_workspace_owner(workspace_id))');
  assert.equal((await pool.query("select has_schema_privilege('service_role','private','usage') u")).rows[0].u,false);
  await pool.query(await read('supabase/migrations/20261024140000_call_tg_feed.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),server=fn=>as('service_role','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const COLS=['workspace_id','source','day','occurred_at','room_key','room_label','title','summary','points','raw_text','raw_count','organization_id','suggested_project_id','source_ref'];
  const put=(c,row,over={})=>{const r={...row,...over};const cols=COLS.filter(k=>k in r);
   return c.query(`insert into public.app_feed_items(${cols.join(',')}) values(${cols.map((k,i)=>k==='points'?`$${i+1}::jsonb`:`$${i+1}`).join(',')}) on conflict (workspace_id,source,source_ref) do nothing`,cols.map(k=>r[k]));};
  const count=async()=>(await pool.query('select count(*)::int n from public.app_feed_items')).rows[0].n;
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('before: service_role insert is refused with the production error; owner path works',async()=>{
   await assert.rejects(server(c=>put(c,CALL)),{code:'42501',message:/permission denied for schema private/});
   await assert.rejects(server(c=>put(c,TG)),{code:'42501',message:/permission denied for schema private/});
   assert.equal(await count(),0);
  });
  await t.test('files: expanded rules pass; one function replaced, INVOKER, no private call, no grant, no policy; rollback restores old body; summary 3 lines',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual(plan.functions,['private.app_feed_item_guard']);assert.equal(plan.review.definer.length,0);assert.equal(plan.review.policies,0);
    assert.deepEqual(plan.createdTables,[]);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const body=code.slice(code.indexOf('as $guard$'),code.indexOf('$guard$;'));
   assert.doesNotMatch(body,/private\./);
   assert.doesNotMatch(code,/security definer|disable row level security|create policy|alter policy|drop policy|\bto (?:anon|public|service_role|authenticated)\b|rtw_|grant /i);
   assert.doesNotMatch(code,/grant usage on schema/i);
   assert.match(code,/revoke all on function private\.app_feed_item_guard\(\) from public, anon, authenticated, service_role;/);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261024210000', 'feed_item_guard_public'/);
   assert.match(rollbackSQL,/SQL Editor 경로 전용/);
   const orig=s=>{const i=s.indexOf('function private.app_feed_item_guard');return s.slice(s.indexOf('as $guard$',i),s.indexOf('$guard$;',i)+8);};
   const prev=await read('supabase/migrations/20261024140000_call_tg_feed.sql');
   assert.equal(orig(rollbackSQL),orig(prev));
  });
  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.equal(v['service_role schema private usage'],'false');
   const dry=await run('dry-run','9921');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await readOnly(precheck),beforeCheck);
   const apply=await run('apply','9922');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck));
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else assert.equal(value,v[item],item);
   }
   assert.equal((await run('apply','9923')).ok,false);
   assert.equal((await pool.query("select has_schema_privilege('service_role','private','usage') u")).rows[0].u,false,'no schema USAGE was granted');
  });
  await t.test('after: service_role inserts call and telegram rows once with links in the same workspace',async()=>{
   await server(c=>put(c,CALL,{organization_id:ORG_A,suggested_project_id:PROJECT_A}));
   await server(c=>put(c,TG));
   await server(c=>put(c,CALL,{title:'다른 제목'}));
   assert.equal(await count(),2,'same source_ref is stored once');
  });
  await t.test('after: other-workspace links are refused for service_role and owner; raw text is clear-only; owner still pins and clears',async()=>{
   await assert.rejects(server(c=>put(c,CALL,{source_ref:'call:o1',organization_id:ORG_B})),/FEED_LINK_SCOPE/);
   await assert.rejects(server(c=>put(c,CALL,{source_ref:'call:o2',suggested_project_id:PROJECT_B})),/FEED_LINK_SCOPE/);
   await assert.rejects(owner(c=>c.query("update public.app_feed_items set project_id=$1 where source='call'",[PROJECT_B])),/FEED_LINK_SCOPE/);
   await assert.rejects(owner(c=>c.query("update public.app_feed_items set organization_id=$1 where source='call'",[ORG_B])),/FEED_LINK_SCOPE/);
   await assert.rejects(owner(c=>c.query("update public.app_feed_items set raw_text='되살리기' where source='telegram'")),/FEED_RAW_TEXT_CLEAR_ONLY/);
   assert.equal((await owner(c=>c.query("update public.app_feed_items set project_id=$1 where source='call'",[PROJECT_A]))).rowCount,1);
   assert.equal((await owner(c=>c.query("update public.app_feed_items set pinned_at=now(),raw_text=null where source='telegram'"))).rowCount,1);
   await assert.rejects(server(c=>c.query("update public.app_feed_items set summary='x'")),{code:'42501'});
   await assert.rejects(server(c=>c.query('delete from public.app_feed_items')),{code:'42501'});
   await assert.rejects(owner(c=>c.query('select private.app_feed_item_guard()')),{code:/^(42501|0A000)$/});
   await assert.rejects(server(c=>c.query('select private.app_feed_item_guard()')),{code:/^(42501|0A000)$/});
  });
  await t.test('rollback restores the old body (service_role insert blocked again) and the snapshot; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await assert.rejects(server(c=>put(c,CALL,{source_ref:'call:again'})),{code:'42501',message:/permission denied for schema private/});
   assert.equal(await count(),2,'rows kept');
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   await server(c=>put(c,CALL,{source_ref:'call:again'}));
   assert.equal(await count(),3);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
