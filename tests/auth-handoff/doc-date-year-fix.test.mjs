// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic (no real titles or file names).
// WEEKLY-자료날짜 일괄 고침 DB(20261101011500_doc_date_year_fix): AI가 해를 잘못 붙인 것이 확실한 자료 날짜만 해를 바로잡는다.
// - 승인형 workflow 실행기(dry-run·apply)로 돌리고, 사전 확인의 고칠 수·확인 필요 수가 규칙대로 나온다.
// - 사람이 넣은 날짜·기록 없는 날짜·연도 둘·반대 근거·연도 없음·올린 뒤 먼 날짜·2월 29일은 고치지 않는다.
// - 옛 날짜는 비공개 표에만(RLS 켜짐·정책 없음·API 역할 권한 없음). 50건 넘으면 멈춤. 되돌리기는 옛 날짜 복원 + 표·기록 삭제.
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
import {fixture,OWNER,WS_A,WS_B} from './basket4-fixture.mjs';
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261101011500',name='doc_date_year_fix',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Production-like app_documents after 20261022100000 (field_origin with its check), owner RLS, anon revoked.
const documents=`
  create table public.app_documents(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.app_workspaces(id),
    project_id uuid,organization_id uuid,title text,category text,source text,document_date date,file_name text,visibility text default 'private',
    classification_note text,extracted_text text,extraction_status text default 'pending',extraction_error text,extracted_at timestamptz,
    field_origin jsonb not null default '{}'::jsonb,created_at timestamptz default now(),updated_at timestamptz default now(),
    constraint app_documents_field_origin_check check (jsonb_typeof(field_origin) = 'object'
      and (field_origin - array['title', 'category', 'source', 'document_date']) = '{}'::jsonb
      and not jsonb_path_exists(field_origin, 'strict $.* ? (@.type() != "string")')
      and not jsonb_path_exists(field_origin, 'strict $.* ? (@ != "ai" && @ != "user")')));
  alter table public.app_documents enable row level security;
  create policy task12a_owner_all on public.app_documents for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke all on public.app_documents from anon;
  revoke truncate, references, trigger on public.app_documents from authenticated;
  insert into supabase_migrations.schema_migrations(version,name) values('20261022100000','library_ai_fill');
`;
const AI={document_date:'ai'},USER={document_date:'user'};

