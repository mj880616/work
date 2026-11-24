// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// S69-91 ① 노트 보드 꾸미기 DB(20261125040000_note_board_decor, 20261125040100_note_board_free_lines):
// 글 상자 표에 배경 없는 글자·도형·꾸미기 칸, 연결선 표에 점 끝·꺾은선·선 색·두께. 앞 단계 기록이 있어야 적용, 범위 밖 값 거절,
// 옛 행 그대로, 주인만 고침, 남·anon·server 막힘, 쓰는 중이면 되돌리기가 멈춤, 비운 뒤 되돌리면 옛 모양 그대로.
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
const A='20261125040000_note_board_decor',B='20261125040100_note_board_free_lines';
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

test('note board decor db: labels, shapes, decor, free lines, owner only, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'note-board-decor-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  for(const m of ['20261123090000_note_board_links','20261123120000_note_board_texts','20261125000000_note_board_mindmap'])await pool.query(await read('supabase/migrations/'+m+'.sql'));
  const [ma,mb]=await Promise.all([A,B].map(s=>read('supabase/migrations/'+s+'.sql')));
  // 앞 단계 없이 적용하면 멈춘다(상자 틀 칸 없음 → 꾸미기, 꾸미기 없음 → 선).
  await assert.rejects(pool.query(ma),/PREREQUISITE_CHANGED/);
  await assert.rejects(pool.query(mb),/PREREQUISITE_CHANGED/);
  await pool.query(await read('supabase/migrations/20261125020000_note_board_box_size.sql'));
  const pair=async s=>Object.fromEntries(await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(async k=>[k.split('.')[0],await read('docs/'+s+'.'+k)])));
  const pa=await pair(A),pb=await pair(B);
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  const oldBox=(await pool.query("insert into public.app_note_board_texts(workspace_id,board_id,body,x,y,w) values ($1,'bdec0001','옛 상자',10,20,200) returning id",[WS_A])).rows[0].id;
  const oldBox2=(await pool.query("insert into public.app_note_board_texts(workspace_id,board_id,body,x,y) values ($1,'bdec0001','옛 상자 2',300,20) returning id",[WS_A])).rows[0].id;
  const oldLine=(await pool.query("insert into public.app_note_board_links(workspace_id,board_id,from_text,to_text) values ($1,'bdec0001',$2,$3) returning id",[WS_A,oldBox,oldBox2])).rows[0].id;
  const beforeA=(await pool.query(pa.snapshot)).rows,beforeB=(await pool.query(pb.snapshot)).rows,preA=await readOnly(pa.precheck);

  await t.test('files: pair files, summary 3 lines, approved workflow accepts both files as new-column grants',()=>{
   for(const [s,p,mig,table] of [[A,pa,ma,'app_note_board_texts'],[B,pb,mb,'app_note_board_links']]){
    for(const sql of [p.precheck,p.postcheck,p.snapshot])assert.equal(checkSQL(sql).baselineNull,false);
    const [version]=s.split('_');
    const plan=prepareMigration({mode:'apply',version,runId:'1',root});
    assert.equal(plan.rules,'expanded',s);assert.equal(plan.flow,'full',s);assert.deepEqual(plan.newColumnGrantTables,[table]);
    const lines=p.summary.trim().split('\n');
    assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((x,i)=>assert.ok(lines[i].startsWith(x)));
    const code=mig.replace(/--.*$/gm,'');
    assert.doesNotMatch(code,/create (or replace )?function|create trigger|create policy|drop policy|rtw_|app_collab|\bto (anon|public)\b|security definer|disable row level security|using \(true\)|with check \(true\)/i);
    assert.match(code,/commit;\s*$/);
   }
  });
  await t.test('precheck yes, apply both, postchecks yes, old rows unchanged, second apply refused',async()=>{
   for(const r of preA)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   await pool.query(ma);
   for(const r of await readOnly(pb.precheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   await pool.query(mb);
   for(const r of [...await readOnly(pa.postcheck),...await readOnly(pb.postcheck)])assert.equal(r.ok,'예',r.item);
   assert.deepEqual((await pool.query('select body,kind,shape,color,z,stroke,dash,alpha,bold,align,ink from public.app_note_board_texts where id=$1',[oldBox])).rows[0],
    {body:'옛 상자',kind:'topic',shape:'round',color:null,z:0,stroke:null,dash:false,alpha:null,bold:false,align:null,ink:null});
   assert.deepEqual((await pool.query('select from_x,to_x,color,width,shape from public.app_note_board_links where id=$1',[oldLine])).rows[0],{from_x:null,to_x:null,color:null,width:null,shape:'line'});
   await assert.rejects(pool.query(ma),/PREREQUISITE_CHANGED/);
   await assert.rejects(pool.query(mb),/PREREQUISITE_CHANGED/);
  });
  const insT="insert into public.app_note_board_texts(workspace_id,board_id,body,x,y,kind,shape,color,stroke,stroke_w,dash,alpha,bold,align,ink,z,w,h) values ($1,'bdec0001',$2,10,10,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id";
  const insL="insert into public.app_note_board_links(workspace_id,board_id,from_text,to_text,from_x,from_y,to_x,to_y,shape,ends,color,width) values ($1,'bdec0001',$2,$3,$4,$5,$6,$7,$8,'end',$9,$10) returning id";
  let label,shape;
  await t.test('owner adds a label, an empty shape and free lines; bad values refused',async()=>{
   label=(await owner(c=>c.query(insT,[WS_A,'선 위 글자','label','plain',-1,-1,null,false,80,true,'center',9,5,null,null]))).rows[0].id;
   shape=(await owner(c=>c.query(insT,[WS_A,'','shape','diamond',3,9,2,true,100,false,'left',null,-3,120,80]))).rows[0].id;
   const free=(await owner(c=>c.query(insL,[WS_A,null,null,10,10,200,10,'elbow',2,3]))).rows[0].id;
   const half=(await owner(c=>c.query(insL,[WS_A,shape,null,null,null,300,40,'line',null,null]))).rows[0].id;
   await owner(c=>c.query('update public.app_note_board_links set to_x=null,to_y=null,to_text=$2 where id=$1',[free,label]));
   await owner(c=>c.query('update public.app_note_board_texts set z=100000,stroke_w=8 where id=$1',[shape]));
   assert.equal((await owner(c=>c.query('select count(*)::int n from public.app_note_board_links where id in ($1,$2)',[free,half]))).rows[0].n,2);
   const badT=[['빈 글자','','label','plain'],['큰 색','x','shape','rect',10],['없는 모양','x','shape','star'],['없는 종류','x','image','rect']];
   for(const [why,body,kind,sh,color=null] of badT)await assert.rejects(owner(c=>c.query(insT,[WS_A,body,kind,sh,color,null,null,false,null,false,null,null,0,null,null])),{code:'23514'},why);
   for(const [col,v] of [['z',100001],['stroke',10],['stroke_w',0],['alpha',9],['align','middle'],['ink',-1]])
    await assert.rejects(owner(c=>c.query(`update public.app_note_board_texts set ${col}=$2 where id=$1`,[shape,v])),{code:'23514'},col);
   await assert.rejects(owner(c=>c.query('update public.app_note_board_texts set parent_id=$2 where id=$1',[shape,oldBox])),{code:'23514'},'shape cannot be a branch');
   await assert.rejects(owner(c=>c.query("update public.app_note_board_texts set body='' where id=$1",[oldBox])),{code:'23514'},'topic needs text');
   const badL=[['두 끝 함께',[shape,null,5,5,10,10,'line',null,null]],['반쪽 점',[null,null,5,null,10,10,'line',null,null]],['판 밖',[null,null,-1,5,10,10,'line',null,null]],
    ['없는 모양',[null,null,5,5,10,10,'zigzag',null,null]],['큰 색',[null,null,5,5,10,10,'line',10,null]],['두께',[null,null,5,5,10,10,'line',null,9]],['끝 없음',[null,null,null,null,10,10,'line',null,null]]];
   for(const [why,v] of badL)await assert.rejects(owner(c=>c.query(insL,[WS_A,...v])),{code:'23514'},why);
  });
  await t.test('stranger, anon and server blocked',async()=>{
   assert.equal((await stranger(c=>c.query('update public.app_note_board_texts set z=5 where workspace_id=$1',[WS_A]))).rowCount,0);
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_note_board_links where workspace_id=$1',[WS_A]))).rows[0].n,0);
   await assert.rejects(stranger(c=>c.query(insL,[WS_A,null,null,1,1,2,2,'line',null,null])),/row-level security/);
   await assert.rejects(stranger(c=>c.query(insT,[WS_A,'남','label','plain',null,null,null,false,null,false,null,null,0,null,null])),/row-level security/);
   await assert.rejects(as('anon','',c=>c.query('update public.app_note_board_texts set z=1')),/permission denied/);
   await assert.rejects(as('anon','',c=>c.query('select from_x from public.app_note_board_links')),/permission denied/);
   await assert.rejects(server(c=>c.query('select z,ink from public.app_note_board_texts')),/permission denied/);
   await assert.rejects(server(c=>c.query('select from_x,width from public.app_note_board_links')),/permission denied/);
  });
  await t.test('rollback stops while in use; after clearing, both roll back to the old shape',async()=>{
   await assert.rejects(pool.query(pa.rollback),/ROLLBACK_BLOCKED/); // 선 단계가 아직 있음
   await assert.rejects(pool.query(pb.rollback),/ROLLBACK_BLOCKED: point-end/);
   await pool.query("delete from public.app_note_board_links where from_x is not null or to_x is not null or shape='elbow'");
   await pool.query(pb.rollback);
   assert.deepEqual((await pool.query(pb.snapshot)).rows,beforeB);
   await assert.rejects(pool.query(pa.rollback),/ROLLBACK_BLOCKED: labels/);
   await pool.query("delete from public.app_note_board_texts where kind in ('label','shape')");
   await pool.query(pa.rollback);
   assert.deepEqual((await pool.query(pa.snapshot)).rows,beforeA);
   for(const r of [...await readOnly(pa.postcheck),...await readOnly(pb.postcheck)])assert.equal(r.ok,'예',r.item);
   assert.equal((await pool.query('select count(*)::int n from public.app_note_board_links where id=$1',[oldLine])).rows[0].n,1);
   await pool.query(ma);await pool.query(mb);
   for(const r of [...await readOnly(pa.postcheck),...await readOnly(pb.postcheck)])assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
