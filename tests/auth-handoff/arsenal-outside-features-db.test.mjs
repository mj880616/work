// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// MULTI-처음쓰는사람 ③(20261113230000): 운영자 기능 키 arsenal(아스날)·outside(News) + 운영자(calls) 작업공간에 키마다 1행.
// - 승인형 DB workflow 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예.
// - 허용 행은 calls 작업공간에만. calls가 하나가 아니면 멈추고 아무것도 바꾸지 않는다. 앞 단계(ai_user_cap)가 없어도 멈춘다.
// - 권한을 넓히지 않는다: 운영자 표는 API 역할이 못 읽고 못 쓰며, 다른 owner의 app_my_features에는 새 키가 없다.
// - 되돌리기는 두 허용 행·검사·기록만 원래대로 하고, 다른 허용 행은 그대로 둔다.
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
const version='20261113230000',name='arsenal_outside_features',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const BEFORE=['20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261025200000_call_personal_box',
 '20261025210000_feed_item_archive','20261026120000_call_user_edit','20261026190000_tg_sender_names','20261027010000_tg_room_day_group',
 '20261027030000_tg_sender_names_read','20261027200000_tg_summary_edit','20261028030000_tg_room_day_context','20261029090000_operator_features'];

test('arsenal·outside features: operator workspace only, no new privileges, rollback restores',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'arsenal-outside-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  await pool.query(`create table public.app_documents(id uuid primary key, workspace_id uuid not null, file_id text, extraction_status text, extracted_text text);
   alter table public.app_documents enable row level security;
   create policy fake_docs_owner on public.app_documents for select to authenticated using (private.app_is_workspace_owner(workspace_id));
   grant select on public.app_documents to authenticated;`);
  // 기존 사용 기록 표의 최소 모양(운영과 같은 칸 이름·owner 정책).
  await pool.query(`create table public.app_ai_daily_usage(workspace_id uuid not null references public.app_workspaces(id), user_id uuid not null, day date not null,
     requests integer not null default 0, advanced_requests integer not null default 0, input_tokens bigint not null default 0, output_tokens bigint not null default 0,
     updated_at timestamptz not null default now(), primary key(workspace_id,user_id,day));
   alter table public.app_ai_daily_usage enable row level security;
   create policy fake_usage_owner on public.app_ai_daily_usage for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
   grant select, insert, update on public.app_ai_daily_usage to authenticated;
   create table public.app_news_days(workspace_id uuid not null references public.app_workspaces(id), day date not null,
     ai_requests integer not null default 0, ai_input_tokens bigint not null default 0, ai_output_tokens bigint not null default 0, primary key(workspace_id,day));
   alter table public.app_news_days enable row level security;`);
  await pool.query("update public.app_workspaces set slug='kptu-work' where id=$1",[WS_A]);
  await pool.query("update public.app_workspaces set slug='other-work' where id=$1",[WS_B]);
  for(const f of BEFORE.slice(0,-1))await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-24','2026-10-24T03:00:00Z','가상 통화','가상 요약','call:uc1')",[WS_A]);
  await pool.query(await read('supabase/migrations/'+BEFORE.at(-1)+'.sql'));
  for(const f of ['20261028160000_ai_usage_costs','20261031120000_gdrive_photo_index','20261102160000_cloud_files_index','20261103100000_dev_inbox_feature'])
   await pool.query(await read('supabase/migrations/'+f+'.sql'));
  for(const f of ['20261105100000_family_notes'])await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const aiCap=await read('supabase/migrations/20261113160000_ai_user_cap.sql');
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const guardFails=async(pattern)=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),pattern);await c.query('rollback');}finally{c.release();}};
  const feats=async()=>(await pool.query('select feature from public.app_operator_features order by feature')).rows.map(r=>r.feature);
  const SEVEN=['ai_no_cap','calls','dev_inbox','family','files','gdrive_photos','telegram'];

  await t.test('guard: stops without changes before the AI cap step (20261113160000) is applied',async()=>{
   await guardFails(/ARSENAL_OUTSIDE_PREREQUISITE_CHANGED/);
   assert.ok(!(await feats()).includes('arsenal'));
   await pool.query(aiCap);
   assert.deepEqual(await feats(),SEVEN);
  });
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const allYes=async sql=>{for(const r of await readOnly(sql))assert.equal(r.ok,'예',r.item);};
  const before=(await pool.query(snapshot)).rows;

  await t.test('files: rules pass, summary 3 lines, no fixed id, no grants/policies/functions, snapshot reads catalogs only',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const sql of [precheck,postcheck,snapshot,rollbackSQL,migration])assert.doesNotMatch(sql.replace(/--.*$/gm,''),/information_schema/i);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.flow,'full');
    assert.deepEqual([...plan.createdTables],[]);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bgrant\b|\brevoke\b|create (or replace )?(function|policy|trigger|table)|disable row level security|security definer|rtw_/i);
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id in the migration');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
  });

  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(await readOnly(precheck));
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.equal(v['arsenal·outside rows'],'0');
   await allYes(postcheck);
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(await feats(),SEVEN);
   const apply=await run('apply','9982');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.equal((await run('apply','9983')).ok,false);
  });

  await t.test('feature: arsenal·outside only for the operator workspace owner; stranger has none; the allow table stays closed to API roles',async()=>{
   assert.deepEqual((await pool.query("select workspace_id,feature from public.app_operator_features where feature in ('arsenal','outside') order by feature")).rows,
    [{workspace_id:WS_A,feature:'arsenal'},{workspace_id:WS_A,feature:'outside'}]);
   const mine=(await owner(c=>c.query('select public.app_my_features() f'))).rows[0].f;
   assert.ok(mine.includes('arsenal')&&mine.includes('outside')&&mine.includes('calls'));
   assert.deepEqual((await stranger(c=>c.query('select public.app_my_features() f'))).rows[0].f,[]);
   for(const fn of [owner,stranger,server,anon])await assert.rejects(fn(c=>c.query('select * from public.app_operator_features')),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_operator_features(workspace_id,feature) values($1,'arsenal')",[WS_B])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query("insert into public.app_operator_features(workspace_id,feature) values($1,'outside')",[WS_B])),{code:'42501'});
   await assert.rejects(pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'bogus')",[WS_B]),{code:'23514'});
  });

  await t.test('rollback restores the check, removes the two rows and record; other allow rows stay; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.deepEqual(await feats(),SEVEN);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await allYes(postcheck);
   assert.equal(values(await readOnly(precheck))['new migration absent'],'예');
   const again=await run('apply','9984');assert.equal(again.ok,true,again.summary);
   await allYes(postcheck);
  });

  await t.test('guard: stops without changes when calls is not on exactly one workspace',async()=>{
   await pool.query(rollbackSQL);
   await pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'calls')",[WS_B]);
   await guardFails(/ARSENAL_OUTSIDE_SEED_WORKSPACE_NOT_SINGLE/);
   await pool.query("delete from public.app_operator_features where workspace_id=$1 and feature='calls'",[WS_B]);
   assert.deepEqual(await feats(),SEVEN);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
