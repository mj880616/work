// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// NOTE-게시 ①: app_note_share_pages (one share page row ↔ one note). Checks the prerequisite guard, the pair files (existing tables
// unchanged), owner-only access, same-workspace kind 'note' only, one pair per note and per page, no update, what service_role may
// read, note purge leaves an empty note_id (reader 404), and the guarded rollback.
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
const base='20261020005000_share_pages_links',version='20261124220000',name='note_share_pages',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
// The note table as far as this migration reads it (columns, owner RLS, authenticated table grants; no anon).
const notes=`
 create table public.app_notes(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  kind text not null default 'note', title text, raw_text text not null default '', doc jsonb, deleted_at timestamptz, archived_at timestamptz);
 alter table public.app_notes enable row level security;
 revoke all on table public.app_notes from public, anon, authenticated;
 grant select, insert, update, delete on table public.app_notes to authenticated;
 create policy notes_owner_all on public.app_notes for all to authenticated
  using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));`;

test('note share pages: guard, pair files, owner-only pairs, same-workspace notes only, guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'note-share-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(await read('supabase/migrations/'+base+'.sql'));
  await pool.query(notes);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollback=await read('docs/'+stem+'.rollback.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  assert.match(await read('docs/'+stem+'.summary.md'),/무엇이 바뀌나:[\s\S]*잘못되면:[\s\S]*되돌리는 법:/);
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const items=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const one=async(fn,sql,args)=>(await fn(c=>c.query(sql,args))).rows[0];
  const note=await one(owner,"insert into public.app_notes(workspace_id,kind,title,raw_text) values($1,'note','회의 정리','본문') returning id",[WS_A]);
  const note2=await one(owner,"insert into public.app_notes(workspace_id,kind,title,raw_text) values($1,'note','둘째','본문') returning id",[WS_A]);
  const memo=await one(owner,"insert into public.app_notes(workspace_id,kind,raw_text) values($1,'basket','메모') returning id",[WS_A]);
  const otherNote=await one(stranger,"insert into public.app_notes(workspace_id,kind,title,raw_text) values($1,'note','남의 노트','비밀') returning id",[WS_B]);
  const newPage=()=>one(owner,"insert into public.app_share_pages(workspace_id,title,status) values($1,'회의 정리','published') returning id",[WS_A]);
  const page=await newPage();
  const otherPage=await one(stranger,"insert into public.app_share_pages(workspace_id,title,status) values($1,'남의 페이지','published') returning id",[WS_B]);
  await owner(c=>c.query("insert into public.app_share_page_links(workspace_id,page_id) values($1,$2)",[WS_A,page.id]));

  let pre;
  await t.test('precheck before apply: expected values, snapshot reads catalogs',async()=>{
   pre=items((await pool.query(precheck)).rows);
   for(const k of ['prerequisite recorded','new migration absent','new table absent','note columns present','RLS on existing tables','owner check function'])assert.equal(pre[k],'예',k);
   const snap=(await pool.query(snapshot)).rows;
   assert.ok(snap.some(r=>r.kind==='new table'&&r.name==='app_note_share_pages'&&r.definition==='absent'));
   assert.ok(snap.some(r=>r.kind==='policy'&&r.name.endsWith('notes_owner_all')));
  });
  await t.test('prerequisite guard stops when the new table already exists',async()=>{
   const c=await pool.connect();
   try{await c.query('begin');await c.query('create table public.app_note_share_pages(id int)');
    await assert.rejects(c.query(migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/NOTE_SHARE_PAGES_PREREQUISITE_CHANGED/);}
   finally{await c.query('rollback');c.release();}
  });
  await t.test('apply once; existing tables unchanged (postcheck = precheck); second apply refused',async()=>{
   await pool.query(migration);
   const post=items((await pool.query(postcheck)).rows);
   for(const k of ['new table and history agree','new table RLS enabled','new table one owner policy','new table no anon or public privilege','service_role reads two columns only','authenticated cannot update'])assert.equal(post[k],'예',k);
   for(const k of ['share pages rows','share links rows','existing tables columns hash','existing tables constraints hash','existing tables policies hash','existing tables grants hash','existing tables triggers hash'])assert.equal(post[k],pre[k],k);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n,1);
   await assert.rejects(pool.query(migration),/NOTE_SHARE_PAGES_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });
  await t.test('owner pairs one own note with one own page; one pair per note and per page; no update',async()=>{
   await owner(c=>c.query('insert into public.app_note_share_pages(workspace_id,page_id,note_id) values($1,$2,$3)',[WS_A,page.id,note.id]));
   const page2=await newPage();
   await assert.rejects(owner(c=>c.query('insert into public.app_note_share_pages(workspace_id,page_id,note_id) values($1,$2,$3)',[WS_A,page2.id,note.id])),{code:'23505'},'same note twice');
   await assert.rejects(owner(c=>c.query('insert into public.app_note_share_pages(workspace_id,page_id,note_id) values($1,$2,$3)',[WS_A,page.id,note2.id])),{code:'23505'},'same page twice');
   await assert.rejects(owner(c=>c.query('update public.app_note_share_pages set note_id=$1',[note2.id])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('insert into public.app_note_share_pages(id,workspace_id,page_id,note_id) values(gen_random_uuid(),$1,$2,$3)',[WS_A,page2.id,note2.id])),{code:'42501'},'id is not the screen\'s');
   await owner(c=>c.query('delete from public.app_share_pages where id=$1',[page2.id]));
  });
  await t.test('refused: a memo row, an empty note, another workspace\'s note or page, a stranger',async()=>{
   const p=await newPage();
   const add=(fn,ws,pid,nid)=>fn(c=>c.query('insert into public.app_note_share_pages(workspace_id,page_id,note_id) values($1,$2,$3)',[ws,pid,nid]));
   await assert.rejects(add(owner,WS_A,p.id,memo.id),{code:'42501'},'kind basket');
   await assert.rejects(add(owner,WS_A,p.id,null),{code:'42501'},'no note');
   await assert.rejects(add(owner,WS_A,p.id,otherNote.id),{code:'42501'},'note of another workspace');
   await assert.rejects(add(owner,WS_A,otherPage.id,note2.id),{code:'42501'},'page of another workspace');
   await assert.rejects(add(owner,WS_B,otherPage.id,otherNote.id),{code:'42501'},'into another workspace');
   await assert.rejects(add(stranger,WS_A,p.id,note2.id),{code:'42501'},'stranger into my workspace');
   await assert.rejects(add(stranger,WS_B,otherPage.id,note2.id),{code:'42501'},'stranger points at my note');
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_note_share_pages'))).rows[0].n,0);
   assert.equal((await stranger(c=>c.query('delete from public.app_note_share_pages'))).rowCount,0);
   await assert.rejects(as('anon',null,c=>c.query('select 1 from public.app_note_share_pages')),{code:'42501'});
   await owner(c=>c.query('delete from public.app_share_pages where id=$1',[p.id]));
  });
  await t.test('service_role reads page_id and note_id only, writes nothing',async()=>{
   const r=(await as('service_role',null,c=>c.query('select note_id from public.app_note_share_pages where page_id=$1',[page.id]))).rows;
   assert.deepEqual(r,[{note_id:note.id}]);
   await assert.rejects(as('service_role',null,c=>c.query('select workspace_id from public.app_note_share_pages')),{code:'42501'});
   await assert.rejects(as('service_role',null,c=>c.query('delete from public.app_note_share_pages')),{code:'42501'});
  });
  await t.test('purging the note empties note_id (the reader shows 404); deleting the page removes the pair',async()=>{
   const n=await one(owner,"insert into public.app_notes(workspace_id,kind,title,raw_text) values($1,'note','지울 노트','x') returning id",[WS_A]);
   const p=await newPage();
   await owner(c=>c.query('insert into public.app_note_share_pages(workspace_id,page_id,note_id) values($1,$2,$3)',[WS_A,p.id,n.id]));
   await owner(c=>c.query('delete from public.app_notes where id=$1',[n.id]));
   assert.deepEqual((await owner(c=>c.query('select note_id from public.app_note_share_pages where page_id=$1',[p.id]))).rows,[{note_id:null}]);
   await owner(c=>c.query('delete from public.app_share_pages where id=$1',[p.id]));
   assert.equal((await owner(c=>c.query('select count(*)::int n from public.app_note_share_pages where page_id=$1',[p.id]))).rows[0].n,0);
  });
  await t.test('rollback is blocked while published notes exist; works once they are gone',async()=>{
   await assert.rejects(pool.query(rollback),/NOTE_SHARE_PAGES_ROLLBACK_BLOCKED/);await pool.query('rollback');
   await pool.query('delete from public.app_note_share_pages');
   await pool.query(rollback);
   const post=items((await pool.query(postcheck)).rows);
   assert.equal(post['new table and history agree'],'예');
   for(const k of ['existing tables columns hash','existing tables constraints hash','existing tables policies hash','existing tables grants hash','existing tables triggers hash'])assert.equal(post[k],pre[k],k);
   await pool.query(migration);
   assert.equal(items((await pool.query(postcheck)).rows)['new table and history agree'],'예');
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
