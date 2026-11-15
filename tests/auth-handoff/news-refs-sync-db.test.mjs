// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S62-12d NEWS-모두에게열기 E2 보충(20261115160000_news_refs_sync, 설계 docs/design/news-for-all.md 13절).
// - D2 적용 뒤 수집기가 옛 표에 넣은 줄(지도 없음)·화면이 옛 표에 쓴 읽음·반응·자세히를 채운다. 승인형 workflow plan·dry-run·apply 통과.
// - 사후 확인은 '마지막 지도 쓰기 1분 전까지 생긴 줄' 기준: 적용 직후 수집기가 넣은 새 줄이 있어도 통과(경주 없음), 다음 보충이 채운다.
// - 함수: service_role만 실행(anon·authenticated 42501), 여러 번 불러도 같음, 인자 검사, 옛 줄과 같은 작업공간 것만 옮김.
// - 보안: 채널 스크랩만 있던 주소는 'tg_scrap'(다른 가입자 0줄), 텔레그램 표(방·소식·가족)를 읽지 않음, 다른 작업공간 사람별 줄은 서로 못 읽음.
// - 되돌리기 뒤 함수·기록만 지워지고 snapshot 같음, 다시 적용 가능.
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
const version='20261115160000',name='news_refs_sync',stem=version+'_'+name;
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


