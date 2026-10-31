// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S47-12 폰 알림 N2 DB(20261101010000_phone_push): app_push_devices·app_push_log·app_profiles.notify_prefs — through the approved DB workflow runner.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261101010000',name='phone_push',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Production-like prerequisites: app_profiles with task12a owner RLS, authenticated SELECT/UPDATE only, anon revoked.
const prerequisites=`
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;
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
  create table public.app_profiles(user_id uuid primary key,display_name text,created_at timestamptz default now(),updated_at timestamptz default now());
  alter table public.app_profiles enable row level security;
  create policy task12a_owner_all on public.app_profiles for all to authenticated
    using (private.app_is_owner_profile(user_id)) with check (private.app_is_owner_profile(user_id));
  create policy task12a_profile_self_select on public.app_profiles for select to authenticated
    using (user_id = (select auth.uid()));
  revoke all on public.app_profiles from public, anon, authenticated;
  grant select, update on public.app_profiles to authenticated;
  insert into public.app_profiles(user_id,display_name) values ('${OWNER}','소유자'),('${STRANGER}','남');`;
const TOKEN='fcmTokenAAAA_bbbb:CCCC-dddd1234567890';

test('phone push db: plan, dry-run, apply, owner boundary, token hidden, server-only writes, prefs shape, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'phone-push-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL]=await Promise.all(['precheck','postcheck','snapshot','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const addDevice=(c,ws,user,token,ver='0.5.0')=>c.query('insert into public.app_push_devices(workspace_id,user_id,fcm_token,app_version) values ($1,$2,$3,$4) returning id',[ws,user,token,ver]).then(r=>r.rows[0].id);
  const addLog=(c,ws,kind,ref,day='2026-11-01',status='sent')=>c.query('insert into public.app_push_log(workspace_id,kind,ref_key,day,status) values ($1,$2,$3,$4,$5)',[ws,kind,ref,day,status]);
  const setPrefs=(fn,prefs)=>fn(c=>c.query('update public.app_profiles set notify_prefs=$1::jsonb where user_id=$2',[prefs===null?null:JSON.stringify(prefs),OWNER]));

  await t.test('approval plan: expanded rules, full flow, no definer function',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.review.definer,[]);
   assert.equal(prepareMigration({mode:'dry-run',version,runId:'1',root}).flow,'full');
   assert.match(toDryRun(migration),/rollback;\s*$/);
  });
  await t.test('precheck: all yes before apply',()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
  await t.test('dry-run leaves schema and history unchanged',async()=>{
   const dry=await run('dry-run','9931');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; second apply refused',async()=>{
   const apply=await run('apply','9932');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9933')).ok,false);
  });

  let devA;
  await t.test('devices: only the server registers; owner lists own devices without the token and can delete; stranger and anon nothing',async()=>{
   devA=await server(c=>addDevice(c,WS_A,OWNER,TOKEN));
   await server(c=>addDevice(c,WS_B,STRANGER,'strangerToken_0123456789abcdef'));
   await assert.rejects(owner(c=>addDevice(c,WS_A,OWNER,'ownerSelfInsert_0123456789')),{code:'42501'});
   await assert.rejects(owner(c=>c.query('update public.app_push_devices set revoked_at=now()')),{code:'42501'});
   await assert.rejects(owner(c=>c.query('select fcm_token from public.app_push_devices')),{code:'42501'});
   await assert.rejects(owner(c=>c.query('select * from public.app_push_devices')),{code:'42501'});
   const rows=(await owner(c=>c.query('select id,workspace_id,app_version,last_seen_at,revoked_at from public.app_push_devices'))).rows;
   assert.equal(rows.length,1);assert.equal(rows[0].id,devA);assert.equal(rows[0].app_version,'0.5.0');
   assert.equal((await stranger(c=>c.query('select id from public.app_push_devices where workspace_id=$1',[WS_A]))).rows.length,0);
   assert.equal((await stranger(c=>c.query('delete from public.app_push_devices where id=$1',[devA]))).rowCount,0);
   await assert.rejects(anon(c=>c.query('select id from public.app_push_devices')),{code:'42501'});
   await assert.rejects(anon(c=>c.query('delete from public.app_push_devices')),{code:'42501'});
   // Token is unique and shaped; version shaped.
   await assert.rejects(server(c=>addDevice(c,WS_A,OWNER,TOKEN)),{code:'23505'});
   for(const bad of ['short','has space token 0123456789','quote\'token_0123456789abc','x'.repeat(4097)])
     await assert.rejects(server(c=>addDevice(c,WS_A,OWNER,bad)),{code:'23514'},bad.slice(0,30));
   await assert.rejects(server(c=>addDevice(c,WS_A,OWNER,'okToken_0123456789abcdefg','0.5 beta')),{code:'23514'});
   // Server marks unregistered devices and refreshes last seen.
   assert.equal((await server(c=>c.query('update public.app_push_devices set revoked_at=now(),last_seen_at=now() where id=$1',[devA]))).rowCount,1);
   // Owner removes own device.
   assert.equal((await owner(c=>c.query('delete from public.app_push_devices where id=$1',[devA]))).rowCount,1);
  });
  await t.test('log: only the server writes; one per kind, ref and day; owner reads own; stranger and anon nothing',async()=>{
   await server(c=>addLog(c,WS_A,'task_due','task-abc_1'));
   await server(c=>addLog(c,WS_A,'morning','2026-11-01'));
   await server(c=>addLog(c,WS_B,'evening','2026-11-01'));
   await assert.rejects(server(c=>addLog(c,WS_A,'task_due','task-abc_1')),{code:'23505'});
   await server(c=>addLog(c,WS_A,'task_due','task-abc_1','2026-11-02','held_quiet'));
   for(const [kind,ref,status] of [['push','x','sent'],['task_due','제목 그대로','sent'],['task_due','a b','sent'],['task_due','x'.repeat(81),'sent'],['task_due','ok','queued']])
     await assert.rejects(server(c=>addLog(c,WS_A,kind,ref,'2026-11-03',status)),{code:'23514'},kind+ref.slice(0,10)+status);
   await assert.rejects(owner(c=>addLog(c,WS_A,'test','t1')),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_push_log set status='failed'")),{code:'42501'});
   await assert.rejects(owner(c=>c.query('delete from public.app_push_log')),{code:'42501'});
   assert.equal((await owner(c=>c.query('select count(*)::int n from public.app_push_log'))).rows[0].n,3);
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_push_log'))).rows[0].n,1);
   await assert.rejects(anon(c=>c.query('select 1 from public.app_push_log')),{code:'42501'});
   // Server cleans old rows.
   assert.equal((await server(c=>c.query("delete from public.app_push_log where sent_at < now() - interval '30 days'"))).rowCount,0);
  });
  await t.test('notify_prefs: owner saves own valid shape; wrong shapes refused; stranger cannot change it',async()=>{
   for(const ok of [{},{kinds:{task_due:false}},{quiet:{from:'22:00',to:'07:00'}},
     {kinds:{task_due:true,commitment:true,meeting_done:false,collect_stall:true,morning:true,evening:false,next_week:true},quiet:{from:'23:30',to:'06:00'}}])
     assert.equal((await setPrefs(owner,ok)).rowCount,1,JSON.stringify(ok));
   for(const bad of [[],'x',{other:1},{kinds:[]},{kinds:{task_due:'yes'}},{kinds:{calendar:true}},{quiet:{from:'22:00'}},
     {quiet:{from:'24:00',to:'07:00'}},{quiet:{from:'7:00',to:'08:00'}},{quiet:{from:'22:00',to:'07:00',days:1}},{quiet:{from:2200,to:700}},{quiet:'22-07'},
     {kinds:{task_due:true},quiet:{from:'22:00',to:'07:00'},pad:'x'.repeat(1000)}])
     await assert.rejects(setPrefs(owner,bad),{code:'23514'},JSON.stringify(bad).slice(0,60));
   assert.equal((await setPrefs(owner,null)).rowCount,1);
   assert.equal((await stranger(c=>c.query("update public.app_profiles set notify_prefs='{}'::jsonb where user_id=$1",[OWNER]))).rowCount,0);
   await assert.rejects(anon(c=>c.query("update public.app_profiles set notify_prefs='{}'::jsonb")),{code:'42501'});
  });
  await t.test('rollback returns to the snapshot',async()=>{
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   for(const r of await readOnly(precheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
