// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic (no real folder or document names).
// S59-11 LIB-받는폴더 DB: 20261111181000_library_receive_folder — app_profiles.library_receive_folder(외래 키, 폴더가 지워지면 비움) +
// app_documents 넣기 뒤 트리거(같은 작업공간·휴지통 아닌 받는 폴더에만 연결 한 줄). 승인형 DB workflow 실행기로 dry-run·apply를 시험하고,
// 로그인 사용자·서버 키 어느 쪽이 자료를 넣어도 받는 폴더에 들어가는지, 남의 폴더·휴지통 폴더는 무시하는지, 권한이 넓어지지 않는지, 되돌리기를 본다.
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
const version='20261111181000',name='library_receive_folder',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// 운영과 같은 앞 모양: 자료 표(owner RLS), 프로필 표(task12a 두 정책, authenticated SELECT/UPDATE만), 폴더 표 두 개(진짜 앞 migration),
// 폴더 휴지통 칸·숨김 정책(20261025180000의 해당 부분만 — 휴지통 RPC는 이 시험과 무관), service_role은 schema private USAGE 없음.
const shapes=`
  create table public.app_documents(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
    project_id uuid references public.app_spaces(id) on delete set null,title text,category text,visibility text default 'private');
  alter table public.app_documents enable row level security;
  create policy task12a_owner_all on public.app_documents for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke all on public.app_documents from anon;
  revoke truncate, references, trigger on public.app_documents from authenticated;
  create function private.app_is_owner_profile(p_user uuid)
  returns boolean language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select exists (
      select 1
      from public.app_workspace_members subject
      join public.app_workspace_members owner
        on owner.workspace_id = subject.workspace_id
       and owner.role = 'owner'
       and owner.user_id = (select auth.uid())
      where subject.user_id = p_user
    )
  $$;
  revoke all on function private.app_is_owner_profile(uuid) from public, anon, authenticated;
  grant execute on function private.app_is_owner_profile(uuid) to authenticated, service_role;
  create table public.app_profiles(user_id uuid primary key,display_name text,library_view jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
  alter table public.app_profiles enable row level security;
  create policy task12a_owner_all on public.app_profiles for all to authenticated
    using (private.app_is_owner_profile(user_id)) with check (private.app_is_owner_profile(user_id));
  create policy task12a_profile_self_select on public.app_profiles for select to authenticated
    using (user_id = (select auth.uid()));
  revoke all on public.app_profiles from public, anon, authenticated;
  grant select, update on public.app_profiles to authenticated;
  insert into public.app_profiles(user_id,display_name) values ('${OWNER}','소유자'),('${STRANGER}','남');
`;
const trashShape=`
  alter table public.app_library_folders add column deleted_at timestamptz, add column deleted_root_id uuid;
  alter table public.app_library_folders add constraint app_library_folders_trash_pair_check check ((deleted_at is null) = (deleted_root_id is null));
  create policy app_library_folders_trash_hidden on public.app_library_folders as restrictive for all to authenticated
    using (deleted_at is null) with check (deleted_at is null and deleted_root_id is null);
  insert into supabase_migrations.schema_migrations(version,name) values('20261025180000','trash_library_folder_db');
  revoke usage on schema private from service_role;
`;

