// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic (rule texts are made-up style rules).
// WEEKLY-규칙합의 DB(20261101130000_weekly_rules_confirmed): 운영자('calls') 작업공간의 가장 나중 규칙 칸 하나만 확정·후보·폐기 모양(v2)으로 바꾼다.
// - 승인형 workflow 실행기(dry-run·apply)로 돌고, 사전·사후 확인의 옛 줄 수·다른 행 해시가 같다.
// - 옛 줄은 지우지 않고 후보로(정책·연구·제외 뜻의 줄은 폐기로), 확정 14줄, 다른 작업공간·다른 주는 그대로. 권한·정책은 그대로(주인만 읽음).
// - 되돌리기는 후보·옛 폐기 줄을 옛 모양 lines 로 되돌리고 기록을 지운다.
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
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261101130000',name='weekly_rules_confirmed',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// 운영 표와 같은 모양의 허용 표(RLS 켜짐·정책 없음·API 역할 권한 없음). 실제 migration 은 앞 표가 많이 필요해 같은 모양만 만든다.
const operator=`
  create table public.app_operator_features(workspace_id uuid not null references public.app_workspaces(id) on delete cascade,feature text not null,
    created_at timestamptz not null default now(),constraint app_operator_features_pkey primary key(workspace_id,feature));
  alter table public.app_operator_features enable row level security;
  revoke all on table public.app_operator_features from public,anon,authenticated,service_role;
  insert into public.app_operator_features(workspace_id,feature) values('${WS_A}','calls'),('${WS_A}','telegram');
  insert into supabase_migrations.schema_migrations(version,name) values('20261029090000','operator_features');
`;
const draft=rules=>({v:1,base:null,me:'',me_from:'',date:'',rows:[],titles:[],...(rules?{rules}:{})});
const OLD_A=[{text:'가상 규칙: 날짜는 점으로 쓴다',from:'auto'},'가상 규칙: 끝난 일은 결과부터',{text:'정책·연구 사업은 진행이 없으면 제외',from:'edited'},{text:'가상 규칙: 장소는 줄인다',from:'added'}];

