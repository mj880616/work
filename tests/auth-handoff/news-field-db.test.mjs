// Fresh local PostgreSQL only. No Supabase, Edge or production credentials. All data synthetic.
// S71-70 ② NEWS-분야칸(20261127013000_news_field): 공용 기사 app_news_articles에 news_field(정치·경제·사회·노동·칼럼·사설 키) 빈 칸과 검사.
// - 승인형 DB workflow(plan 규칙·dry-run·apply·사후 확인)를 통과하고 dry-run은 아무것도 안 바꾼다.
// - 기존 줄은 빈 값 그대로(값 변경 없음). 분야는 다섯 키 또는 빈 값만. 수집기(service_role)만 쓴다.
// - authenticated는 여전히 읽기만(새 칸도 못 씀), anon은 못 읽는다. 정책·권한·색인 그대로.
// - 되돌리기 뒤 snapshot·precheck 같음, 다시 적용 가능.
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
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261127013000',name='news_field',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// 운영과 같은 모양의 앞 조건(칸은 이 시험에 필요한 만큼): RLS 켜짐, 읽기 정책 둘, authenticated 읽기만, service_role 쓰기, anon 없음.
const prerequisites=`
  create table public.app_news_articles(
    id uuid primary key default gen_random_uuid(), origin text not null, lane text not null, url text not null, url_key text not null unique,
    title text, source_key text, published_at timestamptz, scrapped_at timestamptz,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    news_rank smallint, kst_day date default ((now() at time zone 'Asia/Seoul')::date),
    constraint app_news_articles_news_rank_check check (news_rank is null or news_rank between 1 and 3),
    constraint app_news_articles_origin_check check (origin in ('site','tg_room','tg_scrap','user')));
  create index app_news_articles_list_idx on public.app_news_articles(coalesce(published_at, scrapped_at, created_at) desc);
  create index app_news_articles_day_rank_idx on public.app_news_articles(kst_day desc nulls last, news_rank asc nulls last, created_at desc, id desc);
  alter table public.app_news_articles enable row level security;
  revoke all on table public.app_news_articles from public, anon, authenticated, service_role;
  grant select on table public.app_news_articles to authenticated;
  grant select, insert, update, delete on table public.app_news_articles to service_role;
  create policy news_articles_reader_select on public.app_news_articles for select to authenticated using (origin in ('site','tg_room'));
  create policy news_articles_scrap_operator_select on public.app_news_articles for select to authenticated using (origin = 'tg_scrap' and auth.uid() = '${OWNER}'::uuid);
  insert into supabase_migrations.schema_migrations(version,name) values ('20261115100000','news_for_all'),('20261115230000','news_user_save'),('20261116130000','news_rank_order');
  insert into public.app_news_articles(origin,lane,url,url_key,title,source_key,created_at) values
    ('site','media','https://news.example.test/a/1','news.example.test/a/1','가상 기사 하나','news-sample','2026-11-14T16:30:00Z'),
    ('site','media','https://news.example.test/a/2','news.example.test/a/2','가상 기사 둘','news-sample','2026-11-15T01:00:00Z'),
    ('tg_room','channel','https://news.example.test/a/3','news.example.test/a/3','가상 채널 글',null,'2026-11-15T10:00:00Z');`;

