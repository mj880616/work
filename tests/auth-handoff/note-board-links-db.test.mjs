// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// S68-38 노트 보드 연결선 DB(20261123090000_note_board_links): 소유자만, 양쪽 노트 같은 작업공간만, 작업공간·보드 고치기 없음, 노트 삭제 시 선 정리.
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
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261123090000',name='note_board_links',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
// 노트 표는 이 migration이 읽는 칸(id·workspace_id·kind)만 갖춘 합성 모양이다(운영과 같은 소유자 정책).
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

test('note board links db: plan, dry-run, apply, owner boundary, same-workspace notes only, cascade, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'note-board-links-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  const addNote=(ws,kind='note')=>pool.query("insert into public.app_notes(workspace_id,raw_text,kind) values ($1,'가상 노트 #읽기',$2) returning id",[ws,kind]).then(r=>r.rows[0].id);
  const noteA=await addNote(WS_A),noteA2=await addNote(WS_A),noteA3=await addNote(WS_A),basketA=await addNote(WS_A,'basket'),noteB=await addNote(WS_B),noteB2=await addNote(WS_B);
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const ins="insert into public.app_note_board_links(workspace_id,board_id,from_note,to_note,from_side,to_side,shape,dash,ends,label) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id";
  const line=(ws,board,a,b,extra={})=>[ws,board,a,b,extra.fs??null,extra.ts??null,extra.shape??'curve',extra.dash??'solid',extra.ends??'end',extra.label??null];

  await t.test('files: expanded rules, no functions or triggers, grants as designed, summary 3 lines',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');
   assert.deepEqual([...plan.functions],[]);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/create (or replace )?function|create trigger|rtw_|app_collab|\bto (anon|public)\b|alter table public\.app_notes|security definer/i);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/app_notes|truncate|cascade|grant /i);
  });
  await t.test('precheck yes, dry-run changes nothing, apply passes postcheck, second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9982');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9983')).ok,false);
  });
  let first;
  await t.test('owner draws lines on [all] and a named board, changes shape, dash, ends, sides, label, flips, deletes',async()=>{
   first=(await owner(c=>c.query(ins,line(WS_A,'all',noteA,noteA2)))).rows[0].id;
   await owner(c=>c.query(ins,line(WS_A,'babc12345',noteA,noteA2,{fs:'right',ts:'left',shape:'line',dash:'dashed',ends:'both',label:'이어짐'})));
   await owner(c=>c.query(ins,line(WS_A,'babc12345',noteA2,noteA3,{ends:'none'})));
   const def=await owner(c=>c.query("insert into public.app_note_board_links(workspace_id,board_id,from_note,to_note) values ($1,'bdef67890',$2,$3) returning shape,dash,ends,from_side,label",[WS_A,noteA3,noteA]));
   assert.deepEqual(def.rows[0],{shape:'curve',dash:'solid',ends:'end',from_side:null,label:null});
   assert.equal((await owner(c=>c.query('select 1 from public.app_note_board_links'))).rows.length,4);
   // 같은 보드·같은 방향·같은 두 노트는 한 줄뿐(반대 방향은 따로 된다).
   await assert.rejects(owner(c=>c.query(ins,line(WS_A,'all',noteA,noteA2))),{code:'23505'});
   await owner(c=>c.query(ins,line(WS_A,'all',noteA2,noteA)));
   await owner(c=>c.query("update public.app_note_board_links set shape='line',dash='dashed',ends='both',from_side='top',to_side='bottom',label='관련' where id=$1",[first]));
   await owner(c=>c.query("update public.app_note_board_links set from_note=$2,to_note=$3 where id=$1",[first,noteA3,noteA2]));
   const row=(await owner(c=>c.query('select from_note,to_note,shape,dash,ends,from_side,to_side,label from public.app_note_board_links where id=$1',[first]))).rows[0];
   assert.deepEqual(row,{from_note:noteA3,to_note:noteA2,shape:'line',dash:'dashed',ends:'both',from_side:'top',to_side:'bottom',label:'관련'});
   await owner(c=>c.query("update public.app_note_board_links set label=null where id=$1",[first]));
   await assert.rejects(owner(c=>c.query("update public.app_note_board_links set board_id='bzzz99999' where id=$1",[first])),/permission denied/);
   await assert.rejects(owner(c=>c.query("update public.app_note_board_links set workspace_id=$2 where id=$1",[first,WS_B])),/permission denied/);
   await assert.rejects(owner(c=>c.query("update public.app_note_board_links set created_at=now() where id=$1",[first])),/permission denied/);
   await assert.rejects(owner(c=>c.query("insert into public.app_note_board_links(id,workspace_id,board_id,from_note,to_note) values (gen_random_uuid(),$1,'all',$2,$3)",[WS_A,noteA3,noteA])),/permission denied/);
   const extra=(await owner(c=>c.query(ins,line(WS_A,'all',noteA3,noteA)))).rows[0].id;
   assert.equal((await owner(c=>c.query('delete from public.app_note_board_links where id=$1',[extra]))).rowCount,1);
  });
  await t.test('shape checks: bad board id, same note, bad side, shape, dash, ends, label refused',async()=>{
   for(const [board,extra] of [['',{}],['ALL',{}],['b12',{}],['bABCDEFG',{}],['b'+'1'.repeat(13),{}],['all',{fs:'middle'}],['all',{ts:'Top'}],['all',{shape:'zigzag'}],['all',{dash:'dotted'}],['all',{ends:'start'}],['all',{label:''}],['all',{label:'  '}],['all',{label:'가'.repeat(41)}],['all',{label:'줄\n바꿈'}]])
    await assert.rejects(owner(c=>c.query(ins,line(WS_A,board,noteA2,noteA3,extra))),{code:'23514'},JSON.stringify([board,extra]));
   await assert.rejects(owner(c=>c.query(ins,line(WS_A,'all',noteA,noteA))),{code:'23514'});
   await owner(c=>c.query(ins,line(WS_A,'bqwe12345',noteA2,noteA3,{label:'가'.repeat(40)})));
  });
  await t.test('boundaries: other workspace note on either end, basket row, other workspace id, stranger, anon and server blocked',async()=>{
   await assert.rejects(owner(c=>c.query(ins,line(WS_A,'all',noteA,noteB))),/row-level security/);
   await assert.rejects(owner(c=>c.query(ins,line(WS_A,'all',noteB,noteA))),/row-level security/);
   await assert.rejects(owner(c=>c.query(ins,line(WS_B,'all',noteB,noteB2))),/row-level security/);
   await assert.rejects(owner(c=>c.query(ins,line(WS_A,'all',noteA,basketA))),/row-level security/);
   // 고치기로 남의 노트에 잇기도 거절.
   await assert.rejects(owner(c=>c.query('update public.app_note_board_links set to_note=$2 where id=$1',[first,noteB])),/row-level security/);
   await assert.rejects(stranger(c=>c.query(ins,line(WS_A,'all',noteA,noteA2))),/row-level security/);
   assert.deepEqual((await stranger(c=>c.query('select 1 from public.app_note_board_links'))).rows,[]);
   assert.equal((await stranger(c=>c.query("update public.app_note_board_links set label='남'"))).rowCount,0);
   assert.equal((await stranger(c=>c.query('delete from public.app_note_board_links'))).rowCount,0);
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_note_board_links')),/permission denied/);
   await assert.rejects(as('anon','',c=>c.query(ins,line(WS_A,'all',noteA,noteA2))),/permission denied/);
   await assert.rejects(server(c=>c.query('select 1 from public.app_note_board_links')),/permission denied/);
   await pool.query("insert into public.app_note_board_links(workspace_id,board_id,from_note,to_note) values ($1,'all',$2,$3)",[WS_B,noteB,noteB2]);
   assert.equal((await owner(c=>c.query('select 1 from public.app_note_board_links where workspace_id=$1',[WS_B]))).rows.length,0);
  });
  await t.test('deleting a note removes the lines on both ends only',async()=>{
   const left=(await pool.query('select count(*)::int n from public.app_note_board_links where from_note<>$1 and to_note<>$1',[noteA])).rows[0].n;
   assert.ok((await pool.query('select count(*)::int n from public.app_note_board_links where from_note=$1 or to_note=$1',[noteA])).rows[0].n>=2);
   await pool.query('delete from public.app_notes where id=$1',[noteA]);
   assert.equal((await pool.query('select count(*)::int n from public.app_note_board_links where from_note=$1 or to_note=$1',[noteA])).rows[0].n,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_note_board_links')).rows[0].n,left);
  });
  await t.test('rollback: new table and record gone, notes untouched, re-apply works',async()=>{
   const notes=(await pool.query('select count(*)::int n from public.app_notes')).rows[0].n;
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await pool.query('select count(*)::int n from public.app_notes')).rows[0].n,notes);
   await pool.query(migration);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
