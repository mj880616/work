// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic.
// LIB-AI자동분류: 20261022100000_library_ai_fill — app_documents.field_origin (hidden per-field ai/user record) through the
// approved DB workflow runner: dry-run, apply, owner RLS, value check, the PATCH statements ai-assist and the edit screen send, guarded rollback.
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
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261022100000',name='library_ai_fill',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Production-like app_documents: owner RLS (task12a + doc_organization_link), anon revoked, authenticated DML,
// the existing text columns from the old document-ai-index, and the task13 private-visibility trigger.
const documents=`
  create table public.app_documents(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.app_workspaces(id),
    project_id uuid,organization_id uuid,title text,category text,source text,document_date date,file_name text,visibility text default 'private',
    extracted_text text,extraction_status text default 'pending' check (extraction_status in ('pending','ready','error')),extraction_error text,extracted_at timestamptz,
    updated_at timestamptz default now());
  alter table public.app_documents enable row level security;
  create policy task12a_owner_all on public.app_documents for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  create function private.app_enforce_web2_private_visibility() returns trigger language plpgsql as $$ begin
    if new.visibility is distinct from 'private' then raise exception 'private only' using errcode='42501'; end if; return new; end $$;
  create trigger task13_documents_private_visibility before insert or update of visibility on public.app_documents
    for each row execute function private.app_enforce_web2_private_visibility();
  revoke all on public.app_documents from anon;
  revoke truncate, references, trigger on public.app_documents from authenticated;
  insert into supabase_migrations.schema_migrations(version,name) values('20261018032038','doc_organization_link');
`;

test('library ai fill: dry-run, apply, hidden origin column, owner RLS, value check, guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'library-ai-fill-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false});
  await pool.query(fixture);await pool.query(documents);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const doc=async(ws,title,file='a.pdf')=>(await pool.query('insert into public.app_documents(workspace_id,title,category,file_name) values($1,$2,$3,$4) returning id',[ws,title,'기타',file])).rows[0].id;
  const D1=await doc(WS_A,'251020_요구안','251020_요구안.hwpx'),D2=await doc(WS_A,'정책 메모'),D3=await doc(WS_B,'남의 자료');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;

  await t.test('files: read-only checks, three-line summary, expanded approved workflow accepts the file',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const p=plan('apply','1');assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');assert.deepEqual(p.targets,['app_documents']);
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|create function|create table|create policy|disable row level|to anon|to public|grant |update public|delete from public|rtw_/i);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/delete from public|update public|truncate|cascade|grant |policy|extracted_text/i);
  });
  await t.test('precheck before apply',()=>{
   const v=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));
   for(const k of ['new migration absent','prerequisite recorded','field origin column absent','text columns to reuse present','documents RLS enabled','documents owner policy only','authenticated can update documents','owner check function','workspaces table'])assert.equal(v[k],'예',k);
   assert.equal(v['anon or public documents privilege'],'아니오');assert.equal(v['documents rows'],'3');
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await runMigrationPlan(plan('dry-run','9501'),query,{saveSnapshot:async()=>{}});assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('apply passes postcheck; existing rows keep values and start with an empty record',async()=>{
   const saved=new Map();const apply=await runMigrationPlan(plan('apply','9502'),query,{saveSnapshot:async(file,body)=>{saved.set(file,body);}});assert.equal(apply.ok,true,apply.summary);assert.equal(saved.size,1);
   assert.doesNotMatch(apply.summary.split('사후 검사:')[1]??'',/아니오/);
   assert.equal(await history(),1);
   assert.deepEqual((await pool.query('select title,field_origin from public.app_documents order by title')).rows.map(r=>[r.title,r.field_origin]),
    [['251020_요구안',{}],['남의 자료',{}],['정책 메모',{}]]);
   await assert.rejects(pool.query(migration),/LIBRARY_AI_FILL_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });
  await t.test('the PATCH ai-assist sends (owner token, updated_at guard) fills and marks; a moved row is not touched',async()=>{
   // PostgREST gives updated_at as full-precision text; ai-assist sends it back unchanged.
   const stamp=(await pool.query('select updated_at::text t from public.app_documents where id=$1',[D1])).rows[0].t;
   const r=await as('authenticated',OWNER,c=>c.query(`update public.app_documents set title=$1,category=$2,field_origin=$3::jsonb,updated_at=now()
     where id=$4 and workspace_id=$5 and updated_at=$6 returning id`,['요구안','교섭',JSON.stringify({title:'ai',category:'ai'}),D1,WS_A,stamp]));
   assert.equal(r.rowCount,1);
   const stale=await as('authenticated',OWNER,c=>c.query('update public.app_documents set title=$1 where id=$2 and updated_at=$3 returning id',['덮어쓰기',D1,stamp]));
   assert.equal(stale.rowCount,0);
   // The edit screen marks a corrected field as user (other records stay).
   await as('authenticated',OWNER,c=>c.query('update public.app_documents set title=$1,field_origin=$2::jsonb where id=$3',['내가 고친 제목',JSON.stringify({title:'user',category:'ai'}),D1]));
   assert.deepEqual((await pool.query('select field_origin from public.app_documents where id=$1',[D1])).rows[0].field_origin,{title:'user',category:'ai'});
  });
  await t.test('value check: only the four fields, only ai/user',async()=>{
   for(const bad of [{project_id:'ai'},{title:'robot'},{title:1},{title:true},{title:['ai']},[], 'x'])
    await assert.rejects(as('authenticated',OWNER,c=>c.query('update public.app_documents set field_origin=$1::jsonb where id=$2',[JSON.stringify(bad),D2])),{code:'23514'},JSON.stringify(bad));
  });
  await t.test('stranger and anon cannot read or write the record',async()=>{
   assert.equal((await as('authenticated',STRANGER,c=>c.query('update public.app_documents set field_origin=$1::jsonb where id=$2',['{"title":"ai"}',D2]))).rowCount,0);
   assert.equal((await as('authenticated',OWNER,c=>c.query('update public.app_documents set field_origin=$1::jsonb where id=$2',['{"title":"ai"}',D3]))).rowCount,0);
   await assert.rejects(as('anon','',c=>c.query('select field_origin from public.app_documents')),{code:'42501'});
  });
  await t.test('rollback refuses while records exist and keeps them; after reset it restores the snapshot; re-apply works',async()=>{
   await assert.rejects(pool.query(rollbackSQL),/LIBRARY_AI_FILL_ROLLBACK_BLOCKED: field origin records exist/);await pool.query('rollback');
   assert.equal(await history(),1);
   await pool.query("update public.app_documents set field_origin='{}'::jsonb where field_origin<>'{}'::jsonb");
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const after=Object.fromEntries((await pool.query(postcheck)).rows.map(r=>[r.item,r.value]));
   assert.equal(after['column and history agree'],'예');
   await pool.query(migration);assert.equal(await history(),1);
  });
  await t.test('apply refuses when the text columns to reuse are missing (no repair)',async()=>{
   await pool.query(rollbackSQL);
   await pool.query('alter table public.app_documents rename column extracted_text to extracted_text_x');
   try{await assert.rejects(pool.query(migration),/LIBRARY_AI_FILL_PREREQUISITE_CHANGED/);await pool.query('rollback');}
   finally{await pool.query('alter table public.app_documents rename column extracted_text_x to extracted_text');}
   assert.equal(await history(),0);
  });
 }finally{
  if(pool)await pool.end();await cluster.stop().catch(()=>{});
 }
});
