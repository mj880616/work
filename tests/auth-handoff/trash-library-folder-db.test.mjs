// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic (no real folder or document names).
// TRASH-다른삭제 3단계: 20261025180000_trash_library_folder_db — 자료실 폴더(app_library_folders)의 [폴더 지우기]도 휴지통(deleted_at·deleted_root_id)으로 간다.
// 숨김 정책(restrictive)·삭제 가로채기 트리거(기존 lift 트리거보다 먼저)·app_trash_list/restore/purge의 새 종류 library_folder, 앞 단계 휴지통 그대로.
// 앞 단계 20261024193000_trash_projects_db, 20261025100000_trash_org_report_db, 20261022120000_library_folders를 진짜 파일로 먼저 적용한다.
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
const version='20261025180000',name='trash_library_folder_db',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const id=n=>`29000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const WS_C='21000000-0000-4000-8000-0000000000c3';

// Existing shapes: the project tree the project trash needs, the organization and report tables the previous step needs, and the production-like
// documents table (owner RLS) the library folders hang on. Nothing here comes from production.
const docsDDL=`create table public.app_documents(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
    project_id uuid references public.app_spaces(id) on delete set null,workstream_id uuid references public.app_project_workstreams(id),title text,category text,visibility text default 'private');
  alter table public.app_documents enable row level security;
  create policy task12a_owner_all on public.app_documents for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke all on public.app_documents from anon;
  revoke truncate, references, trigger on public.app_documents from authenticated;
