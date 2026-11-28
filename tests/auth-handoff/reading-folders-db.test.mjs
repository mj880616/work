// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S70-83 READ-저장한글폴더 DB(20261126123000_reading_folders):
// - 새 표 app_reading_folders: owner만(RLS·정책 1개). 화면은 id·작업공간·상위·이름·순서 넣기 / 상위·이름·순서 고치기 / 지우기만. 작업공간은 못 고친다.
// - 폴더 안 폴더(2026-11-28 사용자 결정): 상위는 같은 작업공간 폴더만, 자기 자신·자기 아래로 못 옮김(트리거), 지우면 안의 폴더는 한 단 위로(노트 폴더 규칙).
//   service_role·anon 권한 없음. 남의 작업공간 폴더는 못 보고 못 넣고 못 고치고 못 지운다.
// - app_reading_items.folder_id(새 칸): 같은 작업공간 폴더만 가리킨다(남의 폴더 id를 알아도 거절). 폴더를 지우면 글은 남고 칸만 비운다.
//   화면은 이 칸만 칸 단위로 고친다(넣기 칸·다른 칸 권한 그대로).
// - 승인형 DB workflow 확장 규칙·전체 흐름 통과, 사전 조건 다르면 멈춤, dry-run은 아무것도 안 바꿈, 되돌리기(SQL Editor)는 폴더가 있으면 멈추고 없으면 이전 판으로.
// Optional: READING_FOLDERS_PG_PORT=<port> runs the same checks on an already running local server (user postgres, trust auth).
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
import {OWNER,STRANGER,WS_A,WS_B} from './basket4-fixture.mjs';
import {setupSteps} from './reading-folders-fixture.mjs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const FN='20261126123000',FN_NAME='reading_folders',stem=FN+'_'+FN_NAME;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const externalPort=process.env.READING_FOLDERS_PG_PORT;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const FA='31000000-0000-4000-8000-0000000000a1',FB='31000000-0000-4000-8000-0000000000b1';

