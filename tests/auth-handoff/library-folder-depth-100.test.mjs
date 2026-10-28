// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic (no real folder or document names).
// LIB-폴더100단 DB: 20261028113000_library_folder_depth_100 — 자료실 폴더 단 제한 3 → 100.
// 앞 단계 migration들(폴더·휴지통·폴더 자유·공유 페이지 휴지통)을 진짜 파일로 먼저 적용하고 확인한다: 적용 전 3단 거절, 적용 뒤 100단까지 만들기·101단 거절,
// 돌고 도는 폴더 막기 그대로, 깊은 폴더 휴지통 보내기(아래 99단 함께)·되살리기·되살릴 때 100단 넘으면 거절·영구 삭제, 남의 작업공간 거절, 깊이 계산 시간,
// 권한 그대로, 짝 사전·사후 확인, 되돌리기(4단 이상 있으면 멈춤 → 없으면 3단 모양으로).
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
const version='20261028113000',name='library_folder_depth_100',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const CHAIN=['20260921231000_fix_project_delete_workstream_unlink','20261021053502_prj_depth_guard','20261022120000_library_folders','20261024193000_trash_projects_db','20261025100000_trash_org_report_db','20261025180000_trash_library_folder_db',
  '20260927103344_task_impl2_notes_record_links','20260928123601_task_meeting_followup_record_links','20261010120000_basket1_notes_links','20261011180000_basket4a_confirm_links','20261012100000_basket_link_view_db',
  '20261013034836_basket_photo_ocr_db','20261017052234_journal_memo_notes_kind','20261020051027_journal_work_lines','20261026100000_trash_notes_db',
  '20261020005000_share_pages_links','20261022130000_share_pages_doc_block','20261023110000_share_page_media','20261023160000_share_pages_archived_status',
  '20261026170000_library_folders_free','20261027050000_trash_share_pages_db'];

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


