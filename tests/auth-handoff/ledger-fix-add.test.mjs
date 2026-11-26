// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic (09xx ids, made-up names).
// LEDGER-수정요청 DB: 20261024200000_ledger_fix_add — app_apply_ledger_fix also takes do:'add' (a new record the owner enters by hand,
// from the [+ 기록하기] box). Same signature, INVOKER, authenticated only. replace/retire/add_source unchanged. Undo via app_undo_ledger_fix.
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
import {fixture,OWNER,STRANGER,WS_A} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261024200000',name='ledger_fix_add',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;

test('LEDGER-수정요청 DB: plan, apply, add (event/change/commitment/org links), refusals, undo, replace still works, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'ledger-fix-add-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  for(const file of ['20261021082000_ledger_schema','20261021150000_ledger_import','20261021190000_ledger_candidates','20261021234000_ledger_candidate_undo','20261024120000_ledger_auto_record'])
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
  const fix=(request,dry=false,who=owner)=>who(c=>c.query('select public.app_apply_ledger_fix($1,$2,$3) r',[WS_A,JSON.stringify(request),dry])).then(r=>r.rows[0].r);
  const undoFix=id=>owner(c=>c.query('select public.app_undo_ledger_fix($1) r',[id])).then(r=>r.rows[0].r);
  const req=(items)=>({format:'kptu-ledger-fix',version:1,received_from:'user',items});
  const rec=ledger=>one('select * from public.app_ledger_records where workspace_id=$1 and ledger_id=$2',[WS_A,ledger]);

  await owner(c=>c.query('select public.app_import_ledger_apply($1,$2,false)',[WS_A,JSON.stringify({format:'kptu-ledger-import',version:1,kind:'sheet',label:'가상 원장',sha256:'4'.repeat(64),
   id_prefixes:{event:'EVT',change:'CHG',decision:'DEC',evidence:'EVD',commitment:'COM',source:'SRC',organization:'ORG',topic:'TOP'},
   topics:[{ledger_id:'TOP-0901',name:'가상 주제'}],organizations:[{ledger_id:'ORG-0901',name:'가 지부'}],sources:[{ledger_id:'SRC-0901',title:'가상 공문',doc_type:'official_letter'}],
   records:[{kind:'event',ledger_id:'EVT-0901',title:'가상 기존 사건',event_status:'tracking'},{kind:'decision',ledger_id:'DEC-0901',title:'가상 기존 결정',decision_type:'adopted'}]})]));
  await pool.query("update public.app_ledger_imports set status='confirmed',decided_at=now() where status='applied'");
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules pass; one function replaced, no definer, no policy; rollback restores the old body; summary 3 lines',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual(plan.functions,['public.app_apply_ledger_fix']);assert.equal(plan.review.definer.length,0);assert.equal(plan.review.policies,0);assert.equal(plan.review.triggers,0);
    assert.deepEqual(plan.createdTables,[]);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|disable row level security|create policy|alter policy|drop policy|\bto (?:anon|public|service_role)\b|rtw_|set_config|create table/i);
   assert.match(code,/revoke all on function public\.app_apply_ledger_fix\(uuid,jsonb,boolean\) from public, anon, service_role;\s*grant execute on function public\.app_apply_ledger_fix\(uuid,jsonb,boolean\) to authenticated;/);
   // The rollback carries the earlier body verbatim.
   const orig=s=>{const i=s.indexOf('function public.app_apply_ledger_fix');return s.slice(s.indexOf('as $$',i),s.indexOf('$$;',i)+3);};
   return read('supabase/migrations/20261024120000_ledger_auto_record.sql').then(prev=>assert.equal(orig(rollbackSQL),orig(prev)));
  });
  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   const dry=await run('dry-run','9911');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await readOnly(precheck),beforeCheck);
   const apply=await run('apply','9912');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck));
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else assert.equal(value,v[item],item);
   }
   assert.equal((await run('apply','9913')).ok,false);
  });

  let added;
  await t.test('add: a new event with org link and topic; a change under it; a commitment — all current, marked "명진이 직접 기록"',async()=>{
   const items=[
    {do:'add',kind:'event',set:{title:'가상 나 지부 2차 교섭',summary:'2차 교섭 진행.',date_start:'2026-11-05',date_precision:'day',topic:'TOP-0901'},reason:'직접 기록',links:[{target_organization:'ORG-0901'}]},
    {do:'add',kind:'change',belongs_to:'EVT-0901',set:{title:'가상 기존 사건 진전',date_start:'2026-10-24',date_precision:'day'}},
    {do:'add',kind:'commitment',set:{title:'가상 사측 자료 회신 약속',counterparty:'가 사측',follow_up_on:'2026-11-01',sensitivity:'S2'}},
   ];
   const s0={rec:await count('app_ledger_records'),fix:await count('app_ledger_fix_requests')};
   const dry=await fix(req(items),true);
   assert.equal(dry.dry_run,true);assert.equal(dry.fix_request_id,null);assert.equal(dry.applied,3);
   assert.deepEqual(dry.items.map(i=>[i.do,i.kind,i.target]),[['add','event',null],['add','change',null],['add','commitment',null]]);
   assert.deepEqual(dry.items[0].changes.find(c=>c.field==='date_start'),{field:'date_start',before:null,after:'2026-11-05'});
   assert.deepEqual({rec:await count('app_ledger_records'),fix:await count('app_ledger_fix_requests')},s0);
   const done=await fix(req(items));
   assert.ok(done.fix_request_id);assert.equal(done.applied,3);
   const fr=await one('select status,received_from,result from public.app_ledger_fix_requests where id=$1',[done.fix_request_id]);
   assert.deepEqual([fr.status,fr.received_from],['applied','user']);
   const [evId,chgId,comId]=fr.result.items.map(i=>i.new);
   assert.match(evId,/^EVT-\d+$/);assert.match(chgId,/^CHG-\d+$/);assert.match(comId,/^COM-\d+$/);
   const ev=await rec(evId),chg=await rec(chgId),com=await rec(comId);
   assert.deepEqual([ev.validity,ev.event_status,ev.sensitivity,ev.topic_id!==null],['current','tracking','S1',true]);
   assert.equal(await count('app_ledger_links','record_id=$2 and target_organization_id is not null and relation=$3',[WS_A,ev.id,'direct']),1);
   assert.equal(await count('app_ledger_links','record_id=$2 and target_record_id=$3 and relation=$4',[WS_A,chg.id,(await rec('EVT-0901')).id,'belongs_to']),1);
   assert.deepEqual([com.commitment_status,com.counterparty,com.sensitivity],['waiting','가 사측','S2']);
   const notes=(await pool.query("select record_id,action,route,note from public.app_ledger_record_changes where fix_request_id=$1 order by created_at",[done.fix_request_id])).rows;
   assert.equal(notes.length,3);
   for(const n of notes){assert.deepEqual([n.action,n.route],['created','correction']);assert.match(n.note,/^명진이 직접 기록 · \d{4}-\d{2}-\d{2}$/);}
   // Existing records untouched.
   assert.equal((await rec('EVT-0901')).validity,'current');
   added={fix:done.fix_request_id,ev,chg,com};
  });
  await t.test('add refusals: whole request refused, nothing written',async()=>{
   const state=async()=>({rec:await count('app_ledger_records'),fix:await count('app_ledger_fix_requests'),chg:await count('app_ledger_record_changes'),links:await count('app_ledger_links')});
   const s0=await state();
   const bad=[
    ['no title',[{do:'add',kind:'event',set:{summary:'x'}}],/LEDGER_FIX_BAD_REQUEST/],
    ['blank title',[{do:'add',kind:'event',set:{title:'  '}}],/LEDGER_FIX_BAD_REQUEST/],
    ['no kind',[{do:'add',set:{title:'x'}}],/LEDGER_FIX_BAD_REQUEST/],
    ['unknown kind',[{do:'add',kind:'memo',set:{title:'x'}}],/LEDGER_FIX_BAD_REQUEST/],
    ['target with add',[{do:'add',kind:'event',target:'EVT-0901',set:{title:'x'}}],/LEDGER_FIX_BAD_REQUEST/],
    ['change without belongs_to',[{do:'add',kind:'change',set:{title:'x'}}],/LEDGER_FIX_BAD_REQUEST/],
    ['belongs_to on an event',[{do:'add',kind:'event',belongs_to:'EVT-0901',set:{title:'x'}}],/LEDGER_FIX_BAD_REQUEST/],
    ['belongs_to a decision',[{do:'add',kind:'change',belongs_to:'DEC-0901',set:{title:'x'}}],/LEDGER_FIX_BROKEN_REF/],
    ['belongs_to missing',[{do:'add',kind:'change',belongs_to:'EVT-8888',set:{title:'x'}}],/LEDGER_FIX_BROKEN_REF/],
    ['unknown org',[{do:'add',kind:'event',set:{title:'x'},links:[{target_organization:'ORG-8888'}]}],/LEDGER_FIX_BROKEN_REF/],
    ['link to a project id is not allowed by hand',[{do:'add',kind:'event',set:{title:'x'},links:[{target_project_id:'00000000-0000-4000-8000-000000000001'}]}],/LEDGER_FIX_BAD_REQUEST/],
    ['bad org relation',[{do:'add',kind:'event',set:{title:'x'},links:[{target_organization:'ORG-0901',relation:'belongs_to'}]}],/LEDGER_FIX_BAD_RECORD/],
    ['validity cannot be set',[{do:'add',kind:'event',set:{title:'x',validity:'retired'}}],/LEDGER_FIX_BAD_REQUEST/],
    ['ledger id cannot be set',[{do:'add',kind:'event',set:{title:'x',ledger_id:'EVT-9999'}}],/LEDGER_FIX_BAD_REQUEST/],
    ['S3',[{do:'add',kind:'event',set:{title:'x',sensitivity:'S3'}}],/LEDGER_AUTO_BAD_ITEM/],
    ['personal number',[{do:'add',kind:'event',set:{title:'x',summary:'010-1234-5678'}}],/LEDGER_AUTO_PERSONAL/],
    ['bad date shape',[{do:'add',kind:'event',set:{title:'x',date_start:'2026-11-05',date_precision:'unknown'}}],/LEDGER_FIX_BAD_RECORD/],
    ['kind/set on retire',[{do:'retire',target:'EVT-0901',kind:'event',reason:'x'}],/LEDGER_FIX_BAD_REQUEST/],
    ['second item wrong',[{do:'add',kind:'event',set:{title:'좋은 것'}},{do:'retire',target:'EVT-8888',reason:'x'}],/LEDGER_FIX_BROKEN_REF/],
   ];
   for(const [label,items,pattern] of bad){
    await assert.rejects(fix(req(items)),{message:pattern},label);
    await assert.rejects(fix(req(items),true),{message:pattern},label+' (dry run)');
    assert.deepEqual(await state(),s0,label);
   }
   // anon and strangers are refused.
   await assert.rejects(anon(c=>c.query('select public.app_apply_ledger_fix($1,$2,true)',[WS_A,JSON.stringify(req([{do:'add',kind:'event',set:{title:'x'}}]))])),{code:'42501'});
   await assert.rejects(fix(req([{do:'add',kind:'event',set:{title:'x'}}]),false,stranger),{code:'42501',message:/LEDGER_FIX_NOT_OWNER/});
   assert.deepEqual(await state(),s0);
  });
  await t.test('undo of the add request retires the new records (kept, not deleted); replace still works; undo refused after a later edit',async()=>{
   const u=await undoFix(added.fix);
   assert.deepEqual([u.status,u.records_retired],['undone',3]);
   for(const x of [added.ev,added.chg,added.com])assert.equal((await rec(x.ledger_id)).validity,'retired');
   assert.equal((await rec('EVT-0901')).validity,'current');
   assert.equal(await count('app_ledger_records',"ledger_id=$2",[WS_A,added.ev.ledger_id]),1);
   // replace keeps working on the widened function.
   const r=await fix(req([{target:'DEC-0901',do:'replace',set:{decision_reason:'가상 이유'},reason:'이유 보충'}]));
   assert.equal((await rec('DEC-0901')).validity,'superseded');
   assert.equal((await rec(r.items?.[0]?.target||'DEC-0901')).supersede_reason,'명진 지적으로 수정: 이유 보충');
   // A record made by add and edited afterwards blocks the undo of that add (existing rule).
   const a2=await fix(req([{do:'add',kind:'decision',set:{title:'가상 직접 결정',decision_type:'adopted'}}]));
   const made=(await one('select result from public.app_ledger_fix_requests where id=$1',[a2.fix_request_id])).result.items[0].new;
   await owner(c=>c.query("update public.app_ledger_records set note='손으로 고침' where workspace_id=$1 and ledger_id=$2",[WS_A,made]));
   await assert.rejects(undoFix(a2.fix_request_id),{code:'55000',message:/LEDGER_FIX_UNDO_CHANGED/});
   assert.equal((await rec(made)).validity,'current');
  });
  await t.test('rollback restores the earlier body; records made by add stay; add is refused afterwards',async()=>{
   await pool.query(rollbackSQL);
   const rows=(await pool.query(snapshot)).rows;
   assert.deepEqual(rows.filter(r=>r.kind!=='history'),before.filter(r=>r.kind!=='history'));
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.equal((await rec(added.ev.ledger_id)).validity,'retired');
   await assert.rejects(fix(req([{do:'add',kind:'event',set:{title:'x'}}])),{message:/LEDGER_FIX_BAD_REQUEST/});
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
