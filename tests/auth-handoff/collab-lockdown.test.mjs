// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// S47-50 DB-협업잔재차단: 20261102013000_collab_lockdown - 협업 DEFINER 함수 9개의 PUBLIC·anon·authenticated 실행권 회수,
// app_invites·app_workspace_members의 쓰기(insert·update·delete)를 restrictive 정책으로 차단. 읽기·owner 확인·자료는 그대로.
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
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261102013000',name='collab_lockdown',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const NEWCOMER='20000000-0000-4000-8000-000000000009';
const FUNCTIONS=[
 ["public.app_create_invite(text,uuid,timestamptz)","select public.app_create_invite('viewer',null,now()+interval '1 day')"],
 ["public.app_set_workspace_member_role(uuid,text)",`select public.app_set_workspace_member_role('${NEWCOMER}','admin')`],
 ["public.app_approve_access_request(uuid,text)",`select public.app_approve_access_request('${NEWCOMER}',null)`],
 ["public.app_reject_access_request(uuid)",`select public.app_reject_access_request('${NEWCOMER}')`],
 ["public.app_accept_invite(text)","select public.app_accept_invite('x')"],
 ["public.app_claim_owner(text,text)","select public.app_claim_owner('x','y')"],
 ["public.app_request_workspace_access(text)","select public.app_request_workspace_access('x')"],
 ["public.app_respond_project_invitation(uuid,boolean)",`select public.app_respond_project_invitation('${NEWCOMER}',true)`],
 ["public.app_join_default_team()","select public.app_join_default_team()"],
];
// Production-like shape (task12a policies, hosted table grants). Function ACLs are deliberately the worst case:
// default PUBLIC execute plus explicit anon/authenticated/service_role grants, as a schema-only restore could leave them.
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant select, insert, update, delete on public.app_workspace_members, public.app_workspaces to authenticated;
  alter table public.app_workspace_members enable row level security;
  alter table public.app_workspaces enable row level security;
  create policy task12a_owner_all on public.app_workspace_members for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  create policy task12a_member_self_select on public.app_workspace_members for select to authenticated using (user_id = (select auth.uid()));
  create policy task12a_owner_all on public.app_workspaces for all to authenticated
    using (private.app_is_workspace_owner(id)) with check (private.app_is_workspace_owner(id));
  create table public.app_invites(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id),
    group_id uuid, token_hash text not null, role text not null, expires_at timestamptz, created_by uuid);
  alter table public.app_invites enable row level security;
  create policy task12a_owner_all on public.app_invites for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  create function public.app_create_invite(p_role text default 'viewer', p_group uuid default null, p_expires_at timestamptz default now()+interval '7 days')
    returns text language plpgsql security definer set search_path = pg_catalog, public as $$
    declare v_workspace uuid; v_token text;
    begin
      select m.workspace_id into v_workspace from public.app_workspace_members m where m.user_id = auth.uid() and m.role = 'owner' limit 1;
      if v_workspace is null then raise exception 'owner permission required' using errcode='42501'; end if;
      v_token := md5(random()::text);
      insert into public.app_invites(workspace_id,group_id,token_hash,role,expires_at,created_by) values(v_workspace,p_group,md5(v_token),p_role,p_expires_at,auth.uid());
      return v_token;
    end $$;
  create function public.app_set_workspace_member_role(p_user uuid, p_role text) returns jsonb
    language plpgsql security definer set search_path = public, private, pg_temp as $$
    declare v_workspace uuid;
    begin
      select workspace_id into v_workspace from public.app_workspace_members where user_id=auth.uid() and role='owner' limit 1;
      if v_workspace is null then raise exception 'no permission' using errcode='42501'; end if;
      update public.app_workspace_members set role=p_role where workspace_id=v_workspace and user_id=p_user;
      return jsonb_build_object('ok',true);
    end $$;
  create function public.app_approve_access_request(p_request uuid, p_role text default null) returns boolean language sql security definer set search_path = pg_catalog as $$ select true $$;
  create function public.app_reject_access_request(p_request uuid) returns boolean language sql security definer set search_path = pg_catalog as $$ select true $$;
  create function public.app_accept_invite(p_token text) returns boolean language sql security definer set search_path = pg_catalog as $$ select true $$;
  create function public.app_claim_owner(p_code text, p_display_name text) returns boolean language sql security definer set search_path = pg_catalog as $$ select true $$;
  create function public.app_request_workspace_access(p_token text) returns boolean language sql security definer set search_path = pg_catalog as $$ select true $$;
  create function public.app_respond_project_invitation(p_invitation uuid, p_accept boolean) returns boolean language sql security definer set search_path = pg_catalog as $$ select true $$;
  create function public.app_join_default_team() returns boolean language sql security definer set search_path = pg_catalog as $$ select true $$;
  grant execute on all functions in schema public to anon, authenticated, service_role;
  insert into supabase_migrations.schema_migrations(version,name) values ('20261101233000','news_clipping');`;

test('collab lockdown: nine collaboration RPCs closed to anon/authenticated; invites and member rows not writable; owner reads unchanged; rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'collab-lockdown-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn,{keep=false}={}){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query(keep?'commit':'rollback');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=(fn,o)=>as('authenticated',OWNER,fn,o),stranger=(fn,o)=>as('authenticated',STRANGER,fn,o),anon=fn=>as('anon','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  let before,beforeCheck;

  await t.test('files: expanded rules pass; 6 restrictive policies, no grant, no definer; summary 3 lines; rollback is SQL Editor only',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const sql of [precheck,postcheck,snapshot,rollbackSQL,migration])assert.doesNotMatch(sql.replace(/--.*$/gm,''),/information_schema|rtw_/i);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual(plan.createdTables,[]);assert.deepEqual(plan.review.definer,[]);
    assert.equal(plan.review.policies,6);assert.equal(plan.review.restrictive,6);assert.equal(plan.review.triggers,0);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/^\s*grant\s/im,'no grant at all');
   assert.doesNotMatch(code,/alter policy|drop policy|create or replace|drop function|disable row level security|alter table/i);
   assert.equal([...code.matchAll(/^revoke execute on function public\.app_[a-z_]+\([^)]*\) from public, anon, authenticated;$/gm)].length,9);
   for(const table of ['app_invites','app_workspace_members'])for(const cmd of ['insert','update','delete']){
    assert.match(code,new RegExp(`create policy collab_lock_no_${cmd} on public\\.${table} as restrictive for ${cmd} to anon, authenticated `),table+cmd);
    assert.match(rollbackSQL,new RegExp(`drop policy collab_lock_no_${cmd} on public\\.${table};`),table+cmd);
   }
   assert.match(rollbackSQL,/SQL Editor 경로 전용/);
  });
  await t.test('before: the gap is real (owner can invite and add another person; anon can call the RPCs)',async()=>{
   assert.equal(typeof (await owner(c=>c.query("select public.app_create_invite('viewer',null,now()+interval '1 day') t"),{keep:true})).rows[0].t,'string');
   await owner(c=>c.query("insert into public.app_workspace_members values($1,$2,'viewer')",[WS_A,NEWCOMER]),{keep:true});
   assert.equal((await anon(c=>c.query('select public.app_accept_invite($1) v',['x']))).rows[0].v,true);
   before=(await pool.query(snapshot)).rows;
   beforeCheck=await readOnly(precheck);
  });
  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.equal(v['collaboration functions executable by anon or authenticated (count)'],'9');
   assert.equal(v['app_workspace_members owner rows'],'2');assert.equal(v['app_workspace_members rows'],'3');
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9972');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck));
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else assert.equal(value,v[item],item);
   }
   assert.equal((await run('apply','9973')).ok,false);
  });
  await t.test('after: every collaboration RPC refused for anon and authenticated (owner included); service_role untouched',async()=>{
   for(const [sig,call] of FUNCTIONS){
    await assert.rejects(owner(c=>c.query(call)),{code:'42501'},sig);
    await assert.rejects(stranger(c=>c.query(call)),{code:'42501'},sig);
    await assert.rejects(anon(c=>c.query(call)),{code:'42501'},sig);
    assert.equal((await pool.query("select has_function_privilege('service_role',$1::regprocedure,'execute') v",[sig])).rows[0].v,true,sig);
   }
  });
  await t.test('after: owner keeps reading own row and workspace, owner check holds; no member or invite writes for anyone',async()=>{
   assert.deepEqual((await owner(c=>c.query('select workspace_id,user_id,role from public.app_workspace_members order by user_id'))).rows,
    [{workspace_id:WS_A,user_id:OWNER,role:'owner'},{workspace_id:WS_A,user_id:NEWCOMER,role:'viewer'}],'own workspace rows only (left over from the gap check)');
   assert.equal((await owner(c=>c.query('select private.app_is_workspace_owner($1) v',[WS_A]))).rows[0].v,true);
   assert.equal((await owner(c=>c.query('select private.app_is_workspace_owner($1) v',[WS_B]))).rows[0].v,false);
   assert.equal((await owner(c=>c.query('select count(*)::int n from public.app_workspaces'))).rows[0].n,1);
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_workspace_members'))).rows[0].n,1);
   // insert: another person, a second owner row, even into own workspace -> refused by RLS
   await assert.rejects(owner(c=>c.query("insert into public.app_workspace_members values($1,$2,'viewer')",[WS_A,STRANGER])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_workspace_members values($1,$2,'owner')",[WS_A,NEWCOMER])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query("insert into public.app_workspace_members values($1,$2,'owner')",[WS_A,STRANGER])),{code:'42501'});
   // update / delete: nothing matches, so nothing changes (own owner row is protected too)
   assert.equal((await owner(c=>c.query("update public.app_workspace_members set role='admin' where workspace_id=$1",[WS_A]),{keep:true})).rowCount,0);
   assert.equal((await owner(c=>c.query("update public.app_workspace_members set user_id=$2 where user_id=$1",[OWNER,NEWCOMER]),{keep:true})).rowCount,0);
   assert.equal((await owner(c=>c.query('delete from public.app_workspace_members where workspace_id=$1',[WS_A]),{keep:true})).rowCount,0);
   assert.deepEqual((await pool.query("select user_id,role from public.app_workspace_members where workspace_id=$1 order by user_id",[WS_A])).rows,
    [{user_id:OWNER,role:'owner'},{user_id:NEWCOMER,role:'viewer'}]);
   // invites: owner still reads, cannot write
   assert.equal((await owner(c=>c.query('select count(*)::int n from public.app_invites'))).rows[0].n,1);
   await assert.rejects(owner(c=>c.query("insert into public.app_invites(workspace_id,token_hash,role) values($1,'h','viewer')",[WS_A])),{code:'42501'});
   assert.equal((await owner(c=>c.query("update public.app_invites set role='admin'"),{keep:true})).rowCount,0);
   assert.equal((await owner(c=>c.query('delete from public.app_invites'),{keep:true})).rowCount,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_invites')).rows[0].n,1);
   await assert.rejects(anon(c=>c.query("insert into public.app_invites(workspace_id,token_hash,role) values($1,'h','viewer')",[WS_A])),{code:'42501'});
   // the table owner (future signup DEFINER function path) is not affected by the restrictive policies
   await pool.query("insert into public.app_workspace_members values($1,$2,'viewer')",[WS_B,NEWCOMER]);
   await pool.query('delete from public.app_workspace_members where workspace_id=$1 and user_id=$2',[WS_B,NEWCOMER]);
  });
  await t.test('rollback drops only the six policies and the record; data stays; re-apply works',async()=>{
   const rows=(await pool.query('select count(*)::int n from public.app_workspace_members')).rows[0].n;
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polname like 'collab\\_lock\\_%'")).rows[0].n,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_workspace_members')).rows[0].n,rows);
   const pre=values(await readOnly(precheck));
   for(const k of ['existing policies hash (two tables)','table grants and RLS hash (two tables)','triggers hash (two tables)'])assert.equal(pre[k],values(beforeCheck)[k],k);
   assert.equal(pre['collaboration functions executable by anon or authenticated (count)'],'0','execute is not restored by rollback');
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
