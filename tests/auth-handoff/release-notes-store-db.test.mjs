// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// UPDATE-운영자전용기록업데이트소식 PR1(20261115190000): 개발 기록 표 app_release_notes + 읽기(운영자만)·쓰기(service_role만) 함수.
// - 승인형 DB workflow 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예.
// - 읽기: 운영자 기능 dev_inbox 작업공간 owner만. 다른 owner·비로그인·service_role은 거절(42501). 표는 어떤 API 역할도 직접 못 읽고 못 쓴다.
// - 쓰기: service_role만. 모양·커밋 모양이 틀리면 거절. authenticated(운영자 포함)는 못 쓴다.
// - 되돌리기는 함수·기록만 지우고 표는 남긴다. 다시 적용하면 이전 표가 있어 멈춘다(표를 지운 뒤에만 다시 적용).
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
const version='20261115190000',name='release_notes_store',stem=version+'_'+name;
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
const SHA='0123456789abcdef0123456789abcdef01234567';
const NOTES={schema:1,current:'11/15-1',notes:[{v:'11/15-1',date:'2026-11-15',changes:['가상 바뀐 점'],checks:[]}]};

test('release notes store: operator reads, server writes, no API table access, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'release-notes-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
   grant select on public.app_documents to authenticated;`);
  await pool.query("update public.app_workspaces set slug='kptu-work' where id=$1",[WS_A]);
  await pool.query("update public.app_workspaces set slug='other-work' where id=$1",[WS_B]);
  for(const f of BEFORE.slice(0,-1))await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-24','2026-10-24T03:00:00Z','가상 통화','가상 요약','call:rn1')",[WS_A]);
  await pool.query(await read('supabase/migrations/'+BEFORE.at(-1)+'.sql'));
  for(const f of ['20261031120000_gdrive_photo_index','20261102160000_cloud_files_index'])await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const devInbox=await read('supabase/migrations/20261103100000_dev_inbox_feature.sql');
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const guardFails=async pattern=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),pattern);await c.query('rollback');}finally{c.release();}};

  await t.test('guard: stops without changes before the dev_inbox step is applied',async()=>{
   await guardFails(/RELEASE_NOTES_STORE_PREREQUISITE_CHANGED/);
   assert.equal((await pool.query("select to_regclass('public.app_release_notes') r")).rows[0].r,null);
   await pool.query(devInbox);
  });
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const allYes=async sql=>{for(const r of await readOnly(sql))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);};
  const before=(await pool.query(snapshot)).rows;

  await t.test('files: rules pass, summary 3 lines, no fixed id, snapshot reads catalogs only',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.flow,'full');
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bto (anon|public)\b(?!\.)|disable row level security|create policy|rtw_/i);
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id in the migration');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
  });

  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(await readOnly(precheck));
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.equal(v['dev_inbox rows'],'1');
   const dry=await run('dry-run','9961');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9962');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.equal((await run('apply','9963')).ok,false);
  });

  await t.test('read: empty store gives null to the operator; stranger, anon and server are refused',async()=>{
   assert.equal((await owner(c=>c.query('select public.app_release_notes_read() n'))).rows[0].n,null);
   await assert.rejects(stranger(c=>c.query('select public.app_release_notes_read()')),{code:'42501',message:/OPERATOR_FEATURE_REQUIRED/});
   await assert.rejects(anon(c=>c.query('select public.app_release_notes_read()')),{code:'42501'});
   await assert.rejects(server(c=>c.query('select public.app_release_notes_read()')),{code:'42501'});
  });

  await t.test('put: server only, shape and commit checked; operator then reads the stored notes',async()=>{
   await assert.rejects(owner(c=>c.query('select public.app_release_notes_put($1,$2)',[NOTES,SHA])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query('select public.app_release_notes_put($1,$2)',[NOTES,SHA])),{code:'42501'});
   await assert.rejects(anon(c=>c.query('select public.app_release_notes_put($1,$2)',[NOTES,SHA])),{code:'42501'});
   await assert.rejects(server(c=>c.query('select public.app_release_notes_put($1,$2)',[{schema:2,notes:[]},SHA])),/RELEASE_NOTES_SHAPE/);
   await assert.rejects(server(c=>c.query('select public.app_release_notes_put($1,$2)',[{schema:1,notes:{}},SHA])),/RELEASE_NOTES_SHAPE/);
   await assert.rejects(server(c=>c.query('select public.app_release_notes_put($1,$2)',[NOTES,'main'])),/RELEASE_NOTES_COMMIT/);
   assert.equal((await server(c=>c.query('select public.app_release_notes_put($1,$2) r',[NOTES,SHA]))).rows[0].r.count,1);
   assert.equal((await server(c=>c.query('select public.app_release_notes_put($1,$2) r',[NOTES,SHA]))).rows[0].r.count,1);
   assert.equal((await pool.query('select count(*)::int n from public.app_release_notes')).rows[0].n,1);
   assert.deepEqual((await owner(c=>c.query('select public.app_release_notes_read() n'))).rows[0].n,NOTES);
   await assert.rejects(stranger(c=>c.query('select public.app_release_notes_read()')),{code:'42501'});
  });

  await t.test('table: no API role can read or write it directly',async()=>{
   for(const fn of [owner,stranger,server,anon]){
    await assert.rejects(fn(c=>c.query('select * from public.app_release_notes')),{code:'42501'});
    await assert.rejects(fn(c=>c.query("update public.app_release_notes set commit_sha=$1",[SHA])),{code:'42501'});
   }
  });

  await t.test('operator check follows the allow table: owner without dev_inbox is refused',async()=>{
   await pool.query("delete from public.app_operator_features where feature='dev_inbox'");
   await assert.rejects(owner(c=>c.query('select public.app_release_notes_read()')),{code:'42501'});
   await pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'dev_inbox')",[WS_A]);
   assert.ok((await owner(c=>c.query('select public.app_release_notes_read() n'))).rows[0].n);
  });

  await t.test('rollback removes the functions and record; the table stays',async()=>{
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select to_regprocedure('public.app_release_notes_read()') f")).rows[0].f,null);
   assert.equal((await pool.query("select to_regprocedure('public.app_release_notes_put(jsonb,text)') f")).rows[0].f,null);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_release_notes')).rows[0].n,1);
   await guardFails(/RELEASE_NOTES_STORE_PREREQUISITE_CHANGED/);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
