// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S62-12c NEWS-모두에게열기 D2 DB(20261115140000_news_for_all_refs, 설계 docs/design/news-for-all.md 13절).
// - 승인형 workflow plan·dry-run·apply가 통과(확장 규칙)하고 dry-run은 아무것도 남기지 않는다. 두 번째 apply는 멈춘다.
// - 옮기기: 옛 표에만 있던 주소도 공용 기사로(D1 규칙), 옛 줄마다 지도 1줄(같은 주소·같은 작업공간), 기사마다 본문 1줄(옛 id = 기사 id 줄 우선),
//   읽음·자세히·반응은 그 작업공간 것으로만. 옛 표 줄은 그대로.
// - 본문 블록: 기사를 읽을 수 있는 사람만(가입자, 'tg_scrap'은 운영자), 비로그인·차단·작업공간 없는 로그인은 0줄. 화면 쓰기 없음.
// - 사람별(읽음·자세히·반응): 남의 줄을 못 읽고·못 지우고·남의 작업공간이나 못 읽는 기사로 넣지 못한다. A가 읽어도 B가 넣을 수 있다.
// - 지도: 화면 권한 없음. 지도 함수는 자기 작업공간 옛 id만, 자기가 읽을 수 있는 기사로만 돌려준다.
// - 텔레그램: 새 표에 방·보낸 사람·글 칸이 없고 텔레그램 표를 가리키지 않는다. 뉴스방이 아닌 방 글은 여전히 공용 표로 못 간다.
// - 되돌리기 뒤 snapshot 같음·옛 표 그대로·다시 적용 가능.
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
const version='20261115140000',name='news_for_all_refs',stem=version+'_'+name;
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

