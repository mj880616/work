// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// S69-88 노트 보드 상자 크기·자유 이동 DB(20261125020000_note_board_box_size): 글 상자에 높이(h 30~1200)·손으로 둔 가지 자리(pinned) 칸.
// 앞 단계(생각 지도 칸) 기록이 있어야 적용, 범위 밖 값 거절, 옛 행 기본값, 주인만 고침, 되돌리기 뒤 옛 모양 그대로.
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
const version='20261125020000',name='note_board_box_size',stem=version+'_'+name;
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

test('note board box size db: precheck, apply, height range, pinned, owner only, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'note-board-box-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query(await read('supabase/migrations/20261123090000_note_board_links.sql'));
  await pool.query(await read('supabase/migrations/20261123120000_note_board_texts.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  // 앞 단계(생각 지도 칸) 없이 적용하면 멈춘다.
  await assert.rejects(pool.query(migration),/PREREQUISITE_CHANGED/);
  await pool.query(await read('supabase/migrations/20261125000000_note_board_mindmap.sql'));
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  const oldBox=(await pool.query("insert into public.app_note_board_texts(workspace_id,board_id,body,x,y,w) values ($1,'bbox0001','옛 상자',10,20,200) returning id",[WS_A])).rows[0].id;
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const ins="insert into public.app_note_board_texts(workspace_id,board_id,body,x,y,parent_id,w,h,pinned) values ($1,'bbox0001',$2,$3,$4,$5,$6,$7,$8) returning id";

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
  await t.test('precheck yes, apply passes postcheck, old box keeps its shape, second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   await pool.query(migration);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   const old=(await pool.query('select body,x,y,w,h,pinned,parent_id from public.app_note_board_texts where id=$1',[oldBox])).rows[0];
   assert.deepEqual(old,{body:'옛 상자',x:10,y:20,w:200,h:null,pinned:false,parent_id:null});
   await assert.rejects(pool.query(migration),/PREREQUISITE_CHANGED/);
  });
  let rootId,kid;
  await t.test('owner sets height and pins a branch; ranges refused; stranger, anon and server blocked',async()=>{
   rootId=(await owner(c=>c.query(ins,[WS_A,'가운데',100,100,null,180,40,false]))).rows[0].id;
   kid=(await owner(c=>c.query(ins,[WS_A,'옮긴 가지',400,300,rootId,null,null,true]))).rows[0].id;
   await owner(c=>c.query('update public.app_note_board_texts set h=1200,w=600 where id=$1',[rootId]));
   await owner(c=>c.query('update public.app_note_board_texts set pinned=false,h=30 where id=$1',[kid]));
   assert.deepEqual((await owner(c=>c.query('select h,pinned,parent_id from public.app_note_board_texts where id=$1',[kid]))).rows[0],{h:30,pinned:false,parent_id:rootId});
   for(const h of [29,1201,0,-5])await assert.rejects(owner(c=>c.query('update public.app_note_board_texts set h=$2 where id=$1',[rootId,h])),{code:'23514'},String(h));
   await assert.rejects(owner(c=>c.query('update public.app_note_board_texts set pinned=null where id=$1',[kid])),{code:'23502'});
   assert.equal((await stranger(c=>c.query('update public.app_note_board_texts set h=99 where workspace_id=$1',[WS_A]))).rowCount,0);
   await assert.rejects(stranger(c=>c.query(ins,[WS_A,'남',0,0,null,null,90,false])),/row-level security/);
   await assert.rejects(as('anon','',c=>c.query('update public.app_note_board_texts set h=90')),/permission denied/);
   await assert.rejects(server(c=>c.query('select h,pinned from public.app_note_board_texts')),/permission denied/);
  });
  await t.test('rollback: new columns, check, grants and record gone; boxes and width kept',async()=>{
   const boxes=(await pool.query('select count(*)::int n from public.app_note_board_texts')).rows[0].n;
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await pool.query('select count(*)::int n from public.app_note_board_texts')).rows[0].n,boxes);
   assert.equal((await pool.query('select w from public.app_note_board_texts where id=$1',[rootId])).rows[0].w,600);
   await pool.query(migration);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
