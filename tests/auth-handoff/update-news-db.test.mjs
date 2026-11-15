// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// UPDATE-운영자전용기록업데이트소식 PR2(20261115200000): 이용자용 '업데이트 소식' 표·함수.
// - 승인형 DB workflow 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예.
// - 쓰기(보내기·고치기·거두기·시작 날짜)·관리 목록은 운영자(dev_inbox 작업공간 owner)만. 다른 이용자·비로그인·service_role은 거절.
// - 읽기는 로그인한 사람 누구나, 시작 날짜(서울) 이후·거두지 않은 것만. 표는 어떤 API 역할도 직접 못 읽고 못 쓴다.
// - 읽음은 화면을 연 사람만 센다(운영자 '읽음 n/m'). 되돌리기는 함수·기록만 지우고 표는 남긴다.
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
const version='20261115200000',name='update_news',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const BEFORE=['20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261025200000_call_personal_box',
 '20261025210000_feed_item_archive','20261026120000_call_user_edit','20261026190000_tg_sender_names','20261027010000_tg_room_day_group',
 '20261027030000_tg_sender_names_read','20261027200000_tg_summary_edit','20261028030000_tg_room_day_context','20261029090000_operator_features'];

test('update news: operator writes, signed-in users read after the start date, no API table access, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'update-news-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-24','2026-10-24T03:00:00Z','가상 통화','가상 요약','call:un1')",[WS_A]);
  await pool.query(await read('supabase/migrations/'+BEFORE.at(-1)+'.sql'));
  for(const f of ['20261031120000_gdrive_photo_index','20261102160000_cloud_files_index'])await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const devInbox=await read('supabase/migrations/20261103100000_dev_inbox_feature.sql');
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const guardFails=async pattern=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),pattern);await c.query('rollback');}finally{c.release();}};

  await t.test('guard: stops without changes before the dev_inbox step is applied',async()=>{
   await guardFails(/UPDATE_NEWS_PREREQUISITE_CHANGED/);
   assert.equal((await pool.query("select to_regclass('public.app_update_news') r")).rows[0].r,null);
   await pool.query(devInbox);
  });
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const allYes=async sql=>{for(const r of await readOnly(sql))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);};
  const before=(await pool.query(snapshot)).rows;

  await t.test('files: rules pass, summary 3 lines, no fixed id, snapshot reads catalogs only',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.flow,'full');
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bto (anon|public)\b(?!\.)|disable row level security|create policy|rtw_/i);
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id in the migration');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
  });

  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(await readOnly(precheck));
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.equal(v['dev_inbox rows'],'1');
   const dry=await run('dry-run','9951');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9952');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.equal((await run('apply','9953')).ok,false);
  });

  const THIRD='20000000-0000-4000-8000-000000000003',WS_C='21000000-0000-4000-8000-000000000003';
  const third=fn=>as('authenticated',THIRD,fn);
  const list=async who=>(await who(c=>c.query('select public.app_update_news_list() l'))).rows[0].l;
  const save=(who,id,title,lines,sources=[])=>who(c=>c.query('select public.app_update_news_save($1,$2,$3,$4) id',[id,title,lines,sources])).then(r=>r.rows[0].id);

  await t.test('operator-only writes: users, anon and server are refused; shape is checked',async()=>{
   for(const fn of [stranger,anon,server]){
    await assert.rejects(save(fn,null,'가상',['한 줄']),{code:'42501'});
    await assert.rejects(fn(c=>c.query("select public.app_update_news_set_start('2026-11-20')")),{code:'42501'});
    await assert.rejects(fn(c=>c.query('select public.app_update_news_admin()')),{code:'42501'});
    await assert.rejects(fn(c=>c.query("select public.app_update_news_withdraw('00000000-0000-4000-8000-000000000000')")),{code:'42501'});
   }
   await assert.rejects(save(owner,null,'가상',[]),/UPDATE_NEWS_SHAPE/);
   await assert.rejects(save(owner,null,'가상',['  ']),/UPDATE_NEWS_SHAPE/);
   await assert.rejects(save(owner,null,'가상',['가'.repeat(201)]),/UPDATE_NEWS_SHAPE/);
   await assert.rejects(save(owner,null,'가'.repeat(81),['한 줄']),/UPDATE_NEWS_SHAPE/);
   await assert.rejects(save(owner,null,null,['한 줄'],['main']),/UPDATE_NEWS_SHAPE/);
   await assert.rejects(owner(c=>c.query("select public.app_update_news_set_start('2020-01-01')")),/UPDATE_NEWS_START/);
   await assert.rejects(anon(c=>c.query('select public.app_update_news_list()')),{code:'42501'});
   await assert.rejects(server(c=>c.query('select public.app_update_news_list()')),{code:'42501'});
  });

  await t.test('no start date: nothing is visible; after the start date users see sent news, newest first, withdrawn ones gone',async()=>{
   await pool.query('insert into auth.users(id) values($1) on conflict do nothing',[THIRD]);
   await pool.query("insert into public.app_workspaces values($1)",[WS_C]);
   await pool.query("insert into public.app_workspace_members values($1,$2,'owner')",[WS_C,THIRD]);
   const old=await save(owner,null,null,['시작 날짜 전 소식']);
   await pool.query("update public.app_update_news set sent_at='2026-11-09T14:59:00Z' where id=$1",[old]);
   assert.deepEqual(await list(stranger),[]);
   assert.equal((await owner(c=>c.query("select public.app_update_news_set_start('2026-11-10') d"))).rows[0].d instanceof Date,true);
   const a=await save(owner,null,'  구글 드라이브 사진·파일 ',['사진 화면에 내 구글 드라이브 칸이 생겼어요',' ','메뉴에 [파일]이 생겼어요'],['11/15-3','11/15-2']);
   await pool.query("update public.app_update_news set sent_at='2026-11-12T00:00:00Z' where id=$1",[a]);
   const b=await save(owner,null,null,['둘째 소식']);
   const edge=await save(owner,null,null,['서울 0시 바로 그 시각']);
   await pool.query("update public.app_update_news set sent_at='2026-11-09T15:00:00Z' where id=$1",[edge]);
   const seen=await list(stranger);
   assert.deepEqual(seen.map(n=>n.id),[b,a,edge]);
   assert.equal(seen[1].title,'구글 드라이브 사진·파일');
   assert.deepEqual(seen[1].lines,['사진 화면에 내 구글 드라이브 칸이 생겼어요','메뉴에 [파일]이 생겼어요']);
   assert.equal(Object.hasOwn(seen[1],'sources'),false,'users do not get the development record names');
   assert.deepEqual((await list(third)).map(n=>n.id),[b,a,edge]);
   assert.equal((await owner(c=>c.query('select public.app_update_news_withdraw($1) w',[edge]))).rows[0].w,true);
   assert.equal((await owner(c=>c.query('select public.app_update_news_withdraw($1) w',[edge]))).rows[0].w,false);
   assert.deepEqual((await list(stranger)).map(n=>n.id),[b,a]);
   await assert.rejects(save(owner,edge,null,['거둔 것 고치기']),/UPDATE_NEWS_NOT_FOUND/);
   assert.equal(await save(owner,b,'고친 제목',['고친 줄']),b);
   const fixed=(await list(stranger))[0];
   assert.equal(fixed.title,'고친 제목');assert.ok(fixed.edited_at);
  });

  await t.test('reads: opening the list marks the visible news read for that person only; admin shows reads n/m',async()=>{
   assert.equal((await stranger(c=>c.query('select public.app_update_news_seen() n'))).rows[0].n,2);
   assert.equal((await stranger(c=>c.query('select public.app_update_news_seen() n'))).rows[0].n,0);
   const admin=(await owner(c=>c.query('select public.app_update_news_admin() a'))).rows[0].a;
   assert.equal(admin.start_on,'2026-11-10');
   assert.equal(admin.users,2);
   assert.equal(admin.items.length,4);
   const byId=Object.fromEntries(admin.items.map(i=>[i.id,i]));
   assert.ok(admin.items.some(i=>i.withdrawn_at));
   assert.deepEqual(admin.items.find(i=>i.title==='구글 드라이브 사진·파일').sources,['11/15-3','11/15-2']);
   assert.equal(Object.values(byId).filter(i=>i.reads===1).length,2);
   await owner(c=>c.query('select public.app_update_news_seen()'));
   const again=(await owner(c=>c.query('select public.app_update_news_admin() a'))).rows[0].a;
   assert.equal(again.items.filter(i=>i.reads===1).length,2,'the operator own reads are not counted');
  });

  await t.test('tables: no API role can read or write them directly',async()=>{
   for(const fn of [owner,stranger,server,anon])for(const tbl of ['app_update_news','app_update_news_start','app_update_news_reads']){
    await assert.rejects(fn(c=>c.query(`select * from public.${tbl}`)),{code:'42501'});
    await assert.rejects(fn(c=>c.query(`delete from public.${tbl}`)),{code:'42501'});
   }
   for(const fn of [owner,stranger])await assert.rejects(fn(c=>c.query('select private.app_update_news_operator()')),{code:'42501'});
  });

  await t.test('operator check follows the allow table',async()=>{
   await pool.query("delete from public.app_operator_features where feature='dev_inbox'");
   await assert.rejects(save(owner,null,null,['한 줄']),{code:'42501'});
   assert.equal((await list(owner)).length,2,'the former operator still reads as a user');
   await pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'dev_inbox')",[WS_A]);
  });

  await t.test('rollback removes the functions and record; tables and sent news stay',async()=>{
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select to_regprocedure('public.app_update_news_list()') f")).rows[0].f,null);
   assert.equal((await pool.query("select to_regprocedure('private.app_update_news_operator()') f")).rows[0].f,null);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_update_news')).rows[0].n,4);
   await guardFails(/UPDATE_NEWS_PREREQUISITE_CHANGED/);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
