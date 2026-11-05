// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic (example.com·합성 글).
// S51-3 NEWS-전면개편 P2a(20261106050000_feed_bodies): 글마다 본문 문단·사진 주소·캡션을 담는 표 app_feed_bodies.
// - 승인형 DB workflow 확장 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예.
// - 소유자만 읽는다(화면은 읽기만). 서버(service_role)는 읽기·넣기·고치기(upsert)만, 지우기 없음. anon·PUBLIC 없음.
// - 블록 모양·크기 상한(블록 400·글자 10만·사진 20·https 주소 2000·캡션 300)과 상태·까닭 검사. 같은 작업공간 글만(트리거).
// - 글이 지워지면 함께 지워진다. 되돌리기는 줄이 있으면 멈추고, 없으면 표·함수·기록만 원래대로.
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
const version='20261106050000',name='feed_bodies',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// 사회운동 글·뉴스 기사 표는 이 migration이 가리키는 칸(id·workspace_id)만 갖춘 합성 모양이다(운영과 같은 소유자 정책·서버 권한).
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;
  create table public.app_outside_posts(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id) on delete cascade, title text not null default '합성 성명');
  create table public.app_news_items(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id) on delete cascade, title text);
  alter table public.app_outside_posts enable row level security;
  alter table public.app_news_items enable row level security;
  revoke all on table public.app_outside_posts, public.app_news_items from public, anon, authenticated, service_role;
  grant select on table public.app_outside_posts, public.app_news_items to authenticated;
  grant select, insert, update, delete on table public.app_outside_posts, public.app_news_items to service_role;
  create policy outside_posts_owner_select on public.app_outside_posts for select to authenticated using (private.app_is_workspace_owner(workspace_id));
  create policy news_items_owner_all on public.app_news_items for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  -- 운영 모양: service_role에는 schema private USAGE가 없다.
  revoke usage on schema private from service_role;`;
const STEPS=`insert into supabase_migrations.schema_migrations(version,name) values ('20261031230000','outside_statements'),('20261101233000','news_clipping');`;

test('feed bodies db: plan, dry-run, apply, owner read only, server upsert without delete, shapes, same workspace, cascade, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'feed-bodies-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const allYes=async sql=>{for(const r of await readOnly(sql))assert.equal(r.value,'예',r.item);};
  const guardFails=async pattern=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),pattern);await c.query('rollback');}finally{c.release();}};
  const ids=(await pool.query(`with p as (insert into public.app_outside_posts(workspace_id) values ($1),($2) returning id,workspace_id),
    n as (insert into public.app_news_items(workspace_id,title) values ($1,'합성 기사'),($2,'남의 기사') returning id,workspace_id)
    select (select id from p where workspace_id=$1) pa,(select id from p where workspace_id=$2) pb,
           (select id from n where workspace_id=$1) na,(select id from n where workspace_id=$2) nb`,[WS_A,WS_B])).rows[0];
  // 서버 넣기: upsert(글마다 한 줄). 칸 이름은 P2b 수집 함수가 쓸 모양 그대로.
  const put=(c,row)=>{const r={workspace_id:WS_A,blocks:'[]',state:'failed',reason:'relay',rule:null,chars:0,images:0,...row};
   const key=r.news_item_id?'news_item_id':'outside_post_id';const cols=Object.keys(r);
   return c.query(`insert into public.app_feed_bodies(${cols.join(',')}) values (${cols.map((k,i)=>'$'+(i+1)+(k==='blocks'?'::jsonb':'')).join(',')})
    on conflict (${key}) do update set ${cols.map(k=>k+'=excluded.'+k).join(',')},updated_at=now() returning id`,cols.map(k=>r[k]));};
  const P=(text)=>({t:'p',text}),IMG=(src,cap)=>cap===undefined?{t:'img',src}:{t:'img',src,cap};
  const body=(blocks,o={})=>({blocks:JSON.stringify(blocks),state:'ok',reason:null,rule:'kptu@1',
   chars:blocks.filter(b=>b.t!=='img').reduce((n,b)=>n+(typeof b.text==='string'?b.text.length:1),0),images:blocks.filter(b=>b&&b.t==='img').length,...o});

  await t.test('guard: stops without changes when the outside/news DB steps are not recorded',async()=>{
   await guardFails(/FEED_BODIES_PREREQUISITE_CHANGED/);
   assert.equal((await pool.query("select to_regclass('public.app_feed_bodies') t")).rows[0].t,null);
   await pool.query(STEPS);
  });
  const before=(await pool.query(snapshot)).rows;

  await t.test('files: expanded rules, full flow, one new table and one invoker guard, summary 3 lines, snapshot reads catalogs only',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const sql of [precheck,postcheck,snapshot,rollbackSQL,migration])assert.doesNotMatch(sql.replace(/--.*$/gm,''),/information_schema/i);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.flow,'full');assert.equal(plan.rules,'expanded');
    assert.deepEqual([...plan.createdTables],['app_feed_bodies']);
    assert.deepEqual([...plan.functions],['private.app_feed_bodies_scope_guard']);
    assert.deepEqual(plan.review.definer,[]);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bto (anon|public)\b|disable row level security|alter policy|drop policy|security definer|rtw_|grant usage on schema/i);
   assert.doesNotMatch(code,/alter table public\.app_(outside_posts|news_items|outside_sentences)|on public\.app_(outside_posts|news_items|outside_sentences)\b/i,'existing tables untouched');
   assert.doesNotMatch(code,/20261106040000/,'no dependency on the P1a step');
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id in the migration');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
   assert.doesNotMatch(precheck.replace(/--.*$/gm,''),/from public\./i,'precheck reads no app table rows');
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261106050000', 'feed_bodies'/);
   assert.match(rollbackSQL,/SQL Editor\(폰 경로 C\) 전용/);assert.match(rollbackSQL,/FEED_BODIES_ROLLBACK_BLOCKED: rows exist/);
  });

  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(await readOnly(precheck));
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   await allYes(postcheck);
   const dry=await run('dry-run','9991');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9992');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.equal((await run('apply','9993')).ok,false);
  });

  await t.test('shape: columns as designed; checks reject bad blocks, sizes, addresses and state/reason pairs',async()=>{
   const cols=(await pool.query("select attname from pg_attribute where attrelid='public.app_feed_bodies'::regclass and attnum>0 and not attisdropped order by attnum")).rows.map(r=>r.attname);
   assert.deepEqual(cols,['id','workspace_id','outside_post_id','news_item_id','blocks','state','reason','rule','chars','images','extracted_at','created_at','updated_at']);
   const long=n=>'https://example.com/'+'a'.repeat(n-20);
   const ok=[
    body([{t:'h',text:'합성 소제목'},P('합성 문단 "따옴표" 포함'),{t:'quote',text:'합성 인용'},{t:'img',src:'https://example.com/a.jpg?w=1&k=한글',cap:'합성 캡션',alt:null}]),
    body(Array.from({length:400},()=>P('가'))),
    body(Array.from({length:100},()=>P('가'.repeat(1000)))),
    body(Array.from({length:20},(_,i)=>IMG('https://example.com/'+i)),{state:'image_only',reason:null}),
    body([IMG(long(2000),'가'.repeat(300))],{state:'image_only'}),
    body([P('앞부분만')],{state:'lead',reason:'paywall'}),
    {state:'failed',reason:'robots',rule:null},
   ];
   for(const [i,row] of ok.entries()){
    await assert.doesNotReject(server(c=>put(c,{outside_post_id:ids.pa,...row})),'ok '+i);
    await pool.query('delete from public.app_feed_bodies');
   }
   const bad=[
    ['not array',{blocks:'{}'}],
    ['401 blocks',body(Array.from({length:401},()=>P('가')))],
    ['text total over 100k',body(Array.from({length:120},()=>P('가'.repeat(1000))),{chars:100000})],
    ['chars over 100k',body([P('가')],{chars:100001})],
    ['21 images',body(Array.from({length:21},(_,i)=>IMG('https://example.com/'+i)),{state:'image_only'})],
    ['images count differs',body([IMG('https://example.com/a')],{state:'image_only',images:2})],
    ['chars zero with text',body([P('가')],{state:'lead',reason:'paywall',chars:0})],
    ['not object',body(['가'])],
    ['no type',body([{text:'가'}])],
    ['html type',body([{t:'html',text:'<b>가</b>'}])],
    ['extra key',body([{t:'p',text:'가',html:'<b>'}])],
    ['empty text',body([P('')],{chars:1})],
    ['number text',body([{t:'p',text:5}])],
    ['control char',body([P('첫 줄\n둘째 줄')])],
    ['src in paragraph',body([{t:'p',text:'가',src:'https://example.com/a'}])],
    ['text in image',body([{t:'img',src:'https://example.com/a',text:'가'}],{state:'image_only'})],
    ['http image',body([IMG('http://example.com/a.png')],{state:'image_only'})],
    ['javascript image',body([IMG('javascript:alert(1)')],{state:'image_only'})],
    ['data image',body([IMG('data:image/png;base64,AAAA')],{state:'image_only'})],
    ['space in address',body([IMG('https://example.com/a b.png')],{state:'image_only'})],
    ['quote in address',body([IMG('https://example.com/a"onerror=x')],{state:'image_only'})],
    ['address 2001',body([IMG(long(2001))],{state:'image_only'})],
    ['caption 301',body([IMG('https://example.com/a','가'.repeat(301))],{state:'image_only'})],
    ['caption number',body([{t:'img',src:'https://example.com/a',cap:3}],{state:'image_only'})],
    ['ok with reason',body([P('가')],{reason:'paywall'})],
    ['image_only without image',body([P('가')],{state:'image_only'})],
    ['failed without reason',{state:'failed',reason:null}],
    ['failed with blocks',body([P('가')],{state:'failed',reason:'relay'})],
    ['unknown state',{state:'done',reason:null}],
    ['unknown reason',{state:'failed',reason:'nope'}],
    ['bad rule',body([P('가')],{rule:'Kptu'})],
   ];
   for(const [label,row] of bad)await assert.rejects(server(c=>put(c,{outside_post_id:ids.pa,...row})),{code:'23514'},label);
   await assert.rejects(server(c=>c.query("insert into public.app_feed_bodies(workspace_id,state,reason) values ($1,'failed','relay')",[WS_A])),{code:'23514'},'no item');
   await assert.rejects(server(c=>put(c,{outside_post_id:ids.pa,news_item_id:ids.na})),{code:'23514'},'two items');
  });

  await t.test('server: upsert one row per item, re-extract updates in place, other workspace item refused, no delete, no id',async()=>{
   const first=(await server(c=>put(c,{outside_post_id:ids.pa,...body([P('처음 뽑은 문단')])}))).rows[0].id;
   const again=(await server(c=>put(c,{outside_post_id:ids.pa,...body([P('다시 뽑은 문단'),IMG('https://example.com/b.jpg','캡션')],{rule:'kptu@2'})}))).rows[0].id;
   assert.equal(again,first,'one row per item');
   await server(c=>put(c,{news_item_id:ids.na,state:'failed',reason:'relay'}));
   await server(c=>put(c,{workspace_id:WS_B,news_item_id:ids.nb,state:'failed',reason:'off_host'}));
   await assert.rejects(server(c=>put(c,{outside_post_id:ids.pb,state:'failed',reason:'relay'})),{code:'23514'},'other workspace item');
   await assert.rejects(server(c=>c.query('update public.app_feed_bodies set workspace_id=$1 where outside_post_id=$2',[WS_B,ids.pa])),{code:'23514'});
   await assert.rejects(server(c=>c.query('delete from public.app_feed_bodies')),{code:'42501'});
   await assert.rejects(server(c=>c.query("insert into public.app_feed_bodies(id,workspace_id,news_item_id,state,reason) values (gen_random_uuid(),$1,$2,'failed','relay')",[WS_A,ids.na])),{code:'42501'});
   await assert.rejects(server(c=>c.query('update public.app_feed_bodies set created_at=now()')),{code:'42501'});
   const rows=(await pool.query('select rule,images,chars from public.app_feed_bodies where outside_post_id=$1',[ids.pa])).rows;
   assert.deepEqual(rows,[{rule:'kptu@2',images:1,chars:8}]);
  });

  await t.test('owner reads own rows only; no insert, update or delete; stranger sees own only; anon nothing',async()=>{
   assert.equal((await owner(c=>c.query('select count(*)::int n from public.app_feed_bodies'))).rows[0].n,2);
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_feed_bodies'))).rows[0].n,1);
   assert.equal((await owner(c=>c.query("select blocks->0->>'text' t from public.app_feed_bodies where outside_post_id=$1",[ids.pa]))).rows[0].t,'다시 뽑은 문단');
   await assert.rejects(owner(c=>put(c,{news_item_id:ids.na,state:'failed',reason:'timeout'})),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_feed_bodies set reason='timeout'")),{code:'42501'});
   await assert.rejects(owner(c=>c.query('delete from public.app_feed_bodies')),{code:'42501'});
   await assert.rejects(anon(c=>c.query('select 1 from public.app_feed_bodies')),{code:'42501'});
  });

  await t.test('isolation: only the guard names the table; nobody executes it; no view or other policy reads it',async()=>{
   const fns=(await pool.query("select p.oid::regprocedure::text f from pg_proc p where p.prosrc ~ 'app_feed_bodies'")).rows.map(r=>r.f);
   assert.deepEqual(fns,[]);
   for(const role of ['authenticated','anon','service_role'])
    assert.equal((await pool.query("select has_function_privilege($1,'private.app_feed_bodies_scope_guard()','execute') x",[role])).rows[0].x,false,role);
   assert.equal((await pool.query("select prosecdef d from pg_proc where oid='private.app_feed_bodies_scope_guard()'::regprocedure")).rows[0].d,false);
   assert.equal((await pool.query("select count(*)::int n from pg_views where definition ~ 'app_feed_bodies'")).rows[0].n,0);
  });

  await t.test('cascade: deleting the post or news item removes its body row',async()=>{
   await pool.query('delete from public.app_news_items where id=$1',[ids.nb]);
   assert.equal((await pool.query('select count(*)::int n from public.app_feed_bodies where news_item_id=$1',[ids.nb])).rows[0].n,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_feed_bodies')).rows[0].n,2);
  });

  await t.test('rollback: blocked while rows exist; then restores table, function and record; re-apply works',async()=>{
   {const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/FEED_BODIES_ROLLBACK_BLOCKED: rows exist/);await c.query('rollback');}finally{c.release();}}
   assert.notEqual((await pool.query("select to_regclass('public.app_feed_bodies') t")).rows[0].t,null);
   await pool.query('delete from public.app_feed_bodies');
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await allYes(postcheck);
   assert.equal(values(await readOnly(precheck))['new migration absent'],'예');
   assert.equal((await pool.query('select count(*)::int n from public.app_outside_posts')).rows[0].n,2,'posts untouched');
   const again=await run('apply','9994');assert.equal(again.ok,true,again.summary);
   await allYes(postcheck);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
