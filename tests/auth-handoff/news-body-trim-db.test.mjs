// Fresh local PostgreSQL only. No Supabase, Edge or production credentials. All data synthetic.
// S73-01 NEWS-본문하루(20261127180000_news_body_trim + docs/ops/news-body-trim-daily.*, SQL Editor).
// - 승인형 workflow plan(확장 규칙)·사전 조건 멈춤·dry-run·apply·사후 확인, 적용 순간에는 한 줄도 비우지 않음. rollback 모드는 받지 않음(SQL Editor 전용).
// - 받은 지 24시간 지난 언론 기사만 본문 칸(body·body_kind·body_ko)·본문 블록을 비움, 제목·요약·주소·번역 제목·날짜는 그대로.
//   번역 시각은 번역 제목이 없을 때만 함께 비움. 블록 줄은 비운 표시 줄(trim@1)로 — 없던 기사에는 하나 넣음, 옛 표는 있는 줄만.
// - 사람이 남긴 것은 본문도 그대로: 읽을 거리 줄(연결·같은 주소)·직접 넣은 기사·손으로 고친 기사·노트 메모(지도 옛 id)·밑줄·옛 표 별표, 손 본문 블록, 읽기 전 기사.
// - 두 번 불러도 같은 결과(이미 비운 기사는 다시 고르지 않음), p_limit 지킴, service_role만 실행.
// - 매일 정리(SQL Editor 조각 ①): 가짜 cron 스키마로 이전 본문 → 본문 비우기를 부르는 본문, 되돌리기는 이전 본문 그대로.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {trackPool,closePool} from './pg-close.mjs';
import {OWNER,WS_A,WS_B} from './basket4-fixture.mjs';
import {setupSteps} from './reading-one-store-fixture.mjs';
import {prepareMigration,toDryRun} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261127180000',name='news_body_trim',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const A=n=>'41000000-0000-4000-8000-0000000000'+String(n).padStart(2,'0'),I=n=>'44000000-0000-4000-8000-0000000000'+String(n).padStart(2,'0');
const md5=s=>createHash('md5').update(s).digest('hex');
const fakeCron=`
  create schema cron;
  create table cron.job(jobid bigserial primary key, jobname text unique, schedule text not null, command text not null, active boolean not null default true);
  create table cron.job_run_details(runid bigserial primary key, jobid bigint, status text, return_message text, start_time timestamptz, end_time timestamptz);
  create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as
    $f$ insert into cron.job(jobname,schedule,command) values (p_name,p_schedule,p_command) returning jobid $f$;
  create function cron.unschedule(p_name text) returns boolean language sql as $f$ with d as (delete from cron.job where jobname = p_name returning 1) select count(*) = 1 from d $f$;`;
const fragment=(sql,n)=>sql.slice(sql.indexOf(`-- ===== 조각 ${n} 시작`),sql.indexOf(`-- ===== 조각 ${n} 끝`));

