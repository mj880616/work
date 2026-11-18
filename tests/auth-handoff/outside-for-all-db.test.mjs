// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S62-12c NEWS-모두에게열기 D1b DB(20261115150000_outside_for_all, 설계 docs/design/news-for-all.md 14절) — [사회운동] 공용 글 한 벌.
// - 승인형 workflow plan·dry-run·apply가 통과(확장 규칙)하고 dry-run은 아무것도 남기지 않는다. 두 번째 apply는 멈춘다.
// - 옮기기: url마다 공용 글 1줄(운영자 줄 id 우선), 문장은 문장 있는 줄에서, 옛 줄마다 지도 1줄, 표시·본문·읽음·자세히·반응은 그 작업공간 것으로. 옛 표 그대로.
// - 공용 글·문장·본문: 가입자만 읽고(비로그인·차단·작업공간 없는 로그인 0줄), 화면은 쓰지 못한다. 공용 찾기 함수도 같은 정책을 거친다.
// - 사람별(표시·읽음·자세히·반응): 남의 줄을 못 읽고·못 고치고·남의 작업공간으로 못 넣는다. 지도는 화면 권한 없음, 지도 함수는 자기 옛 id만.
// - 텔레그램: 새 표에 방·보낸 사람·글 칸이 없고 텔레그램 표를 가리키지 않는다. 단체 켜기·마지막 본 시각은 사람별 그대로.
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
const version='20261115150000',name='outside_for_all',stem=version+'_'+name;
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

