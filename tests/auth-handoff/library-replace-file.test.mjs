// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic.
// LIB-수정파일교체 DB: 20261024030000_library_replace_file through the approved DB workflow runner — app_documents.previous_files (jsonb, default [])
// + shape CHECK and app_documents.reclassify_needed (boolean, default false). Existing rows stay as they are, the owner RLS and table grants are
// untouched, and the rollback stops while any row holds a replaced-file record.
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
const version='20261024030000',name='library_replace_file',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Production-like app_documents after 20261023120000: file columns, extraction columns, field_origin check, owner RLS, workspace trigger,
// authenticated table-level privileges (anon revoked).
const documents=`
  create table public.app_documents(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.app_workspaces(id),
    title text,category text,source text,document_date date,description text,tags text[] default '{}',
    file_id text,file_name text,mime_type text,file_size bigint,drive_url text,visibility text default 'private',
    classification_note text,extracted_text text,extraction_status text default 'pending',extraction_error text,extracted_at timestamptz,
    field_origin jsonb not null default '{}'::jsonb,created_at timestamptz default now(),updated_at timestamptz default now(),
    constraint app_documents_field_origin_check check (jsonb_typeof(field_origin) = 'object'));
  create index app_documents_workspace_idx on public.app_documents(workspace_id);
  alter table public.app_documents enable row level security;
  create policy task12a_owner_all on public.app_documents for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke all on public.app_documents from anon;
  revoke truncate, references, trigger on public.app_documents from authenticated;
  insert into supabase_migrations.schema_migrations(version,name) values('20261023120000','library_ai_classify');
`;
const entry=(id,extra={})=>({file_id:id,file_name:'옛 파일.hwpx',mime_type:'application/x-hwp',file_size:1234,drive_url:'https://drive.google.com/file/d/'+id+'/view',replaced_at:'2026-10-24T00:00:00Z',...extra});

