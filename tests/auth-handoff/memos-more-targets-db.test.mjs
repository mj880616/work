// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// S69-95 NOTE-메모넓히기 DB(20261125060000_memos_more_targets): 메모 대상 종류 넷(자료실 자료·사업 보고·담당조직 기록·텔레그램 소식)과
// 넣기 정책 교체(같은 이름·역할·명령, 새 종류는 같은 작업공간 원문만, 텔레그램은 운영자 기능 허용 표까지), 원문을 지워도 메모는 남음,
// 공유(COLLAB)로 원문을 받은 사람에게도 메모는 가지 않음(메모 표는 주인만 · 공유 함수가 메모 표를 읽지 않음), 되돌리기.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {trackPool,closePool} from './pg-close.mjs';
import {fixture,OWNER,STRANGER,WS_A,WS_B,ORG_A,ORG_B,MEETING_A,MEETING_B} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261125060000',name='memos_more_targets',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
// 원문 표는 이 migration이 읽는 칸만 갖춘 합성 모양이다(운영과 같은 소유자 정책). 노트·옛 댓글·메모 표는 원래 migration 원문으로 만든다.
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
  create table public.app_documents(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id), title text);
  create table public.app_feed_items(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id), source text not null, title text);
  create table public.app_suborganization_updates(id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.app_suborganizations(id) on delete cascade, raw_text text);
  alter table public.app_documents enable row level security;
  alter table public.app_feed_items enable row level security;
  alter table public.app_meetings enable row level security;
  alter table public.app_suborganization_updates enable row level security;
  revoke all on table public.app_documents, public.app_feed_items, public.app_meetings, public.app_suborganization_updates from public, anon, service_role;
  create policy owner_all on public.app_documents for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  create policy owner_all on public.app_feed_items for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  create policy owner_all on public.app_meetings for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  create policy owner_all on public.app_suborganization_updates for all to authenticated
    using (exists (select 1 from public.app_suborganizations o where o.id = organization_id)) with check (exists (select 1 from public.app_suborganizations o where o.id = organization_id));
  create table public.app_operator_features(workspace_id uuid not null references public.app_workspaces(id), feature text not null, primary key (workspace_id, feature));
  alter table public.app_operator_features enable row level security;
  revoke all on table public.app_operator_features from public, anon, authenticated, service_role;
  create function private.app_workspace_has_feature(p_workspace uuid, p_feature text) returns boolean
    language sql stable security definer set search_path = '' as $$
    select p_workspace is not null and p_feature is not null and private.app_is_workspace_owner(p_workspace)
       and exists (select 1 from public.app_operator_features f where f.workspace_id = p_workspace and f.feature = p_feature) $$;
  revoke all on function private.app_workspace_has_feature(uuid,text) from public;
  grant execute on function private.app_workspace_has_feature(uuid,text) to authenticated;
  revoke usage on schema private from service_role;`;
const R1='31000000-0000-4000-8000-000000000001';

test('memos more targets db: plan, dry-run, apply, same-workspace targets, telegram operator feature, memo stays, owner-only under sharing, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'memos-more-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query(await read('supabase/migrations/20261102203000_note_comments.sql'));
  await pool.query(await read('supabase/migrations/20261125030000_memos.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const one=(sql,args)=>pool.query(sql,args).then(r=>r.rows[0].id);
  // 사업 보고 MEETING_A(WS_A)·MEETING_B(WS_B)는 공용 합성 자료(basket4-fixture)에 이미 있다.
  const docA=await one("insert into public.app_documents(workspace_id,title) values ($1,'가상 자료') returning id",[WS_A]);
  const docB=await one("insert into public.app_documents(workspace_id,title) values ($1,'남의 자료') returning id",[WS_B]);
  const recA=await one("insert into public.app_suborganization_updates(organization_id,raw_text) values ($1,'가상 기록') returning id",[ORG_A]);
  const recB=await one("insert into public.app_suborganization_updates(organization_id,raw_text) values ($1,'남의 기록') returning id",[ORG_B]);
  const tgA=await one("insert into public.app_feed_items(workspace_id,source,title) values ($1,'telegram','가상 소식') returning id",[WS_A]);
  const callA=await one("insert into public.app_feed_items(workspace_id,source,title) values ($1,'call','가상 통화') returning id",[WS_A]);
  const tgB=await one("insert into public.app_feed_items(workspace_id,source,title) values ($1,'telegram','남의 소식') returning id",[WS_B]);
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const ins="insert into public.app_memos(workspace_id,target_type,target_id,target_title,body) values ($1,$2,$3,$4,$5) returning id";

  await t.test('files: expanded rules, policy replaced in place, no functions, grants or triggers, summary 3 lines',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');
   assert.deepEqual([...plan.functions],[]);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.deepEqual([...code.matchAll(/drop policy (\w+) on public\.(\w+)/g)].map(m=>m[1]+'@'+m[2]),['memos_owner_insert@app_memos']);
   assert.deepEqual([...code.matchAll(/create policy (\w+) on public\.(\w+) for (\w+) to (\w+)/g)].map(m=>m.slice(1).join(' ')),['memos_owner_insert app_memos insert authenticated']);
   assert.doesNotMatch(code,/\bgrant\b|\brevoke\b|create (or replace )?function|create trigger|rtw_|\bto (anon|public)\b|alter table public\.app_(documents|meetings|feed_items|suborganization)|delete from public|update public|security definer|disable row level/i);
   const rb=rollbackSQL.replace(/--.*$/gm,'');
   assert.match(rb,/drop policy memos_owner_insert on public\.app_memos;\s*create policy memos_owner_insert on public\.app_memos for insert to authenticated/);
   assert.doesNotMatch(rb,/app_documents|app_meetings|app_feed_items|app_suborganization|truncate|cascade|grant /i);
  });
  await t.test('precheck yes, dry-run changes nothing, apply passes postcheck, target tables unchanged, second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9972');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const pre=new Map(beforeCheck.map(r=>[r.item,r.value]));
   for(const r of await readOnly(postcheck))if(pre.has(r.item))assert.equal(r.value,pre.get(r.item),r.item);
   assert.equal((await run('apply','9973')).ok,false);
  });
  await t.test('owner leaves memos on own document, report, organization record; old kinds still work',async()=>{
   for(const [type,id] of [['document',docA],['meeting',MEETING_A],['org_record',recA]])
    await owner(c=>c.query(ins,[WS_A,type,id,'가상 제목','가상 메모']));
   await owner(c=>c.query(ins,[WS_A,'reading',R1,null,'가상 저장 글 메모']));
   await owner(c=>c.query(ins,[WS_A,'brief',R1,null,'가상 브리핑 메모']));
   assert.equal((await owner(c=>c.query("select count(*)::int n from public.app_memos where target_type in ('document','meeting','org_record')"))).rows[0].n,3);
  });
  await t.test('new kinds need a target in the same workspace: other workspace, unknown id refused',async()=>{
   for(const [type,id] of [['document',docB],['meeting',MEETING_B],['org_record',recB],['document',R1],['meeting',R1],['org_record',R1]])
    await assert.rejects(owner(c=>c.query(ins,[WS_A,type,id,null,'가상'])),/row-level security/,type);
   // 남(STRANGER)은 자기 작업공간 이름으로도 WS_A 원문에 메모를 남기지 못한다.
   for(const [type,id] of [['document',docA],['meeting',MEETING_A],['org_record',recA],['telegram',tgA]])
    await assert.rejects(stranger(c=>c.query(ins,[WS_B,type,id,null,'가상'])),/row-level security/,type);
   await assert.rejects(owner(c=>c.query(ins,[WS_A,'library',docA,null,'가상'])),{code:'23514'});
  });
  await t.test('telegram: only with the operator feature on the server allow-list, only telegram items of the same workspace',async()=>{
   await assert.rejects(owner(c=>c.query(ins,[WS_A,'telegram',tgA,null,'가상'])),/row-level security/,'기능 없음');
   await pool.query("insert into public.app_operator_features values ($1,'telegram')",[WS_A]);
   await owner(c=>c.query(ins,[WS_A,'telegram',tgA,'가상 방 · 가상 소식','텔레그램 메모']));
   await assert.rejects(owner(c=>c.query(ins,[WS_A,'telegram',callA,null,'가상'])),/row-level security/,'통화 줄');
   await assert.rejects(owner(c=>c.query(ins,[WS_A,'telegram',tgB,null,'가상'])),/row-level security/,'남의 소식');
   await pool.query("delete from public.app_operator_features where workspace_id=$1",[WS_A]);
   await assert.rejects(owner(c=>c.query(ins,[WS_A,'telegram',tgA,null,'가상'])),/row-level security/,'기능 끔');
   // 이미 남긴 메모는 주인이 그대로 읽고 지울 수 있다(읽기·지우기 정책은 그대로).
   assert.equal((await owner(c=>c.query("select count(*)::int n from public.app_memos where target_type='telegram'"))).rows[0].n,1);
  });
  await t.test('sharing: a group member who can see the original still never sees the owner memos; no collab function reads memos',async()=>{
   // 공유 받은 사람(STRANGER)이 원문을 본다고 해도(가상: 그 작업공간 기록 읽기를 열어 줌) 메모 표는 주인 정책만 따른다.
   await pool.query("create policy shared_probe on public.app_suborganization_updates for select to authenticated using (true)");
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_suborganization_updates where id=$1',[recA]))).rows[0].n,1);
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_memos where target_id=$1',[recA]))).rows[0].n,0);
   assert.equal((await stranger(c=>c.query("select count(*)::int n from public.app_memos where workspace_id=$1",[WS_A]))).rows[0].n,0);
   await assert.rejects(stranger(c=>c.query(ins,[WS_A,'org_record',recA,null,'남이 남김'])),/row-level security/);
   await pool.query("drop policy shared_probe on public.app_suborganization_updates");
   const files=(await readdir(new URL('../../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql'));
   for(const f of files){
    const sql=(await read('supabase/migrations/'+f)).replace(/--.*$/gm,'');
    for(const m of sql.matchAll(/create (?:or replace )?function [\w.]*app_collab_\w+[\s\S]*?\$\w*\$[\s\S]*?\$\w*\$/gi))
     assert.doesNotMatch(m[0],/app_memos/,f);
   }
  });
  await t.test('deleting the original keeps its memo and its title copy',async()=>{
   await pool.query('delete from public.app_documents where id=$1',[docA]);
   await pool.query('delete from public.app_suborganization_updates where id=$1',[recA]);
   await pool.query('delete from public.app_feed_items where id=$1',[tgA]);
   assert.equal((await owner(c=>c.query("select count(*)::int n from public.app_memos where target_id = any($1) and target_title is not null",[[docA,recA,tgA]]))).rows[0].n,3);
  });
  await t.test('rollback: removes only new-kind memos, restores check, policy and record; re-apply works',async()=>{
   const old=(await pool.query("select count(*)::int n from public.app_memos where target_type in ('note','news','outside','reading','brief')")).rows[0].n;
   await pool.query(rollbackSQL);
   for(const r of await readOnly(postcheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal((await pool.query('select count(*)::int n from public.app_memos')).rows[0].n,old);
   await assert.rejects(owner(c=>c.query(ins,[WS_A,'meeting',MEETING_A,null,'가상'])),{code:'23514'});
   await pool.query(migration);
   for(const r of await readOnly(postcheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   await owner(c=>c.query(ins,[WS_A,'meeting',MEETING_A,null,'다시 남김']));
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