test('news field: plan, dry-run, apply, empty old rows, five keys only, read-only for users, rollback',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'news-field-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;
  const checkOf=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));

  await t.test('precheck values before apply',()=>{
   const v=checkOf(beforeCheck);
   assert.deepEqual([v['prerequisite recorded'],v['new migration absent'],v['new column count'],v['new check count'],v['RLS enabled'],
    v['anon or public table privilege'],v['authenticated read only'],v['service_role can write'],v['two reader policies']],
    ['예','예','0','0','예','아니오','예','예','예']);
  });
  await t.test('the approved workflow plan accepts the file and its five pair files',()=>{
   const p=plan('apply','9900');assert.ok(p&&p.ok!==false,JSON.stringify(p?.summary??p).slice(0,400));
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9901');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('prerequisite changes stop the migration without any change',async()=>{
   const attempts=[
    ['grant select on public.app_news_articles to anon','revoke select on public.app_news_articles from anon'],
    ['alter table public.app_news_articles disable row level security','alter table public.app_news_articles enable row level security'],
    ['grant update on public.app_news_articles to authenticated','revoke update on public.app_news_articles from authenticated'],
    ['grant update (title) on public.app_news_articles to authenticated','revoke update (title) on public.app_news_articles from authenticated'],
    ["create policy synthetic_extra on public.app_news_articles for select to authenticated using (true)",'drop policy synthetic_extra on public.app_news_articles'],
    ['alter table public.app_news_articles add column news_field text','alter table public.app_news_articles drop column news_field'],
    ["delete from supabase_migrations.schema_migrations where version='20261116130000'","insert into supabase_migrations.schema_migrations(version,name) values('20261116130000','news_rank_order')"],
   ];
   for(const [breakIt,fixIt] of attempts){
    await pool.query(breakIt);
    try{const c=await pool.connect();try{await assert.rejects(c.query(migration),/NEWS_FIELD_PREREQUISITE_CHANGED/,breakIt);await c.query('rollback');}finally{c.release();}}
    finally{await pool.query(fixIt);}
   }
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; old rows stay empty; grants, policies and indexes unchanged',async()=>{
   const apply=await run('apply','9902');assert.equal(apply.ok,true,apply.summary);
   const post=(await pool.query(postcheck)).rows;
   assert.ok(post.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'),JSON.stringify(post));
   for(const r of post.filter(r=>!/^(예|아니오)$/.test(r.value)))assert.equal(r.value,checkOf(beforeCheck)[r.item],r.item);
   assert.deepEqual((await pool.query('select news_field f from public.app_news_articles')).rows,[{f:null},{f:null},{f:null}]);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid='public.app_news_articles'::regclass")).rows[0].n,2);
   assert.equal((await pool.query("select relacl::text acl from pg_class where oid='public.app_news_articles'::regclass")).rows[0].acl.match(/authenticated=[a-z]*/)[0],'authenticated=r');
  });
  await t.test('the collector (service_role) writes the five keys or null; other values are refused',async()=>{
   const ins=(url,field)=>as('service_role','',c=>c.query("insert into public.app_news_articles(origin,lane,url,url_key,title,source_key,news_field) values('site','media',$1,$2,'가상 새 기사','news-sample',$3)",[url,url.replace('https://',''),field]));
   for(const [i,f] of ['politics','economy','society','labor','opinion',null].entries())await ins('https://news.example.test/b/'+i,f);
   for(const bad of ['culture','정치','sports',''])await assert.rejects(ins('https://news.example.test/bad/'+encodeURIComponent(bad||'empty'),bad),{code:'23514'},bad);
   // 옛 줄 채우기(Edge prune 단계와 같은 모양: id로 빈 줄만).
   assert.equal((await as('service_role','',c=>c.query("update public.app_news_articles set news_field='society' where url_key='news.example.test/a/1' and news_field is null"))).rowCount,1);
   const post=(await pool.query(postcheck)).rows;assert.ok(post.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'),JSON.stringify(post));
  });
  await t.test('signed-in users read the column but cannot write it; anon cannot read',async()=>{
   const rows=(await as('authenticated',STRANGER,c=>c.query('select news_field from public.app_news_articles'))).rows;assert.equal(rows.length,9);
   await assert.rejects(as('authenticated',OWNER,c=>c.query("update public.app_news_articles set news_field='labor'")),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query('select news_field from public.app_news_articles limit 1')),{code:'42501'});
  });
  await t.test('rollback restores the original schema (rows kept); re-apply works',async()=>{
   const n=(await pool.query('select count(*)::int n from public.app_news_articles')).rows[0].n;
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_news_articles')).rows[0].n,n,'articles are kept');
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const pre=checkOf((await pool.query(precheck)).rows),was=checkOf(beforeCheck);for(const k of Object.keys(was))assert.equal(pre[k],was[k],k);
   const again=await run('apply','9905');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
