// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S47-40 UI-앱안알림 4·5 DB(20261101210000_push_log_notices): app_push_log shown_at·opened_at·'shown' — through the approved DB workflow runner.
// Prerequisite 20261101010000_phone_push is applied from its repository file first.
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
const version='20261101210000',name='push_log_notices',stem=version+'_'+name;
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

test('push log notices db: plan, dry-run, apply, shown/opened columns, server-only writes, owner reads, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'push-log-notices-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query(await read('supabase/migrations/20261101010000_phone_push.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL]=await Promise.all(['precheck','postcheck','snapshot','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  // An existing phone push row before the change stays readable and untouched.
  await server(c=>c.query("insert into public.app_push_log(workspace_id,kind,ref_key,day,status) values ($1,'test','t1','2026-11-01','sent')",[WS_A]));
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const addLog=(c,ws,kind,ref,status='shown',shown=true,day='2026-11-01')=>c.query('insert into public.app_push_log(workspace_id,kind,ref_key,day,status,shown_at) values ($1,$2,$3,$4,$5,$6)',[ws,kind,ref,day,status,shown?new Date():null]);

  await t.test('approval plan: expanded rules, full flow, no definer function, no grant or policy',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.flow,'full');
   assert.deepEqual(plan.review.definer,[]);
   assert.doesNotMatch(migration,/\bgrant\b|create policy|drop policy|security definer/i);
   assert.equal(prepareMigration({mode:'dry-run',version,runId:'1',root}).flow,'full');
   assert.match(toDryRun(migration),/rollback;\s*$/);
  });
  await t.test('precheck: all yes before apply',()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
  await t.test('dry-run leaves schema and history unchanged',async()=>{
   const dry=await run('dry-run','9941');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; second apply refused; old row kept',async()=>{
   const apply=await run('apply','9942');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9943')).ok,false);
   const old=(await owner(c=>c.query("select status,shown_at,opened_at from public.app_push_log where ref_key='t1'"))).rows;
   assert.deepEqual(old,[{status:'sent',shown_at:null,opened_at:null}]);
  });
  await t.test('server writes shown and opened; shown needs shown_at; same row for push and bar',async()=>{
   await server(c=>addLog(c,WS_A,'next_week','w2026-11-02'));
   await server(c=>addLog(c,WS_B,'next_week','w2026-11-02'));
   await assert.rejects(server(c=>addLog(c,WS_A,'meeting_done','job-1','shown',false)),{code:'23514'});
   await assert.rejects(server(c=>addLog(c,WS_A,'meeting_done','job-1','queued',true)),{code:'23514'});
   // A push already sent for the same item: the bar only adds shown_at to that row.
   await server(c=>addLog(c,WS_A,'meeting_done','job-2','sent',false));
   assert.equal((await server(c=>c.query("update public.app_push_log set shown_at=now() where workspace_id=$1 and kind='meeting_done' and ref_key='job-2' and shown_at is null",[WS_A]))).rowCount,1);
   assert.equal((await server(c=>c.query("update public.app_push_log set opened_at=now() where workspace_id=$1 and kind='next_week' and ref_key='w2026-11-02' and opened_at is null",[WS_A]))).rowCount,1);
  });
  await t.test('screen reads own rows only and cannot write; anon nothing',async()=>{
   const mine=(await owner(c=>c.query('select kind,ref_key,status,shown_at is not null as shown,opened_at is not null as opened from public.app_push_log order by kind,ref_key'))).rows;
   assert.equal(mine.length,3);
   assert.deepEqual(mine.find(r=>r.kind==='next_week'),{kind:'next_week',ref_key:'w2026-11-02',status:'shown',shown:true,opened:true});
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_push_log where opened_at is not null'))).rows[0].n,0);
   await assert.rejects(owner(c=>c.query('update public.app_push_log set opened_at=now()')),{code:'42501'});
   await assert.rejects(owner(c=>addLog(c,WS_A,'next_week','w2026-11-09')),{code:'42501'});
   await assert.rejects(owner(c=>c.query('delete from public.app_push_log')),{code:'42501'});
   await assert.rejects(anon(c=>c.query('select 1 from public.app_push_log')),{code:'42501'});
   await assert.rejects(anon(c=>c.query('update public.app_push_log set opened_at=now()')),{code:'42501'});
  });
  await t.test('rollback returns to the snapshot and drops only bar-only rows',async()=>{
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   for(const r of await readOnly(precheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const left=(await pool.query('select kind,ref_key,status from public.app_push_log order by kind,ref_key')).rows;
   assert.deepEqual(left,[{kind:'meeting_done',ref_key:'job-2',status:'sent'},{kind:'test',ref_key:'t1',status:'sent'}]);
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
