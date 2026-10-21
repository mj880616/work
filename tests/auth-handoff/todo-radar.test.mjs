// Fresh local PostgreSQL only. No Supabase, OpenAI or production credentials. All data synthetic (no real names).
// JOURNAL-챙길것 1단계 / AI-서버연동 S5: 20261021075034_todo_radar_candidates — candidate table + find state table,
// owner-only RLS, column privileges, dedupe, the exact statements ai-assist sends through PostgREST, guarded rollback.
// SQL Editor only (the approved DB workflow refuses policies and table grants), so the file is applied as written.
// Optional: TODO_RADAR_PG_PORT=<port> runs the same checks on an already running local server (user postgres, trust auth).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,PROJECT_B,ORG_A,ORG_B} from './basket4-fixture.mjs';
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
const version='20261021075034',name='todo_radar_candidates',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const externalPort=process.env.TODO_RADAR_PG_PORT;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const SRC='27000000-0000-4000-8000-000000000001',SRC2='27000000-0000-4000-8000-000000000002';

test('todo radar: migration, owner-only RLS, column grants, dedupe, PostgREST statements, guarded rollback',{timeout:120000},async t=>{
 let cluster,pool,adminPool,database='postgres',port,password='';
 if(externalPort){
  port=Number(externalPort);database='todo_radar_'+randomBytes(4).toString('hex');
  adminPool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres',ssl:false});
  await adminPool.query('create database '+database);
  for(const role of ['anon','authenticated','public_probe','service_role'])await adminPool.query(`drop role if exists ${role}`).catch(()=>{});
 }else{
  const directory=await mkdtemp(join(tmpdir(),'todo-radar-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));port=sock.address().port;await new Promise(r=>sock.close(r));
  password=randomBytes(24).toString('hex');
  cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
  await cluster.initialise();await cluster.start();
 }
 try{
  pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database,ssl:false});
  await pool.query(fixture);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const cand=(over={})=>({workspace_id:WS_A,kind:'request',summary:'A 사업장 자료 회신.',due:null,source_kind:'basket',source_id:SRC,source_day:'2026-10-21',evidence:'회신 요청',dedupe_key:'basket:'+SRC+':a사업장자료회신',project_id:null,organization_id:null,...over});
  // The statement PostgREST makes for ai-assist's POST app_todo_candidates?on_conflict=workspace_id,dedupe_key with
  // Prefer: resolution=ignore-duplicates,return=representation.
  const insert=(c,rows)=>c.query(`insert into public.app_todo_candidates(workspace_id,kind,summary,due,source_kind,source_id,source_day,evidence,dedupe_key,project_id,organization_id)
    select * from jsonb_to_recordset($1::jsonb) as x(workspace_id uuid,kind text,summary text,due date,source_kind text,source_id uuid,source_day date,evidence text,dedupe_key text,project_id uuid,organization_id uuid)
    on conflict (workspace_id,dedupe_key) do nothing returning id`,[JSON.stringify(rows)]);

  await t.test('files: read-only checks, three-line summary; SQL Editor only (workflow parser refuses policies/grants)',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   assert.equal(prepareMigration({mode:'apply',version,runId:'1',root}).rules,'expanded'); // DB-승인형확장
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'');
   assert.match(code,/^begin;\n/);assert.match(code,/\ncommit;\n$/);
   assert.doesNotMatch(code,/security definer|create function|disable row level|to anon|to public|to service_role|update public|delete from public|rtw_|raw_text|transcript/i);
   assert.match(code,/revoke all on table public\.app_todo_candidates, public\.app_todo_radar_state from public, anon, authenticated, service_role;/);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261021075034', 'todo_radar_candidates'/);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/delete from public|update public|truncate|cascade|grant |policy/i);
  });
  const before=(await pool.query(snapshot)).rows;
  await t.test('precheck before apply is all 예 and the snapshot shows absent tables',async()=>{
   for(const r of (await pool.query(precheck)).rows.filter(r=>r.item!=='recent migrations'))assert.equal(r.value,'예',r.item);
   assert.deepEqual(before.filter(r=>r.kind==='table').map(r=>r.definition),['absent','absent']);
  });
  await t.test('prerequisite guard stops when the owner check function is missing',async()=>{
   const c=await pool.connect();
   try{await c.query('begin');await c.query('alter function private.app_is_workspace_owner(uuid) rename to app_is_workspace_owner_x');
    await assert.rejects(c.query(migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/TODO_RADAR_PREREQUISITE_CHANGED/);}
   finally{await c.query('rollback');c.release();}
   assert.equal(await history(),0);
  });
  await t.test('apply succeeds once and postcheck is all 예; a second apply is refused',async()=>{
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal(await history(),1);
   await assert.rejects(pool.query(migration),/TODO_RADAR_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  await t.test('owner adds candidates; the same source + summary is skipped (dismissed ones too)',async()=>{
   const first=await owner(c=>insert(c,[cand(),cand({kind:'deadline',summary:'의견 제출.',due:'2026-10-24',dedupe_key:'basket:'+SRC+':의견제출'})]));
   assert.equal(first.rowCount,2);
   const again=await owner(c=>insert(c,[cand(),cand({source_kind:'meeting',source_id:SRC2,summary:'회의 자료 준비.',kind:'prepare',dedupe_key:'meeting:'+SRC2+':회의자료준비'})]));
   assert.equal(again.rowCount,1,'only the new one is added');
   const rows=(await owner(c=>c.query("select status,task_id,decided_at from public.app_todo_candidates order by created_at"))).rows;
   assert.ok(rows.every(r=>r.status==='open'&&r.task_id===null&&r.decided_at===null),'new rows always start open');
   await owner(c=>c.query("update public.app_todo_candidates set status='dismissed',decided_at=now() where dedupe_key=$1",[cand().dedupe_key]));
   assert.equal((await owner(c=>insert(c,[cand()]))).rowCount,0,'a dismissed candidate does not come back');
  });
  await t.test('client cannot set status on insert, nor change summary, source or workspace',async()=>{
   await assert.rejects(owner(c=>c.query("insert into public.app_todo_candidates(workspace_id,kind,summary,source_kind,source_id,source_day,dedupe_key,status) values($1,'request','x','basket',$2,'2026-10-21','k1','tasked')",[WS_A,SRC])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_todo_candidates(workspace_id,kind,summary,source_kind,source_id,source_day,dedupe_key,task_id) values($1,'request','x','basket',$2,'2026-10-21','k2','t')",[WS_A,SRC])),{code:'42501'});
   for(const col of ["summary='바꿈'","source_id='"+SRC2+"'","workspace_id='"+WS_B+"'","evidence='x'","dedupe_key='x'","kind='attend'"])
    await assert.rejects(owner(c=>c.query('update public.app_todo_candidates set '+col)),{code:'42501'},col);
  });
  await t.test('status rules: tasked needs a task id, open has no decision time',async()=>{
   const id=(await owner(c=>c.query("select id from public.app_todo_candidates where status='open' limit 1"))).rows[0].id;
   await assert.rejects(owner(c=>c.query("update public.app_todo_candidates set status='tasked',decided_at=now() where id=$1",[id])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("update public.app_todo_candidates set status='dismissed' where id=$1",[id])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("update public.app_todo_candidates set status='done',decided_at=now() where id=$1",[id])),{code:'23514'});
   // The screen's guarded PATCH: ...?id=eq.X&workspace_id=eq.W&status=eq.open → one row back.
   const r=await owner(c=>c.query("update public.app_todo_candidates set status='tasked',task_id='g-1',decided_at=now() where id=$1 and workspace_id=$2 and status='open' returning id,status,task_id",[id,WS_A]));
   assert.equal(r.rowCount,1);assert.equal(r.rows[0].task_id,'g-1');
   assert.equal((await owner(c=>c.query("update public.app_todo_candidates set status='dismissed',task_id=null,decided_at=now() where id=$1 and status='open'",[id]))).rowCount,0,'already handled: no second change');
  });
  await t.test('values are checked: kinds, lengths, control characters',async()=>{
   for(const [over,label] of [[{kind:'promise'},'kind'],[{source_kind:'diary'},'diary source'],[{summary:'가'.repeat(101)},'summary 101'],[{summary:'  '},'blank'],
    [{summary:'줄\n바꿈'},'newline'],[{evidence:'가'.repeat(201)},'evidence 201'],[{evidence:'a\u0007b'},'control'],[{dedupe_key:''},'empty key']])
    await assert.rejects(owner(c=>insert(c,[cand({...over,dedupe_key:over.dedupe_key??'v:'+label})])),{code:'23514'},label);
  });
  await t.test('project and organization must be in the same workspace',async()=>{
   await assert.rejects(owner(c=>insert(c,[cand({project_id:PROJECT_B,dedupe_key:'p:b'})])),{code:'42501'});
   await assert.rejects(owner(c=>insert(c,[cand({organization_id:ORG_B,dedupe_key:'o:b'})])),{code:'42501'});
   assert.equal((await owner(c=>insert(c,[cand({project_id:PROJECT_A,organization_id:ORG_A,dedupe_key:'po:a',source_kind:'org_update'})]))).rowCount,1);
  });
  await t.test('stranger, anon, no-login and service_role see and change nothing',async()=>{
   await assert.rejects(stranger(c=>insert(c,[cand({dedupe_key:'s:1'})])),{code:'42501'});
   assert.deepEqual((await stranger(c=>c.query('select id from public.app_todo_candidates'))).rows,[]);
   assert.equal((await stranger(c=>c.query("update public.app_todo_candidates set status='dismissed',decided_at=now()"))).rowCount,0);
   assert.equal((await stranger(c=>c.query('delete from public.app_todo_candidates'))).rowCount,0);
   assert.deepEqual((await as('authenticated',null,c=>c.query('select id from public.app_todo_candidates'))).rows,[]);
   for(const role of ['anon','service_role'])for(const sql of ['select 1 from public.app_todo_candidates','select 1 from public.app_todo_radar_state',"insert into public.app_todo_radar_state(workspace_id) values('"+WS_A+"')"])
    await assert.rejects(as(role,null,c=>c.query(sql)),{code:'42501'},role+' '+sql);
  });
  await t.test('find state: upsert ignore, guarded claim (one runner), finish, owner only',async()=>{
   // POST app_todo_radar_state?on_conflict=workspace_id (Prefer: resolution=ignore-duplicates) twice: one row.
   for(let i=0;i<2;i++)await owner(c=>c.query('insert into public.app_todo_radar_state(workspace_id) values($1) on conflict (workspace_id) do nothing',[WS_A]));
   assert.equal((await pool.query('select count(*)::int n from public.app_todo_radar_state')).rows[0].n,1);
   const claim=stale=>owner(c=>c.query('update public.app_todo_radar_state set running_since=now(),updated_at=now() where workspace_id=$1 and (running_since is null or running_since < $2) returning workspace_id',[WS_A,stale]));
   assert.equal((await claim(new Date(Date.now()-120000).toISOString())).rowCount,1);
   assert.equal((await claim(new Date(Date.now()-120000).toISOString())).rowCount,0,'a second runner is refused while the first is running');
   assert.equal((await claim(new Date(Date.now()+1000).toISOString())).rowCount,1,'a stale mark can be taken over');
   await owner(c=>c.query("update public.app_todo_radar_state set running_since=null,last_success_at=now(),last_partial=false,last_day='2026-10-21',runs_on_day=1,updated_at=now() where workspace_id=$1",[WS_A]));
   await assert.rejects(owner(c=>c.query('update public.app_todo_radar_state set workspace_id=$1',[WS_B])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('delete from public.app_todo_radar_state')),{code:'42501'});
   await assert.rejects(owner(c=>c.query('update public.app_todo_radar_state set runs_on_day=-1')),{code:'23514'});
   await assert.rejects(stranger(c=>c.query('insert into public.app_todo_radar_state(workspace_id) values($1)',[WS_A])),{code:'42501'});
   assert.equal((await stranger(c=>c.query('update public.app_todo_radar_state set running_since=null'))).rowCount,0);
  });
  await t.test('old decided candidates can be cleaned by the owner (30-day rule)',async()=>{
   await pool.query("update public.app_todo_candidates set decided_at=now()-interval '31 days' where status<>'open'");
   const gone=await owner(c=>c.query("delete from public.app_todo_candidates where workspace_id=$1 and status<>'open' and decided_at<now()-interval '30 days'",[WS_A]));
   assert.ok(gone.rowCount>=1);
   assert.ok((await owner(c=>c.query("select count(*)::int n from public.app_todo_candidates where status='open'"))).rows[0].n>=1,'open candidates stay');
  });
  await t.test('rollback stops while candidates exist; after they are removed it restores the snapshot; re-apply works',async()=>{
   await assert.rejects(pool.query(rollbackSQL),/TODO_RADAR_ROLLBACK_BLOCKED: candidates exist/);await pool.query('rollback');
   assert.equal(await history(),1);
   await pool.query('delete from public.app_todo_candidates');
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   await pool.query(migration);assert.equal(await history(),1);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await pool?.end();
  if(adminPool){await adminPool.query('drop database if exists '+database+' with (force)').catch(()=>{});for(const role of ['anon','authenticated','public_probe','service_role'])await adminPool.query(`drop role if exists ${role}`).catch(()=>{});await adminPool.end();}
  await cluster?.stop();
 }
});
