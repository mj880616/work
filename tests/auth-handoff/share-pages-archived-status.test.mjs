// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// SHARE-페이지삭제: app_share_pages_status_check accepts 'archived' (hidden page, record kept). Checks the prerequisite guard,
// precheck/postcheck pair files, that an archived page stops the public link (the real share-page-read handler) while the link
// row and the page row stay, that the owner can set and restore the status, that other rules stay (stranger, anon, bad values),
// and that the rollback stops while an archived page exists.
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
import {createShareReadHandler} from '../../supabase/functions/share-page-read/handler.ts';
const base='20261020005000_share_pages_links',version='20261023160000',name='share_pages_archived_status',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

test('share pages archived status: guard, pair files, hidden page stops the link, guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'share-archived-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(await read('supabase/migrations/'+base+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollback=await read('docs/'+stem+'.rollback.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const items=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));

  let before;
  await t.test('precheck before apply: expected values, snapshot readable',async()=>{
   before=items((await pool.query(precheck)).rows);
   for(const k of ['prerequisite recorded','new migration absent','status check draft and published only','RLS enabled','one owner policy'])assert.equal(before[k],'예',k);
   assert.equal(before['anon or public table privilege'],'아니오');
   assert.equal(before['archived pages'],'0');assert.equal(before['status values outside draft and published'],'0');
   assert.ok((await pool.query(snapshot)).rows.some(r=>r.kind==='constraint'&&r.name==='app_share_pages_status_check'));
  });
  await t.test('before apply an archived status is refused',async()=>{
   await assert.rejects(owner(c=>c.query("insert into public.app_share_pages(workspace_id,title,status) values($1,'x','archived')",[WS_A])),{code:'23514'});
  });
  await t.test('prerequisite guard stops when the status check was already changed',async()=>{
   const c=await pool.connect();
   try{await c.query('begin');await c.query('alter table public.app_share_pages drop constraint app_share_pages_status_check');
    await c.query("alter table public.app_share_pages add constraint app_share_pages_status_check check (status in ('draft','published','archived'))");
    await assert.rejects(c.query(migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/SHARE_ARCHIVED_STATUS_PREREQUISITE_CHANGED/);}
   finally{await c.query('rollback');c.release();}
  });
  await t.test('prerequisite guard stops when a policy was added',async()=>{
   const c=await pool.connect();
   try{await c.query('begin');await c.query("create policy extra on public.app_share_pages for select to authenticated using (true)");
    await assert.rejects(c.query(migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/SHARE_ARCHIVED_STATUS_PREREQUISITE_CHANGED/);}
   finally{await c.query('rollback');c.release();}
  });

  let pageId;
  await t.test('data before apply, then apply once; postcheck equals precheck hashes; second apply refused',async()=>{
   pageId=(await owner(c=>c.query("insert into public.app_share_pages(workspace_id,title,status) values($1,'게시 페이지','published') returning id",[WS_A]))).rows[0].id;
   const pre=items((await pool.query(precheck)).rows);
   await pool.query(migration);
   const post=items((await pool.query(postcheck)).rows);
   for(const k of ['status check and history agree','RLS still enabled','one owner policy','no anon or public table privilege'])assert.equal(post[k],'예',k);
   for(const k of ['share pages rows','other constraints hash','indexes hash','owner RLS grants hash','column grants hash','policies hash','triggers hash'])assert.equal(post[k],pre[k],k);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n,1);
   await assert.rejects(pool.query(migration),/SHARE_ARCHIVED_STATUS_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  const reader={
   linkByHash:hash=>as('service_role',null,async c=>(await c.query('select page_id,token_hash,expires_at,disabled_at from public.app_share_page_links where token_hash=$1',[hash])).rows[0]??null),
   pageById:id=>as('service_role',null,async c=>(await c.query('select id,title,blocks,status from public.app_share_pages where id=$1',[id])).rows[0]??null),
  };
  const handler=createShareReadHandler({linkByHash:async h=>{const r=await reader.linkByHash(h);return r&&{...r,expires_at:r.expires_at?.toISOString()??null,disabled_at:r.disabled_at?.toISOString()??null};},pageById:reader.pageById},{log:()=>{}});
  const call=token=>handler(new Request('https://x.supabase.co/functions/v1/share-page-read',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://work.bokdoong.com'},body:JSON.stringify({token})}));
  const setStatus=status=>owner(c=>c.query('update public.app_share_pages set status=$2,updated_at=now() where id=$1 and workspace_id=$3 returning status',[pageId,status,WS_A]));

  await t.test('archiving a published page stops its link; the rows stay; restoring brings the link back',async()=>{
   const token=(await owner(c=>c.query("insert into public.app_share_page_links(workspace_id,page_id,label) values($1,$2,'받는 곳') returning token",[WS_A,pageId]))).rows[0].token;
   assert.equal((await call(token)).status,200);
   assert.equal((await setStatus('archived')).rows[0].status,'archived');
   const gone=await call(token);assert.equal(gone.status,404);assert.deepEqual(await gone.json(),{error:'not_found'});
   // Nothing was deleted: the page row and its link row are still there, the link is not turned off.
   assert.equal((await owner(c=>c.query('select count(*)::int n from public.app_share_pages where id=$1',[pageId]))).rows[0].n,1);
   const link=(await owner(c=>c.query('select disabled_at from public.app_share_page_links where page_id=$1',[pageId]))).rows;
   assert.equal(link.length,1);assert.equal(link[0].disabled_at,null);
   assert.equal((await setStatus('published')).rows[0].status,'published');
   assert.equal((await call(token)).status,200);
  });
  await t.test('an archived draft is also hidden; the list can filter it out',async()=>{
   await setStatus('draft');await setStatus('archived');
   const rows=(await owner(c=>c.query("select id from public.app_share_pages where workspace_id=$1 and status<>'archived'",[WS_A]))).rows;
   assert.equal(rows.some(r=>r.id===pageId),false);
  });
  await t.test('other rules are unchanged: bad status, stranger, anon',async()=>{
   await assert.rejects(owner(c=>c.query("update public.app_share_pages set status='public' where id=$1",[pageId])),{code:'23514'});
   const touched=(await stranger(c=>c.query("update public.app_share_pages set status='published' where id=$1",[pageId]))).rowCount;
   assert.equal(touched,0);
   assert.equal((await owner(c=>c.query('select status from public.app_share_pages where id=$1',[pageId]))).rows[0].status,'archived');
   await assert.rejects(as('anon',null,c=>c.query('select 1 from public.app_share_pages')),{code:'42501'});
   await assert.rejects(as('anon',null,c=>c.query("update public.app_share_pages set status='published'")),{code:'42501'});
  });
  await t.test('rollback is blocked while an archived page exists; works after the status is decided',async()=>{
   await assert.rejects(pool.query(rollback),/SHARE_ARCHIVED_STATUS_ROLLBACK_BLOCKED/);await pool.query('rollback');
   await setStatus('draft');
   await pool.query(rollback);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   const post=items((await pool.query(postcheck)).rows);assert.equal(post['status check and history agree'],'예');
   await assert.rejects(owner(c=>c.query("update public.app_share_pages set status='archived' where id=$1",[pageId])),{code:'23514'});
   await pool.query(migration);
   assert.equal(items((await pool.query(postcheck)).rows)['status check and history agree'],'예');
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
