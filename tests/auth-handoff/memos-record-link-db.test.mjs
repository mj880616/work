// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// S71-71 RECORD-기록하나로 DB(20261127030000_memos_record_link): 메모 대상 종류에 record_link(조직·사업 관리 연결 기록 한 줄)를 더하고
// 넣기 정책을 같은 이름·역할·명령으로 교체(record_link는 같은 작업공간의 확정 연결 줄만, 있던 종류 조건은 그대로), 되돌리기.
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
const version='20261127030000',name='memos_record_link',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
// 원문 표는 이 migration·앞 단계가 읽는 칸만 갖춘 합성 모양이다(운영과 같은 소유자 정책). 노트·옛 댓글·메모 표는 원래 migration 원문으로 만든다.
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
  create table public.app_record_links(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id),
    note_id uuid, organization_id uuid, project_id uuid, status text not null default 'confirmed');
  alter table public.app_record_links enable row level security;
  revoke all on table public.app_record_links from public, anon, service_role;
  create policy owner_all on public.app_record_links for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke usage on schema private from service_role;`;

test('memos record_link db: plan, dry-run, apply, same-workspace confirmed link only, old kinds unchanged, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'memos-link-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query(await read('supabase/migrations/20261102203000_note_comments.sql'));
  await pool.query(await read('supabase/migrations/20261125030000_memos.sql'));
  await pool.query(await read('supabase/migrations/20261125060000_memos_more_targets.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const one=(sql,args)=>pool.query(sql,args).then(r=>r.rows[0].id);
  const linkA=await one("insert into public.app_record_links(workspace_id,note_id,organization_id) values ($1,gen_random_uuid(),$2) returning id",[WS_A,ORG_A]);
  const linkOld=await one("insert into public.app_record_links(workspace_id,note_id,organization_id,status) values ($1,gen_random_uuid(),$2,'rejected') returning id",[WS_A,ORG_A]);
  const linkB=await one("insert into public.app_record_links(workspace_id,note_id,organization_id) values ($1,gen_random_uuid(),$2) returning id",[WS_B,ORG_B]);
  const recA=await one("insert into public.app_suborganization_updates(organization_id,raw_text) values ($1,'가상 기록') returning id",[ORG_A]);
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
   assert.doesNotMatch(code,/\bgrant\b|\brevoke\b|create (or replace )?function|create trigger|rtw_|\bto (anon|public)\b|alter table public\.app_record_links|delete from public|update public|security definer|disable row level/i);
   const rb=rollbackSQL.replace(/--.*$/gm,'');
   assert.match(rb,/drop policy memos_owner_insert on public\.app_memos;\s*create policy memos_owner_insert on public\.app_memos for insert to authenticated/);
   assert.doesNotMatch(rb,/app_record_links|truncate|cascade|grant /i);
  });
  await t.test('precheck yes, dry-run changes nothing, apply passes postcheck, link table unchanged, second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9982');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const pre=new Map(beforeCheck.map(r=>[r.item,r.value]));
   for(const r of await readOnly(postcheck))if(pre.has(r.item))assert.equal(r.value,pre.get(r.item),r.item);
   assert.equal((await run('apply','9983')).ok,false);
  });
  await t.test('owner leaves a memo on an own confirmed record link; old kinds still work',async()=>{
   await owner(c=>c.query(ins,[WS_A,'record_link',linkA,'가상 조직 · 가상 기록','가상 메모']));
   await owner(c=>c.query(ins,[WS_A,'org_record',recA,null,'가상 기록 메모']));
   assert.equal((await owner(c=>c.query("select count(*)::int n from public.app_memos where target_type='record_link'"))).rows[0].n,1);
  });
  await t.test('record_link needs a confirmed link in the same workspace: other workspace, not confirmed, unknown id, stranger refused',async()=>{
   for(const id of [linkB,linkOld,'31000000-0000-4000-8000-000000000009'])
    await assert.rejects(owner(c=>c.query(ins,[WS_A,'record_link',id,null,'가상'])),/row-level security/,id);
   await assert.rejects(stranger(c=>c.query(ins,[WS_B,'record_link',linkA,null,'가상'])),/row-level security/);
   await assert.rejects(stranger(c=>c.query(ins,[WS_A,'record_link',linkA,null,'가상'])),/row-level security/);
   assert.equal((await stranger(c=>c.query("select count(*)::int n from public.app_memos where workspace_id=$1",[WS_A]))).rows[0].n,0);
  });
  await t.test('rollback: removes only record_link memos, restores check, policy and record; re-apply works',async()=>{
   const old=(await pool.query("select count(*)::int n from public.app_memos where target_type<>'record_link'")).rows[0].n;
   await pool.query(rollbackSQL);
   for(const r of await readOnly(postcheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal((await pool.query('select count(*)::int n from public.app_memos')).rows[0].n,old);
   await assert.rejects(owner(c=>c.query(ins,[WS_A,'record_link',linkA,null,'가상'])),{code:'23514'});
   await owner(c=>c.query(ins,[WS_A,'org_record',recA,null,'되돌린 뒤에도']));
   await pool.query(migration);
   for(const r of await readOnly(postcheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   await owner(c=>c.query(ins,[WS_A,'record_link',linkA,null,'다시 남김']));
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
