// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic.
// WEEKLY-자료요약 1단계 DB: 20261024140000_document_brief — one check on app_document_ai_index that applies only to rows whose
// content_hash starts with 'b1:'. Runs through the approved DB workflow runner (dry-run, apply), checks every precheck guard,
// the owner upsert ai-assist will send, the b1: boundaries, old-shape rows passing, stranger/anon refusal, and the rollback.
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
const version='20261024140000',name='document_brief',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Production-like shape (assumed; no repository migration creates this table): one row per document, owner policy from task12a,
// anon revoked by the 2026-09-20 cutover, authenticated keeps hosted default DML. Old document-ai-index rows hold long summaries.
const tables=`
  create table public.app_documents(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.app_workspaces(id),title text,
    extracted_text text,extraction_status text default 'pending');
  alter table public.app_documents enable row level security;
  create policy task12a_owner_all on public.app_documents for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  create function private.app_is_owner_document(p_document uuid) returns boolean language sql stable security definer
    set search_path = pg_catalog, public as $$
    select coalesce((select private.app_is_workspace_owner(d.workspace_id) from public.app_documents d where d.id = p_document), false) $$;
  revoke all on function private.app_is_owner_document(uuid) from public;
  grant execute on function private.app_is_owner_document(uuid) to authenticated, service_role;
  create table public.app_document_ai_index(document_id uuid primary key references public.app_documents(id) on delete cascade,
    workspace_id uuid not null references public.app_workspaces(id),content_hash text not null,summary text,keywords text[] not null default '{}',
    chunk_count integer not null default 0,summary_model text,indexed_at timestamptz,updated_at timestamptz not null default now());
  alter table public.app_document_ai_index enable row level security;
  create policy task12a_owner_all on public.app_document_ai_index for all to authenticated
    using (private.app_is_owner_document(document_id)) with check (private.app_is_owner_document(document_id));
  revoke all on public.app_documents, public.app_document_ai_index from anon;
  revoke truncate, references, trigger on public.app_documents, public.app_document_ai_index from authenticated;
  insert into supabase_migrations.schema_migrations(version,name) values('20261022100000','library_ai_fill');
`;
const hash=n=>'b1:'+String(n).repeat(32).slice(0,32);

