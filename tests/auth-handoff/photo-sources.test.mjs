// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// PHOTO-출처 ① DB: app_profiles_view_prefs_check accepts photo_sources ({onedrive, gdrive, phone} booleans) and the star/album source checks accept phone,
// through the approved DB workflow runner.
// - 다른 칸 규칙 그대로(앞선 스무 칸을 그대로 받고, 전에 거절하던 값은 계속 거절). 원드라이브·직접 올림 별표·앨범도 그대로.
// - 권한 그대로: 프로필·별표·앨범은 내 것만, anon은 못 읽는다. 표 권한·정책 수 그대로.
// - plan·dry-run·apply가 통과하고, rollback은 저장된 출처나 폰 사진 별표·앨범 행이 있으면 멈춘 뒤 비우면 원래 모양으로 돌아간다.
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
const version='20261030230000',name='photo_sources',stem=version+'_'+name;
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

const EARLIER=['20261023180000_profile_view_prefs','20261027020000_profile_view_prefs_report_view','20261027040000_profile_view_prefs_theme10',
 '20261027070000_profile_view_prefs_theme_refresh','20261028020000_profile_view_prefs_menu_home','20261028090000_profile_view_prefs_photo_cols',
 '20261028100000_profile_view_prefs_diary_view','20261028150000_profile_view_prefs_diary_onedrive','20261026140000_diary_onedrive_db','20261028010000_onedrive_photo_index',
 '20261028220000_photo_menu_index','20261029010000_profile_view_prefs_split_screens','20261029103000_profile_view_prefs_quiet_weeks','20261029183000_profile_view_prefs_note_view',
 '20261030091000_profile_view_prefs_note_boards','20261030150000_photo_sort','20261029150000_photo_tags','20261030190000_profile_view_prefs_photo_hint'];

