// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S68-09 READ-읽을거리함 PR-1 DB(20261122100000_reading_items):
// - 새 표 app_reading_items: owner만(RLS·정책 1개), 화면은 주소·제목·사이트·사업영역 넣기 / 제목·읽음·사업영역 고치기만, 원문 사본 칸은 service_role만.
//   사업영역은 같은 작업공간 app_spaces만(지워지면 비움). 남의 작업공간 줄은 못 보고 못 넣고 못 고친다. anon은 아무것도 못 한다.
// - 밑줄: 기존 app_news_highlights에 종류 'reading'만 더한다(다른 검사·정책 그대로).
// - 검색: app_search_records가 이름으로 부를 때만 'reading'을 찾는다(기본 8종류·결과 그대로). 남의 읽을 거리는 안 나온다.
// - 승인형 DB workflow 확장 규칙·전체 흐름 통과, 사전 조건 다르면 멈춤, dry-run은 아무것도 안 바꿈, 되돌리기(SQL Editor)는 이전 판을 그대로 되살린다.
// Optional: READING_PG_PORT=<port> runs the same checks on an already running local server (user postgres, trust auth).
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,PROJECT_B} from './basket4-fixture.mjs';
import {askSchema,askChain} from './ask-web2-fixture.mjs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const FN='20261122100000',FN_NAME='reading_items',stem=FN+'_'+FN_NAME;
const BEFORE=['20261029061500_ask_web2.sql','20261108070000_news_highlights.sql','20261115194000_news_highlights_note.sql'];
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const externalPort=process.env.READING_PG_PORT;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