test('weekly rules confirmed: operator latest rules row only, old lines kept as candidates, rollback',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'weekly-rules-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(await read('supabase/migrations/20261023140000_weekly_exec_requests.sql'));
  await pool.query(await read('supabase/migrations/20261024001000_weekly_draft.sql'));
  await pool.query(operator);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const row=async(ws,week,d)=>(await pool.query(`insert into public.app_weekly_exec_requests(workspace_id,week_start,items,draft,draft_saved_at) values($1,$2,'[]'::jsonb,$3::jsonb,$4) returning id`,[ws,week,d?JSON.stringify(d):null,d?'2026-10-30T05:00:00Z':null])).rows[0].id;
  const rulesOf=async id=>(await pool.query('select draft->\'rules\' r,draft_saved_at::text s from public.app_weekly_exec_requests where id=$1',[id])).rows[0];
  const check=async sql=>Object.fromEntries((await pool.query(sql)).rows.map(r=>[r.item,r.value]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}

  const A_OLD=await row(WS_A,'2026-10-19',draft({at:'2026-10-23T05:00:00Z',lines:[{text:'가상 지난 규칙'}]}));
  const A_TARGET=await row(WS_A,'2026-10-26',draft({at:'2026-10-30T05:00:00Z',week:'2026-10-26',lines:OLD_A}));
  const A_NEXT=await row(WS_A,'2026-11-02',draft(null));
  const B_ROW=await row(WS_B,'2026-10-26',draft({at:'2026-10-30T05:00:00Z',lines:[{text:'다른 작업공간 규칙'}]}));
  const untouched=async()=>Object.fromEntries(await Promise.all([['A_OLD',A_OLD],['A_NEXT',A_NEXT],['B_ROW',B_ROW]].map(async([k,id])=>[k,await rulesOf(id)])));
  const keep=await untouched(),before=(await pool.query(snapshot)).rows;let pre;

  await t.test('files: read-only checks, three-line summary, expanded workflow accepts the file and backs up the weekly table',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const p=plan(mode,'1');assert.equal(p.flow,'full');assert.deepEqual(p.targets,['app_weekly_exec_requests']);}
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|disable row level|\bgrant\b|\bto (anon|public|authenticated|service_role)\b|create policy|alter table|information_schema|rtw_/i);
   for(const sql of [precheck,postcheck,snapshot,rollbackSQL])assert.doesNotMatch(sql,/information_schema/i);
   // 공개 저장소: 확인 SQL은 규칙 글·draft 를 결과로 내보내지 않는다(건수·예/아니오·해시만).
   for(const r of (await pool.query(precheck)).rows)assert.match(r.value,/^(예|아니오|[0-9]+|[0-9a-f]{32})$/,r.item);
  });

  await t.test('precheck: target row found, 4 old lines, 1 to retire',async()=>{
   pre=await check(precheck);
   for(const k of ['prerequisite recorded','new migration absent','operator workspace single','rules row found','no split rules yet','RLS enabled'])assert.equal(pre[k],'예',k);
   assert.equal(pre['anon or public table privilege'],'아니오');
   assert.equal(pre['old rule lines'],'4');assert.equal(pre['old lines to retire'],'1');
   assert.equal(pre['rows with rules'],'3');assert.equal(pre['weekly rows'],'4');
  });

  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await runMigrationPlan(plan('dry-run','9801'),query,{saveSnapshot:async()=>{}});assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await check(precheck),pre);
   assert.equal((await rulesOf(A_TARGET)).r.v,undefined);assert.equal(await history(),0);
  });

  await t.test('apply: only the operator latest rules row becomes v2, postcheck passes',async()=>{
   const result=await runMigrationPlan(plan('apply','9802'),query,{saveSnapshot:async()=>{}});assert.equal(result.ok,true,result.summary);
   assert.doesNotMatch(result.summary.split('사후 확인')[1]??'',/\| 아니오 \|/);
   assert.equal(await history(),1);
   const {r,s}=await rulesOf(A_TARGET);
   assert.equal(r.v,2);assert.equal(r.week,'2026-10-26');assert.match(r.at,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
   assert.equal(r.lines.length,14);assert.ok(r.lines.every(l=>l.from==='added'&&l.text.length<=120));
   assert.equal(r.lines[0].text,'날짜는 월.일. 꼴로 통일한다.');
   assert.deepEqual(r.candidates.map(c=>c.text),['가상 규칙: 날짜는 점으로 쓴다','가상 규칙: 끝난 일은 결과부터','가상 규칙: 장소는 줄인다']);
   assert.deepEqual(r.retired.map(c=>c.text),['정책·연구 사업은 진행이 없으면 제외한다.','정책·연구 사업은 진행이 없으면 제외']);
   assert.notEqual(s,'2026-10-30 05:00:00+00');
   assert.deepEqual(await untouched(),keep);
   const post=await check(postcheck);
   for(const k of ['migration recorded','rules row split','only one split row','RLS still enabled','no anon or public table privilege'])assert.equal(post[k],'예',k);
   assert.equal(post['confirmed rules'],'14');
   for(const k of ['old rule lines','old lines to retire','rows with rules','weekly rows','other rows rules hash','constraints hash','policies hash','owner RLS grants hash','column grants hash','triggers hash'])assert.equal(post[k],pre[k],k);
   await assert.rejects(pool.query(migration),/WEEKLY_RULES_CONFIRMED_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  await t.test('owner reads own rules, stranger and anon do not',async()=>{
   const mine=await as('authenticated',OWNER,c=>c.query("select draft->'rules'->>'v' v from public.app_weekly_exec_requests where id=$1",[A_TARGET]));assert.equal(mine.rows[0].v,'2');
   const theirs=await as('authenticated',STRANGER,c=>c.query('select count(*)::int n from public.app_weekly_exec_requests where workspace_id=$1',[WS_A]));assert.equal(theirs.rows[0].n,0);
   await assert.rejects(as('anon','',c=>c.query('select count(*) from public.app_weekly_exec_requests')),/permission denied/);
  });

  await t.test('rollback restores the old lines (candidates + old retired) and removes the record',async()=>{
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   const {r}=await rulesOf(A_TARGET);
   assert.equal(r.v,undefined);assert.equal(r.week,'2026-10-26');
   assert.deepEqual(r.lines.map(l=>l.text),['가상 규칙: 날짜는 점으로 쓴다','가상 규칙: 끝난 일은 결과부터','가상 규칙: 장소는 줄인다','정책·연구 사업은 진행이 없으면 제외']);
   assert.deepEqual(await untouched(),keep);
   const again=await check(precheck);
   for(const k of ['new migration absent','no split rules yet','rules row found'])assert.equal(again[k],'예',k);
   assert.equal(again['old rule lines'],'4');assert.equal(again['other rows rules hash'],pre['other rows rules hash']);
  });

  await t.test('no operator workspace: migration stops without a change',async()=>{
   await pool.query("delete from public.app_operator_features where feature='calls'");
   await assert.rejects(pool.query(migration),/WEEKLY_RULES_CONFIRMED_PREREQUISITE_CHANGED/);await pool.query('rollback');
   assert.equal(await history(),0);assert.equal((await rulesOf(A_TARGET)).r.v,undefined);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
