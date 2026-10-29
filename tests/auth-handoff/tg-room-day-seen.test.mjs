// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// TG-요청강조·안본것 2/3: 20261029170000_tg_room_day_seen - app_feed_room_days.seen_at + one definer function app_feed_room_day_seen
// (authenticated only, owner workspace from auth.uid(), telegram operator feature, existing non-hidden telegram item). No new table,
// policy, grant or trigger; the existing owner read policy, restrictive op_feature_read and trg_op_feature_guard cover the column.
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
const version='20261029170000',name='tg_room_day_seen',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const BEFORE=['20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261025200000_call_personal_box',
 '20261025210000_feed_item_archive','20261026120000_call_user_edit','20261026190000_tg_sender_names','20261027010000_tg_room_day_group',
 '20261027030000_tg_sender_names_read','20261027200000_tg_summary_edit','20261028030000_tg_room_day_context','20261029090000_operator_features'];

test('tg room day seen: one nullable column + one owner-only definer function; operator feature and existing item required; rollback keeps rows',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'tg-seen-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  for(const f of BEFORE.slice(0,-1))await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,room_key,room_label,title,summary,raw_count,source_ref) values($1,'telegram','2026-10-24','2026-10-24T03:00:00Z','room_s_1','가상 방','가상 소식','가상 요약',2,'tg:s1')",[WS_A]);
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,room_key,room_label,title,summary,raw_count,source_ref) values($1,'telegram','2026-10-24','2026-10-24T05:00:00Z','room_s_2','가상 방 2','가상 소식 2','가상 요약 2',1,'tg:s2')",[WS_A]);
  await pool.query(await read('supabase/migrations/'+BEFORE.at(-1)+'.sql'));
  await pool.query("insert into public.app_feed_room_days(workspace_id,room_key,day,parts) values($1,'room_s_2','2026-10-24','[{\"batch\":\"b1\",\"first_at\":\"2026-10-24T05:00:00Z\",\"headline\":\"가상\",\"lines\":[\"가상 줄\"]}]'::jsonb)",[WS_A]);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const seen=(fn,room,day='2026-10-24')=>fn(c=>c.query('select public.app_feed_room_day_seen($1,$2::date) r',[room,day])).then(r=>r.rows[0].r);
  const before=(await pool.query(snapshot)).rows;
  const beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules pass; one definer function, no policy/trigger/table; one grant to authenticated; summary 3 lines',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual(plan.createdTables,[]);
    assert.deepEqual([...plan.review.definer],['public.app_feed_room_day_seen']);
    assert.equal(plan.review.policies,0);assert.equal(plan.review.triggers,0);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0].replace(/\s+/g,' '));
   assert.deepEqual(grants,['grant execute on function public.app_feed_room_day_seen(text, date) to authenticated;']);
   assert.doesNotMatch(code,/create policy|alter policy|drop policy|create trigger|create table|create or replace|rtw_|disable row level security|\bto (anon|public)\b/i);
   assert.match(rollbackSQL,/SQL Editor 경로 전용/);
  });
  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9972');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck));
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else assert.equal(value,v[item],item);
   }
   assert.equal((await run('apply','9973')).ok,false);
  });
  await t.test('owner: opening a room·day stores seen_at (new row or seen_at only on an existing row), readable by the owner; parts untouched',async()=>{
   const a=await seen(owner,'room_s_1');assert.equal(a.ok,true);assert.equal(a.room_key,'room_s_1');
   const b=await seen(owner,'room_s_2');assert.equal(b.ok,true);
   const rows=(await owner(c=>c.query("select room_key,seen_at is not null s,jsonb_array_length(parts) n,hidden_at from public.app_feed_room_days where workspace_id=$1 order by room_key",[WS_A]))).rows;
   assert.deepEqual(rows,[{room_key:'room_s_1',s:true,n:0,hidden_at:null},{room_key:'room_s_2',s:true,n:1,hidden_at:null}]);
   // 다시 열어도 앞으로만 간다(같은 줄 하나).
   await seen(owner,'room_s_1');
   assert.equal((await pool.query("select count(*)::int n from public.app_feed_room_days where room_key='room_s_1'")).rows[0].n,1);
   // 날 목록 함수는 그대로 동작한다.
   assert.equal((await owner(c=>c.query("select count(*)::int n from public.app_feed_room_day_lines('2026-10-20','2026-10-31')"))).rows[0].n,2);
  });
  await t.test('refused: bad args, unknown or hidden room·day, other owners, anon, service_role, direct table writes',async()=>{
   await assert.rejects(seen(owner,'bad room'),/TGDG_ARGS/);
   await assert.rejects(seen(owner,'room_none'),/TGDG_NOT_FOUND/);
   await assert.rejects(seen(owner,'room_s_1','2026-10-23'),/TGDG_NOT_FOUND/);
   await pool.query("update public.app_feed_items set hidden_at=now() where source_ref='tg:s2'");
   await assert.rejects(seen(owner,'room_s_2'),/TGDG_NOT_FOUND/);
   await pool.query("update public.app_feed_items set hidden_at=null where source_ref='tg:s2'");
   await assert.rejects(seen(stranger,'room_s_1'),/TGDG_NOT_FOUND|OPERATOR_FEATURE_REQUIRED/);
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_feed_room_days'))).rows[0].n,0);
   await assert.rejects(as('anon','',c=>c.query("select public.app_feed_room_day_seen('room_s_1','2026-10-24')")),{code:'42501'});
   await assert.rejects(server(c=>c.query("select public.app_feed_room_day_seen('room_s_1','2026-10-24')")),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_feed_room_days set seen_at=null where workspace_id=$1",[WS_A])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_feed_room_days(workspace_id,room_key,day,seen_at) values($1,'room_s_1','2026-10-25',now())",[WS_B])),{code:'42501'});
  });
  await t.test('rollback drops only the column and the function; rows stay; re-apply works',async()=>{
   const rowsBefore=(await pool.query('select count(*)::int n from public.app_feed_room_days')).rows[0].n;
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.equal((await pool.query("select to_regprocedure('public.app_feed_room_day_seen(text,date)') f")).rows[0].f,null);
   assert.equal((await pool.query("select count(*)::int n from pg_attribute where attrelid='public.app_feed_room_days'::regclass and attname='seen_at' and not attisdropped")).rows[0].n,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_feed_room_days')).rows[0].n,rowsBefore);
   const pre=values(await readOnly(precheck));
   assert.equal(pre['room days grants policies triggers hash'],values(beforeCheck)['room days grants policies triggers hash']);
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
