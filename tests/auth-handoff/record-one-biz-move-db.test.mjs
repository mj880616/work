// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S54-29 BIZ-기록하나로 B-2(20261109130000_record_one_biz_move): 옛 사업 진행 기록(app_project_progress_updates) → 사업 기록 복사
// — O-2·B-1 다음, through the approved DB workflow runner. Rollback is the SQL Editor file.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,PROJECT_A2,PROJECT_B} from './basket4-fixture.mjs';
import {prerequisites} from './record-one-fixture.mjs';
import {prepareMigration,toDryRun} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261109130000',name='record_one_biz_move',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const id=n=>'3b000000-0000-4000-8000-'+String(n).padStart(12,'0');
const NO_SPACE='22000000-0000-4000-8000-0000000000ff';

test('record one biz move: plan, precheck counts, dry-run, apply, originals untouched, idempotent, workspace boundary, rollback, re-apply',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'record-one-biz-move-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query(`grant select on public.app_spaces to authenticated; alter table public.app_spaces enable row level security;
    create policy synthetic_owner on public.app_spaces for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));`);
  // 운영 모양을 흉내 낸 옛 진행 기록 표(만든 SQL은 저장소에 없음). 사업이 없는 줄을 시험하려고 외래 키는 두지 않는다.
  await pool.query(`create table public.app_project_progress_updates(id uuid primary key default gen_random_uuid(), project_id uuid not null, workstream_id uuid,
      author_id uuid, status_label text, summary text, next_step text, effective_on date, metadata jsonb not null default '{}', doc jsonb, created_at timestamptz default now());
    alter table public.app_project_progress_updates enable row level security;
    revoke all on public.app_project_progress_updates from public, anon, authenticated, service_role;
    grant select, insert, update, delete on public.app_project_progress_updates to authenticated;
    create policy synthetic_space_owner on public.app_project_progress_updates for all to authenticated
      using (exists (select 1 from public.app_spaces s where s.id = project_id and private.app_is_workspace_owner(s.workspace_id)))
      with check (exists (select 1 from public.app_spaces s where s.id = project_id and private.app_is_workspace_owner(s.workspace_id)));`);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL]=await Promise.all(['precheck','postcheck','snapshot','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,rid,v=version)=>runMigrationPlan(prepareMigration({mode,version:v,runId:rid,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value??r.ok]));
  const moved=async()=>(await pool.query("select workspace_id,space_id,day::text as day,body,source_id,created_by,created_at from public.app_business_records where source_kind='progress' order by space_id,day,body")).rows;
  const others=async()=>(await pool.query("select id,space_id,day::text as day,body from public.app_business_records where source_kind<>'progress' order by id")).rows;
  const originals=async()=>(await pool.query('select * from public.app_project_progress_updates order by id')).rows;

  await t.test('without B-1 the precheck fails and apply stops without writing',async()=>{
   await assert.rejects(readOnly(precheck),{code:'42P01'});
   assert.equal((await run('apply','9950')).ok,false);
   for(const [v,rid] of [['20261109100000','9951'],['20261109110000','9952']]){const r=await run('apply',rid,v);assert.equal(r.ok,true,r.summary);}
  });

  const P=(n,o)=>pool.query('insert into public.app_project_progress_updates(id,project_id,summary,next_step,status_label,effective_on,created_at) values ($1,$2,$3,$4,$5,$6,$7)',
   [id(n),o.space??PROJECT_A,o.text,o.next??null,o.label??null,o.on===undefined?'2026-10-20':o.on,o.at===undefined?'2026-10-20T09:00:00+09:00':o.at]);
  await P(1,{text:'진행 한 줄',next:'다음 할 일',label:'진행'});
  await P(2,{text:'진행 한 줄',at:'2026-10-20T10:00:00+09:00'});
  await P(3,{text:'날짜 없는 기록',on:null,at:'2026-10-21T23:30:00+09:00'});
  await P(4,{text:'  \n '});
  await P(5,{text:'가'.repeat(301)});
  await P(6,{text:'첫 줄\r\n둘째 줄\t끝'});
  await P(7,{text:'사업 없는 줄',space:NO_SPACE});
  await P(8,{text:'남의 사업 진행',space:PROJECT_B});
  await pool.query("insert into public.app_business_records(workspace_id,space_id,day,body,source_kind) values ($1,$2,'2026-10-22','이미 있는 줄','user')",[WS_A,PROJECT_A]);
  await P(9,{text:'이미 있는 줄',on:'2026-10-22'});
  for(let i=0;i<48;i++)await pool.query("insert into public.app_business_records(workspace_id,space_id,day,body,source_kind) values ($1,$2,'2026-10-23',$3,'user')",[WS_A,PROJECT_A2,'채운 줄 '+i]);
  await P(10,{text:'마흔아홉째',space:PROJECT_A2,on:'2026-10-23',at:'2026-10-23T09:00:00+09:00'});
  await P(11,{text:'쉰째',space:PROJECT_A2,on:'2026-10-23',at:'2026-10-23T10:00:00+09:00'});
  await P(12,{text:'쉰한째',space:PROJECT_A2,on:'2026-10-23',at:'2026-10-23T11:00:00+09:00'});
  await P(13,{text:'날짜가 하나도 없는 줄',on:null,at:null});
  const before=(await pool.query(snapshot)).rows;
  const beforeOthers=await others(),beforeOriginals=await originals();
  let pre;

  await t.test('approval plan: full flow, nothing to back up, no definer; rollback mode refuses data delete',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.flow,'full');assert.deepEqual(plan.targets,[]);assert.deepEqual(plan.functions,[]);
   assert.equal(prepareMigration({mode:'dry-run',version,runId:'1',root}).flow,'full');
   assert.match(toDryRun(migration),/rollback;\s*$/);
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
  });
  await t.test('precheck: all yes, target and skip counts add up',async()=>{
   pre=values(await readOnly(precheck));
   for(const [item,value] of Object.entries(pre))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   const want={'already moved':'0','progress rows total':'13','progress rows skip no business':'1','progress rows skip no date':'1','progress rows skip empty text':'1',
    'progress rows skip over 300 chars':'1','progress rows skip same line twice':'1','progress rows skip record already there':'1','progress rows skip over 50 a day':'1',
    'progress rows to move':'6','business records rows not moved':'49'};
   for(const [k,v] of Object.entries(want))assert.equal(pre[k],v,k);
  });
  await t.test('dry-run writes nothing',async()=>{
   const dry=await run('dry-run','9953');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual(await moved(),[]);assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply: moved = target − skipped, postcheck passes, second apply refused',async()=>{
   const apply=await run('apply','9954');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck));
   for(const [item,value] of Object.entries(post))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   for(const k of ['progress rows to move','progress rows hash','progress rows total','business records rows not moved'])assert.equal(post[k],pre[k],k);
   assert.equal((await run('apply','9955')).ok,false);
  });
  await t.test('moved rows: day, cleaned text, original time, owner, own workspace only',async()=>{
   const rows=await moved();
   assert.deepEqual(rows.map(r=>[r.space_id,r.day,r.body,r.source_id]),[
    [PROJECT_A,'2026-10-20','진행 한 줄',id(1)],
    [PROJECT_A,'2026-10-20','첫 줄 둘째 줄 끝',id(6)],
    [PROJECT_A,'2026-10-21','날짜 없는 기록',id(3)],
    [PROJECT_A2,'2026-10-23','마흔아홉째',id(10)],
    [PROJECT_A2,'2026-10-23','쉰째',id(11)],
    [PROJECT_B,'2026-10-20','남의 사업 진행',id(8)]]);
   for(const r of rows)assert.equal(r.workspace_id,r.space_id===PROJECT_B?WS_B:WS_A);
   for(const r of rows)assert.equal(r.created_by,r.space_id===PROJECT_B?STRANGER:OWNER);
   assert.equal(rows[0].created_at.toISOString(),'2026-10-20T00:00:00.000Z');
   assert.deepEqual(await originals(),beforeOriginals);assert.deepEqual(await others(),beforeOthers);
   const mine=(await as('authenticated',OWNER,c=>c.query("select space_id from public.app_business_records where source_kind='progress'"))).rows;
   assert.equal(mine.length,5);assert.ok(mine.every(r=>r.space_id!==PROJECT_B));
   const theirs=(await as('authenticated',STRANGER,c=>c.query("select space_id from public.app_business_records where source_kind='progress'"))).rows;
   assert.deepEqual(theirs.map(r=>r.space_id),[PROJECT_B]);
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_business_records(workspace_id,space_id,day,body,source_kind,source_id) values ($1,$2,'2026-11-01','가짜','progress',$3)",[WS_A,PROJECT_A,id(2)])),{code:'23514'});
  });
  await t.test('running the same SQL again adds 0 rows',async()=>{
   const n=(await moved()).length;
   await pool.query('delete from supabase_migrations.schema_migrations where version=$1',[version]);
   await pool.query(migration);
   assert.equal((await moved()).length,n);
   assert.equal(values(await readOnly(postcheck))['nothing left to move'],'예');
  });
  await t.test('rollback removes only moved rows; originals and other records stay; B-1 rollback then allowed; re-apply gives the same result',async()=>{
   const after=await moved();
   await assert.rejects(pool.query(await read('docs/20261109110000_record_one_biz.rollback.sql')),/moved rows remain/);
   await pool.query(rollbackSQL);
   assert.deepEqual(await moved(),[]);
   assert.deepEqual(await originals(),beforeOriginals);assert.deepEqual(await others(),beforeOthers);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(values(await readOnly(precheck)),pre);
   await assert.rejects(pool.query(rollbackSQL),/NOT_APPLIED/);
   const again=await run('apply','9956');assert.equal(again.ok,true,again.summary);
   assert.deepEqual((await moved()).map(r=>[r.source_id,r.body]),after.map(r=>[r.source_id,r.body]));
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
