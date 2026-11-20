// Fresh local PostgreSQL only. No Supabase, Edge or production credentials. All data synthetic.
// S67-24 DB-보관기간정리 ①(20261120130000_news_outside_retention) + ②(docs/ops/retention-daily.*, SQL Editor).
// - 승인형 workflow plan(확장 규칙)·dry-run·apply·사후 확인 통과, 적용 순간에는 한 줄도 안 지움(자동 사본 대상 표 없음).
// - 언론 72시간 경계(받은 시각 created_at), 사회운동 6개월(받은 시각 fetched_at).
// - 사람이 남긴 것은 안 지움: 별표(공용·옛 표)·직접 넣은 기사·손으로 고친 기사·노트 메모(공용 id·옛 id·지도·휴지통 노트)·밑줄·사회운동 보관.
// - 딸린 본문·문장·읽음·자세히·반응은 지운 기사 것만 같이 지워짐(외래 키), 남긴 기사의 딸린 줄은 그대로. 텔레그램 표는 그대로.
// - 함수는 service_role만, p_limit 지킴. 되돌리기 뒤 이전 본문 그대로·다시 적용 가능.
// - 매일 정리(SQL Editor 조각 ①·②): 가짜 cron 스키마로 예약 1개·실행 기록 7일·백업 사본 규칙(기록 있음 + 처음 본 지 14일, 11/15·16·19 뉴스 백업은 바로) 확인.
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
const version='20261120130000',name='news_outside_retention',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;
  alter table auth.users add column email text;
  insert into auth.users(id,email) values ('${OWNER}','op@example.test'),('${STRANGER}','b@example.test');
  create table public.app_notes(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id),
    raw_text text not null, kind text not null default 'note', metadata jsonb not null default '{}'::jsonb, deleted_at timestamptz);
  alter table public.app_notes enable row level security;
  revoke all on table public.app_notes from public, anon, authenticated, service_role;
  create table public.app_workspace_signup_allow(email text primary key, kind text not null, created_at timestamptz not null default now(),
    constraint app_workspace_signup_allow_kind check (kind in ('operator','blocked')));
  alter table public.app_workspace_signup_allow enable row level security;
  revoke all on table public.app_workspace_signup_allow from public, anon, authenticated, service_role;
  insert into supabase_migrations.schema_migrations(version,name) values ('20261113140000','workspace_signup_allow');`;
const BEFORE=['20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261025200000_call_personal_box',
 '20261025210000_feed_item_archive','20261026120000_call_user_edit','20261026190000_tg_sender_names','20261027010000_tg_room_day_group',
 '20261027030000_tg_sender_names_read','20261027200000_tg_summary_edit','20261028030000_tg_room_day_context','20261029090000_operator_features'];
// 가짜 cron(운영 pg_cron과 같은 이름·칸만). 시험 DB에는 pg_cron이 없다.
const fakeCron=`
  create schema cron;
  create table cron.job(jobid bigserial primary key, jobname text unique, schedule text not null, command text not null, active boolean not null default true);
  create table cron.job_run_details(runid bigserial primary key, jobid bigint, status text, return_message text, start_time timestamptz, end_time timestamptz);
  create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as
    $f$ insert into cron.job(jobname,schedule,command) values (p_name,p_schedule,p_command) returning jobid $f$;
  create function cron.unschedule(p_name text) returns boolean language sql as $f$ with d as (delete from cron.job where jobname = p_name returning 1) select count(*) = 1 from d $f$;
  insert into cron.job(jobname,schedule,command) values ('web2_feed_outside','7 4,9,23 * * *','x'),('web2_feed_news','22 4,9,23 * * *','x'),
    ('web2_feed_news_fill','22 0-3,5-8,10-22 * * *','x'),('web2_feed_tick','* * * * *','x');`;
const fragment=(sql,n)=>sql.slice(sql.indexOf(`-- ===== 조각 ${n} 시작`),sql.indexOf(`-- ===== 조각 ${n} 끝`));

test('news/outside retention: plan, dry-run, apply, 72h and 6-month rules, kept human marks, cascades, service role only, rollback, daily job',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'retention-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query('revoke usage on schema private from service_role');
  await pool.query('grant select on public.app_spaces to authenticated');
  await pool.query('alter table public.app_spaces enable row level security');
  await pool.query('create policy fake_owner_read on public.app_spaces for select to authenticated using (private.app_is_workspace_owner(workspace_id))');
  await pool.query(`create table public.app_documents(id uuid primary key, workspace_id uuid not null, file_id text, extraction_status text, extracted_text text);
   alter table public.app_documents enable row level security;
   create policy fake_docs_owner on public.app_documents for select to authenticated using (private.app_is_workspace_owner(workspace_id));
   grant select on public.app_documents to authenticated;`);
  await pool.query("update public.app_workspaces set slug='kptu-work' where id=$1",[WS_A]);
  await pool.query("update public.app_workspaces set slug='other-work' where id=$1",[WS_B]);
  for(const f of BEFORE.slice(0,-1))await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-24','2026-10-24T03:00:00Z','가상 통화','가상 요약','call:uc1')",[WS_A]);
  await pool.query(await read('supabase/migrations/'+BEFORE.at(-1)+'.sql'));
  for(const f of ['20261028160000_ai_usage_costs','20261031120000_gdrive_photo_index','20261102160000_cloud_files_index','20261103100000_dev_inbox_feature',
   '20261030060000_tg_room_pin','20261105100000_family_notes','20261101233000_news_clipping','20261108140000_news_titles_tried',
   '20261031230000_outside_statements','20261102150000_outside_search_undated','20261108020000_outside_post_body_ko','20261102140000_now_detail','20261106050000_feed_bodies',
   '20261108070000_news_highlights'])
   await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const readsSQL=await read('supabase/migrations/20261106080000_feed_reads_news_prefs.sql');
  await pool.query(readsSQL.slice(readsSQL.indexOf('create table public.app_feed_reads ('),readsSQL.indexOf('alter table public.app_profiles drop constraint')));
  await pool.query("insert into supabase_migrations.schema_migrations(version,name) values ('20261106080000','feed_reads_news_prefs')");
  for(const f of ['20261115100000_news_for_all','20261115140000_news_for_all_refs','20261115150000_outside_for_all','20261115230000_news_user_save','20261119000000_news_hand_fill'])
   await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const oldPruneSrc=(await pool.query("select prosrc from pg_proc where oid='public.app_news_prune(timestamptz,integer)'::regprocedure")).rows[0].prosrc;

  // ---- 합성 기사(제목·내용 없음에 가까운 가짜). 기준 시각 NOW에서 거꾸로 센다.
  const NOW='2026-11-20T00:00:00Z',ago=h=>new Date(Date.parse(NOW)-h*3600000).toISOString();
  const art=async(n,createdH,extra={})=>(await pool.query(`insert into public.app_news_articles(id,origin,lane,url,url_key,title,state,created_at,manual_at)
    values (coalesce($5::uuid,gen_random_uuid()),$1,$2,$3,$4,'합성 기사','ok',$6,$7) returning id`,
    [extra.origin||'site',extra.lane||'media','https://news.example.org/a/'+n,'news.example.org/a/'+n,extra.id||null,ago(createdH),extra.manual?ago(1):null])).rows[0].id;
  const old=async(ws,n,createdH,extra={})=>(await pool.query(`insert into public.app_news_items(id,workspace_id,lane,url,url_key,title,state,created_at,starred_at)
    values (coalesce($5::uuid,gen_random_uuid()),$1,$2,$3,$4,'합성 기사','ok',$6,$7) returning id`,
    [ws,extra.lane||'media','https://news.example.org/a/'+n,'news.example.org/a/'+n,extra.id||null,ago(createdH),extra.star?ago(1):null])).rows[0].id;
  const map=(oldId,ws,artId)=>pool.query('insert into public.app_news_id_map(old_id,workspace_id,article_id) values ($1,$2,$3)',[oldId,ws,artId]);
  const note=(ws,meta,trashed=false)=>pool.query('insert into public.app_notes(workspace_id,raw_text,metadata,deleted_at) values ($1,$2,$3::jsonb,$4)',[ws,'합성 메모',JSON.stringify(meta),trashed?ago(1):null]);
  const hl=(ws,type,id)=>pool.query(`insert into public.app_news_highlights(workspace_id,source_type,source_id,quote) values ($1,$2,$3,'합성 밑줄')`,[ws,type,id]);
  const N={};
  // 1 지울 것: 공용 + 옛 줄 둘(A는 같은 id, B는 다른 id) + 딸린 본문·읽음·자세히·반응
  N.a1=await art(1,120);N.a1A=await old(WS_A,1,120,{id:N.a1});N.a1B=await old(WS_B,1,120);await map(N.a1B,WS_B,N.a1);
  await pool.query(`insert into public.app_news_article_bodies(article_id,blocks,state,chars) values ($1,'[{"t":"p","text":"합성"}]'::jsonb,'ok',2)`,[N.a1]);
  await pool.query('insert into public.app_news_reads(workspace_id,article_id) values ($1,$2)',[WS_B,N.a1]);
  await pool.query("insert into public.app_news_now_signals(workspace_id,article_id,action) values ($1,$2,'open')",[WS_A,N.a1]);
  await pool.query(`insert into public.app_feed_bodies(workspace_id,news_item_id,blocks,state,chars) values ($1,$2,'[{"t":"p","text":"합성"}]'::jsonb,'ok',2)`,[WS_B,N.a1B]);
  // 2 B가 공용 기사에 별표 → 공용·옛 줄 모두 남음
  N.a2=await art(2,120);N.a2A=await old(WS_A,2,120,{id:N.a2});
  await pool.query('insert into public.app_news_marks(workspace_id,article_id,starred_at) values ($1,$2,$3)',[WS_B,N.a2,ago(2)]);
  await pool.query(`insert into public.app_news_article_bodies(article_id,blocks,state,chars) values ($1,'[{"t":"p","text":"합성"}]'::jsonb,'ok',2)`,[N.a2]);
  // 3 직접 넣은 기사(origin user), 4 손으로 고친 기사(manual_at)
  N.a3=await art(3,120,{origin:'user',lane:'channel'});N.a4=await art(4,120,{manual:true});
  // 5 공용 id 노트 메모, 6 휴지통 노트가 B 옛 id(지도 있음)를 가리킴, 7 밑줄이 옛 id(지도), 8 옛 표 별표만
  N.a5=await art(5,120);await note(WS_A,{news_item_id:N.a5});
  N.a6=await art(6,120);N.a6B=await old(WS_B,6,120);await map(N.a6B,WS_B,N.a6);await note(WS_B,{news_item_id:N.a6B},true);
  N.a7=await art(7,120);N.a7B=await old(WS_B,7,120);await map(N.a7B,WS_B,N.a7);await hl(WS_B,'news',N.a7B);
  N.a8=await art(8,120);N.a8A=await old(WS_A,8,120,{id:N.a8,star:true});
  // 9·10 경계: 71시간 59분 → 남음, 72시간 1분 → 지움. 11 숨김만 → 지움. 12 텔레그램 방 기사(채널) → 지움.
  N.a9=await art(9,71+59/60);N.a10=await art(10,72+1/60);
  N.a11=await art(11,120);await pool.query('insert into public.app_news_marks(workspace_id,article_id,hidden_at) values ($1,$2,$3)',[WS_A,N.a11,ago(2)]);
  N.a12=await art(12,120,{origin:'tg_room',lane:'channel'});
  // 사회운동: 7개월 지난 글(공용 + 옛 줄 + 문장)
  const month=m=>{const d=new Date(NOW);d.setUTCMonth(d.getUTCMonth()-m);return d.toISOString();};
  const oart=async(n,pub,fetched,id=null)=>(await pool.query(`insert into public.app_outside_articles(id,source_key,kind,lang,title,url,published_at,fetched_at)
    values (coalesce($4::uuid,gen_random_uuid()),'kctu','statement','ko','합성 성명',$1,$2,$3) returning id`,['https://union.example.org/s/'+n,pub,fetched,id])).rows[0].id;
  const opost=async(ws,n,pub,fetched,id=null)=>(await pool.query(`insert into public.app_outside_posts(id,workspace_id,source_key,kind,lang,title,url,published_at,fetched_at)
    values (coalesce($5::uuid,gen_random_uuid()),$1,'kctu','statement','ko','합성 성명',$2,$3,$4) returning id`,[ws,'https://union.example.org/s/'+n,pub,fetched,id])).rows[0].id;
  const O={};
  O.o1=await oart(1,month(7),month(7));O.o1A=await opost(WS_A,1,month(7),month(7),O.o1);
  await pool.query("insert into public.app_outside_article_sentences(article_id,idx,text) values ($1,0,'합성 문장')",[O.o1]);
  await pool.query("insert into public.app_outside_sentences(post_id,workspace_id,lang,idx,text) values ($1,$2,'ko',0,'합성 문장')",[O.o1A,WS_A]);
  O.o2=await oart(2,month(7),month(7));await pool.query('insert into public.app_outside_article_marks(workspace_id,article_id,archived_at) values ($1,$2,$3)',[WS_B,O.o2,ago(5)]);
  O.o3=await oart(3,month(7),month(7));O.o3A=await opost(WS_A,3,month(7),month(7),O.o3);
  await pool.query('insert into public.app_outside_marks(post_id,workspace_id,starred_at) values ($1,$2,$3)',[O.o3A,WS_A,ago(5)]);
  O.o4=await oart(4,month(7),month(7));O.o4B=await opost(WS_B,4,month(7),month(7));await pool.query('insert into public.app_outside_id_map(old_id,workspace_id,article_id) values ($1,$2,$3)',[O.o4B,WS_B,O.o4]);
  await note(WS_B,{outside_post_id:O.o4B});
  O.o5=await oart(5,null,month(7));O.o6=await oart(6,month(5),month(5));
  // 8: 2년 전 성명을 지난달에 처음 받음 → 받은 날 기준이라 남음(목록에 남은 옛 글을 지웠다 다시 넣는 헛돎 없음).
  O.o8=await oart(8,month(24),month(1));
  O.o7=await oart(7,month(8),month(8));await hl(WS_A,'outside',O.o7);

  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const server=fn=>as('service_role','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  const counts=async()=>(await pool.query(`select (select count(*) from public.app_news_articles)::int arts,(select count(*) from public.app_news_items)::int items,
   (select count(*) from public.app_outside_articles)::int oarts,(select count(*) from public.app_outside_posts)::int oposts,(select count(*) from public.app_feed_items)::int tg,
   (select count(*) from public.app_news_marks)::int marks,(select count(*) from public.app_notes)::int notes,(select count(*) from public.app_news_highlights)::int hls`)).rows[0];
  const has=async(tb,id)=>(await pool.query(`select count(*)::int n from public.${tb} where id=$1`,[id])).rows[0].n===1;
  const prune=(fn,limit=5000)=>server(c=>c.query(`select public.${fn}($1::timestamptz,$2) r`,[NOW,limit])).then(r=>r.rows[0].r);
  const before=(await pool.query(snapshot)).rows,c0=await counts();let pre;

  await t.test('files: expanded rules, no backup target, three-line summary, read-only checks, no telegram or rtw',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const p=prepareMigration({mode,version,runId:'1',root});assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');assert.deepEqual(p.targets,[],'적용 순간 지우는 표 없음 = 자동 사본 없음');}
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);
   ['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   assert.match(lines[1],/되살릴 수 없/);
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bto (anon|public|authenticated)\b|disable row level|rtw_|create policy|alter table|drop /i);
   assert.doesNotMatch(code.replace(/\$prune\$[\s\S]*?\$prune\$|\$oprune\$[\s\S]*?\$oprune\$/g,''),/\bdelete from\b|\bupdate public\./i,'최상위에서 줄을 지우거나 고치지 않음');
   assert.doesNotMatch(code,/app_feed_items|app_feed_rooms|app_family|app_tg_|room_key|sender/i,'텔레그램·가족 표를 읽지 않음');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot은 앱 표를 읽지 않음');
   assert.doesNotMatch(precheck+postcheck,/from public\./i,'확인 SQL은 기사 줄을 읽지 않음');
   pre=values(await readOnly(precheck));
   for(const [k,v] of Object.entries(pre))if(/^(예|아니오)$/.test(v))assert.equal(v,'예',k);
  });

  await t.test('dry-run leaves functions, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(values(await readOnly(precheck)),pre);assert.equal(await history(),0);
   assert.deepEqual(await counts(),c0);
  });

  await t.test('apply changes functions only; no row deleted at apply; postcheck passes; second apply refused',async()=>{
   const result=await run('apply','9972');assert.equal(result.ok,true,result.summary);
   const post=values(await readOnly(postcheck));
   for(const [k,v] of Object.entries(post))if(/^(예|아니오)$/.test(v))assert.equal(v,'예',k);
   assert.equal(post['cascade keys hash'],pre['cascade keys hash']);
   assert.deepEqual(await counts(),c0,'적용 순간 줄 수 그대로');
   assert.equal((await run('apply','9973')).ok,false);
   await assert.rejects(pool.query(migration),/NEWS_OUTSIDE_RETENTION_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  await t.test('functions: service_role only, DEFINER with empty search_path',async()=>{
   for(const fn of ['app_news_prune','app_outside_prune']){
    await assert.rejects(as('anon','',c=>c.query(`select public.${fn}(now(),10)`)),{code:'42501'});
    for(const sub of [OWNER,STRANGER])await assert.rejects(as('authenticated',sub,c=>c.query(`select public.${fn}(now(),10)`)),{code:'42501'});
    const f=(await pool.query(`select prosecdef,proconfig from pg_proc where oid='public.${fn}(timestamptz,integer)'::regprocedure`)).rows[0];
    assert.equal(f.prosecdef,true);assert.deepEqual(f.proconfig,['search_path=""']);
   }
  });

  await t.test('news 72h: limit honoured, boundary, human marks kept in shared and old tables, cascades only for deleted',async()=>{
   assert.equal(await prune('app_news_prune',1),2,'공용 1줄 + 옛 1줄');
   const removed=await prune('app_news_prune');
   assert.ok(removed>=1);assert.equal(await prune('app_news_prune'),0,'두 번째는 0');
   for(const k of ['a1','a10','a11','a12'])assert.equal(await has('app_news_articles',N[k]),false,k+' 지움');
   for(const k of ['a2','a3','a4','a5','a6','a7','a8','a9'])assert.equal(await has('app_news_articles',N[k]),true,k+' 남김');
   for(const k of ['a1A','a1B'])assert.equal(await has('app_news_items',N[k]),false,k+' 옛 줄 지움');
   for(const k of ['a2A','a6B','a7B','a8A'])assert.equal(await has('app_news_items',N[k]),true,k+' 옛 줄 남김(같은 주소 묶음)');
   const n=async(sql,p)=>(await pool.query(sql,p)).rows[0].n;
   assert.equal(await n('select count(*)::int n from public.app_news_article_bodies where article_id=$1',[N.a1]),0,'지운 기사 본문 같이 지움');
   assert.equal(await n('select count(*)::int n from public.app_news_article_bodies where article_id=$1',[N.a2]),1,'남긴 기사 본문 그대로');
   assert.equal(await n('select count(*)::int n from public.app_news_reads where article_id=$1',[N.a1]),0);
   assert.equal(await n('select count(*)::int n from public.app_news_now_signals where article_id=$1',[N.a1]),0);
   assert.equal(await n('select count(*)::int n from public.app_feed_bodies where news_item_id=$1',[N.a1B]),0,'옛 본문 블록 같이 지움');
   assert.equal(await n('select count(*)::int n from public.app_news_id_map where article_id=$1',[N.a1]),0);
   assert.equal(await n('select count(*)::int n from public.app_news_marks where article_id=$1 and starred_at is not null',[N.a2]),1,'별표 그대로');
   assert.equal(await n('select count(*)::int n from public.app_news_marks where article_id=$1',[N.a11]),0,'숨김만 있던 표시는 기사와 같이');
   const c=await counts();assert.equal(c.notes,c0.notes,'노트 그대로');assert.equal(c.hls,c0.hls,'밑줄 그대로');assert.equal(c.tg,c0.tg,'텔레그램 그대로');
   assert.equal(c.oarts,c0.oarts,'뉴스 정리는 사회운동 글을 건드리지 않음');
  });

  await t.test('outside 6 months after received (fetched_at), star/archive/memo/highlight kept, sentences cascade',async()=>{
   assert.equal(await prune('app_outside_prune'),3,'공용 o1·o5 + 옛 o1A');
   for(const k of ['o1','o5'])assert.equal(await has('app_outside_articles',O[k]),false,k+' 지움');
   for(const k of ['o2','o3','o4','o6','o7','o8'])assert.equal(await has('app_outside_articles',O[k]),true,k+' 남김');
   assert.equal(await has('app_outside_posts',O.o1A),false);for(const k of ['o3A','o4B'])assert.equal(await has('app_outside_posts',O[k]),true,k);
   assert.equal((await pool.query('select count(*)::int n from public.app_outside_article_sentences where article_id=$1',[O.o1])).rows[0].n,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_outside_sentences where post_id=$1',[O.o1A])).rows[0].n,0);
   assert.equal(await prune('app_outside_prune'),0);
   assert.equal((await counts()).arts,(await pool.query('select count(*)::int n from public.app_news_articles')).rows[0].n);
  });

  await t.test('edge guards match the database rules',async()=>{
   const news=await read('supabase/functions/news-feed/handler.ts'),out=await read('supabase/functions/outside-feed/handler.ts');
   assert.match(news,/export const KEEP_HOURS = 72;/);assert.match(migration,/interval '72 hours'/);
   assert.match(news,/if \(tooOldForNews\(it\.published_at, nowMs\)\) \{ dropped\+\+; continue; \}/);
   // 사회운동은 받은 날 기준이라 수집기 거르기가 필요 없다(목록에 남은 옛 글은 '이미 있음'으로 건너뜀) — 수집기는 그대로.
   assert.match(migration,/where a\.fetched_at < v_cut/);assert.match(migration,/where p\.fetched_at < v_cut/);assert.doesNotMatch(out,/KEEP_DAYS/);
  });

  await t.test('daily job (SQL Editor fragments): one cron job, 7-day run log, backup rule, preview and rollback',async()=>{
   const ops=await read('docs/ops/retention-daily.apply.sql'),preview=await read('docs/ops/retention-daily.precheck.sql'),opsBack=await read('docs/ops/retention-daily.rollback.sql');
   assert.doesNotMatch(ops.replace(/--.*$/gm,''),/\bto (anon|public|authenticated)\b|grant /i);
   await pool.query(fakeCron);await pool.query("alter database postgres set cron.timezone = 'GMT'");
   const c=await pool.connect();
   try{
    await c.query("set cron.timezone = 'GMT'");
    await c.query(`insert into cron.job_run_details(jobid,status,start_time,end_time) values (1,'succeeded',now()-interval '10 days',now()-interval '10 days'),
      (1,'succeeded',now()-interval '8 days',null),(1,'succeeded',now()-interval '1 day',now()-interval '1 day')`);
    await c.query('create schema ops_backup');
    await c.query("insert into supabase_migrations.schema_migrations(version,name) values ('20261116110000','document_brief_delete')");
    for(const tb of ['20261115100000_app_news_items_9001','20261119000000_app_news_articles_9002','20261116110000_app_documents_9004','20261118110000_app_collab_x_9003'])
     await c.query(`create table ops_backup."${tb}" (id integer)`);
    await c.query(fragment(ops,'①'));
    assert.deepEqual((await c.query("select schedule,command from cron.job where jobname='web2_retention_daily'")).rows,[{schedule:'43 17 * * *',command:'select private.app_retention_daily()'}]);
    assert.equal((await c.query('select count(*)::int n from private.app_ops_backup_seen')).rows[0].n,4);
    await assert.rejects(c.query(fragment(ops,'①')),/RETENTION_DAILY_PREREQUISITE_CHANGED/);await c.query('rollback');
    for(const role of ['authenticated','service_role','anon']){
     await c.query('begin');await c.query('set local role '+role);
     await assert.rejects(c.query('select private.app_retention_daily()'),{code:'42501'});await c.query('rollback');
    }
    const look=Object.fromEntries((await c.query(preview)).rows.map(r=>[r.item,r.value]));
    assert.equal(look['retention job present'],'예');assert.match(look['backup 20261115100000_app_news_items_9001'],/기록있음 지금지움/);
    assert.match(look['backup 20261118110000_app_collab_x_9003'],/기록없음 14일규칙/);assert.match(look['backup 20261116110000_app_documents_9004'],/기록있음 14일규칙/);
    await c.query(fragment(ops,'②'));
    const left=async()=>(await c.query("select relname from pg_class where relnamespace='ops_backup'::regnamespace order by 1")).rows.map(r=>r.relname);
    assert.deepEqual(await left(),['20261116110000_app_documents_9004','20261118110000_app_collab_x_9003'],'11/15·19 뉴스 백업만 바로 지움');
    assert.equal((await c.query('select count(*)::int n from cron.job_run_details')).rows[0].n,1,'7일 지난 실행 기록 지움(끝 시각 없는 줄은 시작 시각)');
    // 14일 규칙: 처음 본 지 15일 → 기록 있는 것만 지움, 기록 없는 것(적용이 멈춘 것)은 남김.
    await c.query("update private.app_ops_backup_seen set first_seen_at = now() - interval '15 days'");
    const r=(await c.query('select private.app_retention_daily() r')).rows[0].r;
    assert.equal(r.backups,1);assert.deepEqual(await left(),['20261118110000_app_collab_x_9003']);
    assert.deepEqual((await c.query('select name from private.app_ops_backup_seen')).rows.map(x=>x.name),['20261118110000_app_collab_x_9003']);
    // 사람이 남긴 기사는 매일 정리 뒤에도 남는다(실제 시각 기준으로 돌아도).
    for(const k of ['a2','a3','a4','a5','a6','a7','a8'])assert.equal(await has('app_news_articles',N[k]),true,k);
    for(const k of ['o2','o3','o4','o7'])assert.equal(await has('app_outside_articles',O[k]),true,k);
    assert.equal((await counts()).tg,c0.tg);
    await c.query(opsBack);
    assert.equal((await c.query("select count(*)::int n from cron.job where jobname='web2_retention_daily'")).rows[0].n,0);
    assert.equal((await c.query("select count(*)::int n from cron.job where jobname like 'web2\\_feed\\_%'")).rows[0].n,4,'수집 예약은 그대로');
   }finally{c.release();}
  });

  await t.test('rollback restores the previous news prune body, drops the outside prune and the record; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.equal((await pool.query("select prosrc from pg_proc where oid='public.app_news_prune(timestamptz,integer)'::regprocedure")).rows[0].prosrc,oldPruneSrc);
   assert.equal((await pool.query("select to_regprocedure('public.app_outside_prune(timestamptz,integer)') is null n")).rows[0].n,true);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const again=await run('apply','9974');assert.equal(again.ok,true,again.summary);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
