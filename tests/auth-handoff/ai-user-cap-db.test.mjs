// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// AI-사람별한도 DB(20261113160000): 운영자 기능 키 ai_no_cap + 작업공간별 한도 표 + 이번 달 사용 합계 함수 셋.
// - 승인형 DB workflow 확장 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예.
// - 한도 표는 API 역할이 못 읽고 못 쓴다(SQL로만). 행이 없으면 기본 3,000원.
// - 합계는 이번 달(서울 날짜)만: 지난달 줄은 빠진다. 기존 사용 기록 표 셋(daily·news·external)만 읽는다.
// - owner 본인 작업공간만(app_my_ai_month), 남의 작업공간은 42501. 서버 함수는 service_role만. anon은 둘 다 못 부른다.
// - 운영자(calls) 작업공간만 exempt. 되돌리기는 함수·표·허용 행·검사·기록만 원래대로.
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
const version='20261113160000',name='ai_user_cap',stem=version+'_'+name;
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
// 서울 날짜 기준 이번 달 1일·지난달 마지막 날(시험 시각에서 계산).
const seoul=new Date(Date.now()+9*3600000);
const pad=n=>String(n).padStart(2,'0');
const THIS_MONTH=`${seoul.getUTCFullYear()}-${pad(seoul.getUTCMonth()+1)}`;
const FIRST=`${THIS_MONTH}-01`;
const LAST_PREV=new Date(Date.UTC(seoul.getUTCFullYear(),seoul.getUTCMonth(),0)).toISOString().slice(0,10);

