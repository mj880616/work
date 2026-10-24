// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic.
// LIB-옛자료다시읽기: 20261024170000_library_reread_old_scans through the approved DB workflow runner. Only kptu-work photo/PDF rows that
// ended as "no text" (error + unsupported/empty, empty text, read before the #1101 deploy) get extraction_status error → null, which the
// nightly text_backfill and the library screen pick as "not read yet". Every other row and every other column stays as it was.
// The rollback (SQL Editor only) returns exactly the still-marked rows to error and never touches rows that were read again.
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
import {fixture,WS_A,WS_B} from './basket4-fixture.mjs';
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261024170000',name='library_reread_old_scans',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Production-like app_documents (text columns, owner RLS, workspace trigger shape not needed here).
const documents=`
  update public.app_workspaces set slug='kptu-work' where id='${WS_A}';
  update public.app_workspaces set slug='other-work' where id='${WS_B}';
  create table public.app_documents(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.app_workspaces(id),
    title text,category text,file_id text,file_name text,mime_type text,file_size bigint,visibility text default 'private',
    extracted_text text,extraction_status text default 'pending',extraction_error text,extracted_at timestamptz,
    field_origin jsonb not null default '{}'::jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
  create index app_documents_workspace_idx on public.app_documents(workspace_id);
  alter table public.app_documents enable row level security;
  create policy task12a_owner_all on public.app_documents for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke all on public.app_documents from anon;
  insert into supabase_migrations.schema_migrations(version,name) values('20261024030000','library_replace_file');
`;
const OLD='2026-10-20T03:00:00Z',AFTER='2026-10-24T02:00:00Z';
// [label, fields]. "target" rows must change; all others must not.
const ROWS=[
 ['target jpg unsupported',{file_name:'스캔.jpg',mime_type:'image/jpeg',extraction_status:'error',extraction_error:'unsupported',extracted_at:OLD},true],
 ['target JPEG upper',{file_name:'사진.JPEG',mime_type:'image/jpeg',extraction_status:'error',extraction_error:'unsupported',extracted_at:OLD},true],
 ['target png empty text blank',{file_name:'화면.png',mime_type:'image/png',extracted_text:'  ',extraction_status:'error',extraction_error:'empty',extracted_at:OLD},true],
 ['target pdf empty',{file_name:'공문 스캔.pdf',mime_type:'application/pdf',extraction_status:'error',extraction_error:'empty',extracted_at:OLD},true],
 ['target pdf old meeting path',{file_name:'회의.PDF',mime_type:'application/pdf',extraction_status:'error',extraction_error:'추출된 본문이 비어 있습니다.',extracted_at:OLD},true],
 ['target jpg old meeting path',{file_name:'현수막.jpg',mime_type:'image/jpeg',extraction_status:'error',extraction_error:'현재 AI 본문 읽기를 지원하지 않는 파일 형식입니다.',extracted_at:null},true],
 ['target no extension image mime',{file_name:'카톡사진',mime_type:'image/png',extraction_status:'error',extraction_error:'unsupported',extracted_at:OLD},true],
 ['keep pdf with text',{file_name:'본문.pdf',mime_type:'application/pdf',extracted_text:'본문 글자',extraction_status:'error',extraction_error:'empty',extracted_at:OLD}],
 ['keep ready pdf',{file_name:'읽힘.pdf',mime_type:'application/pdf',extracted_text:'읽힌 글자',extraction_status:'ready',extraction_error:null,extracted_at:OLD}],
 ['keep jpg too large',{file_name:'큰사진.jpg',mime_type:'image/jpeg',extraction_status:'error',extraction_error:'too_large',extracted_at:OLD}],
 ['keep pdf read failed',{file_name:'깨짐.pdf',mime_type:'application/pdf',extraction_status:'error',extraction_error:'read_failed',extracted_at:OLD}],
 ['keep pdf gave up',{file_name:'끊김.pdf',mime_type:'application/pdf',extraction_status:'error',extraction_error:'gave_up',extracted_at:OLD}],
 ['keep jpg read after deploy',{file_name:'새사진.jpg',mime_type:'image/jpeg',extraction_status:'error',extraction_error:'empty',extracted_at:AFTER}],
 ['keep hwp unsupported',{file_name:'문서.hwp',mime_type:'application/x-hwp',extraction_status:'error',extraction_error:'unsupported',extracted_at:OLD}],
 ['keep gif unsupported',{file_name:'움짤.gif',mime_type:'image/gif',extraction_status:'error',extraction_error:'unsupported',extracted_at:OLD}],
 ['keep name says hwp mime says pdf',{file_name:'변환.hwp',mime_type:'application/pdf',extraction_status:'error',extraction_error:'unsupported',extracted_at:OLD}],
 ['keep jpg.zip',{file_name:'묶음.jpg.zip',mime_type:'application/zip',extraction_status:'error',extraction_error:'unsupported',extracted_at:OLD}],
 ['keep jpg no drive file',{file_id:null,file_name:'링크.jpg',mime_type:'image/jpeg',extraction_status:'error',extraction_error:'unsupported',extracted_at:OLD}],
 ['keep jpg pending nightly try',{file_name:'읽는중.jpg',mime_type:'image/jpeg',extraction_status:'pending',extraction_error:'nightly_try',extracted_at:OLD}],
 ['keep jpg never read',{file_name:'안읽음.jpg',mime_type:'image/jpeg',extraction_status:null,extraction_error:null,extracted_at:null}],
 ['keep other workspace jpg',{workspace_id:WS_B,file_name:'남의사진.jpg',mime_type:'image/jpeg',extraction_status:'error',extraction_error:'unsupported',extracted_at:OLD}],
];
const TARGETS=ROWS.filter(r=>r[2]).length;

