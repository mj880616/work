// Fresh local PostgreSQL only. No Supabase, Google or production credentials.
// S56-1 MTG-회의명조직묶기: app_profiles_meeting_name_sorts_check에 orgs(정기 회의 조직)를 더하는 migration을 승인형 DB workflow 실행기로 시험한다.
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
const version='20261110090000',name='profile_meeting_name_orgs',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const OUTSIDER='20000000-0000-4000-8000-000000000003';
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// 20261108090000 판까지 적용된 운영과 같은 앞 단계(task12a owner RLS, authenticated SELECT/UPDATE만, anon 없음).
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

// 지어낸 이름만(실제 회의·단체 이름 없음).
const OLD={parents:[{id:'gabc123',name:'가상협의회'}],names:{'가상점검회의':'gabc123','한번모임':'etc','지난회의':'del'}};
const NEW={...OLD,orgs:{'가상대표자회의':'gabc123','지난회의':'gabc123'}};

test('profile meeting name orgs: dry-run, apply, old values kept, CHECK and guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'profile-meeting-name-orgs-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(prerequisites);
  await pool.query(await read('supabase/migrations/20261108090000_profile_meeting_name_sorts.sql'));
  await pool.query('update public.app_profiles set meeting_name_sorts=$1::jsonb where user_id=$2',[JSON.stringify(OLD),OWNER]);
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
  const pre=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));

  await t.test('precheck values before apply',()=>{
   assert.deepEqual([pre['prerequisite recorded'],pre['new migration absent'],pre['sorts column count'],pre['sorts check without orgs'],pre['saved orgs'],pre['RLS enabled'],
    pre['anon or public table privilege'],pre['two owner policies'],pre['profiles rows'],pre['saved sorts rows']],['예','예','1','예','0','예','아니오','예','3','1']);
  });
  await t.test('before apply the old CHECK refuses orgs',async()=>{
   await assert.rejects(write(OWNER,OWNER,NEW),{code:'23514'});
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9811');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('prerequisite changes stop the migration without any change',async()=>{
   const attempts=[
    ['grant select on public.app_profiles to anon','revoke select on public.app_profiles from anon'],
    ['alter table public.app_profiles disable row level security','alter table public.app_profiles enable row level security'],
    ['revoke update on public.app_profiles from authenticated','grant update on public.app_profiles to authenticated'],
    ["create policy synthetic_extra on public.app_profiles for select to authenticated using (true)",'drop policy synthetic_extra on public.app_profiles'],
    ["delete from supabase_migrations.schema_migrations where version='20261108090000'","insert into supabase_migrations.schema_migrations(version,name) values('20261108090000','profile_meeting_name_sorts')"],
    ["insert into supabase_migrations.schema_migrations(version,name) values('20261110090000','profile_meeting_name_orgs')","delete from supabase_migrations.schema_migrations where version='20261110090000'"],
   ];
   const migration=await read('supabase/migrations/'+stem+'.sql');
   for(const [breakIt,fixIt] of attempts){
    await pool.query(breakIt);
    try{const c=await pool.connect();try{await assert.rejects(c.query(migration),/PROFILE_MEETING_NAME_ORGS_PREREQUISITE_CHANGED/,breakIt);await c.query('rollback');}finally{c.release();}}
    finally{await pool.query(fixIt);}
   }
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; saved old value kept; grants and policies unchanged',async()=>{
   const apply=await run('apply','9812');assert.equal(apply.ok,true,apply.summary);
   const post=(await pool.query(postcheck)).rows;
   assert.ok(post.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'),JSON.stringify(post));
   for(const r of post.filter(r=>!/^(예|아니오)$/.test(r.value)))assert.equal(r.value,pre[r.item],r.item);
   assert.deepEqual(await saved_(OWNER),OLD,'옛 값 그대로');
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
   assert.equal((await pool.query("select relacl::text acl from pg_class where oid='public.app_profiles'::regclass")).rows[0].acl.match(/authenticated=[a-z]*/)[0],'authenticated=rw');
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid='public.app_profiles'::regclass")).rows[0].n,2);
  });
  await t.test('the owner saves orgs on the own row; other rows, outsiders and anon cannot',async()=>{
   assert.equal((await write(OWNER,OWNER,NEW)).rowCount,1);assert.deepEqual(await saved_(OWNER),NEW);
   assert.equal((await write(OWNER,STRANGER,NEW)).rowCount,0,'another profile row is not writable');
   assert.equal((await write(OUTSIDER,OUTSIDER,NEW)).rowCount,0,'a non-owner member cannot write even the own row');
   await assert.rejects(as('anon','',c=>c.query('select meeting_name_sorts from public.app_profiles limit 1')),{code:'42501'});
   for(const value of [{},OLD,{orgs:{}},{orgs:{a:'gabc123'}}])assert.equal((await write(OWNER,OWNER,value)).rowCount,1,JSON.stringify(value));
  });
  await t.test('the CHECK refuses bad orgs and still refuses old bad shapes',async()=>{
   const O=orgs=>({orgs});
   const bad=[{extra:1},{orgs:[]},{orgs:'x'},{orgs:null},O({'':'gabc123'}),O({'가 나':'gabc123'}),O({'가,나':'gabc123'}),O({['가'.repeat(101)]:'gabc123'}),
    O({a:'etc'}),O({a:'del'}),O({a:'gABCDEF'}),O({a:'g12'}),O({a:1}),O({a:null}),O({a:['gabc123']}),
    O(Object.fromEntries(Array.from({length:301},(_,i)=>['k'+i,'gabc123']))),
    {names:{a:'regular'}},{parents:[{id:'x',name:'가'}]}];
   for(const value of bad)await assert.rejects(write(OWNER,OWNER,value),{code:'23514'},JSON.stringify(value).slice(0,100));
   for(const value of [O({['가'.repeat(100)]:'g'+'0'.repeat(12)}),O(Object.fromEntries(Array.from({length:300},(_,i)=>['k'+i,'gabc123'])))])
    assert.equal((await write(OWNER,OWNER,value)).rowCount,1);
   await write(OWNER,OWNER,NEW);
  });
  await t.test('rollback refuses while any orgs is saved, and keeps it',async()=>{
   const result=await run('rollback','9813');assert.equal(result.ok,false,result.summary);
   const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/PROFILE_MEETING_NAME_ORGS_ROLLBACK_BLOCKED: orgs saved/);await c.query('rollback');}finally{c.release();}
   assert.deepEqual(await saved_(OWNER),NEW);
  });
  await t.test('rollback restores the old CHECK once orgs are gone; re-apply works',async()=>{
   await pool.query('update public.app_profiles set meeting_name_sorts=$1::jsonb where user_id=$2',[JSON.stringify(OLD),OWNER]);
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
   const again=await run('apply','9815');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
