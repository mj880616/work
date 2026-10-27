// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic (no real photo or file names).
// JOURNAL-일기원드라이브 사진 색인 DB(20261028010000): 새 표 2개 + 연결 표 진행 칸 5개.
// - service_role(Edge onedrive-photos)은 색인 표에 여러 행 upsert·고치기·지우기가 되고, 연결 표는 새 칸만 고칠 수 있다.
// - authenticated·anon은 세 표 어디도 읽지도 쓰지도 못한다(권한을 넓히지 않음).
// - 연결 행을 지우면(연결 끊기) 색인도 함께 지워진다. 다음 쪽 주소는 Graph 주소만 받는다.
// - 사전·사후 확인 SQL은 적용 전·후·되돌린 뒤 모두 기대대로 나온다.
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
import {fixture,OWNER,WS_A,WS_B} from './basket4-fixture.mjs';
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const STEM='20261028010000_onedrive_photo_index';

test('onedrive photo index: service_role-only index tables, delta progress columns, pair files',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'onedrive-index-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(await read('supabase/migrations/20261026140000_diary_onedrive_db.sql'));
  async function as(role,fn,sub=''){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub]);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const svc=fn=>as('service_role',fn);
  const rows=async sql=>(await pool.query(sql)).rows;
  const allYes=async file=>{for(const r of await rows(await read(file)))assert.equal(r.ok,'예',file+': '+r.item);};

  await t.test('precheck before apply: absent, prerequisites present, zero new columns',async()=>{
   const r=Object.fromEntries((await rows(await read(`docs/${STEM}.precheck.sql`))).map(x=>[x.item,x.value]));
   assert.equal(r['new migration absent'],'예');assert.equal(r['connection migration applied'],'예');
   assert.equal(r['connections table'],'예');assert.equal(r['new tables absent'],'예');assert.equal(r['new columns present'],'0');
   await allYes(`docs/${STEM}.postcheck.sql`);
  });

  await t.test('apply once; a second apply stops at the guard',async()=>{
   const sql=await read(`supabase/migrations/${STEM}.sql`);
   await pool.query(sql);
   const c=await pool.connect();
   try{await assert.rejects(c.query(sql),/ONEDRIVE_INDEX_PREREQUISITE_CHANGED/);await c.query('rollback');}finally{c.release();}
   await allYes(`docs/${STEM}.postcheck.sql`);
   assert.equal((await rows("select count(*)::int n from supabase_migrations.schema_migrations where version='20261028010000'"))[0].n,1);
  });

  await pool.query(`insert into public.app_onedrive_connections(workspace_id,refresh_token,scope,folder_id,folder_name,folder_path)
   values ($1,'synthetic-refresh-0001','files.readwrite user.read','TOP!1','top','/drive/root:/top'),
          ($2,'synthetic-refresh-0002','files.readwrite user.read','TOP!2','top','/drive/root:/top')`,[WS_A,WS_B]);

  await t.test('service_role: batch upsert of folders and photos, toggle, delete; progress columns update',async()=>{
   const up=`insert into public.app_onedrive_photos(workspace_id,item_id,parent_id,name,taken_at,approx,taken_day,updated_at)
    select b.* from json_populate_recordset(null::public.app_onedrive_photos,$1::json) b
    on conflict (workspace_id,item_id) do update set workspace_id=excluded.workspace_id,item_id=excluded.item_id,parent_id=excluded.parent_id,
     name=excluded.name,taken_at=excluded.taken_at,approx=excluded.approx,taken_day=excluded.taken_day,updated_at=excluded.updated_at`;
   const p=(id,parent,day)=>({workspace_id:WS_A,item_id:id,parent_id:parent,name:'img-'+id+'.jpg',taken_at:day+'T03:00:00Z',approx:false,taken_day:day,updated_at:'2026-10-28T00:00:00Z'});
   await svc(c=>c.query(`insert into public.app_onedrive_folders(workspace_id,item_id,parent_id,name)
    select b.workspace_id,b.item_id,b.parent_id,b.name from json_populate_recordset(null::public.app_onedrive_folders,$1::json) b
    on conflict (workspace_id,item_id) do update set workspace_id=excluded.workspace_id,item_id=excluded.item_id,parent_id=excluded.parent_id,name=excluded.name`,
    [JSON.stringify([{workspace_id:WS_A,item_id:'TOP!1',parent_id:'ROOT!0',name:'top'},{workspace_id:WS_A,item_id:'SUB!1',parent_id:'TOP!1',name:'sub'}])]));
   await svc(c=>c.query(up,[JSON.stringify([p('P!1','SUB!1','2026-10-01'),p('P!2','SUB!1','2026-10-02')])]));
   await svc(c=>c.query(up,[JSON.stringify([p('P!1','TOP!1','2026-09-30')])]));
   assert.deepEqual(await rows("select item_id,parent_id,taken_day::text d from public.app_onedrive_photos order by item_id"),
    [{item_id:'P!1',parent_id:'TOP!1',d:'2026-09-30'},{item_id:'P!2',parent_id:'SUB!1',d:'2026-10-02'}]);
   await svc(c=>c.query("update public.app_onedrive_folders set enabled=false where workspace_id=$1 and item_id='SUB!1'",[WS_A]));
   assert.equal((await rows("select enabled from public.app_onedrive_folders where item_id='SUB!1'"))[0].enabled,false);
   await svc(c=>c.query("delete from public.app_onedrive_photos where workspace_id=$1 and item_id='P!2'",[WS_A]));
   await svc(c=>c.query("update public.app_onedrive_connections set next_link='https://graph.microsoft.com/v1.0/me/drive/items/TOP!1/delta?token=synthetic',index_lock_until=now() where workspace_id=$1",[WS_A]));
   await svc(c=>c.query("update public.app_onedrive_connections set delta_link='https://graph.microsoft.com/v1.0/x?token=s2',next_link=null,index_done_at=now(),synced_at=now(),index_lock_until=null where workspace_id=$1",[WS_A]));
  });

  await t.test('checks: non-Graph links, bad ids and empty names are refused',async()=>{
   await assert.rejects(svc(c=>c.query("update public.app_onedrive_connections set next_link='https://example.com/x' where workspace_id=$1",[WS_A])),{code:'23514'});
   await assert.rejects(svc(c=>c.query("insert into public.app_onedrive_photos(workspace_id,item_id,parent_id,name,taken_at,taken_day) values ($1,'bad id','SUB!1','n',now(),current_date)",[WS_A])),{code:'23514'});
   await assert.rejects(svc(c=>c.query("insert into public.app_onedrive_folders(workspace_id,item_id,name) values ($1,'F!9','')",[WS_A])),{code:'23514'});
  });

  await t.test('grants: service_role cannot change workspace_id on connections or truncate; client roles have nothing',async()=>{
   await assert.rejects(svc(c=>c.query('update public.app_onedrive_connections set workspace_id=$1 where workspace_id=$2',[WS_B,WS_A])),{code:'42501'});
   await assert.rejects(svc(c=>c.query('truncate public.app_onedrive_photos')),{code:'42501'});
   for(const role of ['authenticated','anon'])for(const table of ['app_onedrive_folders','app_onedrive_photos']){
    await assert.rejects(as(role,c=>c.query(`select * from public.${table}`),OWNER),{code:'42501'});
    await assert.rejects(as(role,c=>c.query(`delete from public.${table}`),OWNER),{code:'42501'});
    await assert.rejects(as(role,c=>c.query(`update public.${table} set updated_at=now()`),OWNER),{code:'42501'});
   }
   for(const role of ['authenticated','anon'])
    await assert.rejects(as(role,c=>c.query('update public.app_onedrive_connections set delta_link=null'),OWNER),{code:'42501'});
  });

  await t.test('disconnect: deleting the connection row removes that workspace index only',async()=>{
   await svc(c=>c.query("insert into public.app_onedrive_photos(workspace_id,item_id,parent_id,name,taken_at,taken_day) values ($1,'Q!1','TOP!2','n.jpg',now(),current_date)",[WS_B]));
   await svc(c=>c.query('delete from public.app_onedrive_connections where workspace_id=$1',[WS_A]));
   assert.deepEqual(await rows('select workspace_id::text w,count(*)::int n from public.app_onedrive_photos group by 1'),[{w:WS_B,n:1}]);
   assert.equal((await rows('select count(*)::int n from public.app_onedrive_folders'))[0].n,0);
  });

  await t.test('rollback removes tables, columns and the record; postcheck stays all 예; connection rows are kept',async()=>{
   await pool.query(await read(`docs/${STEM}.rollback.sql`));
   assert.equal((await rows("select to_regclass('public.app_onedrive_photos') is null and to_regclass('public.app_onedrive_folders') is null as gone"))[0].gone,true);
   assert.equal((await rows("select count(*)::int n from pg_attribute where attrelid='public.app_onedrive_connections'::regclass and attname in ('delta_link','next_link','index_done_at','synced_at','index_lock_until') and not attisdropped"))[0].n,0);
   assert.equal((await rows('select count(*)::int n from public.app_onedrive_connections'))[0].n,1);
   await allYes(`docs/${STEM}.postcheck.sql`);
   const pre=Object.fromEntries((await rows(await read(`docs/${STEM}.precheck.sql`))).map(x=>[x.item,x.value]));
   assert.equal(pre['new migration absent'],'예');assert.equal(pre['new columns present'],'0');
  });

  await t.test('pair files read pg_catalog only (no information_schema) and the snapshot reads no row values',async()=>{
   for(const kind of ['precheck','snapshot','postcheck','rollback'])
    assert.doesNotMatch(await read(`docs/${STEM}.${kind}.sql`),/information_schema/i);
   assert.doesNotMatch(await read(`supabase/migrations/${STEM}.sql`),/information_schema|\bto (anon|authenticated|public)\b/i);
   await rows(await read(`docs/${STEM}.snapshot.sql`));
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
