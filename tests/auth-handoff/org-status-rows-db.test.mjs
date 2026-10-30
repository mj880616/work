// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// DESK-현황표 DB(20261030234000_org_status_rows): app_org_status_rows — through the approved DB workflow runner.
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
import {prepareMigration,toDryRun} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261030234000',name='org_status_rows',stem=version+'_'+name;
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

test('org status rows db: plan, dry-run, apply, owner boundary, scope and row-limit guard, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'org-status-rows-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  // A stranger cannot see the owner's organization: the scope guard (23514) or RLS (42501) refuses first.
  const refused=e=>['42501','23514'].includes(e.code);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item??r.kind,r.value??r.ok]));
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const addRow=(sub,ws,org,body,extra={})=>as('authenticated',sub,async c=>(await c.query('insert into public.app_org_status_rows(workspace_id,organization_id,day,body,sort_order,source,evidence) values ($1,$2,$3,$4,$5,$6,$7) returning id',[ws,org,extra.day??'2026-10-29',body,extra.sort??0,extra.source??'user',extra.evidence??[]])).rows[0].id);
  const EV='33000000-0000-4000-8000-000000000031';

  await t.test('approval plan: expanded rules, full flow, no definer function',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.review.definer,[]);
   assert.equal(prepareMigration({mode:'dry-run',version,runId:'1',root}).flow,'full');
   assert.match(toDryRun(migration),/rollback;\s*$/);
  });
  await t.test('precheck: all yes before apply',()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
  await t.test('dry-run leaves schema and history unchanged',async()=>{
   const dry=await run('dry-run','9911');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; second apply refused',async()=>{
   const apply=await run('apply','9912');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9913')).ok,false);
  });
  await t.test('rows: owner only, anon refused, same-workspace organization, body rules, fixed scope columns',async()=>{
   const a=await addRow(OWNER,WS_A,ORG_A,'지노위 2차 조정회의 — 조정 종료(쟁의권 확보)',{source:'ai',evidence:[EV]});
   assert.ok(a);
   assert.ok(await addRow(OWNER,WS_A,ORG_A,'조합원 총력 결의대회',{day:'2026-10-26',sort:1}));
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_org_status_rows')),{code:'42501'});
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_org_status_rows'))).rows[0].n,0);
   await assert.rejects(addRow(STRANGER,WS_A,ORG_A,'침입'),refused);
   assert.equal((await stranger(c=>c.query("update public.app_org_status_rows set body='가로채기' where id=$1",[a]))).rowCount,0);
   assert.equal((await stranger(c=>c.query('delete from public.app_org_status_rows where id=$1',[a]))).rowCount,0);
   await assert.rejects(addRow(OWNER,WS_A,ORG_B,'남의 조직'),{code:'23514'});
   await assert.rejects(addRow(STRANGER,WS_B,ORG_A,'남의 조직'),{code:'23514'});
   for(const bad of ['',' 앞 빈칸','가'.repeat(201),'줄\n바꿈'])await assert.rejects(addRow(OWNER,WS_A,ORG_A,bad),{code:'23514'},JSON.stringify(bad));
   await assert.rejects(addRow(OWNER,WS_A,ORG_A,'출처',{source:'robot'}),{code:'23514'});
   await assert.rejects(addRow(OWNER,WS_A,ORG_A,'순서',{sort:1001}),{code:'23514'});
   await assert.rejects(addRow(OWNER,WS_A,ORG_A,'근거',{evidence:Array.from({length:11},()=>EV)}),{code:'23514'});
   // Owner edits: day, body, order, source. Ids and scope columns are fixed.
   assert.equal((await owner(c=>c.query("update public.app_org_status_rows set body='지노위 2차 조정회의 — 조정 종료',source='user',sort_order=2,day='2026-10-30',updated_at=now() where id=$1",[a]))).rowCount,1);
   await assert.rejects(owner(c=>c.query('update public.app_org_status_rows set organization_id=$1 where id=$2',[ORG_A2,a])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('update public.app_org_status_rows set workspace_id=$1 where id=$2',[WS_B,a])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_org_status_rows(id,workspace_id,organization_id,day,body) values (gen_random_uuid(),$1,$2,'2026-10-29','id 지정')",[WS_A,ORG_A])),{code:'42501'});
  });
  await t.test('at most 30 rows per organization; the limit is per organization',async()=>{
   for(let i=0;i<28;i++)await addRow(OWNER,WS_A,ORG_A,'줄 '+i,{sort:i+3});
   await assert.rejects(addRow(OWNER,WS_A,ORG_A,'서른한째'),{code:'23514'});
   assert.ok(await addRow(OWNER,WS_A,ORG_A2,'다른 조직 첫 줄'));
   assert.equal((await owner(c=>c.query("delete from public.app_org_status_rows where organization_id=$1 and source='user' and body like '줄 %'",[ORG_A]))).rowCount,28);
  });
  await t.test('deleting an organization removes its rows; rollback returns to the snapshot',async()=>{
   await pool.query('delete from public.app_suborganizations where id=$1',[ORG_A]);
   assert.equal((await pool.query('select count(*)::int n from public.app_org_status_rows where organization_id=$1',[ORG_A])).rows[0].n,0);
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
