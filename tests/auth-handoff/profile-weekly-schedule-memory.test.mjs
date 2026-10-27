// Fresh local PostgreSQL only. No Supabase, Google or production credentials.
// WEEKLY-환류 DB: app_profiles.weekly_schedule_memory jsonb + CHECK through the approved DB workflow runner.
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
const version='20261024002000',name='profile_weekly_schedule_memory',stem=version+'_'+name;
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
  insert into supabase_migrations.schema_migrations(version,name) values('20261018112943','doc_categories_profile'),('20261022163000','profile_quick_links'),('20261023150000','profile_library_view'),('20261023180000','profile_view_prefs');
`;

test('profile weekly schedule memory: dry-run, apply, own-row writes, CHECK and guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'profile-view-prefs-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(prerequisites);
  const rollbackSQL=await read('docs/'+stem+'.rollback.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  const saved=new Map(),saveSnapshot=async(file,body)=>{saved.set(file,body);};
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const write=(sub,user,value)=>as('authenticated',sub,c=>c.query('update public.app_profiles set weekly_schedule_memory=$1::jsonb where user_id=$2',[JSON.stringify(value),user]));
  const saved_=async user=>(await pool.query('select weekly_schedule_memory m from public.app_profiles where user_id=$1',[user])).rows[0].m;
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;

  await t.test('precheck values before apply',()=>{
   const v=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));
   assert.deepEqual([v['prerequisite recorded'],v['new migration absent'],v['new column count'],v['new check count'],v['RLS enabled'],v['anon or public table privilege'],
    v['authenticated can update profiles'],v['owner policies only (current shape)'],v['owner check function (task12a body)'],v['owner profile row exists'],v['profiles rows']],
    ['예','예','0','0','예','아니오','예','예','예','예','3']);
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9801');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('prerequisite changes stop the migration without any change',async()=>{
   const attempts=[
    ['grant select on public.app_profiles to anon','revoke select on public.app_profiles from anon'],
    ['alter table public.app_profiles disable row level security','alter table public.app_profiles enable row level security'],
    ['revoke update on public.app_profiles from authenticated','grant update on public.app_profiles to authenticated'],
    ["create policy synthetic_extra on public.app_profiles for select to authenticated using (true)",'drop policy synthetic_extra on public.app_profiles'],
    ['alter table public.app_profiles add column weekly_schedule_memory jsonb','alter table public.app_profiles drop column weekly_schedule_memory'],
    ["delete from supabase_migrations.schema_migrations where version='20261023180000'","insert into supabase_migrations.schema_migrations(version,name) values('20261023180000','profile_view_prefs')"],
   ];
   const migration=await read('supabase/migrations/'+stem+'.sql');
   for(const [breakIt,fixIt] of attempts){
    await pool.query(breakIt);
    try{const c=await pool.connect();try{await assert.rejects(c.query(migration),/PROFILE_WEEKLY_SCHEDULE_MEMORY_PREREQUISITE_CHANGED/,breakIt);await c.query('rollback');}finally{c.release();}}
    finally{await pool.query(fixIt);}
   }
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; every profile starts as an empty list; grants and policies unchanged',async()=>{
   const apply=await run('apply','9802');assert.equal(apply.ok,true,apply.summary);
   assert.ok((await pool.query(postcheck)).rows.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'));
   for(const r of (await pool.query(postcheck)).rows.filter(r=>!/^(예|아니오)$/.test(r.value)&&r.item!=='recent migrations'))assert.equal(r.value,Object.fromEntries(beforeCheck.map(x=>[x.item,x.value]))[r.item],r.item);
   assert.deepEqual((await pool.query('select weekly_schedule_memory m from public.app_profiles')).rows.map(r=>r.m),[[],[],[]]);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
   assert.equal((await pool.query("select relacl::text acl from pg_class where oid='public.app_profiles'::regclass")).rows[0].acl.match(/authenticated=[a-z]*/)[0],'authenticated=rw');
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid='public.app_profiles'::regclass")).rows[0].n,2);
   assert.equal((await pool.query("select is_nullable n from information_schema.columns where table_name='app_profiles' and column_name='weekly_schedule_memory'")).rows[0].n,'NO');
  });
  const names={key:'가상결의대회',origin:'가상 결의대회',title:'OO 결의대회',place:'가상 광장',saved:'2026-10-26',used:'2026-11-02'};
  const dropped={key:'주간회의',origin:'주간 회의',drop:true,saved:'2026-10-26'};
  const good=[names,dropped,{key:'a',origin:'A',title:'B',saved:'2026-10-26'}];
  await t.test('the owner saves own memory; other rows, outsiders and anon cannot',async()=>{
   assert.equal((await write(OWNER,OWNER,good)).rowCount,1);assert.deepEqual(await saved_(OWNER),good);
   assert.equal((await write(OWNER,STRANGER,good)).rowCount,0,'another profile row is not writable');
   assert.equal((await write(OUTSIDER,OUTSIDER,good)).rowCount,0,'a non-owner member cannot write even the own row');
   assert.deepEqual(await saved_(OUTSIDER),[]);
   await assert.rejects(as('anon','',c=>c.query('select weekly_schedule_memory from public.app_profiles limit 1')),{code:'42501'});
   assert.equal((await write(OWNER,OWNER,[])).rowCount,1,'an empty list is allowed');
   assert.equal((await as('authenticated',OWNER,c=>c.query("update public.app_profiles set display_name='소유자',updated_at=now() where user_id=$1",[OWNER]))).rowCount,1,'other profile fields still save');
   assert.equal((await as('authenticated',OWNER,c=>c.query('update public.app_profiles set weekly_schedule_memory=null where user_id=$1',[OWNER])).catch(e=>e.code)),'23502','null is refused (not null)');
  });
  await t.test('the CHECK refuses bad shapes, unknown keys and bad values (a rejection, never an error)',async()=>{
   const E=(over,drop=[])=>{const o={...names,...over};for(const k of drop)delete o[k];return o;};
   const bad=[
    {},'x',1,true,null,
    [1],['x'],[null],[[]],[{}],[{key:'a'}],[{key:'a',origin:'A'}],[{key:'a',title:'B',saved:'2026-10-26'}],[{origin:'A',title:'B',saved:'2026-10-26'}],
    [E({},['saved'])],[E({},['key'])],[E({},['origin'])],
    [E({extra:'x'})],[E({kind:'x'})],[E({Key:'x'})],
    [E({key:5})],[E({origin:null})],[E({title:['x']})],[E({place:1})],[E({saved:20261026})],[E({used:true})],[E({title:{}})],
    [E({key:''})],[E({key:'  '})],[E({origin:' '})],[E({title:''})],[E({title:' \t'})],[E({place:''})],
    [E({key:'가'.repeat(201)})],[E({origin:'가'.repeat(201)})],[E({title:'가'.repeat(201)})],[E({place:'가'.repeat(101)})],
    [E({title:'두\n줄'})],[E({origin:'a\tb'})],[E({key:'a\u0007b'})],[E({place:'a\u007fb'})],[E({saved:'2026-10-26\n'})],
    [E({saved:'2026-1-1'})],[E({saved:'26-10-26'})],[E({saved:'2026-13-01'})],[E({saved:'2026-10-32'})],[E({saved:'오늘'})],[E({used:'2026/11/02'})],[E({used:'2026-00-10'})],[E({used:''})],
    [{...dropped,drop:false}],[{...dropped,drop:'true'}],[{...dropped,drop:1}],[{...dropped,drop:null}],
    [{...dropped,title:'OO'}],[E({drop:true})],[{...dropped,place:'가상 광장'}],[E({},['title'])],[E({},['title','place'])],[{key:'a',origin:'A',place:'p',saved:'2026-10-26'}],
    Array.from({length:201},(_, i)=>({key:'k'+i,origin:'o',drop:true,saved:'2026-10-26'})),
    [E({title:'가'.repeat(200),origin:'가'.repeat(200),key:'가'.repeat(200),place:'가'.repeat(100)}),...Array.from({length:199},(_, i)=>({key:'가'.repeat(190)+i,origin:'가'.repeat(200),title:'가'.repeat(200),place:'가'.repeat(100),saved:'2026-10-26',used:'2026-10-26'}))],
   ];
   for(const value of bad)await assert.rejects(write(OWNER,OWNER,value),{code:'23514'},JSON.stringify(value).slice(0,100));
   const ok=[[names],[dropped],[E({},['used','place'])],[E({place:'가'.repeat(100),title:'가'.repeat(200),origin:'가'.repeat(200),key:'가'.repeat(200)})],[E({key:'😀'.repeat(200)})],
    [E({saved:'2026-02-31'})],[E({saved:'2099-12-31'})],Array.from({length:200},(_, i)=>({key:'k'+i,origin:'o',drop:true,saved:'2026-10-26'}))];
   for(const value of ok)assert.equal((await write(OWNER,OWNER,value)).rowCount,1,JSON.stringify(value).slice(0,100));
   // 64 KiB limit counts bytes of the stored text: 200 items that are each under the field limits but together over 65,536 bytes are refused.
   const one={key:'가'.repeat(200),origin:'가'.repeat(200),title:'가'.repeat(200),place:'가'.repeat(100),saved:'2026-10-26',used:'2026-10-26'};
   const size=(await pool.query("select octet_length(($1::jsonb)::text) n",[JSON.stringify([one])])).rows[0].n;
   assert.ok(size*200>65536,'200 full items exceed 64 KiB: '+size);
   await assert.rejects(write(OWNER,OWNER,Array.from({length:200},(_, i)=>({...one,key:'가'.repeat(190)+String(i).padStart(3,'0')}))),{code:'23514'},'over 64 KiB');
   const fit=Math.floor((65536-2)/(size+1));
   assert.equal((await write(OWNER,OWNER,Array.from({length:fit},(_, i)=>({...one,key:'가'.repeat(190)+String(i).padStart(3,'0')})))).rowCount,1,'just under 64 KiB');
   await write(OWNER,OWNER,good);
  });
  await t.test('rollback refuses while any memory is saved, and keeps it',async()=>{
   const result=await run('rollback','9803');assert.equal(result.ok,false,result.summary);
   const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/PROFILE_WEEKLY_SCHEDULE_MEMORY_ROLLBACK_BLOCKED: memory saved/);await c.query('rollback');}finally{c.release();}
   assert.deepEqual(await saved_(OWNER),good);
  });
  await t.test('rollback restores the original schema once every memory is empty; re-apply works',async()=>{
   await pool.query("update public.app_profiles set weekly_schedule_memory='[]'::jsonb");
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
   const again=await run('apply','9805');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