test('outside for all (D1b): plan, dry-run, apply, shared posts/sentences/bodies, per-person marks/reads/details/signals, shared search, id map, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'outside-all-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
   '20261031230000_outside_statements','20261102150000_outside_search_undated','20261108020000_outside_post_body_ko','20261102140000_now_detail','20261106050000_feed_bodies','20261115100000_news_for_all'])
   await pool.query(await read('supabase/migrations/'+f+'.sql'));
  // 읽음 표는 진짜 정의(20261106080000의 표·정책·트리거 부분)만 — 같은 파일의 화면 설정 칸 검사는 이 시험과 무관.
  const readsSQL=await read('supabase/migrations/20261106080000_feed_reads_news_prefs.sql');
  await pool.query(readsSQL.slice(readsSQL.indexOf('create table public.app_feed_reads ('),readsSQL.indexOf('alter table public.app_profiles drop constraint')));
  await pool.query("insert into supabase_migrations.schema_migrations(version,name) values ('20261106080000','feed_reads_news_prefs')");

  // 옛 사회운동 글(작업공간별). A = 운영자, B = 다른 가입자. url1은 둘 다(B가 먼저 받음), url2는 A만, url3은 B만.
  const post=async(ws,n,at)=>(await pool.query(`insert into public.app_outside_posts(workspace_id,source_key,kind,lang,title,url,fetched_at)
    values ($1,'kctu','statement','ko','합성 성명',$2,$3) returning id`,[ws,'https://union.example.org/s/'+n,at])).rows[0].id;
  const PB1=await post(WS_B,1,'2026-10-31T00:00:00Z'),PA1=await post(WS_A,1,'2026-11-01T00:00:00Z'),PA2=await post(WS_A,2,'2026-11-01T00:00:00Z'),PB3=await post(WS_B,3,'2026-11-02T00:00:00Z');
  const sent=(ws,id,idx,text)=>pool.query("insert into public.app_outside_sentences(post_id,workspace_id,lang,idx,text) values($1,$2,'ko',$3,$4)",[id,ws,idx,text]);
  await sent(WS_B,PB1,0,'합성 첫 문장 임금');await sent(WS_B,PB1,1,'합성 둘째 문장');await sent(WS_A,PA2,0,'합성 단체 교섭 문장');
  await pool.query("insert into public.app_outside_marks(post_id,workspace_id,starred_at) values($1,$2,now()),($3,$4,now())",[PA1,WS_A,PB1,WS_B]);
  const body=(ws,id,text)=>pool.query(`insert into public.app_feed_bodies(workspace_id,outside_post_id,blocks,state,chars) values($1,$2,$3::jsonb,'ok',$4)`,[ws,id,JSON.stringify([{t:'p',text}]),text.length]);
  await body(WS_A,PA1,'운영자 본문');await body(WS_B,PB1,'다른 본문');await body(WS_B,PB3,'셋째 본문');
  await pool.query("insert into public.app_feed_reads(workspace_id,outside_post_id) values($1,$2),($3,$4)",[WS_A,PA1,WS_B,PB1]);
  await pool.query("insert into public.app_now_details(workspace_id,outside_post_id,summary) values($1,$2,'다른 자세히')",[WS_B,PB1]);
  await pool.query("insert into public.app_now_signals(workspace_id,outside_post_id,action) values($1,$2,'star'),($3,$4,'open')",[WS_A,PA1,WS_B,PB3]);
  await pool.query("insert into public.app_outside_sources(workspace_id,source_key) values($1,'kctu')",[WS_B]);
  await pool.query(`insert into public.app_feed_rooms(workspace_id,room_key,room_label,chat_kind) values ($1,'g1','합성 업무방','group')`,[WS_A]);

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
  const oldCounts=async()=>(await pool.query(`select (select count(*) from public.app_outside_posts)::int posts,(select count(*) from public.app_outside_sentences)::int sentences,
   (select count(*) from public.app_outside_marks)::int marks,(select count(*) from public.app_feed_bodies)::int bodies,(select count(*) from public.app_feed_reads)::int reads,
   (select count(*) from public.app_now_details)::int details,(select count(*) from public.app_now_signals)::int signals,(select count(*) from public.app_outside_sources)::int sources`)).rows[0];
  const before=(await pool.query(snapshot)).rows,old0=await oldCounts();let pre;
  const NEW=['app_outside_articles','app_outside_article_sentences','app_outside_article_marks','app_outside_article_bodies','app_outside_reads','app_outside_now_details','app_outside_now_signals','app_outside_id_map'];

  await t.test('files: expanded rules, three-line summary, read-only checks, no fixed id, snapshot reads catalogs only',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const p=prepareMigration({mode,version,runId:'1',root});assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');assert.deepEqual(p.targets,[]);}
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);
   ['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bto (anon|public)\b(?!\.)|disable row level|no force|rtw_/i);
   assert.doesNotMatch(code,new RegExp('create policy [a-z_]+ on public\\.(?!('+NEW.join('|')+') )','i'),'policies only on new tables');
   assert.doesNotMatch(code,new RegExp('alter table public\\.(?!('+NEW.join('|')+') )','i'),'no existing table changed');
   assert.doesNotMatch(code,/\b(update|delete from) public\./i,'no existing row changed');
   assert.doesNotMatch(code,/create (or replace )?function public\.app_outside_search\(/i,'old search untouched');
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
   pre=values(await readOnly(precheck));
   for(const [k,v] of Object.entries(pre))if(/^(예|아니오)$/.test(v))assert.equal(v,'예',k);
   assert.deepEqual(['post rows','distinct urls','sentence rows','mark rows','outside body rows','outside read rows','outside detail rows','outside signal rows'].map(k=>pre[k]),['4','3','3','2','3','2','1','2']);
  });

  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9961');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(values(await readOnly(precheck)),pre);assert.equal(await history(),0);
  });

  await t.test('apply passes postcheck; one article per url with operator id; sentences from a post that has them; second apply refused',async()=>{
   const result=await run('apply','9962');assert.equal(result.ok,true,result.summary);
   const post=values(await readOnly(postcheck));
   for(const [k,v] of Object.entries(post))if(/^(예|아니오)$/.test(v))assert.equal(v,'예',k);
   assert.deepEqual(['post rows','article rows','article sentence rows','map rows','article mark rows','article body rows','read rows','detail rows','signal rows'].map(k=>post[k]),['4','3','3','4','2','2','2','1','2']);
   assert.deepEqual(await oldCounts(),old0,'old tables untouched');
   const arts=Object.fromEntries((await pool.query('select url,id from public.app_outside_articles')).rows.map(a=>[a.url.slice(-1),a.id]));
   assert.deepEqual(arts,{1:PA1,2:PA2,3:PB3},'operator row id wins over the earlier row of another workspace');
   const s=(await pool.query('select article_id,idx,text from public.app_outside_article_sentences order by article_id,idx')).rows;
   assert.deepEqual(s.filter(x=>x.article_id===PA1).map(x=>x.text),['합성 첫 문장 임금','합성 둘째 문장'],'operator post had no sentences; B post sentences used');
   const bodies=Object.fromEntries((await pool.query("select article_id,blocks->0->>'text' t from public.app_outside_article_bodies")).rows.map(b=>[b.article_id,b.t]));
   assert.equal(bodies[PA1],'운영자 본문');assert.equal(bodies[PB3],'셋째 본문');
   const marks=(await pool.query('select workspace_id,article_id from public.app_outside_article_marks')).rows.map(m=>[m.workspace_id,m.article_id]).sort();
   assert.deepEqual(marks,[[WS_A,PA1],[WS_B,PA1]].sort());
   assert.equal((await run('apply','9963')).ok,false,'second apply stops');
   await assert.rejects(pool.query(migration),/OUTSIDE_FOR_ALL_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  await t.test('telegram: new tables carry no room, sender or message column and point at no telegram table',async()=>{
   for(const tb of NEW){
    const cols=(await pool.query("select attname from pg_attribute where attrelid=$1::regclass and attnum>0 and not attisdropped",['public.'+tb])).rows.map(r=>r.attname);
    for(const bad of ['room_key','room_label','chat_kind','chat_username','sender','senders','message','messages','raw_text','source_ref'])assert.ok(!cols.includes(bad),tb+'.'+bad);
    const refs=(await pool.query("select confrelid::regclass::text r from pg_constraint where conrelid=$1::regclass and contype='f'",['public.'+tb])).rows.map(r=>r.r);
    assert.ok(refs.every(r=>['app_outside_articles','app_workspaces'].includes(r)),tb+' → '+refs);
   }
   assert.deepEqual((await stranger(c=>c.query('select * from public.app_feed_rooms'))).rows,[],'other members never see operator rooms');
  });

  await t.test('shared posts, sentences, bodies: members read all; anon, blocked and no-workspace see nothing; no screen writes',async()=>{
   const n=async(fn,tb)=>(await fn(c=>c.query('select count(*)::int n from public.'+tb))).rows[0].n;
   for(const fn of [owner,stranger]){assert.equal(await n(fn,'app_outside_articles'),3);assert.equal(await n(fn,'app_outside_article_sentences'),3);assert.equal(await n(fn,'app_outside_article_bodies'),2);}
   for(const fn of [blocked,nows])for(const tb of ['app_outside_articles','app_outside_article_sentences','app_outside_article_bodies'])assert.equal(await n(fn,tb),0,tb);
   for(const tb of NEW)await assert.rejects(anon(c=>c.query('select * from public.'+tb)),{code:'42501'},tb);
   for(const fn of [owner,stranger]){
    await assert.rejects(fn(c=>c.query("insert into public.app_outside_articles(source_key,kind,lang,title,url) values('kctu','statement','ko','x','https://x.example.org/1')")),{code:'42501'});
    await assert.rejects(fn(c=>c.query("update public.app_outside_articles set title='바꿈' where id=$1",[PA1])),{code:'42501'});
    await assert.rejects(fn(c=>c.query('delete from public.app_outside_articles where id=$1',[PA1])),{code:'42501'});
    await assert.rejects(fn(c=>c.query("insert into public.app_outside_article_sentences(article_id,idx,text) values($1,9,'x')",[PA1])),{code:'42501'});
    await assert.rejects(fn(c=>c.query("delete from public.app_outside_article_bodies where article_id=$1",[PA1])),{code:'42501'});
   }
   await server(c=>c.query("update public.app_outside_articles set summary_ko='서버 요약' where id=$1",[PB3]));
   await server(c=>c.query("insert into public.app_outside_article_sentences(article_id,idx,text) values($1,0,'서버 문장')",[PB3]));
  });

  await t.test('marks, reads, details, signals: own rows only; no foreign workspace; blocked cannot add',async()=>{
   assert.deepEqual((await stranger(c=>c.query('select workspace_id from public.app_outside_article_marks'))).rows,[{workspace_id:WS_B}]);
   assert.equal((await stranger(c=>c.query('update public.app_outside_article_marks set archived_at=now() where workspace_id=$1',[WS_A]))).rowCount,0);
   assert.equal((await stranger(c=>c.query('delete from public.app_outside_article_marks where workspace_id=$1',[WS_A]))).rowCount,0);
   await stranger(c=>c.query('insert into public.app_outside_article_marks(workspace_id,article_id,dismissed_at) values($1,$2,now())',[WS_B,PA2]));
   await stranger(c=>c.query('update public.app_outside_article_marks set starred_at=now(),updated_at=now() where article_id=$1',[PA2]));
   await assert.rejects(stranger(c=>c.query('update public.app_outside_article_marks set article_id=$1 where article_id=$2',[PB3,PA2])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query('insert into public.app_outside_article_marks(workspace_id,article_id,starred_at) values($1,$2,now())',[WS_A,PB3])),{code:'42501'});
   await assert.rejects(blocked(c=>c.query('insert into public.app_outside_article_marks(workspace_id,article_id,starred_at) values($1,$2,now())',[WS_C,PA1])),{code:'42501'});
   assert.ok((await stranger(c=>c.query('select workspace_id from public.app_outside_reads'))).rows.every(r=>r.workspace_id===WS_B));
   await owner(c=>c.query('insert into public.app_outside_reads(workspace_id,article_id) values($1,$2)',[WS_A,PB3]));
   await stranger(c=>c.query('insert into public.app_outside_reads(workspace_id,article_id) values($1,$2)',[WS_B,PB3]));
   await assert.rejects(stranger(c=>c.query('insert into public.app_outside_reads(workspace_id,article_id) values($1,$2)',[WS_A,PA2])),{code:'42501'});
   await assert.rejects(blocked(c=>c.query('insert into public.app_outside_reads(workspace_id,article_id) values($1,$2)',[WS_C,PA1])),{code:'42501'});
   assert.equal((await stranger(c=>c.query('delete from public.app_outside_reads where workspace_id=$1',[WS_A]))).rowCount,0);
   assert.deepEqual((await owner(c=>c.query('select * from public.app_outside_now_details'))).rows,[]);
   assert.equal((await stranger(c=>c.query('select * from public.app_outside_now_details'))).rows.length,1);
   await assert.rejects(stranger(c=>c.query("insert into public.app_outside_now_details(workspace_id,article_id,summary) values($1,$2,'x')",[WS_B,PB3])),{code:'42501'});
   assert.ok((await owner(c=>c.query('select workspace_id from public.app_outside_now_signals'))).rows.every(r=>r.workspace_id===WS_A));
   await stranger(c=>c.query("insert into public.app_outside_now_signals(workspace_id,article_id,action) values($1,$2,'star')",[WS_B,PA1]));
   await assert.rejects(stranger(c=>c.query("insert into public.app_outside_now_signals(workspace_id,article_id,action) values($1,$2,'star')",[WS_A,PA1])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query("insert into public.app_outside_now_signals(workspace_id,article_id,action,created_at) values($1,$2,'open','2020-01-01')",[WS_B,PA1])),{code:'42501'});
   // 단체 켜기·마지막 본 시각은 사람별 그대로.
   assert.deepEqual((await owner(c=>c.query('select * from public.app_outside_sources'))).rows,[]);
  });

  await t.test('shared search: members find shared sentences; blocked and anon do not; old search stays per workspace',async()=>{
   const find=(fn,q)=>fn(c=>c.query("select post_id,sentence,matched from public.app_outside_search_shared($1,null,null,null,null,30,0)",[q])).then(r=>r.rows);
   const a=await find(owner,'임금');assert.equal(a.length,1);assert.equal(a[0].post_id,PA1);assert.equal(a[0].sentence,'합성 첫 문장 임금');
   assert.equal((await find(stranger,'교섭')).length,1,'B finds a sentence only A had');
   assert.deepEqual(await find(blocked,'임금'),[]);assert.deepEqual(await find(nows,'임금'),[]);
   await assert.rejects(anon(c=>c.query("select * from public.app_outside_search_shared('임금',null,null,null,null,30,0)")),{code:'42501'});
   await assert.rejects(server(c=>c.query("select * from public.app_outside_search_shared('임금',null,null,null,null,30,0)")),{code:'42501'});
   const old=await owner(c=>c.query("select post_id from public.app_outside_search('임금',null,null,null,null,30,0)"));
   assert.equal(old.rows.length,0,'old search still per workspace (A had no sentences)');
  });

  await t.test('id map: no screen privilege; map function returns own old ids only',async()=>{
   for(const fn of [owner,stranger])await assert.rejects(fn(c=>c.query('select * from public.app_outside_id_map')),{code:'42501'});
   const of=(fn,ids)=>fn(c=>c.query('select old_id,article_id from public.app_outside_article_of($1::uuid[])',[ids])).then(r=>r.rows.map(x=>[x.old_id,x.article_id]).sort());
   const all=[PA1,PA2,PB1,PB3];
   assert.deepEqual(await of(owner,all),[[PA1,PA1],[PA2,PA2]].sort());
   assert.deepEqual(await of(stranger,all),[[PB1,PA1],[PB3,PB3]].sort(),'B never gets A old ids');
   assert.deepEqual(await of(blocked,all),[]);assert.deepEqual(await of(nows,all),[]);
   await assert.rejects(anon(c=>c.query('select * from public.app_outside_article_of($1::uuid[])',[[PA1]])),{code:'42501'});
   await assert.rejects(server(c=>c.query('select * from public.app_outside_article_of($1::uuid[])',[[PA1]])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('select * from public.app_outside_article_of(null)')),/OUTSIDEMAP_ARGS/);
   await assert.rejects(owner(c=>c.query('select * from public.app_outside_article_of($1::uuid[])',[Array.from({length:201},()=>PA1)])),/OUTSIDEMAP_ARGS/);
   await server(c=>c.query('insert into public.app_outside_id_map(old_id,workspace_id,article_id) values(gen_random_uuid(),$1,$2)',[WS_B,PB3]));
   await assert.rejects(server(c=>c.query('delete from public.app_outside_id_map')),{code:'42501'});
  });

  await t.test('rollback removes new tables, functions and record; old tables stay; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(await oldCounts(),old0,'old tables untouched');
   const again=await run('apply','9964');assert.equal(again.ok,true,again.summary);
   assert.equal((await pool.query('select count(*)::int n from public.app_outside_id_map')).rows[0].n,4);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
