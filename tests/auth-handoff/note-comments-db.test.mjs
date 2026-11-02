// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// NOTE-읽생기아이디어 1단계 DB(20261102203000_note_comments): 노트 댓글 표(소유자만, 같은 작업공간 노트만, 넣기·읽기·지우기만).
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
const version='20261102203000',name='note_comments',stem=version+'_'+name;
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

test('note comments db: plan, dry-run, apply, owner boundary, same-workspace note only, cascade, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'note-comments-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  const noteA=await addNote(WS_A),noteA2=await addNote(WS_A),basketA=await addNote(WS_A,'basket'),noteB=await addNote(WS_B);
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const ins="insert into public.app_note_comments(workspace_id,note_id,kind,quote,body) values ($1,$2,$3,$4,$5) returning id";

  await t.test('files: expanded rules, no functions or triggers, grants as designed, summary 3 lines',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');
   assert.deepEqual([...plan.functions],[]);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0].replace(/\s+/g,' '));
   assert.deepEqual(grants,[
    'grant select, delete on table public.app_note_comments to authenticated;',
    'grant insert (workspace_id, note_id, kind, quote, body) on table public.app_note_comments to authenticated;']);
   assert.doesNotMatch(code,/create (or replace )?function|create trigger|rtw_|\bto (anon|public)\b|alter table public\.app_notes|security definer/i);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/app_notes|truncate|cascade|grant /i);
  });
  await t.test('precheck yes, dry-run changes nothing, apply passes postcheck, second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9972');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9973')).ok,false);
  });
  await t.test('owner writes thought, question and quote comments; reads and deletes; no update',async()=>{
   const a=await owner(c=>c.query(ins,[WS_A,noteA,'thought',null,'가상 생각']));
   await owner(c=>c.query(ins,[WS_A,noteA,'question',null,'가상 질문?\n둘째 줄']));
   await owner(c=>c.query(ins,[WS_A,noteA,'quote','가상 본문 한 문장','가상 인용 댓글']));
   const def=await owner(c=>c.query("insert into public.app_note_comments(workspace_id,note_id,body) values ($1,$2,'가상 기본') returning kind",[WS_A,noteA2]));
   assert.equal(def.rows[0].kind,'thought');
   const rows=(await owner(c=>c.query('select kind,quote,body from public.app_note_comments where note_id=$1 order by created_at,body',[noteA]))).rows;
   assert.equal(rows.length,3);
   await assert.rejects(owner(c=>c.query("update public.app_note_comments set body='바꿈' where id=$1",[a.rows[0].id])),/permission denied/);
   await assert.rejects(owner(c=>c.query("insert into public.app_note_comments(id,workspace_id,note_id,body) values (gen_random_uuid(),$1,$2,'가상')",[WS_A,noteA])),/permission denied/);
   await assert.rejects(owner(c=>c.query("insert into public.app_note_comments(workspace_id,note_id,body,created_at) values ($1,$2,'가상',now())",[WS_A,noteA])),/permission denied/);
   assert.equal((await owner(c=>c.query('delete from public.app_note_comments where id=$1',[a.rows[0].id]))).rowCount,1);
  });
  await t.test('shape checks: empty or long body, bad kind, empty quote refused',async()=>{
   for(const [kind,quote,body] of [['thought',null,''],['thought',null,'   '],['thought',null,'가'.repeat(4001)],['',null,'가상'],[' thought',null,'가상'],['가'.repeat(21),null,'가상'],['줄\n바꿈',null,'가상'],['quote','',  '가상'],['quote','  ','가상'],['quote','가'.repeat(1001),'가상']])
    await assert.rejects(owner(c=>c.query(ins,[WS_A,noteA,kind,quote,body])),{code:'23514'},JSON.stringify([kind,quote,body.length]));
   await owner(c=>c.query(ins,[WS_A,noteA,'thought',null,'가'.repeat(4000)]));
  });
  await t.test('boundaries: other workspace note, basket row, other workspace id, stranger, anon and server blocked',async()=>{
   await assert.rejects(owner(c=>c.query(ins,[WS_A,noteB,'thought',null,'가상'])),/row-level security/);
   await assert.rejects(owner(c=>c.query(ins,[WS_B,noteB,'thought',null,'가상'])),/row-level security/);
   await assert.rejects(owner(c=>c.query(ins,[WS_A,basketA,'thought',null,'가상'])),/row-level security/);
   await assert.rejects(stranger(c=>c.query(ins,[WS_A,noteA,'thought',null,'가상'])),/row-level security/);
   assert.deepEqual((await stranger(c=>c.query('select 1 from public.app_note_comments'))).rows,[]);
   assert.equal((await stranger(c=>c.query('delete from public.app_note_comments'))).rowCount,0);
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_note_comments')),/permission denied/);
   await assert.rejects(as('anon','',c=>c.query(ins,[WS_A,noteA,'thought',null,'가상'])),/permission denied/);
   await assert.rejects(server(c=>c.query('select 1 from public.app_note_comments')),/permission denied/);
   // 남(STRANGER)의 작업공간에 남이 쓴 댓글은 owner에게 보이지 않는다.
   await pool.query("insert into public.app_note_comments(workspace_id,note_id,body) values ($1,$2,'가상 남의 댓글')",[WS_B,noteB]);
   assert.equal((await owner(c=>c.query("select 1 from public.app_note_comments where workspace_id=$1",[WS_B]))).rows.length,0);
  });
  await t.test('deleting a note removes its comments only',async()=>{
   const left=(await pool.query('select count(*)::int n from public.app_note_comments where note_id<>$1',[noteA])).rows[0].n;
   await pool.query('delete from public.app_notes where id=$1',[noteA]);
   assert.equal((await pool.query('select count(*)::int n from public.app_note_comments where note_id=$1',[noteA])).rows[0].n,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_note_comments')).rows[0].n,left);
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