test('document brief: guards, dry-run, apply, b1: check only, owner-only, rollback',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'document-brief-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false});
  await pool.query(fixture);await pool.query(tables);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const doc=async(ws,title)=>(await pool.query("insert into public.app_documents(workspace_id,title,extracted_text,extraction_status) values($1,$2,'가상 본문','ready') returning id",[ws,title])).rows[0].id;
  const D1=await doc(WS_A,'A 지부 요구안'),D2=await doc(WS_A,'가상 결의대회 계획'),D3=await doc(WS_A,'옛 자료'),DB=await doc(WS_B,'남의 자료');
  // An old document-ai-index row: long summary, keywords, chunks. It must keep passing and stay untouched.
  const longOld='옛 인덱싱 요약 '.repeat(200)+'\n둘째 줄\n셋째 줄 <b>';
  await pool.query("insert into public.app_document_ai_index(document_id,workspace_id,content_hash,summary,keywords,chunk_count,summary_model,indexed_at) values($1,$2,'0123abcd',$3,array['교섭','임금'],4,'old-model',now())",[D3,WS_A,longOld]);
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const items=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  // The upsert ai-assist will send with the owner's token (PostgREST on_conflict=document_id).
  const upsert=(c,id,ws,h,summary,extra={})=>c.query(`insert into public.app_document_ai_index(document_id,workspace_id,content_hash,summary,keywords,chunk_count,summary_model,indexed_at,updated_at)
    values($1,$2,$3,$4,$5,$6,'model-x',now(),now()) on conflict(document_id) do update set content_hash=excluded.content_hash,summary=excluded.summary,keywords=excluded.keywords,
    chunk_count=excluded.chunk_count,summary_model=excluded.summary_model,indexed_at=excluded.indexed_at,updated_at=excluded.updated_at returning document_id`,
    [id,ws,h,summary,extra.keywords??[],extra.chunks??0]);
  const guarded=async(setup)=>{const c=await pool.connect();
   try{await c.query('begin');await c.query(setup);
    await assert.rejects(c.query(migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/DOCUMENT_BRIEF_PREREQUISITE_CHANGED/,setup);}
   finally{await c.query('rollback');c.release();}};
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;

  await t.test('files: read-only checks, three-line summary, approved workflow accepts the file, no grant/policy/RLS change',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const p=plan('apply','1');assert.equal(p.flow,'full');assert.deepEqual(p.targets,['app_document_ai_index']);
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|create function|create table|create policy|alter policy|drop policy|row level|grant |revoke |update public|delete from public|add column|rtw_/i);
   assert.match(migration.trim(),/^begin;/);assert.match(migration.trim(),/insert into supabase_migrations\.schema_migrations[\s\S]*'20261024140000', 'document_brief'[\s\S]*\);\ncommit;$/);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/delete from public|update public|truncate|cascade|grant |revoke |policy|drop column/i);
  });
  await t.test('precheck before apply: every assumption of design 8.1-1',()=>{
   const v=items(beforeCheck);
   for(const k of ['new migration absent','prerequisite recorded','index table present','nine columns with expected types','no other required column without default',
    'document id unique','RLS enabled','one owner policy','owner check function','authenticated can select','authenticated can insert','authenticated can update','brief check absent'])assert.equal(v[k],'예',k);
   assert.equal(v['anon or public table privilege'],'아니오');assert.equal(v['old read policy present'],'아니오');
   assert.equal(v['foreign key to documents'],'예');assert.equal(v['index rows'],'1');assert.equal(v['old shape rows'],'1');assert.equal(v['brief rows'],'0');
   for(const value of Object.values(v))assert.ok(value.length<=128);
  });
  await t.test('migration stops before any change when the table differs from the design',async()=>{
   await guarded('revoke insert on public.app_document_ai_index from authenticated');
   await guarded('revoke update on public.app_document_ai_index from authenticated');
   await guarded('revoke select on public.app_document_ai_index from authenticated');
   await guarded('grant select on public.app_document_ai_index to anon');
   await guarded('create policy app_document_ai_index_read on public.app_document_ai_index for select to authenticated using (true)');
   await guarded('alter table public.app_document_ai_index disable row level security');
   await guarded("alter table public.app_document_ai_index add column extra text not null default 'x'; alter table public.app_document_ai_index alter column extra drop default");
   await guarded('alter table public.app_document_ai_index drop column summary_model');
   await guarded('alter table public.app_document_ai_index alter column keywords drop default, alter column keywords type jsonb using to_jsonb(keywords)');
   await guarded('alter table public.app_document_ai_index drop constraint app_document_ai_index_pkey');
   await guarded("delete from supabase_migrations.schema_migrations where version='20261022100000'");
   assert.equal(await history(),0);
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await runMigrationPlan(plan('dry-run','9601'),query,{saveSnapshot:async()=>{}});assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);assert.equal(await history(),0);
  });
  await t.test('apply passes postcheck; old row untouched; second apply refused',async()=>{
   const saved=new Map();const apply=await runMigrationPlan(plan('apply','9602'),query,{saveSnapshot:async(file,body)=>{saved.set(file,body);}});assert.equal(apply.ok,true,apply.summary);
   assert.doesNotMatch(apply.summary.split('사후 검사:')[1]??'',/아니오/);assert.equal(await history(),1);
   const pre=items(beforeCheck),post=items((await pool.query(postcheck)).rows);
   for(const k of ['brief check and history agree','RLS still enabled','one owner policy still','no anon or public table privilege'])assert.equal(post[k],'예',k);
   for(const k of ['index rows','old shape rows','columns definition hash','other constraints hash','indexes hash','owner RLS grants hash','column grants hash','policies hash','triggers hash'])assert.equal(post[k],pre[k],k);
   assert.equal((await pool.query('select summary from public.app_document_ai_index where document_id=$1',[D3])).rows[0].summary,longOld);
   await assert.rejects(pool.query(migration),/DOCUMENT_BRIEF_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });
  await t.test('owner upsert of a b1: brief works (insert, then update; empty brief allowed)',async()=>{
   assert.equal((await owner(c=>upsert(c,D1,WS_A,hash('a'),'A 지부 임금교섭 요구안. 기본급 5% 인상·인력 충원 요구, 10.28.(화) 1차 교섭 예정.'))).rowCount,1);
   assert.equal((await owner(c=>upsert(c,D1,WS_A,hash('b'),'첫 줄 요약.\n둘째 줄 요약.'))).rowCount,1);
   assert.equal((await owner(c=>upsert(c,D2,WS_A,hash('c'),''))).rowCount,1);
   assert.equal((await owner(c=>upsert(c,D2,WS_A,hash('d'),'가'.repeat(120)+'\n'+'나'.repeat(79)))).rowCount,1);
   assert.equal((await pool.query("select count(*)::int n from public.app_document_ai_index where left(content_hash,3)='b1:'")).rows[0].n,2);
  });
  await t.test('b1: rows outside the shape are refused by the server',async()=>{
   const bad=[
    [hash('e'),'가'.repeat(201)],[hash('e'),'한 줄\n두 줄\n세 줄'],[hash('e'),'가'.repeat(121)],[hash('e'),'탭\t있음'],[hash('e'),'캐리지\r리턴'],
    [hash('e'),'널\u0001문자'],[hash('e'),'삭제\u007f문자'],[hash('e'),'<script>'],[hash('e'),'a > b'],[hash('e'),null],
    ['b1:'+'A'.repeat(32),'대문자 지문'],['b1:'+'a'.repeat(31),'짧은 지문'],['b1:'+'a'.repeat(33),'긴 지문'],['b1:','빈 지문'],['b1:'+'g'.repeat(32),'16진수 아님'],
   ];
   for(const [h,s] of bad)await assert.rejects(owner(c=>upsert(c,D2,WS_A,h,s)),{code:'23514'},JSON.stringify([h,s]));
   await assert.rejects(owner(c=>upsert(c,D2,WS_A,hash('e'),'키워드 있음',{keywords:['x']})),{code:'23514'});
   await assert.rejects(owner(c=>upsert(c,D2,WS_A,hash('e'),'조각 있음',{chunks:1})),{code:'23514'});
   // Changing an existing b1: row into a bad shape is refused too.
   await assert.rejects(owner(c=>c.query("update public.app_document_ai_index set summary=repeat('가',300) where document_id=$1",[D1])),{code:'23514'});
  });
  await t.test('old-shape rows are not touched by the check',async()=>{
   await owner(c=>c.query("update public.app_document_ai_index set summary=$2,keywords=array['a','b'],chunk_count=9 where document_id=$1",[D3,longOld+' 더']));
   assert.equal((await pool.query('select chunk_count from public.app_document_ai_index where document_id=$1',[D3])).rows[0].chunk_count,9);
   await owner(c=>c.query("update public.app_document_ai_index set summary=$2,chunk_count=4 where document_id=$1",[D3,longOld]));
  });
  await t.test('stranger and anon cannot read or write; owner cannot write for another workspace document',async()=>{
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_document_ai_index'))).rows[0].n,0);
   await assert.rejects(stranger(c=>upsert(c,D2,WS_A,hash('f'),'남이 씀')),{code:'42501'});
   assert.equal((await stranger(c=>c.query("update public.app_document_ai_index set summary='남' where document_id=$1",[D1]))).rowCount,0);
   await assert.rejects(owner(c=>upsert(c,DB,WS_B,hash('f'),'남의 자료에 씀')),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query('select summary from public.app_document_ai_index')),{code:'42501'});
   await assert.rejects(as('anon','',c=>upsert(c,D2,WS_A,hash('f'),'익명')),{code:'42501'});
  });
  await t.test('rollback removes only the check and the record; rows stay; snapshot matches; re-apply works',async()=>{
   const rows=(await pool.query('select document_id,content_hash,summary from public.app_document_ai_index order by document_id')).rows;
   await pool.query(rollbackSQL);assert.equal(await history(),0);
   assert.deepEqual((await pool.query('select document_id,content_hash,summary from public.app_document_ai_index order by document_id')).rows,rows);
   const restored=(await pool.query(snapshot)).rows.filter(r=>r.kind!=='history'),orig=before.filter(r=>r.kind!=='history');assert.deepEqual(restored,orig);
   assert.equal(items((await pool.query(postcheck)).rows)['brief check and history agree'],'예');
   await assert.rejects(pool.query(rollbackSQL),/DOCUMENT_BRIEF_ROLLBACK_BLOCKED/);await pool.query('rollback');
   await pool.query(migration);assert.equal(await history(),1);
  });
  await t.test('re-apply after rollback stops (whole transaction) when a bad b1: row slipped in meanwhile; the row is not changed',async()=>{
   await pool.query(rollbackSQL);
   await pool.query('update public.app_document_ai_index set summary=$2 where document_id=$1',[D1,'가'.repeat(250)]);
   await assert.rejects(pool.query(migration),{code:'23514'});await pool.query('rollback');
   assert.equal(await history(),0);
   assert.equal((await pool.query('select char_length(summary) n from public.app_document_ai_index where document_id=$1',[D1])).rows[0].n,250);
  });
 }finally{
  if(pool)await pool.end();await cluster.stop().catch(()=>{});
 }
});
