// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S49-38 FOLDER-순서·색 ② DB: app_note_folders.color (null 또는 1~8) + 서버 함수 app_note_folder_set_color (owner만, 표 권한은 넓히지 않음).
// - 승인형 workflow의 plan·dry-run·apply가 통과(확장 규칙)하고, dry-run은 아무것도 남기지 않는다.
// - owner만 색을 바꾼다: 남의 폴더·없는 폴더는 같은 오류로 거절, anon·로그인 안 함 거절, 1~8 밖은 거절, null은 기본으로 되돌림.
// - 표 권한 그대로(authenticated는 color를 직접 쓸 수 없고, 이름·순서 쓰기 길은 그대로), 되돌리기는 칸·검사·함수·기록만 지운다.
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
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261104200500',name='note_folder_color',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const F1='31000000-0000-4000-8000-000000000001',F2='31000000-0000-4000-8000-000000000002',F_OTHER='31000000-0000-4000-8000-000000000003';
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

test('note folder color: plan, dry-run, apply, owner-only function, CHECK and rollback',{timeout:150000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'note-folder-color-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query("create table public.app_notes(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id), kind text not null default 'note', archived_at timestamptz, metadata jsonb not null default '{}'::jsonb)");
  // The folder table comes from its own repository migration, as it was applied.
  await pool.query(await read('supabase/migrations/20261028170000_note_folders.sql'));
  await pool.query(`insert into public.app_note_folders(id,workspace_id,name,sort_order) values ('${F1}','${WS_A}','갑 폴더',1024),('${F2}','${WS_A}','을 폴더',2048),('${F_OTHER}','${WS_B}','남의 폴더',1024)`);
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const setColor=(sub,id,color,role='authenticated')=>as(role,sub,c=>c.query('select public.app_note_folder_set_color($1::uuid,$2::smallint) r',[id,color]));
  const colorOf=async id=>(await pool.query('select color from public.app_note_folders where id=$1',[id])).rows[0].color;
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;

  await t.test('before apply there is no color column and no function',async()=>{
   assert.equal((await pool.query("select count(*)::int n from pg_attribute where attrelid='public.app_note_folders'::regclass and attname='color' and not attisdropped")).rows[0].n,0);
   assert.equal((await pool.query("select to_regprocedure('public.app_note_folder_set_color(uuid,smallint)') is null v")).rows[0].v,true);
   assert.ok(beforeCheck.length>0);
  });
  await t.test('plan accepts the migration and its companion files',()=>{
   const p=plan('apply','9980');assert.ok(p&&!p.rejected,JSON.stringify(p).slice(0,300));
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
  });
  await t.test('apply passes postcheck; table grants and policies unchanged',async()=>{
   const apply=await run('apply','9982');assert.equal(apply.ok,true,apply.summary);
   assert.ok((await pool.query(postcheck)).rows.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'));
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
   assert.equal(await colorOf(F1),null,'existing folders start with no color');
   assert.equal((await pool.query("select has_column_privilege('authenticated','public.app_note_folders','color','insert,update') v")).rows[0].v,false,'no direct color write');
   assert.equal((await pool.query("select has_function_privilege('anon','public.app_note_folder_set_color(uuid,smallint)','execute') a, has_function_privilege('service_role','public.app_note_folder_set_color(uuid,smallint)','execute') s, has_function_privilege('authenticated','public.app_note_folder_set_color(uuid,smallint)','execute') u")).rows[0].a,false);
  });
  await t.test('the owner sets, changes and clears a color; nothing else about the folder changes',async()=>{
   const row=async()=> (await pool.query('select name,sort_order,parent_id from public.app_note_folders where id=$1',[F1])).rows[0];
   const was=await row();
   assert.deepEqual((await setColor(OWNER,F1,5)).rows[0].r,{ok:true,id:F1,color:5});assert.equal(await colorOf(F1),5);
   await setColor(OWNER,F1,8);assert.equal(await colorOf(F1),8);
   await setColor(OWNER,F1,null);assert.equal(await colorOf(F1),null);
   assert.deepEqual(await row(),was);
  });
  await t.test('others cannot: another workspace owner, unknown folder, anon, not signed in',async()=>{
   await assert.rejects(setColor(STRANGER,F1,3),{code:'42501',message:/NOTE_FOLDER_COLOR_FORBIDDEN/});
   await assert.rejects(setColor(OWNER,F_OTHER,3),{code:'42501',message:/NOTE_FOLDER_COLOR_FORBIDDEN/});
   await assert.rejects(setColor(OWNER,'31000000-0000-4000-8000-0000000000ff',3),{code:'42501',message:/NOTE_FOLDER_COLOR_FORBIDDEN/});
   await assert.rejects(setColor('',F1,3),{code:'42501'});
   await assert.rejects(setColor(OWNER,F1,3,'anon'),{code:'42501'});
   assert.equal(await colorOf(F1),null);assert.equal(await colorOf(F_OTHER),null);
  });
  await t.test('bad numbers are refused by the function and by the CHECK',async()=>{
   for(const v of [0,9,-1,100])await assert.rejects(setColor(OWNER,F1,v),{code:'22023',message:/NOTE_FOLDER_COLOR_ARGS/},String(v));
   await assert.rejects(pool.query('update public.app_note_folders set color=9 where id=$1',[F1]),{code:'23514'});
   await assert.rejects(pool.query('update public.app_note_folders set color=0 where id=$1',[F1]),{code:'23514'});
   await pool.query('update public.app_note_folders set color=3 where id=$1',[F1]);await pool.query('update public.app_note_folders set color=null where id=$1',[F1]);
  });
  await t.test('authenticated cannot write color straight into the table',async()=>{
   await assert.rejects(as('authenticated',OWNER,c=>c.query('update public.app_note_folders set color=2 where id=$1',[F1])),{code:'42501'});
   assert.equal(await colorOf(F1),null);
  });
  await t.test('rollback removes the function, check, column and record; re-apply works',async()=>{
   await setColor(OWNER,F2,4);
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal((await pool.query("select count(*)::int n from public.app_note_folders")).rows[0].n,3,'folders stay');
   const again=await run('apply','9983');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
