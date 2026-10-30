// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// CAL-조직참고캘린더 1/2: app_profiles_ledger_calendar_check accepts org (the organization id the reference calendar belongs to) through the approved DB workflow runner.
// - 다른 키 규칙 그대로(이미 저장된 calendar·colors·mine 모양을 그대로 받고, 전에 거절하던 값은 계속 거절).
// - 권한 그대로: 프로필은 내 행만, anon은 못 읽는다. 표 권한·정책 수 그대로.
// - 승인형 workflow의 plan·dry-run·apply가 통과하고, rollback은 저장된 조직이 있으면 멈춘 뒤 비우면 원래 모양으로 돌아간다.
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
const version='20261030210000',name='profile_ledger_calendar_org',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const OUTSIDER='20000000-0000-4000-8000-000000000003';
const ORG='30000000-0000-4000-8000-0000000000aa';
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Production-like prerequisites: app_profiles with owner RLS, authenticated SELECT/UPDATE only, anon revoked,
// and the ledger_calendar column + CHECK exactly as 20261025110000_ledger_sources made them (taken from that file).
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
  insert into supabase_migrations.schema_migrations(version,name) values('20261025110000','ledger_sources');
`;
// The ledger_calendar statements of the earlier migration, verbatim (column + CHECK).
async function ledgerCalendarSql(){
 const src=await read('supabase/migrations/20261025110000_ledger_sources.sql');
 const start=src.indexOf('alter table public.app_profiles\n  add column ledger_calendar');
 const end=src.indexOf(');',src.indexOf('add constraint app_profiles_ledger_calendar_check'))+2;
 assert.ok(start>0&&end>start,'ledger_calendar statements found in the earlier migration');
 return src.slice(start,end);
}

test('ledger calendar org: plan, dry-run, apply, own-row writes, CHECK and guarded rollback',{timeout:150000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'ledger-calendar-org-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(prerequisites);
  await pool.query(await ledgerCalendarSql());
  const rollbackSQL=await read('docs/'+stem+'.rollback.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  const saveSnapshot=async()=>{};
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const write=(sub,user,value)=>as('authenticated',sub,c=>c.query('update public.app_profiles set ledger_calendar=$1::jsonb where user_id=$2',[JSON.stringify(value),user]));
  const saved_=async user=>(await pool.query('select ledger_calendar from public.app_profiles where user_id=$1',[user])).rows[0].ledger_calendar;
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;
  const old={calendar:'fake-calendar@group.example',colors:['3','11'],mine:true};
  const NEW={calendar:'fake-calendar@group.example',org:ORG};

  await t.test('before apply the CHECK refuses org and accepts the old keys',async()=>{
   const v=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));
   assert.deepEqual([v['prerequisite recorded'],v['new migration absent'],v['ledger calendar check without org'],v['saved org'],v['RLS enabled'],v['anon or public table privilege'],v['two owner policies'],v['profiles rows']],
    ['예','예','예','0','예','아니오','예','3']);
   await assert.rejects(write(OWNER,OWNER,NEW),{code:'23514'});
   assert.equal((await write(OWNER,OWNER,old)).rowCount,1,'the old keys are accepted before');
  });
  await t.test('plan accepts the migration and its companion files',()=>{
   const p=plan('apply','9850');assert.ok(p&&!p.rejected,JSON.stringify(p).slice(0,300));
   assert.ok(plan('rollback','9851'));
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9852');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; grants, policies and rows unchanged',async()=>{
   const apply=await run('apply','9853');assert.equal(apply.ok,true,apply.summary);
   assert.ok((await pool.query(postcheck)).rows.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'));
   assert.deepEqual(await saved_(OWNER),old,'a value saved before stays as it was');
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
   assert.equal((await pool.query("select relacl::text acl from pg_class where oid='public.app_profiles'::regclass")).rows[0].acl.match(/authenticated=[a-z]*/)[0],'authenticated=rw');
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid='public.app_profiles'::regclass")).rows[0].n,2);
  });
  await t.test('the owner saves calendar + org (and the old keys); other rows, outsiders and anon cannot',async()=>{
   for(const value of [NEW,{org:ORG},{...old,org:ORG},{},{calendar:'x'}]){assert.equal((await write(OWNER,OWNER,value)).rowCount,1,JSON.stringify(value));assert.deepEqual(await saved_(OWNER),value);}
   assert.equal((await write(OWNER,STRANGER,NEW)).rowCount,0,'another profile row is not writable');
   assert.equal((await write(OUTSIDER,OUTSIDER,NEW)).rowCount,0,'a non-owner member cannot write even the own row');
   await assert.rejects(as('anon','',c=>c.query('select ledger_calendar from public.app_profiles limit 1')),{code:'42501'});
  });
  await t.test('the CHECK refuses malformed org and still refuses what it refused before',async()=>{
   const bad=[{org:ORG.toUpperCase()},{org:'not-a-uuid'},{org:''},{org:1},{org:null},{org:[ORG]},{org:ORG+' '},{orgs:ORG},
    {calendar:''},{calendar:'a'.repeat(201)},{colors:['1','2','3','4','5','6']},{colors:['x']},{mine:'true'},{extra:1},[],'x'];
   for(const value of bad)await assert.rejects(write(OWNER,OWNER,value),{code:'23514'},JSON.stringify(value));
  });
  await t.test('rollback refuses while org is saved, and keeps it',async()=>{
   await write(OWNER,OWNER,NEW);
   const result=await run('rollback','9854');assert.equal(result.ok,false,result.summary);
   const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/PROFILE_LEDGER_CALENDAR_ORG_ROLLBACK_BLOCKED: organization saved/);await c.query('rollback');}finally{c.release();}
   assert.deepEqual(await saved_(OWNER),NEW);
  });
  await t.test('rollback restores the previous schema once no org remains; re-apply works',async()=>{
   await write(OWNER,OWNER,old);
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await assert.rejects(write(OWNER,OWNER,NEW),{code:'23514'});
   assert.deepEqual(await saved_(OWNER),old,'other saved values survive the rollback');
   const again=await run('apply','9855');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
