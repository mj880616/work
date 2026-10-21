// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic (09xx ids, made-up names).
// S7-c: 20261021190000_ledger_candidates — app_confirm_ledger_candidate (candidate -> ledger rows in one transaction),
// app_queue_ledger_candidates (Claude candidates file -> pending candidates). The payload shapes are the ones the screen
// (app/ledger-candidate-model.mjs) and ai-assist (ledger_candidates) build.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,PROJECT_B,MEETING_A} from './basket4-fixture.mjs';
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {candidateFilePayload} from '../../app/ledger-candidate-model.mjs';
const version='20261021190000',name='ledger_candidates',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const externalPort=process.env.LEDGER_PG_PORT;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const NOTE_A='26000000-0000-4000-8000-000000000001';

test('S7-c ledger candidate functions: files, prechecks, confirm, edit, refusals, supersede, add source, queue, rollback',{timeout:120000},async t=>{
 let cluster,pool,adminPool,database='postgres',port,password;
 if(externalPort){
  port=Number(externalPort);database='ledgercand_'+randomBytes(4).toString('hex');
  adminPool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres',ssl:false});
  await adminPool.query('create database '+database);
  for(const role of ['anon','authenticated','public_probe','service_role'])await adminPool.query(`drop role if exists ${role}`).catch(()=>{});
 }else{
  const directory=await mkdtemp(join(tmpdir(),'ledger-cand-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));port=sock.address().port;await new Promise(r=>sock.close(r));
  password=randomBytes(24).toString('hex');
  cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
  await cluster.initialise();await cluster.start();
 }
 try{
  pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database,ssl:false});
  await pool.query(fixture);
  const schema=await read('supabase/migrations/20261021082000_ledger_schema.sql'),importer=await read('supabase/migrations/20261021150000_ledger_import.sql');
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const summary=await read('docs/'+stem+'.summary.md');
  const v=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value??r.ok]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const confirm=(id,edit=null,who=owner)=>who(c=>c.query('select public.app_confirm_ledger_candidate($1,$2) r',[id,edit===null?null:JSON.stringify(edit)])).then(r=>r.rows[0].r);
  const queue=(file,dry,who=owner,ws=WS_A)=>who(c=>c.query('select public.app_queue_ledger_candidates($1,$2,$3) r',[ws,JSON.stringify(file),dry])).then(r=>r.rows[0].r);
  const addCandidate=(row)=>owner(c=>c.query(`insert into public.app_ledger_candidates(workspace_id,origin,action,kind,target_record_id,title,payload,sensitivity,dedup_key)
    values($1,coalesce($2,'web2_ai'),coalesce($3,'new'),$4,$5,$6,$7,coalesce($8,'S1'),$9) returning id`,[WS_A,row.origin??null,row.action??null,row.kind,row.target??null,row.title,JSON.stringify(row.payload??{}),row.sensitivity??null,row.dedup_key??null])).then(r=>r.rows[0].id);
  const one=async(sql,args=[])=>(await pool.query(sql,args)).rows[0];
  const count=async(table,where='true',args=[WS_A])=>(await pool.query(`select count(*)::int n from public.${table} where workspace_id=$1 and ${where}`,args)).rows[0].n;
  const recordId=async ledger=>(await one('select id from public.app_ledger_records where workspace_id=$1 and ledger_id=$2',[WS_A,ledger])).id;
  const status=async id=>(await one('select status from public.app_ledger_candidates where id=$1',[id])).status;

  await t.test('files: workflow-compatible functions only, read-only checks, summary 3 lines, invoker only, no anon/rtw',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run','rollback'])assert.ok(prepareMigration({mode,version,runId:'1',root}),mode);
   assert.deepEqual(prepareMigration({mode:'apply',version,runId:'1',root}).functions,['public.app_confirm_ledger_candidate(uuid,jsonb)','public.app_queue_ledger_candidates(uuid,jsonb,boolean)']);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|\bto (anon|public|service_role)\b|row level security|rtw_|create (table|policy|trigger)|alter table|\bdrop /i);
   assert.equal((code.match(/security invoker\s+set search_path = ''/g)||[]).length,2);
   assert.match(code,/^begin;/);assert.match(code,/commit;\s*$/);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/drop table|delete from public|update public|truncate|cascade|grant |policy/i);
  });
  await t.test('prerequisite guard: refused before the ledger import functions, nothing recorded',async()=>{
   await pool.query(schema);
   await assert.rejects(pool.query(migration),/LEDGER_CANDIDATES_PREREQUISITE_CHANGED/);await pool.query('rollback');
   assert.equal(await history(),0);
   await pool.query(importer);
  });
  const before=(await pool.query(snapshot)).rows;
  await t.test('precheck: prerequisites 예',async()=>{
   const pre=v((await pool.query(precheck)).rows);
   for(const k of ['new migration absent','ledger schema applied (20261021082000)','ledger import applied (20261021150000)','ledger tables present (10)','no candidate function yet','owner check function (security definer)'])assert.equal(pre[k],'예',k);
   assert.equal(before.filter(r=>r.kind==='candidate function').length,0);
  });
  await t.test('apply once: postcheck all 예; earlier postchecks still 예; second apply refused',async()=>{
   await pool.query(migration);
   assert.equal(await history(),1);
   for(const [k,val] of Object.entries(v((await pool.query(postcheck)).rows)))assert.equal(val,'예',k);
   for(const prev of ['docs/20261021082000_ledger_schema.postcheck.sql','docs/20261021150000_ledger_import.postcheck.sql'])
    for(const [k,val] of Object.entries(v((await pool.query(await read(prev))).rows)))assert.equal(val,'예',prev+' '+k);
   await assert.rejects(pool.query(migration),/LEDGER_CANDIDATES_PREREQUISITE_CHANGED/);await pool.query('rollback');
   assert.equal(await history(),1);
  });

  // A small ledger to point at (S7-b import path): prefixes, one topic, one organization, one source, one event.
  await owner(c=>c.query('select public.app_import_ledger_apply($1,$2,false)',[WS_A,JSON.stringify({format:'kptu-ledger-import',version:1,kind:'sheet',label:'가상 원장',sha256:'1'.repeat(64),
   id_prefixes:{event:'EVT',change:'CHG',decision:'DEC',evidence:'EVD',commitment:'COM',source:'SRC',organization:'ORG',topic:'TOP'},
   topics:[{ledger_id:'TOP-0901',name:'가상 주제'}],organizations:[{ledger_id:'ORG-0901',name:'가 지부'}],sources:[{ledger_id:'SRC-0901',title:'가상 공문',doc_type:'official_letter'}],
   records:[{kind:'event',ledger_id:'EVT-0901',title:'가상 사건',event_status:'tracking'}]})]));
  const web2Source={new:{title:'Web2 업데이트 2026-10-20',doc_type:'internal_doc',location:'web2:basket:'+NOTE_A,source_date:'2026-10-20'}};

  let first;
  await t.test('confirm: a new event with a new Web2 source and links to an organization, a project and a meeting',async()=>{
   first=await addCandidate({kind:'event',title:'가상 노선 교섭 시작',dedup_key:'web2:basket:'+NOTE_A+':가상노선교섭시작',payload:{
    record:{summary:'가 지부 교섭 시작 합의.',date_start:'2026-10-20',date_precision:'day',topic:'TOP-0901'},sources:[web2Source],
    links:[{target_organization:'ORG-0901',relation:'direct'},{target_project_id:PROJECT_A},{target_meeting_id:MEETING_A}],
    origin_ref:{kind:'basket',id:NOTE_A,day:'2026-10-20'}}});
   const r=await confirm(first);
   assert.equal(r.status,'confirmed');assert.equal(r.ledger_id,'EVT-0902');assert.equal(r.sources_added,1);assert.equal(r.links_added,3);
   const rec=await one('select kind,title,event_status,date_precision,topic_id is not null as topic,sensitivity,validity from public.app_ledger_records where id=$1',[r.record_id]);
   assert.deepEqual(rec,{kind:'event',title:'가상 노선 교섭 시작',event_status:'tracking',date_precision:'day',topic:true,sensitivity:'S1',validity:'current'});
   assert.equal((await one(`select ledger_id from public.app_ledger_sources where location=$1`,['web2:basket:'+NOTE_A])).ledger_id,'SRC-0902');
   const cand=await one('select status,result_record_id,decided_at is not null as decided from public.app_ledger_candidates where id=$1',[first]);
   assert.deepEqual(cand,{status:'confirmed',result_record_id:r.record_id,decided:true});
   assert.equal(await count('app_ledger_audit',`event='candidate_decided' and target_id=$2`,[WS_A,first]),1);
   await assert.rejects(confirm(first),/LEDGER_CANDIDATE_DECIDED/);
  });
  await t.test('confirm: a change belonging to an event reuses the same Web2 source (web2: location)',async()=>{
   const id=await addCandidate({kind:'change',title:'가상 교섭 2차 일정 확정',payload:{record:{summary:'2차 교섭 날짜 확정.'},sources:[web2Source],links:[{target_record:'EVT-0902',relation:'belongs_to'}]}});
   const r=await confirm(id);
   assert.equal(r.ledger_id,'CHG-0001'); // no change was imported, so the counter starts at 0
   assert.equal(await count('app_ledger_sources',`location like 'web2:%'`),1);
   assert.equal((await one('select date_precision from public.app_ledger_records where id=$1',[r.record_id])).date_precision,'unknown');
  });
  await t.test('[고쳐서 확정]: title, sensitivity and payload are changed first (before-values in the audit), then confirmed',async()=>{
   const id=await addCandidate({kind:'commitment',title:'가상 자료 회신',payload:{record:{summary:'상대측 자료 회신 약속.'}}});
   // Without a counterparty the commitment check refuses it and the candidate stays pending.
   await assert.rejects(confirm(id),/LEDGER_CANDIDATE_BAD_RECORD: app_ledger_records_commitment_check/);
   assert.equal(await status(id),'pending');
   const r=await confirm(id,{title:'가상 기관 자료 회신',sensitivity:'S2',payload:{record:{summary:'상대측 자료 회신 약속.',counterparty:'가상 기관',follow_up_on:'2026-10-30'}}});
   const rec=await one('select title,sensitivity,counterparty,commitment_status,follow_up_on::text f from public.app_ledger_records where id=$1',[r.record_id]);
   assert.deepEqual(rec,{title:'가상 기관 자료 회신',sensitivity:'S2',counterparty:'가상 기관',commitment_status:'waiting',f:'2026-10-30'});
   const edited=await one(`select detail->'before'->>'title' t from public.app_ledger_audit where event='row_update' and target_table='candidates' and target_id=$1`,[id]);
   assert.equal(edited.t,'가상 자료 회신');
  });
  await t.test('refusals keep the candidate pending and write nothing: broken refs, S3, bad dates, bad shape, other workspace project',async()=>{
   const rows=async()=>[await count('app_ledger_records'),await count('app_ledger_sources'),await count('app_ledger_links'),await count('app_ledger_record_sources')];
   const counter=async()=>(await one(`select last_number from public.app_ledger_id_counters where workspace_id=$1 and scope='event'`,[WS_A])).last_number;
   const start=await rows(),high=await counter();
   const cases=[
    [{payload:{links:[{target_record:'EVT-0999',relation:'related'}]}},/LEDGER_CANDIDATE_BROKEN_REF: record EVT-0999/],
    [{payload:{sources:[{source:'SRC-0999'}]}},/LEDGER_CANDIDATE_BROKEN_REF: source SRC-0999/],
    [{payload:{record:{topic:'TOP-0999'}}},/LEDGER_CANDIDATE_BROKEN_REF: topic TOP-0999/],
    [{payload:{record:{date_start:'2026-02-30'}}},/LEDGER_CANDIDATE_BAD_RECORD/],
    [{payload:{record:{date_start:'2026-10-02',date_precision:'month'}}},/LEDGER_CANDIDATE_BAD_RECORD: app_ledger_records_date_check/],
    [{payload:{record:{superseded_by:'EVT-0901'}}},/LEDGER_CANDIDATE_BAD_PAYLOAD: shape/],
    [{payload:{record:{validity:'superseded'}}},/LEDGER_CANDIDATE_BAD_PAYLOAD: shape/],
    [{payload:{extra:1}},/LEDGER_CANDIDATE_BAD_PAYLOAD: shape/],
    [{payload:{links:[{target_record:'EVT-0901',target_organization:'ORG-0901'}]}},/LEDGER_CANDIDATE_BAD_PAYLOAD: links/],
    [{payload:{links:[{target_project_id:PROJECT_B}]}},/LEDGER_CANDIDATE_BAD_RECORD/],
    [{payload:{links:[{target_project_id:'not-a-uuid'}]}},/LEDGER_CANDIDATE_BAD_RECORD/],
    [{payload:{sources:[{new:{title:''}}]}},/LEDGER_CANDIDATE_BAD_RECORD: app_ledger_sources_title_check/]
   ];
   for(const [row,re] of cases){
    const id=await addCandidate({kind:'event',title:'가상 거절 후보',...row});
    await assert.rejects(confirm(id),re,JSON.stringify(row));
    assert.equal(await status(id),'pending');
    await owner(c=>c.query(`update public.app_ledger_candidates set status='discarded',decided_at=now(),discard_reason='시험' where id=$1`,[id]));
   }
   const s3=await addCandidate({kind:'event',title:'가상 민감 후보'});
   await assert.rejects(confirm(s3,{sensitivity:'S3'}),/LEDGER_CANDIDATE_BAD_RECORD: app_ledger_candidates_sensitivity_check/);
   await assert.rejects(confirm(s3,{kind:'decision'}),/LEDGER_CANDIDATE_BAD_EDIT/);
   assert.equal(await status(s3),'pending');
   assert.deepEqual(await rows(),start);
   assert.equal(await counter(),high);
  });
  await t.test('supersede: new decision replaces the target; add_source adds a source to an existing record; update is manual',async()=>{
   const dec=await addCandidate({kind:'decision',title:'가상 결정 1',payload:{record:{decision_type:'adopted',decision_reason:'가상 이유'}}});
   const d1=await confirm(dec);
   const sup=await addCandidate({kind:'decision',action:'supersede',target:d1.record_id,title:'가상 결정 2',payload:{record:{decision_type:'changed'},supersede_reason:'가상 변경'}});
   const d2=await confirm(sup);
   const old=await one('select validity,superseded_by,supersede_reason from public.app_ledger_records where id=$1',[d1.record_id]);
   assert.deepEqual(old,{validity:'superseded',superseded_by:d2.record_id,supersede_reason:'가상 변경'});
   const again=await addCandidate({kind:'decision',action:'supersede',target:d1.record_id,title:'가상 결정 3',payload:{supersede_reason:'또'}});
   await assert.rejects(confirm(again),/LEDGER_CANDIDATE_TARGET_INACTIVE/);
   const noReason=await addCandidate({kind:'decision',action:'supersede',target:d2.record_id,title:'가상 결정 4'});
   await assert.rejects(confirm(noReason),/supersede_reason/);
   const add=await addCandidate({kind:'event',action:'add_source',target:await recordId('EVT-0902'),title:'가상 노선 교섭 시작',payload:{sources:[{source:'SRC-0901',locator:'2쪽'}]}});
   const a=await confirm(add);
   assert.equal(a.ledger_id,'EVT-0902');assert.equal(a.sources_added,1);
   const upd=await addCandidate({kind:'event',action:'update',target:await recordId('EVT-0902'),title:'가상'});
   await assert.rejects(confirm(upd),/LEDGER_CANDIDATE_UPDATE_MANUAL/);
  });
  await t.test('only the owner: stranger sees no candidate, anon cannot call, discarded candidates cannot be confirmed',async()=>{
   const id=await addCandidate({kind:'event',title:'가상 남의 후보 시험'});
   await assert.rejects(confirm(id,null,stranger),/LEDGER_CANDIDATE_NOT_FOUND/);
   await assert.rejects(as('anon','',c=>c.query('select public.app_confirm_ledger_candidate($1,null)',[id])),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query('select public.app_queue_ledger_candidates($1,$2,true)',[WS_A,'{}'])),{code:'42501'});
   await assert.rejects(as('service_role','',c=>c.query('select public.app_confirm_ledger_candidate($1,null)',[id])),{code:'42501'});
   await owner(c=>c.query(`update public.app_ledger_candidates set status='discarded',decided_at=now(),discard_reason='가상 버림' where id=$1 and status='pending'`,[id]));
   await assert.rejects(confirm(id),/LEDGER_CANDIDATE_DECIDED/);
   await assert.rejects(owner(c=>c.query(`update public.app_ledger_candidates set status='pending',decided_at=null,discard_reason=null where id=$1`,[id])),/LEDGER_ALREADY_DECIDED/);
  });

  const file=candidateFilePayload({format:'kptu-ledger-import',version:1,kind:'candidates',label:'가상 대화 이관 1',candidates:[
   {kind:'event',title:'가상 이관 사건',sensitivity:'S1',dedup_key:'chat:0901',payload:{record:{summary:'가상 요지',date_start:'2026-09-01',date_precision:'month'}}},
   {kind:'commitment',title:'가상 이관 약속',payload:{record:{counterparty:'가상 기관'}}},
   {kind:'event',action:'add_source',target:'EVT-0901',title:'가상 사건',payload:{sources:[{new:{title:'가상 대화',doc_type:'ai_chat'}}]}},
   {kind:'event',title:'가상 민감 이관',sensitivity:'S3'}]},'f'.repeat(64));
  await t.test('queue: the screen drops S3 before sending; dry-run leaves nothing; apply adds pending candidates in one confirmed batch',async()=>{
   assert.equal(file.payload.candidates.length,3);assert.equal(file.excluded,1);
   const before=[await count('app_ledger_imports'),await count('app_ledger_candidates'),await count('app_ledger_audit')];
   const dry=await queue(file.payload,true);
   assert.deepEqual({s:dry.status,i:dry.import_id,n:dry.candidates,a:dry.added},{s:'dry_run',i:null,n:3,a:3});
   assert.deepEqual([await count('app_ledger_imports'),await count('app_ledger_candidates'),await count('app_ledger_audit')],before);
   const done=await queue(file.payload,false);
   assert.equal(done.status,'confirmed');assert.equal(done.added,3);
   const batch=await one('select status,source_kind from public.app_ledger_imports where id=$1',[done.import_id]);
   assert.deepEqual(batch,{status:'confirmed',source_kind:'claude_file'});
   const rows=(await pool.query(`select origin,action,status,target_record_id is not null as t from public.app_ledger_candidates where import_id=$1 order by title`,[done.import_id])).rows;
   assert.equal(rows.length,3);assert.ok(rows.every(r=>r.origin==='claude_import'&&r.status==='pending'));
   assert.equal(rows.filter(r=>r.action==='add_source'&&r.t).length,1);
   // A queued candidate is confirmed like any other.
   const ev=(await one(`select id from public.app_ledger_candidates where import_id=$1 and title='가상 이관 사건'`,[done.import_id])).id;
   assert.equal((await confirm(ev)).ledger_id.slice(0,4),'EVT-');
  });
  await t.test('queue refusals: same file, broken target, pending duplicate key skipped, stranger, S3, bad shape',async()=>{
   await assert.rejects(queue(file.payload,false),/LEDGER_IMPORT_DUPLICATE_FILE/);
   const base={...file.payload,sha256:'e'.repeat(64)};
   await assert.rejects(queue({...base,candidates:[{kind:'event',action:'add_source',target:'EVT-0999',title:'가상'}]},false),/LEDGER_QUEUE_BROKEN_REF: 가상 → EVT-0999/);
   await assert.rejects(queue({...base,candidates:[{kind:'event',action:'supersede',title:'대상 없음'}]},true),/LEDGER_QUEUE_BROKEN_REF/);
   await assert.rejects(queue({...base,candidates:[{kind:'event',target:'EVT-0901',title:'new인데 대상'}]},true),/LEDGER_QUEUE_BROKEN_REF/);
   await assert.rejects(queue(base,true,stranger),/LEDGER_QUEUE_NOT_OWNER/);
   await assert.rejects(queue({...base,candidates:[{kind:'event',title:'가상',sensitivity:'S3'}]},true),/LEDGER_QUEUE_BAD_CANDIDATE/);
   await assert.rejects(queue({...base,candidates:[{kind:'event',title:'가상',payload:{bogus:1}}]},true),/LEDGER_QUEUE_BAD_FILE: candidates/);
   await assert.rejects(queue({...base,candidates:[]},true),/LEDGER_QUEUE_BAD_FILE/);
   await assert.rejects(queue({...base,kind:'sheet'},true),/LEDGER_QUEUE_BAD_FILE: format/);
   // The second file repeats a pending key: that candidate is skipped, the other goes in.
   await addCandidate({kind:'event',title:'가상 대기 열쇠',dedup_key:'chat:0950'});
   const r=await queue({...base,candidates:[{kind:'event',title:'가상 같은 열쇠',dedup_key:'chat:0950'},{kind:'event',title:'가상 새 열쇠',dedup_key:'chat:0951'}]},false);
   assert.deepEqual({a:r.added,s:r.skipped},{a:1,s:1});
   assert.equal(await count('app_ledger_candidates','true',[WS_B]),0);
  });
  await t.test('rollback: drops the two functions and the history row only; ledger rows and candidates stay; snapshot matches',async()=>{
   const rows=[await count('app_ledger_records'),await count('app_ledger_candidates'),await count('app_ledger_imports')];
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual([await count('app_ledger_records'),await count('app_ledger_candidates'),await count('app_ledger_imports')],rows);
   const now=(await pool.query(snapshot)).rows;
   // Only the import fingerprint rows changed (data, not schema); compare schema lines.
   assert.deepEqual(now,before);
   const post=v((await pool.query(postcheck)).rows);
   assert.equal(post['functions and history agree'],'예');assert.equal(post['ledger functions unchanged (6)'],'예');assert.equal(post['import functions unchanged (4)'],'예');
  });
 }finally{
  await pool?.end();
  if(adminPool){await adminPool.query(`drop database if exists ${database} with (force)`).catch(()=>{});await adminPool.end();}
  await cluster?.stop();
 }
});
