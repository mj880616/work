// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// S69-82 노트 보드 생각 지도 DB(20261125000000_note_board_mindmap): 글 상자에 가지 관계·순서·쪽·종류·색·모양·글자 크기·폭·접힘 칸.
// 위 상자는 같은 작업공간·같은 보드 상자만, 위 상자를 지우면 가지도 함께, 범위 밖 값 거절, 옛 행 기본값, 되돌리기 뒤 옛 모양 그대로.
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
const version='20261125000000',name='note_board_mindmap',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
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
  revoke usage on schema private from service_role;`;

test('note board mindmap db: precheck, apply, parent same board, cascade, ranges, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'note-board-mindmap-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query(await read('supabase/migrations/20261123090000_note_board_links.sql'));
  await pool.query(await read('supabase/migrations/20261123120000_note_board_texts.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  // 적용 전 글 상자 하나(기존 행 보존·기본값 확인용).
  const oldBox=(await pool.query("insert into public.app_note_board_texts(workspace_id,board_id,body,x,y) values ($1,'all','옛 상자',10,20) returning id",[WS_A])).rows[0].id;
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const ins="insert into public.app_note_board_texts(workspace_id,board_id,body,x,y,parent_id,ord,side,kind,color,shape,font,w,collapsed) values ($1,$2,$3,0,0,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id";
  const node=(ws,board,body,{parent=null,ord=0,side=null,kind='topic',color=null,shape='round',font=2,w=null,collapsed=false}={})=>[ws,board,body,parent,ord,side,kind,color,shape,font,w,collapsed];

  await t.test('files: pair files, summary 3 lines, approved workflow accepts the new-column grants',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');assert.deepEqual(plan.newColumnGrantTables,['app_note_board_texts']);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/create (or replace )?function|create trigger|create policy|drop policy|rtw_|app_collab|\bto (anon|public)\b|security definer|disable row level security|using \(true\)|with check \(true\)/i);
   assert.match(code,/commit;\s*$/);
  });
  await t.test('precheck yes, apply passes postcheck, old box gets defaults, second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   await pool.query(migration);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   const old=(await pool.query('select body,x,y,parent_id,ord,side,kind,color,shape,font,w,collapsed from public.app_note_board_texts where id=$1',[oldBox])).rows[0];
   assert.deepEqual(old,{body:'옛 상자',x:10,y:20,parent_id:null,ord:0,side:null,kind:'topic',color:null,shape:'round',font:2,w:null,collapsed:false});
   await assert.rejects(pool.query(migration),/PREREQUISITE_CHANGED/);
  });
  let rootId,kid,grand,other;
  await t.test('owner builds a tree, restyles, moves a branch; parent same workspace and board only',async()=>{
   rootId=(await owner(c=>c.query(ins,node(WS_A,'all','가운데 주제',{font:3})))).rows[0].id;
   kid=(await owner(c=>c.query(ins,node(WS_A,'all','가지 하나',{parent:rootId,ord:1024,side:1,color:3})))).rows[0].id;
   grand=(await owner(c=>c.query(ins,node(WS_A,'all','더 아래',{parent:kid})))).rows[0].id;
   other=(await owner(c=>c.query(ins,node(WS_A,'bother123','다른 보드')))).rows[0].id;
   await owner(c=>c.query("update public.app_note_board_texts set color=7,shape='pill',font=4,w=300,collapsed=true,kind='sticky',side=-1,ord=5 where id=$1",[kid]));
   assert.deepEqual((await owner(c=>c.query('select color,shape,font,w,collapsed,kind,side,ord from public.app_note_board_texts where id=$1',[kid]))).rows[0],{color:7,shape:'pill',font:4,w:300,collapsed:true,kind:'sticky',side:-1,ord:5});
   await owner(c=>c.query('update public.app_note_board_texts set parent_id=$2 where id=$1',[grand,rootId])); // 가지 옮겨 붙이기
   await owner(c=>c.query('update public.app_note_board_texts set parent_id=null where id=$1',[grand])); // 떼어 혼자 선 상자로
   await owner(c=>c.query('update public.app_note_board_texts set parent_id=$2 where id=$1',[grand,kid]));
   // 다른 보드 상자·자기 자신은 위 상자가 될 수 없다.
   await assert.rejects(owner(c=>c.query('update public.app_note_board_texts set parent_id=$2 where id=$1',[grand,other])),{code:'23503'});
   await assert.rejects(owner(c=>c.query('update public.app_note_board_texts set parent_id=id where id=$1',[grand])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("update public.app_note_board_texts set board_id='bzzz99999' where id=$1",[kid])),/permission denied/);
   for(const extra of [{ord:-1},{ord:1000001},{side:0},{side:2},{kind:'note'},{color:8},{color:-1},{shape:'star'},{font:0},{font:5},{w:59},{w:601}])
    await assert.rejects(owner(c=>c.query(ins,node(WS_A,'all','범위',extra))),{code:'23514'},JSON.stringify(extra));
  });
  await t.test('boundaries: stranger, other workspace parent, anon and server blocked',async()=>{
   const tB=(await pool.query("insert into public.app_note_board_texts(workspace_id,board_id,body) values ($1,'all','B 상자') returning id",[WS_B])).rows[0].id;
   await assert.rejects(owner(c=>c.query(ins,node(WS_A,'all','남 아래',{parent:tB}))),{code:'23503'});
   await assert.rejects(owner(c=>c.query(ins,node(WS_B,'all','남의 공간',{parent:tB}))),/row-level security/);
   await assert.rejects(stranger(c=>c.query(ins,node(WS_A,'all','남',{parent:rootId}))),/row-level security/);
   assert.equal((await stranger(c=>c.query('update public.app_note_board_texts set color=1'))).rowCount,0);
   await assert.rejects(as('anon','',c=>c.query('update public.app_note_board_texts set color=1')),/permission denied/);
   await assert.rejects(server(c=>c.query('select parent_id from public.app_note_board_texts')),/permission denied/);
  });
  await t.test('deleting a box removes its whole branch and lines to it; other boxes stay',async()=>{
   const n=async sql=>(await pool.query(sql)).rows[0].n;
   const line=(await owner(c=>c.query("insert into public.app_note_board_links(workspace_id,board_id,from_text,to_text) values ($1,'all',$2,$3) returning id",[WS_A,oldBox,grand]))).rows[0].id;
   const all=await n('select count(*)::int n from public.app_note_board_texts');
   await owner(c=>c.query('delete from public.app_note_board_texts where id=$1',[kid]));
   assert.equal(await n('select count(*)::int n from public.app_note_board_texts'),all-2);
   assert.equal((await pool.query('select count(*)::int n from public.app_note_board_links where id=$1',[line])).rows[0].n,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_note_board_texts where id=$1 or id=$2',[rootId,oldBox])).rows[0].n,2);
   kid=(await owner(c=>c.query(ins,node(WS_A,'all','다시 가지',{parent:rootId,color:2})))).rows[0].id;
  });
  await t.test('rollback: new columns, constraints, grants and record gone; boxes kept as free boxes',async()=>{
   const boxes=(await pool.query('select count(*)::int n from public.app_note_board_texts')).rows[0].n;
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await pool.query('select count(*)::int n from public.app_note_board_texts')).rows[0].n,boxes);
   await pool.query(migration);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
