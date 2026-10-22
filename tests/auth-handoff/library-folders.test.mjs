// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic.
// LIB-토글트리 ①: 20261022120000_library_folders — library-only folders and document → folder links, owner-only RLS,
// column grants, same-project scope, cycle/depth guard, lift-on-delete, project/document deletion, guarded rollback.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,PROJECT_A2,PROJECT_B} from './basket4-fixture.mjs';
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
const version='20261022120000',name='library_folders',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Production-like documents table: owner RLS (task12a), anon revoked, authenticated keeps ordinary DML.
// Project deletion clears project_id here with ON DELETE SET NULL (production does the same through
// private.app_unlink_retained_project_records before the project row goes).
const documents=`
  create table public.app_documents(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
    project_id uuid references public.app_spaces(id) on delete set null,title text,category text,visibility text default 'private');
  alter table public.app_documents enable row level security;
  create policy task12a_owner_all on public.app_documents for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke all on public.app_documents from anon;
  revoke truncate, references, trigger on public.app_documents from authenticated;
`;

test('library folders: migration, owner-only RLS, scope, cycle/depth guard, lift on delete, guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'lib-folders-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false});
  await pool.query(fixture);await pool.query(documents);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const doc=async(ws,project,title='자료')=>(await pool.query('insert into public.app_documents(workspace_id,project_id,title) values($1,$2,$3) returning id',[ws,project,title])).rows[0].id;
  // What the screen will send through PostgREST (caller JWT).
  const folder=(c,{ws=WS_A,project=PROJECT_A,parent=null,label='A 폴더',order=0}={})=>c.query('insert into public.app_library_folders(workspace_id,project_id,parent_id,name,sort_order) values($1,$2,$3,$4,$5) returning id',[ws,project,parent,label,order]).then(r=>r.rows[0].id);
  const place=(c,document,folderId,ws=WS_A)=>c.query('insert into public.app_library_folder_items(document_id,folder_id,workspace_id) values($1,$2,$3)',[document,folderId,ws]);
  const folderOf=async document=>(await pool.query('select folder_id from public.app_library_folder_items where document_id=$1',[document])).rows[0]?.folder_id??null;
  const parentOf=async id=>(await pool.query('select parent_id from public.app_library_folders where id=$1',[id])).rows[0]?.parent_id??null;

  await t.test('files: read-only checks, three-line summary, expanded approved workflow accepts the file',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'');
   assert.match(code,/^begin;\n/);assert.match(code,/\ncommit;\n$/);
   assert.doesNotMatch(code,/security definer|disable row level|to anon|to public|to service_role|alter policy|drop policy|rtw_/i);
   assert.doesNotMatch(code,/alter table public\.app_documents|on public\.app_documents/i,'documents table is not touched');
   for(const table of ['app_library_folders','app_library_folder_items'])
    assert.match(code,new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated, service_role;`));
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261022120000', 'library_folders'/);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/delete from public|update public|truncate|cascade|grant |policy/i);
  });
  const before=(await pool.query(snapshot)).rows;
  await t.test('precheck before apply is all 예 and the snapshot shows the absent tables',async()=>{
   for(const r of (await pool.query(precheck)).rows.filter(r=>r.item!=='recent migrations'))assert.equal(r.value,'예',r.item);
   assert.deepEqual(before.filter(r=>r.kind==='table').map(r=>r.definition),['absent','absent']);
  });
  await t.test('prerequisite guard stops when the project check function is missing',async()=>{
   const c=await pool.connect();
   try{await c.query('begin');await c.query('alter function private.app_space_in_workspace(uuid,uuid) rename to app_space_in_workspace_x');
    await assert.rejects(c.query(migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/LIBRARY_FOLDERS_PREREQUISITE_CHANGED/);}
   finally{await c.query('rollback');c.release();}
   assert.equal(await history(),0);
  });
  await t.test('apply succeeds once and postcheck is all 예; a second apply is refused',async()=>{
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal(await history(),1);
   await assert.rejects(pool.query(migration),/LIBRARY_FOLDERS_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  const D1=await doc(WS_A,PROJECT_A,'요구안'),D2=await doc(WS_A,PROJECT_A,'회의 자료'),D3=await doc(WS_A,null,'프로젝트 없는 자료'),D4=await doc(WS_A,PROJECT_A2,'다른 프로젝트 자료'),DB=await doc(WS_B,PROJECT_B,'남의 자료');
  let F1,F2,F3,FN;
  await t.test('owner makes folders in a project and in "no project", nests them and files documents',async()=>{
   F1=await owner(c=>folder(c,{label:'A 폴더'}));
   F2=await owner(c=>folder(c,{parent:F1,label:'B 폴더'}));
   F3=await owner(c=>folder(c,{parent:F2,label:'C 폴더'}));
   FN=await owner(c=>folder(c,{project:null,label:'프로젝트 없음 폴더'}));
   await owner(c=>place(c,D1,F2));await owner(c=>place(c,D2,F3));await owner(c=>place(c,D3,FN));
   assert.equal(await folderOf(D1),F2);assert.equal(await folderOf(D3),FN);
   // A document lives in one folder only; moving changes folder_id.
   await assert.rejects(owner(c=>place(c,D1,F1)),{code:'23505'});
   await owner(c=>c.query('update public.app_library_folder_items set folder_id=$1 where document_id=$2',[F1,D1]));
   assert.equal(await folderOf(D1),F1);
   // Rename and reorder.
   await owner(c=>c.query("update public.app_library_folders set name='A 폴더 새 이름', sort_order=2048 where id=$1",[F1]));
  });
  await t.test('scope: folder and document must share the project; parent must share it too',async()=>{
   await assert.rejects(owner(c=>place(c,D4,F1)),{code:'42501'},'document of another project');
   await assert.rejects(owner(c=>place(c,D3,F1)),{code:'42501'},'no-project document into a project folder');
   await assert.rejects(owner(c=>place(c,D1,FN)),{code:'42501'},'project document into a no-project folder');
   await assert.rejects(owner(c=>folder(c,{project:PROJECT_A2,parent:F1})),/LIB_FOLDER_SCOPE/);
   await assert.rejects(owner(c=>folder(c,{project:null,parent:F1})),/LIB_FOLDER_SCOPE/);
   await assert.rejects(owner(c=>c.query('update public.app_library_folders set parent_id=$1 where id=$2',[F1,FN])),/LIB_FOLDER_SCOPE/);
   await assert.rejects(owner(c=>folder(c,{project:PROJECT_B})),{code:'42501'},'project of another workspace');
  });
  await t.test('cycle and depth: no folder under itself or below it, at most 3 levels',async()=>{
   await assert.rejects(owner(c=>c.query('update public.app_library_folders set parent_id=$1 where id=$2',[F3,F1])),/LIB_FOLDER_CYCLE/);
   await assert.rejects(owner(c=>c.query('update public.app_library_folders set parent_id=$1 where id=$2',[F2,F1])),/LIB_FOLDER_CYCLE/);
   await assert.rejects(owner(c=>c.query('update public.app_library_folders set parent_id=id where id=$1',[F1])),{code:'23514'});
   await assert.rejects(owner(c=>folder(c,{parent:F3,label:'4단'})),/LIB_FOLDER_DEPTH/);
   const G=await owner(c=>folder(c,{label:'G'})),H=await owner(c=>folder(c,{parent:G,label:'H'}));
   await assert.rejects(owner(c=>c.query('update public.app_library_folders set parent_id=$1 where id=$2',[F2,G])),/LIB_FOLDER_DEPTH/,'moving a 2-level folder under level 2');
   await owner(c=>c.query('update public.app_library_folders set parent_id=$1 where id=$2',[F1,G]));assert.equal(await parentOf(G),F1);
   await owner(c=>c.query('delete from public.app_library_folders where id=$1',[H]));await owner(c=>c.query('delete from public.app_library_folders where id=$1',[G]));
  });
  await t.test('names are checked; project and workspace of a folder cannot be changed',async()=>{
   for(const [label,why] of [['','empty'],[' 앞공백','leading space'],['가'.repeat(41),'41 chars'],['줄\n바꿈','newline']])
    await assert.rejects(owner(c=>folder(c,{label})),{code:'23514'},why);
   assert.ok(await owner(c=>folder(c,{label:'가'.repeat(40)})));
   for(const col of [`project_id='${PROJECT_A2}'`,`workspace_id='${WS_B}'`,'id=gen_random_uuid()'])
    await assert.rejects(owner(c=>c.query('update public.app_library_folders set '+col+' where id=$1',[F1])),{code:'42501'},col);
   for(const col of [`document_id='${D2}'`,`workspace_id='${WS_B}'`])
    await assert.rejects(owner(c=>c.query('update public.app_library_folder_items set '+col+' where document_id=$1',[D1])),{code:'42501'},col);
   await assert.rejects(owner(c=>c.query('insert into public.app_library_folders(id,workspace_id,name) values(gen_random_uuid(),$1,$2)',[WS_A,'x'])),{code:'42501'});
  });
  await t.test('deleting a folder lifts its folders and documents one level up',async()=>{
   // F1 > F2 > F3(D2); D1 in F1. Delete F2 → F3 under F1, nothing lost.
   await owner(c=>c.query('delete from public.app_library_folders where id=$1',[F2]));
   assert.equal(await parentOf(F3),F1);assert.equal(await folderOf(D2),F3);assert.equal(await folderOf(D1),F1);
   // Delete F3 (under F1) → D2 to F1.
   await owner(c=>c.query('delete from public.app_library_folders where id=$1',[F3]));
   assert.equal(await folderOf(D2),F1);
   // Delete top folder F1 → documents leave the folder (project top), documents themselves stay.
   const child=await owner(c=>folder(c,{parent:F1,label:'아래'}));
   await owner(c=>c.query('delete from public.app_library_folders where id=$1',[F1]));
   assert.equal(await folderOf(D1),null);assert.equal(await folderOf(D2),null);assert.equal(await parentOf(child),null);
   assert.equal((await pool.query('select count(*)::int n from public.app_documents where id = any($1)',[[D1,D2]])).rows[0].n,2);
   await owner(c=>c.query('delete from public.app_library_folders where id=$1',[child]));
  });
  await t.test('a link left behind by a project change is dropped, not lifted into a wrong folder',async()=>{
   const P=await owner(c=>folder(c,{label:'P'})),Q=await owner(c=>folder(c,{parent:P,label:'Q'}));
   await owner(c=>place(c,D1,Q));
   await pool.query('update public.app_documents set project_id=$1 where id=$2',[PROJECT_A2,D1]); // changed on another screen
   await owner(c=>c.query('delete from public.app_library_folders where id=$1',[Q]));
   assert.equal(await folderOf(D1),null);
   await pool.query('update public.app_documents set project_id=$1 where id=$2',[PROJECT_A,D1]);
   await owner(c=>c.query('delete from public.app_library_folders where id=$1',[P]));
  });
  await t.test('deleting a project moves its folders to "no project" with their documents; deleting a document drops its link',async()=>{
   const P2=await owner(c=>folder(c,{project:PROJECT_A2,label:'P2'})),P2c=await owner(c=>folder(c,{project:PROJECT_A2,parent:P2,label:'P2 아래'}));
   await owner(c=>place(c,D4,P2c));
   await pool.query('delete from public.app_spaces where id=$1',[PROJECT_A2]);
   const rows=(await pool.query('select id,project_id,parent_id from public.app_library_folders where id = any($1) order by name',[[P2,P2c]])).rows;
   assert.deepEqual(rows.map(r=>r.project_id),[null,null]);assert.equal(await parentOf(P2c),P2);assert.equal(await folderOf(D4),P2c);
   await pool.query('delete from public.app_documents where id=$1',[D4]);
   assert.equal(await folderOf(D4),null);
   assert.equal((await pool.query('select count(*)::int n from public.app_library_folders where id = any($1)',[[P2,P2c]])).rows[0].n,2,'folders stay');
  });
  await t.test('stranger, no-login, anon and service_role see and change nothing',async()=>{
   await assert.rejects(stranger(c=>folder(c,{label:'남'})),{code:'42501'});
   await assert.rejects(owner(c=>folder(c,{ws:WS_B,project:PROJECT_B,label:'B에'})),{code:'42501'},'owner of A cannot write into B');
   assert.deepEqual((await stranger(c=>c.query('select id from public.app_library_folders'))).rows,[]);
   assert.deepEqual((await stranger(c=>c.query('select document_id from public.app_library_folder_items'))).rows,[]);
   assert.equal((await stranger(c=>c.query('delete from public.app_library_folders'))).rowCount,0);
   assert.equal((await stranger(c=>c.query("update public.app_library_folders set name='x'"))).rowCount,0);
   assert.deepEqual((await as('authenticated',null,c=>c.query('select id from public.app_library_folders'))).rows,[]);
   const SF=await stranger(c=>folder(c,{ws:WS_B,project:PROJECT_B,label:'남의 폴더'}));
   await assert.rejects(owner(c=>place(c,DB,SF,WS_B)),{code:'42501'},'owner of A cannot file into B');
   await assert.rejects(owner(c=>place(c,D3,SF,WS_A)),{code:'42501'},'folder of another workspace');
   for(const role of ['anon','service_role'])for(const sql of ['select 1 from public.app_library_folders','select 1 from public.app_library_folder_items',
     `insert into public.app_library_folders(workspace_id,name) values('${WS_A}','x')`,'delete from public.app_library_folders','delete from public.app_library_folder_items'])
    await assert.rejects(as(role,null,c=>c.query(sql)),{code:'42501'},role+' '+sql);
   for(const role of ['anon','authenticated','service_role'])for(const fn of ['private.app_library_folder_tree_guard()','private.app_library_folder_lift()'])
    assert.equal((await pool.query('select has_function_privilege($1,$2,$3) ok',[role,fn,'execute'])).rows[0].ok,false,role+' '+fn);
   await pool.query('delete from public.app_library_folders where id=$1',[SF]);
  });
  await t.test('rollback stops while folders exist; after they are removed it restores the snapshot; re-apply works',async()=>{
   await assert.rejects(pool.query(rollbackSQL),/LIBRARY_FOLDERS_ROLLBACK_BLOCKED: folders exist/);await pool.query('rollback');
   assert.equal(await history(),1);
   // One statement deleting a folder together with its parent fails as a whole (the lift trigger already moved the child):
   // nothing changes. The screen deletes one folder per request; cleanup goes leaf first.
   const before2=(await pool.query('select count(*)::int n from public.app_library_folders')).rows[0].n;
   await assert.rejects(pool.query('delete from public.app_library_folders where id is not null'),/already modified/);
   assert.equal((await pool.query('select count(*)::int n from public.app_library_folders')).rows[0].n,before2);
   await pool.query('delete from public.app_library_folder_items where document_id is not null');
   await pool.query('delete from public.app_library_folders where parent_id is not null');
   await pool.query('delete from public.app_library_folders where id is not null');
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal((await pool.query('select count(*)::int n from public.app_documents')).rows[0].n,4,'documents untouched');
   await pool.query(migration);assert.equal(await history(),1);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await pool?.end();
  await cluster?.stop();
 }
});
