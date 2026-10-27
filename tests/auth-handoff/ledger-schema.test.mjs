// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic
// (no real organisation, case or ledger ids). S7-a: 20261021082000_ledger_schema — ledger tables, owner RLS,
// fixed lists, id counters, candidates, audit and app_ledger_search. SQL Editor only (policies and triggers).
// Optional: LEDGER_PG_PORT=<port> runs the same checks on an already running local server (user postgres, trust auth).
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,PROJECT_B,ORG_A,ORG_B,MEETING_A} from './basket4-fixture.mjs';
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
const version='20261021082000',name='ledger_schema',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const externalPort=process.env.LEDGER_PG_PORT;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const sha=c=>c.repeat(64);
const PREFIX={event:'EVT',change:'CHG',decision:'DEC',evidence:'EVD',commitment:'COM',source:'SRC',organization:'ORG',topic:'TOP'};

test('S7-a ledger schema: prechecks, apply, owner-only access, fixed lists, ids, references, candidates, audit, search, rollback',{timeout:120000},async t=>{
 let cluster,pool,adminPool,database='postgres',port,password;
 if(externalPort){
  port=Number(externalPort);database='ledger_'+randomBytes(4).toString('hex');
  adminPool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres',ssl:false}));
  await adminPool.query('create database '+database);
  for(const role of ['anon','authenticated','public_probe','service_role'])await adminPool.query(`drop role if exists ${role}`).catch(()=>{});
 }else{
  const directory=await mkdtemp(join(tmpdir(),'ledger-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));port=sock.address().port;await new Promise(r=>sock.close(r));
  password=randomBytes(24).toString('hex');
  cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
  await cluster.initialise();await cluster.start();
 }
 try{
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database,ssl:false}));
  await pool.query(fixture);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const summary=await read('docs/'+stem+'.summary.md');
  const v=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value??r.ok]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const q=(sql,args)=>owner(c=>c.query(sql,args));
  const one=async(sql,args)=>(await q(sql,args)).rows[0];
  const before=(await pool.query(snapshot)).rows;

  await t.test('files: read-only checks, summary 3 lines, SQL Editor only, no definer/anon/rtw',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   assert.equal(prepareMigration({mode:'apply',version,runId:'1',root}).rules,'expanded'); // DB-승인형확장
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|\bto (anon|public|service_role)\b|disable row level|rtw_|alter table public\.app_(?!ledger_)|\bdrop /i);
   assert.equal((code.match(/security invoker\s+set search_path = ''/g)||[]).length,6);
   assert.match(code,/^begin;/);assert.match(code,/commit;\s*$/);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261021082000', 'ledger_schema'/);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/delete from public|update public|truncate|cascade|grant |policy/i);
  });
  await t.test('precheck before apply: prerequisites 예; snapshot shows absent tables',async()=>{
   const pre=v((await pool.query(precheck)).rows);
   for(const k of ['new migration absent','no app_ledger table yet','no app_ledger function yet','owner check function (security definer)','workspaces table','spaces table','suborganizations table','meetings table','PostgreSQL 15 or newer (unique nulls not distinct)'])assert.equal(pre[k],'예',k);
   assert.equal(pre['owner member count'],'2');
   assert.deepEqual(before.filter(r=>r.kind==='table').map(r=>r.definition),Array(10).fill('absent'));
   assert.equal(before.filter(r=>r.kind==='ledger function').length,0);
  });
  await t.test('prerequisite guard stops when the owner check function is missing',async()=>{
   const c=await pool.connect();
   try{await c.query('begin');await c.query('alter function private.app_is_workspace_owner(uuid) rename to app_is_workspace_owner_x');await c.query('savepoint s');
    await assert.rejects(c.query(migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/LEDGER_SCHEMA_PREREQUISITE_CHANGED/);}
   finally{await c.query('rollback');c.release();}
   assert.equal(await history(),0);
  });
  await t.test('apply once: postcheck all 예; second apply refused and history stays 1',async()=>{
   await pool.query(migration);
   assert.equal(await history(),1);
   for(const [k,val] of Object.entries(v((await pool.query(postcheck)).rows)))assert.equal(val,'예',k);
   await assert.rejects(pool.query(migration),/LEDGER_SCHEMA_PREREQUISITE_CHANGED/);await pool.query('rollback');
   assert.equal(await history(),1);
  });

  // Synthetic id prefixes (same shape as the sheet: tab prefix + number).
  for(const [ws,who] of [[WS_A,owner],[WS_B,stranger]])
   await who(c=>c.query(`insert into public.app_ledger_id_counters(workspace_id,scope,prefix) select $1,k,v from jsonb_each_text($2::jsonb) e(k,v)`,[ws,JSON.stringify(PREFIX)]));

  let imp,topic,org,orgB,src1,src2,evt,chg,dec,evd,com,oldDec;
  await t.test('import batch: legacy ids kept; new rows get the next number; no reuse and no other shape',async()=>{
   imp=(await one(`insert into public.app_ledger_imports(workspace_id,label,source_kind,file_sha256,row_counts) values($1,'시험 가져오기','sheet_csv',$2,'{"records":5}') returning id`,[WS_A,sha('a')])).id;
   topic=(await one(`insert into public.app_ledger_topics(workspace_id,ledger_id,name,aliases,project_id,import_id) values($1,'TOP-0903','가상 철도 주제',array['가상선','테스트선'],$2,$3) returning id`,[WS_A,PROJECT_A,imp])).id;
   org=(await one(`insert into public.app_ledger_organizations(workspace_id,ledger_id,name,aliases,suborganization_id,import_id) values($1,'ORG-0907','가 지부',array['가지부'],$2,$3) returning id`,[WS_A,ORG_A,imp])).id;
   src1=(await one(`insert into public.app_ledger_sources(workspace_id,ledger_id,title,doc_type,source_date,processing_status,import_id) values($1,'SRC-0910','가상 회의자료','meeting_material','2026-03-02','partial',$2) returning id`,[WS_A,imp])).id;
   src2=(await one(`insert into public.app_ledger_sources(workspace_id,ledger_id,title,doc_type,sensitivity,import_id) values($1,'SRC-0911','가상 통화 전사','call_transcript','S2',$2) returning id`,[WS_A,imp])).id;
   evt=(await one(`insert into public.app_ledger_records(workspace_id,kind,ledger_id,title,summary,event_status,date_start,date_precision,topic_id,import_id) values($1,'event','EVT-0912','가상 노선 운영 변경','가상 노선의 운영 방식이 바뀜','tracking','2026-03-01','month',$2,$3) returning id`,[WS_A,topic,imp])).id;
   chg=(await one(`insert into public.app_ledger_records(workspace_id,kind,ledger_id,title,date_start,date_precision,import_id) values($1,'change','CHG-0904','가상 노선 1차 협의','2026-03-15','day',$2) returning id`,[WS_A,imp])).id;
   oldDec=(await one(`insert into public.app_ledger_records(workspace_id,kind,ledger_id,title,date_start,date_end,date_precision,date_note,import_id) values($1,'decision','DEC-0901','옛 가상 방침','2025-01-01','2025-12-31','range','2025년 중',$2) returning id`,[WS_A,imp])).id;
   dec=(await one(`insert into public.app_ledger_records(workspace_id,kind,ledger_id,title,decision_type,decision_reason,date_start,date_precision,sensitivity,import_id) values($1,'decision','DEC-0902','가상 대응 방침','adopted','시험용 이유','2026-04-01','day','S2',$2) returning id`,[WS_A,imp])).id;
   evd=(await one(`insert into public.app_ledger_records(workspace_id,kind,ledger_id,title,evidence_type,confidence,verification,import_id) values($1,'evidence','EVD-0920','가상 통계 근거','statistics','high','partial',$2) returning id`,[WS_A,imp])).id;
   com=(await one(`insert into public.app_ledger_records(workspace_id,kind,ledger_id,title,counterparty,commitment_status,follow_up_on,import_id) values($1,'commitment','COM-0903','가상 기관 자료 제공 약속','가상 기관','waiting','2026-05-01',$2) returning id`,[WS_A,imp])).id;
   // New rows without an id: next number after the highest imported one, 4 digits.
   const next=await one(`insert into public.app_ledger_records(workspace_id,kind,title,event_status) values($1,'event','새 가상 사건','watching') returning ledger_id`,[WS_A]);
   assert.equal(next.ledger_id,'EVT-0913');
   assert.equal((await one(`insert into public.app_ledger_sources(workspace_id,title) values($1,'새 가상 출처') returning ledger_id`,[WS_A])).ledger_id,'SRC-0912');
   // A typed id is only accepted inside an import, with the scope prefix and canonical shape.
   await assert.rejects(q(`insert into public.app_ledger_records(workspace_id,kind,ledger_id,title,event_status) values($1,'event','EVT-0990','손으로 쓴 번호','tracking')`,[WS_A]),/LEDGER_ID_ASSIGNED_BY_DB/);
   await assert.rejects(q(`insert into public.app_ledger_records(workspace_id,kind,ledger_id,title,event_status,import_id) values($1,'event','DEC-0990','다른 접두어','tracking',$2)`,[WS_A,imp]),/LEDGER_ID_FORMAT/);
   await assert.rejects(q(`insert into public.app_ledger_records(workspace_id,kind,ledger_id,title,event_status,import_id) values($1,'event','EVT-00912','같은 번호 다른 모양','tracking',$2)`,[WS_A,imp]),/LEDGER_ID_FORMAT/);
   await assert.rejects(q(`insert into public.app_ledger_records(workspace_id,kind,ledger_id,title,event_status,import_id) values($1,'event','EVT-0912','같은 번호','tracking',$2)`,[WS_A,imp]),{code:'23505'});
   // An imported lower number does not move the counter back; the counter can never decrease.
   await q(`insert into public.app_ledger_records(workspace_id,kind,ledger_id,title,event_status,import_id) values($1,'event','EVT-0902','빈 번호 채우기','closed',$2)`,[WS_A,imp]);
   assert.equal((await one(`insert into public.app_ledger_records(workspace_id,kind,title,event_status) values($1,'event','다음 가상 사건','watching') returning ledger_id`,[WS_A])).ledger_id,'EVT-0914');
   await assert.rejects(q(`update public.app_ledger_id_counters set last_number=1 where workspace_id=$1 and scope='event'`,[WS_A]),/LEDGER_ID_COUNTER_DECREASE/);
   await assert.rejects(q(`update public.app_ledger_records set ledger_id='EVT-0999' where id=$1`,[evt]),{code:'42501'});
   // Another workspace has its own counter.
   assert.equal((await stranger(c=>c.query(`insert into public.app_ledger_records(workspace_id,kind,title,event_status) values($1,'event','남의 가상 사건','tracking') returning ledger_id`,[WS_B]))).rows[0].ledger_id,'EVT-0001');
  });
  await t.test('links and record-source rows; broken or foreign references are refused',async()=>{
   await q(`insert into public.app_ledger_record_sources(workspace_id,record_id,source_id,locator,import_id) values($1,$2,$3,'3쪽',$4),($1,$2,$5,'00:12',$4),($1,$6,$3,'',$4)`,[WS_A,evt,src1,imp,src2,dec]);
   await q(`insert into public.app_ledger_links(workspace_id,record_id,target_record_id,relation,import_id) values($1,$2,$3,'belongs_to',$4),($1,$5,$3,'follow_up',$4),($1,$6,$5,'supports',$4)`,[WS_A,chg,evt,imp,dec,evd]);
   await q(`insert into public.app_ledger_links(workspace_id,record_id,target_organization_id,relation,import_id) values($1,$2,$3,'direct',$4),($1,$5,$3,'counterpart',$4)`,[WS_A,evt,org,imp,com]);
   await q(`insert into public.app_ledger_links(workspace_id,record_id,target_project_id,relation) values($1,$2,$3,'related')`,[WS_A,dec,PROJECT_A]);
   await q(`insert into public.app_ledger_links(workspace_id,record_id,target_meeting_id,relation) values($1,$2,$3,'related')`,[WS_A,chg,MEETING_A]);
   const missing='29000000-0000-4000-8000-000000000099';
   await assert.rejects(q(`insert into public.app_ledger_links(workspace_id,record_id,target_record_id,relation) values($1,$2,$3,'related')`,[WS_A,evt,missing]),{code:'23503'});
   await assert.rejects(q(`insert into public.app_ledger_record_sources(workspace_id,record_id,source_id) values($1,$2,$3)`,[WS_A,evt,missing]),{code:'23503'});
   await assert.rejects(q(`insert into public.app_ledger_records(workspace_id,kind,title,event_status,import_id) values($1,'event','x','tracking',$2)`,[WS_A,missing]),{code:'23503'});
   // As the table owner (no RLS), foreign keys still refuse a missing row.
   await assert.rejects(pool.query(`insert into public.app_ledger_links(workspace_id,record_id,target_record_id,relation) values($1,$2,$3,'related')`,[WS_A,evt,missing]),{code:'23503'});
   await assert.rejects(pool.query(`insert into public.app_ledger_records(workspace_id,kind,title,event_status,topic_id) values($1,'event','x','tracking',$2)`,[WS_A,missing]),{code:'23503'});
   // Another workspace's project, organisation or record cannot be linked.
   await assert.rejects(q(`insert into public.app_ledger_links(workspace_id,record_id,target_project_id,relation) values($1,$2,$3,'related')`,[WS_A,evt,PROJECT_B]),{code:'42501'});
   await assert.rejects(q(`insert into public.app_ledger_organizations(workspace_id,name,suborganization_id) values($1,'남의 조직 연결',$2)`,[WS_A,ORG_B]),{code:'42501'});
   const foreign=(await stranger(c=>c.query(`select id from public.app_ledger_records where workspace_id=$1 limit 1`,[WS_B]))).rows[0].id;
   await assert.rejects(q(`insert into public.app_ledger_links(workspace_id,record_id,target_record_id,relation) values($1,$2,$3,'related')`,[WS_A,evt,foreign]),{code:'23503'});
   await assert.rejects(q(`insert into public.app_ledger_records(workspace_id,kind,title,decision_type,validity,superseded_by) values($1,'decision','x','adopted','superseded',$2)`,[WS_A,foreign]),{code:'23503'});
   // Even as the table owner (no RLS) a record cannot point at another workspace's record.
   await assert.rejects(pool.query(`insert into public.app_ledger_record_sources(workspace_id,record_id,source_id) values($1,$2,$3)`,[WS_B,evt,src1]),{code:'23503'});
   // Relation lists depend on the target; exactly one target; no self link; no duplicate.
   await assert.rejects(q(`insert into public.app_ledger_links(workspace_id,record_id,target_organization_id,relation) values($1,$2,$3,'supports')`,[WS_A,dec,org]),{code:'23514'});
   await assert.rejects(q(`insert into public.app_ledger_links(workspace_id,record_id,target_record_id,relation) values($1,$2,$3,'direct')`,[WS_A,dec,evt]),{code:'23514'});
   await assert.rejects(q(`insert into public.app_ledger_links(workspace_id,record_id,target_record_id,target_project_id,relation) values($1,$2,$3,$4,'related')`,[WS_A,dec,evt,PROJECT_A]),{code:'23514'});
   await assert.rejects(q(`insert into public.app_ledger_links(workspace_id,record_id,target_record_id,relation) values($1,$2,$2,'related')`,[WS_A,evt]),{code:'23514'});
   await assert.rejects(q(`insert into public.app_ledger_links(workspace_id,record_id,target_record_id,relation) values($1,$2,$3,'belongs_to')`,[WS_A,chg,evt]),{code:'23505'});
   // One Web2 organisation maps to one ledger organisation.
   await assert.rejects(q(`insert into public.app_ledger_organizations(workspace_id,name,suborganization_id) values($1,'두 번째 연결',$2)`,[WS_A,ORG_A]),{code:'23505'});
   orgB=(await one(`insert into public.app_ledger_organizations(workspace_id,name) values($1,'나 지부') returning id, ledger_id`,[WS_A]));
   assert.equal(orgB.ledger_id,'ORG-0908');orgB=orgB.id;
  });
  await t.test('fixed lists and kind-specific fields are enforced',async()=>{
   const bad=[
    [`insert into public.app_ledger_records(workspace_id,kind,title) values($1,'memo','x')`,'unknown kind'],
    [`insert into public.app_ledger_records(workspace_id,kind,title,event_status,importance) values($1,'event','x','tracking','medium')`,'importance 중간'],
    [`insert into public.app_ledger_records(workspace_id,kind,title,event_status,validity) values($1,'event','x','tracking','valid')`,'validity 유효'],
    [`insert into public.app_ledger_records(workspace_id,kind,title,evidence_type,confidence) values($1,'evidence','x','law','partial')`,'confidence 부분확인'],
    [`insert into public.app_ledger_records(workspace_id,kind,title,event_status,sensitivity) values($1,'event','x','tracking','S3')`,'S3 never stored'],
    [`insert into public.app_ledger_records(workspace_id,kind,title,event_status,scope) values($1,'event','x','tracking','hobby')`,'scope'],
    [`insert into public.app_ledger_records(workspace_id,kind,title) values($1,'event','x')`,'event without status'],
    [`insert into public.app_ledger_records(workspace_id,kind,title,event_status) values($1,'change','x','tracking')`,'status on change'],
    [`insert into public.app_ledger_records(workspace_id,kind,title,decision_type) values($1,'event','x','adopted')`,'decision type on event'],
    [`insert into public.app_ledger_records(workspace_id,kind,title,evidence_type) values($1,'evidence','x','rumour')`,'evidence type'],
    [`insert into public.app_ledger_records(workspace_id,kind,title,counterparty) values($1,'commitment','x','가상 기관')`,'commitment without status'],
    [`insert into public.app_ledger_records(workspace_id,kind,title,event_status,follow_up_on) values($1,'event','x','tracking','2026-05-01')`,'follow-up on event'],
    [`insert into public.app_ledger_records(workspace_id,kind,title,event_status,date_precision) values($1,'event','x','tracking','day')`,'day without date'],
    [`insert into public.app_ledger_records(workspace_id,kind,title,event_status,date_start,date_precision) values($1,'event','x','tracking','2026-03-05','month')`,'month not on day 1'],
    [`insert into public.app_ledger_records(workspace_id,kind,title,event_status,date_start,date_end,date_precision) values($1,'event','x','tracking','2026-03-05','2026-03-01','range')`,'range backwards'],
    [`insert into public.app_ledger_records(workspace_id,kind,title,event_status,date_start) values($1,'event','x','tracking','2026-03-05')`,'date with unknown precision'],
    [`insert into public.app_ledger_records(workspace_id,kind,title,event_status,validity) values($1,'event','x','tracking','superseded')`,'superseded without replacement'],
    [`insert into public.app_ledger_records(workspace_id,kind,title,event_status) values($1,'event','  ','tracking')`,'blank title'],
    [`insert into public.app_ledger_sources(workspace_id,title,doc_type) values($1,'x','blog')`,'doc type'],
    [`insert into public.app_ledger_sources(workspace_id,title,processing_status) values($1,'x','half')`,'processing'],
    [`insert into public.app_ledger_sources(workspace_id,title,drive_file_id) values($1,'x','../../etc')`,'drive id'],
    [`insert into public.app_ledger_candidates(workspace_id,origin,kind,title) values($1,'chatgpt','event','x')`,'origin'],
    [`insert into public.app_ledger_candidates(workspace_id,origin,kind,title) values($1,'claude_import','event','x')`,'claude import without batch'],
    [`insert into public.app_ledger_candidates(workspace_id,origin,kind,title,action) values($1,'user','event','x','update')`,'update without target'],
    [`insert into public.app_ledger_imports(workspace_id,label,source_kind,file_sha256) values($1,'x','csv','abc')`,'import kind and hash'],
    [`insert into public.app_ledger_audit(workspace_id,event) values($1,'edit')`,'audit event'],
   ];
   for(const [sql,label] of bad)await assert.rejects(q(sql,[WS_A]),{code:'23514'},label);
   // Superseding keeps the old record and records why; the old one leaves default search.
   await q(`update public.app_ledger_records set validity='superseded', superseded_by=$2, supersede_reason='시험: 새 방침으로 대체' where id=$1`,[oldDec,dec]);
   await assert.rejects(q(`update public.app_ledger_records set superseded_by=id, validity='superseded' where id=$1`,[dec]),{code:'23514'});
  });
  await t.test('owner only: another owner, anon and service_role see and change nothing',async()=>{
   const tables=['imports','id_counters','topics','organizations','sources','records','record_sources','links','candidates','audit'];
   for(const tb of tables){
    assert.equal((await stranger(c=>c.query(`select count(*)::int n from public.app_ledger_${tb} where workspace_id=$1`,[WS_A]))).rows[0].n,0,tb);
    await assert.rejects(as('anon','',c=>c.query(`select 1 from public.app_ledger_${tb} limit 1`)),{code:'42501'},tb);
    await assert.rejects(as('service_role','',c=>c.query(`select 1 from public.app_ledger_${tb} limit 1`)),{code:'42501'},tb);
   }
   assert.equal((await stranger(c=>c.query(`update public.app_ledger_records set title='남이 고침' where id=$1`,[evt]))).rowCount,0);
   assert.equal((await stranger(c=>c.query(`delete from public.app_ledger_links where workspace_id=$1`,[WS_A]))).rowCount,0);
   await assert.rejects(stranger(c=>c.query(`insert into public.app_ledger_records(workspace_id,kind,title,event_status) values($1,'event','남이 넣음','tracking')`,[WS_A])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query(`insert into public.app_ledger_candidates(workspace_id,origin,kind,title) values($1,'user','event','남의 후보')`,[WS_A])),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query(`select * from public.app_ledger_search('가상')`)),{code:'42501'});
   await assert.rejects(as('service_role','',c=>c.query(`select * from public.app_ledger_search('가상')`)),{code:'42501'});
   for(const fn of ['app_ledger_assign_id()','app_ledger_touch()','app_ledger_audit_change()'])
    assert.equal((await pool.query(`select has_function_privilege('authenticated','private.${fn}','execute') a`)).rows[0].a,false,fn);
  });
  await t.test('candidates: three origins, decided once, S3 never stored, decisions audited',async()=>{
   const cImp=(await one(`insert into public.app_ledger_imports(workspace_id,label,source_kind,file_sha256) values($1,'가상 대화 묶음','claude_file',$2) returning id`,[WS_A,sha('c')])).id;
   const c1=(await one(`insert into public.app_ledger_candidates(workspace_id,origin,kind,title,payload,dedup_key) values($1,'web2_ai','event','가상 후보 1','{"summary":"요지"}','2026-04-02|ORG-0907|가상') returning id`,[WS_A])).id;
   const c2=(await one(`insert into public.app_ledger_candidates(workspace_id,origin,kind,title,import_id,action,target_record_id) values($1,'claude_import','evidence','가상 후보 2',$2,'add_source',$3) returning id`,[WS_A,cImp,evd])).id;
   await assert.rejects(q(`insert into public.app_ledger_candidates(workspace_id,origin,kind,title,sensitivity) values($1,'user','event','가상 민감 후보','S3')`,[WS_A]),{code:'23514'});
   const c3=(await one(`insert into public.app_ledger_candidates(workspace_id,origin,kind,title) values($1,'user','event','가상 셋째 후보') returning id`,[WS_A])).id;
   await assert.rejects(q(`insert into public.app_ledger_candidates(workspace_id,origin,kind,title,dedup_key) values($1,'web2_ai','event','같은 열쇠','2026-04-02|ORG-0907|가상')`,[WS_A]),{code:'23505'});
   const rec=(await one(`insert into public.app_ledger_records(workspace_id,kind,title,event_status) values($1,'event','가상 후보 1','tracking') returning id`,[WS_A])).id;
   await q(`update public.app_ledger_candidates set status='confirmed', result_record_id=$2, decided_at=now() where id=$1`,[c1,rec]);
   await q(`update public.app_ledger_candidates set status='discarded', discard_reason='중복', decided_at=now() where id=$1`,[c2]);
   await assert.rejects(q(`update public.app_ledger_candidates set status='confirmed', decided_at=now() where id=$1`,[c3]),{code:'23514'}); // confirmed needs a record
   await assert.rejects(q(`update public.app_ledger_candidates set status='discarded' where id=$1`,[c3]),{code:'23514'}); // decided needs a time
   await assert.rejects(q(`update public.app_ledger_candidates set title='고침' where id=$1`,[c1]),/LEDGER_ALREADY_DECIDED/);
   await assert.rejects(q(`update public.app_ledger_candidates set status='pending', decided_at=null where id=$1`,[c2]),/LEDGER_ALREADY_DECIDED/);
   await q(`update public.app_ledger_candidates set status='discarded', discard_reason='필요 없음', decided_at=now() where id=$1`,[c3]);
   await assert.rejects(q(`delete from public.app_ledger_candidates where id=$1`,[c1]),{code:'42501'});
   const audit=(await q(`select event, detail->'before'->>'status' s from public.app_ledger_audit where target_table='candidates' order by created_at`)).rows;
   assert.deepEqual(audit.map(r=>[r.event,r.s]),[['candidate_decided','pending'],['candidate_decided','pending'],['candidate_decided','pending']]);
   // After a decision the same dedup key can be proposed again (only one pending at a time).
   await q(`insert into public.app_ledger_candidates(workspace_id,origin,kind,title,dedup_key) values($1,'web2_ai','event','다시 올라온 후보','2026-04-02|ORG-0907|가상')`,[WS_A]);
  });
  await t.test('audit: edits keep the previous values; audit is append-only; legacy write requests stored once',async()=>{
   await q(`update public.app_ledger_records set summary='고친 요지', importance='high' where id=$1`,[evt]);
   const row=await one(`select event,target_table,detail from public.app_ledger_audit where target_id=$1 and event='row_update' order by created_at desc limit 1`,[evt]);
   assert.equal(row.target_table,'records');
   assert.deepEqual(row.detail.before,{summary:'가상 노선의 운영 방식이 바뀜',importance:'normal'});
   const upd=await one(`select updated_at>created_at changed from public.app_ledger_records where id=$1`,[evt]);assert.equal(upd.changed,true);
   await assert.rejects(q(`update public.app_ledger_audit set detail='{}' where target_id=$1`,[evt]),{code:'42501'});
   assert.equal((await q(`delete from public.app_ledger_audit where target_id=$1`,[evt])).rowCount,0);
   await q(`insert into public.app_ledger_audit(workspace_id,event,legacy_id,import_id,occurred_at,detail) values($1,'legacy_write_request','WR-0901',$2,'2026-03-03','{"status":"완료"}')`,[WS_A,imp]);
   await assert.rejects(q(`insert into public.app_ledger_audit(workspace_id,event,legacy_id,import_id) values($1,'legacy_write_request','WR-0901',$2)`,[WS_A,imp]),{code:'23505'});
   await assert.rejects(q(`insert into public.app_ledger_audit(workspace_id,event,legacy_id) values($1,'note','not an id')`,[WS_A]),{code:'23514'});
  });
  await t.test('search: words, ids, aliases, organisation, topic, period, sensitivity, scope, inactive, kinds; owner only',async()=>{
   const s=async(args,who=owner)=>(await who(c=>c.query(`select * from public.app_ledger_search(${args})`))).rows.map(r=>r.ledger_id).sort();
   assert.deepEqual(await s(`'가상 노선'`),['CHG-0904','EVT-0912']);
   assert.deepEqual(await s(`'evt-0912'`),['EVT-0912']);
   assert.deepEqual(await s(`'테스트선'`),['EVT-0912']); // topic alias
   assert.deepEqual(await s(`'가지부'`),['COM-0903','EVT-0912']); // organisation alias via link
   assert.deepEqual(await s(`'SRC-0911'`),['EVT-0912']); // linked source id
   assert.deepEqual(await s(`'회의자료'`),['DEC-0902','EVT-0912']); // linked source title
   assert.deepEqual(await s(`'',p_organization_id=>'${org}'`),['COM-0903','EVT-0912']);
   assert.deepEqual(await s(`'',p_organization_id=>'${ORG_A}'`),['COM-0903','EVT-0912']); // Web2 organisation id
   assert.deepEqual(await s(`'',p_topic_id=>'${topic}'`),['EVT-0912']);
   assert.deepEqual(await s(`'',p_date_from=>'2026-03-10',p_date_to=>'2026-03-31'`),['CHG-0904']);
   assert.deepEqual(await s(`'방침'`),['DEC-0902']);
   assert.deepEqual(await s(`'방침',p_include_inactive=>true`),['DEC-0901','DEC-0902']);
   assert.deepEqual(await s(`'방침',p_max_sensitivity=>'S1'`),[]);
   assert.deepEqual(await s(`'',p_kinds=>array['commitment']`),['COM-0903']);
   await q(`update public.app_ledger_records set scope='interest' where id=$1`,[com]);
   assert.deepEqual(await s(`'',p_kinds=>array['commitment']`),[]);
   assert.deepEqual(await s(`'',p_kinds=>array['commitment'],p_scope=>'interest'`),['COM-0903']);
   assert.deepEqual(await s(`'',p_kinds=>array['commitment'],p_scope=>null`),['COM-0903']);
   assert.deepEqual(await s(`'50%_'`),[]); // no wildcard meaning
   const top=(await q(`select ledger_id,score,organizations from public.app_ledger_search('가상 노선 운영')`)).rows;
   assert.equal(top[0].ledger_id,'EVT-0912');assert.deepEqual(top[0].organizations,['가 지부']);
   assert.equal((await q(`select count(*)::int n from public.app_ledger_search('', p_limit=>2)`)).rows[0].n,2);
   for(const [args,msg] of [[`repeat('가',201)`,'BAD_QUERY'],[`'x',p_limit=>0`,'BAD_LIMIT'],[`'x',p_max_sensitivity=>'S3'`,'BAD_SENSITIVITY'],[`'x',p_kinds=>array['memo']`,'BAD_KIND'],[`'x',p_date_from=>'2026-02-01',p_date_to=>'2026-01-01'`,'BAD_PERIOD'],[`'x',p_scope=>'all'`,'BAD_SCOPE']])
    await assert.rejects(q(`select * from public.app_ledger_search(${args})`),new RegExp('LEDGER_SEARCH_'+msg));
   assert.deepEqual(await s(`'가상'`,stranger),['EVT-0001']);
  });
  await t.test('import batch: same file refused while applied; revert deletes only unedited rows of an unconfirmed batch',async()=>{
   await assert.rejects(q(`insert into public.app_ledger_imports(workspace_id,label,source_kind,file_sha256) values($1,'같은 파일','sheet_csv',$2)`,[WS_A,sha('a')]),{code:'23505'});
   // Hand-made rows (no batch) and edited imported rows cannot be deleted.
   const hand=(await one(`select id from public.app_ledger_records where ledger_id='EVT-0913' and workspace_id=$1`,[WS_A])).id;
   assert.equal((await q(`delete from public.app_ledger_records where id=$1`,[hand])).rowCount,0);
   assert.equal((await q(`delete from public.app_ledger_records where id=$1`,[evt])).rowCount,0); // edited above
   // Editing inside the same transaction as the insert also counts as edited.
   const b0=(await one(`insert into public.app_ledger_imports(workspace_id,label,source_kind,file_sha256) values($1,'같은 거래 고침','sheet_csv',$2) returning id`,[WS_A,sha('d')])).id;
   await owner(async c=>{
    const r=(await c.query(`insert into public.app_ledger_records(workspace_id,kind,ledger_id,title,event_status,import_id) values($1,'event','EVT-0940','바로 고친 사건','tracking',$2) returning id`,[WS_A,b0])).rows[0].id;
    await c.query(`update public.app_ledger_records set title='바로 고침' where id=$1`,[r]);
    assert.equal((await c.query(`delete from public.app_ledger_records where id=$1`,[r])).rowCount,0);
   });
   // A second batch: applied → revert (delete its unedited rows) → reverted; the same file may then be imported again.
   const b2=(await one(`insert into public.app_ledger_imports(workspace_id,label,source_kind,file_sha256) values($1,'둘째 묶음','sheet_csv',$2) returning id`,[WS_A,sha('b')])).id;
   const r2=(await one(`insert into public.app_ledger_records(workspace_id,kind,ledger_id,title,event_status,import_id) values($1,'event','EVT-0950','되돌릴 가상 사건','tracking',$2) returning id`,[WS_A,b2])).id;
   const s2=(await one(`insert into public.app_ledger_sources(workspace_id,ledger_id,title,import_id) values($1,'SRC-0950','되돌릴 가상 출처',$2) returning id`,[WS_A,b2])).id;
   await q(`insert into public.app_ledger_record_sources(workspace_id,record_id,source_id,import_id) values($1,$2,$3,$4)`,[WS_A,r2,s2,b2]);
   await q(`insert into public.app_ledger_audit(workspace_id,event,legacy_id,import_id) values($1,'legacy_write_request','WR-0950',$2)`,[WS_A,b2]);
   await owner(async c=>{
    await c.query(`delete from public.app_ledger_record_sources where import_id=$1`,[b2]);
    assert.equal((await c.query(`delete from public.app_ledger_records where import_id=$1`,[b2])).rowCount,1);
    assert.equal((await c.query(`delete from public.app_ledger_sources where import_id=$1`,[b2])).rowCount,1);
    assert.equal((await c.query(`delete from public.app_ledger_audit where import_id=$1 and event='legacy_write_request'`,[b2])).rowCount,1);
    await c.query(`update public.app_ledger_imports set status='reverted', decided_at=now() where id=$1`,[b2]);
   });
   // Deleted rows are kept in the audit record; their numbers are not reused.
   assert.equal((await one(`select count(*)::int n from public.app_ledger_audit where event='row_delete' and target_id=$1`,[r2])).n,1);
   assert.equal((await one(`insert into public.app_ledger_records(workspace_id,kind,title,event_status) values($1,'event','번호 확인','watching') returning ledger_id`,[WS_A])).ledger_id,'EVT-0951');
   await assert.rejects(q(`update public.app_ledger_imports set status='applied', decided_at=null where id=$1`,[b2]),/LEDGER_ALREADY_DECIDED/);
   await q(`insert into public.app_ledger_imports(workspace_id,label,source_kind,file_sha256) values($1,'같은 파일 다시','sheet_csv',$2)`,[WS_A,sha('b')]);
   // Confirming the first batch locks its rows: nothing can be deleted any more.
   await q(`update public.app_ledger_imports set status='confirmed', decided_at=now() where id=$1`,[imp]);
   assert.equal((await q(`delete from public.app_ledger_records where id=$1`,[chg])).rowCount,0);
   assert.equal((await q(`delete from public.app_ledger_audit where import_id=$1`,[imp])).rowCount,0);
  });
  await t.test('rollback is blocked while ledger rows exist; with empty tables it restores the snapshot; re-apply works',async()=>{
   await assert.rejects(pool.query(rollbackSQL),/LEDGER_SCHEMA_ROLLBACK_BLOCKED: ledger rows exist/);await pool.query('rollback');
   assert.equal(await history(),1);
   // Test-only cleanup as the table owner (bypasses RLS and triggers). The real rollback never deletes rows.
   await pool.query(`set session_replication_role=replica; truncate public.app_ledger_audit, public.app_ledger_candidates, public.app_ledger_links,
     public.app_ledger_record_sources, public.app_ledger_records, public.app_ledger_sources, public.app_ledger_organizations,
     public.app_ledger_topics, public.app_ledger_id_counters, public.app_ledger_imports; set session_replication_role=origin;`);
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal(v((await pool.query(postcheck)).rows)['tables, functions and history agree'],'예');
   await pool.query(migration);
   assert.equal(await history(),1);
   for(const [k,val] of Object.entries(v((await pool.query(postcheck)).rows)))assert.equal(val,'예',k);
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
 }finally{
  await closePool(pool);
  if(cluster)await cluster.stop().catch(()=>{});
  if(adminPool){await adminPool.query('drop database if exists '+database+' with (force)').catch(()=>{});for(const role of ['anon','authenticated','public_probe','service_role'])await adminPool.query(`drop role if exists ${role}`).catch(()=>{});await closePool(adminPool);}
 }
});
