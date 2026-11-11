// Fresh local PostgreSQL 17 only. No Supabase, Google or production credentials. All data synthetic.
// S57-7 BIZ-보고할일정 1단계 DB(20261111020000_report_plan_event_link, 설계 docs/design/biz-report-plan-link.md):
//   새 표 app_calendar_report_plans(일정 하나에 줄 하나: 보고할 일정 켬 on·끔 off·빼기 skip) + 사업 보고 표 app_meetings의 연결 칸 둘(google_calendar_id·google_event_id).
// - 승인형 workflow의 plan·dry-run·apply가 통과(확장 규칙, 전체 흐름)하고, dry-run은 아무것도 남기지 않는다. 사업 보고 표 권한·정책·다른 칸은 그대로.
// - 로그인 사용자는 자기 작업공간 줄만 넣고·고치고·지운다. 다른 작업공간 줄은 안 보이고 못 건드린다. anon·service_role 권한 없음.
// - 칸 검사: 결정 값·정한 쪽·일정 id·캘린더 id·제목·날짜, 일정 id는 작업공간 안에서 하나. 사업 보고 연결 칸은 둘 다 비었거나 둘 다 채움.
// - 설계 문서 5절의 '기존 보고 연결 대상 수' 확인 SQL이 읽기 전용으로 돌고 개수만 낸다(같은 날·같은 이름, 작업공간 경계).
// - 휴지통에 간 보고는 연결도 같이 가려진다. 되돌리기는 쓰인 값이 있으면 멈추고, 비운 뒤에는 새 표·새 칸·기록만 지우며 다시 적용된다.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,PROJECT_A2,PROJECT_B,MEETING_A,MEETING_B} from './basket4-fixture.mjs';
import {prepareMigration,checkSQL,toDryRun} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261111020000',name='report_plan_event_link',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Production-like app_meetings (owner RLS + trash restrictive policy, table-level grants, anon revoked, updated_at touch trigger)
// — the shape after 20261022182319·20261023023500·20261025100000.
const schema=`
  alter table public.app_meetings
    add column series_name text, add column meeting_at timestamptz, add column location text,
    add column activity_kind text not null default 'meeting', add column deleted_at timestamptz,
    add column created_at timestamptz not null default now(), add column updated_at timestamptz not null default now();
  alter table public.app_meetings add constraint app_meetings_location_length_check check (location is null or char_length(location) <= 200);
  create index app_meetings_workspace_at_idx on public.app_meetings(workspace_id, meeting_at desc);
  alter table public.app_meetings enable row level security;
  create policy task12a_owner_all on public.app_meetings for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  create policy app_meetings_trash_hidden on public.app_meetings as restrictive for all to authenticated
    using (deleted_at is null) with check (deleted_at is null);
  revoke all on public.app_meetings from public, anon, authenticated, service_role;
  grant select, insert, update, delete on public.app_meetings to authenticated, service_role;
  create function private.app_touch_meeting() returns trigger language plpgsql as $$ begin new.updated_at = clock_timestamp(); return new; end $$;
  create trigger app_meetings_touch before update on public.app_meetings for each row execute function private.app_touch_meeting();
  update public.app_meetings set title='합성 운영위원회', meeting_at='2026-11-09T01:00:00Z' where id='${MEETING_A}';
  -- 사업영역 주요 일정(Google 연결 칸 포함) — 설계 문서 5절 확인 SQL이 읽는 칸만.
  create table public.app_project_milestones(id uuid primary key default gen_random_uuid(), project_id uuid not null references public.app_spaces(id),
    title text, start_at timestamptz, google_calendar_id text, google_event_id text);
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const EVENT_1='synthevent0001',EVENT_2='synthevent0002_20261116T010000Z',CAL='primary';

test('report plan + event link: plan, precheck, dry-run, apply, owner boundary, checks, guarded rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'report-plan-link-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(schema);
  await pool.query('revoke usage on schema private from service_role');
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,preserve]=await Promise.all(['precheck','postcheck','snapshot','rollback','preserve'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const summary=await read('docs/'+stem+'.summary.md');
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  // 줄 넣기: 화면이 보내는 값 칸만.
  const plan=(sub,ws,over={})=>{const row={workspace_id:ws,google_event_id:EVENT_1,google_calendar_id:CAL,state:'on',title:'합성 집행위',event_day:'2026-11-11',...over};const keys=Object.keys(row);
   return as('authenticated',sub,c=>c.query(`insert into public.app_calendar_report_plans(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) returning id`,keys.map(k=>row[k])));};
  const setPlan=(sub,col,val,event=EVENT_1)=>as('authenticated',sub,c=>c.query(`update public.app_calendar_report_plans set ${col}=$1 where google_event_id=$2`,[val,event]));
  const link=(sub,id,calendar,event)=>as('authenticated',sub,c=>c.query('update public.app_meetings set google_calendar_id=$2,google_event_id=$3 where id=$1',[id,calendar,event]));
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('approval plan: expanded rules, full flow, only app_meetings backed up; three-line summary; workflow rollback refused (SQL Editor only)',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const p=prepareMigration({mode,version,runId:'1',root});assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');assert.deepEqual(p.targets,['app_meetings']);}
   assert.match(toDryRun(migration),/rollback;\s*$/);
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
   const code=sql=>sql.replace(/--[^\n]*/g,''); // 주석 밖 SQL만
   for(const file of [migration,precheck,postcheck,snapshot,rollbackSQL,preserve])assert.doesNotMatch(code(file),/information_schema/);
   const bare=code(migration).replace(/'[^']*'/g,"''");
   assert.doesNotMatch(bare,/security definer|disable row level|create (or replace )?function|create trigger|alter policy|drop policy|rtw_|\bdelete\s+from\b|\bupdate\s+public\./i);
   // 권한을 주는 곳은 새 표의 authenticated뿐이고, 사업 보고 표에는 grant·정책이 없다.
   const grants=bare.match(/\bgrant\b[\s\S]*?;/gi)||[];assert.equal(grants.length,3);
   for(const g of grants){assert.match(g,/on table public\.app_calendar_report_plans to authenticated;$/);assert.doesNotMatch(g,/anon|public\s*;|service_role/i);}
   const policies=bare.match(/create policy[\s\S]*?;/gi)||[];assert.equal(policies.length,1);
   assert.match(policies[0],/on public\.app_calendar_report_plans for all to authenticated\s+using \(private\.app_is_workspace_owner\(workspace_id\)\)\s+with check \(private\.app_is_workspace_owner\(workspace_id\)\);$/);
   assert.match(code(migration),/insert into supabase_migrations\.schema_migrations[\s\S]*'20261111020000', 'report_plan_event_link'[\s\S]*\);\s*commit;\s*$/);
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);
   assert.match(lines[0],/^무엇이 바뀌나: /);assert.match(lines[1],/^잘못되면: /);assert.match(lines[2],/^되돌리는 법: /);
  });

  await t.test('precheck as the read-only role: expected values; owner sees the same',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,item==='anon or public privilege on meetings'?'아니오':'예',item);
   assert.deepEqual([v['new link column count'],v['new link check count'],v['new link index count'],v['meetings triggers count']],['0','0','0','1']);
   assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });

  await t.test('before apply neither the table nor the columns exist',async()=>{
   await assert.rejects(plan(OWNER,WS_A),{code:'42P01'});
   await assert.rejects(link(OWNER,MEETING_A,CAL,EVENT_1),{code:'42703'});
  });

  await t.test('a second permissive policy on reports stops the migration before any change',async()=>{
   await pool.query('create policy extra_read on public.app_meetings for select to authenticated using (private.app_is_workspace_owner(workspace_id))');
   assert.equal(values(await readOnly(precheck))['one permissive owner policy (task12a shape)'],'아니오');
   const c=await pool.connect();try{await assert.rejects(c.query(migration),/REPORT_PLAN_EVENT_LINK_PREREQUISITE_CHANGED/);await c.query('rollback');}finally{c.release();}
   await pool.query('drop policy extra_read on public.app_meetings');
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });

  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9941');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await readOnly(precheck),beforeCheck);assert.equal(await history(),0);
  });

  await t.test('apply passes postcheck; report table boundary unchanged; existing reports untouched; second apply refused',async()=>{
   const apply=await run('apply','9942');assert.equal(apply.ok,true,apply.summary);
   assert.equal(await history(),1);
   const post=values(await readOnly(postcheck)),pre=values(beforeCheck);
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else assert.equal(value,pre[item],item);
   }
   assert.deepEqual((await pool.query('select title,google_calendar_id,google_event_id from public.app_meetings order by id')).rows,
    [{title:'합성 운영위원회',google_calendar_id:null,google_event_id:null},{title:null,google_calendar_id:null,google_event_id:null}]);
   assert.equal((await run('apply','9943')).ok,false,'second apply stops');
   const c=await pool.connect();try{await assert.rejects(c.query(migration),/REPORT_PLAN_EVENT_LINK_PREREQUISITE_CHANGED/);await c.query('rollback');}finally{c.release();}
  });

  await t.test('report plans: owner keeps own rows only; stranger and other workspace blocked; anon and service_role nothing',async()=>{
   const made=await plan(OWNER,WS_A);assert.equal(made.rowCount,1);
   const row=(await as('authenticated',OWNER,c=>c.query('select * from public.app_calendar_report_plans'))).rows[0];
   assert.equal(row.state,'on');assert.equal(row.decided_by,'user');assert.ok(row.decided_at instanceof Date);assert.equal(row.starts_at,null);assert.match(row.id,/^[0-9a-f-]{36}$/);
   await assert.rejects(plan(OWNER,WS_B,{google_event_id:'synthother'}),{code:'42501'},'other workspace');
   await assert.rejects(plan(STRANGER,WS_A,{google_event_id:'synthother'}),{code:'42501'},'not the owner');
   await assert.rejects(plan(OWNER,WS_A),{code:'23505'},'one row per event in a workspace');
   assert.equal((await plan(STRANGER,WS_B)).rowCount,1,'same event id in another workspace is its own row');
   // 켬 → 끔 → 빼기, 사본(제목·날짜·시각·캘린더)과 결정한 때 고치기.
   for(const [col,val] of [['state','off'],['state','skip'],['state','on'],['decided_at','2026-11-11T02:00:00Z'],['title','합성 집행위 (장소 바뀜)'],['event_day','2026-11-12'],['starts_at','2026-11-12T01:00:00Z'],['starts_at',null],['google_calendar_id','synth@example.test']])
    assert.equal((await setPlan(OWNER,col,val)).rowCount,1,col+'='+val);
   // 저절로 켜진 줄(rule)은 on만.
   assert.equal((await plan(OWNER,WS_A,{google_event_id:EVENT_2,decided_by:'rule',starts_at:'2026-11-16T01:00:00Z',event_day:'2026-11-16'})).rowCount,1);
   await assert.rejects(setPlan(OWNER,'state','skip',EVENT_2),{code:'23514'},'rule row cannot be skip');
   assert.equal((await as('authenticated',OWNER,c=>c.query("update public.app_calendar_report_plans set state='skip',decided_by='user' where google_event_id=$1",[EVENT_2]))).rowCount,1);
   // 못 고치는 칸.
   await assert.rejects(setPlan(OWNER,'workspace_id',WS_B),{code:'42501'},'workspace column fixed');
   await assert.rejects(setPlan(OWNER,'google_event_id','synthmoved'),{code:'42501'},'event id fixed');
   await assert.rejects(setPlan(OWNER,'created_at','2026-01-01T00:00:00Z'),{code:'42501'},'created_at fixed');
   await assert.rejects(setPlan(OWNER,'id','26000000-0000-4000-8000-000000000001'),{code:'42501'},'id fixed');
   await assert.rejects(plan(OWNER,WS_A,{google_event_id:'synthcreated',created_at:'2026-01-01T00:00:00Z'}),{code:'42501'},'created_at not insertable');
   // 남의 줄: 안 보이고, 고치기·지우기는 0줄.
   assert.equal((await setPlan(STRANGER,'state','off',EVENT_2)).rowCount,0);
   assert.equal((await as('authenticated',STRANGER,c=>c.query('delete from public.app_calendar_report_plans where workspace_id=$1',[WS_A]))).rowCount,0);
   assert.deepEqual((await as('authenticated',STRANGER,c=>c.query('select workspace_id from public.app_calendar_report_plans'))).rows,[{workspace_id:WS_B}]);
   assert.equal((await as('authenticated',OWNER,c=>c.query('select 1 from public.app_calendar_report_plans'))).rowCount,2);
   // 자기 줄 지우기(사라진 일정 정리).
   assert.equal((await as('authenticated',OWNER,c=>c.query('delete from public.app_calendar_report_plans where google_event_id=$1',[EVENT_2]))).rowCount,1);
   for(const role of ['anon','service_role'])for(const sql of ['select * from public.app_calendar_report_plans',"update public.app_calendar_report_plans set state='off'",'delete from public.app_calendar_report_plans'])
    await assert.rejects(as(role,'',c=>c.query(sql)),{code:'42501'},role+': '+sql);
  });

  await t.test('report plans: value checks',async()=>{
   const bad=(over,label)=>assert.rejects(plan(OWNER,WS_A,{google_event_id:'synthcheck',...over}),{code:'23514'},label);
   await bad({state:'maybe'},'state');
   await bad({decided_by:'ai'},'decided_by');
   await bad({decided_by:'rule',state:'off'},'rule off');
   await bad({google_event_id:''},'empty event id');
   await bad({google_event_id:'synth event'},'space in event id');
   await bad({google_event_id:'합성일정'},'non-ascii event id');
   await bad({google_event_id:'a'.repeat(1025)},'event id too long');
   await bad({google_calendar_id:''},'empty calendar id');
   await bad({google_calendar_id:'synth cal'},'space in calendar id');
   await bad({google_calendar_id:'c'.repeat(256)},'calendar id too long');
   await bad({title:'   '},'blank title');
   await bad({title:'가'.repeat(301)},'title too long');
   await bad({title:'두 줄\n제목'},'title with a line break');
   await bad({event_day:'1999-12-31'},'day too early');
   await assert.rejects(plan(OWNER,WS_A,{google_event_id:'synthcheck',title:null}),{code:'23502'},'title required');
   assert.equal((await plan(OWNER,WS_A,{google_event_id:'a'.repeat(1024),title:'가'.repeat(300),google_calendar_id:'c'.repeat(255)})).rowCount,1,'longest allowed values');
   assert.equal((await as('authenticated',OWNER,c=>c.query('delete from public.app_calendar_report_plans where google_event_id=$1',['a'.repeat(1024)]))).rowCount,1);
  });

  await t.test('report link: owner links own report; both or neither; shape checks; trash hides the link; stranger and anon cannot',async()=>{
   assert.equal((await link(OWNER,MEETING_A,CAL,EVENT_1)).rowCount,1);
   assert.deepEqual((await as('authenticated',OWNER,c=>c.query('select id from public.app_meetings where google_event_id=$1',[EVENT_1]))).rows,[{id:MEETING_A}]);
   await assert.rejects(link(OWNER,MEETING_A,null,EVENT_1),{code:'23514'},'event without calendar');
   await assert.rejects(link(OWNER,MEETING_A,CAL,null),{code:'23514'},'calendar without event');
   await assert.rejects(link(OWNER,MEETING_A,CAL,''),{code:'23514'},'empty event id');
   await assert.rejects(link(OWNER,MEETING_A,CAL,'synth event'),{code:'23514'},'space in event id');
   await assert.rejects(link(OWNER,MEETING_A,'',EVENT_1),{code:'23514'},'empty calendar id');
   await assert.rejects(link(OWNER,MEETING_A,CAL,'e'.repeat(1025)),{code:'23514'},'event id too long');
   // 한 일정에 보고 둘(같은 날 같은 이름 물음에서 [새로 만들기]).
   assert.equal((await as('authenticated',OWNER,c=>c.query('insert into public.app_meetings(id,workspace_id,title,google_calendar_id,google_event_id) values (gen_random_uuid(),$1,$2,$3,$4)',[WS_A,'합성 두 번째 보고',CAL,EVENT_1]))).rowCount,1);
   assert.equal((await as('authenticated',OWNER,c=>c.query('select 1 from public.app_meetings where google_event_id=$1',[EVENT_1]))).rowCount,2);
   // 남의 보고·남의 작업공간.
   assert.equal((await link(STRANGER,MEETING_A,CAL,'synthstolen')).rowCount,0);
   assert.equal((await link(OWNER,MEETING_B,CAL,'synthstolen')).rowCount,0);
   assert.equal((await as('authenticated',STRANGER,c=>c.query('select 1 from public.app_meetings where google_event_id is not null'))).rowCount,0);
   await assert.rejects(as('anon','',c=>c.query('select google_event_id from public.app_meetings')),{code:'42501'});
   // 휴지통에 간 보고는 연결도 같이 가려진다(일정 달력의 ✓가 □로 돌아가는 근거).
   await pool.query("update public.app_meetings set deleted_at=now() where title='합성 두 번째 보고'");
   assert.deepEqual((await as('authenticated',OWNER,c=>c.query('select id from public.app_meetings where google_event_id=$1',[EVENT_1]))).rows,[{id:MEETING_A}]);
   // 연결 끊기(둘 다 비움)와 다시 잇기.
   assert.equal((await link(OWNER,MEETING_A,null,null)).rowCount,1);
   assert.equal((await link(OWNER,MEETING_A,CAL,EVENT_1)).rowCount,1);
   // 색인: 채운 줄만 담는 부분 색인.
   assert.match((await pool.query("select indexdef from pg_indexes where indexname='app_meetings_google_event_idx'")).rows[0].indexdef,/\(workspace_id, google_event_id\) WHERE \(google_event_id IS NOT NULL\)/);
  });

  await t.test('design doc count SQL: read-only, counts only, same day and same name inside one workspace',async()=>{
   const doc=await read('docs/design/biz-report-plan-link.md');
   const blocks=[...doc.matchAll(/```sql\n([\s\S]*?)```/g)].map(m=>m[1]);assert.equal(blocks.length,1,'one SQL block in the design doc');
   const countSQL=blocks[0];
   assert.equal(checkSQL(countSQL).baselineNull,false);
   assert.doesNotMatch(countSQL.replace(/'[^']*'/g,"''"),/\b(insert|update|delete|alter|create|drop|grant|revoke|truncate)\b/i);
   const report=(title,at,series=null)=>pool.query('insert into public.app_meetings(id,workspace_id,title,series_name,meeting_at) values (gen_random_uuid(),$1,$2,$3,$4)',[WS_A,title,series,at]);
   const stone=(project,title,at,event)=>pool.query('insert into public.app_project_milestones(project_id,title,start_at,google_calendar_id,google_event_id) values ($1,$2,$3,$4,$5)',[project,title,at,CAL,event]);
   // 보고 하나 ↔ 일정 하나(띄어쓰기만 다름, 사업영역 두 곳에 같은 일정). 서울 날짜로 같은 날.
   await report('합성 주간회의','2026-11-05T01:00:00Z');await stone(PROJECT_A,'합성 주간 회의','2026-11-05T02:00:00Z','synthms1');await stone(PROJECT_A2,'합성 주간 회의','2026-11-05T02:00:00Z','synthms1');
   // 다른 작업공간의 같은 날·같은 이름 일정은 맞추지 않는다.
   await stone(PROJECT_B,'합성 주간 회의','2026-11-05T02:00:00Z','synthms9');
   // 보고 하나 ↔ 일정 둘(UTC로는 전날이지만 서울로는 같은 날).
   await report('합성 대표자 회의','2026-11-06T16:00:00Z');await stone(PROJECT_A,'합성 대표자회의','2026-11-07T00:00:00Z','synthms2');await stone(PROJECT_A,'합성 대표자회의','2026-11-07T03:00:00Z','synthms3');
   // 보고 둘 ↔ 일정 하나(회의명 칸으로 맞춤).
   await report('합성 첫 기록','2026-11-08T01:00:00Z','합성 정기 교육');await report('합성 둘째 기록','2026-11-08T06:00:00Z','합성 정기 교육');await stone(PROJECT_A,'합성정기교육','2026-11-08T05:00:00Z','synthms4');
   // 맞는 일정이 없는 보고, 날짜가 다른 같은 이름.
   await report('합성 기타 활동','2026-11-09T01:00:00Z');await stone(PROJECT_A,'합성 기타 활동','2026-11-10T01:00:00Z','synthms5');
   const rows=await readOnly(countSQL);
   assert.deepEqual(Object.keys(rows[0]),['item','value']);
   assert.deepEqual(rows.map(r=>r.value),['5','4','3','1','1','1']);
   for(const r of rows)assert.match(r.value,/^\d+$/);
   await pool.query("delete from public.app_meetings where workspace_id=$1 and google_event_id is null and id<>$2",[WS_A,MEETING_A]);
   await pool.query('delete from public.app_project_milestones where project_id is not null');
  });

  await t.test('rollback: blocked while reports are linked or plan rows exist; preserve reads links and plan rows only; then all of it is gone and it re-applies',async()=>{
   const blocked=async pattern=>{const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),pattern);await c.query('rollback');}finally{c.release();}};
   await blocked(/REPORT_PLAN_EVENT_LINK_ROLLBACK_BLOCKED: reports linked to events/);
   const kept=await readOnly(preserve);
   assert.deepEqual(kept.map(r=>r.kind),['report link','report link','report plan','report plan']);
   assert.deepEqual(Object.keys(kept[0]),['kind','id','workspace_id','google_calendar_id','google_event_id','state','decided_by','decided_at','title','event_day','starts_at']);
   await pool.query("delete from public.app_meetings where title='합성 두 번째 보고'");
   await pool.query('update public.app_meetings set google_calendar_id=null,google_event_id=null where google_event_id is not null');
   await blocked(/REPORT_PLAN_EVENT_LINK_ROLLBACK_BLOCKED: report plan rows exist/);
   await pool.query('delete from public.app_calendar_report_plans where workspace_id is not null');
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.equal((await pool.query("select to_regclass('public.app_calendar_report_plans') is null as gone")).rows[0].gone,true);
   const after=values(await readOnly(postcheck));
   for(const [item,value] of Object.entries(after))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(await readOnly(precheck),beforeCheck);
   const again=await run('apply','9946');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
