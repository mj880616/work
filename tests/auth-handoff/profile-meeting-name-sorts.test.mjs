// Fresh local PostgreSQL only. No Supabase, Google or production credentials.
// S53-20 MTG-비정기회의접기: app_profiles.meeting_name_sorts jsonb + CHECK through the approved DB workflow runner.
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
const version='20261108090000',name='profile_meeting_name_sorts',stem=version+'_'+name;
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
  insert into supabase_migrations.schema_migrations(version,name) values('20261018112943','doc_categories_profile'),('20261022163000','profile_quick_links'),('20261023150000','profile_library_view'),('20261023180000','profile_view_prefs'),('20261024002000','profile_weekly_schedule_memory');
`;

test('profile meeting name sorts: dry-run, apply, own-row writes, CHECK and guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'profile-meeting-name-sorts-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  const write=(sub,user,value)=>as('authenticated',sub,c=>c.query('update public.app_profiles set meeting_name_sorts=$1::jsonb where user_id=$2',[JSON.stringify(value),user]));
  const saved_=async user=>(await pool.query('select meeting_name_sorts m from public.app_profiles where user_id=$1',[user])).rows[0].m;
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
    ['alter table public.app_profiles add column meeting_name_sorts jsonb','alter table public.app_profiles drop column meeting_name_sorts'],
    ["delete from supabase_migrations.schema_migrations where version='20261024002000'","insert into supabase_migrations.schema_migrations(version,name) values('20261024002000','profile_weekly_schedule_memory')"],
   ];
   const migration=await read('supabase/migrations/'+stem+'.sql');
   for(const [breakIt,fixIt] of attempts){
    await pool.query(breakIt);
    try{const c=await pool.connect();try{await assert.rejects(c.query(migration),/PROFILE_MEETING_NAME_SORTS_PREREQUISITE_CHANGED/,breakIt);await c.query('rollback');}finally{c.release();}}
    finally{await pool.query(fixIt);}
   }
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; every profile starts empty; grants and policies unchanged',async()=>{
   const apply=await run('apply','9802');assert.equal(apply.ok,true,apply.summary);
   assert.ok((await pool.query(postcheck)).rows.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'));
   for(const r of (await pool.query(postcheck)).rows.filter(r=>!/^(예|아니오)$/.test(r.value)&&r.item!=='recent migrations'))assert.equal(r.value,Object.fromEntries(beforeCheck.map(x=>[x.item,x.value]))[r.item],r.item);
   assert.deepEqual((await pool.query('select meeting_name_sorts m from public.app_profiles')).rows.map(r=>r.m),[{},{},{}]);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
   assert.equal((await pool.query("select relacl::text acl from pg_class where oid='public.app_profiles'::regclass")).rows[0].acl.match(/authenticated=[a-z]*/)[0],'authenticated=rw');
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid='public.app_profiles'::regclass")).rows[0].n,2);
   assert.equal((await pool.query("select is_nullable n from information_schema.columns where table_name='app_profiles' and column_name='meeting_name_sorts'")).rows[0].n,'NO');
  });
  // 지어낸 이름만(실제 회의·단체 이름 없음).
  const good={parents:[{id:'gabc123',name:'가상협의회'},{id:'g0000000001',name:'샘플 모임'}],names:{'가상협의회투쟁점검회의':'gabc123','샘플회의(2차)':'etc','지난회의':'del'}};
  await t.test('the owner saves own sorts; other rows, outsiders and anon cannot',async()=>{
   assert.equal((await write(OWNER,OWNER,good)).rowCount,1);assert.deepEqual(await saved_(OWNER),good);
   assert.equal((await write(OWNER,STRANGER,good)).rowCount,0,'another profile row is not writable');
   assert.equal((await write(OUTSIDER,OUTSIDER,good)).rowCount,0,'a non-owner member cannot write even the own row');
   assert.deepEqual(await saved_(OUTSIDER),{});
   await assert.rejects(as('anon','',c=>c.query('select meeting_name_sorts from public.app_profiles limit 1')),{code:'42501'});
   assert.equal((await write(OWNER,OWNER,{})).rowCount,1,'an empty value is allowed');
   assert.equal((await write(OWNER,OWNER,{parents:[],names:{}})).rowCount,1,'empty lists are allowed');
   assert.equal((await as('authenticated',OWNER,c=>c.query("update public.app_profiles set display_name='소유자',updated_at=now() where user_id=$1",[OWNER]))).rowCount,1,'other profile fields still save');
   assert.equal((await as('authenticated',OWNER,c=>c.query('update public.app_profiles set meeting_name_sorts=null where user_id=$1',[OWNER])).catch(e=>e.code)),'23502','null is refused (not null)');
  });
  await t.test('the CHECK refuses bad shapes, unknown keys and bad values (a rejection, never an error)',async()=>{
   const P=over=>({parents:[{id:'gabc123',name:'가상협의회',...over}]}),N=names=>({names});
   const bad=[
    [],'x',1,true,null,{extra:1},{Parents:[]},
    {parents:{}},{parents:'x'},{parents:[1]},{parents:['x']},{parents:[null]},{parents:[[]]},{parents:[{}]},{parents:[{id:'gabc123'}]},{parents:[{name:'가'}]},
    P({extra:'x'}),P({id:'abc123'}),P({id:'g12'}),P({id:'gABCDEF'}),P({id:'g'+'a'.repeat(13)}),P({id:5}),P({name:''}),P({name:'  '}),P({name:'가'.repeat(31)}),P({name:'두\n줄'}),P({name:1}),
    {parents:Array.from({length:31},(_,i)=>({id:'g'+String(i).padStart(6,'0'),name:'상위'+i}))},
    {names:[]},{names:'x'},N({'':'etc'}),N({'가 나':'etc'}),N({'가,나':'etc'}),N({'a\u0007b':'etc'}),N({['가'.repeat(101)]:'etc'}),
    N({a:''}),N({a:'ETC'}),N({a:'regular'}),N({a:'gabc'}),N({a:1}),N({a:true}),N({a:null}),N({a:['etc']}),N({a:{}}),
    N(Object.fromEntries(Array.from({length:301},(_,i)=>['k'+i,'etc']))),
   ];
   for(const value of bad)await assert.rejects(write(OWNER,OWNER,value),{code:'23514'},JSON.stringify(value).slice(0,100));
   const ok=[P({}),P({name:'가'.repeat(30)}),P({id:'g'+'0'.repeat(12)}),N({a:'etc'}),N({a:'del'}),N({a:'gabc123'}),N({['가'.repeat(100)]:'etc'}),N({'😀':'etc'}),
    {parents:Array.from({length:30},(_,i)=>({id:'g'+String(i).padStart(6,'0'),name:'상위'+i}))},N(Object.fromEntries(Array.from({length:300},(_,i)=>['k'+i,'etc']))),good];
   for(const value of ok)assert.equal((await write(OWNER,OWNER,value)).rowCount,1,JSON.stringify(value).slice(0,100));
   // 32 KiB limit counts bytes of the stored text: 300 long names under the field limits but together over 32,768 bytes are refused.
   const long=n=>N(Object.fromEntries(Array.from({length:n},(_,i)=>['가'.repeat(96)+String(i).padStart(3,'0'),'gabc123'])));
   await assert.rejects(write(OWNER,OWNER,long(300)),{code:'23514'},'over 32 KiB');
   assert.equal((await write(OWNER,OWNER,long(100))).rowCount,1,'under 32 KiB');
   await write(OWNER,OWNER,good);
  });
  await t.test('rollback refuses while any sort is saved, and keeps it',async()=>{
   const result=await run('rollback','9803');assert.equal(result.ok,false,result.summary);
   const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/PROFILE_MEETING_NAME_SORTS_ROLLBACK_BLOCKED: sorts saved/);await c.query('rollback');}finally{c.release();}
   assert.deepEqual(await saved_(OWNER),good);
  });
  await t.test('rollback restores the original schema once every sort is empty; re-apply works',async()=>{
   await pool.query("update public.app_profiles set meeting_name_sorts='{}'::jsonb");
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
   const again=await run('apply','9805');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
