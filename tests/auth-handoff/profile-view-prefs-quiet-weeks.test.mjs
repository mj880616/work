// Fresh local PostgreSQL only. No Supabase, Microsoft or production credentials. All data synthetic (no real photo names or places).
// FEAT-1029묶음 ③: app_profiles_view_prefs_check accepts quiet_weeks (integer 0..12) through the approved DB workflow runner.
// - app_onedrive_photos 새 칸(종류·형식·크기·가로세로·길이·sha1·위치·스크린샷·휴지통)과 app_onedrive_folders role(trash, 작업공간당 하나).
// - app_profiles_view_prefs_check가 photo_view({filter, cols})를 받는다(다른 칸 규칙 그대로).
// - 권한은 그대로: 색인 표는 service_role만, authenticated·anon은 아무것도 못 한다. 프로필은 내 행만.
// - 승인형 workflow의 plan·dry-run·apply가 통과하고, rollback은 저장된 photo_view·휴지통 사진이 있으면 멈춘 뒤 비우면 원래 모양으로 돌아간다.
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
import {fixture,OWNER,STRANGER,WS_A} from './basket4-fixture.mjs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261029103000',name='profile_view_prefs_quiet_weeks',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const OUTSIDER='20000000-0000-4000-8000-000000000003';
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Production-like prerequisites (task12a + doc_categories_profile already recorded): app_profiles with owner RLS,
// authenticated SELECT/UPDATE only, anon revoked.
const prerequisites=`
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
  create table public.app_profiles(user_id uuid primary key,display_name text,job_title text,created_at timestamptz default now(),updated_at timestamptz default now());
  alter table public.app_profiles enable row level security;
  create policy task12a_owner_all on public.app_profiles for all to authenticated
    using (private.app_is_owner_profile(user_id)) with check (private.app_is_owner_profile(user_id));
  create policy task12a_profile_self_select on public.app_profiles for select to authenticated
    using (user_id = (select auth.uid()));
  revoke all on public.app_profiles from public, anon, authenticated;
  grant select, update on public.app_profiles to authenticated;
  insert into public.app_workspace_members values ('${WS_A}', '${OUTSIDER}', 'viewer');
  insert into public.app_profiles(user_id,display_name) values ('${OWNER}','소유자'),('${STRANGER}','남'),('${OUTSIDER}','다른 구성원');
  insert into supabase_migrations.schema_migrations(version,name) values('20261018112943','doc_categories_profile'),('20261022163000','profile_quick_links'),('20261023150000','profile_library_view');
`;

