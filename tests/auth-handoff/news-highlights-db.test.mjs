// Fresh local PostgreSQL only. No Supabase, Edge or production credentials. All data synthetic.
// S53-5 NEWS-밑줄모으기 ①(20261108070000_news_highlights): 원문에서 고른 글(밑줄)·메모 표 app_news_highlights.
// - 승인형 DB workflow 확장 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예.
// - 자기 작업공간 주인만 읽기·넣기·지우기, 고치기는 메모만. 익명·service_role·다른 작업공간 사람은 못 봄.
// - 되돌리기는 표·기록만 원래대로.
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
const version='20261108070000',name='news_highlights',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;`;
const SRC='31000000-0000-4000-8000-000000000001';

test('news highlights: owner-only table, listed insert columns, memo-only update, guarded rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'news-hl-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false,max:8}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,user,fn){const c=await pool.connect();try{await c.query('begin');await c.query('set local role '+role);if(user)await c.query(`select set_config('request.jwt.claim.sub',$1,true)`,[user]);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const allYes=async sql=>{for(const r of await readOnly(sql))assert.equal(r.value,'예',r.item);};
  const add=(user,ws,extra={})=>as('authenticated',user,c=>c.query(
   `insert into public.app_news_highlights(workspace_id,source_type,source_id,quote,quote_prefix,quote_suffix,memo,source_title,source_media,source_date,source_url)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
   [ws,extra.type||'news',SRC,extra.quote??'고른 문장 하나',extra.prefix??'',extra.suffix??'',extra.memo??null,extra.title??'글 제목',extra.media??'매체',extra.date??'2026-11-07T00:00:00Z',extra.url??'https://example.com/a']).then(r=>r.rows[0].id));
  const before=(await pool.query(snapshot)).rows;

  await t.test('files: expanded rules pass, one new table, summary 3 lines, checks read no app rows',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.flow,'full');assert.equal(plan.rules,'expanded');
    assert.deepEqual([...plan.createdTables],['app_news_highlights']);
    assert.deepEqual(plan.review.definer,[]);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|disable row level security|rtw_|information_schema|\bto (anon|public|service_role)\b/i);
   assert.doesNotMatch(snapshot+precheck+postcheck,/from public\./i,'checks read no app table');
   assert.ok(snapshot.length<=8192);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261108070000', 'news_highlights'/);
   assert.match(rollbackSQL,/SQL Editor\(폰 경로 C\) 전용/);
  });

  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(await readOnly(precheck));
   for(const item of ['new migration absent','new table absent','owner check function','workspaces table'])assert.equal(v[item],'예',item);
   await allYes(postcheck);
   const dry=await run('dry-run','9991');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9992');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.equal((await run('apply','9993')).ok,false);
  });

  await t.test('owner adds, reads, edits memo, deletes; others and anon see nothing',async()=>{
   const id=await add(OWNER,WS_A,{memo:'메모 한 줄',prefix:'앞 글',suffix:'뒤 글'});
   const mine=await as('authenticated',OWNER,c=>c.query('select quote,memo,quote_prefix from public.app_news_highlights')).then(r=>r.rows);
   assert.deepEqual(mine,[{quote:'고른 문장 하나',memo:'메모 한 줄',quote_prefix:'앞 글'}]);
   assert.equal((await as('authenticated',STRANGER,c=>c.query('select * from public.app_news_highlights'))).rows.length,0,'other workspace owner sees nothing');
   await assert.rejects(add(STRANGER,WS_A),{code:'42501'},'cannot add into another workspace');
   await assert.rejects(add(OWNER,WS_B),{code:'42501'});
   await assert.rejects(as('anon',null,c=>c.query('select * from public.app_news_highlights')),{code:'42501'});
   await assert.rejects(as('service_role',null,c=>c.query('select * from public.app_news_highlights')),{code:'42501'});
   const upd=await as('authenticated',OWNER,c=>c.query('update public.app_news_highlights set memo=$2, updated_at=now() where id=$1 returning memo',[id,'고친 메모']));
   assert.equal(upd.rows[0].memo,'고친 메모');
   await as('authenticated',OWNER,c=>c.query('update public.app_news_highlights set memo=null where id=$1',[id]));
   for(const col of ['quote','workspace_id','source_id','source_url','created_at'])
    await assert.rejects(as('authenticated',OWNER,c=>c.query(`update public.app_news_highlights set ${col}=${col} where id=$1`,[id])),{code:'42501'},col);
   await assert.rejects(as('authenticated',OWNER,c=>c.query(`insert into public.app_news_highlights(id,workspace_id,source_type,source_id,quote) values(gen_random_uuid(),$1,'news',$2,'x')`,[WS_A,SRC])),{code:'42501'},'id is not insertable');
   const gone=await as('authenticated',STRANGER,c=>c.query('delete from public.app_news_highlights where id=$1',[id]));
   assert.equal(gone.rowCount,0,'stranger cannot delete');
   const del=await as('authenticated',OWNER,c=>c.query('delete from public.app_news_highlights where id=$1',[id]));
   assert.equal(del.rowCount,1);
  });

  await t.test('checks: type, empty quote, long memo, bad url, control chars in title',async()=>{
   await assert.rejects(add(OWNER,WS_A,{type:'mail'}),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,{quote:'   '}),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,{quote:'가'.repeat(4001)}),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,{memo:''}),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,{memo:'가'.repeat(2001)}),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,{prefix:'가'.repeat(61)}),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,{url:'javascript:alert(1)'}),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,{title:'줄\n바꿈'}),{code:'23514'});
   const ok=await add(OWNER,WS_A,{type:'telegram',quote:'여러 줄\n\n문단',url:null,title:null,media:null,date:null});
   assert.ok(ok);
  });

  await t.test('rollback removes table and history; snapshot and postcheck match the start',async()=>{
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await allYes(postcheck);
   await assert.rejects(pool.query(rollbackSQL),/NEWS_HIGHLIGHTS_ROLLBACK_BLOCKED/);await pool.query('rollback').catch(()=>{});
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
