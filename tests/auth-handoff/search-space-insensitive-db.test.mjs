// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S71-15 SEARCH-띄어쓰기무시(20261126180000_search_space_insensitive):
// - app_search_records가 낱말 글자 사이 띄어쓰기·줄바꿈을 무시한다('야간총회' ↔ '야간 총회'). 여러 낱말은 모두 들어 있으면 맞음(순서·사이 글자 상관없음).
// - 정규식 특수문자·ILIKE 특수문자(% _ \)는 글자 그대로. 앞뒤 한 줄은 띄어 쓴 원래 글 자리에서.
// - 남의 작업공간 기록은 안 나오고 anon·service_role은 부를 수 없다(권한 모양 그대로). 같은 서명 하나.
// - 승인형 DB workflow 확장 규칙·전체 흐름 통과, 사전 조건 다르면 멈춤, dry-run은 아무것도 안 바꿈, 되돌리기(SQL Editor)는 이전 판을 그대로 되살린다.
// Optional: SEARCH_SPACE_PG_PORT=<port> runs the same checks on an already running local server (user postgres, trust auth).
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
import {askSchema,askChain} from './ask-web2-fixture.mjs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const FN='20261126180000',FN_NAME='search_space_insensitive',stem=FN+'_'+FN_NAME;
const BEFORE=['20261029061500_ask_web2.sql','20261108070000_news_highlights.sql','20261115194000_news_highlights_note.sql','20261122100000_reading_items.sql'];
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const externalPort=process.env.SEARCH_SPACE_PG_PORT;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

