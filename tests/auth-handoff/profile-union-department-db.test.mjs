// Fresh local PostgreSQL only. No Supabase, Google or production credentials.
// S62-24 PROFILE-소속칸글로쓰기: app_profiles.union_name·department_name text + CHECK through the approved DB workflow runner.
// 다른 계정(다른 작업공간 주인·같은 작업공간의 owner 아닌 구성원·anon)은 내 노조명·부서명을 읽지도 쓰지도 못한다.
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
const version='20261115223000',name='profile_union_department',stem=version+'_'+name;
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
  insert into supabase_migrations.schema_migrations(version,name) values('20261018112943','doc_categories_profile'),('20261022163000','profile_quick_links'),('20261023150000','profile_library_view'),('20261023180000','profile_view_prefs'),('20261024002000','profile_weekly_schedule_memory'),('20261111100500','profile_meeting_name_presets');
`;

test('profile union/department: dry-run, apply, own-row only, CHECK and guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'profile-union-department-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  const saveSnapshot=async()=>{};
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const write=(sub,user,u,d)=>as('authenticated',sub,c=>c.query('update public.app_profiles set union_name=$1,department_name=$2,updated_at=now() where user_id=$3',[u,d,user]));
  const readAs=(sub,user)=>as('authenticated',sub,c=>c.query('select union_name,department_name from public.app_profiles where user_id=$1',[user])).then(r=>r.rows);
  const stored=async user=>(await pool.query('select union_name u,department_name d from public.app_profiles where user_id=$1',[user])).rows[0];
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;

  await t.test('precheck values before apply',()=>{
   const v=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));
   assert.deepEqual([v['prerequisite recorded'],v['new migration absent'],v['new column count'],v['new check count'],v['RLS enabled'],v['anon or public table privilege'],
    v['authenticated can update profiles'],v['owner policies only (current shape)'],v['owner check function (task12a body)'],v['owner profile row exists'],v['profiles rows']],
    ['예','예','0','0','예','아니오','예','예','예','예','3']);
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9901');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('prerequisite changes stop the migration without any change',async()=>{
   const attempts=[
    ['grant select on public.app_profiles to anon','revoke select on public.app_profiles from anon'],
    ['alter table public.app_profiles disable row level security','alter table public.app_profiles enable row level security'],
    ['revoke update on public.app_profiles from authenticated','grant update on public.app_profiles to authenticated'],
    ["create policy synthetic_extra on public.app_profiles for select to authenticated using (true)",'drop policy synthetic_extra on public.app_profiles'],
    ['alter table public.app_profiles add column union_name text','alter table public.app_profiles drop column union_name'],
    ['alter table public.app_profiles add column department_name text','alter table public.app_profiles drop column department_name'],
    ["delete from supabase_migrations.schema_migrations where version='20261111100500'","insert into supabase_migrations.schema_migrations(version,name) values('20261111100500','profile_meeting_name_presets')"],
   ];
   const migration=await read('supabase/migrations/'+stem+'.sql');
   for(const [breakIt,fixIt] of attempts){
    await pool.query(breakIt);
    try{const c=await pool.connect();try{await assert.rejects(c.query(migration),/PROFILE_UNION_DEPARTMENT_PREREQUISITE_CHANGED/,breakIt);await c.query('rollback');}finally{c.release();}}
    finally{await pool.query(fixIt);}
   }
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; every profile starts empty; grants and policies unchanged',async()=>{
   const apply=await run('apply','9902');assert.equal(apply.ok,true,apply.summary);
   const post=(await pool.query(postcheck)).rows;
   assert.ok(post.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'),JSON.stringify(post));
   for(const r of post.filter(r=>!/^(예|아니오)$/.test(r.value)))assert.equal(r.value,Object.fromEntries(beforeCheck.map(x=>[x.item,x.value]))[r.item],r.item);
   assert.deepEqual((await pool.query('select union_name u,department_name d from public.app_profiles')).rows,[{u:null,d:null},{u:null,d:null},{u:null,d:null}]);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
   assert.equal((await pool.query("select relacl::text acl from pg_class where oid='public.app_profiles'::regclass")).rows[0].acl.match(/authenticated=[a-z]*/)[0],'authenticated=rw');
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid='public.app_profiles'::regclass")).rows[0].n,2);
  });
  // 지어낸 이름만(실제 노조·부서 이름 없음).
  const U='가상노동조합 샘플지부',D='샘플사업팀';
  await t.test('the owner saves and reads own names; other accounts cannot read or write them',async()=>{
   assert.equal((await write(OWNER,OWNER,U,D)).rowCount,1);assert.deepEqual(await stored(OWNER),{u:U,d:D});
   assert.deepEqual(await readAs(OWNER,OWNER),[{union_name:U,department_name:D}]);
   // 다른 작업공간 주인: 내 행이 보이지도, 고쳐지지도 않는다.
   assert.deepEqual(await readAs(STRANGER,OWNER),[],'another account cannot see the names');
   assert.equal((await write(STRANGER,OWNER,'남의 노조','남의 부서')).rowCount,0,'another account cannot write them');
   assert.equal((await write(OWNER,STRANGER,U,D)).rowCount,0,'the owner cannot write another profile');
   assert.deepEqual(await stored(OWNER),{u:U,d:D});assert.deepEqual(await stored(STRANGER),{u:null,d:null});
   // 같은 작업공간의 owner 아닌 구성원도 자기 행을 못 쓴다(지금 이름·직책과 같은 경계).
   assert.equal((await write(OUTSIDER,OUTSIDER,U,D)).rowCount,0);
   await assert.rejects(as('anon','',c=>c.query('select union_name from public.app_profiles limit 1')),{code:'42501'});
   assert.equal((await write(OWNER,OWNER,null,null)).rowCount,1,'clearing back to empty is allowed');
   assert.equal((await as('authenticated',OWNER,c=>c.query("update public.app_profiles set display_name='소유자',job_title=null where user_id=$1",[OWNER]))).rowCount,1,'name and title still save');
  });
  await t.test('the CHECK refuses blank, multi-line and over-long names (a rejection, never an error)',async()=>{
   for(const bad of ['','   ','두\n줄','탭\t','a\u0007b','가'.repeat(61)]){
    await assert.rejects(write(OWNER,OWNER,bad,null),{code:'23514'},'union '+JSON.stringify(bad));
    await assert.rejects(write(OWNER,OWNER,null,bad),{code:'23514'},'department '+JSON.stringify(bad));
   }
   for(const ok of ['가','가'.repeat(60),' 앞뒤 공백 ','😀 지부','A-1 (본부)'])assert.equal((await write(OWNER,OWNER,ok,ok)).rowCount,1,ok);
   await write(OWNER,OWNER,U,D);
  });
  await t.test('rollback refuses while any name is saved, and keeps it',async()=>{
   const result=await run('rollback','9903');assert.equal(result.ok,false,result.summary);
   const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/PROFILE_UNION_DEPARTMENT_ROLLBACK_BLOCKED: names saved/);await c.query('rollback');}finally{c.release();}
   assert.deepEqual(await stored(OWNER),{u:U,d:D});
  });
  await t.test('rollback restores the original schema once every name is empty; re-apply works',async()=>{
   await pool.query('update public.app_profiles set union_name=null,department_name=null');
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
   const again=await run('apply','9905');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