test('READ-읽을거리함 DB: owner-only reading items, reading highlights, named-only search kind — plans, guard, dry-run, apply, rollback',{timeout:240000},async t=>{
 let cluster,pool,adminPool,database='postgres',port,password='';
 if(externalPort){
  port=Number(externalPort);database='reading_'+randomBytes(4).toString('hex');
  adminPool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres',ssl:false}));
  await adminPool.query('create database '+database);
  for(const role of ['anon','authenticated','public_probe','service_role'])await adminPool.query(`drop role if exists ${role}`).catch(()=>{});
 }else{
  const directory=await mkdtemp(join(tmpdir(),'reading-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));port=sock.address().port;await new Promise(r=>sock.close(r));
  password=randomBytes(24).toString('hex');
  cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
  await cluster.initialise();await cluster.start();
 }
 try{
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database,ssl:false}));
  await pool.query(fixture);
  await pool.query(askSchema);
  for(const file of [...askChain,...BEFORE])await pool.query(await read('supabase/migrations/'+file));
  const F={migration:await read('supabase/migrations/'+stem+'.sql'),rollback:await read('docs/'+stem+'.rollback.sql'),precheck:await read('docs/'+stem+'.precheck.sql'),
    postcheck:await read('docs/'+stem+'.postcheck.sql'),snapshot:await read('docs/'+stem+'.snapshot.sql'),summary:await read('docs/'+stem+'.summary.md')};
  const prev=await read('supabase/migrations/'+BEFORE[0]);
  const prevSource=prev.slice(prev.indexOf('as $$\n',prev.indexOf('create or replace function public.app_search_records'))+5,prev.indexOf('$$;\nrevoke all on function public.app_search_records'));
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version:FN,runId:run,root});
  const run=p=>runMigrationPlan(p,query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const search=(args,sub=OWNER,role='authenticated')=>as(role,sub,async c=>(await c.query('select public.app_search_records($1,$2,$3,$4,$5) r',[args.q,args.kinds??null,args.per??null,args.offset??null,args.kind??null])).rows[0].r);
  const group=(r,k)=>r.groups.find(g=>g.kind===k);
  const history=async v=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[v])).rows[0].n;
  const fnSource=async()=>(await pool.query("select prosrc from pg_proc where proname='app_search_records' and pronamespace='public'::regnamespace")).rows.map(r=>r.prosrc);
  const typeCheck=async()=>(await pool.query("select pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.app_news_highlights'::regclass and conname='app_news_highlights_type_check'")).rows.map(r=>r.d);

  await pool.query(`insert into public.app_notes(workspace_id,kind,raw_text,title) values($1,'note','교섭 노트 본문','교섭 노트')`,[WS_A]);
  const before=(await pool.query(F.snapshot)).rows;
  const beforeSearch=await search({q:'교섭'});
  const beforeCheck=await typeCheck();

  await t.test('files: 5 pair files, summary 3 lines, no definer/anon/rtw; expanded workflow full flow; rollback is SQL Editor only and restores the earlier body',()=>{
   const lines=F.summary.trim().split('\n');assert.equal(lines.length,3);
   ['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   for(const sql of [F.migration,F.rollback]){
    const code=sql.replace(/--.*$/gm,'');
    assert.doesNotMatch(code,/security definer|\bto (anon|public)\b|disable row level|rtw_|create extension|update public/i);
    assert.match(code,/^begin;/);assert.match(code,/commit;\s*$/);
    assert.match(code,/security invoker\s+set search_path = ''/);
    assert.match(code,/revoke all on function public\.app_search_records\(text, text\[\], integer, integer, text\) from public, anon, service_role;/);
   }
   const code=F.migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/app_call_personal|app_tg_personal|f\.raw_text|'diary'|app_news_articles|app_news_marks|app_collab/);
   assert.match(code,/grant insert \(workspace_id, url, title, site, business_area_id\) on table public\.app_reading_items to authenticated;/);
   assert.match(code,/grant update \(title, site, body, body_state, body_at, updated_at\) on table public\.app_reading_items to service_role;/);
   assert.match(F.migration,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\nvalues \('20261122100000', 'reading_items'/);
   for(const mode of ['apply','dry-run']){const p=plan(mode,'1');assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');}
   assert.throws(()=>plan('rollback','1'));
   assert.ok(F.rollback.includes(prevSource));
  });

  await t.test('precheck before apply: all 예; reading kind refused before apply',async()=>{
   for(const row of (await pool.query(F.precheck)).rows)if(!['search function source hash','recent migrations'].includes(row.item))assert.equal(row.value,'예',row.item);
   await assert.rejects(search({q:'교섭',kinds:['reading']}),{code:'22023',message:'SEARCH_BAD_KIND'});
  });

  await t.test('prerequisite guard stops when the earlier function or highlight check changed or the table exists',async()=>{
   for(const change of [
    `create or replace function public.app_search_records(p_query text, p_kinds text[], p_per_kind integer, p_offset integer, p_kind text) returns jsonb language sql stable security invoker set search_path = '' as $$ select '{}'::jsonb $$`,
    `alter table public.app_news_highlights drop constraint app_news_highlights_type_check`,
    `delete from supabase_migrations.schema_migrations where version='20261029061500'`,
    `create table public.app_reading_items(id uuid)`,
   ]){
    const c=await pool.connect();
    try{await c.query('begin');await c.query(change);
     await assert.rejects(c.query(F.migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/READING_ITEMS_PREREQUISITE_CHANGED/,change);}
    finally{await c.query('rollback');c.release();}
   }
   assert.equal(await history(FN),0);
  });

  await t.test('dry-run leaves nothing; apply passes postcheck; second apply refused',async()=>{
   const dry=await run(plan('dry-run','9811'));assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(F.snapshot)).rows,before);
   const apply=await run(plan('apply','9812'));assert.equal(apply.ok,true,apply.summary);
   for(const r of (await pool.query(F.postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal(await history(FN),1);
   assert.equal((await run(plan('apply','9813'))).ok,false);
   assert.equal(await history(FN),1);
  });

  let A1='',B1='';
  await t.test('items: owner inserts own rows with own business area only; body columns server-only; stranger and anon refused',async()=>{
   const ins=(c,ws,url,area=null,extra='')=>c.query(`insert into public.app_reading_items(workspace_id,url,title,site,business_area_id${extra?','+extra:''}) values ($1,$2,'임금 교섭 기사','ex.com',$3${extra?",'x'":''}) returning id`,[ws,url,area]);
   A1=await as('authenticated',OWNER,async c=>(await ins(c,WS_A,'https://ex.com/a',PROJECT_A)).rows[0].id);
   B1=await as('authenticated',STRANGER,async c=>(await ins(c,WS_B,'https://ex.com/a')).rows[0].id);
   // 같은 작업공간 같은 주소는 한 줄, 남의 작업공간·남의 사업영역·원문 칸 넣기는 거절.
   await assert.rejects(as('authenticated',OWNER,c=>ins(c,WS_A,'https://ex.com/a')),{code:'23505'});
   await assert.rejects(as('authenticated',OWNER,c=>ins(c,WS_B,'https://ex.com/z')),{code:'42501'});
   await assert.rejects(as('authenticated',OWNER,c=>ins(c,WS_A,'https://ex.com/z',PROJECT_B)),{code:'42501'});
   await assert.rejects(as('authenticated',OWNER,c=>ins(c,WS_A,'https://ex.com/z',null,'body')),{code:'42501'});
   await assert.rejects(as('authenticated',OWNER,c=>ins(c,WS_A,'javascript:alert(1)')),{code:'23514'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query(`insert into public.app_reading_items(id,workspace_id,url) values (gen_random_uuid(),$1,'https://ex.com/id')`,[WS_A])),{code:'42501'});
   // 화면 고치기: 제목·읽음·사업영역만. 원문 사본·작업공간·주소는 못 고친다. 남의 줄은 0줄.
   assert.equal(await as('authenticated',OWNER,async c=>(await c.query(`update public.app_reading_items set read_at=now(),title='읽은 기사',updated_at=now() where id=$1`,[A1])).rowCount),1);
   for(const set of [`body='x'`,`body_state='ok'`,`workspace_id='${WS_B}'`,`url='https://ex.com/q'`])
    await assert.rejects(as('authenticated',OWNER,c=>c.query(`update public.app_reading_items set ${set} where id=$1`,[A1])),{code:'42501'},set);
   await assert.rejects(as('authenticated',OWNER,c=>c.query(`update public.app_reading_items set business_area_id=$2 where id=$1`,[A1,PROJECT_B])),{code:'42501'});
   assert.equal(await as('authenticated',OWNER,async c=>(await c.query(`update public.app_reading_items set title='남의 것' where id=$1`,[B1])).rowCount),0);
   assert.equal(await as('authenticated',OWNER,async c=>(await c.query(`delete from public.app_reading_items where id=$1`,[B1])).rowCount),0);
   assert.deepEqual(await as('authenticated',STRANGER,async c=>(await c.query('select id from public.app_reading_items')).rows.map(r=>r.id)),[B1]);
   await assert.rejects(as('anon','',c=>c.query('select * from public.app_reading_items')),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query(`insert into public.app_reading_items(workspace_id,url) values ($1,'https://ex.com/n')`,[WS_A])),{code:'42501'});
   // 서버(service_role): 원문 사본 칸만 고친다. 넣기·지우기·주소·작업공간 고치기는 못 한다.
   await as('service_role','',c=>c.query(`update public.app_reading_items set body=E'첫 문단\n성과급 교섭 결과 본문',body_state='ok',body_at=now(),site='예시 신문',updated_at=now() where id=$1 and workspace_id=$2`,[A1,WS_A]));
   await assert.rejects(as('service_role','',c=>c.query(`update public.app_reading_items set url='https://ex.com/q' where id=$1`,[A1])),{code:'42501'});
   await assert.rejects(as('service_role','',c=>c.query(`update public.app_reading_items set read_at=now() where id=$1`,[A1])),{code:'42501'});
   await assert.rejects(as('service_role','',c=>c.query(`delete from public.app_reading_items where id=$1`,[A1])),{code:'42501'});
   await assert.rejects(as('service_role','',c=>c.query(`insert into public.app_reading_items(workspace_id,url) values ($1,'https://ex.com/s')`,[WS_A])),{code:'42501'});
   // 상태 모양: 본문은 ok·paywall만, 받은 시각은 pending이 아닐 때만.
   await assert.rejects(as('service_role','',c=>c.query(`update public.app_reading_items set body_state='failed',updated_at=now() where id=$1`,[A1])),{code:'23514'});
   await assert.rejects(as('service_role','',c=>c.query(`update public.app_reading_items set body=E'제어\u0001글자' where id=$1`,[A1])),{code:'23514'});
   // 사업영역이 지워지면 칸만 비운다(읽을 거리는 남음).
   await pool.query('delete from public.app_spaces where id=$1',[PROJECT_A]);
   assert.equal((await pool.query('select business_area_id from public.app_reading_items where id=$1',[A1])).rows[0].business_area_id,null);
   await pool.query('insert into public.app_spaces(id,workspace_id) values ($1,$2)',[PROJECT_A,WS_A]);
  });

  await t.test('highlights accept reading for the owner only; other checks unchanged',async()=>{
   const hl=(c,ws,type='reading')=>c.query(`insert into public.app_news_highlights(workspace_id,source_type,source_id,quote,memo,source_title,source_url) values ($1,$2,$3,'성과급 교섭 결과','메모','읽은 기사','https://ex.com/a') returning id`,[ws,type,A1]);
   await as('authenticated',OWNER,c=>hl(c,WS_A));
   await assert.rejects(as('authenticated',OWNER,c=>hl(c,WS_B)),{code:'42501'});
   await assert.rejects(as('authenticated',OWNER,c=>hl(c,WS_A,'diary')),{code:'23514'});
   assert.equal(await as('authenticated',STRANGER,async c=>(await c.query(`select count(*)::int n from public.app_news_highlights`)).rows[0].n),0);
  });

  await t.test('search: reading only when named; title, site and stored text; own rows only; default and earlier results unchanged',async()=>{
   const r=group(await search({q:'성과급',kinds:['reading'],per:10}),'reading');
   assert.deepEqual(r.items.map(i=>[i.id,i.title,i.matched_in,i.kind,i.source]),[[A1,'읽은 기사','body','reading','reading']]);
   assert.match(r.items[0].snippet,/성과급 교섭 결과/);
   assert.equal(group(await search({q:'예시 신문',kind:'reading'}),'reading').total,1);
   assert.equal(group(await search({q:'ex.com',kind:'reading'}),'reading').total,1);
   // 사업영역 꼬리표는 프로젝트 칸으로.
   await as('authenticated',OWNER,c=>c.query(`update public.app_reading_items set business_area_id=$2 where id=$1`,[A1,PROJECT_A]));
   assert.equal(group(await search({q:'성과급',kind:'reading'}),'reading').items[0].project_id,PROJECT_A);
   // 남의 읽을 거리·원문은 안 나온다.
   assert.equal(group(await search({q:'성과급',kind:'reading'},STRANGER),'reading').total,0);
   assert.deepEqual(group(await search({q:'임금',kind:'reading'},STRANGER),'reading').items.map(i=>i.id),[B1]);
   // 기본(종류 비움)은 8종류 그대로, 이전 결과와 같다.
   const after=await search({q:'교섭'});
   assert.deepEqual(after.groups.map(g=>g.kind),['update','note','work','document','meeting','project','organization','milestone']);
   assert.deepEqual(after,beforeSearch);
   // 받지 못한 원문(실패 상태)은 본문으로 찾지 않는다.
   await as('service_role','',c=>c.query(`update public.app_reading_items set body=null,body_state='failed',body_at=now() where id=$1`,[A1]));
   assert.equal(group(await search({q:'성과급',kind:'reading'}),'reading').total,0);
   await assert.rejects(search({q:'성과급',kind:'reading'},'','anon'),{code:'42501'});
   await assert.rejects(as('service_role','',c=>c.query("select public.app_search_records('성과급',null,null,null,'reading')")),{code:'42501'});
  });

  await t.test('rollback (SQL Editor) stops while reading highlights remain, then restores the earlier function, check and drops the table',async()=>{
   await assert.rejects(pool.query(F.rollback),/READING_ITEMS_ROLLBACK_BLOCKED: reading highlights remain/);await pool.query('rollback');
   await pool.query(`delete from public.app_news_highlights where source_type='reading'`);
   await pool.query(F.rollback);
   assert.equal(await history(FN),0);
   assert.deepEqual(await fnSource(),[prevSource]);
   assert.deepEqual(await typeCheck(),beforeCheck);
   assert.deepEqual((await pool.query(F.snapshot)).rows,before);
   for(const r of (await pool.query(F.postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal((await pool.query("select to_regclass('public.app_reading_items') t")).rows[0].t,null);
   await assert.rejects(pool.query(F.rollback),/READING_ITEMS_ROLLBACK_BLOCKED/);await pool.query('rollback');
   await pool.query(F.migration);
   assert.equal(await history(FN),1);
  });
 }finally{
  await closePool(pool);
  if(adminPool){await adminPool.query('drop database if exists '+database+' with (force)').catch(()=>{});await closePool(adminPool);}
  if(cluster)await cluster.stop().catch(()=>{});
 }
});
