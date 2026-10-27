// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic (no real folder or document names).
// TRASH-다른삭제 4단계: 20261026100000_trash_notes_db — 노트·업데이트(app_notes 종류 basket·note)의 [지우기]도 휴지통(deleted_at)으로 간다.
// 숨김 정책(restrictive)·삭제 가로채기 트리거(종류 work·diary는 통과)·app_trash_list/restore/purge의 새 종류 note, 앞 단계 휴지통 그대로.
// 앞 단계 20261024193000_trash_projects_db, 20261025100000_trash_org_report_db, 20261022120000_library_folders, 20261025180000_trash_library_folder_db와 노트 표 migration들을 진짜 파일로 먼저 적용한다.
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
const version='20261026100000',name='trash_notes_db',stem=version+'_'+name;
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

test('TRASH 4단계: 노트·업데이트 휴지통 — prechecks, apply, basket/note delete goes to trash and keeps links, work/diary still delete, hidden from reads, owner-only list/restore/purge, earlier steps unchanged, rollback',{timeout:180000},async t=>{
 let cluster,pool;
 const directory=await mkdtemp(join(tmpdir(),'trash-notes-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
    '20261013034836_basket_photo_ocr_db','20261017052234_journal_memo_notes_kind','20261020051027_journal_work_lines'])
   await pool.query(await read('supabase/migrations/'+file+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const v=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value??r.ok]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn);
  const rpc=(sub,fn,...args)=>as('authenticated',sub,c=>c.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)).then(x=>x.rows[0].r);
  const del=n=>owner(c=>c.query('delete from public.app_notes where id=$1',[id(n)]));
  const visible=async list=>(await owner(c=>c.query('select id from public.app_notes where id=any($1) order by id',[list.map(id)]))).rows.map(r=>r.id);
  const state=async n=>(await pool.query('select deleted_at is not null trashed, updated_at, attachments, raw_text from public.app_notes where id=$1',[id(n)])).rows[0];
  const exists=async n=>(await pool.query('select count(*)::int n from public.app_notes where id=$1',[id(n)])).rows[0].n;
  const linkCount=async n=>(await pool.query('select count(*)::int n from public.app_record_links where note_id=$1',[id(n)])).rows[0].n;
  const att=[{drive_file_id:'file_one',file_name:'a.pdf',mime_type:'application/pdf',size_bytes:10}];
  const mk=(n,{ws=WS_A,kind='basket',title=null,day=null,text='합성 본문 '+n,ai=true,attachments=[]}={})=>pool.query('insert into public.app_notes(id,workspace_id,raw_text,kind,title,journal_day,ai_export_allowed,attachments) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[id(n),ws,text,kind,title,day,ai,JSON.stringify(attachments)]);
  const link=(n,project=id(901),ws=WS_A)=>pool.query('insert into public.app_record_links(workspace_id,note_id,project_id) values($1,$2,$3)',[ws,id(n),project]);
  await pool.query('insert into public.app_spaces(id,workspace_id,owner_id,name) values($1,$2,$3,$4),($5,$6,$7,$8)',[id(901),WS_A,OWNER,'시험 프로젝트',id(903),WS_B,STRANGER,'남의 프로젝트']);
  await mk(1,{attachments:att});await mk(2,{kind:'note',title:'합성 노트'});await mk(3,{kind:'work',day:'2026-10-20',text:'한 줄'});await mk(4,{kind:'diary',day:'2026-10-21',ai:false});
  await mk(5);await mk(6);await mk(50,{ws:WS_B});
  await link(1);await link(2);await link(5);await link(50,id(903),WS_B);
  let madeId=null;
  const before=(await pool.query(snapshot)).rows,beforeCheck=v((await pool.query(precheck)).rows),linksBefore=(await pool.query('select count(*)::int n from public.app_record_links')).rows[0].n;

  await t.test('pair files pass the workflow parser; the migration takes the approval-once expanded flow',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.targets.sort(),['app_notes']);
   assert.deepEqual(plan.review.definer.sort(),['private.app_trash_note_before_delete','public.app_trash_list','public.app_trash_purge','public.app_trash_restore']);
   assert.equal(plan.review.policies,1);assert.equal(plan.review.restrictive,1);assert.equal(plan.review.triggers,1);
   const dry=prepareMigration({mode:'dry-run',version,runId:'1',root});assert.equal(dry.rules,'expanded');
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'');
   assert.match(code,/^begin;\n/);assert.match(code,/\ncommit;\n$/);
   assert.doesNotMatch(code,/to (anon|public)\b|rtw_|disable row level|drop policy|alter policy|as permissive|grant [^;]*service_role/i);
   assert.match(code,/create policy app_notes_trash_hidden on public\.app_notes as restrictive for all to authenticated/);
   assert.match(code,/create trigger app_notes_a_trash_before_delete\s+before delete on public\.app_notes/);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261026100000', 'trash_notes_db'/);
   const fn=/create function private\.app_trash_note_before_delete\(\)[\s\S]*?\n\$\$;/.exec(code)[0].replace(/create function private\.app_trash_note_before_delete/,'');
   assert.doesNotMatch(fn,/private\./);
   assert.match(rollbackSQL,/SQL Editor\(폰 경로 C\) 전용/);
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
  });
  await t.test('precheck: every condition is 예',()=>{
   const yes=Object.entries(beforeCheck).filter(([,x])=>x==='예'||x==='아니오');
   assert.equal(yes.length,12,'예/아니오 항목 수');
   for(const [k,x] of yes)assert.equal(x,'예',k);
   assert.equal(beforeCheck['note row count'],'7');assert.equal(beforeCheck['link row count'],'4');
  });
  await t.test('apply refuses (and changes nothing) when a user trigger exists, the previous step is missing, or the RPCs are not the previous shape',async()=>{
   await pool.query(`create function private.synthetic_noop() returns trigger language plpgsql as $$begin return old; end$$;
     create trigger app_notes_0_other before delete on public.app_notes for each row execute function private.synthetic_noop();`);
   assert.equal(v((await pool.query(precheck)).rows)['no user triggers and one owner policy on notes'],'아니오');
   await assert.rejects(pool.query(migration),/TRASH_NOTES_PREREQUISITE_CHANGED/);await pool.query('rollback');
   await pool.query('drop trigger app_notes_0_other on public.app_notes; drop function private.synthetic_noop();');
   await pool.query("update supabase_migrations.schema_migrations set name='x' where version='20261025180000'");
   assert.equal(v((await pool.query(precheck)).rows)['previous trash_library_folder_db recorded'],'아니오');
   await assert.rejects(pool.query(migration),/TRASH_NOTES_PREREQUISITE_CHANGED/);await pool.query('rollback');
   await pool.query("update supabase_migrations.schema_migrations set name='trash_library_folder_db' where version='20261025180000'");
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
   for(const k of ['objects and history agree','trash installed','note trash trigger runs first','link note_id still cascades from notes','library folder trash still installed','organization and report trash still installed','project trash still installed'])assert.equal(post[k],'예',k);
   const fns=(await pool.query(`select p.oid::regprocedure::text f,has_function_privilege('anon',p.oid,'execute') a,has_function_privilege('authenticated',p.oid,'execute') u,
     has_function_privilege('service_role',p.oid,'execute') s from pg_proc p where proname like 'app_trash_%' order by 1`)).rows;
   assert.deepEqual(fns.map(f=>[f.f,f.a,f.u,f.s]),[['app_trash_list(text)',false,true,false],['app_trash_purge(text,uuid)',false,true,false],
    ['app_trash_restore(text,uuid)',false,true,false],['private.app_trash_library_folder_before_delete()',false,false,false],['private.app_trash_note_before_delete()',false,false,false],
    ['private.app_trash_org_before_delete()',false,false,false],['private.app_trash_report_before_delete()',false,false,false],['private.app_trash_space_before_delete()',false,false,false]]);
   assert.equal((await pool.query("select has_schema_privilege('service_role','private','usage') u")).rows[0].u,false);
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid='public.app_notes'::regclass and polname='app_notes_trash_hidden' and not polpermissive and polroles=array[(select oid from pg_roles where rolname='authenticated')]")).rows[0].n,1);
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid='public.app_notes'::regclass and polname='notes_owner_all'")).rows[0].n,1); // 기존 정책은 그대로
   assert.equal((await pool.query("select has_table_privilege('anon','public.app_notes','select') g")).rows[0].g,false);
  });
  await t.test('the existing screen DELETE moves a basket note and a note to the trash; links, attachments, text and version stay',async()=>{
   const one=await state(1),two=await state(2);
   assert.equal((await visible([1,2,5,6])).length,4);
   assert.equal((await del(1)).rowCount,0); // nothing is deleted; PostgREST answers an empty result
   assert.equal((await del(2)).rowCount,0);
   assert.deepEqual(await visible([1,2,5,6]),[id(5),id(6)]);
   for(const [n,old] of [[1,one],[2,two]]){
    const now=await state(n);
    assert.equal(now.trashed,true);assert.equal(String(now.updated_at),String(old.updated_at));
    assert.deepEqual(now.attachments,old.attachments);assert.equal(now.raw_text,old.raw_text);
    assert.equal(await linkCount(n),1,'link of note '+n);
   }
   assert.equal((await pool.query('select count(*)::int n from public.app_record_links')).rows[0].n,linksBefore);
   assert.deepEqual(await state(5).then(x=>x.trashed),false);
  });
  await t.test('work lines and diary are not part of the trash: DELETE removes them as before',async()=>{
   assert.equal((await del(3)).rowCount,1);assert.equal((await del(4)).rowCount,1);
   assert.equal(await exists(3)+await exists(4),0);
  });
  await t.test('the screen cannot see, change, re-delete or forge trash notes, nor link to them',async()=>{
   assert.equal((await owner(c=>c.query("update public.app_notes set raw_text='고침' where id=$1",[id(1)]))).rowCount,0);
   assert.equal((await del(1)).rowCount,0);assert.equal((await del(2)).rowCount,0);
   for(const n of [1,2])assert.equal((await state(n)).trashed,true);
   assert.equal((await owner(c=>c.query('select id from public.app_record_links l where l.note_id=$1 and exists(select 1 from public.app_notes n where n.id=l.note_id)',[id(1)]))).rowCount,0); // a join through the notes table no longer finds it
   await assert.rejects(owner(c=>c.query('update public.app_notes set deleted_at=now() where id=$1',[id(6)])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_notes(workspace_id,raw_text,deleted_at) values($1,'위조',now())",[WS_A])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('insert into public.app_record_links(workspace_id,note_id,project_id) values($1,$2,$3)',[WS_A,id(2),id(901)])),{code:'42501'}); // cannot attach a new link to a trash note
   // other saves still work: normal edit, insert and delete (which also goes to the trash)
   await owner(c=>c.query("update public.app_notes set raw_text='고친 본문' where id=$1",[id(6)]));
   const made=(await owner(c=>c.query("insert into public.app_notes(workspace_id,raw_text) values($1,'새 메모') returning id",[WS_A]))).rows[0].id;
   await owner(c=>c.query('delete from public.app_notes where id=$1',[made]));
   madeId=made;
   assert.equal((await pool.query('select deleted_at is not null t from public.app_notes where id=$1',[made])).rows[0].t,true);
   // the stranger's note is untouched by the owner
   assert.equal((await owner(c=>c.query('delete from public.app_notes where id=$1',[id(50)]))).rowCount,0);
   assert.equal((await state(50)).trashed,false);
  });
  await t.test('app_trash_list: owner sees the trash notes with counts; stranger sees nothing; anon and service_role cannot call; unknown kind refused',async()=>{
   const list=await rpc(OWNER,'app_trash_list','note');
   assert.deepEqual(list.map(x=>x.id).sort(),[id(1),id(2),madeId].sort());
   const r=list.find(x=>x.id===id(1)),n=list.find(x=>x.id===id(2));
   assert.deepEqual({kind:r.kind,note_kind:r.note_kind,preview:r.preview,files:r.file_count,links:r.link_count,ws:r.workspace_id,has_at:!!r.deleted_at},
    {kind:'note',note_kind:'basket',preview:'합성 본문 1',files:1,links:1,ws:WS_A,has_at:true});
   assert.deepEqual({note_kind:n.note_kind,title:n.title,files:n.file_count},{note_kind:'note',title:'합성 노트',files:0});
   assert.deepEqual(await rpc(STRANGER,'app_trash_list','note'),[]);
   await assert.rejects(rpc(OWNER,'app_trash_list','notes'),/TRASH_KIND_UNKNOWN/);
   for(const call of [`select public.app_trash_list('note')`,`select public.app_trash_restore('note','${id(1)}')`,`select public.app_trash_purge('note','${id(1)}')`])
    await assert.rejects(as('anon','',c=>c.query(call)),{code:'42501'},call);
   await assert.rejects(as('service_role','',c=>c.query("select public.app_trash_list('note')")),{code:'42501'});
  });
  await t.test('app_trash_restore: only the owner, only a trash note; the note comes back with its link, attachment and version; twice is refused',async()=>{
   const old=await state(1);
   await assert.rejects(rpc(STRANGER,'app_trash_restore','note',id(1)),/TRASH_NOT_FOUND/);
   await assert.rejects(rpc(OWNER,'app_trash_restore','note',id(5)),/TRASH_NOT_FOUND/); // not in the trash
   await assert.rejects(rpc(OWNER,'app_trash_restore','note',id(50)),/TRASH_NOT_FOUND/);
   await assert.rejects(rpc(OWNER,'app_trash_restore','task',id(1)),/TRASH_KIND_UNKNOWN/);
   assert.deepEqual(await rpc(OWNER,'app_trash_restore','note',id(1)),{ok:true,kind:'note',id:id(1),restored:1});
   assert.deepEqual(await visible([1,2]),[id(1)]);
   const now=await state(1);assert.equal(now.trashed,false);assert.equal(String(now.updated_at),String(old.updated_at));assert.deepEqual(now.attachments,old.attachments);
   assert.equal(await linkCount(1),1);
   await assert.rejects(rpc(OWNER,'app_trash_restore','note',id(1)),/TRASH_NOT_FOUND/);
  });
  await t.test('app_trash_purge: owner only, trash notes only; the note and its links go, nothing else',async()=>{
   await assert.rejects(rpc(OWNER,'app_trash_purge','note',id(1)),/TRASH_NOT_FOUND/); // restored, not in the trash
   await assert.rejects(rpc(STRANGER,'app_trash_purge','note',id(2)),/TRASH_NOT_FOUND/);
   await assert.rejects(rpc(OWNER,'app_trash_purge','note',id(50)),/TRASH_NOT_FOUND/);
   assert.deepEqual(await rpc(OWNER,'app_trash_purge','note',id(2)),{ok:true,kind:'note',id:id(2)});
   assert.equal(await exists(2),0);assert.equal(await linkCount(2),0); // the link went with the note (cascade), as the old delete did
   assert.equal(await exists(1),1);assert.equal(await linkCount(1),1);assert.equal(await exists(50),1);assert.equal(await linkCount(50),1);
  });
  await t.test('deleting a whole workspace still removes its notes for real (cascade, trigger depth 2)',async()=>{
   await pool.query('insert into public.app_workspaces(id) values($1)',[WS_C]);
   await mk(70,{ws:WS_C});await mk(71,{ws:WS_C,kind:'note',title:'합성'});
   await pool.query('delete from public.app_workspaces where id=$1',[WS_C]);
   assert.equal((await exists(70))+(await exists(71)),0);
  });
  await t.test('the earlier trash kinds still work as before (project, organization, report, library_folder)',async()=>{
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
  });
  await t.test('running the migration again is refused and keeps one history row',async()=>{
   await assert.rejects(pool.query(migration),/TRASH_NOTES_PREREQUISITE_CHANGED/);await pool.query('rollback');
   assert.equal(await history(),1);
  });
  await t.test('rollback removes only the new trash pieces; trashed notes come back in place with their links; earlier trash and RPC names stay; note delete is immediate again',async()=>{
   await mk(90,{attachments:att});await link(90);
   await del(90);
   assert.deepEqual(await visible([90]),[]);
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   const post=v((await pool.query(postcheck)).rows);
   assert.equal(post['objects and history agree'],'예');assert.equal(post['trash installed'],'아니오');
   assert.equal(post['library folder trash still installed'],'예');assert.equal(post['organization and report trash still installed'],'예');assert.equal(post['project trash still installed'],'예');
   assert.deepEqual(await visible([90]),[id(90)]);assert.equal(await linkCount(90),1);
   assert.equal((await del(90)).rowCount,1);assert.equal(await exists(90),0);assert.equal(await linkCount(90),0);
   await assert.rejects(rpc(OWNER,'app_trash_list','note'),/TRASH_KIND_UNKNOWN/);
   assert.deepEqual(await rpc(OWNER,'app_trash_list','organization'),[]);
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
