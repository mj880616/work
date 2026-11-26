// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// S71-56 노트 보드 표·파일 칸 DB(20261127050000_note_board_cells): 글 상자 표에 표(kind 'table', cells)·파일(kind 'file', file_doc 또는 file_note+file_drive).
// 앞 단계(모든 칸 가지) 기록이 있어야 적용, 표는 네모 글자 표(줄 1~30·칸 1~12·20,000바이트), 파일은 같은 작업공간 자료·노트 첨부 하나만,
// 노트 첨부는 그 노트에 실제로 있는 첨부만, 다른 작업공간 id 거절, 주인만 읽고 고침, 남·anon·server 막힘, 쓰는 중이면 되돌리기가 멈춤, 비운 뒤 되돌리면 옛 모양 그대로.
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
const M='20261127050000_note_board_cells';
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
    raw_text text not null default '', kind text not null default 'note', attachments jsonb not null default '[]'::jsonb);
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
  insert into public.app_notes(id, workspace_id, raw_text, attachments) values
    ('${NOTE_A}', '${WS_A}', '내 노트', '[{"drive_file_id":"fileA_1","file_name":"가상 회의록.pdf"}]'),
    ('${NOTE_B}', '${WS_B}', '남의 노트', '[{"drive_file_id":"fileB_1","file_name":"남의 파일.pdf"}]');
  insert into public.app_documents(id, workspace_id, title) values ('${DOC_A}', '${WS_A}', '내 자료'), ('${DOC_B}', '${WS_B}', '남의 자료');`;
const BEFORE=['20261123090000_note_board_links','20261123120000_note_board_texts','20261125000000_note_board_mindmap','20261125020000_note_board_box_size',
 '20261125040000_note_board_decor','20261125040100_note_board_free_lines','20261127000000_note_board_wide_coords'];

test('note board cells db: table and file cells, same workspace only, owner only, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'note-board-cells-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  for(const m of BEFORE)await pool.query(await read('supabase/migrations/'+m+'.sql'));
  const mig=await read('supabase/migrations/'+M+'.sql');
  // 앞 단계(모든 칸 가지) 없이 적용하면 멈춘다.
  await assert.rejects(pool.query(mig),/PREREQUISITE_CHANGED/);
  await pool.query(await read('supabase/migrations/20261126230000_note_board_branch_all.sql'));
  const p=Object.fromEntries(await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(async k=>[k.split('.')[0],await read('docs/'+M+'.'+k)])));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  const topic=(await pool.query("insert into public.app_note_board_texts(workspace_id,board_id,body,x,y) values ($1,'bcel0001','주제',10,20) returning id",[WS_A])).rows[0].id;
  const shape=(await pool.query("insert into public.app_note_board_texts(workspace_id,board_id,body,x,y,kind,shape) values ($1,'bcel0001','',10,90,'shape','rect') returning id",[WS_A])).rows[0].id;
  const before=(await pool.query(p.snapshot)).rows,pre=await readOnly(p.precheck);

  await t.test('files: pair files, summary 3 lines, approved workflow accepts it as new-column grants with a narrowing policy',()=>{
   for(const sql of [p.precheck,p.postcheck,p.snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version:'20261127050000',runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');assert.deepEqual(plan.newColumnGrantTables,['app_note_board_texts']);
   const lines=p.summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((x,i)=>assert.ok(lines[i].startsWith(x)));
   const code=mig.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/create (or replace )?function|create trigger|drop policy|rtw_|app_collab|\bto (anon|public)\b|security definer|disable row level security|using \(true\)|with check \(true\)/i);
   assert.match(code,/as restrictive for all to authenticated/);
   assert.match(code,/commit;\s*$/);
  });
  await t.test('precheck yes, apply, postcheck yes, old rows unchanged, second apply refused',async()=>{
   for(const r of pre)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   await pool.query(mig);
   for(const r of await readOnly(p.postcheck))assert.equal(r.ok,'예',r.item);
   assert.deepEqual((await pool.query('select kind,body,cells,file_doc,file_note,file_drive from public.app_note_board_texts where id=$1',[topic])).rows[0],{kind:'topic',body:'주제',cells:null,file_doc:null,file_note:null,file_drive:null});
   assert.equal((await pool.query('select kind from public.app_note_board_texts where id=$1',[shape])).rows[0].kind,'shape');
   await assert.rejects(pool.query(mig),/PREREQUISITE_CHANGED/);
  });
  const insTable="insert into public.app_note_board_texts(workspace_id,board_id,body,x,y,kind,shape,cells,parent_id) values ($1,'bcel0001',$2,100,100,'table','rect',$3,$4) returning id";
  const insFile="insert into public.app_note_board_texts(workspace_id,board_id,body,x,y,kind,shape,file_doc,file_note,file_drive,parent_id) values ($1,'bcel0001','',200,100,'file','rect',$2,$3,$4,$5) returning id";
  let table,fileDoc,fileAtt;
  await t.test('owner makes a table, edits its cells; bad tables refused',async()=>{
   table=(await owner(c=>c.query(insTable,[WS_A,'',JSON.stringify([['가','나','다'],['','',''],['','','']]),null]))).rows[0].id;
   await owner(c=>c.query("update public.app_note_board_texts set cells=$2 where id=$1",[table,JSON.stringify([['가','나','다'],['1','2','3'],['','',''],['줄','더','함']])]));
   assert.equal((await owner(c=>c.query('select jsonb_array_length(cells) n from public.app_note_board_texts where id=$1',[table]))).rows[0].n,4);
   // 표도 가지: 상자 아래 표, 표 아래 상자
   const child=(await owner(c=>c.query(insTable,[WS_A,'',JSON.stringify([['a']]),topic]))).rows[0].id;
   await owner(c=>c.query("insert into public.app_note_board_texts(workspace_id,board_id,body,x,y,parent_id) values ($1,'bcel0001','표 아래 가지',0,0,$2)",[WS_A,table]));
   assert.ok(child);
   const big='x'.repeat(2000);
   const bad=[['글이 있는 표',['글',[['a']]]],['빈 표',['',[]]],['빈 줄',['',[[]]]],['들쭉날쭉',['',[['a'],['b','c']]]],['숫자 칸',['',[[1]]]],['겹친 칸',['',[[['x']]]]],
    ['줄 31',['',Array.from({length:31},()=>['a'])]],['칸 13',['',[Array.from({length:13},()=>'a')]]],['20,000바이트 넘음',['',[Array.from({length:11},()=>big)]]],['칸 글 없음',['',null]]];
   for(const [why,[body,cells]] of bad)await assert.rejects(owner(c=>c.query(insTable,[WS_A,body,cells===null?null:JSON.stringify(cells),null])),{code:'23514'},why);
   await assert.rejects(owner(c=>c.query("update public.app_note_board_texts set cells=$2 where id=$1",[table,JSON.stringify([['a'],['b','c']])])),{code:'23514'});
   // 표가 아닌 칸에 표 글은 안 됨
   await assert.rejects(owner(c=>c.query("update public.app_note_board_texts set cells=$2 where id=$1",[topic,JSON.stringify([['a']])])),{code:'23514'});
  });
  await t.test('owner points a file cell at a library document or a note attachment; other workspace ids refused',async()=>{
   fileDoc=(await owner(c=>c.query(insFile,[WS_A,DOC_A,null,null,null]))).rows[0].id;
   fileAtt=(await owner(c=>c.query(insFile,[WS_A,null,NOTE_A,'fileA_1',topic]))).rows[0].id;
   assert.equal((await owner(c=>c.query("select count(*)::int n from public.app_note_board_texts where kind='file'"))).rows[0].n,2);
   // 다른 작업공간 자료·노트, 그 노트에 없는 첨부는 거절(좁히기 정책)
   await assert.rejects(owner(c=>c.query(insFile,[WS_A,DOC_B,null,null,null])),/row-level security/);
   await assert.rejects(owner(c=>c.query(insFile,[WS_A,null,NOTE_B,'fileB_1',null])),/row-level security/);
   await assert.rejects(owner(c=>c.query(insFile,[WS_A,null,NOTE_A,'fileB_1',null])),/row-level security/);
   const bad=[['가리키는 곳 없음',[WS_A,null,null,null,null]],['둘 다',[WS_A,DOC_A,NOTE_A,'fileA_1',null]],['드라이브 번호만',[WS_A,DOC_A,null,'fileA_1',null]]];
   for(const [why,v] of bad)await assert.rejects(owner(c=>c.query(insFile,v)),{code:'23514'},why);
   // 노트만·틀린 드라이브 번호: 그 노트 첨부 목록에 없으므로 좁히기 정책이 먼저 거절한다(검사 칸도 막음 — 어느 쪽이든 들어가지 않음).
   for(const [why,v] of [['노트만',[WS_A,null,NOTE_A,null,null]],['틀린 드라이브 번호',[WS_A,null,NOTE_A,'a/b',null]]])
    await assert.rejects(owner(c=>c.query(insFile,v)),e=>e.code==='23514'||/row-level security/.test(e.message),why);
   // 파일이 아닌 칸은 가리키는 곳이 없다
   await assert.rejects(owner(c=>c.query("insert into public.app_note_board_texts(workspace_id,board_id,body,x,y,file_doc) values ($1,'bcel0001','상자',0,0,$2)",[WS_A,DOC_A])),{code:'23514'});
   // 가리키는 곳은 고치지 못한다(지우고 다시 넣음)
   await assert.rejects(owner(c=>c.query('update public.app_note_board_texts set file_doc=$2 where id=$1',[fileDoc,DOC_A])),/permission denied/);
   await assert.rejects(owner(c=>c.query("update public.app_note_board_texts set file_drive='fileA_2' where id=$1",[fileAtt])),/permission denied/);
   await assert.rejects(owner(c=>c.query("update public.app_note_board_texts set kind='topic' where id=$1",[fileDoc])),{code:'23514'});
   // 자료를 지우면 그 파일 칸도 지워진다. 노트도 같다.
   const tmp=(await pool.query("insert into public.app_documents(workspace_id,title) values ($1,'지울 자료') returning id",[WS_A])).rows[0].id;
   const gone=(await owner(c=>c.query(insFile,[WS_A,tmp,null,null,null]))).rows[0].id;
   await pool.query('delete from public.app_documents where id=$1',[tmp]);
   assert.equal((await pool.query('select count(*)::int n from public.app_note_board_texts where id=$1',[gone])).rows[0].n,0);
   const tn=(await pool.query(`insert into public.app_notes(workspace_id,raw_text,attachments) values ($1,'지울 노트','[{"drive_file_id":"fileT_1"}]') returning id`,[WS_A])).rows[0].id;
   const goneAtt=(await owner(c=>c.query(insFile,[WS_A,null,tn,'fileT_1',null]))).rows[0].id;
   await pool.query('delete from public.app_notes where id=$1',[tn]);
   assert.equal((await pool.query('select count(*)::int n from public.app_note_board_texts where id=$1',[goneAtt])).rows[0].n,0);
   // 파일 칸 아래 가지
   await owner(c=>c.query("insert into public.app_note_board_texts(workspace_id,board_id,body,x,y,parent_id) values ($1,'bcel0001','파일 아래 가지',0,0,$2)",[WS_A,fileDoc]));
  });
  await t.test('stranger, anon and server blocked',async()=>{
   assert.equal((await stranger(c=>c.query("select count(*)::int n from public.app_note_board_texts where kind in ('table','file')"))).rows[0].n,0);
   assert.equal((await stranger(c=>c.query("update public.app_note_board_texts set cells='[[\"x\"]]' where kind='table'"))).rowCount,0);
   assert.equal((await stranger(c=>c.query("delete from public.app_note_board_texts where kind in ('table','file')"))).rowCount,0);
   await assert.rejects(stranger(c=>c.query(insFile,[WS_A,DOC_A,null,null,null])),/row-level security/);
   await assert.rejects(stranger(c=>c.query(insTable,[WS_A,'',JSON.stringify([['a']]),null])),/row-level security/);
   await assert.rejects(as('anon','',c=>c.query('select cells from public.app_note_board_texts')),/permission denied/);
   await assert.rejects(server(c=>c.query('select cells,file_doc,file_note,file_drive from public.app_note_board_texts')),/permission denied/);
  });
  await t.test('rollback stops while in use; after clearing, rolls back to the old shape and re-applies',async()=>{
   await assert.rejects(pool.query(p.rollback),/ROLLBACK_BLOCKED: table or file cells in use/);
   await pool.query("delete from public.app_note_board_texts where kind in ('table','file') or parent_id is not null");
   await pool.query(p.rollback);
   assert.deepEqual((await pool.query(p.snapshot)).rows,before);
   for(const r of await readOnly(p.postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await pool.query('select count(*)::int n from public.app_note_board_texts where id in ($1,$2)',[topic,shape])).rows[0].n,2);
   await pool.query(mig);
   for(const r of await readOnly(p.postcheck))assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
