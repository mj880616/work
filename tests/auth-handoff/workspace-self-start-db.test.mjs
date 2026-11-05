// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// MULTI-노조사용자 ②-4 (S50-19): 20261105183000_workspace_self_start - 로그인한 본인에게만 작업공간 1개 + owner 행 1개.
// 서버 스위치(app_workspace_signup, SQL로만 씀)가 꺼져 있으면 거절, 켜지면 본인 1개만·두 번 눌러도 1개·남 대신 못 만듦·이미 owner면 새로 안 만듦.
// 운영 전용 역할 트리거가 역할을 바꾸면(owner가 아니게 되면) 아무것도 남기지 않고 실패한다.
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
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261105183000',name='workspace_self_start',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const NEWCOMER='20000000-0000-4000-8000-000000000031';
const SECOND='20000000-0000-4000-8000-000000000032';
const REWRITTEN='20000000-0000-4000-8000-000000000033';
// Production-like shape: profiles table (auth sign-up trigger already makes rows for most accounts), members locked by the
// collab lockdown restrictive policies, hosted table grants, a role trigger standing in for the production-only one.
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  create table public.app_profiles(user_id uuid primary key, display_name text, view_prefs jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  insert into public.app_profiles(user_id,display_name) values ('${OWNER}','소유자'),('${SECOND}','두번째');
  grant select, insert, update, delete on public.app_workspace_members, public.app_workspaces, public.app_profiles to authenticated;
  alter table public.app_workspace_members enable row level security;
  alter table public.app_workspaces enable row level security;
  alter table public.app_profiles enable row level security;
  create policy task12a_member_self_select on public.app_workspace_members for select to authenticated using (user_id = (select auth.uid()));
  create policy task12a_owner_all on public.app_workspaces for all to authenticated
    using (private.app_is_workspace_owner(id)) with check (private.app_is_workspace_owner(id));
  create policy collab_lock_no_insert on public.app_workspace_members as restrictive for insert to anon, authenticated with check (false);
  create policy app_profiles_self_update on public.app_profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  create function private.app_enforce_workspace_member_role() returns trigger language plpgsql security definer
    set search_path = pg_catalog, public as $$
    begin
      if new.user_id = '${REWRITTEN}'::uuid then new.role := 'viewer'; end if;
      return new;
    end $$;
  create trigger trg_app_enforce_workspace_member_role before insert or update on public.app_workspace_members
    for each row execute function private.app_enforce_workspace_member_role();
  insert into supabase_migrations.schema_migrations(version,name) values ('20261105131500','profile_view_prefs_org_order');`;

test('workspace self start: switch off refuses; on creates exactly one workspace for the caller only; rollback restores',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'workspace-start-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false,max:6}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const user=sub=>fn=>as('authenticated',sub,fn);
  const start=sub=>user(sub)(c=>c.query('select public.app_workspace_start() r')).then(r=>r.rows[0].r);
  const status=sub=>user(sub)(c=>c.query('select public.app_workspace_start_status() r')).then(r=>r.rows[0].r);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const counts=async()=>(await pool.query("select (select count(*)::int from public.app_workspaces) w,(select count(*)::int from public.app_workspace_members) m,(select count(*)::int from public.app_profiles) p")).rows[0];
  const ownedBy=async sub=>(await pool.query("select workspace_id from public.app_workspace_members where user_id=$1 and role='owner'",[sub])).rows.map(r=>r.workspace_id);
  const setSwitch=open=>pool.query('update public.app_workspace_signup set open=$1, updated_at=now() where id=1',[open]);
  const before=(await pool.query(snapshot)).rows;
  const beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules pass; one new table, two definer functions, authenticated-only grants; no switch-on; summary 3 lines',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const sql of [precheck,postcheck,snapshot,rollbackSQL,migration])assert.doesNotMatch(sql.replace(/--.*$/gm,''),/information_schema/i);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual(plan.createdTables,['app_workspace_signup']);
    assert.deepEqual([...plan.review.definer].sort(),['public.app_workspace_start','public.app_workspace_start_status']);
    assert.equal(plan.review.policies,0);assert.equal(plan.review.triggers,0);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0].replace(/\s+/g,' '));
   assert.deepEqual(grants,['grant execute on function public.app_workspace_start_status() to authenticated;','grant execute on function public.app_workspace_start() to authenticated;']);
   assert.match(code,/insert into public\.app_workspace_signup \(id, open\) values \(1, false\);/);
   assert.doesNotMatch(code,/open\s*=\s*true|values \(1, true\)/i,'the switch is not turned on here');
   assert.doesNotMatch(code,/on auth\.users|create trigger|app_operator_features|alter policy|drop policy|create or replace|rtw_|disable row level security|\bto (anon|public)\b/i);
   assert.doesNotMatch(code,/create function public\.app_workspace_start\w*\s*\([^)]/i,'no arguments: nothing the screen sends is trusted');
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id in the migration');
   assert.doesNotMatch(code,/@[a-z0-9-]+\.[a-z]/i,'no mail address in the migration');
   for(const sql of [snapshot])for(const line of sql.split('\n'))assert.ok(line.length<8192);
   assert.match(rollbackSQL,/SQL Editor/);
  });
  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.equal(v['member role trigger count'],'1');
   const dry=await run('dry-run','9991');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9992');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck));
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else assert.equal(value,v[item],item);
   }
   assert.equal((await run('apply','9993')).ok,false);
  });
  await t.test('the switch is closed to every API role; nobody but SQL can read or turn it on',async()=>{
   assert.deepEqual((await pool.query('select id,open from public.app_workspace_signup')).rows,[{id:1,open:false}]);
   for(const role of ['authenticated','service_role','anon']){
    await assert.rejects(as(role,NEWCOMER,c=>c.query('select * from public.app_workspace_signup')),{code:'42501'},role);
    await assert.rejects(as(role,NEWCOMER,c=>c.query('update public.app_workspace_signup set open=true where id=1')),{code:'42501'},role);
   }
   await assert.rejects(as('anon','',c=>c.query('select public.app_workspace_start()')),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query('select public.app_workspace_start_status()')),{code:'42501'});
   await assert.rejects(as('service_role','',c=>c.query('select public.app_workspace_start()')),{code:'42501'},'a server key cannot create workspaces for others');
   await assert.rejects(user(NEWCOMER)(c=>c.query('select public.app_workspace_start($1)',[STRANGER])),{code:'42883'},'no argument to name another person');
  });
  await t.test('switch off: refused with SIGNUP_CLOSED, status says closed, nothing is created',async()=>{
   const was=await counts();
   assert.deepEqual(await status(NEWCOMER),{open:false,has_workspace:false});
   assert.deepEqual(await status(OWNER),{open:false,has_workspace:true});
   await assert.rejects(start(NEWCOMER),err=>err.code==='42501'&&/SIGNUP_CLOSED/.test(err.message));
   await assert.rejects(start(OWNER),/SIGNUP_CLOSED/);
   await assert.rejects(start(''),/AUTH_REQUIRED/);
   assert.deepEqual(await counts(),was);
   assert.deepEqual(await ownedBy(NEWCOMER),[]);
  });
  await t.test('switch on: the caller gets exactly one workspace + one owner row + a profile; pressing again returns the same one',async()=>{
   await setSwitch(true);
   const was=await counts();
   assert.deepEqual(await status(NEWCOMER),{open:true,has_workspace:false});
   const first=await start(NEWCOMER);
   assert.equal(first.ok,true);assert.equal(first.created,true);
   assert.match(first.workspace_id,/^[0-9a-f-]{36}$/);
   assert.deepEqual(await ownedBy(NEWCOMER),[first.workspace_id]);
   assert.deepEqual((await pool.query('select user_id,role from public.app_workspace_members where workspace_id=$1',[first.workspace_id])).rows,[{user_id:NEWCOMER,role:'owner'}]);
   assert.deepEqual(await counts(),{w:was.w+1,m:was.m+1,p:was.p+1});
   const again=await start(NEWCOMER);
   assert.deepEqual(again,{ok:true,created:false,workspace_id:first.workspace_id});
   assert.deepEqual(await counts(),{w:was.w+1,m:was.m+1,p:was.p+1});
   assert.deepEqual(await status(NEWCOMER),{open:true,has_workspace:true});
   // The new owner sees only their own workspace through the normal owner check; the existing workspace stays invisible.
   assert.deepEqual((await user(NEWCOMER)(c=>c.query('select id from public.app_workspaces order by id'))).rows.map(r=>r.id),[first.workspace_id]);
   assert.equal((await user(NEWCOMER)(c=>c.query('select private.app_is_workspace_owner($1) v',[WS_A]))).rows[0].v,false);
   assert.equal((await pool.query("select count(*)::int n from public.app_workspaces where slug='kptu-work' or name<>'내 작업공간' and id=$1",[first.workspace_id])).rows[0].n,0);
  });
  await t.test('two presses at the same time still make one workspace; an existing profile is kept as is',async()=>{
   const was=await counts();
   const [a,b]=await Promise.all([start(SECOND),start(SECOND)]);
   assert.equal(a.workspace_id,b.workspace_id);
   assert.deepEqual([a.created,b.created].sort(),[false,true]);
   assert.deepEqual(await ownedBy(SECOND),[a.workspace_id]);
   assert.deepEqual(await counts(),{w:was.w+1,m:was.m+1,p:was.p});
   assert.equal((await pool.query('select display_name from public.app_profiles where user_id=$1',[SECOND])).rows[0].display_name,'두번째');
  });
  await t.test('an existing owner gets their workspace back, nothing new; nobody can create for someone else',async()=>{
   const was=await counts();
   assert.deepEqual(await start(OWNER),{ok:true,created:false,workspace_id:WS_A});
   assert.deepEqual(await counts(),was);
   assert.deepEqual(await ownedBy(OWNER),[WS_A]);
   // A caller only ever affects their own auth.uid(): STRANGER (owner of WS_B) gets WS_B, and NEWCOMER rows are untouched.
   const mine=await ownedBy(NEWCOMER);
   await start(STRANGER);
   assert.deepEqual(await ownedBy(NEWCOMER),mine);
   assert.equal((await pool.query('select count(*)::int n from public.app_workspace_members where user_id<>all($1::uuid[])',[[OWNER,STRANGER,NEWCOMER,SECOND]])).rows[0].n,0);
  });
  await t.test('if the role trigger rewrites the owner role, the call fails and leaves nothing behind',async()=>{
   const was=await counts();
   await assert.rejects(start(REWRITTEN),/WORKSPACE_OWNER_NOT_SET/);
   assert.deepEqual(await counts(),was);
   assert.equal((await pool.query('select count(*)::int n from public.app_workspace_members where user_id=$1',[REWRITTEN])).rows[0].n,0);
  });
  await t.test('switch off again: refused again, made workspaces stay',async()=>{
   await setSwitch(false);
   await assert.rejects(start(SECOND),/SIGNUP_CLOSED/);
   assert.equal((await ownedBy(SECOND)).length,1);
  });
  await t.test('rollback drops only what this file made; created workspaces stay; re-apply works',async()=>{
   const was=await counts();
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.deepEqual((await pool.query("select to_regclass('public.app_workspace_signup') a,to_regprocedure('public.app_workspace_start()') f,to_regprocedure('public.app_workspace_start_status()') s")).rows[0],{a:null,f:null,s:null});
   assert.deepEqual(await counts(),was);
   const pre=values(await readOnly(precheck)),orig=values(beforeCheck);
   for(const k of ['member role trigger function hash','three tables policies hash','three tables grants and RLS hash','three tables triggers hash','three tables indexes hash'])assert.equal(pre[k],orig[k],k);
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
