// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S67-09 NEWS-보관별표하나로 DB(20261119120000_outside_archive_to_star): 사회운동 글의 '보관'만 있고 별표 없는 줄에 별표 = 보관 시각.
// - 승인형 workflow 실행기(dry-run·apply)로 돌리고, dry-run은 아무것도 남기지 않는다. 두 번째 apply는 멈춘다.
// - 보관만 있던 줄만 starred_at = archived_at, archived_at은 그대로. 이미 별표 있는 줄·표시 없는 줄·다른 칸·행 수는 그대로.
// - 적용 전에 별표 시각 = 보관 시각인 줄이 있으면 멈춘다(되돌리기가 구분할 수 없으므로).
// - 되돌리기는 이번에 채운 별표만 비운다(적용 뒤 새로 친 별표는 남김). 사전·사후 확인은 행 수·예/아니오·해시만.
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
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261119120000',name='outside_archive_to_star',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// 운영 표(20261115150000_outside_for_all)와 같은 칸·권한·정책의 합성 판(공용 글 표는 id만).
const prerequisites=`
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;
  create table public.app_outside_articles(id uuid primary key default gen_random_uuid());
  create table public.app_outside_article_marks (
    workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
    article_id uuid not null references public.app_outside_articles(id) on delete cascade,
    starred_at timestamptz, archived_at timestamptz, dismissed_at timestamptz,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    constraint app_outside_article_marks_pkey primary key (workspace_id, article_id));
  alter table public.app_outside_article_marks enable row level security;
  revoke all on table public.app_outside_article_marks from public, anon, authenticated, service_role;
  grant select, delete on table public.app_outside_article_marks to authenticated;
  grant insert (workspace_id, article_id, starred_at, archived_at, dismissed_at) on table public.app_outside_article_marks to authenticated;
  grant update (starred_at, archived_at, dismissed_at, updated_at) on table public.app_outside_article_marks to authenticated;
  create policy outside_article_marks_owner_all on public.app_outside_article_marks for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  insert into supabase_migrations.schema_migrations(version,name) values ('20261115150000','outside_for_all');`;

