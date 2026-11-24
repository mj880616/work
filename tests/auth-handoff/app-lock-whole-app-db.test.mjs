// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic.
// S69-08 앱 전체 잠금(20261124080000_app_lock_whole_app): 앞 단계(feature_pin_lock·note_folder_lock)를 그대로 둔 채 잠글 수 있는 목록에 'app'을 더한다.
// 지키는 것: 'app'을 받고(정하기·저장·읽기) 모르는 이름은 지금처럼 거절, 기존 줄·PIN·틀린 횟수 그대로, 표 직접 접근 0(RLS·정책·권한 무변경),
// 도우미 실행권 없음, 고치지 않는 잠금 함수·경계 무변경, 되돌리기 뒤 'app'만 빠지고 카탈로그 원래대로.
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
import {fixture,OWNER,STRANGER} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261124080000',name='app_lock_whole_app',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const fakeCrypto=`
  create function extensions.gen_salt(p_type text, p_rounds integer) returns text language sql volatile as $$
    select '$2a$' || lpad(p_rounds::text, 2, '0') || '$' || substr(translate(encode(decode(md5(random()::text || clock_timestamp()::text), 'hex') || decode(md5(random()::text), 'hex'), 'base64'), '+/=', '.ab'), 1, 22) $$;
  create function extensions.crypt(p_password text, p_salt text) returns text language sql immutable as $$
    select substr(p_salt, 1, 29) || substr(md5(substr(p_salt, 1, 29) || p_password) || md5(p_password || substr(p_salt, 1, 29)), 1, 31) $$;`;
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  create function auth.jwt() returns jsonb language sql stable
    as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  revoke usage on schema private from service_role;`;

test('app lock whole app db: plan, dry-run, apply, accepts app, refuses unknown, closed table, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'app-lock-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query('create schema if not exists extensions');
  try{await pool.query('create extension if not exists pgcrypto with schema extensions');}catch{await pool.query(fakeCrypto);}
  await pool.query('grant usage on schema extensions to anon, authenticated, service_role');
  await pool.query("create table public.app_notes(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id), kind text not null default 'note', archived_at timestamptz, metadata jsonb not null default '{}'::jsonb)");
  // 앞 단계 표·함수는 저장소 migration 원문 그대로(운영에 적용된 대로).
  await pool.query(await read('supabase/migrations/20261028170000_note_folders.sql'));
  await pool.query(await read('supabase/migrations/20261119200000_feature_pin_lock.sql'));
  await pool.query(await read('supabase/migrations/20261119233000_note_folder_lock.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,sql,params=[]){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)",[sub||'',JSON.stringify({sub:sub||undefined})]);await c.query('set local role '+role);const r=await c.query(sql,params);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const call=(sub,fn,args=[],types=[])=>as('authenticated',sub,`select public.${fn}(${args.map((_,i)=>'$'+(i+1)+(types[i]?'::'+types[i]:'')).join(',')}) as r`,args).then(r=>r[0].r);
  const setup=(sub,pin,features,relock='5m')=>call(sub,'app_lock_setup',[pin,features,relock],['text','text[]','text']);
  const save=(sub,pin,features,relock='5m')=>call(sub,'app_lock_save',[pin,features,relock],['text','text[]','text']);
  const refuse=async(p,msg)=>{await assert.rejects(p,e=>{assert.equal(e.message,msg);return true;});};
  // 적용 전부터 PIN을 정해 둔 사람(기존 줄은 그대로 남아야 한다).
  await setup(STRANGER,'5678',['diary','photos'],'30m');
  // 적용 전에는 'app'을 모른다.
  await refuse(setup(OWNER,'1234',['app']),'LOCK_SETTINGS_INVALID');
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules, one private helper, no grants, summary 3 lines',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');
   assert.deepEqual([...plan.functions],['private.app_lock_clean_features']);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
  });
  await t.test('precheck yes, dry-run changes nothing, apply passes postcheck, second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9972');assert.equal(apply.ok,true,apply.summary);
   const post=await readOnly(postcheck);
   for(const r of post)if(/^(예|아니오)$/.test(r.ok))assert.equal(r.ok,'예',r.item);
   for(const item of ['existing boundary hash','lock rows'])
    assert.equal(post.find(r=>r.item===item).ok,beforeCheck.find(r=>r.item===item).value,item);
   assert.equal((await run('apply','9973')).ok,false);
  });
  await t.test('accepts app in setup, save and read; unknown names still refused; existing row untouched',async()=>{
   assert.deepEqual(await setup(OWNER,'1234',['diary','app','app']),{ok:true,features:['app','diary'],relock:'5m'});
   assert.deepEqual((await call(OWNER,'app_lock_read')).features,['app','diary']);
   await refuse(save(OWNER,'1234',['app','everything']),'LOCK_SETTINGS_INVALID');
   await refuse(save(OWNER,'1234',['app',null]),'LOCK_SETTINGS_INVALID');
   // 끄기·켜기는 지금처럼 PIN 확인 뒤(틀리면 바뀌지 않고 횟수만).
   assert.deepEqual(await save(OWNER,'0000',['diary']),{ok:false,left:4,blocked_until:null});
   assert.deepEqual((await call(OWNER,'app_lock_read')).features,['app','diary']);
   assert.deepEqual(await save(OWNER,'1234',['diary']),{ok:true,left:5,blocked_until:null,features:['diary'],relock:'5m'});
   assert.deepEqual((await save(OWNER,'1234',['app','calls','diary','photos','telegram'],'close')).features,['app','calls','diary','photos','telegram']);
   assert.deepEqual(await call(STRANGER,'app_lock_read'),{has_pin:true,features:['diary','photos'],relock:'30m',left:5,blocked_until:null});
   // 표 검사도 같은 5가지만 받는다(함수를 거치지 않는 길이 있어도).
   await assert.rejects(pool.query("update public.app_feature_locks set features=array['app','other'] where user_id=$1",[OWNER]),/app_feature_locks_features_check/);
  });
  await t.test('table still closed; helper not executable by any API role; no login refused',async()=>{
   for(const role of ['authenticated','anon'])await assert.rejects(as(role,OWNER,'select count(*) from public.app_feature_locks'),/permission denied/);
   const [{anon,auth,svc}]=(await pool.query(`select has_function_privilege('anon','private.app_lock_clean_features(text[])','execute') anon,has_function_privilege('authenticated','private.app_lock_clean_features(text[])','execute') auth,has_function_privilege('service_role','private.app_lock_clean_features(text[])','execute') svc`)).rows;
   assert.deepEqual([anon,auth,svc],[false,false,false]);
   await refuse(call('','app_lock_read'),'LOCK_AUTH_REQUIRED');
  });
  await t.test('existing structures untouched except the two changed objects',async()=>{
   const keep=rows=>rows.filter(r=>r.kind!=='history'&&!(r.kind==='constraint'&&r.name==='app_feature_locks_features_check')&&!(r.kind==='function'&&r.name.startsWith('private.app_lock_clean_features')));
   assert.deepEqual(keep((await pool.query(snapshot)).rows),keep(before));
  });
  await t.test('rollback removes only app from rows and restores the catalog snapshot',async()=>{
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(await call(OWNER,'app_lock_read'),{has_pin:true,features:['calls','diary','photos','telegram'],relock:'close',left:5,blocked_until:null});
   assert.equal((await call(OWNER,'app_lock_check',['1234'],['text'])).ok,true);
   await refuse(save(OWNER,'1234',['app']),'LOCK_SETTINGS_INVALID');
   for(const r of await readOnly(precheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
