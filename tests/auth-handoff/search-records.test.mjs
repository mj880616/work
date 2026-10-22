// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic.
// SEARCH-전체검색 S-1: 20261022150000_search_records (public.app_search_records, SECURITY INVOKER) through the
// approved DB workflow runner. Also records why a pg_trgm index is not added: under owner RLS the planner cannot use it.
// Checks: owner-only results (another owner and anon get nothing), diary never returned with any argument,
// input rules (2-character words, 6 words, 200 characters, control characters, \ % _ literal), kind counts,
// most-recent-first order, p_offset paging, held update / finished project state, photo text, linked names,
// guarded rollback back to the snapshot.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,PROJECT_A2,PROJECT_B,ORG_A,ORG_B,MEETING_A,MEETING_B} from './basket4-fixture.mjs';
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const FN='20261022150000',FN_NAME='search_records';
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const externalPort=process.env.SEARCH_PG_PORT;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Synthetic stand-ins for tables whose definitions live in the production baseline (columns the search reads only).
const extraSchema=`
  alter table public.app_spaces add column owner_id uuid default '${OWNER}', add column name text, add column parent_id uuid,
    add column status text default 'active', add column metadata jsonb default '{"project_system":"v2"}', add column updated_at timestamptz default now();
  alter table public.app_suborganizations add column aliases text[] default '{}', add column description text, add column updated_at timestamptz default now();
  alter table public.app_meetings add column series_name text, add column meeting_at timestamptz, add column transcript_text text, add column decisions text,
    add column created_at timestamptz not null default now(), add column project_id uuid;
  create table public.app_documents(id uuid primary key, workspace_id uuid not null references public.app_workspaces(id), title text, file_name text, source text,
    category text, tags text[], description text, document_date date, created_at timestamptz not null default now(), project_id uuid, organization_id uuid, visibility text default 'private');
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
  grant update on public.app_spaces to authenticated;
  alter table public.app_meetings enable row level security;
`;

