// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic (09xx ids, made-up names).
// LEDGER-자동기록 DB: 20261024120000_ledger_auto_record — four new tables (auto runs, per-source processing, fix requests, record changes) and
// nine functions: add-only automatic recording, run undo, fix request apply (replace → "대체됨"), fix undo. Owner only; anon and strangers refused.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,MEETING_A} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261024120000',name='ledger_auto_record',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const B1='31000000-0000-4000-8000-000000000001',B2='31000000-0000-4000-8000-000000000002',M1='32000000-0000-4000-8000-000000000001',
  W1='33000000-0000-4000-8000-000000000001',O1='34000000-0000-4000-8000-000000000001',N1='35000000-0000-4000-8000-000000000001';
const T='2026-10-24T01:00:00Z';

const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;

test('LEDGER-자동기록 DB: plan, apply, owner boundary, add-only recording, run undo, fix request (replace/retire/add_source), fix undo, guarded rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'ledger-auto-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  for(const file of ['20261021082000_ledger_schema','20261021150000_ledger_import','20261021190000_ledger_candidates','20261021234000_ledger_candidate_undo'])
   await pool.query(await read('supabase/migrations/'+file+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),anon=fn=>as('anon','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const one=async(sql,args=[])=>(await pool.query(sql,args)).rows[0];
  const count=async(table,where='true',args=[WS_A])=>(await pool.query(`select count(*)::int n from public.${table} where workspace_id=$1 and ${where}`,args)).rows[0].n;
  const rec=ledger=>one('select * from public.app_ledger_records where workspace_id=$1 and ledger_id=$2',[WS_A,ledger]);
  const begin=(who=owner,ws=WS_A)=>who(c=>c.query('select public.app_auto_ledger_begin($1) r',[ws])).then(r=>r.rows[0].r);
  const record=(runId,batch,who=owner)=>who(c=>c.query('select public.app_auto_ledger_record($1,$2) r',[runId,JSON.stringify(batch)])).then(r=>r.rows[0].r);
  const undoRun=(runId,who=owner)=>who(c=>c.query('select public.app_auto_ledger_undo($1) r',[runId])).then(r=>r.rows[0].r);
  const fix=(request,dry=false,who=owner,ws=WS_A)=>who(c=>c.query('select public.app_apply_ledger_fix($1,$2,$3) r',[ws,JSON.stringify(request),dry])).then(r=>r.rows[0].r);
  const undoFix=(id,who=owner)=>who(c=>c.query('select public.app_undo_ledger_fix($1) r',[id])).then(r=>r.rows[0].r);
  const fixReq=(items,extra={})=>({format:'kptu-ledger-fix',version:1,items,...extra});
  const src=(kind,id,title)=>({kind,id,title,doc_type:kind==='meeting'?'minutes':'internal_doc',source_date:'2026-10-23'});
  const newItem=(over={})=>({op:'new',kind:'event',title:'가상 사건',sensitivity:'S1',dedup_key:'web2:basket:'+B1+':'+(over.title||'가상사건'),record:{summary:'가상 요지'},source:src('basket',B1,'업데이트 10/23'),...over});
  const batchOf=(items,extra={})=>({sources:[{kind:'basket',id:B1,updated_at:T},{kind:'meeting',id:M1,updated_at:T},{kind:'work',id:W1,updated_at:T}],items,needs_check:[],excluded:0,tokens_in:0,tokens_out:0,...extra});
  const cleanRunning=()=>pool.query("update public.app_ledger_auto_runs set status='failed',finished_at=now(),fail_code='TEST_CLEANUP' where status='running'");

  await t.test('files: expanded rules pass (apply, dry-run); rollback is SQL Editor only; summary 3 lines; invoker only; every policy to authenticated',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual(plan.createdTables,['app_ledger_auto_runs','app_ledger_auto_sources','app_ledger_fix_requests','app_ledger_record_changes']);
    assert.equal(plan.functions.length,9);assert.equal(plan.review.definer.length,0);assert.equal(plan.review.policies,4);assert.equal(plan.review.restrictive,0);assert.equal(plan.review.triggers,0);
   }
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|disable row level security|alter policy|drop policy|\bto (?:anon|public|service_role)\b|using \(true\)|with check \(true\)|rtw_|set_config/i);
   assert.doesNotMatch(code,/\bgrant [^;]* on (?:table )?public\.app_ledger_(?:records|sources|record_sources|links|audit|candidates|topics|organizations|imports|id_counters)\b/i);
   for(const table of ['app_ledger_auto_runs','app_ledger_auto_sources','app_ledger_fix_requests','app_ledger_record_changes']){
    assert.match(code,new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(code,new RegExp(`revoke all on table public\\.[^;]*${table}[^;]* from public, anon, authenticated, service_role;`));
   }
   const policies=code.match(/create policy [\s\S]*?;/g)||[];assert.equal(policies.length,4);
   for(const p of policies){assert.match(p,/\bto authenticated\b/);assert.match(p,/private\.app_is_workspace_owner\(workspace_id\)/);}
   assert.equal((code.match(/security invoker\s+set search_path = ''/g)||[]).length,9);
   assert.doesNotMatch(code,/grant (?:update|delete)[^;]*app_ledger_record_changes/);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/\bgrant\b|delete from public|truncate|cascade/i);
   assert.match(rollbackSQL,/LEDGER_AUTO_RECORD_ROLLBACK_BLOCKED: auto-record rows exist/);
  });

  // Seed: prefixes, a topic, an organization, a source and an event through the import function; extra records straight in (superuser, ids by the number table).
  await owner(c=>c.query('select public.app_import_ledger_apply($1,$2,false)',[WS_A,JSON.stringify({format:'kptu-ledger-import',version:1,kind:'sheet',label:'가상 원장',sha256:'3'.repeat(64),
   id_prefixes:{event:'EVT',change:'CHG',decision:'DEC',evidence:'EVD',commitment:'COM',source:'SRC',organization:'ORG',topic:'TOP'},
   topics:[{ledger_id:'TOP-0901',name:'가상 주제'}],organizations:[{ledger_id:'ORG-0901',name:'가 지부'}],sources:[{ledger_id:'SRC-0901',title:'가상 공문',doc_type:'official_letter'}],
   records:[{kind:'event',ledger_id:'EVT-0901',title:'가상 기존 사건',event_status:'tracking'},{kind:'decision',ledger_id:'DEC-0901',title:'가상 기존 결정',decision_type:'adopted'}]})]));
  await pool.query("update public.app_ledger_imports set status='confirmed',decided_at=now() where status='applied'");
  const dRetired=(await pool.query(`insert into public.app_ledger_records(workspace_id,kind,title,validity) values ($1,'decision','가상 폐기된 결정','retired') returning ledger_id`,[WS_A])).rows[0].ledger_id;
  const evtOld=await rec('EVT-0901'),decOld=await rec('DEC-0901');
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('precheck as the read-only role; a changed prerequisite stops the migration before any change',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.deepEqual([v['new tables count'],v['new public functions count'],v['new private helpers count']],['0','0','0']);
   const stops=async()=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),/LEDGER_AUTO_RECORD_PREREQUISITE_CHANGED/);await c.query('rollback');}finally{c.release();}};
   await pool.query('grant select on public.app_ledger_records to anon');
   assert.equal(values(await readOnly(precheck))['records table RLS on and no anon or service_role privilege'],'아니오');await stops();
   await pool.query('revoke select on public.app_ledger_records from anon');
   await pool.query("alter table public.app_ledger_audit drop constraint app_ledger_audit_target_check, add constraint app_ledger_audit_target_check check ((target_table is null) = (target_id is null) and (target_table is null or target_table in ('records','sources','organizations','topics','record_sources','links','candidates','imports','auto_runs')))");
   await stops();
   await pool.query("alter table public.app_ledger_audit drop constraint app_ledger_audit_target_check, add constraint app_ledger_audit_target_check check ((target_table is null) = (target_id is null) and (target_table is null or target_table in ('records','sources','organizations','topics','record_sources','links','candidates','imports')))");
   assert.deepEqual(await readOnly(precheck),beforeCheck);
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9901');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await readOnly(precheck),beforeCheck);
  });
  await t.test('apply passes postcheck; new tables are empty; existing ledger tables untouched; second apply refused',async()=>{
   const apply=await run('apply','9902');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck)),pre=values(beforeCheck);
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else if(pre[item]!==undefined&&!/^(new |auto |fix |record changes)/.test(item))assert.equal(value,pre[item],item);
   }
   assert.deepEqual([post['auto runs rows'],post['auto sources rows'],post['fix requests rows'],post['record changes rows']],['0','0','0','0']);
   assert.equal((await run('apply','9903')).ok,false);
   // Earlier ledger postchecks still pass on counts that do not include the new objects.
   for(const prev of ['docs/20261021190000_ledger_candidates.postcheck.sql','docs/20261021234000_ledger_candidate_undo.postcheck.sql']){
    const rows=values((await pool.query(await read(prev))).rows);
    for(const [k,val] of Object.entries(rows))if(/^(예|아니오)$/.test(val)&&!/ledger tables still RLS \(10\)|ledger functions unchanged/.test(k))assert.equal(val,'예',prev+' '+k);
   }
  });

  await t.test('boundary: anon has no table or function access; a stranger sees nothing and writes nothing; no deletes or edits where not granted',async()=>{
   for(const tbl of ['app_ledger_auto_runs','app_ledger_auto_sources','app_ledger_fix_requests','app_ledger_record_changes'])
    await assert.rejects(anon(c=>c.query(`select 1 from public.${tbl}`)),{code:'42501'},tbl);
   await assert.rejects(anon(c=>c.query('select public.app_auto_ledger_begin($1)',[WS_A])),{code:'42501'});
   await assert.rejects(anon(c=>c.query('select public.app_apply_ledger_fix($1,$2,true)',[WS_A,'{}'])),{code:'42501'});
   await assert.rejects(anon(c=>c.query('select public.app_undo_ledger_fix($1)',[OWNER])),{code:'42501'});
   // service_role has no privilege on the new objects either (the server AI uses the owner's login, not service_role).
   await assert.rejects(as('service_role','',c=>c.query('select 1 from public.app_ledger_auto_runs')),{code:'42501'});
   await assert.rejects(as('service_role','',c=>c.query('select public.app_auto_ledger_begin($1)',[WS_A])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query('select public.app_auto_ledger_begin($1)',[WS_A])),{code:'42501',message:/LEDGER_AUTO_NOT_OWNER/});
   await assert.rejects(stranger(c=>c.query('select public.app_apply_ledger_fix($1,$2,true)',[WS_A,JSON.stringify(fixReq([{target:'EVT-0901',do:'retire',reason:'x'}]))])),{code:'42501',message:/LEDGER_FIX_NOT_OWNER/});
   await assert.rejects(stranger(c=>c.query("insert into public.app_ledger_auto_runs(workspace_id) values ($1)",[WS_A])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query("insert into public.app_ledger_fix_requests(workspace_id,request) values ($1,'{}')",[WS_A])),{code:'42501'});
   const mine=await begin();
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_ledger_auto_runs'))).rows[0].n,0);
   await assert.rejects(stranger(c=>c.query('select public.app_auto_ledger_record($1,$2)',[mine.run_id,'{}'])),{code:'P0001'});
   await assert.rejects(stranger(c=>c.query('select public.app_auto_ledger_undo($1)',[mine.run_id])),{code:'P0001'});
   // The owner cannot edit or delete the append-only change log, cannot delete runs or fix requests or the processing table, and cannot set ids by hand.
   await assert.rejects(owner(c=>c.query("update public.app_ledger_record_changes set note='x'")),{code:'42501'});
   await assert.rejects(owner(c=>c.query('delete from public.app_ledger_record_changes')),{code:'42501'});
   await assert.rejects(owner(c=>c.query('delete from public.app_ledger_auto_runs')),{code:'42501'});
   await assert.rejects(owner(c=>c.query('delete from public.app_ledger_auto_sources')),{code:'42501'});
   await assert.rejects(owner(c=>c.query('delete from public.app_ledger_fix_requests')),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_ledger_auto_runs set workspace_id=$1",[WS_B])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_ledger_auto_runs(workspace_id,status) values ($1,'done')",[WS_A])),{code:'42501'});
   await cleanRunning();
  });

  await t.test('begin: one run at a time, stale runs cleaned after 2 minutes, daily limit 16 (zero-token failures not counted), first_run flag',async()=>{
   const a=await begin();
   assert.equal(a.first_run,true);assert.equal(a.last_done_at,null);
   await assert.rejects(begin(),{code:'55006',message:/LEDGER_AUTO_BUSY/});
   // The same login in another workspace is refused by ownership (WS_B belongs to the stranger).
   await assert.rejects(begin(owner,WS_B),{code:'42501'});
   await pool.query("update public.app_ledger_auto_runs set started_at=now()-interval '5 minutes' where id=$1",[a.run_id]);
   const b=await begin();
   assert.notEqual(b.run_id,a.run_id);
   const stale=await one('select status,fail_code from public.app_ledger_auto_runs where id=$1',[a.run_id]);
   assert.deepEqual([stale.status,stale.fail_code],['failed','LEDGER_AUTO_STALE']);
   await cleanRunning();
   // Daily limit: 16 runs that used the AI today; a zero-token failure does not count.
   await pool.query(`insert into public.app_ledger_auto_runs(workspace_id,status,finished_at,tokens_in) select $1,'done',now(),10 from generate_series(1,16)`,[WS_A]);
   await assert.rejects(begin(),{code:'54000',message:/LEDGER_AUTO_DAILY_LIMIT/});
   await pool.query("update public.app_ledger_auto_runs set status='failed',fail_code='X_TEST',tokens_in=0 where id=(select id from public.app_ledger_auto_runs where workspace_id=$1 and status='done' limit 1)",[WS_A]);
   const c=await begin();assert.equal(c.first_run,false);assert.ok(c.last_done_at);
   await cleanRunning();
   await pool.query('delete from public.app_ledger_auto_runs where workspace_id=$1',[WS_A]);
  });

  let happy;
  await t.test('record: new event, change under it (by item number), commitment, change under an existing event, extra evidence on an existing record, needs_check on an existing one',async()=>{
   const r=await begin();
   const items=[
    newItem({title:'가상 교섭 시작',record:{summary:'가 지부 교섭 시작.',date_start:'2026-10-23',date_precision:'day',topic:'TOP-0901'},
      links:[{target_organization:'ORG-0901',relation:'direct'},{target_project_id:PROJECT_A},{target_meeting_id:MEETING_A}]}),
    newItem({kind:'change',title:'가상 1차 교섭 결렬',belongs_to_item:1,dedup_key:'web2:basket:'+B1+':가상1차교섭결렬',record:{summary:'결렬.',date_start:'2026-10-24',date_precision:'day'}}),
    newItem({kind:'commitment',title:'가상 약속',sensitivity:'S2',dedup_key:'web2:meeting:'+M1+':가상약속',source:src('meeting',M1,'사업 보고 10/22'),
      record:{counterparty:'가 사측',commitment_status:'waiting',follow_up_on:'2026-11-05',importance:'high'}}),
    newItem({kind:'change',title:'가상 기존 사건의 변화',belongs_to:'EVT-0901',dedup_key:'web2:work:'+W1+':가상기존사건변화',source:src('work',W1,'업무일지 10/24'),record:{validity:'needs_check'}}),
    {op:'add_source',target:'EVT-0901',source:src('meeting',M1,'사업 보고 10/22'),locator:'3쪽'},
   ];
   const out=await record(r.run_id,batchOf(items,{needs_check:[{record:'DEC-0901'}],excluded:2,tokens_in:8000,tokens_out:900}));
   assert.deepEqual(out,{ok:true,run_id:r.run_id,sources_seen:3,records_new:4,changes_linked:2,sources_added:1,needs_check:2,skipped:0,excluded:2});
   happy={run:r.run_id,out};
   const run1=await one('select * from public.app_ledger_auto_runs where id=$1',[r.run_id]);
   assert.equal(run1.status,'done');assert.ok(run1.finished_at);assert.equal(run1.tokens_in,8000);assert.equal(run1.excluded,2);
   const ev=await one(`select r.*,(select count(*)::int from public.app_ledger_record_changes c where c.record_id=r.id and c.run_id=$2 and c.action='created') made from public.app_ledger_records r where r.workspace_id=$1 and r.title='가상 교섭 시작'`,[WS_A,r.run_id]);
   assert.equal(ev.ledger_id,'EVT-0902');assert.equal(ev.kind,'event');assert.equal(ev.event_status,'tracking');assert.equal(ev.made,1);assert.equal(ev.validity,'current');
   assert.equal(ev.topic_id!==null,true);assert.equal(ev.import_id,null);
   assert.equal(await count('app_ledger_links','record_id=$2 and target_organization_id is not null',[WS_A,ev.id]),1);
   assert.equal(await count('app_ledger_links','record_id=$2 and target_project_id is not null',[WS_A,ev.id]),1);
   assert.equal(await count('app_ledger_links','record_id=$2 and target_meeting_id is not null',[WS_A,ev.id]),1);
   const chg=await rec('CHG-0001');assert.equal(chg.title,'가상 1차 교섭 결렬');
   assert.equal(await count('app_ledger_links','record_id=$2 and target_record_id=$3 and relation=\'belongs_to\'',[WS_A,chg.id,ev.id]),1);
   const chg2=await one(`select * from public.app_ledger_records where workspace_id=$1 and title='가상 기존 사건의 변화'`,[WS_A]);
   assert.equal(chg2.validity,'needs_check');
   assert.equal(await count('app_ledger_links','record_id=$2 and target_record_id=$3 and relation=\'belongs_to\'',[WS_A,chg2.id,evtOld.id]),1);
   const com=await one(`select * from public.app_ledger_records where workspace_id=$1 and kind='commitment'`,[WS_A]);
   assert.deepEqual([com.counterparty,com.commitment_status,com.sensitivity,com.importance],['가 사측','waiting','S2','high']);
   // One source row per original (reuse by location), the existing event got one more source line and kept every content column.
   assert.equal(await count('app_ledger_sources',`location='web2:basket:${B1}'`),1);assert.equal(await count('app_ledger_sources',`location='web2:meeting:${M1}'`),1);
   assert.equal(await count('app_ledger_record_sources','record_id=$2 and locator=\'3쪽\'',[WS_A,evtOld.id]),1);
   const evtNow=await rec('EVT-0901');
   for(const k of ['title','summary','kind','sensitivity','event_status','date_start','note'])assert.deepEqual(evtNow[k],evtOld[k],k);
   const decNow=await rec('DEC-0901');assert.equal(decNow.validity,'needs_check');assert.equal(decNow.title,decOld.title);assert.equal(decNow.summary,decOld.summary);
   const flag=await one(`select note,detail from public.app_ledger_record_changes where record_id=$1 and action='needs_check'`,[decOld.id]);
   assert.match(flag.note,/^원문이 바뀌어 확인필요 · \d{4}-\d{2}-\d{2}$/);assert.deepEqual(flag.detail,{prev_validity:'current'});
   // The processing table now knows the three originals; the change log holds 4 "created" rows with dedup keys, 1 source line, 1 needs_check.
   assert.equal(await count('app_ledger_auto_sources',"last_run_id=$2",[WS_A,r.run_id]),3);
   assert.equal(await count('app_ledger_record_changes',"run_id=$2 and action='created' and dedup_key is not null",[WS_A,r.run_id]),4);
   assert.equal(await count('app_ledger_record_changes',"run_id=$2 and action='source_added' and line_table='record_sources'",[WS_A,r.run_id]),1);
   assert.equal(await count('app_ledger_record_changes',"run_id=$2 and action='needs_check'",[WS_A,r.run_id]),1);
   // The audit trigger kept the value before the needs_check mark.
   assert.equal((await pool.query("select count(*)::int n from public.app_ledger_audit where target_table='records' and target_id=$1 and event='row_update' and detail->'before'->>'validity'='current'",[decOld.id])).rows[0].n,1);
  });
  await t.test('record: a second run with the same keys skips (dedup 1), changes nothing, and re-marks nothing already marked',async()=>{
   const r=await begin();
   const items=[newItem({title:'가상 교섭 시작',dedup_key:'web2:basket:'+B1+':가상 교섭 시작'}),
     newItem({title:'가상 교섭 시작 복제',dedup_key:'web2:basket:'+B1+':가상1차교섭결렬'}),
     newItem({title:'가상 새 사건',dedup_key:'web2:basket:'+B1+':새사건'})];
   const before=await count('app_ledger_records');
   const out=await record(r.run_id,batchOf(items,{needs_check:[{record:'DEC-0901'}]}));
   // Two identical keys are skipped; DEC-0901 is already marked (not "current"), so marking it again is skipped too.
   assert.equal(out.ok,true);assert.equal(out.skipped,3);assert.equal(out.records_new,1);
   assert.equal(await count('app_ledger_records'),before+1);
   await undoRun(r.run_id);
  });
  await t.test('record: wrong input fails the whole run, writes nothing, and leaves the processing table and id numbers as they were',async()=>{
   const snap=async()=>({rec:await count('app_ledger_records'),src:await count('app_ledger_sources'),auto:await count('app_ledger_auto_sources'),chg:await count('app_ledger_record_changes'),
     links:await count('app_ledger_links'),rs:await count('app_ledger_record_sources'),ctr:(await pool.query('select scope,last_number from public.app_ledger_id_counters where workspace_id=$1 order by scope',[WS_A])).rows});
   const fails=[
    ['unknown key',[newItem({title:'가상 A',extra:1})],'LEDGER_AUTO_BAD_ITEM'],
    ['evidence kind is not allowed for the AI',[newItem({title:'가상 B',kind:'evidence'})],'LEDGER_AUTO_BAD_ITEM'],
    ['S3 sensitivity',[newItem({title:'가상 C',sensitivity:'S3'})],'LEDGER_AUTO_BAD_ITEM'],
    ['resident number in the title',[newItem({title:'가상 900101-1234567'})],'LEDGER_AUTO_PERSONAL'],
    ['mobile number in the summary',[newItem({title:'가상 D',record:{summary:'연락 010-1234-5678'}})],'LEDGER_AUTO_PERSONAL'],
    ['source not among the originals seen',[newItem({title:'가상 E',source:src('note',N1,'노트')})],'LEDGER_AUTO_BAD_ITEM'],
    ['unknown source kind',[newItem({title:'가상 F',source:{kind:'diary',id:B1,title:'일기'}})],'LEDGER_AUTO_BAD_ITEM'],
    ['change without an event',[newItem({title:'가상 G',kind:'change'})],'LEDGER_AUTO_BAD_ITEM'],
    ['change under a missing event',[newItem({title:'가상 H',kind:'change',belongs_to:'EVT-8888'})],'LEDGER_AUTO_BROKEN_REF'],
    ['change under a decision (not an event)',[newItem({title:'가상 H2',kind:'change',belongs_to:'DEC-0901'})],'LEDGER_AUTO_BROKEN_REF'],
    ['belongs_to_item that is not an earlier event',[newItem({title:'가상 I',kind:'change',belongs_to_item:0})],'LEDGER_AUTO_BROKEN_REF'],
    ['modify op',[{op:'update',target:'EVT-0901',title:'바꿈'}],'LEDGER_AUTO_BAD_ITEM'],
    ['retire op',[{op:'retire',target:'EVT-0901'}],'LEDGER_AUTO_BAD_ITEM'],
    ['add_source to a retired record',[{op:'add_source',target:dRetired,source:src('meeting',M1,'사업 보고')}],'LEDGER_AUTO_BROKEN_REF'],
    ['add_source to a missing record',[{op:'add_source',target:'EVT-8888',source:src('meeting',M1,'사업 보고')}],'LEDGER_AUTO_BROKEN_REF'],
    ['topic that does not exist',[newItem({title:'가상 J',record:{topic:'TOP-8888'}})],'LEDGER_AUTO_BROKEN_REF'],
    ['organization that does not exist',[newItem({title:'가상 K',links:[{target_organization:'ORG-8888'}]})],'LEDGER_AUTO_BROKEN_REF'],
    ['content column the AI may not set',[newItem({title:'가상 L',record:{superseded_by:'x'}})],'LEDGER_AUTO_BAD_ITEM'],
    ['date check violated',[newItem({title:'가상 M',record:{date_start:'2026-10-24',date_precision:'unknown'}})],'LEDGER_AUTO_BAD_RECORD'],
    ['missing dedup key',[newItem({title:'가상 N',dedup_key:null})],'LEDGER_AUTO_BAD_ITEM'],
   ];
   for(const [label,items,code] of fails){
    const r=await begin(),b=await snap();
    const out=await record(r.run_id,batchOf([newItem({title:'가상 먼저 된 항목',dedup_key:'web2:basket:'+B1+':먼저'}),...items]));
    assert.equal(out.ok,false,label);assert.equal(out.error,code,label);
    assert.deepEqual(await snap(),b,label);
    const row=await one('select status,fail_code,finished_at from public.app_ledger_auto_runs where id=$1',[r.run_id]);
    assert.deepEqual([row.status,row.fail_code],['failed',code],label);assert.ok(row.finished_at);
    await assert.rejects(record(r.run_id,batchOf([])),{code:'55000',message:/LEDGER_AUTO_RUN_NOT_RUNNING/},label);
   }
   // Bad batch shapes.
   for(const bad of [[],{items:'x'},{sources:[{kind:'basket',id:B1}],items:[]},{sources:[{kind:'basket',id:B1,updated_at:T},{kind:'basket',id:B1,updated_at:T}]},{foo:1}]){
    const r=await begin(),b=await snap();const out=await record(r.run_id,bad);
    assert.equal(out.ok,false);assert.match(out.error,/^LEDGER_AUTO_BAD_/);assert.deepEqual(await snap(),b);
   }
   // A missing id prefix stops the run (the kind has no number table row); processing table unchanged, next run continues after it is back.
   const saved=(await pool.query("select * from public.app_ledger_id_counters where workspace_id=$1 and scope='decision'",[WS_A])).rows[0];
   await pool.query("delete from public.app_ledger_id_counters where workspace_id=$1 and scope='decision'",[WS_A]);
   const r=await begin(),b=await snap();
   const out=await record(r.run_id,batchOf([newItem({kind:'decision',title:'가상 결정',dedup_key:'web2:basket:'+B1+':결정',record:{decision_type:'adopted'}})]));
   assert.equal(out.ok,false);assert.equal(out.error,'LEDGER_ID_PREFIX_MISSING');
   await pool.query('insert into public.app_ledger_id_counters(workspace_id,scope,prefix,last_number) values ($1,$2,$3,$4)',[saved.workspace_id,saved.scope,saved.prefix,saved.last_number]);
   assert.equal((await snap()).auto,b.auto);
   const again=await begin();
   assert.equal((await record(again.run_id,batchOf([newItem({kind:'decision',title:'가상 결정',dedup_key:'web2:basket:'+B1+':결정',record:{decision_type:'adopted'}})]))).ok,true);
   await undoRun(again.run_id);
  });
  await t.test('add-only: a record cannot be changed by the automatic path; the owner cannot delete automatic records; content of old records stays',async()=>{
   const auto=await rec('EVT-0902');
   // Direct delete of an automatic record is refused by the existing restrictive policy (rowCount 0); direct edits stay the owner's own manual action, not the automatic path.
   assert.equal((await owner(c=>c.query('delete from public.app_ledger_records where id=$1',[auto.id]))).rowCount,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_ledger_records where id=$1',[auto.id])).rows[0].n,1);
   const r=await begin();
   const out=await record(r.run_id,batchOf([newItem({title:'가상 교섭 시작',dedup_key:'web2:basket:'+B1+':덮어쓰기시도',record:{summary:'덮어쓰기'}})]));
   assert.equal(out.ok,true);
   assert.equal((await rec('EVT-0902')).summary,'가 지부 교섭 시작.');
   await undoRun(r.run_id);
   // needs_check is the only change to an existing record: only a current one, only to needs_check.
   const r2=await begin();
   const o2=await record(r2.run_id,batchOf([],{needs_check:[{record:'EVT-0902'},{record:dRetired},{record:'DEC-0901'}]}));
   assert.equal(o2.ok,true);assert.equal(o2.needs_check,1);assert.equal(o2.skipped,2);
   assert.equal((await rec('EVT-0902')).validity,'needs_check');assert.equal((await rec(dRetired)).validity,'retired');
   assert.equal((await rec('EVT-0902')).summary,'가 지부 교섭 시작.');
   await undoRun(r2.run_id);
   assert.equal((await rec('EVT-0902')).validity,'current');
  });

  await t.test('undo run: new records retired (not deleted), added source line removed, needs_check restored, run undone; same originals are not extracted again',async()=>{
   const r=await begin();
   const out=await record(r.run_id,batchOf([
    newItem({title:'가상 되돌릴 사건',dedup_key:'web2:basket:'+B2+':되돌릴사건',source:src('basket',B2,'업데이트 10/24')}),
    {op:'add_source',target:'EVT-0901',source:src('basket',B2,'업데이트 10/24'),locator:'되돌릴줄'}],{sources:[{kind:'basket',id:B2,updated_at:T}]}));
   assert.equal(out.ok,true);
   const made=await one("select id,ledger_id from public.app_ledger_records where workspace_id=$1 and title='가상 되돌릴 사건'",[WS_A]);
   assert.equal(await count('app_ledger_record_sources',"record_id=$2 and locator='되돌릴줄'",[WS_A,evtOld.id]),1);
   const u=await undoRun(r.run_id);
   assert.deepEqual([u.status,u.records_retired,u.sources_unlinked],['undone',1,1]);
   assert.equal((await pool.query('select validity from public.app_ledger_records where id=$1',[made.id])).rows[0].validity,'retired');
   assert.equal(await count('app_ledger_record_sources',"record_id=$2 and locator='되돌릴줄'",[WS_A,evtOld.id]),0);
   const row=await one('select status,undone_at from public.app_ledger_auto_runs where id=$1',[r.run_id]);assert.equal(row.status,'undone');assert.ok(row.undone_at);
   assert.match((await one("select note from public.app_ledger_record_changes where record_id=$1 and action='retired'",[made.id])).note,/^명진이 취소 · \d{4}-\d{2}-\d{2}$/);
   assert.equal((await pool.query("select count(*)::int n from public.app_ledger_audit where event='note' and target_table='auto_runs' and target_id=$1",[r.run_id])).rows[0].n,1);
   // The key stays: the same original and title is skipped next time.
   const r2=await begin();
   const o2=await record(r2.run_id,batchOf([newItem({title:'가상 되돌릴 사건',dedup_key:'web2:basket:'+B2+':되돌릴사건',source:src('basket',B2,'업데이트 10/24')})],{sources:[{kind:'basket',id:B2,updated_at:T}]}));
   assert.equal(o2.skipped,1);assert.equal(o2.records_new,0);
   await undoRun(r2.run_id);
   await assert.rejects(undoRun(r.run_id),{code:'55000',message:/LEDGER_AUTO_UNDO_NOT_DONE/});
   await assert.rejects(stranger(c=>c.query('select public.app_auto_ledger_undo($1)',[r2.run_id])),{code:'P0001'});
  });
  await t.test('undo run is refused when a record was edited, referenced, or a line/marked record changed afterwards (nothing changes)',async()=>{
   const mk=async(tag)=>{
    await pool.query("update public.app_ledger_records set validity='current' where ledger_id='EVT-0902' and workspace_id=$1",[WS_A]);
    const r=await begin();
    const o=await record(r.run_id,batchOf([newItem({title:'가상 거절 '+tag,dedup_key:'web2:basket:'+B2+':거절'+tag,source:src('basket',B2,'업데이트 10/24')}),
      {op:'add_source',target:'EVT-0901',source:src('basket',B2,'업데이트 10/24'),locator:'줄'+tag}],{sources:[{kind:'basket',id:B2,updated_at:T}],needs_check:[{record:'EVT-0902'}]}));
    assert.equal(o.ok,true);
    return {run:r.run_id,rec:(await one("select id from public.app_ledger_records where workspace_id=$1 and title=$2",[WS_A,'가상 거절 '+tag])).id};
   };
   const state=async()=>(await pool.query("select ledger_id,validity,updated_at::text u from public.app_ledger_records where workspace_id=$1 order by ledger_id",[WS_A])).rows;
   // (1) edited afterwards
   let a=await mk('A');let s0=await state();
   await owner(c=>c.query("update public.app_ledger_records set summary='손으로 고침' where id=$1",[a.rec]));
   s0=await state();
   await assert.rejects(undoRun(a.run),{code:'55000',message:/LEDGER_AUTO_UNDO_CHANGED/});assert.deepEqual(await state(),s0);
   assert.equal((await one('select status from public.app_ledger_auto_runs where id=$1',[a.run])).status,'done');
   // (2) referenced by another record
   await cleanRunning();
   let b=await mk('B');
   const other=(await pool.query("select id from public.app_ledger_records where workspace_id=$1 and ledger_id='DEC-0901'",[WS_A])).rows[0].id;
   await owner(c=>c.query("insert into public.app_ledger_links(workspace_id,record_id,target_record_id,relation) values ($1,$2,$3,'related')",[WS_A,other,b.rec]));
   s0=await state();
   await assert.rejects(undoRun(b.run),{code:'55000',message:/LEDGER_AUTO_UNDO_REFERENCED/});assert.deepEqual(await state(),s0);
   // (3) the added source line was edited afterwards
   let c3=await mk('C');
   await owner(c=>c.query("update public.app_ledger_record_sources set note='손으로 고침' where record_id=$1 and locator='줄C'",[evtOld.id]));
   await assert.rejects(undoRun(c3.run),{code:'55000',message:/LEDGER_AUTO_UNDO_CHANGED/});
   assert.equal(await count('app_ledger_record_sources',"locator='줄C'"),1);
   // (4) a marked record was edited afterwards by hand
   let d=await mk('D');
   await owner(c=>c.query("update public.app_ledger_records set validity='current' where ledger_id='EVT-0902' and workspace_id=$1",[WS_A]));
   await assert.rejects(undoRun(d.run),{code:'55000',message:/LEDGER_AUTO_UNDO_CHANGED/});
  });

  // ----- fix requests -----
  let fixStart;
  await t.test('fix request: dry run shows before/after and leaves no trace; apply replaces (old = 대체됨, new = 명진 지적으로 수정), copies sources and links',async()=>{
   await cleanRunning();
   const target=await rec('EVT-0902');
   const lastEvt=async()=>(await pool.query("select last_number from public.app_ledger_id_counters where workspace_id=$1 and scope='event'",[WS_A])).rows[0].last_number;
   const snapCount=async()=>({rec:await count('app_ledger_records'),fix:await count('app_ledger_fix_requests'),chg:await count('app_ledger_record_changes'),rs:await count('app_ledger_record_sources'),links:await count('app_ledger_links'),ctr:await lastEvt()});
   const request=fixReq([{target:'EVT-0902',do:'replace',set:{date_start:'2026-10-21',summary:'고친 요지',topic:'TOP-0901'},reason:'날짜 오기'}]);
   fixStart=await snapCount();
   const dry=await fix(request,true);
   assert.equal(dry.dry_run,true);assert.equal(dry.fix_request_id,null);assert.equal(dry.applied,1);
   assert.deepEqual(dry.items[0].changes.map(c=>c.field),['date_start','summary','topic']);
   assert.deepEqual(dry.items[0].changes.find(c=>c.field==='date_start'),{field:'date_start',before:'2026-10-23',after:'2026-10-21'});
   assert.deepEqual(await snapCount(),fixStart);
   const done=await fix(request,false);
   assert.equal(done.dry_run,false);assert.ok(done.fix_request_id);
   const old=await rec('EVT-0902'),fresh=await one("select * from public.app_ledger_records where workspace_id=$1 and kind='event' and title='가상 교섭 시작' and validity='current'",[WS_A]);
   assert.equal(old.validity,'superseded');assert.equal(old.superseded_by,fresh.id);assert.equal(old.supersede_reason,'명진 지적으로 수정: 날짜 오기');
   assert.equal(fresh.summary,'고친 요지');assert.equal((await one('select date_start::text d from public.app_ledger_records where id=$1',[fresh.id])).d,'2026-10-21');
   assert.equal(fresh.kind,'event');assert.equal(fresh.event_status,'tracking');assert.equal(fresh.importance,old.importance);assert.equal(fresh.sensitivity,old.sensitivity);
   assert.equal(fresh.ledger_id.startsWith('EVT-'),true);assert.notEqual(fresh.ledger_id,old.ledger_id);
   assert.equal(await count('app_ledger_record_sources','record_id=$2',[WS_A,fresh.id]),await count('app_ledger_record_sources','record_id=$2',[WS_A,old.id]));
   assert.equal(await count('app_ledger_links','record_id=$2',[WS_A,fresh.id]),await count('app_ledger_links','record_id=$2',[WS_A,old.id]));
   assert.equal(await count('app_ledger_links','record_id=$2',[WS_A,fresh.id]),3);
   const created=await one("select note,detail from public.app_ledger_record_changes where record_id=$1 and action='created' and route='correction'",[fresh.id]);
   assert.match(created.note,/^명진 지적으로 수정 · \d{4}-\d{2}-\d{2}$/);assert.deepEqual(created.detail,{replaces:'EVT-0902'});
   const replaced=await one("select note,detail from public.app_ledger_record_changes where record_id=$1 and action='replaced'",[old.id]);
   assert.equal(replaced.detail.replaced_by,fresh.ledger_id);assert.equal(replaced.detail.prev_validity,'current');
   const fr=await one('select status,received_from,request,result from public.app_ledger_fix_requests where id=$1',[done.fix_request_id]);
   assert.deepEqual([fr.status,fr.received_from],['applied','claude_chat']);assert.deepEqual(fr.request,request);assert.equal(fr.result.items[0].new,fresh.ledger_id);
   // The audit trigger kept the old values; the old record is still there (never deleted).
   assert.ok((await pool.query("select 1 from public.app_ledger_audit where target_table='records' and target_id=$1 and event='row_update' and detail->'before'->>'validity'='current'",[old.id])).rowCount>=1);
   // The old record cannot be replaced or retired again; a chain continues from the new one.
   await assert.rejects(fix(fixReq([{target:'EVT-0902',do:'retire',reason:'다시'}])),{message:/LEDGER_FIX_TARGET_INACTIVE/});
   const second=await fix(fixReq([{target:fresh.ledger_id,do:'replace',set:{title:'가상 교섭 시작(재수정)'},reason:'제목'}]));
   assert.equal((await one('select validity from public.app_ledger_records where id=$1',[fresh.id])).validity,'superseded');
   assert.equal((await one("select count(*)::int n from public.app_ledger_records where workspace_id=$1 and title='가상 교섭 시작(재수정)' and validity='current'",[WS_A])).n,1);
   assert.ok(second.fix_request_id);
   fixStart={first:done.fix_request_id,second:second.fix_request_id,old:old.id,fresh:fresh.id};
  });
  await t.test('fix request: retire and add_source; kinds stay; commitment fields; whole request refused when any item is wrong (nothing applied)',async()=>{
   const start={rec:await count('app_ledger_records'),fix:await count('app_ledger_fix_requests'),chg:await count('app_ledger_record_changes'),rs:await count('app_ledger_record_sources')};
   const state=async()=>({rec:await count('app_ledger_records'),fix:await count('app_ledger_fix_requests'),chg:await count('app_ledger_record_changes'),rs:await count('app_ledger_record_sources'),v:(await pool.query('select ledger_id,validity from public.app_ledger_records where workspace_id=$1 order by ledger_id',[WS_A])).rows});
   const s0=await state();
   const bad=[
    ['unknown format',{format:'x',version:1,items:[{target:'COM-0001',do:'retire',reason:'x'}]},/LEDGER_FIX_BAD_REQUEST/],
    ['not an array',{format:'kptu-ledger-fix',version:1,items:'x'},/LEDGER_FIX_BAD_REQUEST/],
    ['21 items',fixReq(Array.from({length:21},(_,i)=>({target:'EVT-09'+String(i).padStart(2,'0'),do:'retire',reason:'x'}))),/LEDGER_FIX_BAD_REQUEST/],
    ['replace without reason',fixReq([{target:'COM-0001',do:'replace',set:{counterparty:'다른 사측'}}]),/LEDGER_FIX_BAD_REQUEST/],
    ['replace with empty set',fixReq([{target:'COM-0001',do:'replace',set:{},reason:'x'}]),/LEDGER_FIX_BAD_REQUEST/],
    ['kind cannot be changed',fixReq([{target:'COM-0001',do:'replace',set:{kind:'event'},reason:'x'}]),/LEDGER_FIX_BAD_REQUEST/],
    ['ledger id cannot be changed',fixReq([{target:'COM-0001',do:'replace',set:{ledger_id:'COM-9999'},reason:'x'}]),/LEDGER_FIX_BAD_REQUEST/],
    ['validity cannot be set',fixReq([{target:'COM-0001',do:'replace',set:{validity:'retired'},reason:'x'}]),/LEDGER_FIX_BAD_REQUEST/],
    ['set on retire',fixReq([{target:'COM-0001',do:'retire',set:{title:'x'},reason:'x'}]),/LEDGER_FIX_BAD_REQUEST/],
    ['same target twice',fixReq([{target:'COM-0001',do:'retire',reason:'x'},{target:'COM-0001',do:'retire',reason:'y'}]),/LEDGER_FIX_BAD_REQUEST/],
    ['target missing',fixReq([{target:'COM-0001',do:'retire',reason:'x'},{target:'EVT-8888',do:'retire',reason:'y'}]),/LEDGER_FIX_BROKEN_REF/],
    ['second item already retired',fixReq([{target:'COM-0001',do:'retire',reason:'x'},{target:dRetired,do:'retire',reason:'y'}]),/LEDGER_FIX_TARGET_INACTIVE/],
    ['S3 sensitivity',fixReq([{target:'COM-0001',do:'replace',set:{sensitivity:'S3'},reason:'x'}]),/LEDGER_AUTO_BAD_ITEM/],
    ['personal number in the reason',fixReq([{target:'COM-0001',do:'retire',reason:'900101-1234567'}]),/LEDGER_FIX_BAD_REQUEST/],
    ['personal number in a field',fixReq([{target:'COM-0001',do:'replace',set:{note:'010-1234-5678'},reason:'x'}]),/LEDGER_AUTO_PERSONAL/],
    ['date check violated',fixReq([{target:'COM-0001',do:'replace',set:{date_start:'2026-10-24',date_precision:'unknown'},reason:'x'}]),/LEDGER_FIX_BAD_RECORD/],
    ['add_source without source',fixReq([{target:'COM-0001',do:'add_source',reason:'x'}]),/LEDGER_FIX_BAD_REQUEST/],
    ['add_source with a missing source id',fixReq([{target:'COM-0001',do:'add_source',source:{ledger_id:'SRC-8888'}}]),/LEDGER_AUTO_BROKEN_REF/],
    ['sets event_status on a commitment',fixReq([{target:'COM-0001',do:'replace',set:{event_status:'closed'},reason:'x'}]),/LEDGER_FIX_BAD_RECORD/],
   ];
   for(const [label,req,pattern] of bad){await assert.rejects(fix(req,false),{message:pattern},label);await assert.rejects(fix(req,true),{message:pattern},label+' (dry run)');assert.deepEqual(await state(),s0,label);}
   // Good: commitment follow-up date fixed; a decision retired as wrong; one more source on an event (existing source id, then again = already attached).
   const ok=await fix(fixReq([{target:'COM-0001',do:'replace',set:{follow_up_on:'2026-11-12',counterparty:'가 사측 대표'},reason:'날짜와 상대측'},
     {target:'DEC-0901',do:'retire',reason:'잘못 뽑힌 결정'},
     {target:'EVT-0901',do:'add_source',source:{ledger_id:'SRC-0901'},locator:'1쪽'}],{received_from:'user'}));
   assert.equal(ok.applied,3);
   const com=await one("select * from public.app_ledger_records where workspace_id=$1 and kind='commitment' and validity='current'",[WS_A]);
   assert.deepEqual([com.counterparty,com.commitment_status,com.sensitivity,com.importance],['가 사측 대표','waiting','S2','high']);
   assert.equal((await rec('COM-0001')).validity,'superseded');assert.equal((await rec('DEC-0901')).validity,'retired');
   assert.equal(await count('app_ledger_record_sources',"record_id=$2 and locator='1쪽'",[WS_A,evtOld.id]),1);
   assert.equal((await one('select received_from from public.app_ledger_fix_requests where id=$1',[ok.fix_request_id])).received_from,'user');
   const again=await fix(fixReq([{target:'EVT-0901',do:'add_source',source:{ledger_id:'SRC-0901'},locator:'1쪽'}]));
   assert.equal(again.items[0].changes[0].after,'already attached');
   assert.equal(await count('app_ledger_record_changes',"fix_request_id=$2 and action='source_added'",[WS_A,again.fix_request_id]),0);
   assert.equal((await count('app_ledger_fix_requests'))-start.fix,2);
   fixStart={...fixStart,ok:ok.fix_request_id,com:com.id};
  });
  await t.test('undo fix: old record back to its earlier state, new record retired, added line removed; refused after later edits or references; stranger refused',async()=>{
   // Undo the commitment/decision/source request.
   const u=await undoFix(fixStart.ok);
   assert.deepEqual([u.status,u.records_retired,u.targets_restored,u.sources_unlinked],['undone',1,2,1]);
   const com=await rec('COM-0001');assert.deepEqual([com.validity,com.superseded_by,com.supersede_reason],['current',null,null]);
   assert.equal((await rec('DEC-0901')).validity,'needs_check');
   assert.equal((await pool.query('select validity from public.app_ledger_records where id=$1',[fixStart.com])).rows[0].validity,'retired');
   assert.equal(await count('app_ledger_record_sources',"record_id=$2 and locator='1쪽'",[WS_A,evtOld.id]),0);
   assert.equal((await one('select status from public.app_ledger_fix_requests where id=$1',[fixStart.ok])).status,'undone');
   assert.equal((await pool.query("select count(*)::int n from public.app_ledger_audit where event='note' and target_table='fix_requests' and target_id=$1",[fixStart.ok])).rows[0].n,1);
   await assert.rejects(undoFix(fixStart.ok),{code:'55000',message:/LEDGER_FIX_UNDO_NOT_APPLIED/});
   await assert.rejects(stranger(c=>c.query('select public.app_undo_ledger_fix($1)',[fixStart.second])),{code:'P0001'});
   // The first EVT-0902 fix is chained by the second one: its new record is now superseded → undo refused.
   await assert.rejects(undoFix(fixStart.first),{code:'55000',message:/LEDGER_FIX_UNDO_(REFERENCED|CHANGED)/});
   // Undo the latest (second) fix; then edit the new record by hand after a re-apply → refused.
   const u2=await undoFix(fixStart.second);assert.equal(u2.status,'undone');
   assert.equal((await pool.query('select validity from public.app_ledger_records where id=$1',[fixStart.fresh])).rows[0].validity,'current');
   const again=await fix(fixReq([{target:'EVT-0901',do:'replace',set:{summary:'다시 고침'},reason:'요지'}]));
   const newId=(await one("select id from public.app_ledger_records where workspace_id=$1 and title='가상 기존 사건' and validity='current'",[WS_A])).id;
   await owner(c=>c.query("update public.app_ledger_records set note='손으로 고침' where id=$1",[newId]));
   const s0=(await pool.query('select ledger_id,validity from public.app_ledger_records where workspace_id=$1 order by ledger_id',[WS_A])).rows;
   await assert.rejects(undoFix(again.fix_request_id),{code:'55000',message:/LEDGER_FIX_UNDO_CHANGED/});
   assert.deepEqual((await pool.query('select ledger_id,validity from public.app_ledger_records where workspace_id=$1 order by ledger_id',[WS_A])).rows,s0);
   // A later edit of the replaced (old) record also blocks the undo.
   const again2=await fix(fixReq([{target:'COM-0001',do:'retire',reason:'다시 폐기'}]));
   await owner(c=>c.query("update public.app_ledger_records set note='손으로 고침' where workspace_id=$1 and ledger_id='COM-0001'",[WS_A]));
   await assert.rejects(undoFix(again2.fix_request_id),{code:'55000',message:/LEDGER_FIX_UNDO_CHANGED/});
  });
  await t.test('existing ledger behavior still works: search sees the new records; candidates confirm/undo unaffected; audit CHECK still rejects unknown names',async()=>{
   const rows=(await owner(c=>c.query("select * from public.app_ledger_search('교섭',null,null,null,null,null,'S2','work',false,50)"))).rows;
   assert.ok(rows.length>=1);
   await assert.rejects(pool.query("insert into public.app_ledger_audit(workspace_id,event,target_table,target_id) values ($1,'note','nonsense',gen_random_uuid())",[WS_A]),{code:'23514'});
   await pool.query("insert into public.app_ledger_audit(workspace_id,event,target_table,target_id) values ($1,'note','auto_runs',gen_random_uuid())",[WS_A]);
   const cand=await owner(c=>c.query(`insert into public.app_ledger_candidates(workspace_id,origin,action,kind,title,payload,sensitivity,dedup_key) values ($1,'web2_ai','new','event','가상 후보','{}','S1','k-1') returning id`,[WS_A])).then(r=>r.rows[0].id);
   const conf=await owner(c=>c.query('select public.app_confirm_ledger_candidate($1,null) r',[cand])).then(r=>r.rows[0].r);
   assert.equal(conf.status,'confirmed');
   const un=await owner(c=>c.query('select public.app_unconfirm_ledger_candidate($1) r',[cand])).then(r=>r.rows[0].r);
   assert.equal(un.status,'pending');
  });
  await t.test('guarded rollback: stops while rows exist; after they are removed it restores the snapshot and the earlier audit list',async()=>{
   const c=await pool.connect();
   try{await assert.rejects(c.query(rollbackSQL),/LEDGER_AUTO_RECORD_ROLLBACK_BLOCKED/);await c.query('rollback');}finally{c.release();}
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,1);
   // Clean up everything the tests created, as the person doing the rollback would (separately approved).
   await pool.query('delete from public.app_ledger_record_changes');await pool.query('delete from public.app_ledger_auto_sources');
   await pool.query('delete from public.app_ledger_fix_requests');await pool.query('delete from public.app_ledger_auto_runs');
   await pool.query("delete from public.app_ledger_audit where target_table in ('auto_runs','fix_requests')");
   await pool.query(rollbackSQL);
   for(const fn of ['app_auto_ledger_begin(uuid)','app_auto_ledger_record(uuid,jsonb)','app_auto_ledger_undo(uuid)','app_apply_ledger_fix(uuid,jsonb,boolean)','app_undo_ledger_fix(uuid)','private.app_auto_ledger_personal(text)','private.app_auto_ledger_log(uuid,uuid,text,text,uuid,uuid,text,uuid,text,jsonb,text)'])
    assert.equal((await pool.query('select to_regprocedure($1) p',[fn.includes('.')?fn:'public.'+fn])).rows[0].p,null,fn);
   const rows=(await pool.query(snapshot)).rows;
   assert.deepEqual(rows.filter(r=>r.kind!=='history'),before.filter(r=>r.kind!=='history'));
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
