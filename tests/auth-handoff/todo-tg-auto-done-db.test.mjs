// Fresh local PostgreSQL only. No Supabase, Edge, OpenAI or production credentials. All data synthetic.
// S70-20 FORGET-이미한일빼기(20261125120000_todo_tg_auto_done): 텔레그램 요청 후보에 요청 시각·번호·'저절로 이미 함' 칸, 서버 전용 함수 셋.
// - 승인형 DB workflow 확장 규칙 통과, dry-run은 아무것도 안 바꿈, apply 뒤 사후 확인 모두 예, 두 번째 apply 거절.
// - 넣기: 답한 요청은 처음부터 done(decided_at = auto_done_at), 아니면 open. 같은 소식은 한 번만.
// - 방 요청 읽기는 그 작업공간·그 방·처리 전·저절로 옮긴 적 없는 줄의 id·시각·번호만. 옮기기는 처리 전 텔레그램 줄만(다른 작업공간·다른 출처·처리한 줄 안 됨).
// - [되돌리기](owner가 status·decided_at만 바꿈) 뒤에는 다시 저절로 옮기지 않는다. owner는 새 칸을 쓸 수 없다. anon·authenticated는 함수 실행 불가.
// - 운영자 기능이 없는 작업공간은 기존 트리거가 막는다. 되돌리기 뒤 snapshot 같음, 다시 적용 가능.
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
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261125120000',name='todo_tg_auto_done',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;`;
const CHAIN=['20261021075034_todo_radar_candidates','20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261025200000_call_personal_box',
 '20261025210000_feed_item_archive','20261026120000_call_user_edit','20261026190000_tg_sender_names','20261027010000_tg_room_day_group',
 '20261027030000_tg_sender_names_read','20261027060000_todo_candidates_task_due','20261027200000_tg_summary_edit','20261028030000_tg_room_day_context'];
const AFTER=['20261029120000_todo_candidates_telegram','20261029210000_todo_mine_only','20261101180000_todo_feedback','20261102030000_todo_feature_guard'];

