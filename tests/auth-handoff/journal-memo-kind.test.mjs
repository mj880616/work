// Fresh local PostgreSQL only. No Supabase, Google or production credentials.
// MEMO-노트·JOURNAL-일지 0단계: app_notes kind/title/journal_day migration through the approved DB workflow runner.
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
const version='20261017052234',name='journal_memo_notes_kind',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

test('journal/memo kind migration: dry-run, apply, kind rules, owner RLS and guarded rollback',{timeout:90000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'journal-memo-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  for(const file of ['20260927103344_task_impl2_notes_record_links.sql','20260928123601_task_meeting_followup_record_links.sql'])await pool.query(await read('supabase/migrations/'+file));
  await pool.query(`create table public.app_documents(id uuid primary key,workspace_id uuid);alter table public.app_spaces add column owner_id uuid default '${OWNER}',add column name text,add column parent_id uuid,add column status text default 'active',add column metadata jsonb default '{"project_system":"v2"}';grant select,update on public.app_spaces to authenticated;alter table public.app_spaces enable row level security;create policy synthetic_spaces_owner on public.app_spaces for all to authenticated using(private.app_is_workspace_owner(workspace_id)) with check(private.app_is_workspace_owner(workspace_id));`);
  for(const file of ['20261010120000_basket1_notes_links.sql','20261011180000_basket4a_confirm_links.sql','20261012100000_basket_link_view_db.sql','20261013034836_basket_photo_ocr_db.sql'])await pool.query(await read('supabase/migrations/'+file));
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const basket=async(text='바구니 원문')=>(await pool.query('insert into public.app_notes(workspace_id,raw_text) values($1,$2) returning id',[WS_A,text])).rows[0].id;
  await basket();await basket('두 번째');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;

  await t.test('precheck reports the expected pre-apply state',()=>{
   const v=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));
   assert.deepEqual([v['prerequisite recorded'],v['new migration absent'],v['new columns count'],v['RLS enabled'],v['owner policy only'],v['anon or public table privilege'],v['triggers count'],v['notes rows']],['예','예','0','예','예','아니오','0','2']);
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await runMigrationPlan(plan('dry-run','9201'),query);assert.equal(dry.ok,true,dry.summary);assert.equal(dry.verification,'complete',dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('apply passes postcheck; existing rows become basket with no title/day',async()=>{
   const apply=await runMigrationPlan(plan('apply','9202'),query);assert.equal(apply.ok,true,apply.summary);assert.doesNotMatch(apply.summary.split('사후 검사:')[1],/아니오/);
   assert.deepEqual((await pool.query('select kind,title,journal_day from public.app_notes')).rows.map(r=>[r.kind,r.title,r.journal_day]),[['basket',null,null],['basket',null,null]]);
   assert.ok((await pool.query(postcheck)).rows.every(r=>r.ok==='예'));
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
  });
  await t.test('kind rules accept note/work/diary shapes and reject invalid ones',async()=>{
   const ins=(o)=>as('authenticated',OWNER,c=>c.query('insert into public.app_notes(workspace_id,raw_text,kind,title,journal_day,ai_export_allowed,attachments) values($1,$2,$3,$4,$5,$6,$7::jsonb) returning id',[WS_A,o.raw_text??'',o.kind,o.title??null,o.journal_day??null,o.ai??false,JSON.stringify(o.attachments??[])]));
   await ins({kind:'note',title:'노트 제목',raw_text:'가'.repeat(100000)});
   await ins({kind:'note',title:'빈 본문 노트'});
   await ins({kind:'work',journal_day:'2026-10-17',raw_text:'오늘 한 줄'});
   await ins({kind:'diary',journal_day:'2026-10-17',raw_text:'일기'});
   const bad=[{kind:'note'},{kind:'note',title:'  '},{kind:'note',title:'두\n줄'},{kind:'note',title:'가'.repeat(201)},{kind:'note',title:'길이',raw_text:'가'.repeat(100001)},
    {kind:'work',journal_day:'2026-10-17',raw_text:'같은 날 두 번째'},{kind:'work',journal_day:'2026-10-18',raw_text:'여러\n줄'},{kind:'work',journal_day:'2026-10-18',raw_text:''},
    {kind:'work',journal_day:'2026-10-18',raw_text:'첨부',attachments:[{drive_file_id:'a',file_name:'a.png',mime_type:'image/png',size_bytes:1}]},
    {kind:'diary',journal_day:'2026-10-18',raw_text:'AI 허용',ai:true},{kind:'diary',raw_text:'날짜 없음'},{kind:'basket',title:'제목 있는 바구니',raw_text:'x'},
    {kind:'basket',raw_text:''},{kind:'basket',journal_day:'2026-10-18',raw_text:'x'},{kind:'other',raw_text:'x'}];
   for(const o of bad)await assert.rejects(ins(o),e=>['23514','23505'].includes(e.code),JSON.stringify(o).slice(0,80));
   // Owner RLS unchanged: a non-owner cannot read or write any kind.
   assert.equal((await as('authenticated',STRANGER,c=>c.query('select count(*)::int n from public.app_notes'))).rows[0].n,0);
   await assert.rejects(as('authenticated',STRANGER,c=>c.query("insert into public.app_notes(workspace_id,raw_text,kind,title) values($1,'',$2,$3)",[WS_A,'note','남의 노트'])),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_notes limit 1')),{code:'42501'});
  });
  await t.test('rollback refuses while note/work/diary rows exist and keeps them',async()=>{
   const result=await runMigrationPlan(plan('rollback','9203'),query);assert.equal(result.ok,false,result.summary);
   await assert.rejects(pool.query(rollbackSQL),/JOURNAL_MEMO_ROLLBACK_BLOCKED/);await pool.query('rollback');
   assert.equal((await pool.query("select count(*)::int n from public.app_notes where kind<>'basket'")).rows[0].n,4);
  });
  await t.test('rollback restores the original schema snapshot once only basket rows remain; re-apply works',async()=>{
   await pool.query("delete from public.app_notes where kind<>'basket'");
   const result=await runMigrationPlan(plan('rollback','9204'),query);assert.equal(result.ok,true,result.summary);assert.doesNotMatch(result.summary.split('사후 검사:')[1],/아니오/);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
   await pool.query(migration);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,1);
  });
  await t.test('apply refuses when anon has a table privilege (no grant repair)',async()=>{
   await pool.query(rollbackSQL);await pool.query('grant select on public.app_notes to anon');
   try{await assert.rejects(pool.query(migration),/JOURNAL_MEMO_PREREQUISITE_CHANGED/);await pool.query('rollback');
    assert.equal((await pool.query("select count(*)::int n from pg_attribute where attrelid='public.app_notes'::regclass and attname='kind' and not attisdropped")).rows[0].n,0);
   }finally{await pool.query('revoke select on public.app_notes from anon');}
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
