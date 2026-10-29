// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// MULTI-노조사용자 단계 ① DB: 20261029090000_operator_features - calls/telegram are allowed only for the workspace in a server allow table.
// The allow table is seeded in the same transaction for the single workspace that already holds call/telegram data; every other
// workspace owner reads 0 rows (restrictive policy) and nobody can write call/telegram rows there (trigger), including definer RPCs and service_role.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261029090000',name='operator_features',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const BEFORE=['20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261025200000_call_personal_box',
 '20261025210000_feed_item_archive','20261026120000_call_user_edit','20261026190000_tg_sender_names','20261027010000_tg_room_day_group',
 '20261027030000_tg_sender_names_read','20261027200000_tg_summary_edit','20261028030000_tg_room_day_context'];
const TABLES=['app_feed_items','app_feed_days','app_call_personal','app_call_edits','app_call_edit_history','app_tg_senders',
 'app_tg_day_senders','app_feed_folders','app_feed_rooms','app_feed_room_days','app_feed_summary_edits','app_feed_summary_edit_history'];

test('operator features: server allow table, seeded for the one data workspace; other owners read nothing and cannot write calls/telegram; rollback restores',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'operator-features-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query('revoke usage on schema private from service_role');
  await pool.query('grant select on public.app_spaces to authenticated');
  await pool.query('alter table public.app_spaces enable row level security');
  await pool.query('create policy fake_owner_read on public.app_spaces for select to authenticated using (private.app_is_workspace_owner(workspace_id))');
  for(const f of BEFORE)await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const count=async(fn,table)=>(await fn(c=>c.query('select count(*)::int n from public.'+table))).rows[0].n;
  // Call/telegram data exists only in the owner's workspace (WS_A), like production.
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-24','2026-10-24T03:00:00Z','가상 통화','가상 요약','call:op1')",[WS_A]);
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,room_key,room_label,title,summary,raw_count,source_ref) values($1,'telegram','2026-10-24','2026-10-24T03:00:00Z','room_op_1','가상 방','가상 소식','가상 요약',2,'tg:op1')",[WS_A]);
  await pool.query("insert into public.app_feed_days(workspace_id,day,source,total_count,kept_count,personal_count,unsure_count) values($1,'2026-10-24','call',5,1,2,2)",[WS_A]);
  await pool.query("insert into public.app_tg_senders(workspace_id,name) values($1,'가상')",[WS_A]);
  const before=(await pool.query(snapshot)).rows;
  const beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules pass; one new table, four definer functions, 12 restrictive policies and 12 triggers; grants only as designed; summary 3 lines',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const sql of [precheck,postcheck,snapshot,rollbackSQL,migration])assert.doesNotMatch(sql.replace(/--.*$/gm,''),/information_schema/i);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual(plan.createdTables,['app_operator_features']);
    assert.deepEqual([...plan.review.definer].sort(),['private.app_operator_feature_guard','private.app_workspace_has_feature','public.app_my_features','public.app_operator_feature_workspace']);
    assert.equal(plan.review.policies,12);assert.equal(plan.review.restrictive,12);assert.equal(plan.review.triggers,12);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0].replace(/\s+/g,' '));
   assert.deepEqual(grants,['grant execute on function private.app_workspace_has_feature(uuid, text) to authenticated;','grant execute on function public.app_my_features() to authenticated;','grant execute on function public.app_operator_feature_workspace(text) to service_role;']);
   assert.doesNotMatch(code,/alter policy|drop policy|create or replace|alter table public\.app_(feed|call|tg)_|rtw_|disable row level security|\bto (anon|public)\b/i);
   for(const table of TABLES){
    assert.match(code,new RegExp('create policy op_feature_read on public\\.'+table+' as restrictive for select to authenticated'),table);
    assert.match(code,new RegExp('create trigger trg_op_feature_guard before insert or update on public\\.'+table+'\\s'),table);
    assert.match(rollbackSQL,new RegExp('drop trigger trg_op_feature_guard on public\\.'+table+';'),table);
    assert.match(rollbackSQL,new RegExp('drop policy op_feature_read on public\\.'+table+';'),table);
   }
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id in the migration');
   assert.match(rollbackSQL,/SQL Editor 경로 전용/);
   // 운영에 없는 텔레그램 개인 하루 표(20261025030000 미적용·적용 계획 없음)는 이 migration과 짝 파일 어디에도 전제하지 않는다.
   for(const sql of [migration,precheck,postcheck,snapshot,rollbackSQL,summary])assert.doesNotMatch(sql,/app_tg_personal/);
   assert.equal(TABLES.length,12);
  });
  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9982');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck));
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else assert.equal(value,v[item],item);
   }
   assert.equal((await run('apply','9983')).ok,false);
  });
  await t.test('the allow table holds calls+telegram for the data workspace only and is closed to every API role',async()=>{
   assert.deepEqual((await pool.query('select workspace_id,feature from public.app_operator_features order by feature')).rows,[{workspace_id:WS_A,feature:'calls'},{workspace_id:WS_A,feature:'telegram'}]);
   for(const fn of [owner,stranger,server])await assert.rejects(fn(c=>c.query('select * from public.app_operator_features')),{code:'42501'});
   await assert.rejects(stranger(c=>c.query('insert into public.app_operator_features(workspace_id,feature) values($1,$2)',[WS_B,'calls'])),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query('select public.app_my_features()')),{code:'42501'});
   await assert.rejects(owner(c=>c.query('select private.app_operator_feature_guard()')),{code:/^(42501|0A000)$/});
   await assert.rejects(owner(c=>c.query("select public.app_operator_feature_workspace('calls')")),{code:'42501'});
  });
  await t.test('owner keeps reading and writing; feature list and checks never trust a passed workspace',async()=>{
   assert.deepEqual((await owner(c=>c.query('select public.app_my_features() f'))).rows[0].f,['calls','telegram']);
   assert.deepEqual((await stranger(c=>c.query('select public.app_my_features() f'))).rows[0].f,[]);
   assert.equal((await owner(c=>c.query("select private.app_workspace_has_feature($1,'calls') v",[WS_A]))).rows[0].v,true);
   assert.equal((await owner(c=>c.query("select private.app_workspace_has_feature($1,'calls') v",[WS_B]))).rows[0].v,false);
   assert.equal((await stranger(c=>c.query("select private.app_workspace_has_feature($1,'calls') v",[WS_A]))).rows[0].v,false,'not the owner of the allowed workspace');
   assert.equal(await count(owner,'app_feed_items'),2);
   assert.equal(await count(owner,'app_tg_senders'),1);
   const made=(await owner(c=>c.query("select public.app_feed_folder_create('가상 폴더') r"))).rows[0].r;assert.equal(made.ok,true);
   assert.equal((await server(c=>c.query("select public.app_operator_feature_workspace('telegram') w"))).rows[0].w,WS_A);
   await server(c=>c.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-25','2026-10-25T03:00:00Z','가상 통화 2','가상 요약','call:op2')",[WS_A]));
  });
  await t.test('another owner: nothing readable even if rows exist, every write path refused (definer RPC, service_role)',async()=>{
   const c=await pool.connect();
   try{await c.query('begin');await c.query('set local session_replication_role = replica');
    await c.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-24','2026-10-24T03:00:00Z','남의 통화','요약','call:opb1')",[WS_B]);
    await c.query("insert into public.app_tg_senders(workspace_id,name) values($1,'남의 이름')",[WS_B]);
    await c.query('commit');}finally{c.release();}
   assert.equal(await count(stranger,'app_feed_items'),0);
   assert.equal(await count(stranger,'app_tg_senders'),0);
   assert.equal((await stranger(c=>c.query("select count(*)::int n from public.app_feed_room_day_lines('2026-10-01','2026-10-31')"))).rows[0].n,0);
   await assert.rejects(stranger(c=>c.query("select public.app_feed_folder_create('남의 폴더')")),/OPERATOR_FEATURE_REQUIRED/);
   await assert.rejects(server(c=>c.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-25','2026-10-25T03:00:00Z','t','s','call:opb2')",[WS_B])),/OPERATOR_FEATURE_REQUIRED/);
   await assert.rejects(server(c=>c.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,room_key,room_label,title,summary,raw_count,source_ref) values($1,'telegram','2026-10-25','2026-10-25T03:00:00Z','room_op_b','가상 방','t','s',1,'tg:opb2')",[WS_B])),/OPERATOR_FEATURE_REQUIRED/);
   await pool.query("delete from public.app_feed_items where source_ref='call:opb1'");await pool.query('delete from public.app_tg_senders where workspace_id=$1',[WS_B]);
  });
  await t.test('rollback drops only what this file made; the data stays; re-apply works',async()=>{
   const rowsBefore=(await pool.query('select count(*)::int n from public.app_feed_items')).rows[0].n;
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.equal((await pool.query("select to_regclass('public.app_operator_features') a,to_regprocedure('public.app_my_features()') f")).rows[0].a,null);
   assert.equal((await pool.query('select count(*)::int n from public.app_feed_items')).rows[0].n,rowsBefore);
   const pre=values(await readOnly(precheck));
   for(const k of ['existing policies hash','table grants and RLS hash','existing triggers hash'])assert.equal(pre[k],values(beforeCheck)[k],k);
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
