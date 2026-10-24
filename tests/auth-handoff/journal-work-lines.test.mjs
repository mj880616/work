// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic.
// JOURNAL-오늘한줄목록: 20261020051027_journal_work_lines through the approved DB workflow runner — the work-line CHECK
// takes 1~50 lines a day (each 1~300 characters), the one-row-a-day index, owner RLS and existing rows stay as they are.
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
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261020051027',name='journal_work_lines',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

test('journal work lines migration: dry-run, apply, per-line rules, owner RLS, existing rows kept, guarded rollback',{timeout:90000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'journal-lines-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  for(const file of ['20260927103344_task_impl2_notes_record_links.sql','20260928123601_task_meeting_followup_record_links.sql'])await pool.query(await read('supabase/migrations/'+file));
  await pool.query(`create table public.app_documents(id uuid primary key,workspace_id uuid);alter table public.app_spaces add column owner_id uuid default '${OWNER}',add column name text,add column parent_id uuid,add column status text default 'active',add column metadata jsonb default '{"project_system":"v2"}';grant select,update on public.app_spaces to authenticated;alter table public.app_spaces enable row level security;create policy synthetic_spaces_owner on public.app_spaces for all to authenticated using(private.app_is_workspace_owner(workspace_id)) with check(private.app_is_workspace_owner(workspace_id));`);
  for(const file of ['20261010120000_basket1_notes_links.sql','20261011180000_basket4a_confirm_links.sql','20261012100000_basket_link_view_db.sql','20261013034836_basket_photo_ocr_db.sql','20261017052234_journal_memo_notes_kind.sql'])await pool.query(await read('supabase/migrations/'+file));
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  // Existing rows of every kind, including one-line work days written before the list.
  await pool.query("insert into public.app_notes(workspace_id,raw_text) values($1,'바구니 원문')",[WS_A]);
  await pool.query("insert into public.app_notes(workspace_id,kind,title,raw_text) values($1,'note','노트','본문')",[WS_A]);
  await pool.query("insert into public.app_notes(workspace_id,kind,journal_day,raw_text,ai_export_allowed) values($1,'diary','2026-10-05','일기',false)",[WS_A]);
  await pool.query("insert into public.app_notes(workspace_id,kind,journal_day,raw_text) values($1,'work','2026-10-05','옛 한 줄'),($1,'work','2026-10-06',$2)",[WS_A,'가'.repeat(300)]);
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const rowsHash=async()=>(await pool.query("select md5(string_agg(to_jsonb(n)::text,E'\\n' order by n.id)) h from public.app_notes n")).rows[0].h;
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows,beforeRows=await rowsHash();
  const v=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const same=(a,b,keys)=>{for(const k of keys)assert.equal(v(a)[k],v(b)[k],k);};

  await t.test('before the change the database takes one line a day only',async()=>{
   await assert.rejects(pool.query("insert into public.app_notes(workspace_id,kind,journal_day,raw_text) values($1,'work','2026-10-07',$2)",[WS_A,'첫 줄\n둘째 줄']),{code:'23514'});
  });
  await t.test('precheck reports the expected pre-apply state',()=>{
   const p=v(beforeCheck);
   assert.deepEqual([p['prerequisite recorded'],p['new migration absent'],p['RLS enabled'],p['owner policy only'],p['anon or public table privilege'],p['triggers count'],p['one-per-day index kept'],p['work line CHECK validated'],p['work rows fit new rule'],p['work rows'],p['notes rows']],['예','예','예','예','아니오','0','예','예','예','2','5']);
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await runMigrationPlan(plan('dry-run','9301'),query);assert.equal(dry.ok,true,dry.summary);assert.equal(dry.verification,'complete',dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('apply passes postcheck; rows, columns, indexes, other constraints, grants and policies unchanged',async()=>{
   const apply=await runMigrationPlan(plan('apply','9302'),query);assert.equal(apply.ok,true,apply.summary);assert.doesNotMatch(apply.summary.split('사후 검사:')[1],/아니오/);
   assert.ok((await pool.query(postcheck)).rows.every(r=>r.ok==='예'));
   assert.equal(await rowsHash(),beforeRows);
   same((await pool.query(precheck)).rows,beforeCheck,['notes full-row hash','columns hash','other constraints hash','indexes hash','owner RLS grants hash','policies hash']);
   assert.notEqual(v((await pool.query(precheck)).rows)['constraints hash'],v(beforeCheck)['constraints hash']);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
   // The old one-line days are still one line each.
   assert.deepEqual((await pool.query("select journal_day::text d,raw_text from public.app_notes where kind='work' order by journal_day")).rows.map(r=>[r.d,[...r.raw_text].length]),[['2026-10-05',5],['2026-10-06',300]]);
  });
  await t.test('work days take 1~50 lines of 1~300 characters; other kinds keep their rules; still one row a day',async()=>{
   const ins=(day,raw_text,extra={})=>as('authenticated',OWNER,c=>c.query('insert into public.app_notes(workspace_id,kind,journal_day,raw_text,attachments) values($1,$2,$3,$4,$5::jsonb) returning id',[extra.ws||WS_A,extra.kind||'work',day,raw_text,JSON.stringify(extra.attachments||[])]));
   await ins('2026-10-07','첫 줄\n둘째 줄\n셋째 줄');
   await ins('2026-10-08',['가'.repeat(300),'나'.repeat(300)].join('\n'));
   await ins('2026-10-09',Array(50).fill('줄').join('\n'));
   await ins('2026-10-10','😀'.repeat(300));
   // Editing an old one-line day into a list works for the owner.
   await as('authenticated',OWNER,c=>c.query("update public.app_notes set raw_text=raw_text||E'\\n새 줄' where kind='work' and journal_day='2026-10-05'"));
   assert.equal((await pool.query("select raw_text from public.app_notes where kind='work' and journal_day='2026-10-05'")).rows[0].raw_text,'옛 한 줄\n새 줄');
   const bad=[['2026-10-11',''],['2026-10-11',' '],['2026-10-11','첫 줄\n'],['2026-10-11','\n첫 줄'],['2026-10-11','첫 줄\n\n셋째 줄'],['2026-10-11','첫 줄\n  \n셋째'],['2026-10-11','첫 줄\r\n둘째'],['2026-10-11','a\rb'],
    ['2026-10-11','가'.repeat(301)],['2026-10-11','짧은 줄\n'+'나'.repeat(301)],['2026-10-11',Array(51).fill('줄').join('\n')],['2026-10-11','😀'.repeat(301)],
    ['2026-10-07','같은 날 두 번째 행']];
   for(const [day,text] of bad)await assert.rejects(ins(day,text),e=>['23514','23505'].includes(e.code),JSON.stringify(text).slice(0,60));
   await assert.rejects(ins('2026-10-11','첨부',{attachments:[{drive_file_id:'a',file_name:'a.png',mime_type:'image/png',size_bytes:1}]}),{code:'23514'});
   // Diary and basket rules are unchanged.
   await assert.rejects(ins('2026-10-05','같은 날 일기',{kind:'diary'}),e=>['23514','23505'].includes(e.code));
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_notes(workspace_id,raw_text) values($1,'')",[WS_A])),{code:'23514'});
   // Owner RLS unchanged: a non-owner reads nothing and cannot write into the owner's workspace; anon has no access.
   assert.equal((await as('authenticated',STRANGER,c=>c.query('select count(*)::int n from public.app_notes'))).rows[0].n,0);
   await assert.rejects(as('authenticated',STRANGER,c=>c.query("insert into public.app_notes(workspace_id,kind,journal_day,raw_text) values($1,'work','2026-10-13','남의 줄')",[WS_A])),{code:'42501'});
   assert.equal((await as('authenticated',STRANGER,c=>c.query("update public.app_notes set raw_text='덮어쓰기' where kind='work'"))).rowCount,0);
   assert.equal((await as('authenticated',STRANGER,c=>c.query("delete from public.app_notes where kind='work'"))).rowCount,0);
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_notes limit 1')),{code:'42501'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_notes(workspace_id,kind,journal_day,raw_text) values($1,'work','2026-10-14','다른 공간')",[WS_B])),{code:'42501'});
  });
  await t.test('rollback refuses while a multi-line day exists and keeps every row',async()=>{
   const hash=await rowsHash();
   const result=await runMigrationPlan(plan('rollback','9303'),query);assert.equal(result.ok,false,result.summary);
   await assert.rejects(pool.query(rollbackSQL),/JOURNAL_WORK_LINES_ROLLBACK_BLOCKED/);await pool.query('rollback');
   assert.equal(await rowsHash(),hash);
  });
  await t.test('rollback restores the original schema once every day is one line again; re-apply works',async()=>{
   await pool.query("delete from public.app_notes where kind='work' and journal_day>'2026-10-06'");
   await pool.query("update public.app_notes set raw_text='옛 한 줄' where kind='work' and journal_day='2026-10-05'");
   const result=await runMigrationPlan(plan('rollback','9304'),query);assert.equal(result.ok,true,result.summary);assert.doesNotMatch(result.summary.split('사후 검사:')[1],/아니오/);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal(await rowsHash(),beforeRows);
   await pool.query(migration);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,1);
  });
  await t.test('apply refuses when anon has a table privilege or a work row breaks the new rule (no repair)',async()=>{
   await pool.query(rollbackSQL);
   await pool.query('grant select on public.app_notes to anon');
   try{await assert.rejects(pool.query(migration),/JOURNAL_WORK_LINES_PREREQUISITE_CHANGED/);await pool.query('rollback');}
   finally{await pool.query('revoke select on public.app_notes from anon');}
   // A one-line row the old rule accepts but the new one does not (padded past 300 raw characters) stops the change.
   await pool.query("insert into public.app_notes(workspace_id,kind,journal_day,raw_text) values($1,'work','2026-10-20',$2)",[WS_A,' '+'가'.repeat(300)]);
   await assert.rejects(pool.query(migration),/JOURNAL_WORK_LINES_PREREQUISITE_CHANGED/);await pool.query('rollback');
   assert.equal((await pool.query("select count(*)::int n from public.app_notes where kind='work' and journal_day='2026-10-20'")).rows[0].n,1);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
