// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic (09xx ids, made-up names).
// LEDGER-확정되돌리기: 20261021234000_ledger_candidate_undo — app_unconfirm_ledger_candidate (undo one confirmation in one
// transaction) and the candidate guard trigger that opens "confirmed -> pending" only for that function.
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
import {fixture,OWNER,STRANGER,WS_A,PROJECT_A,MEETING_A} from './basket4-fixture.mjs';
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
const version='20261021234000',name='ledger_candidate_undo',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const externalPort=process.env.LEDGER_PG_PORT;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const NOTE_A='26000000-0000-4000-8000-000000000011';

test('LEDGER-확정되돌리기: files, apply, confirm → undo → confirm again, refusals, audit, guard, rollback',{timeout:120000},async t=>{
 let cluster,pool,adminPool,database='postgres',port,password;
 if(externalPort){
  port=Number(externalPort);database='ledgerundo_'+randomBytes(4).toString('hex');
  adminPool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres',ssl:false}));
  await adminPool.query('create database '+database);
  for(const role of ['anon','authenticated','public_probe','service_role'])await adminPool.query(`drop role if exists ${role}`).catch(()=>{});
 }else{
  const directory=await mkdtemp(join(tmpdir(),'ledger-undo-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));port=sock.address().port;await new Promise(r=>sock.close(r));
  password=randomBytes(24).toString('hex');
  cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
  await cluster.initialise();await cluster.start();
 }
 try{
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database,ssl:false}));
  await pool.query(fixture);
  for(const file of ['20261021082000_ledger_schema','20261021150000_ledger_import','20261021190000_ledger_candidates'])
   await pool.query(await read('supabase/migrations/'+file+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const summary=await read('docs/'+stem+'.summary.md');
  const v=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value??r.ok]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const confirm=(id,edit=null)=>owner(c=>c.query('select public.app_confirm_ledger_candidate($1,$2) r',[id,edit===null?null:JSON.stringify(edit)])).then(r=>r.rows[0].r);
  const undo=(id,who=owner)=>who(c=>c.query('select public.app_unconfirm_ledger_candidate($1) r',[id])).then(r=>r.rows[0].r);
  const addCandidate=row=>owner(c=>c.query(`insert into public.app_ledger_candidates(workspace_id,origin,action,kind,target_record_id,title,payload,sensitivity,dedup_key)
    values($1,'web2_ai',coalesce($2,'new'),$3,$4,$5,$6,'S1',$7) returning id`,[WS_A,row.action??null,row.kind,row.target??null,row.title,JSON.stringify(row.payload??{}),row.dedup_key??null])).then(r=>r.rows[0].id);
  const one=async(sql,args=[])=>(await pool.query(sql,args)).rows[0];
  const count=async(table,where='true',args=[WS_A])=>(await pool.query(`select count(*)::int n from public.${table} where workspace_id=$1 and ${where}`,args)).rows[0].n;
  const cand=id=>one('select status,title,payload,result_record_id,decided_at from public.app_ledger_candidates where id=$1',[id]);
  const rec=id=>one('select ledger_id,validity,superseded_by,supersede_reason from public.app_ledger_records where id=$1',[id]);
  const recordId=async ledger=>(await one('select id from public.app_ledger_records where workspace_id=$1 and ledger_id=$2',[WS_A,ledger])).id;

  await t.test('files: expanded workflow rules pass (apply, dry-run); rollback is SQL Editor only; summary 3 lines; invoker only',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual(plan.functions,['private.app_guard_ledger_candidate','public.app_unconfirm_ledger_candidate']);
    assert.equal(plan.review.definer.length,0);assert.equal(plan.review.policies,0);
   }
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|\bto (anon|public|service_role)\b|row level security|rtw_|create (table|policy)|alter (table|policy)|\bdrop |set_config/i);
   assert.equal((code.match(/security invoker\s+set search_path = ''/g)||[]).length,2);
   assert.match(code,/^begin;/);assert.match(code,/commit;\s*$/);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/drop table|delete from public|update public|truncate|cascade|grant |policy/i);
  });

  // Small ledger (S7-b import): prefixes, a topic, an organization, a source and an event.
  await owner(c=>c.query('select public.app_import_ledger_apply($1,$2,false)',[WS_A,JSON.stringify({format:'kptu-ledger-import',version:1,kind:'sheet',label:'가상 원장',sha256:'2'.repeat(64),
   id_prefixes:{event:'EVT',change:'CHG',decision:'DEC',evidence:'EVD',commitment:'COM',source:'SRC',organization:'ORG',topic:'TOP'},
   topics:[{ledger_id:'TOP-0901',name:'가상 주제'}],organizations:[{ledger_id:'ORG-0901',name:'가 지부'}],sources:[{ledger_id:'SRC-0901',title:'가상 공문',doc_type:'official_letter'}],
   records:[{kind:'event',ledger_id:'EVT-0901',title:'가상 사건',event_status:'tracking'}]})]));
  // A candidate confirmed before the migration (as in production): it must be undoable after apply.
  const early=await addCandidate({kind:'event',title:'가상 적용 전 확정',payload:{sources:[{source:'SRC-0901'}]}});
  const earlyResult=await confirm(early);
  await t.test('before apply: a confirmed candidate cannot go back to pending (old lock)',async()=>{
   await assert.rejects(owner(c=>c.query(`update public.app_ledger_candidates set status='pending',result_record_id=null,decided_at=null where id=$1`,[early])),/LEDGER_ALREADY_DECIDED/);
  });
  const before=(await pool.query(snapshot)).rows;
  await t.test('precheck 예, apply once, postcheck all 예, earlier postchecks still 예, second apply refused',async()=>{
   const pre=v((await pool.query(precheck)).rows);
   for(const k of ['new migration absent','ledger schema applied (20261021082000)','ledger candidates applied (20261021190000)','confirm function present','no undo function yet','candidate guard trigger uses the old guard'])assert.equal(pre[k],'예',k);
   assert.equal(before.filter(r=>r.kind==='undo function').length,0);
   await pool.query(migration);
   assert.equal(await history(),1);
   for(const [k,val] of Object.entries(v((await pool.query(postcheck)).rows)))assert.equal(val,'예',k);
   for(const prev of ['docs/20261021082000_ledger_schema.postcheck.sql','docs/20261021150000_ledger_import.postcheck.sql','docs/20261021190000_ledger_candidates.postcheck.sql'])
    for(const [k,val] of Object.entries(v((await pool.query(await read(prev))).rows)))assert.equal(val,'예',prev+' '+k);
   await assert.rejects(pool.query(migration),/LEDGER_UNDO_PREREQUISITE_CHANGED/);await pool.query('rollback');
   assert.equal(await history(),1);
  });

  await t.test('confirm → undo → confirm again: links and source links removed, record retired, new id, audit kept',async()=>{
   const web2={new:{title:'Web2 업데이트 2026-10-21',doc_type:'internal_doc',location:'web2:basket:'+NOTE_A,source_date:'2026-10-21'}};
   const id=await addCandidate({kind:'event',title:'가상 교섭 시작',dedup_key:'web2:basket:'+NOTE_A+':가상교섭',payload:{
    record:{summary:'가 지부 교섭 시작.',date_start:'2026-10-21',date_precision:'day',topic:'TOP-0901'},
    sources:[web2,{source:'SRC-0901',locator:'1쪽'}],links:[{target_organization:'ORG-0901',relation:'direct'},{target_project_id:PROJECT_A},{target_meeting_id:MEETING_A}]}});
   const r1=await confirm(id);
   assert.equal(r1.ledger_id,'EVT-0903');
   const counter=async()=>(await one(`select last_number from public.app_ledger_id_counters where workspace_id=$1 and scope='event'`,[WS_A])).last_number;
   const audits=await count('app_ledger_audit');
   const u=await undo(id);
   assert.deepEqual({s:u.status,r:u.record_id,l:u.ledger_id,ret:u.record_retired,sl:u.sources_unlinked,lr:u.links_removed,sr:u.sources_retired,tr:u.target_restored},
    {s:'pending',r:r1.record_id,l:'EVT-0903',ret:true,sl:2,lr:3,sr:1,tr:false});
   assert.equal((await rec(r1.record_id)).validity,'retired');
   assert.equal(await count('app_ledger_record_sources','record_id=$2',[WS_A,r1.record_id]),0);
   assert.equal(await count('app_ledger_links','record_id=$2',[WS_A,r1.record_id]),0);
   assert.equal((await one('select status from public.app_ledger_sources where location=$1',['web2:basket:'+NOTE_A])).status,'retired');
   assert.equal((await one(`select status from public.app_ledger_sources where workspace_id=$1 and ledger_id='SRC-0901'`,[WS_A])).status,'active');
   const c=await cand(id);
   assert.deepEqual({s:c.status,r:c.result_record_id,d:c.decided_at},{s:'pending',r:null,d:null});
   // Audit: nothing removed; one note + candidate_decided (before = confirmed) + 5 row_delete + 2 row_update (source, record).
   assert.ok(await count('app_ledger_audit')>=audits+8);
   const note=await one(`select detail from public.app_ledger_audit where event='note' and target_id=$1`,[id]);
   assert.equal(note.detail.action,'candidate_unconfirm');assert.equal(note.detail.ledger_id,'EVT-0903');
   const decided=(await pool.query(`select detail->'before'->>'status' s from public.app_ledger_audit where event='candidate_decided' and target_id=$1 order by created_at`,[id])).rows.map(r=>r.s);
   assert.deepEqual(decided,['pending','confirmed']);
   // Undo again is refused (pending), and the confirm again gets a new id; the old number is not reused.
   await assert.rejects(undo(id),/LEDGER_UNDO_NOT_CONFIRMED/);
   const r2=await confirm(id);
   assert.equal(r2.ledger_id,'EVT-0904');assert.equal(await counter(),904);
   assert.equal(r2.sources_added,2);assert.equal(r2.links_added,3);
   // The retired web2 source is not reused: a fresh one (new id) is made.
   assert.equal(await count('app_ledger_sources',`location=$2 and status='active'`,[WS_A,'web2:basket:'+NOTE_A]),1);
  });

  await t.test('[고쳐서 확정] then undo: the edited title and payload stay on the pending candidate and can be edited again',async()=>{
   const id=await addCandidate({kind:'commitment',title:'가상 자료 회신',payload:{record:{counterparty:'가상 기관'}}});
   const r=await confirm(id,{title:'가상 기관 자료 회신',payload:{record:{counterparty:'가상 기관',follow_up_on:'2026-10-30'}}});
   await undo(id);
   const c=await cand(id);
   assert.equal(c.status,'pending');assert.equal(c.title,'가상 기관 자료 회신');assert.equal(c.payload.record.follow_up_on,'2026-10-30');
   assert.equal((await rec(r.record_id)).validity,'retired');
   const again=await confirm(id,{title:'가상 기관 자료 회신 2'});
   assert.equal((await one('select title from public.app_ledger_records where id=$1',[again.record_id])).title,'가상 기관 자료 회신 2');
  });

  await t.test('refused (nothing changes): record edited after confirm, linked from another record, source link edited, candidate pointing at it',async()=>{
   const snap=async()=>[await count('app_ledger_records',`validity='retired'`),await count('app_ledger_links'),await count('app_ledger_record_sources'),await count('app_ledger_audit')];
   // edited
   const a=await addCandidate({kind:'event',title:'가상 고친 기록'});
   const ra=await confirm(a);
   await owner(c=>c.query(`update public.app_ledger_records set summary='손으로 고침' where id=$1`,[ra.record_id]));
   let s=await snap();
   await assert.rejects(undo(a),/LEDGER_UNDO_RECORD_CHANGED/);
   assert.deepEqual(await snap(),s);assert.equal((await cand(a)).status,'confirmed');
   // a source added by hand after confirm
   const b=await addCandidate({kind:'event',title:'가상 출처 더함'});
   const rb=await confirm(b);
   await owner(c=>c.query(`insert into public.app_ledger_record_sources(workspace_id,record_id,source_id) select $1,$2,id from public.app_ledger_sources where ledger_id='SRC-0901'`,[WS_A,rb.record_id]));
   await assert.rejects(undo(b),/LEDGER_UNDO_RECORD_CHANGED/);
   // a confirm-made link edited after confirm
   const e=await addCandidate({kind:'event',title:'가상 연결 고침',payload:{links:[{target_organization:'ORG-0901',relation:'direct'}]}});
   const re=await confirm(e);
   await owner(c=>c.query(`update public.app_ledger_links set note='고침' where record_id=$1`,[re.record_id]));
   await assert.rejects(undo(e),/LEDGER_UNDO_RECORD_CHANGED/);
   // a confirm-made source link removed after confirm
   const g=await addCandidate({kind:'event',title:'가상 출처 뗌',payload:{sources:[{source:'SRC-0901'}]}});
   const rg=await confirm(g);
   await owner(c=>c.query(`delete from public.app_ledger_record_sources where record_id=$1`,[rg.record_id]));
   await assert.rejects(undo(g),/LEDGER_UNDO_RECORD_CHANGED/);
   // linked from another record (a change belonging to it)
   const d=await addCandidate({kind:'event',title:'가상 연결된 사건'});
   const rd=await confirm(d);
   const ch=await addCandidate({kind:'change',title:'가상 소속 변화',payload:{links:[{target_record:rd.ledger_id,relation:'belongs_to'}]}});
   await confirm(ch);
   s=await snap();
   await assert.rejects(undo(d),/LEDGER_UNDO_REFERENCED/);
   assert.deepEqual(await snap(),s);
   // a pending candidate targets it (add_source)
   const f=await addCandidate({kind:'event',title:'가상 대상 후보'});
   const rf=await confirm(f);
   await addCandidate({kind:'event',action:'add_source',target:rf.record_id,title:'가상 출처 후보',payload:{sources:[{source:'SRC-0901'}]}});
   await assert.rejects(undo(f),/LEDGER_UNDO_REFERENCED/);
   // the change can still be undone (it points out, nobody points at it); afterwards the event can be undone too
   await undo(ch);
   await undo(d);
   assert.equal((await rec(rd.record_id)).validity,'retired');
  });

  await t.test('supersede: undo restores the replaced record; refused when the replaced record was edited after confirm',async()=>{
   const d1=await addCandidate({kind:'decision',title:'가상 결정 1',payload:{record:{decision_type:'adopted',decision_reason:'가상 이유',validity:'needs_check'}}});
   const r1=await confirm(d1);
   const d2=await addCandidate({kind:'decision',action:'supersede',target:r1.record_id,title:'가상 결정 2',payload:{record:{decision_type:'changed'},supersede_reason:'가상 변경'}});
   const r2=await confirm(d2);
   // The replaced record cannot be undone while something supersedes it.
   await assert.rejects(undo(d1),/LEDGER_UNDO_REFERENCED/);
   const u=await undo(d2);
   assert.equal(u.target_restored,true);
   assert.deepEqual(await rec(r1.record_id),{ledger_id:r1.ledger_id,validity:'needs_check',superseded_by:null,supersede_reason:null});
   assert.equal((await rec(r2.record_id)).validity,'retired');
   // confirm again (target is active again), edit the replaced record, then undo is refused
   const r3=await confirm(d2);
   assert.equal((await rec(r1.record_id)).superseded_by,r3.record_id);
   await owner(c=>c.query(`update public.app_ledger_records set note='손으로' where id=$1`,[r1.record_id]));
   await assert.rejects(undo(d2),/LEDGER_UNDO_TARGET_CHANGED/);
   assert.equal((await cand(d2)).status,'confirmed');
  });

  await t.test('add_source: undo removes only the rows that confirmation added; the existing record stays as it was',async()=>{
   const target=await recordId('EVT-0901');
   const existing=await count('app_ledger_record_sources','record_id=$2',[WS_A,target]);
   const id=await addCandidate({kind:'event',action:'add_source',target,title:'가상 출처 추가',payload:{sources:[{new:{title:'가상 대화',doc_type:'ai_chat'}}],links:[{target_organization:'ORG-0901',relation:'reference'}]}});
   await confirm(id);
   const u=await undo(id);
   assert.deepEqual({ret:u.record_retired,sl:u.sources_unlinked,lr:u.links_removed,sr:u.sources_retired},{ret:false,sl:1,lr:1,sr:1});
   assert.equal(await count('app_ledger_record_sources','record_id=$2',[WS_A,target]),existing);
   assert.equal((await rec(target)).validity,'current');
  });

  await t.test('candidate confirmed before the migration is undoable; imported (sheet) records are never touched',async()=>{
   const u=await undo(early);
   assert.equal(u.status,'pending');assert.equal(u.sources_unlinked,1);
   assert.equal((await rec(earlyResult.record_id)).validity,'retired');
   // A confirmed candidate whose result is an imported record cannot exist via confirm(new); simulate with add_source onto an
   // imported record: undo touches only the confirmation rows, never the imported record itself.
   assert.equal((await rec(await recordId('EVT-0901'))).validity,'current');
  });

  await t.test('duplicate pending dedup key: undo refused with a clear reason, nothing changes',async()=>{
   const id=await addCandidate({kind:'event',title:'가상 열쇠 1',dedup_key:'chat:0990'});
   const r=await confirm(id);
   await addCandidate({kind:'event',title:'가상 열쇠 2',dedup_key:'chat:0990'});
   const audits=await count('app_ledger_audit');
   await assert.rejects(undo(id),/LEDGER_UNDO_DUPLICATE_PENDING/);
   assert.equal(await count('app_ledger_audit'),audits);
   assert.equal((await rec(r.record_id)).validity,'current');
  });

  await t.test('guard: only the function opens confirmed → pending; direct updates, a forged audit note and discarded rows stay locked',async()=>{
   const id=await addCandidate({kind:'event',title:'가상 잠금 시험'});
   await confirm(id);
   await assert.rejects(owner(c=>c.query(`update public.app_ledger_candidates set status='pending',result_record_id=null,decided_at=null where id=$1`,[id])),/LEDGER_ALREADY_DECIDED/);
   await assert.rejects(owner(c=>c.query(`update public.app_ledger_candidates set title='바꿈' where id=$1`,[id])),/LEDGER_ALREADY_DECIDED/);
   // A note written in an earlier transaction does not open the lock.
   await owner(c=>c.query(`insert into public.app_ledger_audit(workspace_id,event,target_table,target_id,detail) values($1,'note','candidates',$2,'{"action":"candidate_unconfirm"}')`,[WS_A,id]));
   await assert.rejects(owner(c=>c.query(`update public.app_ledger_candidates set status='pending',result_record_id=null,decided_at=null where id=$1`,[id])),/LEDGER_ALREADY_DECIDED/);
   // Even in the same transaction, the unconfirm path may not change title/payload at the same time.
   await assert.rejects(owner(async c=>{
    await c.query(`insert into public.app_ledger_audit(workspace_id,event,target_table,target_id,detail) values($1,'note','candidates',$2,'{"action":"candidate_unconfirm"}')`,[WS_A,id]);
    return c.query(`update public.app_ledger_candidates set status='pending',result_record_id=null,decided_at=null,title='바꿈' where id=$1`,[id]);
   }),/LEDGER_ALREADY_DECIDED/);
   const dis=await addCandidate({kind:'event',title:'가상 버린 후보'});
   await owner(c=>c.query(`update public.app_ledger_candidates set status='discarded',decided_at=now(),discard_reason='가상' where id=$1`,[dis]));
   await assert.rejects(undo(dis),/LEDGER_UNDO_NOT_CONFIRMED/);
   await assert.rejects(owner(c=>c.query(`update public.app_ledger_candidates set status='pending',decided_at=null,discard_reason=null where id=$1`,[dis])),/LEDGER_ALREADY_DECIDED/);
   // Pending candidates still edit freely; the import batch lock is unchanged.
   const p=await addCandidate({kind:'event',title:'가상 대기'});
   await owner(c=>c.query(`update public.app_ledger_candidates set title='가상 대기 고침' where id=$1`,[p]));
   await owner(c=>c.query(`update public.app_ledger_imports set status='confirmed',decided_at=now() where workspace_id=$1 and status='applied'`,[WS_A]));
   await assert.rejects(owner(c=>c.query(`update public.app_ledger_imports set status='reverted' where workspace_id=$1 and status='confirmed'`,[WS_A])),/LEDGER_ALREADY_DECIDED/);
  });

  await t.test('only the owner: stranger sees nothing, anon and service_role cannot call, guard not callable',async()=>{
   const id=await addCandidate({kind:'event',title:'가상 남의 되돌리기'});
   await confirm(id);
   await assert.rejects(undo(id,stranger),/LEDGER_UNDO_NOT_FOUND/);
   await assert.rejects(as('anon','',c=>c.query('select public.app_unconfirm_ledger_candidate($1)',[id])),{code:'42501'});
   await assert.rejects(as('service_role','',c=>c.query('select public.app_unconfirm_ledger_candidate($1)',[id])),{code:'42501'});
   assert.equal((await cand(id)).status,'confirmed');
  });

  await t.test('rollback: old lock back, two functions and the history row gone; ledger rows and candidates stay; snapshot matches',async()=>{
   const rows=[await count('app_ledger_records'),await count('app_ledger_candidates'),await count('app_ledger_audit')];
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual([await count('app_ledger_records'),await count('app_ledger_candidates'),await count('app_ledger_audit')],rows);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const post=v((await pool.query(postcheck)).rows);
   assert.equal(post['functions and history agree'],'예');assert.equal(post['import guard trigger unchanged'],'예');
   assert.equal(post['candidate guard trigger uses the new guard'],'아니오');
   const id=await addCandidate({kind:'event',title:'가상 되돌린 뒤'});
   await confirm(id);
   await assert.rejects(owner(c=>c.query(`update public.app_ledger_candidates set status='pending',result_record_id=null,decided_at=null where id=$1`,[id])),/LEDGER_ALREADY_DECIDED/);
  });
 }finally{
  await closePool(pool);
  if(adminPool){await adminPool.query(`drop database if exists ${database} with (force)`).catch(()=>{});await closePool(adminPool);}
  await cluster?.stop();
 }
});
