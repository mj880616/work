// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic.
// LIB-폴더탐색기 DB: 20261026170000_library_folders_free — folders are no longer tied to one project frame.
// Starts from 20261022120000_library_folders (the frame-bound first shape), applies the new file, and checks:
// existing data untouched, cross-project nesting and filing allowed, document projects unchanged, cycle/depth/workspace/owner limits kept,
// lift-on-delete lifts documents of other projects too, no widening of access, rollback restores the first shape without touching rows.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,PROJECT_A2,PROJECT_B} from './basket4-fixture.mjs';
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
const base='20261022120000_library_folders',version='20261026170000',name='library_folders_free',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

const documents=`
  create table public.app_documents(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
    project_id uuid references public.app_spaces(id) on delete set null,title text,category text,visibility text default 'private');
  alter table public.app_documents enable row level security;
  create policy task12a_owner_all on public.app_documents for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke all on public.app_documents from anon;
  revoke truncate, references, trigger on public.app_documents from authenticated;
`;

test('library folders free: frame limit lifted, data kept, access not widened, guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'lib-folders-free-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(documents);
  await pool.query(await read('supabase/migrations/'+base+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const doc=async(ws,project,title='자료')=>(await pool.query('insert into public.app_documents(workspace_id,project_id,title) values($1,$2,$3) returning id',[ws,project,title])).rows[0].id;
  const folder=(c,{ws=WS_A,project=PROJECT_A,parent=null,label='A 폴더',order=0}={})=>c.query('insert into public.app_library_folders(workspace_id,project_id,parent_id,name,sort_order) values($1,$2,$3,$4,$5) returning id',[ws,project,parent,label,order]).then(r=>r.rows[0].id);
  const place=(c,document,folderId,ws=WS_A)=>c.query('insert into public.app_library_folder_items(document_id,folder_id,workspace_id) values($1,$2,$3)',[document,folderId,ws]);
  const folderOf=async document=>(await pool.query('select folder_id from public.app_library_folder_items where document_id=$1',[document])).rows[0]?.folder_id??null;
  const parentOf=async id=>(await pool.query('select parent_id from public.app_library_folders where id=$1',[id])).rows[0]?.parent_id??null;
  const projectOf=async id=>(await pool.query('select project_id from public.app_documents where id=$1',[id])).rows[0].project_id;
  const move=(c,id,parent)=>c.query('update public.app_library_folders set parent_id=$1 where id=$2',[parent,id]);

  // Data made under the first shape (same frame only).
  const D1=await doc(WS_A,PROJECT_A,'A 자료'),D2=await doc(WS_A,PROJECT_A2,'A2 자료'),D3=await doc(WS_A,null,'프로젝트 없는 자료'),D4=await doc(WS_A,PROJECT_A,'A 자료 둘'),DB=await doc(WS_B,PROJECT_B,'남의 자료');
  const OLD1=await owner(c=>folder(c,{label:'옛 A'})),OLD2=await owner(c=>folder(c,{parent:OLD1,label:'옛 A 안'})),OLDN=await owner(c=>folder(c,{project:null,label:'옛 없음'}));
  await owner(c=>place(c,D1,OLD2));await owner(c=>place(c,D3,OLDN));
  // The first shape refuses what the new file allows.
  await assert.rejects(owner(c=>place(c,D2,OLD1)),{code:'42501'},'first shape: other-project document');
  await assert.rejects(owner(c=>folder(c,{project:null,parent:OLD1})),/LIB_FOLDER_SCOPE/,'first shape: other-frame parent');
  const rowsBefore=JSON.stringify([(await pool.query('select id,project_id,parent_id,name,sort_order from public.app_library_folders order by id')).rows,(await pool.query('select document_id,folder_id from public.app_library_folder_items order by document_id')).rows]);

  await t.test('files: read-only checks, three-line summary; the approved workflow refuses it (policy replacement) so it goes through the SQL Editor',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   assert.throws(()=>prepareMigration({mode:'apply',version,runId:'1',root}),/DB plan rejected/);
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
   assert.match(rollbackSQL,/SQL Editor\(폰 경로 C\) 전용/);
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'');
   assert.match(code,/^begin;\n/);assert.match(code,/\ncommit;\n$/);
   assert.doesNotMatch(code,/security definer|disable row level|to anon|to public|to service_role|grant |rtw_|truncate|alter table|drop table/i,'no widening, no table changes');
   assert.doesNotMatch(code,/on public\.app_documents/i,'documents table is not touched');
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261026170000', 'library_folders_free'/);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/truncate|grant |drop table|alter table/i,'rollback changes functions, one policy and the history row only');
  });
  const before=(await pool.query(snapshot)).rows;
  await t.test('precheck before apply is all 예 and the snapshot records the first shape',async()=>{
   for(const r of (await pool.query(precheck)).rows.filter(r=>!['recent migrations','folder row count','folder item row count','folder items whose project differs from the folder','folder items policy hash','folder trigger functions hash'].includes(r.item)))assert.equal(r.value,'예',r.item);
   assert.equal(before.filter(r=>r.kind==='function').length,2);assert.equal(before.filter(r=>r.kind==='items policy').length,1);
  });
  await t.test('prerequisite guard stops when the first migration is not recorded',async()=>{
   const c=await pool.connect();
   try{await c.query('begin');await c.query("delete from supabase_migrations.schema_migrations where version='20261022120000'");
    await assert.rejects(c.query(migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/LIBRARY_FOLDERS_FREE_PREREQUISITE_CHANGED/);}
   finally{await c.query('rollback');c.release();}
   assert.equal(await history(),0);
  });
  await t.test('apply succeeds once, postcheck is all 예, existing folders and links are unchanged, a second apply is refused',async()=>{
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal(await history(),1);
   assert.equal(JSON.stringify([(await pool.query('select id,project_id,parent_id,name,sort_order from public.app_library_folders order by id')).rows,(await pool.query('select document_id,folder_id from public.app_library_folder_items order by document_id')).rows]),rowsBefore);
   await assert.rejects(pool.query(migration),/LIBRARY_FOLDERS_FREE_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });
  let FX,FY,FN2,FZ;
  await t.test('folders nest across projects and documents of any project can be filed; the document project never changes',async()=>{
   FX=await owner(c=>folder(c,{project:PROJECT_A,label:'X'}));
   FY=await owner(c=>folder(c,{project:PROJECT_A2,parent:FX,label:'Y (다른 프로젝트 아래)'}));
   FN2=await owner(c=>folder(c,{project:null,parent:FY,label:'N (프로젝트 없음 아래)'}));
   FZ=await owner(c=>folder(c,{project:null,label:'Z'}));
   await owner(c=>place(c,D2,FX));await owner(c=>place(c,D4,FY));
   // D3 is already filed under the first shape (OLDN, no project): moving it into FX is an update of its one link.
   await owner(c=>c.query('update public.app_library_folder_items set folder_id=$1 where document_id=$2',[FX,D3]));
   assert.equal(await folderOf(D2),FX);assert.equal(await folderOf(D4),FY);
   // Moving a folder to another frame's parent and a document to another folder changes only the folder tables.
   await owner(c=>move(c,FZ,FX));assert.equal(await parentOf(FZ),FX);
   await owner(c=>c.query('update public.app_library_folder_items set folder_id=$1 where document_id=$2',[FZ,D2]));assert.equal(await folderOf(D2),FZ);
   assert.equal(await projectOf(D1),PROJECT_A);assert.equal(await projectOf(D2),PROJECT_A2);assert.equal(await projectOf(D3),null);assert.equal(await projectOf(D4),PROJECT_A);
   await owner(c=>move(c,FZ,null));assert.equal(await parentOf(FZ),null);
  });
  await t.test('still enforced: cycle, 3 levels, workspace, owner, project of the folder cannot be changed',async()=>{
   await assert.rejects(owner(c=>move(c,FX,FN2)),/LIB_FOLDER_CYCLE/);
   await assert.rejects(owner(c=>move(c,FX,FY)),/LIB_FOLDER_CYCLE/);
   await assert.rejects(owner(c=>folder(c,{parent:FN2,label:'4단',project:PROJECT_A2})),/LIB_FOLDER_DEPTH/);
   await assert.rejects(owner(c=>move(c,FZ,FN2)),/LIB_FOLDER_DEPTH/,'moving under level 3');
   await assert.rejects(owner(c=>place(c,DB,FX)),{code:'42501'},'document of another workspace');
   await assert.rejects(owner(c=>place(c,D1,FX,WS_B)),{code:'42501'},'link written for another workspace');
   await assert.rejects(owner(c=>folder(c,{project:PROJECT_B})),{code:'42501'},'project of another workspace');
   await assert.rejects(owner(c=>c.query('update public.app_library_folders set project_id=$1 where id=$2',[PROJECT_A2,FX])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('update public.app_library_folder_items set document_id=$1 where document_id=$2',[D1,D3])),{code:'42501'});
   await assert.rejects(owner(c=>place(c,D1,FX)),{code:'23505'},'one folder per document');
  });
  await t.test('stranger, no-login, anon and service_role see and change nothing',async()=>{
   await assert.rejects(stranger(c=>place(c,D3,FX)),{code:'42501'});
   await assert.rejects(stranger(c=>folder(c,{label:'남'})),{code:'42501'});
   assert.deepEqual((await stranger(c=>c.query('select id from public.app_library_folders'))).rows,[]);
   assert.deepEqual((await stranger(c=>c.query('select document_id from public.app_library_folder_items'))).rows,[]);
   assert.deepEqual((await as('authenticated',null,c=>c.query('select document_id from public.app_library_folder_items'))).rows,[]);
   for(const role of ['anon','service_role'])for(const sql of ['select 1 from public.app_library_folders','select 1 from public.app_library_folder_items','delete from public.app_library_folder_items'])
    await assert.rejects(as(role,null,c=>c.query(sql)),{code:'42501'},role+' '+sql);
   for(const role of ['anon','authenticated','service_role'])for(const fn of ['private.app_library_folder_tree_guard()','private.app_library_folder_lift()'])
    assert.equal((await pool.query('select has_function_privilege($1,$2,$3) ok',[role,fn,'execute'])).rows[0].ok,false,role+' '+fn);
  });
  await t.test('deleting a folder lifts folders and documents of any project one level up; a top folder only drops the links',async()=>{
   // FX > FY(D4) > FN2 ; FX holds D3. Delete FY → FN2 under FX, D4 under FX (D4 project A, FX project A: any project is lifted).
   await owner(c=>c.query('delete from public.app_library_folders where id=$1',[FY]));
   assert.equal(await parentOf(FN2),FX);assert.equal(await folderOf(D4),FX);
   // Put a document of another project into FN2 (project null) and delete FN2 → it lifts to FX.
   await owner(c=>c.query('update public.app_library_folder_items set folder_id=$1 where document_id=$2',[FN2,D2]));
   await owner(c=>c.query('delete from public.app_library_folders where id=$1',[FN2]));
   assert.equal(await folderOf(D2),FX);
   // Delete top folder FX → no folder left for its documents; documents stay with their projects.
   await owner(c=>c.query('delete from public.app_library_folders where id=$1',[FX]));
   assert.equal(await folderOf(D2),null);assert.equal(await folderOf(D3),null);assert.equal(await folderOf(D4),null);
   assert.equal(await projectOf(D2),PROJECT_A2);
   assert.equal((await pool.query('select count(*)::int n from public.app_documents where id = any($1)',[[D1,D2,D3,D4]])).rows[0].n,4);
  });
  await t.test('rollback restores the first shape without touching rows; the frame limit applies again; re-apply works',async()=>{
   const X=await owner(c=>folder(c,{project:PROJECT_A,label:'롤백 전 만든 것'})),Y=await owner(c=>folder(c,{project:PROJECT_A2,parent:X,label:'틀 넘은 아래'}));
   await owner(c=>place(c,D3,Y));
   const rows=JSON.stringify([(await pool.query('select id,project_id,parent_id,name from public.app_library_folders order by id')).rows,(await pool.query('select document_id,folder_id from public.app_library_folder_items order by document_id')).rows]);
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예','after rollback: '+r.item);
   assert.equal(JSON.stringify([(await pool.query('select id,project_id,parent_id,name from public.app_library_folders order by id')).rows,(await pool.query('select document_id,folder_id from public.app_library_folder_items order by document_id')).rows]),rows,'rows untouched');
   assert.deepEqual((await pool.query(snapshot)).rows.filter(r=>r.kind==='function'||r.kind==='items policy').map(r=>r.definition.replace(/\{\d+\}/,'')),before.filter(r=>r.kind==='function'||r.kind==='items policy').map(r=>r.definition.replace(/\{\d+\}/,'')),'first shape restored');
   await assert.rejects(owner(c=>place(c,D2,X)),{code:'42501'},'frame limit again');
   await assert.rejects(owner(c=>folder(c,{project:null,parent:X})),/LIB_FOLDER_SCOPE/);
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal(await history(),1);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
