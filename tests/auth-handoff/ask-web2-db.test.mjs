// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic.
// ASK-Web2 1단계 DB: 20261029061500_ask_web2 redefines public.app_search_records (same signature, SECURITY INVOKER,
// authenticated only) with kinds call/telegram (named only, default 8 kinds unchanged) and adds app_ask_answers (owner only, 30 days).
// Checks: pair files, workflow plans (expanded, full flow), prerequisite guard, dry-run, apply + postcheck, call/telegram hits
// (work calls only, user edits win, hidden/trashed day excluded), diary / personal call box / personal telegram / raw text never found,
// other workspace and anon refused, answers table owner-only (no update, server time), rollback restores the earlier function exactly.
// Optional: SEARCH_PG_PORT=<port> runs the same checks on an already running local server (user postgres, trust auth).
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
const FN='20261029061500',FN_NAME='ask_web2',PREV_FILE='20261023013000_search_attachment_text.sql';
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const externalPort=process.env.SEARCH_PG_PORT;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const ORG='23000000-0000-4000-8000-0000000000aa';
const CALL='30000000-0000-4000-8000-000000000001',CALL_HIDDEN='30000000-0000-4000-8000-000000000002',CALL_EDITED='30000000-0000-4000-8000-000000000003',CALL_B='30000000-0000-4000-8000-000000000004';
const TG='31000000-0000-4000-8000-000000000001',TG_TRASHED_DAY='31000000-0000-4000-8000-000000000002';

