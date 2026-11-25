// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// S69-97 노트 서식 DB(20261125131000_note_templates): 소유자만 읽기·쓰기, 다른 작업공간·anon·service_role 거절,
// 이름·본문 모양 검사, 작업공간 고치기 불가, id·시각 넣기 불가, 작업공간 안 이름 하나, 되돌리기.
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
const version='20261125131000',name='note_templates',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  revoke usage on schema private from service_role;`;
const ed1=(text='가상 회의록 틀')=>({v:'ed1',doc:{type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text}]},{type:'paragraph'}]}});

test('note templates db: plan, dry-run, apply, owner boundary, name and doc checks, workspace fixed, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'note-templates-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const ins='insert into public.app_note_templates(workspace_id,name,doc) values ($1,$2,$3::jsonb) returning id,created_at,updated_at';
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules, no functions or triggers, grants as designed, summary 3 lines',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');
   assert.deepEqual([...plan.functions],[]);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/create (or replace )?function|create trigger|rtw_|app_collab|\bto (anon|public|service_role)\b|alter table public\.app_notes|security definer/i);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/app_notes|truncate|cascade|grant /i);
   assert.match(rollbackSQL+summary,/서식도 함께 사라/);
  });
  await t.test('precheck yes, dry-run changes nothing, apply passes postcheck, second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const dry=await run('dry-run','9991');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9992');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9993')).ok,false);
  });
  let first;
  await t.test('owner saves, lists, renames, edits, deletes templates; one name per workspace',async()=>{
   const row=(await owner(c=>c.query(ins,[WS_A,'회의록',JSON.stringify(ed1())]))).rows[0];first=row.id;
   assert.ok(row.created_at instanceof Date||typeof row.created_at==='string');
   await owner(c=>c.query(ins,[WS_A,'주간 정리',JSON.stringify(ed1('주간'))]));
   await owner(c=>c.query(ins,[WS_A,'가'.repeat(40),JSON.stringify(ed1())]));
   assert.equal((await owner(c=>c.query('select 1 from public.app_note_templates'))).rows.length,3);
   await assert.rejects(owner(c=>c.query(ins,[WS_A,'회의록',JSON.stringify(ed1())])),{code:'23505'});
   await owner(c=>c.query("update public.app_note_templates set name='회의록(새)',doc=$2::jsonb,updated_at=now() where id=$1",[first,JSON.stringify(ed1('바뀐 틀'))]));
   const got=(await owner(c=>c.query('select name,doc from public.app_note_templates where id=$1',[first]))).rows[0];
   assert.equal(got.name,'회의록(새)');assert.equal(got.doc.doc.content[0].content[0].text,'바뀐 틀');
   await assert.rejects(owner(c=>c.query('update public.app_note_templates set workspace_id=$2 where id=$1',[first,WS_B])),/permission denied/);
   await assert.rejects(owner(c=>c.query('update public.app_note_templates set id=gen_random_uuid() where id=$1',[first])),/permission denied/);
   await assert.rejects(owner(c=>c.query('update public.app_note_templates set created_at=now() where id=$1',[first])),/permission denied/);
   await assert.rejects(owner(c=>c.query("insert into public.app_note_templates(id,workspace_id,name,doc) values (gen_random_uuid(),$1,'x',$2::jsonb)",[WS_A,JSON.stringify(ed1())])),/permission denied/);
   await assert.rejects(owner(c=>c.query("insert into public.app_note_templates(workspace_id,name,doc,created_at) values ($1,'x',$2::jsonb,now())",[WS_A,JSON.stringify(ed1())])),/permission denied/);
   await assert.rejects(owner(c=>c.query("insert into public.app_note_templates(workspace_id,name,doc,updated_at) values ($1,'x',$2::jsonb,now())",[WS_A,JSON.stringify(ed1())])),/permission denied/);
   const extra=(await owner(c=>c.query(ins,[WS_A,'지울 것',JSON.stringify(ed1())]))).rows[0].id;
   assert.equal((await owner(c=>c.query('delete from public.app_note_templates where id=$1',[extra]))).rowCount,1);
  });
  await t.test('shape checks: bad names and docs refused, same name in another workspace allowed',async()=>{
   for(const bad of ['','  ','가'.repeat(41),'줄\n바꿈','탭\t글'])
    await assert.rejects(owner(c=>c.query(ins,[WS_A,bad,JSON.stringify(ed1())])),{code:'23514'},JSON.stringify(bad));
   const docs=[[],'"글"',{v:'ed2',doc:{type:'doc',content:[]}},{doc:{type:'doc',content:[]}},{v:'ed1'},{v:'ed1',doc:'글'},{v:'ed1',doc:[]},{v:'ed1',doc:{type:'doc'}},{v:'ed1',doc:{type:'doc',content:{}}},
     {v:'ed1',doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'가'.repeat(70000)}]}]}}];
   for(const d of docs)await assert.rejects(owner(c=>c.query(ins,[WS_A,'틀',typeof d==='string'?d:JSON.stringify(d)])),{code:'23514'},JSON.stringify(d).slice(0,80));
   await assert.rejects(owner(c=>c.query("insert into public.app_note_templates(workspace_id,name,doc) values ($1,'틀',null)",[WS_A])),{code:'23502'});
   await assert.rejects(owner(c=>c.query("update public.app_note_templates set name='' where id=$1",[first])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("update public.app_note_templates set doc='{\"v\":\"ed1\"}'::jsonb where id=$1",[first])),{code:'23514'});
   await owner(c=>c.query(ins,[WS_A,'큰 틀',JSON.stringify({v:'ed1',doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'가'.repeat(60000)}]}]}})]));
   await stranger(c=>c.query(ins,[WS_B,'회의록(새)',JSON.stringify(ed1())]));
  });
  await t.test('boundaries: other workspace id, stranger, anon and server blocked',async()=>{
   await assert.rejects(owner(c=>c.query(ins,[WS_B,'남의 틀',JSON.stringify(ed1())])),/row-level security/);
   await assert.rejects(stranger(c=>c.query(ins,[WS_A,'남의 틀',JSON.stringify(ed1())])),/row-level security/);
   assert.equal((await stranger(c=>c.query('select 1 from public.app_note_templates where workspace_id=$1',[WS_A]))).rows.length,0);
   assert.equal((await stranger(c=>c.query("update public.app_note_templates set name='남' where workspace_id=$1",[WS_A]))).rowCount,0);
   assert.equal((await stranger(c=>c.query('delete from public.app_note_templates where workspace_id=$1',[WS_A]))).rowCount,0);
   assert.equal((await owner(c=>c.query('select 1 from public.app_note_templates where workspace_id=$1',[WS_B]))).rows.length,0);
   assert.equal((await owner(c=>c.query('delete from public.app_note_templates where workspace_id=$1',[WS_B]))).rowCount,0);
   for(const fn of [anon,server]){
    await assert.rejects(fn(c=>c.query('select 1 from public.app_note_templates')),/permission denied/);
    await assert.rejects(fn(c=>c.query(ins,[WS_A,'x',JSON.stringify(ed1())])),/permission denied/);
    await assert.rejects(fn(c=>c.query('delete from public.app_note_templates')),/permission denied/);
   }
   assert.equal((await pool.query('select count(*)::int n from public.app_note_templates where workspace_id=$1',[WS_A])).rows[0].n,4);
  });
  await t.test('rollback: new table and record gone, workspaces untouched, re-apply works',async()=>{
   const ws=(await pool.query('select count(*)::int n from public.app_workspaces')).rows[0].n;
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   for(const r of await readOnly(precheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   assert.equal((await pool.query('select count(*)::int n from public.app_workspaces')).rows[0].n,ws);
   await pool.query(migration);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
