// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic.
// LIB-AI분류보완: 20261023120000_library_ai_classify — link keys in field_origin/backups, classify attempt record, apply / revert /
// revert_since functions, through the approved DB workflow runner: dry-run, apply, hand-set values and links never overwritten,
// project/organization IDs checked against the owner's own workspace, one-transaction backup, whole-sweep revert, guarded rollback.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,PROJECT_A2,PROJECT_B,ORG_A,ORG_B} from './basket4-fixture.mjs';
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261023120000',name='library_ai_classify',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const ORG_A_OFF='23000000-0000-4000-8000-000000000009',PROJECT_A_ARCHIVED='22000000-0000-4000-8000-000000000009';

// Production-like app_documents after 20261022100000 (field_origin check, 4 keys), owner RLS with the same-workspace organization check,
// the same-workspace project trigger, projects/organizations readable under owner RLS, then 20261022212757 applied as in production.
const documents=`
  alter table public.app_spaces add column name text, add column status text, add column owner_id uuid;
  alter table public.app_spaces enable row level security;
  create policy task12a_owner_all on public.app_spaces for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  grant select on public.app_spaces to authenticated;
  alter table public.app_suborganizations add column active boolean not null default true;
  insert into public.app_spaces(id,workspace_id,status) values ('${PROJECT_A_ARCHIVED}','${WS_A}','archived');
  insert into public.app_suborganizations(id,workspace_id,active) values ('${ORG_A_OFF}','${WS_A}',false);
  create table public.app_documents(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.app_workspaces(id),
    project_id uuid references public.app_spaces(id) on delete set null,organization_id uuid references public.app_suborganizations(id) on delete set null,
    title text,category text,source text,document_date date,file_name text,visibility text default 'private',
    classification_note text,extracted_text text,extraction_status text default 'pending',extraction_error text,extracted_at timestamptz,
    field_origin jsonb not null default '{}'::jsonb,created_at timestamptz default now(),updated_at timestamptz default now(),
    constraint app_documents_field_origin_check check (jsonb_typeof(field_origin) = 'object'
      and (field_origin - array['title', 'category', 'source', 'document_date']) = '{}'::jsonb
      and not jsonb_path_exists(field_origin, 'strict $.* ? (@.type() != "string")')
      and not jsonb_path_exists(field_origin, 'strict $.* ? (@ != "ai" && @ != "user")')));
  alter table public.app_documents enable row level security;
  create policy task12a_owner_all on public.app_documents for all to authenticated
    using (private.app_is_workspace_owner(workspace_id))
    with check (private.app_is_workspace_owner(workspace_id) and (organization_id is null or exists (
      select 1 from public.app_suborganizations o where o.id = organization_id and o.workspace_id = app_documents.workspace_id)));
  create function private.app_enforce_workspace_links() returns trigger language plpgsql security definer set search_path = pg_catalog, public, private as $$
    begin if not private.app_space_in_workspace(new.project_id, new.workspace_id) then
      raise exception using errcode='23514', message='project/space must belong to the same workspace'; end if; return new; end $$;
  create trigger app_documents_workspace_consistency before insert or update on public.app_documents for each row execute function private.app_enforce_workspace_links();
  revoke all on public.app_documents from anon;
  revoke truncate, references, trigger on public.app_documents from authenticated;
  insert into supabase_migrations.schema_migrations(version,name) values('20261022100000','library_ai_fill');
`;

