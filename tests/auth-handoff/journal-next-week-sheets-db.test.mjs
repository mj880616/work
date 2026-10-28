// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// JOURNAL-다음주준비 DB(20261029040000_journal_next_week_sheets): app_journal_next_week_sheets — through the approved DB workflow runner.
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
import {prepareMigration,toDryRun} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261029040000',name='journal_next_week_sheets',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

const prerequisites=`
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;

test('journal next week sheets db: plan, dry-run, apply, owner boundary, shape guard, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'next-week-sheets-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL]=await Promise.all(['precheck','postcheck','snapshot','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const MON='2026-11-02';
  const top=JSON.stringify([{text:'화요일 교섭 전에 지난 회의 후속 2건 정리 필요함.',refs:['e1']}]);
  const groups=JSON.stringify([{group:'events',title:'A 사업장 교섭',day:'2026-11-03',source_kind:'event',source_id:'e1'}]);
  const save=(sub,ws,week,extra={})=>as('authenticated',sub,c=>c.query(
   `insert into public.app_journal_next_week_sheets(workspace_id,week_start,top_lines,groups,ai_status,made_by) values ($1,$2,$3::jsonb,$4::jsonb,$5,$6)
    on conflict (workspace_id,week_start) do update set top_lines=excluded.top_lines,groups=excluded.groups,ai_status=excluded.ai_status,made_by=excluded.made_by,updated_at=now()`,
   [ws,week,extra.top??top,extra.groups??groups,extra.ai??'ok',extra.made??'auto']));

  await t.test('approval plan: expanded rules, full flow, no definer function',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.review.definer,[]);
   assert.match(toDryRun(migration),/rollback;\s*$/);
  });
  await t.test('precheck: all yes before apply',()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
  await t.test('dry-run leaves schema and history unchanged',async()=>{
   const dry=await run('dry-run','9901');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; second apply refused',async()=>{
   const apply=await run('apply','9902');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9903')).ok,false);
  });
  await t.test('owner writes one row per week; regenerate overwrites; anon and other workspaces refused',async()=>{
   await save(OWNER,WS_A,MON);
   await save(OWNER,WS_A,MON,{ai:'limit',top:'[]',made:'user'});
   const rows=(await owner(c=>c.query('select ai_status,made_by,jsonb_array_length(top_lines) n from public.app_journal_next_week_sheets'))).rows;
   assert.deepEqual(rows,[{ai_status:'limit',made_by:'user',n:0}]);
   // anon: no privilege at all.
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_journal_next_week_sheets')),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query(`insert into public.app_journal_next_week_sheets(workspace_id,week_start,ai_status,made_by) values ('${WS_A}','${MON}','ok','auto')`)),{code:'42501'});
   // Stranger: sees nothing, cannot write into the owner's workspace, cannot change or delete the owner's row.
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_journal_next_week_sheets'))).rows[0].n,0);
   await assert.rejects(save(STRANGER,WS_A,'2026-11-09'),{code:'42501'});
   assert.equal((await stranger(c=>c.query("update public.app_journal_next_week_sheets set ai_status='failed'"))).rowCount,0);
   await assert.rejects(stranger(c=>c.query('delete from public.app_journal_next_week_sheets')),{code:'42501'});
   // Owner of WS_A is not owner of WS_B.
   await assert.rejects(save(OWNER,WS_B,MON),{code:'42501'});
   // Owner cannot delete (history kept), nor move a row to another week or workspace, nor set created_at.
   await assert.rejects(owner(c=>c.query('delete from public.app_journal_next_week_sheets')),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_journal_next_week_sheets set week_start='2026-11-09'")),{code:'42501'});
   await assert.rejects(owner(c=>c.query('update public.app_journal_next_week_sheets set workspace_id=$1',[WS_B])),{code:'42501'});
   await assert.rejects(owner(c=>c.query(`insert into public.app_journal_next_week_sheets(workspace_id,week_start,ai_status,made_by,created_at) values ('${WS_A}','2026-11-16','ok','auto',now())`)),{code:'42501'});
  });
  await t.test('shape guard: Monday only, top at most 3, arrays only, known status and maker',async()=>{
   await assert.rejects(save(OWNER,WS_A,'2026-11-03'),{code:'23514'});
   await assert.rejects(save(OWNER,WS_A,'2026-11-09',{top:JSON.stringify([{},{},{},{}])}),{code:'23514'});
   await assert.rejects(save(OWNER,WS_A,'2026-11-09',{groups:'{}'}),{code:'23514'});
   await assert.rejects(save(OWNER,WS_A,'2026-11-09',{ai:'great'}),{code:'23514'});
   await assert.rejects(save(OWNER,WS_A,'2026-11-09',{made:'schedule'}),{code:'23514'});
   await assert.rejects(save(OWNER,WS_A,'2026-11-09',{groups:JSON.stringify(Array.from({length:201},()=>({})))}),{code:'23514'});
  });
  await t.test('deleting the workspace removes its rows; rollback returns to the snapshot',async()=>{
   await pool.query('delete from public.app_workspace_members where workspace_id=$1',[WS_A]);
   await pool.query('delete from public.app_spaces where workspace_id=$1',[WS_A]);
   await pool.query('delete from public.app_suborganizations where workspace_id=$1',[WS_A]);
   await pool.query('delete from public.app_meetings where workspace_id=$1',[WS_A]);
   await pool.query('delete from public.app_workspaces where id=$1',[WS_A]).catch(()=>{});
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