test('news refs sync (E2): plan, dry-run, apply, backfill after D2, idempotent service-role sync, isolation, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'news-refs-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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

  const item=async(ws,lane,n,at='2026-11-01T00:00:00Z',id=null)=>(await pool.query(`insert into public.app_news_items(id,workspace_id,lane,url,url_key,title,state,summary,created_at)
    values (coalesce($6::uuid,gen_random_uuid()),$1,$2,$3,$4,'합성 기사','ok','합성 요약',$5) returning id`,[ws,lane,'https://news.example.org/a/'+n,'news.example.org/a/'+n,at,id])).rows[0].id;
  // D1 전 옛 줄 → D1 → D2(운영 순서).
  const A1=await item(WS_A,'media',1),B1=await item(WS_B,'media',1);
  await pool.query(await read('supabase/migrations/20261115100000_news_for_all.sql'));
  await pool.query(await read('supabase/migrations/20261115140000_news_for_all_refs.sql'));
  await pool.query(`insert into public.app_feed_rooms(workspace_id,room_key,room_label,chat_kind) values ($1,'g1','합성 업무방','group'),($1,'u1','합성 1:1','user')`,[WS_A]);
  // D2 뒤(E1 수집기): 공용 기사와 같은 id로 운영자 옛 줄(#2), 다른 작업공간 옛 줄(#2, 새 id), 공용 표 장애로 옛 표에만 들어간 채널 스크랩(#3)·매체 글(#4).
  const ART2=(await pool.query(`insert into public.app_news_articles(origin,lane,url,url_key,state,created_at) values('site','media','https://news.example.org/a/2','news.example.org/a/2','ok','2026-11-10T00:00:00Z') returning id`)).rows[0].id;
  const A2=await item(WS_A,'media',2,'2026-11-10T00:00:00Z',ART2),B2=await item(WS_B,'media',2,'2026-11-10T00:00:00Z');
  const A3=await item(WS_A,'channel',3,'2026-11-10T00:00:00Z'),B4=await item(WS_B,'media',4,'2026-11-10T00:00:00Z');
  // D2 뒤 옛 표 본문·읽음·자세히·반응(화면·ai-assist가 옛 표에 씀). B1 자세히는 새로 만든 것(D2 복사본보다 새것).
  const body=(ws,id,text,at)=>pool.query(`insert into public.app_feed_bodies(workspace_id,news_item_id,blocks,state,chars,extracted_at,created_at) values($1,$2,$3::jsonb,'ok',$4,$5,$5)`,
   [ws,id,JSON.stringify([{t:'p',text}]),text.length,at]);
  await body(WS_B,B2,'기사2 다른 본문','2026-11-10T01:00:00Z');await body(WS_A,A2,'기사2 본문','2026-11-10T00:30:00Z');await body(WS_A,A3,'스크랩 본문','2026-11-10T00:30:00Z');
  await pool.query(`insert into public.app_feed_reads(workspace_id,news_item_id,read_at) values ($1,$2,'2026-11-10T02:00:00Z'),($3,$4,'2026-11-10T03:00:00Z'),($3,$5,'2026-11-10T03:00:00Z')`,[WS_A,A2,WS_B,B2,B4]);
  await pool.query(`insert into public.app_now_details(workspace_id,news_item_id,summary,interests_key,generated_at) values ($1,$2,'운영자 자세히 2','aaa','2026-11-10T02:00:00Z'),($3,$4,'다른 자세히 새것','bbb','2026-11-10T02:00:00Z')`,[WS_A,A2,WS_B,B1]);
  await pool.query(`insert into public.app_now_signals(workspace_id,news_item_id,action,created_at) values ($1,$2,'star','2026-11-10T02:00:00Z'),($3,$4,'open','2026-11-10T02:00:00Z')`,[WS_A,A3,WS_B,B2]);

  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  const count=async tb=>(await pool.query(`select count(*)::int n from public.${tb}`)).rows[0].n;
  const oldCounts=async()=>(await pool.query(`select (select count(*) from public.app_news_items)::int items,(select count(*) from public.app_feed_bodies)::int bodies,
   (select count(*) from public.app_feed_reads)::int reads,(select count(*) from public.app_now_details)::int details,(select count(*) from public.app_now_signals)::int signals`)).rows[0];
  const sync=n=>server(c=>c.query('select public.app_news_refs_sync($1) r',[n])).then(r=>r.rows[0].r);
  const before=(await pool.query(snapshot)).rows,old0=await oldCounts();let pre;

  await t.test('files: expanded rules, three-line summary, read-only checks, function body = top-level backfill, no telegram table',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const p=prepareMigration({mode,version,runId:'1',root});assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');assert.deepEqual(p.targets,[]);}
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);
   ['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bto (anon|public|authenticated)\b(?!\.)|disable row level|no force|rtw_|security invoker|create policy|alter table|drop /i);
   assert.doesNotMatch(code,/\b(delete from) public\.|\bupdate public\./i,'no existing row changed');
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id');
   assert.doesNotMatch(code,/app_feed_items|app_feed_rooms|app_feed_days|app_family|app_tg_|telegram_|room_key|sender/i,'텔레그램 소식·방·가족 표를 읽지 않음');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
   // 함수 본문 1~6 = 적용 때 한 번 쓰는 넣기(상한·줄 수 세기만 다름).
   const norm=s=>s.replace(/--.*$/gm,'').split('\n').filter(l=>!/get diagnostics|^\s*limit p_limit\s*$/.test(l)).join(' ').replace(/\s*limit p_limit\)/g,')').replace(/\s+/g,' ').trim();
   const fnBody=migration.slice(migration.indexOf('  -- 1) 옛 표에만'),migration.indexOf('  return pg_catalog.jsonb_build_object'));
   const top=migration.slice(migration.lastIndexOf('-- 1) 옛 표에만'),migration.indexOf('-- 사후 확인'));
   assert.equal(norm(top),norm(fnBody));
   pre=values(await readOnly(precheck));
   for(const [k,v] of Object.entries(pre))if(/^(예|아니오)$/.test(v))assert.equal(v,'예',k);
   assert.deepEqual([pre['items rows'],pre['unmapped old items'],pre['old only url keys'],pre['map rows']],['6','4','2','2']);
  });

  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(values(await readOnly(precheck)),pre);assert.equal(await history(),0);
  });

  await t.test('apply fills the map, shared bodies and per-person rows written after D2; postcheck passes; second apply refused',async()=>{
   const result=await run('apply','9982');assert.equal(result.ok,true,result.summary);
   const post=values(await readOnly(postcheck));
   for(const [k,v] of Object.entries(post))if(/^(예|아니오)$/.test(v))assert.equal(v,'예',k);
   assert.equal(post['unmapped old items'],'0');
   assert.deepEqual(await oldCounts(),old0,'old tables untouched');
   const arts=Object.fromEntries((await pool.query('select url_key,id,origin from public.app_news_articles')).rows.map(a=>[a.url_key.slice(-1),a]));
   assert.equal(arts['3'].id,A3);assert.equal(arts['3'].origin,'tg_scrap','채널 스크랩만 있던 주소는 운영자 전용');
   assert.equal(arts['4'].id,B4);assert.equal(arts['4'].origin,'site');
   const map=Object.fromEntries((await pool.query('select old_id,article_id,workspace_id from public.app_news_id_map')).rows.map(m=>[m.old_id,m]));
   assert.deepEqual([map[A2].article_id,map[B2].article_id,map[B2].workspace_id,map[A3].article_id,map[B4].article_id],[ART2,ART2,WS_B,A3,B4]);
   const bodies=Object.fromEntries((await pool.query("select article_id,blocks->0->>'text' t from public.app_news_article_bodies")).rows.map(b=>[b.article_id,b.t]));
   assert.equal(bodies[ART2],'기사2 본문','옛 id = 기사 id 줄이 이김');assert.equal(bodies[A3],'스크랩 본문');
   const reads=(await pool.query('select workspace_id,article_id from public.app_news_reads')).rows.map(r=>[r.workspace_id,r.article_id]);
   for(const want of [[WS_A,ART2],[WS_B,ART2],[WS_B,B4]])assert.ok(reads.some(r=>r[0]===want[0]&&r[1]===want[1]),JSON.stringify(want));
   const det=Object.fromEntries((await pool.query('select workspace_id::text||article_id::text k,summary from public.app_news_now_details')).rows.map(d=>[d.k,d.summary]));
   assert.equal(det[WS_A+ART2],'운영자 자세히 2');assert.equal(det[WS_B+A1],'다른 자세히 새것','더 새로 만든 옛 자세히로 고침');
   assert.equal(await count('app_news_now_signals'),2);
   assert.equal((await run('apply','9983')).ok,false,'second apply stops');
   await assert.rejects(pool.query(migration),/NEWS_REFS_SYNC_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  await t.test('no race: a row the collector adds right after apply does not fail the postcheck; the next sync maps it',async()=>{
   const A5=await item(WS_A,'media',5,new Date().toISOString());
   const post=values(await readOnly(postcheck));
   assert.equal(post['old items before the last map write mapped to the same url'],'예');assert.equal(post['unmapped old items'],'1');
   const r=await sync(2000);
   assert.deepEqual(r,{articles:1,map:1,bodies:0,reads:0,details:0,signals:0});
   assert.equal((await pool.query('select count(*)::int n from public.app_news_id_map where old_id=$1',[A5])).rows[0].n,1);
   assert.deepEqual(await sync(2000),{articles:0,map:0,bodies:0,reads:0,details:0,signals:0},'idempotent');
   // 상한: 1줄씩.
   const A6=await item(WS_A,'media',6,'2026-11-11T00:00:00Z'),A7=await item(WS_A,'media',7,'2026-11-11T00:00:00Z');
   assert.equal((await sync(1)).map,1);assert.equal((await sync(1)).map,1);assert.equal((await sync(1)).map,0);
   assert.ok(A6&&A7);
  });

  await t.test('function: service_role only; argument check; anon and authenticated refused',async()=>{
   await assert.rejects(anon(c=>c.query('select public.app_news_refs_sync(10)')),{code:'42501'});
   for(const fn of [owner,stranger])await assert.rejects(fn(c=>c.query('select public.app_news_refs_sync(10)')),{code:'42501'});
   for(const bad of [null,0,100001,-1])await assert.rejects(sync(bad),/NEWSREFS_ARGS/);
   const fn=(await pool.query("select prosecdef,proconfig from pg_proc where oid='public.app_news_refs_sync(integer)'::regprocedure")).rows[0];
   assert.equal(fn.prosecdef,true);assert.deepEqual(fn.proconfig,['search_path=""']);
  });

  await t.test('isolation: per-person rows only from the same workspace; B never reads A rows; tg_scrap stays operator-only',async()=>{
   // 사람별 넣기는 모두 '지도 작업공간 = 옛 줄 작업공간'으로만 잇는다(함수·적용 때 넣기 둘 다).
   const joins=migration.replace(/--.*$/gm,'').match(/join public\.app_news_id_map m on m\.old_id = [a-z]\.news_item_id[^\n]*/g);
   assert.equal(joins.length,12,"넣기 8곳 + 사후 확인 4곳");for(const j of joins)assert.match(j,/and m\.workspace_id = ([a-z])\.workspace_id\b/);
   const B8=await item(WS_B,'media',8,'2026-11-11T00:00:00Z');
   await sync(2000);
   await pool.query(`insert into public.app_feed_reads(workspace_id,news_item_id,read_at) values ($1,$2,'2026-11-11T01:00:00Z')`,[WS_B,B8]);
   await sync(2000);
   const bReads=(await pool.query('select article_id from public.app_news_reads where workspace_id=$1',[WS_B])).rows.map(r=>r.article_id);
   assert.ok(bReads.includes((await pool.query('select article_id from public.app_news_id_map where old_id=$1',[B8])).rows[0].article_id));
   assert.equal((await pool.query('select count(*)::int n from public.app_news_reads where workspace_id=$1 and read_at=$2',[WS_A,'2026-11-11T01:00:00Z'])).rows[0].n,0,'다른 작업공간 읽음이 A로 가지 않음');
   const sees=async fn=>(await fn(c=>c.query('select workspace_id from public.app_news_reads union all select workspace_id from public.app_news_now_details union all select workspace_id from public.app_news_now_signals'))).rows;
   assert.ok((await sees(stranger)).every(r=>r.workspace_id===WS_B));assert.ok((await sees(owner)).every(r=>r.workspace_id===WS_A));
   assert.deepEqual((await stranger(c=>c.query('select id from public.app_news_articles where id=$1',[A3]))).rows,[],'tg_scrap 기사 B에게 0줄');
   assert.deepEqual((await stranger(c=>c.query('select article_id from public.app_news_article_bodies where article_id=$1',[A3]))).rows,[],'tg_scrap 본문 B에게 0줄');
   assert.deepEqual((await stranger(c=>c.query('select * from public.app_feed_rooms'))).rows,[],'다른 사람은 운영자 방을 못 봄');
   for(const room of ['g1','u1'])
    assert.equal((await server(c=>c.query('select public.app_news_room_take($1,$2,$3::jsonb) r',[WS_A,room,JSON.stringify([{url:'https://good.example.org/x',url_key:'good.example.org/x'}])]))).rows[0].r.news,false,room);
   assert.equal((await pool.query("select count(*)::int n from public.app_news_articles where url_key='good.example.org/x'")).rows[0].n,0,'뉴스방 아닌 업무방·1:1 글은 공용 표로 못 감');
  });

  await t.test('rollback removes function and record only; old and D2 tables stay; re-apply works',async()=>{
   const maps=await count('app_news_id_map');
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal(await count('app_news_id_map'),maps,'채운 줄은 남김');
   const again=await run('apply','9984');assert.equal(again.ok,true,again.summary);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