test('library ai classify: dry-run, apply, hand-set never overwritten, ids checked, one transaction, whole-sweep revert, guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'library-ai-classify-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(documents);
  await pool.query(await read('supabase/migrations/20261022212757_library_auto_tidy.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const doc=async(ws,over={})=>(await pool.query(`insert into public.app_documents(workspace_id,title,category,source,document_date,file_name,field_origin,project_id,organization_id)
    values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) returning id`,[ws,over.title??'251020_요구안',over.category??'기타',over.source??null,over.document_date??null,'251020_요구안.hwpx',
    JSON.stringify(over.field_origin??{}),over.project_id??null,over.organization_id??null])).rows[0].id;
  // D1 empty; D2 hand-linked project and a user title; D3 other workspace; D4 empty; D5 empty.
  const D1=await doc(WS_A),D2=await doc(WS_A,{title:'고친 제목',field_origin:{title:'user'},project_id:PROJECT_A2}),D3=await doc(WS_B),D4=await doc(WS_A),D5=await doc(WS_A);
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  const stamp=async id=>(await pool.query('select updated_at::text t from public.app_documents where id=$1',[id])).rows[0].t;
  const row=async id=>(await pool.query('select title,category,source,document_date::text as document_date,project_id::text as project_id,organization_id::text as organization_id,field_origin from public.app_documents where id=$1',[id])).rows[0];
  const apply=(sub,batch,items)=>as('authenticated',sub,c=>c.query('select public.app_library_classify_apply($1,$2::jsonb) r',[batch,JSON.stringify(items)])).then(r=>r.rows[0].r);
  const revert=(sub,batch)=>as('authenticated',sub,c=>c.query('select public.app_library_classify_revert($1) r',[batch])).then(r=>r.rows[0].r);
  const revertSince=(sub,since)=>as('authenticated',sub,c=>c.query('select public.app_library_classify_revert_since($1) r',[since])).then(r=>r.rows[0].r);
  const attempt=async id=>(await pool.query('select with_text,changed from public.app_library_classify_attempts where document_id=$1',[id])).rows[0];
  const item=async(id,changes,with_text=true)=>({document_id:id,updated_at:await stamp(id),with_text,changes});
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;

  await t.test('files: read-only checks, three-line summary, expanded approved workflow accepts the file',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const p=plan(mode,'1');assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');}
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   assert.match(summary[0],/프로젝트·담당조직/);assert.match(summary[0],/바꾸지 않고 연결을 지우지도 않습니다/);
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|disable row level|\bto (anon|public|service_role)\b|information_schema|rtw_|drop policy|alter policy|create or replace/i);
   assert.doesNotMatch(precheck+postcheck,/information_schema/);
  });
  await t.test('precheck before apply',()=>{
   const v=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));
   for(const k of ['new migration absent','library auto tidy recorded','classify attempts table absent','classify apply function absent','classify revert function absent',
     'classify revert since function absent','tidy backups table present','field origin check present','backup field check present','no link keys in field origin yet',
     'project status column','organization active column','authenticated can read projects','authenticated can read organizations','documents workspace trigger',
     'documents RLS enabled','authenticated can update documents','owner check function'])assert.equal(v[k],'예',k);
   assert.equal(v['documents rows'],'5');assert.equal(v['tidy backups rows'],'0');
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await runMigrationPlan(plan('dry-run','9701'),query,{saveSnapshot:async()=>{}});assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('apply passes postcheck; existing values unchanged; old tidy functions untouched',async()=>{
   const result=await runMigrationPlan(plan('apply','9702'),query,{saveSnapshot:async()=>{}});assert.equal(result.ok,true,result.summary);
   assert.doesNotMatch(result.summary.split('사후 확인')[1]??'',/\| 아니오 \|/);
   assert.equal(await history(),1);
   assert.deepEqual(await row(D2),{title:'고친 제목',category:'기타',source:null,document_date:null,project_id:PROJECT_A2,organization_id:null,field_origin:{title:'user'}});
   assert.deepEqual(before.filter(r=>r.kind==='existing tidy functions'),(await pool.query(snapshot)).rows.filter(r=>r.kind==='existing tidy functions'));
   await assert.rejects(pool.query(migration),/LIBRARY_AI_CLASSIFY_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });
  const B1=randomUUID();let sweepStart;
  await t.test('apply: text fields and empty links filled in one call; backups hold the empty original; attempt with_text recorded',async()=>{
   sweepStart=(await pool.query('select now()::text t')).rows[0].t;
   const r=await apply(OWNER,B1,[await item(D1,{title:'2026년 임금교섭 요구안',category:'교섭·합의',project_id:PROJECT_A,organization_id:ORG_A})]);
   assert.deepEqual(r,{documents:1,fields:4,moved:0});
   assert.deepEqual(await row(D1),{title:'2026년 임금교섭 요구안',category:'교섭·합의',source:null,document_date:null,project_id:PROJECT_A,organization_id:ORG_A,
     field_origin:{title:'ai',category:'ai',project_id:'ai',organization_id:'ai'}});
   const backups=(await pool.query('select field,old_value,old_origin,new_value from public.app_library_tidy_backups where batch_id=$1 order by field',[B1])).rows;
   assert.deepEqual(backups.map(b=>[b.field,b.old_value,b.new_value]),[['category','기타','교섭·합의'],['organization_id',null,ORG_A],['project_id',null,PROJECT_A],['title','251020_요구안','2026년 임금교섭 요구안']]);
   assert.deepEqual(await attempt(D1),{with_text:true,changed:4});
  });
  await t.test('hand-set never overwritten: a user field or an existing link rolls back the whole call',async()=>{
   const b=randomUUID();
   // D2 title is 'user'; D2 project was linked by hand (no origin) — both refused, and D4's change in the same call is undone too.
   for(const bad of [{title:'덮어쓰기'},{project_id:PROJECT_A}])
    await assert.rejects(apply(OWNER,b,[await item(D4,{title:'바꿈'}),await item(D2,bad)]),{code:'42501'},JSON.stringify(bad));
   // An AI-filled link is not replaced either (only empty links are filled).
   await assert.rejects(apply(OWNER,b,[await item(D1,{organization_id:ORG_A_OFF})]),{code:'42501'});
   assert.equal((await pool.query('select count(*)::int n from public.app_library_tidy_backups where batch_id=$1',[b])).rows[0].n,0);
   assert.equal((await row(D4)).title,'251020_요구안');assert.equal((await row(D2)).project_id,PROJECT_A2);
   assert.equal(await attempt(D4),undefined);
  });
  await t.test('a link the person removed (origin ai, value now empty) is never filled again',async()=>{
   const id=await doc(WS_A,{project_id:PROJECT_A,field_origin:{}});
   await pool.query(`update public.app_documents set project_id=null,field_origin='{"project_id":"ai"}' where id=$1`,[id]);
   await assert.rejects(apply(OWNER,randomUUID(),[await item(id,{project_id:PROJECT_A2})]),{code:'42501'});
  });
  await t.test('ids are checked in the database: other workspace, archived project, inactive organization, not a uuid',async()=>{
   for(const changes of [{project_id:PROJECT_B},{organization_id:ORG_B},{project_id:PROJECT_A_ARCHIVED},{organization_id:ORG_A_OFF},{project_id:'p1'},{project_id:''},{organization_id:randomUUID()}])
    await assert.rejects(apply(OWNER,randomUUID(),[await item(D4,changes)]),{code:'22023'},JSON.stringify(changes));
   assert.deepEqual(await row(D4),{title:'251020_요구안',category:'기타',source:null,document_date:null,project_id:null,organization_id:null,field_origin:{}});
  });
  await t.test('input shape: with_text required and boolean, unknown keys and fields refused, at most 10 items',async()=>{
   const s=await stamp(D4);
   for(const items of [[{document_id:D4,updated_at:s,changes:{}}],[{document_id:D4,updated_at:s,with_text:'yes',changes:{}}],
     [{document_id:D4,updated_at:s,with_text:true,changes:{meeting_id:MEETING()}}],[{document_id:D4,updated_at:s,with_text:true,changes:{title:'<b>x</b>'}}],
     [{document_id:D4,updated_at:s,with_text:true,changes:{},extra:1}],Array.from({length:11},()=>({document_id:D4,updated_at:s,with_text:true,changes:{}}))])
    await assert.rejects(apply(OWNER,randomUUID(),items),{code:'22023'},JSON.stringify(items).slice(0,80));
  });
  await t.test('text arriving later: a file-name-only attempt is upgraded once; a text attempt is final',async()=>{
   assert.deepEqual(await apply(OWNER,randomUUID(),[await item(D5,{title:'파일 이름으로 본 제목'},false)]),{documents:1,fields:1,moved:0});
   assert.deepEqual(await attempt(D5),{with_text:false,changed:1});
   assert.deepEqual(await apply(OWNER,randomUUID(),[await item(D5,{title:'글자로 본 제목',project_id:PROJECT_A},true)]),{documents:1,fields:2,moved:0});
   assert.deepEqual(await attempt(D5),{with_text:true,changed:2});
   assert.deepEqual(await row(D5).then(r=>[r.title,r.project_id,r.field_origin]),['글자로 본 제목',PROJECT_A,{title:'ai',project_id:'ai'}]);
   await apply(OWNER,randomUUID(),[await item(D5,{source:'공공운수노조'},false)]);
   assert.deepEqual(await attempt(D5),{with_text:true,changed:2},'a final attempt is not overwritten');
  });
  await t.test('owner only: a stranger cannot apply to, read or revert another workspace; anon has nothing',async()=>{
   assert.deepEqual(await apply(STRANGER,randomUUID(),[await item(D1,{source:'x'})]),{documents:0,fields:0,moved:1});
   assert.deepEqual(await revert(STRANGER,B1),{reverted:0,skipped:0});
   assert.deepEqual(await revertSince(STRANGER,'2000-01-01'),{batches:0,reverted:0,skipped:0});
   assert.equal((await as('authenticated',STRANGER,c=>c.query('select * from public.app_library_classify_attempts'))).rowCount,0);
   await assert.rejects(as('authenticated',OWNER,c=>c.query('insert into public.app_library_classify_attempts(document_id,workspace_id,batch_id) values($1,$2,$3)',[D3,WS_A,randomUUID()])),{code:'42501'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query('delete from public.app_library_classify_attempts')),{code:'42501'});
   for(const sql of ['select * from public.app_library_classify_attempts',`select public.app_library_classify_revert('${B1}')`,`select public.app_library_classify_revert_since(now())`,
     `select public.app_library_classify_apply('${B1}','[]'::jsonb)`])
    await assert.rejects(as('anon','',c=>c.query(sql)),{code:'42501'},sql);
  });
  await t.test('whole-sweep revert: every batch since the start goes back; a field the person changed afterwards is skipped',async()=>{
   // The person corrects D1's category and removes the organization after the sweep.
   await as('authenticated',OWNER,c=>c.query(`update public.app_documents set category='정책',field_origin=field_origin||'{"category":"user"}'::jsonb where id=$1`,[D1]));
   await as('authenticated',OWNER,c=>c.query(`update public.app_documents set organization_id=null where id=$1`,[D1]));
   const r=await revertSince(OWNER,sweepStart);
   assert.equal(r.batches,4);assert.equal(r.skipped,2);
   assert.deepEqual(await row(D1),{title:'251020_요구안',category:'정책',source:null,document_date:null,project_id:null,organization_id:null,field_origin:{category:'user',organization_id:'ai'}});
   assert.deepEqual(await row(D5).then(x=>[x.title,x.project_id,x.field_origin]),['251020_요구안',null,{}]);
   // Attempts stay, so the same documents are not sent to AI again.
   assert.equal((await attempt(D1)).with_text,true);
   assert.deepEqual(await revertSince(OWNER,sweepStart),{batches:1,reverted:0,skipped:2});
  });
  await t.test('rollback refuses while link records exist; once preserved it restores the snapshot; re-apply works',async()=>{
   await assert.rejects(pool.query(rollbackSQL),/LIBRARY_AI_CLASSIFY_ROLLBACK_BLOCKED/);await pool.query('rollback');
   assert.equal(await history(),1);
   // CC procedure after keeping a capture: remove the synthetic link records (test data only).
   await pool.query(`update public.app_documents set field_origin=field_origin-'project_id'-'organization_id'`);
   await pool.query(`delete from public.app_library_tidy_backups where field in ('project_id','organization_id')`);
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const after=Object.fromEntries((await pool.query(postcheck)).rows.map(r=>[r.item,r.value]));
   assert.equal(after['objects and history agree'],'예');assert.equal(after['check constraints match history'],'예');
   await pool.query(migration);assert.equal(await history(),1);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
function MEETING(){return '25000000-0000-4000-8000-000000000001';}
