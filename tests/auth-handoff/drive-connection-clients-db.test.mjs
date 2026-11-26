// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic (no real token).
// S71-01 AUTH-구글권한나누기 ①(20261126100000_drive_connection_clients): 작업공간 Drive 연결이 어느 구글 창구(심사용 review / 사용자 전용 full)로 받은 것인지 적는 표.
// - 승인형 DB workflow 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예. 두 번째 apply는 멈춤. 앞 단계가 없으면 멈춤.
// - 표: workspace_id·oauth_client·updated_at 칸뿐(토큰 칸 없음), oauth_client는 review|full만, 연결 행이 없는 작업공간은 못 넣고, 연결이 지워지면 같이 지워진다.
// - anon·authenticated는 읽지도 쓰지도 못한다. service_role은 읽기·넣기·고치기(oauth_client)·지우기만, workspace_id는 못 고친다.
// - 기존 app_drive_connections의 칸·권한·RLS는 그대로. 되돌리기는 기록만 지우고 표는 남긴다.
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
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261126100000',name='drive_connection_clients',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
// 운영과 같은 앞 모양(20261104233000_workspace_drive_connections의 표·권한 부분).
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  create table public.app_drive_connections (
    workspace_id uuid primary key references public.app_workspaces(id) on delete cascade,
    google_refresh_token text not null,
    full_drive boolean not null default false,
    connected_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint app_drive_connections_token_check check (char_length(google_refresh_token) between 8 and 4096)
  );
  alter table public.app_drive_connections enable row level security;
  revoke all on table public.app_drive_connections from public, anon, authenticated, service_role;
  grant select, delete on table public.app_drive_connections to service_role;
  grant insert (workspace_id, google_refresh_token, full_drive, connected_at, updated_at) on table public.app_drive_connections to service_role;
  grant update (google_refresh_token, full_drive, connected_at, updated_at) on table public.app_drive_connections to service_role;
  insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261104233000','workspace_drive_connections',array['fixture']);
`;

test('drive connection clients: review|full per workspace connection, server only, rollback keeps table',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'drive-clients-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query("insert into public.app_drive_connections(workspace_id,google_refresh_token) values ($1,'synthetic-refresh-a')",[WS_A]);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const allYes=async sql=>{for(const r of await readOnly(sql))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);};
  const before=(await pool.query(snapshot)).rows;
  const oldAcl=(await pool.query("select relacl::text a from pg_class where oid='public.app_drive_connections'::regclass")).rows[0].a;

  await t.test('files: rules pass, summary 3 lines, snapshot reads catalogs only',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run'])assert.equal(prepareMigration({mode,version,runId:'1',root}).flow,'full');
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bto (anon|public|authenticated)\b(?!\.)|disable row level security|create policy|rtw_|google_refresh_token/i);
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
  });

  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   await allYes(precheck);
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9982');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.equal((await run('apply','9983')).ok,false);
  });

  await t.test('columns: workspace_id, oauth_client, updated_at only; old table unchanged',async()=>{
   const cols=(await pool.query("select column_name from information_schema.columns where table_schema='public' and table_name='app_drive_connection_clients' order by ordinal_position")).rows.map(r=>r.column_name);
   assert.deepEqual(cols,['workspace_id','oauth_client','updated_at']);
   assert.equal((await pool.query("select relacl::text a from pg_class where oid='public.app_drive_connections'::regclass")).rows[0].a,oldAcl);
  });

  await t.test('server: insert, update kind, read, delete; only review|full; only connected workspaces',async()=>{
   await server(c=>c.query("insert into public.app_drive_connection_clients(workspace_id,oauth_client) values ($1,'full')",[WS_A]));
   assert.equal((await server(c=>c.query('select oauth_client from public.app_drive_connection_clients where workspace_id=$1',[WS_A]))).rows[0].oauth_client,'full');
   await server(c=>c.query("update public.app_drive_connection_clients set oauth_client='review', updated_at=now() where workspace_id=$1",[WS_A]));
   assert.equal((await pool.query('select oauth_client from public.app_drive_connection_clients where workspace_id=$1',[WS_A])).rows[0].oauth_client,'review');
   await assert.rejects(server(c=>c.query("update public.app_drive_connection_clients set oauth_client='drive' where workspace_id=$1",[WS_A])),{code:'23514'});
   await assert.rejects(server(c=>c.query("insert into public.app_drive_connection_clients(workspace_id,oauth_client) values ($1,'full')",[WS_B])),{code:'23503'});
   await assert.rejects(server(c=>c.query("update public.app_drive_connection_clients set workspace_id=$1 where workspace_id=$2",[WS_B,WS_A])),{code:'42501'});
  });

  await t.test('anon and signed-in users cannot read or write',async()=>{
   for(const fn of [owner,anon]){
    await assert.rejects(fn(c=>c.query('select * from public.app_drive_connection_clients')),{code:'42501'});
    await assert.rejects(fn(c=>c.query("insert into public.app_drive_connection_clients(workspace_id,oauth_client) values ($1,'full')",[WS_A])),{code:'42501'});
    await assert.rejects(fn(c=>c.query("update public.app_drive_connection_clients set oauth_client='full' where workspace_id=$1",[WS_A])),{code:'42501'});
    await assert.rejects(fn(c=>c.query('delete from public.app_drive_connection_clients where workspace_id=$1',[WS_A])),{code:'42501'});
   }
  });

  await t.test('deleting the connection deletes its client row',async()=>{
   await server(c=>c.query("update public.app_drive_connection_clients set oauth_client='full' where workspace_id=$1",[WS_A]));
   await server(c=>c.query('delete from public.app_drive_connections where workspace_id=$1',[WS_A]));
   assert.equal((await pool.query('select count(*)::int n from public.app_drive_connection_clients')).rows[0].n,0);
  });

  await t.test('rollback removes the record only; table stays; re-apply stops',async()=>{
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.notEqual((await pool.query("select to_regclass('public.app_drive_connection_clients') t")).rows[0].t,null);
   const c=await pool.connect();try{await assert.rejects(c.query(migration),/DRIVE_CONNECTION_CLIENTS_PREREQUISITE_CHANGED/);await c.query('rollback');}finally{c.release();}
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
