// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic (example.org).
// S47-44 NEWS-클리핑 A) DB(20261101230000_news_clipping): 기사 한 목록·별표 폴더·키워드·하루 사용량 + app_news_prune — through the approved DB workflow runner.
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
import {prepareMigration,toDryRun} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261101230000',name='news_clipping',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// 노트 표는 이 migration이 읽기만 하는 칸(workspace_id·kind·metadata·deleted_at)만 갖춘 합성 모양이다(운영과 같은 소유자 정책).
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
  -- 운영 모양: service_role에는 schema private USAGE가 없다.
  revoke usage on schema private from service_role;`;

test('news clipping db: plan, dry-run, apply, owner boundary, server-only body and translation, star folders, prune keeps memo, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'news-clipping-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL]=await Promise.all(['precheck','postcheck','snapshot','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const add=(c,ws,p={})=>c.query(`insert into public.app_news_items(workspace_id,lane,url,url_key,title,lang,publisher,state,summary,body,body_kind,published_at,created_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,coalesce($13,now())) returning id`,[ws,p.lane??'channel',p.url??'https://example.org/a/1',p.key??(p.url??'example.org/a/1'),
    p.title??'합성 기사 제목',p.lang??'ko',p.publisher??'합성 매체',p.state??'ok',p.summary??'한 문장 요약',p.body===undefined?'합성 본문 문단.':p.body,
    p.body===null?null:(p.bodyKind??'full'),p.published??null,p.created??null]).then(r=>r.rows[0].id);

  await t.test('approval plan: expanded rules, full flow, one definer function (prune) for review',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.review.definer,['public.app_news_prune']);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   assert.doesNotMatch(migration,/alter table public\.app_notes|on public\.app_notes/i,'notes table untouched');
  });
  await t.test('precheck: all yes before apply',()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
  await t.test('dry-run leaves schema and history unchanged',async()=>{
   const dry=await run('dry-run','9931');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; second apply refused',async()=>{
   const apply=await run('apply','9932');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9933')).ok,false);
  });

  let itemA,itemEn;
  await t.test('items: only the server writes body, summary and translation; owner reads; stranger and anon see nothing',async()=>{
   itemA=await server(c=>add(c,WS_A));
   itemEn=await server(c=>add(c,WS_A,{lane:'keyword',url:'https://example.org/en/1',lang:'en',title:'Synthetic headline',summary:'One line in English.',body:'Synthetic body.'}));
   await assert.rejects(owner(c=>add(c,WS_A,{url:'https://example.org/own'})),{code:'42501'});
   for(const col of ["body='x'","summary='x'","title_ko='x',translated_at=now()","url='https://example.org/z'","workspace_id='"+WS_B+"'","state='ok'"])
     await assert.rejects(owner(c=>c.query(`update public.app_news_items set ${col} where id=$1`,[itemA])),{code:'42501'},col);
   await assert.rejects(owner(c=>c.query('delete from public.app_news_items')),{code:'42501'});
   assert.equal((await owner(c=>c.query('select count(*)::int n from public.app_news_items'))).rows[0].n,2);
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_news_items'))).rows[0].n,0);
   assert.equal((await stranger(c=>c.query('update public.app_news_items set starred_at=now()'))).rowCount,0);
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_news_items')),{code:'42501'});
   // Same article once per workspace; another workspace keeps its own copy.
   await assert.rejects(server(c=>add(c,WS_A)),{code:'23505'});
   assert.ok(await server(c=>add(c,WS_B)));
   // Translation is written by the server only, together with its time.
   assert.equal((await server(c=>c.query("update public.app_news_items set title_ko='합성 번역 제목',body_ko='합성 번역 본문',translated_at=now() where id=$1",[itemEn]))).rowCount,1);
   await assert.rejects(server(c=>c.query("update public.app_news_items set title_ko='x' where id=$1",[itemA])),{code:'23514'},'translation needs translated_at');
   for(const bad of [{lane:'tweet'},{lang:'EN'},{url:'javascript:alert(1)'},{url:'https://a b'},{title:'줄\n바꿈'},{state:'stolen'},{bodyKind:'paywalled'},{body:'x'.repeat(100001)}])
     await assert.rejects(server(c=>add(c,WS_A,{url:'https://example.org/bad',...bad})),{code:'23514'},JSON.stringify(bad).slice(0,60));
   assert.ok(await server(c=>add(c,WS_A,{url:'https://example.org/pay',state:'paywall',bodyKind:'lead',body:'공개 리드 한 문단.'})));
   assert.ok(await server(c=>add(c,WS_A,{url:'https://example.org/pending',state:'pending',title:null,summary:null,body:null})));
  });

  let top,child,grand;
  await t.test('star folders: owner tree in own workspace, cycle and scope refused, delete lifts folders and articles',async()=>{
   [top,child,grand]=await owner(async c=>{
    const a=(await c.query("insert into public.app_news_folders(workspace_id,name) values ($1,'위') returning id",[WS_A])).rows[0].id;
    const b=(await c.query("insert into public.app_news_folders(workspace_id,parent_id,name) values ($1,$2,'가운데') returning id",[WS_A,a])).rows[0].id;
    const d=(await c.query("insert into public.app_news_folders(workspace_id,parent_id,name) values ($1,$2,'아래') returning id",[WS_A,b])).rows[0].id;
    return [a,b,d];});
   await assert.rejects(owner(c=>c.query('update public.app_news_folders set parent_id=$1 where id=$2',[grand,top])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("insert into public.app_news_folders(workspace_id,name) values ($1,'남의 것')",[WS_B])),{code:'42501'});
   const other=await stranger(c=>c.query("insert into public.app_news_folders(workspace_id,name) values ($1,'남') returning id",[WS_B])).then(r=>r.rows[0].id);
   // Folder only on a starred article; only own workspace folders.
   await assert.rejects(owner(c=>c.query('update public.app_news_items set folder_id=$1 where id=$2',[child,itemA])),{code:'23514'});
   assert.equal((await owner(c=>c.query('update public.app_news_items set starred_at=now(),folder_id=$1,updated_at=now() where id=$2',[child,itemA]))).rowCount,1);
   await assert.rejects(owner(c=>c.query('update public.app_news_items set folder_id=$1 where id=$2',[other,itemA])),{code:'23503'});
   await assert.rejects(server(c=>c.query('select 1 from public.app_news_folders')),{code:'42501'});
   // Deleting the middle folder lifts the child folder and the article one level up.
   assert.equal((await owner(c=>c.query('delete from public.app_news_folders where id=$1',[child]))).rowCount,1);
   assert.equal((await pool.query('select parent_id from public.app_news_folders where id=$1',[grand])).rows[0].parent_id,top);
   const it=(await pool.query('select folder_id,starred_at is not null starred from public.app_news_items where id=$1',[itemA])).rows[0];
   assert.equal(it.folder_id,top);assert.equal(it.starred,true);
   // Deleting the top folder: article stays starred with no folder.
   await owner(c=>c.query('delete from public.app_news_folders where id=$1',[top]));
   assert.equal((await pool.query('select folder_id from public.app_news_items where id=$1',[itemA])).rows[0].folder_id,null);
   assert.equal((await pool.query('select parent_id from public.app_news_folders where id=$1',[grand])).rows[0].parent_id,null);
  });

  await t.test('keywords: owner adds, switches, removes own; server reads only',async()=>{
   await owner(c=>c.query("insert into public.app_news_keywords(workspace_id,word) values ($1,'합성어'),($1,'둘째')",[WS_A]));
   for(const bad of ['',' 앞공백','a'.repeat(31),'줄\n바꿈'])
     await assert.rejects(owner(c=>c.query('insert into public.app_news_keywords(workspace_id,word) values ($1,$2)',[WS_A,bad])),{code:'23514'},bad);
   await assert.rejects(owner(c=>c.query("insert into public.app_news_keywords(workspace_id,word) values ($1,'x')",[WS_B])),{code:'42501'});
   assert.equal((await owner(c=>c.query("update public.app_news_keywords set enabled=false,updated_at=now() where word='둘째'"))).rowCount,1);
   await assert.rejects(owner(c=>c.query("update public.app_news_keywords set word='바꿈'")),{code:'42501'});
   assert.equal((await owner(c=>c.query("delete from public.app_news_keywords where word='둘째'"))).rowCount,1);
   assert.equal((await server(c=>c.query('select count(*)::int n from public.app_news_keywords'))).rows[0].n,1);
   await assert.rejects(server(c=>c.query("insert into public.app_news_keywords(workspace_id,word) values ($1,'서버')",[WS_A])),{code:'42501'});
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_news_keywords'))).rows[0].n,0);
  });

  await t.test('daily usage: server counts, owner reads only',async()=>{
   await server(c=>c.query("insert into public.app_news_days(workspace_id,day,translate_n) values ($1,'2026-11-01',1) on conflict (workspace_id,day) do update set translate_n=public.app_news_days.translate_n+1",[WS_A]));
   assert.equal((await owner(c=>c.query('select translate_n from public.app_news_days'))).rows[0].translate_n,1);
   await assert.rejects(owner(c=>c.query('update public.app_news_days set translate_n=0')),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_news_days(workspace_id,day) values ($1,'2026-11-02')",[WS_A])),{code:'42501'});
   await assert.rejects(server(c=>c.query('delete from public.app_news_days')),{code:'42501'});
   await assert.rejects(server(c=>c.query("update public.app_news_days set fill_n=-1")),{code:'23514'});
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_news_days'))).rows[0].n,0);
  });

  await t.test('prune: old media 30d and keyword 180d only; keeps channel, starred and memo articles; server only',async()=>{
   const old='2026-01-01T00:00:00Z',now='2026-11-01T00:00:00Z';
   const ids=await server(async c=>({
    media:await add(c,WS_A,{lane:'media',url:'https://example.org/m1',published:'2026-09-20T00:00:00Z'}),
    mediaNew:await add(c,WS_A,{lane:'media',url:'https://example.org/m2',published:'2026-10-25T00:00:00Z'}),
    keyword:await add(c,WS_A,{lane:'keyword',url:'https://example.org/k1',published:old}),
    keywordNew:await add(c,WS_A,{lane:'keyword',url:'https://example.org/k2',published:'2026-08-01T00:00:00Z'}),
    channel:await add(c,WS_A,{lane:'channel',url:'https://example.org/c1',published:old}),
    starred:await add(c,WS_A,{lane:'media',url:'https://example.org/s1',published:old}),
    memo:await add(c,WS_A,{lane:'keyword',url:'https://example.org/n1',published:old}),
    noDate:await add(c,WS_A,{lane:'media',url:'https://example.org/d1',created:old}),
   }));
   await owner(c=>c.query('update public.app_news_items set starred_at=now() where id=$1',[ids.starred]));
   // Memo = an ordinary note with metadata.news_item_id (also kept while in the trash).
   await owner(c=>c.query("insert into public.app_notes(workspace_id,raw_text,kind,metadata,deleted_at) values ($1,'합성 메모','note',jsonb_build_object('news_item_id',$2::text),now())",[WS_A,ids.memo]));
   // Same id written in another workspace's note must not protect it (cannot happen through RLS, set directly here).
   await pool.query("insert into public.app_notes(workspace_id,raw_text,metadata) values ($1,'남의 메모',jsonb_build_object('news_item_id',$2::text))",[WS_B,ids.keyword]);
   await assert.rejects(owner(c=>c.query('select public.app_news_prune($1,100)',[now])),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query('select public.app_news_prune($1,100)',[now])),{code:'42501'});
   assert.equal((await server(c=>c.query('select public.app_news_prune($1,1) n',[now]))).rows[0].n,1,'limit respected');
   assert.equal((await server(c=>c.query('select public.app_news_prune($1,100) n',[now]))).rows[0].n,2);
   const left=new Set((await pool.query('select id from public.app_news_items')).rows.map(r=>r.id));
   for(const k of ['media','keyword','noDate'])assert.equal(left.has(ids[k]),false,k);
   for(const k of ['mediaNew','keywordNew','channel','starred','memo'])assert.equal(left.has(ids[k]),true,k);
   assert.equal(left.has(itemA),true);
  });

  await t.test('rollback returns to the snapshot; notes stay',async()=>{
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await pool.query('select count(*)::int n from public.app_notes')).rows[0].n,2);
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
