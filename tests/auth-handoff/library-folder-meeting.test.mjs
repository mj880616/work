// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic (no real folder names).
// MTG-정기회의자료폴더 DB: app_library_folders.meeting_key (회의명 열쇠, 작업공간별 하나) + 서버 함수 app_library_folder_set_meeting (owner만, 표 권한은 넓히지 않음).
// - 승인형 workflow의 plan·dry-run·apply가 통과(확장 규칙)하고, dry-run은 아무것도 남기지 않는다.
// - owner만 바꾼다: 남의 폴더·없는 폴더·휴지통 폴더는 같은 오류, anon·로그인 안 함 거절, 모양이 틀리면 거절, 같은 회의명은 폴더 하나와만 짝(옛 짝은 풂).
// - 표 권한 그대로(authenticated는 칸을 직접 쓸 수 없음), 되돌리기는 칸·검사·색인·함수·기록만 지운다.
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
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261124213000',name='library_folder_meeting',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const CHAIN=['20260921231000_fix_project_delete_workstream_unlink','20261021053502_prj_depth_guard','20261022120000_library_folders','20261024193000_trash_projects_db','20261025100000_trash_org_report_db','20261025180000_trash_library_folder_db',
  '20260927103344_task_impl2_notes_record_links','20260928123601_task_meeting_followup_record_links','20261010120000_basket1_notes_links','20261011180000_basket4a_confirm_links','20261012100000_basket_link_view_db',
  '20261013034836_basket_photo_ocr_db','20261017052234_journal_memo_notes_kind','20261020051027_journal_work_lines','20261026100000_trash_notes_db',
  '20261020005000_share_pages_links','20261022130000_share_pages_doc_block','20261023110000_share_page_media','20261023160000_share_pages_archived_status',
  '20261026170000_library_folders_free','20261027050000_trash_share_pages_db','20261104213000_library_folder_color','20261124100000_library_folder_drive'];

// Existing shapes copied from trash-share-pages-db.test.mjs (the chain above needs them). Nothing here comes from production.
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


