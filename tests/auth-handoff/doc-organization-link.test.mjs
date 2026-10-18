// Fresh local PostgreSQL only. No Supabase, Google or production credentials.
// UI-바구니첨부메모 PR 2a: app_documents.organization_id through the approved DB workflow runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {fixture,OWNER,STRANGER,WS_A,WS_B,ORG_A,ORG_B,PROJECT_A} from './basket4-fixture.mjs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261018032038',name='doc_organization_link',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Production-like prerequisites: owner RLS on app_documents (task12a), anon revoked from app_* tables,
// authenticated keeps ordinary DML, and the task13 private-visibility trigger.
const documents=`
  create table public.app_documents(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.app_workspaces(id),
    project_id uuid references public.app_spaces(id),title text,category text,visibility text default 'private',updated_at timestamptz default now());
  alter table public.app_documents enable row level security;
  create policy task12a_owner_all on public.app_documents for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  create function private.app_enforce_web2_private_visibility() returns trigger language plpgsql as $$ begin
    if new.visibility is distinct from 'private' then raise exception 'private only' using errcode='42501'; end if; return new; end $$;
  create trigger task13_documents_private_visibility before insert or update of visibility on public.app_documents
    for each row execute function private.app_enforce_web2_private_visibility();
  revoke all on public.app_documents from anon;
  revoke truncate, references, trigger on public.app_documents from authenticated;
  grant select on public.app_suborganizations to authenticated;
`;

