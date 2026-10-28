// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// FEAT-1029 5: 20261029120000_todo_candidates_telegram - source kind check adds telegram; one definer insert function, service_role execute only; table grants unchanged.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,ORG_A} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261029120000',name='todo_candidates_telegram',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const MISSING='99999999-9999-4999-8999-999999999999';

test('todo candidates telegram: check adds telegram; one definer insert function for service_role only; candidates table stays closed; rollback keeps rows',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'todo-tg-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query('revoke usage on schema private from service_role');
  await pool.query('grant select on public.app_spaces to authenticated');
  await pool.query('alter table public.app_spaces enable row level security');
  await pool.query('create policy fake_owner_read on public.app_spaces for select to authenticated using (private.app_is_workspace_owner(workspace_id))');
  for(const f of ['20261021075034_todo_radar_candidates','20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261027060000_todo_candidates_task_due'])await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),server=fn=>as('service_role','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const FEED_A='31000000-0000-4000-8000-000000000001',FEED_B='31000000-0000-4000-8000-000000000002',FEED_HIDDEN='31000000-0000-4000-8000-000000000003',FEED_CALL='31000000-0000-4000-8000-000000000004';
  const fn='select public.app_todo_candidate_from_telegram($1,$2,$3,$4,$5) r';
  const before=(await pool.query(snapshot)).rows;
  const beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules pass; one definer function; only one execute grant; summary 3 lines',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');
    assert.deepEqual([...plan.functions],['public.app_todo_candidate_from_telegram']);
    assert.deepEqual(plan.createdTables,[]);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0].replace(/\s+/g,' '));
   assert.deepEqual(grants,['grant execute on function public.app_todo_candidate_from_telegram(uuid, uuid, text, text, date) to service_role;']);
   assert.doesNotMatch(code,/create table|create policy|alter policy|drop policy|create trigger|create or replace|rtw_|\bto (anon|public|authenticated)\b/i);
   assert.deepEqual([...code.matchAll(/^alter table [^;]*/gim)].map(m=>m[0].split(' ').slice(0,5).join(' ')),[
    'alter table public.app_todo_candidates drop constraint','alter table public.app_todo_candidates add constraint']);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261029120000', 'todo_candidates_telegram'/);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/delete from public|truncate|cascade|grant |policy/i);
  });
  await t.test('precheck, dry-run changes nothing, apply passes postcheck, second apply refused',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.equal((await run('dry-run','9981')).ok,true);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9982');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck));
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else if(v[item]!==undefined)assert.equal(value,v[item],item);
   }
   assert.equal((await run('apply','9983')).ok,false);
  });
  await t.test('server adds one open request candidate from a visible telegram item; dedupe; wrong source refused; other roles denied',async()=>{
   const ins=(id,ws,source,ref,org)=>pool.query(source==='telegram'
    ?"insert into public.app_feed_items(id,workspace_id,source,day,occurred_at,room_key,room_label,title,summary,raw_count,points,raw_text,source_ref,organization_id) values($1,$2,'telegram','2026-10-29','2026-10-29T01:00:00Z','room-fake','가상 방','가상','가상 요약',1,'[]','가상 원문',$3,$4)"
    :"insert into public.app_feed_items(id,workspace_id,source,day,occurred_at,title,summary,raw_count,points,source_ref) values($1,$2,'call','2026-10-29','2026-10-29T01:00:00Z','가상 통화','가상',0,'[]',$3)",
    source==='telegram'?[id,ws,ref,org]:[id,ws,ref]);
   await ins(FEED_A,WS_A,'telegram','tg:fake:1',ORG_A);
   await ins(FEED_B,WS_B,'telegram','tg:fake:2',null);
   await ins(FEED_HIDDEN,WS_A,'telegram','tg:fake:3',null);
   await ins(FEED_CALL,WS_A,'call','call:fake:1');
   await pool.query('update public.app_feed_items set hidden_at=now() where id=$1',[FEED_HIDDEN]);
   assert.equal((await server(c=>c.query(fn,[WS_A,FEED_A,' 가상 자료 보내 달라는 요청 ','가상 근거 한 줄','2026-10-30']))).rows[0].r,'added');
   assert.equal((await server(c=>c.query(fn,[WS_A,FEED_A,'다른 요약','',null]))).rows[0].r,'exists');
   const rows=(await pool.query("select kind,summary,due::text,source_kind,source_id,source_day::text,evidence,dedupe_key,organization_id,project_id,status,task_id from public.app_todo_candidates")).rows;
   assert.deepEqual(rows,[{kind:'request',summary:'가상 자료 보내 달라는 요청',due:'2026-10-30',source_kind:'telegram',source_id:FEED_A,source_day:'2026-10-29',evidence:'가상 근거 한 줄',dedupe_key:'tg:'+FEED_A,organization_id:ORG_A,project_id:null,status:'open',task_id:null}]);
   for(const [ws,id] of [[WS_A,FEED_B],[WS_A,FEED_HIDDEN],[WS_A,FEED_CALL],[WS_A,MISSING]])
    await assert.rejects(server(c=>c.query(fn,[ws,id,'가상','',null])),/TODO_TG_SOURCE/,id);
   for(const [s,e] of [['',''],['가'.repeat(101),''],['줄\n바꿈',''],['가상','가'.repeat(201)]])
    await assert.rejects(server(c=>c.query(fn,[WS_A,FEED_A,s,e,null])),/TODO_TG_ARGS/);
   await assert.rejects(server(c=>c.query('select summary from public.app_todo_candidates')),/permission denied/);
   await assert.rejects(server(c=>c.query("insert into public.app_todo_candidates(workspace_id,kind,summary,source_kind,source_id,source_day,dedupe_key) values($1,'request','x','telegram',$2,'2026-10-29','z')",[WS_A,FEED_A])),/permission denied/);
   await assert.rejects(owner(c=>c.query(fn,[WS_A,FEED_A,'가상','',null])),/permission denied/);
   await assert.rejects(as('anon','',c=>c.query(fn,[WS_A,FEED_A,'가상','',null])),/permission denied/);
   // 명진은 화면에서 텔레그램 후보를 보고 처리 칸만 바꾼다(기존 경로 그대로).
   const seen=(await owner(c=>c.query("select source_kind from public.app_todo_candidates"))).rows;
   assert.deepEqual(seen,[{source_kind:'telegram'}]);
   assert.deepEqual((await as('authenticated',STRANGER,c=>c.query('select id from public.app_todo_candidates'))).rows,[]);
   const r=await owner(c=>c.query("update public.app_todo_candidates set status='dismissed',decided_at=now() where source_kind='telegram' and status='open'"));
   assert.equal(r.rowCount,1);
   await pool.query("update public.app_todo_candidates set status='open',decided_at=null");
  });
  await t.test('rollback removes the function and record, dismisses open telegram rows, keeps rows; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.equal((await pool.query("select to_regprocedure('public.app_todo_candidate_from_telegram(uuid,uuid,text,text,date)') f")).rows[0].f,null);
   assert.deepEqual((await pool.query("select source_kind,status from public.app_todo_candidates")).rows,[{source_kind:'telegram',status:'dismissed'}]);
   await assert.rejects(owner(c=>c.query("insert into public.app_todo_candidates(workspace_id,kind,summary,source_kind,source_id,source_day,dedupe_key) values($1,'request','x','telegram',$2,'2026-10-29','z2')",[WS_A,FEED_A])),{code:'23514'});
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
