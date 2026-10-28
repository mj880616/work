// Fresh local PostgreSQL only. No Supabase, Microsoft or production credentials. All data synthetic (no real photo names or places).
// PHOTO-사진메뉴 서버 ① DB(20261028220000_photo_menu_index):
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
const version='20261028220000',name='photo_menu_index',stem=version+'_'+name;
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

test('photo menu index: plan, dry-run, apply, service_role-only columns, photo_view CHECK and guarded rollback',{timeout:150000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'photo-menu-index-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(prerequisites);
  // The earlier view_prefs and OneDrive migrations are applied from the repository files as they were.
  for(const f of ['20261023180000_profile_view_prefs','20261027020000_profile_view_prefs_report_view','20261027040000_profile_view_prefs_theme10',
   '20261027070000_profile_view_prefs_theme_refresh','20261028020000_profile_view_prefs_menu_home','20261028090000_profile_view_prefs_photo_cols',
   '20261028100000_profile_view_prefs_diary_view','20261028150000_profile_view_prefs_diary_onedrive','20261026140000_diary_onedrive_db','20261028010000_onedrive_photo_index'])
   await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query(`insert into public.app_onedrive_connections(workspace_id,refresh_token,scope,folder_id,folder_name,folder_path)
   values ($1,'synthetic-refresh-0001','files.readwrite user.read','TOP!1','top','/drive/root:/top')`,[WS_A]);
  await pool.query(`insert into public.app_onedrive_folders(workspace_id,item_id,parent_id,name) values ($1,'TOP!1',null,'top'),($1,'SUB!1','TOP!1','sub')`,[WS_A]);
  await pool.query(`insert into public.app_onedrive_photos(workspace_id,item_id,parent_id,name,taken_at,taken_day) values ($1,'P!1','SUB!1','img-1.jpg','2026-10-01T03:00:00Z','2026-10-01')`,[WS_A]);
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
  const base={theme:'lemon',home_cards:['todo'],photo_cols:3,photo_cols_wide:8,diary_view:'list',diary_onedrive:false};
  const PV={photo_view:{filter:'video',cols:5}};

  await t.test('before apply: precheck values, the CHECK refuses photo_view, the new columns are absent',async()=>{
   const v=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));
   for(const k of ['prerequisites recorded','new migration absent','view prefs check without photo view key','RLS enabled on three tables',
    'index tables have no policy and no client grant','service_role four privileges on index tables','two owner policies on profiles'])assert.equal(v[k],'예',k);
   assert.equal(v['anon or public table privilege'],'아니오');
   assert.deepEqual([v['new columns present'],v['new indexes present'],v['saved photo view keys'],v['profiles rows'],v['photo index rows'],v['folder index rows']],['0','0','0','3','1','2']);
   await assert.rejects(write(OWNER,OWNER,PV),{code:'23514'});
   assert.equal((await write(OWNER,OWNER,base)).rowCount,1);await write(OWNER,OWNER,null);
   await assert.rejects(svc(c=>c.query("update public.app_onedrive_photos set kind='video'")),{code:'42703'});
  });
  await t.test('plan accepts the migration (strict rules, full flow) and the rollback file',()=>{
   const p=plan('apply','9730');assert.equal(p.rules,'strict');assert.equal(p.flow,'full');
   assert.deepEqual(p.targets,['app_onedrive_folders','app_onedrive_photos','app_profiles']);
   assert.ok(plan('rollback','9731'));
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9732');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('apply passes postcheck; existing rows keep their values with the new defaults; grants and policies unchanged',async()=>{
   const apply=await run('apply','9733');assert.equal(apply.ok,true,apply.summary);
   assert.ok((await pool.query(postcheck)).rows.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'));
   assert.deepEqual(await rows("select item_id,parent_id,name,kind,screenshot,mime,sha1,lat,trashed_at from public.app_onedrive_photos"),
    [{item_id:'P!1',parent_id:'SUB!1',name:'img-1.jpg',kind:'photo',screenshot:false,mime:null,sha1:null,lat:null,trashed_at:null}]);
   assert.deepEqual((await rows('select item_id,role,enabled from public.app_onedrive_folders order by item_id')).map(r=>[r.item_id,r.role,r.enabled]),[['SUB!1',null,true],['TOP!1',null,true]]);
   assert.equal((await rows("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name]))[0].n,1);
   assert.equal((await rows("select count(*)::int n from pg_policy where polrelid='public.app_profiles'::regclass"))[0].n,2);
   assert.equal((await rows("select count(*)::int n from pg_policy where polrelid in ('public.app_onedrive_photos'::regclass,'public.app_onedrive_folders'::regclass)"))[0].n,0);
  });
  await t.test('service_role writes media, location, hash and trash columns; one trash folder per workspace',async()=>{
   const up=`insert into public.app_onedrive_photos(workspace_id,item_id,parent_id,name,taken_at,approx,taken_day,kind,mime,size_bytes,width,height,duration_ms,sha1,lat,lon,screenshot,updated_at)
    select b.workspace_id,b.item_id,b.parent_id,b.name,b.taken_at,b.approx,b.taken_day,b.kind,b.mime,b.size_bytes,b.width,b.height,b.duration_ms,b.sha1,b.lat,b.lon,b.screenshot,b.updated_at
    from json_populate_recordset(null::public.app_onedrive_photos,$1::json) b
    on conflict (workspace_id,item_id) do update set kind=excluded.kind,mime=excluded.mime,size_bytes=excluded.size_bytes,width=excluded.width,height=excluded.height,
     duration_ms=excluded.duration_ms,sha1=excluded.sha1,lat=excluded.lat,lon=excluded.lon,screenshot=excluded.screenshot,updated_at=excluded.updated_at`;
   const v={workspace_id:WS_A,item_id:'V!1',parent_id:'SUB!1',name:'clip-1.mp4',taken_at:'2026-10-02T03:00:00Z',approx:true,taken_day:'2026-10-02',kind:'video',mime:'video/mp4',
    size_bytes:1048576,width:1920,height:1080,duration_ms:42000,sha1:'0123456789abcdef0123456789abcdef01234567',lat:37.5,lon:127.0,screenshot:false,updated_at:'2026-10-28T00:00:00Z'};
   const s={...v,item_id:'S!1',name:'Screenshot_1.png',kind:'photo',mime:'image/png',duration_ms:null,sha1:null,lat:null,lon:null,screenshot:true};
   await svc(c=>c.query(up,[JSON.stringify([v,s])]));
   await svc(c=>c.query(`insert into public.app_onedrive_folders(workspace_id,item_id,parent_id,name,enabled,role) values ($1,'TR!1','TOP!1','.Web2 휴지통',false,'trash')`,[WS_A]));
   await svc(c=>c.query(`update public.app_onedrive_photos set parent_id='TR!1',trashed_at=now(),orig_parent_id='SUB!1' where workspace_id=$1 and item_id='V!1'`,[WS_A]));
   assert.deepEqual(await rows("select item_id,kind,screenshot,duration_ms::int d,orig_parent_id from public.app_onedrive_photos where kind='video' or screenshot order by item_id"),
    [{item_id:'S!1',kind:'photo',screenshot:true,d:null,orig_parent_id:null},{item_id:'V!1',kind:'video',screenshot:false,d:42000,orig_parent_id:'SUB!1'}]);
   await assert.rejects(svc(c=>c.query(`insert into public.app_onedrive_folders(workspace_id,item_id,parent_id,name,role) values ($1,'TR!2','TOP!1','two','trash')`,[WS_A])),{code:'23505'});
  });
  await t.test('the CHECKs refuse malformed media, hash, location and trash values',async()=>{
   for(const set of ["kind='gif'","mime='text/html'","size_bytes=-1","width=0","height=100001","duration_ms=-5","sha1='ABCDEF'","sha1='0123'",
    "lat=91","lon=181","lat=null","orig_parent_id='bad id'","trashed_at=null"])
    await assert.rejects(svc(c=>c.query(`update public.app_onedrive_photos set ${set} where item_id='V!1'`)),{code:'23514'},set);
   await assert.rejects(svc(c=>c.query("update public.app_onedrive_folders set role='album' where item_id='SUB!1'")),{code:'23514'});
  });
  await t.test('client roles still have nothing on the index tables; truncate stays refused',async()=>{
   for(const role of ['authenticated','anon'])for(const table of ['app_onedrive_folders','app_onedrive_photos']){
    await assert.rejects(as(role,OWNER,c=>c.query(`select * from public.${table}`)),{code:'42501'});
    await assert.rejects(as(role,OWNER,c=>c.query(`update public.${table} set updated_at=now()`)),{code:'42501'});
   }
   await assert.rejects(svc(c=>c.query('truncate public.app_onedrive_photos')),{code:'42501'});
  });
  await t.test('the owner saves photo_view alone and with the old keys; other rows, outsiders and anon cannot',async()=>{
   for(const value of [PV,{photo_view:{}},{photo_view:{filter:'star'}},{photo_view:{cols:3}},{photo_view:{cols:12,filter:'shot'}},{...base,...PV}]){
    assert.equal((await write(OWNER,OWNER,value)).rowCount,1,JSON.stringify(value));assert.deepEqual(await saved_(OWNER),value);}
   assert.equal((await write(OWNER,STRANGER,PV)).rowCount,0,'another profile row is not writable');
   assert.equal((await write(OUTSIDER,OUTSIDER,PV)).rowCount,0,'a non-owner member cannot write even the own row');
   await assert.rejects(as('anon','',c=>c.query('select view_prefs from public.app_profiles limit 1')),{code:'42501'});
  });
  await t.test('the CHECK refuses malformed photo_view values and still refuses what it refused before',async()=>{
   const bad=[{photo_view:'all'},{photo_view:[]},{photo_view:null},{photo_view:{filter:'x'}},{photo_view:{filter:1}},{photo_view:{cols:2}},{photo_view:{cols:13}},
    {photo_view:{cols:'5'}},{photo_view:{cols:5.5}},{photo_view:{other:1}},{photo_views:{}},
    {diary_onedrive:'true'},{diary_view:'month'},{photo_cols:5},{theme:'dark'},{extra:'x'},[],'x'];
   for(const value of bad)await assert.rejects(write(OWNER,OWNER,value),{code:'23514'},JSON.stringify(value));
  });
  await t.test('rollback refuses while photo_view or a Web2 trash photo is saved, and keeps them',async()=>{
   const result=await run('rollback','9734');assert.equal(result.ok,false,result.summary);
   const once=async re=>{const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),re);await c.query('rollback');}finally{c.release();}};
   await once(/PHOTO_MENU_INDEX_ROLLBACK_BLOCKED: photo view key saved/);
   await write(OWNER,OWNER,base);
   await once(/PHOTO_MENU_INDEX_ROLLBACK_BLOCKED: photos in Web2 trash/);
   assert.equal((await rows("select count(*)::int n from public.app_onedrive_photos where trashed_at is not null"))[0].n,1);
  });
  await t.test('rollback restores the previous schema once nothing depends on it; rows and other prefs survive; re-apply works',async()=>{
   await svc(c=>c.query(`update public.app_onedrive_photos set parent_id='SUB!1',trashed_at=null,orig_parent_id=null where item_id='V!1'`));
   await pool.query(rollbackSQL);
   assert.equal((await rows("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version]))[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal((await rows('select count(*)::int n from public.app_onedrive_photos'))[0].n,3);
   assert.equal((await rows('select count(*)::int n from public.app_onedrive_folders'))[0].n,3);
   await assert.rejects(write(OWNER,OWNER,PV),{code:'23514'});
   assert.deepEqual(await saved_(OWNER),base,'other saved values survive the rollback');
   const again=await run('apply','9735');assert.equal(again.ok,true,again.summary);
  });
  await t.test('pair files read pg_catalog only and the migration grants nothing',async()=>{
   for(const kind of ['precheck','snapshot','postcheck','rollback'])assert.doesNotMatch(await read(`docs/${stem}.${kind}.sql`),/information_schema/i,kind);
   assert.doesNotMatch(await read(`supabase/migrations/${stem}.sql`),/\b(grant|revoke)\b|create policy|disable row level security/i);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
