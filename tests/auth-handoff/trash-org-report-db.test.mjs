// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic (no real organization or report names).
// TRASH-다른삭제 2단계: 20261025100000_trash_org_report_db — 담당조직(app_suborganizations)과 사업 보고(app_meetings)의 [삭제]도
// 휴지통(deleted_at)으로 간다. 숨김 정책(restrictive)·삭제 가로채기 트리거·app_trash_list/restore/purge의 새 종류, 프로젝트 휴지통 그대로.
// 앞 단계 20261024193000_trash_projects_db를 진짜 파일로 먼저 적용한다. service_role에서 schema private USAGE를 뺀 운영 모양으로도 확인한다
// (20261024210000_feed_item_guard_public 참고: 시험 틀이 둘 다에 USAGE를 줘서 42501을 못 잡았던 일).
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
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
const version='20261025100000',name='trash_org_report_db',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const id=n=>`28000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const WS_C='21000000-0000-4000-8000-0000000000c3';

// Existing shapes: the project tree the project trash needs (same as trash-projects-db.test.mjs) plus the organization and
// business-report tables with the records that hang on them (cascade children, set-null links, link rows), owner RLS like task12a_owner_all,
// workspace cascade like production, and an update trigger so the trash UPDATE runs next to another trigger. Nothing here comes from production.
const shapes=`
  alter table public.app_spaces add column owner_id uuid default '${OWNER}', add column name text not null default 'p',
    add column parent_id uuid references public.app_spaces(id) on delete cascade, add column status text default 'active',
    add column sort_order integer default 0;
  create table public.app_project_workstreams(id uuid primary key, project_id uuid not null references public.app_spaces(id) on delete cascade, title text);
  create table public.app_project_progress_updates(id uuid primary key, project_id uuid not null references public.app_spaces(id) on delete cascade, body text);
  create table public.app_tasks(id uuid primary key, workspace_id uuid not null, project_id uuid references public.app_spaces(id),
    workstream_id uuid references public.app_project_workstreams(id), source_type text, source_id uuid, title text);
  create table public.app_events(id uuid primary key, workspace_id uuid not null, project_id uuid references public.app_spaces(id),
    workstream_id uuid references public.app_project_workstreams(id));
  alter table public.app_meetings add column project_id uuid references public.app_spaces(id), add column workstream_id uuid references public.app_project_workstreams(id);
  create table public.app_documents(id uuid primary key, workspace_id uuid not null, project_id uuid references public.app_spaces(id),
    workstream_id uuid references public.app_project_workstreams(id));
  create table public.app_pages(id uuid primary key, workspace_id uuid not null, space_id uuid references public.app_spaces(id),
    workstream_id uuid references public.app_project_workstreams(id));
  grant select, insert, update, delete on public.app_spaces, public.app_project_workstreams, public.app_project_progress_updates,
    public.app_tasks, public.app_events, public.app_meetings, public.app_documents, public.app_pages to authenticated;
  alter table public.app_spaces enable row level security;
  create policy synthetic_spaces_owner on public.app_spaces for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));`;
const shapes2=`
  alter table public.app_suborganizations add column active boolean default true;
  alter table public.app_meetings add column series_name text, add column round_no integer, add column meeting_at timestamptz,
    add column activity_kind text not null default 'meeting', add column touched integer not null default 0;
  alter table public.app_suborganizations drop constraint app_suborganizations_workspace_id_fkey,
    add constraint app_suborganizations_workspace_id_fkey foreign key (workspace_id) references public.app_workspaces(id) on delete cascade;
  alter table public.app_meetings drop constraint app_meetings_workspace_id_fkey,
    add constraint app_meetings_workspace_id_fkey foreign key (workspace_id) references public.app_workspaces(id) on delete cascade;
  create table public.app_org_updates(id uuid primary key, organization_id uuid not null references public.app_suborganizations(id) on delete cascade, body text);
  create table public.app_org_docs(id uuid primary key, organization_id uuid references public.app_suborganizations(id) on delete set null);
  create table public.app_record_links(id uuid primary key, organization_id uuid references public.app_suborganizations(id) on delete cascade,
    meeting_id uuid references public.app_meetings(id) on delete cascade);
  create table public.app_report_docs(id uuid primary key, meeting_id uuid references public.app_meetings(id) on delete set null);
  create function private.synthetic_touch() returns trigger language plpgsql as $$begin new.touched := old.touched + 1; return new; end$$;
  create trigger app_meetings_touch before update on public.app_meetings for each row execute function private.synthetic_touch();
  alter table public.app_meetings enable row level security;
  create policy task12a_owner_all on public.app_meetings for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  grant select, insert, update, delete on public.app_suborganizations, public.app_meetings, public.app_org_updates, public.app_org_docs,
    public.app_record_links, public.app_report_docs to authenticated;
  -- 운영 모양: service_role에는 schema private USAGE가 없다.
  revoke usage on schema private from service_role;`;

test('TRASH 2단계: 담당조직·사업 보고 휴지통 — prechecks, apply, delete goes to trash and keeps links, hidden from reads, service_role path, owner-only list/restore/purge, project unchanged, rollback',{timeout:120000},async t=>{
 let cluster,pool;
 const directory=await mkdtemp(join(tmpdir(),'trash-org-report-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex');
 cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 await cluster.initialise();await cluster.start();
 try{
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(shapes);await pool.query(shapes2);
  await pool.query('delete from public.app_spaces');
  await pool.query('delete from public.app_suborganizations');
  await pool.query('delete from public.app_meetings');
  await pool.query(await read('supabase/migrations/20260921231000_fix_project_delete_workstream_unlink.sql'));
  await pool.query(await read('supabase/migrations/20261021053502_prj_depth_guard.sql'));
  await pool.query(await read('supabase/migrations/20261024193000_trash_projects_db.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const v=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value??r.ok]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn);
  const service=fn=>as('service_role','',fn);
  const rpc=(sub,fn,...args)=>as('authenticated',sub,c=>c.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)).then(x=>x.rows[0].r);
  const del=(table,n)=>owner(c=>c.query(`delete from public.${table} where id=$1`,[id(n)]));
  const visible=async(table,n)=>(await owner(c=>c.query(`select count(*)::int n from public.${table} where id=any($1)`,[n.map(id)]))).rows[0].n;
  const row=async(table,n)=>(await pool.query(`select deleted_at is not null trashed from public.${table} where id=$1`,[id(n)])).rows[0];
  const exists=async(table,n)=>(await pool.query(`select count(*)::int n from public.${table} where id=$1`,[id(n)])).rows[0].n;
  const links=async()=>(await pool.query(`select
    (select string_agg(id::text||'/'||organization_id::text,',' order by id) from public.app_org_updates) updates,
    (select string_agg(id::text||'/'||coalesce(organization_id::text,'-'),',' order by id) from public.app_org_docs) org_docs,
    (select string_agg(id::text||'/'||coalesce(organization_id::text,'-')||'/'||coalesce(meeting_id::text,'-'),',' order by id) from public.app_record_links) rlinks,
    (select string_agg(id::text||'/'||coalesce(meeting_id::text,'-'),',' order by id) from public.app_report_docs) report_docs`)).rows[0];
  // Synthetic data: organizations 1,2 (owner) and 50 (stranger); reports 1,2 (owner) and 50 (stranger); one project 100 (and a child 101).
  for(const [n,ws] of [[1,WS_A],[2,WS_A],[50,WS_B]]){
   await pool.query('insert into public.app_suborganizations(id,workspace_id,name) values($1,$2,$3)',[id(n),ws,'시험 조직 '+n]);
   await pool.query('insert into public.app_meetings(id,workspace_id,title,series_name,round_no,meeting_at) values($1,$2,$3,$4,$5,now())',[id(200+n),ws,'시험 보고 '+n,'시험 연속',n]);
   await pool.query('insert into public.app_org_updates values($1,$2,$3)',[id(300+n),id(n),'기록']);
  }
  for(const n of [1,2]){
   await pool.query('insert into public.app_org_docs values($1,$2)',[id(400+n),id(n)]);
   await pool.query('insert into public.app_report_docs values($1,$2)',[id(500+n),id(200+n)]);
  }
  await pool.query('insert into public.app_record_links values($1,$2,$3),($4,$5,null),($6,null,$7),($8,$9,$10)',[id(601),id(1),id(201),id(602),id(1),id(603),id(201),id(604),id(2),id(202)]);
  await pool.query('insert into public.app_spaces(id,workspace_id,owner_id,name,parent_id) values($1,$2,$3,$4,null),($5,$2,$3,$6,$1)',[id(100),WS_A,OWNER,'시험 프로젝트',id(101),'시험 하위']);
  const before=(await pool.query(snapshot)).rows,beforeCheck=v((await pool.query(precheck)).rows),linksBefore=await links();

  await t.test('pair files pass the workflow parser; the migration takes the approval-once expanded flow',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.targets.sort(),['app_meetings','app_suborganizations']);
   assert.deepEqual(plan.review.definer.sort(),['private.app_trash_org_before_delete','private.app_trash_report_before_delete','public.app_trash_list','public.app_trash_purge','public.app_trash_restore']);
   assert.equal(plan.review.policies,2);assert.equal(plan.review.restrictive,2);assert.equal(plan.review.triggers,2);
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/to (anon|public)\b|rtw_|disable row level|drop policy|alter policy|as permissive|grant [^;]*service_role/i);
   assert.match(code,/create policy app_suborganizations_trash_hidden on public\.app_suborganizations as restrictive for all to authenticated/);
   assert.match(code,/create policy app_meetings_trash_hidden on public\.app_meetings as restrictive for all to authenticated/);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261025100000', 'trash_org_report_db'/);
   // trigger functions never call a private function (service_role has no schema private USAGE in production)
   for(const m of code.matchAll(/create function (private\.app_trash_(?:org|report)_before_delete)\(\)[\s\S]*?\n\$\$;/g))assert.doesNotMatch(m[0].replace(/create function private\.app_trash_\w+/,''),/private\./,m[1]);
  });
  await t.test('precheck: every condition is 예',()=>{
   const yes=Object.entries(beforeCheck).filter(([,x])=>x==='예'||x==='아니오');
   assert.ok(yes.length===15,'예/아니오 항목 수');
   for(const [k,x] of yes)assert.equal(x,'예',k);
   assert.equal(beforeCheck['org row count'],'3');assert.equal(beforeCheck['report row count'],'3');
   assert.equal(beforeCheck['org service_role select (table level)'],'true');
   assert.match(beforeCheck['before delete trigger names'],/^$/);
  });
  await t.test('apply refuses (and changes nothing) when an earlier before-delete trigger exists, the previous step is missing, or the RPCs are not project-only',async()=>{
   await pool.query(`create function private.synthetic_noop() returns trigger language plpgsql as $$begin return old; end$$;
     create trigger app_meetings_0_other before delete on public.app_meetings for each row execute function private.synthetic_noop();`);
   assert.equal(v((await pool.query(precheck)).rows)['report no earlier before delete trigger'],'아니오');
   await assert.rejects(pool.query(migration),/TRASH_ORG_REPORT_PREREQUISITE_CHANGED/);await pool.query('rollback');
   await pool.query('drop trigger app_meetings_0_other on public.app_meetings; drop function private.synthetic_noop();');
   // a later-named trigger is fine: ours still runs first (checked after apply below)
   await pool.query("update supabase_migrations.schema_migrations set name='x' where version='20261024193000'");
   assert.equal(v((await pool.query(precheck)).rows)['previous trash_projects_db recorded'],'아니오');
   await assert.rejects(pool.query(migration),/TRASH_ORG_REPORT_PREREQUISITE_CHANGED/);await pool.query('rollback');
   await pool.query("update supabase_migrations.schema_migrations set name='trash_projects_db' where version='20261024193000'");
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(v((await pool.query(precheck)).rows),beforeCheck);
  });
  await t.test('dry-run (last commit -> rollback) leaves no trace; apply passes postcheck',async()=>{
   await pool.query(migration.replace(/commit;\s*$/,'rollback;'));
   assert.equal(await history(),0);assert.deepEqual(v((await pool.query(precheck)).rows),beforeCheck);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await pool.query(migration);
   assert.equal(await history(),1);
   const post=v((await pool.query(postcheck)).rows);
   for(const [k,x] of Object.entries(post)){
    if(x==='예'||x==='아니오')assert.equal(x,'예',k);
    else assert.equal(x,beforeCheck[k],k); // 숫자·해시·목록 항목은 사전 확인과 같다
   }
   for(const k of ['objects and history agree','trash installed','org trash trigger runs first','report trash trigger runs first','project trash still installed'])assert.equal(post[k],'예',k);
   const fns=(await pool.query(`select p.oid::regprocedure::text f,has_function_privilege('anon',p.oid,'execute') a,has_function_privilege('authenticated',p.oid,'execute') u,
     has_function_privilege('service_role',p.oid,'execute') s from pg_proc p where proname like 'app_trash_%' order by 1`)).rows;
   assert.deepEqual(fns.map(f=>[f.f,f.a,f.u,f.s]),[['app_trash_list(text)',false,true,false],['app_trash_purge(text,uuid)',false,true,false],
    ['app_trash_restore(text,uuid)',false,true,false],['private.app_trash_org_before_delete()',false,false,false],['private.app_trash_report_before_delete()',false,false,false],
    ['private.app_trash_space_before_delete()',false,false,false]]);
   // schema private stays closed to service_role and nothing was granted to anon/public
   assert.equal((await pool.query("select has_schema_privilege('service_role','private','usage') u")).rows[0].u,false);
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid in ('public.app_suborganizations'::regclass,'public.app_meetings'::regclass) and polname like '%trash_hidden' and not polpermissive and polroles=array[(select oid from pg_roles where rolname='authenticated')]")).rows[0].n,2);
  });
  await t.test('the existing screen DELETE moves the organization and the report to the trash; every link stays',async()=>{
   assert.equal(await visible('app_suborganizations',[1,2]),2);assert.equal(await visible('app_meetings',[201,202]),2);
   assert.equal((await del('app_suborganizations',1)).rowCount,0); // nothing is deleted; PostgREST answers the same 204
   assert.equal((await del('app_meetings',201)).rowCount,0);
   assert.equal(await visible('app_suborganizations',[1,2]),1);assert.equal(await visible('app_meetings',[201,202]),1);
   assert.deepEqual(await row('app_suborganizations',1),{trashed:true});assert.deepEqual(await row('app_suborganizations',2),{trashed:false});
   assert.deepEqual(await row('app_meetings',201),{trashed:true});
   assert.deepEqual(await links(),linksBefore);
   assert.equal((await pool.query('select touched from public.app_meetings where id=$1',[id(201)])).rows[0].touched,1); // the other update trigger ran once beside ours
   // Rows that point at a trashed organization or report stay readable (they were never deleted).
   assert.equal((await owner(c=>c.query('select count(*)::int n from public.app_org_updates where organization_id=$1',[id(1)]))).rows[0].n,1);
  });
  await t.test('the screen cannot see, change, re-delete or forge trash rows',async()=>{
   assert.equal((await owner(c=>c.query("update public.app_suborganizations set name='고침' where id=$1",[id(1)]))).rowCount,0);
   assert.equal((await owner(c=>c.query("update public.app_meetings set title='고침' where id=$1",[id(201)]))).rowCount,0);
   assert.equal((await del('app_suborganizations',1)).rowCount,0);assert.equal((await del('app_meetings',201)).rowCount,0);
   assert.deepEqual(await row('app_suborganizations',1),{trashed:true});assert.deepEqual(await row('app_meetings',201),{trashed:true});
   await assert.rejects(owner(c=>c.query('update public.app_suborganizations set deleted_at=now() where id=$1',[id(2)])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('update public.app_meetings set deleted_at=now() where id=$1',[id(202)])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_suborganizations(id,workspace_id,name,deleted_at) values($1,$2,'위조',now())",[id(20),WS_A])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_meetings(id,workspace_id,title,deleted_at) values($1,$2,'위조',now())",[id(220),WS_A])),{code:'42501'});
   assert.equal((await exists('app_suborganizations',20))+(await exists('app_meetings',220)),0);
   // other saves still work: normal edit and insert
   await owner(c=>c.query("update public.app_suborganizations set name='고친 이름' where id=$1",[id(2)]));
   await owner(c=>c.query("update public.app_meetings set title='고친 제목' where id=$1",[id(202)]));
   await owner(c=>c.query("insert into public.app_suborganizations(id,workspace_id,name) values($1,$2,'새 조직')",[id(21),WS_A]));
   await owner(c=>c.query("insert into public.app_meetings(id,workspace_id,title) values($1,$2,'새 보고')",[id(221),WS_A]));
   await owner(c=>c.query('delete from public.app_suborganizations where id=$1',[id(21)]));await owner(c=>c.query('delete from public.app_meetings where id=$1',[id(221)]));
   assert.equal(await visible('app_suborganizations',[21]),0); // the new ones went to the trash too (no schema-hidden immediate delete)
   assert.deepEqual(await row('app_suborganizations',21),{trashed:true});assert.deepEqual(await row('app_meetings',221),{trashed:true});
  });
  await t.test('service_role (no schema private USAGE) can read the mark and its DELETE goes to the trash without 42501',async()=>{
   const seen=await service(c=>c.query('select id,deleted_at is not null trashed from public.app_suborganizations where id=any($1) order by id',[[1,2].map(id)]));
   assert.deepEqual(seen.rows.map(r=>r.trashed),[true,false]); // service_role bypasses RLS, so Edge functions must filter deleted_at themselves
   assert.equal((await service(c=>c.query('delete from public.app_suborganizations where id=$1',[id(2)]))).rowCount,0);
   assert.deepEqual(await row('app_suborganizations',2),{trashed:true});
   assert.equal((await service(c=>c.query('delete from public.app_meetings where id=$1',[id(202)]))).rowCount,0);
   assert.deepEqual(await row('app_meetings',202),{trashed:true});
   assert.deepEqual(await links(),linksBefore);
   await assert.rejects(service(c=>c.query("select private.app_is_workspace_owner($1)",[WS_A])),{code:'42501'}); // the production shape the test now reproduces
  });
  await t.test('app_trash_list: owner sees own trash with the right fields; stranger sees nothing; anon cannot call; unknown kind refused',async()=>{
   const orgs=await rpc(OWNER,'app_trash_list','organization');
   assert.deepEqual(orgs.map(o=>[o.kind,o.id,o.name]).sort(),[['organization',id(1),'시험 조직 1'],['organization',id(2),'고친 이름'],['organization',id(21),'새 조직']].sort());
   assert.ok(orgs.every(o=>o.workspace_id===WS_A&&o.deleted_at));
   const reports=await rpc(OWNER,'app_trash_list','report');
   assert.deepEqual(reports.map(o=>o.id).sort(),[id(201),id(202),id(221)].sort());
   const r1=reports.find(x=>x.id===id(201));
   assert.deepEqual({kind:r1.kind,title:r1.title,series:r1.series_name,round:r1.round_no,activity:r1.activity_kind,has_at:!!r1.meeting_at},{kind:'report',title:'시험 보고 1',series:'시험 연속',round:1,activity:'meeting',has_at:true});
   for(const kind of ['organization','report','project'])assert.deepEqual(await rpc(STRANGER,'app_trash_list',kind),[],kind);
   await assert.rejects(rpc(OWNER,'app_trash_list','task'),/TRASH_KIND_UNKNOWN/);
   await assert.rejects(rpc(OWNER,'app_trash_list',null),/TRASH_KIND_UNKNOWN/);
   for(const kind of ['organization','report'])for(const call of [`select public.app_trash_list('${kind}')`,`select public.app_trash_restore('${kind}','${id(1)}')`,`select public.app_trash_purge('${kind}','${id(1)}')`])
    await assert.rejects(as('anon','',c=>c.query(call)),{code:'42501'},call);
   await assert.rejects(service(c=>c.query("select public.app_trash_list('report')")),{code:'42501'});
  });
  await t.test('app_trash_restore: only the owner, only trash rows; the mark clears and links are untouched',async()=>{
   for(const [kind,rowId] of [['organization',1],['report',201]]){
    await assert.rejects(rpc(STRANGER,'app_trash_restore',kind,id(rowId)),/TRASH_NOT_FOUND/,kind);
    await assert.rejects(rpc(OWNER,'app_trash_restore',kind,id(kind==='organization'?50:250)),/TRASH_NOT_FOUND/,kind); // not in the trash / not found
   }
   await assert.rejects(rpc(OWNER,'app_trash_restore','organization',id(201)),/TRASH_NOT_FOUND/); // a report id under the organization kind
   await assert.rejects(rpc(OWNER,'app_trash_restore','task',id(1)),/TRASH_KIND_UNKNOWN/);
   assert.deepEqual(await rpc(OWNER,'app_trash_restore','organization',id(1)),{ok:true,kind:'organization',id:id(1),restored:1});
   assert.deepEqual(await rpc(OWNER,'app_trash_restore','report',id(201)),{ok:true,kind:'report',id:id(201),restored:1});
   assert.equal(await visible('app_suborganizations',[1]),1);assert.equal(await visible('app_meetings',[201]),1);
   await assert.rejects(rpc(OWNER,'app_trash_restore','organization',id(1)),/TRASH_NOT_FOUND/); // twice is refused, nothing changes
   assert.deepEqual(await links(),linksBefore);
  });
  await t.test('a stranger\'s organization and report are untouched by the owner paths',async()=>{
   assert.deepEqual(await row('app_suborganizations',50),{trashed:false});assert.deepEqual(await row('app_meetings',250),{trashed:false});
   await assert.rejects(rpc(OWNER,'app_trash_purge','organization',id(50)),/TRASH_NOT_FOUND/);
   assert.equal(await exists('app_suborganizations',50),1);
  });
  await t.test('app_trash_purge: owner only, trash only; then the old delete behaviour runs (cascade children, set null links)',async()=>{
   await assert.rejects(rpc(OWNER,'app_trash_purge','organization',id(1)),/TRASH_NOT_FOUND/); // not in the trash
   await assert.rejects(rpc(OWNER,'app_trash_purge','report',id(201)),/TRASH_NOT_FOUND/);
   await del('app_suborganizations',1);await del('app_meetings',201);
   await assert.rejects(rpc(STRANGER,'app_trash_purge','organization',id(1)),/TRASH_NOT_FOUND/);
   await assert.rejects(rpc(STRANGER,'app_trash_purge','report',id(201)),/TRASH_NOT_FOUND/);
   assert.deepEqual(await rpc(OWNER,'app_trash_purge','organization',id(1)),{ok:true,kind:'organization',id:id(1)});
   assert.deepEqual(await rpc(OWNER,'app_trash_purge','report',id(201)),{ok:true,kind:'report',id:id(201)});
   assert.equal((await exists('app_suborganizations',1))+(await exists('app_meetings',201)),0);
   const after=await links();
   assert.ok(!after.updates.includes(id(301))&&after.updates.includes(id(302))); // children cascade away with the organization (as before)
   assert.equal(after.org_docs,`${id(401)}/-,${id(402)}/${id(2)}`); // set null keeps the row
   assert.ok(!after.rlinks.includes(id(601))&&!after.rlinks.includes(id(602))&&!after.rlinks.includes(id(603))&&after.rlinks.includes(id(604))); // link rows of the purged ones cascade
   assert.equal(after.report_docs,`${id(501)}/-,${id(502)}/${id(202)}`);
   assert.equal(await exists('app_suborganizations',2),1); // the other trashed organization is still in the trash
  });
  await t.test('deleting a whole workspace still removes its rows for real (cascade, trigger depth 2)',async()=>{
   await pool.query('insert into public.app_workspaces(id) values($1)',[WS_C]);
   await pool.query("insert into public.app_suborganizations(id,workspace_id,name) values($1,$2,'작업공간 조직')",[id(70),WS_C]);
   await pool.query("insert into public.app_meetings(id,workspace_id,title) values($1,$2,'작업공간 보고')",[id(270),WS_C]);
   await pool.query('delete from public.app_workspaces where id=$1',[WS_C]);
   assert.equal((await exists('app_suborganizations',70))+(await exists('app_meetings',270)),0);
  });
  await t.test('the project trash still works as before (list, delete, restore, purge)',async()=>{
   assert.deepEqual(await rpc(OWNER,'app_trash_list','project'),[]);
   await owner(c=>c.query('delete from public.app_spaces where id=$1',[id(100)]));
   const list=await rpc(OWNER,'app_trash_list','project');
   assert.deepEqual(list.map(x=>[x.kind,x.id,x.name,x.child_count,x.parent_in_trash]),[['project',id(100),'시험 프로젝트',1,false]]);
   assert.deepEqual(await rpc(OWNER,'app_trash_restore','project',id(100)),{ok:true,kind:'project',id:id(100),restored:2});
   assert.equal(await visible('app_spaces',[100,101]),2);
   await owner(c=>c.query('delete from public.app_spaces where id=$1',[id(100)]));
   assert.deepEqual(await rpc(OWNER,'app_trash_purge','project',id(100)),{ok:true,kind:'project',id:id(100)});
   assert.equal((await exists('app_spaces',100))+(await exists('app_spaces',101)),0);
  });
  await t.test('running the migration again is refused and keeps one history row',async()=>{
   await assert.rejects(pool.query(migration),/TRASH_ORG_REPORT_PREREQUISITE_CHANGED/);await pool.query('rollback');
   assert.equal(await history(),1);
  });
  await t.test('rollback removes only the new trash pieces; trashed rows come back; project trash and RPC names stay; delete is immediate again',async()=>{
   await pool.query('insert into public.app_suborganizations(id,workspace_id,name) values($1,$2,$3)',[id(30),WS_A,'되돌리기 시험']);
   await pool.query('insert into public.app_meetings(id,workspace_id,title) values($1,$2,$3)',[id(230),WS_A,'되돌리기 시험']);
   await del('app_suborganizations',30);await del('app_meetings',230);
   assert.equal(await visible('app_suborganizations',[30]),0);
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   const post=v((await pool.query(postcheck)).rows);
   assert.equal(post['objects and history agree'],'예');assert.equal(post['trash installed'],'아니오');assert.equal(post['project trash still installed'],'예');
   assert.equal(await visible('app_suborganizations',[30]),1);assert.equal(await visible('app_meetings',[230]),1);
   assert.equal((await del('app_suborganizations',30)).rowCount,1);assert.equal((await del('app_meetings',230)).rowCount,1);
   // the RPCs are project-only again (same names, same grants) and the project trash is intact
   await assert.rejects(rpc(OWNER,'app_trash_list','organization'),/TRASH_KIND_UNKNOWN/);
   assert.deepEqual(await rpc(OWNER,'app_trash_list','project'),[]);
   assert.equal((await pool.query("select count(*)::int n from pg_proc where proname in ('app_trash_list','app_trash_restore','app_trash_purge') and not has_function_privilege('anon',oid,'execute') and has_function_privilege('authenticated',oid,'execute')")).rows[0].n,3);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(v((await pool.query(precheck)).rows),{...beforeCheck,'org row count':String((await pool.query('select count(*)::int n from public.app_suborganizations')).rows[0].n),'report row count':String((await pool.query('select count(*)::int n from public.app_meetings')).rows[0].n),'org rows hash (ids only)':v((await pool.query(precheck)).rows)['org rows hash (ids only)'],'report rows hash (ids only)':v((await pool.query(precheck)).rows)['report rows hash (ids only)']});
   await pool.query(migration);assert.equal(await history(),1);
   assert.equal(v((await pool.query(postcheck)).rows)['trash installed'],'예');
   await pool.query(rollbackSQL);assert.equal(await history(),0);
  });
 }finally{
  await closePool(pool);
  if(cluster)await cluster.stop().catch(()=>{});
 }
});
