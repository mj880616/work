// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S71-68 ② READ-원문고치기 DB(20261126233000_feed_body_edits):
// - 새 표 app_feed_body_edits: 내 작업공간만(RLS·정책 1개). 화면은 작업공간·글·블록·시각 넣기 / 블록·시각 고치기 / 읽기 / 지우기만. 작업공간·글은 못 고친다.
//   service_role·anon 권한 없음. 남의 작업공간 고친 원문은 못 보고 못 넣고 못 고치고 못 지운다. 글은 뉴스·사회운동 중 하나만, 같은 글은 한 줄.
// - 블록 모양 검사(공용 본문과 같음): 종류·https 사진·제어 글자·다른 칸·빈 배열 거절.
// - 승인형 DB workflow 확장 규칙·전체 흐름 통과, 사전 조건 다르면 멈춤, dry-run은 아무것도 안 바꿈, 되돌리기(SQL Editor)는 고친 원문이 있으면 멈추고 없으면 이전 판으로.
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
const FN='20261126233000',FN_NAME='feed_body_edits',stem=FN+'_'+FN_NAME;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const NA='32000000-0000-4000-8000-0000000000a1',OA='32000000-0000-4000-8000-0000000000b1';
// 공용 글 두 표는 이 시험에 필요한 모양만(합성 — id 칸과 가입자 읽기 정책 하나).
const SHARED=`
create table public.app_news_articles(id uuid primary key, title text);
create table public.app_outside_articles(id uuid primary key, title text);
alter table public.app_news_articles enable row level security;
alter table public.app_outside_articles enable row level security;
grant select on table public.app_news_articles to authenticated;
grant select on table public.app_outside_articles to authenticated;
create policy news_articles_read on public.app_news_articles for select to authenticated using (true);
create policy outside_articles_read on public.app_outside_articles for select to authenticated using (true);
insert into supabase_migrations.schema_migrations(version,name) values ('20261115100000','news_for_all'),('20261115150000','outside_for_all');
insert into public.app_news_articles(id,title) values ('${NA}','예시 기사');
insert into public.app_outside_articles(id,title) values ('${OA}','예시 성명');`;
const P=t=>({t:'p',text:t});

