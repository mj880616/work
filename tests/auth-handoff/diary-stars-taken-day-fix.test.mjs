// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic (no real photo or file names).
// PHOTO-찍은시각 바로잡기 DB(20261029124500): 원드라이브 별표의 taken_day를 새 규칙으로 다시 받은 색인 날짜와 같게 맞춘다(데이터만).
// - 색인을 아직 다시 받지 않은 연결이 있으면 아무것도 바꾸지 않고 멈춘다.
// - 새 규칙 색인 줄(updated_at ≥ 고침 기준)만 기준으로 쓰고, 직접 올린 사진 별표·색인에 없는 별표·옛 줄은 그대로 둔다.
// - 두 번 적용은 멈추고, 되돌리기는 기록 1행만 지운다. 사전·사후 확인 SQL은 적용 전·후·되돌린 뒤 기대대로 나온다.
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
import {fixture,WS_A} from './basket4-fixture.mjs';
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const STEM='20261029124500_diary_stars_taken_day_fix';

test('diary stars taken_day fix: waits for the re-walked index, fixes onedrive stars only, pair files',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'stars-day-fix-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(await read('supabase/migrations/20261026140000_diary_onedrive_db.sql'));
  await pool.query(await read('supabase/migrations/20261028010000_onedrive_photo_index.sql'));
  const rows=async(sql,args)=>(await pool.query(sql,args)).rows;
  const check=async kind=>Object.fromEntries((await rows(await read(`docs/${STEM}.${kind}.sql`))).map(x=>[x.item,x.value]));
  const migration=await read(`supabase/migrations/${STEM}.sql`);
  const tryApply=async()=>{const c=await pool.connect();try{await c.query(migration);}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const stars=async()=>(await rows("select source||':'||item_key as k,to_char(taken_day,'YYYY-MM-DD') as d from public.app_diary_stars order by 1")).map(r=>r.k+'='+r.d);

  await pool.query(`insert into public.app_onedrive_connections(workspace_id,refresh_token,scope,folder_id,folder_name,folder_path,index_done_at)
   values ($1,'synthetic-refresh-0001','files.readwrite user.read','TOP!1','top','/drive/root:/top','2026-10-20T00:00:00Z')`,[WS_A]);
  // 새 규칙으로 다시 적힌 줄(P!1·P!3)과 옛 줄(P!2). P!1은 16:00(서울) 사진이라 옛 별표가 하루 늦다.
  await pool.query(`insert into public.app_onedrive_photos(workspace_id,item_id,parent_id,name,taken_at,approx,taken_day,updated_at) values
   ($1,'P!1','TOP!1','a.jpg','2026-10-13T07:00:00Z',false,'2026-10-13','2026-10-29T00:10:00Z'),
   ($1,'P!2','TOP!1','b.jpg','2026-10-13T16:00:00Z',false,'2026-10-14','2026-10-20T00:00:00Z'),
   ($1,'P!3','TOP!1','c.jpg','2026-10-13T01:00:00Z',false,'2026-10-13','2026-10-29T00:10:00Z')`,[WS_A]);
  await pool.query(`insert into public.app_diary_stars(workspace_id,source,item_key,taken_day) values
   ($1,'onedrive','P!1','2026-10-14'),($1,'onedrive','P!2','2026-10-15'),($1,'onedrive','P!3','2026-10-13'),
   ($1,'onedrive','MISSING','2026-10-14'),($1,'upload','P!1','2026-10-14')`,[WS_A]);
  const before=await stars();

  await t.test('index not re-walked yet: precheck says so and apply stops without a change',async()=>{
   const pre=await check('precheck');
   assert.equal(pre['every connected index re-walked'],'아니오');assert.equal(pre['new migration absent'],'예');assert.equal(pre['prerequisite recorded'],'예');
   await assert.rejects(tryApply(),/DIARY_STARS_TAKEN_DAY_FIX_PREREQUISITE_CHANGED/);
   assert.deepEqual(await stars(),before);
  });

  await pool.query("update public.app_onedrive_connections set index_done_at='2026-10-29T00:10:00Z'");
  let pre;
  await t.test('precheck before apply: all expectations met, one star off by a day',async()=>{
   pre=await check('precheck');
   for(const k of ['prerequisite recorded','new migration absent','every connected index re-walked','RLS enabled','one owner policy'])assert.equal(pre[k],'예',k);
   assert.equal(pre['anon or public table privilege'],'아니오');assert.equal(pre['stars off by a day'],'1');assert.equal(pre['stars rows'],'5');
  });

  await t.test('apply once: only the onedrive star on a re-walked row moves; a second apply stops',async()=>{
   await tryApply();
   assert.deepEqual(await stars(),['onedrive:MISSING=2026-10-14','onedrive:P!1=2026-10-13','onedrive:P!2=2026-10-15','onedrive:P!3=2026-10-13','upload:P!1=2026-10-14']);
   await assert.rejects(tryApply(),/DIARY_STARS_TAKEN_DAY_FIX_PREREQUISITE_CHANGED/);
   const post=await check('postcheck');
   for(const k of ['stars agree with history','RLS still enabled','one owner policy','no anon or public table privilege'])assert.equal(post[k],'예',k);
   for(const k of ['stars rows','onedrive stars rows','constraints hash','indexes hash','owner RLS grants hash','column grants hash','policies hash','triggers hash'])assert.equal(post[k],pre[k],k);
   assert.equal((await rows("select count(*)::int n from supabase_migrations.schema_migrations where version='20261029124500' and name='diary_stars_taken_day_fix'"))[0].n,1);
  });

  await t.test('rollback removes only the record; postcheck still agrees',async()=>{
   await pool.query(await read(`docs/${STEM}.rollback.sql`));
   assert.equal((await rows("select count(*)::int n from supabase_migrations.schema_migrations where version='20261029124500'"))[0].n,0);
   assert.equal((await check('postcheck'))['stars agree with history'],'예');
   assert.equal((await check('precheck'))['new migration absent'],'예');
  });

  await t.test('pair files read pg_catalog only and the snapshot reads no row values',async()=>{
   for(const kind of ['precheck','snapshot','postcheck','rollback'])assert.doesNotMatch(await read(`docs/${STEM}.${kind}.sql`),/information_schema/i);
   assert.doesNotMatch(migration,/information_schema|\bgrant\s+(select|insert|update|delete|all|execute|usage)\b|\bto (anon|authenticated|public)\b/i);
   assert.ok((await rows(await read(`docs/${STEM}.snapshot.sql`))).length>0);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
