// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S51-10 NEWS-전면개편 P3a(20261106100000_feed_ai_days): 수집·미리 만들기 AI 사용량 하루 표 app_feed_ai_days + 상세 분류 칸 app_now_details.topic.
// - 승인형 DB workflow 확장 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예.
// - 소유자만 읽는다(홈 'AI 사용량'이 소유자 토큰으로 읽음). 서버(service_role)는 읽기·넣기·고치기(upsert)만, 지우기 없음. anon·PUBLIC 없음.
// - (workspace_id, day, feature) 한 줄, 기능 셋, 칸 0 이상·상한. topic은 넷 중 하나 또는 null, 기존 줄·권한 그대로.
// - 되돌리기는 줄이 있거나 topic 값이 있으면 멈추고, 없으면 표·칸·기록만 원래대로.
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
const version='20261106100000',name='feed_ai_days',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// 상세 표는 이 migration이 보는 칸만 갖춘 합성 모양이다(운영과 같은 표 단위 권한: 소유자 읽기, 서버 읽기·넣기·고치기·지우기).
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;
  create table public.app_now_details(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id) on delete cascade, summary text, updated_at timestamptz not null default now());
  alter table public.app_now_details enable row level security;
  revoke all on table public.app_now_details from public, anon, authenticated, service_role;
  grant select on table public.app_now_details to authenticated;
  grant select, insert, update, delete on table public.app_now_details to service_role;
  create policy now_details_owner_select on public.app_now_details for select to authenticated using (private.app_is_workspace_owner(workspace_id));
  -- 운영 모양: service_role에는 schema private USAGE가 없다.
  revoke usage on schema private from service_role;`;
const STEPS=`insert into supabase_migrations.schema_migrations(version,name) values ('20261102140000','now_detail');`;

test('feed ai days db: plan, dry-run, apply, owner read only, server upsert without delete, checks, topic column, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'feed-ai-days-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const allYes=async sql=>{for(const r of await readOnly(sql))assert.equal(r.value,'예',r.item);};
  const guardFails=async pattern=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),pattern);await c.query('rollback');}finally{c.release();}};
  // 서버 더하기: 같은 날·기능 줄에 더한다(P3c 수집 함수가 쓸 모양).
  const add=(c,r)=>c.query(`insert into public.app_feed_ai_days(workspace_id,day,feature,requests,input_tokens,output_tokens,cost_krw)
    values ($1,$2,$3,$4,$5,$6,$7) on conflict (workspace_id,day,feature) do update set
    requests=app_feed_ai_days.requests+excluded.requests,input_tokens=app_feed_ai_days.input_tokens+excluded.input_tokens,
    output_tokens=app_feed_ai_days.output_tokens+excluded.output_tokens,cost_krw=app_feed_ai_days.cost_krw+excluded.cost_krw,updated_at=now()`,
    [r.ws??WS_A,r.day??'2026-11-06',r.feature??'prebuild',r.requests??1,r.input??6000,r.output??1200,r.krw??1.68]);
  const detail=(await pool.query("insert into public.app_now_details(workspace_id,summary) values ($1,'합성 요약'),($2,'남의 요약') returning id",[WS_A,WS_B])).rows.map(r=>r.id);

  await t.test('guard: stops without changes when the detail DB step is not recorded',async()=>{
   await guardFails(/FEED_AI_DAYS_PREREQUISITE_CHANGED/);
   assert.equal((await pool.query("select to_regclass('public.app_feed_ai_days') t")).rows[0].t,null);
   await pool.query(STEPS);
  });
  const before=(await pool.query(snapshot)).rows;

  await t.test('files: expanded rules, full flow, one new table and no function, summary 3 lines, snapshot reads catalogs only',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const sql of [precheck,postcheck,snapshot,rollbackSQL,migration])assert.doesNotMatch(sql.replace(/--.*$/gm,''),/information_schema/i);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.flow,'full');assert.equal(plan.rules,'expanded');
    assert.deepEqual([...plan.createdTables],['app_feed_ai_days']);
    assert.deepEqual([...plan.functions],[]);
    assert.deepEqual(plan.review.definer,[]);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bto (anon|public)\b|disable row level security|alter policy|drop policy|create function|security definer|rtw_|grant usage on schema/i);
   assert.doesNotMatch(code,/on (table )?public\.app_now_details\b/i,'detail grants and policies untouched');
   assert.equal((code.match(/alter table public\.app_now_details/gi)||[]).length,1,'one detail change: add column topic');
   assert.doesNotMatch(code,/15000|10000원|limit_krw/i,'no monthly cap value stored in the DB');
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id in the migration');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
   assert.doesNotMatch(precheck.replace(/--.*$/gm,''),/from public\./i,'precheck reads no app table rows');
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261106100000', 'feed_ai_days'/);
   assert.match(rollbackSQL,/SQL Editor\(폰 경로 C\) 전용/);
   assert.match(rollbackSQL,/FEED_AI_DAYS_ROLLBACK_BLOCKED: rows exist/);assert.match(rollbackSQL,/FEED_AI_DAYS_ROLLBACK_BLOCKED: topic values exist/);
  });

  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(await readOnly(precheck));
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   await allYes(postcheck);
   const dry=await run('dry-run','9991');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9992');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.equal((await run('apply','9993')).ok,false);
  });

  await t.test('shape: columns as designed; checks reject bad feature, negative and over-limit values',async()=>{
   const cols=(await pool.query("select attname from pg_attribute where attrelid='public.app_feed_ai_days'::regclass and attnum>0 and not attisdropped order by attnum")).rows.map(r=>r.attname);
   assert.deepEqual(cols,['workspace_id','day','feature','requests','input_tokens','output_tokens','cost_krw','updated_at']);
   for(const feature of ['outside_summary','news_summary','prebuild'])await assert.doesNotReject(server(c=>add(c,{feature,day:'2026-11-01'})),feature);
   await assert.doesNotReject(server(c=>add(c,{day:'2026-11-02',requests:100000,input:1000000000,output:1000000000,krw:1000000})),'upper limits');
   const bad=[['feature',{feature:'translate'}],['negative requests',{requests:-1}],['requests over',{requests:100001}],
    ['input over',{input:1000000001}],['output negative',{output:-1}],['krw over',{krw:1000000.0001}],['krw negative',{krw:-0.01}]];
   for(const [label,row] of bad)await assert.rejects(server(c=>add(c,{day:'2026-11-03',...row})),{code:'23514'},label);
   await pool.query('delete from public.app_feed_ai_days');
  });

  await t.test('server: one row per workspace, day and feature adds up; no delete; no updated_at insert',async()=>{
   await server(c=>add(c,{}));await server(c=>add(c,{}));
   await server(c=>add(c,{feature:'news_summary',requests:2,input:10,output:10,krw:0.01}));
   await server(c=>add(c,{ws:WS_B,feature:'outside_summary'}));
   const rows=(await pool.query("select requests,input_tokens::int i,output_tokens::int o,cost_krw::text k from public.app_feed_ai_days where workspace_id=$1 and feature='prebuild'",[WS_A])).rows;
   assert.deepEqual(rows,[{requests:2,i:12000,o:2400,k:'3.3600'}]);
   await assert.rejects(server(c=>c.query('delete from public.app_feed_ai_days')),{code:'42501'});
   await assert.rejects(server(c=>c.query("insert into public.app_feed_ai_days(workspace_id,day,feature,updated_at) values ($1,'2026-11-04','prebuild',now())",[WS_A])),{code:'42501'});
   await assert.rejects(server(c=>c.query("insert into public.app_feed_ai_days(workspace_id,day,feature) values ($1,'2026-11-06','prebuild')",[WS_A])),{code:'23505'});
  });

  await t.test('owner reads own rows only; no insert, update or delete; stranger sees own only; anon nothing',async()=>{
   assert.equal((await owner(c=>c.query('select count(*)::int n from public.app_feed_ai_days'))).rows[0].n,2);
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_feed_ai_days'))).rows[0].n,1);
   await assert.rejects(owner(c=>add(c,{day:'2026-11-05'})),{code:'42501'});
   await assert.rejects(owner(c=>c.query('update public.app_feed_ai_days set requests=0')),{code:'42501'});
   await assert.rejects(owner(c=>c.query('delete from public.app_feed_ai_days')),{code:'42501'});
   await assert.rejects(anon(c=>c.query('select 1 from public.app_feed_ai_days')),{code:'42501'});
  });

  await t.test('topic: existing rows stay null; server sets one of four; others refused; owner reads but cannot write',async()=>{
   assert.deepEqual((await pool.query('select summary,topic from public.app_now_details order by summary')).rows,[{summary:'남의 요약',topic:null},{summary:'합성 요약',topic:null}]);
   for(const topic of ['labor','politics','economy','society',null])await assert.doesNotReject(server(c=>c.query('update public.app_now_details set topic=$1 where id=$2',[topic,detail[0]])),String(topic));
   for(const topic of ['노동','international','statement',''])await assert.rejects(server(c=>c.query('update public.app_now_details set topic=$1 where id=$2',[topic,detail[0]])),{code:'23514'},topic);
   await server(c=>c.query("update public.app_now_details set topic='labor' where id=$1",[detail[0]]));
   assert.deepEqual((await owner(c=>c.query('select topic from public.app_now_details'))).rows,[{topic:'labor'}]);
   await assert.rejects(owner(c=>c.query('update public.app_now_details set topic=null')),{code:'42501'});
   await assert.rejects(anon(c=>c.query('select topic from public.app_now_details')),{code:'42501'});
  });

  await t.test('cascade: deleting a workspace removes its usage rows',async()=>{
   const WS_C='21000000-0000-4000-8000-0000000000c3';
   await pool.query("insert into public.app_workspaces(id,name) values ($1,'합성 셋째')",[WS_C]);
   await server(c=>add(c,{ws:WS_C}));
   assert.equal((await pool.query('select count(*)::int n from public.app_feed_ai_days')).rows[0].n,4);
   await pool.query('delete from public.app_workspaces where id=$1',[WS_C]);
   assert.equal((await pool.query('select count(*)::int n from public.app_feed_ai_days where workspace_id=$1',[WS_C])).rows[0].n,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_feed_ai_days')).rows[0].n,3);
  });

  await t.test('rollback: blocked while rows or topic values exist; then restores table, column and record; re-apply works',async()=>{
   const blocked=async pattern=>{const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),pattern);await c.query('rollback');}finally{c.release();}};
   await blocked(/FEED_AI_DAYS_ROLLBACK_BLOCKED: rows exist/);
   await pool.query('delete from public.app_feed_ai_days');
   await blocked(/FEED_AI_DAYS_ROLLBACK_BLOCKED: topic values exist/);
   assert.equal((await pool.query("select topic from public.app_now_details where id=$1",[detail[0]])).rows[0].topic,'labor');
   await pool.query('update public.app_now_details set topic=null');
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await allYes(postcheck);
   assert.equal(values(await readOnly(precheck))['new migration absent'],'예');
   assert.equal((await pool.query("select summary from public.app_now_details where id=$1",[detail[0]])).rows[0].summary,'합성 요약','detail rows untouched');
   const again=await run('apply','9994');assert.equal(again.ok,true,again.summary);
   await allYes(postcheck);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
