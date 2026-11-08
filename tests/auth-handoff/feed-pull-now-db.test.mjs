// Fresh local PostgreSQL only. No Supabase, Edge or production credentials. All data synthetic.
// S52-46 FEED-최신화즉시수집 1/3(20261108040000_feed_pull_now): [최신화] 누른 횟수 표 app_feed_pulls와 세는 함수 app_feed_pull_take.
// - 승인형 DB workflow 확장 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예.
// - 화면(authenticated)·익명은 표·함수에 권한이 없고, 서버(service_role)만 함수를 부른다.
// - 하루 20번(두 출처 합계)·같은 출처 3분 간격·사람마다 따로·동시에 눌러도 한 번씩 센다.
// - 되돌리기는 표·함수·기록만 원래대로.
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
const version='20261108040000',name='feed_pull_now',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;
  insert into supabase_migrations.schema_migrations(version,name) values ('20261029090000','operator_features');
  -- Hosted default ACL 흉내: 새 함수에도 API 역할 실행권이 기본으로 붙는다(이 migration이 회수해야 함).
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`;
const FN='public.app_feed_pull_take(uuid,uuid,text)';

test('feed pull now: service-only counter table, 20 a day, 3 minutes apart, per person, guarded rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'feed-pull-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false,max:12}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,fn){const c=await pool.connect();try{await c.query('begin');await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const allYes=async sql=>{for(const r of await readOnly(sql))assert.equal(r.ok,'예',r.item);};
  const take=(user,ws,source)=>as('service_role',async c=>(await c.query('select public.app_feed_pull_take($1,$2,$3) v',[user,ws,source])).rows[0].v);
  // 3분 간격을 넘기려고 마지막 시각을 과거로 민다(시계는 건드리지 않음).
  const age=(user,mins)=>pool.query(`update public.app_feed_pulls set last_at=last_at-make_interval(mins=>$2) where user_id=$1`,[user,mins]);
  const before=(await pool.query(snapshot)).rows;

  await t.test('files: expanded rules pass, one new table and one function, summary 3 lines, no definer or API grants',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.flow,'full');assert.equal(plan.rules,'expanded');
    assert.deepEqual([...plan.createdTables],['app_feed_pulls']);
    assert.deepEqual([...plan.functions],['public.app_feed_pull_take']);
    assert.deepEqual(plan.review.definer,[]);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|disable row level security|create policy|rtw_|information_schema|\bto (anon|public|authenticated)\b/i);
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id in the migration');
   assert.doesNotMatch(snapshot+precheck+postcheck,/from public\./i,'checks read no app table');
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261108040000', 'feed_pull_now'/);
   assert.match(rollbackSQL,/SQL Editor\(폰 경로 C\) 전용/);
  });

  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(await readOnly(precheck));
   for(const item of ['new migration absent','operator features recorded','workspaces table','new table absent','new function absent'])assert.equal(v[item],'예',item);
   await allYes(postcheck);
   const dry=await run('dry-run','9991');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9992');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.equal((await run('apply','9993')).ok,false);
  });

  await t.test('access: anon and authenticated cannot read the table or run the function; service_role can',async()=>{
   for(const role of ['anon','authenticated']){
    await assert.rejects(as(role,c=>c.query('select * from public.app_feed_pulls')),{code:'42501'},role);
    await assert.rejects(as(role,c=>c.query('select public.app_feed_pull_take($1,$2,$3)',[OWNER,WS_A,'telegram'])),{code:'42501'},role);
    assert.equal((await pool.query('select has_function_privilege($1,$2,$3) x',[role,FN,'execute'])).rows[0].x,false);
   }
   assert.equal((await pool.query('select has_function_privilege($1,$2,$3) x',['service_role',FN,'execute'])).rows[0].x,true);
   await assert.rejects(take(OWNER,WS_A,'news'),/FEED_PULL_INVALID/);
   await assert.rejects(take(null,WS_A,'call'),/FEED_PULL_INVALID/);
   await assert.rejects(pool.query("insert into public.app_feed_pulls(user_id,workspace_id,day,source,n) values($1,$2,current_date,'sms',1)",[OWNER,WS_A]),{code:'23514'});
  });

  await t.test('3 minutes per source, 20 a day across both sources, per person',async()=>{
   const first=await take(OWNER,WS_A,'telegram');assert.deepEqual(first,{ok:true,left:19});
   const again=await take(OWNER,WS_A,'telegram');
   assert.equal(again.ok,false);assert.equal(again.reason,'cooldown');assert.ok(again.wait_s>=170&&again.wait_s<=180,String(again.wait_s));assert.equal(again.left,19);
   assert.deepEqual(await take(OWNER,WS_A,'call'),{ok:true,left:18},'other source is not on the 3-minute wait');
   assert.deepEqual(await take(STRANGER,WS_B,'telegram'),{ok:true,left:19},'another person counts separately');
   let left=18;
   for(let i=0;i<18;i++){await age(OWNER,4);const r=await take(OWNER,WS_A,i%2?'call':'telegram');left--;assert.deepEqual(r,{ok:true,left},'press '+(i+3));}
   await age(OWNER,4);
   assert.deepEqual(await take(OWNER,WS_A,'telegram'),{ok:false,reason:'daily',left:0},'21st press refused');
   assert.deepEqual(await take(OWNER,WS_A,'call'),{ok:false,reason:'daily',left:0});
   const rows=(await pool.query('select source,n from public.app_feed_pulls where user_id=$1 order by source',[OWNER])).rows;
   assert.deepEqual(rows,[{source:'call',n:10},{source:'telegram',n:10}]);
   // 지난 날 줄은 오늘 합계에 들지 않고, 31일 지나면 지워진다.
   await pool.query("update public.app_feed_pulls set day=day-40, last_at=last_at-interval '40 days' where user_id=$1",[OWNER]);
   assert.deepEqual(await take(OWNER,WS_A,'telegram'),{ok:true,left:19});
   assert.equal((await pool.query('select count(*)::int n from public.app_feed_pulls where user_id=$1',[OWNER])).rows[0].n,1);
  });

  await t.test('ten presses at once: one counted, nine on the 3-minute wait',async()=>{
   await pool.query('delete from public.app_feed_pulls where true');
   const all=await Promise.all(Array.from({length:10},()=>take(OWNER,WS_A,'call')));
   assert.equal(all.filter(r=>r.ok).length,1);
   assert.equal(all.filter(r=>r.reason==='cooldown').length,9);
   assert.equal((await pool.query("select n from public.app_feed_pulls where user_id=$1 and source='call'",[OWNER])).rows[0].n,1);
  });

  await t.test('rollback removes table, function and history; snapshot and postcheck match the start',async()=>{
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await allYes(postcheck);
   await assert.rejects(pool.query(rollbackSQL),/FEED_PULL_NOW_ROLLBACK_BLOCKED/);await pool.query('rollback').catch(()=>{});
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
