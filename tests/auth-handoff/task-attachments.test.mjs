// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic.
// TASK-파일붙이기: 20261022003000_task_attachments — Google task → Drive file link table, owner-only RLS,
// insert column grants (no update), value checks, the exact statements google-tasks Edge sends through PostgREST, guarded rollback.
// Optional: TASK_ATTACH_PG_PORT=<port> runs the same checks on an already running local server (user postgres, trust auth).
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
const version='20261022003000',name='task_attachments',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const externalPort=process.env.TASK_ATTACH_PG_PORT;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

test('task attachments: migration, owner-only RLS, column grants, checks, PostgREST statements, guarded rollback',{timeout:120000},async t=>{
 let cluster,pool,adminPool,database='postgres',port,password='';
 if(externalPort){
  port=Number(externalPort);database='task_attach_'+randomBytes(4).toString('hex');
  adminPool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres',ssl:false}));
  await adminPool.query('create database '+database);
  for(const role of ['anon','authenticated','public_probe','service_role'])await adminPool.query(`drop role if exists ${role}`).catch(()=>{});
 }else{
  const directory=await mkdtemp(join(tmpdir(),'task-attach-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));port=sock.address().port;await new Promise(r=>sock.close(r));
  password=randomBytes(24).toString('hex');
  cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
  await cluster.initialise();await cluster.start();
 }
 try{
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database,ssl:false}));
  await pool.query(fixture);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const row=(over={})=>({workspace_id:WS_A,google_task_id:'task-A_1',drive_file_id:'drive-file-1',file_name:'회의 자료.hwpx',mime_type:'application/octet-stream',size_bytes:1024,...over});
  // The statement PostgREST makes for google-tasks Edge's insert (caller JWT, Prefer: return=representation).
  const insert=(c,r)=>c.query(`insert into public.app_task_attachments(workspace_id,google_task_id,drive_file_id,file_name,mime_type,size_bytes)
    select * from jsonb_to_recordset($1::jsonb) as x(workspace_id uuid,google_task_id text,drive_file_id text,file_name text,mime_type text,size_bytes bigint)
    returning google_task_id,drive_file_id,file_name,mime_type,size_bytes,created_at`,[JSON.stringify([r])]);

  await t.test('files: read-only checks, three-line summary, expanded approved workflow accepts the file',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'');
   assert.match(code,/^begin;\n/);assert.match(code,/\ncommit;\n$/);
   assert.doesNotMatch(code,/security definer|create function|disable row level|to anon|to public|to service_role|grant update|update public|delete from public|rtw_/i);
   assert.match(code,/revoke all on table public\.app_task_attachments from public, anon, authenticated, service_role;/);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261022003000', 'task_attachments'/);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/delete from public|update public|truncate|cascade|grant |policy/i);
  });
  const before=(await pool.query(snapshot)).rows;
  await t.test('precheck before apply is all 예 and the snapshot shows the absent table',async()=>{
   for(const r of (await pool.query(precheck)).rows.filter(r=>r.item!=='recent migrations'))assert.equal(r.value,'예',r.item);
   assert.deepEqual(before.filter(r=>r.kind==='table').map(r=>r.definition),['absent']);
  });
  await t.test('prerequisite guard stops when the owner check function is missing',async()=>{
   const c=await pool.connect();
   try{await c.query('begin');await c.query('alter function private.app_is_workspace_owner(uuid) rename to app_is_workspace_owner_x');
    await assert.rejects(c.query(migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/TASK_ATTACHMENTS_PREREQUISITE_CHANGED/);}
   finally{await c.query('rollback');c.release();}
   assert.equal(await history(),0);
  });
  await t.test('apply succeeds once and postcheck is all 예; a second apply is refused',async()=>{
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal(await history(),1);
   await assert.rejects(pool.query(migration),/TASK_ATTACHMENTS_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  await t.test('owner attaches, lists by task ids, deletes one; the same Drive file cannot be attached twice',async()=>{
   const r=await owner(c=>insert(c,row()));
   assert.equal(r.rowCount,1);assert.equal(r.rows[0].file_name,'회의 자료.hwpx');
   await owner(c=>insert(c,row({drive_file_id:'drive-file-2',file_name:'사진.jpg',mime_type:'image/jpeg'})));
   await owner(c=>insert(c,row({google_task_id:'task-B',drive_file_id:'drive-file-3'})));
   await assert.rejects(owner(c=>insert(c,row({google_task_id:'task-B'}))),{code:'23505'});
   // GET app_task_attachments?google_task_id=in.(...)&select=...&order=created_at.asc (Edge action=files)
   const listed=await owner(c=>c.query("select google_task_id,drive_file_id from public.app_task_attachments where google_task_id = any($1) order by created_at",[['task-A_1','task-B']]));
   assert.equal(listed.rowCount,3);
   // DELETE ...?google_task_id=eq.X&drive_file_id=eq.Y (Edge action=detach)
   const gone=await owner(c=>c.query("delete from public.app_task_attachments where google_task_id=$1 and drive_file_id=$2 returning drive_file_id",['task-A_1','drive-file-2']));
   assert.equal(gone.rowCount,1);
   // DELETE ...?google_task_id=eq.X (Edge action=delete: the task is gone, its links go too)
   assert.equal((await owner(c=>c.query("delete from public.app_task_attachments where google_task_id=$1",['task-B']))).rowCount,1);
  });
  await t.test('client cannot set id or created_at, and nothing can be updated',async()=>{
   await assert.rejects(owner(c=>c.query("insert into public.app_task_attachments(id,workspace_id,google_task_id,drive_file_id,file_name,size_bytes) values(gen_random_uuid(),$1,'t','f-x','a',1)",[WS_A])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_task_attachments(created_at,workspace_id,google_task_id,drive_file_id,file_name,size_bytes) values(now(),$1,'t','f-y','a',1)",[WS_A])),{code:'42501'});
   for(const col of ["file_name='바꿈'","google_task_id='other'","workspace_id='"+WS_B+"'","drive_file_id='z'"])
    await assert.rejects(owner(c=>c.query('update public.app_task_attachments set '+col)),{code:'42501'},col);
  });
  await t.test('values are checked: ids, names, mime, size',async()=>{
   for(const [over,label] of [[{google_task_id:''},'empty task'],[{google_task_id:'a/b'},'task slash'],[{google_task_id:'x'.repeat(201)},'task 201'],
    [{drive_file_id:'a b'},'file space'],[{drive_file_id:'../x'},'file dots'],[{file_name:''},'empty name'],[{file_name:'가'.repeat(256)},'name 256'],
    [{file_name:'줄\n바꿈'},'newline name'],[{mime_type:'text'},'mime no slash'],[{mime_type:'a/b/c'},'mime two slashes'],
    [{size_bytes:0},'size 0'],[{size_bytes:104857601},'size over 100MiB']])
    await assert.rejects(owner(c=>insert(c,row({...over,drive_file_id:over.drive_file_id??'v-'+label.replace(/\W/g,'')}))),{code:'23514'},label);
   assert.equal((await owner(c=>insert(c,row({drive_file_id:'max-size',size_bytes:104857600,file_name:'가'.repeat(255)})))).rowCount,1);
  });
  await t.test('stranger, no-login, anon and service_role see and change nothing',async()=>{
   await assert.rejects(stranger(c=>insert(c,row({drive_file_id:'s-1'}))),{code:'42501'});
   await assert.rejects(owner(c=>insert(c,row({workspace_id:WS_B,drive_file_id:'b-1'}))),{code:'42501'},'owner of A cannot write into B');
   assert.deepEqual((await stranger(c=>c.query('select id from public.app_task_attachments'))).rows,[]);
   assert.equal((await stranger(c=>c.query('delete from public.app_task_attachments'))).rowCount,0);
   assert.deepEqual((await as('authenticated',null,c=>c.query('select id from public.app_task_attachments'))).rows,[]);
   for(const role of ['anon','service_role'])for(const sql of ['select 1 from public.app_task_attachments',"insert into public.app_task_attachments(workspace_id,google_task_id,drive_file_id,file_name,size_bytes) values('"+WS_A+"','t','r-1','a',1)",'delete from public.app_task_attachments'])
    await assert.rejects(as(role,null,c=>c.query(sql)),{code:'42501'},role+' '+sql);
  });
  await t.test('rollback stops while attachments exist; after they are removed it restores the snapshot; re-apply works',async()=>{
   await assert.rejects(pool.query(rollbackSQL),/TASK_ATTACHMENTS_ROLLBACK_BLOCKED: attachments exist/);await pool.query('rollback');
   assert.equal(await history(),1);
   await pool.query('delete from public.app_task_attachments');
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   await pool.query(migration);assert.equal(await history(),1);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  if(adminPool){await adminPool.query('drop database if exists '+database+' with (force)').catch(()=>{});for(const role of ['anon','authenticated','public_probe','service_role'])await adminPool.query(`drop role if exists ${role}`).catch(()=>{});await closePool(adminPool);}
  await cluster?.stop();
 }
});