test('view prefs quiet weeks: plan, dry-run, apply, own-row writes, CHECK and guarded rollback',{timeout:150000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'view-prefs-quiet-weeks-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(prerequisites);
  // The earlier view_prefs and OneDrive migrations are applied from the repository files as they were.
  for(const f of ['20261023180000_profile_view_prefs','20261027020000_profile_view_prefs_report_view','20261027040000_profile_view_prefs_theme10',
   '20261027070000_profile_view_prefs_theme_refresh','20261028020000_profile_view_prefs_menu_home','20261028090000_profile_view_prefs_photo_cols',
   '20261028100000_profile_view_prefs_diary_view','20261028150000_profile_view_prefs_diary_onedrive','20261026140000_diary_onedrive_db','20261028010000_onedrive_photo_index',
   '20261028220000_photo_menu_index','20261029010000_profile_view_prefs_split_screens'])
   await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const rollbackSQL=await read('docs/'+stem+'.rollback.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  const saveSnapshot=async()=>{};
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const write=(sub,user,value)=>as('authenticated',sub,c=>c.query('update public.app_profiles set view_prefs=$1::jsonb where user_id=$2',[value===null?null:JSON.stringify(value),user]));
  const saved_=async user=>(await pool.query('select view_prefs from public.app_profiles where user_id=$1',[user])).rows[0].view_prefs;
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;
  const base={theme:'lemon',split_ratio:{tasks:0.4,telegram:0.3,reports3:0.25},home_cards:['quiet','todo'],diary_view:'list',photo_view:{filter:'star',cols:4}};
  const NEW={quiet_weeks:3};

  await t.test('before apply the CHECK refuses quiet_weeks and accepts the old keys',async()=>{
   const v=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));
   assert.deepEqual([v['prerequisite recorded'],v['new migration absent'],v['view prefs check without quiet weeks'],v['saved quiet weeks'],v['RLS enabled'],v['anon or public table privilege'],v['two owner policies'],v['profiles rows']],
    ['예','예','예','0','예','아니오','예','3']);
   for(const n of [0,3,12])await assert.rejects(write(OWNER,OWNER,{quiet_weeks:n}),{code:'23514'},String(n));
   assert.equal((await write(OWNER,OWNER,base)).rowCount,1,'the old keys are accepted before');
   await write(OWNER,OWNER,null);
  });
  await t.test('plan accepts the migration and its companion files',()=>{
   const p=plan('apply','9730');assert.ok(p&&!p.rejected,JSON.stringify(p).slice(0,300));
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9731');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('apply passes postcheck; grants, policies and rows unchanged',async()=>{
   const apply=await run('apply','9732');assert.equal(apply.ok,true,apply.summary);
   assert.ok((await pool.query(postcheck)).rows.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'));
   assert.deepEqual((await pool.query('select view_prefs from public.app_profiles')).rows.map(r=>r.view_prefs),[null,null,null]);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
   assert.equal((await pool.query("select relacl::text acl from pg_class where oid='public.app_profiles'::regclass")).rows[0].acl.match(/authenticated=[a-z]*/)[0],'authenticated=rw');
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid='public.app_profiles'::regclass")).rows[0].n,2);
  });
  await t.test('the owner saves quiet_weeks with the old keys; other rows, outsiders and anon cannot',async()=>{
   for(const value of [NEW,{quiet_weeks:0},{quiet_weeks:12},{...base,quiet_weeks:6}]){assert.equal((await write(OWNER,OWNER,value)).rowCount,1,JSON.stringify(value));assert.deepEqual(await saved_(OWNER),value);}
   assert.equal((await write(OWNER,STRANGER,NEW)).rowCount,0,'another profile row is not writable');
   assert.equal((await write(OUTSIDER,OUTSIDER,NEW)).rowCount,0,'a non-owner member cannot write even the own row');
   assert.equal(await saved_(OUTSIDER),null);
   await assert.rejects(as('anon','',c=>c.query('select view_prefs from public.app_profiles limit 1')),{code:'42501'});
  });
  await t.test('the CHECK refuses malformed quiet_weeks and still refuses what it refused before',async()=>{
   const bad=[{quiet_weeks:13},{quiet_weeks:-1},{quiet_weeks:2.5},{quiet_weeks:'3'},{quiet_weeks:null},{quiet_weeks:true},{quiet_weeks:[3]},{quiet_weeks:{w:3}},{split_ratio:{chat:0.3}},{split_ratio:{telegram:1}},
    {theme:'dark'},{extra:'x'},[],'x',{photo_view:{cols:2}},{diary_onedrive:'true'}];
   for(const value of bad)await assert.rejects(write(OWNER,OWNER,value),{code:'23514'},JSON.stringify(value));
   await write(OWNER,OWNER,NEW);
  });
  await t.test('rollback refuses while quiet_weeks is saved, and keeps it',async()=>{
   const result=await run('rollback','9733');assert.equal(result.ok,false,result.summary);
   const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/PROFILE_VIEW_PREFS_QUIET_WEEKS_ROLLBACK_BLOCKED: quiet_weeks saved/);await c.query('rollback');}finally{c.release();}
   assert.deepEqual(await saved_(OWNER),NEW);
  });
  await t.test('rollback restores the previous schema once no quiet_weeks remains; re-apply works',async()=>{
   await write(OWNER,OWNER,base);
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await assert.rejects(write(OWNER,OWNER,NEW),{code:'23514'});
   assert.deepEqual(await saved_(OWNER),base,'other saved values survive the rollback');
   const again=await run('apply','9735');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
