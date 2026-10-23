// Fresh local PostgreSQL only. No Supabase, OpenAI or production credentials. All data synthetic (no real names).
// WEEKLY-임원요청정리: 20261023140000_weekly_exec_requests — one table (week × request rows jsonb + carried_at), owner-only RLS,
// column privileges (no delete), the items rule, the statements the screen sends through PostgREST, guarded rollback.
// SQL Editor only (the approved DB workflow refuses policies and table grants), so the file is applied as written.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {fixture,OWNER,STRANGER,WS_A,WS_B} from './basket4-fixture.mjs';
import {checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
const version='20261023140000',name='weekly_exec_requests',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const WEEK='2026-10-19';
const ROW={id:'r1',day:'2026-10-28',time:'10:30',what:'가상 결의대회',place:'가상 광장',who:'가상 임원'};

test('weekly exec requests: migration, owner-only RLS, no delete, items rule, guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'exec-requests-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex');
 const cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 await cluster.initialise();await cluster.start();
 let pool;
 try{
  pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false});
  await pool.query(fixture);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  // The screen's POST (insert of the allowed columns) and guarded PATCH (updated_at condition).
  const add=(c,items,over={})=>{const r={workspace_id:WS_A,week_start:WEEK,carried_at:null,...over};
   return c.query('insert into public.app_weekly_exec_requests(workspace_id,week_start,items,carried_at,updated_at) values($1,$2,$3::jsonb,$4,now()) returning id,updated_at::text as updated_at',[r.workspace_id,r.week_start,JSON.stringify(items),r.carried_at]);};

  await t.test('files: read-only checks, three-line summary, no definer/anon/public grants',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'');
   assert.match(code,/^begin;\n/);assert.match(code,/\ncommit;\n$/);
   assert.doesNotMatch(code,/security definer|create function|disable row level|to anon|to public|to service_role|rtw_|grant delete|grant all/i);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261023140000', 'weekly_exec_requests'/);
  });
  const before=(await pool.query(snapshot)).rows;
  await t.test('precheck before apply is all 예',async()=>{
   for(const r of (await pool.query(precheck)).rows.filter(r=>r.item!=='recent migrations'))assert.equal(r.value,'예',r.item);
  });
  await t.test('apply once, postcheck all 예, a second apply is refused',async()=>{
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal(await history(),1);
   await assert.rejects(pool.query(migration),/WEEKLY_EXEC_REQUESTS_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });
  await t.test('owner: one row a week, guarded update of items and carried_at, no delete',async()=>{
   const first=(await owner(c=>add(c,[ROW,{...ROW,id:'r2',until:'2026-10-29',carried:true,time:'',place:'',who:''}]))).rows[0];
   await assert.rejects(owner(c=>add(c,[])),{code:'23505'},'one row per week');
   const stale=await owner(c=>c.query("update public.app_weekly_exec_requests set items='[]'::jsonb,updated_at=now() where workspace_id=$1 and week_start=$2 and updated_at=$3::timestamptz - interval '1 second' returning id",[WS_A,WEEK,first.updated_at]));
   assert.equal(stale.rowCount,0,'another version is not overwritten');
   const ok=await owner(c=>c.query("update public.app_weekly_exec_requests set items=$4::jsonb,carried_at=now(),updated_at=now() where workspace_id=$1 and week_start=$2 and updated_at=$3::timestamptz returning items",[WS_A,WEEK,first.updated_at,JSON.stringify([ROW])]));
   assert.deepEqual(ok.rows[0].items,[ROW]);
   await assert.rejects(owner(c=>c.query('delete from public.app_weekly_exec_requests')),{code:'42501'});
  });
  await t.test('items rule: shape, keys, types, dates, lengths, control characters, 30 rows',async()=>{
   const bad=[
    [[1],'not an object'],[[{...ROW,extra:'x'}],'unknown key'],[[{...ROW,id:undefined}],'no id'],[[{...ROW,day:undefined}],'no day'],
    [[{...ROW,what:undefined}],'no what'],[[{...ROW,what:'  '}],'blank what'],[[{...ROW,who:['가상 임원']}],'array who'],[[{...ROW,time:10}],'number time'],
    [[{...ROW,carried:'yes'}],'string carried'],[[{...ROW,id:'a b'}],'bad id'],[[{...ROW,day:'2026-13-01'}],'bad month'],[[{...ROW,day:'10.28.(수)'}],'form day'],
    [[{...ROW,until:'2026/10/29'}],'bad until'],[[{...ROW,what:'a\nb'}],'newline'],[[{...ROW,place:'a\u0007b'}],'control'],
    [[{...ROW,time:'가'.repeat(41)}],'41 time'],[[{...ROW,what:'가'.repeat(201)}],'201 what'],[[{...ROW,place:'가'.repeat(101)}],'101 place'],[[{...ROW,who:'가'.repeat(201)}],'201 who'],
    [Array.from({length:31},(_, i)=>({...ROW,id:'r'+i})),'31 rows'],[{a:1},'object, not array'],
   ];
   for(const [items,label] of bad)await assert.rejects(owner(c=>add(c,items,{week_start:'2026-10-12'})),{code:'23514'},label);
   await assert.rejects(owner(c=>add(c,[],{week_start:'2026-10-13'})),{code:'23514'},'tuesday');
   const max=Array.from({length:30},(_, i)=>({id:'r'+i,day:'2026-10-28',time:'가'.repeat(40),what:'가'.repeat(200),place:'가'.repeat(100),who:'가'.repeat(200),carried:false}));
   assert.equal((await owner(c=>add(c,max,{week_start:'2026-10-12'}))).rowCount,1);
   assert.equal((await owner(c=>add(c,[],{week_start:'2026-10-05'}))).rowCount,1,'an empty week');
  });
  await t.test('cannot move a week to another week or workspace',async()=>{
   for(const col of ["week_start='2026-10-26'","workspace_id='"+WS_B+"'"])
    await assert.rejects(owner(c=>c.query('update public.app_weekly_exec_requests set '+col)),{code:'42501'},col);
   await assert.rejects(owner(c=>add(c,[],{workspace_id:WS_B,week_start:'2026-09-28'})),{code:'42501'});
  });
  await t.test('stranger, no-login, anon and service_role see and change nothing',async()=>{
   assert.deepEqual((await stranger(c=>c.query('select id from public.app_weekly_exec_requests'))).rows,[]);
   assert.equal((await stranger(c=>c.query("update public.app_weekly_exec_requests set items='[]'::jsonb"))).rowCount,0);
   await assert.rejects(stranger(c=>add(c,[],{week_start:'2026-09-21'})),{code:'42501'});
   assert.deepEqual((await as('authenticated',null,c=>c.query('select id from public.app_weekly_exec_requests'))).rows,[]);
   for(const role of ['anon','service_role'])await assert.rejects(as(role,null,c=>c.query('select 1 from public.app_weekly_exec_requests')),{code:'42501'},role);
  });
  await t.test('rollback stops while saved rows exist; otherwise restores the snapshot; re-apply works',async()=>{
   await assert.rejects(pool.query(rollbackSQL),/WEEKLY_EXEC_REQUESTS_ROLLBACK_BLOCKED: saved request rows exist/);await pool.query('rollback');
   assert.equal(await history(),1);
   await pool.query("update public.app_weekly_exec_requests set items='[]'::jsonb");
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   await pool.query(migration);assert.equal(await history(),1);
  });
 }finally{
  await pool?.end();
  await cluster.stop();
 }
});