test('READ-원문고치기 DB: owner-only edited article copies — plans, guard, dry-run, apply, rollback',{timeout:240000},async t=>{
 let cluster,pool,port,password='';
 const directory=await mkdtemp(join(tmpdir(),'feed-body-edits-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));port=sock.address().port;await new Promise(r=>sock.close(r));
 password=randomBytes(24).toString('hex');
 cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 await cluster.initialise();await cluster.start();
 try{
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(SHARED);
  const F={migration:await read('supabase/migrations/'+stem+'.sql'),rollback:await read('docs/'+stem+'.rollback.sql'),precheck:await read('docs/'+stem+'.precheck.sql'),
    postcheck:await read('docs/'+stem+'.postcheck.sql'),snapshot:await read('docs/'+stem+'.snapshot.sql'),summary:await read('docs/'+stem+'.summary.md')};
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version:FN,runId:run,root});
  const run=p=>runMigrationPlan(p,query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const history=async v=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[v])).rows[0].n;
  const checks=async sql=>Object.fromEntries((await pool.query(sql)).rows.map(r=>[r.item,r.value]));
  const before=(await pool.query(F.snapshot)).rows;
  const pre=await checks(F.precheck);

  await t.test('files: 5 pair files, summary 3 lines, no definer/anon/rtw/function; expanded workflow full flow; rollback is SQL Editor only',()=>{
   const lines=F.summary.trim().split('\n');assert.equal(lines.length,3);
   ['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   for(const sql of [F.migration,F.rollback]){
    const code=sql.replace(/--.*$/gm,'');
    assert.doesNotMatch(code,/security definer|\bto (anon|public)\b|disable row level|rtw_|create extension|create (or replace )?function|update public|insert into public/i);
    assert.match(code,/^begin;/);assert.match(code,/commit;\s*$/);
   }
   const code=F.migration.replace(/--.*$/gm,'');
   assert.match(code,/revoke all on table public\.app_feed_body_edits from public, anon, authenticated, service_role;/);
   assert.match(code,/grant insert \(workspace_id, news_article_id, outside_article_id, blocks, edited_at\) on table public\.app_feed_body_edits to authenticated;/);
   assert.match(code,/grant update \(blocks, edited_at\) on table public\.app_feed_body_edits to authenticated;/);
   assert.doesNotMatch(code,/to service_role/);
   assert.match(F.migration,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\nvalues \('20261126233000', 'feed_body_edits'/);
   for(const mode of ['apply','dry-run']){const p=plan(mode,'1');assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');}
   assert.throws(()=>plan('rollback','1'));
  });

  await t.test('precheck before apply: every yes/no item is 예',()=>{
   for(const [item,value] of Object.entries(pre))if(!/hash$/.test(item))assert.equal(value,'예',item);
  });

  await t.test('prerequisite guard stops when the table or a record differs',async()=>{
   for(const change of [
    `create table public.app_feed_body_edits(id uuid)`,
    `delete from supabase_migrations.schema_migrations where version='20261115150000'`,
    `drop table public.app_news_articles`,
   ]){
    const c=await pool.connect();
    try{await c.query('begin');await c.query(change);
     await assert.rejects(c.query(F.migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/FEED_BODY_EDITS_PREREQUISITE_CHANGED/,change);}
    finally{await c.query('rollback');c.release();}
   }
   assert.equal(await history(FN),0);
  });

  await t.test('dry-run leaves nothing; apply passes postcheck; second apply refused',async()=>{
   const dry=await run(plan('dry-run','9841'));assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(F.snapshot)).rows,before);
   const apply=await run(plan('apply','9842'));assert.equal(apply.ok,true,apply.summary);
   const post=await checks(F.postcheck);
   for(const [item,value] of Object.entries(post))assert.equal(value,/hash$/.test(item)?pre[item]:'예',item);
   assert.equal(await history(FN),1);
   assert.equal((await run(plan('apply','9843'))).ok,false);
   assert.equal(await history(FN),1);
  });

  await t.test('edited copies: owner only; one article; same article once; workspace and article fixed; stranger, anon, service_role refused',async()=>{
   const put=(c,ws,col,id,blocks)=>c.query(`insert into public.app_feed_body_edits(workspace_id,${col},blocks) values ($1,$2,$3::jsonb) returning id`,[ws,id,JSON.stringify(blocks)]);
   const blocks=[P('고친 첫 문단'),{t:'img',src:'https://img.example.com/a.jpg',cap:'설명',alt:null},P('고친 둘째 문단')];
   await as('authenticated',OWNER,c=>put(c,WS_A,'news_article_id',NA,blocks));
   await as('authenticated',OWNER,c=>put(c,WS_A,'outside_article_id',OA,[P('사회운동 글 고친 문단')]));
   await as('authenticated',STRANGER,c=>put(c,WS_B,'news_article_id',NA,[P('남의 고친 원문')]));
   // 남의 작업공간에 넣기 거절, 같은 글 두 줄 거절, 글 둘 다·둘 다 없음 거절.
   await assert.rejects(as('authenticated',OWNER,c=>put(c,WS_B,'outside_article_id',OA,[P('몰래')])),{code:'42501'});
   await assert.rejects(as('authenticated',OWNER,c=>put(c,WS_A,'news_article_id',NA,[P('또')])),{code:'23505'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query(`insert into public.app_feed_body_edits(workspace_id,news_article_id,outside_article_id,blocks) values ($1,$2,$3,'[{"t":"p","text":"둘"}]')`,[WS_A,NA,OA])),{code:'23514'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query(`insert into public.app_feed_body_edits(workspace_id,blocks) values ($1,'[{"t":"p","text":"없음"}]')`,[WS_A])),{code:'23514'});
   // 없는 글 id 거절.
   await assert.rejects(as('authenticated',OWNER,c=>put(c,WS_A,'news_article_id','32000000-0000-4000-8000-0000000000ff',[P('없는 글')])),{code:'23503'});
   // 블록 모양 거절: 빈 배열·모르는 종류·http 사진·제어 글자·다른 칸·글자 아닌 text.
   for(const bad of [[],[{t:'script',text:'x'}],[{t:'img',src:'http://img.example.com/a.jpg'}],[{t:'img',src:'javascript:alert(1)'}],[P('줄\u0001바꿈')],[{t:'p',text:'a',html:'<b>'}],[{t:'p',text:1}],{t:'p',text:'a'}])
    await assert.rejects(as('authenticated',OWNER,c=>c.query(`update public.app_feed_body_edits set blocks=$2::jsonb where news_article_id=$1 and workspace_id='${WS_A}'`,[NA,JSON.stringify(bad)])),{code:'23514'},JSON.stringify(bad));
   // 보기는 자기 것만.
   const mine=async sub=>(await as('authenticated',sub,async c=>(await c.query('select workspace_id from public.app_feed_body_edits order by 1')).rows)).map(r=>r.workspace_id);
   assert.deepEqual(await mine(OWNER),[WS_A,WS_A]);
   assert.deepEqual(await mine(STRANGER),[WS_B]);
   // 블록·시각 고치기는 자기 것만, 작업공간·글·id는 못 고친다.
   assert.equal(await as('authenticated',OWNER,async c=>(await c.query(`update public.app_feed_body_edits set blocks='[{"t":"p","text":"다시 고침"}]',edited_at=now() where news_article_id=$1`,[NA])).rowCount),1);
   assert.equal((await pool.query(`select blocks from public.app_feed_body_edits where workspace_id=$1 and news_article_id=$2`,[WS_B,NA])).rows[0].blocks[0].text,'남의 고친 원문','남의 줄은 그대로');
   for(const set of [`workspace_id='${WS_B}'`,`news_article_id=null`,`outside_article_id='${OA}'`,`id=gen_random_uuid()`])
    await assert.rejects(as('authenticated',OWNER,c=>c.query(`update public.app_feed_body_edits set ${set} where news_article_id=$1`,[NA])),{code:'42501'},set);
   // 지우기도 자기 것만(남의 줄 0).
   assert.equal(await as('authenticated',STRANGER,async c=>(await c.query(`delete from public.app_feed_body_edits where workspace_id=$1`,[WS_A])).rowCount),0);
   for(const role of ['anon','service_role'])
    for(const sql of ['select id from public.app_feed_body_edits',`insert into public.app_feed_body_edits(workspace_id,news_article_id,blocks) values ('${WS_A}','${NA}','[{"t":"p","text":"x"}]')`,
      `update public.app_feed_body_edits set blocks='[{"t":"p","text":"x"}]'`,'delete from public.app_feed_body_edits'])
     await assert.rejects(as(role,'',c=>c.query(sql)),{code:'42501'},role+' '+sql);
   // 처음 원문으로 되돌리기 = 내 줄 지우기(공용 글은 그대로).
   assert.equal(await as('authenticated',OWNER,async c=>(await c.query(`delete from public.app_feed_body_edits where outside_article_id=$1`,[OA])).rowCount),1);
   assert.equal((await pool.query('select count(*)::int n from public.app_outside_articles')).rows[0].n,1);
  });

  await t.test('rollback (SQL Editor) stops while edited copies exist, then drops the table and restores the snapshot',async()=>{
   await assert.rejects(pool.query(F.rollback),/FEED_BODY_EDITS_ROLLBACK_BLOCKED: edited copies exist/);await pool.query('rollback');
   assert.equal(await history(FN),1);
   await pool.query('delete from public.app_feed_body_edits');
   await pool.query(F.rollback);
   assert.equal(await history(FN),0);
   assert.deepEqual((await pool.query(F.snapshot)).rows,before);
   assert.deepEqual(await checks(F.precheck),pre);
   for(const [item,value] of Object.entries(await checks(F.postcheck)))assert.equal(value,/hash$/.test(item)?pre[item]:'예',item);
   await assert.rejects(pool.query(F.rollback),/FEED_BODY_EDITS_ROLLBACK_BLOCKED/);await pool.query('rollback');
   await pool.query(F.migration);
   assert.equal(await history(FN),1);
  });
 }finally{
  await closePool(pool);
  if(cluster)await cluster.stop().catch(()=>{});
 }
});