test('SEARCH-띄어쓰기무시 DB: whitespace-insensitive words, literal specials, own rows only — plans, guard, dry-run, apply, rollback',{timeout:240000},async t=>{
 let cluster,pool,adminPool,database='postgres',port,password='';
 if(externalPort){
  port=Number(externalPort);database='space_'+randomBytes(4).toString('hex');
  adminPool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres',ssl:false}));
  await adminPool.query('create database '+database);
  for(const role of ['anon','authenticated','public_probe','service_role'])await adminPool.query(`drop role if exists ${role}`).catch(()=>{});
 }else{
  const directory=await mkdtemp(join(tmpdir(),'space-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));port=sock.address().port;await new Promise(r=>sock.close(r));
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
  const prev=await read('supabase/migrations/'+BEFORE.at(-1));
  const prevSource=prev.slice(prev.indexOf('as $$\n',prev.indexOf('create or replace function public.app_search_records'))+5,prev.indexOf('$$;\nrevoke all on function public.app_search_records'));
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version:FN,runId:run,root});
  const run=p=>runMigrationPlan(p,query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const search=(args,sub=OWNER,role='authenticated')=>as(role,sub,async c=>(await c.query('select public.app_search_records($1,$2,$3,$4,$5) r',[args.q,args.kinds??null,args.per??null,args.offset??null,args.kind??null])).rows[0].r);
  const group=(r,k)=>r.groups.find(g=>g.kind===k);
  const ids=async(q,kind='note',sub=OWNER)=>group(await search({q,kind,per:20},sub),kind).items.map(i=>i.id).sort();
  const history=async v=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[v])).rows[0].n;
  const fnSource=async()=>(await pool.query("select prosrc from pg_proc where proname='app_search_records' and pronamespace='public'::regnamespace")).rows.map(r=>r.prosrc);

  const note=async(ws,title,raw)=>(await pool.query(`insert into public.app_notes(workspace_id,kind,raw_text,title) values($1,'note',$2,$3) returning id`,[ws,raw,title])).rows[0].id;
  const N1=await note(WS_A,'가상 노트 하나','올해 야간 \n 총회 준비 [메모] a.b (괄호) 50% 달성 a_b');
  const N2=await note(WS_A,'가상 노트 둘','야간총회 결과 정리');
  const N3=await note(WS_A,'가상 노트 셋','야간 근무 뒤 대의원 회의');
  const NB=await note(WS_B,'남의 노트','야간총회 남의 기록');
  const before=(await pool.query(F.snapshot)).rows;
  const beforeSpaced=await ids('야간 총회');

  await t.test('files: 5 pair files, summary 3 lines, no definer/anon/rtw; expanded workflow full flow; rollback is SQL Editor only and restores the earlier body',()=>{
   const lines=F.summary.trim().split('\n');assert.equal(lines.length,3);
   ['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   for(const sql of [F.migration,F.rollback]){
    const code=sql.replace(/--.*$/gm,'');
    assert.doesNotMatch(code,/security definer|\bto (anon|public)\b|disable row level|rtw_|create extension|update public|create table|alter table|create policy|drop policy/i);
    assert.match(code,/^begin;/);assert.match(code,/commit;\s*$/);
    assert.match(code,/security invoker\s+set search_path = ''/);
    assert.match(code,/revoke all on function public\.app_search_records\(text, text\[\], integer, integer, text\) from public, anon, service_role;/);
    assert.match(code,/grant execute on function public\.app_search_records\(text, text\[\], integer, integer, text\) to authenticated;/);
   }
   const code=F.migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/app_call_personal|app_tg_personal|f\.raw_text|'diary'/);
   // 함수 본문(사후 확인 DO의 'not like ilike all' 글자는 빼고)에는 ILIKE 맞추기가 남지 않는다.
   const body=code.slice(code.indexOf('create or replace function public.app_search_records'),code.indexOf('revoke all on function public.app_search_records'));
   assert.doesNotMatch(body,/ilike/i);
   assert.equal((body.match(/~\* all \(v_rx\)/g)||[]).length,12);
   assert.match(F.migration,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\nvalues \('20261126180000', 'search_space_insensitive'/);
   for(const mode of ['apply','dry-run']){const p=plan(mode,'1');assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');}
   assert.throws(()=>plan('rollback','1'));
   assert.ok(F.rollback.includes(prevSource));
  });

  await t.test('before apply: precheck all 예; joined query does not find the spaced record yet',async()=>{
   for(const row of (await pool.query(F.precheck)).rows)if(!['search function source hash','recent migrations'].includes(row.item))assert.equal(row.value,'예',row.item);
   assert.deepEqual(await ids('야간총회'),[N2]);
   assert.deepEqual(beforeSpaced,[N1,N2].sort());
  });

  await t.test('prerequisite guard stops when the earlier function or record changed',async()=>{
   for(const change of [
    `create or replace function public.app_search_records(p_query text, p_kinds text[], p_per_kind integer, p_offset integer, p_kind text) returns jsonb language sql stable security invoker set search_path = '' as $$ select '{}'::jsonb $$`,
    `delete from supabase_migrations.schema_migrations where version='20261122100000'`,
   ]){
    const c=await pool.connect();
    try{await c.query('begin');await c.query(change);
     await assert.rejects(c.query(F.migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/SEARCH_SPACE_PREREQUISITE_CHANGED/,change);}
    finally{await c.query('rollback');c.release();}
   }
   assert.equal(await history(FN),0);
  });

  await t.test('dry-run leaves nothing; apply passes postcheck; second apply refused',async()=>{
   const dry=await run(plan('dry-run','9821'));assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(F.snapshot)).rows,before);
   const apply=await run(plan('apply','9822'));assert.equal(apply.ok,true,apply.summary);
   for(const r of (await pool.query(F.postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal(await history(FN),1);
   assert.equal((await run(plan('apply','9823'))).ok,false);
   assert.equal(await history(FN),1);
  });

  await t.test('search: spaces ignored both ways, all words in any order, literal specials, snippet from the spaced text, own rows only',async()=>{
   assert.deepEqual(await ids('야간총회'),[N1,N2].sort());
   assert.deepEqual(await ids('야간 총회'),[N1,N2].sort());
   assert.deepEqual(await ids('총회 야간'),[N1,N2].sort());
   assert.deepEqual(await ids('야간 회의'),[N3]);
   assert.deepEqual(await ids('YAGAN'),[]);
   for(const [q,want] of [['a.b',[N1]],['ab',[]],['(괄호)',[N1]],['[메모]',[N1]],['a*b',[]],['50%',[N1]],['a_b',[N1]],['%%',[]],['__',[]]])
    assert.deepEqual(await ids(q),want,q);
   const hit=group(await search({q:'야간총회',kind:'note',per:20}),'note').items.find(i=>i.id===N1);
   assert.equal(hit.matched_in,'body');
   assert.match(hit.snippet,/야간 총회 준비/);
   // 남의 작업공간 기록은 안 나오고, 남은 자기 것만.
   assert.ok(!(await ids('야간총회')).includes(NB));
   assert.deepEqual(await ids('야간 총회','note',STRANGER),[NB]);
   // 기본 종류·돌려주는 모양 그대로.
   const all=await search({q:'야간총회'});
   assert.deepEqual(all.groups.map(g=>g.kind),['update','note','work','document','meeting','project','organization','milestone']);
   assert.deepEqual(all.words,['야간총회']);
   await assert.rejects(search({q:'야간총회'},'','anon'),{code:'42501'});
   await assert.rejects(as('service_role','',c=>c.query("select public.app_search_records('야간총회',null,null,null,null)")),{code:'42501'});
   await assert.rejects(search({q:'야'}),{code:'22023',message:'SEARCH_QUERY_TOO_SHORT'});
  });

  await t.test('rollback (SQL Editor) restores the earlier function and record; postcheck still 예; apply again works',async()=>{
   await pool.query(F.rollback);
   assert.equal(await history(FN),0);
   assert.deepEqual(await fnSource(),[prevSource]);
   assert.deepEqual((await pool.query(F.snapshot)).rows,before);
   for(const r of (await pool.query(F.postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.deepEqual(await ids('야간총회'),[N2]);
   await assert.rejects(pool.query(F.rollback),/SEARCH_SPACE_ROLLBACK_BLOCKED/);await pool.query('rollback');
   await pool.query(F.migration);
   assert.equal(await history(FN),1);
  });
 }finally{
  await closePool(pool);
  if(adminPool){await adminPool.query('drop database if exists '+database+' with (force)').catch(()=>{});await closePool(adminPool);}
  if(cluster)await cluster.stop().catch(()=>{});
 }
});