test('LIB-받는폴더 DB: prechecks, dry-run, apply, new documents go to the receive folder from any writer, other workspace and trash ignored, purge clears it, access not widened, rollback',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'library-receive-folder-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(shapes);
  await pool.query(await read('supabase/migrations/20261022120000_library_folders.sql'));
  await pool.query(await read('supabase/migrations/20261026170000_library_folders_free.sql'));
  await pool.query(trashShape);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  const saveSnapshot=async()=>{};
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const folder=(c,{ws=WS_A,parent=null,label='예시 폴더',order=0}={})=>c.query('insert into public.app_library_folders(workspace_id,project_id,parent_id,name,sort_order) values($1,null,$2,$3,$4) returning id',[ws,parent,label,order]).then(r=>r.rows[0].id);
  const addDoc=(c,ws=WS_A,title='예시 자료')=>c.query('insert into public.app_documents(workspace_id,title) values($1,$2) returning id',[ws,title]).then(r=>r.rows[0].id);
  const folderOf=async document=>(await pool.query('select folder_id from public.app_library_folder_items where document_id=$1',[document])).rows[0]?.folder_id??null;
  const receiveOf=async user=>(await pool.query('select library_receive_folder r from public.app_profiles where user_id=$1',[user])).rows[0].r;
  const setReceive=(sub,user,id)=>as('authenticated',sub,c=>c.query('update public.app_profiles set library_receive_folder=$1 where user_id=$2',[id,user]));

  const A1=await owner(c=>folder(c,{label:'예시 받는 폴더'})),A2=await owner(c=>folder(c,{label:'예시 다른 폴더',order:1})),A3=await owner(c=>folder(c,{parent:A1,label:'예시 안 폴더'}));
  const B1=await stranger(c=>folder(c,{ws:WS_B,label:'남의 폴더'}));
  const OUT1=await owner(c=>addDoc(c,WS_A,'예시 폴더 밖 자료'));
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;
  const pre=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));

  await t.test('precheck: every yes/no item is yes before apply',()=>{
   const yesNo=beforeCheck.filter(r=>/^(예|아니오)$/.test(r.value));
   assert.equal(yesNo.length,9);assert.ok(yesNo.every(r=>r.value==='예'),JSON.stringify(yesNo));
  });
  await t.test('static plan accepts dry-run and apply under the expanded rules (one definer trigger function, no grants or policies)',()=>{
   for(const mode of ['dry-run','apply']){const p=plan(mode,'1');assert.equal(p.expanded,true);assert.deepEqual(p.review.definer,['private.app_documents_receive_folder']);assert.equal(p.review.grants,0);assert.equal(p.review.policies,0);assert.equal(p.review.triggers,1)}
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9911');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('prerequisite changes stop the migration without any change',async()=>{
   const attempts=[
    ['grant select on public.app_profiles to anon','revoke select on public.app_profiles from anon'],
    ['alter table public.app_profiles disable row level security','alter table public.app_profiles enable row level security'],
    ['revoke update on public.app_profiles from authenticated','grant update on public.app_profiles to authenticated'],
    ["create policy synthetic_extra on public.app_profiles for select to authenticated using (true)",'drop policy synthetic_extra on public.app_profiles'],
    ['grant select on public.app_library_folder_items to anon','revoke select on public.app_library_folder_items from anon'],
    ["delete from supabase_migrations.schema_migrations where version='20261025180000'","insert into supabase_migrations.schema_migrations(version,name) values('20261025180000','trash_library_folder_db')"],
    ["insert into supabase_migrations.schema_migrations(version,name) values('20261111181000','library_receive_folder')","delete from supabase_migrations.schema_migrations where version='20261111181000'"],
   ];
   for(const [breakIt,fixIt] of attempts){
    await pool.query(breakIt);
    try{const c=await pool.connect();try{await assert.rejects(c.query(migration),/LIBRARY_RECEIVE_FOLDER_PREREQUISITE_CHANGED/,breakIt);await c.query('rollback');}finally{c.release();}}
    finally{await pool.query(fixIt);}
   }
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; hashes equal precheck; existing rows untouched',async()=>{
   const apply=await run('apply','9912');assert.equal(apply.ok,true,apply.summary);
   const post=(await pool.query(postcheck)).rows;
   assert.ok(post.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'),JSON.stringify(post));
   for(const r of post.filter(r=>!/^(예|아니오)$/.test(r.value)))assert.equal(r.value,pre[r.item],r.item);
   assert.equal(await receiveOf(OWNER),null,'기존 프로필은 꺼진 채');
   assert.equal(await folderOf(OUT1),null,'기존 폴더 밖 자료는 그대로(한 번에 옮기기는 화면에서)');
   assert.equal((await pool.query("select relacl::text acl from pg_class where oid='public.app_profiles'::regclass")).rows[0].acl.match(/authenticated=[a-z]*/)[0],'authenticated=rw');
  });
  await t.test('off: a new document stays outside any folder',async()=>{
   const d=await owner(c=>addDoc(c));assert.equal(await folderOf(d),null);
  });
  await t.test('the owner turns the receive folder on for the own row only; another row and a missing folder are refused',async()=>{
   assert.equal((await setReceive(OWNER,OWNER,A1)).rowCount,1);assert.equal(await receiveOf(OWNER),A1);
   assert.equal((await setReceive(OWNER,STRANGER,A1)).rowCount,0,'another profile row is not writable');
   assert.equal((await setReceive(STRANGER,OWNER,B1)).rowCount,0,'a stranger cannot write my row');
   await assert.rejects(setReceive(OWNER,OWNER,'29000000-0000-4000-8000-00000000ffff'),{code:'23503'});
   assert.equal(await receiveOf(OWNER),A1);
   await assert.rejects(as('anon','',c=>c.query('select library_receive_folder from public.app_profiles limit 1')),{code:'42501'});
  });
  await t.test('on: new documents from the signed-in owner and from the server key both go to the receive folder',async()=>{
   const d1=await owner(c=>addDoc(c));assert.equal(await folderOf(d1),A1);
   const d2=await as('service_role','',c=>addDoc(c));assert.equal(await folderOf(d2),A1,'service_role path (no schema private usage)');
   const many=(await as('service_role','',c=>c.query("insert into public.app_documents(workspace_id,title) select $1,'예시 '||g from generate_series(1,3) g returning id",[WS_A]))).rows.map(r=>r.id);
   for(const id of many)assert.equal(await folderOf(id),A1);
   const other=await stranger(c=>addDoc(c,WS_B));assert.equal(await folderOf(other),null,'다른 작업공간 자료는 내 받는 폴더와 무관');
  });
  await t.test('a document opened into a folder is then moved by the owner as before (owner RLS update)',async()=>{
   const d=await owner(c=>addDoc(c));assert.equal(await folderOf(d),A1);
   assert.equal((await owner(c=>c.query('update public.app_library_folder_items set folder_id=$1 where document_id=$2 and workspace_id=$3',[A2,d,WS_A]))).rowCount,1);
   assert.equal(await folderOf(d),A2);
   // 같은 문장 안에서 이미 연결이 있으면 건드리지 않는다는 것은 on conflict do nothing — 이미 연결된 자료를 다시 넣는 길은 없으므로 행이 하나뿐인지만 본다.
   assert.equal((await pool.query('select count(*)::int n from public.app_library_folder_items where document_id=$1',[d])).rows[0].n,1);
  });
  await t.test('a folder of another workspace in my row is ignored by the server',async()=>{
   await pool.query('update public.app_profiles set library_receive_folder=$1 where user_id=$2',[B1,OWNER]);
   const d=await owner(c=>addDoc(c));assert.equal(await folderOf(d),null);
   const d2=await as('service_role','',c=>addDoc(c));assert.equal(await folderOf(d2),null);
   assert.equal((await pool.query('select count(*)::int n from public.app_library_folder_items where folder_id=$1',[B1])).rows[0].n,0,'남의 폴더에 아무것도 들어가지 않음');
   await setReceive(OWNER,OWNER,A1);
  });
  await t.test('a receive folder in the trash is ignored; back from the trash it receives again; a sub folder works too',async()=>{
   await pool.query('update public.app_library_folders set deleted_at=now(),deleted_root_id=$1 where id in ($1,$2)',[A1,A3]);
   const d=await owner(c=>addDoc(c));assert.equal(await folderOf(d),null);
   await pool.query('update public.app_library_folders set deleted_at=null,deleted_root_id=null where id in ($1,$2)',[A1,A3]);
   const d2=await owner(c=>addDoc(c));assert.equal(await folderOf(d2),A1);
   await setReceive(OWNER,OWNER,A3);
   const d3=await owner(c=>addDoc(c));assert.equal(await folderOf(d3),A3);
   assert.equal((await setReceive(OWNER,OWNER,null)).rowCount,1);
   const d4=await owner(c=>addDoc(c));assert.equal(await folderOf(d4),null,'끄면 지금처럼 폴더 밖');
  });
  await t.test('a permanently deleted receive folder clears the setting',async()=>{
   const P=await owner(c=>folder(c,{label:'예시 지울 폴더',order:5}));
   await setReceive(OWNER,OWNER,P);assert.equal(await receiveOf(OWNER),P);
   await pool.query('delete from public.app_library_folders where id=$1',[P]);
   assert.equal(await receiveOf(OWNER),null);
   const d=await owner(c=>addDoc(c));assert.equal(await folderOf(d),null);
  });
  await t.test('nobody but the trigger can run the function; no new grants',async()=>{
   for(const role of ['anon','authenticated','service_role'])assert.equal((await pool.query("select has_function_privilege($1,'private.app_documents_receive_folder()','execute') ok",[role])).rows[0].ok,false,role);
   assert.equal((await pool.query("select has_column_privilege('anon','public.app_profiles','library_receive_folder','select') ok")).rows[0].ok,false);
   assert.equal((await pool.query("select has_table_privilege('service_role','public.app_library_folder_items','insert') ok")).rows[0].ok,false,'서버 키에 폴더 연결 표 권한을 주지 않음');
  });
  await t.test('rollback removes trigger, function and column; filed documents stay; re-apply works',async()=>{
   await setReceive(OWNER,OWNER,A1);
   const filed=await owner(c=>addDoc(c));assert.equal(await folderOf(filed),A1);
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
   assert.equal(await folderOf(filed),A1,'이미 들어간 자료는 그대로');
   const after=await owner(c=>addDoc(c));assert.equal(await folderOf(after),null,'되돌린 뒤에는 지금처럼 폴더 밖');
   const again=await run('apply','9915');assert.equal(again.ok,true,again.summary);
   const post=(await pool.query(postcheck)).rows;assert.ok(post.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'),JSON.stringify(post));
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
