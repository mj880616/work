// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic (no real folder or document names).
// TRASH-다른삭제 공유 페이지 단계: 20261027050000_trash_share_pages_db — 공유 페이지(app_share_pages)의 [삭제]는 휴지통(deleted_at)으로 간다. 보관(archived)은 그대로 따로 둔다.
// 숨김 정책(restrictive)·삭제 가로채기 트리거(status를 archived로 닫아 공개 링크가 열리지 않음)·app_trash_list/restore/purge의 새 종류 share_page, 앞 단계 휴지통 그대로.
// 앞 단계 휴지통 migration들과 공유 페이지 표 migration들(links·doc_block·media·archived_status)을 진짜 파일로 먼저 적용한다.
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
import {createShareReadHandler} from '../../supabase/functions/share-page-read/handler.ts';
const version='20261027050000',name='trash_share_pages_db',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const id=n=>`2a000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
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

test('TRASH 공유 페이지: prechecks, apply, delete goes to trash and closes the public link, archive stays separate, hidden from reads, owner-only list/restore/purge, earlier steps unchanged, rollback',{timeout:180000},async t=>{
 let cluster,pool,madeId=null;
 const directory=await mkdtemp(join(tmpdir(),'trash-share-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex');
 cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 await cluster.initialise();await cluster.start();
 try{
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(shapes);
  await pool.query(shapes2);
  await pool.query("alter table public.app_spaces add column metadata jsonb default '{\"project_system\":\"v2\"}'");
  await pool.query('delete from public.app_spaces');await pool.query('delete from public.app_suborganizations');await pool.query('delete from public.app_meetings');
  for(const file of ['20260921231000_fix_project_delete_workstream_unlink','20261021053502_prj_depth_guard','20261022120000_library_folders','20261024193000_trash_projects_db','20261025100000_trash_org_report_db','20261025180000_trash_library_folder_db',
    '20260927103344_task_impl2_notes_record_links','20260928123601_task_meeting_followup_record_links','20261010120000_basket1_notes_links','20261011180000_basket4a_confirm_links','20261012100000_basket_link_view_db',
    '20261013034836_basket_photo_ocr_db','20261017052234_journal_memo_notes_kind','20261020051027_journal_work_lines','20261026100000_trash_notes_db',
    '20261020005000_share_pages_links','20261022130000_share_pages_doc_block','20261023110000_share_page_media','20261023160000_share_pages_archived_status'])
   await pool.query(await read('supabase/migrations/'+file+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const v=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value??r.ok]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn);
  const rpc=(sub,fn,...args)=>as('authenticated',sub,c=>c.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)).then(x=>x.rows[0].r);
  const del=n=>owner(c=>c.query('delete from public.app_share_pages where id=$1',[id(n)]));
  const visible=async list=>(await owner(c=>c.query('select id from public.app_share_pages where id=any($1) order by id',[list.map(id)]))).rows.map(r=>r.id);
  const state=async n=>(await pool.query('select deleted_at is not null trashed, deleted_status, status, updated_at, blocks, title from public.app_share_pages where id=$1',[id(n)])).rows[0];
  const exists=async n=>(await pool.query('select count(*)::int n from public.app_share_pages where id=$1',[id(n)])).rows[0].n;
  const count=async(table,col,n)=>(await pool.query(`select count(*)::int n from public.${table} where ${col}=$1`,[id(n)])).rows[0].n;
  const mk=(n,{ws=WS_A,status='draft',title='합성 페이지 '+n}={})=>pool.query('insert into public.app_share_pages(id,workspace_id,title,status) values($1,$2,$3,$4)',[id(n),ws,title,status]);
  const mkLink=async(n)=>(await pool.query('insert into public.app_share_page_links(workspace_id,page_id) values($1,$2) returning token',[WS_A,id(n)])).rows[0].token;
  const mkMedia=(n,m)=>pool.query("insert into public.app_share_page_media(id,workspace_id,page_id,storage_path,width,height,bytes) values($1,$2,$3,$4,10,10,10)",[id(m),WS_A,id(n),id(n)+'/'+id(m)+'.jpg']);
  // 공개 읽기: 진짜 share-page-read 핸들러를 service_role 권한(열 단위 SELECT)으로 돌린다.
  const reader={
   linkByHash:hash=>as('service_role',null,async c=>(await c.query('select page_id,token_hash,expires_at,disabled_at from public.app_share_page_links where token_hash=$1',[hash])).rows[0]??null),
   pageById:pid=>as('service_role',null,async c=>(await c.query('select id,title,blocks,status from public.app_share_pages where id=$1',[pid])).rows[0]??null),
  };
  const handler=createShareReadHandler({linkByHash:async h=>{const r=await reader.linkByHash(h);return r&&{...r,expires_at:r.expires_at?.toISOString()??null,disabled_at:r.disabled_at?.toISOString()??null};},pageById:reader.pageById},{log:()=>{}});
  const open=token=>handler(new Request('https://x.supabase.co/functions/v1/share-page-read',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://work.bokdoong.com'},body:JSON.stringify({token})})).then(r=>r.status);
  await mk(1,{status:'published'});await mk(2,{status:'draft'});await mk(3,{status:'archived'});await mk(4,{status:'published'});await mk(5);await mk(50,{ws:WS_B,status:'published'});
  const tok1=await mkLink(1),tok4=await mkLink(4);await mkLink(2);await mkLink(3);await mkMedia(1,601);await mkMedia(1,602);
  const before=(await pool.query(snapshot)).rows,beforeCheck=v((await pool.query(precheck)).rows),linksBefore=(await pool.query('select count(*)::int n from public.app_share_page_links')).rows[0].n,mediaBefore=(await pool.query('select count(*)::int n from public.app_share_page_media')).rows[0].n;

  await t.test('pair files pass the workflow parser; the migration takes the approval-once expanded flow',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.targets.sort(),['app_share_pages']);
   assert.deepEqual(plan.review.definer.sort(),['private.app_trash_share_page_before_delete','public.app_trash_list','public.app_trash_purge','public.app_trash_restore']);
   assert.equal(plan.review.policies,1);assert.equal(plan.review.restrictive,1);assert.equal(plan.review.triggers,1);
   const dry=prepareMigration({mode:'dry-run',version,runId:'1',root});assert.equal(dry.rules,'expanded');
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'');
   assert.match(code,/^begin;\n/);assert.match(code,/\ncommit;\n$/);
   assert.doesNotMatch(code,/to (anon|public)\b|rtw_|disable row level|drop policy|alter policy|as permissive|grant [^;]*service_role/i);
   assert.doesNotMatch(code,/\bgrant\s+(select|insert|update|delete)\b/i); // no table or column grants at all
   assert.match(code,/create policy app_share_pages_trash_hidden on public\.app_share_pages as restrictive for all to authenticated/);
   assert.match(code,/create trigger app_share_pages_a_trash_before_delete\s+before delete on public\.app_share_pages/);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261027050000', 'trash_share_pages_db'/);
   const fn=/create function private\.app_trash_share_page_before_delete\(\)[\s\S]*?\n\$\$;/.exec(code)[0].replace(/create function private\.app_trash_share_page_before_delete/,'');
   assert.doesNotMatch(fn,/private\./);
   assert.match(rollbackSQL,/SQL Editor\(폰 경로 C\) 전용/);
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
  });
  await t.test('precheck: every condition is 예',()=>{
   const yes=Object.entries(beforeCheck).filter(([,x])=>x==='예'||x==='아니오');
   assert.equal(yes.length,14,'예/아니오 항목 수');
   for(const [k,x] of yes)assert.equal(x,'예',k);
   assert.equal(beforeCheck['page row count'],'6');assert.equal(beforeCheck['link row count'],'4');assert.equal(beforeCheck['media row count'],'2');
  });
  await t.test('apply refuses (and changes nothing) when a user trigger exists, the previous step is missing, or the RPCs are not the previous shape',async()=>{
   await pool.query(`create function private.synthetic_noop() returns trigger language plpgsql as $$begin return old; end$$;
     create trigger app_share_pages_0_other before delete on public.app_share_pages for each row execute function private.synthetic_noop();`);
   assert.equal(v((await pool.query(precheck)).rows)['no user triggers and one owner policy on pages'],'아니오');
   await assert.rejects(pool.query(migration),/TRASH_SHARE_PAGES_PREREQUISITE_CHANGED/);await pool.query('rollback');
   await pool.query('drop trigger app_share_pages_0_other on public.app_share_pages; drop function private.synthetic_noop();');
   await pool.query("update supabase_migrations.schema_migrations set name='x' where version='20261026100000'");
   assert.equal(v((await pool.query(precheck)).rows)['previous trash_notes_db recorded'],'아니오');
   await assert.rejects(pool.query(migration),/TRASH_SHARE_PAGES_PREREQUISITE_CHANGED/);await pool.query('rollback');
   await pool.query("update supabase_migrations.schema_migrations set name='trash_notes_db' where version='20261026100000'");
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
   for(const k of ['objects and history agree','trash installed','page trash trigger runs first','links and media still cascade from pages','note trash still installed','library folder trash still installed','organization and report trash still installed','project trash still installed','no anon or public table grants on pages'])assert.equal(post[k],'예',k);
   const fns=(await pool.query(`select p.oid::regprocedure::text f,has_function_privilege('anon',p.oid,'execute') a,has_function_privilege('authenticated',p.oid,'execute') u,
     has_function_privilege('service_role',p.oid,'execute') s from pg_proc p where proname like 'app_trash_%' order by 1`)).rows;
   assert.deepEqual(fns.map(f=>[f.f,f.a,f.u,f.s]),[['app_trash_list(text)',false,true,false],['app_trash_purge(text,uuid)',false,true,false],
    ['app_trash_restore(text,uuid)',false,true,false],['private.app_trash_library_folder_before_delete()',false,false,false],['private.app_trash_note_before_delete()',false,false,false],
    ['private.app_trash_org_before_delete()',false,false,false],['private.app_trash_report_before_delete()',false,false,false],['private.app_trash_share_page_before_delete()',false,false,false],['private.app_trash_space_before_delete()',false,false,false]]);
   assert.equal((await pool.query("select has_schema_privilege('service_role','private','usage') u")).rows[0].u,false);
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid='public.app_share_pages'::regclass and polname='app_share_pages_trash_hidden' and not polpermissive and polroles=array[(select oid from pg_roles where rolname='authenticated')]")).rows[0].n,1);
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid='public.app_share_pages'::regclass and polname='share_pages_owner_all'")).rows[0].n,1); // 기존 정책은 그대로
   assert.equal((await pool.query("select has_table_privilege('anon','public.app_share_pages','select') g")).rows[0].g,false);
   // 권한 확대 없음: service_role은 새 칸을 읽을 수 없고, authenticated는 새 칸을 쓸 수 없다.
   assert.deepEqual({...(await pool.query("select has_column_privilege('service_role','public.app_share_pages','deleted_at','select') a, has_column_privilege('service_role','public.app_share_pages','deleted_status','select') b, has_column_privilege('authenticated','public.app_share_pages','deleted_at','update') c, has_column_privilege('authenticated','public.app_share_pages','deleted_status','update') d")).rows[0]},{a:false,b:false,c:false,d:false});
  });
  await t.test('the existing screen DELETE moves a published page, a draft and an archived page to the trash; links, photo records, text and version stay',async()=>{
   const olds={};for(const n of [1,2,3])olds[n]=await state(n);
   assert.equal(await open(tok1),200); // before: the public link opens
   assert.equal((await del(1)).rowCount,0); // nothing is deleted; PostgREST answers an empty result
   assert.equal((await del(2)).rowCount,0);assert.equal((await del(3)).rowCount,0);
   assert.deepEqual(await visible([1,2,3,4,5]),[id(4),id(5)]);
   for(const n of [1,2,3]){
    const now=await state(n);
    assert.equal(now.trashed,true);assert.equal(now.deleted_status,olds[n].status,'previous status kept');assert.equal(now.status,'archived');
    assert.equal(String(now.updated_at),String(olds[n].updated_at));assert.deepEqual(now.blocks,olds[n].blocks);assert.equal(now.title,olds[n].title);
    assert.equal(await count('app_share_page_links','page_id',n),1,'link of page '+n);
   }
   assert.equal(await count('app_share_page_media','page_id',1),2);
   assert.equal((await pool.query('select count(*)::int n from public.app_share_page_links')).rows[0].n,linksBefore);
   assert.equal((await pool.query('select count(*)::int n from public.app_share_page_media')).rows[0].n,mediaBefore);
   assert.equal((await state(5)).trashed,false);
  });
  await t.test('a page in the trash is not opened by its public link (real share-page-read handler); a live one still is',async()=>{
   assert.equal(await open(tok1),404);
   assert.equal(await open(tok4),200);
  });
  await t.test('archive stays separate: the 보관 PATCH only changes status and never lands in the trash; trash is not the 보관함',async()=>{
   await owner(c=>c.query("update public.app_share_pages set status='archived',updated_at=now() where id=$1",[id(4)]));
   assert.equal(await open(tok4),404);
   const s=await state(4);assert.equal(s.trashed,false);assert.equal(s.deleted_status,null);assert.equal(s.status,'archived');
   const kept=(await owner(c=>c.query("select id from public.app_share_pages where status='archived' order by id"))).rows.map(r=>r.id);
   assert.deepEqual(kept,[id(4)]); // the 보관함 query does not return the trash pages (they are hidden, though their status is archived)
   assert.deepEqual((await rpc(OWNER,'app_trash_list','share_page')).map(x=>x.id).sort(),[id(1),id(2),id(3)].sort()); // the trash list does not return the archived page
   await owner(c=>c.query("update public.app_share_pages set status='published',updated_at=now() where id=$1",[id(4)]));
   assert.equal(await open(tok4),200);
  });
  await t.test('the screen cannot see, change, re-delete or forge trash pages, nor add links or photos to them',async()=>{
   assert.equal((await owner(c=>c.query("update public.app_share_pages set title='고침' where id=$1",[id(1)]))).rowCount,0);
   assert.equal((await owner(c=>c.query("update public.app_share_pages set status='published' where id=$1",[id(1)]))).rowCount,0); // cannot reopen a trash page by editing status
   assert.equal((await del(1)).rowCount,0);assert.equal((await del(2)).rowCount,0);
   for(const n of [1,2,3])assert.equal((await state(n)).trashed,true);
   assert.equal(await open(tok1),404);
   await assert.rejects(owner(c=>c.query('update public.app_share_pages set deleted_at=now() where id=$1',[id(5)])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_share_pages(workspace_id,title,deleted_at) values($1,'위조',now())",[WS_A])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('insert into public.app_share_page_links(workspace_id,page_id) values($1,$2)',[WS_A,id(1)])),{code:'42501'}); // no new link on a trash page
   await assert.rejects(owner(c=>c.query("insert into public.app_share_page_media(workspace_id,page_id,storage_path,width,height,bytes) values($1,$2,$3,1,1,1)",[WS_A,id(1),id(1)+'/'+id(699)+'.jpg'])),{code:'42501'});
   // the owner can still read and delete the photo records and links of a trash page (the server function cleans them before the final purge)
   assert.equal((await owner(c=>c.query('select id from public.app_share_page_media where page_id=$1',[id(1)]))).rowCount,2);
   // other saves still work: normal edit, insert and delete (which also goes to the trash)
   await owner(c=>c.query("update public.app_share_pages set title='고친 제목' where id=$1",[id(5)]));
   const made=(await owner(c=>c.query("insert into public.app_share_pages(workspace_id,title) values($1,'새 페이지') returning id",[WS_A]))).rows[0].id;
   await owner(c=>c.query('delete from public.app_share_pages where id=$1',[made]));
   madeId=made;
   assert.deepEqual({...(await pool.query('select deleted_at is not null t, deleted_status s from public.app_share_pages where id=$1',[made])).rows[0]},{t:true,s:'draft'});
   // the stranger's page is untouched by the owner
   assert.equal((await owner(c=>c.query('delete from public.app_share_pages where id=$1',[id(50)]))).rowCount,0);
   assert.equal((await state(50)).trashed,false);
  });
  await t.test('app_trash_list: owner sees the trash pages with counts and previous status; stranger sees nothing; anon and service_role cannot call; unknown kind refused',async()=>{
   const list=await rpc(OWNER,'app_trash_list','share_page');
   assert.deepEqual(list.map(x=>x.id).sort(),[id(1),id(2),id(3),madeId].sort());
   const r=list.find(x=>x.id===id(1));
   assert.deepEqual({kind:r.kind,title:r.title,prev:r.prev_status,files:r.file_count,links:r.link_count,ws:r.workspace_id,has_at:!!r.deleted_at},
    {kind:'share_page',title:'합성 페이지 1',prev:'published',files:2,links:1,ws:WS_A,has_at:true});
   assert.equal(list.find(x=>x.id===id(3)).prev_status,'archived');
   assert.deepEqual(await rpc(STRANGER,'app_trash_list','share_page'),[]);
   await assert.rejects(rpc(OWNER,'app_trash_list','share_pages'),/TRASH_KIND_UNKNOWN/);
   for(const call of [`select public.app_trash_list('share_page')`,`select public.app_trash_restore('share_page','${id(1)}')`,`select public.app_trash_purge('share_page','${id(1)}')`])
    await assert.rejects(as('anon','',c=>c.query(call)),{code:'42501'},call);
   await assert.rejects(as('service_role','',c=>c.query("select public.app_trash_list('share_page')")),{code:'42501'});
  });
  await t.test('app_trash_restore: only the owner, only a trash page; it comes back with its previous status; a published page opens its same link again; twice is refused',async()=>{
   const old=await state(1);
   await assert.rejects(rpc(STRANGER,'app_trash_restore','share_page',id(1)),/TRASH_NOT_FOUND/);
   await assert.rejects(rpc(OWNER,'app_trash_restore','share_page',id(5)),/TRASH_NOT_FOUND/); // not in the trash
   await assert.rejects(rpc(OWNER,'app_trash_restore','share_page',id(50)),/TRASH_NOT_FOUND/);
   await assert.rejects(rpc(OWNER,'app_trash_restore','task',id(1)),/TRASH_KIND_UNKNOWN/);
   assert.deepEqual(await rpc(OWNER,'app_trash_restore','share_page',id(1)),{ok:true,kind:'share_page',id:id(1),restored:1});
   assert.deepEqual(await visible([1,2]),[id(1)]);
   const now=await state(1);assert.deepEqual([now.trashed,now.deleted_status,now.status],[false,null,'published']);assert.equal(String(now.updated_at),String(old.updated_at));
   assert.equal(await open(tok1),200); // the same link opens again
   assert.equal(await count('app_share_page_links','page_id',1),1);assert.equal(await count('app_share_page_media','page_id',1),2);
   await assert.rejects(rpc(OWNER,'app_trash_restore','share_page',id(1)),/TRASH_NOT_FOUND/);
   assert.deepEqual(await rpc(OWNER,'app_trash_restore','share_page',id(3)),{ok:true,kind:'share_page',id:id(3),restored:1}); // an archived page returns to the 보관함, not to the list
   assert.deepEqual([(await state(3)).status,(await state(3)).trashed],['archived',false]);
  });
  await t.test('app_trash_purge: owner only, trash pages only, refused while photo records remain; then the page, its links and records go, nothing else',async()=>{
   await assert.rejects(rpc(OWNER,'app_trash_purge','share_page',id(1)),/TRASH_NOT_FOUND/); // restored, not in the trash
   await assert.rejects(rpc(STRANGER,'app_trash_purge','share_page',id(2)),/TRASH_NOT_FOUND/);
   await assert.rejects(rpc(OWNER,'app_trash_purge','share_page',id(50)),/TRASH_NOT_FOUND/);
   await del(1); // back to the trash with two photo records
   await assert.rejects(rpc(OWNER,'app_trash_purge','share_page',id(1)),/TRASH_SHARE_PAGE_FILES/);
   assert.equal(await exists(1),1);assert.equal(await count('app_share_page_media','page_id',1),2);
   await owner(c=>c.query('delete from public.app_share_page_media where page_id=$1',[id(1)])); // what the server function does after removing the files
   assert.deepEqual(await rpc(OWNER,'app_trash_purge','share_page',id(1)),{ok:true,kind:'share_page',id:id(1)});
   assert.equal(await exists(1),0);assert.equal(await count('app_share_page_links','page_id',1),0); // the link went with the page (cascade)
   assert.deepEqual(await rpc(OWNER,'app_trash_purge','share_page',id(2)),{ok:true,kind:'share_page',id:id(2)}); // no photos: purges directly
   assert.equal(await exists(2),0);assert.equal(await exists(5),1);assert.equal(await exists(50),1);assert.equal(await count('app_share_page_links','page_id',3),1);
  });
  await t.test('deleting a whole workspace still removes its pages for real (cascade, trigger depth 2)',async()=>{
   await pool.query('insert into public.app_workspaces(id) values($1)',[WS_C]);
   await mk(70,{ws:WS_C});await mk(71,{ws:WS_C,status:'published'});
   await pool.query('delete from public.app_workspaces where id=$1',[WS_C]);
   assert.equal((await exists(70))+(await exists(71)),0);
  });
  await t.test('the earlier trash kinds still work as before (project, organization, report, library_folder, note)',async()=>{
   await pool.query('insert into public.app_spaces(id,workspace_id,owner_id,name) values($1,$2,$3,$4)',[id(901),WS_A,OWNER,'시험 프로젝트']);
   await pool.query('insert into public.app_suborganizations(id,workspace_id,name) values($1,$2,$3)',[id(801),WS_A,'시험 조직']);
   await pool.query('insert into public.app_meetings(id,workspace_id,title) values($1,$2,$3)',[id(802),WS_A,'시험 보고']);
   await owner(c=>c.query('delete from public.app_suborganizations where id=$1',[id(801)]));await owner(c=>c.query('delete from public.app_meetings where id=$1',[id(802)]));
   assert.deepEqual((await rpc(OWNER,'app_trash_list','organization')).map(x=>x.id),[id(801)]);assert.deepEqual((await rpc(OWNER,'app_trash_list','report')).map(x=>x.id),[id(802)]);
   assert.deepEqual(await rpc(OWNER,'app_trash_restore','organization',id(801)),{ok:true,kind:'organization',id:id(801),restored:1});
   assert.deepEqual(await rpc(OWNER,'app_trash_restore','report',id(802)),{ok:true,kind:'report',id:id(802),restored:1});
   await pool.query('insert into public.app_library_folders(id,workspace_id,project_id,name) values($1,$2,$3,$4)',[id(810),WS_A,id(901),'시험 폴더']);
   await owner(c=>c.query('delete from public.app_library_folders where id=$1',[id(810)]));
   assert.deepEqual((await rpc(OWNER,'app_trash_list','library_folder')).map(x=>x.id),[id(810)]);
   assert.deepEqual(await rpc(OWNER,'app_trash_purge','library_folder',id(810)),{ok:true,kind:'library_folder',id:id(810)});
   await owner(c=>c.query('insert into public.app_spaces(id,workspace_id,owner_id,name) values($1,$2,$3,$4)',[id(811),WS_A,OWNER,'프로젝트 시험']));
   await owner(c=>c.query('delete from public.app_spaces where id=$1',[id(811)]));
   assert.deepEqual((await rpc(OWNER,'app_trash_list','project')).map(x=>[x.id,x.child_count]),[[id(811),0]]);
   assert.deepEqual(await rpc(OWNER,'app_trash_purge','project',id(811)),{ok:true,kind:'project',id:id(811)});
   await pool.query("insert into public.app_notes(id,workspace_id,raw_text,kind,title) values($1,$2,'합성','note','합성 노트')",[id(820),WS_A]);
   await owner(c=>c.query('delete from public.app_notes where id=$1',[id(820)]));
   assert.deepEqual((await rpc(OWNER,'app_trash_list','note')).map(x=>x.id),[id(820)]);
   assert.deepEqual(await rpc(OWNER,'app_trash_purge','note',id(820)),{ok:true,kind:'note',id:id(820)});
  });
  await t.test('running the migration again is refused and keeps one history row',async()=>{
   await assert.rejects(pool.query(migration),/TRASH_SHARE_PAGES_PREREQUISITE_CHANGED/);await pool.query('rollback');
   assert.equal(await history(),1);
  });
  await t.test('rollback restores trashed pages to their previous status with links and photo records; earlier trash and RPC names stay; page delete is immediate again',async()=>{
   await mk(90,{status:'published'});const tok90=await mkLink(90);await mkMedia(90,690);
   await del(90);
   assert.deepEqual(await visible([90]),[]);assert.equal(await open(tok90),404);
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   const post=v((await pool.query(postcheck)).rows);
   assert.equal(post['objects and history agree'],'예');assert.equal(post['trash installed'],'아니오');
   assert.equal(post['note trash still installed'],'예');assert.equal(post['library folder trash still installed'],'예');assert.equal(post['organization and report trash still installed'],'예');assert.equal(post['project trash still installed'],'예');
   assert.deepEqual(await visible([90]),[id(90)]);assert.equal((await pool.query('select status from public.app_share_pages where id=$1',[id(90)])).rows[0].status,'published');assert.equal(await open(tok90),200); // the same link opens again
   assert.equal(await count('app_share_page_links','page_id',90),1);assert.equal(await count('app_share_page_media','page_id',90),1);
   assert.equal((await del(90)).rowCount,1);assert.equal(await exists(90),0);assert.equal(await count('app_share_page_links','page_id',90),0);assert.equal(await count('app_share_page_media','page_id',90),0);
   await assert.rejects(rpc(OWNER,'app_trash_list','share_page'),/TRASH_KIND_UNKNOWN/);
   assert.deepEqual(await rpc(OWNER,'app_trash_list','note'),[]);
   assert.equal((await pool.query("select count(*)::int n from pg_proc where proname in ('app_trash_list','app_trash_restore','app_trash_purge') and not has_function_privilege('anon',oid,'execute') and has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('service_role',oid,'execute')")).rows[0].n,3);
   await pool.query(migration);assert.equal(await history(),1);
   assert.equal(v((await pool.query(postcheck)).rows)['trash installed'],'예');
   await pool.query(rollbackSQL);assert.equal(await history(),0);
  });
 }finally{
  await closePool(pool);
  if(cluster)await cluster.stop().catch(()=>{});
 }
});
