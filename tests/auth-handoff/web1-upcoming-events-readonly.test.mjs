// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// SEC-옛표쓰기정리(20261029234500_web1_upcoming_events_readonly): 옛 Web1 일정 표의 쓰기 권한 회수 + 쓰기 정책 삭제(읽기 유지).
// 표는 저장소 migration 밖에서 만들어져 정책 이름을 모른다 → 시험은 대시보드식 이름(공백 포함)·역할 조합을 합성해 본다.
// guard(예상 밖 정책 모양이면 멈춤), 적용 뒤 쓰기 거절·읽기 유지·행 보존, 기록 행의 되살리기 문장, rollback이 정책·권한을 원래대로
// 되살리는지(snapshot 비교), 재적용, 승인형 workflow가 이 파일을 거절해 SQL Editor 경로라는 것을 확인한다.
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
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
const version='20261029234500',name='web1_upcoming_events_readonly',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const setup=`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text);
  create table public.main_upcoming_events(id bigserial primary key, start_date date not null, end_date date, title text not null, detail text, updated_at timestamptz default now());
  grant all on public.main_upcoming_events to anon, authenticated, service_role;
  grant usage on all sequences in schema public to anon, authenticated;
  alter table public.main_upcoming_events enable row level security;
  create policy "Public read upcoming events" on public.main_upcoming_events for select using (true);
  create policy "Public insert upcoming events" on public.main_upcoming_events for insert with check (true);
  create policy "Public update upcoming events" on public.main_upcoming_events for update to anon, authenticated using (true) with check (true);
  create policy main_upcoming_delete on public.main_upcoming_events for delete to anon using (true);
  insert into public.main_upcoming_events(start_date,title) values ('2026-01-01','가'),('2026-02-01','나');`;

test('web1 upcoming events readonly: guard, revoke + drop write policies, read kept, exact rollback, SQL Editor only',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'web1-upcoming-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(setup);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollback=await read('docs/'+stem+'.rollback.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const items=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const snap=async()=>(await pool.query(snapshot)).rows.map(r=>[r.kind,r.name,r.definition].join(' | ')).join('\n');
  const body=sql=>sql.replace(/^begin;/m,'').replace(/commit;\s*$/,'');
  async function as(role,sql){const c=await pool.connect();try{await c.query('begin');await c.query('set local role '+role);const r=await c.query(sql);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}

  await t.test('approved DB workflow refuses this file (SQL Editor path)',()=>{
   assert.throws(()=>prepareMigration({mode:'apply',version,runId:'1',root}));
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
  });

  let before,snapBefore;
  await t.test('precheck before apply',async()=>{
   before=items((await pool.query(precheck)).rows);
   for(const k of ['new migration absent','table exists','RLS enabled','anon can select','anon can insert','no ALL policy','write policies removable shape'])assert.equal(before[k],'예',k);
   assert.equal(before['write policies (insert/update/delete)'],'3');assert.equal(before['read policies'],'1');assert.equal(before['row count'],'2');
   snapBefore=await snap();
   assert.match(snapBefore,/restore policy \| main_upcoming_delete \| create policy main_upcoming_delete on public\.main_upcoming_events as permissive for delete to anon using \(true\)/);
   assert.match(snapBefore,/grant \| anon:INSERT/);
  });

  for(const [label,sql] of [
   ['conditional write policy','create policy narrow_insert on public.main_upcoming_events for insert to authenticated with check (title <> \'\')'],
   ['ALL policy','create policy everything on public.main_upcoming_events using (true)'],
   ['restrictive write policy','create policy limit_update on public.main_upcoming_events as restrictive for update to anon using (true)'],
   ['other role','create role editor nologin; create policy editor_delete on public.main_upcoming_events for delete to editor using (true)'],
  ])await t.test('guard stops on '+label+' and changes nothing',async()=>{
   const c=await pool.connect();
   try{await c.query('begin');await c.query(sql);
    await assert.rejects(c.query(body(migration)),/WEB1_UPCOMING_EVENTS_PREREQUISITE_CHANGED/);}
   finally{await c.query('rollback');c.release();}
   assert.equal(await snap(),snapBefore);
  });

  await t.test('apply: writes refused, read and rows kept, restore statements recorded; second apply refused',async()=>{
   await pool.query(migration);
   const post=items((await pool.query(postcheck)).rows);
   for(const k of ['history recorded','writes revoked (anon·authenticated)','no write policy','anon can select','authenticated can select','RLS enabled'])assert.equal(post[k],'예',k);
   for(const k of ['read policies','policy Public read upcoming events','columns','row count'])assert.equal(post[k],before[k],k);
   assert.equal(post['restore statements recorded'],before['write policies (insert/update/delete)']);
   assert.equal((await as('anon','select count(*)::int n from public.main_upcoming_events')).rows[0].n,2);
   await assert.rejects(as('anon',"insert into public.main_upcoming_events(start_date,title) values ('2026-03-01','다')"),{code:'42501'});
   await assert.rejects(as('anon',"update public.main_upcoming_events set title='x'"),{code:'42501'});
   await assert.rejects(as('authenticated','delete from public.main_upcoming_events'),{code:'42501'});
   await assert.rejects(as('anon','truncate public.main_upcoming_events'),{code:'42501'});
   assert.equal((await as('service_role','select count(*)::int n from public.main_upcoming_events')).rows[0].n,2);
   const statements=(await pool.query('select statements from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].statements;
   assert.equal(statements.length,4);
   assert.ok(statements.includes('create policy "Public insert upcoming events" on public.main_upcoming_events as permissive for insert to public with check (true)'));
   await assert.rejects(pool.query(migration),/WEB1_UPCOMING_EVENTS_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  await t.test('rollback restores the exact policies and grants, then apply works again',async()=>{
   await pool.query(rollback);
   assert.equal(await snap(),snapBefore);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.deepEqual(items((await pool.query(precheck)).rows),before);
   await assert.rejects(pool.query(rollback),/WEB1_UPCOMING_EVENTS_ROLLBACK_PREREQUISITE/);await pool.query('rollback');
   await pool.query(migration);
   assert.equal(items((await pool.query(postcheck)).rows)['no write policy'],'예');
  });

  await t.test('rollback refuses a tampered restore statement',async()=>{
   const c=await pool.connect();
   try{await c.query('begin');
    await c.query("update supabase_migrations.schema_migrations set statements=statements||array['create policy x on public.main_upcoming_events as permissive for select to anon using (true)'] where version=$1",[version]);
    await assert.rejects(c.query(body(rollback)),/WEB1_UPCOMING_EVENTS_ROLLBACK_STATEMENT/);}
   finally{await c.query('rollback');c.release();}
  });
 }finally{await closePool(pool);await cluster.stop();}
});
