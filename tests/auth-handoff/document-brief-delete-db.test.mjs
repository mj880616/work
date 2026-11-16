// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic(가상 자료).
// S63-08 BRIEF-브리핑룸삭제 PR ①(20261116110000_document_brief_delete): 브리핑만 지우는 함수 — 승인형 DB workflow 실행기로.
// - 규칙 통과(full 흐름), 시험 적용은 아무것도 안 바꿈, 적용 뒤 사후 확인 모두 예, 두 번째 적용 거절.
// - 주인만: 자기 작업공간 자료의 브리핑 행(만드는 중 포함)만 지우고 지운 수만 돌려준다. 자료 행은 그대로.
// - 거절: 비로그인·anon·service_role 실행, 남의 작업공간 자료는 0건(행 그대로). 표 권한은 그대로(authenticated 직접 지우기 없음).
// - 되돌리기: 함수·기록이 없어지고 snapshot과 같아진다.
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
const version='20261116110000',name='document_brief_delete',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const DOC_A='31000000-0000-4000-8000-0000000000a1',DOC_A2='31000000-0000-4000-8000-0000000000a2',DOC_B='31000000-0000-4000-8000-0000000000b1';
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;
  create table public.app_documents(id uuid primary key, workspace_id uuid not null references public.app_workspaces(id), title text);
  alter table public.app_documents enable row level security;
  create policy fake_docs_owner on public.app_documents for select to authenticated using (private.app_is_workspace_owner(workspace_id));
  grant select on public.app_documents to authenticated;
  insert into public.app_documents values ('${DOC_A}','${WS_A}','가상 자료 1'),('${DOC_A2}','${WS_A}','가상 자료 2'),('${DOC_B}','${WS_B}','가상 남의 자료');`;

test('document brief delete db: plan, dry-run, apply, owner-only delete, no table grant change, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'brief-delete-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const guardFails=async pattern=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),pattern);await c.query('rollback');}finally{c.release();}};
  const del=(c,doc)=>c.query('select public.app_document_brief_delete($1) n',[doc]).then(r=>r.rows[0].n);
  const count=async doc=>Number((await pool.query('select count(*) n from public.app_document_briefs where document_id=$1',[doc])).rows[0].n);

  await t.test('guard: stops without changes until document_briefs is applied',async()=>{
   await guardFails(/DOCUMENT_BRIEF_DELETE_PREREQUISITE_CHANGED/);
   await pool.query(await read('supabase/migrations/20261113220000_document_briefs.sql'));
  });
  // 가상 브리핑 행: 내 자료 1(끝난 것 + 만드는 중), 내 자료 2(끝난 것), 남의 자료(끝난 것).
  await pool.query(`insert into public.app_document_briefs(workspace_id,created_by,document_id,status,stage) values
   ('${WS_A}','${OWNER}','${DOC_A}','done','done'),('${WS_A}','${OWNER}','${DOC_A}','running','chunk'),
   ('${WS_A}','${OWNER}','${DOC_A2}','done','done'),('${WS_B}','${STRANGER}','${DOC_B}','done','done')`);
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules, full flow, summary 3 lines, snapshot reads catalogs only, no anon/public grant, no table grant or policy',()=>{
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.flow,'full');assert.equal(plan.rules,'expanded');
    assert.deepEqual(plan.review.definer,['public.app_document_brief_delete']);
    assert.equal(plan.review.policies,0);assert.equal(plan.review.triggers,0);assert.deepEqual(plan.createdTables,[]);
   }
   const code=migration.replace(/--.*$/gm,'').replace(/insert into supabase_migrations\.schema_migrations[\s\S]*?\]\);/,'');
   assert.doesNotMatch(code,/create policy|drop policy|alter policy|disable row level security|rtw_|grant [^;]* to (anon|public|service_role)\b|on table|grant (select|insert|update|delete)|create table|alter table|create trigger/i);
   assert.match(code,/revoke all on function public\.app_document_brief_delete\(uuid\) from public, anon, service_role;\s*grant execute on function public\.app_document_brief_delete\(uuid\) to authenticated;/);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   for(const r of (precheck.match(/^-- expect: .*$/gm)||[]))assert.match(r,/^-- expect: .+ = (예|기록)$/);
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
   assert.doesNotMatch(migration+rollbackSQL+summary+precheck+postcheck+snapshot,/[A-Za-z0-9._-]+@[A-Za-z0-9-]+\.[A-Za-z]/,'no mail address');
  });
  await t.test('precheck all yes; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9982');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9983')).ok,false);
  });
  await t.test('owner deletes only own brief rows of one document (running too); document row stays; returns count only',async()=>{
   assert.equal(await owner(c=>del(c,DOC_A)),2);
   assert.equal(await count(DOC_A),0);assert.equal(await count(DOC_A2),1,'other document untouched');
   assert.equal(Number((await pool.query('select count(*) n from public.app_documents')).rows[0].n),3,'documents stay');
   assert.equal(await owner(c=>del(c,DOC_A)),0,'second time: nothing left');
  });
  await t.test('stranger, anon, service_role, signed-out: nothing deleted',async()=>{
   assert.equal(await owner(c=>del(c,DOC_B)),0,'owner cannot delete another workspace brief');
   assert.equal(await stranger(c=>del(c,DOC_A2)),0,'stranger cannot delete my brief');
   assert.equal(await count(DOC_A2),1);assert.equal(await count(DOC_B),1);
   await assert.rejects(()=>as('authenticated','',c=>del(c,DOC_A2)),/DOCUMENT_BRIEF_DELETE_NOT_ALLOWED/);
   await assert.rejects(()=>owner(c=>del(c,null)),/DOCUMENT_BRIEF_DELETE_NOT_ALLOWED/);
   await assert.rejects(()=>as('anon','',c=>del(c,DOC_A2)),/permission denied/);
   await assert.rejects(()=>as('service_role','',c=>del(c,DOC_A2)),/permission denied/);
   await assert.rejects(()=>owner(c=>c.query('delete from public.app_document_briefs where document_id=$1',[DOC_A2])),/permission denied/,'table delete still closed');
   assert.equal(await stranger(c=>del(c,DOC_B)),1,'stranger deletes own');
  });
  await t.test('rollback: function and history gone, snapshot same as before apply (except rows already deleted)',async()=>{
   await pool.query(rollbackSQL);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal((await pool.query("select to_regprocedure('public.app_document_brief_delete(uuid)') p")).rows[0].p,null);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
