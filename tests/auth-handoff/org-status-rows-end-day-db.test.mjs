// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// DESK-일정기간 DB(20261104201500_org_status_rows_end_day): app_org_status_rows.end_day — applied after the base table. The new column grants are refused by the approval workflow (grant-existing), so this file applies the SQL directly (SQL Editor path) and checks the result.
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
const baseStem='20261030234000_org_status_rows',stem='20261104201500_org_status_rows_end_day';
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const ORG_A2='23000000-0000-4000-8000-000000000021';

const prerequisites=`
  revoke all on public.app_suborganizations from public, anon;
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  insert into public.app_suborganizations values ('${ORG_A2}','${WS_A}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;


test('org status rows end_day: nullable column, end >= start check, owner-only column writes, postcheck, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'org-status-end-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  const [base,migration,precheck,snapshot,postcheck,rollbackSQL]=await Promise.all([read('supabase/migrations/'+baseStem+'.sql'),read('supabase/migrations/'+stem+'.sql'),...['precheck','snapshot','postcheck','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql'))]);
  await pool.query(base);
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn);
  const ins=(day,end)=>owner(c=>c.query('insert into public.app_org_status_rows(workspace_id,organization_id,day,end_day,body) values ($1,$2,$3,$4,$5) returning id',[WS_A,ORG_A,day,end,'합성 줄']));
  const before=(await pool.query(snapshot)).rows;
  await t.test('precheck is all yes before apply; the column is absent and a row with end_day is refused',async()=>{
   for(const r of (await pool.query(precheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   await assert.rejects(ins('2026-11-02','2026-11-05'),{code:'42703'});
   assert.ok((await owner(c=>c.query("insert into public.app_org_status_rows(workspace_id,organization_id,day,body) values ($1,$2,'2026-10-01','기존 줄') returning id",[WS_A,ORG_A]))).rows[0].id);
  });
  await t.test('apply: history row, postcheck yes, existing row keeps end_day null, second apply refused',async()=>{
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal((await pool.query("select count(*)::int n from public.app_org_status_rows where end_day is null")).rows[0].n,1);
   await assert.rejects(pool.query(migration));
  });
  await t.test('owner writes end_day; end before start refused; null allowed; same day allowed; update works',async()=>{
   const id=(await ins('2026-11-02','2026-11-05')).rows[0].id;
   assert.ok(id);assert.ok((await ins('2026-11-02',null)).rows[0].id);assert.ok((await ins('2026-11-02','2026-11-02')).rows[0].id);
   await assert.rejects(ins('2026-11-02','2026-11-01'),{code:'23514'});
   assert.equal((await owner(c=>c.query("update public.app_org_status_rows set end_day='2026-11-09' where id=$1",[id]))).rowCount,1);
   await assert.rejects(owner(c=>c.query("update public.app_org_status_rows set end_day='2026-10-01' where id=$1",[id])),{code:'23514'});
   assert.equal((await owner(c=>c.query("update public.app_org_status_rows set end_day=null where id=$1",[id]))).rowCount,1);
  });
  await t.test('boundary unchanged: stranger sees nothing and cannot write end_day, anon refused',async()=>{
   assert.equal((await as('authenticated',STRANGER,c=>c.query('select count(*)::int n from public.app_org_status_rows'))).rows[0].n,0);
   await assert.rejects(as('authenticated',STRANGER,c=>c.query("insert into public.app_org_status_rows(workspace_id,organization_id,day,end_day,body) values ($1,$2,'2026-11-02','2026-11-03','침입')",[WS_A,ORG_A])),e=>['42501','23514'].includes(e.code));
   await assert.rejects(as('anon','',c=>c.query('select end_day from public.app_org_status_rows')),{code:'42501'});
  });
  await t.test('rollback returns to the snapshot and keeps the base table',async()=>{
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal((await pool.query("select count(*)::int n from pg_attribute where attrelid='public.app_org_status_rows'::regclass and attname='end_day' and not attisdropped")).rows[0].n,0);
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
