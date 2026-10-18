// Fresh local PostgreSQL only. No Supabase, Google or production credentials.
// UI-바구니첨부메모 PR 2b: app_profiles.document_categories + category functions through the approved DB workflow runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {fixture,OWNER,STRANGER,WS_A,WS_B} from './basket4-fixture.mjs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261018112943',name='doc_categories_profile',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const DEFAULT=['교섭','투쟁','교육','선전','정책','회의','기타'];
const OUTSIDER='20000000-0000-4000-8000-000000000003';
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Production-like prerequisites (task12a + 2a): app_profiles with owner RLS (ALL via private.app_is_owner_profile,
// SELECT own row), authenticated SELECT/UPDATE only, anon revoked; app_documents with owner RLS and category text.
// Hosted default ACL also grants EXECUTE on new functions to anon/service_role.
const prerequisites=`
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
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
  create table public.app_documents(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.app_workspaces(id),
    title text,category text,visibility text default 'private',organization_id uuid,updated_at timestamptz default now());
  alter table public.app_documents enable row level security;
  create policy task12a_owner_all on public.app_documents for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke all on public.app_documents from anon;
  revoke truncate, references, trigger on public.app_documents from authenticated;
  insert into public.app_workspace_members values ('${WS_A}', '${OUTSIDER}', 'viewer');
  insert into public.app_profiles(user_id,display_name) values ('${OWNER}','소유자'),('${STRANGER}','남'),('${OUTSIDER}','다른 구성원');
  insert into supabase_migrations.schema_migrations(version,name) values('20261018032038','doc_organization_link');
`;

test('doc categories on profile: dry-run, apply, own-profile functions, CHECK and guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'doc-categories-profile-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false});
  await pool.query(fixture);
  await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const doc=async(ws,category,title='자료')=>(await pool.query('insert into public.app_documents(workspace_id,category,title) values($1,$2,$3) returning id',[ws,category,title])).rows[0].id;
  const D1=await doc(WS_A,'정부자료','국토부 지침'),D2=await doc(WS_A,'정책','정책 메모'),D3=await doc(WS_A,'교섭자료','요구안'),D4=await doc(WS_B,'정책','남의 자료'),D5=await doc(WS_B,'교섭','남의 교섭');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const rpc=(sub,fn,args)=>as('authenticated',sub,c=>c.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as r`,args)).then(r=>r.rows[0].r);
  const list=async user=>(await pool.query('select document_categories from public.app_profiles where user_id=$1',[user])).rows[0].document_categories;
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;

  await t.test('precheck proves authenticated UPDATE and the owner own-row RLS before apply',()=>{
   const v=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));
   assert.deepEqual([v['prerequisite recorded'],v['new migration absent'],v['abandoned version absent'],v['new column count'],v['new functions count'],v['RLS enabled'],
    v['anon or public table privilege'],v['authenticated can update profiles'],v['owner policies only (current shape)'],v['owner check function (task12a body)'],
    v['owner profile row exists'],v['owner can update own profile row'],v['documents category column'],v['authenticated can update documents'],v['profiles rows'],v['triggers count']],
    ['예','예','예','0','0','예','아니오','예','예','예','예','예','예','예','3','0']);
  });
  await t.test('the owner can really update the own profile row under RLS (what the precheck asserts)',async()=>{
   const r=await as('authenticated',OWNER,c=>c.query("update public.app_profiles set job_title=job_title where user_id=$1",[OWNER]));assert.equal(r.rowCount,1);
   const other=await as('authenticated',OWNER,c=>c.query("update public.app_profiles set job_title='x' where user_id=$1",[STRANGER]));assert.equal(other.rowCount,0);
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await runMigrationPlan(plan('dry-run','9501'),query);assert.equal(dry.ok,true,dry.summary);assert.equal(dry.verification,'complete',dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('apply passes postcheck; every profile gets the default 7 and documents keep their values',async()=>{
   const apply=await runMigrationPlan(plan('apply','9502'),query);assert.equal(apply.ok,true,apply.summary);assert.doesNotMatch(apply.summary.split('사후 검사:')[1],/아니오/);
   assert.match(apply.summary,/ops_backup\.20261018112943_app_profiles_9502/);
   assert.ok((await pool.query(postcheck)).rows.every(r=>r.ok==='예'));
   assert.deepEqual((await pool.query('select document_categories from public.app_profiles order by user_id')).rows.map(r=>r.document_categories),[DEFAULT,DEFAULT,DEFAULT]);
   assert.deepEqual((await pool.query('select id,category from public.app_documents')).rows.map(r=>[r.id,r.category]).sort(),[[D1,'정부자료'],[D2,'정책'],[D3,'교섭자료'],[D4,'정책'],[D5,'교섭']].sort());
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
   // Functions: INVOKER, empty search_path, authenticated only.
   const fns=(await pool.query(`select proname,prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('service_role',oid,'execute') svc,
     has_function_privilege('authenticated',oid,'execute') auth from pg_proc where proname like 'app_document_category_%' order by proname`)).rows;
   assert.equal(fns.length,3);
   for(const f of fns)assert.deepEqual([f.prosecdef,f.proconfig,f.anon,f.svc,f.auth],[false,['search_path=""'],false,false,true],f.proname);
   assert.deepEqual((await pool.query("select relacl::text acl from pg_class where oid='public.app_profiles'::regclass")).rows[0].acl.match(/authenticated=[a-z]*/)[0],'authenticated=rw');
  });
  await t.test('add / rename (with documents) / delete to 기타 on the own profile only',async()=>{
   assert.deepEqual(await rpc(OWNER,'app_document_category_add',[' 조직 ']),{ok:true,categories:[...DEFAULT,'조직']});
   for(const [bad,error] of [['조직','CATEGORY_EXISTS'],['','INVALID_NAME'],['  ','INVALID_NAME'],['가'.repeat(21),'INVALID_NAME'],['두\n줄','INVALID_NAME'],['a,b','INVALID_NAME'],['가\t나','INVALID_NAME'],[null,'INVALID_NAME']])
    assert.equal((await rpc(OWNER,'app_document_category_add',[bad])).error,error,JSON.stringify(bad));
   assert.equal((await rpc(OWNER,'app_document_category_add',['가'.repeat(20)])).ok,true,'20 characters are allowed');
   assert.equal((await rpc(OWNER,'app_document_category_delete',['가'.repeat(20),[]])).ok,true);
   // Other profiles are untouched.
   assert.deepEqual(await list(STRANGER),DEFAULT);assert.deepEqual(await list(OUTSIDER),DEFAULT);
   // Rename 정책 → 정책·국회: the list and own-workspace documents shown as 정책 (stored 정책 and old 정부자료) change together.
   const renamed=await rpc(OWNER,'app_document_category_rename',['정책','정책·국회',['정부자료']]);
   assert.deepEqual(renamed,{ok:true,categories:['교섭','투쟁','교육','선전','정책·국회','회의','기타','조직'],documents:2});
   assert.deepEqual((await pool.query('select category from public.app_documents where id in($1,$2) order by title',[D1,D2])).rows.map(r=>r.category),['정책·국회','정책·국회']);
   assert.equal((await pool.query('select category from public.app_documents where id=$1',[D4])).rows[0].category,'정책','another workspace is untouched');
   // Stored values that are another current category are refused (cannot sweep 교섭 into 정책·국회).
   assert.equal((await rpc(OWNER,'app_document_category_rename',['정책·국회','정책',['교섭']])).error,'INVALID_INPUT');
   assert.equal((await rpc(OWNER,'app_document_category_rename',['정책·국회','정책',[null]])).error,'INVALID_INPUT');
   for(const [args,error] of [[['없음','새',[]],'CATEGORY_NOT_FOUND'],[['기타','그 밖',[]],'CATEGORY_LOCKED'],[['교섭','교육',[]],'CATEGORY_EXISTS'],[['교섭','',[]],'INVALID_NAME'],[['교섭','a,b',[]],'INVALID_NAME']])
    assert.equal((await rpc(OWNER,'app_document_category_rename',args)).error,error,args.join('/'));
   // Delete 교섭: own-workspace documents stored as 교섭자료 become 기타; another workspace's 교섭 stays.
   const removed=await rpc(OWNER,'app_document_category_delete',['교섭',['교섭자료']]);
   assert.deepEqual(removed,{ok:true,categories:['투쟁','교육','선전','정책·국회','회의','기타','조직'],documents:1});
   assert.equal((await pool.query('select category from public.app_documents where id=$1',[D3])).rows[0].category,'기타');
   assert.equal((await pool.query('select category from public.app_documents where id=$1',[D5])).rows[0].category,'교섭');
   assert.equal((await rpc(OWNER,'app_document_category_delete',['기타',[]])).error,'CATEGORY_LOCKED');
   assert.deepEqual(await list(OWNER),['투쟁','교육','선전','정책·국회','회의','기타','조직']);
  });
  await t.test('non-owner profiles, anon and missing login cannot change anything',async()=>{
   // OUTSIDER is a non-owner member: owner RLS hides even the own row from ALL writes.
   for(const [fn,args] of [['app_document_category_add',['침입']],['app_document_category_rename',['투쟁','x',[]]],['app_document_category_delete',['투쟁',[]]]])
    assert.equal((await rpc(OUTSIDER,fn,args)).error,'PERMISSION_DENIED',fn);
   assert.deepEqual(await list(OUTSIDER),DEFAULT);
   // STRANGER owns another workspace: changes only the own list and own documents, never WS_A's.
   const s=await rpc(STRANGER,'app_document_category_delete',['정책',[]]);assert.equal(s.ok,true);assert.equal(s.documents,1);
   assert.equal((await pool.query('select category from public.app_documents where id=$1',[D4])).rows[0].category,'기타');
   assert.deepEqual((await pool.query('select category from public.app_documents where id in($1,$2) order by title',[D1,D2])).rows.map(r=>r.category),['정책·국회','정책·국회']);
   assert.deepEqual(await list(OWNER),['투쟁','교육','선전','정책·국회','회의','기타','조직']);
   assert.equal((await rpc('','app_document_category_add',['x'])).error,'PERMISSION_DENIED');
   await assert.rejects(as('anon','',c=>c.query("select public.app_document_category_add('x')")),{code:'42501'});
   await assert.rejects(as('service_role','',c=>c.query("select public.app_document_category_add('x')")),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query('select document_categories from public.app_profiles limit 1')),{code:'42501'});
  });
  await t.test('the CHECK also guards direct writes of the list',async()=>{
   for(const bad of [["교섭"],["기타","기타"],[],["기타",""],["기타"," 교섭"],["기타","a,b"],["기타",null],Array.from({length:30},(_,i)=>'분류'+i).concat('기타')])
    await assert.rejects(as('authenticated',OWNER,c=>c.query('update public.app_profiles set document_categories=$1 where user_id=$2',[bad,OWNER])),{code:'23514'},JSON.stringify(bad));
   await assert.rejects(as('authenticated',OWNER,c=>c.query("update public.app_profiles set document_categories='{{기타,교섭}}' where user_id=$1",[OWNER])),{code:'23514'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query("update public.app_profiles set document_categories='[0:1]={기타,교섭}' where user_id=$1",[OWNER])),{code:'23514'});
   const ok=await as('authenticated',OWNER,c=>c.query("update public.app_profiles set document_categories=array['기타','교섭자료','교섭'] where user_id=$1",[OWNER]));assert.equal(ok.rowCount,1,'prefix names are distinct');
   // Existing profile save path (display_name/job_title PATCH) keeps working.
   const save=await as('authenticated',OWNER,c=>c.query("update public.app_profiles set display_name='소유자2',job_title=null,updated_at=now() where user_id=$1",[OWNER]));assert.equal(save.rowCount,1);
  });
  await t.test('rollback refuses while any list is edited, and keeps it',async()=>{
   const result=await runMigrationPlan(plan('rollback','9503'),query);assert.equal(result.ok,false,result.summary);
   await assert.rejects(pool.query(rollbackSQL),/DOC_CATEGORIES_PROFILE_ROLLBACK_BLOCKED: category list edited/);await pool.query('rollback');
   assert.deepEqual(await list(OWNER),['기타','교섭자료','교섭']);
  });
  await t.test('rollback restores the original schema once lists are default; re-apply works',async()=>{
   await pool.query('update public.app_profiles set document_categories=$1',[DEFAULT]);
   await pool.query("update public.app_profiles set display_name='소유자' where user_id=$1",[OWNER]);
   const result=await runMigrationPlan(plan('rollback','9504'),query);assert.equal(result.ok,true,result.summary);assert.doesNotMatch(result.summary.split('사후 검사:')[1],/아니오/);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const after=Object.fromEntries((await pool.query(precheck)).rows.map(r=>[r.item,r.value])),base=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));
   for(const key of ['new column count','new functions count','owner policies only (current shape)','authenticated can update profiles','owner can update own profile row','columns hash','constraints hash','indexes hash','owner RLS grants hash','policies hash','triggers hash'])assert.equal(after[key],base[key],key);
   assert.equal((await pool.query("select count(*)::int n from pg_proc where proname like 'app_document_category_%'")).rows[0].n,0);
   // Re-apply (main file as the SQL Editor path would run it), then roll back again.
   await pool.query(migration);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,1);
   assert.ok((await pool.query(postcheck)).rows.every(r=>r.ok==='예'));
   await pool.query(rollbackSQL);
   assert.ok((await pool.query(postcheck)).rows.every(r=>r.ok==='예'));
  });
  await t.test('apply refuses when UPDATE is missing, the owner policy differs, anon has a privilege or the abandoned version is recorded (no repair)',async()=>{
   const refuse=async(change,undo)=>{await pool.query(change);try{await assert.rejects(pool.query(migration),/DOC_CATEGORIES_PROFILE_PREREQUISITE_CHANGED/);await pool.query('rollback');}finally{await pool.query(undo);}};
   await refuse('revoke update on public.app_profiles from authenticated','grant update on public.app_profiles to authenticated');
   await refuse('alter policy task12a_owner_all on public.app_profiles with check (true)','alter policy task12a_owner_all on public.app_profiles with check (private.app_is_owner_profile(user_id))');
   await refuse('alter policy task12a_owner_all on public.app_profiles using (false)','alter policy task12a_owner_all on public.app_profiles using (private.app_is_owner_profile(user_id))');
   await refuse('create policy extra_read on public.app_profiles for select to authenticated using (true)','drop policy extra_read on public.app_profiles');
   await refuse('grant select on public.app_profiles to anon','revoke select on public.app_profiles from anon');
   await refuse(`insert into supabase_migrations.schema_migrations(version,name) values('20261018023753','doc_org_categories')`,`delete from supabase_migrations.schema_migrations where version='20261018023753'`);
   await refuse(`delete from supabase_migrations.schema_migrations where version='20261018032038'`,`insert into supabase_migrations.schema_migrations(version,name) values('20261018032038','doc_organization_link')`);
   await refuse(`create or replace function private.app_is_owner_profile(p_user uuid) returns boolean language sql stable security definer set search_path = pg_catalog, public as $$ select true $$`,
    `create or replace function private.app_is_owner_profile(p_user uuid) returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
    select exists (
      select 1
      from public.app_workspace_members subject
      join public.app_workspace_members owner
        on owner.workspace_id = subject.workspace_id
       and owner.role = 'owner'
       and owner.user_id = (select auth.uid())
      where subject.user_id = p_user
    )
  $$`);
   assert.equal((await pool.query("select count(*)::int n from pg_attribute where attrelid='public.app_profiles'::regclass and attname='document_categories' and not attisdropped")).rows[0].n,0);
   const v=Object.fromEntries((await pool.query(precheck)).rows.map(r=>[r.item,r.value]));
   assert.equal(v['owner check function (task12a body)'],'예','restored function matches again');
  });
 }finally{
  if(pool)await pool.end();await cluster.stop().catch(()=>{});
 }
});
