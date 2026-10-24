// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic.
// SEARCH-전체검색 ② 첨부 파일 안 글자: 20261023013000_search_attachment_text redefines public.app_search_records
// (same signature, SECURITY INVOKER, authenticated only) so it also searches app_documents.extracted_text
// (extraction_status 'ready' only) and returns matched_in 'attachment' with a snippet from the file text.
// Checks: workflow plans (strict, full flow), prerequisite guard, dry-run, apply + postcheck, owner-only results,
// diary still excluded, only ready text is searched, earlier results unchanged, rollback (SQL Editor) restores the
// earlier function body exactly and keeps every row.
// Optional: SEARCH_PG_PORT=<port> runs the same checks on an already running local server (user postgres, trust auth).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {trackPool,closePool} from './pg-close.mjs';
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A} from './basket4-fixture.mjs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const PREV='20261022150000',PREV_NAME='search_records',FN='20261023013000',FN_NAME='search_attachment_text';
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const externalPort=process.env.SEARCH_PG_PORT;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Same synthetic stand-ins as search-records.test.mjs, plus the existing text columns on app_documents.
const extraSchema=`
  alter table public.app_spaces add column owner_id uuid default '${OWNER}', add column name text, add column parent_id uuid,
    add column status text default 'active', add column metadata jsonb default '{"project_system":"v2"}', add column updated_at timestamptz default now();
  alter table public.app_suborganizations add column aliases text[] default '{}', add column description text, add column updated_at timestamptz default now();
  alter table public.app_meetings add column series_name text, add column meeting_at timestamptz, add column transcript_text text, add column decisions text,
    add column created_at timestamptz not null default now(), add column project_id uuid;
  create table public.app_documents(id uuid primary key, workspace_id uuid not null references public.app_workspaces(id), title text, file_name text, source text,
    category text, tags text[], description text, document_date date, created_at timestamptz not null default now(), project_id uuid, organization_id uuid,
    visibility text default 'private', extracted_text text, extraction_status text, extraction_error text, extracted_at timestamptz);
  create table public.app_project_progress_updates(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid not null,
    workstream_id uuid, effective_on date, status_label text, summary text, next_step text);
  create table public.app_project_milestones(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid not null,
    title text, status text, start_at timestamptz);
  create table public.app_suborganization_updates(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, organization_id uuid not null,
    raw_text text, detail_text text, occurred_at timestamptz);
  create table public.app_suborganization_timeline(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, organization_id uuid not null,
    event_year integer, event_date date, title text, summary text);
  ${['app_spaces','app_meetings','app_documents','app_project_progress_updates','app_project_milestones','app_suborganization_updates','app_suborganization_timeline'].map(t=>`
  grant select on public.${t} to authenticated;
  alter table public.${t} enable row level security;
  create policy synthetic_owner on public.${t} for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));`).join('')}
  grant select on public.app_suborganizations to authenticated;
  alter table public.app_meetings enable row level security;
`;

