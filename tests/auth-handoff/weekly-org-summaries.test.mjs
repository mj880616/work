// Fresh local PostgreSQL only. No Supabase, OpenAI or production credentials. All data synthetic (no real names).
// JOURNAL-조직현황AI요약: 20261022140000_weekly_org_summaries — one table (week × organization summary + edited flag),
// owner-only RLS, column privileges, the statements the screen and ai-assist send through PostgREST, guarded rollback.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,ORG_A,ORG_B} from './basket4-fixture.mjs';
import {checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
const version='20261022140000',name='weekly_org_summaries',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const WEEK='2026-10-19';

test('weekly org summaries: migration, owner-only RLS, column grants, edited kept, guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'org-summary-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  const add=(c,over={})=>{const r={workspace_id:WS_A,week_start:WEEK,organization_id:ORG_A,summary:'임금교섭 3차 실무교섭 진행.',edited:false,...over};
   return c.query('insert into public.app_weekly_org_summaries(workspace_id,week_start,organization_id,summary,edited,generated_at,updated_at) values($1,$2,$3,$4,$5,now(),now()) on conflict (workspace_id,week_start,organization_id) do nothing returning id',[r.workspace_id,r.week_start,r.organization_id,r.summary,r.edited]);};

  await t.test('files: read-only checks, three-line summary, no definer/anon/public grants',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'');
   assert.match(code,/^begin;\n/);assert.match(code,/\ncommit;\n$/);
   assert.doesNotMatch(code,/security definer|create function|disable row level|to anon|to public|to service_role|rtw_|raw_text/i);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261022140000', 'weekly_org_summaries'/);
  });
  const before=(await pool.query(snapshot)).rows;
  await t.test('precheck before apply is all 예',async()=>{
   for(const r of (await pool.query(precheck)).rows.filter(r=>r.item!=='recent migrations'))assert.equal(r.value,'예',r.item);
  });
  await t.test('apply once, postcheck all 예, a second apply is refused',async()=>{
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal(await history(),1);
   await assert.rejects(pool.query(migration),/WEEKLY_ORG_SUMMARIES_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });
  await t.test('AI write (edited=false) then the guarded AI update skips an edited row',async()=>{
   assert.equal((await owner(c=>add(c))).rowCount,1);
   assert.equal((await owner(c=>add(c))).rowCount,0,'one row per week and organization');
   // The owner edits it (screen PATCH).
   await owner(c=>c.query("update public.app_weekly_org_summaries set summary='고친 요약.',edited=true,updated_at=now() where workspace_id=$1 and week_start=$2 and organization_id=$3",[WS_A,WEEK,ORG_A]));
   // ai-assist PATCH ...&edited=is.false → 0 rows.
   const r=await owner(c=>c.query("update public.app_weekly_org_summaries set summary='AI 새 요약.' where workspace_id=$1 and week_start=$2 and organization_id=$3 and edited is false returning id",[WS_A,WEEK,ORG_A]));
   assert.equal(r.rowCount,0);
   assert.equal((await owner(c=>c.query('select summary from public.app_weekly_org_summaries'))).rows[0].summary,'고친 요약.');
  });
  await t.test('checks: Monday only, 1~8 non-empty lines, 1,000 characters, no control characters',async()=>{
   for(const [over,label] of [[{week_start:'2026-10-20'},'tuesday'],[{summary:'  '},'blank'],[{summary:'a\n\nb'},'empty line'],[{summary:'a\r\nb'},'CR'],
    [{summary:Array.from({length:9},(_, i)=>'줄'+i).join('\n')},'9 lines'],[{summary:'가'.repeat(1001)},'1001'],[{summary:'a\u0007b'},'control']])
    await assert.rejects(owner(c=>add(c,{...over,organization_id:ORG_A,week_start:over.week_start||'2026-10-12'})),{code:'23514'},label);
   assert.equal((await owner(c=>add(c,{week_start:'2026-10-12',summary:Array.from({length:8},(_, i)=>'줄'+i).join('\n')}))).rowCount,1);
  });
  await t.test('cannot move a summary to another week, organization or workspace; organization must be in the workspace',async()=>{
   for(const col of ["week_start='2026-10-26'","organization_id='"+ORG_B+"'","workspace_id='"+WS_B+"'"])
    await assert.rejects(owner(c=>c.query('update public.app_weekly_org_summaries set '+col)),{code:'42501'},col);
   await assert.rejects(owner(c=>add(c,{organization_id:ORG_B,week_start:'2026-10-05'})),{code:'42501'});
  });
  await t.test('stranger, anon, no-login and service_role see and change nothing',async()=>{
   assert.deepEqual((await stranger(c=>c.query('select id from public.app_weekly_org_summaries'))).rows,[]);
   assert.equal((await stranger(c=>c.query('delete from public.app_weekly_org_summaries'))).rowCount,0);
   await assert.rejects(stranger(c=>add(c,{week_start:'2026-10-05'})),{code:'42501'});
   assert.deepEqual((await as('authenticated',null,c=>c.query('select id from public.app_weekly_org_summaries'))).rows,[]);
   for(const role of ['anon','service_role'])await assert.rejects(as(role,null,c=>c.query('select 1 from public.app_weekly_org_summaries')),{code:'42501'},role);
  });
  await t.test('rollback stops while an edited summary exists; otherwise restores the snapshot; re-apply works',async()=>{
   await assert.rejects(pool.query(rollbackSQL),/WEEKLY_ORG_SUMMARIES_ROLLBACK_BLOCKED: edited summaries exist/);await pool.query('rollback');
   assert.equal(await history(),1);
   await owner(c=>c.query('delete from public.app_weekly_org_summaries where edited'));
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