test('news for all refs (D2): plan, dry-run, apply, shared bodies, per-person reads/details/signals, id map, rollback',{timeout:300000},async t=>{
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

  // 옛 표 합성 기사(D1 전). A = 운영자, B = 다른 가입자.
  const item=async(ws,lane,n,at='2026-11-01T00:00:00Z')=>(await pool.query(`insert into public.app_news_items(workspace_id,lane,url,url_key,title,state,summary,created_at)
    values ($1,$2,$3,$4,'합성 기사','ok','합성 요약',$5) returning id`,[ws,lane,'https://news.example.org/a/'+n,'news.example.org/a/'+n,at])).rows[0].id;
  const B1=await item(WS_B,'media',1,'2026-10-31T00:00:00Z');
  const A1=await item(WS_A,'media',1);
  const A2=await item(WS_A,'channel',2);               // tg_scrap
  const B4=await item(WS_B,'media',4);
  await pool.query(await read('supabase/migrations/20261115100000_news_for_all.sql'));
  // D1 뒤 E1 사이: 옛 표에만 들어온 주소(#6 B, #7 A 채널 스크랩), 공용 기사와 id가 다른 옛 줄(A의 #4 → 기사 B4).
  const B6=await item(WS_B,'media',6),A7=await item(WS_A,'channel',7),A4=await item(WS_A,'media',4);
  await pool.query(`insert into public.app_feed_rooms(workspace_id,room_key,room_label,chat_kind) values ($1,'g1','합성 업무방','group'),($1,'u1','합성 1:1','user')`,[WS_A]);
  // 옛 참조: 본문(A1·B1 둘 다 → 기사 A1, 옛 id = 기사 id 줄이 이김), A2(tg_scrap), B4, A4(같은 기사 B4 — B4 줄이 이김).
  const body=(ws,id,text,at)=>pool.query(`insert into public.app_feed_bodies(workspace_id,news_item_id,blocks,state,chars,extracted_at) values($1,$2,$3::jsonb,'ok',$4,$5)`,
   [ws,id,JSON.stringify([{t:'p',text}]),text.length,at]);
  await body(WS_A,A1,'운영자 본문','2026-11-01T00:00:00Z');await body(WS_B,B1,'다른 본문','2026-11-05T00:00:00Z');
  await body(WS_A,A2,'스크랩 본문','2026-11-01T00:00:00Z');await body(WS_B,B4,'기사4 본문','2026-11-01T00:00:00Z');await body(WS_A,A4,'기사4 다른 본문','2026-11-06T00:00:00Z');
  await pool.query(`insert into public.app_feed_reads(workspace_id,news_item_id,read_at) values ($1,$2,'2026-11-02T00:00:00Z'),($3,$4,'2026-11-03T00:00:00Z'),($3,$5,'2026-11-04T00:00:00Z')`,[WS_A,A1,WS_B,B1,B4]);
  await pool.query(`insert into public.app_now_details(workspace_id,news_item_id,summary,interests_key) values ($1,$2,'운영자 자세히','aaa'),($3,$4,'다른 자세히','bbb')`,[WS_A,A1,WS_B,B1]);
  await pool.query(`insert into public.app_now_signals(workspace_id,news_item_id,action) values ($1,$2,'star'),($3,$4,'open'),($3,$5,'open')`,[WS_A,A1,WS_B,B1,B4]);

  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),blocked=fn=>as('authenticated',BLOCKED,fn),
   nows=fn=>as('authenticated',NOWS,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  const oldCounts=async()=>(await pool.query(`select (select count(*) from public.app_news_items)::int items,(select count(*) from public.app_feed_bodies)::int bodies,
   (select count(*) from public.app_feed_reads)::int reads,(select count(*) from public.app_now_details)::int details,(select count(*) from public.app_now_signals)::int signals`)).rows[0];
  const before=(await pool.query(snapshot)).rows,old0=await oldCounts();let pre;

  await t.test('files: expanded rules, three-line summary, read-only checks, no fixed id, snapshot reads catalogs only',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const p=prepareMigration({mode,version,runId:'1',root});assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');assert.deepEqual(p.targets,[]);}
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);
   ['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bto (anon|public)\b(?!\.)|disable row level|no force|rtw_|security invoker/i);
   assert.doesNotMatch(code,/create policy [a-z_]+ on public\.(?!app_news_article_bodies|app_news_reads|app_news_now_details|app_news_now_signals)/i,'policies only on new tables');
   assert.doesNotMatch(code,/alter table public\.(?!app_news_article_bodies|app_news_reads|app_news_now_details|app_news_now_signals|app_news_id_map)/i,'no existing table changed');
   assert.doesNotMatch(code,/\b(update|delete from) public\./i,'no existing row changed');
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
   pre=values(await readOnly(precheck));
   for(const [k,v] of Object.entries(pre))if(/^(예|아니오)$/.test(v))assert.equal(v,'예',k);
   assert.deepEqual([pre['items rows'],pre['old only url keys'],pre['news body rows'],pre['news read rows'],pre['news detail rows'],pre['news signal rows']],['7','2','5','3','2','3']);
  });

  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(values(await readOnly(precheck)),pre);assert.equal(await history(),0);
  });

  await t.test('apply passes postcheck; copies old-only urls, maps every old row, one body per article; second apply refused',async()=>{
   const result=await run('apply','9972');assert.equal(result.ok,true,result.summary);
   const post=values(await readOnly(postcheck));
   for(const [k,v] of Object.entries(post))if(/^(예|아니오)$/.test(v))assert.equal(v,'예',k);
   assert.deepEqual([post['items rows'],post['map rows'],post['body rows'],post['read rows'],post['detail rows'],post['signal rows']],['7','7','3','3','2','3']);
   assert.deepEqual(await oldCounts(),old0,'old tables untouched');
   const arts=Object.fromEntries((await pool.query('select url_key,id,origin from public.app_news_articles')).rows.map(a=>[a.url_key.slice(-1),a]));
   assert.equal(arts['6'].id,B6);assert.equal(arts['6'].origin,'site');
   assert.equal(arts['7'].id,A7);assert.equal(arts['7'].origin,'tg_scrap');
   const map=Object.fromEntries((await pool.query('select old_id,article_id,workspace_id from public.app_news_id_map')).rows.map(m=>[m.old_id,m]));
   assert.equal(map[B1].article_id,A1);assert.equal(map[B1].workspace_id,WS_B);assert.equal(map[A4].article_id,B4);assert.equal(map[A4].workspace_id,WS_A);
   assert.equal(map[A1].article_id,A1);
   const bodies=Object.fromEntries((await pool.query("select article_id,blocks->0->>'text' t from public.app_news_article_bodies")).rows.map(b=>[b.article_id,b.t]));
   assert.equal(bodies[A1],'운영자 본문','row whose old id equals the article id wins over a newer one');
   assert.equal(bodies[B4],'기사4 본문');assert.equal(bodies[A2],'스크랩 본문');
   const reads=(await pool.query('select workspace_id,article_id from public.app_news_reads order by workspace_id,article_id')).rows;
   assert.deepEqual(reads.map(r=>[r.workspace_id,r.article_id]).sort(),[[WS_A,A1],[WS_B,A1],[WS_B,B4]].sort());
   const det=(await pool.query('select workspace_id,article_id,summary from public.app_news_now_details')).rows;
   assert.deepEqual(det.map(d=>[d.workspace_id,d.article_id,d.summary]).sort(),[[WS_A,A1,'운영자 자세히'],[WS_B,A1,'다른 자세히']].sort());
   assert.equal((await run('apply','9973')).ok,false,'second apply stops');
   await assert.rejects(pool.query(migration),/NEWS_REFS_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  await t.test('telegram: new tables carry no room, sender or message column and point at no telegram table; non-news rooms still add nothing',async()=>{
   for(const tb of ['app_news_article_bodies','app_news_reads','app_news_now_details','app_news_now_signals','app_news_id_map']){
    const cols=(await pool.query("select attname from pg_attribute where attrelid=$1::regclass and attnum>0 and not attisdropped",['public.'+tb])).rows.map(r=>r.attname);
    for(const bad of ['room_key','room_label','chat_kind','chat_username','sender','senders','text','message','messages','raw_text','source_ref'])assert.ok(!cols.includes(bad),tb+'.'+bad);
    const refs=(await pool.query("select confrelid::regclass::text r from pg_constraint where conrelid=$1::regclass and contype='f'",['public.'+tb])).rows.map(r=>r.r);
    assert.ok(refs.every(r=>['app_news_articles','app_workspaces'].includes(r)),tb+' → '+refs);
   }
   const n0=(await pool.query('select count(*)::int n from public.app_news_articles')).rows[0].n;
   for(const room of ['g1','u1'])
    assert.equal((await server(c=>c.query('select public.app_news_room_take($1,$2,$3::jsonb) r',[WS_A,room,JSON.stringify([{url:'https://good.example.org/x',url_key:'good.example.org/x'}])]))).rows[0].r.news,false,room);
   assert.equal((await pool.query('select count(*)::int n from public.app_news_articles')).rows[0].n,n0);
   assert.deepEqual((await stranger(c=>c.query('select * from public.app_feed_rooms'))).rows,[],'other members never see operator rooms');
  });

  await t.test('bodies: readers of the article only; tg_scrap bodies operator only; anon, blocked and no-workspace see nothing; no screen writes',async()=>{
   const ids=async fn=>(await fn(c=>c.query('select article_id from public.app_news_article_bodies'))).rows.map(r=>r.article_id).sort();
   assert.deepEqual(await ids(owner),[A1,A2,B4].sort());
   assert.deepEqual(await ids(stranger),[A1,B4].sort(),'tg_scrap body hidden from B');
   assert.deepEqual(await ids(blocked),[]);assert.deepEqual(await ids(nows),[]);
   await assert.rejects(anon(c=>c.query('select * from public.app_news_article_bodies')),{code:'42501'});
   for(const fn of [owner,stranger]){
    await assert.rejects(fn(c=>c.query("insert into public.app_news_article_bodies(article_id,state,chars) values($1,'failed',0)",[B6])),{code:'42501'});
    await assert.rejects(fn(c=>c.query("update public.app_news_article_bodies set rule=null where article_id=$1",[A1])),{code:'42501'});
    await assert.rejects(fn(c=>c.query('delete from public.app_news_article_bodies where article_id=$1',[A1])),{code:'42501'});
   }
   await server(c=>c.query(`insert into public.app_news_article_bodies(article_id,blocks,state,chars) values($1,'[{"t":"p","text":"서버 본문"}]'::jsonb,'ok',5)`,[B6]));
  });

  await t.test('reads: own rows only; A reading does not block B; no foreign workspace or unreadable article',async()=>{
   const mine=async fn=>(await fn(c=>c.query('select workspace_id,article_id from public.app_news_reads'))).rows;
   assert.ok((await mine(stranger)).every(r=>r.workspace_id===WS_B));assert.equal((await mine(stranger)).length,2);
   assert.ok((await mine(owner)).every(r=>r.workspace_id===WS_A));assert.equal((await mine(blocked)).length,0);
   await owner(c=>c.query('insert into public.app_news_reads(workspace_id,article_id) values($1,$2)',[WS_A,B6]));
   await stranger(c=>c.query('insert into public.app_news_reads(workspace_id,article_id) values($1,$2)',[WS_B,B6]));
   await assert.rejects(stranger(c=>c.query('insert into public.app_news_reads(workspace_id,article_id) values($1,$2)',[WS_A,A2])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query('insert into public.app_news_reads(workspace_id,article_id) values($1,$2)',[WS_B,A2])),{code:'42501'},'tg_scrap unreadable for B');
   await assert.rejects(blocked(c=>c.query('insert into public.app_news_reads(workspace_id,article_id) values($1,$2)',[WS_C,A1])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query("insert into public.app_news_reads(workspace_id,article_id,read_at) values($1,$2,'2020-01-01')",[WS_B,A1])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query("update public.app_news_reads set read_at=now() where workspace_id=$1",[WS_B])),{code:'42501'});
   assert.equal((await stranger(c=>c.query('delete from public.app_news_reads where workspace_id=$1',[WS_A]))).rowCount,0);
   assert.equal((await stranger(c=>c.query('delete from public.app_news_reads where article_id=$1',[B6]))).rowCount,1);
   assert.equal((await pool.query('select count(*)::int n from public.app_news_reads where workspace_id=$1',[WS_A])).rows[0].n,2);
  });

  await t.test('details and signals: own rows only; details server-written; signals own insert with readable article',async()=>{
   assert.deepEqual((await stranger(c=>c.query('select workspace_id,summary from public.app_news_now_details'))).rows,[{workspace_id:WS_B,summary:'다른 자세히'}]);
   assert.deepEqual((await blocked(c=>c.query('select * from public.app_news_now_details'))).rows,[]);
   await assert.rejects(stranger(c=>c.query("insert into public.app_news_now_details(workspace_id,article_id,summary) values($1,$2,'x')",[WS_B,B4])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query("update public.app_news_now_details set summary='x'")),{code:'42501'});
   await server(c=>c.query("insert into public.app_news_now_details(workspace_id,article_id,summary) values($1,$2,'서버 자세히')",[WS_B,B4]));
   assert.ok((await stranger(c=>c.query('select workspace_id from public.app_news_now_signals'))).rows.every(r=>r.workspace_id===WS_B));
   assert.equal((await owner(c=>c.query('select * from public.app_news_now_signals'))).rows.length,1);
   await stranger(c=>c.query("insert into public.app_news_now_signals(workspace_id,article_id,action) values($1,$2,'star')",[WS_B,A1]));
   await assert.rejects(stranger(c=>c.query("insert into public.app_news_now_signals(workspace_id,article_id,action) values($1,$2,'star')",[WS_A,A1])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query("insert into public.app_news_now_signals(workspace_id,article_id,action) values($1,$2,'open')",[WS_B,A2])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query("insert into public.app_news_now_signals(workspace_id,article_id,action,created_at) values($1,$2,'open','2020-01-01')",[WS_B,A1])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query("delete from public.app_news_now_signals where workspace_id=$1",[WS_B])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query("insert into public.app_news_now_signals(workspace_id,article_id,action) values($1,$2,'bad')",[WS_B,A1])),{code:'23514'});
  });

  await t.test('id map: no screen privilege; map function returns own old ids readable only',async()=>{
   for(const fn of [owner,stranger])await assert.rejects(fn(c=>c.query('select * from public.app_news_id_map')),{code:'42501'});
   await assert.rejects(anon(c=>c.query('select * from public.app_news_id_map')),{code:'42501'});
   const of=(fn,ids)=>fn(c=>c.query('select old_id,article_id from public.app_news_article_of($1::uuid[]) order by old_id',[ids])).then(r=>r.rows.map(x=>[x.old_id,x.article_id]));
   const all=[A1,A2,A4,A7,B1,B4,B6];
   assert.deepEqual(await of(owner,all),[[A1,A1],[A2,A2],[A4,B4],[A7,A7]].sort((a,b)=>a[0]<b[0]?-1:1));
   assert.deepEqual(await of(stranger,all),[[B1,A1],[B4,B4],[B6,B6]].sort((a,b)=>a[0]<b[0]?-1:1),'B never gets A old ids');
   assert.deepEqual(await of(blocked,all),[]);assert.deepEqual(await of(nows,all),[]);
   await assert.rejects(anon(c=>c.query('select * from public.app_news_article_of($1::uuid[])',[[A1]])),{code:'42501'});
   await assert.rejects(server(c=>c.query('select * from public.app_news_article_of($1::uuid[])',[[A1]])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('select * from public.app_news_article_of(null)')),/NEWSMAP_ARGS/);
   await assert.rejects(owner(c=>c.query("select * from public.app_news_article_of('{}'::uuid[])")),/NEWSMAP_ARGS/);
   await assert.rejects(owner(c=>c.query('select * from public.app_news_article_of($1::uuid[])',[Array.from({length:201},()=>A1)])),/NEWSMAP_ARGS/);
   // 운영자가 telegram 기능을 잃으면 tg_scrap 지도도 안 돌려준다(기사 읽기 정책과 같음).
   await pool.query("delete from public.app_operator_features where workspace_id=$1 and feature='telegram'",[WS_A]);
   assert.deepEqual((await of(owner,[A2,A7])),[]);
   await pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'telegram')",[WS_A]);
   await server(c=>c.query('insert into public.app_news_id_map(old_id,workspace_id,article_id) values(gen_random_uuid(),$1,$2)',[WS_B,B6]));
   await assert.rejects(server(c=>c.query('update public.app_news_id_map set article_id=$1',[A1])),{code:'42501'});
   await assert.rejects(server(c=>c.query('delete from public.app_news_id_map')),{code:'42501'});
  });

  await t.test('rollback removes new tables, function and record; old tables stay; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(await oldCounts(),old0,'old tables untouched');
   const again=await run('apply','9974');assert.equal(again.ok,true,again.summary);
   assert.equal((await pool.query('select count(*)::int n from public.app_news_id_map')).rows[0].n,7);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
