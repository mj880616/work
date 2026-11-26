// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S62-12 NEWS-모두에게열기 ① DB(20261115100000_news_for_all, 설계 docs/design/news-for-all.md 2·3·5절).
// - 승인형 workflow plan·dry-run·apply가 통과(확장 규칙)하고 dry-run은 아무것도 남기지 않는다. 두 번째 apply는 멈춘다.
// - 공용 기사: 가입자(owner 행 1개·차단 명단 아님)만 읽고, 비로그인·차단·작업공간 없는 로그인은 0줄. 화면은 넣기·고치기·지우기 못 함.
//   옮기는 동안의 'tg_scrap' 줄은 운영자(telegram 기능)만 읽는다.
// - 사람별 표시: 남의 표시를 못 읽고·못 고치고, 남의 작업공간 줄이나 못 읽는 기사로 넣지 못한다. 키워드 칸은 서버만.
// - 뉴스방: telegram 기능이 있는 owner만, 그룹·채널만(1:1·종류 모름 거절), 가족 방 거절. 수집기 함수는 서버 표로 다시 판정하고
//   기사 주소만 넣으며 업무 문서·초대·단축·내부 주소는 버린다. 뉴스방이 아니면 0줄. 텔레그램 원문·방 칸은 공용 표에 없다.
// - 옮기기: 기사는 url_key마다 1줄(운영자 줄 id 우선), 표시는 표시 있던 줄 수만큼. 옛 표 줄은 그대로. 되돌리기 뒤 다시 적용 가능.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261115100000',name='news_for_all',stem=version+'_'+name;
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
  -- 가입 차단 명단 표의 최소 모양(20261113140000과 같은 칸·권한: API 역할 권한 없음).
  create table public.app_workspace_signup_allow(email text primary key, kind text not null, created_at timestamptz not null default now(),
    constraint app_workspace_signup_allow_kind check (kind in ('operator','blocked')));
  alter table public.app_workspace_signup_allow enable row level security;
  revoke all on table public.app_workspace_signup_allow from public, anon, authenticated, service_role;
  insert into public.app_workspace_signup_allow values ('blocked@example.test','blocked');
  insert into supabase_migrations.schema_migrations(version,name) values ('20261113140000','workspace_signup_allow');`;
const BEFORE=['20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261025200000_call_personal_box',
 '20261025210000_feed_item_archive','20261026120000_call_user_edit','20261026190000_tg_sender_names','20261027010000_tg_room_day_group',
 '20261027030000_tg_sender_names_read','20261027200000_tg_summary_edit','20261028030000_tg_room_day_context','20261029090000_operator_features'];
const famTag=(ws,room)=>createHash('sha256').update(`family-room|${ws}|${room}`).digest('hex').slice(0,16);

test('news for all: plan, dry-run, apply, shared read, per-person marks, news rooms, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'news-for-all-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  // 운영자 작업공간(A)에만 텔레그램 자료가 있어야 operator_features가 A에 telegram 기능을 준다.
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-24','2026-10-24T03:00:00Z','가상 통화','가상 요약','call:uc1')",[WS_A]);
  await pool.query(await read('supabase/migrations/'+BEFORE.at(-1)+'.sql'));
  for(const f of ['20261028160000_ai_usage_costs','20261031120000_gdrive_photo_index','20261102160000_cloud_files_index','20261103100000_dev_inbox_feature',
   '20261030060000_tg_room_pin','20261105100000_family_notes','20261101233000_news_clipping','20261108140000_news_titles_tried'])
   await pool.query(await read('supabase/migrations/'+f+'.sql'));

  // 합성 기사(옛 표). A = 운영자, B = 다른 가입자.
  const FOLDER=(await pool.query("insert into public.app_news_folders(workspace_id,name) values($1,'모음') returning id",[WS_A])).rows[0].id;
  const item=async(ws,lane,n,extra={})=>(await pool.query(`insert into public.app_news_items(workspace_id,lane,url,url_key,title,state,starred_at,folder_id,hidden_at,keywords,summary,created_at)
    values ($1,$2,$3,$4,'합성 기사','ok',$5,$6,$7,$8,'합성 요약',$9) returning id`,
    [ws,lane,'https://news.example.org/a/'+n,'news.example.org/a/'+n,extra.star??null,extra.folder??null,extra.hide??null,extra.kw??[],extra.at??'2026-11-01T00:00:00Z'])).rows[0].id;
  const B1=await item(WS_B,'media',1,{star:'2026-11-02T00:00:00Z',at:'2026-10-31T00:00:00Z'});   // B가 먼저 넣었어도 id는 A 줄
  const A1=await item(WS_A,'media',1,{star:'2026-11-02T00:00:00Z',folder:FOLDER});
  const A2=await item(WS_A,'channel',2);                                    // 채널 스크랩만 → tg_scrap
  const A3=await item(WS_A,'keyword',3,{hide:'2026-11-03T00:00:00Z',kw:['노동']});
  const B4=await item(WS_B,'media',4);
  const A5=await item(WS_A,'channel',5);await item(WS_B,'media',5);        // 같은 주소가 사이트에도 → site
  await pool.query(`insert into public.app_feed_rooms(workspace_id,room_key,room_label,chat_kind) values
    ($1,'ch1','합성 채널','channel'),($1,'g1','합성 그룹','group'),($1,'u1','합성 1:1','user'),($1,'nk','합성 방',null),($1,'fam','합성 가족','group')`,[WS_A]);
  await pool.query(`insert into public.app_family_notes(workspace_id,kind,body,origin,origin_day,source_ref) values($1,'remind','합성 메모','telegram','2026-11-01',$2)`,
    [WS_A,`fam:tg:${famTag(WS_A,'fam')}:x1`]);

  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),blocked=fn=>as('authenticated',BLOCKED,fn),
   nows=fn=>as('authenticated',NOWS,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const keys=async fn=>(await fn(c=>c.query('select url_key from public.app_news_articles order by url_key'))).rows.map(r=>r.url_key.replace('news.example.org/a/','#'));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  const before=(await pool.query(snapshot)).rows;let pre;

  await t.test('files: expanded rules, three-line summary, read-only checks, no fixed id, snapshot reads catalogs only',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const p=prepareMigration({mode,version,runId:'1',root});assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');assert.deepEqual(p.targets,['app_feed_rooms']);}
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);
   ['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bto (anon|public)\b(?!\.)|disable row level|no force|rtw_|create policy [a-z_]+ on public\.(?!app_news_articles|app_news_marks)/i);
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
   pre=values(await readOnly(precheck));
   for(const [k,v] of Object.entries(pre))if(/^(예|아니오)$/.test(v))assert.equal(v,'예',k);
   assert.equal(pre['items rows'],'7');assert.equal(pre['distinct url keys'],'5');assert.equal(pre['marked item rows'],'3');
  });

  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(values(await readOnly(precheck)),pre);assert.equal(await history(),0);
  });

  await t.test('apply passes postcheck; copy keeps operator ids; second apply refused',async()=>{
   const result=await run('apply','9982');assert.equal(result.ok,true,result.summary);
   const post=values(await readOnly(postcheck));
   for(const [k,v] of Object.entries(post))if(/^(예|아니오)$/.test(v))assert.equal(v,'예',k);
   for(const k of ['items rows','distinct url keys','marked item rows','rooms rows','rooms grants policies triggers hash'])assert.equal(post[k],pre[k],k);
   const arts=(await pool.query('select id,origin,lane,url_key from public.app_news_articles order by url_key')).rows;
   assert.deepEqual(arts.map(a=>[a.url_key.slice(-1),a.origin]),[['1','site'],['2','tg_scrap'],['3','site'],['4','site'],['5','site']]);
   assert.equal(arts[0].id,A1,'operator row id wins over the earlier row of another workspace');
   assert.equal(arts[1].id,A2);assert.equal(arts[3].id,B4);assert.equal(arts[4].id,A5);
   assert.ok(!arts.some(a=>a.id===B1));
   const marks=(await pool.query('select workspace_id,article_id,starred_at is not null s,folder_id,hidden_at is not null h,keywords from public.app_news_marks order by workspace_id,article_id')).rows;
   assert.equal(marks.length,3);
   assert.deepEqual(marks.find(m=>m.workspace_id===WS_B),{workspace_id:WS_B,article_id:A1,s:true,folder_id:null,h:false,keywords:[]});
   assert.equal(marks.find(m=>m.article_id===A1&&m.workspace_id===WS_A).folder_id,FOLDER);
   assert.deepEqual(marks.find(m=>m.article_id===A3).keywords,['노동']);
   assert.equal((await run('apply','9983')).ok,false,'second apply stops');
   await assert.rejects(pool.query(migration),/NEWS_FOR_ALL_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  await t.test('shared table has no telegram text, room or sender column',async()=>{
   const cols=(await pool.query("select attname from pg_attribute where attrelid='public.app_news_articles'::regclass and attnum>0 and not attisdropped")).rows.map(r=>r.attname);
   for(const bad of ['workspace_id','room_key','room_label','chat_kind','chat_username','sender','senders','text','message','messages','raw_text','starred_at','hidden_at','folder_id','keywords'])
    assert.ok(!cols.includes(bad),bad);
  });

  await t.test('read: members see shared articles; tg_scrap only for the operator; anon, blocked and no-workspace see nothing',async()=>{
   assert.deepEqual(await keys(owner),['#1','#2','#3','#4','#5']);
   assert.deepEqual(await keys(stranger),['#1','#3','#4','#5']);
   assert.deepEqual(await keys(blocked),[],'block list (email case-insensitive) refused');
   assert.deepEqual(await keys(nows),[],'signed in without a workspace');
   await assert.rejects(anon(c=>c.query('select * from public.app_news_articles')),{code:'42501'});
   await assert.rejects(anon(c=>c.query('select * from public.app_news_marks')),{code:'42501'});
   // 옛 표는 그대로 owner만.
   assert.deepEqual((await stranger(c=>c.query('select workspace_id from public.app_news_items'))).rows.map(r=>r.workspace_id).filter(w=>w!==WS_B),[]);
  });

  await t.test('write: signed-in users cannot add, change or delete shared articles',async()=>{
   for(const fn of [owner,stranger]){
    await assert.rejects(fn(c=>c.query("insert into public.app_news_articles(origin,lane,url,url_key) values('site','media','https://x.example.org/1','x.example.org/1')")),{code:'42501'});
    await assert.rejects(fn(c=>c.query("update public.app_news_articles set title='바꿈' where id=$1",[A1])),{code:'42501'});
    await assert.rejects(fn(c=>c.query('delete from public.app_news_articles where id=$1',[A1])),{code:'42501'});
   }
   await server(c=>c.query("update public.app_news_articles set summary='서버 요약' where id=$1",[A1]));
  });

  await t.test('marks: own rows only; no foreign workspace or unreadable article; keywords server only',async()=>{
   const mine=async fn=>(await fn(c=>c.query('select workspace_id,article_id from public.app_news_marks'))).rows;
   assert.ok((await mine(stranger)).every(m=>m.workspace_id===WS_B));assert.equal((await mine(stranger)).length,1);
   assert.ok((await mine(owner)).every(m=>m.workspace_id===WS_A));
   assert.equal((await mine(blocked)).length,0);
   // 남의 표시 고치기·지우기: 0줄.
   assert.equal((await stranger(c=>c.query('update public.app_news_marks set hidden_at=now() where workspace_id=$1',[WS_A]))).rowCount,0);
   assert.equal((await stranger(c=>c.query('delete from public.app_news_marks where workspace_id=$1',[WS_A]))).rowCount,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_news_marks where workspace_id=$1',[WS_A])).rows[0].n,2);
   // 자기 표시 넣기·고치기·지우기.
   await stranger(c=>c.query('insert into public.app_news_marks(workspace_id,article_id,hidden_at) values($1,$2,now())',[WS_B,A3]));
   await stranger(c=>c.query('update public.app_news_marks set starred_at=now(),updated_at=now() where article_id=$1',[A3]));
   await stranger(c=>c.query('delete from public.app_news_marks where article_id=$1',[A3]));
   await assert.rejects(stranger(c=>c.query('insert into public.app_news_marks(workspace_id,article_id,starred_at) values($1,$2,now())',[WS_A,B4])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query('insert into public.app_news_marks(workspace_id,article_id,starred_at) values($1,$2,now())',[WS_B,A2])),{code:'42501'},'tg_scrap is unreadable for B');
   await assert.rejects(blocked(c=>c.query('insert into public.app_news_marks(workspace_id,article_id,starred_at) values($1,$2,now())',[WS_C,A1])),{code:'42501'},'blocked cannot read the article');
   await assert.rejects(stranger(c=>c.query("update public.app_news_marks set keywords='{x}' where workspace_id=$1",[WS_B])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query("insert into public.app_news_marks(workspace_id,article_id,keywords) values($1,$2,'{x}')",[WS_B,B4])),{code:'42501'});
   // 폴더는 같은 작업공간 폴더만.
   await assert.rejects(stranger(c=>c.query('update public.app_news_marks set folder_id=$1 where workspace_id=$2',[FOLDER,WS_B])),{code:'23503'});
   await server(c=>c.query("update public.app_news_marks set keywords='{임금}' where workspace_id=$1",[WS_B]));
  });

  await t.test('news room switch: telegram owner only, group/channel only, family refused, missing refused',async()=>{
   const sw=(fn,room,on)=>fn(c=>c.query('select public.app_feed_room_news($1,$2) r',[room,on])).then(x=>x.rows[0].r);
   await assert.rejects(sw(stranger,'ch1',true),/OPERATOR_FEATURE_REQUIRED/);
   await assert.rejects(sw(anon,'ch1',true),{code:'42501'});
   await assert.rejects(server(c=>c.query("select public.app_feed_room_news('ch1',true)")),{code:'42501'});
   await assert.rejects(sw(owner,'u1',true),/TGNEWS_KIND/);
   await assert.rejects(sw(owner,'nk',true),/TGNEWS_KIND/);
   await assert.rejects(sw(owner,'fam',true),/TGNEWS_FAMILY/);
   await assert.rejects(sw(owner,'none',true),/TGDG_NOT_FOUND/);
   await assert.rejects(sw(owner,'bad key!',true),/TGDG_ARGS/);
   const on=await sw(owner,'ch1',true);assert.equal(on.changed,true);assert.ok(on.news_at);
   assert.equal((await sw(owner,'ch1',true)).changed,false,'same state twice is no change');
   await assert.rejects(stranger(c=>c.query("update public.app_feed_rooms set news_at=now() where room_key='g1'")),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_feed_rooms set news_at=now() where room_key='g1'")),{code:'42501'},'column only through the function');
  });

  await t.test('room take: server re-checks the room table, keeps article URLs only, drops document/invite/short/internal hosts',async()=>{
   const take=(room,items,ws=WS_A)=>server(c=>c.query('select public.app_news_room_take($1,$2,$3::jsonb) r',[ws,room,JSON.stringify(items)])).then(x=>x.rows[0].r);
   const it=u=>({url:u,url_key:u.replace(/^https:\/\//,'')});
   const count=async()=>(await pool.query('select count(*)::int n from public.app_news_articles')).rows[0].n;
   const n0=await count();
   for(const room of ['g1','u1','nk','fam','none'])assert.deepEqual(await take(room,[it('https://good.example.org/x')]),{ok:true,news:false,taken:0,dup:0,widened:0,refused:0},room);
   assert.equal((await take('ch1',[it('https://good.example.org/x')],WS_B)).news,false,'workspace without the telegram feature');
   assert.equal(await count(),n0);
   const bad=['https://docs.google.com/document/d/x','https://drive.google.com/file/d/x','https://t.me/joinchat/x','https://bit.ly/x','https://open.kakao.com/o/x',
    'https://x.sharepoint.com/s','https://work.bokdoong.com/app','https://forms.gle/x','https://www.notion.so/x','https://zoom.us/j/1','https://10.0.0.1/x',
    'https://localhost/x','https://abc.supabase.co/rest','http://plain.example.org/x','https://user@good.example.org/x'];
   const r=await take('ch1',[...bad.map(it),it('https://good.example.org/x'),it('https://blog.example.org/@writer/post-1'),{url:'https://news.example.org/a/2',url_key:'news.example.org/a/2'},
    {url:'https://news.example.org/a/1',url_key:'news.example.org/a/1'},{url:5},'x']);
   assert.deepEqual(r,{ok:true,news:true,taken:2,dup:1,widened:1,refused:bad.length+2});
   const got=(await pool.query("select origin,lane,state,url from public.app_news_articles where url_key in ('good.example.org/x','news.example.org/a/2') order by url_key")).rows;
   assert.deepEqual(got.map(g=>[g.origin,g.lane,g.state]),[['tg_room','channel','pending'],['tg_room','channel','ok']]);
   assert.deepEqual(await keys(stranger),['blog.example.org/@writer/post-1','good.example.org/x','#1','#2','#3','#4','#5'],'B now sees the news-room articles');
   await assert.rejects(owner(c=>c.query("select public.app_news_room_take($1,'ch1','[]'::jsonb)",[WS_A])),{code:'42501'});
   await assert.rejects(take('ch1',[]),/NEWSROOM_ARGS/);
   await assert.rejects(take('ch1',Array.from({length:51},(_,i)=>it('https://good.example.org/'+i))),/NEWSROOM_ARGS/);
   // [뉴스방에서 빼기] 뒤에는 넣지 않지만 이미 들어간 기사는 그대로(사용자 결정 6).
   await owner(c=>c.query("select public.app_feed_room_news('ch1',false)"));
   assert.equal((await take('ch1',[it('https://good.example.org/y')])).news,false);
   assert.equal((await pool.query("select count(*)::int n from public.app_news_articles where url_key='good.example.org/x'")).rows[0].n,1);
  });

  await t.test('rollback removes new tables, functions, column and record; old items stay; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal((await pool.query('select count(*)::int n from public.app_news_items')).rows[0].n,7,'old items stay');
   const again=await run('apply','9984');assert.equal(again.ok,true,again.summary);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
