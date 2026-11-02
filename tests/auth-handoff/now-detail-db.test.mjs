// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic (example.org).
// S48-14 OUTSIDE-글상세·관심환류 DB(20261102140000_now_detail): 상세 저장·사회운동 글 표시·환류 기록·관심 주제 — through the approved DB workflow runner.
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
const version='20261102140000',name='now_detail',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// 사회운동 글·뉴스 기사 표는 이 migration이 가리키는 칸(id·workspace_id)만 갖춘 합성 모양이다(운영과 같은 소유자 정책·서버 권한).
const prerequisites=`
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;
  create table public.app_outside_posts(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id), title text not null default '합성 성명');
  create table public.app_news_items(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id), title text, starred_at timestamptz);
  alter table public.app_outside_posts enable row level security;
  alter table public.app_news_items enable row level security;
  revoke all on table public.app_outside_posts, public.app_news_items from public, anon, authenticated, service_role;
  grant select on table public.app_outside_posts to authenticated;
  grant select on table public.app_news_items to authenticated;
  grant update (starred_at) on table public.app_news_items to authenticated;
  grant select, insert, update, delete on table public.app_outside_posts, public.app_news_items to service_role;
  create policy outside_posts_owner_select on public.app_outside_posts for select to authenticated using (private.app_is_workspace_owner(workspace_id));
  create policy news_items_owner_all on public.app_news_items for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  -- 운영 모양: service_role에는 schema private USAGE가 없다.
  revoke usage on schema private from service_role;`;