test('library reread old scans: dry-run, apply only target rows, guards, SQL Editor rollback',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'library-reread-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(documents);
  const ids={};
  for(const [label,f] of ROWS){
   const row={workspace_id:WS_A,file_id:'drive_'+Object.keys(ids).length,extracted_text:null,...f};
   ids[label]=(await pool.query(`insert into public.app_documents(workspace_id,title,file_id,file_name,mime_type,extracted_text,extraction_status,extraction_error,extracted_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,[row.workspace_id,label,row.file_id,row.file_name,row.mime_type,row.extracted_text,row.extraction_status,row.extraction_error,row.extracted_at])).rows[0].id;
  }
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  const v=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  const all=async()=>Object.fromEntries((await pool.query('select title,to_jsonb(d) j from public.app_documents d')).rows.map(r=>[r.title,r.j]));
  const status=async label=>(await pool.query('select extraction_status s from public.app_documents where id=$1',[ids[label]])).rows[0].s;
  // The nightly text_backfill / library screen selection (text-backfill.mjs UNFINISHED + file_id), kptu-work only.
  const picked=async()=>(await pool.query(`select title from public.app_documents where workspace_id=$1 and file_id is not null
    and (extraction_status is null or extraction_status not in ('ready','error')) and not (coalesce(extraction_status,'')='pending' and coalesce(extraction_error,'')='nightly_try') order by title`,[WS_A])).rows.map(r=>r.title);
  const stops=async(sql,re)=>{const c=await pool.connect();try{await assert.rejects(c.query(sql),re);await c.query('rollback');}finally{c.release();}};
  const schema=async()=>(await pool.query(snapshot)).rows.filter(r=>r.kind!=='history');
  const original=await all(),beforeSnap=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;

  await t.test('files: read-only checks, three-line summary, approved workflow accepts apply/dry-run, rollback is SQL Editor only',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const p=plan(mode,'1');assert.equal(p.flow,'full');assert.deepEqual(p.targets,['app_documents']);assert.deepEqual(p.functions,[]);}
   assert.throws(()=>plan('rollback','1'),'workflow rollback refuses a data UPDATE');
   const lines=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(lines.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'').replace(/insert into supabase_migrations[\s\S]*$/,'');
   assert.doesNotMatch(code,/\bgrant\b|\brevoke\b|policy|row level security|create |alter table|drop |delete from public|rtw_/i);
   assert.equal((code.match(/\bupdate public\.app_documents d\s+set extraction_status = null\s+where /g)||[]).length,1,'one UPDATE, status only, with WHERE');
   assert.match(migration.trim(),/'20261024170000', 'library_reread_old_scans'[\s\S]*\);\ncommit;$/);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/delete from public|truncate|cascade|grant |revoke |policy|alter table|create /i);
   assert.doesNotMatch(snapshot.replace(/--.*$/gm,''),/from public\./i,'snapshot reads catalogs only');
  });
  await t.test('precheck: counts the target rows (photo/pdf split) and no marker rows',()=>{
   const p=v(beforeCheck);
   for(const k of ['new migration absent','workspace found','text columns as expected','RLS enabled'])assert.equal(p[k],'예',k);
   assert.equal(p['marker rows'],'0');assert.equal(p['reread rows'],String(TARGETS));
   assert.equal(p['reread rows photo'],'5');assert.equal(p['reread rows pdf'],'2');assert.equal(p['documents rows'],String(ROWS.length));
   for(const value of Object.values(p))assert.ok(value.length<=128);
  });
  await t.test('before apply the nightly selection skips the old photos and PDFs',async()=>{
   assert.deepEqual(await picked(),['keep jpg never read']);
  });
  await t.test('dry-run leaves rows, schema and history unchanged',async()=>{
   const dry=await runMigrationPlan(plan('dry-run','9801'),query,{saveSnapshot:async()=>{}});assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual(await all(),original);assert.deepEqual((await pool.query(snapshot)).rows,beforeSnap);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);assert.equal(await history(),0);
  });
  await t.test('guards stop the migration without any change',async()=>{
   await pool.query(`update public.app_workspaces set slug='x' where id='${WS_A}'`);
   try{await stops(migration,/LIBRARY_REREAD_OLD_SCANS_PREREQUISITE_CHANGED/);}finally{await pool.query(`update public.app_workspaces set slug='kptu-work' where id='${WS_A}'`);}
   await pool.query(`update public.app_documents set extraction_status=null where id=$1`,[ids['keep hwp unsupported']]);
   try{await stops(migration,/marker rows exist/);}finally{await pool.query(`update public.app_documents set extraction_status='error' where id=$1`,[ids['keep hwp unsupported']]);}
   await pool.query('alter table public.app_documents disable row level security');
   try{await stops(migration,/LIBRARY_REREAD_OLD_SCANS_PREREQUISITE_CHANGED/);}finally{await pool.query('alter table public.app_documents enable row level security');}
   assert.deepEqual(await all(),original);assert.equal(await history(),0);
  });
  await t.test('zero targets: nothing but the record changes',async()=>{
   const c=await pool.connect();
   try{await c.query('begin');await c.query(`update public.app_documents set extraction_error='read_failed' where title like 'target%'`);
    const before=(await c.query('select md5(string_agg(to_jsonb(d)::text,\',\' order by id)) h from public.app_documents d')).rows[0].h;
    await c.query(migration.replace(/^begin;/,'').replace(/commit;\s*$/,''));
    assert.equal((await c.query('select md5(string_agg(to_jsonb(d)::text,\',\' order by id)) h from public.app_documents d')).rows[0].h,before);
    assert.equal((await c.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,1);}
   finally{await c.query('rollback');c.release();}
   assert.deepEqual(await all(),original);
  });
  await t.test('apply: only target rows change, only their status; postcheck equals precheck; nightly now picks them',async()=>{
   const apply=await runMigrationPlan(plan('apply','9802'),query,{saveSnapshot:async()=>{}});assert.equal(apply.ok,true,apply.summary);
   assert.equal(await history(),1);
   const now=await all();
   for(const [label,,target] of ROWS){
    const {extraction_status:a,...restAfter}=now[label],{extraction_status:b,...restBefore}=original[label];
    assert.deepEqual(restAfter,restBefore,label+': other columns unchanged');
    assert.equal(a,target?null:b,label);
   }
   const post=v((await pool.query(postcheck)).rows),pre=v(beforeCheck);
   assert.ok(Object.values(post).filter(x=>/^(예|아니오)$/.test(x)).every(x=>x==='예'));
   for(const [k,x] of Object.entries(post))if(!/^(예|아니오)$/.test(x))assert.equal(x,pre[k],k);
   assert.deepEqual(await schema(),beforeSnap.filter(r=>r.kind!=='history'),'schema unchanged');
   assert.ok((await pool.query(snapshot)).rows.some(r=>r.kind==='history'&&r.name===version));
   assert.deepEqual(await picked(),[...ROWS.filter(r=>r[2]).map(r=>r[0]),'keep jpg never read'].sort());
   await stops(migration,/LIBRARY_REREAD_OLD_SCANS_PREREQUISITE_CHANGED/);
  });
  await t.test('rollback right away restores every row exactly and removes the record',async()=>{
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);assert.deepEqual(await all(),original);
   const after=v((await pool.query(postcheck)).rows);assert.equal(after['status and history agree'],'예');
   assert.deepEqual((await pool.query(snapshot)).rows,beforeSnap);
  });
  await t.test('after a re-read, rollback keeps the new text and returns only still-marked rows',async()=>{
   await pool.query(migration);assert.equal(await history(),1);
   // The nightly run read one scan PDF (now ready with text) and one photo again (new error after the deploy), and is reading a third.
   await pool.query(`update public.app_documents set extraction_status='ready',extracted_text='새로 읽은 글자',extraction_error=null,extracted_at=now() where id=$1`,[ids['target pdf empty']]);
   await pool.query(`update public.app_documents set extraction_status='error',extraction_error='empty',extracted_at=now() where id=$1`,[ids['target jpg unsupported']]);
   await pool.query(`update public.app_documents set extraction_status='pending',extraction_error='nightly_try',extracted_at=now() where id=$1`,[ids['target JPEG upper']]);
   await pool.query(rollbackSQL);assert.equal(await history(),0);
   assert.equal(await status('target pdf empty'),'ready');
   assert.equal((await pool.query('select extracted_text from public.app_documents where id=$1',[ids['target pdf empty']])).rows[0].extracted_text,'새로 읽은 글자');
   assert.equal(await status('target jpg unsupported'),'error');assert.equal(await status('target JPEG upper'),'pending');
   for(const label of ['target png empty text blank','target pdf old meeting path','target jpg old meeting path','target no extension image mime'])assert.equal(await status(label),'error',label);
   const now=await all();
   for(const [label,,target] of ROWS)if(!target)assert.deepEqual(now[label],original[label],label);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
