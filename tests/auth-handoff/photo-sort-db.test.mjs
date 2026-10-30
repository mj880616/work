// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// PHOTO-정렬 1/2 DB(20261030150000_photo_sort): app_onedrive_photos.uploaded_at(원드라이브 올린 시각, null 허용) +
// app_profiles_view_prefs_check의 photo_view가 sort(taken_desc|taken_asc|uploaded_desc|name_asc|size_desc|duration_desc)를 받는다.
// - 다른 칸 규칙 그대로(앞선 열아홉 칸을 그대로 받고, 전에 거절하던 값은 계속 거절).
// - 권한 그대로: 색인 표는 service_role만(authenticated·anon 아무것도 못 함), 프로필은 내 행만. 표 권한·정책 수 그대로.
// - 승인형 workflow의 plan·dry-run·apply가 통과하고, rollback은 저장된 정렬 기준이 있으면 멈춘 뒤 비우면 원래 모양으로 돌아간다.
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
const version='20261030150000',name='photo_sort',stem=version+'_'+name;
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

// The earlier view_prefs and OneDrive migrations are applied from the repository files as they were.
const EARLIER=['20261023180000_profile_view_prefs','20261027020000_profile_view_prefs_report_view','20261027040000_profile_view_prefs_theme10',
 '20261027070000_profile_view_prefs_theme_refresh','20261028020000_profile_view_prefs_menu_home','20261028090000_profile_view_prefs_photo_cols',
 '20261028100000_profile_view_prefs_diary_view','20261028150000_profile_view_prefs_diary_onedrive','20261026140000_diary_onedrive_db','20261028010000_onedrive_photo_index',
 '20261028220000_photo_menu_index','20261029010000_profile_view_prefs_split_screens','20261029103000_profile_view_prefs_quiet_weeks','20261029183000_profile_view_prefs_note_view',
 '20261030091000_profile_view_prefs_note_boards'];

