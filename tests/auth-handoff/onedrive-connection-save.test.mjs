// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// JOURNAL-일기원드라이브 연결 저장 고치기: 운영에 적용된 20261026140000 migration 권한 그대로(service_role은 workspace_id 고치기 권한 없음).
// - 옛 저장(PostgREST upsert = INSERT … ON CONFLICT DO UPDATE SET <보낸 모든 칸, workspace_id 포함>)은 행이 없어도 42501로 거절된다.
// - 새 저장(넣기 → 이미 있으면 23505 → 허용된 칸만 고치기)은 기존 권한 안에서 성공한다.
// - authenticated·anon은 여전히 아무것도 못 한다(권한을 넓히지 않았음).
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

const COLS=['workspace_id','refresh_token','scope','folder_id','folder_name','folder_path','connected_at','updated_at'];
const row=(ws,token)=>({workspace_id:ws,refresh_token:token,scope:'files.readwrite user.read',folder_id:null,folder_name:null,folder_path:null,
 connected_at:'2026-10-27T06:00:00Z',updated_at:'2026-10-27T06:00:00Z'});
// PostgREST(supabase-js .upsert(v,{onConflict:'workspace_id'}))가 만드는 모양: 보낸 모든 칸을 넣고, 충돌하면 보낸 모든 칸을 EXCLUDED로 덮는다.
const upsertSql=cols=>`insert into public.app_onedrive_connections(${COLS.join(',')})
 select ${COLS.map(c=>'b.'+c).join(',')} from json_populate_record(null::public.app_onedrive_connections,$1::json) b
 on conflict (workspace_id) do update set ${cols.map(c=>`${c}=excluded.${c}`).join(',')}`;
// 새 저장 방식이 PostgREST로 보내는 두 요청의 모양(.insert(v) / .update(fields).eq('workspace_id',ws).select('workspace_id')).
const insertSql=`insert into public.app_onedrive_connections(${COLS.join(',')})
 select ${COLS.map(c=>'b.'+c).join(',')} from json_populate_record(null::public.app_onedrive_connections,$1::json) b`;
const FIELDS=COLS.filter(c=>c!=='workspace_id');
const updateSql=`update public.app_onedrive_connections t set ${FIELDS.map(c=>`${c}=b.${c}`).join(',')}
 from json_populate_record(null::public.app_onedrive_connections,$1::json) b where t.workspace_id=$2 returning t.workspace_id`;

test('onedrive connection save: old upsert is refused (42501) under the applied grants, insert-then-update works without widening',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'onedrive-save-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(await read('supabase/migrations/20261026140000_diary_onedrive_db.sql'));
  async function as(role,fn,sub=''){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub]);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const svc=fn=>as('service_role',fn);
  const stored=async ws=>(await pool.query('select refresh_token,folder_id,folder_path from public.app_onedrive_connections where workspace_id=$1',[ws])).rows;

  await t.test('cause: the PostgREST upsert is refused with 42501 even when no row exists yet (workspace_id is in the SET clause)',async()=>{
   await assert.rejects(svc(c=>c.query(upsertSql(COLS),[JSON.stringify(row(WS_A,'synthetic-refresh-0001'))])),{code:'42501'});
   assert.deepEqual(await stored(WS_A),[]);
   // 같은 upsert에서 workspace_id만 SET에서 빼면 통과한다 = 원인은 workspace_id 고치기 권한 하나.
   await svc(c=>c.query(upsertSql(FIELDS),[JSON.stringify(row(WS_B,'synthetic-refresh-0009'))]));
   assert.equal((await stored(WS_B)).length,1);
   await pool.query('delete from public.app_onedrive_connections where workspace_id=$1',[WS_B]);
  });

  await t.test('fix, first connection: plain insert with workspace_id succeeds as service_role',async()=>{
   const r=await svc(c=>c.query(insertSql,[JSON.stringify(row(WS_A,'synthetic-refresh-0001'))]));
   assert.equal(r.rowCount,1);assert.deepEqual(await stored(WS_A),[{refresh_token:'synthetic-refresh-0001',folder_id:null,folder_path:null}]);
  });

  await t.test('fix, reconnect: insert hits 23505, then update of the allowed columns only succeeds and clears the folder',async()=>{
   await svc(c=>c.query('update public.app_onedrive_connections set folder_id=$2,folder_name=$3,folder_path=$4 where workspace_id=$1',[WS_A,'F1!100','카메라','/drive/root:/Pictures/Camera']));
   await assert.rejects(svc(c=>c.query(insertSql,[JSON.stringify(row(WS_A,'synthetic-refresh-0002'))])),{code:'23505'});
   const r=await svc(c=>c.query(updateSql,[JSON.stringify(row(WS_A,'synthetic-refresh-0002')),WS_A]));
   assert.deepEqual(r.rows,[{workspace_id:WS_A}]);
   assert.deepEqual(await stored(WS_A),[{refresh_token:'synthetic-refresh-0002',folder_id:null,folder_path:null}]);
   // 행이 없으면 update는 0행(함수는 이것을 실패로 본다).
   assert.equal((await svc(c=>c.query(updateSql,[JSON.stringify(row(WS_B,'synthetic-refresh-0003')),WS_B]))).rowCount,0);
  });

  await t.test('grants are unchanged: service_role still cannot change workspace_id; client roles still have no access',async()=>{
   await assert.rejects(svc(c=>c.query('update public.app_onedrive_connections set workspace_id=$1 where workspace_id=$2',[WS_B,WS_A])),{code:'42501'});
   for(const role of ['authenticated','anon']){
    await assert.rejects(as(role,c=>c.query('select refresh_token from public.app_onedrive_connections'),OWNER),{code:'42501'});
    await assert.rejects(as(role,c=>c.query(insertSql,[JSON.stringify(row(WS_B,'synthetic-refresh-0004'))]),OWNER),{code:'42501'});
    await assert.rejects(as(role,c=>c.query(updateSql,[JSON.stringify(row(WS_A,'synthetic-refresh-0005')),WS_A]),OWNER),{code:'42501'});
   }
   assert.deepEqual(await stored(WS_A),[{refresh_token:'synthetic-refresh-0002',folder_id:null,folder_path:null}]);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
