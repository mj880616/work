// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// HOME-읽을거리평가 DB(20261128071000_read_ratings): 소유자만 읽기·넣기·지우기, 다른 작업공간·anon·service_role 거절,
// 평가 값 -1/1만, 글 칸은 뉴스·사회운동 가운데 정확히 하나, 글 하나에 평가 하나, 고치기 없음(바꾸기 = 지우고 넣기), id·시각 넣기 불가, 되돌리기.
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
const version='20261128071000',name='read_ratings',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const N1='31000000-0000-4000-8000-000000000001',N2='31000000-0000-4000-8000-000000000002',O1='32000000-0000-4000-8000-000000000001';
// 공용 글 표 두 개의 아주 작은 대역(id·제목·매체 키만). 운영 표는 이 migration이 바꾸지 않는다.
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  revoke usage on schema private from service_role;
  create table public.app_news_articles(id uuid primary key, title text, source_key text);
  create table public.app_outside_articles(id uuid primary key, title text not null, source_key text not null);
  insert into public.app_news_articles values ('${N1}','가상 기사 1','gasang'),('${N2}','가상 기사 2','gasang');
  insert into public.app_outside_articles values ('${O1}','가상 글 1','gasang-out');`;

test('read ratings db: plan, dry-run, apply, owner boundary, value and one-article checks, no update, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'read-ratings-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const insNews='insert into public.app_read_ratings(workspace_id,news_article_id,rating) values ($1,$2,$3) returning id,rated_at';
  const insOut='insert into public.app_read_ratings(workspace_id,outside_article_id,rating) values ($1,$2,$3) returning id,rated_at';
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules, no functions or triggers, grants as designed, summary 3 lines',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual([...plan.functions],[]);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/create (or replace )?function|create trigger|rtw_|app_collab|\bto (anon|public|service_role)\b|alter table public\.app_(news|outside)_articles|security definer|grant update/i);
   // 글 제목·본문·매체 칸은 두지 않는다(공용 글 표에서 읽는다).
   assert.doesNotMatch(code.match(/create table public\.app_read_ratings \(([\s\S]*?)\n\);/)[1],/\b(title|body|summary|source_key|url)\b/);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/app_news_articles|app_outside_articles|truncate|cascade|grant /i);
   assert.match(rollbackSQL+summary,/평가도 함께 사라/);
  });
  await t.test('precheck yes, dry-run changes nothing, apply passes postcheck, second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const dry=await run('dry-run','9991');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9992');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9993')).ok,false);
  });
  await t.test('owner rates news and outside articles, one rating per article, cancel = delete, change = delete then insert',async()=>{
   const row=(await owner(c=>c.query(insNews,[WS_A,N1,1]))).rows[0];
   assert.ok(row.rated_at);
   await owner(c=>c.query(insOut,[WS_A,O1,-1]));
   await assert.rejects(owner(c=>c.query(insNews,[WS_A,N1,-1])),{code:'23505'});
   await assert.rejects(owner(c=>c.query(insOut,[WS_A,O1,1])),{code:'23505'});
   assert.deepEqual((await owner(c=>c.query('select news_article_id,outside_article_id,rating from public.app_read_ratings order by rating desc'))).rows,
     [{news_article_id:N1,outside_article_id:null,rating:1},{news_article_id:null,outside_article_id:O1,rating:-1}]);
   // 바꾸기: 지우고 넣기(고치기 권한 없음).
   await assert.rejects(owner(c=>c.query('update public.app_read_ratings set rating=-1 where news_article_id=$1',[N1])),/permission denied/);
   await assert.rejects(owner(c=>c.query('update public.app_read_ratings set rated_at=now() where news_article_id=$1',[N1])),/permission denied/);
   await owner(async c=>{await c.query('delete from public.app_read_ratings where workspace_id=$1 and news_article_id=$2',[WS_A,N1]);await c.query(insNews,[WS_A,N1,-1]);});
   assert.equal((await owner(c=>c.query('select rating from public.app_read_ratings where news_article_id=$1',[N1]))).rows[0].rating,-1);
   // 취소 = 지우기.
   assert.equal((await owner(c=>c.query('delete from public.app_read_ratings where workspace_id=$1 and outside_article_id=$2',[WS_A,O1]))).rowCount,1);
   // 같은 글을 다른 작업공간은 따로 평가한다.
   await stranger(c=>c.query(insNews,[WS_B,N1,1]));
  });
  await t.test('shape checks: rating only -1/1, exactly one article, article must exist, id and time not settable',async()=>{
   for(const bad of [0,2,-2,5])await assert.rejects(owner(c=>c.query(insNews,[WS_A,N2,bad])),{code:'23514'},String(bad));
   await assert.rejects(owner(c=>c.query(insNews,[WS_A,N2,null])),{code:'23502'});
   await assert.rejects(owner(c=>c.query('insert into public.app_read_ratings(workspace_id,rating) values ($1,1)',[WS_A])),{code:'23514'});
   await assert.rejects(owner(c=>c.query('insert into public.app_read_ratings(workspace_id,news_article_id,outside_article_id,rating) values ($1,$2,$3,1)',[WS_A,N2,O1])),{code:'23514'});
   await assert.rejects(owner(c=>c.query(insNews,[WS_A,'39000000-0000-4000-8000-000000000009',1])),{code:'23503'});
   await assert.rejects(owner(c=>c.query('insert into public.app_read_ratings(id,workspace_id,news_article_id,rating) values (gen_random_uuid(),$1,$2,1)',[WS_A,N2])),/permission denied/);
   await assert.rejects(owner(c=>c.query("insert into public.app_read_ratings(workspace_id,news_article_id,rating,rated_at) values ($1,$2,1,'2020-01-01')",[WS_A,N2])),/permission denied/);
  });
  await t.test('boundaries: other workspace id, stranger, anon and server blocked',async()=>{
   await assert.rejects(owner(c=>c.query(insNews,[WS_B,N2,1])),/row-level security/);
   await assert.rejects(stranger(c=>c.query(insNews,[WS_A,N2,1])),/row-level security/);
   assert.equal((await stranger(c=>c.query('select 1 from public.app_read_ratings where workspace_id=$1',[WS_A]))).rows.length,0);
   assert.equal((await stranger(c=>c.query('delete from public.app_read_ratings where workspace_id=$1',[WS_A]))).rowCount,0);
   assert.equal((await owner(c=>c.query('select 1 from public.app_read_ratings where workspace_id=$1',[WS_B]))).rows.length,0);
   assert.equal((await owner(c=>c.query('delete from public.app_read_ratings where workspace_id=$1',[WS_B]))).rowCount,0);
   for(const fn of [anon,server]){
    await assert.rejects(fn(c=>c.query('select 1 from public.app_read_ratings')),/permission denied/);
    await assert.rejects(fn(c=>c.query(insNews,[WS_A,N2,1])),/permission denied/);
    await assert.rejects(fn(c=>c.query('delete from public.app_read_ratings')),/permission denied/);
   }
   assert.equal((await pool.query('select count(*)::int n from public.app_read_ratings where workspace_id=$1',[WS_A])).rows[0].n,1);
   // 글이 지워지면 평가도 함께 지워진다.
   await pool.query('delete from public.app_news_articles where id=$1',[N1]);
   assert.equal((await pool.query('select count(*)::int n from public.app_read_ratings')).rows[0].n,0);
  });
  await t.test('rollback: new table and record gone, article tables untouched, re-apply works',async()=>{
   const arts=(await pool.query('select count(*)::int n from public.app_news_articles')).rows[0].n;
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   for(const r of await readOnly(precheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   assert.equal((await pool.query('select count(*)::int n from public.app_news_articles')).rows[0].n,arts);
   await pool.query(migration);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
