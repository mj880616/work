// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic (09xx ids, made-up names).
// LEDGER-재료 공통 DB: 20261025110000_ledger_sources — the ledger auto-record accepts three new source kinds (call, weekly_personal, calendar_ref)
// from one kind helper (CHECK + the two DB functions agree), a new owner-only table app_calendar_work_refs (참고 일정) and app_profiles.ledger_calendar.
// No service_role access to anything new; the existing six kinds keep working; rollback is refused while new-kind rows exist.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,ORG_A,ORG_B} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261025110000',name='ledger_sources',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const OLD_KINDS=['basket','note','work','meeting','org_update','project_update'],NEW_KINDS=['call','weekly_personal','calendar_ref'],ALL_KINDS=[...OLD_KINDS,...NEW_KINDS];
const B1='31000000-0000-4000-8000-000000000001',U1='36000000-0000-4000-8000-000000000001';
const T='2026-10-24T01:00:00Z';
const K1='a'.repeat(32),K2='b'.repeat(32),K3='c'.repeat(32);

const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  create function private.app_is_owner_profile(p_user uuid)
  returns boolean language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select exists (
      select 1
      from public.app_workspace_members subject
      join public.app_workspace_members owner
        on owner.workspace_id = subject.workspace_id
       and owner.role = 'owner'
       and owner.user_id = (select auth.uid())
      where subject.user_id = p_user
    )
  $$;
  revoke all on function private.app_is_owner_profile(uuid) from public, anon, authenticated;
  grant execute on function private.app_is_owner_profile(uuid) to authenticated, service_role;
  create table public.app_profiles(user_id uuid primary key,display_name text,job_title text,created_at timestamptz default now(),updated_at timestamptz default now());
  alter table public.app_profiles enable row level security;
  create policy task12a_owner_all on public.app_profiles for all to authenticated
    using (private.app_is_owner_profile(user_id)) with check (private.app_is_owner_profile(user_id));
  create policy task12a_profile_self_select on public.app_profiles for select to authenticated
    using (user_id = (select auth.uid()));
  revoke all on public.app_profiles from public, anon, authenticated;
  grant select, update on public.app_profiles to authenticated;
  insert into public.app_profiles(user_id,display_name) values ('${OWNER}','소유자'),('${STRANGER}','남');`;

test('LEDGER-재료 공통 DB: plan, apply, nine kinds in one place, owner-only 참고 일정 표, profile column, guarded rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'ledger-sources-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  // Same, but always cancelled at the end: the callback's result is returned, nothing stays.
  async function asCancelled(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);return await fn(c);}finally{await c.query('rollback').catch(()=>{});c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),anon=fn=>as('anon','',fn),service=fn=>as('service_role','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const one=async(sql,args=[])=>(await pool.query(sql,args)).rows[0];
  const refs=(where='true',args=[])=>one(`select count(*)::int n from public.app_calendar_work_refs where ${where}`,args).then(r=>r.n);
  const insertRef=(c,key,over={})=>c.query('insert into public.app_calendar_work_refs(workspace_id,event_key,day,start_at,all_day,title,judged,included,organization_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',
   [over.ws||WS_A,key,over.day||'2026-10-23',over.start_at??'2026-10-23T05:00:00Z',over.all_day??false,over.title||'가상 가 지부 간담회',over.judged||'work',over.included??true,over.org??null]);

  await owner(c=>c.query('select public.app_import_ledger_apply($1,$2,false)',[WS_A,JSON.stringify({format:'kptu-ledger-import',version:1,kind:'sheet',label:'가상 원장',sha256:'5'.repeat(64),
   id_prefixes:{event:'EVT',change:'CHG',decision:'DEC',evidence:'EVD',commitment:'COM',source:'SRC',organization:'ORG',topic:'TOP'},
   topics:[],organizations:[],sources:[],records:[{kind:'event',ledger_id:'EVT-0901',title:'가상 기존 사건',event_status:'tracking'}]})]));
  await pool.query("update public.app_ledger_imports set status='confirmed',decided_at=now() where status='applied'");
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules pass; two functions replaced, one helper, one trigger guard, one table, one policy; no definer; rollback carries the earlier bodies; summary 3 lines',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual(plan.createdTables,['app_calendar_work_refs']);
    assert.deepEqual([...plan.functions].sort(),['private.app_auto_ledger_source','private.app_auto_ledger_source_kind_ok','private.app_calendar_work_ref_guard','public.app_auto_ledger_record']);
    assert.equal(plan.review.definer.length,0);assert.equal(plan.review.policies,1);assert.equal(plan.review.restrictive,0);assert.equal(plan.review.triggers,1);
   }
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|disable row level security|alter policy|drop policy|\bto (?:anon|public|service_role)\b|using \(true\)|with check \(true\)|rtw_|set_config/i);
   assert.doesNotMatch(code,/\bgrant [^;]* to [^;]*service_role/i);
   // Every function the migration creates or replaces is revoked from public/anon/service_role first.
   assert.match(code,/revoke all on function private\.app_auto_ledger_source_kind_ok\(text\) from public, anon, service_role;\s*grant execute on function private\.app_auto_ledger_source_kind_ok\(text\) to authenticated;/);
   assert.match(code,/revoke all on function private\.app_calendar_work_ref_guard\(\) from public, anon, authenticated, service_role;/);
   // The authenticated grants on the new table are by column, nothing for anon/PUBLIC/service_role; the existing ledger tables get no grant.
   assert.doesNotMatch(code,/\bgrant [^;]* on (?:table )?public\.app_ledger_/i);
   // The rollback carries the earlier bodies verbatim.
   const prev=await read('supabase/migrations/20261024120000_ledger_auto_record.sql');
   const body=(s,sig)=>{const i=s.indexOf(sig);const a=s.indexOf('as $$',i);return s.slice(a,s.indexOf('\n$$',a));};
   for(const sig of ['function private.app_auto_ledger_source(','function public.app_auto_ledger_record('])
    assert.equal(body(rollbackSQL,sig),body(prev,sig),sig);
   // The new bodies differ from the earlier ones only where the kind list was.
   for(const sig of ['function private.app_auto_ledger_source(','function public.app_auto_ledger_record(']){
    const oldBody=body(prev,sig),newBody=body(migration,sig);
    assert.equal(newBody,oldBody.replace(/\((\w+) ->> 'kind'\) not in \('basket', 'note', 'work', 'meeting', 'org_update', 'project_update'\)/,"not private.app_auto_ledger_source_kind_ok($1 ->> 'kind')"),sig);
    assert.notEqual(newBody,oldBody);
   }
   // Kind lists: the CHECK, the helper and the rollback's restored CHECK agree; the server list (still six until the Edge PR) is inside the DB list.
   const quoted=s=>[...s.matchAll(/'([a-z_]+)'/g)].map(m=>m[1]);
   const checkList=quoted(code.match(/add constraint app_ledger_auto_sources_kind_check check \(source_kind in \(([^)]*)\)\)/)[1]);
   const helperList=quoted(code.match(/select coalesce\(p_kind in \(([^)]*)\), false\)/)[1]);
   assert.deepEqual(checkList,ALL_KINDS);assert.deepEqual(helperList,ALL_KINDS);
   assert.deepEqual(quoted(rollbackSQL.replace(/--.*$/gm,'').match(/add constraint app_ledger_auto_sources_kind_check check \(source_kind in \(([^)]*)\)\)/)[1]),OLD_KINDS);
   const server=await read('supabase/functions/ai-assist/ledger-auto.ts');
   const serverKinds=quoted(server.match(/AUTO_SOURCE_KINDS[^=]*=\s*Object\.freeze\(\[([^\]]*)\]/)[1].replace(/"/g,"'"));
   assert.ok(serverKinds.length>=OLD_KINDS.length);for(const k of serverKinds)assert.ok(ALL_KINDS.includes(k),'server kind '+k+' unknown to the DB');
  });
  await t.test('precheck as the read-only role; a changed prerequisite stops the migration before any change',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   const stops=async()=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),/LEDGER_SOURCES_PREREQUISITE_CHANGED/);await c.query('rollback');}finally{c.release();}};
   // An edited function body (another version in between) stops it.
   const orig=(await one("select pg_get_functiondef('private.app_auto_ledger_source(uuid,jsonb)'::regprocedure) d")).d;
   await pool.query(orig.replace("'project_update')","'project_update', 'telegram')"));
   assert.equal(values(await readOnly(precheck))['source helper keeps the earlier body'],'아니오');await stops();
   await pool.query(orig);
   await pool.query('grant select on public.app_profiles to anon');
   assert.equal(values(await readOnly(precheck))['profiles shape (RLS on, no anon, authenticated write, two policies)'],'아니오');await stops();
   await pool.query('revoke select on public.app_profiles from anon');
   assert.deepEqual(await readOnly(precheck),beforeCheck);
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9921');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await readOnly(precheck),beforeCheck);
  });
  await t.test('apply passes postcheck; unchanged counts and hashes; second apply refused',async()=>{
   const apply=await run('apply','9922');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck)),pre=values(beforeCheck);
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else assert.equal(value,pre[item],item);
   }
   assert.equal((await run('apply','9923')).ok,false);
  });

  const recordBatch=(runId,kind,id,extra={})=>({sources:[{kind,id,updated_at:T}],items:[{op:'new',kind:'event',title:'가상 '+kind+' 사건',sensitivity:'S1',dedup_key:'web2:'+kind+':'+id+':가상',record:{summary:'가상 요지'},
   source:{kind,id,title:'Web2 '+kind,doc_type:kind==='call'?'call_transcript':kind==='weekly_personal'?'internal_doc':'other',source_date:'2026-10-23'}}],needs_check:[],excluded:0,tokens_in:0,tokens_out:0,...extra});
  await t.test('kinds: the three new kinds and the six old ones record through the same functions; others and null are refused; nothing stays (cancelled)',async()=>{
   await asCancelled('authenticated',OWNER,async c=>{
    const ok=async(kind,n)=>{
     const id=U1.slice(0,-2)+String(n).padStart(2,'0');
     const begun=(await c.query('select public.app_auto_ledger_begin($1) r',[WS_A])).rows[0].r;
     const r=(await c.query('select public.app_auto_ledger_record($1,$2) r',[begun.run_id,JSON.stringify(recordBatch(begun.run_id,kind,id))])).rows[0].r;
     assert.equal(r.ok,true,kind+' '+JSON.stringify(r));assert.equal(r.records_new,1,kind);
     assert.equal((await c.query('select count(*)::int n from public.app_ledger_auto_sources where source_kind=$1 and source_id=$2',[kind,id])).rows[0].n,1,kind);
     assert.equal((await c.query('select count(*)::int n from public.app_ledger_sources where location=$1',['web2:'+kind+':'+id])).rows[0].n,1,kind);
    };
    let n=1;for(const kind of ALL_KINDS)await ok(kind,n++);
    // Refused kinds: the whole batch fails (no partial write) and the processing table does not learn them.
    for(const bad of ['telegram','Call','',null]){
     const begun=(await c.query('select public.app_auto_ledger_begin($1) r',[WS_A])).rows[0].r;
     const id=U1.slice(0,-2)+String(90+n++).slice(-2);
     const r=(await c.query('select public.app_auto_ledger_record($1,$2) r',[begun.run_id,JSON.stringify({sources:[{kind:bad,id,updated_at:T}],items:[]})])).rows[0].r;
     assert.equal(r.ok,false,String(bad));assert.equal(r.error,'LEDGER_AUTO_BAD_BATCH',String(bad));
    }
    // An item whose source names an unknown kind is refused by the source helper.
    const begun=(await c.query('select public.app_auto_ledger_begin($1) r',[WS_A])).rows[0].r;
    const id=U1.slice(0,-2)+'77';
    const r=(await c.query('select public.app_auto_ledger_record($1,$2) r',[begun.run_id,JSON.stringify(recordBatch(begun.run_id,'basket',id,{items:[{op:'new',kind:'event',title:'가상 이상한 출처',sensitivity:'S1',dedup_key:'web2:x:'+id,record:{summary:'가상'},source:{kind:'sms',id,title:'x',doc_type:'other'}}]}))])).rows[0].r;
    assert.equal(r.ok,false);
   });
   assert.equal((await one("select count(*)::int n from public.app_ledger_auto_sources where source_kind in ('call','weekly_personal','calendar_ref')")).n,0);
   // The processing table itself accepts only the nine (CHECK), also for a direct superuser write.
   const run1=(await owner(c=>c.query('select public.app_auto_ledger_begin($1) r',[WS_A]))).rows[0].r.run_id;
   await assert.rejects(pool.query("insert into public.app_ledger_auto_sources(workspace_id,source_kind,source_id,seen_updated_at,last_run_id) values ($1,'telegram',$2,now(),$3)",[WS_A,U1,run1]),{code:'23514'});
   await pool.query("update public.app_ledger_auto_runs set status='failed',finished_at=now(),fail_code='TEST_CLEANUP' where status='running'");
  });

  await t.test('참고 일정 표: owner writes the allowed columns; strangers, anon and service_role have nothing; link scope, shape and column limits hold',async()=>{
   await owner(c=>insertRef(c,K1,{org:ORG_A}));
   assert.equal(await refs(),1);
   // anon / service_role: no access at all. A stranger sees nothing and writes nothing (RLS).
   await assert.rejects(anon(c=>c.query('select 1 from public.app_calendar_work_refs')),{code:'42501'});
   await assert.rejects(service(c=>c.query('select 1 from public.app_calendar_work_refs')),{code:'42501'});
   await assert.rejects(service(c=>insertRef(c,K2)),{code:'42501'});
   await assert.rejects(anon(c=>insertRef(c,K2)),{code:'42501'});
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_calendar_work_refs'))).rows[0].n,0);
   await assert.rejects(stranger(c=>insertRef(c,K2)),{code:'42501'});
   // A link to an organization of another workspace is refused by the guard; same-workspace is fine.
   await assert.rejects(owner(c=>insertRef(c,K2,{org:ORG_B})),{code:'23514',message:/CALENDAR_REF_LINK_SCOPE/});
   // Shape: judged work/unsure only, decided_by rule/user, key 32 hex, title 1..80 without control chars, unique (workspace, key).
   await assert.rejects(owner(c=>insertRef(c,K2,{judged:'personal'})),{code:'23514'});
   await assert.rejects(owner(c=>insertRef(c,'zz'+'a'.repeat(30))),{code:'23514'});
   await assert.rejects(owner(c=>insertRef(c,K2,{title:'   '})),{code:'23514'});
   await assert.rejects(owner(c=>insertRef(c,K2,{title:'가'.repeat(81)})),{code:'23514'});
   await assert.rejects(owner(c=>insertRef(c,K2,{title:'줄\n바꿈'})),{code:'23514'});
   await assert.rejects(owner(c=>insertRef(c,K1)),{code:'23505'});
   await owner(c=>insertRef(c,K2,{judged:'unsure',included:false,all_day:true,start_at:null,title:'가'.repeat(80)}));
   // No column for description, location, attendees, calendar id or event id.
   const cols=(await pool.query("select attname from pg_attribute where attrelid='public.app_calendar_work_refs'::regclass and attnum>0 and not attisdropped order by attnum")).rows.map(r=>r.attname);
   assert.deepEqual(cols,['id','workspace_id','event_key','day','start_at','all_day','title','judged','included','decided_by','organization_id','created_at','updated_at']);
   // The owner can change the allowed columns; a content change moves updated_at (the trigger does it), a no-op update does not.
   await pool.query("update public.app_calendar_work_refs set updated_at='2020-01-01T00:00:00Z' where event_key=$1",[K2]);
   await owner(c=>c.query("update public.app_calendar_work_refs set included=true,decided_by='user' where event_key=$1",[K2]));
   assert.equal((await one("select included,decided_by,updated_at>'2026-01-01' fresh from public.app_calendar_work_refs where event_key=$1",[K2])).fresh,true);
   await pool.query("update public.app_calendar_work_refs set updated_at='2020-01-01T00:00:00Z' where event_key=$1",[K2]);
   await owner(c=>c.query("update public.app_calendar_work_refs set included=true,decided_by='user' where event_key=$1",[K2]));
   assert.equal((await one("select updated_at<'2021-01-01' still from public.app_calendar_work_refs where event_key=$1",[K2])).still,true);
   // Not changeable: workspace, event key, id, created_at. Owner cannot truncate; strangers cannot update or delete.
   for(const set of [`event_key='${K3}'`,`workspace_id='${WS_B}'`,'id=gen_random_uuid()','created_at=now()'])
    await assert.rejects(owner(c=>c.query(`update public.app_calendar_work_refs set ${set}`)),{code:'42501'},set);
   await assert.rejects(owner(c=>c.query('truncate public.app_calendar_work_refs')),{code:'42501'});
   assert.equal((await stranger(c=>c.query("update public.app_calendar_work_refs set included=false"))).rowCount,0);
   assert.equal((await stranger(c=>c.query("delete from public.app_calendar_work_refs"))).rowCount,0);
   assert.equal(await refs(),2);
   // The guard function cannot be called by anyone; the owner can delete a row.
   await assert.rejects(owner(c=>c.query('select private.app_calendar_work_ref_guard()')),{code:'42501'});
   assert.equal((await owner(c=>c.query('delete from public.app_calendar_work_refs where event_key=$1',[K2]))).rowCount,1);
   // Policy / grant surface: one policy, authenticated only; no anon / service_role privilege on the table or its columns.
   const pol=(await pool.query("select polroles::regrole[]::text r,polcmd from pg_policy where polrelid='public.app_calendar_work_refs'::regclass")).rows;
   assert.deepEqual(pol.map(p=>[p.r,p.polcmd]),[['{authenticated}','*']]);
   assert.equal((await one("select bool_or(has_table_privilege(r,'public.app_calendar_work_refs','select,insert,update,delete,truncate,references,trigger')) x from unnest(array['anon','service_role']) r")).x,false);
   assert.equal((await one("select bool_or(has_any_column_privilege(r,'public.app_calendar_work_refs','select,insert,update,references')) x from unnest(array['anon','service_role']) r")).x,false);
  });

  await t.test('프로필 고르기 칸: default {}, own row only, shape limits, null refused',async()=>{
   assert.deepEqual((await one('select ledger_calendar from public.app_profiles where user_id=$1',[OWNER])).ledger_calendar,{});
   const set=(who,uid,value)=>who(c=>c.query('update public.app_profiles set ledger_calendar=$1 where user_id=$2',[value,uid]));
   const good={calendar:'가상-캘린더-ID',colors:['3','11'],mine:true};
   assert.equal((await set(owner,OWNER,JSON.stringify(good))).rowCount,1);
   assert.deepEqual((await one('select ledger_calendar from public.app_profiles where user_id=$1',[OWNER])).ledger_calendar,good);
   assert.equal((await set(owner,OWNER,JSON.stringify({}))).rowCount,1);
   assert.equal((await set(owner,OWNER,JSON.stringify({colors:[]}))).rowCount,1);
   for(const bad of [{x:1},{calendar:''},{calendar:'a'.repeat(201)},{calendar:5},{calendar:'줄\n바꿈'},{colors:['1','2','3','4','5','6']},{colors:[3]},{colors:['abc']},{colors:'3'},{mine:'true'},{mine:1},[],'"text"',{calendar:'a'.repeat(1900),colors:['1'],pad:'x'.repeat(300)}])
    await assert.rejects(set(owner,OWNER,JSON.stringify(bad)),{code:'23514'},JSON.stringify(bad).slice(0,60));
   await assert.rejects(set(owner,OWNER,null),{code:'23502'});
   // A stranger cannot change the owner's row; anon cannot touch the table (existing rules unchanged).
   assert.equal((await set(stranger,OWNER,JSON.stringify(good))).rowCount,0);
   await assert.rejects(anon(c=>c.query("update public.app_profiles set ledger_calendar='{}'")),{code:'42501'});
   assert.equal(values(await readOnly(postcheck))['profiles shape (RLS on, no anon, authenticated write, two policies)'],'예');
  });

  await t.test('rollback is refused while any new-kind row exists, one blocker at a time; then restores the earlier state',async()=>{
   const blocked=async()=>{const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/LEDGER_SOURCES_ROLLBACK_BLOCKED: new-kind rows exist/);await c.query('rollback');}finally{c.release();}};
   // 1) a calendar reference row
   await owner(c=>insertRef(c,K3));await blocked();await pool.query('delete from public.app_calendar_work_refs');
   // 2) a chosen calendar
   await pool.query("update public.app_profiles set ledger_calendar='{\"mine\":true}' where user_id=$1",[OWNER]);await blocked();
   await pool.query("update public.app_profiles set ledger_calendar='{}'");
   // 3) a ledger source made from a new-kind original
   const src=(await pool.query("insert into public.app_ledger_sources(workspace_id,title,doc_type,location) values ($1,'Web2 통화','call_transcript',$2) returning id",[WS_A,'web2:call:'+U1])).rows[0].id;
   await blocked();await pool.query('delete from public.app_ledger_sources where id=$1',[src]);
   // 4) a processing-table row of a new kind
   const run1=(await owner(c=>c.query('select public.app_auto_ledger_begin($1) r',[WS_A]))).rows[0].r.run_id;
   await pool.query("insert into public.app_ledger_auto_sources(workspace_id,source_kind,source_id,seen_updated_at,last_run_id) values ($1,'weekly_personal',$2,now(),$3)",[WS_A,U1,run1]);
   await blocked();await pool.query("delete from public.app_ledger_auto_sources where source_kind='weekly_personal'");
   await pool.query("update public.app_ledger_auto_runs set status='failed',finished_at=now(),fail_code='TEST_CLEANUP' where status='running'");
   // Clean: the rollback runs, the earlier state is back (snapshot except history, precheck), the migration record is gone.
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows.filter(r=>r.kind!=='history'),before.filter(r=>r.kind!=='history'));
   assert.deepEqual(await readOnly(precheck),beforeCheck);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.equal(await one("select to_regclass('public.app_calendar_work_refs') x").then(r=>r.x),null);
   // The earlier six kinds still record; a new kind is refused again.
   await asCancelled('authenticated',OWNER,async c=>{
    const begun=(await c.query('select public.app_auto_ledger_begin($1) r',[WS_A])).rows[0].r;
    const good=(await c.query('select public.app_auto_ledger_record($1,$2) r',[begun.run_id,JSON.stringify(recordBatch(begun.run_id,'basket',B1))])).rows[0].r;
    assert.equal(good.ok,true,JSON.stringify(good));
   });
   await asCancelled('authenticated',OWNER,async c=>{
    const begun=(await c.query('select public.app_auto_ledger_begin($1) r',[WS_A])).rows[0].r;
    const bad=(await c.query('select public.app_auto_ledger_record($1,$2) r',[begun.run_id,JSON.stringify(recordBatch(begun.run_id,'call',U1))])).rows[0].r;
    assert.equal(bad.ok,false);assert.equal(bad.error,'LEDGER_AUTO_BAD_BATCH');
   });
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
