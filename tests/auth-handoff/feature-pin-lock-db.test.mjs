// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic.
// SEC-기능PIN잠금 ①(20261119200000_feature_pin_lock): 기능별 4자리 PIN 잠금의 서버 쪽.
// 지키는 것: 표 직접 접근 0(RLS 켬·정책 0·API 권한 0), 함수는 authenticated만·auth.uid() 필수, PIN 원문 저장 안 함(bcrypt 해시만·사람마다 소금),
// 남의 줄 못 읽음·못 바꿈, 틀린 횟수 서버가 셈(5번이면 막힘·막힌 동안 맞는 PIN도 거절·막힐 때마다 두 배), 끄기·바꾸기는 PIN 확인 뒤,
// 잊음 → 최근 로그인(JWT amr 10분 안)만 새로 정하기, 기존 owner 경계 무변경, 되돌리기 뒤 카탈로그 원래대로.
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
const USER_NONE='20000000-0000-4000-8000-000000000077';
const version='20261119200000',name='feature_pin_lock',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
// 운영과 같은 자리: extensions 스키마의 pgcrypto(crypt·gen_salt), auth.jwt()(요청 JWT claims).
// 이 PostgreSQL에 pgcrypto가 없으면 같은 서명의 시험용 대역(60자 '$2a$10$…', 소금마다 다른 값)을 쓴다 — 운영에는 진짜 pgcrypto가 있음을 precheck가 본다.
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