test('outside archive to star: archive-only rows get a star, archived_at kept, same-time stop, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'outside-a2s-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL]=await Promise.all(['precheck','postcheck','snapshot','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  const check=async sql=>Object.fromEntries((await readOnly(sql)).map(r=>[r.item,r.value]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  const mark=async(ws,m)=>{const a=(await pool.query('insert into public.app_outside_articles default values returning id')).rows[0].id;
   await pool.query('insert into public.app_outside_article_marks(workspace_id,article_id,starred_at,archived_at,dismissed_at) values ($1,$2,$3,$4,$5)',[ws,a,m.star??null,m.archive??null,m.dismiss??null]);return a;};
  const row=async a=>(await pool.query('select starred_at s,archived_at a,dismissed_at d from public.app_outside_article_marks where article_id=$1',[a])).rows[0];
  const T1='2026-11-01T01:00:00Z',T2='2026-11-02T02:00:00Z',T3='2026-11-03T03:00:00Z';
  const onlyArchive=await mark(WS_A,{archive:T1});
  const otherWs=await mark(WS_B,{archive:T2});
  const archiveDismiss=await mark(WS_A,{archive:T2,dismiss:T3});
  const both=await mark(WS_A,{star:T3,archive:T1});
  const onlyStar=await mark(WS_A,{star:T2});
  const dismissOnly=await mark(WS_A,{dismiss:T1});
  const moved=[onlyArchive,otherWs,archiveDismiss];
  const before=(await pool.query(snapshot)).rows;let pre;

  await t.test('files: read-only checks, three-line summary, expanded workflow accepts the file and backs up the marks table',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const p=prepareMigration({mode,version,runId:'1',root});assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');assert.deepEqual(p.targets,['app_outside_article_marks']);assert.deepEqual(p.review.definer,[]);}
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|disable row level|\bgrant\b|\brevoke\b|create policy|drop policy|create (or replace )?function|information_schema|rtw_|app_outside_marks\b|delete from public|archived_at\s*=\s*null/i);
   for(const sql of [precheck,postcheck,snapshot,rollbackSQL])assert.doesNotMatch(sql,/information_schema/i);
   for(const r of await readOnly(precheck))assert.match(r.value,/^(예|아니오|[0-9]+|[0-9a-f]{32})$/,r.item);
   for(const r of await readOnly(postcheck))assert.match(r.value,/^(예|아니오|[0-9]+|[0-9a-f]{32})$/,r.item);
  });

  await t.test('precheck: counts',async()=>{
   pre=await check(precheck);
   for(const k of ['prerequisite recorded','new migration absent','RLS enabled'])assert.equal(pre[k],'예',k);
   assert.equal(pre['anon or public table privilege'],'아니오');
   assert.equal(pre['star equals archive rows'],'0');
   assert.equal(pre['archive only rows to move'],'3');
   assert.equal(pre['starred rows'],'2');assert.equal(pre['marks rows'],'6');assert.equal(pre['archived rows'],'4');
  });

  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9961');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await check(precheck),pre);
   assert.equal((await row(onlyArchive)).s,null);assert.equal(await history(),0);
  });

  await t.test('apply: archive-only rows get starred_at = archived_at, everything else unchanged, postcheck passes',async()=>{
   const result=await run('apply','9962');assert.equal(result.ok,true,result.summary);
   assert.doesNotMatch(result.summary.split('사후 확인')[1]??'',/\| 아니오 \|/);
   assert.equal(await history(),1);
   for(const a of moved){const r=await row(a);assert.ok(r.a);assert.equal(r.s?.toISOString(),r.a.toISOString());}
   assert.equal((await row(archiveDismiss)).d.toISOString(),new Date(T3).toISOString());
   assert.equal((await row(both)).s.toISOString(),new Date(T3).toISOString());
   assert.equal((await row(onlyStar)).s.toISOString(),new Date(T2).toISOString());
   assert.equal((await row(dismissOnly)).s,null);assert.equal((await row(dismissOnly)).a,null);
   const post=await check(postcheck);
   for(const k of ['move agrees with history','RLS still enabled','no anon or public table privilege'])assert.equal(post[k],'예',k);
   for(const k of ['marks rows','archived rows','other columns hash','constraints hash','policies hash','owner RLS grants hash','column grants hash','triggers hash'])assert.equal(post[k],pre[k],k);
   assert.deepEqual((await pool.query(snapshot)).rows.filter(r=>r.kind!=='history'),before.filter(r=>r.kind!=='history'));
   const again=await check(precheck);assert.equal(again['archive only rows to move'],'0');assert.equal(again['starred rows'],'5');
   assert.equal((await run('apply','9963')).ok,false);
   await assert.rejects(pool.query(migration),/OUTSIDE_ARCHIVE_TO_STAR_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  await t.test('rollback clears only the stars the move filled; a star made after the move stays',async()=>{
   const later=await mark(WS_A,{archive:T1});
   await pool.query("update public.app_outside_article_marks set starred_at='2026-11-19T09:00:00Z' where article_id=$1",[later]);
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   for(const a of moved){const r=await row(a);assert.equal(r.s,null);assert.ok(r.a);}
   assert.equal((await row(both)).s.toISOString(),new Date(T3).toISOString());
   assert.equal((await row(onlyStar)).s.toISOString(),new Date(T2).toISOString());
   assert.ok((await row(later)).s);
   await pool.query('delete from public.app_outside_article_marks where article_id=$1',[later]);
   assert.deepEqual(await check(precheck),pre);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });

  await t.test('a row with the same star and archive time: precheck shows it and apply stops without a change',async()=>{
   const same=await mark(WS_A,{star:T2,archive:T2});
   const v=await check(precheck);assert.equal(v['star equals archive rows'],'1');
   assert.equal((await run('apply','9964')).ok,false);
   await assert.rejects(pool.query(migration),/OUTSIDE_ARCHIVE_TO_STAR_PREREQUISITE_CHANGED/);await pool.query('rollback');
   assert.equal(await history(),0);assert.equal((await row(onlyArchive)).s,null);
   await pool.query('delete from public.app_outside_article_marks where article_id=$1',[same]);
  });

  await t.test('a different login cannot read or change these marks',async()=>{
   const c=await pool.connect();
   try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[STRANGER]);await c.query('set local role authenticated');
    const r=await c.query('select count(*)::int n from public.app_outside_article_marks where workspace_id=$1',[WS_A]);assert.equal(r.rows[0].n,0);
    const u=await c.query('update public.app_outside_article_marks set starred_at=now() where workspace_id=$1',[WS_A]);assert.equal(u.rowCount,0);
    await c.query('rollback');}finally{c.release();}
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