test('SEARCH ②: file text search migration — plans, guard, dry-run, apply, owner-only attachment hits, diary excluded, rollback',{timeout:180000},async t=>{
 let cluster,pool,adminPool,database='postgres',port,password='';
 if(externalPort){
  port=Number(externalPort);database='search2_'+randomBytes(4).toString('hex');
  adminPool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres',ssl:false}));
  await adminPool.query('create database '+database);
  for(const role of ['anon','authenticated','public_probe','service_role'])await adminPool.query(`drop role if exists ${role}`).catch(()=>{});
 }else{
  const directory=await mkdtemp(join(tmpdir(),'search2-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));port=sock.address().port;await new Promise(r=>sock.close(r));
  password=randomBytes(24).toString('hex');
  cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
  await cluster.initialise();await cluster.start();
 }
 try{
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database,ssl:false}));
  await pool.query(fixture);
  await pool.query(extraSchema);
  for(const file of ['20260927103344_task_impl2_notes_record_links.sql','20260928123601_task_meeting_followup_record_links.sql','20261010120000_basket1_notes_links.sql',
    '20261011180000_basket4a_confirm_links.sql','20261012100000_basket_link_view_db.sql','20261013034836_basket_photo_ocr_db.sql','20261017052234_journal_memo_notes_kind.sql',
    '20261020051027_journal_work_lines.sql',PREV+'_'+PREV_NAME+'.sql'])await pool.query(await read('supabase/migrations/'+file));
  const stem=FN+'_'+FN_NAME;
  const F={migration:await read('supabase/migrations/'+stem+'.sql'),rollback:await read('docs/'+stem+'.rollback.sql'),precheck:await read('docs/'+stem+'.precheck.sql'),
    postcheck:await read('docs/'+stem+'.postcheck.sql'),snapshot:await read('docs/'+stem+'.snapshot.sql'),summary:await read('docs/'+stem+'.summary.md')};
  const prev=await read('supabase/migrations/'+PREV+'_'+PREV_NAME+'.sql');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version:FN,runId:run,root});
  const run=p=>runMigrationPlan(p,query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const search=(args,sub=OWNER,role='authenticated')=>as(role,sub,async c=>(await c.query('select public.app_search_records($1,$2,$3,$4,$5) r',[args.q,args.kinds??null,args.per??null,args.offset??null,args.kind??null])).rows[0].r);
  const docs=r=>r.groups.find(g=>g.kind==='document');
  const history=async v=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[v])).rows[0].n;
  const fnSource=async()=>(await pool.query("select prosrc from pg_proc where proname='app_search_records' and pronamespace='public'::regnamespace")).rows.map(r=>r.prosrc);
  const prevSource=prev.slice(prev.indexOf('as $$\n')+5,prev.indexOf('$$;\nrevoke'));

  // Synthetic documents. Only "ready" file text is searched; text of another workspace never shows.
  const doc=async(ws,title,extra={})=>{const id=randomUUID();await pool.query(`insert into public.app_documents(id,workspace_id,title,file_name,tags,document_date,project_id,extracted_text,extraction_status)
    values($1,$2,$3,$4,'{}',$5,$6,$7,$8)`,[id,ws,title,extra.file??'a.pdf',extra.date??'2026-09-01',extra.project??null,extra.text??null,extra.status??null]);return id;};
  const ready=await doc(WS_A,'합성 보고서',{text:'첫 문단은 일반 내용이다. '+'가'.repeat(50)+'궤도 단체협약 잠정 합의 조항'+'나'.repeat(50),status:'ready',date:'2026-09-10',project:PROJECT_A});
  const both=await doc(WS_A,'궤도 표지 자료',{text:'본문에도 궤도라는 말',status:'ready',date:'2026-09-09'});
  const notReady=await doc(WS_A,'읽는 중 자료',{text:'궤도 단체협약 아직 읽는 중',status:'pending',date:'2026-09-08'});
  const failed=await doc(WS_A,'실패 자료',{text:'궤도 단체협약 실패한 글자',status:'error',date:'2026-09-07'});
  const stranger=await doc(WS_B,'남의 자료',{text:'궤도 단체협약 남의 비밀 글자',status:'ready',date:'2026-09-11'});
  await pool.query(`insert into public.app_notes(workspace_id,kind,raw_text,journal_day,ai_export_allowed) values($1,'diary','일기 단체협약 비밀','2026-10-02',false)`,[WS_A]);
  const before=(await pool.query(F.snapshot)).rows;
  const beforeSearch=await search({q:'궤도'});

  await t.test('files: 5 pair files, summary 3 lines, invoker only, no definer/anon/index/extension; strict workflow full flow for apply and dry-run; rollback is SQL Editor only',()=>{
   const lines=F.summary.trim().split('\n');assert.equal(lines.length,3);
   ['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   for(const sql of [F.migration,F.rollback]){
    const code=sql.replace(/--.*$/gm,'');
    assert.doesNotMatch(code,/security definer|\bto (anon|public|service_role)\b|disable row level|rtw_|create extension|create policy|alter table|create index|update public|delete from public/i);
    assert.match(code,/^begin;/);assert.match(code,/commit;\s*$/);
    assert.match(code,/security invoker\s+set search_path = ''/);
    assert.match(code,/revoke all on function public\.app_search_records\(text, text\[\], integer, integer, text\) from public, anon, service_role;/);
    assert.match(code,/grant execute on function public\.app_search_records\(text, text\[\], integer, integer, text\) to authenticated;/);
   }
   for(const mode of ['apply','dry-run']){const p=plan(mode,'1');assert.equal(p.rules,'strict');assert.equal(p.flow,'full');assert.deepEqual(p.targets,[]);
    assert.deepEqual(p.functions,['public.app_search_records(text,text[],integer,integer,text)']);}
   // Re-creating a function is outside the rollback-mode grammar (the same as other function-restoring rollbacks).
   assert.throws(()=>plan('rollback','1'));
   // The rollback restores the earlier body byte for byte.
   assert.ok(F.rollback.includes(prevSource));
  });

  await t.test('precheck before apply: all 예 (counts recorded)',async()=>{
   const rows=(await pool.query(F.precheck)).rows;
   for(const row of rows)if(!['documents rows','documents text ready','documents text not read yet','documents text error','search function source hash','recent migrations'].includes(row.item))assert.equal(row.value,'예',row.item);
   assert.equal(rows.find(r=>r.item==='documents text ready').value,'3');
  });

  await t.test('before apply the file text is not searched',async()=>{
   assert.equal(docs(await search({q:'단체협약'})).total,0);
  });

  await t.test('prerequisite guard stops when the earlier function changed or the text column is missing (no repair)',async()=>{
   for(const change of [
    `alter table public.app_documents rename column extracted_text to extracted_x`,
    `alter table public.app_documents alter column extraction_status type varchar`,
    `create or replace function public.app_search_records(p_query text, p_kinds text[], p_per_kind integer, p_offset integer, p_kind text) returns jsonb language sql stable security invoker set search_path = '' as $$ select '{}'::jsonb $$`,
    `delete from supabase_migrations.schema_migrations where version='${PREV}'`,
   ]){
    const c=await pool.connect();
    try{await c.query('begin');await c.query(change);
     await assert.rejects(c.query(F.migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/SEARCH_ATTACHMENT_TEXT_PREREQUISITE_CHANGED/,change);}
    finally{await c.query('rollback');c.release();}
   }
   assert.equal(await history(FN),0);
  });

  await t.test('dry-run leaves nothing; apply passes postcheck; second apply refused',async()=>{
   const dry=await run(plan('dry-run','9701'));assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(F.snapshot)).rows,before);
   const apply=await run(plan('apply','9702'));assert.equal(apply.ok,true,apply.summary);
   for(const r of (await pool.query(F.postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal(await history(FN),1);
   const again=await run(plan('apply','9703'));assert.equal(again.ok,false);
   assert.equal(await history(FN),1);
  });

  await t.test('owner finds ready file text as matched_in attachment with a snippet from the file text',async()=>{
   const r=await search({q:'단체협약'});
   const g=docs(r);
   assert.equal(g.total,1);
   const it=g.items[0];
   assert.deepEqual([it.id,it.source,it.matched_in,it.title,it.project_id],[ready,'document','attachment','합성 보고서',PROJECT_A]);
   // About 40 characters on each side of the first hit, taken from the file text.
   assert.equal(it.snippet,'가'.repeat(37)+'궤도 단체협약 잠정 합의 조항'+'나'.repeat(31));
   // AND across words: one word in the title, one only in the file text.
   assert.equal(docs(await search({q:'합성 잠정'})).items[0].matched_in,'attachment');
   // A document whose title matches keeps matched_in title even when the file text also matches.
   const t2=docs(await search({q:'표지'})).items[0];
   assert.deepEqual([t2.id,t2.matched_in,t2.snippet],[both,'title',null]);
   // Pending / error text is not searched; another workspace's text never shows; diary still excluded.
   assert.doesNotMatch(JSON.stringify(r),new RegExp([notReady,failed,stranger].join('|')));
   assert.doesNotMatch(JSON.stringify(r),/남의|비밀|일기/);
   assert.equal(r.groups.filter(x=>x.kind!=='document').every(x=>x.total===0),true);
   const s=await search({q:'단체협약'},STRANGER);
   assert.deepEqual([docs(s).total,docs(s).items[0].id,docs(s).items[0].matched_in],[1,stranger,'attachment']);
   await assert.rejects(search({q:'단체협약'},'','anon'),{code:'42501'});
   await assert.rejects(as('service_role','',c=>c.query("select public.app_search_records('단체협약',null,null,null,null)")),{code:'42501'});
  });

  await t.test('earlier results are unchanged for records without file text; input rules unchanged',async()=>{
   const after=await search({q:'궤도'});
   const strip=r=>JSON.stringify({...r,groups:r.groups.map(g=>g.kind==='document'?{...g,total:null,items:null}:g)});
   assert.equal(strip(after),strip(beforeSearch));
   // The ready document whose file text says 궤도 is now found as well, newest first. As with photo text (S-1 rule),
   // a document whose title also matches gets the file text snippet: matched_in 'title' means "found only outside the text".
   assert.deepEqual(docs(after).items.map(i=>[i.id,i.matched_in]),[[ready,'attachment'],[both,'attachment']]);
   for(const q of ['','궤'])await assert.rejects(search({q}),{code:'22023',message:'SEARCH_QUERY_TOO_SHORT'});
   await assert.rejects(search({q:'궤도',kinds:['diary']}),{code:'22023',message:'SEARCH_BAD_KIND'});
   // Wildcards stay literal inside file text too.
   assert.equal(docs(await search({q:'%%'})).total,0);
  });

  await t.test('rollback (SQL Editor) restores the earlier function body exactly and keeps every row',async()=>{
   const rows=(await pool.query('select md5(string_agg(to_jsonb(d)::text,E\'\\n\' order by d.id)) h from public.app_documents d')).rows[0].h;
   await pool.query(F.rollback);
   assert.equal(await history(FN),0);
   assert.deepEqual(await fnSource(),[prevSource]);
   assert.deepEqual((await pool.query(F.snapshot)).rows,before);
   assert.equal((await pool.query('select md5(string_agg(to_jsonb(d)::text,E\'\\n\' order by d.id)) h from public.app_documents d')).rows[0].h,rows);
   for(const r of (await pool.query(F.postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal(docs(await search({q:'단체협약'})).total,0);
   await assert.rejects(pool.query(F.rollback),/SEARCH_ATTACHMENT_TEXT_ROLLBACK_BLOCKED/);await pool.query('rollback');
   await pool.query(F.migration);
   assert.equal(await history(FN),1);
   assert.equal(docs(await search({q:'단체협약'})).total,1);
  });
 }finally{
  await closePool(pool);
  if(adminPool){await adminPool.query('drop database if exists '+database+' with (force)').catch(()=>{});await closePool(adminPool);}
  if(cluster)await cluster.stop().catch(()=>{});
 }
});
