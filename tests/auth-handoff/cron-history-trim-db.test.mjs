// Fresh local PostgreSQL only. No Supabase, pg_cron or production credentials. All data synthetic.
// S69-80 OPS-DB용량(20261124220000, SQL Editor 전용): 예약 'web2_cron_history_trim' 1개 + 기록 1행.
// 시험 PostgreSQL에는 pg_cron이 없다 → 같은 이름·같은 모양의 가짜 cron 스키마(job·job_run_details·schedule·unschedule)를 만들어
// 사전 확인 → 적용 → 사후 확인 → 예약 명령 실제 실행(3일 지난 끝난 줄만 지움) → 같은 이름이 있으면 멈춤 → rollback(두 번) 을 돌린다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import pg from 'pg';
import {trackPool,closePool} from './pg-close.mjs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
const version='20261124220000',name='cron_history_trim',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const setup=`
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text);
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
  select cron.schedule('web2_feed_tick','* * * * *','select 1');
  select cron.schedule('web2_feed_news','22 4,9,23 * * *','select 2');`;

test('cron history trim: SQL Editor only, one job, deletes only finished rows older than 3 days, stops on same name, rollback',{timeout:120000},async t=>{
 let cluster,pool,port,password;
 const {default:EmbeddedPostgres}=await import('embedded-postgres');
 const directory=await mkdtemp(join(tmpdir(),'cron-trim-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));port=sock.address().port;await new Promise(r=>sock.close(r));
 password=randomBytes(24).toString('hex');
 cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 await cluster.initialise();await cluster.start();
 try{
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false,options:'-c cron.timezone=GMT'}));
  await pool.query(setup);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const items=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const run=async sql=>{const c=await pool.connect();try{return await c.query(sql);}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const snap=async()=>(await pool.query(snapshot)).rows.map(r=>[r.kind,r.name,r.definition].join(' | ')).join('\n');

  await t.test('files: SQL Editor only, one begin/commit, one history row, nothing widened, summary 3 lines',()=>{
   // S70-01(2026-11-25 명진 결정): 승인형 DB workflow가 cron 예약 등록을 좁은 조건으로 받는다 → apply·dry-run 계획 통과(승인 한 번 흐름).
   // rollback 모드는 엄격 규칙만이라 여전히 거절(되돌리기는 SQL Editor).
   for(const mode of ['apply','dry-run'])assert.equal(prepareMigration({mode,version,runId:'1',root}).flow,'full',mode);
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}),undefined,'rollback');
   assert.match(migration,/SQL Editor\(폰 경로 C\) 전용/);
   const body=migration.replace(/^--.*\n/gm,'').trim();
   assert.match(body,/^begin;/);assert.match(body,/commit;$/);
   assert.equal((migration.match(/^begin;$/gm)||[]).length,1);assert.equal((migration.match(/^commit;$/gm)||[]).length,1);
   assert.equal((migration.match(/insert into supabase_migrations\.schema_migrations/g)||[]).length,1);
   assert.match(rollbackSQL.trim(),/^begin;[\s\S]*commit;$/);
   const code=[migration,precheck,postcheck,snapshot,rollbackSQL].join('\n').replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|\bgrant\b|\brevoke\b|\bto (anon|public|authenticated)\b|disable row level security|create policy|rtw_|extension|vault|https?:\/\//i);
   assert.equal((code.match(/select cron\.schedule\(/g)||[]).length,1,'only one schedule call');
   for(const sql of [precheck,postcheck,snapshot])assert.doesNotMatch(sql.replace(/--.*$/gm,'').replace(/\$cmd\$[\s\S]*?\$cmd\$/g,''),/\b(insert|update|delete from|create|drop|alter|begin|commit|perform)\b/i);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
  });

  let pre,before;
  await t.test('precheck all yes and snapshot before',async()=>{
   pre=items((await pool.query(precheck)).rows);
   for(const k of ['pg_cron ready','cron timezone UTC','trim job absent','new migration absent'])assert.equal(pre[k],'예',k);
   assert.equal(pre['cron jobs'],'2');assert.equal(pre['retention daily job present'],'아니오');
   before=await snap();
  });

  await t.test('apply: one job at 18:43 UTC, other jobs unchanged, history recorded; postcheck yes',async()=>{
   await run(migration);
   const post=items((await pool.query(postcheck)).rows);
   for(const k of ['trim job 1','trim job schedule 18:43 UTC active','trim job command','migration recorded'])assert.equal(post[k],'예',k);
   assert.equal(post['other cron jobs hash'],pre['other cron jobs hash']);
   assert.equal((await pool.query('select count(*)::int n from cron.job')).rows[0].n,3);
  });

  await t.test('job command deletes only finished rows older than 3 days',async()=>{
   await pool.query(`insert into cron.job_run_details(jobid,status,start_time,end_time) values
     (1,'succeeded',now()-interval '10 days',now()-interval '10 days'),
     (1,'failed',now()-interval '4 days',now()-interval '4 days'),
     (1,'succeeded',now()-interval '2 days',now()-interval '2 days'),
     (1,'running',now()-interval '9 days',null),
     (1,'succeeded',now(),now())`);
   const cmd=(await pool.query(`select command from cron.job where jobname='web2_cron_history_trim'`)).rows[0].command;
   await pool.query(cmd);
   const left=(await pool.query(`select status, end_time is null as open from cron.job_run_details order by start_time`)).rows;
   assert.equal(left.length,3);
   assert.ok(left.some(r=>r.open),'unfinished row kept');
   assert.equal((await pool.query(`select count(*)::int n from cron.job_run_details where end_time < now()-interval '3 days'`)).rows[0].n,0);
  });

  await t.test('second apply stops (already recorded); same-name job stops even without history',async()=>{
   await assert.rejects(run(migration),/CRON_HISTORY_TRIM_PREREQUISITE_CHANGED/);
   await pool.query(`delete from supabase_migrations.schema_migrations where version='${version}'`);
   await pool.query(`update cron.job set schedule='0 0 * * *' where jobname='web2_cron_history_trim'`);
   await assert.rejects(run(migration),/CRON_HISTORY_TRIM_PREREQUISITE_CHANGED/);
   assert.equal((await pool.query(`select schedule from cron.job where jobname='web2_cron_history_trim'`)).rows[0].schedule,'0 0 * * *','existing job not changed');
   assert.equal((await pool.query(`select count(*)::int n from supabase_migrations.schema_migrations where version='${version}'`)).rows[0].n,0);
   await pool.query(`update cron.job set schedule='43 18 * * *' where jobname='web2_cron_history_trim'`);
   await pool.query(`insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array['x'])`);
  });

  await t.test('rollback removes only this job and history row, twice ok; snapshot back to before',async()=>{
   await run(rollbackSQL);
   await run(rollbackSQL);
   assert.equal(await snap(),before);
   const again=items((await pool.query(precheck)).rows);
   assert.equal(again['other cron jobs hash'],pre['other cron jobs hash']);
   assert.equal(again['trim job absent'],'예');assert.equal(again['new migration absent'],'예');
  });
 }finally{
  await closePool(pool);
  if(cluster)await cluster.stop().catch(()=>{});
 }
});