const LIMIT=100;
test('LIB-폴더100단: 3단 → 100단, 돌고 도는 폴더 막기·작업공간 경계 그대로, 깊은 폴더 휴지통·되살리기·영구 삭제, 권한 그대로, 되돌리기',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'lib-depth-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const v=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const RECORDED=['folder row count','folder rows in trash','deepest folder level','folder function acl hash','recent migrations'];
  const allYes=(rows,label)=>{for(const [k,x] of Object.entries(v(rows)))if(!RECORDED.includes(k))assert.equal(x,'예',label+': '+k)};
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role authenticated');const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as(OWNER,fn),stranger=fn=>as(STRANGER,fn);
  const mk=(c,parent,label,ws=WS_A)=>c.query('insert into public.app_library_folders(workspace_id,project_id,parent_id,name,sort_order) values($1,null,$2,$3,0) returning id',[ws,parent,label]).then(r=>r.rows[0].id);
  const chain=async(n,top=null,prefix='가상')=>owner(async c=>{const ids=[];let p=top;for(let i=1;i<=n;i++){p=await mk(c,p,prefix+' '+i+'단');ids.push(p)}return ids});
  const move=(id,parent)=>owner(c=>c.query('update public.app_library_folders set parent_id=$1 where id=$2',[parent,id]));
  const rpc=(sub,fn,...args)=>as(sub,c=>c.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)).then(x=>x.rows[0].r);
  const trashed=async()=>(await pool.query('select count(*)::int n from public.app_library_folders where deleted_at is not null')).rows[0].n;
  const visible=async()=>(await owner(c=>c.query('select count(*)::int n from public.app_library_folders'))).rows[0].n;
  const fails=async(sql,re)=>{const c=await pool.connect();try{await assert.rejects(c.query(sql),re)}finally{await c.query('rollback');c.release()}};
  const shape=async()=>(await pool.query(snapshot)).rows.filter(r=>r.kind!=='history');

  await t.test('pair files pass the workflow parser; the migration takes the approval-once expanded flow; only the numbers change',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const sql of [precheck,postcheck])assert.doesNotMatch(sql.replace(/--.*$/gm,''),/information_schema/);
   for(const mode of ['dry-run','apply']){const plan=prepareMigration({mode,version,runId:'1',root});assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual(plan.review.definer.sort(),['private.app_trash_library_folder_before_delete','public.app_trash_restore']);assert.equal(plan.review.policies,0);assert.equal(plan.review.triggers,0);assert.equal(plan.review.grants,1)}
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'');
   assert.match(code,/^begin;\n/);assert.match(code,/\ncommit;\n$/);
   assert.doesNotMatch(code,/to anon|to public|to service_role|rtw_|truncate|alter table|drop |create policy|create trigger/i,'no widening, no table or policy changes');
   assert.deepEqual(code.match(/^grant .*$/gim),['grant execute on function public.app_trash_restore(text, uuid) to authenticated;']);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261028113000', 'library_folder_depth_100'/);
   // 함수 본문은 앞 단계 원문과 숫자·주석만 다르다(되돌리기 파일이 그 원문이다).
   const bodies=sql=>[...sql.matchAll(/create or replace function [\s\S]*?\n\$(?:guard)?\$;/g)].map(m=>m[0]);
   const norm=s=>s.replace(/--.*$/gm,'').replace(/\b(3|4|6|10|100|101)\b/g,'N').replace(/\s+/g,' ');
   const a=bodies(migration),b=bodies(rollbackSQL);assert.equal(a.length,3);assert.equal(b.length,3);
   assert.deepEqual(a.map(norm),b.map(norm));
   assert.match(rollbackSQL,/SQL Editor\(폰 경로 C\) 전용/);
  });

  // 적용 전: 3단까지만.
  allYes((await pool.query(precheck)).rows,'precheck');
  const before=await shape(),beforeCheck=v((await pool.query(precheck)).rows);
  const old=await chain(3,null,'옛');
  await assert.rejects(chain(1,old[2]),/LIB_FOLDER_DEPTH: folders are limited to 3 levels/,'before apply: 4th level refused');

  await t.test('apply: history row once, postcheck all 예, rows and grants unchanged',async()=>{
   await pool.query(migration);
   assert.equal(await history(),1);
   const post=(await pool.query(postcheck)).rows;allYes(post,'postcheck');
   const after=v((await pool.query(precheck)).rows),pv=v(post);
   assert.equal(pv['folder row count'],after['folder row count']);assert.equal(pv['folder function acl hash'],beforeCheck['folder function acl hash'],'execute grants unchanged');
   assert.equal(pv['deepest folder level'],'3');
   await fails(migration,/LIBRARY_FOLDER_DEPTH_100_PREREQUISITE_CHANGED/);
  });

  let deep;
  await t.test('100 levels can be made, the 101st is refused; moves that would pass 100 are refused; the depth check stays fast',async()=>{
   await chain(1,old[2],'옛');// 4단이 이제 된다.
   deep=await chain(LIMIT);
   assert.equal(deep.length,LIMIT);
   let t0=Date.now();
   await assert.rejects(chain(1,deep[LIMIT-1]),/LIB_FOLDER_DEPTH: folders are limited to 100 levels/);
   assert.ok(Date.now()-t0<2000,'refusal at 100 levels is quick');
   // 맨 위 새 폴더 X 아래로 100단 사슬 전체를 넣으면 101단 → 거절.
   const [x]=await chain(1,null,'X');
   await assert.rejects(move(deep[0],x),/LIB_FOLDER_DEPTH: folders are limited to 100 levels/);
   // 돌고 도는 폴더: 사슬 맨 위를 자기 아래(50단)로, 깊은 폴더를 자기 자신 아래로 → 거절.
   await assert.rejects(move(deep[0],deep[49]),/LIB_FOLDER_CYCLE/);
   await assert.rejects(move(deep[99],deep[99]),/LIB_FOLDER_CYCLE/);
   // 99단 폴더를 맨 위로 꺼내고 다시 제자리로: 된다.
   t0=Date.now();await move(deep[98],null);await move(deep[98],deep[97]);assert.ok(Date.now()-t0<2000,'deep moves are quick');
   // 다른 작업공간 폴더 아래로는 안 된다. 남은 폴더를 보지도 못한다.
   await assert.rejects(owner(c=>mk(c,deep[10],'남의 칸',WS_B)));
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_library_folders'))).rows[0].n,0);
   await assert.rejects(stranger(c=>mk(c,deep[10],'남')));
  });

  await t.test('trash a deep folder: everything below goes with it; restore checks 100 levels; purge lifts the rest',async()=>{
   const n0=await visible();
   await owner(c=>c.query('delete from public.app_library_folders where id=$1',[deep[50]]));// 51단 → 아래 50단 함께
   assert.equal(await trashed(),50);assert.equal(await visible(),n0-50);
   await assert.rejects(rpc(STRANGER,'app_trash_restore','library_folder',deep[50]),/TRASH_NOT_FOUND/);
   // 휴지통에 있는 동안 위 사슬을 한 단 더 깊게(X 아래로) → 되살리면 101단이라 거절.
   const [x2]=await chain(1,null,'X2');
   await move(deep[0],x2);
   await assert.rejects(rpc(OWNER,'app_trash_restore','library_folder',deep[50]),/LIB_FOLDER_DEPTH: folders are limited to 100 levels/);
   assert.equal(await trashed(),50,'refused restore changes nothing');
   await move(deep[0],null);
   const r=await rpc(OWNER,'app_trash_restore','library_folder',deep[50]);assert.equal(r.restored,50);
   assert.equal(await trashed(),0);assert.equal(await visible(),n0+1);
   // 2단을 휴지통으로 보내고 영구 삭제: 그 폴더만 지워지고 아래 98단은 한 단 위로 올라와 다시 보인다.
   await owner(c=>c.query('delete from public.app_library_folders where id=$1',[deep[1]]));
   assert.equal(await trashed(),LIMIT-1);
   await rpc(OWNER,'app_trash_purge','library_folder',deep[1]);
   assert.equal(await trashed(),0);
   assert.equal((await pool.query('select parent_id from public.app_library_folders where id=$1',[deep[2]])).rows[0].parent_id,deep[0]);
  });

  await t.test('rollback stops while folders deeper than 3 exist; with none it restores the 3 level shape and removes only the history row',async()=>{
   await fails(rollbackSQL,/LIBRARY_FOLDER_DEPTH_100_ROLLBACK_BLOCKED: folders deeper than 3 levels exist/);
   assert.equal(await history(),1);
   const rows=(await pool.query('select count(*)::int n from public.app_library_folders')).rows[0].n;
   await pool.query('update public.app_library_folders set parent_id=null where parent_id is not null');
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.equal((await pool.query('select count(*)::int n from public.app_library_folders')).rows[0].n,rows,'rollback keeps every folder row');
   allYes((await pool.query(postcheck)).rows,'postcheck after rollback');
   assert.deepEqual(await shape(),before,'functions, triggers, policies and table grants are back to the earlier shape');
   const three=await chain(3,null,'다시');
   await assert.rejects(chain(1,three[2]),/LIB_FOLDER_DEPTH: folders are limited to 3 levels/);
  });
 }finally{await closePool(pool);await cluster.stop();}
});