test('ASK-Web2 DB: search kinds call/telegram + answers table — plans, guard, dry-run, apply, owner-only, never personal, rollback',{timeout:180000},async t=>{
 let cluster,pool,adminPool,database='postgres',port,password='';
 if(externalPort){
  port=Number(externalPort);database='ask_'+randomBytes(4).toString('hex');
  adminPool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres',ssl:false}));
  await adminPool.query('create database '+database);
  for(const role of ['anon','authenticated','public_probe','service_role'])await adminPool.query(`drop role if exists ${role}`).catch(()=>{});
 }else{
  const directory=await mkdtemp(join(tmpdir(),'ask-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));port=sock.address().port;await new Promise(r=>sock.close(r));
  password=randomBytes(24).toString('hex');
  cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
  await cluster.initialise();await cluster.start();
 }
 try{
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database,ssl:false}));
  await pool.query(fixture);
  await pool.query(askSchema);
  for(const file of askChain)await pool.query(await read('supabase/migrations/'+file));
  const stem=FN+'_'+FN_NAME;
  const F={migration:await read('supabase/migrations/'+stem+'.sql'),rollback:await read('docs/'+stem+'.rollback.sql'),precheck:await read('docs/'+stem+'.precheck.sql'),
    postcheck:await read('docs/'+stem+'.postcheck.sql'),snapshot:await read('docs/'+stem+'.snapshot.sql'),summary:await read('docs/'+stem+'.summary.md')};
  const prev=await read('supabase/migrations/'+PREV_FILE);
  const prevSource=prev.slice(prev.indexOf('as $$\n')+5,prev.indexOf('$$;\nrevoke'));
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version:FN,runId:run,root});
  const run=p=>runMigrationPlan(p,query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const search=(args,sub=OWNER,role='authenticated')=>as(role,sub,async c=>(await c.query('select public.app_search_records($1,$2,$3,$4,$5) r',[args.q,args.kinds??null,args.per??null,args.offset??null,args.kind??null])).rows[0].r);
  const group=(r,k)=>r.groups.find(g=>g.kind===k);
  const history=async v=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[v])).rows[0].n;
  const fnSource=async()=>(await pool.query("select prosrc from pg_proc where proname='app_search_records' and pronamespace='public'::regnamespace")).rows.map(r=>r.prosrc);

  // Synthetic feed rows. Words: 임금 everywhere; personal rows and raw text carry 비밀 too.
  await pool.query(`insert into public.app_suborganizations(id,workspace_id,name) values ($1,$2,'궤도지부')`,[ORG,WS_A]);
  await pool.query(`insert into public.app_feed_items(id,workspace_id,source,day,occurred_at,title,summary,points,counterpart,raw_text,organization_id) values
    ($1,$5,'call','2026-10-27','2026-10-27 10:00+09','임금 통화','성과급 기준 쟁점 논의','["인상률 근거 자료 보내기"]','김 위원장','원문 비밀 임금 궤도 010-0000-0000',$7),
    ($2,$5,'call','2026-10-26','2026-10-26 10:00+09','지운 통화','임금 지운 것','[]',null,null,null),
    ($3,$5,'call','2026-10-25','2026-10-25 10:00+09','AI 제목','요약 없음','["옛 핵심"]',null,null,null),
    ($4,$6,'call','2026-10-27','2026-10-27 10:00+09','남의 임금 통화','남의 임금','[]',null,null,null)`,[CALL,CALL_HIDDEN,CALL_EDITED,CALL_B,WS_A,WS_B,ORG]);
  await pool.query(`update public.app_feed_items set hidden_at=now() where id=$1`,[CALL_HIDDEN]);
  await pool.query(`insert into public.app_call_edits values ($1,$2,'{"title":"고친 임금 제목","points":["고친 핵심 교섭"]}')`,[CALL_EDITED,WS_A]);
  await pool.query(`insert into public.app_feed_items(id,workspace_id,source,day,occurred_at,room_key,room_label,title,summary,points,raw_text) values
    ($1,$3,'telegram','2026-10-28','2026-10-28 09:00+09','r1','궤도 단톡','교섭 소식','AI 요약 임금','["다음 교섭 11/1"]','A: 원문 비밀 임금 보낸이'),
    ($2,$3,'telegram','2026-10-20','2026-10-20 09:00+09','r1','궤도 단톡',null,'지운 날 임금','[]',null)`,[TG,TG_TRASHED_DAY,WS_A]);
  await pool.query(`insert into public.app_feed_summary_edits values ($1,$2,'{"summary":"고친 요약 임금 잠정"}')`,[WS_A,'item:'+TG]);
  await pool.query(`insert into public.app_feed_room_days(workspace_id,room_key,day,hidden_at) values ($1,'r1','2026-10-20',now())`,[WS_A]);
  await pool.query(`insert into public.app_call_personal(workspace_id,kind,day,title,summary,raw_text) values ($1,'personal','2026-10-27','개인 임금 통화','개인 비밀 임금','개인 비밀')`,[WS_A]);
  await pool.query(`insert into public.app_tg_personal_days(workspace_id,room_label,day,one_line) values ($1,'개인방 임금','2026-10-27','개인 비밀 임금')`,[WS_A]);
  await pool.query(`insert into public.app_notes(workspace_id,kind,raw_text,journal_day,ai_export_allowed) values($1,'diary','일기 임금 비밀','2026-10-02',false)`,[WS_A]);
  const before=(await pool.query(F.snapshot)).rows;
  const beforeSearch=await search({q:'궤도'});

  await t.test('files: 5 pair files, summary 3 lines, invoker search, no definer/anon/rtw; expanded workflow full flow; rollback is SQL Editor only and restores the earlier body',()=>{
   const lines=F.summary.trim().split('\n');assert.equal(lines.length,3);
   ['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   for(const sql of [F.migration,F.rollback]){
    const code=sql.replace(/--.*$/gm,'');
    assert.doesNotMatch(code,/security definer|\bto (anon|public|service_role)\b|disable row level|rtw_|create extension|update public/i);
    assert.match(code,/^begin;/);assert.match(code,/commit;\s*$/);
    assert.match(code,/security invoker\s+set search_path = ''/);
    assert.match(code,/revoke all on function public\.app_search_records\(text, text\[\], integer, integer, text\) from public, anon, service_role;/);
    assert.match(code,/grant execute on function public\.app_search_records\(text, text\[\], integer, integer, text\) to authenticated;/);
   }
   const code=F.migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/app_call_personal|app_tg_personal|f\.raw_text|'diary'/);
   assert.match(code,/grant insert \(workspace_id, question, lines, sources, ai_status\) on table public\.app_ask_answers to authenticated;/);
   assert.match(F.migration,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\nvalues \('20261029061500', 'ask_web2'/);
   for(const mode of ['apply','dry-run']){const p=plan(mode,'1');assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');}
   assert.throws(()=>plan('rollback','1'));
   assert.ok(F.rollback.includes(prevSource));
  });

  await t.test('precheck before apply: all 예',async()=>{
   for(const row of (await pool.query(F.precheck)).rows)if(!['search function source hash','recent migrations'].includes(row.item))assert.equal(row.value,'예',row.item);
  });

  await t.test('before apply call/telegram kinds are refused',async()=>{
   await assert.rejects(search({q:'임금',kinds:['call']}),{code:'22023',message:'SEARCH_BAD_KIND'});
  });

  await t.test('prerequisite guard stops when the earlier function changed or a feed table is missing',async()=>{
   for(const change of [
    `drop table public.app_call_edits`,
    `create or replace function public.app_search_records(p_query text, p_kinds text[], p_per_kind integer, p_offset integer, p_kind text) returns jsonb language sql stable security invoker set search_path = '' as $$ select '{}'::jsonb $$`,
    `delete from supabase_migrations.schema_migrations where version='20261023013000'`,
    `create table public.app_ask_answers(id uuid)`,
   ]){
    const c=await pool.connect();
    try{await c.query('begin');await c.query(change);
     await assert.rejects(c.query(F.migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/ASK_WEB2_PREREQUISITE_CHANGED/,change);}
    finally{await c.query('rollback');c.release();}
   }
   assert.equal(await history(FN),0);
  });

  await t.test('dry-run leaves nothing; apply passes postcheck; second apply refused',async()=>{
   const dry=await run(plan('dry-run','9711'));assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(F.snapshot)).rows,before);
   const apply=await run(plan('apply','9712'));assert.equal(apply.ok,true,apply.summary);
   for(const r of (await pool.query(F.postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal(await history(FN),1);
   assert.equal((await run(plan('apply','9713'))).ok,false);
   assert.equal(await history(FN),1);
  });

  await t.test('call/telegram: work calls only, user edits win, hidden call and trashed day excluded, summary field only on these kinds',async()=>{
   const r=await search({q:'임금',kinds:['call','telegram'],per:10});
   const calls=group(r,'call'),tgs=group(r,'telegram');
   assert.deepEqual(calls.items.map(i=>i.id),[CALL,CALL_EDITED]);
   assert.deepEqual([calls.items[0].title,calls.items[0].organization_id,calls.items[0].organization_name,calls.items[0].summary],
    ['임금 통화',ORG,'궤도지부','성과급 기준 쟁점 논의 인상률 근거 자료 보내기']);
   assert.deepEqual([calls.items[1].title,calls.items[1].summary],['고친 임금 제목','요약 없음 고친 핵심 교섭']);
   assert.deepEqual(tgs.items.map(i=>[i.id,i.title,i.summary,i.matched_in]),[[TG,'궤도 단톡 · 교섭 소식','고친 요약 임금 잠정 다음 교섭 11/1','body']]);
   // Counterpart and organization name are searchable; the snippet never comes from raw text.
   assert.equal(group(await search({q:'위원장',kind:'call'}),'call').total,1);
   assert.equal(group(await search({q:'궤도지부',kind:'call'}),'call').total,1);
   const all=JSON.stringify(await search({q:'임금',kinds:['call','telegram','note','update','work','document','meeting','project','organization','milestone'],per:20}));
   assert.doesNotMatch(all,/비밀|개인|010-|보낸이|지운|남의/);
   assert.doesNotMatch(all,new RegExp([CALL_HIDDEN,TG_TRASHED_DAY,CALL_B].join('|')));
   for(const q of ['비밀','개인','보낸이'])for(const k of ['call','telegram'])assert.equal(group(await search({q,kind:k}),k).total,0,q+k);
   // Other kinds keep the earlier item shape (no summary key).
   assert.equal(Object.hasOwn(group(await search({q:'궤도지부',kind:'organization'}),'organization').items[0]??{},'summary'),false);
  });

  await t.test('default (no kinds) stays the 8 kinds; earlier results unchanged; another workspace, anon and service_role refused',async()=>{
   const after=await search({q:'궤도'});
   assert.deepEqual(after.groups.map(g=>g.kind),['update','note','work','document','meeting','project','organization','milestone']);
   assert.deepEqual(after,beforeSearch);
   const s=await search({q:'임금',kinds:['call','telegram']},STRANGER);
   assert.deepEqual(group(s,'call').items.map(i=>i.id),[CALL_B]);assert.equal(group(s,'telegram').total,0);
   await assert.rejects(search({q:'임금',kind:'call'},'','anon'),{code:'42501'});
   await assert.rejects(as('service_role','',c=>c.query("select public.app_search_records('임금',null,null,null,'call')")),{code:'42501'});
   await assert.rejects(search({q:'임금',kinds:['diary']}),{code:'22023',message:'SEARCH_BAD_KIND'});
  });

  await t.test('answers table: owner inserts 5 columns (server time), reads and deletes own rows only; no update; anon refused',async()=>{
   const ins=(c,ws,q='임금 쟁점 뭐였지?')=>c.query(`insert into public.app_ask_answers(workspace_id,question,lines,sources,ai_status) values ($1,$2,'[{"text":"쟁점임.","refs":["s1"]}]','[{"ref":"s1","kind":"call","id":"x"}]','ok') returning id`,[ws,q]);
   const id=await as('authenticated',OWNER,async c=>(await ins(c,WS_A)).rows[0].id);
   await assert.rejects(as('authenticated',OWNER,c=>ins(c,WS_B)),{code:'42501'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query(`insert into public.app_ask_answers(workspace_id,question,ai_status,created_at) values ($1,'질문임','ok',now()-interval '40 days')`,[WS_A])),{code:'42501'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query(`update public.app_ask_answers set question='바꿈' where id=$1`,[id])),{code:'42501'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query(`insert into public.app_ask_answers(workspace_id,question,ai_status) values ($1,'질문임','other')`,[WS_A])),{code:'23514'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query(`insert into public.app_ask_answers(workspace_id,question,ai_status,lines) values ($1,'질문임','ok','{}')`,[WS_A])),{code:'23514'});
   assert.equal(await as('authenticated',STRANGER,async c=>(await c.query('select count(*)::int n from public.app_ask_answers')).rows[0].n),0);
   assert.equal(await as('authenticated',STRANGER,async c=>(await c.query('delete from public.app_ask_answers')).rowCount),0);
   await assert.rejects(as('anon','',c=>c.query('select * from public.app_ask_answers')),{code:'42501'});
   await assert.rejects(as('service_role','',c=>c.query('select * from public.app_ask_answers')),{code:'42501'});
   // 30-day cleanup: the owner deletes its own old rows (the server does this on each new answer).
   await pool.query(`update public.app_ask_answers set created_at=now()-interval '31 days' where id=$1`,[id]);
   assert.equal(await as('authenticated',OWNER,async c=>(await c.query(`delete from public.app_ask_answers where workspace_id=$1 and created_at < now()-interval '30 days'`,[WS_A])).rowCount),1);
  });

  await t.test('rollback (SQL Editor) restores the earlier function body exactly and drops the answers table',async()=>{
   await pool.query(F.rollback);
   assert.equal(await history(FN),0);
   assert.deepEqual(await fnSource(),[prevSource]);
   assert.deepEqual((await pool.query(F.snapshot)).rows,before);
   for(const r of (await pool.query(F.postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal((await pool.query("select to_regclass('public.app_ask_answers') t")).rows[0].t,null);
   assert.equal((await pool.query('select count(*)::int n from public.app_feed_items')).rows[0].n,6);
   await assert.rejects(pool.query(F.rollback),/ASK_WEB2_ROLLBACK_BLOCKED/);await pool.query('rollback');
   await pool.query(F.migration);
   assert.equal(await history(FN),1);
   assert.equal(group(await search({q:'임금',kind:'call'}),'call').total,2);
  });
 }finally{
  await closePool(pool);
  if(adminPool){await adminPool.query('drop database if exists '+database+' with (force)').catch(()=>{});await closePool(adminPool);}
  if(cluster)await cluster.stop().catch(()=>{});
 }
});
