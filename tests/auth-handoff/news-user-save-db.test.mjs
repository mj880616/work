// Fresh local PostgreSQL only. No Supabase, Edge or production credentials. All data synthetic.
// S62-22 APP-공유로뉴스보관 ①(20261115230000_news_user_save): 폰 공유로 받은 기사 주소를 그 사람 News 보관에 넣는 서버 함수.
// - 승인형 DB workflow 규칙(확장 규칙·정책 교체)을 통과하고 dry-run은 아무것도 안 바꿈, apply 뒤 사후 확인 모두 예.
// - 함수: service_role만(anon·authenticated 42501), 주소 검사(https·호스트 이름만, 문서·텔레그램·단축·내부·IP 거절), 같은 주소는 한 줄(표시만).
// - 'user' 기사는 넣은 사람만 본다(다른 가입자·익명 0줄). 기존 'site' 기사·채널 스크랩 경계는 그대로. 채널 스크랩 줄은 운영자만 표시.
// - 텔레그램 방·소식·가족·통화 표로 가는 길 없음(행 수 그대로, 함수 본문에 이름 없음).
// - 되돌리기 뒤 snapshot 같음, 다시 적용 가능.
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
const version='20261115230000',name='news_user_save',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const BLOCKED='20000000-0000-4000-8000-000000000003',NOWS='20000000-0000-4000-8000-000000000004',WS_C='21000000-0000-4000-8000-000000000003';
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;
  alter table auth.users add column email text;
  insert into auth.users(id,email) values ('${OWNER}','op@example.test'),('${STRANGER}','b@example.test'),('${BLOCKED}','Blocked@Example.test'),('${NOWS}','nows@example.test');
  insert into public.app_workspaces values ('${WS_C}');
  insert into public.app_workspace_members values ('${WS_C}','${BLOCKED}','owner');
  create table public.app_notes(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id),
    raw_text text not null, kind text not null default 'note', metadata jsonb not null default '{}'::jsonb, deleted_at timestamptz);
  alter table public.app_notes enable row level security;
  revoke all on table public.app_notes from public, anon, authenticated, service_role;
  create table public.app_workspace_signup_allow(email text primary key, kind text not null, created_at timestamptz not null default now(),
    constraint app_workspace_signup_allow_kind check (kind in ('operator','blocked')));
  alter table public.app_workspace_signup_allow enable row level security;
  revoke all on table public.app_workspace_signup_allow from public, anon, authenticated, service_role;
  insert into public.app_workspace_signup_allow values ('blocked@example.test','blocked');
  insert into supabase_migrations.schema_migrations(version,name) values ('20261113140000','workspace_signup_allow');`;
const BEFORE=['20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261025200000_call_personal_box',
 '20261025210000_feed_item_archive','20261026120000_call_user_edit','20261026190000_tg_sender_names','20261027010000_tg_room_day_group',
 '20261027030000_tg_sender_names_read','20261027200000_tg_summary_edit','20261028030000_tg_room_day_context','20261029090000_operator_features'];


test('news user save: plan, dry-run, apply, service-role save, user rows only for the saver, telegram untouched, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'news-user-save-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  await pool.query("update public.app_workspaces set slug='third-work' where id=$1",[WS_C]);
  for(const f of BEFORE.slice(0,-1))await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-24','2026-10-24T03:00:00Z','가상 통화','가상 요약','call:uc1')",[WS_A]);
  await pool.query(await read('supabase/migrations/'+BEFORE.at(-1)+'.sql'));
  for(const f of ['20261028160000_ai_usage_costs','20261031120000_gdrive_photo_index','20261102160000_cloud_files_index','20261103100000_dev_inbox_feature',
   '20261030060000_tg_room_pin','20261105100000_family_notes','20261101233000_news_clipping','20261108140000_news_titles_tried',
   '20261031230000_outside_statements','20261102140000_now_detail','20261106050000_feed_bodies'])
   await pool.query(await read('supabase/migrations/'+f+'.sql'));
  // 읽음 표는 진짜 정의(20261106080000의 표·정책·트리거 부분)만 — 같은 파일의 화면 설정 칸 검사는 이 시험과 무관.
  const readsSQL=await read('supabase/migrations/20261106080000_feed_reads_news_prefs.sql');
  await pool.query(readsSQL.slice(readsSQL.indexOf('create table public.app_feed_reads ('),readsSQL.indexOf('alter table public.app_profiles drop constraint')));
  await pool.query("insert into supabase_migrations.schema_migrations(version,name) values ('20261106080000','feed_reads_news_prefs')");
  await pool.query(await read('supabase/migrations/20261115100000_news_for_all.sql'));
  await pool.query(await read('supabase/migrations/20261115140000_news_for_all_refs.sql'));
  await pool.query(`insert into public.app_feed_rooms(workspace_id,room_key,room_label,chat_kind) values ($1,'g1','합성 업무방','group')`,[WS_A]);
  const SITE=(await pool.query(`insert into public.app_news_articles(origin,lane,url,url_key,title,state) values('site','media','https://news.example.org/a/1','news.example.org/a/1','합성 매체 기사','ok') returning id`)).rows[0].id;
  const SCRAP=(await pool.query(`insert into public.app_news_articles(origin,lane,url,url_key,state) values('tg_scrap','channel','https://news.example.org/s/1','news.example.org/s/1','pending') returning id`)).rows[0].id;

  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  const save=(ws,url,key,page=null)=>server(c=>c.query('select public.app_news_user_save($1,$2,$3,$4::jsonb) r',[ws,url,key,page===null?null:JSON.stringify(page)])).then(r=>r.rows[0].r);
  const PAGE={title:'합성 공유 기사',title_key:'합성공유기사',publisher:'합성 매체',published_at:'2026-11-15T00:00:00Z',lang:'ko',state:'ok',body:'합성 본문 '.repeat(50),body_kind:'full'};
  const tgCounts=async()=>(await pool.query(`select (select count(*) from public.app_feed_rooms)::int rooms,(select count(*) from public.app_feed_items)::int items,
   (select count(*) from public.app_news_items)::int old`)).rows[0];
  const before=(await pool.query(snapshot)).rows,tg0=await tgCounts();let pre;

  await t.test('files: expanded rules with policy replacement, three-line summary, read-only checks, no telegram/family/call table',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const p=prepareMigration({mode,version,runId:'1',root});assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');}
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);
   ['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bto (anon|public)\b|disable row level|no force|rtw_|security invoker/i);
   assert.doesNotMatch(code,/\b(delete from) public\.|\bupdate public\./i,'no existing row changed');
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id');
   assert.doesNotMatch(code,/app_feed_items|app_feed_rooms|app_feed_days|app_family|app_tg_|app_call|telegram_|room_key|sender/i,'텔레그램 소식·방·가족·통화 표 없음');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
   assert.match(rollbackSQL,/drop policy news_articles_reader_select on public\.app_news_articles;\s*create policy news_articles_reader_select on public\.app_news_articles for select to authenticated\s*using \(origin <> 'tg_scrap' and private\.app_news_reader_ok\(\)\);/);
   pre=values(await readOnly(precheck));
   for(const [k,v] of Object.entries(pre))if(/^(예|아니오)$/.test(v))assert.equal(v,'예',k);
   assert.equal(pre['user rows'],'0');
  });

  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(values(await readOnly(precheck)),pre);assert.equal(await history(),0);
  });

  await t.test('apply: postcheck all yes, site articles unchanged for both readers, second apply refused',async()=>{
   const result=await run('apply','9972');assert.equal(result.ok,true,result.summary);
   for(const [k,v] of Object.entries(values(await readOnly(postcheck))))assert.equal(v,'예',k);
   for(const fn of [owner,stranger])assert.deepEqual((await fn(c=>c.query('select id from public.app_news_articles where id=$1',[SITE]))).rows,[{id:SITE}]);
   assert.deepEqual((await stranger(c=>c.query('select id from public.app_news_articles where id=$1',[SCRAP]))).rows,[],'채널 스크랩 그대로 운영자만');
   assert.deepEqual((await owner(c=>c.query('select id from public.app_news_articles where id=$1',[SCRAP]))).rows,[{id:SCRAP}]);
   assert.equal((await pool.query("select save_n from public.app_news_days limit 1")).rows.length,0);
   assert.equal((await run('apply','9973')).ok,false,'second apply stops');
  });

  await t.test('function: service_role only; definer with empty search_path',async()=>{
   for(const fn of [anon,owner,stranger])await assert.rejects(fn(c=>c.query("select public.app_news_user_save($1,'https://news.example.org/x','news.example.org/x',null)",[WS_A])),{code:'42501'});
   const fn=(await pool.query("select prosecdef,proconfig from pg_proc where oid='public.app_news_user_save(uuid,text,text,jsonb)'::regprocedure")).rows[0];
   assert.equal(fn.prosecdef,true);assert.deepEqual(fn.proconfig,['search_path=""']);
   await assert.rejects(anon(c=>c.query('select private.app_news_marked_by_me($1)',[SITE])),{code:'42501'});
  });

  await t.test('url refusals: not https, IP, internal, documents, telegram, shortener, bokdoong, supabase, bad key; unknown workspace',async()=>{
   for(const u of ['http://news.example.org/a','ftp://news.example.org/a','https://127.0.0.1/a','https://10.0.0.1/a','https://localhost/a','https://intra/a',
    'https://srv.internal/a','https://docs.google.com/document/d/x','https://drive.google.com/file/x','https://t.me/somechannel/1','https://naver.me/abc',
    'https://bit.ly/abc','https://desk.bokdoong.com/app/','https://abc.supabase.co/rest/v1/','https://user:pw@news.example.org/a','https://news.example.org:8443/a',
    'https://news.example.org/a b'])
    await assert.rejects(save(WS_A,u,'k/'+u.length),/NEWSSAVE_URL/,u);
   await assert.rejects(save(WS_A,'https://news.example.org/a','has space'),/NEWSSAVE_URL/);
   await assert.rejects(save(WS_A,'https://news.example.org/a',''),/NEWSSAVE_URL/);
   await assert.rejects(save('99999999-0000-4000-8000-000000000009','https://news.example.org/a','news.example.org/a'),/NEWSSAVE_OWNER/);
   await assert.rejects(save(null,'https://news.example.org/a','news.example.org/a'),/NEWSSAVE_ARGS/);
   await assert.rejects(save(WS_A,'https://news.example.org/new','news.example.org/new',{...PAGE,state:'pending'}),/NEWSSAVE_PAGE/);
   await assert.rejects(save(WS_A,'https://news.example.org/new','news.example.org/new',{...PAGE,body_kind:'other'}),/NEWSSAVE_PAGE/);
   assert.equal((await pool.query("select count(*)::int n from public.app_news_articles where origin='user'")).rows[0].n,0);
  });

  await t.test('save: unknown url asks to read first; new row origin user, starred; same url twice = one row; only the saver sees it',async()=>{
   assert.deepEqual(await save(WS_B,'https://news.example.org/u/1','news.example.org/u/1'),{ok:true,found:false});
   const r1=await save(WS_B,'https://news.example.org/u/1','news.example.org/u/1',PAGE);
   assert.equal(r1.found,true);assert.equal(r1.created,true);assert.equal(r1.state,'ok');
   const art=(await pool.query('select origin,lane,title,body_kind,publisher from public.app_news_articles where id=$1',[r1.article_id])).rows[0];
   assert.deepEqual(art,{origin:'user',lane:'channel',title:'합성 공유 기사',body_kind:'full',publisher:'합성 매체'});
   const r2=await save(WS_B,'https://news.example.org/u/1','news.example.org/u/1',PAGE);
   assert.equal(r2.created,false);assert.equal(r2.article_id,r1.article_id);
   assert.equal((await pool.query("select count(*)::int n from public.app_news_articles where url_key='news.example.org/u/1'")).rows[0].n,1,'같은 기사 한 줄');
   assert.equal((await pool.query('select count(*)::int n from public.app_news_marks where article_id=$1',[r1.article_id])).rows[0].n,1);
   assert.deepEqual((await stranger(c=>c.query('select id from public.app_news_articles where id=$1',[r1.article_id]))).rows,[{id:r1.article_id}],'넣은 사람은 봄');
   assert.ok((await stranger(c=>c.query('select starred_at from public.app_news_marks where article_id=$1',[r1.article_id]))).rows[0].starred_at,'바로 보관');
   assert.deepEqual((await owner(c=>c.query('select id from public.app_news_articles where id=$1',[r1.article_id]))).rows,[],'다른 가입자(운영자 포함) 0줄');
   assert.deepEqual((await owner(c=>c.query("select id from public.app_news_articles where origin='user'"))).rows,[]);
   await assert.rejects(anon(c=>c.query('select id from public.app_news_articles')),{code:'42501'});
   // 다른 사람이 표시를 직접 넣어 보려 해도(기사를 못 읽으므로) 거절.
   await assert.rejects(owner(c=>c.query('insert into public.app_news_marks(workspace_id,article_id,starred_at) values ($1,$2,now())',[WS_A,r1.article_id])));
   // 운영자가 같은 주소를 공유하면 새 줄 없이 자기 표시만 → 그때부터 그 사람도 봄.
   const r3=await save(WS_A,'https://news.example.org/u/1','news.example.org/u/1');
   assert.equal(r3.created,false);assert.equal(r3.article_id,r1.article_id);
   assert.deepEqual((await owner(c=>c.query('select id from public.app_news_articles where id=$1',[r1.article_id]))).rows,[{id:r1.article_id}]);
   // 숨긴 매체 기사를 공유하면 숨김이 풀리고 보관.
   await owner(c=>c.query('insert into public.app_news_marks(workspace_id,article_id,hidden_at) values ($1,$2,now())',[WS_A,SITE]));
   const r4=await save(WS_A,'https://news.example.org/a/1','news.example.org/a/1');assert.equal(r4.article_id,SITE);assert.equal(r4.created,false);
   const m=(await pool.query('select starred_at,hidden_at from public.app_news_marks where workspace_id=$1 and article_id=$2',[WS_A,SITE])).rows[0];
   assert.ok(m.starred_at);assert.equal(m.hidden_at,null);
   assert.equal((await pool.query("select origin from public.app_news_articles where id=$1",[SITE])).rows[0].origin,'site','기존 기사 출처 그대로');
   // 본문 없는 기사(봇 확인·못 읽음): 제목·주소만.
   const r5=await save(WS_B,'https://news.example.org/u/2','news.example.org/u/2',{state:'bot_check',title:null,body:null,body_kind:null});
   const a5=(await pool.query('select state,title,body,body_kind from public.app_news_articles where id=$1',[r5.article_id])).rows[0];
   assert.deepEqual(a5,{state:'bot_check',title:null,body:null,body_kind:null});
   const r6=await save(WS_B,'https://news.example.org/u/3','news.example.org/u/3',{state:'paywall',title:'유료',body:'합성 리드',body_kind:'lead'});
   assert.equal((await pool.query('select body_kind from public.app_news_articles where id=$1',[r6.article_id])).rows[0].body_kind,'lead');
  });

  await t.test('telegram scrap: other users cannot reach it through save; operator can mark; telegram/family/call tables untouched',async()=>{
   await assert.rejects(save(WS_B,'https://news.example.org/s/1','news.example.org/s/1'),/NEWSSAVE_UNAVAILABLE/);
   assert.equal((await pool.query('select count(*)::int n from public.app_news_marks where workspace_id=$1 and article_id=$2',[WS_B,SCRAP])).rows[0].n,0);
   assert.deepEqual((await stranger(c=>c.query('select id from public.app_news_articles where id=$1',[SCRAP]))).rows,[]);
   const r=await save(WS_A,'https://news.example.org/s/1','news.example.org/s/1');assert.equal(r.article_id,SCRAP);
   assert.equal((await pool.query('select origin from public.app_news_articles where id=$1',[SCRAP])).rows[0].origin,'tg_scrap');
   assert.deepEqual(await tgCounts(),tg0,'텔레그램 방·소식·옛 기사 표 그대로(가족 표는 migration 본문 검사가 막음)');
  });

  await t.test('rollback removes functions, column, user rows and record; snapshot same; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal((await pool.query("select count(*)::int n from public.app_news_articles where origin='user'")).rows[0].n,0);
   assert.deepEqual((await owner(c=>c.query('select id from public.app_news_articles where id=$1',[SITE]))).rows,[{id:SITE}]);
   for(const [k,v] of Object.entries(values(await readOnly(postcheck))))assert.equal(v,'예',k);
   const again=await run('apply','9974');assert.equal(again.ok,true,again.summary);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