test('photo sources: plan, dry-run, apply, own-row writes, CHECKs and guarded rollback',{timeout:150000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'photo-sources-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(prerequisites);
  for(const f of EARLIER)await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const rollbackSQL=await read('docs/'+stem+'.rollback.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  for(const f of [precheck,postcheck,snapshot])assert.doesNotMatch(f,/information_schema/i);
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  const saveSnapshot=async()=>{};
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const write=(sub,user,value)=>as('authenticated',sub,c=>c.query('update public.app_profiles set view_prefs=$1::jsonb where user_id=$2',[value===null?null:JSON.stringify(value),user]));
  const saved_=async user=>(await pool.query('select view_prefs from public.app_profiles where user_id=$1',[user])).rows[0].view_prefs;
  const star=(sub,ws,source,key)=>as('authenticated',sub,c=>c.query('insert into public.app_diary_stars(workspace_id,source,item_key,taken_day) values ($1,$2,$3,$4)',[ws,source,key,'2026-10-05']));
  const tagId=(await pool.query("insert into public.app_photo_tags(workspace_id,name) values ($1,'여행') returning id",[WS_A])).rows[0].id;
  const tagItem=(sub,ws,source,key)=>as('authenticated',sub,c=>c.query('insert into public.app_photo_tag_items(tag_id,workspace_id,source,item_key,taken_day) values ($1,$2,$3,$4,$5)',[tagId,ws,source,key,'2026-10-05']));
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;
  const base={theme:'lemon',split_ratio:{tasks:0.4,telegram:0.3,reports3:0.25},home_cards:['quiet','todo'],diary_view:'list',photo_view:{filter:'star',cols:4,sort:'name_asc'},quiet_weeks:3,note_view:'board',note_boards:[{id:'b1a2b3c4',name:'보드'}],note_board:'b1a2b3c4',photo_hint:2};
  const NEW={photo_sources:{onedrive:true,phone:true}};

  await t.test('before apply the CHECKs refuse photo_sources and phone, and accept the old values',async()=>{
   const v=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));
   assert.deepEqual([v['prerequisite recorded'],v['new migration absent'],v['view prefs check without photo sources'],v['source checks without phone'],v['saved photo sources'],v['phone rows'],v['RLS enabled'],v['no anon or public table privilege'],v['policy counts'],v['profiles rows']],
    ['예','예','예','예','0','0','예','예','예','3']);
   for(const n of [NEW,{...base,photo_sources:{gdrive:false}}])await assert.rejects(write(OWNER,OWNER,n),{code:'23514'},JSON.stringify(n));
   await assert.rejects(star(OWNER,WS_A,'phone','ms:1'),{code:'23514'});
   await assert.rejects(tagItem(OWNER,WS_A,'phone','ms:1'),{code:'23514'});
   assert.equal((await write(OWNER,OWNER,base)).rowCount,1,'the old keys are accepted before');
   await write(OWNER,OWNER,null);
  });
  await t.test('plan accepts the migration and its companion files',()=>{
   const p=plan('apply','9850');assert.ok(p&&!p.rejected,JSON.stringify(p).slice(0,300));
   assert.ok(plan('rollback','9851'));
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9852');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('apply passes postcheck; grants, policies and rows unchanged',async()=>{
   const apply=await run('apply','9853');assert.equal(apply.ok,true,apply.summary);
   assert.ok((await pool.query(postcheck)).rows.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'));
   assert.deepEqual((await pool.query('select view_prefs from public.app_profiles')).rows.map(r=>r.view_prefs),[null,null,null]);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
   assert.equal((await pool.query("select relacl::text acl from pg_class where oid='public.app_profiles'::regclass")).rows[0].acl.match(/authenticated=[a-z]*/)[0],'authenticated=rw');
   for(const [tbl,n] of [['app_profiles',2],['app_diary_stars',1],['app_photo_tag_items',1]])
    assert.equal((await pool.query(`select count(*)::int n from pg_policy where polrelid='public.${tbl}'::regclass`)).rows[0].n,n,tbl);
  });
  await t.test('the owner saves photo_sources with the old keys; other rows, outsiders and anon cannot',async()=>{
   for(const ps of [{},{onedrive:true},{onedrive:false,gdrive:false,phone:true},{phone:false}])for(const value of [{photo_sources:ps},{...base,photo_sources:ps}]){
    assert.equal((await write(OWNER,OWNER,value)).rowCount,1,JSON.stringify(value));assert.deepEqual(await saved_(OWNER),value);}
   assert.equal((await write(OWNER,STRANGER,NEW)).rowCount,0,'another profile row is not writable');
   assert.equal((await write(OUTSIDER,OUTSIDER,NEW)).rowCount,0,'a non-owner member cannot write even the own row');
   assert.equal(await saved_(OUTSIDER),null);
   await assert.rejects(as('anon','',c=>c.query('select view_prefs from public.app_profiles limit 1')),{code:'42501'});
  });
  await t.test('phone stars and album items: owner only; onedrive/upload still work; other sources refused',async()=>{
   assert.equal((await star(OWNER,WS_A,'phone','ms:1001')).rowCount,1);
   assert.equal((await star(OWNER,WS_A,'onedrive','A1')).rowCount,1);
   assert.equal((await star(OWNER,WS_A,'upload','u1')).rowCount,1);
   assert.equal((await tagItem(OWNER,WS_A,'phone','ms:1001')).rowCount,1);
   assert.equal((await tagItem(OWNER,WS_A,'onedrive','A1')).rowCount,1);
   for(const s of ['gdrive','Phone','','web'])await assert.rejects(star(OWNER,WS_A,s,'ms:2'),{code:'23514'},s);
   await assert.rejects(tagItem(OWNER,WS_A,'gdrive','g1'),{code:'23514'});
   await assert.rejects(star(OWNER,WS_A,'phone',''),{code:'23514'},'key length check stays');
   await assert.rejects(star(STRANGER,WS_A,'phone','ms:9'),{code:'42501'});
   await assert.rejects(tagItem(STRANGER,WS_A,'phone','ms:9'),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_diary_stars')),{code:'42501'});
  });
  await t.test('the CHECK refuses malformed photo_sources and still refuses what it refused before',async()=>{
   const bad=[{photo_sources:true},{photo_sources:[]},{photo_sources:'phone'},{photo_sources:{phone:'true'}},{photo_sources:{phone:1}},{photo_sources:{phone:null}},
    {photo_sources:{dropbox:true}},{photo_sources:{phone:{on:true}}},{photo_source:{phone:true}},{photo_hint:10},
    {photo_view:{sort:'newest'}},{note_board:'b12'},{note_view:'grid'},{quiet_weeks:13},{split_ratio:{chat:0.3}},
    {theme:'dark'},{extra:'x'},[],'x',{photo_view:{cols:2}},{diary_onedrive:'true'}];
   for(const value of bad)await assert.rejects(write(OWNER,OWNER,value),{code:'23514'},JSON.stringify(value));
  });
  await t.test('rollback refuses while photo_sources or phone rows are saved, and keeps them',async()=>{
   await write(OWNER,OWNER,{...base,photo_sources:{phone:true}});
   const result=await run('rollback','9854');assert.equal(result.ok,false,result.summary);
   const tryRollback=async re=>{const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),re);await c.query('rollback');}finally{c.release();}};
   await tryRollback(/PHOTO_SOURCES_ROLLBACK_BLOCKED: photo sources saved/);
   assert.deepEqual(await saved_(OWNER),{...base,photo_sources:{phone:true}});
   await write(OWNER,OWNER,base);
   await tryRollback(/PHOTO_SOURCES_ROLLBACK_BLOCKED: phone photo stars or album items saved/);
   assert.equal((await pool.query("select count(*)::int n from public.app_diary_stars where source='phone'")).rows[0].n,1);
  });
  await t.test('rollback restores the previous schema once nothing remains; re-apply works',async()=>{
   await pool.query("delete from public.app_diary_stars where source='phone'");await pool.query("delete from public.app_photo_tag_items where source='phone'");
   await pool.query("delete from public.app_diary_stars");await pool.query("delete from public.app_photo_tag_items");
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await assert.rejects(write(OWNER,OWNER,NEW),{code:'23514'});
   await assert.rejects(star(OWNER,WS_A,'phone','ms:1'),{code:'23514'});
   assert.deepEqual(await saved_(OWNER),base,'other saved values survive the rollback');
   const again=await run('apply','9855');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
