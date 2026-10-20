// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// SHARE-현장공유 PR 1: share pages/links migration, owner RLS boundary, column privileges,
// guarded rollback, and the real share-page-read handler reading through the service_role column grants.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,PROJECT_B} from './basket4-fixture.mjs';
import {createShareReadHandler} from '../../supabase/functions/share-page-read/handler.ts';
const version='20261020005000',name='share_pages_links',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

test('share pages: migration, owner-only RLS, no anon, service_role column reads, handler and guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'share-pages-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false});
  await pool.query(fixture);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollback=await read('docs/'+stem+'.rollback.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);

  await t.test('precheck before apply is all 예 and snapshot shows absent tables',async()=>{
   const rows=(await pool.query(precheck)).rows;
   for(const r of rows.filter(r=>r.item!=='recent migrations'))assert.equal(r.value,'예',r.item);
   const snap=(await pool.query(snapshot)).rows.filter(r=>r.kind==='table');
   assert.deepEqual(snap.map(r=>r.definition),['absent','absent']);
  });
  await t.test('prerequisite guard stops when the owner check function is missing',async()=>{
   const c=await pool.connect();
   try{await c.query('begin');await c.query('alter function private.app_is_workspace_owner(uuid) rename to app_is_workspace_owner_x');await c.query('savepoint s');
    await assert.rejects(c.query(migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/SHARE_PAGES_PREREQUISITE_CHANGED/);}
   finally{await c.query('rollback');c.release();}
  });
  await t.test('apply succeeds once and postcheck is all 예; second apply is refused',async()=>{
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n,1);
   await assert.rejects(pool.query(migration),/SHARE_PAGES_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  let pageA,pageA2,pageB;
  await t.test('owner creates pages and links; DB generates the token and its hash',async()=>{
   const blocks=[{type:'summary',text:'한 줄 현황'},{type:'stages',items:['준비','교섭']},{type:'updates',items:[]}];
   pageA=(await owner(c=>c.query("insert into public.app_share_pages(workspace_id,project_id,title,blocks,status) values($1,$2,'민자철도 현황',$3,'published') returning id",[WS_A,PROJECT_A,JSON.stringify(blocks)]))).rows[0].id;
   pageA2=(await owner(c=>c.query("insert into public.app_share_pages(workspace_id,title,status) values($1,'다른 페이지','published') returning id",[WS_A]))).rows[0].id;
   pageB=(await stranger(c=>c.query("insert into public.app_share_pages(workspace_id,title,status) values($1,'남의 페이지','published') returning id",[WS_B]))).rows[0].id;
   const link=(await owner(c=>c.query("insert into public.app_share_page_links(workspace_id,page_id,label) values($1,$2,'○○지부') returning token,token_hash",[WS_A,pageA]))).rows[0];
   assert.match(link.token,/^[0-9a-f]{64}$/);
   assert.equal(link.token_hash,createHash('sha256').update(Buffer.from(link.token,'hex')).digest('hex'));
   // S2: owner can read the raw value again to re-copy it.
   const again=(await owner(c=>c.query('select token from public.app_share_page_links where page_id=$1',[pageA]))).rows;
   assert.deepEqual(again.map(r=>r.token),[link.token]);
   // S4: several links per page, each different.
   const second=(await owner(c=>c.query("insert into public.app_share_page_links(workspace_id,page_id,label) values($1,$2,'□□지부') returning token",[WS_A,pageA]))).rows[0];
   assert.notEqual(second.token,link.token);
  });
  await t.test('client cannot choose the token, its hash, or move a link',async()=>{
   await assert.rejects(owner(c=>c.query("insert into public.app_share_page_links(workspace_id,page_id,token) values($1,$2,$3)",[WS_A,pageA,'a'.repeat(64)])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_share_page_links(workspace_id,page_id,token_hash) values($1,$2,$3)",[WS_A,pageA,'a'.repeat(64)])),/42501|generated|cannot insert/);
   await assert.rejects(owner(c=>c.query('update public.app_share_page_links set token=$1',['b'.repeat(64)])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('update public.app_share_page_links set page_id=$1',[pageA2])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('update public.app_share_pages set workspace_id=$1',[WS_B])),{code:'42501'});
  });
  await t.test('owner cannot attach pages or links to another workspace',async()=>{
   await assert.rejects(owner(c=>c.query("insert into public.app_share_pages(workspace_id,title) values($1,'x')",[WS_B])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_share_pages(workspace_id,project_id,title) values($1,$2,'x')",[WS_A,PROJECT_B])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('insert into public.app_share_page_links(workspace_id,page_id) values($1,$2)',[WS_A,pageB])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('insert into public.app_share_page_links(workspace_id,page_id) values($1,$2)',[WS_B,pageB])),{code:'42501'});
  });
  await t.test('stranger sees and changes nothing of the owner',async()=>{
   const seen=await stranger(async c=>[(await c.query('select id from public.app_share_pages')).rows,(await c.query('select token from public.app_share_page_links')).rows]);
   assert.deepEqual(seen[0].map(r=>r.id),[pageB]);assert.deepEqual(seen[1],[]);
   assert.equal((await stranger(c=>c.query("update public.app_share_pages set title='hijack' where id=$1",[pageA]))).rowCount,0);
   assert.equal((await stranger(c=>c.query('update public.app_share_page_links set disabled_at=null'))).rowCount,0);
   assert.equal((await stranger(c=>c.query('delete from public.app_share_pages where id=$1',[pageA]))).rowCount,0);
  });
  await t.test('anon has no access at all; no login JWT sees nothing',async()=>{
   for(const sql of ['select 1 from public.app_share_pages','select 1 from public.app_share_page_links',"insert into public.app_share_pages(workspace_id,title) values('"+WS_A+"','x')",'select token_hash from public.app_share_page_links'])
    await assert.rejects(as('anon',null,c=>c.query(sql)),{code:'42501'},sql);
   assert.deepEqual((await as('authenticated',null,c=>c.query('select id from public.app_share_pages'))).rows,[]);
  });
  await t.test('service_role reads only the columns the reader needs and cannot write',async()=>{
   for(const sql of ['select token from public.app_share_page_links','select workspace_id from public.app_share_page_links','select workspace_id from public.app_share_pages','select project_id from public.app_share_pages','select * from public.app_share_pages',"update public.app_share_page_links set disabled_at=now() where page_id='"+pageA+"'","delete from public.app_share_pages where id='"+pageA+"'"])
    await assert.rejects(as('service_role',null,c=>c.query(sql)),{code:'42501'},sql);
  });
  await t.test('blocks are limited to the six types; title must be non-empty',async()=>{
   for(const blocks of [[{type:'script'}],[1],[{text:'no type'}],{type:'summary'},[{type:['summary']}],[{type:'summary'},{text:'x'}],[{type:'summary'},{type:'bad'}],[{type:'links'},[{type:'links'}]]])
    await assert.rejects(owner(c=>c.query("insert into public.app_share_pages(workspace_id,title,blocks) values($1,'x',$2)",[WS_A,JSON.stringify(blocks)])),{code:'23514'},JSON.stringify(blocks));
   await assert.rejects(owner(c=>c.query("insert into public.app_share_pages(workspace_id,title) values($1,'  ')",[WS_A])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("insert into public.app_share_pages(workspace_id,title,status) values($1,'x','public')",[WS_A])),{code:'23514'});
  });

  // The real handler, with the same two lookups as index.ts, executed as service_role.
  const reader={
   linkByHash:hash=>as('service_role',null,async c=>(await c.query('select page_id,token_hash,expires_at,disabled_at from public.app_share_page_links where token_hash=$1',[hash])).rows[0]??null),
   pageById:id=>as('service_role',null,async c=>(await c.query('select id,title,blocks,status from public.app_share_pages where id=$1',[id])).rows[0]??null),
  };
  const handler=createShareReadHandler({linkByHash:async h=>{const r=await reader.linkByHash(h);return r&&{...r,expires_at:r.expires_at?.toISOString()??null,disabled_at:r.disabled_at?.toISOString()??null};},pageById:reader.pageById},{log:()=>{}});
  const call=token=>handler(new Request('https://x.supabase.co/functions/v1/share-page-read',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://work.bokdoong.com'},body:JSON.stringify({token})}));
  const tokenOf=async label=>(await owner(c=>c.query('select token from public.app_share_page_links where label=$1',[label]))).rows[0].token;
  const newLink=async(page,label,extra='')=>(await owner(c=>c.query(`insert into public.app_share_page_links(workspace_id,page_id,label${extra?',expires_at':''}) values($1,$2,$3${extra?',$4':''}) returning token`,extra?[WS_A,page,label,extra]:[WS_A,page,label]))).rows[0].token;
  const expectNotFound=async r=>{assert.equal(r.status,404);assert.deepEqual(await r.json(),{error:'not_found'});};

  await t.test('valid link returns only that page title and blocks',async()=>{
   const r=await call(await tokenOf('○○지부'));assert.equal(r.status,200);
   const body=await r.json();
   assert.deepEqual(Object.keys(body.page).sort(),['blocks','title']);
   assert.equal(body.page.title,'민자철도 현황');assert.equal(body.page.blocks[0].type,'summary');
   const text=JSON.stringify(body);
   for(const secret of [OWNER,WS_A,PROJECT_A,pageA])assert.equal(text.includes(secret),false);
  });
  await t.test('disabled link is 404 immediately; other links of the page keep working',async()=>{
   await owner(c=>c.query("update public.app_share_page_links set disabled_at=now() where label='○○지부'"));
   await expectNotFound(await call(await tokenOf('○○지부')));
   assert.equal((await call(await tokenOf('□□지부'))).status,200);
  });
  await t.test('expired link is 404; future expiry works',async()=>{
   await expectNotFound(await call(await newLink(pageA,'지난 기한','2020-01-01T00:00:00Z')));
   assert.equal((await call(await newLink(pageA,'남은 기한','2999-01-01T00:00:00Z'))).status,200);
  });
  await t.test('draft page is 404; deleting a page removes its links',async()=>{
   const draft=(await owner(c=>c.query("insert into public.app_share_pages(workspace_id,title) values($1,'초안') returning id",[WS_A]))).rows[0].id;
   const token=await newLink(draft,'초안 링크');await expectNotFound(await call(token));
   await owner(c=>c.query('delete from public.app_share_pages where id=$1',[draft]));
   await expectNotFound(await call(token));
  });
  await t.test('a link never opens another page',async()=>{
   const token=await newLink(pageA2,'다른 페이지 링크');
   const body=await (await call(token)).json();assert.equal(body.page.title,'다른 페이지');
   const otherA=await (await call(await tokenOf('□□지부'))).json();assert.equal(otherA.page.title,'민자철도 현황');
  });
  await t.test('wrong, malformed or guessed values are the same 404',async()=>{
   for(const token of ['0'.repeat(64),'f'.repeat(64)])await expectNotFound(await call(token));
   for(const token of ['short','Z'.repeat(64),'A'.repeat(64),123,null])await expectNotFound(await call(token));
   // The stored hash itself is not a valid link value.
   const hash=(await owner(c=>c.query("select token_hash from public.app_share_page_links where label='□□지부'"))).rows[0].token_hash;
   await expectNotFound(await call(hash));
  });

  await t.test('rollback is blocked while pages or links exist; succeeds when empty',async()=>{
   await assert.rejects(pool.query(rollback),/SHARE_PAGES_ROLLBACK_BLOCKED/);await pool.query('rollback');
   assert.notEqual((await pool.query("select to_regclass('public.app_share_pages') t")).rows[0].t,null);
   await pool.query('delete from public.app_share_pages');
   await pool.query(rollback);
   assert.equal((await pool.query("select to_regclass('public.app_share_pages') t")).rows[0].t,null);
   assert.equal((await pool.query("select to_regclass('public.app_share_page_links') t")).rows[0].t,null);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   // Re-apply works after rollback.
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
  });
 }finally{await pool?.end();await cluster.stop().catch(()=>{});}
});
