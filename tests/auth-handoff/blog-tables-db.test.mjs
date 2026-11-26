// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// BLOG ①(20261125113100_blog_tables, docs/design/blog.md 3절·9절): 운영자 기능 키 blog + 표 3개(app_blogs·app_blog_boards·app_blog_posts).
// - 사전 조건이 다르면 멈추고, 적용 뒤 사후 확인이 모두 예이며 기존 표(공유 페이지·노트·운영자 표)의 칸·정책·권한·트리거 해시가 그대로.
// - blog 허용 행은 calls 작업공간 하나에만. 그 owner만 세 표를 읽고 쓴다. 다른 가입자(blog 허용 없음)는 자기 작업공간에도 못 넣고(RLS 42501),
//   남의 작업공간에도 못 넣는다. anon·PUBLIC 권한 없음. service_role은 정해진 칸만 읽고 쓰지 못한다.
// - 글 짝은 같은 작업공간의 게시판·공유 페이지·노트(kind 'note')만. 고치기는 board_id·republished_at만. 주소용 key는 DB가 만든다.
// - 글이 남은 게시판은 지울 수 없다. 허용 행을 지우면 owner도 읽기·쓰기가 막힌다. 되돌리기는 블로그 줄이 남아 있으면 멈춘다.
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
import {blogPrerequisites} from './blog-tables-fixture.mjs';
const version='20261125113100',name='blog_tables',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

