// Fresh local PostgreSQL only. No Supabase, OpenAI or production credentials. All data synthetic.
// S55-07 HOME-하루채우기 PR-B DB(20261109180000_home_day_picks): 홈 [하루] 읽을 글·기록 제안을 작업공간·날짜 한 줄로 두는 표 app_home_day_picks.
// - 승인형 workflow의 plan·dry-run·apply가 통과(확장 규칙)하고, dry-run은 아무것도 남기지 않는다. 작업공간 표 권한·정책 해시는 그대로.
// - 로그인 사용자는 자기 작업공간에만 줄을 만들고(workspace_id·day만) 값 칸만 고친다. 다른 작업공간 줄은 안 보이고 못 고친다. 지우기 없음.
// - 칸 검사: 읽을 글 0~3·기록 제안 0~2(배열만), 때 am|pm, 쓴 제안 id s1~s9. anon·service_role 권한 없음.
// - 되돌리기는 새 표와 기록만 지우고, 다시 적용된다.
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
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261109180000',name='home_day_picks',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;

test('home day picks: plan, dry-run, apply, owner-only rows and value columns, checks, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'home-day-picks-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query('revoke usage on schema private from service_role');
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL]=await Promise.all(['precheck','postcheck','snapshot','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  const check=async sql=>Object.fromEntries((await readOnly(sql)).map(r=>[r.item,r.value]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const before=(await pool.query(snapshot)).rows;let pre;

  await t.test('files: read-only checks, three-line summary, expanded workflow accepts apply and dry-run',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const p=prepareMigration({mode,version,runId:'1',root});assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');}
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'').replace(/'[^']*'/g,"''");
   assert.doesNotMatch(code,/security definer|disable row level|\banon\b(?!,)|create (or replace )?function|create trigger|rtw_|\bdelete\s+from\b|\bupdate\s+public\.|alter table public\.(?!app_home_day_picks\b)/i);
   pre=await check(precheck);
   for(const k of ['new migration absent','home day picks table absent','owner check function present'])assert.equal(pre[k],'예',k);
  });

  await t.test('dry-run leaves schema and history unchanged',async()=>{
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await check(precheck),pre);assert.equal(await history(),0);
  });

  await t.test('apply passes postcheck; workspaces table unchanged; second apply stops',async()=>{
   const result=await run('apply','9982');assert.equal(result.ok,true,result.summary);
   assert.equal(await history(),1);
   const post=await check(postcheck);
   for(const k of ['history row present','home day picks RLS on, empty','home day picks one authenticated owner policy','home day picks: no anon/service_role, no delete, set columns only','owner check function present'])assert.equal(post[k],'예',k);
   assert.equal(post['workspaces grants policies hash'],pre['workspaces grants policies hash']);
   assert.equal((await run('apply','9983')).ok,false,'second apply stops');
   await assert.rejects(pool.query(migration),/HOME_DAY_PICKS_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  await t.test('owner makes and updates own day rows only; stranger and other workspace blocked; no delete; anon and service_role nothing',async()=>{
   const make=(sub,ws,day='2026-11-09')=>as('authenticated',sub,c=>c.query('insert into public.app_home_day_picks(workspace_id,day) values($1,$2)',[ws,day]));
   await make(OWNER,WS_A);
   await assert.rejects(make(OWNER,WS_B),{code:'42501'},'other workspace');
   await assert.rejects(make(STRANGER,WS_A,'2026-11-10'),{code:'42501'},'not the owner');
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_home_day_picks(workspace_id,day,reads) values($1,'2026-11-10','[]')",[WS_A])),{code:'42501'},'insert value columns');
   await assert.rejects(make(OWNER,WS_A),{code:'23505'},'one row per day');
   const reads=[{id:'n1',title:'가상 기사',what:'가상 일',why:'가상 지부',source:'가상 신문',at:'2026-11-09T00:00:00.000Z',url:'https://example.test/a'}];
   const set=(sub,col,val)=>as('authenticated',sub,c=>c.query(`update public.app_home_day_picks set ${col}=$1 where workspace_id=$2 and day='2026-11-09'`,[val,WS_A]));
   await set(OWNER,'reads',JSON.stringify(reads));
   await set(OWNER,'reads_slot','am');
   await set(OWNER,'suggests',JSON.stringify([{id:'s1',text:'오늘 가상 회의',basis:'회의'}]));
   await set(OWNER,'suggests_done',['s1']);
   await set(OWNER,'run_at',new Date().toISOString());await set(OWNER,'run_at',null);
   await assert.rejects(set(OWNER,'reads',JSON.stringify([1,2,3,4])),{code:'23514'},'reads over 3');
   await assert.rejects(set(OWNER,'reads',JSON.stringify({a:1})),{code:'23514'},'reads not array');
   await assert.rejects(set(OWNER,'reads',JSON.stringify([{t:'가'.repeat(5000)}])),{code:'23514'},'reads too big');
   await assert.rejects(set(OWNER,'suggests',JSON.stringify([1,2,3])),{code:'23514'},'suggests over 2');
   await assert.rejects(set(OWNER,'reads_slot','noon'),{code:'23514'},'slot');
   await assert.rejects(set(OWNER,'suggests_done',['x1']),{code:'23514'},'done id shape');
   await assert.rejects(set(OWNER,'suggests_done',['s1,s2']),{code:'23514'},'done id with comma');
   await assert.rejects(as('authenticated',OWNER,c=>c.query("update public.app_home_day_picks set workspace_id=$1",[WS_B])),{code:'42501'},'workspace column fixed');
   await assert.rejects(as('authenticated',OWNER,c=>c.query("update public.app_home_day_picks set created_at=now()")),{code:'42501'},'created_at fixed');
   await assert.rejects(as('authenticated',OWNER,c=>c.query('delete from public.app_home_day_picks')),{code:'42501'},'no delete');
   const touched=await as('authenticated',STRANGER,c=>c.query("update public.app_home_day_picks set reads_slot='pm'"));
   assert.equal(touched.rowCount,0,'stranger updates nothing');
   assert.equal((await as('authenticated',STRANGER,c=>c.query('select * from public.app_home_day_picks'))).rows.length,0);
   const mine=(await as('authenticated',OWNER,c=>c.query('select reads,reads_slot,suggests_done from public.app_home_day_picks'))).rows;
   assert.equal(mine.length,1);assert.deepEqual(mine[0].reads,reads);assert.equal(mine[0].reads_slot,'am');assert.deepEqual(mine[0].suggests_done,['s1']);
   await assert.rejects(as('anon','',c=>c.query('select * from public.app_home_day_picks')),{code:'42501'});
   await assert.rejects(as('service_role','',c=>c.query('select * from public.app_home_day_picks')),{code:'42501'});
  });

  await t.test('rollback drops the table and record only; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.equal((await pool.query("select to_regclass('public.app_home_day_picks') is null as gone")).rows[0].gone,true);
   const again=await run('apply','9984');assert.equal(again.ok,true,again.summary);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
