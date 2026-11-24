// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// S69-12 자료실 옮긴 기록 DB(20261124090000_library_move_log): 소유자만, 자료·두 폴더 같은 작업공간만, 고치기 없음, 자료·폴더 삭제 시 기록 정리.
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
const version='20261124090000',name='library_move_log',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
// 자료·폴더 표는 이 migration이 읽는 칸만 갖춘 합성 모양이다(운영과 같은 소유자 정책).
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  create table public.app_documents(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id) on delete cascade, title text);
  create table public.app_library_folders(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id) on delete cascade, name text not null);
  alter table public.app_documents enable row level security;
  alter table public.app_library_folders enable row level security;
  revoke all on table public.app_documents, public.app_library_folders from public, anon, authenticated, service_role;
  grant select, insert, update, delete on table public.app_documents, public.app_library_folders to authenticated;
  create policy docs_owner_all on public.app_documents for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  create policy folders_owner_all on public.app_library_folders for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke usage on schema private from service_role;`;

test('library move log db: plan, dry-run, apply, owner boundary, same-workspace rows only, cascade, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'library-move-log-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  const addDoc=ws=>pool.query("insert into public.app_documents(workspace_id,title) values ($1,'가상 자료') returning id",[ws]).then(r=>r.rows[0].id);
  const addFolder=ws=>pool.query("insert into public.app_library_folders(workspace_id,name) values ($1,'가상 폴더') returning id",[ws]).then(r=>r.rows[0].id);
  const docA=await addDoc(WS_A),docA2=await addDoc(WS_A),docB=await addDoc(WS_B),fA=await addFolder(WS_A),fA2=await addFolder(WS_A),fB=await addFolder(WS_B);
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const ins="insert into public.app_library_move_log(workspace_id,batch_id,kind,document_id,from_folder_id,to_folder_id) values ($1,$2,$3,$4,$5,$6) returning id";
  const batch='31000000-0000-4000-8000-000000000001';

  await t.test('files: strict or expanded rules, no functions or triggers, grants as designed, summary 3 lines',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.deepEqual([...plan.functions],[]);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/create (or replace )?function|create trigger|rtw_|app_collab|\bto (anon|public)\b|alter table public\.app_(documents|library_folders|library_folder_items)\b|security definer|grant update/i);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/app_documents|app_library_folders|app_library_folder_items|truncate|cascade|grant /i);
  });
  await t.test('precheck yes, dry-run changes nothing, apply passes postcheck, second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9972');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9973')).ok,false);
  });
  await t.test('owner logs moves (from a folder or from outside), reads them, deletes a batch; no update, server-set columns',async()=>{
   await owner(c=>c.query(ins,[WS_A,batch,'tidy',docA,fA,fA2]));
   await owner(c=>c.query(ins,[WS_A,batch,'tidy',docA2,null,fA2]));
   await owner(c=>c.query(ins,[WS_A,'31000000-0000-4000-8000-000000000002','sort',docA,fA2,fA]));
   assert.equal((await owner(c=>c.query('select 1 from public.app_library_move_log'))).rows.length,3);
   await assert.rejects(owner(c=>c.query("update public.app_library_move_log set from_folder_id=$1",[fA2])),/permission denied/);
   await assert.rejects(owner(c=>c.query("insert into public.app_library_move_log(id,workspace_id,batch_id,kind,document_id,to_folder_id) values (gen_random_uuid(),$1,$2,'tidy',$3,$4)",[WS_A,batch,docA,fA])),/permission denied/);
   await assert.rejects(owner(c=>c.query("insert into public.app_library_move_log(created_at,workspace_id,batch_id,kind,document_id,to_folder_id) values (now(),$1,$2,'tidy',$3,$4)",[WS_A,batch,docA,fA])),/permission denied/);
   await assert.rejects(owner(c=>c.query(ins,[WS_A,batch,'other',docA,fA,fA2])),{code:'23514'});
   await assert.rejects(owner(c=>c.query(ins,[WS_A,batch,'tidy',docA,fA,fA])),{code:'23514'});
   assert.equal((await owner(c=>c.query("delete from public.app_library_move_log where batch_id='31000000-0000-4000-8000-000000000002'"))).rowCount,1);
  });
  await t.test('boundaries: other workspace document or folder, other workspace id, stranger, anon and server blocked',async()=>{
   await assert.rejects(owner(c=>c.query(ins,[WS_A,batch,'tidy',docB,fA,fA2])),/row-level security/);
   await assert.rejects(owner(c=>c.query(ins,[WS_A,batch,'tidy',docA,fB,fA2])),/row-level security/);
   await assert.rejects(owner(c=>c.query(ins,[WS_A,batch,'tidy',docA,fA,fB])),/row-level security/);
   await assert.rejects(owner(c=>c.query(ins,[WS_B,batch,'tidy',docB,null,fB])),/row-level security/);
   await assert.rejects(stranger(c=>c.query(ins,[WS_A,batch,'tidy',docA,fA,fA2])),/row-level security/);
   assert.deepEqual((await stranger(c=>c.query('select 1 from public.app_library_move_log'))).rows,[]);
   assert.equal((await stranger(c=>c.query('delete from public.app_library_move_log'))).rowCount,0);
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_library_move_log')),/permission denied/);
   await assert.rejects(as('anon','',c=>c.query(ins,[WS_A,batch,'tidy',docA,fA,fA2])),/permission denied/);
   await assert.rejects(server(c=>c.query('select 1 from public.app_library_move_log')),/permission denied/);
   await pool.query("insert into public.app_library_move_log(workspace_id,batch_id,kind,document_id,to_folder_id) values ($1,$2,'tidy',$3,$4)",[WS_B,batch,docB,fB]);
   assert.equal((await owner(c=>c.query('select 1 from public.app_library_move_log where workspace_id=$1',[WS_B]))).rows.length,0);
  });
  await t.test('deleting a document or a folder removes its log rows only',async()=>{
   const total=async()=>(await pool.query('select count(*)::int n from public.app_library_move_log')).rows[0].n;
   const n0=await total();
   await pool.query('delete from public.app_documents where id=$1',[docA2]);
   assert.equal(await total(),n0-1);
   await pool.query('delete from public.app_library_folders where id=$1',[fA]);
   assert.equal(await total(),n0-2);
   assert.equal((await pool.query('select count(*)::int n from public.app_documents')).rows[0].n,2);
  });
  await t.test('rollback: new table and record gone, documents and folders untouched, re-apply works',async()=>{
   const docs=(await pool.query('select count(*)::int n from public.app_documents')).rows[0].n;
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await pool.query('select count(*)::int n from public.app_documents')).rows[0].n,docs);
   await pool.query(migration);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