test('blog tables: guard, pair files, operator-only RLS, same-workspace posts, column limits, guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'blog-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(await read('supabase/migrations/20261020005000_share_pages_links.sql'));
  await pool.query(blogPrerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollback=await read('docs/'+stem+'.rollback.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  assert.match(await read('docs/'+stem+'.summary.md'),/무엇이 바뀌나:[\s\S]*잘못되면:[\s\S]*되돌리는 법:/);
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),service=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const items=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const one=async(fn,sql,args)=>(await fn(c=>c.query(sql,args))).rows[0];
  const newNote=(fn,ws,kind='note')=>one(fn,"insert into public.app_notes(workspace_id,kind,title,raw_text) values($1,$2,'글','본문') returning id",[ws,kind]);
  const newPage=(fn,ws)=>one(fn,"insert into public.app_share_pages(workspace_id,title,status) values($1,'글','published') returning id",[ws]);

  let pre;
  await t.test('precheck before apply: expected values, snapshot reads catalogs only',async()=>{
   pre=items((await pool.query(precheck)).rows);
   for(const k of ['prerequisite recorded','new migration absent','new tables absent','feature check with nojo_words without blog','single calls workspace','owner and feature functions'])assert.equal(pre[k],'예',k);
   assert.equal(pre['blog rows'],'0');
   const snap=(await pool.query(snapshot)).rows;
   for(const n of ['app_blogs','app_blog_boards','app_blog_posts'])assert.ok(snap.some(r=>r.kind==='new table'&&r.name===n&&r.definition==='absent'),n);
   assert.ok(snap.some(r=>r.kind==='constraint'&&r.name.endsWith('app_operator_features_feature_check')));
  });
  await t.test('prerequisite guard: stops when a new table already exists or calls is not a single workspace',async()=>{
   const body=migration.replace(/^begin;/,'').replace(/commit;\s*$/,'');
   for(const setup of ['create table public.app_blogs(id int)',`insert into public.app_operator_features values('${WS_B}','calls')`]){
    const c=await pool.connect();
    try{await c.query('begin');await c.query(setup);await assert.rejects(c.query(body),/BLOG_TABLES_(PREREQUISITE_CHANGED|SEED_WORKSPACE_NOT_SINGLE)/);}
    finally{await c.query('rollback');c.release();}
   }
  });
  await t.test('apply once: postcheck all yes, existing tables unchanged, blog row only on the calls workspace; second apply refused',async()=>{
   await pool.query(migration);
   const post=items((await pool.query(postcheck)).rows);
   for(const k of ['new tables and history agree','new tables RLS enabled','new tables four owner policies each','new tables no anon or public privilege','service_role reads only','blog row on calls workspace'])assert.equal(post[k],'예',k);
   for(const k of ['share pages rows','existing tables columns hash','existing tables policies hash','existing tables grants hash','existing tables triggers hash'])assert.equal(post[k],pre[k],k);
   assert.deepEqual((await pool.query("select workspace_id::text w from public.app_operator_features where feature='blog'")).rows,[{w:WS_A}]);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n,1);
   await assert.rejects(pool.query(migration),/BLOG_TABLES_PREREQUISITE_CHANGED/);await pool.query('rollback');
   assert.deepEqual((await one(owner,'select public.app_my_features() f')).f.includes('blog'),true);
   assert.deepEqual((await one(stranger,'select public.app_my_features() f')).f,[]);
  });

  let blog,board,board2,note,page,post;
  await t.test('operator owner: blog, boards and a post; keys made by the database',async()=>{
   blog=await one(owner,"insert into public.app_blogs(workspace_id,title,intro) values($1,'사용자 블로그','한 줄') returning id,enabled,indexable",[WS_A]);
   assert.equal(blog.enabled,false);assert.equal(blog.indexable,false);
   board=await one(owner,"insert into public.app_blog_boards(workspace_id,blog_id,name) values($1,$2,'생각') returning id,public_key",[WS_A,blog.id]);
   board2=await one(owner,"insert into public.app_blog_boards(workspace_id,blog_id,name,sort) values($1,$2,'기록',1) returning id,public_key",[WS_A,blog.id]);
   assert.match(board.public_key,/^[0-9a-f]{10}$/);
   note=await newNote(owner,WS_A);page=await newPage(owner,WS_A);
   post=await one(owner,'insert into public.app_blog_posts(workspace_id,board_id,page_id,note_id) values($1,$2,$3,$4) returning id,public_key,published_at',[WS_A,board.id,page.id,note.id]);
   assert.match(post.public_key,/^[0-9a-f]{10}$/);assert.ok(post.published_at);
   await assert.rejects(owner(c=>c.query("insert into public.app_blogs(workspace_id,title) values($1,'둘째')",[WS_A])),{code:'23505'},'one blog per workspace');
   await assert.rejects(owner(c=>c.query("insert into public.app_blog_boards(workspace_id,blog_id,name,public_key) values($1,$2,'x','0000000000')",[WS_A,blog.id])),{code:'42501'},'key not settable');
   await assert.rejects(owner(c=>c.query("insert into public.app_blogs(workspace_id,title) values($1,'  ')",[WS_A])),{code:'23514'});
  });
  await t.test('post: one per note and per page; same-workspace board, page and note (kind note) only',async()=>{
   const page2=await newPage(owner,WS_A),note2=await newNote(owner,WS_A);
   await assert.rejects(owner(c=>c.query('insert into public.app_blog_posts(workspace_id,board_id,page_id,note_id) values($1,$2,$3,$4)',[WS_A,board.id,page2.id,note.id])),{code:'23505'},'same note twice');
   await assert.rejects(owner(c=>c.query('insert into public.app_blog_posts(workspace_id,board_id,page_id,note_id) values($1,$2,$3,$4)',[WS_A,board.id,page.id,note2.id])),{code:'23505'},'same page twice');
   const memo=await newNote(owner,WS_A,'basket');
   await assert.rejects(owner(c=>c.query('insert into public.app_blog_posts(workspace_id,board_id,page_id,note_id) values($1,$2,$3,$4)',[WS_A,board.id,page2.id,memo.id])),{code:'42501'},'memo is not a note');
   await assert.rejects(owner(c=>c.query('insert into public.app_blog_posts(workspace_id,board_id,page_id,note_id) values($1,$2,$3,null)',[WS_A,board.id,page2.id])),{code:'42501'},'note required');
   const otherNote=await newNote(stranger,WS_B),otherPage=await newPage(stranger,WS_B);
   await assert.rejects(owner(c=>c.query('insert into public.app_blog_posts(workspace_id,board_id,page_id,note_id) values($1,$2,$3,$4)',[WS_A,board.id,otherPage.id,note2.id])),{code:'42501'},'other page');
   await assert.rejects(owner(c=>c.query('insert into public.app_blog_posts(workspace_id,board_id,page_id,note_id) values($1,$2,$3,$4)',[WS_A,board.id,page2.id,otherNote.id])),{code:'42501'},'other note');
  });
  await t.test('post update: board move and republish time only; key, page, note, workspace fixed',async()=>{
   await owner(c=>c.query('update public.app_blog_posts set board_id=$1, republished_at=now() where id=$2',[board2.id,post.id]));
   for(const set of ["public_key='0000000000'",'page_id=page_id','note_id=note_id','workspace_id=workspace_id','published_at=now()'])
    await assert.rejects(owner(c=>c.query('update public.app_blog_posts set '+set)),{code:'42501'},set);
   await assert.rejects(owner(c=>c.query('update public.app_blog_boards set public_key=$1',['0000000000'])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('update public.app_blog_boards set blog_id=blog_id')),{code:'42501'});
   await owner(c=>c.query("update public.app_blogs set enabled=true, indexable=false, title='블로그', updated_at=now()"));
   await assert.rejects(owner(c=>c.query('delete from public.app_blog_boards where id=$1',[board2.id])),{code:'23503'},'board with posts cannot be deleted');
  });
  await t.test('other member (no blog feature): refused on own and on the operator workspace; sees nothing',async()=>{
   await assert.rejects(stranger(c=>c.query("insert into public.app_blogs(workspace_id,title) values($1,'남의 블로그')",[WS_B])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query("insert into public.app_blogs(workspace_id,title) values($1,'침입')",[WS_A])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query("insert into public.app_blog_boards(workspace_id,blog_id,name) values($1,$2,'침입')",[WS_A,blog.id])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query("insert into public.app_blog_boards(workspace_id,blog_id,name) values($1,$2,'침입')",[WS_B,blog.id])),{code:'42501'});
   const otherNote=await newNote(stranger,WS_B),otherPage=await newPage(stranger,WS_B);
   await assert.rejects(stranger(c=>c.query('insert into public.app_blog_posts(workspace_id,board_id,page_id,note_id) values($1,$2,$3,$4)',[WS_B,board.id,otherPage.id,otherNote.id])),{code:'42501'});
   for(const tb of ['app_blogs','app_blog_boards','app_blog_posts'])assert.equal((await one(stranger,`select count(*)::int n from public.${tb}`)).n,0,tb);
   const u=await stranger(c=>c.query('update public.app_blog_posts set republished_at=now()'));assert.equal(u.rowCount,0);
   const d=await stranger(c=>c.query('delete from public.app_blogs'));assert.equal(d.rowCount,0);
  });
  await t.test('anon: no privilege on any blog table; service_role: listed columns only, no writes',async()=>{
   for(const tb of ['app_blogs','app_blog_boards','app_blog_posts'])await assert.rejects(anon(c=>c.query(`select 1 from public.${tb}`)),{code:'42501'},tb);
   assert.equal((await one(service,'select count(*)::int n from (select board_id,page_id,note_id,public_key,published_at,republished_at from public.app_blog_posts) s')).n,1);
   assert.equal((await one(service,'select count(*)::int n from (select id,blog_id,name,sort,public_key from public.app_blog_boards) s')).n,2);
   assert.equal((await one(service,'select count(*)::int n from (select id,workspace_id,title,intro,enabled,indexable from public.app_blogs) s')).n,1);
   for(const sql of ['select workspace_id from public.app_blog_posts','select id from public.app_blog_posts','select workspace_id from public.app_blog_boards','select created_at from public.app_blogs',
    "update public.app_blogs set enabled=false","delete from public.app_blog_posts",`insert into public.app_blogs(workspace_id,title) values('${WS_B}','x')`])
    await assert.rejects(service(c=>c.query(sql)),{code:'42501'},sql);
   assert.equal((await one(service,"select public.app_operator_feature_workspace('blog')::text w")).w,WS_A);
  });
  await t.test('removing the allow row blocks the owner too (read and write)',async()=>{
   await pool.query("delete from public.app_operator_features where feature='blog'");
   assert.equal((await one(owner,'select count(*)::int n from public.app_blog_posts')).n,0);
   await assert.rejects(owner(c=>c.query("insert into public.app_blog_boards(workspace_id,blog_id,name) values($1,$2,'새')",[WS_A,blog.id])),{code:'42501'});
   assert.equal((await one(service,"select public.app_operator_feature_workspace('blog') w")).w,null);
   await pool.query(`insert into public.app_operator_features(workspace_id,feature) values('${WS_A}','blog')`);
  });
  await t.test('rollback stops while blog rows exist; after clearing it restores the key list and history',async()=>{
   await assert.rejects(pool.query(rollback),/BLOG_TABLES_ROLLBACK_BLOCKED/);await pool.query('rollback');
   await pool.query('delete from public.app_blog_posts; delete from public.app_blog_boards; delete from public.app_blogs');
   await pool.query(rollback);
   const post=items((await pool.query(postcheck)).rows);
   for(const k of ['new tables and history agree','blog row on calls workspace'])assert.equal(post[k],'예',k);
   for(const k of ['existing tables columns hash','existing tables policies hash','existing tables grants hash','existing tables triggers hash'])assert.equal(post[k],pre[k],k);
   assert.equal((await pool.query("select count(*)::int n from public.app_operator_features where feature in ('calls','telegram','arsenal')")).rows[0].n,3);
   await assert.rejects(pool.query(`insert into public.app_operator_features values('${WS_A}','blog')`),{code:'23514'});
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