test('feature pin lock db: plan, dry-run, apply, closed table, hashed pin, server-side tries, recent-login renew, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'pin-lock-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query('create schema if not exists extensions');
  try{await pool.query('create extension if not exists pgcrypto with schema extensions');}catch{await pool.query(fakeCrypto);}
  await pool.query('grant usage on schema extensions to anon, authenticated, service_role');
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,sql,params=[],claims={}){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)",[sub||'',JSON.stringify({sub:sub||undefined,...claims})]);await c.query('set local role '+role);const r=await c.query(sql,params);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const call=(sub,fn,args=[],claims={})=>as('authenticated',sub,`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as r`,args,claims).then(r=>r[0].r);
  const refuse=async(p,msg)=>{await assert.rejects(p,e=>{assert.equal(e.message,msg);return true;});};
  const row=async sub=>(await pool.query('select * from public.app_feature_locks where user_id=$1',[sub])).rows[0];
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const publicFns=['app_lock_read()','app_lock_setup(text,text[],text)','app_lock_check(text)','app_lock_save(text,text[],text)','app_lock_pin_change(text,text)','app_lock_pin_renew(text)'];

  await t.test('files: expanded rules, 9 functions, 6 grants to authenticated only, summary 3 lines',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');
   assert.equal([...plan.functions].length,9);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0].replace(/\s+/g,' '));
   assert.equal(grants.length,6);
   for(const g of grants)assert.match(g,/^grant execute on function public\.app_lock_[a-z_]+\([a-z, \[\]]*\) to authenticated;$/);
  });
  await t.test('precheck yes, dry-run changes nothing, apply passes postcheck, second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9972');assert.equal(apply.ok,true,apply.summary);
   const post=await readOnly(postcheck);
   for(const r of post)if(r.item!=='existing owner boundary hash')assert.equal(r.ok,'예',r.item);
   assert.equal(post.find(r=>r.item==='existing owner boundary hash').ok,beforeCheck.find(r=>r.item==='existing owner boundary hash').value);
   assert.equal((await run('apply','9973')).ok,false);
  });
  await t.test('table closed to every API role; functions not executable by anon or service_role; no login refused',async()=>{
   for(const role of ['authenticated','anon']){
    await assert.rejects(as(role,OWNER,'select count(*) from public.app_feature_locks'),/permission denied/);
    await assert.rejects(as(role,OWNER,"insert into public.app_feature_locks(user_id,pin_hash) values ($1,'x')",[OWNER]),/permission denied/);
    await assert.rejects(as(role,OWNER,'delete from public.app_feature_locks where true'),/permission denied/);
   }
   for(const fn of publicFns){
    const [{anon,svc,auth}]=(await pool.query(`select has_function_privilege('anon','public.${fn}','execute') anon,has_function_privilege('service_role','public.${fn}','execute') svc,has_function_privilege('authenticated','public.${fn}','execute') auth`)).rows;
    assert.deepEqual([anon,svc,auth],[false,false,true],fn);
   }
   for(const fn of ['app_lock_pin_shape(text)','app_lock_clean_features(text[])','app_lock_try(uuid,text)'])
    assert.equal((await pool.query(`select has_function_privilege('authenticated','private.${fn}','execute') a`)).rows[0].a,false,fn);
   await assert.rejects(as('anon','','select public.app_lock_read()'),/permission denied/);
   await refuse(call('','app_lock_read'),'LOCK_AUTH_REQUIRED');
   await refuse(call('','app_lock_check',['1234']),'LOCK_AUTH_REQUIRED');
  });
  await t.test('setup: 4 digits only, known features only, once; PIN stored only as a salted 60-char hash',async()=>{
   assert.deepEqual(await call(OWNER,'app_lock_read'),{has_pin:false,features:[],relock:'5m',left:5,blocked_until:null});
   for(const bad of ['123','12345','12a4',' 1234','',null])await refuse(call(OWNER,'app_lock_setup',[bad,['diary'],'5m']),'LOCK_PIN_FORMAT');
   await refuse(call(OWNER,'app_lock_setup',['1234',['diary','family'],'5m']),'LOCK_SETTINGS_INVALID');
   await refuse(call(OWNER,'app_lock_setup',['1234',['diary'],'1h']),'LOCK_SETTINGS_INVALID');
   assert.deepEqual(await call(OWNER,'app_lock_setup',['1234',['photos','diary','diary'],'5m']),{ok:true,features:['diary','photos'],relock:'5m'});
   await refuse(call(OWNER,'app_lock_setup',['9999',['diary'],'now']),'LOCK_PIN_EXISTS');
   assert.deepEqual(await call(STRANGER,'app_lock_setup',['1234',[],'30m']),{ok:true,features:[],relock:'30m'});
   const a=await row(OWNER),b=await row(STRANGER);
   assert.equal(a.pin_hash.length,60);assert.match(a.pin_hash,/^\$2a\$10\$/);
   assert.notEqual(a.pin_hash,b.pin_hash,'same PIN, different salt');
   // 원문 PIN은 표 어디에도 없다.
   const all=JSON.stringify((await pool.query('select * from public.app_feature_locks')).rows);
   assert.doesNotMatch(all,/"1234"|:"1234|1234"/);
   const read=await call(OWNER,'app_lock_read');
   assert.deepEqual(read,{has_pin:true,features:['diary','photos'],relock:'5m',left:5,blocked_until:null});
   assert.doesNotMatch(JSON.stringify(read),/\$2a\$|pin_hash|user_id/);
   // 남의 설정은 보이지 않는다(각자 자기 줄만).
   assert.deepEqual((await call(STRANGER,'app_lock_read')).features,[]);
  });
  await t.test('check: right PIN ok, wrong PIN counted on the server, 5 wrong blocks, blocked refuses even the right PIN, block doubles',async()=>{
   assert.deepEqual(await call(OWNER,'app_lock_check',['1234']),{ok:true,left:5,blocked_until:null});
   assert.deepEqual(await call(OWNER,'app_lock_check',['0000']),{ok:false,left:4,blocked_until:null});
   // 맞히면 0으로.
   assert.equal((await call(OWNER,'app_lock_check',['1234'])).ok,true);
   assert.equal((await row(OWNER)).fail_count,0);
   for(const left of [4,3,2,1])assert.deepEqual(await call(OWNER,'app_lock_check',['0000']),{ok:false,left,blocked_until:null});
   const blocked=await call(OWNER,'app_lock_check',['0000']);
   assert.equal(blocked.ok,false);assert.equal(blocked.left,0);
   const mins=(new Date(blocked.blocked_until)-Date.now())/60000;assert.ok(mins>14&&mins<=15.1,String(mins));
   assert.deepEqual(await call(OWNER,'app_lock_check',['1234']),{ok:false,left:0,blocked_until:blocked.blocked_until});
   assert.equal((await call(OWNER,'app_lock_read')).left,0);
   // 남의 막힘은 나와 상관없다.
   assert.equal((await call(STRANGER,'app_lock_check',['1234'])).ok,true);
   // 막힘이 끝난 뒤 또 5번이면 두 배(30분).
   await pool.query("update public.app_feature_locks set blocked_until=now()-interval '1 second' where user_id=$1",[OWNER]);
   assert.equal((await call(OWNER,'app_lock_read')).left,5);
   for(let i=0;i<4;i++)await call(OWNER,'app_lock_check',['0000']);
   const second=await call(OWNER,'app_lock_check',['0000']);
   const mins2=(new Date(second.blocked_until)-Date.now())/60000;assert.ok(mins2>29&&mins2<=30.1,String(mins2));
   await pool.query("update public.app_feature_locks set blocked_until=now()-interval '1 second' where user_id=$1",[OWNER]);
   assert.equal((await call(OWNER,'app_lock_check',['1234'])).ok,true);
   const r=await row(OWNER);assert.deepEqual([r.fail_count,r.block_level,r.blocked_until],[0,0,null]);
  });
  await t.test('save (turn on/off, relock) and pin change need the current PIN; wrong PIN changes nothing and is counted',async()=>{
   const wrong=await call(OWNER,'app_lock_save',['0000',[],'now']);
   assert.deepEqual(wrong,{ok:false,left:4,blocked_until:null});
   assert.deepEqual((await call(OWNER,'app_lock_read')).features,['diary','photos']);
   assert.deepEqual(await call(OWNER,'app_lock_save',['1234',['telegram','calls'],'close']),{ok:true,left:5,blocked_until:null,features:['calls','telegram'],relock:'close'});
   await refuse(call(OWNER,'app_lock_save',['1234',['notes'],'5m']),'LOCK_SETTINGS_INVALID');
   const oldHash=(await row(OWNER)).pin_hash;
   assert.equal((await call(OWNER,'app_lock_pin_change',['0000','5678'])).ok,false);
   assert.equal((await row(OWNER)).pin_hash,oldHash);
   await refuse(call(OWNER,'app_lock_pin_change',['1234','56']),'LOCK_PIN_FORMAT');
   assert.equal((await call(OWNER,'app_lock_pin_change',['1234','5678'])).ok,true);
   assert.notEqual((await row(OWNER)).pin_hash,oldHash);
   assert.equal((await call(OWNER,'app_lock_check',['1234'])).ok,false);
   assert.equal((await call(OWNER,'app_lock_check',['5678'])).ok,true);
   // 끄기(빈 목록)는 PIN 확인 뒤. PIN 줄은 남는다.
   assert.deepEqual((await call(OWNER,'app_lock_save',['5678',[],'5m'])).features,[]);
   assert.equal((await call(OWNER,'app_lock_read')).has_pin,true);
   await refuse(call(USER_NONE,'app_lock_check',['1234']),'LOCK_PIN_MISSING');
   await refuse(call(USER_NONE,'app_lock_save',['1234',[],'5m']),'LOCK_PIN_MISSING');
  });
  await t.test('forgot PIN: renew only with a sign-in in the last 10 minutes; clears tries and block; keeps settings',async()=>{
   await call(OWNER,'app_lock_save',['5678',['diary'],'30m']);
   for(let i=0;i<5;i++)await call(OWNER,'app_lock_check',['0000']);
   const now=Math.floor(Date.now()/1000);
   await refuse(call(OWNER,'app_lock_pin_renew',['4321']),'LOCK_RECENT_LOGIN_REQUIRED');
   await refuse(call(OWNER,'app_lock_pin_renew',['4321'],{amr:[{method:'oauth',timestamp:now-3600}]}),'LOCK_RECENT_LOGIN_REQUIRED');
   await refuse(call(OWNER,'app_lock_pin_renew',['4321'],{amr:'oauth'}),'LOCK_RECENT_LOGIN_REQUIRED');
   await refuse(call(OWNER,'app_lock_pin_renew',['4321'],{amr:[{method:'oauth',timestamp:String(now)+'x'}]}),'LOCK_RECENT_LOGIN_REQUIRED');
   await refuse(call(OWNER,'app_lock_pin_renew',['43'],{amr:[{method:'oauth',timestamp:now}]}),'LOCK_PIN_FORMAT');
   await refuse(call(USER_NONE,'app_lock_pin_renew',['4321'],{amr:[{method:'oauth',timestamp:now}]}),'LOCK_PIN_MISSING');
   assert.deepEqual(await call(OWNER,'app_lock_pin_renew',['4321'],{amr:[{method:'oauth',timestamp:now-120}]}),{ok:true,left:5,blocked_until:null});
   const r=await row(OWNER);assert.deepEqual([r.fail_count,r.block_level,r.blocked_until,r.features,r.relock],[0,0,null,['diary'],'30m']);
   assert.equal((await call(OWNER,'app_lock_check',['4321'])).ok,true);
   // 남의 줄은 바뀌지 않았다.
   assert.equal((await call(STRANGER,'app_lock_check',['1234'])).ok,true);
  });
  await t.test('existing owner boundary untouched',async()=>{
   const now=(await pool.query(snapshot)).rows.filter(r=>!['lock table','lock function','history'].includes(r.kind));
   assert.deepEqual(now,before.filter(r=>!['lock table','lock function','history'].includes(r.kind)));
  });
  await t.test('rollback restores the catalog snapshot',async()=>{
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(precheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
