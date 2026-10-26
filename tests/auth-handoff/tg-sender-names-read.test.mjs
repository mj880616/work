// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// TG-발언자이름 결정 3 변경: 20261027030000_tg_sender_names_read - one read-only definer function, service_role execute only, table grants unchanged.
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
const version='20261027030000',name='tg_sender_names_read',stem=version+'_'+name;
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

test('tg sender names read: one read-only definer function for service_role only; tables stay closed; rollback leaves data',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'tg-sender-names-read-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query('revoke usage on schema private from service_role');
  for(const f of ['20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261026190000_tg_sender_names'])await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),server=fn=>as('service_role','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const ROOM='room_fake_1',DAY='2026-10-23';
  const K1='a1b2c3d4e5f60718293a4b5c6d7e8f90',K2='0123456789abcdef0123456789abcdef';
  const before=(await pool.query(snapshot)).rows;
  const beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules pass; one definer function; only one execute grant; no table changes; summary 3 lines',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');
    assert.deepEqual([...plan.functions],['public.app_tg_sender_names_for_day']);
    assert.deepEqual(plan.createdTables,[]);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0].replace(/\s+/g,' '));
   assert.deepEqual(grants,['grant execute on function public.app_tg_sender_names_for_day(uuid, text, date) to service_role;']);
   assert.doesNotMatch(code,/create table|create policy|alter table|alter policy|drop policy|create trigger|create or replace|rtw_|\bto (anon|public|authenticated)\b/i);
   assert.doesNotMatch(code,/\b(insert|update|delete)\s+(into|from)?\s*public\./i);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261027030000', 'tg_sender_names_read'/);
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
  await t.test('function returns label, hand name and self only; tables stay closed to service_role; other roles denied',async()=>{
   await server(c=>c.query('select public.app_tg_senders_upsert($1,$2,$3,$4::jsonb)',[WS_A,ROOM,DAY,JSON.stringify([{label:'A',key:K1,name:'가상 자동이름'},{label:'B',key:K2,self:true},{label:'C',name:'가상 채널'}])]));
   await owner(c=>c.query('select public.app_tg_sender_set_name($1,$2,$3,$4)',[ROOM,DAY,'A','가상 손이름']));
   const r=(await server(c=>c.query('select public.app_tg_sender_names_for_day($1,$2,$3) r',[WS_A,ROOM,DAY]))).rows[0].r;
   assert.deepEqual(r,[{label:'A',name:'가상 손이름',is_self:false},{label:'B',name:null,is_self:true},{label:'C',name:null,is_self:false}]);
   for(const k of [K1,K2])assert.ok(!JSON.stringify(r).includes(k));
   assert.deepEqual((await server(c=>c.query('select public.app_tg_sender_names_for_day($1,$2,$3) r',[WS_A,ROOM,'2026-10-24']))).rows[0].r,[]);
   assert.deepEqual((await server(c=>c.query('select public.app_tg_sender_names_for_day($1,$2,$3) r',[WS_B,ROOM,DAY]))).rows[0].r,[],'other workspace');
   await assert.rejects(server(c=>c.query('select public.app_tg_sender_names_for_day($1,$2,$3)',[WS_A,'bad room!',DAY])),/TG_SENDER_ARGS/);
   await assert.rejects(server(c=>c.query('select * from public.app_tg_senders')),/permission denied/);
   await assert.rejects(server(c=>c.query('select * from public.app_tg_day_senders')),/permission denied/);
   await assert.rejects(owner(c=>c.query('select public.app_tg_sender_names_for_day($1,$2,$3)',[WS_A,ROOM,DAY])),/permission denied/);
   await assert.rejects(as('anon','',c=>c.query('select public.app_tg_sender_names_for_day($1,$2,$3)',[WS_A,ROOM,DAY])),/permission denied/);
  });
  await t.test('rollback removes only the function and its record; sender data stays',async()=>{
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.equal((await pool.query("select to_regprocedure('public.app_tg_sender_names_for_day(uuid,text,date)') f")).rows[0].f,null);
   assert.equal((await pool.query('select count(*)::int n from public.app_tg_senders')).rows[0].n,3);
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
