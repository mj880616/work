// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S54-29 ORG-기록하나로 O-3(20261109120000_record_one_org_move): 옛 현황 표 줄·원래 기록 없는 주별 줄 → 조직 기록 복사
// — O-2(20261109100000_record_one_org) 다음, through the approved DB workflow runner. Rollback is the SQL Editor file.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,ORG_A,ORG_B} from './basket4-fixture.mjs';
import {prerequisites,UPD_A} from './record-one-fixture.mjs';
import {prepareMigration,toDryRun} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261109120000',name='record_one_org_move',stem=version+'_'+name,orgVersion='20261109100000';
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const id=n=>'3a000000-0000-4000-8000-'+String(n).padStart(12,'0');
const ORG_A2='23000000-0000-4000-8000-000000000003';

test('record one org move: plan, precheck counts, dry-run, apply, originals untouched, idempotent, workspace boundary, rollback, re-apply',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'record-one-org-move-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query(`insert into public.app_suborganizations values ('${ORG_A2}', '${WS_A}')`);
  // 옛 표는 저장소의 실제 migration 그대로 만든다(현황 표 → 끝 날 → 주별 줄), 이어서 O-2.
  for(const f of ['20261030234000_org_status_rows','20261104201500_org_status_rows_end_day','20261104211500_weekly_org_lines'])
   await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL]=await Promise.all(['precheck','postcheck','snapshot','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,rid,v=version)=>runMigrationPlan(prepareMigration({mode,version:v,runId:rid,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value??r.ok]));
  const moved=async()=>(await pool.query("select organization_id,raw_text,(occurred_at at time zone 'Asia/Seoul')::date::text as day,end_day::text as end_day,source_kind,source_id,created_by,created_at from public.app_suborganization_updates where source_kind in ('status_row','weekly_line') order by source_kind,raw_text")).rows;
  const others=async()=>(await pool.query("select id,raw_text,occurred_at from public.app_suborganization_updates where source_kind is null or source_kind not in ('status_row','weekly_line') order by id")).rows;
  const originals=async()=>({status:(await pool.query('select * from public.app_org_status_rows order by id')).rows,weekly:(await pool.query('select * from public.app_weekly_org_lines order by id')).rows});

  await t.test('without O-2 the precheck says no and apply stops without writing',async()=>{
   // O-2 칸이 없으면 사전 확인 SQL 자체가 실패한다 → workflow는 쓰기 전에 멈춘다.
   await assert.rejects(readOnly(precheck),{code:'42703'});
   assert.equal((await run('apply','9940')).ok,false);
   assert.equal(await pool.query('select 1 from supabase_migrations.schema_migrations where version=$1',[version]).then(r=>r.rowCount),0);
   const org=await run('apply','9941',orgVersion);assert.equal(org.ok,true,org.summary);
  });

  // 합성 옛 자료. 현황 표: 옮김 2(S1·S4), 같은 줄 둘(S3), 이미 같은 기록(S2), 작업공간 어긋남(S5).
  const ins=(sql,args)=>pool.query(sql,args);
  const S=(n,ws,org,day,body,end=null,at='2026-11-01T09:00:00+09:00')=>ins('insert into public.app_org_status_rows(id,workspace_id,organization_id,day,end_day,body,created_at) values ($1,$2,$3,$4,$5,$6,$7)',[id(n),ws,org,day,end,body,at]);
  await S(1,WS_A,ORG_A,'2026-11-02','찬반투표 공고','2026-11-05','2026-11-01T09:00:00+09:00');
  await S(2,WS_A,ORG_A,'2026-11-03','합성 조직 기록');
  await S(3,WS_A,ORG_A,'2026-11-02','찬반투표 공고',null,'2026-11-01T10:00:00+09:00');
  await S(4,WS_B,ORG_B,'2026-11-04','남의 현황');
  await pool.query('alter table public.app_org_status_rows disable trigger app_org_status_rows_guard');
  await S(5,WS_B,ORG_A,'2026-11-06','어긋난 작업공간 줄');
  await pool.query('alter table public.app_org_status_rows enable trigger app_org_status_rows_guard');
  // 주별 줄: 옮김 2(W1 손으로 쓴 줄, W3 원래 기록이 지워진 줄).
  const gone=(await pool.query("insert into public.app_suborganization_updates(organization_id,raw_text,occurred_at) values ($1,'곧 지울 기록','2026-11-04T12:00:00+09:00') returning id",[ORG_A])).rows[0].id;
  const W=(n,o)=>ins(`insert into public.app_weekly_org_lines(id,workspace_id,week_start,organization_id,day,end_day,body,state,origin,edited,source_update_ids,source_status_ids,created_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[id(100+n),o.ws??WS_A,o.week??'2026-11-02',o.org??ORG_A,o.day??null,o.end??null,o.body,o.state??'in',o.origin??'user',o.edited??false,o.upd??[],o.st??[],o.at??'2026-11-02T08:00:00+09:00']);
  await W(1,{body:'손으로 쓴 줄'});
  await W(2,{body:'AI 요약 줄',origin:'ai',upd:[UPD_A]});
  await W(3,{body:'원래 기록이 지워진 줄',day:'2026-11-04',end:'2026-11-06',origin:'plain',upd:[gone]});
  await pool.query('delete from public.app_suborganization_updates where id=$1',[gone]);
  await W(4,{body:'뺀 줄',state:'dropped'});
  await W(5,{body:'손으로 쓴 줄',week:'2026-11-09',origin:'last_week'});
  await W(6,{body:'찬반투표 공고',day:'2026-11-02'});
  await W(7,{body:'현황 표에서 고친 줄',origin:'plain',st:[id(1)],edited:true});
  await W(8,{body:'두 번 넣은 줄',day:'2026-11-05',org:ORG_A2,at:'2026-11-02T08:00:00+09:00'});
  await W(9,{body:'두 번 넣은 줄',day:'2026-11-05',org:ORG_A2,at:'2026-11-02T09:00:00+09:00'});
  await W(10,{body:'옛 기록',week:'2026-09-28',day:'2026-10-01'});
  await W(11,{body:'제안만 된 줄',state:'suggested',origin:'ai'});
  // W8은 옮김, W9는 같은 줄 둘이라 건너뜀 → 주별 줄 옮김은 W1·W3·W8 = 3.
  const before=(await pool.query(snapshot)).rows;
  const beforeOthers=await others(),beforeOriginals=await originals();
  let pre;

  await t.test('approval plan: expanded rules, full flow, nothing to back up, no definer; rollback mode refuses data delete',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');assert.deepEqual(plan.targets,[]);
   assert.deepEqual(plan.review.definer,[]);assert.equal(plan.review.grants,0);assert.equal(plan.review.policies,0);
   assert.equal(prepareMigration({mode:'dry-run',version,runId:'1',root}).flow,'full');
   assert.match(toDryRun(migration),/rollback;\s*$/);
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
  });
  await t.test('precheck: all yes, target and skip counts add up',async()=>{
   pre=values(await readOnly(precheck));
   for(const [item,value] of Object.entries(pre))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.equal(pre['already moved'],'0');
   assert.equal(pre['status rows total'],'5');assert.equal(pre['status rows skip same original twice'],'1');
   assert.equal(pre['status rows skip other workspace'],'1');assert.equal(pre['status rows skip record already there'],'1');
   assert.equal(pre['status rows to move'],'2');
   assert.equal(pre['weekly lines total'],'11');assert.equal(pre['weekly lines in'],'9');
   assert.equal(pre['weekly lines skip original record kept'],'2');assert.equal(pre['weekly lines skip carried from last week'],'1');
   assert.equal(pre['weekly lines skip same line twice'],'1');assert.equal(pre['weekly lines skip other workspace'],'0');
   assert.equal(pre['weekly lines skip same as status row'],'1');assert.equal(pre['weekly lines skip record already there'],'1');
   assert.equal(pre['weekly lines to move'],'3');
   assert.equal(pre['org records text length limits'],'0');
  });
  await t.test('dry-run writes nothing',async()=>{
   const dry=await run('dry-run','9942');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual(await moved(),[]);assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply: moved = target − skipped, postcheck passes, second apply refused',async()=>{
   const apply=await run('apply','9943');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck));
   for(const [item,value] of Object.entries(post))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.equal(post['status rows to move'],pre['status rows to move']);assert.equal(post['weekly lines to move'],pre['weekly lines to move']);
   for(const k of ['status rows hash','weekly lines hash','status rows total','weekly lines total','org records rows not moved'])assert.equal(post[k],pre[k],k);
   assert.equal((await run('apply','9944')).ok,false);
  });
  await t.test('moved rows: dates, period, text, original time, owner, own organization only',async()=>{
   const rows=await moved();
   assert.deepEqual(rows.map(r=>[r.source_kind,r.organization_id,r.raw_text,r.day,r.end_day]),[
    ['status_row',ORG_B,'남의 현황','2026-11-04',null],
    ['status_row',ORG_A,'찬반투표 공고','2026-11-02','2026-11-05'],
    ['weekly_line',ORG_A2,'두 번 넣은 줄','2026-11-05',null],
    ['weekly_line',ORG_A,'손으로 쓴 줄','2026-11-02',null],
    ['weekly_line',ORG_A,'원래 기록이 지워진 줄','2026-11-04','2026-11-06']]);
   const by=Object.fromEntries(rows.map(r=>[r.source_id,r]));
   assert.equal(by[id(1)].created_at.toISOString(),'2026-11-01T00:00:00.000Z');
   assert.equal(by[id(108)]?.raw_text,'두 번 넣은 줄');assert.equal(by[id(109)],undefined);
   assert.equal(by[id(4)].created_by,STRANGER);
   for(const r of rows.filter(r=>r.organization_id!==ORG_B))assert.equal(r.created_by,OWNER);
   // 원래 자료·직접 쓴 기록은 그대로.
   assert.deepEqual(await originals(),beforeOriginals);assert.deepEqual(await others(),beforeOthers);
   // 남의 작업공간 섞이지 않음: 주인 정책으로 읽으면 각자 자기 조직 줄만.
   const mine=(await as('authenticated',OWNER,c=>c.query("select organization_id from public.app_suborganization_updates where source_kind in ('status_row','weekly_line')"))).rows;
   assert.equal(mine.length,4);assert.ok(mine.every(r=>r.organization_id!==ORG_B));
   const theirs=(await as('authenticated',STRANGER,c=>c.query("select organization_id from public.app_suborganization_updates where source_kind in ('status_row','weekly_line')"))).rows;
   assert.deepEqual(theirs.map(r=>r.organization_id),[ORG_B]);
   // 옮긴 종류는 로그인 사용자가 새로 넣거나 출처를 바꾸지 못한다(O-2 검사).
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_suborganization_updates(organization_id,raw_text,source_kind,source_id) values ($1,'가짜','status_row',$2)",[ORG_A,id(2)])),{code:'23514'});
  });
  await t.test('running the same SQL again adds 0 rows',async()=>{
   const n=(await moved()).length;
   await pool.query('delete from supabase_migrations.schema_migrations where version=$1',[version]);
   await pool.query(migration);
   assert.equal((await moved()).length,n);
   assert.equal(values(await readOnly(postcheck))['nothing left to move'],'예');
  });
  await t.test('rollback removes only moved rows; originals and other records stay; re-apply gives the same result',async()=>{
   const after=await moved();
   await pool.query(rollbackSQL);
   assert.deepEqual(await moved(),[]);
   assert.deepEqual(await originals(),beforeOriginals);assert.deepEqual(await others(),beforeOthers);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(values(await readOnly(precheck)),pre);
   await assert.rejects(pool.query(rollbackSQL),/NOT_APPLIED/);
   const again=await run('apply','9945');assert.equal(again.ok,true,again.summary);
   assert.deepEqual((await moved()).map(r=>[r.source_kind,r.source_id,r.raw_text]),after.map(r=>[r.source_kind,r.source_id,r.raw_text]));
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
