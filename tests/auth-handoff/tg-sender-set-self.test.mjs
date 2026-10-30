// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// TODO-내일만 3: 20261029233000_tg_sender_set_self - one owner-checked definer function for authenticated only; changes is_self only; table grants unchanged.
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
const version='20261029233000',name='tg_sender_set_self',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const MISSING='99999999-9999-4999-8999-999999999999';
const ROOM='room_fake_1',ROOM2='room_fake_2',DAY='2026-10-23',DAY2='2026-10-24';
const K1='a1b2c3d4e5f60718293a4b5c6d7e8f90',K2='0123456789abcdef0123456789abcdef';

test('tg sender set self: owner-only definer function changes is_self only; tables stay closed; rollback leaves data',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'tg-sender-set-self-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  for(const f of ['20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261026190000_tg_sender_names','20261027030000_tg_sender_names_read'])await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),server=fn=>as('service_role','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const before=(await pool.query(snapshot)).rows;
  const beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules pass; one definer function; only one execute grant; no table changes; summary 3 lines',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');
    assert.deepEqual([...plan.functions],['public.app_tg_sender_set_self']);
    assert.deepEqual(plan.createdTables,[]);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0].replace(/\s+/g,' '));
   assert.deepEqual(grants,['grant execute on function public.app_tg_sender_set_self(uuid, boolean) to authenticated;']);
   assert.match(code,/revoke all on function public\.app_tg_sender_set_self\(uuid, boolean\) from public, anon, service_role;/);
   assert.doesNotMatch(code,/create table|create policy|alter table|alter policy|drop policy|create trigger|create or replace|rtw_|\bto (anon|public|service_role)\b/i);
   assert.doesNotMatch(code,/\b(insert|delete)\s+(into|from)?\s*public\./i);
   assert.deepEqual([...code.matchAll(/\bupdate\s+public\.(\w+)/gi)].map(m=>m[1]),['app_tg_senders']);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261029233000', 'tg_sender_set_self'/);
  });
  await t.test('precheck, dry-run changes nothing, apply passes postcheck, second apply refused',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.equal((await run('dry-run','9971')).ok,true);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9972');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck));
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else if(v[item]!==undefined)assert.equal(value,v[item],item);
   }
   assert.equal((await run('apply','9973')).ok,false);
  });
  await t.test('owner marks and unmarks self; server read sees it; collector upsert without self keeps it; others denied',async()=>{
   await server(c=>c.query('select public.app_tg_senders_upsert($1,$2,$3,$4::jsonb)',[WS_A,ROOM,DAY,JSON.stringify([{label:'A',key:K1,name:'가상 자동이름'},{label:'B',key:K2}])]));
   await server(c=>c.query('select public.app_tg_senders_upsert($1,$2,$3,$4::jsonb)',[WS_A,ROOM2,DAY2,JSON.stringify([{label:'C',key:K2}])]));
   const idOf=async key=>(await pool.query('select id from public.app_tg_senders where workspace_id=$1 and sender_key=$2',[WS_A,key])).rows[0].id;
   const me=await idOf(K2),other=await idOf(K1);
   const set=(id,self,fn=owner)=>fn(c=>c.query('select public.app_tg_sender_set_self($1,$2) r',[id,self])).then(r=>r.rows[0].r);
   assert.deepEqual(await set(me,true),{ok:true,changed:true,id:me,is_self:true,keyed:true});
   assert.deepEqual(await set(me,true),{ok:true,changed:false,id:me,is_self:true,keyed:true},'same value again: no change');
   const names=(room,day)=>server(c=>c.query('select public.app_tg_sender_names_for_day($1,$2,$3) r',[WS_A,room,day])).then(r=>r.rows[0].r);
   assert.deepEqual((await names(ROOM,DAY)).map(x=>[x.label,x.is_self]),[['A',false],['B',true]]);
   assert.deepEqual((await names(ROOM2,DAY2)).map(x=>[x.label,x.is_self]),[['C',true]],'keyed person: every room and day');
   // 수집기가 self 칸 없이 다시 보내도 표시는 남는다.
   await server(c=>c.query('select public.app_tg_senders_upsert($1,$2,$3,$4::jsonb)',[WS_A,ROOM,DAY,JSON.stringify([{label:'B',key:K2,name:'가상 내 이름'}])]));
   assert.equal((await pool.query('select is_self from public.app_tg_senders where id=$1',[me])).rows[0].is_self,true);
   // 다른 칸은 바뀌지 않는다.
   const row=(await pool.query('select name,auto_name,sender_key from public.app_tg_senders where id=$1',[other])).rows[0];
   await set(other,true);
   assert.deepEqual((await pool.query('select name,auto_name,sender_key from public.app_tg_senders where id=$1',[other])).rows[0],row);
   await set(other,false);
   assert.deepEqual(await set(me,false),{ok:true,changed:true,id:me,is_self:false,keyed:true});
   await assert.rejects(set(MISSING,true),/TG_SENDER_NOT_FOUND/);
   await assert.rejects(owner(c=>c.query('select public.app_tg_sender_set_self($1,$2)',[me,null])),/TG_SENDER_ARGS/);
   await assert.rejects(as('authenticated',STRANGER,c=>c.query('select public.app_tg_sender_set_self($1,$2)',[me,true])),/TG_SENDER_NOT_FOUND/,'other user');
   await assert.rejects(server(c=>c.query('select public.app_tg_sender_set_self($1,$2)',[me,true])),/permission denied/);
   await assert.rejects(as('anon','',c=>c.query('select public.app_tg_sender_set_self($1,$2)',[me,true])),/permission denied/);
   await assert.rejects(owner(c=>c.query('update public.app_tg_senders set is_self=true where id=$1',[me])),/permission denied/);
   assert.equal((await pool.query('select is_self from public.app_tg_senders where id=$1',[me])).rows[0].is_self,false);
  });
  await t.test('rollback removes only the function and its record; sender data stays',async()=>{
   await owner(c=>c.query('select public.app_tg_sender_set_self((select id from public.app_tg_senders where sender_key=$1),true)',[K2]));
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.equal((await pool.query("select to_regprocedure('public.app_tg_sender_set_self(uuid,boolean)') f")).rows[0].f,null);
   assert.equal((await pool.query('select count(*)::int n from public.app_tg_senders where is_self')).rows[0].n,1);
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