test('ai user cap: per-workspace month totals, owner-only read, server-only cap, operator exempt; rollback restores',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'ai-user-cap-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  const family=await read('supabase/migrations/20261105100000_family_notes.sql');
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const guardFails=async(pattern)=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),pattern);await c.query('rollback');}finally{c.release();}};
  const feats=async()=>(await pool.query('select feature from public.app_operator_features order by feature')).rows.map(r=>r.feature);

  await t.test('guard: stops without changes before the family step (20261105100000) is applied',async()=>{
   await guardFails(/AI_USER_CAP_PREREQUISITE_CHANGED/);
   assert.equal((await pool.query("select to_regclass('public.app_workspace_ai_caps') t")).rows[0].t,null);
   await pool.query(family);
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

  await t.test('files: rules pass, summary 3 lines, no fixed id, snapshot reads catalogs only',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const sql of [precheck,postcheck,snapshot,rollbackSQL,migration])assert.doesNotMatch(sql.replace(/--.*$/gm,''),/information_schema/i);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.flow,'full');
    assert.deepEqual([...plan.createdTables],['app_workspace_ai_caps']);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bto\s+(anon|public)\b|disable row level security|create policy|rtw_/i);
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id in the migration');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
  });

  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(await readOnly(precheck));
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.equal(v['ai_no_cap rows'],'0');
   await allYes(postcheck);
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(await feats(),['calls','dev_inbox','family','files','gdrive_photos','telegram']);
   const apply=await run('apply','9982');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.equal((await run('apply','9983')).ok,false);
  });

  await t.test('feature: ai_no_cap only on the operator (calls) workspace; the stranger is capped',async()=>{
   assert.deepEqual((await pool.query("select workspace_id from public.app_operator_features where feature='ai_no_cap'")).rows,[{workspace_id:WS_A}]);
   const mine=(await owner(c=>c.query('select public.app_my_ai_month($1) m',[WS_A]))).rows[0].m;
   assert.equal(mine.exempt,true);
   const other=(await stranger(c=>c.query('select public.app_my_ai_month($1) m',[WS_B]))).rows[0].m;
   assert.equal(other.exempt,false);
   assert.equal(other.cap_krw,3000);
   assert.equal(other.month,THIS_MONTH);
   assert.deepEqual((await stranger(c=>c.query('select public.app_my_features() f'))).rows[0].f,[]);
  });

  await t.test('totals: this Seoul month only, three existing usage tables, Gemini per model',async()=>{
   await pool.query(`insert into public.app_ai_daily_usage(workspace_id,user_id,day,requests,input_tokens,output_tokens) values
     ($1,$2,$3,3,1000,200),($1,$2,$4,9,999999,999999)`,[WS_B,STRANGER,FIRST,LAST_PREV]);
   await pool.query('insert into public.app_news_days(workspace_id,day,ai_requests,ai_input_tokens,ai_output_tokens) values($1,$2,1,50,5),($1,$3,1,7777,7777)',[WS_B,FIRST,LAST_PREV]);
   await pool.query(`insert into public.app_ai_external_usage(workspace_id,ref,provider,source,model,day,calls,input_tokens,audio_tokens,output_tokens) values
     ($1,'mtg-aaaa0001','gemini','transcript','gemini-3.5-transcribe',$2,1,300,200,40),
     ($1,'mtg-aaaa0002','gemini','transcript','gemini-3.5-transcribe',$2,1,100,100,10),
     ($1,'mtg-aaaa0003','gemini','transcript','gemini-3.5-transcribe',$3,1,9999,9999,9999)`,[WS_B,FIRST,LAST_PREV]);
   // 남의 작업공간(WS_A) 줄은 WS_B 합계에 섞이지 않는다.
   await pool.query('insert into public.app_ai_daily_usage(workspace_id,user_id,day,requests,input_tokens,output_tokens) values($1,$2,$3,1,123456,654321)',[WS_A,OWNER,FIRST]);
   const m=(await server(c=>c.query('select public.app_workspace_ai_month($1) m',[WS_B]))).rows[0].m;
   assert.equal(Number(m.openai_input_tokens),1050);
   assert.equal(Number(m.openai_output_tokens),205);
   assert.deepEqual(m.gemini.map(g=>[g.model,Number(g.input_tokens),Number(g.audio_tokens),Number(g.output_tokens)]),[['gemini-3.5-transcribe',400,300,50]]);
   assert.equal(m.exempt,false);
   const mine=(await stranger(c=>c.query('select public.app_my_ai_month($1) m',[WS_B]))).rows[0].m;
   assert.equal(Number(mine.openai_input_tokens),1050);
  });

  await t.test('cap: one row per workspace, SQL only; API roles cannot read or write it',async()=>{
   await pool.query('insert into public.app_workspace_ai_caps(workspace_id,monthly_cap_krw) values($1,5000)',[WS_B]);
   assert.equal((await stranger(c=>c.query('select public.app_my_ai_month($1) m',[WS_B]))).rows[0].m.cap_krw,5000);
   for(const fn of [owner,stranger,server,anon])await assert.rejects(fn(c=>c.query('select * from public.app_workspace_ai_caps')),{code:'42501'});
   await assert.rejects(stranger(c=>c.query('update public.app_workspace_ai_caps set monthly_cap_krw=999999 where workspace_id=$1',[WS_B])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query('insert into public.app_workspace_ai_caps(workspace_id,monthly_cap_krw) values($1,999999)',[WS_B])),{code:'42501'});
   await assert.rejects(pool.query('insert into public.app_workspace_ai_caps(workspace_id,monthly_cap_krw) values($1,-1)',[WS_A]),{code:'23514'});
   await pool.query('delete from public.app_workspace_ai_caps where workspace_id=$1',[WS_B]);
   assert.equal((await stranger(c=>c.query('select public.app_my_ai_month($1) m',[WS_B]))).rows[0].m.cap_krw,3000);
  });

  await t.test('boundary: no one reads another workspace; server function is service_role only; private function closed',async()=>{
   await assert.rejects(stranger(c=>c.query('select public.app_my_ai_month($1) m',[WS_A])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('select public.app_my_ai_month($1) m',[WS_B])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query('select public.app_my_ai_month(null) m')),{code:'42501'});
   await assert.rejects(anon(c=>c.query('select public.app_my_ai_month($1) m',[WS_B])),{code:'42501'});
   for(const fn of [owner,stranger,anon])await assert.rejects(fn(c=>c.query('select public.app_workspace_ai_month($1) m',[WS_B])),{code:'42501'});
   await assert.rejects(server(c=>c.query('select public.app_my_ai_month($1) m',[WS_B])),{code:'42501'});
   for(const fn of [owner,server,anon])await assert.rejects(fn(c=>c.query('select private.app_ai_month_usage($1) m',[WS_B])),{code:'42501'});
   // 운영자 표를 API 역할이 직접 고쳐 한도를 빠져나가지 못한다.
   await assert.rejects(stranger(c=>c.query("insert into public.app_operator_features(workspace_id,feature) values($1,'ai_no_cap')",[WS_B])),{code:'42501'});
  });

  await t.test('rollback restores the check, removes the table, functions, feature row and record; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.deepEqual(await feats(),['calls','dev_inbox','family','files','gdrive_photos','telegram']);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await allYes(postcheck);
   assert.equal(values(await readOnly(precheck))['new migration absent'],'예');
   const again=await run('apply','9984');assert.equal(again.ok,true,again.summary);
   await allYes(postcheck);
  });

  await t.test('guard: stops without changes when calls is not on exactly one workspace',async()=>{
   await pool.query(rollbackSQL);
   await pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'calls')",[WS_B]);
   await guardFails(/AI_USER_CAP_SEED_WORKSPACE_NOT_SINGLE/);
   await pool.query("delete from public.app_operator_features where workspace_id=$1 and feature='calls'",[WS_B]);
   assert.deepEqual(await feats(),['calls','dev_inbox','family','files','gdrive_photos','telegram']);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
