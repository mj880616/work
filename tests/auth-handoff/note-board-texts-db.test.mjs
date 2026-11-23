// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// S68-38c 노트 보드 글 상자·선 곡선 DB(20261123120000_note_board_texts): 글 상자 소유자만, 연결선 끝은 노트 또는 같은 작업공간·같은 보드의 글 상자 정확히 하나,
// 곡선 지나는 점(두 끝점 기준 상대 위치), 글 상자 삭제 시 선 정리, 되돌리기 뒤 옛 모양 그대로.
// 기존 표(app_note_board_links)에 이 파일이 더한 칸에만 칸 권한을 주므로 승인형 DB workflow 확장 규칙이 받는다(S68-42). 시험은 파일을 그대로 적용한다.
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
const version='20261123120000',name='note_board_texts',stem=version+'_'+name;
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

test('note board texts db: precheck, apply, owner-only texts, note|text ends, bend, cascade, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'note-board-texts-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query(await read('supabase/migrations/20261123090000_note_board_links.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  const addNote=(ws,kind='note')=>pool.query("insert into public.app_notes(workspace_id,raw_text,kind) values ($1,'가상 노트',$2) returning id",[ws,kind]).then(r=>r.rows[0].id);
  const noteA=await addNote(WS_A),noteA2=await addNote(WS_A),noteB=await addNote(WS_B);
  // 적용 전 노트↔노트 선 하나(기존 행 보존 확인용).
  const oldLine=(await pool.query("insert into public.app_note_board_links(workspace_id,board_id,from_note,to_note,label) values ($1,'all',$2,$3,'옛 선') returning id",[WS_A,noteA,noteA2])).rows[0].id;
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const insText="insert into public.app_note_board_texts(workspace_id,board_id,body,x,y) values ($1,$2,$3,$4,$5) returning id";
  const insLink="insert into public.app_note_board_links(workspace_id,board_id,from_note,to_note,from_text,to_text,shape,bend_x,bend_y) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id";
  const link=(ws,board,{fn=null,tn=null,ft=null,tt=null,shape='line',bx=null,by=null})=>[ws,board,fn,tn,ft,tt,shape,bx,by];

  await t.test('files: pair files, summary 3 lines, approved workflow accepts the new-column grants (S68-42)',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');assert.deepEqual(plan.newColumnGrantTables,['app_note_board_links']);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/create (or replace )?function|create trigger|rtw_|app_collab|\bto (anon|public)\b|alter table public\.app_notes|security definer|disable row level security|using \(true\)|with check \(true\)/i);
   assert.match(code,/commit;\s*$/);
  });
  await t.test('precheck yes, apply passes postcheck, old line kept, second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   await pool.query(migration);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   const old=(await pool.query('select from_note,to_note,from_text,to_text,shape,bend_x,label from public.app_note_board_links where id=$1',[oldLine])).rows[0];
   assert.deepEqual(old,{from_note:noteA,to_note:noteA2,from_text:null,to_text:null,shape:'curve',bend_x:null,label:'옛 선'});
   await assert.rejects(pool.query(migration),/PREREQUISITE_CHANGED/);
  });
  let tA,tA2,tOther;
  await t.test('owner makes, edits, moves, deletes text boxes; workspace and board fixed',async()=>{
   tA=(await owner(c=>c.query(insText,[WS_A,'all','생각 한 줄',100,200]))).rows[0].id;
   tA2=(await owner(c=>c.query(insText,[WS_A,'all','둘째\n줄바꿈',300,40]))).rows[0].id;
   tOther=(await owner(c=>c.query(insText,[WS_A,'babc12345','다른 보드',0,0]))).rows[0].id;
   await owner(c=>c.query("update public.app_note_board_texts set body='고친 글',x=120,y=220 where id=$1",[tA]));
   assert.deepEqual((await owner(c=>c.query('select body,x,y from public.app_note_board_texts where id=$1',[tA]))).rows[0],{body:'고친 글',x:120,y:220});
   await assert.rejects(owner(c=>c.query("update public.app_note_board_texts set board_id='bzzz99999' where id=$1",[tA])),/permission denied/);
   await assert.rejects(owner(c=>c.query("update public.app_note_board_texts set workspace_id=$2 where id=$1",[tA,WS_B])),/permission denied/);
   await assert.rejects(owner(c=>c.query("insert into public.app_note_board_texts(id,workspace_id,board_id,body) values (gen_random_uuid(),$1,'all','글')",[WS_A])),/permission denied/);
   for(const [board,body,x,y] of [['ALL','글',0,0],['all','',0,0],['all','  \n ',0,0],['all','가'.repeat(301),0,0],['all','탭\t글',0,0],['all','글',-1,0],['all','글',0,100001]])
    await assert.rejects(owner(c=>c.query(insText,[WS_A,board,body,x,y])),{code:'23514'},JSON.stringify([board,body,x,y]));
   const gone=(await owner(c=>c.query(insText,[WS_A,'all','지울 글',0,0]))).rows[0].id;
   assert.equal((await owner(c=>c.query('delete from public.app_note_board_texts where id=$1',[gone]))).rowCount,1);
  });
  await t.test('boundaries: stranger, other workspace, anon and server blocked',async()=>{
   await assert.rejects(owner(c=>c.query(insText,[WS_B,'all','남의 공간',0,0])),/row-level security/);
   await assert.rejects(stranger(c=>c.query(insText,[WS_A,'all','남',0,0])),/row-level security/);
   assert.deepEqual((await stranger(c=>c.query('select 1 from public.app_note_board_texts'))).rows,[]);
   assert.equal((await stranger(c=>c.query("update public.app_note_board_texts set body='남'"))).rowCount,0);
   assert.equal((await stranger(c=>c.query('delete from public.app_note_board_texts'))).rowCount,0);
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_note_board_texts')),/permission denied/);
   await assert.rejects(as('anon','',c=>c.query(insText,[WS_A,'all','글',0,0])),/permission denied/);
   await assert.rejects(server(c=>c.query('select 1 from public.app_note_board_texts')),/permission denied/);
   const tB=(await pool.query("insert into public.app_note_board_texts(workspace_id,board_id,body) values ($1,'all','B 글') returning id",[WS_B])).rows[0].id;
   assert.equal((await owner(c=>c.query('select 1 from public.app_note_board_texts where id=$1',[tB]))).rows.length,0);
   // 다른 작업공간 글 상자를 끝으로 잇기: 외래 키(같은 작업공간·같은 보드)가 거절.
   await assert.rejects(owner(c=>c.query(insLink,link(WS_A,'all',{fn:noteA,tt:tB}))),{code:'23503'});
  });
  let textLine,bentLine;
  await t.test('lines: note→text, text→note, text→text; exactly one per end; same board only; unique ends',async()=>{
   textLine=(await owner(c=>c.query(insLink,link(WS_A,'all',{fn:noteA,tt:tA})))).rows[0].id;
   await owner(c=>c.query(insLink,link(WS_A,'all',{ft:tA,tn:noteA2})));
   await owner(c=>c.query(insLink,link(WS_A,'all',{ft:tA,tt:tA2})));
   // 끝마다 정확히 하나.
   await assert.rejects(owner(c=>c.query(insLink,link(WS_A,'all',{fn:noteA,ft:tA,tn:noteA2}))),{code:'23514'});
   await assert.rejects(owner(c=>c.query(insLink,link(WS_A,'all',{tn:noteA2}))),{code:'23514'});
   await assert.rejects(owner(c=>c.query(insLink,link(WS_A,'all',{fn:noteA}))),{code:'23514'});
   await assert.rejects(owner(c=>c.query(insLink,link(WS_A,'all',{ft:tA,tt:tA}))),{code:'23514'});
   // 다른 보드의 글 상자는 못 잇는다.
   await assert.rejects(owner(c=>c.query(insLink,link(WS_A,'all',{fn:noteA,tt:tOther}))),{code:'23503'});
   // 같은 보드·방향·두 끝은 한 줄.
   await assert.rejects(owner(c=>c.query(insLink,link(WS_A,'all',{fn:noteA,tt:tA}))),{code:'23505'});
   // 노트 끝은 지금처럼 같은 작업공간 노트만.
   await assert.rejects(owner(c=>c.query(insLink,link(WS_A,'all',{fn:noteB,tt:tA}))),/row-level security/);
   // 고치기로 끝 바꾸기(뒤집기): 노트↔글 상자 자리를 바꾼다.
   await owner(c=>c.query('update public.app_note_board_links set from_note=null,from_text=$2,to_text=null,to_note=$3 where id=$1',[textLine,tA2,noteA]));
   await assert.rejects(owner(c=>c.query('update public.app_note_board_links set to_note=$2 where id=$1',[textLine,noteB])),/row-level security/);
  });
  await t.test('bend: relative point saved with curve, both or neither, range, straight again',async()=>{
   bentLine=(await owner(c=>c.query(insLink,link(WS_A,'all',{fn:noteA2,tn:noteA,shape:'curve',bx:0.5,by:-0.25})))).rows[0].id;
   assert.deepEqual((await owner(c=>c.query('select shape,bend_x,bend_y from public.app_note_board_links where id=$1',[bentLine]))).rows[0],{shape:'curve',bend_x:0.5,bend_y:-0.25});
   for(const extra of [{shape:'line',bx:0.5,by:0.2},{shape:'curve',bx:0.5,by:null},{shape:'curve',bx:null,by:0.1},{shape:'curve',bx:6,by:0},{shape:'curve',bx:0,by:-5.5},{shape:'curve',bx:'NaN',by:0}])
    await assert.rejects(owner(c=>c.query(insLink,link(WS_A,'bqwe12345',{fn:noteA,tn:noteA2,...extra}))),{code:'23514'},JSON.stringify(extra));
   await owner(c=>c.query("update public.app_note_board_links set bend_x=1.2,bend_y=0.4 where id=$1",[bentLine]));
   await owner(c=>c.query("update public.app_note_board_links set shape='line',bend_x=null,bend_y=null where id=$1",[bentLine]));
   assert.deepEqual((await owner(c=>c.query('select shape,bend_x from public.app_note_board_links where id=$1',[bentLine]))).rows[0],{shape:'line',bend_x:null});
   // 새 선 기본 모양은 직선.
   const def=await owner(c=>c.query("insert into public.app_note_board_links(workspace_id,board_id,from_note,to_note) values ($1,'bdef67890',$2,$3) returning shape",[WS_A,noteA,noteA2]));
   assert.equal(def.rows[0].shape,'line');
   await owner(c=>c.query("update public.app_note_board_links set shape='curve',bend_x=0.5,bend_y=0.3 where id=$1",[bentLine]));
  });
  await t.test('deleting a text box removes only its lines; deleting a note still removes its lines',async()=>{
   const n=async sql=>(await pool.query(sql)).rows[0].n;
   const all=await n('select count(*)::int n from public.app_note_board_links');
   const hit=(await pool.query('select count(*)::int n from public.app_note_board_links where from_text=$1 or to_text=$1',[tA])).rows[0].n;
   assert.ok(hit>=2);
   await owner(c=>c.query('delete from public.app_note_board_texts where id=$1',[tA]));
   assert.equal(await n('select count(*)::int n from public.app_note_board_links'),all-hit);
   assert.equal((await pool.query('select count(*)::int n from public.app_note_board_links where id=$1',[textLine])).rows[0].n,1); // tA2→noteA 선은 남음
  });
  await t.test('rollback: texts table, new columns, constraints and record gone; policy, default and not-null restored; notes and note lines kept',async()=>{
   const notes=(await pool.query('select count(*)::int n from public.app_notes')).rows[0].n;
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await pool.query('select count(*)::int n from public.app_notes')).rows[0].n,notes);
   assert.equal((await pool.query('select count(*)::int n from public.app_note_board_links where id=$1 or id=$2',[oldLine,bentLine])).rows[0].n,2);
   assert.equal((await pool.query('select count(*)::int n from public.app_note_board_links where from_note is null or to_note is null')).rows[0].n,0);
   assert.equal((await pool.query('select shape from public.app_note_board_links where id=$1',[bentLine])).rows[0].shape,'curve');
   await pool.query(migration);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
