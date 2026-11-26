// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// S71-54 노트 보드 주제 재료 DB(20261127020000_note_board_materials): 연결선 표에 재료 종류(kind 'material')와 자료(mat_doc)·주소(mat_url) 칸.
// 앞 단계(관계선 칸) 기록이 있어야 적용, 재료는 주제 상자 → 노트·자료·주소 하나, 주소는 http/https만, 같은 재료 한 번만,
// 남의 노트·자료 잇기 거절, 주인만 읽고 고침, 남·anon·server 막힘, 쓰는 중이면 되돌리기가 멈춤, 비운 뒤 되돌리면 옛 모양 그대로.
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
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
const M='20261127020000_note_board_materials';
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const NOTE_A='26000000-0000-4000-8000-000000000001',NOTE_B='26000000-0000-4000-8000-000000000002';
const DOC_A='27000000-0000-4000-8000-000000000001',DOC_B='27000000-0000-4000-8000-000000000002';
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  create table public.app_notes(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id),
    raw_text text not null default '', kind text not null default 'note');
  alter table public.app_notes enable row level security;
  revoke all on table public.app_notes from public, anon, authenticated, service_role;
  grant select, insert, update, delete on table public.app_notes to authenticated;
  create policy notes_owner_all on public.app_notes for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  create table public.app_documents(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id), title text);
  alter table public.app_documents enable row level security;
  revoke all on table public.app_documents from public, anon, authenticated, service_role;
  grant select, insert, update, delete on table public.app_documents to authenticated;
  create policy documents_owner_all on public.app_documents for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke usage on schema private from service_role;
  insert into public.app_notes(id, workspace_id, raw_text) values ('${NOTE_A}', '${WS_A}', '내 노트'), ('${NOTE_B}', '${WS_B}', '남의 노트');
  insert into public.app_documents(id, workspace_id, title) values ('${DOC_A}', '${WS_A}', '내 자료'), ('${DOC_B}', '${WS_B}', '남의 자료');`;
const BEFORE=['20261123090000_note_board_links','20261123120000_note_board_texts','20261125000000_note_board_mindmap','20261125020000_note_board_box_size',
 '20261125040000_note_board_decor','20261125040100_note_board_free_lines'];

test('note board materials db: topic materials (note, document, web address), owner only, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'note-board-materials-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  for(const m of BEFORE)await pool.query(await read('supabase/migrations/'+m+'.sql'));
  const mig=await read('supabase/migrations/'+M+'.sql');
  // 앞 단계(관계선 칸) 없이 적용하면 멈춘다.
  await assert.rejects(pool.query(mig),/PREREQUISITE_CHANGED/);
  await pool.query(await read('supabase/migrations/20261127010000_note_board_relation.sql'));
  const p=Object.fromEntries(await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(async k=>[k.split('.')[0],await read('docs/'+M+'.'+k)])));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  const topic=(await pool.query("insert into public.app_note_board_texts(workspace_id,board_id,body,x,y) values ($1,'bmat0001','주제',10,20) returning id",[WS_A])).rows[0].id;
  const topic2=(await pool.query("insert into public.app_note_board_texts(workspace_id,board_id,body,x,y) values ($1,'bmat0001','다른 주제',300,20) returning id",[WS_A])).rows[0].id;
  const oldLine=(await pool.query("insert into public.app_note_board_links(workspace_id,board_id,from_text,to_text) values ($1,'bmat0001',$2,$3) returning id",[WS_A,topic,topic2])).rows[0].id;
  // 같은 주제 → 같은 노트의 지금 선(재료와 함께 있어도 된다 — 노트 재료는 선 끝 칸 to_note가 아닌 mat_note)
  const noteLine=(await pool.query("insert into public.app_note_board_links(workspace_id,board_id,from_text,to_note) values ($1,'bmat0001',$2,$3) returning id",[WS_A,topic,NOTE_A])).rows[0].id;
  const before=(await pool.query(p.snapshot)).rows,pre=await readOnly(p.precheck);

  await t.test('files: pair files, summary 3 lines, approved workflow accepts it as new-column grants with a narrowing policy',()=>{
   for(const sql of [p.precheck,p.postcheck,p.snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version:'20261127020000',runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');assert.deepEqual(plan.newColumnGrantTables,['app_note_board_links']);
   const lines=p.summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((x,i)=>assert.ok(lines[i].startsWith(x)));
   const code=mig.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/create (or replace )?function|create trigger|drop policy|rtw_|app_collab|\bto (anon|public)\b|security definer|disable row level security|using \(true\)|with check \(true\)|grant update/i);
   assert.match(code,/as restrictive for all to authenticated/);
   assert.match(code,/commit;\s*$/);
  });
  await t.test('precheck yes, apply, postcheck yes, old line unchanged, second apply refused',async()=>{
   for(const r of pre)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   await pool.query(mig);
   for(const r of await readOnly(p.postcheck))assert.equal(r.ok,'예',r.item);
   assert.deepEqual((await pool.query('select kind,mat_note,mat_doc,mat_url,from_text,to_text from public.app_note_board_links where id=$1',[oldLine])).rows[0],{kind:'line',mat_note:null,mat_doc:null,mat_url:null,from_text:topic,to_text:topic2});
   await assert.rejects(pool.query(mig),/PREREQUISITE_CHANGED/);
  });
  const ins="insert into public.app_note_board_links(workspace_id,board_id,kind,from_text,mat_note,mat_doc,mat_url,label) values ($1,'bmat0001',$2,$3,$4,$5,$6,$7) returning id";
  await t.test('owner links a note, a document and a web address to a topic; bad ones refused',async()=>{
   const ids=[];
   ids.push((await owner(c=>c.query(ins,[WS_A,'material',topic,NOTE_A,null,null,null]))).rows[0].id);
   ids.push((await owner(c=>c.query(ins,[WS_A,'material',topic,null,DOC_A,null,'내 자료']))).rows[0].id);
   ids.push((await owner(c=>c.query(ins,[WS_A,'material',topic,null,null,'https://example.org/a?b=1',null]))).rows[0].id);
   ids.push((await owner(c=>c.query(ins,[WS_A,'material',topic2,null,null,'http://example.org/',null]))).rows[0].id);
   assert.equal((await owner(c=>c.query("select count(*)::int n from public.app_note_board_links where kind='material'"))).rows[0].n,4);
   // 같은 주제에 같은 재료는 한 번만
   await assert.rejects(owner(c=>c.query(ins,[WS_A,'material',topic,NOTE_A,null,null,null])),{code:'23505'});
   await assert.rejects(owner(c=>c.query(ins,[WS_A,'material',topic,null,null,'https://example.org/a?b=1','다시'])),{code:'23505'});
   const bad=[['javascript 주소',[WS_A,'material',topic,null,null,'javascript:alert(1)',null]],['data 주소',[WS_A,'material',topic,null,null,'data:text/html,x',null]],
    ['빈칸 든 주소',[WS_A,'material',topic,null,null,'https://a b.org/x',null]],['줄바꿈 든 주소',[WS_A,'material',topic,null,null,'https://a.org/\nx',null]],
    ['끝 둘',[WS_A,'material',topic,NOTE_A,DOC_A,null,null]],['선에 노트 재료 칸',[WS_A,'line',topic,NOTE_A,null,null,null]],['끝 없음',[WS_A,'material',topic,null,null,null,null]],
    ['선에 주소',[WS_A,'line',topic,null,null,'https://example.org/',null]],['선에 자료',[WS_A,'relation',topic,null,DOC_A,null,null]],
    ['없는 종류',[WS_A,'stuff',topic,NOTE_A,null,null,null]]];
   for(const [why,v] of bad)await assert.rejects(owner(c=>c.query(ins,v)),{code:'23514'},why);
   // 재료는 선 끝 칸(to_note)을 쓰지 않는다
   await assert.rejects(owner(c=>c.query("insert into public.app_note_board_links(workspace_id,board_id,kind,from_text,to_note) values ($1,'bmat0001','material',$2,$3)",[WS_A,topic,NOTE_A])),{code:'23514'});
   // 주제 상자가 아닌 끝(노트 카드)에서는 재료를 잇지 않는다
   await assert.rejects(owner(c=>c.query("insert into public.app_note_board_links(workspace_id,board_id,kind,from_note,mat_url) values ($1,'bmat0001','material',$2,'https://example.org/')",[WS_A,NOTE_A])),{code:'23514'});
   // 노트를 지우면 그 노트 재료도 지워진다(지금 선도 지금처럼 함께)
   const tn=(await pool.query("insert into public.app_notes(workspace_id,raw_text) values ($1,'지울 노트') returning id",[WS_A])).rows[0].id;
   const tnl=(await owner(c=>c.query(ins,[WS_A,'material',topic2,tn,null,null,null]))).rows[0].id;
   await pool.query('delete from public.app_notes where id=$1',[tn]);
   assert.equal((await pool.query('select count(*)::int n from public.app_note_board_links where id=$1',[tnl])).rows[0].n,0);
   // 남의 노트·남의 자료는 내 주제에 잇지 못한다(정책)
   await assert.rejects(owner(c=>c.query(ins,[WS_A,'material',topic,NOTE_B,null,null,null])),/row-level security|foreign key/);
   await assert.rejects(owner(c=>c.query(ins,[WS_A,'material',topic,null,DOC_B,null,null])),/row-level security|foreign key/);
   // 이은 뒤 고치기 권한은 없다(풀고 다시 잇는다)
   await assert.rejects(owner(c=>c.query("update public.app_note_board_links set mat_url='https://example.org/z' where id=$1",[ids[2]])),/permission denied/);
   await assert.rejects(owner(c=>c.query("update public.app_note_board_links set kind='line' where id=$1",[ids[2]])),/permission denied/);
   // 자료를 지우면 잇기도 지워진다
   const tmp=(await pool.query("insert into public.app_documents(workspace_id,title) values ($1,'지울 자료') returning id",[WS_A])).rows[0].id;
   const tl=(await owner(c=>c.query(ins,[WS_A,'material',topic2,null,tmp,null,null]))).rows[0].id;
   await pool.query('delete from public.app_documents where id=$1',[tmp]);
   assert.equal((await pool.query('select count(*)::int n from public.app_note_board_links where id=$1',[tl])).rows[0].n,0);
   // 잇기 풀기 = 줄 지우기
   assert.equal((await owner(c=>c.query('delete from public.app_note_board_links where id=$1',[ids[3]]))).rowCount,1);
  });
  await t.test('stranger, anon and server blocked',async()=>{
   assert.equal((await stranger(c=>c.query("select count(*)::int n from public.app_note_board_links where kind='material'"))).rows[0].n,0);
   assert.equal((await stranger(c=>c.query("delete from public.app_note_board_links where kind='material'"))).rowCount,0);
   await assert.rejects(stranger(c=>c.query(ins,[WS_A,'material',topic,null,null,'https://example.org/s',null])),/row-level security/);
   await assert.rejects(as('anon','',c=>c.query('select mat_url from public.app_note_board_links')),/permission denied/);
   await assert.rejects(server(c=>c.query('select mat_note,mat_doc,mat_url from public.app_note_board_links')),/permission denied/);
  });
  await t.test('rollback stops while in use; after clearing, rolls back to the old shape and re-applies',async()=>{
   await assert.rejects(pool.query(p.rollback),/ROLLBACK_BLOCKED: materials in use/);
   await pool.query("delete from public.app_note_board_links where kind='material'");
   await pool.query(p.rollback);
   assert.deepEqual((await pool.query(p.snapshot)).rows,before);
   for(const r of await readOnly(p.postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await pool.query('select count(*)::int n from public.app_note_board_links where id in ($1,$2)',[oldLine,noteLine])).rows[0].n,2);
   await pool.query(mig);
   for(const r of await readOnly(p.postcheck))assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
