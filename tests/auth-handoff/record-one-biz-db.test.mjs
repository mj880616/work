// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S54-27 BIZ-기록하나로 B-1 DB(20261109110000_record_one_biz): 사업 기록(app_business_records)·사업 지금 상황(app_business_now)
// — O-2(20261109100000_record_one_org) 다음, through the approved DB workflow runner.
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
import {prerequisites,FEED_A,FEED_B,MEM_A,NOTE_A,NOTE_B,OLD} from './record-one-fixture.mjs';
import {prepareMigration,toDryRun} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261109110000',name='record_one_biz',stem=version+'_'+name,orgVersion='20261109100000';
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

test('record one biz db: needs O-2, plan, dry-run, apply, owner boundary, guards, biz_record marks, rollback and re-apply',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'record-one-biz-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  // 사업 표는 화면이 owner 정책으로 읽는다(합성).
  await pool.query(`grant select on public.app_spaces to authenticated; alter table public.app_spaces enable row level security;
    create policy synthetic_owner on public.app_spaces for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));`);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL]=await Promise.all(['precheck','postcheck','snapshot','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id,v=version)=>runMigrationPlan(prepareMigration({mode,version:v,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const refused=e=>['42501','23514'].includes(e.code);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value??r.ok]));
  const addRecord=(sub,ws,space,r={})=>as('authenticated',sub,async c=>(await c.query(
   'insert into public.app_business_records(workspace_id,space_id,day,end_day,body,source_kind,source_id) values ($1,$2,$3,$4,$5,$6,$7) returning id,created_by',
   [ws,space,r.day??'2026-11-10',r.end??null,r.body??'합성 사업 기록',r.kind??'user',r.src??null])).rows[0]);
  const addNow=(sub,ws,space,n={})=>as('authenticated',sub,async c=>(await c.query(
   'insert into public.app_business_now(workspace_id,space_id,week_start,body,owner_text) values ($1,$2,$3,$4,$5) returning id',
   [ws,space,n.week??'2026-11-09',n.body??'지금 상황',n.owner??'담당'])).rows[0].id);

  await t.test('without O-2 the precheck says no and apply stops without writing',async()=>{
   const pre=values(await readOnly(precheck));
   assert.equal(pre['previous migration record_one_org present'],'아니오');
   const stopped=await run('apply','9930');assert.equal(stopped.ok,false);
   assert.equal(await pool.query("select 1 from supabase_migrations.schema_migrations where version=$1",[version]).then(r=>r.rowCount),0);
   assert.equal((await pool.query("select to_regclass('public.app_business_records') is null as absent")).rows[0].absent,true);
   const org=await run('apply','9931',orgVersion);assert.equal(org.ok,true,org.summary);
  });
  const before=(await pool.query(snapshot)).rows;
  const beforeCheck=values(await readOnly(precheck));

  await t.test('approval plan: expanded rules, full flow, no definer function',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.review.definer,[]);
   assert.equal(prepareMigration({mode:'dry-run',version,runId:'1',root}).flow,'full');
   assert.match(toDryRun(migration),/rollback;\s*$/);
  });
  await t.test('precheck: all yes before apply',()=>{
   for(const [item,value] of Object.entries(beforeCheck))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
  });
  await t.test('report marks refuse biz_record before B-1',async()=>{
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_report_line_marks(workspace_id,week_start,section,ref_kind,ref_key) values ($1,'2026-11-09','biz_detail','biz_record',$2)",[WS_A,OLD])),
    e=>e.code==='23514'&&/not ready/.test(e.message));
  });
  await t.test('dry-run leaves schema and history unchanged',async()=>{
   const dry=await run('dry-run','9932');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; second apply refused',async()=>{
   const apply=await run('apply','9933');assert.equal(apply.ok,true,apply.summary);
   for(const [item,value] of Object.entries(values(await readOnly(postcheck))))assert.equal(value,'예',item);
   assert.equal((await run('apply','9934')).ok,false);
  });
  let rec;
  await t.test('business records: owner only, same workspace business and source, body and date rules, fixed columns',async()=>{
   rec=await addRecord(OWNER,WS_A,PROJECT_A);assert.ok(rec.id);assert.equal(rec.created_by,OWNER);
   assert.ok(await addRecord(OWNER,WS_A,PROJECT_A2,{day:'2026-11-02',end:'2026-12-05'}));
   await assert.rejects(addRecord(OWNER,WS_A,PROJECT_A,{day:'2026-11-10',end:'2026-11-09'}),{code:'23514'});
   for(const bad of ['',' 앞 빈칸','가'.repeat(301),'줄\n바꿈'])await assert.rejects(addRecord(OWNER,WS_A,PROJECT_A,{body:bad}),{code:'23514'},JSON.stringify(bad));
   await assert.rejects(addRecord(OWNER,WS_A,PROJECT_A,{kind:'robot',src:FEED_A}),{code:'23514'});
   await assert.rejects(addRecord(OWNER,WS_A,PROJECT_A,{kind:'feed'}),{code:'23514'});
   await assert.rejects(addRecord(OWNER,WS_A,PROJECT_A,{kind:'user',src:FEED_A}),{code:'23514'});
   assert.ok(await addRecord(OWNER,WS_A,PROJECT_A,{kind:'feed',src:FEED_A}));
   assert.ok(await addRecord(OWNER,WS_A,PROJECT_A,{kind:'memorable',src:MEM_A}));
   assert.ok(await addRecord(OWNER,WS_A,PROJECT_A,{kind:'update',src:NOTE_A}));
   await assert.rejects(addRecord(OWNER,WS_A,PROJECT_A2,{kind:'feed',src:FEED_A}),{code:'23505'});
   await assert.rejects(addRecord(OWNER,WS_A,PROJECT_A,{kind:'feed',src:FEED_B}),{code:'23514'});
   await assert.rejects(addRecord(OWNER,WS_A,PROJECT_A,{kind:'update',src:NOTE_B}),{code:'23514'});
   // 옛 진행 기록 옮기기 종류는 로그인 사용자가 못 넣고 옮기기 SQL(postgres)만.
   await assert.rejects(addRecord(OWNER,WS_A,PROJECT_A,{kind:'progress',src:OLD}),{code:'23514'});
   await pool.query("insert into public.app_business_records(workspace_id,space_id,day,body,source_kind,source_id) values ($1,$2,'2026-10-20','옮긴 진행 기록','progress',$3)",[WS_A,PROJECT_A,OLD]);
   // 남의 사업·남의 작업공간·anon.
   await assert.rejects(addRecord(OWNER,WS_A,PROJECT_B),{code:'23514'});
   await assert.rejects(addRecord(STRANGER,WS_A,PROJECT_A),refused);
   await assert.rejects(addRecord(STRANGER,WS_B,PROJECT_A),{code:'23514'});
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_business_records'))).rows[0].n,0);
   assert.equal((await stranger(c=>c.query("update public.app_business_records set body='가로채기' where id=$1",[rec.id]))).rowCount,0);
   assert.equal((await stranger(c=>c.query('delete from public.app_business_records where id=$1',[rec.id]))).rowCount,0);
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_business_records')),{code:'42501'});
   // 고치기: 날짜·끝 날·글만. updated_at은 서버 시각.
   await pool.query('alter table public.app_business_records disable trigger app_business_records_guard');
   await pool.query("update public.app_business_records set updated_at='2000-01-01' where id=$1",[rec.id]);
   await pool.query('alter table public.app_business_records enable trigger app_business_records_guard');
   assert.equal((await owner(c=>c.query("update public.app_business_records set body='고친 사업 기록',day='2026-11-11',end_day='2026-11-12' where id=$1",[rec.id]))).rowCount,1);
   assert.ok((await pool.query('select updated_at from public.app_business_records where id=$1',[rec.id])).rows[0].updated_at.getFullYear()>2000);
   for(const col of ['workspace_id','space_id','source_kind','source_id','created_by','created_at'])
    await assert.rejects(owner(c=>c.query(`update public.app_business_records set ${col}=${col} where id=$1`,[rec.id])),{code:'42501'},col);
   await assert.rejects(owner(c=>c.query("insert into public.app_business_records(workspace_id,space_id,day,body,source_kind,created_by) values ($1,$2,'2026-11-10','남 이름','user',$3)",[WS_A,PROJECT_A,STRANGER])),{code:'42501'});
  });
  await t.test('business records: at most 50 rows per business per day; per business',async()=>{
   const have=(await pool.query("select count(*)::int n from public.app_business_records where space_id=$1 and day='2026-11-20'",[PROJECT_A])).rows[0].n;
   for(let i=have;i<50;i++)await addRecord(OWNER,WS_A,PROJECT_A,{day:'2026-11-20',body:'줄 '+i});
   await assert.rejects(addRecord(OWNER,WS_A,PROJECT_A,{day:'2026-11-20',body:'쉰한째'}),{code:'23514'});
   assert.ok(await addRecord(OWNER,WS_A,PROJECT_A2,{day:'2026-11-20'}));
   assert.ok(await addRecord(OWNER,WS_A,PROJECT_A,{day:'2026-11-21'}));
   assert.equal((await owner(c=>c.query("delete from public.app_business_records where day='2026-11-20' and body like '줄 %'"))).rowCount,50);
  });
  await t.test('business now: one row per business per week, owner only, text rules, fixed columns',async()=>{
   const id=await addNow(OWNER,WS_A,PROJECT_A);assert.ok(id);
   assert.ok(await addNow(OWNER,WS_A,PROJECT_A,{week:'2026-11-16',body:'',owner:''}));
   assert.ok(await addNow(OWNER,WS_A,PROJECT_A2,{body:'둘째 줄\n있는 지금 상황'}));
   await assert.rejects(addNow(OWNER,WS_A,PROJECT_A),{code:'23505'});
   await assert.rejects(addNow(OWNER,WS_A,PROJECT_A,{week:'2026-11-17'}),{code:'23514'});
   for(const bad of [' 앞',  '가'.repeat(1001),'탭\t'])await assert.rejects(addNow(OWNER,WS_A,PROJECT_A,{week:'2026-11-23',body:bad}),{code:'23514'},JSON.stringify(bad));
   for(const bad of [' 앞','가'.repeat(101),'줄\n바꿈'])await assert.rejects(addNow(OWNER,WS_A,PROJECT_A,{week:'2026-11-23',owner:bad}),{code:'23514'},JSON.stringify(bad));
   await assert.rejects(addNow(OWNER,WS_A,PROJECT_B,{week:'2026-11-23'}),{code:'23514'});
   await assert.rejects(addNow(STRANGER,WS_A,PROJECT_A,{week:'2026-11-23'}),refused);
   await assert.rejects(addNow(STRANGER,WS_B,PROJECT_A,{week:'2026-11-23'}),{code:'23514'});
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_business_now'))).rows[0].n,0);
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_business_now')),{code:'42501'});
   assert.equal((await owner(c=>c.query("update public.app_business_now set body='고친 상황',owner_text='담당 둘' where id=$1",[id]))).rowCount,1);
   for(const col of ['workspace_id','space_id','week_start'])
    await assert.rejects(owner(c=>c.query(`update public.app_business_now set ${col}=${col} where id=$1`,[id])),{code:'42501'},col);
   // 그 주의 지금 상황 = week_start <= 그 주인 가장 나중 행(화면 규칙을 SQL로 확인).
   const at=async w=>(await owner(c=>c.query("select body from public.app_business_now where space_id=$1 and week_start<=$2 order by week_start desc limit 1",[PROJECT_A,w]))).rows[0]?.body;
   assert.equal(await at('2026-11-09'),'고친 상황');assert.equal(await at('2026-11-30'),'');assert.equal(await at('2026-11-02'),undefined);
  });
  await t.test('report marks accept biz_record of the same workspace after B-1',async()=>{
   assert.equal((await owner(c=>c.query("insert into public.app_report_line_marks(workspace_id,week_start,section,ref_kind,ref_key,choice) values ($1,'2026-11-09','biz_detail','biz_record',$2,'out')",[WS_A,rec.id]))).rowCount,1);
   const other=(await pool.query("insert into public.app_business_records(workspace_id,space_id,day,body,source_kind) values ($1,$2,'2026-11-10','남의 사업 기록','user') returning id",[WS_B,PROJECT_B])).rows[0].id;
   await assert.rejects(owner(c=>c.query("insert into public.app_report_line_marks(workspace_id,week_start,section,ref_kind,ref_key) values ($1,'2026-11-09','biz_detail','biz_record',$2)",[WS_A,other])),{code:'23514'});
  });
  await t.test('deleting a business removes its rows; rollback stops while moved rows remain, then returns to the snapshot; re-apply works',async()=>{
   await pool.query('delete from public.app_spaces where id=$1',[PROJECT_A2]);
   assert.equal((await pool.query('select (select count(*) from public.app_business_records where space_id=$1)+(select count(*) from public.app_business_now where space_id=$1) as n',[PROJECT_A2])).rows[0].n,'0');
   await assert.rejects(pool.query(rollbackSQL),/moved rows remain/);
   await pool.query("delete from public.app_business_records where source_kind='progress'");
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const [item,value] of Object.entries(values(await readOnly(postcheck))))assert.equal(value,'예',item);
   const again=await run('apply','9935');assert.equal(again.ok,true,again.summary);
   for(const [item,value] of Object.entries(values(await readOnly(postcheck))))assert.equal(value,'예',item);
   assert.ok(await addNow(OWNER,WS_A,PROJECT_A));
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
