// Fresh local PostgreSQL only. No Supabase, Edge or production credentials. All data synthetic.
// S69-86 BRIEF-밑줄노트 ①(20261125010000_news_highlights_brief): 밑줄 표 종류 검사에 'brief'(브리핑 룸 자료)를 더한다.
// - 승인형 DB workflow 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예. 앞 단계(20261122100000 reading)가 없으면 멈춘다.
// - 권한을 넓히지 않는다: 브리핑 밑줄도 자기 작업공간 주인만 넣고 읽고 지운다. 다른 작업공간 주인·익명·service_role은 못 본다.
// - 파생 저장은 독립: 브리핑을 지워도(app_document_brief_delete와 같은 행 삭제)·자료를 지워도 밑줄 행은 남는다(외래 키 없음).
// - 되돌리기는 검사·기록을 원래대로 하고 브리핑 밑줄 행만 지운다(다른 밑줄은 그대로).
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
import {askSchema,askChain} from './ask-web2-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261125010000',name='news_highlights_brief',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;`;
const SRC='31000000-0000-4000-8000-000000000001',NOTE='32000000-0000-4000-8000-000000000002';
const BEFORE=['20261029061500_ask_web2.sql','20261108070000_news_highlights.sql','20261115194000_news_highlights_note.sql'];

test('news highlights brief type: owner-only like before, no new privileges, kept after brief/document delete, guarded rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'news-hl-brief-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false,max:8}));
  await pool.query(fixture);await pool.query(prerequisites);await pool.query(askSchema);
  for(const file of [...askChain,...BEFORE])await pool.query(await read('supabase/migrations/'+file));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,user,fn){const c=await pool.connect();try{await c.query('begin');await c.query('set local role '+role);if(user)await c.query(`select set_config('request.jwt.claim.sub',$1,true)`,[user]);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const allYes=async sql=>{for(const r of await readOnly(sql))assert.equal(r.ok,'예',r.item);};
  const add=(user,ws,type,id=SRC)=>as('authenticated',user,c=>c.query(
   `insert into public.app_news_highlights(workspace_id,source_type,source_id,quote,quote_prefix,quote_suffix,memo,source_title,source_media,source_date,source_url)
    values($1,$2,$3,'고른 문장','앞','뒤',null,'제목',null,'2026-11-15T00:00:00Z',null) returning id`,[ws,type,id]).then(r=>r.rows[0].id));
  const guardFails=async pattern=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),pattern);await c.query('rollback');}finally{c.release();}};

  await t.test('guard: stops without changes before the reading step (20261122100000)',async()=>{
   await guardFails(/NEWS_HIGHLIGHTS_BRIEF_PREREQUISITE_CHANGED/);
   await pool.query(await read('supabase/migrations/20261122100000_reading_items.sql'));
  });
  const before=(await pool.query(snapshot)).rows;

  await t.test('files: rules pass, summary 3 lines, no grants/policies/functions/tables, snapshot reads catalogs only',async()=>{
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
   assert.doesNotMatch(code,/\bgrant\b|\brevoke\b|create (or replace )?(function|policy|trigger|table)|disable row level security|security definer|rtw_|\bto (anon|public|service_role)\b/i);
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id in the migration');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261125010000', 'news_highlights_brief'/);
   assert.match(rollbackSQL,/SQL Editor\(폰 경로 C\) 전용/);
  });

  await t.test('before apply: brief is refused by the check; precheck, dry-run, apply, postcheck, second apply refused',async()=>{
   await add(OWNER,WS_A,'news');await add(OWNER,WS_A,'reading');
   await assert.rejects(add(OWNER,WS_A,'brief',NOTE),{code:'23514'});
   const v=values(await readOnly(precheck));
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.equal(v['brief rows'],'0');
   await allYes(postcheck);
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await assert.rejects(add(OWNER,WS_A,'brief',NOTE),{code:'23514'},'dry-run changed nothing');
   const apply=await run('apply','9972');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.equal((await run('apply','9973')).ok,false);
  });

  await t.test('brief highlights: owner adds, reads, edits memo, deletes; other owner, anon and service_role see nothing',async()=>{
   const id=await add(OWNER,WS_A,'brief',NOTE);
   const mine=(await as('authenticated',OWNER,c=>c.query("select source_type,source_id from public.app_news_highlights where source_type='brief'"))).rows;
   assert.deepEqual(mine,[{source_type:'brief',source_id:NOTE}]);
   assert.equal((await as('authenticated',STRANGER,c=>c.query('select * from public.app_news_highlights'))).rows.length,0);
   await assert.rejects(add(STRANGER,WS_A,'brief',NOTE),{code:'42501'},'cannot add into another workspace');
   await assert.rejects(add(OWNER,WS_B,'brief',NOTE),{code:'42501'});
   await assert.rejects(as('anon',null,c=>c.query('select * from public.app_news_highlights')),{code:'42501'});
   await assert.rejects(as('service_role',null,c=>c.query('select * from public.app_news_highlights')),{code:'42501'});
   const upd=await as('authenticated',OWNER,c=>c.query('update public.app_news_highlights set memo=$2, updated_at=now() where id=$1 returning memo',[id,'메모']));
   assert.equal(upd.rows[0].memo,'메모');
   await assert.rejects(as('authenticated',OWNER,c=>c.query("update public.app_news_highlights set source_type='news' where id=$1",[id])),{code:'42501'});
   assert.equal((await as('authenticated',STRANGER,c=>c.query('delete from public.app_news_highlights where id=$1',[id]))).rowCount,0);
   await assert.rejects(add(OWNER,WS_A,'mail'),{code:'23514'},'unknown types still refused');
   await add(OWNER,WS_A,'brief',NOTE);
  });

  await t.test('derived saves stay: brief highlights point only at the workspace (no foreign key to briefs or documents)',async()=>{
   const fk=(await pool.query("select count(*)::int n from pg_constraint where conrelid='public.app_news_highlights'::regclass and contype='f' and confrelid<>'public.app_workspaces'::regclass")).rows[0].n;
   assert.equal(fk,0,'highlights only point at the workspace');
   const n=async()=>(await pool.query("select count(*)::int n from public.app_news_highlights where source_type='brief' and source_id=$1",[NOTE])).rows[0].n;
   const had=await n();assert.ok(had>0);
   // 브리핑·자료 표가 없는 바탕에서도 같다: 밑줄이 가리키는 곳은 작업공간뿐이라, 브리핑·자료를 지우는 어떤 길도 밑줄 행을 함께 지우지 못한다.
   const owner=(await pool.query("select count(*)::int n from pg_constraint where conrelid='public.app_news_highlights'::regclass and contype='f' and confrelid='public.app_workspaces'::regclass")).rows[0].n;
   assert.equal(owner,1);
   assert.equal(await n(),had);
  });

  await t.test('rollback restores the check and record, removes only brief rows; other highlights stay; re-apply works',async()=>{
   const others=(await pool.query("select count(*)::int n from public.app_news_highlights where source_type<>'brief'")).rows[0].n;
   assert.ok((await pool.query("select count(*)::int n from public.app_news_highlights where source_type='brief'")).rows[0].n>0);
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await allYes(postcheck);
   assert.equal((await pool.query("select count(*)::int n from public.app_news_highlights where source_type='brief'")).rows[0].n,0);
   assert.equal((await pool.query("select count(*)::int n from public.app_news_highlights where source_type<>'brief'")).rows[0].n,others);
   assert.equal(values(await readOnly(precheck))['new migration absent'],'예');
   await assert.rejects(pool.query(rollbackSQL),/NEWS_HIGHLIGHTS_BRIEF_ROLLBACK_BLOCKED/);await pool.query('rollback').catch(()=>{});
   const again=await run('apply','9974');assert.equal(again.ok,true,again.summary);
   await allYes(postcheck);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