test('S-1 search: workflow plans, apply, owner-only results, diary excluded, input rules, paging, no trigram index, rollback',{timeout:180000},async t=>{
 let cluster,pool,adminPool,database='postgres',port,password='';
 if(externalPort){
  port=Number(externalPort);database='search_'+randomBytes(4).toString('hex');
  adminPool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres',ssl:false});
  await adminPool.query('create database '+database);
  for(const role of ['anon','authenticated','public_probe','service_role'])await adminPool.query(`drop role if exists ${role}`).catch(()=>{});
 }else{
  const directory=await mkdtemp(join(tmpdir(),'search-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));port=sock.address().port;await new Promise(r=>sock.close(r));
  password=randomBytes(24).toString('hex');
  cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
  await cluster.initialise();await cluster.start();
 }
 try{
  pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database,ssl:false});
  await pool.query(fixture);
  await pool.query(extraSchema);
  for(const file of ['20260927103344_task_impl2_notes_record_links.sql','20260928123601_task_meeting_followup_record_links.sql','20261010120000_basket1_notes_links.sql',
    '20261011180000_basket4a_confirm_links.sql','20261012100000_basket_link_view_db.sql','20261013034836_basket_photo_ocr_db.sql','20261017052234_journal_memo_notes_kind.sql',
    '20261020051027_journal_work_lines.sql'])await pool.query(await read('supabase/migrations/'+file));
  const files=async stem=>({migration:await read('supabase/migrations/'+stem+'.sql'),rollback:await read('docs/'+stem+'.rollback.sql'),
    precheck:await read('docs/'+stem+'.precheck.sql'),postcheck:await read('docs/'+stem+'.postcheck.sql'),snapshot:await read('docs/'+stem+'.snapshot.sql'),
    summary:await read('docs/'+stem+'.summary.md')});
  const F=await files(FN+'_'+FN_NAME);
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const plan=(mode,version,run)=>prepareMigration({mode,version,runId:run,root});
  const saved=new Map(),saveSnapshot=async(file,body)=>{saved.set(file,body);};
  const run=(p)=>runMigrationPlan(p,query,{saveSnapshot});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const search=(args,sub=OWNER,role='authenticated')=>as(role,sub,async c=>(await c.query('select public.app_search_records($1,$2,$3,$4,$5) r',[args.q,args.kinds??null,args.per??null,args.offset??null,args.kind??null])).rows[0].r);
  const group=(r,kind)=>r.groups.find(g=>g.kind===kind);
  const history=async v=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[v])).rows[0].n;

  // Synthetic owner data (workspace A) and a stranger's data (workspace B) that share the search words.
  const note=async(ws,kind,raw,extra={})=>(await pool.query(`insert into public.app_notes(workspace_id,kind,title,raw_text,journal_day,occurred_at,archived_at,attachments,ai_export_allowed)
    values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) returning id`,[ws,kind,extra.title??null,raw,extra.day??null,extra.at??'2026-10-01T00:00:00Z',extra.archived??null,JSON.stringify(extra.attachments??[]),kind!=='diary'])).rows[0].id;
  await pool.query(`update public.app_spaces set name='궤도협의회 교섭' , status='active' where id='${PROJECT_A}';update public.app_spaces set name='끝난 궤도 사업', status='done', updated_at='2026-01-01' where id='${PROJECT_A2}';
    update public.app_spaces set name='남의 궤도 사업' where id='${PROJECT_B}';update public.app_suborganizations set name='가나지부' where id='${ORG_A}';update public.app_suborganizations set name='남의 지부' where id='${ORG_B}'`);
  const upd1=await note(WS_A,'basket','첫 업데이트: 궤도협의회 임금 교섭 일정 확인',{at:'2026-10-03T00:00:00Z'});
  const upd2=await note(WS_A,'basket','보류한 궤도 메모',{at:'2026-10-05T00:00:00Z',archived:'2026-10-06T00:00:00Z'});
  const upd3=await note(WS_A,'basket','사진만 붙인 메모',{at:'2026-10-04T00:00:00Z',attachments:[{drive_file_id:'f1',file_name:'p.jpg',mime_type:'image/jpeg',size_bytes:1,
    ocr:{state:'done',text:'사진 속 단체협약 문구',attempt_id:randomUUID(),original_file_id:'f1',cleanup_state:'deleted',temp_document_id:'tmp-1'}}]});
  const noteA=await note(WS_A,'note','본문에 100%_특수\\문자 와 궤도',{title:'궤도 노트 제목',at:'2026-09-01T00:00:00Z'});
  const work=await note(WS_A,'work','궤도 회의 준비',{day:'2026-10-02'});
  const diary=await note(WS_A,'diary','궤도 일기 비밀 단체협약 100%_특수\\문자',{day:'2026-10-02'});
  await note(WS_B,'basket','남의 궤도 업데이트 단체협약',{at:'2026-10-07T00:00:00Z'});
  await note(WS_B,'diary','남의 궤도 일기',{day:'2026-10-02'});
  await pool.query(`insert into public.app_record_links(workspace_id,note_id,project_id,status) values($1,$2,$3,'confirmed'),($1,$4,$3,'suggested')`,[WS_A,upd1,PROJECT_A,upd2]);
  await pool.query(`insert into public.app_record_links(workspace_id,note_id,organization_id,status) values($1,$2,$3,'confirmed')`,[WS_A,upd1,ORG_A]);
  const docA=randomUUID();
  await pool.query(`insert into public.app_documents(id,workspace_id,title,file_name,tags,description,document_date,project_id,organization_id) values
    ($1,$2,'궤도 자료','a.hwpx','{교섭}','설명 단체협약','2026-08-01',$3,$4),(gen_random_uuid(),$5,'남의 궤도 자료','b.hwpx','{}',null,'2026-10-09',null,null)`,[docA,WS_A,PROJECT_A,ORG_A,WS_B]);
  await pool.query(`update public.app_meetings set title='궤도 정기회의', meeting_at='2026-09-10', transcript_text='결과: 궤도 단체협약 잠정 합의', project_id=$2 where id=$1;
    update public.app_meetings set title='남의 궤도 회의', transcript_text='단체협약' where id=$3`.replaceAll('$2',`'${PROJECT_A}'`).replaceAll('$1',`'${MEETING_A}'`).replaceAll('$3',`'${MEETING_B}'`));
  await pool.query(`insert into public.app_project_progress_updates(workspace_id,project_id,effective_on,summary) values($1,$2,'2026-09-20','궤도 진행 요약')`,[WS_A,PROJECT_A]);
  await pool.query(`insert into public.app_project_milestones(workspace_id,project_id,title,status,start_at) values($1,$2,'궤도 집회','done','2026-09-15'),($3,$4,'남의 궤도 집회',null,'2026-09-15')`,[WS_A,PROJECT_A,WS_B,PROJECT_B]);
  await pool.query(`insert into public.app_suborganization_updates(workspace_id,organization_id,raw_text,occurred_at) values($1,$2,'지부 궤도 소식','2026-09-25')`,[WS_A,ORG_A]);
  await pool.query(`insert into public.app_suborganization_timeline(workspace_id,organization_id,event_year,title,summary) values($1,$2,2024,'궤도 연혁',null)`,[WS_A,ORG_A]);

  const before={fn:(await pool.query(F.snapshot)).rows};

  await t.test('files: 5 pair files each, summary 3 lines, invoker only, no definer/anon/rtw/extension command; workflow plans pass',()=>{
   for(const f of [F]){
    for(const sql of [f.precheck,f.postcheck,f.snapshot])assert.equal(checkSQL(sql).baselineNull,false);
    const lines=f.summary.trim().split('\n');assert.equal(lines.length,3);
    ['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
    const code=f.migration.replace(/--.*$/gm,'');
    assert.doesNotMatch(code,/security definer|\bto (anon|public|service_role)\b|disable row level|rtw_|create extension|create policy|alter table/i);
    assert.match(code,/^begin;/);assert.match(code,/commit;\s*$/);
   }
   assert.match(F.migration,/security invoker\s+set search_path = ''/);
   assert.match(F.migration,/revoke all on function public\.app_search_records\(text, text\[\], integer, integer, text\) from public, anon, service_role;/);
   for(const v of [FN])for(const mode of ['apply','dry-run','rollback']){
    const p=plan(mode,v,'1');assert.equal(p.rules,'strict');assert.deepEqual(p.targets,[]);
    if(mode!=='rollback')assert.equal(p.flow,'full');
   }
  });

  await t.test('precheck before apply: all 예; snapshot shows the function absent',async()=>{
   for(const row of (await pool.query(F.precheck)).rows)if(!['notes rows','documents rows','meetings rows','recent migrations','search tables policies hash'].includes(row.item))assert.equal(row.value,'예',row.item);
   assert.equal(before.fn.find(r=>r.kind==='search function').definition,'absent');
  });

  await t.test('prerequisite guard stops when a searched column is missing (no repair)',async()=>{
   const c=await pool.connect();
   try{await c.query('begin');await c.query('alter table public.app_meetings rename column transcript_text to transcript_x');
    await assert.rejects(c.query(F.migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/SEARCH_RECORDS_PREREQUISITE_CHANGED/);}
   finally{await c.query('rollback');c.release();}
   const c2=await pool.connect();
   try{await c2.query('begin');await c2.query('alter table public.app_meetings alter column meeting_at type text');
    await assert.rejects(c2.query(F.migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/SEARCH_RECORDS_PREREQUISITE_CHANGED/);}
   finally{await c2.query('rollback');c2.release();}
   assert.equal(await history(FN),0);
  });

  await t.test('dry-run leaves nothing; apply passes postcheck; second apply refused',async()=>{
   const dry=await run(plan('dry-run',FN,'9401'));assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(F.snapshot)).rows,before.fn);
   const apply=await run(plan('apply',FN,'9402'));assert.equal(apply.ok,true,apply.summary);
   for(const r of (await pool.query(F.postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal(await history(FN),1);
   const again=await run(plan('apply',FN,'9403'));assert.equal(again.ok,false);
   assert.equal(await history(FN),1);
  });

  await t.test('owner finds every kind with counts, most recent first; stranger and anon get nothing of the owner',async()=>{
   const r=await search({q:'궤도'});
   assert.deepEqual(r.words,['궤도']);
   assert.deepEqual(r.groups.map(g=>g.kind),['update','note','work','document','meeting','project','organization','milestone']);
   assert.deepEqual(r.groups.map(g=>g.total),[2,1,1,1,1,3,2,1]);
   // Most recent first; held update carries state "held".
   assert.deepEqual(group(r,'update').items.map(i=>[i.id,i.state]),[[upd2,'held'],[upd1,null]]);
   assert.equal(group(r,'work').items[0].id,work);assert.equal(group(r,'work').items[0].day,'2026-10-02');
   // Finished project shows state "done"; project progress is a project row with source "progress".
   const proj=group(r,'project').items;
   assert.deepEqual(proj.map(i=>[i.source,i.title,i.state]),[['project','궤도협의회 교섭',null],['progress','궤도협의회 교섭',null],['project','끝난 궤도 사업','done']]);
   assert.deepEqual(group(r,'organization').items.map(i=>i.source),['org_update','org_timeline']);
   assert.equal(group(await search({q:'가나지부'}),'organization').items[0].source,'organization');
   assert.equal(group(r,'milestone').items[0].state,'done');
   // Linked names: confirmed note links only; documents carry their own project/organization.
   const u1=group(r,'update').items.find(i=>i.id===upd1);
   assert.deepEqual([u1.project_name,u1.organization_name],['궤도협의회 교섭','가나지부']);
   assert.equal(group(r,'update').items.find(i=>i.id===upd2).project_id,null); // suggested link is not shown
   assert.deepEqual([group(r,'document').items[0].project_name,group(r,'document').items[0].organization_name],['궤도협의회 교섭','가나지부']);
   // No row of workspace B anywhere.
   assert.doesNotMatch(JSON.stringify(r),/남의/);
   const s=await search({q:'궤도'},STRANGER);
   assert.deepEqual(s.groups.map(g=>g.total),[1,0,0,1,1,1,0,1]);
   assert.doesNotMatch(JSON.stringify(s),/교섭|가나지부|첫 업데이트/);
   await assert.rejects(search({q:'궤도'},'', 'anon'),{code:'42501'});
   await assert.rejects(as('service_role','',c=>c.query("select public.app_search_records('궤도',null,null,null,null)")),{code:'42501'});
  });

  await t.test('diary is never returned with any argument; diary is not an accepted kind',async()=>{
   for(const args of [{q:'일기 비밀'},{q:'궤도',per:50},{q:'궤도',kinds:['note','work','update']},{q:'궤도',kind:'note'},{q:'궤도',kind:'work'},{q:'100%_특수\\문자'},{q:'단체협약'}]){
    const r=await search(args);
    assert.doesNotMatch(JSON.stringify(r),new RegExp(diary));assert.doesNotMatch(JSON.stringify(r.groups),/일기/);
   }
   assert.equal((await search({q:'일기 비밀'})).groups.every(g=>g.total===0),true);
   for(const args of [{q:'궤도',kinds:['diary']},{q:'궤도',kinds:['note','diary']},{q:'궤도',kind:'diary'},{q:'궤도',kinds:['basket']}])
    await assert.rejects(search(args),{code:'22023',message:'SEARCH_BAD_KIND'});
  });

  await t.test('input rules: 2 characters per word, at most 6 words, 200 characters, no control characters; \\ % _ literal',async()=>{
   for(const q of ['','  ','궤','궤도 a','a'])await assert.rejects(search({q}),{code:'22023',message:'SEARCH_QUERY_TOO_SHORT'});
   await assert.rejects(search({q:'가나 다라 마바 사아 자차 카타 파하'}),{code:'22023',message:'SEARCH_TOO_MANY_WORDS'});
   await assert.rejects(search({q:'가'.repeat(201)}),{code:'22023',message:'SEARCH_BAD_QUERY'});
   await assert.rejects(search({q:'궤도\n교섭'}),{code:'22023',message:'SEARCH_BAD_QUERY'});
   await assert.rejects(search({q:'궤도\t교섭'}),{code:'22023',message:'SEARCH_BAD_QUERY'});
   // Same word twice counts once; 6 distinct words are fine.
   assert.deepEqual((await search({q:'궤도  궤도'})).words,['궤도']);
   assert.equal((await search({q:'궤도 교섭 임금 일정 확인 업데이트'})).groups[0].total,1);
   // Literal wildcard characters: "%_" does not match everything; the backslash is a character.
   assert.equal(group(await search({q:'100%_특수\\문자'}),'note').total,1);
   assert.equal(group(await search({q:'1%0'}),'note').total,0);
   assert.equal(group(await search({q:'__'}),'note').total,0);
   assert.equal(group(await search({q:'%%'}),'note').total,0);
   assert.equal(group(await search({q:'\\\\'}),'note').total,0);
   // AND across words; case-insensitive for Latin letters.
   await pool.query(`insert into public.app_notes(workspace_id,kind,title,raw_text) values($1,'note','KTX 메모','ktx Rail')`,[WS_A]);
   assert.equal(group(await search({q:'ktx RAIL'}),'note').total,1);
   assert.equal(group(await search({q:'ktx 궤도'}),'note').total,0);
   // Paging arguments.
   for(const args of [{q:'궤도',per:0},{q:'궤도',per:51},{q:'궤도',offset:3},{q:'궤도',kind:'note',offset:-1},{q:'궤도',kind:'note',offset:200}])
    await assert.rejects(search(args),{code:'22023',message:'SEARCH_BAD_PAGE'});
   await assert.rejects(search({q:'궤도',kind:'note',kinds:['note']}),{code:'22023',message:'SEARCH_BAD_KIND'});
   await assert.rejects(search({q:'궤도',kinds:[]}),{code:'22023',message:'SEARCH_BAD_KIND'});
  });

  await t.test('snippet: about 40 characters around the first hit in the body; title hit has no snippet; photo text is matched_in attachment',async()=>{
   const long='앞'.repeat(60)+'단체협약'+'뒤'.repeat(60);
   const id=await note(WS_A,'basket',long,{at:'2026-10-20T00:00:00Z'});
   const it=group(await search({q:'단체협약',kind:'update',per:5}),'update').items.find(i=>i.id===id);
   assert.equal(it.matched_in,'body');assert.equal(it.snippet,'앞'.repeat(40)+'단체협약'+'뒤'.repeat(40));
   const photo=group(await search({q:'단체협약',kind:'update',per:5}),'update').items.find(i=>i.id===upd3);
   assert.equal(photo.matched_in,'attachment');assert.equal(photo.snippet,'사진 속 단체협약 문구');
   const titleOnly=group(await search({q:'제목'}),'note').items[0];
   assert.deepEqual([titleOnly.id,titleOnly.matched_in,titleOnly.snippet],[noteA,'title',null]);
   // OCR text that is not done (reading/failed) is not searched.
   await pool.query(`insert into public.app_notes(workspace_id,raw_text,attachments) values($1,'읽는 중',$2::jsonb)`,[WS_A,JSON.stringify([{drive_file_id:'f2',file_name:'q.png',mime_type:'image/png',size_bytes:1,ocr:{state:'failed',text:'',attempt_id:randomUUID(),original_file_id:'f2',cleanup_state:'deleted',temp_document_id:'tmp-2'}}])]);
   assert.equal(group(await search({q:'읽는'}),'update').items[0].matched_in,'body');
  });

  await t.test('paging: one kind from p_offset, total capped at 200 with capped flag',async()=>{
   await pool.query(`insert into public.app_notes(workspace_id,kind,raw_text,occurred_at) select $1,'basket','페이지 시험 '||g,'2026-01-01'::timestamptz+make_interval(days=>g) from generate_series(1,205) g`,[WS_A]);
   const first=await search({q:'페이지 시험'});
   assert.deepEqual([group(first,'update').total,group(first,'update').capped,group(first,'update').items.length],[200,true,3]);
   assert.deepEqual(group(first,'update').items.map(i=>i.title),['페이지 시험 205','페이지 시험 204','페이지 시험 203']);
   const more=await search({q:'페이지 시험',kind:'update',per:50,offset:3});
   assert.equal(more.groups.length,1);assert.equal(more.groups[0].offset,3);
   assert.deepEqual(more.groups[0].items.slice(0,2).map(i=>i.title),['페이지 시험 202','페이지 시험 201']);
   assert.equal(more.groups[0].items.length,50);
  });

  await t.test('no trigram index: under owner RLS the ILIKE filter cannot use one (not leakproof), so S-1 adds none',async()=>{
   await pool.query('create schema if not exists extensions; create extension if not exists pg_trgm schema extensions');
   await pool.query(`create index probe_notes_trgm on public.app_notes using gin (raw_text extensions.gin_trgm_ops)`);
   try{
    const explain=async(role,sub)=>role==='postgres'
     ? (await pool.query(`set enable_seqscan=off; explain select 1 from public.app_notes where raw_text ilike '%단체협약%'; reset enable_seqscan`))[1].rows.map(r=>r['QUERY PLAN']).join('\n')
     : as(role,sub,async c=>{await c.query('set local enable_seqscan=off');return (await c.query(`explain select 1 from public.app_notes where raw_text ilike '%단체협약%'`)).rows.map(r=>r['QUERY PLAN']).join('\n');});
    assert.match(await explain('postgres'),/probe_notes_trgm/); // table owner (no RLS): usable
    assert.doesNotMatch(await explain('authenticated',OWNER),/probe_notes_trgm/); // the search function's caller: not usable
   }finally{await pool.query('drop index public.probe_notes_trgm; drop extension pg_trgm');}
   assert.equal((await pool.query("select count(*)::int n from pg_indexes where schemaname='public' and tablename='app_notes' and indexdef like '%trgm%'")).rows[0].n,0);
  });

  await t.test('rollback restores the snapshot and keeps every row; re-apply works',async()=>{
   const rows=(await pool.query('select md5(string_agg(to_jsonb(n)::text,E\'\\n\' order by n.id)) h from public.app_notes n')).rows[0].h;
   const fn=await run(plan('rollback',FN,'9603'));assert.equal(fn.ok,true,fn.summary);
   assert.equal(await history(FN),0);
   assert.deepEqual((await pool.query(F.snapshot)).rows,before.fn);
   assert.equal((await pool.query('select md5(string_agg(to_jsonb(n)::text,E\'\\n\' order by n.id)) h from public.app_notes n')).rows[0].h,rows);
   for(const r of (await pool.query(F.postcheck)).rows)assert.equal(r.ok,'예',r.item);
   await assert.rejects(pool.query(F.rollback),/SEARCH_RECORDS_ROLLBACK_BLOCKED/);await pool.query('rollback');
   await pool.query(F.migration);
   assert.equal(await history(FN),1);
  });
 }finally{
  if(pool)await pool.end();
  if(adminPool){await adminPool.query('drop database if exists '+database+' with (force)').catch(()=>{});await adminPool.end();}
  if(cluster)await cluster.stop().catch(()=>{});
 }
});