test('todo tg auto done: plan, dry-run, apply, server-only functions, open-only moves, undo sticks, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'todo-tg-auto-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  for(const f of CHAIN)await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-24','2026-10-24T03:00:00Z','가상 통화','가상 요약','call:uc1')",[WS_A]);
  await pool.query(await read('supabase/migrations/20261029090000_operator_features.sql'));
  for(const f of AFTER)await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const ops=(await pool.query("select workspace_id::text w, feature from public.app_operator_features order by 1,2")).rows;
  if(!ops.some(r=>r.w===WS_A&&r.feature==='telegram'))await pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'telegram')",[WS_A]);

  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),server=fn=>as('service_role','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const before=(await pool.query(snapshot)).rows;
  const beforeCheck=await readOnly(precheck);
  const feed=(id,ws,ref,room)=>pool.query("insert into public.app_feed_items(id,workspace_id,source,day,occurred_at,room_key,room_label,title,summary,raw_count,points,raw_text,source_ref) values($1,$2,'telegram','2026-11-25',now(),$4,'가상 방','가상','가상 요약',1,'[]','가상 원문',$3)",[id,ws,ref,room]);
  const F=n=>`31000000-0000-4000-8000-00000000000${n}`;
  const add="select public.app_todo_candidate_from_telegram_at($1,$2,'가상 자료 보내기','가상 근거',null,$3,$4,$5)->>'result' r";

  await t.test('files: expanded rules pass; three definer functions; only execute grants to service_role; summary 3 lines',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual([...plan.functions].sort(),['public.app_todo_candidate_from_telegram_at','public.app_todo_tg_auto_done','public.app_todo_tg_open_asks']);
    assert.deepEqual(plan.createdTables,[]);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);
   ['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0]);
   assert.equal(grants.length,3);for(const g of grants)assert.match(g,/^grant execute on function public\.app_todo_[a-z_]+\([^)]*\) to service_role;$/);
   assert.doesNotMatch(code,/create table|create policy|alter policy|drop policy|create trigger|create or replace|rtw_|family_notes|\bto (anon|public|authenticated)\b/i);
  });
  await t.test('precheck, dry-run changes nothing, apply passes postcheck, second apply refused',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.equal((await run('dry-run','9991')).ok,true);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9992');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck));
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else if(v[item]!==undefined)assert.equal(value,v[item],item);
   }
   assert.equal((await run('apply','9993')).ok,false);
  });
  await t.test('insert: replied → done with same times; not replied → open; dedupe; bad args refused; roles denied',async()=>{
   // 다른 작업공간 소식(대조용)을 넣는 동안만 그 작업공간에 텔레그램 기능을 준다(소식 표 트리거가 막으므로). 아래에서 다시 뺀다.
   await pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'telegram') on conflict do nothing",[WS_B]);
   await feed(F(1),WS_A,'tg:fake:1','-100');await feed(F(2),WS_A,'tg:fake:2','-100');await feed(F(3),WS_A,'tg:fake:3','-200');await feed(F(4),WS_B,'tg:fake:4','-100');
   assert.equal((await server(c=>c.query(add,[WS_A,'tg:fake:1',new Date(Date.now()-3600_000).toISOString(),'1001','replied']))).rows[0].r,'added');
   assert.equal((await server(c=>c.query(add,[WS_A,'tg:fake:2',new Date(Date.now()-3600_000).toISOString(),'1002',null]))).rows[0].r,'added');
   assert.equal((await server(c=>c.query(add,[WS_A,'tg:fake:3',new Date(Date.now()-3600_000).toISOString(),'1003',null]))).rows[0].r,'added');
   assert.equal((await server(c=>c.query(add,[WS_A,'tg:fake:2',new Date().toISOString(),'1002','replied']))).rows[0].r,'exists');
   const rows=(await pool.query("select source_id::text s,status,ask_ref,auto_done,(decided_at=auto_done_at) same from public.app_todo_candidates order by ask_ref")).rows;
   assert.deepEqual(rows,[{s:F(1),status:'done',ask_ref:'1001',auto_done:'replied',same:true},{s:F(2),status:'open',ask_ref:'1002',auto_done:null,same:null},{s:F(3),status:'open',ask_ref:'1003',auto_done:null,same:null}]);
   for(const a of [[WS_A,'tg:fake:2',null,'1002',null],[WS_A,'tg:fake:2',new Date().toISOString(),'bad ref',null],[WS_A,'tg:fake:2',new Date().toISOString(),'1002','yes']])
    await assert.rejects(server(c=>c.query(add,a)),/TODO_TG_ARGS/);
   await assert.rejects(server(c=>c.query(add,[WS_A,'tg:fake:4',new Date().toISOString(),'1004',null])),/TODO_TG_SOURCE/,'다른 작업공간 소식');
   // 운영자 기능(telegram)이 없는 작업공간은 기존 트리거가 막는다.
   await pool.query("delete from public.app_operator_features where workspace_id=$1",[WS_B]);
   for(const fn of ["select public.app_todo_tg_open_asks($1,'-100')","select public.app_todo_tg_auto_done($1,array[gen_random_uuid()])",
    "select public.app_todo_candidate_from_telegram_at($1,'tg:fake:1','x','',null,now(),'1','replied')"]){
    await assert.rejects(owner(c=>c.query(fn,[WS_A])),/permission denied/);
    await assert.rejects(as('anon','',c=>c.query(fn,[WS_A])),/permission denied/);
   }
   // owner는 새 칸을 쓸 수 없다(기존 칸 권한 그대로).
   await assert.rejects(owner(c=>c.query("update public.app_todo_candidates set auto_done=null")),/permission denied/);
   await assert.rejects(owner(c=>c.query("update public.app_todo_candidates set ask_at=now()")),/permission denied/);
   assert.deepEqual((await as('authenticated',STRANGER,c=>c.query('select id from public.app_todo_candidates'))).rows,[]);
  });
  await t.test('open asks: only that room, open, not auto-moved; ids and times only. auto done: open telegram only; undo sticks',async()=>{
   const open=(await server(c=>c.query("select public.app_todo_tg_open_asks($1,'-100') r",[WS_A]))).rows[0].r.rows;
   assert.equal(open.length,1);assert.deepEqual(Object.keys(open[0]).sort(),['ask_at','ask_ref','id']);assert.equal(open[0].ask_ref,'1002');
   assert.deepEqual((await server(c=>c.query("select public.app_todo_tg_open_asks($1,'-100') r",[WS_B]))).rows[0].r.rows,[]);
   await assert.rejects(server(c=>c.query("select public.app_todo_tg_open_asks($1,'bad room')",[WS_A])),/TODO_TG_ARGS/);
   const ids=(await pool.query("select id::text, ask_ref from public.app_todo_candidates order by ask_ref")).rows;
   const id=r=>ids.find(x=>x.ask_ref===r).id;
   // 다른 작업공간 이름으로는 안 옮겨진다.
   assert.equal((await server(c=>c.query("select public.app_todo_tg_auto_done($1,$2::uuid[])->>'done' n",[WS_B,[id('1002')]]))).rows[0].n,'0');
   assert.equal((await server(c=>c.query("select public.app_todo_tg_auto_done($1,$2::uuid[])->>'done' n",[WS_A,[id('1002'),id('1001')]]))).rows[0].n,'1');
   assert.deepEqual((await pool.query("select status,auto_done,(decided_at=auto_done_at) same from public.app_todo_candidates where id=$1",[id('1002')])).rows,[{status:'done',auto_done:'replied',same:true}]);
   await assert.rejects(server(c=>c.query("select public.app_todo_tg_auto_done($1,'{}'::uuid[])",[WS_A])),/TODO_TG_ARGS/);
   // [되돌리기]: owner가 기존 길(status·decided_at)로 처리 전으로 → 방 요청 읽기에 다시 나오지 않고 다시 옮겨지지 않는다.
   const back=await owner(c=>c.query("update public.app_todo_candidates set status='open',decided_at=null where id=$1 and status='done'",[id('1002')]));
   assert.equal(back.rowCount,1);
   assert.deepEqual((await server(c=>c.query("select public.app_todo_tg_open_asks($1,'-100') r",[WS_A]))).rows[0].r.rows,[]);
   assert.equal((await server(c=>c.query("select public.app_todo_tg_auto_done($1,$2::uuid[])->>'done' n",[WS_A,[id('1002')]]))).rows[0].n,'0');
   // 사람이 다시 [이미 함]을 누르면 decided_at이 달라져 화면은 '답장함' 꼬리표를 달지 않는다.
   await owner(c=>c.query("update public.app_todo_candidates set status='done',decided_at=now()+interval '1 minute' where id=$1",[id('1002')]));
   assert.deepEqual((await pool.query("select (decided_at=auto_done_at) same from public.app_todo_candidates where id=$1",[id('1002')])).rows,[{same:false}]);
  });
  await t.test('rollback removes functions, columns and record, keeps rows; snapshot same; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.equal((await pool.query("select to_regprocedure('public.app_todo_tg_auto_done(uuid,uuid[])') f")).rows[0].f,null);
   assert.deepEqual((await pool.query("select status from public.app_todo_candidates order by status")).rows.map(r=>r.status),['done','done','open']);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
