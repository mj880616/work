// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic (no real names).
// WEEKLY-임시저장 DB: 20261024001000_weekly_draft — two columns (draft jsonb, draft_saved_at timestamptz) + shape CHECK on the existing
// weekly request table, column insert/update grants for the two new columns only (authenticated), owner RLS untouched, guarded rollback.
// The approved DB workflow refuses a grant on an existing table (grant-existing), so the file is applied as written (SQL Editor, phone path C)
// unless the workflow gate is widened by a separate decision; this test applies the file directly.
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
import {checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
const version='20261024001000',name='weekly_draft',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const WEEK='2026-10-19';
const ROW={id:'r1',day:'2026-10-28',time:'10:30',what:'가상 결의대회',place:'가상 광장',who:'가상 임원'};
const DRAFT={v:1,base:{from:'library',file_name:'가상 확정본.hwpx',digest:'0123456789abcdef'},me:'가상 팀원',rows:[{section:'summary',key:'가상 과제',n:1,lines:['가상 줄']}],titles:[{event:'cal:evt',title:'OO 결의대회',place:'가상 광장'}],dropped:[]};

test('weekly draft: columns, shape CHECK, owner-only writes, no new reach, guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'weekly-draft-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex');
 const cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 await cluster.initialise();await cluster.start();
 let pool;
 try{
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(await read('supabase/migrations/20261023140000_weekly_exec_requests.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const v=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  // The request-table writes the screen already sends (insert of the allowed columns), and the new draft write: PATCH on draft_saved_at.
  const add=(c,items,over={})=>{const r={workspace_id:WS_A,week_start:WEEK,...over};
   return c.query('insert into public.app_weekly_exec_requests(workspace_id,week_start,items,carried_at,updated_at) values($1,$2,$3::jsonb,null,now()) returning id,updated_at::text as updated_at',[r.workspace_id,r.week_start,JSON.stringify(items)]);};
  const saveDraft=(c,draft,expected,week=WEEK)=>c.query("update public.app_weekly_exec_requests set draft=$1::jsonb,draft_saved_at=now() where workspace_id=$2 and week_start=$3 and draft_saved_at is not distinct from $4::timestamptz returning draft_saved_at::text as saved",[draft===null?null:JSON.stringify(draft),WS_A,week,expected]);
  const row=async()=>(await pool.query('select items,draft,draft_saved_at::text s,updated_at::text u from public.app_weekly_exec_requests where week_start=$1',[WEEK])).rows[0];

  await t.test('files: read-only checks, three-line summary, grants only for the two new columns, no policy or anon reach',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'');
   assert.match(code,/^begin;\n/);assert.match(code,/\ncommit;\n$/);
   assert.deepEqual(code.match(/\bgrant\b[^;]*;/gi),['grant insert (draft, draft_saved_at) on table public.app_weekly_exec_requests to authenticated;','grant update (draft, draft_saved_at) on table public.app_weekly_exec_requests to authenticated;']);
   assert.doesNotMatch(code,/security definer|create (or replace )?function|create table|create policy|alter policy|drop policy|row level security|\brevoke\b|to anon|to public|to service_role|rtw_|grant delete|grant all|\bupdate public\.|\bdelete from public\.|\bnot valid\b/i);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261024001000', 'weekly_draft'/);
   const rb=rollbackSQL.replace(/--.*$/gm,'');
   assert.match(rb,/where draft is not null\) then\s+raise exception/);assert.match(rb,/drop constraint app_weekly_exec_requests_draft_check,\s+drop column draft_saved_at,\s+drop column draft;/);
   assert.doesNotMatch(rb,/drop table|\bgrant\b|policy/i);
  });
  // One owner row with request lines, saved before the migration (must stay as it is).
  const first=(await owner(c=>add(c,[ROW]))).rows[0];
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;
  const existingHash=async()=>(await pool.query("select md5(string_agg((to_jsonb(r)-'draft'-'draft_saved_at')::text,E'\\n' order by r.id)) h from public.app_weekly_exec_requests r")).rows[0].h;
  const dataHash=await existingHash();
  await t.test('precheck reports the expected pre-apply state',()=>{
   const p=v(beforeCheck);
   for(const k of ['prerequisite recorded','new migration absent','requests table exists','RLS enabled','one owner policy (current shape)','authenticated cannot move a week'])assert.equal(p[k],'예',k);
   for(const k of ['anon or public or service_role table privilege','anon or public or service_role column privilege','authenticated delete privilege'])assert.equal(p[k],'아니오',k);
   assert.deepEqual([p['draft column count'],p['draft check count'],p['requests rows'],p['policies count']],['0','0','1','1']);
  });
  await t.test('prerequisite changes stop the migration without any change',async()=>{
   const attempts=[
    ['grant select on public.app_weekly_exec_requests to anon','revoke select on public.app_weekly_exec_requests from anon'],
    ['grant delete on public.app_weekly_exec_requests to authenticated','revoke delete on public.app_weekly_exec_requests from authenticated'],
    ['alter table public.app_weekly_exec_requests disable row level security','alter table public.app_weekly_exec_requests enable row level security'],
    ["create policy synthetic_extra on public.app_weekly_exec_requests for select to authenticated using (true)",'drop policy synthetic_extra on public.app_weekly_exec_requests'],
    ['alter table public.app_weekly_exec_requests add column draft jsonb','alter table public.app_weekly_exec_requests drop column draft'],
    ["delete from supabase_migrations.schema_migrations where version='20261023140000'","insert into supabase_migrations.schema_migrations(version,name) values('20261023140000','weekly_exec_requests')"],
   ];
   for(const [breakIt,fixIt] of attempts){
    await pool.query(breakIt);
    try{const c=await pool.connect();try{await assert.rejects(c.query(migration),/WEEKLY_DRAFT_PREREQUISITE_CHANGED/,breakIt);await c.query('rollback');}finally{c.release();}}
    finally{await pool.query(fixIt);}
   }
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply once; postcheck all 예 and equal to the precheck values; existing rows unchanged; a second apply is refused',async()=>{
   await pool.query(migration);
   const post=(await pool.query(postcheck)).rows;
   assert.ok(post.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'),'예/아니오 items');
   for(const r of post.filter(r=>!/^(예|아니오)$/.test(r.value)))assert.equal(r.value,v(beforeCheck)[r.item],r.item);
   assert.equal(await history(),1);
   assert.equal(await existingHash(),dataHash,'existing rows unchanged');
   const now=await row();assert.deepEqual([now.draft,now.s],[null,null]);assert.deepEqual(now.items,[ROW]);
   await assert.rejects(pool.query(migration),/WEEKLY_DRAFT_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });
  await t.test('owner saves a draft with the guarded write; a stale write changes nothing; the request lines and updated_at are not touched',async()=>{
   const a=(await owner(c=>saveDraft(c,DRAFT,null))).rows[0];assert.ok(a.saved);
   assert.deepEqual((await row()).draft,DRAFT);
   assert.equal((await row()).u,first.updated_at,'a draft write does not change updated_at');
   assert.equal((await owner(c=>saveDraft(c,{...DRAFT,me:'다른 기기'},null))).rowCount,0,'old version (null) is not written over a saved draft');
   assert.equal((await owner(c=>saveDraft(c,{...DRAFT,me:'다른 기기'},'2000-01-01 00:00:00+00'))).rowCount,0,'old version');
   assert.deepEqual((await row()).draft,DRAFT);
   const b=(await owner(c=>saveDraft(c,{...DRAFT,me:'고침'},a.saved))).rows[0];assert.notEqual(b.saved,a.saved);
   assert.equal((await row()).draft.me,'고침');
   // Clearing the draft keeps the version time (the guard keeps working); the request lines stay.
   assert.equal((await owner(c=>c.query('update public.app_weekly_exec_requests set draft=null,draft_saved_at=now() where week_start=$1',[WEEK]))).rowCount,1);
   assert.deepEqual([(await row()).draft,(await row()).items],[null,[ROW]]);
   // The request-table write (updated_at guard) still works next to the draft.
   assert.equal((await owner(c=>c.query("update public.app_weekly_exec_requests set items=$3::jsonb,updated_at=now() where workspace_id=$1 and week_start=$2 and updated_at=$4::timestamptz returning id",[WS_A,WEEK,JSON.stringify([ROW,{...ROW,id:'r2'}]),first.updated_at]))).rowCount,1);
  });
  await t.test('a new week row can be created with a draft in the same insert',async()=>{
   const r=await owner(c=>c.query("insert into public.app_weekly_exec_requests(workspace_id,week_start,items,draft,draft_saved_at) values($1,'2026-10-26','[]'::jsonb,$2::jsonb,now()) returning id",[WS_A,JSON.stringify(DRAFT)]));
   assert.equal(r.rowCount,1);
  });
  await t.test('the CHECK accepts only an object {"v":1,…} up to 200 KiB with a saved time (a rejection, never an error)',async()=>{
   const bad=[[],'x',1,true,{},{v:2},{v:'1'},{v:null},{v:[1]},{V:1},{version:1},{base:{}}];
   for(const value of bad)await assert.rejects(owner(c=>c.query("update public.app_weekly_exec_requests set draft=$1::jsonb,draft_saved_at=now() where week_start=$2",[JSON.stringify(value),WEEK])),{code:'23514'},JSON.stringify(value));
   await assert.rejects(owner(c=>c.query("update public.app_weekly_exec_requests set draft=$1::jsonb,draft_saved_at=null where week_start=$2",[JSON.stringify(DRAFT),WEEK])),{code:'23514'},'draft without saved time');
   const ok=[{v:1},{v:1.0},DRAFT,{v:1,extra:[1,2,{a:null}]}];
   for(const value of ok)assert.equal((await owner(c=>c.query("update public.app_weekly_exec_requests set draft=$1::jsonb,draft_saved_at=now() where week_start=$2",[JSON.stringify(value),WEEK]))).rowCount,1,JSON.stringify(value).slice(0,60));
   // 204,800 bytes of the stored text: exactly the limit passes, one more is refused; multibyte letters count by bytes.
   const overhead=(await pool.query("select octet_length(($1::jsonb)::text) n",[JSON.stringify({v:1,t:''})])).rows[0].n;
   const w=value=>owner(c=>c.query("update public.app_weekly_exec_requests set draft=$1::jsonb,draft_saved_at=now() where week_start=$2",[JSON.stringify(value),WEEK]));
   assert.equal((await w({v:1,t:'a'.repeat(204800-overhead)})).rowCount,1,'exactly 200 KiB');
   await assert.rejects(w({v:1,t:'a'.repeat(204800-overhead+1)}),{code:'23514'},'200 KiB + 1');
   await assert.rejects(w({v:1,t:'한'.repeat(Math.floor((204800-overhead)/3)+1)}),{code:'23514'},'multibyte');
   assert.equal((await w({v:1,t:'한'.repeat(Math.floor((204800-overhead)/3))})).rowCount,1,'multibyte exactly under');
   assert.equal((await owner(c=>c.query("update public.app_weekly_exec_requests set draft=null,draft_saved_at=null where week_start=$1",[WEEK]))).rowCount,1,'empty again');
  });
  await t.test('no new reach: stranger, no-login, anon and service_role cannot read or write drafts; no delete; no week move',async()=>{
   await owner(c=>saveDraft(c,DRAFT,null));
   assert.deepEqual((await stranger(c=>c.query('select draft from public.app_weekly_exec_requests'))).rows,[]);
   assert.equal((await stranger(c=>c.query("update public.app_weekly_exec_requests set draft='{\"v\":1}'::jsonb,draft_saved_at=now()"))).rowCount,0);
   await assert.rejects(stranger(c=>c.query("insert into public.app_weekly_exec_requests(workspace_id,week_start,draft,draft_saved_at) values($1,'2026-09-21','{\"v\":1}'::jsonb,now())",[WS_A])),{code:'42501'},'stranger insert');
   await assert.rejects(owner(c=>c.query("insert into public.app_weekly_exec_requests(workspace_id,week_start,draft,draft_saved_at) values($1,'2026-09-21','{\"v\":1}'::jsonb,now())",[WS_B])),{code:'42501'},'owner into another workspace');
   assert.deepEqual((await as('authenticated',null,c=>c.query('select draft from public.app_weekly_exec_requests'))).rows,[]);
   for(const role of ['anon','service_role'])await assert.rejects(as(role,null,c=>c.query('select draft from public.app_weekly_exec_requests')),{code:'42501'},role);
   for(const role of ['anon','service_role'])await assert.rejects(as(role,null,c=>c.query("update public.app_weekly_exec_requests set draft='{\"v\":1}'::jsonb")),{code:'42501'},role+' write');
   await assert.rejects(owner(c=>c.query('delete from public.app_weekly_exec_requests')),{code:'42501'});
   for(const col of ["week_start='2026-10-26'","workspace_id='"+WS_B+"'"])await assert.rejects(owner(c=>c.query('update public.app_weekly_exec_requests set '+col)),{code:'42501'},col);
   const grants=(await pool.query("select attname,attacl::text a from pg_attribute where attrelid='public.app_weekly_exec_requests'::regclass and attname in ('draft','draft_saved_at') order by 1")).rows;
   for(const g of grants)assert.match(g.a,/^\{authenticated=[aw]{2}\/[^,]+\}$/,g.attname);
  });
  await t.test('rollback stops while a draft exists; otherwise restores the snapshot; re-apply works',async()=>{
   const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/WEEKLY_DRAFT_ROLLBACK_BLOCKED: saved drafts exist/);await c.query('rollback');}finally{c.release();}
   assert.equal(await history(),1);assert.deepEqual((await row()).draft,DRAFT);
   await pool.query("update public.app_weekly_exec_requests set draft=null,draft_saved_at=null");
   await pool.query("delete from public.app_weekly_exec_requests where week_start<>$1",[WEEK]);
   await pool.query("update public.app_weekly_exec_requests set items=$1::jsonb,updated_at=$2::timestamptz",[JSON.stringify([ROW]),first.updated_at]);
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
   for(const r of (await pool.query(postcheck)).rows.filter(r=>/^(예|아니오)$/.test(r.value)))assert.equal(r.value,'예',r.item);
   await pool.query(migration);assert.equal(await history(),1);
  });
 }finally{
  await closePool(pool);
  await cluster.stop();
 }
});
