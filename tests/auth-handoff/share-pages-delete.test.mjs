// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// SHARE-페이지삭제(완전 삭제): no migration. The existing grants and owner RLS already let the owner delete a share page row,
// and the FKs (on delete cascade) take its links and photo records with it. A stranger, anon and service_role cannot delete.
// share-page-media purge_page relies on exactly this (it removes the photo files first, then this row delete with the caller's token).
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
import {fixture,OWNER,STRANGER,WS_A} from './basket4-fixture.mjs';
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

test('share page delete: owner row delete cascades to links and photo records; stranger, anon, service_role cannot',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'share-delete-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  for(const stem of ['20261020005000_share_pages_links','20261022130000_share_pages_doc_block','20261023110000_share_page_media','20261023160000_share_pages_archived_status'])
   await pool.query(await read('supabase/migrations/'+stem+'.sql'));
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const count=async(table,id)=>(await pool.query(`select count(*)::int n from public.${table} where ${table==='app_share_pages'?'id':'page_id'}=$1`,[id])).rows[0].n;
  await t.test('a photo record can be made for the page (path shape check)',async()=>{
   const id=(await owner(c=>c.query("insert into public.app_share_pages(workspace_id,title) values($1,'사진') returning id",[WS_A]))).rows[0].id;
   const mid='40000000-0000-4000-8000-0000000000aa';
   await owner(c=>c.query('insert into public.app_share_page_media(id,workspace_id,page_id,storage_path,width,height,bytes) values($1,$2,$3,$4,1,1,1)',[mid,WS_A,id,`${id}/${mid}.jpg`]));
   assert.equal(await count('app_share_page_media',id),1);
   await owner(c=>c.query('delete from public.app_share_pages where id=$1',[id]));
   assert.equal(await count('app_share_page_media',id),0);
  });
  for(const status of ['draft','published','archived'])await t.test(`owner deletes a ${status} page: links and photo records go too`,async()=>{
   const id=(await owner(c=>c.query("insert into public.app_share_pages(workspace_id,title,status) values($1,'지울 페이지',$2) returning id",[WS_A,status]))).rows[0].id;
   await owner(c=>c.query("insert into public.app_share_page_links(workspace_id,page_id,label) values($1,$2,'받는 곳')",[WS_A,id]));
   const mid=`40000000-0000-4000-8000-${status==='draft'?'000000000001':status==='published'?'000000000002':'000000000003'}`;
   await owner(c=>c.query('insert into public.app_share_page_media(id,workspace_id,page_id,storage_path,width,height,bytes) values($1,$2,$3,$4,1,1,1)',[mid,WS_A,id,`${id}/${mid}.jpg`]));
   // stranger: no row seen, nothing deleted
   assert.equal((await stranger(c=>c.query('delete from public.app_share_pages where id=$1 returning id',[id]))).rowCount,0);
   assert.equal(await count('app_share_pages',id),1);
   // anon and service_role have no delete right at all
   await assert.rejects(as('anon',null,c=>c.query('delete from public.app_share_pages where id=$1',[id])),{code:'42501'});
   await assert.rejects(as('service_role',null,c=>c.query('delete from public.app_share_pages where id=$1',[id])),{code:'42501'});
   assert.equal(await count('app_share_pages',id),1);assert.equal(await count('app_share_page_links',id),1);assert.equal(await count('app_share_page_media',id),1);
   // owner: exactly one row, cascade takes the link and the photo record
   assert.equal((await owner(c=>c.query('delete from public.app_share_pages where id=$1 returning id',[id]))).rowCount,1);
   assert.equal(await count('app_share_pages',id),0);assert.equal(await count('app_share_page_links',id),0);assert.equal(await count('app_share_page_media',id),0);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
