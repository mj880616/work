// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S54-16 SRV-낭비줄이기 ④ DB(20261108140000_news_titles_tried): 뉴스 제목 번역 시도 시각 칸 app_news_items.title_tried_at.
// - 승인형 workflow의 plan·dry-run·apply가 통과(확장 규칙)하고, dry-run은 아무것도 남기지 않는다.
// - 서버(service_role)만 적는다. 로그인 사용자(authenticated)는 자기 작업공간 줄만 읽고 이 칸을 쓸 수 없다. anon 없음.
// - 표 권한·정책·트리거 해시는 그대로, 되돌리기는 칸·기록만 지운다.
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
const version='20261108140000',name='news_titles_tried',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// news_clipping이 읽는 노트 표만 갖춘 합성 모양(news-clipping-db.test.mjs와 같음).
const prerequisites=`
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;
  create table public.app_notes(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id),
    raw_text text not null, kind text not null default 'note', metadata jsonb not null default '{}'::jsonb, deleted_at timestamptz);
  alter table public.app_notes enable row level security;
  revoke all on table public.app_notes from public, anon, authenticated, service_role;
  grant select, insert, update, delete on table public.app_notes to authenticated;
  create policy notes_owner_all on public.app_notes for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke usage on schema private from service_role;`;

test('news titles tried: plan, dry-run, apply, server-only write, owner-only read, rollback',{timeout:150000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'news-titles-tried-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query(await read('supabase/migrations/20261101233000_news_clipping.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL]=await Promise.all(['precheck','postcheck','snapshot','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  const check=async sql=>Object.fromEntries((await readOnly(sql)).map(r=>[r.item,r.value]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  let n=0;
  const item=async(lang,ws=WS_A)=>(await pool.query(`insert into public.app_news_items(workspace_id,lane,url,url_key,title,lang,state)
    values ($1,'channel',$2,$3,$4,$5,'ok') returning id`,[ws,'https://example.org/n/'+(++n),'example.org/n/'+n,lang==='ko'?'합성 기사':'Synthetic headline',lang])).rows[0].id;
  const EN=await item('en'),KO=await item('ko'),EN_B=await item('en',WS_B);
  const before=(await pool.query(snapshot)).rows;let pre;

  await t.test('files: read-only checks, three-line summary, expanded workflow accepts apply and dry-run',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const p=prepareMigration({mode,version,runId:'1',root});assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');assert.deepEqual(p.targets,['app_news_items']);}
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'').replace(/'[^']*'/g,"''");
   assert.doesNotMatch(code,/security definer|disable row level|\bgrant\b|\brevoke\b|create policy|create (or replace )?function|create trigger|create index|rtw_|\bdelete\s+from\b|\bupdate\s+public\./i);
   pre=await check(precheck);
   for(const k of ['new migration absent','previous step applied','title_tried_at column absent','items RLS on, no anon privilege, no authenticated insert/delete or title update'])assert.equal(pre[k],'예',k);
   assert.equal(pre['items rows'],'3');assert.equal(pre['foreign items rows'],'2');
  });

  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await check(precheck),pre);assert.equal(await history(),0);
  });

  await t.test('apply passes postcheck; rows, grants, policies and triggers unchanged',async()=>{
   const result=await run('apply','9982');assert.equal(result.ok,true,result.summary);
   assert.equal(await history(),1);
   const post=await check(postcheck);
   for(const k of ['history row present','title_tried_at column nullable timestamptz, no default','title_tried_at: authenticated read only, server can write','items RLS on, no anon privilege, no authenticated insert/delete or title update'])assert.equal(post[k],'예',k);
   for(const k of ['items rows','foreign items rows','items grants policies triggers hash'])assert.equal(post[k],pre[k],k);
   assert.equal((await pool.query('select count(*)::int n from public.app_news_items where title_tried_at is not null')).rows[0].n,0,'existing rows start empty');
   assert.equal((await run('apply','9983')).ok,false,'second apply stops');
   await assert.rejects(pool.query(migration),/NEWS_TITLES_TRIED_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  await t.test('server writes the time; signed-in users read own rows only and cannot write it; anon has nothing',async()=>{
   await as('service_role','',c=>c.query('update public.app_news_items set title_tried_at=now() where id=$1',[EN]));
   const mine=await as('authenticated',OWNER,c=>c.query('select id,title_tried_at from public.app_news_items order by id'));
   assert.ok(mine.rows.every(r=>r.id!==EN_B),'other workspace row is invisible');
   assert.ok(mine.rows.find(r=>r.id===EN).title_tried_at instanceof Date);
   assert.equal(mine.rows.find(r=>r.id===KO).title_tried_at,null);
   await assert.rejects(as('authenticated',OWNER,c=>c.query('update public.app_news_items set title_tried_at=now() where id=$1',[EN])),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query('select title_tried_at from public.app_news_items')),{code:'42501'});
   // 별·폴더 칸 고치기(기존 권한)는 그대로 된다.
   await as('authenticated',OWNER,c=>c.query('update public.app_news_items set hidden_at=now() where id=$1',[EN]));
  });

  await t.test('rollback removes the column and record; items stay; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal((await pool.query('select count(*)::int n from public.app_news_items')).rows[0].n,3,'items stay');
   const again=await run('apply','9984');assert.equal(again.ok,true,again.summary);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
