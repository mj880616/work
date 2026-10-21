// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic.
// DB-승인형확장: the single-approval flow (precheck expectations → catalog-only snapshot artifact → dry-run in a
// transaction that is rolled back → apply → postcheck) run with the real repository files of today's six migrations,
// in order, against a synthetic schema. Optional: DB_WORKFLOW_PG_PORT=<port> uses an already running local server
// (user postgres, trust auth) instead of the embedded one.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {fixture,WS_A} from './basket4-fixture.mjs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
import {DbQueryError} from '../../scripts/ops/db-query.mjs';
const root=new URL('../../',import.meta.url).pathname;
const externalPort=process.env.DB_WORKFLOW_PG_PORT;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const id=n=>`27000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const CARD='synthetic-card-never-in-artifact';

// Shapes the six migrations depend on (copied from their own tests): app_spaces tree columns with the workspace
// consistency trigger, and the Web1 card archive table made outside migrations (anon read + write, as found in prod).
const prerequisites=`
  alter table public.app_spaces add column owner_id uuid, add column name text not null default 'p',
    add column parent_id uuid references public.app_spaces(id) on delete cascade, add column status text default 'active',
    add column sort_order integer default 0, add column metadata jsonb default '{"project_system":"v2"}';
  create function private.app_enforce_space_workspace() returns trigger language plpgsql security definer
    set search_path = pg_catalog, public as $$
  begin
    if new.parent_id is not null and not exists (select 1 from public.app_spaces p where p.id = new.parent_id and p.workspace_id = new.workspace_id) then
      raise exception using errcode='23514', message='parent project must belong to the same workspace';
    end if;
    return new;
  end $$;
  revoke all on function private.app_enforce_space_workspace() from public;
  create trigger app_spaces_workspace_consistency before insert or update on public.app_spaces for each row execute function private.app_enforce_space_workspace();
  alter table public.app_spaces enable row level security;
  create policy synthetic_spaces_owner on public.app_spaces for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  create table public.main_project_archive_state(card_key text primary key, archived boolean not null default false, updated_at timestamptz default now());
  alter table public.main_project_archive_state enable row level security;
  create policy archive_state_read on public.main_project_archive_state for select to anon, authenticated using (true);
  create policy archive_state_write on public.main_project_archive_state for all to anon, authenticated using (true) with check (true);
  insert into public.main_project_archive_state(card_key,archived) values ('${CARD}',true),('synthetic-card-2',false);
  insert into supabase_migrations.schema_migrations(version,name) values ('20261020051027','journal_work_lines');`;

const order=[
 ['20261021053502','prj_depth_guard'],
 ['20261021075034','todo_radar_candidates'],
 ['20261021082000','ledger_schema'],
 ['20261021150000','ledger_import'],
 ['20261021190000','ledger_candidates'],
 ['20261021200000','web1_archive_state_readonly'],
];

test('DB-승인형확장: today\'s six migrations through precheck → snapshot → dry-run → apply → postcheck',{timeout:120000},async t=>{
 let cluster,pool,adminPool,database='postgres',port,password;
 if(externalPort){
  port=Number(externalPort);database='dbwf_'+randomBytes(4).toString('hex');
  adminPool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres',ssl:false});
  await adminPool.query('create database '+database);
  for(const role of ['anon','authenticated','public_probe','service_role'])await adminPool.query(`drop role if exists ${role}`).catch(()=>{});
 }else{
  const directory=await mkdtemp(join(tmpdir(),'db-wf-expand-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));port=sock.address().port;await new Promise(r=>sock.close(r));
  password=randomBytes(24).toString('hex');
  cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
  await cluster.initialise();await cluster.start();
 }
 try{
  pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database,ssl:false});
  await pool.query(fixture);await pool.query(prerequisites);
  for(const [n,p] of [[1,null],[2,1],[3,2],[10,null],[11,10]])
   await pool.query('insert into public.app_spaces(id,workspace_id,name,parent_id) values($1,$2,$3,$4)',[id(n),WS_A,'시험 '+n,p==null?null:id(p)]);
  // Same transport semantics as the Management API: read_only requests in a read-only transaction, the result of the
  // last statement, SQL errors as DbQueryError with SQLSTATE only. Every request is counted.
  const calls=[];
  const query=async(sql,{readOnly=false}={})=>{
   calls.push({sql,readOnly});
   const client=await pool.connect();
   try{
    if(readOnly)await client.query('begin read only');
    const result=await client.query(sql);
    if(readOnly)await client.query('commit');
    return Array.isArray(result)?result.at(-1).rows:result.rows;
   }catch(error){await client.query('rollback').catch(()=>{});throw new DbQueryError('API',{status:400,sqlState:error.code});}
   finally{client.release();}
  };
  const history=async v=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[v])).rows[0].n;
  const saved=new Map();
  const saveSnapshot=async(file,body)=>{saved.set(file,body);};
  let run=100;

  await t.test('a precheck that does not meet its expectation stops before any write',async()=>{
   // A 4th project level breaks the prj precheck expectation "rows deeper than 3 levels (=0) = 0".
   await pool.query('insert into public.app_spaces(id,workspace_id,name,parent_id) values($1,$2,$3,$4)',[id(4),WS_A,'시험 4',id(3)]);
   const plan=prepareMigration({mode:'apply',version:'20261021053502',runId:String(run++),root});
   calls.length=0;
   const result=await runMigrationPlan(plan,query,{saveSnapshot});
   assert.equal(result.ok,false);
   assert.match(result.summary,/사전 확인이 기대와 다릅니다/);
   assert.match(result.summary,/\| rows deeper than 3 levels \(=0\) \| 1 \| 0 \| 아니오 \|/);
   assert.match(result.summary,/쓰기 요청 전송: 아니오/);
   assert.ok(calls.every(c=>c.readOnly),'only read-only requests');
   assert.equal(await history('20261021053502'),0);
   await pool.query('delete from public.app_spaces where id=$1',[id(4)]);
  });

  await t.test('a precheck that cannot run (missing prerequisite table) also stops before any write',async()=>{
   const plan=prepareMigration({mode:'dry-run',version:'20261021150000',runId:String(run++),root});
   calls.length=0;
   const result=await runMigrationPlan(plan,query,{saveSnapshot});
   assert.equal(result.ok,false);
   assert.match(result.summary,/사전 확인\(precheck\): 실패/);
   assert.match(result.summary,/쓰기 요청 전송: 아니오/);
   assert.ok(calls.every(c=>c.readOnly));
  });

  for(const [version,name] of order){
   await t.test(`${version}_${name}: dry-run (rolled back) then apply`,async()=>{
    const dry=prepareMigration({mode:'dry-run',version,runId:String(run++),root});
    assert.equal(dry.flow,'full');
    const dryResult=await runMigrationPlan(dry,query,{saveSnapshot});
    assert.equal(dryResult.ok,true,dryResult.summary);
    assert.match(dryResult.summary,/시험 적용\(트랜잭션 안 적용 후 취소\): 성공/);
    assert.equal(await history(version),0,'dry-run leaves no history');
    const apply=prepareMigration({mode:'apply',version,runId:String(run++),root});
    calls.length=0;
    const result=await runMigrationPlan(apply,query,{saveSnapshot});
    assert.equal(result.ok,true,result.summary);
    assert.match(result.summary,/사후 확인: 모두 예/);
    assert.match(result.summary,/되돌리기 \(자동 실행 안 함/);
    assert.equal(await history(version),1);
    // Exactly one dry-run and one real execution of the file; no rollback SQL was sent.
    assert.equal(calls.filter(c=>c.sql===apply.file.sql).length,1);
    assert.equal(calls.filter(c=>c.sql.endsWith('rollback;\n')).length,1);
    assert.ok(!calls.some(c=>/delete from supabase_migrations/.test(c.sql)));
    const snapshot=saved.get(`${version}_${name}.snapshot.json`);
    assert.ok(snapshot,'snapshot saved before apply');
    assert.doesNotMatch(snapshot,new RegExp(CARD));
    assert.doesNotMatch(dryResult.summary+result.summary,new RegExp(CARD));
   });
  }

  await t.test('a failing postcheck stops after apply, shows the rollback guide and never runs the rollback',async()=>{
   const tmp=await mkdtemp(join(tmpdir(),'db-wf-expand-root-'));
   const v='20261099000001',n='synthetic_postcheck_fail',stem=v+'_'+n;
   await mkdir(join(tmp,'supabase/migrations'),{recursive:true});await mkdir(join(tmp,'docs'));
   await writeFile(join(tmp,`supabase/migrations/${stem}.sql`),`begin;\ncreate table public.ex_synthetic(id int primary key);\nalter table public.ex_synthetic enable row level security;\ninsert into supabase_migrations.schema_migrations (version, name) values ('${v}', '${n}');\ncommit;\n`);
   await writeFile(join(tmp,`docs/${stem}.summary.md`),'무엇이 바뀌나: 시험 표.\n잘못되면: 없음.\n되돌리는 법: rollback 파일.\n');
   await writeFile(join(tmp,`docs/${stem}.precheck.sql`),`select 'new migration absent' as item, case when to_regclass('public.ex_synthetic') is null then '예' else '아니오' end as value;`);
   await writeFile(join(tmp,`docs/${stem}.snapshot.sql`),`select 'table' as kind, coalesce(to_regclass('public.ex_synthetic')::text,'absent') as name;`);
   await writeFile(join(tmp,`docs/${stem}.postcheck.sql`),`select 'deliberately false' as item, '아니오' as ok;`);
   await writeFile(join(tmp,`docs/${stem}.rollback.sql`),`begin;\nalter table public.ex_synthetic drop column id;\ndelete from supabase_migrations.schema_migrations where version = '${v}';\ncommit;\n`);
   const plan=prepareMigration({mode:'apply',version:v,runId:String(run++),root:tmp});
   assert.equal(plan.flow,'full');
   calls.length=0;
   const result=await runMigrationPlan(plan,query,{saveSnapshot});
   assert.equal(result.ok,false);
   assert.match(result.summary,/사후 확인 실패\. 이미 적용된 변경은 자동으로 되돌리지 않습니다/);
   assert.match(result.summary,/되돌리기 \(자동 실행 안 함 — 사용자 결정\)/);
   assert.match(result.summary,new RegExp(`docs/${stem}\\.rollback\\.sql`));
   assert.equal(await history(v),1,'stays applied');
   assert.ok(!calls.some(c=>/delete from supabase_migrations|drop column/.test(c.sql)),'rollback never sent');
  });

  await t.test('an already applied version is refused before any write',async()=>{
   const plan=prepareMigration({mode:'apply',version:'20261021200000',runId:String(run++),root});
   calls.length=0;
   const result=await runMigrationPlan(plan,query,{saveSnapshot});
   assert.equal(result.ok,false);
   assert.match(result.summary,/이미 적용된 version/);
   assert.equal(calls.length,1);assert.ok(calls[0].readOnly);
  });

  await t.test('web1 table is now read-only for anon; card rows unchanged',async()=>{
   const r=(await pool.query("select has_table_privilege('anon','public.main_project_archive_state','insert') i, has_table_privilege('anon','public.main_project_archive_state','select') s, (select count(*)::int from public.main_project_archive_state) n")).rows[0];
   assert.deepEqual(r,{i:false,s:true,n:2});
  });
 }finally{
  await pool?.end();
  if(adminPool){await adminPool.query('drop database if exists '+database+' with (force)').catch(()=>{});await adminPool.end();}
  if(cluster)await cluster.stop();
 }
});
