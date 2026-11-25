// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic(가상 자료).
// S70-27 BRIEF-손수정(20261125143000_document_brief_edit): 브리핑 손으로 고친 한 장 칸 + 서버 함수 — 승인형 DB workflow 실행기로.
// - 규칙 통과(확장 규칙, full 흐름), 시험 적용은 아무것도 안 바꿈, 적용 뒤 사후 확인 모두 예, 두 번째 적용 거절. 앞 단계(document_briefs) 없으면 멈춤.
// - 주인만: 자기 작업공간의 다 된 브리핑만 고치고(edited·edited_at), AI 원문(brief)은 그대로. null = 되돌리기. 돌려주는 값은 시각뿐.
// - 거절: 남의 작업공간 행(못 고침·행 그대로), 만드는 중 행, 모양 틀린 글, 비로그인·anon·service_role 실행, 표 직접 고치기(authenticated).
// - 되돌리기: 칸·함수·기록이 없어지고 snapshot과 같아진다.
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
import {prepareMigration,toDryRun} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261125143000',name='document_brief_edit',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const DOC_A='32000000-0000-4000-8000-0000000000a1',DOC_B='32000000-0000-4000-8000-0000000000b1';
const BR_A='33000000-0000-4000-8000-0000000000a1',BR_RUN='33000000-0000-4000-8000-0000000000a2',BR_B='33000000-0000-4000-8000-0000000000b1';
const AI={v:3,lead:'가상 요지',gist:['가상 요지'],sections:[{title:'가상 소제목',items:[{text:'가상 줄',page:3,ours:false}]}],quotes:[]};
const EDITED={...AI,lead:'고친 요지',gist:['고친 요지'],sections:[{title:'가상 소제목',items:[{text:'고친 줄',page:3,ours:false}]}]};
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;
  create table public.app_documents(id uuid primary key, workspace_id uuid not null references public.app_workspaces(id), title text);
  alter table public.app_documents enable row level security;
  create policy fake_docs_owner on public.app_documents for select to authenticated using (private.app_is_workspace_owner(workspace_id));
  grant select on public.app_documents to authenticated;
  insert into public.app_documents values ('${DOC_A}','${WS_A}','가상 자료'),('${DOC_B}','${WS_B}','가상 남의 자료');`;

test('document brief edit db: plan, dry-run, apply, owner-only edit of done brief, AI original kept, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'brief-edit-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const guardFails=async pattern=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),pattern);await c.query('rollback');}finally{c.release();}};
  const edit=(c,id,v)=>c.query('select public.app_document_brief_edit($1,$2::jsonb) at',[id,v==null?null:JSON.stringify(v)]).then(r=>r.rows[0].at);
  const rowOf=async id=>(await pool.query('select brief,edited,edited_at from public.app_document_briefs where id=$1',[id])).rows[0];

  await t.test('guard: stops without changes until document_briefs is applied',async()=>{
   await guardFails(/DOCUMENT_BRIEF_EDIT_PREREQUISITE_CHANGED/);
   await pool.query(await read('supabase/migrations/20261113220000_document_briefs.sql'));
  });
  await pool.query(`insert into public.app_document_briefs(id,workspace_id,created_by,document_id,status,stage) values
   ('${BR_A}','${WS_A}','${OWNER}','${DOC_A}','done','done'),('${BR_RUN}','${WS_A}','${OWNER}','${DOC_A}','running','chunk'),
   ('${BR_B}','${WS_B}','${STRANGER}','${DOC_B}','done','done')`);
  await pool.query(`update public.app_document_briefs set brief=$1::jsonb where status='done'`,[JSON.stringify(AI)]);
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules, full flow, summary 3 lines, snapshot reads catalogs only, no anon/public grant, no policy or table grant',()=>{
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.flow,'full');assert.equal(plan.rules,'expanded');
    assert.deepEqual(plan.review.definer,['public.app_document_brief_edit']);
    assert.equal(plan.review.policies,0);assert.equal(plan.review.triggers,0);assert.deepEqual(plan.createdTables,[]);
   }
   const code=migration.replace(/--.*$/gm,'').replace(/insert into supabase_migrations\.schema_migrations[\s\S]*?\]\);/,'');
   assert.doesNotMatch(code,/create policy|drop policy|alter policy|disable row level security|rtw_|grant [^;]* to (anon|public|service_role)\b|on table|grant (select|insert|update|delete)|create table|create trigger/i);
   assert.match(code,/revoke all on function public\.app_document_brief_edit\(uuid, jsonb\) from public, anon, service_role;\s*grant execute on function public\.app_document_brief_edit\(uuid, jsonb\) to authenticated;/);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   for(const r of (precheck.match(/^-- expect: .*$/gm)||[]))assert.match(r,/^-- expect: .+ = (예|기록)$/);
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
   assert.doesNotMatch(migration+rollbackSQL+summary+precheck+postcheck+snapshot,/[A-Za-z0-9._-]+@[A-Za-z0-9-]+\.[A-Za-z]/,'no mail address');
  });
  await t.test('precheck all yes; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9972');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9973')).ok,false);
  });
  await t.test('owner edits own done brief: edited set, AI original kept, time returned; null reverts',async()=>{
   const at=await owner(c=>edit(c,BR_A,EDITED));
   assert.ok(at instanceof Date);
   let r=await rowOf(BR_A);
   assert.deepEqual(r.edited,EDITED);assert.deepEqual(r.brief,AI,'AI original unchanged');assert.ok(r.edited_at);
   assert.deepEqual(await owner(c=>c.query('select edited from public.app_document_briefs where id=$1',[BR_A]).then(x=>x.rows[0].edited)),EDITED,'owner reads edited');
   assert.equal(await owner(c=>edit(c,BR_A,null)),null);
   r=await rowOf(BR_A);assert.equal(r.edited,null);assert.equal(r.edited_at,null);assert.deepEqual(r.brief,AI);
  });
  await t.test('refused: another workspace, running brief, bad shape, signed-out, anon, service_role, direct table update',async()=>{
   await assert.rejects(()=>owner(c=>edit(c,BR_B,EDITED)),/DOCUMENT_BRIEF_EDIT_NOT_FOUND/,'owner cannot edit another workspace brief');
   await assert.rejects(()=>stranger(c=>edit(c,BR_A,EDITED)),/DOCUMENT_BRIEF_EDIT_NOT_FOUND/,'stranger cannot edit my brief');
   assert.equal((await rowOf(BR_A)).edited,null);assert.equal((await rowOf(BR_B)).edited,null);
   assert.equal(await stranger(c=>c.query('select count(*)::int n from public.app_document_briefs where id=$1',[BR_A]).then(x=>x.rows[0].n)),0,'stranger cannot read my brief');
   await assert.rejects(()=>owner(c=>edit(c,BR_RUN,EDITED)),/DOCUMENT_BRIEF_EDIT_NOT_FOUND/,'running brief not editable');
   for(const bad of [[1,2],{v:2,gist:[],sections:[]},{v:3,gist:'x',sections:[]},{v:3,gist:[],sections:{}},{v:3,gist:[],sections:[],big:'가'.repeat(30000)}])
    await assert.rejects(()=>owner(c=>edit(c,BR_A,bad)),/DOCUMENT_BRIEF_EDIT_SHAPE/);
   await assert.rejects(()=>as('authenticated','',c=>edit(c,BR_A,EDITED)),/DOCUMENT_BRIEF_EDIT_NOT_ALLOWED/);
   await assert.rejects(()=>owner(c=>edit(c,null,EDITED)),/DOCUMENT_BRIEF_EDIT_NOT_ALLOWED/);
   await assert.rejects(()=>as('anon','',c=>edit(c,BR_A,EDITED)),/permission denied/);
   await assert.rejects(()=>as('service_role','',c=>edit(c,BR_A,EDITED)),/permission denied/);
   await assert.rejects(()=>owner(c=>c.query("update public.app_document_briefs set edited='{}'::jsonb where id=$1",[BR_A])),/permission denied/,'table update still closed');
   await assert.rejects(()=>as('service_role','',c=>c.query("update public.app_document_briefs set edited='{}'::jsonb where id=$1",[BR_A])),/permission denied/,'service_role cannot write edited');
   assert.ok(await stranger(c=>edit(c,BR_B,EDITED)),'stranger edits own');
  });
  await t.test('rollback: columns, function and history gone, snapshot same as before apply',async()=>{
   await pool.query(rollbackSQL);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal((await pool.query("select to_regprocedure('public.app_document_brief_edit(uuid,jsonb)') p")).rows[0].p,null);
   assert.deepEqual((await pool.query('select brief from public.app_document_briefs where id=$1',[BR_A])).rows[0].brief,AI,'AI original still there');
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
