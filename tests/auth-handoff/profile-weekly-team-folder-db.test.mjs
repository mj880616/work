// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic (no real folder or document names).
// S70-11 WEEKLY-저장폴더나누기 DB: 20261125193000_profile_weekly_team_folder — app_profiles.weekly_team_folder(팀 보고 취합 저장 폴더, 외래 키, 폴더가 지워지면 비움).
// 승인형 DB workflow 실행기로 plan·dry-run·apply를 시험하고, 앞 단계(20261124203000 weekly_folder)가 없으면 멈추는지, 내 행만 쓰는지, 남의 행·없는 폴더는 거절되는지,
// 권한이 넓어지지 않는지, 되돌리기가 이 칸만 지우는지(내 주간 보고 칸 weekly_folder는 그대로) 본다. 모양(앞 표·정책)은 library-receive-folder-db 시험과 같다.
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
const version='20261125193000',name='profile_weekly_team_folder',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// 운영과 같은 앞 모양(library-receive-folder-db.test.mjs에서 그대로): 자료 표(owner RLS), 프로필 표(task12a 두 정책, authenticated SELECT/UPDATE만), 폴더 표 두 개(진짜 앞 migration).
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

test('WEEKLY-저장폴더나누기 DB: precheck, plan, dry-run, prerequisite stop, apply, own row only, fk set null, access not widened, rollback keeps weekly_folder',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'weekly-team-folder-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(shapes);
  await pool.query(await read('supabase/migrations/20261022120000_library_folders.sql'));
  await pool.query(await read('supabase/migrations/20261026170000_library_folders_free.sql'));
  await pool.query(trashShape);
  await pool.query(await read('supabase/migrations/20261111181000_library_receive_folder.sql'));
  await pool.query(await read('supabase/migrations/20261124203000_profile_weekly_folder.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const folder=(c,{ws=WS_A,parent=null,label='예시 폴더',order=0}={})=>c.query('insert into public.app_library_folders(workspace_id,project_id,parent_id,name,sort_order) values($1,null,$2,$3,$4) returning id',[ws,parent,label,order]).then(r=>r.rows[0].id);
  const colsOf=async user=>(await pool.query('select weekly_folder w, weekly_team_folder t from public.app_profiles where user_id=$1',[user])).rows[0];
  const setTeam=(sub,user,id)=>as('authenticated',sub,c=>c.query('update public.app_profiles set weekly_team_folder=$1 where user_id=$2',[id,user]));

  const A1=await owner(c=>folder(c,{label:'예시 보고'})),A2=await owner(c=>folder(c,{parent:A1,label:'예시 내 보고'})),A3=await owner(c=>folder(c,{parent:A1,label:'예시 팀 모음',order:1}));
  await owner(c=>c.query('update public.app_profiles set weekly_folder=$1 where user_id=$2',[A2,OWNER]));
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;
  const pre=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));

  await t.test('precheck: every yes/no item is yes before apply',()=>{
   const yesNo=beforeCheck.filter(r=>/^(예|아니오)$/.test(r.value));
   assert.equal(yesNo.length,5);assert.ok(yesNo.every(r=>r.value==='예'),JSON.stringify(yesNo));
  });
  await t.test('static plan accepts dry-run and apply (no grants, policies, functions or triggers)',()=>{
   for(const mode of ['dry-run','apply']){const p=plan(mode,'1');assert.ok(p,mode);if(p.review){assert.equal(p.review.grants||0,0);assert.equal(p.review.policies||0,0);assert.equal(p.review.triggers||0,0);assert.deepEqual(p.review.definer||[],[])}}
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9921');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('prerequisite changes stop the migration without any change',async()=>{
   const attempts=[
    ["delete from supabase_migrations.schema_migrations where version='20261124203000'","insert into supabase_migrations.schema_migrations(version,name) values('20261124203000','profile_weekly_folder')"],
    ['grant select on public.app_profiles to anon','revoke select on public.app_profiles from anon'],
    ['alter table public.app_profiles disable row level security','alter table public.app_profiles enable row level security'],
    ['revoke update on public.app_profiles from authenticated','grant update on public.app_profiles to authenticated'],
    ["insert into supabase_migrations.schema_migrations(version,name) values('20261125193000','profile_weekly_team_folder')","delete from supabase_migrations.schema_migrations where version='20261125193000'"],
   ];
   for(const [breakIt,fixIt] of attempts){
    await pool.query(breakIt);
    try{const c=await pool.connect();try{await assert.rejects(c.query(migration),/PROFILE_WEEKLY_TEAM_FOLDER_PREREQUISITE_CHANGED/,breakIt);await c.query('rollback');}finally{c.release();}}
    finally{await pool.query(fixIt);}
   }
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; hashes equal precheck; weekly_folder untouched and the new column starts empty',async()=>{
   const apply=await run('apply','9922');assert.equal(apply.ok,true,apply.summary);
   const post=(await pool.query(postcheck)).rows;
   assert.ok(post.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'),JSON.stringify(post));
   for(const r of post.filter(r=>!/^(예|아니오)$/.test(r.value)))assert.equal(r.value,pre[r.item],r.item);
   assert.deepEqual(await colsOf(OWNER),{w:A2,t:null});
   assert.equal((await pool.query("select relacl::text acl from pg_class where oid='public.app_profiles'::regclass")).rows[0].acl.match(/authenticated=[a-z]*/)[0],'authenticated=rw');
   assert.equal((await pool.query("select has_any_column_privilege('anon','public.app_profiles','select,insert,update,references') v")).rows[0].v,false);
  });
  await t.test('the owner sets the own row only; another row and a missing folder are refused; a deleted folder clears it',async()=>{
   assert.equal((await setTeam(OWNER,OWNER,A3)).rowCount,1);assert.deepEqual(await colsOf(OWNER),{w:A2,t:A3});
   assert.equal((await setTeam(OWNER,STRANGER,A3)).rowCount,0,'남의 행은 보이지 않아 바뀌지 않음');
   assert.equal((await setTeam(STRANGER,OWNER,A3)).rowCount,0);
   await assert.rejects(setTeam(OWNER,OWNER,'43000000-0000-4000-8000-0000000000ff'),/foreign key|violates/);
   await assert.rejects(as('anon','',c=>c.query('update public.app_profiles set weekly_team_folder=null')),/permission denied/);
   await pool.query('delete from public.app_library_folders where id=$1',[A3]);
   assert.deepEqual(await colsOf(OWNER),{w:A2,t:null});
  });
  await t.test('rollback removes only this column and record; weekly_folder stays; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from pg_attribute where attrelid='public.app_profiles'::regclass and attname='weekly_team_folder' and not attisdropped")).rows[0].n,0);
   assert.equal((await pool.query("select weekly_folder w from public.app_profiles where user_id=$1",[OWNER])).rows[0].w,A2);
   assert.equal((await pool.query(`select count(*)::int n from supabase_migrations.schema_migrations where version='${version}'`)).rows[0].n,0);
   const again=await run('apply','9923');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
