// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S48-17 PHOTO-지우기두갈래 DB(20261102160000_phone_trash_keep): app_phone_trash_log keep·rel_path·taken_at — through the approved DB workflow runner.
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
import {prepareMigration,toDryRun} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261102160000',name='phone_trash_keep',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

const prerequisites=`
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;`;

test('phone trash keep db: plan, dry-run, apply, columns, shapes, same permissions, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'phone-trash-keep-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query(await read('supabase/migrations/20261101040000_phone_trash_log.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL]=await Promise.all(['precheck','postcheck','snapshot','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  // An old row (before this change) must keep working and read as keep=false.
  const old=await server(c=>c.query("insert into public.app_phone_trash_log(workspace_id,phone_id,source,copy_id) values ($1,'11','onedrive','OLD1') returning id",[WS_A]).then(r=>r.rows[0].id));
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const add=(c,ws,{phone='1234',copy='ABC123!45',keep=true,path='DCIM/Camera/',taken='2026-10-01T01:02:03Z'}={})=>c.query('insert into public.app_phone_trash_log(workspace_id,phone_id,source,copy_id,keep,rel_path,taken_at) values ($1,$2,$3,$4,$5,$6,$7) returning id',[ws,phone,'onedrive',copy,keep,path,taken]).then(r=>r.rows[0].id);

  await t.test('approval plan: expanded or strict rules, full flow, no definer function',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.flow,'full');
   assert.deepEqual(plan.review?.definer||[],[]);
   assert.match(toDryRun(migration),/rollback;\s*$/);
  });
  await t.test('precheck: all yes before apply',()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
  await t.test('dry-run leaves schema and history unchanged',async()=>{
   const dry=await run('dry-run','9941');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; second apply refused',async()=>{
   const apply=await run('apply','9942');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9943')).ok,false);
  });
  await t.test('rows: old row keep=false; server writes keep rows; owner reads own only; no new rights',async()=>{
   assert.deepEqual((await server(c=>c.query('select keep,rel_path,taken_at from public.app_phone_trash_log where id=$1',[old]))).rows[0],{keep:false,rel_path:null,taken_at:null});
   const a=await server(c=>add(c,WS_A));
   await server(c=>add(c,WS_B,{phone:'99',copy:'ZZZ'}));
   await assert.rejects(owner(c=>add(c,WS_A,{phone:'5'})),{code:'42501'});
   await assert.rejects(owner(c=>c.query('update public.app_phone_trash_log set keep=false')),{code:'42501'});
   await assert.rejects(owner(c=>c.query('delete from public.app_phone_trash_log')),{code:'42501'});
   const rows=(await owner(c=>c.query('select id,keep,rel_path,taken_at from public.app_phone_trash_log where keep'))).rows;
   assert.equal(rows.length,1);assert.equal(rows[0].id,a);assert.equal(rows[0].rel_path,'DCIM/Camera/');
   assert.equal((await stranger(c=>c.query('select id from public.app_phone_trash_log where workspace_id=$1',[WS_A]))).rows.length,0);
   await assert.rejects(anon(c=>c.query('select id from public.app_phone_trash_log')),{code:'42501'});
   assert.equal((await server(c=>c.query('delete from public.app_phone_trash_log where id=$1',[a]))).rowCount,1);
  });
  await t.test('shapes: folder path is relative, short, no control characters or ..',async()=>{
   for(const path of ['','/DCIM/','DCIM/../x/','..','a\nb','x'.repeat(256)])
     await assert.rejects(server(c=>add(c,WS_A,{path})),{code:'23514'},JSON.stringify(path).slice(0,20));
   for(const path of [null,'DCIM/Camera/','Pictures/웹2/','DCIM/a..b/'])await server(c=>add(c,WS_A,{path}));
  });
  await t.test('rollback returns to the snapshot (rows stay)',async()=>{
   await server(c=>c.query('delete from public.app_phone_trash_log where id<>$1',[old]));
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   for(const r of await readOnly(precheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   assert.equal((await pool.query('select count(*)::int n from public.app_phone_trash_log')).rows[0].n,1);
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
