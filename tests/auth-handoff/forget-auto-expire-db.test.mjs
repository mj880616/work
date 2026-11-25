// Fresh local PostgreSQL only. No Supabase, Edge, OpenAI or production credentials. All data synthetic.
// S70-20b FORGET-기본이미함(20261125160000_forget_auto_expire): 하루 지나도 손대지 않은 업무 제안을 서버 예약이 '이미 함(지남)'으로.
// 시험 PostgreSQL에는 pg_cron이 없다 → 같은 이름·같은 모양의 가짜 cron 스키마(cron-history-trim-db.test.mjs와 같음).
// - 승인형 DB workflow 확장 규칙(cron 예약 등록 포함) 통과, dry-run은 아무것도 안 바꿈, apply 뒤 사후 확인 모두 예·예약 1개, 두 번째 apply 거절.
// - 옮기기: 처리 전·마감 없음·직접 부름 아님·저절로 옮긴 적 없음·서울 어제 0시 전에 들어온 줄만 done/expired(다른 작업공간도 같은 규칙).
// - [되돌리기](owner 기존 길) 뒤에는 다시 옮기지 않는다. 함수는 누구도 직접 부를 수 없고(예약만), 넣기 새 판은 service_role만.
// - rollback: 예약·함수·칸·기록 걷어 냄, 옮긴 줄은 done 그대로(까닭만 비움), snapshot 같음, 다시 적용 가능.
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
const version='20261125160000',name='forget_auto_expire',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;`;
const CHAIN=['20261021075034_todo_radar_candidates','20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261025200000_call_personal_box',
 '20261025210000_feed_item_archive','20261026120000_call_user_edit','20261026190000_tg_sender_names','20261027010000_tg_room_day_group',
 '20261027030000_tg_sender_names_read','20261027060000_todo_candidates_task_due','20261027200000_tg_summary_edit','20261028030000_tg_room_day_context'];
const AFTER=['20261029120000_todo_candidates_telegram','20261029210000_todo_mine_only','20261101180000_todo_feedback','20261102030000_todo_feature_guard','20261125120000_todo_tg_auto_done'];
const cronSetup=`
  create schema cron;
  create table cron.job(jobid bigserial primary key, schedule text not null, command text not null, nodename text default 'localhost', nodeport int default 5432,
    database text default current_database(), username text default current_user, active boolean default true, jobname text unique);
  create table cron.job_run_details(jobid bigint, runid bigserial primary key, job_pid int, database text, username text, command text,
    status text, return_message text, start_time timestamptz, end_time timestamptz);
  create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as
    $f$ insert into cron.job(jobname,schedule,command) values(job_name,schedule,command)
        on conflict (jobname) do update set schedule=excluded.schedule, command=excluded.command returning jobid $f$;
  create function cron.unschedule(job_name text) returns boolean language plpgsql as
    $f$ begin delete from cron.job where jobname=job_name; if not found then raise exception 'could not find valid entry for job %', job_name; end if; return true; end $f$;
  select cron.schedule('web2_feed_tick','* * * * *','select 1');`;

test('forget auto expire: plan, dry-run, apply, cron job, expires only old plain open rows, stars stay, undo sticks, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'forget-expire-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false,options:'-c cron.timezone=GMT'}));
  await pool.query(cronSetup);
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query('revoke usage on schema private from service_role');
  await pool.query('grant select on public.app_spaces to authenticated');
  await pool.query('alter table public.app_spaces enable row level security');
  await pool.query('create policy fake_owner_read on public.app_spaces for select to authenticated using (private.app_is_workspace_owner(workspace_id))');
  for(const f of CHAIN)await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-24','2026-10-24T03:00:00Z','가상 통화','가상 요약','call:uc1')",[WS_A]);
  await pool.query(await read('supabase/migrations/20261029090000_operator_features.sql'));
  for(const f of AFTER)await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const ops=(await pool.query("select workspace_id::text w, feature from public.app_operator_features order by 1,2")).rows;
  if(!ops.some(r=>r.w===WS_A&&r.feature==='telegram'))await pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'telegram')",[WS_A]);

  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),server=fn=>as('service_role','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const before=(await pool.query(snapshot)).rows;
  const beforeCheck=await readOnly(precheck);
  const feed=(id,ws,ref)=>pool.query("insert into public.app_feed_items(id,workspace_id,source,day,occurred_at,room_key,room_label,title,summary,raw_count,points,raw_text,source_ref) values($1,$2,'telegram','2026-11-25',now(),'-100','가상 방','가상','가상 요약',1,'[]','가상 원문',$3)",[id,ws,ref]);
  const F=n=>`32000000-0000-4000-8000-00000000000${n}`;
  // 서울 어제 0시 기준: 3일 전 = 옮김, 지금 = 그대로.
  const cand=(ws,key,o={})=>pool.query(`insert into public.app_todo_candidates(workspace_id,kind,summary,due,source_kind,source_id,source_day,dedupe_key,status,task_id,decided_at,created_at)
    values($1,'my_task','가상 제안',$3,$4,gen_random_uuid(),'2026-11-20',$2,$5,$6,$7,now()-($8||' hours')::interval)`,[ws,key,o.due||null,o.kind||'basket',o.status||'open',o.status==='tasked'?'task-1':null,o.status&&o.status!=='open'?new Date().toISOString():null,String(o.hours??72)]);
  const add="select public.app_todo_candidate_from_telegram_ask($1,$2,'가상 자료 보내기','가상 근거',null,now()-interval '3 days',$3,null,$4)->>'result' r";
  const state=async()=>Object.fromEntries((await pool.query("select dedupe_key k,status||':'||coalesce(auto_done,'-')||':'||coalesce((decided_at=auto_done_at)::text,'-') v from public.app_todo_candidates")).rows.map(r=>[r.k,r.v]));

  await t.test('files: expanded rules with cron; two definer functions; one grant to service_role; summary 3 lines',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual([...plan.functions].sort(),['public.app_forget_auto_expire','public.app_todo_candidate_from_telegram_ask']);
    assert.deepEqual(plan.review.cron,['web2_forget_auto_expire']);
    assert.deepEqual(plan.createdTables,[]);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);
   ['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0]);
   assert.equal(grants.length,1);assert.match(grants[0],/^grant execute on function public\.app_todo_candidate_from_telegram_ask\([^)]*\) to service_role;$/);
   assert.doesNotMatch(code,/create table|create policy|alter policy|drop policy|create trigger|create or replace|rtw_|family_notes|journal_memorable|\bto (anon|public|authenticated)\b/i);
  });
  await t.test('precheck, dry-run changes nothing, apply passes postcheck with one cron job, second apply refused',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.equal((await run('dry-run','9981')).ok,true);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9982');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck));
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else if(v[item]!==undefined)assert.equal(value,v[item],item);
   }
   assert.deepEqual((await pool.query("select schedule,command,active from cron.job where jobname='web2_forget_auto_expire'")).rows,[{schedule:'13 15 * * *',command:'select public.app_forget_auto_expire()',active:true}]);
   assert.equal((await run('apply','9983')).ok,false);
  });
  await t.test('direct insert: p_direct stored; roles denied; owner cannot write ask_direct',async()=>{
   await feed(F(1),WS_A,'tg:fake:1');await feed(F(2),WS_A,'tg:fake:2');
   assert.equal((await server(c=>c.query(add,[WS_A,'tg:fake:1','1001',true]))).rows[0].r,'added');
   assert.equal((await server(c=>c.query(add,[WS_A,'tg:fake:2','1002',false]))).rows[0].r,'added');
   await assert.rejects(server(c=>c.query(add,[WS_A,'tg:fake:2','1002',null])),/TODO_TG_ARGS/);
   await pool.query("update public.app_todo_candidates set created_at=now()-interval '3 days' where source_kind='telegram'");
   for(const fn of ["select public.app_forget_auto_expire()","select public.app_todo_candidate_from_telegram_ask($1,'tg:fake:1','x','',null,now(),'1',null,true)"]){
    await assert.rejects(owner(c=>c.query(fn,fn.includes('$1')?[WS_A]:[])),/permission denied/);
    await assert.rejects(as('anon','',c=>c.query(fn,fn.includes('$1')?[WS_A]:[])),/permission denied/);
   }
   await assert.rejects(server(c=>c.query("select public.app_forget_auto_expire()")),/permission denied/,'service_role도 직접 부르지 못함(예약만)');
   await assert.rejects(owner(c=>c.query("update public.app_todo_candidates set ask_direct=false")),/permission denied/);
  });
  await t.test('expire: only open, no due, not direct, not auto-moved, before yesterday 00:00 Seoul; other workspaces too; family untouched',async()=>{
   await cand(WS_A,'old');                                  // 3일 전 → 지남
   await cand(WS_A,'old-note',{kind:'note',hours:50});      // 50시간 전 → 서울 어제 0시보다 앞(최대 48시간+) → 지남
   await cand(WS_A,'fresh',{hours:0});                      // 지금 → 그대로
   await cand(WS_A,'due',{due:'2026-12-01'});               // ★ 마감 → 그대로
   await cand(WS_A,'tasked',{status:'tasked'});             // 처리한 줄 → 그대로
   await cand(WS_B,'other-ws');                             // 다른 작업공간의 AI 제안도 같은 규칙 → 지남
   const n=(await pool.query("select public.app_forget_auto_expire()->>'expired' n")).rows[0].n;
   const s=await state();
   assert.equal(s.old,'done:expired:true');assert.equal(s['old-note'],'done:expired:true');assert.equal(s['other-ws'],'done:expired:true');
   assert.equal(s.fresh,'open:-:-');assert.equal(s.due,'open:-:-');assert.equal(s.tasked,'tasked:-:-');
   const tg=Object.fromEntries((await pool.query("select ask_ref k,status||':'||coalesce(auto_done,'-') v from public.app_todo_candidates where source_kind='telegram'")).rows.map(r=>[r.k,r.v]));
   assert.deepEqual(tg,{'1001':'open:-','1002':'done:expired'},'직접 부름(★)은 그대로, 아닌 텔레그램 요청은 지남');
   assert.equal(n,'4');
   // 경계: 서울 어제 0시 바로 뒤에 들어온 줄은 그대로.
   await pool.query(`insert into public.app_todo_candidates(workspace_id,kind,summary,source_kind,source_id,source_day,dedupe_key,created_at)
     values($1,'my_task','가상','basket',gen_random_uuid(),'2026-11-20','edge',(((timezone('Asia/Seoul',now()))::date-1)::timestamp at time zone 'Asia/Seoul')+interval '1 minute')`,[WS_A]);
   assert.equal((await pool.query("select public.app_forget_auto_expire()->>'expired' n")).rows[0].n,'0');
   assert.equal((await state()).edge,'open:-:-');
   // [되돌리기](owner 기존 길) 뒤에는 다시 옮기지 않는다.
   assert.equal((await owner(c=>c.query("update public.app_todo_candidates set status='open',decided_at=null where dedupe_key='old' and status='done'"))).rowCount,1);
   assert.equal((await pool.query("select public.app_forget_auto_expire()->>'expired' n")).rows[0].n,'0');
   assert.equal((await state()).old,'open:expired:-');
   // 예약 명령 그대로 실행해도 같은 함수(옮길 줄 없음).
   const cmd=(await pool.query("select command from cron.job where jobname='web2_forget_auto_expire'")).rows[0].command;
   assert.equal((await pool.query(cmd)).rows[0].app_forget_auto_expire.expired,0);
  });
  await t.test('rollback: job, functions, column and record gone; expired rows stay done without reason; snapshot same; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.equal((await pool.query("select count(*)::int n from cron.job where jobname='web2_forget_auto_expire'")).rows[0].n,0);
   assert.equal((await pool.query("select to_regprocedure('public.app_forget_auto_expire()') f")).rows[0].f,null);
   const s=await state();assert.equal(s['other-ws'],'done:-:-');assert.equal(s.old,'open:-:-');
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