test('READ-저장한글폴더 DB: owner-only saved-post folders and a same-workspace folder column — plans, guard, dry-run, apply, rollback',{timeout:240000},async t=>{
 let cluster,pool,adminPool,database='postgres',port,password='';
 if(externalPort){
  port=Number(externalPort);database='reading_folders_'+randomBytes(4).toString('hex');
  adminPool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres',ssl:false}));
  await adminPool.query('create database '+database);
  for(const role of ['anon','authenticated','public_probe','service_role'])await adminPool.query(`drop role if exists ${role}`).catch(()=>{});
 }else{
  const directory=await mkdtemp(join(tmpdir(),'reading-folders-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));port=sock.address().port;await new Promise(r=>sock.close(r));
  password=randomBytes(24).toString('hex');
  cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
  await cluster.initialise();await cluster.start();
 }
 try{
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database,ssl:false}));
  for(const sql of await setupSteps(read))await pool.query(sql);
  const F={migration:await read('supabase/migrations/'+stem+'.sql'),rollback:await read('docs/'+stem+'.rollback.sql'),precheck:await read('docs/'+stem+'.precheck.sql'),
    postcheck:await read('docs/'+stem+'.postcheck.sql'),snapshot:await read('docs/'+stem+'.snapshot.sql'),summary:await read('docs/'+stem+'.summary.md')};
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version:FN,runId:run,root});
  const run=p=>runMigrationPlan(p,query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const history=async v=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[v])).rows[0].n;
  const checks=async sql=>Object.fromEntries((await pool.query(sql)).rows.map(r=>[r.item,r.value]));

  const A1=(await pool.query(`insert into public.app_reading_items(workspace_id,url,title) values ($1,'https://ex.com/a','예시 글 A') returning id`,[WS_A])).rows[0].id;
  const B1=(await pool.query(`insert into public.app_reading_items(workspace_id,url,title) values ($1,'https://ex.com/b','예시 글 B') returning id`,[WS_B])).rows[0].id;
  const before=(await pool.query(F.snapshot)).rows;
  const pre=await checks(F.precheck);

  await t.test('files: 5 pair files, summary 3 lines, no definer/anon/rtw; only the two private invoker tree functions; expanded workflow full flow; rollback is SQL Editor only',()=>{
   const lines=F.summary.trim().split('\n');assert.equal(lines.length,3);
   ['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   for(const sql of [F.migration,F.rollback]){
    const code=sql.replace(/--.*$/gm,'');
    assert.doesNotMatch(code,/security definer|\bto (anon|public)\b|disable row level|rtw_|create extension|create or replace|insert into public|grant execute/i);
    assert.match(code,/^begin;/);assert.match(code,/commit;\s*$/);
   }
   const code=F.migration.replace(/--.*$/gm,'');
   assert.deepEqual([...code.matchAll(/create function ([a-z_.]+)\(/g)].map(m=>m[1]),['private.app_reading_folder_tree_guard','private.app_reading_folder_lift']);
   assert.equal([...code.matchAll(/security invoker/g)].length,2);
   for(const fn of ['app_reading_folder_tree_guard','app_reading_folder_lift'])assert.match(code,new RegExp(`revoke all on function private\\.${fn}\\(\\) from public, anon, authenticated, service_role;`));
   assert.deepEqual([...code.matchAll(/create trigger \w+\s+before [a-z ,_]+ on (public\.\w+)/g)].map(m=>m[1]),['public.app_reading_folders','public.app_reading_folders']);
   assert.match(code,/update public\.app_reading_folders set parent_id = old\.parent_id\s+where parent_id = old\.id;/);
   assert.equal([...code.matchAll(/update public\./g)].length,1,'함수 본문이 고치는 표는 폴더 표 하나(저장한 글 표는 안 고침)');
   assert.match(F.rollback,/drop function private\.app_reading_folder_tree_guard\(\);\ndrop function private\.app_reading_folder_lift\(\);/);
   assert.match(code,/revoke all on table public\.app_reading_folders from public, anon, authenticated, service_role;/);
   assert.match(code,/grant insert \(id, workspace_id, parent_id, name, sort_order\) on table public\.app_reading_folders to authenticated;/);
   assert.match(code,/grant update \(parent_id, name, sort_order\) on table public\.app_reading_folders to authenticated;/);
   assert.match(code,/grant update \(folder_id\) on table public\.app_reading_items to authenticated;/);
   assert.doesNotMatch(code,/to service_role/);
   assert.match(F.migration,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\nvalues \('20261126123000', 'reading_folders'/);
   for(const mode of ['apply','dry-run']){const p=plan(mode,'1');assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');}
   assert.throws(()=>plan('rollback','1'));
  });

  await t.test('precheck before apply: every yes/no item is 예',()=>{
   for(const [item,value] of Object.entries(pre))if(!/hash$/.test(item))assert.equal(value,'예',item);
  });

  await t.test('prerequisite guard stops when the table, column, record or RLS differs',async()=>{
   for(const change of [
    `create table public.app_reading_folders(id uuid)`,
    `alter table public.app_reading_items add column folder_id uuid`,
    `create function private.app_reading_folder_lift() returns trigger language plpgsql as $f$begin return old; end$f$`,
    `delete from supabase_migrations.schema_migrations where version='20261122100000'`,
    `alter table public.app_reading_items disable row level security`,
   ]){
    const c=await pool.connect();
    try{await c.query('begin');await c.query(change);
     await assert.rejects(c.query(F.migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/READING_FOLDERS_PREREQUISITE_CHANGED/,change);}
    finally{await c.query('rollback');c.release();}
   }
   assert.equal(await history(FN),0);
  });

  await t.test('dry-run leaves nothing; apply passes postcheck; second apply refused',async()=>{
   const dry=await run(plan('dry-run','9831'));assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(F.snapshot)).rows,before);
   const apply=await run(plan('apply','9832'));assert.equal(apply.ok,true,apply.summary);
   const post=await checks(F.postcheck);
   for(const [item,value] of Object.entries(post))assert.equal(value,/hash$/.test(item)?pre[item]:'예',item);
   assert.equal(await history(FN),1);
   assert.equal((await run(plan('apply','9833'))).ok,false);
   assert.equal(await history(FN),1);
   // 지금 있는 글은 모두 폴더 없음.
   assert.equal((await pool.query('select count(*)::int n from public.app_reading_items where folder_id is not null')).rows[0].n,0);
  });

  await t.test('folders: owner only; workspace fixed; stranger, anon and service_role refused',async()=>{
   const mk=(c,ws,id,name)=>c.query(`insert into public.app_reading_folders(id,workspace_id,name,sort_order) values ($1,$2,$3,1024) returning id`,[id,ws,name]);
   await as('authenticated',OWNER,c=>mk(c,WS_A,FA,'교섭 자료'));
   await as('authenticated',STRANGER,c=>mk(c,WS_B,FB,'남의 폴더'));
   // 남의 작업공간에 만들기·이름 규칙 밖·같은 id 다시 만들기 거절.
   await assert.rejects(as('authenticated',OWNER,c=>mk(c,WS_B,'31000000-0000-4000-8000-0000000000a2','몰래')),{code:'42501'});
   for(const bad of ['',' 앞공백','가'.repeat(41),'줄\n바꿈'])
    await assert.rejects(as('authenticated',OWNER,c=>mk(c,WS_A,'31000000-0000-4000-8000-0000000000a3',bad)),{code:'23514'},JSON.stringify(bad));
   await assert.rejects(as('authenticated',OWNER,c=>mk(c,WS_A,FA,'또')),{code:'23505'});
   // 보기는 자기 것만.
   assert.deepEqual(await as('authenticated',OWNER,async c=>(await c.query('select id from public.app_reading_folders')).rows.map(r=>r.id)),[FA]);
   assert.deepEqual(await as('authenticated',STRANGER,async c=>(await c.query('select id from public.app_reading_folders')).rows.map(r=>r.id)),[FB]);
   // 이름·순서 고치기는 자기 것만, 작업공간·id·만든 시각은 못 고친다.
   assert.equal(await as('authenticated',OWNER,async c=>(await c.query(`update public.app_reading_folders set name='교섭 기사',sort_order=2048 where id=$1`,[FA])).rowCount),1);
   assert.equal(await as('authenticated',OWNER,async c=>(await c.query(`update public.app_reading_folders set name='남의 것' where id=$1`,[FB])).rowCount),0);
   for(const set of [`workspace_id='${WS_B}'`,`id=gen_random_uuid()`,`created_at=now()`])
    await assert.rejects(as('authenticated',OWNER,c=>c.query(`update public.app_reading_folders set ${set} where id=$1`,[FA])),{code:'42501'},set);
   assert.equal(await as('authenticated',OWNER,async c=>(await c.query(`delete from public.app_reading_folders where id=$1`,[FB])).rowCount),0);
   for(const role of ['anon','service_role'])
    for(const sql of ['select id from public.app_reading_folders',`insert into public.app_reading_folders(workspace_id,name) values ('${WS_A}','x')`,
      `update public.app_reading_folders set name='x' where id='${FA}'`,`delete from public.app_reading_folders where id='${FA}'`])
     await assert.rejects(as(role,'',c=>c.query(sql)),{code:'42501'},role+' '+sql);
  });

  await t.test('folder column: own folder only (another workspace folder refused even with its id); other columns unchanged; delete folder keeps the post',async()=>{
   const put=(sub,item,folder)=>as('authenticated',sub,async c=>(await c.query('update public.app_reading_items set folder_id=$2 where id=$1',[item,folder])).rowCount);
   assert.equal(await put(OWNER,A1,FA),1);
   await assert.rejects(put(STRANGER,B1,FA),{code:'23503'});
   assert.equal(await put(STRANGER,A1,FB),0); // 남의 글은 0줄
   assert.equal(await put(OWNER,B1,FA),0);
   // 넣을 때 폴더 칸은 못 쓴다(넣기 칸 권한 그대로), 고치기 칸도 그대로.
   await assert.rejects(as('authenticated',OWNER,c=>c.query(`insert into public.app_reading_items(workspace_id,url,folder_id) values ($1,'https://ex.com/n',$2)`,[WS_A,FA])),{code:'42501'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query(`update public.app_reading_items set url='https://ex.com/q' where id=$1`,[A1])),{code:'42501'});
   for(const role of ['anon','service_role'])
    await assert.rejects(as(role,'',c=>c.query(`update public.app_reading_items set folder_id=null where id='${A1}'`)),{code:'42501'},role);
   // 남은 남의 폴더 글 수도 못 센다.
   assert.equal(await as('authenticated',STRANGER,async c=>(await c.query('select count(*)::int n from public.app_reading_items where folder_id is not null')).rows[0].n),0);
   // 폴더를 지우면 글은 그대로, 칸만 비운다.
   assert.equal(await as('authenticated',OWNER,async c=>(await c.query('delete from public.app_reading_folders where id=$1',[FA])).rowCount),1);
   const row=(await pool.query('select folder_id,title from public.app_reading_items where id=$1',[A1])).rows[0];
   assert.deepEqual(row,{folder_id:null,title:'예시 글 A'});
   // 지운 폴더 되돌리기(같은 id로 다시 만들기)는 owner면 된다.
   await as('authenticated',OWNER,c=>c.query(`insert into public.app_reading_folders(id,workspace_id,name,sort_order) values ($1,$2,'교섭 기사',2048)`,[FA,WS_A]));
   assert.equal(await put(OWNER,A1,FA),1);
  });

  await t.test('nested folders: same-workspace parent only, no self or own-descendant parent, delete lifts the folders inside one level; posts keep',async()=>{
   const C1='31000000-0000-4000-8000-0000000000c1',C2='31000000-0000-4000-8000-0000000000c2',C3='31000000-0000-4000-8000-0000000000c3';
   const mk=(sub,ws,id,parent,name)=>as('authenticated',sub,c=>c.query(`insert into public.app_reading_folders(id,workspace_id,parent_id,name,sort_order) values ($1,$2,$3,$4,1024)`,[id,ws,parent,name]));
   const parentOf=async id=>(await pool.query('select parent_id from public.app_reading_folders where id=$1',[id])).rows[0]?.parent_id??null;
   const move=(sub,id,parent)=>as('authenticated',sub,async c=>(await c.query('update public.app_reading_folders set parent_id=$2 where id=$1',[id,parent])).rowCount);
   // FA(맨 위) › C1 › C2, 그리고 C3(맨 위).
   await mk(OWNER,WS_A,C1,FA,'하위 폴더');await mk(OWNER,WS_A,C2,C1,'하위의 하위');await mk(OWNER,WS_A,C3,null,'다른 폴더');
   assert.equal(await parentOf(C2),C1);
   // 자기 자신·자기 아래 폴더를 상위로 두기 거절.
   await assert.rejects(move(OWNER,FA,FA),{code:'23514'});
   await assert.rejects(move(OWNER,FA,C2),{code:'23514',message:/READING_FOLDER_CYCLE/});
   await assert.rejects(move(OWNER,C1,C2),{code:'23514',message:/READING_FOLDER_CYCLE/});
   // 남의 폴더를 상위로(id를 알아도) 거절, 남이 내 폴더 아래에 만들기 거절, 남이 내 폴더 옮기기 0줄.
   await assert.rejects(move(OWNER,C3,FB),{code:'23514',message:/READING_FOLDER_SCOPE/});
   await assert.rejects(mk(STRANGER,WS_B,'31000000-0000-4000-8000-0000000000b2',FA,'끼어들기'),{code:'23514',message:/READING_FOLDER_SCOPE/});
   await assert.rejects(mk(OWNER,WS_A,'31000000-0000-4000-8000-0000000000c4',FB,'남의 아래'),{code:'23514',message:/READING_FOLDER_SCOPE/});
   assert.equal(await move(STRANGER,C1,null),0);
   // RLS를 넘는 서버 사용자로도 남의 작업공간 폴더를 상위로 두지 못한다(트리거 SCOPE — 그 뒤에 같은 작업공간 외래 키가 한 번 더 막는다).
   await assert.rejects(pool.query(`insert into public.app_reading_folders(workspace_id,parent_id,name) values ($1,$2,'키 시험')`,[WS_B,FA]),{code:'23514'});
   // 옮기기: C2를 맨 위 C3 아래로, 다시 C1 아래로.
   assert.equal(await move(OWNER,C2,C3),1);assert.equal(await parentOf(C2),C3);
   assert.equal(await move(OWNER,C2,C1),1);
   // 글을 C1에 넣고 C1을 지우면: 안의 폴더 C2는 한 단 위(FA)로, 글은 지우지 않고 칸만 비움(화면은 그 전에 한 단 위로 옮긴다).
   assert.equal(await as('authenticated',OWNER,async c=>(await c.query('update public.app_reading_items set folder_id=$2 where id=$1',[A1,C1])).rowCount),1);
   assert.equal(await as('authenticated',OWNER,async c=>(await c.query('delete from public.app_reading_folders where id=$1',[C1])).rowCount),1);
   assert.equal(await parentOf(C2),FA);
   assert.deepEqual((await pool.query('select folder_id,title from public.app_reading_items where id=$1',[A1])).rows[0],{folder_id:null,title:'예시 글 A'});
   // 맨 위 폴더 FA를 지우면 C2는 맨 위로.
   const back=await as('authenticated',OWNER,async c=>(await c.query('select name,sort_order from public.app_reading_folders where id=$1',[FA])).rows[0]);
   assert.equal(await as('authenticated',OWNER,async c=>(await c.query('delete from public.app_reading_folders where id=$1',[FA])).rowCount),1);
   assert.equal(await parentOf(C2),null);
   // [되돌리기]: 같은 id·같은 상위로 다시 만들고 안의 폴더를 다시 그 아래로(owner 권한만으로).
   await mk(OWNER,WS_A,FA,null,back.name);
   assert.equal(await move(OWNER,C2,FA),1);assert.equal(await parentOf(C2),FA);
   // 정리(아래부터): 다음 되돌리기 시험은 폴더 하나(FA)만 있는 상태에서 시작.
   for(const id of [C2,C3])await as('authenticated',OWNER,c=>c.query('delete from public.app_reading_folders where id=$1',[id]));
   assert.equal((await pool.query('select count(*)::int n from public.app_reading_folders where workspace_id=$1',[WS_A])).rows[0].n,1);
  });

  await t.test('rollback (SQL Editor) stops while folders exist, then drops the column and table and restores the snapshot',async()=>{
   await assert.rejects(pool.query(F.rollback),/READING_FOLDERS_ROLLBACK_BLOCKED: folders exist/);await pool.query('rollback');
   assert.equal(await history(FN),1);
   await pool.query('delete from public.app_reading_folders');
   await pool.query(F.rollback);
   assert.equal(await history(FN),0);
   assert.deepEqual((await pool.query(F.snapshot)).rows,before);
   assert.deepEqual(await checks(F.precheck),pre);
   for(const [item,value] of Object.entries(await checks(F.postcheck)))assert.equal(value,/hash$/.test(item)?pre[item]:'예',item);
   assert.equal((await pool.query('select count(*)::int n from public.app_reading_items')).rows[0].n,2);
   await assert.rejects(pool.query(F.rollback),/READING_FOLDERS_ROLLBACK_BLOCKED/);await pool.query('rollback');
   await pool.query(F.migration);
   assert.equal(await history(FN),1);
  });
 }finally{
  await closePool(pool);
  if(adminPool){await adminPool.query('drop database if exists '+database+' with (force)').catch(()=>{});await closePool(adminPool);}
  if(cluster)await cluster.stop().catch(()=>{});
 }
});
