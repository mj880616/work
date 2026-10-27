// Fresh local PostgreSQL only. No Supabase, Google or production credentials.
// UI-화면색10: app_profiles_view_prefs_check accepts ten themes through the approved DB workflow runner.
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
const version='20261027040000',name='profile_view_prefs_theme10',stem=version+'_'+name;
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

test('view prefs theme10: dry-run, apply, own-row writes, CHECK and guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'view-prefs-theme10-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(prerequisites);
  // The earlier migration (view_prefs column + seven-key CHECK) is applied from the repository file as it was.
  await pool.query(await read('supabase/migrations/20261023180000_profile_view_prefs.sql'));
  await pool.query(await read('supabase/migrations/20261027020000_profile_view_prefs_report_view.sql'));
  const rollbackSQL=await read('docs/'+stem+'.rollback.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  const saved=new Map(),saveSnapshot=async(file,body)=>{saved.set(file,body);};
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const write=(sub,user,value)=>as('authenticated',sub,c=>c.query('update public.app_profiles set view_prefs=$1::jsonb where user_id=$2',[value===null?null:JSON.stringify(value),user]));
  const saved_=async user=>(await pool.query('select view_prefs from public.app_profiles where user_id=$1',[user])).rows[0].view_prefs;
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;
  const base={theme:'navy',nav_collapsed:true,calendar_view:'week',home_quick_mode:'task',note_folder:'f:회의 자료',split_ratio:{tasks:0.4,reports:0.25},collect_hidden_on:'2026-10-27',report_view:'photo'};
  const NEW=['mugwort','lavender','ink','rose','teal','mustard'],OLD=['olive','navy','terracotta','sand'];

  await t.test('before apply the original CHECK refuses the six new themes and accepts the four old ones',async()=>{
   const v=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));
   assert.deepEqual([v['prerequisite recorded'],v['new migration absent'],v['view prefs check without new themes'],v['saved new themes'],v['RLS enabled'],v['anon or public table privilege'],v['two owner policies'],v['profiles rows']],
    ['예','예','예','0','예','아니오','예','3']);
   for(const theme of NEW)await assert.rejects(write(OWNER,OWNER,{theme}),{code:'23514'},theme);
   for(const theme of OLD)assert.equal((await write(OWNER,OWNER,{theme})).rowCount,1,theme);
   assert.equal((await write(OWNER,OWNER,base)).rowCount,1,'the eight old keys are accepted before');
   await write(OWNER,OWNER,null);
  });
  await t.test('plan accepts the migration and its companion files',()=>{
   const p=plan('apply','9600');assert.ok(p&&!p.rejected,JSON.stringify(p).slice(0,300));
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9601');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('apply passes postcheck; grants, policies and rows unchanged',async()=>{
   const apply=await run('apply','9602');assert.equal(apply.ok,true,apply.summary);
   assert.ok((await pool.query(postcheck)).rows.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'));
   assert.deepEqual((await pool.query('select view_prefs from public.app_profiles')).rows.map(r=>r.view_prefs),[null,null,null]);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
   assert.equal((await pool.query("select relacl::text acl from pg_class where oid='public.app_profiles'::regclass")).rows[0].acl.match(/authenticated=[a-z]*/)[0],'authenticated=rw');
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid='public.app_profiles'::regclass")).rows[0].n,2);
   assert.equal((await pool.query("select count(*)::int n from pg_constraint where conrelid='public.app_profiles'::regclass and conname='app_profiles_view_prefs_check' and convalidated")).rows[0].n,1);
  });
  await t.test('the owner saves each of the ten themes; other rows, outsiders and anon cannot',async()=>{
   for(const theme of [...OLD,...NEW]){assert.equal((await write(OWNER,OWNER,{theme})).rowCount,1,theme);assert.deepEqual(await saved_(OWNER),{theme});}
   const both={...base,theme:'mustard'};
   assert.equal((await write(OWNER,OWNER,both)).rowCount,1);assert.deepEqual(await saved_(OWNER),both);
   assert.equal((await write(OWNER,STRANGER,both)).rowCount,0,'another profile row is not writable');
   assert.equal((await write(OUTSIDER,OUTSIDER,both)).rowCount,0,'a non-owner member cannot write even the own row');
   assert.equal(await saved_(OUTSIDER),null);
   await assert.rejects(as('anon','',c=>c.query('select view_prefs from public.app_profiles limit 1')),{code:'42501'});
  });
  await t.test('the CHECK refuses other theme values and still refuses everything it refused before',async()=>{
   const bad=[{theme:'dark'},{theme:'Mustard'},{theme:' rose'},{theme:'rose '},{theme:'mugwort2'},{theme:''},{theme:null},{theme:5},{theme:true},{theme:['rose']},{theme:{a:1}},
    {theme:'rose',extra:1},{extra:'x'},[],'x',1,{report_view:'week'},{calendar_view:'day'},{split_ratio:{tasks:1}},{note_folder:'folder'},{collect_hidden_on:'2026-1-1'},{nav_collapsed:'1'}];
   for(const value of bad)await assert.rejects(write(OWNER,OWNER,value),{code:'23514'},JSON.stringify(value).slice(0,80));
   for(const value of [{theme:'olive',report_view:'list'},{theme:'teal',calendar_view:'month'},{},{report_view:'calendar'}])
    assert.equal((await write(OWNER,OWNER,value)).rowCount,1,JSON.stringify(value).slice(0,80));
   await write(OWNER,OWNER,{theme:'rose'});
  });
  await t.test('rollback refuses while a new theme is saved, and keeps it',async()=>{
   const result=await run('rollback','9603');assert.equal(result.ok,false,result.summary);
   const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/PROFILE_VIEW_PREFS_THEME10_ROLLBACK_BLOCKED: new theme saved/);await c.query('rollback');}finally{c.release();}
   assert.deepEqual(await saved_(OWNER),{theme:'rose'});
  });
  await t.test('rollback restores the original schema once no new theme remains; re-apply works',async()=>{
   await write(OWNER,OWNER,base);
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await assert.rejects(write(OWNER,OWNER,{theme:'rose'}),{code:'23514'});
   assert.deepEqual(await saved_(OWNER),base,'other saved values survive the rollback');
   const again=await run('apply','9605');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
