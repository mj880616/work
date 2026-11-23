// Fresh local PostgreSQL only. No Supabase, Edge or production credentials. All data synthetic.
// S69-01 글 보기 요약·시사점 다시 만들기 고침(20261124070000_now_detail_body_key, 명진 11/24 "매번 다시 만드는 거 같은데 이러지마"):
// - 승인형 workflow plan(엄격 규칙)·dry-run·apply·사후 확인 통과, 두 번째 적용 거절.
// - 사람별 자세히 표 둘에 body_key 칸 + 모양 검사만. 기존 줄 그대로(비어 있음), 권한·정책·RLS 그대로.
// - 서버(service_role)는 지문을 쓰고 고칠 수 있고, 화면(authenticated)은 자기 줄 읽기만(지문 고치기 거절), anon은 아무것도 없음.
// - 되돌리기: snapshot과 같아지고 다시 적용할 수 있다.
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
const version='20261124070000',name='now_detail_body_key',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
// 앞 단계는 news-outside-retention-db.test.mjs와 같은 길(사회운동·뉴스 공용 표까지).
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;
  alter table auth.users add column email text;
  insert into auth.users(id,email) values ('${OWNER}','op@example.test'),('${STRANGER}','b@example.test');
  create table public.app_notes(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id),
    raw_text text not null, kind text not null default 'note', metadata jsonb not null default '{}'::jsonb, deleted_at timestamptz);
  alter table public.app_notes enable row level security;
  revoke all on table public.app_notes from public, anon, authenticated, service_role;
  create table public.app_workspace_signup_allow(email text primary key, kind text not null, created_at timestamptz not null default now(),
    constraint app_workspace_signup_allow_kind check (kind in ('operator','blocked')));
  alter table public.app_workspace_signup_allow enable row level security;
  revoke all on table public.app_workspace_signup_allow from public, anon, authenticated, service_role;
  insert into supabase_migrations.schema_migrations(version,name) values ('20261113140000','workspace_signup_allow');`;
const BEFORE=['20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261025200000_call_personal_box',
 '20261025210000_feed_item_archive','20261026120000_call_user_edit','20261026190000_tg_sender_names','20261027010000_tg_room_day_group',
 '20261027030000_tg_sender_names_read','20261027200000_tg_summary_edit','20261028030000_tg_room_day_context','20261029090000_operator_features'];
const ART='c0000000-0000-4000-8000-000000006901',POST='c0000000-0000-4000-8000-000000006902';

test('now detail body_key: plan, dry-run, apply, existing rows kept, server writes, screens read only, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'body-key-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query('revoke usage on schema private from service_role');
  await pool.query('grant select on public.app_spaces to authenticated');
  await pool.query('alter table public.app_spaces enable row level security');
  await pool.query('create policy fake_owner_read on public.app_spaces for select to authenticated using (private.app_is_workspace_owner(workspace_id))');
  await pool.query(`create table public.app_documents(id uuid primary key, workspace_id uuid not null, file_id text, extraction_status text, extracted_text text);
   alter table public.app_documents enable row level security;
   create policy fake_docs_owner on public.app_documents for select to authenticated using (private.app_is_workspace_owner(workspace_id));
   grant select on public.app_documents to authenticated;`);
  await pool.query("update public.app_workspaces set slug='kptu-work' where id=$1",[WS_A]);
  await pool.query("update public.app_workspaces set slug='other-work' where id=$1",[WS_B]);
  for(const f of BEFORE.slice(0,-1))await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-24','2026-10-24T03:00:00Z','가상 통화','가상 요약','call:uc1')",[WS_A]);
  await pool.query(await read('supabase/migrations/'+BEFORE.at(-1)+'.sql'));
  for(const f of ['20261028160000_ai_usage_costs','20261031120000_gdrive_photo_index','20261102160000_cloud_files_index','20261103100000_dev_inbox_feature',
   '20261030060000_tg_room_pin','20261105100000_family_notes','20261101233000_news_clipping','20261108140000_news_titles_tried',
   '20261031230000_outside_statements','20261102150000_outside_search_undated','20261108020000_outside_post_body_ko','20261102140000_now_detail','20261106050000_feed_bodies',
   '20261108070000_news_highlights'])
   await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const readsSQL=await read('supabase/migrations/20261106080000_feed_reads_news_prefs.sql');
  await pool.query(readsSQL.slice(readsSQL.indexOf('create table public.app_feed_reads ('),readsSQL.indexOf('alter table public.app_profiles drop constraint')));
  await pool.query("insert into supabase_migrations.schema_migrations(version,name) values ('20261106080000','feed_reads_news_prefs')");
  for(const f of ['20261115100000_news_for_all','20261115140000_news_for_all_refs','20261115150000_outside_for_all'])
   await pool.query(await read('supabase/migrations/'+f+'.sql'));

  // 합성 글 하나씩 + 이미 저장된 요약(옛 저장본 — 지문 없음).
  await pool.query(`insert into public.app_news_articles(id,origin,lane,url,url_key,title,state) values ($1,'site','media','https://news.example.org/a/69','news.example.org/a/69','합성 기사','ok')`,[ART]);
  await pool.query(`insert into public.app_outside_articles(id,source_key,kind,lang,title,url,fetched_at) values ($1,'kctu','statement','ko','합성 성명','https://union.example.org/s/69',now())`,[POST]);
  await pool.query(`insert into public.app_news_now_details(workspace_id,article_id,level,summary,key_sentences,related,interests_key,generated_at) values ($1,$2,'full','합성 요약.','[]','[]','none',now())`,[WS_A,ART]);
  await pool.query(`insert into public.app_outside_now_details(workspace_id,article_id,level,summary,key_sentences,related,interests_key,generated_at) values ($1,$2,'full','합성 요약.','[]','[]','none',now())`,[WS_B,POST]);
  const rowsOf=async()=>(await pool.query(`select 'n' t,workspace_id,article_id,summary,generated_at from public.app_news_now_details union all select 'o',workspace_id,article_id,summary,generated_at from public.app_outside_now_details order by 1`)).rows;
  const rows0=await rowsOf();

  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value??r.ok]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  const before=(await pool.query(snapshot)).rows;let pre;

  await t.test('files: strict rules (rollback mode too), three-line summary, read-only checks, no privilege change',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const p=prepareMigration({mode,version,runId:'1',root});assert.equal(p.rules,'strict');assert.equal(p.flow,'full');}
   assert.equal(prepareMigration({mode:'rollback',version,runId:'1',root}).rules,'strict');
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);
   ['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bgrant\b|\brevoke\b|create policy|drop policy|disable row level|security definer|rtw_|\bupdate public\.|\bdelete from public\./i);
   assert.doesNotMatch(snapshot+precheck+postcheck,/from public\./i,'확인 SQL은 앱 표 줄을 읽지 않음');
   pre=values(await readOnly(precheck));
   for(const [k,v] of Object.entries(pre))if(/^(예|아니오)$/.test(v))assert.equal(v,'예',k);
  });

  await t.test('dry-run leaves columns, rows and history unchanged',async()=>{
   const dry=await run('dry-run','6901');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(values(await readOnly(precheck)),pre);assert.equal(await history(),0);
   assert.deepEqual(await rowsOf(),rows0);
  });

  await t.test('apply adds one column per table, existing rows kept with empty fingerprint, postcheck passes, second apply refused',async()=>{
   const result=await run('apply','6902');assert.equal(result.ok,true,result.summary);
   const post=values(await readOnly(postcheck));
   for(const [k,v] of Object.entries(post))if(/^(예|아니오)$/.test(v))assert.equal(v,'예',k);
   assert.deepEqual(await rowsOf(),rows0,'기존 저장본 그대로');
   assert.equal((await pool.query('select count(*)::int n from public.app_news_now_details where body_key is not null')).rows[0].n,0);
   assert.equal((await run('apply','6903')).ok,false);
   await assert.rejects(pool.query(migration),/NOW_DETAIL_BODY_KEY_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  await t.test('server writes the fingerprint; shape checked; screens read own row only and cannot write; anon nothing',async()=>{
   await as('service_role','',c=>c.query("update public.app_news_now_details set body_key='0123456789abcdef0123456789abcdef' where workspace_id=$1 and article_id=$2 and body_key is null",[WS_A,ART]));
   await as('service_role','',c=>c.query("update public.app_outside_now_details set body_key='none' where workspace_id=$1 and article_id=$2",[WS_B,POST]));
   for(const bad of ['Bad Key!','ABC',''])await assert.rejects(as('service_role','',c=>c.query('update public.app_news_now_details set body_key=$1',[bad])),{code:'23514'});
   const mine=await as('authenticated',OWNER,c=>c.query('select article_id,body_key from public.app_news_now_details'));
   assert.deepEqual(mine.rows,[{article_id:ART,body_key:'0123456789abcdef0123456789abcdef'}]);
   assert.deepEqual((await as('authenticated',OWNER,c=>c.query('select article_id from public.app_outside_now_details'))).rows,[],'남의 작업공간 줄은 안 보임');
   await assert.rejects(as('authenticated',OWNER,c=>c.query("update public.app_news_now_details set body_key='none'")),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query('select body_key from public.app_news_now_details')),{code:'42501'});
  });

  await t.test('rollback drops the column, checks and record only; rows kept; snapshot same; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(await rowsOf(),rows0,'저장된 요약 그대로');
   const post=values(await readOnly(postcheck));
   for(const [k,v] of Object.entries(post))if(/^(예|아니오)$/.test(v))assert.equal(v,'예',k);
   const again=await run('apply','6904');assert.equal(again.ok,true,again.summary);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