test('photo sort: plan, dry-run, apply, service_role column, own-row prefs, CHECK and guarded rollback',{timeout:150000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'photo-sort-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(prerequisites);
  for(const f of EARLIER)await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query(`insert into public.app_onedrive_connections(workspace_id,refresh_token,scope,folder_id,folder_name,folder_path)
   values ($1,'synthetic-refresh-0001','files.readwrite user.read','TOP!1','top','/drive/root:/top')`,[WS_A]);
  await pool.query(`insert into public.app_onedrive_folders(workspace_id,item_id,parent_id,name) values ($1,'TOP!1',null,'top'),($1,'SUB!1','TOP!1','sub')`,[WS_A]);
  await pool.query(`insert into public.app_onedrive_photos(workspace_id,item_id,parent_id,name,taken_at,taken_day,size_bytes) values ($1,'P!1','SUB!1','img-1.jpg','2026-10-01T03:00:00Z','2026-10-01',1000)`,[WS_A]);
  const rollbackSQL=await read('docs/'+stem+'.rollback.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  const saveSnapshot=async()=>{};
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const svc=fn=>as('service_role','',fn);
  const write=(sub,user,value)=>as('authenticated',sub,c=>c.query('update public.app_profiles set view_prefs=$1::jsonb where user_id=$2',[value===null?null:JSON.stringify(value),user]));
  const saved_=async user=>(await pool.query('select view_prefs from public.app_profiles where user_id=$1',[user])).rows[0].view_prefs;
  const rows=async(sql,args=[])=>(await pool.query(sql,args)).rows;
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;
  const base={theme:'lemon',split_ratio:{tasks:0.4,reports3:0.25},home_cards:['quiet','todo'],diary_view:'list',photo_view:{filter:'star',cols:4},quiet_weeks:3,note_view:'board',note_boards:[{id:'b1a2b3c4',name:'보드'}],note_board:'b1a2b3c4'};
  const SORTS=['taken_desc','taken_asc','uploaded_desc','name_asc','size_desc','duration_desc'];
  const S={photo_view:{filter:'all',cols:6,sort:'name_asc'}};

  await t.test('before apply: precheck values, the CHECK refuses photo sort, the new column is absent',async()=>{
   const v=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));
   for(const k of ['prerequisites recorded','new migration absent','view prefs check without photo sort','RLS enabled on two tables',
    'photo index has no policy and no client grant','service_role four privileges on photo index','two owner policies on profiles'])assert.equal(v[k],'예',k);
   assert.equal(v['anon or public table privilege'],'아니오');
   assert.deepEqual([v['uploaded at column present'],v['saved photo sort keys'],v['profiles rows']],['0','0','3']);
   for(const n of [S,{photo_view:{sort:'taken_desc'}}])await assert.rejects(write(OWNER,OWNER,n),{code:'23514'},JSON.stringify(n));
   assert.equal((await write(OWNER,OWNER,base)).rowCount,1,'the old keys are accepted before');await write(OWNER,OWNER,null);
   await assert.rejects(svc(c=>c.query("update public.app_onedrive_photos set uploaded_at=now()")),{code:'42703'});
  });
  await t.test('plan accepts the migration (strict rules, full flow) and the rollback file',()=>{
   const p=plan('apply','9930');assert.ok(p&&!p.rejected,JSON.stringify(p).slice(0,300));assert.equal(p.rules,'strict');assert.equal(p.flow,'full');
   assert.deepEqual(p.targets,['app_onedrive_photos','app_profiles']);
   assert.ok(plan('rollback','9931'));
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9932');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('apply passes postcheck; existing rows keep their values; grants and policies unchanged',async()=>{
   const apply=await run('apply','9933');assert.equal(apply.ok,true,apply.summary);
   assert.ok((await pool.query(postcheck)).rows.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'));
   assert.deepEqual(await rows("select item_id,name,size_bytes::int s,uploaded_at from public.app_onedrive_photos"),[{item_id:'P!1',name:'img-1.jpg',s:1000,uploaded_at:null}]);
   assert.deepEqual((await rows('select view_prefs from public.app_profiles')).map(r=>r.view_prefs),[null,null,null]);
   assert.equal((await rows("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name]))[0].n,1);
   assert.equal((await rows("select count(*)::int n from pg_policy where polrelid='public.app_profiles'::regclass"))[0].n,2);
   assert.equal((await rows("select count(*)::int n from pg_policy where polrelid='public.app_onedrive_photos'::regclass"))[0].n,0);
   assert.equal((await rows("select relacl::text acl from pg_class where oid='public.app_profiles'::regclass"))[0].acl.match(/authenticated=[a-z]*/)[0],'authenticated=rw');
  });
  await t.test('service_role writes uploaded_at; client roles still have nothing on the photo index',async()=>{
   await svc(c=>c.query("update public.app_onedrive_photos set uploaded_at='2026-10-05T01:02:03Z' where workspace_id=$1 and item_id='P!1'",[WS_A]));
   assert.equal((await rows("select uploaded_at from public.app_onedrive_photos"))[0].uploaded_at.toISOString(),'2026-10-05T01:02:03.000Z');
   for(const role of ['authenticated','anon']){
    await assert.rejects(as(role,OWNER,c=>c.query('select uploaded_at from public.app_onedrive_photos')),{code:'42501'});
    await assert.rejects(as(role,OWNER,c=>c.query('update public.app_onedrive_photos set uploaded_at=now()')),{code:'42501'});
   }
  });
  await t.test('the owner saves each photo sort alone and with the old keys; other rows, outsiders and anon cannot',async()=>{
   for(const sort of SORTS)for(const value of [{photo_view:{sort}},{...base,photo_view:{filter:'video',cols:5,sort}}]){
    assert.equal((await write(OWNER,OWNER,value)).rowCount,1,JSON.stringify(value));assert.deepEqual(await saved_(OWNER),value);}
   for(const value of [{photo_view:{}},{photo_view:{filter:'shot',cols:12}}]){assert.equal((await write(OWNER,OWNER,value)).rowCount,1);assert.deepEqual(await saved_(OWNER),value);}
   assert.equal((await write(OWNER,STRANGER,S)).rowCount,0,'another profile row is not writable');
   assert.equal((await write(OUTSIDER,OUTSIDER,S)).rowCount,0,'a non-owner member cannot write even the own row');
   assert.equal(await saved_(OUTSIDER),null);
   await assert.rejects(as('anon','',c=>c.query('select view_prefs from public.app_profiles limit 1')),{code:'42501'});
  });
  await t.test('the CHECK refuses malformed photo sort values and still refuses what it refused before',async()=>{
   const bad=[{photo_view:{sort:'newest'}},{photo_view:{sort:'TAKEN_DESC'}},{photo_view:{sort:''}},{photo_view:{sort:1}},{photo_view:{sort:null}},{photo_view:{sort:['name_asc']}},
    {photo_view:{sort:'name_desc'}},{photo_view:{sort:'size_asc'}},{photo_view:{order:'name_asc'}},{photo_sort:'name_asc'},
    {photo_view:'all'},{photo_view:{filter:'x'}},{photo_view:{cols:2}},{photo_view:{cols:'5'}},
    {note_board:'b12'},{note_view:'grid'},{quiet_weeks:13},{split_ratio:{chat:0.3}},{theme:'dark'},{extra:'x'},[],'x',{diary_onedrive:'true'}];
   for(const value of bad)await assert.rejects(write(OWNER,OWNER,value),{code:'23514'},JSON.stringify(value));
  });
  await t.test('rollback refuses while a photo sort is saved, and keeps it',async()=>{
   await write(OWNER,OWNER,S);
   const result=await run('rollback','9934');assert.equal(result.ok,false,result.summary);
   const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/PHOTO_SORT_ROLLBACK_BLOCKED: photo sort saved/);await c.query('rollback');}finally{c.release();}
   assert.deepEqual(await saved_(OWNER),S);
  });
  await t.test('rollback restores the previous schema once no photo sort remains; rows and other prefs survive; re-apply works',async()=>{
   await write(OWNER,OWNER,base);
   await pool.query(rollbackSQL);
   assert.equal((await rows("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version]))[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal((await rows('select count(*)::int n from public.app_onedrive_photos'))[0].n,1);
   await assert.rejects(write(OWNER,OWNER,S),{code:'23514'});
   assert.deepEqual(await saved_(OWNER),base,'other saved values survive the rollback');
   const again=await run('apply','9935');assert.equal(again.ok,true,again.summary);
  });
  await t.test('pair files read pg_catalog only and the migration grants nothing',async()=>{
   const code=sql=>sql.replace(/--.*$/gm,'');
   for(const kind of ['precheck','snapshot','postcheck','rollback'])assert.doesNotMatch(code(await read(`docs/${stem}.${kind}.sql`)),/information_schema/i,kind);
   assert.doesNotMatch(code(await read(`supabase/migrations/${stem}.sql`)),/\b(grant|revoke)\b|create policy|create index|disable row level security/i);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