test('doc/organization link migration: dry-run, apply, owner RLS and guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'doc-organization-link-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false});
  await pool.query(fixture);
  await pool.query(`insert into supabase_migrations.schema_migrations(version,name) values('20261012100000','basket_link_view_db')`);
  await pool.query(documents);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const doc=async(ws,category,title='자료')=>(await pool.query('insert into public.app_documents(workspace_id,category,title) values($1,$2,$3) returning id',[ws,category,title])).rows[0].id;
  const D1=await doc(WS_A,'정부자료','국토부 지침'),D2=await doc(WS_A,'정책','정책 메모'),D3=await doc(WS_A,'교섭자료','요구안'),D4=await doc(WS_B,'정책','남의 자료');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;

  await t.test('precheck reports the expected pre-apply state',()=>{
   const v=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));
   assert.deepEqual([v['prerequisite recorded'],v['new migration absent'],v['abandoned version absent'],v['new column count'],v['RLS enabled'],v['owner policy only (current shape)'],v['anon or public table privilege'],v['documents rows']],
    ['예','예','예','0','예','예','아니오','4']);
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await runMigrationPlan(plan('dry-run','9401'),query);assert.equal(dry.ok,true,dry.summary);assert.equal(dry.verification,'complete',dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('apply passes postcheck; existing rows keep their values',async()=>{
   const apply=await runMigrationPlan(plan('apply','9402'),query);assert.equal(apply.ok,true,apply.summary);assert.doesNotMatch(apply.summary.split('사후 검사:')[1],/아니오/);
   assert.ok((await pool.query(postcheck)).rows.every(r=>r.ok==='예'));
   assert.deepEqual((await pool.query('select id,category,organization_id from public.app_documents')).rows.map(r=>[r.id,r.category,r.organization_id]).sort(),[[D1,'정부자료',null],[D2,'정책',null],[D3,'교섭자료',null],[D4,'정책',null]].sort());
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
  });
  await t.test('owner links a document to an own-workspace organization only; others and anon cannot',async()=>{
   await as('authenticated',OWNER,c=>c.query('update public.app_documents set organization_id=$1 where id=$2',[ORG_A,D1]));
   assert.equal((await pool.query('select organization_id from public.app_documents where id=$1',[D1])).rows[0].organization_id,ORG_A);
   // Another workspace's organization is refused by the owner check.
   await assert.rejects(as('authenticated',OWNER,c=>c.query('update public.app_documents set organization_id=$1 where id=$2',[ORG_B,D2])),{code:'42501'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query('insert into public.app_documents(workspace_id,title,organization_id) values($1,$2,$3)',[WS_A,'새 자료',ORG_B])),{code:'42501'});
   // Existing writes that do not send organization_id keep working (the current app).
   await as('authenticated',OWNER,c=>c.query('update public.app_documents set project_id=$1,title=$2 where id=$3',[PROJECT_A,'요구안(수정)',D3]));
   await as('authenticated',OWNER,c=>c.query('insert into public.app_documents(workspace_id,title,category) values($1,$2,$3)',[WS_A,'새 자료','기타']));
   // A stranger sees nothing and cannot link; anon has no table access.
   const moved=await as('authenticated',STRANGER,c=>c.query('update public.app_documents set organization_id=$1 where id=$2',[ORG_B,D2]));assert.equal(moved.rowCount,0);
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_documents limit 1')),{code:'42501'});
   // Deleting the organization only clears the link.
   await pool.query('insert into public.app_suborganizations(id,workspace_id) values($1,$2)',['23000000-0000-4000-8000-000000000009',WS_A]);
   await pool.query('update public.app_documents set organization_id=$1 where id=$2',['23000000-0000-4000-8000-000000000009',D2]);
   await pool.query('delete from public.app_suborganizations where id=$1',['23000000-0000-4000-8000-000000000009']);
   assert.equal((await pool.query('select organization_id from public.app_documents where id=$1',[D2])).rows[0].organization_id,null);
  });
  await t.test('rollback refuses while organization links exist, and keeps them',async()=>{
   const result=await runMigrationPlan(plan('rollback','9403'),query);assert.equal(result.ok,false,result.summary);
   await assert.rejects(pool.query(rollbackSQL),/DOC_ORGANIZATION_LINK_ROLLBACK_BLOCKED/);await pool.query('rollback');
   assert.equal((await pool.query('select count(*)::int n from public.app_documents where organization_id is not null')).rows[0].n,1);
  });
  await t.test('rollback restores the original schema once links are cleared; re-apply works',async()=>{
   await pool.query('update public.app_documents set organization_id=null');
   const result=await runMigrationPlan(plan('rollback','9404'),query);assert.equal(result.ok,true,result.summary);assert.doesNotMatch(result.summary.split('사후 검사:')[1],/아니오/);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const after=Object.fromEntries((await pool.query(precheck)).rows.map(r=>[r.item,r.value])),base=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));
   for(const key of ['new column count','owner policy only (current shape)','columns hash','constraints hash','indexes hash','owner RLS grants hash','policies hash','triggers hash'])assert.equal(after[key],base[key],key);
   await pool.query(migration);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,1);
   await pool.query(rollbackSQL);
  });
  await t.test('apply refuses when the owner check differs, anon has a privilege or the abandoned version is recorded (no repair)',async()=>{
   await pool.query('alter policy task12a_owner_all on public.app_documents with check (true)');
   try{await assert.rejects(pool.query(migration),/DOC_ORGANIZATION_LINK_PREREQUISITE_CHANGED/);await pool.query('rollback');}
   finally{await pool.query('alter policy task12a_owner_all on public.app_documents with check (private.app_is_workspace_owner(workspace_id))');}
   await pool.query('grant select on public.app_documents to anon');
   try{await assert.rejects(pool.query(migration),/DOC_ORGANIZATION_LINK_PREREQUISITE_CHANGED/);await pool.query('rollback');}
   finally{await pool.query('revoke select on public.app_documents from anon');}
   await pool.query(`insert into supabase_migrations.schema_migrations(version,name) values('20261018023753','doc_org_categories')`);
   try{await assert.rejects(pool.query(migration),/DOC_ORGANIZATION_LINK_PREREQUISITE_CHANGED/);await pool.query('rollback');}
   finally{await pool.query(`delete from supabase_migrations.schema_migrations where version='20261018023753'`);}
   assert.equal((await pool.query("select count(*)::int n from pg_attribute where attrelid='public.app_documents'::regclass and attname='organization_id' and not attisdropped")).rows[0].n,0);
  });
 }finally{
  if(pool)await pool.end();await cluster.stop().catch(()=>{});
 }
});
