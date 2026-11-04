// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic (no real folder or album names).
// S49-50 FOLDER-순서·색 ③-2 DB: app_folder_prefs(새 표, owner 읽기만) + app_photo_tags.color/sort_order + 서버 함수 2개(owner만, 표 쓰기 권한은 열지 않음).
// - 승인형 workflow의 plan·dry-run·apply가 통과(확장 규칙)하고, dry-run은 아무것도 남기지 않는다.
// - owner만 쓴다: 남의 작업공간·로그인 안 함·anon 거절, 1~8 밖·모르는 출처·잘못된 줄은 거절, 없는 키 = 줄 만듦, c/o는 보낸 것만 바뀜.
// - 읽기는 owner 정책으로만, 표에 직접 쓰기는 거절, 앨범의 이름·대표 사진 쓰기 길은 그대로, 되돌리기는 표·함수·칸·기록만 지운다.
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
const version='20261104223000',name='folder_look_prefs',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create table public.app_diary_stars(id uuid primary key);
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const T1='42000000-0000-4000-8000-000000000001',T2='42000000-0000-4000-8000-000000000002',T_OTHER='42000000-0000-4000-8000-000000000003';

test('folder look prefs db: plan, dry-run, apply, owner-only functions, no direct writes, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'folder-prefs-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query(await read('supabase/migrations/20261029150000_photo_tags.sql'));
  await pool.query(`insert into public.app_photo_tags(id,workspace_id,name) values ('${T1}','${WS_A}','가앨범'),('${T2}','${WS_A}','나앨범'),('${T_OTHER}','${WS_B}','남앨범')`);
  const [precheck,postcheck,snapshot,rollbackSQL]=await Promise.all(['precheck','postcheck','snapshot','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const prefs=(sub,ws,source,items,role='authenticated')=>as(role,sub,c=>c.query('select public.app_folder_prefs_apply($1::uuid,$2::text,$3::jsonb) r',[ws,source,JSON.stringify(items)]));
  const looks=(sub,ws,items,role='authenticated')=>as(role,sub,c=>c.query('select public.app_photo_tag_look_apply($1::uuid,$2::jsonb) r',[ws,JSON.stringify(items)]));
  const rows=async()=>(await pool.query('select workspace_id,source,folder_key,color,sort_order from public.app_folder_prefs order by workspace_id,source,folder_key')).rows;
  const tag=async id=>(await pool.query('select name,cover_key,color,sort_order from public.app_photo_tags where id=$1',[id])).rows[0];
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('plan accepts the migration (expanded rules) and precheck is all yes',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});assert.ok(plan&&!plan.rejected,JSON.stringify(plan).slice(0,300));
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
  await t.test('dry-run leaves schema and history unchanged',async()=>{
   const dry=await run('dry-run','9991');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal((await pool.query("select to_regclass('public.app_folder_prefs') is null v")).rows[0].v,true);
  });
  await t.test('apply passes postcheck; second apply refused; albums start with no color and order 0',async()=>{
   const apply=await run('apply','9992');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   assert.equal((await run('apply','9993')).ok,false);
   assert.deepEqual(await tag(T1),{name:'가앨범',cover_key:null,color:null,sort_order:0});
  });
  await t.test('the owner sets color and order of cloud folders; only the sent parts change; clearing works',async()=>{
   assert.deepEqual((await prefs(OWNER,WS_A,'od',[{k:'fold-a',c:3,o:1024},{k:'fold-b',o:2048}])).rows[0].r,{ok:true,count:2});
   assert.deepEqual((await rows()).map(r=>[r.folder_key,r.color,r.sort_order]),[['fold-a',3,1024],['fold-b',null,2048]]);
   await prefs(OWNER,WS_A,'od',[{k:'fold-a',c:5}]);
   assert.deepEqual((await rows()).map(r=>[r.folder_key,r.color,r.sort_order]),[['fold-a',5,1024],['fold-b',null,2048]],'order kept when only color is sent');
   await prefs(OWNER,WS_A,'od',[{k:'fold-a',c:null},{k:'fold-b',o:null}]);
   assert.deepEqual((await rows()).map(r=>[r.folder_key,r.color,r.sort_order]),[['fold-a',null,1024],['fold-b',null,null]]);
   await prefs(OWNER,WS_A,'gd',[{k:'fold-a',c:8}]);
   assert.equal((await rows()).length,3,'same key under another source is another row');
  });
  await t.test('others cannot: another workspace owner, anon, not signed in',async()=>{
   await assert.rejects(prefs(STRANGER,WS_A,'od',[{k:'x',c:2}]),{code:'42501',message:/FOLDER_PREFS_FORBIDDEN/});
   await assert.rejects(prefs(OWNER,WS_B,'od',[{k:'x',c:2}]),{code:'42501',message:/FOLDER_PREFS_FORBIDDEN/});
   await assert.rejects(prefs('',WS_A,'od',[{k:'x',c:2}]),{code:'42501'});
   await assert.rejects(prefs(OWNER,WS_A,'od',[{k:'x',c:2}],'anon'),{code:'42501'});
   assert.equal((await rows()).some(r=>r.folder_key==='x'),false);
  });
  await t.test('bad input is refused: color out of range or not a number, unknown source, bad items, too many',async()=>{
   for(const c of [0,9,-1,'3',1.5,true])await assert.rejects(prefs(OWNER,WS_A,'od',[{k:'x',c}]),{code:'22023',message:/FOLDER_PREFS_ARGS/},JSON.stringify(c));
   for(const o of ['1',1.5,12345678901,true])await assert.rejects(prefs(OWNER,WS_A,'od',[{k:'x',o}]),{code:'22023'},JSON.stringify(o));
   await assert.rejects(prefs(OWNER,WS_A,'zz',[{k:'x',c:1}]),{code:'22023'});
   await assert.rejects(prefs(OWNER,WS_A,'od',[]),{code:'22023'});
   await assert.rejects(prefs(OWNER,WS_A,'od',[{c:1}]),{code:'22023'});
   await assert.rejects(prefs(OWNER,WS_A,'od',[{k:''}]),{code:'22023'});
   await assert.rejects(prefs(OWNER,WS_A,'od',Array.from({length:201},(_,i)=>({k:'k'+i,c:1}))),{code:'22023'});
   await assert.rejects(pool.query("insert into public.app_folder_prefs(workspace_id,source,folder_key,color) values ($1,'od','y',9)",[WS_A]),{code:'23514'});
   assert.equal((await rows()).some(r=>r.folder_key==='x'||r.folder_key==='y'),false,'a refused call keeps nothing');
  });
  await t.test('reads go through the owner policy only; direct writes are refused',async()=>{
   assert.equal((await as('authenticated',OWNER,c=>c.query('select count(*)::int n from public.app_folder_prefs'))).rows[0].n,3);
   await prefs(OWNER,WS_A,'od',[{k:'a'}]);
   assert.equal((await as('authenticated',STRANGER,c=>c.query('select count(*)::int n from public.app_folder_prefs'))).rows[0].n,0);
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_folder_prefs')),{code:'42501'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_folder_prefs(workspace_id,source,folder_key) values ($1,'od','z')",[WS_A])),{code:'42501'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query("update public.app_folder_prefs set color=2")),{code:'42501'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query("delete from public.app_folder_prefs")),{code:'42501'});
  });
  await t.test('albums: the owner sets color and order; name and cover stay; other workspace albums and bad input are refused',async()=>{
   assert.deepEqual((await looks(OWNER,WS_A,[{id:T1,c:4,o:2048},{id:T2,o:1024}])).rows[0].r,{ok:true,count:2});
   assert.deepEqual(await tag(T1),{name:'가앨범',cover_key:null,color:4,sort_order:2048});
   assert.deepEqual(await tag(T2),{name:'나앨범',cover_key:null,color:null,sort_order:1024});
   await looks(OWNER,WS_A,[{id:T1,c:null}]);assert.equal((await tag(T1)).color,null);assert.equal((await tag(T1)).sort_order,2048);
   assert.deepEqual((await looks(OWNER,WS_A,[{id:T_OTHER,c:2}])).rows[0].r,{ok:true,count:0},'another workspace album is not touched');
   assert.equal((await tag(T_OTHER)).color,null);
   await assert.rejects(looks(STRANGER,WS_A,[{id:T1,c:2}]),{code:'42501',message:/PHOTO_TAG_LOOK_FORBIDDEN/});
   await assert.rejects(looks('',WS_A,[{id:T1,c:2}]),{code:'42501'});
   await assert.rejects(looks(OWNER,WS_A,[{id:T1,c:2}],'anon'),{code:'42501'});
   for(const c of [0,9,'3'])await assert.rejects(looks(OWNER,WS_A,[{id:T1,c}]),{code:'22023',message:/PHOTO_TAG_LOOK_ARGS/});
   await assert.rejects(looks(OWNER,WS_A,[{id:'not-a-uuid',c:1}]),{code:'22023'});
   await assert.rejects(looks(OWNER,WS_A,[{id:T1,o:null}]),{code:'22023'});
   await assert.rejects(pool.query('update public.app_photo_tags set color=9 where id=$1',[T1]),{code:'23514'});
  });
  await t.test('album table grants are unchanged: no direct color or order write, name and cover paths still work',async()=>{
   await assert.rejects(as('authenticated',OWNER,c=>c.query('update public.app_photo_tags set color=2 where id=$1',[T1])),{code:'42501'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query('update public.app_photo_tags set sort_order=5 where id=$1',[T1])),{code:'42501'});
   await as('authenticated',OWNER,c=>c.query("update public.app_photo_tags set name='가앨범2',cover_key='K1',updated_at=now() where id=$1",[T1]));
   assert.deepEqual(await tag(T1),{name:'가앨범2',cover_key:'K1',color:null,sort_order:2048});
  });
  await t.test('rollback removes functions, table, check, columns and the record; albums stay; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.deepEqual({...(await pool.query("select to_regclass('public.app_folder_prefs') is null a, to_regprocedure('public.app_folder_prefs_apply(uuid,text,jsonb)') is null b, to_regprocedure('public.app_photo_tag_look_apply(uuid,jsonb)') is null c")).rows[0]},{a:true,b:true,c:true});
   assert.equal((await pool.query("select count(*)::int n from pg_attribute where attrelid='public.app_photo_tags'::regclass and attname in ('color','sort_order') and not attisdropped")).rows[0].n,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_photo_tags')).rows[0].n,3,'albums stay');
   const again=await run('apply','9994');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
