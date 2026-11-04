// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic (no real file, folder or account names).
// S49-28 FILES-통합 2-②(20261104162800_cloud_jobs): 전송 작업표.
// - 승인형 DB workflow 확장 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예.
// - 작업표는 그 작업공간 owner + files 허용일 때만 읽힘. 다른 작업공간 0줄, files 없으면 0줄, anon 거절, 화면은 쓰기 못 함.
// - 이어 올리기 자리 표는 화면(authenticated)·anon 모두 못 읽음(service_role만).
// - service_role은 정한 칸만 넣고 고침(작업공간·만든 사람·원본은 못 바꿈), 지우기 없음.
// - 되돌리기(SQL Editor 전용)는 진행 중 줄이 있으면 멈추고, 없으면 표 둘·기록을 지우고 다시 적용할 수 있다.
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
const version='20261104162800',name='cloud_jobs',stem=version+'_'+name;
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

test('cloud jobs: owner+files read only, upload address hidden, service role limited columns, rollback guarded',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'cloud-jobs-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  await pool.query(`create table public.app_documents(id uuid primary key, workspace_id uuid not null, file_id text, extraction_status text, extracted_text text);
   alter table public.app_documents enable row level security;
   create policy fake_docs_owner on public.app_documents for select to authenticated using (private.app_is_workspace_owner(workspace_id));
   revoke all on public.app_documents from anon;
   grant select on public.app_documents to authenticated;`);
  await pool.query("update public.app_workspaces set slug='kptu-work' where id=$1",[WS_A]);
  await pool.query("update public.app_workspaces set slug='other-work' where id=$1",[WS_B]);
  for(const f of BEFORE.slice(0,-1))await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-24','2026-10-24T03:00:00Z','가상 통화','가상 요약','call:cj1')",[WS_A]);
  await pool.query(await read('supabase/migrations/'+BEFORE.at(-1)+'.sql'));
  await pool.query(await read('supabase/migrations/20261031120000_gdrive_photo_index.sql'));
  await pool.query(await read('supabase/migrations/20261102160000_cloud_files_index.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),anon=fn=>as('anon','',fn),service=fn=>as('service_role','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const allYes=async sql=>{for(const r of await readOnly(sql))assert.equal(r.ok,'예',r.item);};
  const job=(ws,o={})=>({workspace_id:ws,created_by:ws===WS_A?OWNER:STRANGER,kind:'copy',origin:'cloud',src_source:'gd',src_id:'file_a',dest_source:'od',dest_parent:null,
   name:'가상_파일.bin',size_bytes:1000,mime:'application/octet-stream',status:'queued',...o});
  const ins=(c,j)=>c.query(`insert into public.app_cloud_jobs(${Object.keys(j).join(',')}) values(${Object.keys(j).map((_,i)=>'$'+(i+1)).join(',')}) returning id`,Object.values(j)).then(r=>r.rows[0].id);
  let before;

  await t.test('files: expanded rules, pair files, summary three lines, no fixed ids, no functions',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['dry-run','apply']){const plan=prepareMigration({mode,version,runId:'1',root});assert.equal(plan.flow,'full');assert.equal(plan.rules,'expanded');}
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.split('\n').filter(l=>!l.trim().startsWith('--')).join('\n');
   assert.doesNotMatch(code,/disable row level security|\bto (anon|public)\b|rtw_|create function|security definer|cron\./i);
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
  });

  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(await readOnly(precheck));
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   await allYes(postcheck);
   before=(await pool.query(snapshot)).rows;
   const dry=await run('dry-run','9991');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9992');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.equal((await run('apply','9993')).ok,false);
  });

  await t.test('jobs: owner with files reads own rows only; stranger 0 rows; no files feature 0 rows; anon refused; screen cannot write',async()=>{
   const a=await service(c=>ins(c,job(WS_A)));
   await service(c=>ins(c,job(WS_B,{src_id:'file_z'})));
   await service(c=>c.query("insert into public.app_cloud_job_uploads(job_id,upload_url,hash_state) values($1,'https://up.example.test/session/1','{\"sent\":0}')",[a]));
   assert.deepEqual((await owner(c=>c.query('select id,src_id from public.app_cloud_jobs'))).rows,[{id:a,src_id:'file_a'}]);
   assert.deepEqual((await stranger(c=>c.query('select id from public.app_cloud_jobs'))).rows,[],'B has no files feature: 0 rows, never A rows');
   await pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'files')",[WS_B]);
   assert.deepEqual((await stranger(c=>c.query('select src_id from public.app_cloud_jobs'))).rows,[{src_id:'file_z'}],'B sees only B');
   await pool.query("delete from public.app_operator_features where feature='files' and workspace_id=$1",[WS_B]);
   await pool.query("delete from public.app_operator_features where feature='files' and workspace_id=$1",[WS_A]);
   assert.deepEqual((await owner(c=>c.query('select id from public.app_cloud_jobs'))).rows,[],'files off: 0 rows');
   await pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'files')",[WS_A]);
   assert.deepEqual((await as('authenticated','',c=>c.query('select id from public.app_cloud_jobs'))).rows,[]);
   await assert.rejects(anon(c=>c.query('select id from public.app_cloud_jobs')),{code:'42501'});
   for(const sql of [`insert into public.app_cloud_jobs(workspace_id,created_by,kind,src_source,src_id,dest_source,name) values('${WS_A}','${OWNER}','copy','gd','x','od','x')`,
     `update public.app_cloud_jobs set status='queued'`,`delete from public.app_cloud_jobs`])
    await assert.rejects(owner(c=>c.query(sql)),{code:'42501'},sql);
  });

  await t.test('upload addresses: screen and anon cannot read; service role can',async()=>{
   for(const who of [owner,stranger,anon])await assert.rejects(who(c=>c.query('select upload_url from public.app_cloud_job_uploads')),{code:'42501'});
   await assert.rejects(owner(c=>c.query('select 1 from public.app_cloud_job_uploads')),{code:'42501'});
   assert.equal((await service(c=>c.query('select count(*)::int as n from public.app_cloud_job_uploads'))).rows[0].n,1);
  });

  await t.test('service role: listed columns only, no delete; checks hold (status, bytes, origin, url)',async()=>{
   const a=(await pool.query('select id from public.app_cloud_jobs where workspace_id=$1',[WS_A])).rows[0].id;
   await service(c=>c.query("update public.app_cloud_jobs set status='running',sent_bytes=500,lease_until=now() where id=$1",[a]));
   for(const sql of [`update public.app_cloud_jobs set workspace_id='${WS_B}'`,`update public.app_cloud_jobs set created_by='${STRANGER}'`,
     "update public.app_cloud_jobs set src_id='other'","update public.app_cloud_jobs set dest_source='gd'","update public.app_cloud_jobs set size_bytes=1",
     'delete from public.app_cloud_jobs',`insert into public.app_cloud_jobs(id,workspace_id,created_by,kind,src_source,src_id,dest_source,name) values(gen_random_uuid(),'${WS_A}','${OWNER}','copy','gd','x','od','x')`])
    await assert.rejects(service(c=>c.query(sql)),{code:'42501'},sql);
   for(const [o,label] of [[{status:'bogus'},'status'],[{size_bytes:10,big:true,is_folder:true},'big folder'],[{origin:'device'},'device needs dev source'],
     [{src_id:'bad id'},'id'],[{same_name:'replace'},'no overwrite option'],[{error_code:'Has Caps'},'error code'],[{kind:'delete'},'kind'],[{dest_source:'ph'},'dest']])
    await assert.rejects(service(c=>ins(c,job(WS_A,o))),{code:'23514'},label);
   await assert.rejects(service(c=>c.query("update public.app_cloud_jobs set sent_bytes=5000 where id=$1",[a])),{code:'23514'},'sent beyond size');
   await assert.rejects(service(c=>c.query("insert into public.app_cloud_job_uploads(job_id,upload_url) values($1,'http://plain.example.test/x') on conflict (job_id) do update set upload_url=excluded.upload_url",[a])),{code:'23514'},'https only');
   const d=await service(c=>ins(c,job(WS_A,{origin:'device',src_source:'dev',src_id:null,status:'paused'})));
   assert.ok(d,'device rows have their own shape (used by later uploads)');
  });

  await t.test('rollback (SQL Editor) stops while jobs run; otherwise drops both tables and the record; re-apply works',async()=>{
   await assert.rejects(pool.query(rollbackSQL),/CLOUD_JOBS_ROLLBACK_BLOCKED: jobs still running/);
   assert.ok((await pool.query("select to_regclass('public.app_cloud_jobs') is not null as ok")).rows[0].ok);
   await pool.query("update public.app_cloud_jobs set status='paused'");
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select to_regclass('public.app_cloud_jobs') is null and to_regclass('public.app_cloud_job_uploads') is null as gone")).rows[0].gone,true);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await allYes(postcheck);
   assert.equal(values(await readOnly(precheck))['new migration absent'],'예');
   const again=await run('apply','9994');assert.equal(again.ok,true,again.summary);
   await allYes(postcheck);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
