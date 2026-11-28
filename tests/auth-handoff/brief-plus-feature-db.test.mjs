// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// BRIEF-품질올리기 ①(20261128130000_brief_plus_feature, docs/design/brief-room.md 6-2절):
// 운영자 기능 키 brief_plus + 통화(calls) 작업공간 하나에만 허용 행 1개.
// - 승인형 DB workflow 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예. 앞 단계(mcp_claude_write)가 없거나 calls가 하나가 아니면 멈춘다.
// - 허용 행은 calls 작업공간에만. 그 owner의 app_my_features에만 보이고, service role 함수 app_operator_feature_workspace('brief_plus')가 그 작업공간을 답한다.
// - 권한을 넓히지 않는다: 운영자 표는 API 역할이 못 읽고 못 쓴다(다른 owner가 자기 작업공간에 허용 행을 넣을 수 없음).
// - 되돌리기는 허용 행·검사·기록만 원래대로 하고 다른 허용 행은 그대로 둔다.
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
import {blogPrerequisites} from './blog-tables-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261128130000',name='brief_plus_feature',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

test('brief_plus feature key: guard, pair files, one allow row on the calls workspace, no new privileges, rollback restores',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'brief-plus-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(`create role supabase_read_only_user login bypassrls; grant pg_read_all_data to supabase_read_only_user;`);
  await pool.query(await read('supabase/migrations/20261020005000_share_pages_links.sql'));
  await pool.query(blogPrerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const one=async(fn,sql,args)=>(await fn(c=>c.query(sql,args))).rows[0];
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const allYes=async sql=>{for(const r of await readOnly(sql))assert.equal(r.ok,'예',r.item);};
  const feats=async()=>(await pool.query('select feature from public.app_operator_features order by feature,workspace_id')).rows.map(r=>r.feature);
  const guardFails=async pattern=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),pattern);await c.query('rollback');}finally{c.release();}};

  await t.test('guard: stops without changes before the Claude write step (20261128100000) is recorded',async()=>{
   await pool.query(await read('supabase/migrations/20261125113100_blog_tables.sql'));
   await pool.query(await read('supabase/migrations/20261126190000_photo_content_feature.sql'));
   await guardFails(/BRIEF_PLUS_PREREQUISITE_CHANGED/);
   // 앞 단계 mcp_claude_write는 여러 표·함수가 필요해 여기서는 그 단계가 남기는 운영자 표 모양만 같게 만든다(키 검사에 mcp_write, calls 작업공간 1행, 기록 1행).
   await pool.query(`alter table public.app_operator_features drop constraint app_operator_features_feature_check;
    alter table public.app_operator_features add constraint app_operator_features_feature_check
     check (feature in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap', 'arsenal', 'outside', 'ppwu_forms', 'nojo_words', 'blog', 'photo_content', 'mcp_write'));
    insert into public.app_operator_features(workspace_id,feature) select workspace_id,'mcp_write' from public.app_operator_features where feature='calls';`);
   await guardFails(/BRIEF_PLUS_PREREQUISITE_CHANGED/);
   await pool.query("insert into supabase_migrations.schema_migrations(version,name) values('20261128100000','mcp_claude_write')");
   assert.ok((await feats()).includes('mcp_write'));
   await assert.rejects(pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'brief_plus')",[WS_A]),{code:'23514'});
  });
  const before=(await pool.query(snapshot)).rows;
  const featsBefore=await feats();

  await t.test('files: rules pass, summary 3 lines, no grants/policies/functions, no fixed id or names, snapshot reads catalogs only',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const sql of [precheck,postcheck,snapshot,rollbackSQL,migration])assert.doesNotMatch(sql.replace(/--.*$/gm,''),/information_schema/i);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.flow,'full');
    assert.deepEqual([...plan.createdTables],[]);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bgrant\b|\brevoke\b|create (or replace )?(function|policy|trigger|table)|disable row level security|security definer|rtw_/i);
   assert.match(code,/select f\.workspace_id, 'brief_plus' from public\.app_operator_features f where f\.feature = 'calls'/,'allow row found inside SQL from the calls workspace');
   for(const text of [migration,precheck,postcheck,snapshot,rollbackSQL,summary]){
    assert.doesNotMatch(text,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id');
    assert.doesNotMatch(text,/공공운수|@/,'no union name or mail');
   }
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
  });

  await t.test('precheck as the read-only role; guard on a second calls workspace; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(await readOnly(precheck));
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.equal(v['brief_plus rows'],'0');
   await allYes(postcheck);
   {const c=await pool.connect();try{await c.query('begin');await c.query("insert into public.app_operator_features(workspace_id,feature) values($1,'calls')",[WS_B]);
     await assert.rejects(c.query(migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/BRIEF_PLUS_SEED_WORKSPACE_NOT_SINGLE/);}finally{await c.query('rollback');c.release();}}
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(await feats(),featsBefore);
   const apply=await run('apply','9982');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.deepEqual((await pool.query("select workspace_id::text w from public.app_operator_features where feature='brief_plus'")).rows,[{w:WS_A}]);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n,1);
   await assert.rejects(pool.query(migration),/BRIEF_PLUS_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  await t.test('only the operator owner sees the key; service role helper answers that workspace; no API role reads or writes the table',async()=>{
   assert.ok((await one(owner,'select public.app_my_features() f')).f.includes('brief_plus'));
   assert.ok(!(await one(stranger,'select public.app_my_features() f')).f.includes('brief_plus'));
   assert.equal((await one(server,"select public.app_operator_feature_workspace('brief_plus')::text w")).w,WS_A);
   await assert.rejects(stranger(c=>c.query("insert into public.app_operator_features(workspace_id,feature) values($1,'brief_plus')",[WS_B])),{code:'42501'});
   for(const fn of [owner,stranger,server,anon])await assert.rejects(fn(c=>c.query('select feature from public.app_operator_features')),{code:'42501'});
   await assert.rejects(anon(c=>c.query("select public.app_operator_feature_workspace('brief_plus')")),{code:'42501'});
  });

  await t.test('rollback removes only the brief_plus row, key and history; other allow rows stay',async()=>{
   await pool.query(rollbackSQL);
   await allYes(postcheck);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(await feats(),featsBefore);
   await assert.rejects(pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'brief_plus')",[WS_A]),{code:'23514'});
   await assert.rejects(pool.query(rollbackSQL),/BRIEF_PLUS_ROLLBACK_BLOCKED/);await pool.query('rollback');
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
