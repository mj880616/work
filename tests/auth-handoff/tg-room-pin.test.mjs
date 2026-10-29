// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// TG-방고정 1/2: 20261030060000_tg_room_pin - app_feed_rooms.pinned_at + one definer function app_feed_room_pin
// (authenticated only, owner workspace from auth.uid(), telegram operator feature, existing telegram room, archived refused, 20 pins at most).
// No new table, policy, grant or trigger; the existing owner read policy, restrictive op_feature_read and trg_op_feature_guard cover the column.
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
const version='20261030060000',name='tg_room_pin',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const BEFORE=['20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261025200000_call_personal_box',
 '20261025210000_feed_item_archive','20261026120000_call_user_edit','20261026190000_tg_sender_names','20261027010000_tg_room_day_group',
 '20261027030000_tg_sender_names_read','20261027200000_tg_summary_edit','20261028030000_tg_room_day_context','20261029090000_operator_features',
 '20261029170000_tg_room_day_seen'];

test('tg room pin: one nullable column + one owner-only definer function; order kept, archived refused, limit 20; rollback keeps rows',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'tg-pin-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  // 운영처럼 텔레그램 자료는 운영자 작업공간(WS_A)에만 있다(operator_features가 이 작업공간에 허용 행을 넣는다).
  const opAt=BEFORE.indexOf('20261029090000_operator_features');
  for(const f of BEFORE.slice(0,opAt))await pool.query(await read('supabase/migrations/'+f+'.sql'));
  for(let i=1;i<=22;i++)await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,room_key,room_label,title,summary,raw_count,source_ref) values($1,'telegram','2026-10-24',$2,$3,$4,'가상 소식','가상 요약',1,$5)",[WS_A,`2026-10-24T03:${String(i).padStart(2,'0')}:00Z`,'room_p_'+i,'가상 방 '+i,'tg:p'+i]);
  for(const f of BEFORE.slice(opAt))await pool.query(await read('supabase/migrations/'+f+'.sql'));
  // 방 2는 이미 폴더가 있는 방 줄(고정해도 폴더·이름은 그대로여야 한다), 방 3은 보관한 방.
  await pool.query("insert into public.app_feed_folders(id,workspace_id,name,sort_order) values('90000000-0000-4000-8000-000000000001',$1,'가상 폴더',0)",[WS_A]);
  await pool.query("insert into public.app_feed_rooms(workspace_id,room_key,room_label,folder_id) values($1,'room_p_2','가상 방 2','90000000-0000-4000-8000-000000000001')",[WS_A]);
  await pool.query("insert into public.app_feed_rooms(workspace_id,room_key,room_label,archived_at) values($1,'room_p_3','가상 방 3',now())",[WS_A]);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const pin=(fn,room,on=true)=>fn(c=>c.query('select public.app_feed_room_pin($1,$2) r',[room,on])).then(r=>r.rows[0].r);
  const pinnedRooms=()=>owner(c=>c.query("select room_key from public.app_feed_rooms where workspace_id=$1 and pinned_at is not null order by pinned_at,room_key",[WS_A])).then(r=>r.rows.map(x=>x.room_key));
  const before=(await pool.query(snapshot)).rows;
  const beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules pass; one definer function, no policy/trigger/table; one grant to authenticated; summary 3 lines',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual(plan.createdTables,[]);
    assert.deepEqual([...plan.review.definer],['public.app_feed_room_pin']);
    assert.equal(plan.review.policies,0);assert.equal(plan.review.triggers,0);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0].replace(/\s+/g,' '));
   assert.deepEqual(grants,['grant execute on function public.app_feed_room_pin(text, boolean) to authenticated;']);
   assert.doesNotMatch(code,/create policy|alter policy|drop policy|create trigger|create table|create or replace|rtw_|disable row level security|\bto (anon|public)\b/i);
   assert.doesNotMatch(precheck+postcheck+snapshot,/information_schema/i);
   assert.match(rollbackSQL,/SQL Editor 경로 전용/);
  });
  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9982');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck));
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else assert.equal(value,v[item],item);
   }
   assert.equal((await run('apply','9983')).ok,false);
  });
  await t.test('owner: pin creates or updates the room row, keeps folder/label, keeps order on repeat, unpin clears; readable by the owner',async()=>{
   const a=await pin(owner,'room_p_1');assert.equal(a.ok,true);assert.equal(a.changed,true);assert.ok(a.pinned_at);
   await new Promise(r=>setTimeout(r,20));
   const b=await pin(owner,'room_p_2');assert.equal(b.changed,true);
   assert.deepEqual(await pinnedRooms(),['room_p_1','room_p_2']);
   // 다시 고정해도 처음 시각(순서) 그대로.
   const again=await pin(owner,'room_p_1');assert.equal(again.changed,false);assert.equal(again.pinned_at,a.pinned_at);
   assert.deepEqual(await pinnedRooms(),['room_p_1','room_p_2']);
   const r2=(await pool.query("select room_label,folder_id,archived_at from public.app_feed_rooms where room_key='room_p_2'")).rows[0];
   assert.deepEqual(r2,{room_label:'가상 방 2',folder_id:'90000000-0000-4000-8000-000000000001',archived_at:null});
   const r1=(await pool.query("select room_label,folder_id,archived_at from public.app_feed_rooms where room_key='room_p_1'")).rows[0];
   assert.deepEqual(r1,{room_label:'가상 방 1',folder_id:null,archived_at:null});
   const off=await pin(owner,'room_p_1',false);assert.equal(off.changed,true);assert.equal(off.pinned_at,null);
   assert.deepEqual(await pinnedRooms(),['room_p_2']);
   // 줄이 없는 방을 풀면 아무것도 만들지 않는다.
   const none=await pin(owner,'room_p_4',false);assert.equal(none.changed,false);
   assert.equal((await pool.query("select count(*)::int n from public.app_feed_rooms where room_key='room_p_4'")).rows[0].n,0);
   // 날 목록 함수는 그대로 동작한다.
   assert.equal((await owner(c=>c.query("select count(*)::int n from public.app_feed_room_day_lines('2026-10-20','2026-10-31')"))).rows[0].n,22);
  });
  await t.test('refused: archived room, more than 20 pins, bad args, unknown room, other owners, anon, service_role, direct table writes',async()=>{
   await assert.rejects(pin(owner,'room_p_3'),/TGPIN_ARCHIVED/);
   for(let i=4;i<=22;i++)await pin(owner,'room_p_'+i);
   assert.equal((await pinnedRooms()).length,20);
   await assert.rejects(pin(owner,'room_p_1'),/TGPIN_LIMIT/);
   await pin(owner,'room_p_22',false);await pin(owner,'room_p_1');
   await assert.rejects(pin(owner,'bad room'),/TGDG_ARGS/);
   await assert.rejects(owner(c=>c.query("select public.app_feed_room_pin('room_p_1',null)")),/TGDG_ARGS/);
   await assert.rejects(pin(owner,'room_none'),/TGDG_NOT_FOUND/);
   await assert.rejects(pin(stranger,'room_p_1'),/TGDG_NOT_FOUND|OPERATOR_FEATURE_REQUIRED/);
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_feed_rooms'))).rows[0].n,0);
   await assert.rejects(as('anon','',c=>c.query("select public.app_feed_room_pin('room_p_1',true)")),{code:'42501'});
   await assert.rejects(server(c=>c.query("select public.app_feed_room_pin('room_p_1',true)")),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_feed_rooms set pinned_at=null where workspace_id=$1",[WS_A])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_feed_rooms(workspace_id,room_key,pinned_at) values($1,'room_x',now())",[WS_B])),{code:'42501'});
  });
  await t.test('rollback drops only the column and the function; rows stay; re-apply works',async()=>{
   const rowsBefore=(await pool.query('select count(*)::int n from public.app_feed_rooms')).rows[0].n;
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.equal((await pool.query("select to_regprocedure('public.app_feed_room_pin(text,boolean)') f")).rows[0].f,null);
   assert.equal((await pool.query("select count(*)::int n from pg_attribute where attrelid='public.app_feed_rooms'::regclass and attname='pinned_at' and not attisdropped")).rows[0].n,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_feed_rooms')).rows[0].n,rowsBefore);
   const pre=values(await readOnly(precheck));
   assert.equal(pre['rooms grants policies triggers hash'],values(beforeCheck)['rooms grants policies triggers hash']);
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