test('doc date year fix: certain AI year mistakes only, counts, private backup, too-many stop, rollback',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'doc-date-fix-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(documents);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const doc=async(o)=>(await pool.query(`insert into public.app_documents(workspace_id,title,file_name,document_date,field_origin,extracted_text,extraction_status,created_at)
    values($1,$2,$3,$4,$5::jsonb,$6,$7,$8) returning id`,[o.ws??WS_A,o.title??'자료',o.file??'자료.pdf',o.date??null,JSON.stringify(o.origin??{}),o.text??null,o.status??'pending',o.at??'2026-10-30T03:00:00Z'])).rows[0].id;
  const day=async id=>(await pool.query('select document_date::text d from public.app_documents where id=$1',[id])).rows[0].d;
  const check=async sql=>Object.fromEntries((await pool.query(sql)).rows.map(r=>[r.item,r.value]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}

  // 고칠 것(확실): 같은 월·일로 다른 해가 하나만 적힘, AI가 넣은 날짜.
  const FIX_TITLE=await doc({title:'2025.10.26 가짜 성명',date:'2026-10-26',origin:AI});
  const FIX_FILE=await doc({title:'가짜 성명',file:'251026_가짜.pdf',date:'2026-10-26',origin:AI});
  const FIX_HEAD=await doc({title:'가짜 성명서',date:'2026-10-26',origin:AI,status:'ready',text:'가짜 노동조합\n2025년 10월 26일\n가짜 본문'});
  const FIX_B=await doc({ws:WS_B,title:'가짜-2025-03-05',date:'2026-03-05',origin:AI});
  // 고치지 않을 것.
  const KEEP={
   user:await doc({title:'2025.10.26 가짜',date:'2026-10-26',origin:USER}),
   noOrigin:await doc({title:'2025.10.26 가짜',date:'2026-10-26'}),
   twoYears:await doc({title:'2024.10.26 가짜 2025.10.26',date:'2026-10-26',origin:AI}),
   contra:await doc({title:'2025.10.26 가짜 2026 다시',date:'2026-10-26',origin:AI}),
   correct:await doc({title:'2026.10.26 가짜',date:'2026-10-26',origin:AI}),
   noYear:await doc({title:'10월 26일 가짜',date:'2026-10-26',origin:AI}),
   far:await doc({title:'가짜',date:'2027-03-01',origin:AI}),
   leap:await doc({title:'2020.02.29 가짜',date:'2024-02-29',origin:AI}),
   headPending:await doc({title:'가짜',date:'2026-10-26',origin:AI,status:'pending',text:'2025년 10월 26일'}),
   farFix:await doc({title:'2027.10.26 가짜',date:'2026-10-26',origin:AI}),
   otherDay:await doc({title:'2025.10.25 가짜',date:'2026-10-26',origin:AI}),
   noDate:await doc({title:'2025.10.26 가짜',origin:AI}),
  };
  const keepBefore=Object.fromEntries(await Promise.all(Object.entries(KEEP).map(async([k,id])=>[k,await day(id)])));
  const before=(await pool.query(snapshot)).rows;let pre;

  await t.test('files: read-only checks, three-line summary, expanded workflow accepts the file and backs up app_documents',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const p=plan(mode,'1');assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');assert.deepEqual(p.targets,['app_documents']);}
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|disable row level|\bgrant\b|\bto (anon|public|authenticated|service_role)\b|create policy|information_schema|rtw_/i);
   for(const sql of [precheck,postcheck,snapshot,rollbackSQL])assert.doesNotMatch(sql,/information_schema/i);
   // 공개 저장소: 확인 SQL은 제목·파일 이름·본문 칸을 결과로 내보내지 않는다(건수·예/아니오·해시만).
   for(const r of (await pool.query(precheck)).rows)assert.match(r.value,/^(예|아니오|[0-9]+|[0-9a-f]{32})$/,r.item);
  });

  await t.test('precheck: 4 certain fixes and the needs-check counts',async()=>{
   pre=await check(precheck);
   for(const k of ['prerequisite recorded','new migration absent','fix table absent','RLS enabled'])assert.equal(pre[k],'예',k);
   assert.equal(pre['anon or public table privilege'],'아니오');
   assert.equal(pre['dates to fix'],'4');
   // other year: noOrigin·twoYears·contra·leap·farFix·otherDay / ai without year: noYear·headPending·otherDay / not by ai: noOrigin / long after upload: far
   assert.equal(pre['needs check other year'],'6');
   assert.equal(pre['needs check ai date without year'],'3');
   assert.equal(pre['needs check date not set by ai'],'1');
   assert.equal(pre['needs check date long after upload'],'1');
   assert.equal(pre['needs check total'],'9');
   assert.equal(pre['documents rows'],'16');assert.equal(pre['documents with date'],'15');
  });

  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await runMigrationPlan(plan('dry-run','9701'),query,{saveSnapshot:async()=>{}});assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await check(precheck),pre);
   assert.equal(await day(FIX_TITLE),'2026-10-26');assert.equal(await history(),0);
  });

  await t.test('apply: only the 4 certain dates change year, private table keeps old dates, postcheck passes',async()=>{
   const result=await runMigrationPlan(plan('apply','9702'),query,{saveSnapshot:async()=>{}});assert.equal(result.ok,true,result.summary);
   assert.doesNotMatch(result.summary.split('사후 확인')[1]??'',/\| 아니오 \|/);
   assert.equal(await history(),1);
   assert.equal(await day(FIX_TITLE),'2025-10-26');assert.equal(await day(FIX_FILE),'2025-10-26');
   assert.equal(await day(FIX_HEAD),'2025-10-26');assert.equal(await day(FIX_B),'2025-03-05');
   for(const [k,id] of Object.entries(KEEP))assert.equal(await day(id),keepBefore[k],k);
   const fixes=(await pool.query('select document_id,old_document_date::text o,new_document_date::text n from public.app_document_date_fixes order by n,document_id')).rows;
   assert.equal(fixes.length,4);assert.ok(fixes.every(f=>f.o.slice(4)===f.n.slice(4)&&f.o.slice(0,4)==='2026'&&f.n.slice(0,4)==='2025'));
   const post=await check(postcheck);
   for(const k of ['fix agrees with history','fix table locked','RLS still enabled','no anon or public table privilege'])assert.equal(post[k],'예',k);
   for(const k of ['documents rows','documents with date','constraints hash','policies hash','owner RLS grants hash','column grants hash','triggers hash'])assert.equal(post[k],pre[k],k);
   // 같은 규칙으로 다시 세면 고칠 것 0, 확인 필요 수는 그대로.
   const again=await check(precheck);assert.equal(again['dates to fix'],'0');assert.equal(again['needs check total'],pre['needs check total']);
   await assert.rejects(pool.query(migration),/DOC_DATE_YEAR_FIX_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  await t.test('fix table: owner login, anon and service_role cannot read or write it',async()=>{
   for(const role of ['authenticated','anon','service_role'])
    await assert.rejects(as(role,OWNER,c=>c.query('select count(*) from public.app_document_date_fixes')),/permission denied/,role);
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_document_date_fixes(document_id,workspace_id,old_document_date,new_document_date) values (gen_random_uuid(),$1,'2026-01-01','2025-01-01')",[WS_A])),/permission denied/);
  });

  await t.test('rollback stops when a fixed date was changed afterwards, then restores the old dates',async()=>{
   await pool.query("update public.app_documents set document_date='2025-10-27' where id=$1",[FIX_TITLE]);
   await assert.rejects(pool.query(rollbackSQL),/DOC_DATE_YEAR_FIX_ROLLBACK_BLOCKED/);await pool.query('rollback');
   await pool.query("update public.app_documents set document_date='2025-10-26' where id=$1",[FIX_TITLE]);
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.equal((await pool.query("select to_regclass('public.app_document_date_fixes') is null as gone")).rows[0].gone,true);
   for(const id of [FIX_TITLE,FIX_FILE,FIX_HEAD])assert.equal(await day(id),'2026-10-26');
   assert.equal(await day(FIX_B),'2026-03-05');
   const post=await check(postcheck);assert.equal(post['fix agrees with history'],'예');assert.equal(post['fix table locked'],'예');
   assert.deepEqual(await check(precheck),pre);
  });

  await t.test('more than 50 certain fixes: precheck out of range and apply stops without a change',async()=>{
   for(let i=0;i<47;i++)await doc({title:'2025.09.10 가짜 '+i,date:'2026-09-10',origin:AI});
   const v=await check(precheck);assert.equal(v['dates to fix'],'51');
   const result=await runMigrationPlan(plan('apply','9703'),query,{saveSnapshot:async()=>{}});assert.equal(result.ok,false);
   await assert.rejects(pool.query(migration),/DOC_DATE_YEAR_FIX_TOO_MANY/);await pool.query('rollback');
   assert.equal(await history(),0);assert.equal(await day(FIX_TITLE),'2026-10-26');
   assert.equal((await pool.query("select to_regclass('public.app_document_date_fixes') is null as gone")).rows[0].gone,true);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
