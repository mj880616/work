// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic.
// SEC-기능PIN잠금 노트 폴더 잠금(20261119233000_note_folder_lock): 앞 단계(feature_pin_lock)를 그대로 둔 채 더한 표·함수.
// 지키는 것: 표 직접 접근 0(RLS 켬·정책 0·API 권한 0), 함수는 authenticated만·auth.uid() 필수, 같은 PIN·같은 틀린 횟수(5번이면 막힘),
// 남의 작업공간 폴더·없는 폴더는 같은 오류로 거절(횟수도 쓰지 않음), 50개 상한, 폴더를 지우면 잠금 줄도 사라짐,
// 앞 단계 잠금 함수·노트 폴더 표 권한 무변경, 되돌리기 뒤 카탈로그 원래대로.
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
const version='20261119233000',name='note_folder_lock',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const F1='32000000-0000-4000-8000-000000000001',F2='32000000-0000-4000-8000-000000000002',F_CHILD='32000000-0000-4000-8000-000000000003',F_OTHER='32000000-0000-4000-8000-000000000009',F_NONE='32000000-0000-4000-8000-0000000000ff';
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

test('note folder lock db: plan, dry-run, apply, closed table, same PIN and tries, owner-only folders, limit, cascade, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'note-folder-lock-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  await pool.query(`insert into public.app_note_folders(id,workspace_id,parent_id,name,sort_order) values ('${F1}','${WS_A}',null,'갑 폴더',1024),('${F2}','${WS_A}',null,'을 폴더',2048),('${F_CHILD}','${WS_A}','${F1}','갑 안 폴더',1024),('${F_OTHER}','${WS_B}',null,'남의 폴더',1024)`);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,sql,params=[]){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)",[sub||'',JSON.stringify({sub:sub||undefined})]);await c.query('set local role '+role);const r=await c.query(sql,params);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const call=(sub,fn,args=[],types=[])=>as('authenticated',sub,`select public.${fn}(${args.map((_,i)=>'$'+(i+1)+(types[i]?'::'+types[i]:'')).join(',')}) as r`,args).then(r=>r[0].r);
  const set=(sub,pin,folder,locked)=>call(sub,'app_lock_note_folder_set',[pin,folder,locked],['text','uuid','boolean']);
  const refuse=async(p,msg)=>{await assert.rejects(p,e=>{assert.equal(e.message,msg);return true;});};
  const failCount=async sub=>(await pool.query('select fail_count from public.app_feature_locks where user_id=$1',[sub])).rows[0]?.fail_count;
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules, 2 functions, 2 grants to authenticated only, summary 3 lines',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');
   assert.equal([...plan.functions].length,2);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0].replace(/\s+/g,' '));
   assert.equal(grants.length,2);
   for(const g of grants)assert.match(g,/^grant execute on function public\.app_lock_note_folder[a-z_]*\([a-z, ]*\) to authenticated;$/);
  });
  await t.test('precheck yes, dry-run changes nothing, apply passes postcheck, second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const dry=await run('dry-run','9961');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9962');assert.equal(apply.ok,true,apply.summary);
   const post=await readOnly(postcheck);
   for(const r of post)if(/^(예|아니오)$/.test(r.ok))assert.equal(r.ok,'예',r.item);
   for(const item of ['existing boundary hash','note folders rows'])
    assert.equal(post.find(r=>r.item===item).ok,beforeCheck.find(r=>r.item===item).value,item);
   assert.equal((await run('apply','9963')).ok,false);
  });
  await t.test('table closed to every API role; functions not executable by anon or service_role; no login refused',async()=>{
   for(const role of ['authenticated','anon']){
    await assert.rejects(as(role,OWNER,'select count(*) from public.app_note_folder_locks'),/permission denied/);
    await assert.rejects(as(role,OWNER,'insert into public.app_note_folder_locks(user_id,folder_id) values ($1,$2)',[OWNER,F1]),/permission denied/);
    await assert.rejects(as(role,OWNER,'delete from public.app_note_folder_locks where true'),/permission denied/);
   }
   for(const fn of ['app_lock_note_folders()','app_lock_note_folder_set(text,uuid,boolean)']){
    const [{anon,svc,auth}]=(await pool.query(`select has_function_privilege('anon','public.${fn}','execute') anon,has_function_privilege('service_role','public.${fn}','execute') svc,has_function_privilege('authenticated','public.${fn}','execute') auth`)).rows;
    assert.deepEqual([anon,svc,auth],[false,false,true],fn);
   }
   await assert.rejects(as('anon','','select public.app_lock_note_folders()'),/permission denied/);
   await refuse(call('','app_lock_note_folders'),'LOCK_AUTH_REQUIRED');
   await refuse(set('','1234',F1,true),'LOCK_AUTH_REQUIRED');
  });
  await t.test('needs a PIN; locks and unlocks only with the right PIN; wrong PIN counted in the same tries',async()=>{
   assert.deepEqual(await call(OWNER,'app_lock_note_folders'),{folders:[]});
   await refuse(set(OWNER,'1234',F1,true),'LOCK_PIN_MISSING');
   await call(OWNER,'app_lock_setup',['1234',[],'5m'],['text','text[]','text']);
   for(const bad of ['123','12a4','',null])await refuse(set(OWNER,bad,F1,true),'LOCK_PIN_FORMAT');
   await refuse(set(OWNER,'1234',null,true),'LOCK_SETTINGS_INVALID');
   await refuse(set(OWNER,'1234',F1,null),'LOCK_SETTINGS_INVALID');
   assert.deepEqual(await set(OWNER,'0000',F1,true),{ok:false,left:4,blocked_until:null});
   assert.deepEqual(await call(OWNER,'app_lock_note_folders'),{folders:[]});
   // 같은 횟수: 기능 잠금 대조(app_lock_check)와 함께 센다.
   assert.equal(await failCount(OWNER),1);
   assert.deepEqual(await call(OWNER,'app_lock_check',['0000'],['text']),{ok:false,left:3,blocked_until:null});
   assert.deepEqual(await set(OWNER,'1234',F1,true),{ok:true,left:5,blocked_until:null,folders:[F1]});
   assert.equal(await failCount(OWNER),0);
   assert.deepEqual((await set(OWNER,'1234',F2,true)).folders,[F1,F2].sort());
   // 두 번 잠가도 한 줄.
   assert.deepEqual((await set(OWNER,'1234',F2,true)).folders,[F1,F2].sort());
   assert.deepEqual((await set(OWNER,'1234',F2,false)).folders,[F1]);
   assert.deepEqual(await call(OWNER,'app_lock_note_folders'),{folders:[F1]});
   // 앞 단계 설정(잠근 기능)은 그대로.
   assert.deepEqual((await call(OWNER,'app_lock_read')).features,[]);
  });
  await t.test('other workspace folder and missing folder: same refusal, tries untouched; others see nothing of mine',async()=>{
   await refuse(set(OWNER,'1234',F_OTHER,true),'LOCK_FOLDER_FORBIDDEN');
   await refuse(set(OWNER,'0000',F_OTHER,true),'LOCK_FOLDER_FORBIDDEN');
   await refuse(set(OWNER,'1234',F_NONE,true),'LOCK_FOLDER_FORBIDDEN');
   assert.equal(await failCount(OWNER),0);
   await call(STRANGER,'app_lock_setup',['5678',[],'5m'],['text','text[]','text']);
   await refuse(set(STRANGER,'5678',F1,true),'LOCK_FOLDER_FORBIDDEN');
   await refuse(set(STRANGER,'5678',F1,false),'LOCK_FOLDER_FORBIDDEN');
   assert.deepEqual(await call(STRANGER,'app_lock_note_folders'),{folders:[]});
   assert.deepEqual((await set(STRANGER,'5678',F_OTHER,true)).folders,[F_OTHER]);
   assert.deepEqual(await call(OWNER,'app_lock_note_folders'),{folders:[F1]});
   // 남의 작업공간 폴더 줄이 (어떤 길로든) 남아 있어도 읽기에 나오지 않는다(owner 판정).
   await pool.query('insert into public.app_note_folder_locks(user_id,folder_id) values ($1,$2)',[OWNER,F_OTHER]);
   assert.deepEqual(await call(OWNER,'app_lock_note_folders'),{folders:[F1]});
   await pool.query('delete from public.app_note_folder_locks where user_id=$1 and folder_id=$2',[OWNER,F_OTHER]);
  });
  await t.test('blocked after 5 wrong tries: folder lock refused even with the right PIN',async()=>{
   for(const left of [4,3,2,1])assert.deepEqual(await set(OWNER,'0000',F2,true),{ok:false,left,blocked_until:null});
   const blocked=await set(OWNER,'0000',F2,true);
   assert.equal(blocked.ok,false);assert.equal(blocked.left,0);assert.ok(blocked.blocked_until);
   assert.deepEqual(await set(OWNER,'1234',F1,false),{ok:false,left:0,blocked_until:blocked.blocked_until});
   assert.deepEqual(await call(OWNER,'app_lock_note_folders'),{folders:[F1]});
   await pool.query("update public.app_feature_locks set blocked_until=now()-interval '1 second' where user_id=$1",[OWNER]);
  });
  await t.test('at most 50 folders; deleting a folder removes its lock row',async()=>{
   const ids=[];for(let i=0;i<50;i++)ids.push(`33000000-0000-4000-8000-${String(i).padStart(12,'0')}`);
   await pool.query(`insert into public.app_note_folders(id,workspace_id,name,sort_order) select x::uuid,'${WS_A}','많은 '||n,n from unnest($1::text[]) with ordinality as t(x,n)`,[ids]);
   for(const id of ids.slice(0,49))assert.equal((await set(OWNER,'1234',id,true)).ok,true);
   assert.equal((await call(OWNER,'app_lock_note_folders')).folders.length,50);
   await refuse(set(OWNER,'1234',ids[49],true),'LOCK_FOLDER_LIMIT');
   // 이미 잠근 폴더를 다시 잠그는 것은 상한에 걸리지 않는다.
   assert.equal((await set(OWNER,'1234',F1,true)).ok,true);
   await pool.query('delete from public.app_note_folders where id=any($1::uuid[])',[ids]);
   assert.deepEqual(await call(OWNER,'app_lock_note_folders'),{folders:[F1]});
   await pool.query('delete from public.app_note_folders where id=$1',[F2]);
   assert.equal((await pool.query('select count(*)::int n from public.app_note_folder_locks where folder_id=$1',[F2])).rows[0].n,0);
  });
  await t.test('existing structures untouched',async()=>{
   const now=(await pool.query(snapshot)).rows.filter(r=>!['folder lock table','folder lock function','history'].includes(r.kind));
   assert.deepEqual(now,before.filter(r=>!['folder lock table','folder lock function','history'].includes(r.kind)));
  });
  await t.test('rollback restores the catalog snapshot and keeps PIN rows',async()=>{
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal((await call(OWNER,'app_lock_check',['1234'],['text'])).ok,true);
   for(const r of await readOnly(precheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
