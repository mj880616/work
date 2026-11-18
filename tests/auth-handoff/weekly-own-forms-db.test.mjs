// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic (지어낸 양식 이름).
// WEEKLY-내양식자유변형 ②(20261116003000_weekly_own_forms): app_weekly_forms — through the approved DB workflow runner.
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
const version='20261116003000',name='weekly_own_forms',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const FORM={v:1,sections:[{id:'s1',title:'1. 금주 주요 활동',level:1,columns:[],fill:'biz'},{id:'s2',title:'2. 지회 동향',level:1,columns:['지회명','동향','비고'],fill:'org'}]};

const prerequisites=`
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;

test('weekly own forms db: plan, dry-run, apply, owner boundary, one per workspace, value rules, stamp, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'weekly-own-forms-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  const refused=e=>['42501','23514'].includes(e.code);
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const add=(sub,ws,x={})=>as('authenticated',sub,async c=>(await c.query(
   'insert into public.app_weekly_forms(workspace_id,name,source_name,source_file_id,form) values ($1,$2,$3,$4,$5) returning id,updated_at::text',
   [ws,x.name??'내 주간 보고',x.source??'가나노조 조직국 주간보고.hwpx',x.file??null,JSON.stringify(x.form??FORM)])).rows[0]);

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
   const dry=await run('dry-run','9931');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; second apply refused',async()=>{
   const apply=await run('apply','9932');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9933')).ok,false);
  });
  let mine;
  await t.test('owner only: anon refused, stranger sees, changes and deletes nothing',async()=>{
   mine=await add(OWNER,WS_A);assert.ok(mine.id);
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_weekly_forms')),{code:'42501'});
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_weekly_forms'))).rows[0].n,0);
   await assert.rejects(add(STRANGER,WS_A,{name:'침입'}),refused);
   await assert.rejects(add(OWNER,WS_B,{name:'남의 작업공간'}),refused);
   assert.equal((await stranger(c=>c.query("update public.app_weekly_forms set name='가로채기' where id=$1",[mine.id]))).rowCount,0);
   assert.equal((await stranger(c=>c.query('delete from public.app_weekly_forms where id=$1',[mine.id]))).rowCount,0);
   assert.equal((await owner(c=>c.query('select form from public.app_weekly_forms where id=$1',[mine.id]))).rows[0].form.sections[1].columns[2],'비고');
  });
  await t.test('one form per workspace',async()=>{
   await assert.rejects(add(OWNER,WS_A,{name:'둘째 양식'}),{code:'23505'});
  });
  await t.test('value rules: name, source name, file id, form shape and size',async()=>{
   await owner(c=>c.query('delete from public.app_weekly_forms where id=$1',[mine.id]));
   for(const bad of ['',' 앞 빈칸','가'.repeat(81),'줄\n바꿈'])await assert.rejects(add(OWNER,WS_A,{name:bad}),{code:'23514'},JSON.stringify(bad));
   await assert.rejects(add(OWNER,WS_A,{source:'파일\t이름'}),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,{file:'../etc'}),{code:'23514'});
   for(const form of [[],{v:2,sections:[]},{v:1},{v:1,sections:{}},{v:1,sections:Array.from({length:41},(_,i)=>({id:'s'+i,title:'항목',level:1,columns:[],fill:'blank'}))},{v:1,sections:[{id:'s1',title:'가'.repeat(31000)}]}])
    await assert.rejects(add(OWNER,WS_A,{form}),{code:'23514'},JSON.stringify(form).slice(0,40));
   assert.ok(await add(OWNER,WS_A,{source:null,form:{v:1,sections:[]}}),'빈 양식에서 직접 만들기');
  });
  await t.test('fixed columns; updated_at is server time and works as a concurrency stamp; owner may delete',async()=>{
   const row=(await owner(c=>c.query('select id,updated_at::text from public.app_weekly_forms where workspace_id=$1',[WS_A]))).rows[0];
   for(const [col,val] of [['workspace_id',WS_B],['updated_at','2000-01-01'],['created_at','2000-01-01']])
    await assert.rejects(owner(c=>c.query(`update public.app_weekly_forms set ${col}=$1 where id=$2`,[val,row.id])),{code:'42501'},col);
   await assert.rejects(owner(c=>c.query("insert into public.app_weekly_forms(id,workspace_id,name,form) values (gen_random_uuid(),$1,'id 지정','{\"v\":1,\"sections\":[]}')",[WS_B])),{code:'42501'});
   const first=await owner(c=>c.query('update public.app_weekly_forms set form=$1 where id=$2 and updated_at=$3 returning updated_at::text',[JSON.stringify(FORM),row.id,row.updated_at]));
   assert.equal(first.rowCount,1);assert.ok(first.rows[0].updated_at>row.updated_at);
   assert.equal((await owner(c=>c.query("update public.app_weekly_forms set name='화면 2' where id=$1 and updated_at=$2",[row.id,row.updated_at]))).rowCount,0);
   assert.equal((await owner(c=>c.query('delete from public.app_weekly_forms where id=$1',[row.id]))).rowCount,1);
  });
  await t.test('rollback with a saved form returns to the snapshot',async()=>{
   await add(OWNER,WS_A);
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
