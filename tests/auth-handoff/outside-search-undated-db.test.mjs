// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic (example.org).
// S48-18 바깥 성명 문장 찾기(20261102150000_outside_search_undated): 기간 거르기는 게시 시각만, 날짜 모름은 맨 아래 — through the approved DB workflow runner.
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
import {fixture,OWNER,STRANGER,WS_A} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261102150000',name='outside_search_undated',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

const prerequisites=`
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;`;
const SEARCH='public.app_outside_search($1,$2,$3,$4,$5,$6,$7)';

test('outside search undated: plan, dry-run, apply, published date only, undated last, owner only, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'outside-search-undated-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  // 앞 단계(운영에 적용됨): 표 넷 + 찾기 함수.
  await pool.query(await read('supabase/migrations/20261031230000_outside_statements.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL]=await Promise.all(['precheck','postcheck','snapshot','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const s=(fn,args)=>fn(c=>c.query(`select * from ${SEARCH}`,args)).then(r=>r.rows);

  // 합성 글 셋: 게시 10/30(받은 날 11/01), 날짜 모름(받은 날 11/01 — 예전 같으면 11/01 기간에 걸림), 게시 10/20(받은 날 11/01).
  const addPost=(url,published)=>pool.query(`insert into public.app_outside_posts(workspace_id,source_key,kind,lang,title,url,published_at,fetched_at,has_body)
    values ($1,'kctu','statement','ko','[성명] 합성 제목',$2,$3,'2026-11-01T03:00:00Z',true) returning id`,[WS_A,url,published]).then(r=>r.rows[0].id);
  const dated=await addPost('https://example.org/a/1','2026-10-30T01:00:00Z');
  const undated=await addPost('https://example.org/a/2',null);
  const older=await addPost('https://example.org/a/3','2026-10-20T01:00:00Z');
  for(const id of [dated,undated,older])
    await pool.query("insert into public.app_outside_sentences(post_id,workspace_id,lang,idx,text) values ($1,$2,'ko',0,'정부는 구조조정을 즉각 중단하라.')",[id,WS_A]);
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  // 예전 모양: 날짜 모름 글이 받은 날(11/01)로 기간에 걸린다(고칠 증상).
  assert.deepEqual((await s(owner,['구조조정',null,null,'2026-11-01','2026-11-01',null,null])).map(r=>r.post_id),[undated]);

  await t.test('approval plan: expanded rules, full flow, no definer function, existing tables untouched',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.review.definer,[]);assert.equal(plan.review.policies,0);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   assert.doesNotMatch(migration,/alter table|create (table|policy)|security definer|grant [^\n]* to (anon|public|service_role)/i);
  });
  await t.test('precheck: all yes before apply',()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
  await t.test('dry-run leaves schema and history unchanged',async()=>{
   const dry=await run('dry-run','9961');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; second apply refused',async()=>{
   const apply=await run('apply','9962');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9963')).ok,false);
   // 실행권은 그대로(snapshot의 함수 줄은 본문 해시만 달라짐).
   const fn=rows=>rows.find(r=>r.kind==='function').definition.split(':').slice(0,-1).join(':');
   assert.equal(fn((await pool.query(snapshot)).rows),fn(before));
  });
  await t.test('date range uses the published date only; undated posts appear only without a range, last',async()=>{
   assert.deepEqual(await s(owner,['구조조정',null,null,'2026-11-01','2026-11-01',null,null]),[],'received date no longer counts');
   assert.deepEqual((await s(owner,['구조조정',null,null,'2026-10-25',null,null,null])).map(r=>r.post_id),[dated]);
   assert.deepEqual((await s(owner,['구조조정',null,null,null,'2026-10-25',null,null])).map(r=>r.post_id),[older]);
   assert.deepEqual((await s(owner,['구조조정',null,null,'2026-10-01','2026-10-31',null,null])).map(r=>r.post_id),[dated,older]);
   const all=await s(owner,['구조조정',null,null,null,null,null,null]);
   assert.deepEqual(all.map(r=>r.post_id),[dated,older,undated],'newest first, undated last');
   assert.equal(all[2].published_at,null);
   // 나머지 동작(비슷한 말·쪽 나누기·남·익명)은 그대로.
   assert.deepEqual((await s(owner,['zz',['중단'],null,null,null,1,1])).map(r=>[r.post_id,r.matched,r.is_similar]),[[older,'중단',true]]);
   assert.equal((await s(stranger,['구조조정',null,null,null,null,null,null])).length,0);
   await assert.rejects(as('anon','',c=>c.query(`select * from ${SEARCH}`,['구조조정',null,null,null,null,null,null])),{code:'42501'});
  });
  await t.test('rollback (SQL Editor path) returns to the snapshot; postcheck still all yes',async()=>{
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}),/rejected/,'restore-by-replace rollback is not a workflow button');
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.deepEqual((await s(owner,['구조조정',null,null,'2026-11-01','2026-11-01',null,null])).map(r=>r.post_id),[undated]);
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