`;
const shapes=`
  alter table public.app_spaces add column owner_id uuid default '${OWNER}', add column name text not null default 'p',
    add column parent_id uuid references public.app_spaces(id) on delete cascade, add column status text default 'active',
    add column sort_order integer default 0;
  create table public.app_project_workstreams(id uuid primary key, project_id uuid not null references public.app_spaces(id) on delete cascade, title text);
  create table public.app_project_progress_updates(id uuid primary key, project_id uuid not null references public.app_spaces(id) on delete cascade, body text);
  create table public.app_tasks(id uuid primary key, workspace_id uuid not null, project_id uuid references public.app_spaces(id),
    workstream_id uuid references public.app_project_workstreams(id), source_type text, source_id uuid, title text);
  create table public.app_events(id uuid primary key, workspace_id uuid not null, project_id uuid references public.app_spaces(id),
    workstream_id uuid references public.app_project_workstreams(id));
  alter table public.app_meetings add column project_id uuid references public.app_spaces(id), add column workstream_id uuid references public.app_project_workstreams(id);
  ${docsDDL}
  create table public.app_pages(id uuid primary key, workspace_id uuid not null, space_id uuid references public.app_spaces(id),
    workstream_id uuid references public.app_project_workstreams(id));
  grant select, insert, update, delete on public.app_spaces, public.app_project_workstreams, public.app_project_progress_updates,
    public.app_tasks, public.app_events, public.app_meetings, public.app_documents, public.app_pages to authenticated;
  alter table public.app_spaces enable row level security;
  create policy synthetic_spaces_owner on public.app_spaces for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));`;
const shapes2=`
  alter table public.app_suborganizations add column active boolean default true;
  alter table public.app_meetings add column series_name text, add column round_no integer, add column meeting_at timestamptz,
    add column activity_kind text not null default 'meeting';
  alter table public.app_suborganizations drop constraint app_suborganizations_workspace_id_fkey,
    add constraint app_suborganizations_workspace_id_fkey foreign key (workspace_id) references public.app_workspaces(id) on delete cascade;
  alter table public.app_meetings drop constraint app_meetings_workspace_id_fkey,
    add constraint app_meetings_workspace_id_fkey foreign key (workspace_id) references public.app_workspaces(id) on delete cascade;
  alter table public.app_meetings enable row level security;
  create policy task12a_owner_all on public.app_meetings for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  grant select, insert, update, delete on public.app_suborganizations, public.app_meetings to authenticated;
  -- 운영 모양: service_role에는 schema private USAGE가 없다.
  revoke usage on schema private from service_role;`;

test('TRASH 3단계: 자료실 폴더 휴지통 — prechecks, apply, delete goes to trash as one group and keeps items, hidden from reads, owner-only list/restore/purge, lift on purge, earlier steps unchanged, rollback',{timeout:180000},async t=>{
 let cluster,pool;
 const directory=await mkdtemp(join(tmpdir(),'trash-library-folder-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex');
 cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 await cluster.initialise();await cluster.start();
 try{
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(shapes);
  await pool.query(shapes2);
  await pool.query('delete from public.app_spaces');await pool.query('delete from public.app_suborganizations');await pool.query('delete from public.app_meetings');
  for(const file of ['20260921231000_fix_project_delete_workstream_unlink','20261021053502_prj_depth_guard','20261022120000_library_folders','20261024193000_trash_projects_db','20261025100000_trash_org_report_db'])
   await pool.query(await read('supabase/migrations/'+file+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const v=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value??r.ok]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn);
  const rpc=(sub,fn,...args)=>as('authenticated',sub,c=>c.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)).then(x=>x.rows[0].r);
  const del=n=>owner(c=>c.query('delete from public.app_library_folders where id=$1',[id(n)]));
  const visible=async list=>(await owner(c=>c.query('select id from public.app_library_folders where id=any($1) order by id',[list.map(id)]))).rows.map(r=>r.id);
  const state=async n=>(await pool.query('select deleted_at is not null trashed, deleted_root_id root, parent_id parent from public.app_library_folders where id=$1',[id(n)])).rows[0];
  const exists=async n=>(await pool.query('select count(*)::int n from public.app_library_folders where id=$1',[id(n)])).rows[0].n;
  const itemFolder=async d=>(await pool.query('select folder_id from public.app_library_folder_items where document_id=$1',[id(d)])).rows[0]?.folder_id??null;
  const itemCount=async()=>(await pool.query('select count(*)::int n from public.app_library_folder_items')).rows[0].n;
  const mkFolder=(n,{ws=WS_A,project=id(901),parent=null,label}={})=>pool.query('insert into public.app_library_folders(id,workspace_id,project_id,parent_id,name) values($1,$2,$3,$4,$5)',[id(n),ws,project,parent?id(parent):null,label||'폴더 '+n]);
  const mkDoc=(n,project=id(901),ws=WS_A)=>pool.query('insert into public.app_documents(id,workspace_id,project_id,title) values($1,$2,$3,$4)',[id(n),ws,project,'자료 '+n]);
  const put=(d,f,ws=WS_A)=>pool.query('insert into public.app_library_folder_items(document_id,folder_id,workspace_id) values($1,$2,$3)',[id(d),id(f),ws]);
  // Synthetic data: projects 901 (owner), 902 (owner); folder tree F1 > F2 > F3 (+ F4 under F2? no: depth 3 max) plus an unrelated top folder 10 and a stranger's folder 50.
  await pool.query('insert into public.app_spaces(id,workspace_id,owner_id,name) values($1,$2,$3,$4),($5,$2,$3,$6),($7,$8,$9,$10)',[id(901),WS_A,OWNER,'시험 프로젝트',id(902),'다른 프로젝트',id(903),WS_B,STRANGER,'남의 프로젝트']);
  await mkFolder(1);await mkFolder(2,{parent:1});await mkFolder(3,{parent:2});await mkFolder(10);await mkFolder(11,{project:null});await mkFolder(50,{ws:WS_B,project:id(903)});
  for(const d of [201,202,203,204,205])await mkDoc(d);
  await mkDoc(206,null);await mkDoc(250,id(903),WS_B);
  await put(201,1);await put(202,2);await put(203,3);await put(204,10);await put(206,11);await put(250,50,WS_B);
  let madeId=null;
  const parentOf=async n=>(await pool.query('select parent_id from public.app_library_folders where id=$1',[id(n)])).rows[0]?.parent_id??null;
  const before=(await pool.query(snapshot)).rows,beforeCheck=v((await pool.query(precheck)).rows),itemsBefore=await itemCount();

  await t.test('pair files pass the workflow parser; the migration takes the approval-once expanded flow',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.targets.sort(),['app_library_folders']);
   assert.deepEqual(plan.review.definer.sort(),['private.app_trash_library_folder_before_delete','public.app_trash_list','public.app_trash_purge','public.app_trash_restore']);
   assert.equal(plan.review.policies,1);assert.equal(plan.review.restrictive,1);assert.equal(plan.review.triggers,1);
   const dry=prepareMigration({mode:'dry-run',version,runId:'1',root});assert.equal(dry.rules,'expanded');
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'');
   assert.match(code,/^begin;\n/);assert.match(code,/\ncommit;\n$/);
   assert.doesNotMatch(code,/to (anon|public)\b|rtw_|disable row level|drop policy|alter policy|as permissive|grant [^;]*service_role|app_documents/i);
   assert.match(code,/create policy app_library_folders_trash_hidden on public\.app_library_folders as restrictive for all to authenticated/);
   assert.match(code,/create trigger app_library_folders_a_trash_before_delete\s+before delete on public\.app_library_folders/);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261025180000', 'trash_library_folder_db'/);
   // the trigger function never calls a private function (service_role has no schema private USAGE in production)
   const fn=/create function private\.app_trash_library_folder_before_delete\(\)[\s\S]*?\n\$\$;/.exec(code)[0].replace(/create function private\.app_trash_library_folder_before_delete/,'');
   assert.doesNotMatch(fn,/private\./);
   assert.match(rollbackSQL,/SQL Editor\(폰 경로 C\) 전용/);
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
  });
  await t.test('precheck: every condition is 예',()=>{
   const yes=Object.entries(beforeCheck).filter(([,x])=>x==='예'||x==='아니오');
   assert.equal(yes.length,13,'예/아니오 항목 수');
   for(const [k,x] of yes)assert.equal(x,'예',k);
   assert.equal(beforeCheck['folder row count'],'6');assert.equal(beforeCheck['folder item row count'],'6');
   assert.match(beforeCheck['before delete trigger names'],/^app_library_folders\.app_library_folders_lift_on_delete$/);
  });
  await t.test('apply refuses (and changes nothing) when an earlier before-delete trigger exists, the previous step is missing, or the RPCs are not the previous shape',async()=>{
   await pool.query(`create function private.synthetic_noop() returns trigger language plpgsql as $$begin return old; end$$;
     create trigger app_library_folders_0_other before delete on public.app_library_folders for each row execute function private.synthetic_noop();`);
   assert.equal(v((await pool.query(precheck)).rows)['no earlier before delete trigger'],'아니오');
   await assert.rejects(pool.query(migration),/TRASH_LIBRARY_FOLDER_PREREQUISITE_CHANGED/);await pool.query('rollback');
   await pool.query('drop trigger app_library_folders_0_other on public.app_library_folders; drop function private.synthetic_noop();');
   await pool.query("update supabase_migrations.schema_migrations set name='x' where version='20261025100000'");
   assert.equal(v((await pool.query(precheck)).rows)['previous trash_org_report_db recorded'],'아니오');
   await assert.rejects(pool.query(migration),/TRASH_LIBRARY_FOLDER_PREREQUISITE_CHANGED/);await pool.query('rollback');
   await pool.query("update supabase_migrations.schema_migrations set name='trash_org_report_db' where version='20261025100000'");
   // a different guard trigger name means the lift/guard pair differs from what this migration was written for
   await pool.query('alter table public.app_library_folders disable trigger app_library_folders_lift_on_delete');
   assert.equal(v((await pool.query(precheck)).rows)['existing folder guard and lift triggers present'],'아니오');
   await pool.query('alter table public.app_library_folders enable trigger app_library_folders_lift_on_delete');
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(v((await pool.query(precheck)).rows),beforeCheck);
  });
  await t.test('dry-run (last commit -> rollback) leaves no trace; apply passes postcheck',async()=>{
   await pool.query(migration.replace(/commit;\s*$/,'rollback;'));
   assert.equal(await history(),0);assert.deepEqual(v((await pool.query(precheck)).rows),beforeCheck);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await pool.query(migration);
   assert.equal(await history(),1);
   const post=v((await pool.query(postcheck)).rows);
   for(const [k,x] of Object.entries(post)){
    if(x==='예'||x==='아니오')assert.equal(x,'예',k);
    else assert.equal(x,beforeCheck[k],k); // 숫자·해시·목록 항목은 사전 확인과 같다
   }
   for(const k of ['objects and history agree','trash installed','folder trash trigger runs first','existing folder guard and lift triggers still present','organization and report trash still installed','project trash still installed'])assert.equal(post[k],'예',k);
   const fns=(await pool.query(`select p.oid::regprocedure::text f,has_function_privilege('anon',p.oid,'execute') a,has_function_privilege('authenticated',p.oid,'execute') u,
     has_function_privilege('service_role',p.oid,'execute') s from pg_proc p where proname like 'app_trash_%' order by 1`)).rows;
   assert.deepEqual(fns.map(f=>[f.f,f.a,f.u,f.s]),[['app_trash_list(text)',false,true,false],['app_trash_purge(text,uuid)',false,true,false],
    ['app_trash_restore(text,uuid)',false,true,false],['private.app_trash_library_folder_before_delete()',false,false,false],['private.app_trash_org_before_delete()',false,false,false],
    ['private.app_trash_report_before_delete()',false,false,false],['private.app_trash_space_before_delete()',false,false,false]]);
   assert.equal((await pool.query("select has_schema_privilege('service_role','private','usage') u")).rows[0].u,false);
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid='public.app_library_folders'::regclass and polname='app_library_folders_trash_hidden' and not polpermissive and polroles=array[(select oid from pg_roles where rolname='authenticated')]")).rows[0].n,1);
   // the new columns cannot be written by the screen role and the table stays closed to service_role
   for(const col of ['deleted_at','deleted_root_id'])for(const priv of ['insert','update'])assert.equal((await pool.query("select has_column_privilege('authenticated','public.app_library_folders',$1,$2) g",[col,priv])).rows[0].g,false,col+priv);
   assert.equal((await pool.query("select has_table_privilege('service_role','public.app_library_folders','select') g")).rows[0].g,false);
  });
  await t.test('the existing screen DELETE moves the folder and everything below it to the trash as one group; items and documents stay',async()=>{
   assert.equal((await visible([1,2,3,10])).length,4);
   assert.equal((await del(1)).rowCount,0); // nothing is deleted; PostgREST answers the same 204
   assert.deepEqual(await visible([1,2,3,10]),[id(10)]);
   for(const n of [1,2,3])assert.deepEqual([(await state(n)).trashed,(await state(n)).root],[true,id(1)],'folder '+n);
   // nothing was lifted: the tree is as it was
   assert.equal((await state(2)).parent,id(1));assert.equal((await state(3)).parent,id(2));
   assert.deepEqual([await itemFolder(201),await itemFolder(202),await itemFolder(203)],[id(1),id(2),id(3)]);
   assert.equal(await itemCount(),itemsBefore);
   assert.equal((await pool.query('select count(*)::int n from public.app_documents')).rows[0].n,7);
   assert.deepEqual(await state(10),{trashed:false,root:null,parent:null});
   // the screen still reads the items; their folder is the only thing it no longer sees (the screen hides those documents from the library list)
   const seen=(await owner(c=>c.query('select document_id from public.app_library_folder_items where document_id=any($1) order by document_id',[[201,202,203].map(id)]))).rows;
   assert.equal(seen.length,3);
  });
  await t.test('the screen cannot see, change, re-delete or forge trash folders, nor file into or under them',async()=>{
   assert.equal((await owner(c=>c.query("update public.app_library_folders set name='고침' where id=$1",[id(2)]))).rowCount,0);
   assert.equal((await del(2)).rowCount,0);assert.equal((await del(1)).rowCount,0);
   for(const n of [1,2,3])assert.equal((await state(n)).trashed,true);
   await assert.rejects(owner(c=>c.query('update public.app_library_folders set deleted_at=now() where id=$1',[id(10)])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('update public.app_library_folders set deleted_root_id=id where id=$1',[id(10)])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_library_folders(workspace_id,project_id,name,deleted_at) values($1,$2,'위조',now())",[WS_A,id(901)])),{code:'42501'});
   // filing a document into a trashed folder or making a folder under it is refused (the existing checks cannot see the trashed folder)
   await assert.rejects(owner(c=>c.query('update public.app_library_folder_items set folder_id=$1 where document_id=$2',[id(1),id(204)])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('insert into public.app_library_folder_items(document_id,folder_id,workspace_id) values($1,$2,$3)',[id(205),id(3),WS_A])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('insert into public.app_library_folders(workspace_id,project_id,parent_id,name) values($1,$2,$3,$4)',[WS_A,id(901),id(2),'아래'])),/LIB_FOLDER_SCOPE/);
   await assert.rejects(owner(c=>c.query('update public.app_library_folders set parent_id=$1 where id=$2',[id(1),id(10)])),/LIB_FOLDER_SCOPE/);
   // other saves still work: normal edit, insert and delete (which also goes to the trash)
   await owner(c=>c.query("update public.app_library_folders set name='고친 이름' where id=$1",[id(10)]));
   const made=(await owner(c=>c.query("insert into public.app_library_folders(workspace_id,project_id,name) values($1,$2,'새 폴더') returning id",[WS_A,id(901)]))).rows[0].id;
   await owner(c=>c.query('delete from public.app_library_folders where id=$1',[made]));
   madeId=made;
   assert.deepEqual((await pool.query('select deleted_root_id r, deleted_at is not null t from public.app_library_folders where id=$1',[made])).rows[0],{r:made,t:true});
  });
  await t.test('app_trash_list: owner sees the group roots with counts and project name; stranger sees nothing; anon cannot call; unknown kind refused',async()=>{
   const list=await rpc(OWNER,'app_trash_list','library_folder');
   assert.deepEqual(list.map(x=>x.id).sort(),[id(1),madeId].sort());
   const r=list.find(x=>x.id===id(1));
   assert.deepEqual({kind:r.kind,name:r.name,project:r.project_id,project_name:r.project_name,parent:r.parent_id,children:r.child_count,files:r.file_count,parent_in_trash:r.parent_in_trash,ws:r.workspace_id,has_at:!!r.deleted_at},
    {kind:'library_folder',name:'폴더 1',project:id(901),project_name:'시험 프로젝트',parent:null,children:2,files:3,parent_in_trash:false,ws:WS_A,has_at:true});
   assert.deepEqual(await rpc(STRANGER,'app_trash_list','library_folder'),[]);
   await assert.rejects(rpc(OWNER,'app_trash_list','library'),/TRASH_KIND_UNKNOWN/);
   for(const call of [`select public.app_trash_list('library_folder')`,`select public.app_trash_restore('library_folder','${id(1)}')`,`select public.app_trash_purge('library_folder','${id(1)}')`])
    await assert.rejects(as('anon','',c=>c.query(call)),{code:'42501'},call);
   await assert.rejects(as('service_role','',c=>c.query("select public.app_trash_list('library_folder')")),{code:'42501'});
  });
  await t.test('app_trash_restore: only the owner, only a group root; the whole group comes back with its items; twice is refused',async()=>{
   await assert.rejects(rpc(STRANGER,'app_trash_restore','library_folder',id(1)),/TRASH_NOT_FOUND/);
   await assert.rejects(rpc(OWNER,'app_trash_restore','library_folder',id(2)),/TRASH_NOT_FOUND/); // a folder inside the group is not restored on its own
   await assert.rejects(rpc(OWNER,'app_trash_restore','library_folder',id(10)),/TRASH_NOT_FOUND/); // not in the trash
   await assert.rejects(rpc(OWNER,'app_trash_restore','library_folder',id(50)),/TRASH_NOT_FOUND/);
   await assert.rejects(rpc(OWNER,'app_trash_restore','task',id(1)),/TRASH_KIND_UNKNOWN/);
   assert.deepEqual(await rpc(OWNER,'app_trash_restore','library_folder',id(1)),{ok:true,kind:'library_folder',id:id(1),restored:3});
   assert.deepEqual(await visible([1,2,3]),[id(1),id(2),id(3)]);
   assert.deepEqual([(await state(2)).parent,(await state(3)).parent,(await state(2)).root],[id(1),id(2),null]);
   assert.deepEqual([await itemFolder(201),await itemFolder(202),await itemFolder(203)],[id(1),id(2),id(3)]);
   await assert.rejects(rpc(OWNER,'app_trash_restore','library_folder',id(1)),/TRASH_NOT_FOUND/);
  });
  await t.test('a folder trashed on its own stays its own group; its parent must come back first',async()=>{
   await del(3); // F3 alone
   await del(1); // F1 > F2 (F3 already in the trash keeps its own group)
   assert.deepEqual([(await state(3)).root,(await state(2)).root,(await state(1)).root],[id(3),id(1),id(1)]);
   const roots=(await rpc(OWNER,'app_trash_list','library_folder')).filter(x=>[1,3].map(id).includes(x.id));
   assert.deepEqual(roots.map(x=>[x.id,x.child_count,x.parent_in_trash]).sort(),[[id(1),1,false],[id(3),0,true]].sort());
   await assert.rejects(rpc(OWNER,'app_trash_restore','library_folder',id(3)),/TRASH_PARENT_IN_TRASH/);
   assert.deepEqual(await rpc(OWNER,'app_trash_restore','library_folder',id(1)),{ok:true,kind:'library_folder',id:id(1),restored:2});
   assert.deepEqual(await visible([1,2,3]),[id(1),id(2)]);
   assert.deepEqual(await rpc(OWNER,'app_trash_restore','library_folder',id(3)),{ok:true,kind:'library_folder',id:id(3),restored:1});
   assert.deepEqual(await visible([1,2,3]),[id(1),id(2),id(3)]);
  });
  await t.test('restore refuses when the parent was moved so deep that the group would pass 3 levels',async()=>{
   await mkFolder(30);await mkFolder(31,{parent:30});
   await del(3); // F3 (own group) under F2 under F1
   // F1 > F2 now has two visible levels; put F1 under folder 30 (30 > 1 > 2 is 3 levels, F3 below would be a fourth)
   await owner(c=>c.query('update public.app_library_folders set parent_id=$1 where id=$2',[id(30),id(1)]));
   await assert.rejects(rpc(OWNER,'app_trash_restore','library_folder',id(3)),/LIB_FOLDER_DEPTH/);
   assert.equal((await state(3)).trashed,true);
   // put F1 back at the top and F3 comes back
   await owner(c=>c.query('update public.app_library_folders set parent_id=null where id=$1',[id(1)]));
   await rpc(OWNER,'app_trash_restore','library_folder',id(3));
   assert.equal((await state(3)).trashed,false);
  });
  await t.test('a stranger\'s folder is untouched by the owner paths',async()=>{
   assert.deepEqual(await state(50),{trashed:false,root:null,parent:null});
   await assert.rejects(rpc(OWNER,'app_trash_purge','library_folder',id(50)),/TRASH_NOT_FOUND/);
   assert.equal(await exists(50),1);
  });
  await t.test('app_trash_purge: owner only, trash roots only; then the old delete runs and lifts the folders and documents one level up',async()=>{
   await assert.rejects(rpc(OWNER,'app_trash_purge','library_folder',id(1)),/TRASH_NOT_FOUND/); // not in the trash
   await del(1); // F1(top) > F2 > F3, items 201 in F1, 202 in F2, 203 in F3
   await assert.rejects(rpc(STRANGER,'app_trash_purge','library_folder',id(1)),/TRASH_NOT_FOUND/);
   await assert.rejects(rpc(OWNER,'app_trash_purge','library_folder',id(2)),/TRASH_NOT_FOUND/); // not a group root
   assert.deepEqual(await rpc(OWNER,'app_trash_purge','library_folder',id(1)),{ok:true,kind:'library_folder',id:id(1)});
   assert.equal(await exists(1),0);
   // F2 and F3 are visible again, F2 went up to the top (F1 was a top folder), F3 stays under F2; F1's own document left the folder (project top level)
   assert.deepEqual(await visible([2,3]),[id(2),id(3)]);
   assert.deepEqual([(await state(2)).parent,(await state(3)).parent,(await state(2)).trashed,(await state(3)).root],[null,id(2),false,null]);
   assert.deepEqual([await itemFolder(201),await itemFolder(202),await itemFolder(203)],[null,id(2),id(3)]);
   assert.equal((await pool.query('select count(*)::int n from public.app_documents where id=$1',[id(201)])).rows[0].n,1); // the document itself is never deleted
  });
  await t.test('purging a folder whose own parent went to the trash later puts its group under that parent\'s group',async()=>{
   await mkFolder(40);await mkFolder(41,{parent:40});await mkFolder(42,{parent:41});await mkDoc(240);await put(240,42);
   await del(41); // R = 41 with 42
   await del(40); // P = 40 (41 stays its own group)
   assert.deepEqual([(await state(42)).root,(await state(41)).root,(await state(40)).root],[id(41),id(41),id(40)]);
   await rpc(OWNER,'app_trash_purge','library_folder',id(41));
   assert.equal(await exists(41),0);
   // 42 was lifted under 40 and now follows 40's group instead of showing under a hidden parent
   assert.deepEqual([(await state(42)).parent,(await state(42)).trashed,(await state(42)).root],[id(40),true,id(40)]);
   assert.equal(await itemFolder(240),id(42));
   assert.deepEqual(await rpc(OWNER,'app_trash_restore','library_folder',id(40)),{ok:true,kind:'library_folder',id:id(40),restored:2});
   assert.deepEqual(await visible([40,42]),[id(40),id(42)]);
  });
  await t.test('purging the project of a trashed folder detaches the folder as before (set null); the folder stays in the trash',async()=>{
   await mkFolder(60,{project:id(902)});await del(60);
   await owner(c=>c.query('delete from public.app_spaces where id=$1',[id(902)]));
   await rpc(OWNER,'app_trash_purge','project',id(902));
   const row=(await pool.query('select project_id, deleted_root_id from public.app_library_folders where id=$1',[id(60)])).rows[0];
   assert.deepEqual([row.project_id,row.deleted_root_id],[null,id(60)]);
   assert.equal((await rpc(OWNER,'app_trash_list','library_folder')).find(x=>x.id===id(60)).project_id,null);
   await rpc(OWNER,'app_trash_restore','library_folder',id(60));
  });
  await t.test('deleting a whole workspace still removes its folders for real (cascade, trigger depth 2)',async()=>{
   await pool.query('insert into public.app_workspaces(id) values($1)',[WS_C]);
   await mkFolder(70,{ws:WS_C,project:null});await mkFolder(71,{ws:WS_C,project:null,parent:70});
   await pool.query('delete from public.app_workspaces where id=$1',[WS_C]);
   assert.equal((await exists(70))+(await exists(71)),0);
  });
  await t.test('the earlier trash kinds still work as before (project, organization, report)',async()=>{
   await pool.query('insert into public.app_suborganizations(id,workspace_id,name) values($1,$2,$3)',[id(801),WS_A,'시험 조직']);
   await pool.query('insert into public.app_meetings(id,workspace_id,title) values($1,$2,$3)',[id(802),WS_A,'시험 보고']);
   await owner(c=>c.query('delete from public.app_suborganizations where id=$1',[id(801)]));await owner(c=>c.query('delete from public.app_meetings where id=$1',[id(802)]));
   assert.deepEqual((await rpc(OWNER,'app_trash_list','organization')).map(x=>x.id),[id(801)]);assert.deepEqual((await rpc(OWNER,'app_trash_list','report')).map(x=>x.id),[id(802)]);
   assert.deepEqual(await rpc(OWNER,'app_trash_restore','organization',id(801)),{ok:true,kind:'organization',id:id(801),restored:1});
   assert.deepEqual(await rpc(OWNER,'app_trash_restore','report',id(802)),{ok:true,kind:'report',id:id(802),restored:1});
   await owner(c=>c.query('insert into public.app_spaces(id,workspace_id,owner_id,name) values($1,$2,$3,$4)',[id(810),WS_A,OWNER,'프로젝트 시험']));
   await owner(c=>c.query('delete from public.app_spaces where id=$1',[id(810)]));
   assert.deepEqual((await rpc(OWNER,'app_trash_list','project')).map(x=>[x.id,x.child_count]),[[id(810),0]]);
   assert.deepEqual(await rpc(OWNER,'app_trash_purge','project',id(810)),{ok:true,kind:'project',id:id(810)});
  });
  await t.test('running the migration again is refused and keeps one history row',async()=>{
   await assert.rejects(pool.query(migration),/TRASH_LIBRARY_FOLDER_PREREQUISITE_CHANGED/);await pool.query('rollback');
   assert.equal(await history(),1);
  });
  await t.test('rollback removes only the new trash pieces; trashed folders come back in place; earlier trash and RPC names stay; folder delete lifts again',async()=>{
   await mkFolder(90);await mkFolder(91,{parent:90});await mkDoc(290);await put(290,91);
   await del(90);
   assert.deepEqual(await visible([90,91]),[]);
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   const post=v((await pool.query(postcheck)).rows);
   assert.equal(post['objects and history agree'],'예');assert.equal(post['trash installed'],'아니오');
   assert.equal(post['organization and report trash still installed'],'예');assert.equal(post['project trash still installed'],'예');
   assert.deepEqual(await visible([90,91]),[id(90),id(91)]);
   assert.equal(await parentOf(91),id(90));assert.equal(await itemFolder(290),id(91));
   // the delete is immediate again and the old lift moves the child up
   assert.equal((await del(90)).rowCount,1);
   assert.equal(await parentOf(91),null);assert.equal(await itemFolder(290),id(91));
   // the RPCs are the previous shape again (same names, same grants); organization and project trash intact
   await assert.rejects(rpc(OWNER,'app_trash_list','library_folder'),/TRASH_KIND_UNKNOWN/);
   assert.deepEqual(await rpc(OWNER,'app_trash_list','organization'),[]);
   assert.equal((await pool.query("select count(*)::int n from pg_proc where proname in ('app_trash_list','app_trash_restore','app_trash_purge') and not has_function_privilege('anon',oid,'execute') and has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('service_role',oid,'execute')")).rows[0].n,3);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const after=v((await pool.query(precheck)).rows);
   for(const [k,x] of Object.entries(after))if(x==='예'||x==='아니오')assert.equal(x,'예',k);
   await pool.query(migration);assert.equal(await history(),1);
   assert.equal(v((await pool.query(postcheck)).rows)['trash installed'],'예');
   await pool.query(rollbackSQL);assert.equal(await history(),0);
  });
 }finally{
  await closePool(pool);
  if(cluster)await cluster.stop().catch(()=>{});
 }
});