test('library replace file: dry-run, apply, owner-only writes, shape CHECK, guarded rollback',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'library-replace-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false});
  await pool.query(fixture);await pool.query(documents);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const doc=async(ws,over={})=>(await pool.query(`insert into public.app_documents(workspace_id,title,category,file_id,file_name,mime_type,file_size,drive_url,extracted_text,extraction_status,field_origin)
    values($1,$2,$3,$4,$5,'application/x-hwp',2048,$6,'본문','ready',$7::jsonb) returning id`,[ws,over.title??'제목',over.category??'교섭',over.file_id??'driveFile1',over.file_name??'원본.hwpx','https://drive.google.com/file/d/x/view',JSON.stringify(over.field_origin??{title:'user'})])).rows[0].id;
  const D1=await doc(WS_A),D2=await doc(WS_A,{title:'둘째',file_id:'driveFile2'}),D3=await doc(WS_B,{file_id:'driveFile3'});
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  const dataHash=async()=>(await pool.query(`select md5(string_agg((to_jsonb(d)-'previous_files'-'reclassify_needed')::text,E'\\n' order by d.id)) h from public.app_documents d`)).rows[0].h;
  const writePrev=(sub,id,value)=>as('authenticated',sub,c=>c.query('update public.app_documents set previous_files=$1::jsonb where id=$2',[JSON.stringify(value),id]));
  const v=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows,hashBefore=await dataHash();

  await t.test('files: read-only checks, three-line summary, no grant/policy/function/trigger, approved workflow accepts the file',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run','rollback']){const p=plan(mode,'1');assert.equal(p.name,name);assert.deepEqual(p.targets,['app_documents']);assert.deepEqual(p.functions,[]);assert.equal(p.summaryLines.length,3);}
   for(const mode of ['apply','dry-run']){const p=plan(mode,'1');assert.equal(p.flow,'full');}
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bgrant\b|\brevoke\b|(?:create|alter|drop) policy|row level security|security definer|create (?:or replace )?function|create table|create trigger|\bupdate public\.|\bdelete from public\.|\bnot valid\b|information_schema|rtw_/i);
   assert.match(code,/add column previous_files jsonb not null default '\[\]'::jsonb,\s+add column reclassify_needed boolean not null default false;/);
   assert.doesNotMatch(precheck+postcheck,/information_schema/);
  });
  await t.test('summary has the three plain-language lines',async()=>{
   const lines=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(lines.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   assert.match(lines[0],/칸 두 개/);assert.match(lines[2],/Drive 파일은 어느 경우에도 지워지지 않습니다/);
  });
  await t.test('precheck reports the expected pre-apply state',()=>{
   const p=v(beforeCheck);
   for(const k of ['prerequisite recorded','new migration absent','documents table exists','file and text columns are text','RLS enabled','authenticated can read and update','one owner policy'])assert.equal(p[k],'예',k);
   for(const k of ['anon or public table privilege','anon or public policy'])assert.equal(p[k],'아니오',k);
   assert.deepEqual([p['previous files column count'],p['reclassify column count'],p['previous files check count'],p['documents rows']],['0','0','0','3']);
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await runMigrationPlan(plan('dry-run','9701'),query,{saveSnapshot:async()=>{}});assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);assert.equal(await dataHash(),hashBefore);assert.equal(await history(),0);
  });
  await t.test('prerequisite changes stop the migration without any change',async()=>{
   const attempts=[
    ['grant select on public.app_documents to anon','revoke select on public.app_documents from anon'],
    ['create policy synthetic_anon on public.app_documents for select to anon using (true)','drop policy synthetic_anon on public.app_documents'],
    ['create policy synthetic_second on public.app_documents for select to authenticated using (true)','drop policy synthetic_second on public.app_documents'],
    ['alter table public.app_documents disable row level security','alter table public.app_documents enable row level security'],
    ['revoke update on public.app_documents from authenticated','grant update on public.app_documents to authenticated'],
    ['alter table public.app_documents add column previous_files jsonb','alter table public.app_documents drop column previous_files'],
    ['alter table public.app_documents add column reclassify_needed boolean','alter table public.app_documents drop column reclassify_needed'],
    ["delete from supabase_migrations.schema_migrations where version='20261023120000'","insert into supabase_migrations.schema_migrations(version,name) values('20261023120000','library_ai_classify')"],
   ];
   for(const [breakIt,fixIt] of attempts){
    await pool.query(breakIt);
    try{const c=await pool.connect();try{await assert.rejects(c.query(migration),/LIBRARY_REPLACE_FILE_PREREQUISITE_CHANGED/,breakIt);await c.query('rollback');}finally{c.release();}}
    finally{await pool.query(fixIt);}
   }
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; rows, other columns, constraints, grants, policies, triggers and indexes unchanged',async()=>{
   const apply=await runMigrationPlan(plan('apply','9702'),query,{saveSnapshot:async()=>{}});assert.equal(apply.ok,true,apply.summary);assert.doesNotMatch(apply.summary.split('사후 확인')[1]??'',/\| 아니오 \|/);
   const post=(await pool.query(postcheck)).rows;
   assert.ok(post.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'),'postcheck 예/아니오 items');
   assert.equal(await dataHash(),hashBefore,'existing rows unchanged');
   for(const r of post.filter(r=>!/^(예|아니오)$/.test(r.value)&&r.item!=='recent migrations'))assert.equal(r.value,v(beforeCheck)[r.item],r.item);
   const pre=v((await pool.query(precheck)).rows);assert.deepEqual([pre['previous files column count'],pre['reclassify column count'],pre['previous files check count']],['1','1','1']);
   assert.equal(await history(),1);
   assert.equal((await pool.query(`select count(*)::int n from public.app_documents where previous_files<>'[]'::jsonb or reclassify_needed`)).rows[0].n,0);
   await assert.rejects(pool.query(migration),/LIBRARY_REPLACE_FILE_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });
  await t.test('the owner replaces the file in one write and the links, title and marks stay; others and anon cannot',async()=>{
   const old=entry('driveFile1');
   const r=await as('authenticated',OWNER,c=>c.query(`update public.app_documents set file_id=$2,file_name=$3,previous_files=previous_files||$4::jsonb,reclassify_needed=true,
     extracted_text=null,extraction_status=null where id=$1 returning title,category,field_origin,previous_files,reclassify_needed`,[D1,'driveFile9','새 파일.hwpx',JSON.stringify([old])]));
   assert.equal(r.rowCount,1);assert.deepEqual(r.rows[0],{title:'제목',category:'교섭',field_origin:{title:'user'},previous_files:[old],reclassify_needed:true});
   assert.equal((await writePrev(STRANGER,D1,[old,entry('driveFileX')])).rowCount,0,'stranger writes nothing');
   assert.deepEqual((await pool.query('select previous_files from public.app_documents where id=$1',[D1])).rows[0].previous_files,[old]);
   assert.equal((await as('authenticated',STRANGER,c=>c.query('select previous_files from public.app_documents where workspace_id=$1',[WS_A]))).rowCount,0,'stranger sees nothing');
   assert.equal((await writePrev(OWNER,D3,[old])).rowCount,0,'owner cannot touch another workspace row');
   await assert.rejects(as('anon','',c=>c.query('select previous_files from public.app_documents limit 1')),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query(`update public.app_documents set reclassify_needed=false`)),{code:'42501'});
   assert.equal((await as('authenticated',OWNER,c=>c.query('update public.app_documents set reclassify_needed=false where id=$1',[D1]))).rowCount,1);
  });
  await t.test('the CHECK accepts only an array of objects with a Drive-id-shaped file_id (a rejection, never an error), up to 50 and 64 KiB',async()=>{
   const bad=[{},'x',1,true,null,['x'],[1],[null],[[]],[{}],[{file_name:'a'}],[{file_id:1}],[{file_id:null}],[{file_id:''}],[{file_id:'a b'}],[{file_id:'a/b'}],[{file_id:'x'.repeat(256)}],[entry('ok'),{file_id:'a.b'}],[entry('ok'),{}]];
   const ok=[[],[entry('abc_-123')],[entry('a'),entry('b'),{file_id:'c',extra:1}],[{file_id:'x'.repeat(255)}]];
   for(const value of bad)await assert.rejects(writePrev(OWNER,D2,value),{code:'23514'},JSON.stringify(value).slice(0,60));
   for(const value of ok)assert.equal((await writePrev(OWNER,D2,value)).rowCount,1,JSON.stringify(value).slice(0,60));
   assert.equal((await writePrev(OWNER,D2,Array.from({length:50},(_,i)=>({file_id:'f'+i})))).rowCount,1,'50 entries');
   await assert.rejects(writePrev(OWNER,D2,Array.from({length:51},(_,i)=>({file_id:'f'+i}))),{code:'23514'},'51 entries');
   await assert.rejects(writePrev(OWNER,D2,[{file_id:'f',file_name:'가'.repeat(30000)}]),{code:'23514'},'over 64 KiB');
   await assert.rejects(as('authenticated',OWNER,c=>c.query('update public.app_documents set previous_files=null where id=$1',[D2])),{code:'23502'},'null refused');
   await writePrev(OWNER,D2,[]);
  });
  await t.test('rollback refuses while a replaced-file record or the re-classify mark exists; once cleared it restores the snapshot; re-apply works',async()=>{
   await assert.rejects(pool.query(rollbackSQL),/LIBRARY_REPLACE_FILE_ROLLBACK_BLOCKED/);await pool.query('rollback');
   assert.equal(await history(),1);
   await pool.query(`update public.app_documents set reclassify_needed=true where id=$1`,[D2]);
   await assert.rejects(pool.query(rollbackSQL),/LIBRARY_REPLACE_FILE_ROLLBACK_BLOCKED/);await pool.query('rollback');
   // CC procedure after keeping a capture: clear the synthetic records (test data only).
   await pool.query(`update public.app_documents set previous_files='[]'::jsonb, reclassify_needed=false`);
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const after=v((await pool.query(postcheck)).rows);assert.equal(after['columns check and history agree'],'예');assert.equal(after['every new column at its starting value (or no column)'],'예');
   await pool.query(migration);assert.equal(await history(),1);
  });
 }finally{
  if(pool)await pool.end();await cluster.stop().catch(()=>{});
 }
});
