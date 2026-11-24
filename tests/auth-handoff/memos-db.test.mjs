// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// S69-94 NOTE-메모통일 DB(20261125020000_memos): 메모 표(소유자만, 대상 종류 검사, 노트 메모는 같은 작업공간 노트만, 고치기는 글만)와
// 옛 노트 댓글(app_note_comments) 복사(옛 표는 그대로), 원문을 지워도 메모는 남음, 되돌리기.
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
const version='20261125020000',name='memos',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
// 노트 표는 이 migration이 읽는 칸(id·workspace_id·kind·title)만 갖춘 합성 모양이다(운영과 같은 소유자 정책). 옛 댓글 표는 원래 migration 원문으로 만든다.
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  create table public.app_notes(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id),
    title text not null default '', raw_text text not null default '', kind text not null default 'note');
  alter table public.app_notes enable row level security;
  revoke all on table public.app_notes from public, anon, authenticated, service_role;
  grant select, insert, update, delete on table public.app_notes to authenticated;
  create policy notes_owner_all on public.app_notes for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke usage on schema private from service_role;`;
const R1='31000000-0000-4000-8000-000000000001',A1='32000000-0000-4000-8000-000000000001';

test('memos db: plan, dry-run, apply copies old comments, owner boundary, target rules, text-only edit, memo stays after note delete, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'memos-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query(await read('supabase/migrations/20261102203000_note_comments.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  const addNote=(ws,title='가상 노트',kind='note')=>pool.query("insert into public.app_notes(workspace_id,title,raw_text,kind) values ($1,$2,'가상 본문',$3) returning id",[ws,title,kind]).then(r=>r.rows[0].id);
  const noteA=await addNote(WS_A,'  바다\n책  '),noteA2=await addNote(WS_A,''),basketA=await addNote(WS_A,'바구니','basket'),noteB=await addNote(WS_B,'남의 노트');
  // 옛 댓글(적용 전에 쓴 것): 종류·인용을 그대로 들고 옮겨야 한다.
  const oldIns="insert into public.app_note_comments(workspace_id,note_id,kind,quote,body,created_at) values ($1,$2,$3,$4,$5,$6) returning id";
  const c1=(await pool.query(oldIns,[WS_A,noteA,'quote','가상 인용 문장','가상 인용 댓글','2026-11-01T00:00:00Z'])).rows[0].id;
  const c2=(await pool.query(oldIns,[WS_A,noteA2,'question',null,'가상 질문?','2026-11-02T00:00:00Z'])).rows[0].id;
  const c3=(await pool.query(oldIns,[WS_B,noteB,'thought',null,'가상 남의 댓글','2026-11-03T00:00:00Z'])).rows[0].id;
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const ins="insert into public.app_memos(workspace_id,target_type,target_id,target_title,body) values ($1,$2,$3,$4,$5) returning id";

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
    'grant select, delete on table public.app_memos to authenticated;',
    'grant insert (workspace_id, target_type, target_id, target_title, body, quote, kind) on table public.app_memos to authenticated;',
    'grant update (body, updated_at) on table public.app_memos to authenticated;']);
   assert.doesNotMatch(code,/create (or replace )?function|create trigger|rtw_|\bto (anon|public)\b|alter table public\.app_notes|alter table public\.app_note_comments|delete from public|update public|security definer/i);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/app_notes\b|truncate|cascade|grant |delete from public/i);
  });
  await t.test('precheck yes, dry-run changes nothing, apply copies every old comment and passes postcheck, second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal((await pool.query("select to_regclass('public.app_memos') t")).rows[0].t,null);
   const apply=await run('apply','9982');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const pre=new Map(beforeCheck.map(r=>[r.item,r.value]));
   for(const r of await readOnly(postcheck))if(pre.has(r.item))assert.equal(r.value,pre.get(r.item),r.item);
   const copied=(await pool.query('select id,workspace_id,target_type,target_id,target_title,body,quote,kind,created_at=updated_at same from public.app_memos order by created_at')).rows;
   assert.deepEqual(copied.map(m=>[m.id,m.workspace_id,m.target_type,m.target_id,m.target_title,m.body,m.quote,m.kind,m.same]),[
    [c1,WS_A,'note',noteA,'바다 책','가상 인용 댓글','가상 인용 문장','quote',true],
    [c2,WS_A,'note',noteA2,null,'가상 질문?',null,'question',true],
    [c3,WS_B,'note',noteB,'남의 노트','가상 남의 댓글',null,'thought',true]]);
   assert.equal((await pool.query('select count(*)::int n from public.app_note_comments')).rows[0].n,3,'옛 표는 그대로');
   assert.equal((await run('apply','9983')).ok,false);
  });
  await t.test('owner leaves memos on note, articles and saved items; reads, edits text only, deletes',async()=>{
   const a=await owner(c=>c.query(ins,[WS_A,'note',noteA,'바다 책','가상 메모']));
   await owner(c=>c.query(ins,[WS_A,'news',A1,'가상 기사','가상 기사 메모']));
   await owner(c=>c.query(ins,[WS_A,'outside',A1,null,'가상 성명 메모']));
   await owner(c=>c.query(ins,[WS_A,'reading',R1,'가상 저장 글','가상 저장 글 메모']));
   await owner(c=>c.query(ins,[WS_A,'brief',R1,null,'가상 브리핑 메모']));
   const rows=(await owner(c=>c.query('select target_type,body from public.app_memos where workspace_id=$1 order by created_at,body',[WS_A]))).rows;
   assert.equal(rows.length,7);
   const id=a.rows[0].id;
   assert.equal((await owner(c=>c.query("update public.app_memos set body='고친 메모', updated_at=now() where id=$1",[id]))).rowCount,1);
   assert.equal((await pool.query('select body from public.app_memos where id=$1',[id])).rows[0].body,'고친 메모');
   for(const col of ["target_type='news'","target_id=gen_random_uuid()","workspace_id=workspace_id","target_title='바꿈'","created_at=now()","kind='x'","quote='x'"])
    await assert.rejects(owner(c=>c.query(`update public.app_memos set ${col} where id=$1`,[id])),/permission denied/,col);
   await assert.rejects(owner(c=>c.query("insert into public.app_memos(id,workspace_id,target_type,target_id,body) values (gen_random_uuid(),$1,'note',$2,'가상')",[WS_A,noteA])),/permission denied/);
   await assert.rejects(owner(c=>c.query("insert into public.app_memos(workspace_id,target_type,target_id,body,created_at) values ($1,'note',$2,'가상',now())",[WS_A,noteA])),/permission denied/);
   // 옛 인용·종류를 되돌리기로 다시 남길 수 있다(지운 메모 되살리기).
   await owner(c=>c.query("insert into public.app_memos(workspace_id,target_type,target_id,body,quote,kind) values ($1,'note',$2,'가상 되돌림','가상 인용','quote')",[WS_A,noteA]));
   assert.equal((await owner(c=>c.query('delete from public.app_memos where id=$1',[id]))).rowCount,1);
  });
  await t.test('shape checks: unknown kind of target, empty or long body, long title, empty quote refused',async()=>{
   for(const [type,title,body] of [['library',null,'가상'],['',null,'가상'],['note','','가상'],['note','  ','가상'],['note','가'.repeat(301),'가상'],['note',null,''],['note',null,'   '],['note',null,'가'.repeat(4001)]])
    await assert.rejects(owner(c=>c.query(ins,[WS_A,type,noteA,title,body])),{code:'23514'},JSON.stringify([type,title,body.length]));
   await assert.rejects(owner(c=>c.query("insert into public.app_memos(workspace_id,target_type,target_id,body,quote) values ($1,'note',$2,'가상','  ')",[WS_A,noteA])),{code:'23514'});
   await owner(c=>c.query(ins,[WS_A,'note',noteA,'가'.repeat(300),'가'.repeat(4000)]));
  });
  await t.test('boundaries: other workspace note, basket row, other workspace id, stranger, anon and server blocked',async()=>{
   await assert.rejects(owner(c=>c.query(ins,[WS_A,'note',noteB,null,'가상'])),/row-level security/);
   await assert.rejects(owner(c=>c.query(ins,[WS_B,'note',noteB,null,'가상'])),/row-level security/);
   await assert.rejects(owner(c=>c.query(ins,[WS_B,'news',A1,null,'가상'])),/row-level security/);
   await assert.rejects(owner(c=>c.query(ins,[WS_A,'note',basketA,null,'가상'])),/row-level security/);
   await assert.rejects(stranger(c=>c.query(ins,[WS_A,'news',A1,null,'가상'])),/row-level security/);
   assert.deepEqual((await stranger(c=>c.query('select 1 from public.app_memos'))).rows,[]);
   assert.equal((await stranger(c=>c.query("update public.app_memos set body='남이 고침'"))).rowCount,0);
   assert.equal((await stranger(c=>c.query('delete from public.app_memos'))).rowCount,0);
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_memos')),/permission denied/);
   await assert.rejects(as('anon','',c=>c.query(ins,[WS_A,'news',A1,null,'가상'])),/permission denied/);
   await assert.rejects(server(c=>c.query('select 1 from public.app_memos')),/permission denied/);
   // 남(STRANGER)의 작업공간 메모(옮겨 온 옛 댓글)는 owner에게 보이지 않고 고치거나 지울 수 없다.
   assert.equal((await owner(c=>c.query('select 1 from public.app_memos where workspace_id=$1',[WS_B]))).rows.length,0);
   assert.equal((await owner(c=>c.query("update public.app_memos set body='바꿈' where id=$1",[c3]))).rowCount,0);
   assert.equal((await owner(c=>c.query('delete from public.app_memos where id=$1',[c3]))).rowCount,0);
  });
  await t.test('deleting a note keeps its memos (title copy stays) and the memo text can still be edited',async()=>{
   const left=(await pool.query("select count(*)::int n from public.app_memos where target_id=$1",[noteA2])).rows[0].n;
   assert.ok(left>=1);
   await pool.query('delete from public.app_note_comments where note_id=$1',[noteA2]); // 옛 표는 노트와 함께 지워지는 구조(cascade) — 같은 일을 흉내
   await pool.query('delete from public.app_notes where id=$1',[noteA2]);
   assert.equal((await pool.query("select count(*)::int n from public.app_memos where target_id=$1",[noteA2])).rows[0].n,left);
   assert.equal((await owner(c=>c.query("update public.app_memos set body='원문 없어도 고침' where id=$1",[c2]))).rowCount,1);
  });
  await t.test('rollback: refused while new memos exist; after they are removed, new table and record gone, old comments untouched, re-apply works',async()=>{
   await assert.rejects(pool.query(rollbackSQL),/MEMOS_ROLLBACK_BLOCKED/);
   await pool.query("delete from public.app_memos m where not exists (select 1 from public.app_note_comments c where c.id=m.id and m.target_id=c.note_id and m.body=c.body)");
   const comments=(await pool.query('select count(*)::int n from public.app_note_comments')).rows[0].n;
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select to_regclass('public.app_memos') t")).rows[0].t,null);
   for(const r of await readOnly(postcheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   assert.equal((await pool.query('select count(*)::int n from public.app_note_comments')).rows[0].n,comments);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   await pool.query(migration);
   for(const r of await readOnly(postcheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   assert.equal((await pool.query('select count(*)::int n from public.app_memos')).rows[0].n,comments);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
