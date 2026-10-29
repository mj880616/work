// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// TODO-내일만 DB(20261029210000_todo_mine_only): 예외 방 표 + [내 일 아님] 표(소유자만) + 서버 전용 읽기 함수 하나.
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
const version='20261029210000',name='todo_mine_only',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;

test('todo mine only db: plan, dry-run, apply, owner boundary, server filter function, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'todo-mine-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query('revoke usage on schema private from service_role');
  await pool.query(await read('supabase/migrations/20261021075034_todo_radar_candidates.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  const filter=(ws,room)=>server(c=>c.query('select public.app_todo_ask_filter($1,$2) f',[ws,room]).then(r=>r.rows[0].f));
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules, one definer function, grants as designed, summary 3 lines',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');
   assert.deepEqual([...plan.functions],['public.app_todo_ask_filter']);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0].replace(/\s+/g,' '));
   assert.deepEqual(grants,[
    'grant select, delete on table public.app_todo_ask_rooms to authenticated;',
    'grant insert (workspace_id, room_key) on table public.app_todo_ask_rooms to authenticated;',
    'grant select, delete on table public.app_todo_not_mine to authenticated;',
    'grant insert (workspace_id, source_kind, summary) on table public.app_todo_not_mine to authenticated;',
    'grant execute on function public.app_todo_ask_filter(uuid, text) to service_role;']);
   assert.doesNotMatch(code,/app_todo_candidates\s+(add|drop|alter)|alter table public\.app_(todo_candidates|feed)|create or replace|rtw_|\bto (anon|public)\b/i);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/delete from public|truncate|cascade|grant |app_todo_candidates/i);
  });
  await t.test('precheck yes, dry-run changes nothing, apply passes postcheck, second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9972');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9973')).ok,false);
  });
  await t.test('owner reads, adds and removes own rows only; no update; stranger and anon blocked',async()=>{
   await owner(c=>c.query("insert into public.app_todo_ask_rooms(workspace_id,room_key) values ($1,'room-fake-1'),($1,'-100200')",[WS_A]));
   await owner(c=>c.query("insert into public.app_todo_not_mine(workspace_id,source_kind,summary) values ($1,'telegram','가상 남의 일 하나'),($1,'meeting','가상 남의 일 둘')",[WS_A]));
   assert.equal((await owner(c=>c.query('select room_key from public.app_todo_ask_rooms order by room_key'))).rows.length,2);
   await assert.rejects(owner(c=>c.query("insert into public.app_todo_ask_rooms(workspace_id,room_key) values ($1,'x')",[WS_B])),/row-level security/);
   await assert.rejects(owner(c=>c.query("insert into public.app_todo_ask_rooms(workspace_id,room_key) values ($1,'bad key')",[WS_A])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("insert into public.app_todo_not_mine(workspace_id,source_kind,summary) values ($1,'mail','가상')",[WS_A])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("insert into public.app_todo_not_mine(workspace_id,source_kind,summary) values ($1,'note',$2)",[WS_A,'가'.repeat(101)])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("insert into public.app_todo_not_mine(id,workspace_id,source_kind,summary) values (gen_random_uuid(),$1,'note','가상')",[WS_A])),/permission denied/);
   await assert.rejects(owner(c=>c.query("update public.app_todo_ask_rooms set room_key='y'")),/permission denied/);
   await assert.rejects(owner(c=>c.query("update public.app_todo_not_mine set summary='y'")),/permission denied/);
   assert.deepEqual((await stranger(c=>c.query('select room_key from public.app_todo_ask_rooms'))).rows,[]);
   assert.deepEqual((await stranger(c=>c.query('select summary from public.app_todo_not_mine'))).rows,[]);
   assert.equal((await stranger(c=>c.query('delete from public.app_todo_ask_rooms'))).rowCount,0);
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_todo_ask_rooms')),/permission denied/);
   await assert.rejects(server(c=>c.query('select 1 from public.app_todo_not_mine')),/permission denied/);
   assert.equal((await owner(c=>c.query("delete from public.app_todo_ask_rooms where room_key='-100200'"))).rowCount,1);
  });
  await t.test('server filter: exception room flag and newest not-mine examples; args checked; other roles denied',async()=>{
   const f=await filter(WS_A,'room-fake-1');
   assert.equal(f.group_room,true);assert.deepEqual([...f.not_mine].sort(),['가상 남의 일 둘','가상 남의 일 하나']);
   assert.deepEqual(await filter(WS_A,'room-other'),{group_room:false,not_mine:f.not_mine});
   assert.deepEqual(await filter(WS_B,'room-fake-1'),{group_room:false,not_mine:[]});
   for(const room of ['bad key',null,'x'.repeat(101)])await assert.rejects(filter(WS_A,room),/TODO_MINE_ARGS/);
   for(let i=0;i<25;i++)await pool.query("insert into public.app_todo_not_mine(workspace_id,source_kind,summary,created_at) values ($1,'note',$2,now()+make_interval(secs=>$3))",[WS_A,'가상 예시 '+i,i+1]);
   const many=await filter(WS_A,'room-fake-1');assert.equal(many.not_mine.length,20);assert.equal(many.not_mine[0],'가상 예시 24');
   await assert.rejects(owner(c=>c.query("select public.app_todo_ask_filter($1,'room-fake-1')",[WS_A])),/permission denied/);
   await assert.rejects(as('anon','',c=>c.query("select public.app_todo_ask_filter($1,'room-fake-1')",[WS_A])),/permission denied/);
  });
  await t.test('rollback removes the new objects and record; candidates untouched; re-apply works',async()=>{
   const candidates=(await pool.query('select count(*)::int n from public.app_todo_candidates')).rows[0].n;
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await pool.query('select count(*)::int n from public.app_todo_candidates')).rows[0].n,candidates);
   await pool.query(migration);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
