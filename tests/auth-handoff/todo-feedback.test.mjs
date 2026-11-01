// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// TODO-이미함·환류 DB(20261101180000_todo_feedback): 후보 상태 done + 결과 기록 표 + 규칙 표(소유자만).
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
const version='20261101180000',name='todo_feedback',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const SRC='26000000-0000-4000-8000-000000000001';

test('todo feedback db: plan, dry-run, apply, done status, owner boundary, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'todo-feedback-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query('revoke usage on schema private from service_role');
  await pool.query(await read('supabase/migrations/20261021075034_todo_radar_candidates.sql'));
  await pool.query(await read('supabase/migrations/20261027060000_todo_candidates_task_due.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  const addCandidate=(ws,summary)=>pool.query("insert into public.app_todo_candidates(workspace_id,kind,summary,source_kind,source_id,source_day,dedupe_key) values ($1,'request',$2,'note',$3,'2026-11-01',$2) returning id",[ws,summary,SRC]).then(r=>r.rows[0].id);
  const candA=await addCandidate(WS_A,'가상 자료 회신'),candB=await addCandidate(WS_B,'가상 남의 작업공간 일');
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules, no functions, grants as designed, summary 3 lines',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');
   assert.deepEqual([...plan.functions],[]);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0].replace(/\s+/g,' '));
   assert.deepEqual(grants,[
    'grant select, delete on table public.app_todo_feedback to authenticated;',
    'grant insert (workspace_id, candidate_id, outcome, kind, source_kind, summary, edited) on table public.app_todo_feedback to authenticated;',
    'grant select, delete on table public.app_todo_rules to authenticated;',
    'grant insert (workspace_id, text, state) on table public.app_todo_rules to authenticated;',
    'grant update (text, state, decided_at) on table public.app_todo_rules to authenticated;']);
   assert.doesNotMatch(code,/create (or replace )?function|create trigger|app_todo_not_mine|app_todo_ask_filter|rtw_|\bto (anon|public)\b/i);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/delete from public|truncate|cascade|grant |app_todo_not_mine/i);
  });
  await t.test('precheck yes, dry-run changes nothing, apply passes postcheck, second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9982');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9983')).ok,false);
  });
  await t.test('owner marks a candidate done (no task id/due) and back; done with task id refused',async()=>{
   const done=await owner(c=>c.query("update public.app_todo_candidates set status='done',decided_at=now() where id=$1 and status='open' returning status",[candA]));
   assert.equal(done.rows[0].status,'done');
   await assert.rejects(owner(c=>c.query("update public.app_todo_candidates set status='done',decided_at=null where id=$1",[candA])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("update public.app_todo_candidates set task_id='t1' where id=$1",[candA])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("update public.app_todo_candidates set task_due='2026-11-02' where id=$1",[candA])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("update public.app_todo_candidates set status='finished' where id=$1",[candA])),{code:'23514'});
   assert.equal((await stranger(c=>c.query("update public.app_todo_candidates set status='open',decided_at=null where id=$1",[candA]))).rowCount,0);
   await owner(c=>c.query("update public.app_todo_candidates set status='open',decided_at=null where id=$1 and status='done'",[candA]));
  });
  await t.test('feedback: owner logs one outcome per candidate, no update, undo by delete; boundaries',async()=>{
   const row=await owner(c=>c.query("insert into public.app_todo_feedback(workspace_id,candidate_id,outcome,kind,source_kind,summary) values ($1,$2,'done','request','note','가상 자료 회신') returning id",[WS_A,candA]));
   assert.ok(row.rows[0].id);
   await assert.rejects(owner(c=>c.query("insert into public.app_todo_feedback(workspace_id,candidate_id,outcome,kind,source_kind,summary) values ($1,$2,'dismissed','request','note','가상')",[WS_A,candA])),{code:'23505'});
   await owner(c=>c.query("insert into public.app_todo_feedback(workspace_id,outcome,kind,source_kind,summary,edited) values ($1,'tasked','my_task','telegram','가상 제안','가상 고친 할 일')",[WS_A]));
   await assert.rejects(owner(c=>c.query("insert into public.app_todo_feedback(workspace_id,outcome,kind,source_kind,summary,edited) values ($1,'done','request','note','가상','고친')",[WS_A])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("insert into public.app_todo_feedback(workspace_id,outcome,kind,source_kind,summary) values ($1,'maybe','request','note','가상')",[WS_A])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("insert into public.app_todo_feedback(workspace_id,outcome,kind,source_kind,summary) values ($1,'done','request','note',$2)",[WS_A,'가'.repeat(101)])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("insert into public.app_todo_feedback(workspace_id,outcome,kind,source_kind,summary) values ($1,'done','request','note',$2)",[WS_A,'줄\n바꿈'])),{code:'23514'});
   // 다른 작업공간 후보·다른 작업공간 줄은 넣지 못한다.
   await assert.rejects(owner(c=>c.query("insert into public.app_todo_feedback(workspace_id,candidate_id,outcome,kind,source_kind,summary) values ($1,$2,'done','request','note','가상')",[WS_A,candB])),/row-level security/);
   await assert.rejects(owner(c=>c.query("insert into public.app_todo_feedback(workspace_id,outcome,kind,source_kind,summary) values ($1,'done','request','note','가상')",[WS_B])),/row-level security/);
   await assert.rejects(owner(c=>c.query("insert into public.app_todo_feedback(workspace_id,outcome,kind,source_kind,summary,created_at) values ($1,'done','request','note','가상',now())",[WS_A])),/permission denied/);
   await assert.rejects(owner(c=>c.query("update public.app_todo_feedback set outcome='tasked'")),/permission denied/);
   assert.equal((await owner(c=>c.query('select 1 from public.app_todo_feedback'))).rows.length,2);
   assert.deepEqual((await stranger(c=>c.query('select 1 from public.app_todo_feedback'))).rows,[]);
   assert.equal((await stranger(c=>c.query('delete from public.app_todo_feedback'))).rowCount,0);
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_todo_feedback')),/permission denied/);
   await assert.rejects(server(c=>c.query('select 1 from public.app_todo_feedback')),/permission denied/);
   assert.equal((await owner(c=>c.query('delete from public.app_todo_feedback where id=$1',[row.rows[0].id]))).rowCount,1);
   // 후보가 정리돼도 기록은 남고 후보 칸만 빈다.
   await owner(c=>c.query("insert into public.app_todo_feedback(workspace_id,candidate_id,outcome,kind,source_kind,summary) values ($1,$2,'dismissed','request','note','가상 자료 회신')",[WS_A,candA]));
   await pool.query('delete from public.app_todo_candidates where id=$1',[candA]);
   const left=(await owner(c=>c.query("select candidate_id from public.app_todo_feedback where outcome='dismissed'"))).rows;
   assert.deepEqual(left,[{candidate_id:null}]);
  });
  await t.test('rules: owner adds candidate, confirms, retires; stranger, anon and server blocked',async()=>{
   const r=await owner(c=>c.query("insert into public.app_todo_rules(workspace_id,text) values ($1,'가상 공지성 안내는 올리지 않음.') returning id,state",[WS_A]));
   assert.equal(r.rows[0].state,'candidate');
   const id=r.rows[0].id;
   assert.equal((await owner(c=>c.query("update public.app_todo_rules set state='confirmed',decided_at=now(),text='가상 공지는 올리지 않음.' where id=$1",[id]))).rowCount,1);
   await assert.rejects(owner(c=>c.query("update public.app_todo_rules set state='maybe' where id=$1",[id])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("update public.app_todo_rules set workspace_id=$2 where id=$1",[id,WS_B])),/permission denied/);
   await assert.rejects(owner(c=>c.query("insert into public.app_todo_rules(workspace_id,text) values ($1,'가상')",[WS_B])),/row-level security/);
   await assert.rejects(owner(c=>c.query("insert into public.app_todo_rules(workspace_id,text) values ($1,$2)",[WS_A,'가'.repeat(121)])),{code:'23514'});
   assert.equal((await stranger(c=>c.query("update public.app_todo_rules set state='retired'"))).rowCount,0);
   assert.deepEqual((await stranger(c=>c.query('select 1 from public.app_todo_rules'))).rows,[]);
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_todo_rules')),/permission denied/);
   await assert.rejects(server(c=>c.query('select 1 from public.app_todo_rules')),/permission denied/);
   assert.equal((await owner(c=>c.query("update public.app_todo_rules set state='retired',decided_at=now() where id=$1",[id]))).rowCount,1);
  });
  await t.test('rollback: done candidates become dismissed, new tables and record gone, re-apply works',async()=>{
   const c2=await addCandidate(WS_A,'가상 이미 한 일');
   await owner(c=>c.query("update public.app_todo_candidates set status='done',decided_at=now() where id=$1",[c2]));
   const count=(await pool.query('select count(*)::int n from public.app_todo_candidates')).rows[0].n;
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await pool.query('select count(*)::int n from public.app_todo_candidates')).rows[0].n,count);
   assert.equal((await pool.query('select status from public.app_todo_candidates where id=$1',[c2])).rows[0].status,'dismissed');
   await pool.query(migration);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
