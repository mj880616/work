// Fresh local PostgreSQL only. No Supabase, Google or production credentials.
// LIB-폴더로옮기기: app_profiles_library_view_check also accepts recent_folders (uuid string array, max 5) through the approved DB workflow runner.
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
const version='20261027173000',name='library_view_recent_folders',stem=version+'_'+name;
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
  insert into supabase_migrations.schema_migrations(version,name) values('20261018112943','doc_categories_profile'),('20261022163000','profile_quick_links');
`;

test('library view recent folders: dry-run, apply, own-row writes, CHECK and guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'library-view-recent-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(prerequisites);
  // The earlier migrations (library_view column + CHECK, then the folder group value) are applied from the repository files as they were.
  await pool.query(await read('supabase/migrations/20261023150000_profile_library_view.sql'));
  await pool.query(await read('supabase/migrations/20261026180000_library_view_group_folder.sql'));
  const rollbackSQL=await read('docs/'+stem+'.rollback.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  const saved=new Map(),saveSnapshot=async(file,body)=>{saved.set(file,body);};
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const write=(sub,user,value)=>as('authenticated',sub,c=>c.query('update public.app_profiles set library_view=$1::jsonb where user_id=$2',[value===null?null:JSON.stringify(value),user]));
  const saved_=async user=>(await pool.query('select library_view from public.app_profiles where user_id=$1',[user])).rows[0].library_view;
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;

  await t.test('before apply the previous CHECK refuses recent_folders',async()=>{
   const v=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));
   assert.deepEqual([v['prerequisite recorded'],v['new migration absent'],v['library view check without recent folders'],v['saved recent folders'],v['RLS enabled'],v['anon or public table privilege'],v['two owner policies'],v['profiles rows']],
    ['예','예','예','0','예','아니오','예','3']);
   await assert.rejects(write(OWNER,OWNER,{recent_folders:['11111111-1111-4111-8111-111111111111']}),{code:'23514'});
  });
  await t.test('plan accepts the migration and its companion files',()=>{
   const p=plan('apply','9700');assert.ok(p&&!p.rejected,JSON.stringify(p).slice(0,300));
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9701');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('apply passes postcheck; grants, policies and rows unchanged',async()=>{
   const apply=await run('apply','9702');assert.equal(apply.ok,true,apply.summary);
   assert.ok((await pool.query(postcheck)).rows.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'));
   assert.deepEqual((await pool.query('select library_view from public.app_profiles')).rows.map(r=>r.library_view),[null,null,null]);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
   assert.equal((await pool.query("select relacl::text acl from pg_class where oid='public.app_profiles'::regclass")).rows[0].acl.match(/authenticated=[a-z]*/)[0],'authenticated=rw');
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid='public.app_profiles'::regclass")).rows[0].n,2);
   assert.equal((await pool.query("select count(*)::int n from pg_constraint where conrelid='public.app_profiles'::regclass and conname='app_profiles_library_view_check' and convalidated")).rows[0].n,1);
  });
  const recent={group_by:'folder',categories_off:['회의'],recent_folders:['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']};
  await t.test('the owner saves recent_folders; other rows, outsiders and anon cannot',async()=>{
   assert.equal((await write(OWNER,OWNER,recent)).rowCount,1);assert.deepEqual(await saved_(OWNER),recent);
   assert.equal((await write(OWNER,STRANGER,recent)).rowCount,0,'another profile row is not writable');
   assert.equal((await write(OUTSIDER,OUTSIDER,recent)).rowCount,0,'a non-owner member cannot write even the own row');
   assert.equal(await saved_(OUTSIDER),null);
   await assert.rejects(as('anon','',c=>c.query('select library_view from public.app_profiles limit 1')),{code:'42501'});
  });
  await t.test('the CHECK still refuses everything else it refused before, and bad recent_folders',async()=>{
   const bad=[[],'x',1,{extra:'x'},{group_by:'Folder'},{group_by:null},{categories_off:'회의'},{categories_off:[1]},{categories_off:['']},{categories_off:Array.from({length:61},(_,i)=>'n'+i)},
    {recent_folders:'11111111-1111-4111-8111-111111111111'},{recent_folders:[1]},{recent_folders:[null]},{recent_folders:['x']},{recent_folders:['AAAAAAAA-1111-4111-8111-111111111111']},{recent_folders:[' 11111111-1111-4111-8111-111111111111']},{recent_folders:['11111111-1111-4111-8111-111111111111x']},
    {recent_folders:Array.from({length:6},(_,i)=>`00000000-0000-4000-8000-00000000000${i}`)},{recent_folders:{}},{recent_folders:[['11111111-1111-4111-8111-111111111111']]},{recent_folders:['11111111-1111-4111-8111-111111111111'],extra:1}];
   for(const value of bad)await assert.rejects(write(OWNER,OWNER,value),{code:'23514'},JSON.stringify(value).slice(0,80));
   for(const value of [{group_by:'project'},{group_by:'folder'},{},{categories_off:[]},{recent_folders:[]},{recent_folders:['11111111-1111-4111-8111-111111111111']},{recent_folders:Array.from({length:5},(_,i)=>`00000000-0000-4000-8000-00000000000${i}`),group_by:'month'}])
    assert.equal((await write(OWNER,OWNER,value)).rowCount,1,JSON.stringify(value).slice(0,80));
   await write(OWNER,OWNER,recent);
  });
  await t.test('rollback refuses while recent_folders is saved, and keeps it',async()=>{
   const result=await run('rollback','9703');assert.equal(result.ok,false,result.summary);
   const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/PROFILE_LIBRARY_VIEW_RECENT_ROLLBACK_BLOCKED: recent folders saved/);await c.query('rollback');}finally{c.release();}
   assert.deepEqual(await saved_(OWNER),recent);
  });
  await t.test('rollback restores the previous schema once no recent folders remain; re-apply works',async()=>{
   await write(OWNER,OWNER,{group_by:'month'});
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await assert.rejects(write(OWNER,OWNER,{recent_folders:['11111111-1111-4111-8111-111111111111']}),{code:'23514'});
   assert.deepEqual(await saved_(OWNER),{group_by:'month'},'other saved values survive the rollback');
   await write(OWNER,OWNER,{group_by:'folder'});
   const again=await run('apply','9705');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
