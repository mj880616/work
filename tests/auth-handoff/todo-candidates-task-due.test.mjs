// Fresh local PostgreSQL only. No Supabase, OpenAI or production credentials. All data synthetic (no real names).
// JOURNAL-챙길것화면 후속: 20261027060000_todo_candidates_task_due — 후보 표에 task_due 칸. 앞 단계(20261021075034 todo_radar_candidates)를 진짜 파일로 먼저 적용한다.
// 칸 권한(update만)·검사 제약(tasked일 때만)·화면이 보내는 PATCH 문장·owner 밖 차단·값이 있으면 rollback 거절.
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
import {checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
const version='20261027060000',name='todo_candidates_task_due',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const SRC='28000000-0000-4000-8000-000000000001';

test('후보 task_due: prechecks, apply, column grant (update only), tasked-only constraint, PATCH statements, owner only, guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'todo-task-due-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex');
 const cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 await cluster.initialise();await cluster.start();
 let pool;
 try{
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(await read('supabase/migrations/20261021075034_todo_radar_candidates.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const add=(key,over={})=>owner(c=>c.query(`insert into public.app_todo_candidates(workspace_id,kind,summary,due,source_kind,source_id,source_day,evidence,dedupe_key)
    values($1,'request',$2,$3,'basket',$4,'2026-10-27','근거',$5) returning id`,[WS_A,'요약 '+key,over.due??null,SRC,'k:'+key])).then(r=>r.rows[0].id);

  await t.test('files: read-only checks, three-line summary, only a column grant to authenticated (SQL Editor only)',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'');
   assert.match(code,/^begin;\n/);assert.match(code,/\ncommit;\n$/);
   assert.doesNotMatch(code,/security definer|create function|create policy|drop policy|disable row level|to anon|to public|to service_role|update public|delete from public|raw_text|transcript/i);
   assert.deepEqual([...code.matchAll(/^grant .*$/gm)].map(m=>m[0]),['grant update (task_due) on table public.app_todo_candidates to authenticated;']);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261027060000', 'todo_candidates_task_due'/);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/delete from public|update public|truncate|cascade|grant |policy/i);
  });
  const oldId=await add('old'); // a candidate that exists before the column
  await owner(c=>c.query("update public.app_todo_candidates set status='tasked',task_id='g-old',decided_at=now() where id=$1",[oldId]));
  const before=(await pool.query(snapshot)).rows;
  await t.test('precheck before apply is all 예',async()=>{
   for(const r of (await pool.query(precheck)).rows.filter(r=>r.item!=='recent migrations'))assert.equal(r.value,'예',r.item);
   assert.ok(!before.some(r=>r.kind==='column'&&r.name==='task_due'));
  });
  await t.test('prerequisite guard stops when the previous step is missing',async()=>{
   const c=await pool.connect();
   try{await c.query('begin');await c.query("delete from supabase_migrations.schema_migrations where version='20261021075034'");
    await assert.rejects(c.query(migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/TODO_TASK_DUE_PREREQUISITE_CHANGED/);}
   finally{await c.query('rollback');c.release();}
   assert.equal(await history(),0);
  });
  await t.test('apply succeeds once, postcheck all 예, second apply refused, old rows stay null',async()=>{
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal(await history(),1);
   await assert.rejects(pool.query(migration),/TODO_TASK_DUE_PREREQUISITE_CHANGED/);await pool.query('rollback');
   assert.equal((await pool.query('select task_due from public.app_todo_candidates where id=$1',[oldId])).rows[0].task_due,null);
  });
  await t.test('the screen PATCH: tasked with task_due in one statement; no-due stays null; open or dismissed cannot hold a date',async()=>{
   const a=await add('a'),b=await add('b'),c2=await add('c');
   const r=await owner(c=>c.query("update public.app_todo_candidates set status='tasked',task_id='g-1',decided_at=now(),task_due='2026-10-30' where id=$1 and workspace_id=$2 and status='open' returning status,task_due::text",[a,WS_A]));
   assert.equal(r.rowCount,1);assert.equal(r.rows[0].task_due,'2026-10-30');
   const n=await owner(c=>c.query("update public.app_todo_candidates set status='tasked',task_id='g-2',decided_at=now(),task_due=null where id=$1 and status='open' returning task_due",[b]));
   assert.equal(n.rows[0].task_due,null);
   await assert.rejects(owner(c=>c.query("update public.app_todo_candidates set task_due='2026-10-30' where id=$1",[c2])),{code:'23514'},'open candidate');
   await assert.rejects(owner(c=>c.query("update public.app_todo_candidates set status='dismissed',decided_at=now(),task_due='2026-10-30' where id=$1",[c2])),{code:'23514'},'dismissed candidate');
   await assert.rejects(owner(c=>c.query("update public.app_todo_candidates set status='tasked',task_id='g-3',decided_at=now(),task_due='abc' where id=$1",[c2])),{code:'22007'},'not a date');
   assert.equal((await owner(c=>c.query("select count(*)::int n from public.app_todo_candidates where task_due is not null"))).rows[0].n,1);
   const back=(await owner(c=>c.query("select id,status,task_id,task_due::text d,decided_at from public.app_todo_candidates where id=$1",[a]))).rows[0];
   assert.equal(back.d,'2026-10-30');
  });
  await t.test('insert cannot set task_due; other protected columns stay protected',async()=>{
   await assert.rejects(owner(c=>c.query("insert into public.app_todo_candidates(workspace_id,kind,summary,source_kind,source_id,source_day,dedupe_key,task_due) values($1,'request','x','basket',$2,'2026-10-27','z1','2026-10-30')",[WS_A,SRC])),{code:'42501'});
   for(const col of ["summary='바꿈'","due='2026-11-01'","workspace_id='"+WS_A+"'"])
    await assert.rejects(owner(c=>c.query('update public.app_todo_candidates set '+col)),{code:'42501'},col);
  });
  await t.test('stranger, anon, no-login and service_role cannot read or change task_due',async()=>{
   assert.deepEqual((await stranger(c=>c.query('select task_due from public.app_todo_candidates'))).rows,[]);
   assert.equal((await stranger(c=>c.query("update public.app_todo_candidates set status='tasked',task_id='x',decided_at=now(),task_due='2026-10-30'"))).rowCount,0);
   assert.deepEqual((await as('authenticated',null,c=>c.query('select task_due from public.app_todo_candidates'))).rows,[]);
   for(const role of ['anon','service_role'])for(const sql of ['select task_due from public.app_todo_candidates',"update public.app_todo_candidates set task_due='2026-10-30'"])
    await assert.rejects(as(role,null,c=>c.query(sql)),{code:'42501'},role+' '+sql);
  });
  await t.test('rollback stops while a task_due value exists; after it is cleared it restores the snapshot; re-apply works',async()=>{
   await assert.rejects(pool.query(rollbackSQL),/TODO_TASK_DUE_ROLLBACK_BLOCKED: task_due values exist/);await pool.query('rollback');
   assert.equal(await history(),1);
   await pool.query("update public.app_todo_candidates set task_due=null");
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   await pool.query(migration);assert.equal(await history(),1);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
