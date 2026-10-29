// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// SHARE-보관함·HTML공유 1/3: app_share_page_html (HTML file versions, 5MB) and app_share_page_slugs (name + 8 DB-made letters).
// Checks the prerequisite guard, the pair files (precheck/postcheck hashes of the existing tables stay equal), owner-only access,
// that the random letters come from the DB only, the sha256 lookup value, the size limit, what service_role may read, cascades,
// and the guarded rollback.
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
const base='20261020005000_share_pages_links',version='20261029140000',name='share_html_pages',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

test('share html pages: guard, pair files, owner-only versions and short links, guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'share-html-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(await read('supabase/migrations/'+base+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollback=await read('docs/'+stem+'.rollback.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  assert.match(await read('docs/'+stem+'.summary.md'),/무엇이 바뀌나:[\s\S]*잘못되면:[\s\S]*되돌리는 법:/);
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const items=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const pageId=(await owner(c=>c.query("insert into public.app_share_pages(workspace_id,title,status) values($1,'현장 현황','published') returning id",[WS_A]))).rows[0].id;
  const link=(await owner(c=>c.query("insert into public.app_share_page_links(workspace_id,page_id) values($1,$2) returning token,token_hash",[WS_A,pageId]))).rows[0];

  let pre;
  await t.test('precheck before apply: expected values, snapshot reads catalogs',async()=>{
   pre=items((await pool.query(precheck)).rows);
   for(const k of ['prerequisite recorded','new migration absent','new tables absent','link token hash unique','owner check function'])assert.equal(pre[k],'예',k);
   const snap=(await pool.query(snapshot)).rows;
   assert.ok(snap.some(r=>r.kind==='new table'&&r.name==='app_share_page_html'&&r.definition==='absent'));
   assert.ok(snap.some(r=>r.kind==='constraint'&&r.name.endsWith('app_share_page_links_token_hash_key')));
  });
  await t.test('prerequisite guard stops when a new table already exists',async()=>{
   const c=await pool.connect();
   try{await c.query('begin');await c.query('create table public.app_share_page_html(id int)');
    await assert.rejects(c.query(migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/SHARE_HTML_PREREQUISITE_CHANGED/);}
   finally{await c.query('rollback');c.release();}
  });
  await t.test('apply once; existing tables unchanged (postcheck = precheck); second apply refused',async()=>{
   await pool.query(migration);
   const post=items((await pool.query(postcheck)).rows);
   for(const k of ['new tables and history agree','new tables RLS enabled','new tables one owner policy each','new tables no anon or public privilege','service_role reads no slug text'])assert.equal(post[k],'예',k);
   for(const k of ['share pages rows','share links rows','existing tables columns hash','existing tables constraints hash','existing tables policies hash','existing tables grants hash','existing tables triggers hash'])assert.equal(post[k],pre[k],k);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n,1);
   await assert.rejects(pool.query(migration),/SHARE_HTML_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  let slug;
  await t.test('owner adds an HTML version and a short link; the random letters come from the DB',async()=>{
   const html='<!doctype html><title>그래프</title><canvas></canvas><script>1</script>';
   const v=(await owner(c=>c.query("insert into public.app_share_page_html(workspace_id,page_id,html,file_name) values($1,$2,$3,'a.html') returning bytes",[WS_A,pageId,html]))).rows[0];
   assert.equal(v.bytes,Buffer.byteLength(html));
   const s=(await owner(c=>c.query("insert into public.app_share_page_slugs(workspace_id,token_hash,slug_name) values($1,$2,'minja-rail') returning slug_name,slug_code,slug_hash",[WS_A,link.token_hash]))).rows[0];
   assert.match(s.slug_code,/^[a-km-np-z2-9]{8}$/);
   slug=s.slug_name+'-'+s.slug_code;
   assert.equal(s.slug_hash,createHash('sha256').update(slug,'utf8').digest('hex'));
   // The screen cannot pick the letters (no insert grant on slug_code), nor the lookup value.
   await assert.rejects(owner(c=>c.query("insert into public.app_share_page_slugs(workspace_id,token_hash,slug_name,slug_code) values($1,$2,'x2','aaaaaaaa')",[WS_A,link.token_hash])),{code:'42501'});
   // One short link per link row.
   await assert.rejects(owner(c=>c.query("insert into public.app_share_page_slugs(workspace_id,token_hash,slug_name) values($1,$2,'again')",[WS_A,link.token_hash])),{code:'23505'});
   // Versions and short links are not edited.
   await assert.rejects(owner(c=>c.query("update public.app_share_page_html set html='x' where page_id=$1",[pageId])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_share_page_slugs set slug_name='other'")),{code:'42501'});
  });
  await t.test('many generated codes look random enough (all 32 letters used, few repeats)',async()=>{
   const l2=(await owner(c=>c.query("insert into public.app_share_page_links(workspace_id,page_id) select $1,$2 from generate_series(1,300) returning token_hash",[WS_A,pageId]))).rows;
   const codes=(await owner(c=>c.query("insert into public.app_share_page_slugs(workspace_id,token_hash,slug_name) select $1,h,'bulk' from unnest($2::text[]) h returning slug_code",[WS_A,l2.map(r=>r.token_hash)]))).rows.map(r=>r.slug_code);
   assert.equal(new Set(codes).size,300);
   assert.equal(new Set(codes.join('')).size,32);
   await owner(c=>c.query("delete from public.app_share_page_links where page_id=$1 and token_hash<>$2",[pageId,link.token_hash]));
   assert.equal((await owner(c=>c.query("select count(*)::int n from public.app_share_page_slugs"))).rows[0].n,1,'deleting a link removes its short link');
  });
  await t.test('bad values are refused: name shape, size over 5MB, empty file',async()=>{
   for(const bad of ['A-b','-x','x','x--y','한글','a_b','x'.repeat(41)]){
    const l=(await owner(c=>c.query("insert into public.app_share_page_links(workspace_id,page_id) values($1,$2) returning token_hash",[WS_A,pageId]))).rows[0];
    await assert.rejects(owner(c=>c.query("insert into public.app_share_page_slugs(workspace_id,token_hash,slug_name) values($1,$2,$3)",[WS_A,l.token_hash,bad])),{code:'23514'},bad);
   }
   await assert.rejects(owner(c=>c.query("insert into public.app_share_page_html(workspace_id,page_id,html) values($1,$2,repeat('a',5242881))",[WS_A,pageId])),{code:'23514'});
   await owner(c=>c.query("insert into public.app_share_page_html(workspace_id,page_id,html) values($1,$2,repeat('a',5242880))",[WS_A,pageId]));
   await assert.rejects(owner(c=>c.query("insert into public.app_share_page_html(workspace_id,page_id,html) values($1,$2,'')",[WS_A,pageId])),{code:'23514'});
  });
  await t.test('stranger, other workspace and anon cannot read or add',async()=>{
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_share_page_html'))).rows[0].n,0);
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_share_page_slugs'))).rows[0].n,0);
   await assert.rejects(stranger(c=>c.query("insert into public.app_share_page_html(workspace_id,page_id,html) values($1,$2,'x')",[WS_A,pageId])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query("insert into public.app_share_page_html(workspace_id,page_id,html) values($1,$2,'x')",[WS_B,pageId])),{code:'42501'});
   // The owner cannot put a short link for a link of another workspace, nor a version into a page of another workspace.
   await assert.rejects(owner(c=>c.query("insert into public.app_share_page_html(workspace_id,page_id,html) values($1,$2,'x')",[WS_B,pageId])),{code:'42501'});
   await assert.rejects(as('anon',null,c=>c.query('select 1 from public.app_share_page_html')),{code:'42501'});
   await assert.rejects(as('anon',null,c=>c.query('select 1 from public.app_share_page_slugs')),{code:'42501'});
   assert.equal((await stranger(c=>c.query('delete from public.app_share_page_slugs'))).rowCount,0);
  });
  await t.test('service_role reads only the lookup columns',async()=>{
   const s=(await as('service_role',null,c=>c.query('select token_hash from public.app_share_page_slugs where slug_hash=$1',[createHash('sha256').update(slug).digest('hex')]))).rows;
   assert.deepEqual(s,[{token_hash:link.token_hash}]);
   await assert.rejects(as('service_role',null,c=>c.query('select slug_name from public.app_share_page_slugs')),{code:'42501'});
   await assert.rejects(as('service_role',null,c=>c.query('select workspace_id from public.app_share_page_html')),{code:'42501'});
   const h=(await as('service_role',null,c=>c.query('select html from public.app_share_page_html where page_id=$1 order by created_at desc limit 1',[pageId]))).rows;
   assert.equal(h.length,1);
   await assert.rejects(as('service_role',null,c=>c.query("insert into public.app_share_page_html(workspace_id,page_id,html) values($1,$2,'x')",[WS_A,pageId])),{code:'42501'});
  });
  await t.test('rollback is blocked while versions or short links exist; works once they are gone',async()=>{
   await assert.rejects(pool.query(rollback),/SHARE_HTML_ROLLBACK_BLOCKED/);await pool.query('rollback');
   await pool.query('delete from public.app_share_page_html');await pool.query('delete from public.app_share_page_slugs');
   await pool.query(rollback);
   const post=items((await pool.query(postcheck)).rows);
   assert.equal(post['new tables and history agree'],'예');
   for(const k of ['existing tables columns hash','existing tables constraints hash','existing tables policies hash','existing tables grants hash','existing tables triggers hash'])assert.equal(post[k],pre[k],k);
   await pool.query(migration);
   assert.equal(items((await pool.query(postcheck)).rows)['new tables and history agree'],'예');
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
