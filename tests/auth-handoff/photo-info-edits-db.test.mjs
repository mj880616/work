// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S48-60 PHOTO-정보고치기 DB(20261103140000_photo_info_edits): 사진 정보 고치기 되돌리기 기록 표 — through the approved DB workflow runner.
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
const version='20261103140000',name='photo_info_edits',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

const prerequisites=`
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;`;
const BATCH='c0000000-0000-4000-8000-0000000000c1';

test('photo info edits db: plan, dry-run, apply, owner boundary, undo only, shape guard, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'photo-info-edits-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL]=await Promise.all(['precheck','postcheck','snapshot','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const add=(sub,ws,{key='ms:101',bt='2026-10-01T10:00:00Z',at='2026-10-01T02:00:00Z',loc=false,blat=null,blon=null,alat=null,alon=null}={})=>as('authenticated',sub,c=>c.query(
   'insert into public.app_photo_info_edits(workspace_id,batch_id,source,item_key,before_taken,after_taken,loc_changed,before_lat,before_lon,after_lat,after_lon) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id',
   [ws,BATCH,'phone',key,bt,at,loc,blat,blon,alat,alon]).then(r=>r.rows[0].id));
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('approval plan: expanded rules, full flow, no definer function',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.review.definer,[]);
   assert.match(toDryRun(migration),/rollback;\s*$/);
  });
  await t.test('precheck: all yes before apply',()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
  await t.test('dry-run leaves schema and history unchanged',async()=>{
   const dry=await run('dry-run','9961');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; second apply refused',async()=>{
   const apply=await run('apply','9962');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9963')).ok,false);
  });
  let row;
  await t.test('owner writes a batch, reads it, marks it undone; values never change; no delete',async()=>{
   row=await add(OWNER,WS_A);
   await add(OWNER,WS_A,{key:'ms:102',bt:null,at:null,loc:true,blat:37.5,blon:127.0});
   await add(OWNER,WS_A,{key:'ms:103',bt:null,at:null,loc:true,alat:35.1,alon:129.0});
   const rows=(await owner(c=>c.query('select item_key,undone_at from public.app_photo_info_edits where batch_id=$1 order by item_key',[BATCH]))).rows;
   assert.deepEqual(rows.map(r=>r.item_key),['ms:101','ms:102','ms:103']);
   assert.equal((await owner(c=>c.query('update public.app_photo_info_edits set undone_at=now() where batch_id=$1',[BATCH]))).rowCount,3);
   await assert.rejects(owner(c=>c.query("update public.app_photo_info_edits set after_taken=now()")),{code:'42501'});
   await assert.rejects(owner(c=>c.query('update public.app_photo_info_edits set workspace_id=$1',[WS_B])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('delete from public.app_photo_info_edits')),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_photo_info_edits(id,workspace_id,batch_id,source,item_key,after_taken) values (gen_random_uuid(),$1,$2,'phone','ms:1',now())",[WS_A,BATCH])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_photo_info_edits(workspace_id,batch_id,source,item_key,after_taken,undone_at) values ($1,$2,'phone','ms:1',now(),now())",[WS_A,BATCH])),{code:'42501'});
  });
  await t.test('anon and service_role have nothing; a stranger sees nothing and cannot write into the owner workspace',async()=>{
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_photo_info_edits')),{code:'42501'});
   await assert.rejects(as('service_role','',c=>c.query('select 1 from public.app_photo_info_edits')),{code:'42501'});
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_photo_info_edits'))).rows[0].n,0);
   await assert.rejects(add(STRANGER,WS_A),{code:'42501'});
   assert.equal((await stranger(c=>c.query('update public.app_photo_info_edits set undone_at=null'))).rowCount,0);
   await assert.rejects(add(OWNER,WS_B),{code:'42501'});
  });
  await t.test('shape guard: phone source only, key length, location range and pairs, something changed',async()=>{
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_photo_info_edits(workspace_id,batch_id,source,item_key,after_taken) values ($1,$2,'onedrive','A1',now())",[WS_A,BATCH])),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,{key:'k'.repeat(301)}),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,{key:''}),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,{bt:null,at:null,loc:true,alat:91,alon:0}),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,{bt:null,at:null,loc:true,alat:37}),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,{bt:'2026-10-01T10:00:00Z',at:'2026-10-01T10:00:00Z'}),{code:'23514'},'nothing changed');
   await assert.rejects(add(OWNER,WS_A,{alat:37,alon:127}),{code:'23514'},'location values without loc_changed');
  });
  await t.test('rollback returns to the snapshot',async()=>{
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.ok(row);
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
