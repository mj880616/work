// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S52-36 NEWS-바깥소식번역 DB(20261108020000_outside_post_body_ko): 사회운동 영어 소식 [번역] 저장 칸 app_outside_posts.body_ko.
// - 승인형 workflow의 plan·dry-run·apply가 통과(확장 규칙)하고, dry-run은 아무것도 남기지 않는다.
// - 서버(service_role)만 채운다: 영어 글만, 1~100000자. 로그인 사용자(authenticated)는 자기 작업공간 줄만 읽고 쓸 수 없다. anon 없음.
// - 표 권한·정책·트리거 해시는 그대로, 되돌리기는 검사·칸·기록만 지운다.
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
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261108020000',name='outside_post_body_ko',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

const prerequisites=`
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;`;

test('outside post body_ko: plan, dry-run, apply, server-only write, owner-only read, rollback',{timeout:150000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'outside-body-ko-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query(await read('supabase/migrations/20261031230000_outside_statements.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL]=await Promise.all(['precheck','postcheck','snapshot','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  const check=async sql=>Object.fromEntries((await readOnly(sql)).map(r=>[r.item,r.value]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  let n=0;
  const post=async(lang,ws=WS_A)=>(await pool.query(`insert into public.app_outside_posts(workspace_id,source_key,kind,lang,title,url,has_body)
    values ($1,$2,$3,$4,$5,$6,false) returning id`,[ws,lang==='en'?'jacobin':'kctu',lang==='en'?'article':'statement',lang,lang==='en'?'Synthetic strike wave':'가상 성명','https://example.org/b/'+(++n)])).rows[0].id;
  const EN=await post('en'),KO=await post('ko'),EN_B=await post('en',WS_B);
  const before=(await pool.query(snapshot)).rows;let pre;

  await t.test('files: read-only checks, three-line summary, expanded workflow accepts apply and dry-run',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const p=prepareMigration({mode,version,runId:'1',root});assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');assert.deepEqual(p.targets,['app_outside_posts']);}
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   // 주석·글자 값(기록 설명 문장 등)은 빼고 SQL 문장만 본다.
   const code=migration.replace(/--.*$/gm,'').replace(/'[^']*'/g,"''");
   assert.doesNotMatch(code,/security definer|disable row level|\bgrant\b|\brevoke\b|create policy|create (or replace )?function|create trigger|rtw_|\bdelete\s+from\b|\bupdate\s+public\./i);
   pre=await check(precheck);
   for(const k of ['new migration absent','previous step applied','body_ko column and check absent','posts RLS on, no anon privilege, no authenticated write'])assert.equal(pre[k],'예',k);
   assert.equal(pre['posts rows'],'3');assert.equal(pre['foreign posts rows'],'2');
  });

  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await check(precheck),pre);assert.equal(await history(),0);
  });

  await t.test('apply passes postcheck; rows, grants, policies and triggers unchanged',async()=>{
   const result=await run('apply','9972');assert.equal(result.ok,true,result.summary);
   assert.equal(await history(),1);
   const post=await check(postcheck);
   for(const k of ['history row present','body_ko column nullable text with check','body_ko: authenticated read only, server can write','posts RLS on, no anon privilege, no authenticated write'])assert.equal(post[k],'예',k);
   for(const k of ['posts rows','foreign posts rows','posts grants policies triggers hash'])assert.equal(post[k],pre[k],k);
   assert.equal((await pool.query('select count(*)::int n from public.app_outside_posts where body_ko is not null')).rows[0].n,0,'existing rows start empty');
   assert.equal((await run('apply','9973')).ok,false,'second apply stops');
   await assert.rejects(pool.query(migration),/OUTSIDE_POST_BODY_KO_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  await t.test('server writes English posts only, 1..100000 chars',async()=>{
   const set=(id,v)=>as('service_role','',c=>c.query('update public.app_outside_posts set body_ko=$2 where id=$1',[id,v]));
   await set(EN,'가상 첫 줄.\n가상 둘째 줄.');
   assert.equal((await pool.query('select body_ko from public.app_outside_posts where id=$1',[EN])).rows[0].body_ko,'가상 첫 줄.\n가상 둘째 줄.');
   await assert.rejects(set(KO,'한국어 글에는 번역 없음'),{code:'23514'});
   await assert.rejects(set(EN_B,''),{code:'23514'});
   await assert.rejects(set(EN_B,'가'.repeat(100001)),{code:'23514'});
   await set(EN_B,'가'.repeat(100000));await set(EN_B,null);
  });

  await t.test('signed-in users read only their own rows and cannot write body_ko; anon has nothing',async()=>{
   const mine=await as('authenticated',OWNER,c=>c.query('select id,body_ko from public.app_outside_posts order by id'));
   assert.ok(mine.rows.every(r=>r.id!==EN_B),'other workspace row is invisible');
   assert.equal(mine.rows.find(r=>r.id===EN).body_ko,'가상 첫 줄.\n가상 둘째 줄.');
   const other=await as('authenticated',STRANGER,c=>c.query('select count(*)::int n from public.app_outside_posts where id=$1',[EN]));
   assert.equal(other.rows[0].n,0);
   await assert.rejects(as('authenticated',OWNER,c=>c.query("update public.app_outside_posts set body_ko='x' where id=$1",[EN])),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query('select body_ko from public.app_outside_posts')),{code:'42501'});
   assert.equal((await pool.query('select body_ko from public.app_outside_posts where id=$1',[EN])).rows[0].body_ko,'가상 첫 줄.\n가상 둘째 줄.');
  });

  await t.test('rollback removes the check, column and record; posts stay; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal((await pool.query('select count(*)::int n from public.app_outside_posts')).rows[0].n,3,'posts stay');
   const again=await run('apply','9974');assert.equal(again.ok,true,again.summary);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