test('news body trim: plan, guard, dry-run, apply, 24h rule, kept human marks, markers, service role only, daily job, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'news-trim-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  for(const sql of await setupSteps(read))await pool.query(sql);
  await pool.query(await read('supabase/migrations/20261122230000_reading_one_store.sql'));
  const q=(sql,p)=>pool.query(sql,p);

  // ---- 합성 기사(제목·내용은 가짜). 받은 시각은 지금(now)에서 거꾸로 센다.
  const art=(n,hours,x={})=>q(`insert into public.app_news_articles(id,origin,lane,url,url_key,title,summary,state,created_at,manual_at,body,body_kind,title_ko,body_ko,translated_at,lang)
    values ($1,$2,'media',$3,$4,'합성 기사','합성 요약',$5,now()-make_interval(hours=>$6),$7,$8,$9,$10,$11,$12,$13)`,
    [A(n),x.origin||'site','https://news.example.org/t/'+n,'news.example.org/t/'+n,x.state||'ok',hours,x.manual?'2026-11-01T00:00:00Z':null,
     x.body===undefined?'합성 본문':x.body,x.body===null?null:'full',x.titleKo||null,x.bodyKo||null,(x.titleKo||x.bodyKo)?'2026-11-01T00:00:00Z':null,x.lang||'ko']);
  const blocks=(n,rule=null)=>q(`insert into public.app_news_article_bodies(article_id,blocks,state,rule,chars,extracted_at) values ($1,'[{"t":"p","text":"합성"}]'::jsonb,'ok',$2,2,'2026-11-01T00:00:00Z')`,[A(n),rule]);
  const old=(n,ws,hours,x={})=>q(`insert into public.app_news_items(id,workspace_id,lane,url,url_key,title,summary,state,created_at,starred_at,body,body_kind)
    values ($1,$2,'media',$3,$4,'합성 기사','합성 요약','ok',now()-make_interval(hours=>$5),$6,'합성 본문','full')`,
    [I(n),ws,'https://news.example.org/t/'+n,'news.example.org/t/'+n,hours,x.star?'2026-11-01T00:00:00Z':null]);
  const oldBlocks=(n,ws)=>q(`insert into public.app_feed_bodies(workspace_id,news_item_id,blocks,state,chars) values ($1,$2,'[{"t":"p","text":"합성"}]'::jsonb,'ok',2)`,[ws,I(n)]);
  // 비울 것: 1(본문·블록·번역 본문만 — 번역 시각도 비움), 2(번역 제목 있음 → 번역 시각 남음), 10(블록 줄 없음 → 표시 줄 넣음)
  await art(1,30,{lang:'en',bodyKo:'합성 번역 본문'});await blocks(1);await old(1,WS_A,30);await oldBlocks(1,WS_A);
  await art(2,30,{lang:'en',titleKo:'합성 번역 제목',bodyKo:'합성 번역 본문'});await blocks(2);
  await art(10,30);
  // 남길 것
  await art(3,23);await blocks(3);await old(3,WS_A,23);await oldBlocks(3,WS_A);   // 24시간 안
  await art(4,30);await blocks(4);                                                // 읽을 거리 줄이 가리킴
  await art(5,30);                                                                // 같은 주소 직접 저장 줄
  await art(6,30);await old(6,WS_B,30);await q('insert into public.app_news_id_map(old_id,workspace_id,article_id) values ($1,$2,$3)',[I(6),WS_B,A(6)]);
  await q('insert into public.app_notes(workspace_id,raw_text,metadata,deleted_at) values ($1,$2,$3::jsonb,now())',[WS_B,'합성 메모',JSON.stringify({news_item_id:I(6)})]); // 휴지통 노트·옛 id
  await art(7,30);await q(`insert into public.app_news_highlights(workspace_id,source_type,source_id,quote) values ($1,'news',$2,'합성 밑줄')`,[WS_A,A(7)]);
  await art(8,30,{manual:true});await art(9,30,{origin:'user'});
  await art(11,30,{state:'pending',body:null});                                  // 읽기 전
  await art(12,30);await blocks(12,'manual@1');                                   // 손 본문 블록
  await art(13,30);await old(13,WS_A,30,{star:true});await oldBlocks(13,WS_A);    // 옛 표 별표 → 공용·옛 줄 모두
  await q(`insert into public.app_reading_items(workspace_id,url,title,origin,news_article_id) values ($1,'https://news.example.org/t/4','합성','news',$2)`,[WS_A,A(4)]);
  await q(`insert into public.app_reading_items(workspace_id,url,title) values ($1,'https://news.example.org/t/5','합성')`,[WS_B]);

  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const history=async()=>(await q('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  const state=async()=>({
   arts:(await q('select id::text id,title,summary,url,state,created_at,body,body_kind,title_ko,body_ko,translated_at,updated_at from public.app_news_articles order by id')).rows,
   bodies:(await q('select article_id::text id,blocks,state,reason,rule,chars,images,extracted_at from public.app_news_article_bodies order by article_id')).rows,
   olds:(await q('select id::text id,body,body_kind,body_ko from public.app_news_items order by id')).rows,
   oldBodies:(await q('select news_item_id::text id,blocks,state,reason,rule from public.app_feed_bodies where news_item_id is not null order by news_item_id')).rows});
  const trim=(limit=5000)=>as('service_role','',async c=>(await c.query('select public.app_news_trim_bodies(now(),$1) n',[limit])).rows[0].n);
  const before=(await q(snapshot)).rows,rows0=await state();let pre;

  await t.test('files: expanded full flow, three-line summary, no anon/PUBLIC/rtw, no top-level row change, rollback is SQL Editor only',async()=>{
   for(const mode of ['apply','dry-run']){const p=prepareMigration({mode,version,runId:'1',root});assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');assert.deepEqual([...p.targets],[]);}
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
   assert.match(rollbackSQL,/SQL Editor 전용/);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);
   ['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bto (anon|public|authenticated)\b|disable row level|rtw_|create policy|drop policy|app_feed_items|app_family|app_tg_|app_call_|app_outside_|app_feed_body_edits/i);
   assert.doesNotMatch(code,/grant [^;]* on table/i,'표 권한은 그대로');
   assert.match(code,/grant execute on function public\.app_news_trim_bodies\(timestamptz, integer\) to service_role;/);
   const top=code.replace(/\$\$[\s\S]*?\$\$|\$trim\$[\s\S]*?\$trim\$/g,'');
   assert.doesNotMatch(top,/\b(update|delete from|insert into) public\./i,'적용 순간에는 줄을 바꾸지 않음');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot은 앱 표를 읽지 않음');
   // 남길 묶음은 지우기 함수(app_news_prune, 20261122230000 판)와 같은 글.
   const prune=await read('supabase/migrations/20261122230000_reading_one_store.sql');
   const kept=s=>s.slice(s.indexOf('with kept_ids as ('),s.indexOf('), ',s.indexOf('select i.url_key from public.app_news_items i where i.starred_at')));
   const pruneFn=prune.slice(prune.indexOf('create or replace function public.app_news_prune'));
   assert.equal(kept(migration),kept(pruneFn));
  });

  await t.test('precheck before apply: all 예, no marker rows',async()=>{
   pre=values(await readOnly(precheck));
   for(const [k,v] of Object.entries(pre))if(/^(예|아니오)$/.test(v))assert.equal(v,'예',k);
   assert.equal(pre['trim marker rows'],'0');
   assert.match(pre['news articles size MB'],/^\d+(\.\d)?$/);
  });

  await t.test('guard stops when the prune function changed, a record is missing or the function exists',async()=>{
   for(const change of [
    `create or replace function public.app_news_prune(p_now timestamptz, p_limit integer) returns integer language plpgsql security definer set search_path = '' as $f$ begin return 0; end $f$`,
    `delete from supabase_migrations.schema_migrations where version='20261122230000'`,
    `create function public.app_news_trim_bodies(p_now timestamptz, p_limit integer) returns integer language sql as $f$ select 0 $f$`,
   ]){
    const c=await pool.connect();
    try{await c.query('begin');await c.query(change);
     await assert.rejects(c.query(migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/NEWS_BODY_TRIM_PREREQUISITE_CHANGED/,change);}
    finally{await c.query('rollback');c.release();}
   }
   assert.equal(await history(),0);
  });

  await t.test('dry-run and apply change no rows; postcheck passes; second apply refused',async()=>{
   const dry=await run('dry-run','9991');assert.equal(dry.ok,true,dry.summary);
   assert.equal(await history(),0);assert.deepEqual((await q(snapshot)).rows,before);
   const result=await run('apply','9992');assert.equal(result.ok,true,result.summary);
   assert.equal(await history(),1);assert.deepEqual(await state(),rows0,'적용 순간에는 줄을 바꾸지 않음');
   const post=values(await readOnly(postcheck));
   for(const [k,v] of Object.entries(post))if(/^(예|아니오)$/.test(v))assert.equal(v,'예',k);
   assert.equal(post['trim marker rows'],pre['trim marker rows']);
   const again=await run('apply','9993');assert.equal(again.ok,false);
  });

  await t.test('only service_role runs it',async()=>{
   for(const role of ['authenticated','anon'])await assert.rejects(as(role,OWNER,c=>c.query('select public.app_news_trim_bodies(now(),10)')),{code:'42501'});
  });

  await t.test('trim: 24h rule, kept marks, markers, limit, idempotent',async()=>{
   assert.equal(await trim(1),2,'p_limit은 공용·옛 표 따로');
   const n=await trim();assert.equal(n,2,'나머지 공용 기사 둘(옛 표는 이미 끝남)');
   assert.equal(await trim(),0,'두 번 불러도 다시 고르지 않음');
   const s=await state(),a=Object.fromEntries(s.arts.map(r=>[r.id,r])),a0=Object.fromEntries(rows0.arts.map(r=>[r.id,r]));
   const b=Object.fromEntries(s.bodies.map(r=>[r.id,r])),b0=Object.fromEntries(rows0.bodies.map(r=>[r.id,r]));
   for(const k of [1,2,10]){
    const r=a[A(k)],r0=a0[A(k)];
    assert.equal(r.body,null,k);assert.equal(r.body_kind,null,k);assert.equal(r.body_ko,null,k);
    for(const c of ['title','summary','url','state','created_at','title_ko','updated_at'])assert.deepEqual(r[c],r0[c],k+' '+c+' 그대로');
    assert.deepEqual({blocks:b[A(k)].blocks,state:b[A(k)].state,reason:b[A(k)].reason,rule:b[A(k)].rule,chars:b[A(k)].chars,images:b[A(k)].images},
     {blocks:[],state:'failed',reason:'no_body',rule:'trim@1',chars:0,images:0},k+' 비운 표시 줄');
   }
   assert.equal(a[A(1)].translated_at,null,'번역 제목이 없으면 번역 시각도 비움');
   assert.deepEqual(a[A(2)].translated_at,a0[A(2)].translated_at,'번역 제목이 있으면 번역 시각 그대로');
   assert.deepEqual(b[A(1)].extracted_at,b0[A(1)].extracted_at,'뽑은 시각 그대로(요약 저장본 유지)');
   for(const k of [3,4,5,6,7,8,9,11,12,13])assert.deepEqual(a[A(k)],a0[A(k)],'남김 '+k);
   for(const k of [3,4,12])assert.deepEqual(b[A(k)],b0[A(k)],'블록 남김 '+k);
   for(const k of [5,6,7,8,9,11,13])assert.equal(b[A(k)],undefined,'남긴 기사에는 표시 줄을 넣지 않음 '+k);
   const o=Object.fromEntries(s.olds.map(r=>[r.id,r])),ob=Object.fromEntries(s.oldBodies.map(r=>[r.id,r])),ob0=Object.fromEntries(rows0.oldBodies.map(r=>[r.id,r]));
   assert.deepEqual(o[I(1)],{id:I(1),body:null,body_kind:null,body_ko:null});
   assert.deepEqual({blocks:ob[I(1)].blocks,state:ob[I(1)].state,reason:ob[I(1)].reason,rule:ob[I(1)].rule},{blocks:[],state:'failed',reason:'no_body',rule:'trim@1'});
   for(const k of [3,6,13])assert.equal(o[I(k)].body,'합성 본문','옛 줄 남김 '+k);
   for(const k of [3,13])assert.deepEqual(ob[I(k)],ob0[I(k)],'옛 블록 남김 '+k);
   assert.equal((await q('select count(*)::int n from public.app_news_articles')).rows[0].n,rows0.arts.length,'줄은 지우지 않음');
   // 사람이 다시 읽어 본문이 생기면(수집기가 표시 줄을 새 결과로 덮음) 다음 정리 때 다시 비운다.
   await q(`update public.app_news_article_bodies set blocks='[{"t":"p","text":"합성"}]'::jsonb,state='ok',reason=null,rule='open@3',chars=2 where article_id=$1`,[A(10)]);
   await q("update public.app_news_articles set body='합성 본문',body_kind='full' where id=$1",[A(10)]);
   assert.equal(await trim(),1);
   assert.equal((await q('select rule from public.app_news_article_bodies where article_id=$1',[A(10)])).rows[0].rule,'trim@1');
  });

  await t.test('daily job (SQL Editor fragment ①): calls the trim, keeps every other line, rollback restores the earlier body',async()=>{
   const ops=await read('docs/ops/news-body-trim-daily.apply.sql'),back=await read('docs/ops/news-body-trim-daily.rollback.sql'),look=await read('docs/ops/news-body-trim-daily.precheck.sql');
   const base=await read('docs/ops/retention-daily.apply.sql');
   for(const s of [ops,back])assert.doesNotMatch(s.replace(/--.*$/gm,''),/\bto (anon|public|authenticated|service_role)\b|grant /i);
   await q(fakeCron);await q("alter database postgres set cron.timezone = 'GMT'");
   const c=await pool.connect();
   const src=async()=>(await c.query("select prosrc from pg_proc where oid='private.app_retention_daily()'::regprocedure")).rows[0].prosrc;
   try{
    await c.query("set cron.timezone = 'GMT'");
    await c.query(fragment(base,'①'));
    const oldSrc=await src();
    await c.query(fragment(ops,'①'));
    const newSrc=await src();
    // 더한 것은 본문 비우기 반복 한 묶음·돌려주는 값 하나뿐.
    assert.equal(newSrc.replace(/\n  -- S73-01[^\n]*\n  for i in 1\.\.20 loop\n    v_n := public\.app_news_trim_bodies\(pg_catalog\.now\(\), 5000\);\n    v_bodies := v_bodies \+ v_n;\n    exit when v_n = 0;\n  end loop;/,'')
     .replace("\n  v_bodies integer := 0;",'').replace("'news_bodies', v_bodies, ",''),oldSrc);
    assert.equal((await c.query("select count(*)::int n from cron.job where jobname='web2_retention_daily'")).rows[0].n,1,'예약은 그대로');
    await assert.rejects(c.query(fragment(ops,'①')),/NEWS_BODY_TRIM_DAILY_PREREQUISITE_CHANGED/);await c.query('rollback');
    for(const role of ['authenticated','service_role','anon']){
     await c.query('begin');await c.query('set local role '+role);
     await assert.rejects(c.query('select private.app_retention_daily()'),{code:'42501'});await c.query('rollback');
    }
    await q(`update public.app_news_articles set body='합성 본문',body_kind='full' where id=$1`,[A(10)]);
    await q(`update public.app_news_article_bodies set blocks='[{"t":"p","text":"합성"}]'::jsonb,state='ok',reason=null,rule='open@3',chars=2 where article_id=$1`,[A(10)]);
    const out=(await c.query('select private.app_retention_daily() r')).rows[0].r;
    assert.equal(out.news_bodies,1);assert.ok('news' in out && 'outside' in out && 'cron_runs' in out && 'backups' in out);
    const v=values((await c.query(look)).rows);
    assert.equal(v['daily function version'],'본문 비우기 포함(조각 ① 뒤)');assert.equal(v['trim migration applied'],'예');
    // 조각 ②: 지금 한 번(남은 것 없음 → 0)
    await c.query(fragment(ops,'②'));
    await c.query(back);
    assert.equal(await src(),oldSrc,'되돌리기 = 이전 본문 그대로');
    assert.equal(md5(oldSrc),(ops.match(/이전 본문 해시 ([0-9a-f]{32})/)||[])[1]);
    assert.equal(md5(newSrc),(ops.match(/새 본문 해시 ([0-9a-f]{32})/)||[])[1]);
    assert.equal(values((await c.query(look)).rows)['daily function version'],'이전(조각 ① 전)');
    await assert.rejects(c.query(back),/NEWS_BODY_TRIM_DAILY_ROLLBACK_BLOCKED/);await c.query('rollback');
   }finally{c.release();}
  });

  await t.test('rollback (SQL Editor): function and record gone, catalog as before, re-apply works',async()=>{
   await q(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await q(snapshot)).rows,before);
   const again=await run('apply','9994');assert.equal(again.ok,true,again.summary);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