const F1='43000000-0000-4000-8000-000000000001',F2='43000000-0000-4000-8000-000000000002',F_OTHER='43000000-0000-4000-8000-000000000003',F_GONE='43000000-0000-4000-8000-000000000004';
const K1='가상정기회의',K2='가상다른회의';
test('library folder meeting pair: plan, dry-run, apply, owner-only set, CHECK, unique and rollback',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'lib-meeting-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex');
 const cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 await cluster.initialise();await cluster.start();
 try{
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(shapes);await pool.query(shapes2);
  await pool.query("alter table public.app_spaces add column metadata jsonb default '{\"project_system\":\"v2\"}'");
  await pool.query('delete from public.app_spaces');await pool.query('delete from public.app_suborganizations');await pool.query('delete from public.app_meetings');
  for(const file of CHAIN)await pool.query(await read('supabase/migrations/'+file+'.sql'));
  await pool.query(`insert into public.app_library_folders(id,workspace_id,name,sort_order) values ('${F1}','${WS_A}','갑 폴더',1024),('${F2}','${WS_A}','을 폴더',2048),('${F_OTHER}','${WS_B}','남의 폴더',1024),('${F_GONE}','${WS_A}','지운 폴더',3072)`);
  await pool.query(`update public.app_library_folders set deleted_at=now(), deleted_root_id=id where id='${F_GONE}'`);
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const setMeeting=(sub,id,key,role='authenticated')=>as(role,sub,c=>c.query('select public.app_library_folder_set_meeting($1::uuid,$2::text) r',[id,key])).then(r=>r.rows[0].r);
  const keyOf=async id=>(await pool.query('select meeting_key from public.app_library_folders where id=$1',[id])).rows[0].meeting_key;
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;

  await t.test('before apply there is no column and no function',async()=>{
   assert.equal((await pool.query("select count(*)::int n from pg_attribute where attrelid='public.app_library_folders'::regclass and attname='meeting_key' and not attisdropped")).rows[0].n,0);
   assert.equal((await pool.query("select to_regprocedure('public.app_library_folder_set_meeting(uuid,text)') is null v")).rows[0].v,true);
   assert.ok(beforeCheck.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'),JSON.stringify(beforeCheck));
  });
  await t.test('plan accepts the migration and its companion files',()=>{
   const p=plan('apply','9980');assert.ok(p&&!p.rejected,JSON.stringify(p).slice(0,300));
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
  });
  await t.test('apply passes postcheck; table grants unchanged; existing folders start empty',async()=>{
   const apply=await run('apply','9982');assert.equal(apply.ok,true,apply.summary);
   const post=(await pool.query(postcheck)).rows;
   assert.ok(post.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'),JSON.stringify(post));
   for(const name of ['folders rows','folders grants policies triggers hash'])assert.equal(post.find(r=>r.item===name).value,beforeCheck.find(r=>r.item===name).value,name);
   assert.equal(await keyOf(F1),null);
   assert.equal((await pool.query("select has_column_privilege('authenticated','public.app_library_folders','meeting_key','insert,update') v")).rows[0].v,false);
   assert.deepEqual((await pool.query("select has_function_privilege('anon','public.app_library_folder_set_meeting(uuid,text)','execute') a, has_function_privilege('service_role','public.app_library_folder_set_meeting(uuid,text)','execute') s, has_function_privilege('authenticated','public.app_library_folder_set_meeting(uuid,text)','execute') u")).rows[0],{a:false,s:false,u:true});
  });
  await t.test('the owner sets, moves and clears; one meeting name pairs with one folder',async()=>{
   const row=async()=> (await pool.query('select name,sort_order,parent_id,project_id,color,drive_folder_id from public.app_library_folders where id=$1',[F1])).rows[0];
   const was=await row();
   assert.deepEqual(await setMeeting(OWNER,F1,K1),{ok:true,id:F1,meeting_key:K1});assert.equal(await keyOf(F1),K1);
   assert.deepEqual(await setMeeting(OWNER,F2,K1),{ok:true,id:F2,meeting_key:K1});
   assert.equal(await keyOf(F1),null,'the old pair is released');assert.equal(await keyOf(F2),K1);
   assert.equal((await setMeeting(OWNER,F1,K2)).ok,true);assert.equal(await keyOf(F1),K2);
   assert.equal((await setMeeting(OWNER,F1,null)).ok,true);assert.equal(await keyOf(F1),null);
   assert.deepEqual(await row(),was);
  });
  await t.test('others cannot: another workspace owner, unknown folder, trashed folder, anon, not signed in',async()=>{
   await assert.rejects(setMeeting(STRANGER,F1,K1),{code:'42501',message:/LIBRARY_FOLDER_MEETING_FORBIDDEN/});
   await assert.rejects(setMeeting(OWNER,F_OTHER,K1),{code:'42501',message:/LIBRARY_FOLDER_MEETING_FORBIDDEN/});
   await assert.rejects(setMeeting(OWNER,'43000000-0000-4000-8000-0000000000ff',K1),{code:'42501',message:/LIBRARY_FOLDER_MEETING_FORBIDDEN/});
   await assert.rejects(setMeeting(OWNER,F_GONE,K1),{code:'42501',message:/LIBRARY_FOLDER_MEETING_FORBIDDEN/});
   await assert.rejects(setMeeting('',F1,K1),{code:'42501'});
   await assert.rejects(setMeeting(OWNER,F1,K1,'anon'),{code:'42501'});
   assert.equal(await keyOf(F_OTHER),null);assert.equal(await keyOf(F2),K1);
  });
  await t.test('bad keys are refused by the function, the CHECK and the unique index',async()=>{
   for(const v of ['','띄어 쓴 이름','쉼표,있음','a'.repeat(101),'줄\nbreak'])await assert.rejects(setMeeting(OWNER,F1,v),{code:'22023',message:/LIBRARY_FOLDER_MEETING_ARGS/},JSON.stringify(v));
   await assert.rejects(pool.query("update public.app_library_folders set meeting_key='a b' where id=$1",[F1]),{code:'23514'});
   await assert.rejects(pool.query('update public.app_library_folders set meeting_key=$2 where id=$1',[F1,K1]),{code:'23505'});
   await pool.query('update public.app_library_folders set meeting_key=$2 where id=$1',[F_OTHER,K1]); // 다른 작업공간은 따로 센다
   await pool.query('update public.app_library_folders set meeting_key=null where id=$1',[F_OTHER]);
  });
  await t.test('authenticated cannot write the column straight into the table; name and order paths still work',async()=>{
   await assert.rejects(as('authenticated',OWNER,c=>c.query('update public.app_library_folders set meeting_key=$2 where id=$1',[F1,K2])),{code:'42501'});
   assert.equal(await keyOf(F1),null);
   await as('authenticated',OWNER,c=>c.query("update public.app_library_folders set name='갑 폴더 2', sort_order=4096 where id=$1",[F1]));
   const r=await as('authenticated',OWNER,c=>c.query('select id,meeting_key from public.app_library_folders order by sort_order'));
   assert.ok(r.rows.every(x=>x.id!==F_OTHER&&x.id!==F_GONE),'owner RLS and trash-hidden still hide the others');
   assert.equal(r.rows.find(x=>x.id===F2).meeting_key,K1,'the owner reads the pair');
  });
  await t.test('rollback removes the function, index, check, column and record; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.equal((await pool.query("select to_regclass('public.app_library_folders_meeting_key_idx') is null v")).rows[0].v,true);
   assert.equal((await pool.query("select to_regprocedure('public.app_library_folder_set_meeting(uuid,text)') is null v")).rows[0].v,true);
   assert.equal((await pool.query("select count(*)::int n from public.app_library_folders")).rows[0].n,4,'folders stay');
   const again=await run('apply','9983');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
