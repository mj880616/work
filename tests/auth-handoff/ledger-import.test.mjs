// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic (09xx ids, made-up names).
// S7-b: 20261021150000_ledger_import — app_import_ledger_apply (one transaction, dry-run rolls back), counts, confirm, revert.
// The payload is made by the real browser checker (app/ledger-import-model.mjs) from the synthetic sheet in tests/ledger-import-fixture.mjs.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B} from './basket4-fixture.mjs';
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {readInputFiles,analyze,numberCheck} from '../../app/ledger-import-model.mjs';
import {csvFiles,TABS,ALL_TABS} from '../ledger-import-fixture.mjs';
const version='20261021150000',name='ledger_import',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const externalPort=process.env.LEDGER_PG_PORT;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

async function payloadFor(tabs,label='가상 가져오기'){
 const result=analyze(await readInputFiles(csvFiles(tabs)),{},{},label);
 assert.equal(result.ok,true,JSON.stringify(result.summary.error));
 return result;
}

test('S7-b ledger import functions: files, prechecks, dry-run, apply, duplicate file, broken refs, number check, confirm, revert, rollback',{timeout:120000},async t=>{
 let cluster,pool,adminPool,database='postgres',port,password;
 if(externalPort){
  port=Number(externalPort);database='ledgerimp_'+randomBytes(4).toString('hex');
  adminPool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres',ssl:false}));
  await adminPool.query('create database '+database);
  for(const role of ['anon','authenticated','public_probe','service_role'])await adminPool.query(`drop role if exists ${role}`).catch(()=>{});
 }else{
  const directory=await mkdtemp(join(tmpdir(),'ledger-import-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));port=sock.address().port;await new Promise(r=>sock.close(r));
  password=randomBytes(24).toString('hex');
  cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
  await cluster.initialise();await cluster.start();
 }
 try{
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database,ssl:false}));
  await pool.query(fixture);
  const schema=await read('supabase/migrations/20261021082000_ledger_schema.sql');
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const summary=await read('docs/'+stem+'.summary.md');
  const v=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value??r.ok]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const rpc=(fn,args,who=owner)=>who(c=>c.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as r`,args)).then(r=>r.rows[0].r);
  const apply=(payload,dry,who=owner,ws=WS_A)=>rpc('app_import_ledger_apply',[ws,JSON.stringify(payload),dry],who);
  const count=async table=>(await pool.query(`select count(*)::int n from public.${table} where workspace_id=$1`,[WS_A])).rows[0].n;
  const ledgerRows=async()=>{const o={};for(const tb of ['app_ledger_imports','app_ledger_id_counters','app_ledger_topics','app_ledger_organizations','app_ledger_sources','app_ledger_records','app_ledger_record_sources','app_ledger_links','app_ledger_audit'])o[tb]=await count(tb);return o;};

  await t.test('files: workflow-compatible functions only, read-only checks, summary 3 lines, invoker only, no anon/rtw',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run','rollback'])assert.ok(prepareMigration({mode,version,runId:'1',root}),mode);
   assert.deepEqual(prepareMigration({mode:'apply',version,runId:'1',root}).functions,['public.app_import_ledger_apply(uuid,jsonb,boolean)','public.app_import_ledger_confirm(uuid)','public.app_import_ledger_counts(uuid)','public.app_import_ledger_revert(uuid)']);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|\bto (anon|public|service_role)\b|row level security|rtw_|create (table|policy|trigger)|alter table|\bdrop /i);
   assert.equal((code.match(/security invoker\s+set search_path = ''/g)||[]).length,4);
   assert.match(code,/^begin;/);assert.match(code,/commit;\s*$/);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/drop table|delete from public|update public|truncate|cascade|grant |policy/i);
  });
  await t.test('prerequisite guard: refused before the ledger schema, nothing recorded',async()=>{
   await assert.rejects(pool.query(migration),/LEDGER_IMPORT_PREREQUISITE_CHANGED/);await pool.query('rollback');
   assert.equal(await history(),0);
   await pool.query(schema);
  });
  const before=(await pool.query(snapshot)).rows;
  await t.test('precheck after schema: prerequisites 예',async()=>{
   const pre=v((await pool.query(precheck)).rows);
   for(const k of ['new migration absent','ledger schema applied (20261021082000)','ledger tables present (10)','no app_import_ledger function yet','owner check function (security definer)','ledger functions unchanged (6)'])assert.equal(pre[k],'예',k);
   assert.equal(pre['import batches'],'0');
   assert.equal(before.filter(r=>r.kind==='import function').length,0);
  });
  await t.test('apply once: postcheck all 예; second apply refused',async()=>{
   await pool.query(migration);
   assert.equal(await history(),1);
   for(const [k,val] of Object.entries(v((await pool.query(postcheck)).rows)))assert.equal(val,'예',k);
   await assert.rejects(pool.query(migration),/LEDGER_IMPORT_PREREQUISITE_CHANGED/);await pool.query('rollback');
   assert.equal(await history(),1);
   // The ledger schema's own postcheck (six app_ledger_ functions) still holds.
   for(const [k,val] of Object.entries(v((await pool.query(await read('docs/20261021082000_ledger_schema.postcheck.sql'))).rows)))assert.equal(val,'예',k);
  });

  const main=await payloadFor(TABS);
  await t.test('only the owner of the workspace can import; anon cannot call',async()=>{
   await assert.rejects(apply(main.payload,true,stranger),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query('select public.app_import_ledger_apply($1,$2,true)',[WS_A,JSON.stringify(main.payload)])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query('select public.app_import_ledger_revert(gen_random_uuid())')),/LEDGER_IMPORT_NOT_OPEN/);
  });
  await t.test('dry-run: counts like a real apply, then nothing stays (no batch, rows, prefixes or audit)',async()=>{
   const dry=await apply(main.payload,true);
   assert.equal(dry.status,'dry_run');assert.equal(dry.import_id,null);assert.equal(dry.dry_run,true);
   assert.deepEqual(dry.records_by_kind,{event:2,change:2,decision:2,evidence:2,commitment:1});
   assert.equal(dry.sources,2);assert.equal(dry.record_sources,5);assert.equal(dry.links_to_records,1);assert.equal(dry.links_to_organizations,2);assert.equal(dry.legacy_write_requests,2);
   assert.equal(dry.registered_prefixes.length,8);
   assert.deepEqual(Object.values(await ledgerRows()),Array(9).fill(0));
  });
  let importId;
  await t.test('apply: one batch; sheet ids kept; supersede order solved; number check matches the sheet',async()=>{
   const done=await apply(main.payload,false);
   importId=done.import_id;
   assert.equal(done.status,'applied');assert.equal(done.modified,0);
   const ids=(await pool.query('select ledger_id from public.app_ledger_records where import_id=$1 order by 1',[importId])).rows.map(r=>r.ledger_id);
   assert.deepEqual(ids,['CHG-0901','CHG-0902','COM-0901','DEC-0901','DEC-0902','EVD-0901','EVD-0902','EVT-0901','EVT-0902']);
   const old=(await pool.query(`select r.validity,s.ledger_id sup from public.app_ledger_records r join public.app_ledger_records s on s.id=r.superseded_by where r.ledger_id='DEC-0901'`)).rows[0];
   assert.deepEqual(old,{validity:'superseded',sup:'DEC-0902'});
   const belongs=(await pool.query(`select t.ledger_id from public.app_ledger_links l join public.app_ledger_records r on r.id=l.record_id join public.app_ledger_records t on t.id=l.target_record_id where r.ledger_id='CHG-0901' and l.relation='belongs_to'`)).rows;
   assert.deepEqual(belongs,[{ledger_id:'EVT-0901'}]);
   assert.equal((await pool.query(`select count(*)::int n from public.app_ledger_records where sensitivity='S3' or ledger_id='EVT-0903'`)).rows[0].n,0);
   const counts=await rpc('app_import_ledger_counts',[importId]);
   const check=numberCheck(counts.file.report,counts);
   assert.ok(check.length>=10);assert.ok(check.every(r=>r.ok),JSON.stringify(check));
   assert.deepEqual(check.find(r=>r.key==='event'),{key:'event',label:'사건',sheet:3,inserted:2,excluded:1,rejected:0,shift:0,ok:true});
   // Prefixes registered; the counter followed the imported numbers (next new event is 0904).
   assert.equal((await pool.query(`select last_number from public.app_ledger_id_counters where workspace_id=$1 and scope='event'`,[WS_A])).rows[0].last_number,902);
   const audit=(await pool.query(`select event from public.app_ledger_audit where import_id=$1 order by event`,[importId])).rows.map(r=>r.event);
   assert.deepEqual(audit,['import_applied','legacy_write_request','legacy_write_request']);
  });
  await t.test('same file again is refused (fingerprint); another file with the same ids is refused, all or nothing',async()=>{
   const rowsBefore=await ledgerRows();
   await assert.rejects(apply(main.payload,true),/LEDGER_IMPORT_DUPLICATE_FILE/);
   await assert.rejects(apply(main.payload,false),/LEDGER_IMPORT_DUPLICATE_FILE/);
   const other={...main.payload,sha256:'e'.repeat(64)};
   await assert.rejects(apply(other,false),/LEDGER_IMPORT_EXISTING_ID/);
   assert.deepEqual(await ledgerRows(),rowsBefore);
  });
  await t.test('broken reference: the whole batch is refused with the ids, nothing stored',async()=>{
   const rowsBefore=await ledgerRows();
   const broken={format:'kptu-ledger-import',version:1,kind:'sheet',label:'깨진 참조',sha256:'b'.repeat(64),id_prefixes:{change:'CHG',event:'EVT'},
    records:[{kind:'change',ledger_id:'CHG-0950',title:'가상 변화'}],links:[{record:'CHG-0950',target_record:'EVT-0999',relation:'belongs_to'}]};
   await assert.rejects(apply(broken,false),/LEDGER_IMPORT_BROKEN_REF: CHG-0950 → EVT-0999/);
   const brokenSource={...broken,sha256:'c'.repeat(64),links:[],record_sources:[{record:'CHG-0950',source:'SRC-0999'}]};
   await assert.rejects(apply(brokenSource,true),/LEDGER_IMPORT_BROKEN_REF: CHG-0950 → SRC-0999/);
   const brokenTopic={...broken,sha256:'d'.repeat(64),links:[],records:[{kind:'change',ledger_id:'CHG-0950',title:'가상 변화',topic:'TOP-0999'}]};
   await assert.rejects(apply(brokenTopic,false),/LEDGER_IMPORT_BROKEN_REF: CHG-0950 → TOP-0999/);
   const wrongPrefix={...broken,sha256:'f'.repeat(64),links:[],id_prefixes:{change:'CHX'},records:[]};
   await assert.rejects(apply(wrongPrefix,false),/LEDGER_IMPORT_PREFIX_MISMATCH/);
   await assert.rejects(apply({...broken,kind:'candidates'},false),/LEDGER_IMPORT_CANDIDATES_LATER/);
   await assert.rejects(apply({...broken,records:[{kind:'change',title:'ID 없음'}]},false),/LEDGER_IMPORT_BAD_FILE/);
   // References to rows already in the ledger are fine (a later batch may point at an earlier one).
   const later={...broken,sha256:'a'.repeat(64),links:[{record:'CHG-0950',target_record:'EVT-0901',relation:'belongs_to'}]};
   assert.equal((await apply(later,true)).links_to_records,1);
   assert.deepEqual(await ledgerRows(),rowsBefore);
  });
  await t.test('revert is refused when an imported row was changed or another row points at it; nothing is deleted',async()=>{
   const second=await payloadFor({업무주제:[['ID','주제명'],['TOP-0910','가상 둘째 주제']],사건:[['ID','제목','상태','계속추적'],['EVT-0910','가상 둘째 사건','진행','Y'],['EVT-0911','가상 셋째 사건','진행','Y']]},'둘째 묶음');
   const done=await apply(second.payload,false);
   await owner(c=>c.query(`update public.app_ledger_records set summary='고침' where ledger_id='EVT-0910'`));
   await assert.rejects(rpc('app_import_ledger_revert',[done.import_id]),/LEDGER_IMPORT_MODIFIED: 1/);
   const third=await payloadFor({사건:[['ID','제목','상태','계속추적'],['EVT-0920','가상 넷째 사건','종료','N']]},'셋째 묶음');
   const t3=await apply(third.payload,false);
   const rec=(await pool.query(`select id from public.app_ledger_records where ledger_id='EVT-0920'`)).rows[0].id;
   const other=(await pool.query(`select id from public.app_ledger_records where ledger_id='EVT-0911'`)).rows[0].id;
   // A hand-made link (no import) from the third batch's record to the second batch's record blocks the third revert.
   await owner(c=>c.query(`insert into public.app_ledger_links(workspace_id,record_id,target_record_id,relation) values($1,$2,$3,'related')`,[WS_A,rec,other]));
   await assert.rejects(rpc('app_import_ledger_revert',[t3.import_id]),/LEDGER_IMPORT_REVERT_BLOCKED/);
   assert.equal((await pool.query(`select count(*)::int n from public.app_ledger_records where import_id=$1`,[t3.import_id])).rows[0].n,1);
   assert.equal((await rpc('app_import_ledger_counts',[t3.import_id])).status,'applied');
  });
  await t.test('revert: the batch rows go (audit keeps them), counters do not move back, the same file can come in again',async()=>{
   const counter=async()=>(await pool.query(`select last_number from public.app_ledger_id_counters where workspace_id=$1 and scope='event'`,[WS_A])).rows[0].last_number;
   const high=await counter();
   const reverted=await rpc('app_import_ledger_revert',[importId]);
   assert.equal(reverted.status,'reverted');
   for(const k of ['topics','organizations','sources','records','record_sources','links','legacy_write_requests'])assert.equal(reverted[k],0,k);
   assert.equal(await counter(),high);
   const deleted=(await pool.query(`select count(*)::int n from public.app_ledger_audit where event='row_delete' and target_table='records' and detail->'before'->>'import_id'=$1`,[importId])).rows[0].n;
   assert.equal(deleted,9);
   assert.equal((await pool.query(`select count(*)::int n from public.app_ledger_audit where event='import_reverted' and import_id=$1`,[importId])).rows[0].n,1);
   await assert.rejects(rpc('app_import_ledger_revert',[importId]),/LEDGER_IMPORT_NOT_OPEN/);
   await assert.rejects(rpc('app_import_ledger_confirm',[importId]),/LEDGER_IMPORT_NOT_OPEN/);
   // After revert the fingerprint is free again (a fixed sheet is imported as a new batch).
   const again=await apply(main.payload,false);
   assert.equal(again.records,9);importId=again.import_id;
  });
  await t.test('confirm locks the batch: no revert, no row delete',async()=>{
   const confirmed=await rpc('app_import_ledger_confirm',[importId]);
   assert.equal(confirmed.status,'confirmed');
   await assert.rejects(rpc('app_import_ledger_revert',[importId]),/LEDGER_IMPORT_NOT_OPEN/);
   const gone=await owner(c=>c.query(`delete from public.app_ledger_records where import_id=$1`,[importId]));
   assert.equal(gone.rowCount,0);
   assert.equal((await pool.query(`select count(*)::int n from public.app_ledger_audit where event='import_confirmed' and import_id=$1`,[importId])).rows[0].n,1);
   await assert.rejects(apply(main.payload,false),/LEDGER_IMPORT_DUPLICATE_FILE/);
  });
  await t.test('another workspace is untouched; its owner sees nothing of this one',async()=>{
   assert.equal(await stranger(c=>c.query('select public.app_import_ledger_counts($1) r',[importId])).then(r=>r.rows[0].r),null);
   assert.equal((await pool.query(`select count(*)::int n from public.app_ledger_records where workspace_id=$1`,[WS_B])).rows[0].n,0);
  });
  await t.test('real sheet headers (synthetic content): the whole batch goes in; odd legacy ids kept in detail; number check matches',async()=>{
   const real=await payloadFor(ALL_TABS,'실제 머리줄');
   const done=await apply(real.payload,false,stranger,WS_B);
   assert.equal(done.status,'applied');
   assert.ok(numberCheck(done.file.report,done).every(r=>r.ok),JSON.stringify(numberCheck(done.file.report,done)));
   const legacy=(await pool.query(`select legacy_id,detail->>'legacy_id_original' o from public.app_ledger_audit where import_id=$1 and event='legacy_write_request' order by created_at,legacy_id nulls last`,[done.import_id])).rows;
   assert.deepEqual(legacy.map(r=>r.legacy_id).sort(),[null,null,'REQ-0901'].sort());
   assert.ok(legacy.some(r=>r.o==='REQ-20260924042846-COL-1cVke0'));
   assert.equal((await rpc('app_import_ledger_revert',[done.import_id],stranger)).status,'reverted');
  });
  await t.test('rollback: drops the four functions and the history row only; ledger rows stay; snapshot matches',async()=>{
   const rows=await ledgerRows();
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual(await ledgerRows(),rows);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const post=v((await pool.query(postcheck)).rows);
   assert.equal(post['functions and history agree'],'예');assert.equal(post['ledger functions unchanged (6)'],'예');assert.equal(post['ledger tables still RLS (10)'],'예');
  });
 }finally{
  await closePool(pool);
  if(adminPool){await adminPool.query(`drop database if exists ${database} with (force)`).catch(()=>{});await closePool(adminPool);}
  await cluster?.stop();
 }
});