test('now detail db: plan, dry-run, apply, owner boundary, server-only details, same-workspace items, append-only signals, interests, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'now-detail-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  const ids=(await pool.query(`with p as (insert into public.app_outside_posts(workspace_id) values ($1),($2) returning id,workspace_id),
    n as (insert into public.app_news_items(workspace_id,title) values ($1,'합성 기사'),($2,'남의 기사') returning id,workspace_id)
    select (select id from p where workspace_id=$1) pa,(select id from p where workspace_id=$2) pb,
           (select id from n where workspace_id=$1) na,(select id from n where workspace_id=$2) nb`,[WS_A,WS_B])).rows[0];

  await t.test('approval plan: expanded rules, full flow, no definer function',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.review.definer,[]);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   assert.doesNotMatch(migration,/alter table public\.app_(outside_posts|news_items|notes)|on public\.app_(outside_posts|news_items|notes)\b/i,'existing tables untouched');
  });
  await t.test('precheck: all yes before apply',()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
  await t.test('dry-run leaves schema and history unchanged',async()=>{
   const dry=await run('dry-run','9941');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; second apply refused',async()=>{
   const apply=await run('apply','9942');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9943')).ok,false);
  });

  const full={summary:'합성 요약 세 문장.',sent:JSON.stringify([{orig:'Synthetic sentence.',ko:'합성 문장.'},{orig:'국내 원문 문장.'}]),
   rel:JSON.stringify({topics:['공공부문','임금'],reason:'관심 주제와 같은 쟁점'}),imp:JSON.stringify({kptu:'합성 시사점 하나.',labor:'합성 시사점 둘.'}),
   related:JSON.stringify([{kind:'update',id:'00000000-0000-4000-8000-0000000000aa',title:'합성 업데이트'},{kind:'outside',id:'abc_1',title:'다른 단체 글'}])};
  const addDetail=(c,ws,p={})=>c.query(`insert into public.app_now_details(workspace_id,outside_post_id,news_item_id,level,summary,key_sentences,relevance,implications,related,interests_key)
    values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10) returning id`,[ws,p.post??null,p.news??null,p.level??'full',p.summary??full.summary,
    p.sent??full.sent,p.rel===undefined?full.rel:p.rel,p.imp===undefined?full.imp:p.imp,p.related??full.related,p.key??'abc123']).then(r=>r.rows[0].id);

  await t.test('details: server writes once per item, owner reads only, stranger and anon see nothing, shapes checked',async()=>{
   assert.ok(await server(c=>addDetail(c,WS_A,{post:ids.pa})));
   assert.ok(await server(c=>addDetail(c,WS_A,{news:ids.na,level:'basic',rel:null,imp:null})));
   await assert.rejects(server(c=>addDetail(c,WS_A,{post:ids.pa})),{code:'23505'},'one detail per item');
   await assert.rejects(server(c=>addDetail(c,WS_A,{post:ids.pb})),{code:'23514'},'other workspace item');
   await assert.rejects(server(c=>addDetail(c,WS_A,{})),{code:'23514'},'no item');
   await assert.rejects(server(c=>addDetail(c,WS_A,{post:ids.pa,news:ids.na})),{code:'23514'},'two items');
   await assert.rejects(owner(c=>addDetail(c,WS_A,{news:ids.na})),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_now_details set summary='x'")),{code:'42501'});
   await assert.rejects(owner(c=>c.query('delete from public.app_now_details')),{code:'42501'});
   assert.equal((await owner(c=>c.query('select count(*)::int n from public.app_now_details'))).rows[0].n,2);
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_now_details'))).rows[0].n,0);
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_now_details')),{code:'42501'});
   const bad=[
    {level:'deep'},{summary:'x'.repeat(1501)},
    {sent:JSON.stringify([{orig:'a'},{orig:'b'},{orig:'c'},{orig:'d'}])},{sent:JSON.stringify([{orig:'x'.repeat(301)}])},{sent:JSON.stringify([{ko:'원문 없음'}])},{sent:JSON.stringify([{orig:'a',ko:5}])},
    {rel:JSON.stringify({topics:['a','b','c','d','e','f'],reason:'r'})},{rel:JSON.stringify({topics:['줄\n바꿈'],reason:'r'})},{rel:JSON.stringify({topics:[],reason:'r',extra:1})},{rel:JSON.stringify({topics:[]})},
    {imp:JSON.stringify({})},{imp:JSON.stringify({kptu:'x'.repeat(301)})},{imp:JSON.stringify({other:'x'})},
    {related:JSON.stringify([{kind:'web',id:'a',title:'t'}])},{related:JSON.stringify([{kind:'news',id:'a b',title:'t'}])},{related:JSON.stringify(Array(9).fill({kind:'news',id:'a',title:'t'}))},
    {key:'ABC'},{level:'basic'}];
   for(const p of bad)await assert.rejects(server(c=>addDetail(c,WS_B,{post:ids.pb,...p})),{code:'23514'},JSON.stringify(p).slice(0,80));
   // Regenerating relevance only: the server updates its own row.
   assert.equal((await server(c=>c.query("update public.app_now_details set relevance=null,implications=null,interests_key='def456',context_at=now() where outside_post_id=$1",[ids.pa]))).rowCount,1);
   await assert.rejects(server(c=>c.query('update public.app_now_details set outside_post_id=$1 where outside_post_id=$2',[ids.pb,ids.pa])),{code:'23514'});
  });

  await t.test('outside marks: owner stars, archives, dismisses own posts only; server reads only',async()=>{
   assert.equal((await owner(c=>c.query('insert into public.app_outside_marks(post_id,workspace_id,starred_at) values ($1,$2,now()) on conflict (post_id) do update set starred_at=excluded.starred_at,updated_at=now()',[ids.pa,WS_A]))).rowCount,1);
   assert.equal((await owner(c=>c.query('insert into public.app_outside_marks(post_id,workspace_id,archived_at) values ($1,$2,now()) on conflict (post_id) do update set archived_at=excluded.archived_at,updated_at=now()',[ids.pa,WS_A]))).rowCount,1);
   const m=(await owner(c=>c.query('select starred_at is not null s,archived_at is not null a from public.app_outside_marks'))).rows[0];
   assert.equal(m.s,true);assert.equal(m.a,true);
   // Another workspace's post: invisible to the owner, so refused by the scope guard; claiming the other workspace is refused too.
   await assert.rejects(owner(c=>c.query('insert into public.app_outside_marks(post_id,workspace_id,starred_at) values ($1,$2,now())',[ids.pb,WS_A])),{code:'23514'});
   // (scope guard runs before RLS WITH CHECK, so either refusal is fine)
   await assert.rejects(owner(c=>c.query('insert into public.app_outside_marks(post_id,workspace_id,starred_at) values ($1,$2,now())',[ids.pb,WS_B])),e=>['42501','23514'].includes(e.code));
   await assert.rejects(owner(c=>c.query('update public.app_outside_marks set post_id=$1',[ids.pb])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_outside_marks set created_at=now()")),{code:'42501'});
   assert.equal((await stranger(c=>c.query('update public.app_outside_marks set dismissed_at=now()'))).rowCount,0);
   assert.equal((await server(c=>c.query('select count(*)::int n from public.app_outside_marks'))).rows[0].n,1);
   await assert.rejects(server(c=>c.query('update public.app_outside_marks set starred_at=null')),{code:'42501'});
   assert.equal((await owner(c=>c.query('update public.app_outside_marks set starred_at=null,updated_at=now()'))).rowCount,1);
  });

  await t.test('signals: owner appends for own items only; no update, delete or forged time; server reads and prunes',async()=>{
   await owner(c=>c.query("insert into public.app_now_signals(workspace_id,outside_post_id,action) values ($1,$2,'star'),($1,$2,'open')",[WS_A,ids.pa]));
   await owner(c=>c.query("insert into public.app_now_signals(workspace_id,news_item_id,action) values ($1,$2,'memo')",[WS_A,ids.na]));
   await assert.rejects(owner(c=>c.query("insert into public.app_now_signals(workspace_id,news_item_id,action) values ($1,$2,'star')",[WS_A,ids.nb])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("insert into public.app_now_signals(workspace_id,outside_post_id,action) values ($1,$2,'like')",[WS_A,ids.pa])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("insert into public.app_now_signals(workspace_id,action) values ($1,'open')",[WS_A])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("insert into public.app_now_signals(workspace_id,outside_post_id,action,created_at) values ($1,$2,'open','2020-01-01')",[WS_A,ids.pa])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_now_signals set action='dismiss'")),{code:'42501'});
   await assert.rejects(owner(c=>c.query('delete from public.app_now_signals')),{code:'42501'});
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_now_signals'))).rows[0].n,0);
   await assert.rejects(server(c=>c.query("insert into public.app_now_signals(workspace_id,outside_post_id,action) values ($1,$2,'open')",[WS_A,ids.pa])),{code:'42501'});
   assert.equal((await server(c=>c.query("delete from public.app_now_signals where action='open'"))).rowCount,1);
   assert.equal((await owner(c=>c.query('select count(*)::int n from public.app_now_signals'))).rows[0].n,2);
  });

  await t.test('interests: AI adds candidates, owner confirms, edits, drops, adds; origin stays server-only',async()=>{
   await server(c=>c.query("insert into public.app_now_interests(workspace_id,topic,state,origin,reason) values ($1,'공공부문 임금','candidate','ai','별표 3건')",[WS_A]));
   assert.equal((await owner(c=>c.query("update public.app_now_interests set state='confirmed',decided_at=now(),updated_at=now() where topic='공공부문 임금'"))).rowCount,1);
   assert.equal((await owner(c=>c.query("update public.app_now_interests set topic='공공기관 임금' where topic='공공부문 임금'"))).rowCount,1);
   await owner(c=>c.query("insert into public.app_now_interests(workspace_id,topic,state,decided_at) values ($1,'돌봄','confirmed',now())",[WS_A]));
   assert.equal((await pool.query("select origin from public.app_now_interests where topic='돌봄'")).rows[0].origin,'user');
   await assert.rejects(owner(c=>c.query("insert into public.app_now_interests(workspace_id,topic,origin) values ($1,'가짜','ai')",[WS_A])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_now_interests set reason='x'")),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_now_interests(workspace_id,topic) values ($1,'남의 것')",[WS_B])),{code:'42501'});
   for(const bad of ['',' 앞공백','가'.repeat(31),'줄\n바꿈'])
     await assert.rejects(owner(c=>c.query('insert into public.app_now_interests(workspace_id,topic) values ($1,$2)',[WS_A,bad])),{code:'23514'},bad);
   await assert.rejects(owner(c=>c.query("update public.app_now_interests set state='maybe'")),{code:'23514'});
   await assert.rejects(owner(c=>c.query("insert into public.app_now_interests(workspace_id,topic) values ($1,'돌봄')",[WS_A])),{code:'23505'});
   assert.equal((await owner(c=>c.query("delete from public.app_now_interests where topic='돌봄'"))).rowCount,1);
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_now_interests'))).rows[0].n,0);
  });

  await t.test('deleting an item removes its detail, marks and signals',async()=>{
   await pool.query('delete from public.app_news_items where id=$1',[ids.na]);
   assert.equal((await pool.query('select count(*)::int n from public.app_now_details where news_item_id=$1',[ids.na])).rows[0].n,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_now_signals where news_item_id=$1',[ids.na])).rows[0].n,0);
   await pool.query('delete from public.app_outside_posts where id=$1',[ids.pa]);
   assert.equal((await pool.query('select count(*)::int n from public.app_outside_marks')).rows[0].n,0);
  });

  await t.test('rollback returns to the snapshot; posts and news stay',async()=>{
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await pool.query('select count(*)::int n from public.app_outside_posts')).rows[0].n,1);
   assert.equal((await pool.query('select count(*)::int n from public.app_news_items')).rows[0].n,1);
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
