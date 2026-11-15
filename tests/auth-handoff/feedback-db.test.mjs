// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// FEEDBACK-의견보내기 PR4(20261115210000): 의견 표·사진 표·보내기(자기 것만)·운영자 읽기 함수.
// - 승인형 DB workflow 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예.
// - 보내기는 로그인한 사람만, 보낸 사람은 언제나 auth.uid(). 글·사진·자동 정보 크기 상한과 24시간 10건 상한.
// - 읽기·처리함·숫자는 운영자(dev_inbox owner)만. 보낸 사람 본인·다른 이용자·비로그인·service_role은 거절. 표는 어떤 API 역할도 직접 못 읽고 못 쓴다.
// - 되돌리기는 함수·기록만 지우고 표는 남긴다.
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
const version='20261115210000',name='feedback',stem=version+'_'+name;
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

test('feedback: users send their own, only the operator reads, limits, no API table access, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'feedback-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-24','2026-10-24T03:00:00Z','가상 통화','가상 요약','call:fb1')",[WS_A]);
  await pool.query(await read('supabase/migrations/'+BEFORE.at(-1)+'.sql'));
  for(const f of ['20261031120000_gdrive_photo_index','20261102160000_cloud_files_index'])await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query(`create table public.app_profiles(user_id uuid primary key, display_name text);
   insert into public.app_profiles values('${STRANGER}','가상 이용자');`);
  const devInbox=await read('supabase/migrations/20261103100000_dev_inbox_feature.sql');
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const guardFails=async pattern=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),pattern);await c.query('rollback');}finally{c.release();}};

  await t.test('guard: stops without changes before the dev_inbox step is applied',async()=>{
   await guardFails(/FEEDBACK_PREREQUISITE_CHANGED/);
   assert.equal((await pool.query("select to_regclass('public.app_feedback') r")).rows[0].r,null);
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
   const dry=await run('dry-run','9941');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9942');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.equal((await run('apply','9943')).ok,false);
  });

  const PNG=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5f0000000049454e44ae426082','hex').toString('base64');
  const send=(who,body,ctx={},photos=[])=>who(c=>c.query('select public.app_feedback_send($1,$2,$3) id',[body,JSON.stringify(ctx),JSON.stringify(photos)])).then(r=>r.rows[0].id);

  await t.test('send: signed-in only, sender is the caller, context limited to four fields, photos checked',async()=>{
   await assert.rejects(send(anon,'비로그인'),{code:'42501'});
   await assert.rejects(send(server,'서버'),{code:'42501'});
   await assert.rejects(send(stranger,'   '),/FEEDBACK_BODY/);
   await assert.rejects(send(stranger,'가'.repeat(2001)),/FEEDBACK_BODY/);
   await assert.rejects(send(stranger,'사진 넷',{},[1,2,3,4].map(()=>({mime:'image/png',data:PNG}))),/FEEDBACK_PHOTOS/);
   await assert.rejects(send(stranger,'사진 종류',{},[{mime:'text/html',data:PNG}]),/FEEDBACK_PHOTOS/);
   await assert.rejects(send(stranger,'사진 큼',{},[{mime:'image/jpeg',data:Buffer.alloc(1048577,1).toString('base64')}]),/FEEDBACK_PHOTOS/);
   await assert.rejects(send(stranger,'사진 깨짐',{},[{mime:'image/png',data:'@@@'}]),/FEEDBACK_PHOTOS/);
   assert.equal((await pool.query('select count(*)::int n from public.app_feedback')).rows[0].n,0,'refused sends leave nothing');
   const id=await send(stranger,'  사진 화면에서 별표가 안 눌려요  ',{screen:'사진',device:'fold',client:'app',version:'abc123',user_id:OWNER,extra:'x'.repeat(5000)},[{mime:'image/png',data:PNG}]);
   const row=(await pool.query('select * from public.app_feedback where id=$1',[id])).rows[0];
   assert.equal(row.user_id,STRANGER);assert.equal(row.workspace_id,WS_B);
   assert.equal(row.body,'사진 화면에서 별표가 안 눌려요');
   assert.deepEqual([row.screen,row.device,row.client,row.app_version,row.photo_count],['사진','fold','app','abc123',1]);
   const bad=await send(stranger,'모르는 값',{device:'tv',client:'x',screen:'긴'.repeat(100)});
   const b=(await pool.query('select * from public.app_feedback where id=$1',[bad])).rows[0];
   assert.equal(b.device,null);assert.equal(b.client,null);assert.equal(b.screen.length,40);
  });

  await t.test('read: only the operator lists, sees photos, marks done and counts; the sender cannot read back',async()=>{
   for(const fn of [stranger,anon,server]){
    await assert.rejects(fn(c=>c.query("select public.app_feedback_list('all')")),{code:'42501'});
    await assert.rejects(fn(c=>c.query('select public.app_feedback_open_count()')),{code:'42501'});
    await assert.rejects(fn(c=>c.query("select public.app_feedback_photo('00000000-0000-4000-8000-000000000000',0)")),{code:'42501'});
    await assert.rejects(fn(c=>c.query("select public.app_feedback_done('00000000-0000-4000-8000-000000000000',true)")),{code:'42501'});
   }
   const items=(await owner(c=>c.query("select public.app_feedback_list('open') l"))).rows[0].l;
   assert.equal(items.length,2);
   const first=items.find(i=>i.photos===1);
   assert.equal(first.name,'가상 이용자');assert.equal(first.device,'fold');assert.equal(Object.hasOwn(first,'user_id'),false);
   const photo=(await owner(c=>c.query('select public.app_feedback_photo($1,0) p',[first.id]))).rows[0].p;
   assert.deepEqual(photo,{mime:'image/png',data:PNG});
   assert.equal((await owner(c=>c.query('select public.app_feedback_photo($1,1) p',[first.id]))).rows[0].p,null);
   assert.equal((await owner(c=>c.query('select public.app_feedback_open_count() n'))).rows[0].n,2);
   assert.equal((await owner(c=>c.query('select public.app_feedback_done($1,true) d',[first.id]))).rows[0].d,true);
   assert.equal((await owner(c=>c.query('select public.app_feedback_open_count() n'))).rows[0].n,1);
   assert.equal((await owner(c=>c.query("select public.app_feedback_list('done') l"))).rows[0].l.length,1);
   assert.equal((await owner(c=>c.query("select public.app_feedback_list('all') l"))).rows[0].l.length,2);
   await owner(c=>c.query('select public.app_feedback_done($1,false)',[first.id]));
   assert.equal((await owner(c=>c.query('select public.app_feedback_open_count() n'))).rows[0].n,2);
  });

  await t.test('daily limit: ten per 24 hours per person, others unaffected',async()=>{
   for(let i=0;i<8;i++)await send(stranger,'의견 '+i);
   await assert.rejects(send(stranger,'열한 번째'),/FEEDBACK_DAILY_LIMIT/);
   await send(owner,'운영자도 보낼 수 있어요');
   await pool.query("update public.app_feedback set created_at=now()-interval '25 hours' where user_id=$1",[STRANGER]);
   await send(stranger,'하루 지나면 다시');
  });

  await t.test('tables: no API role can read or write them directly',async()=>{
   for(const fn of [owner,stranger,server,anon])for(const tbl of ['app_feedback','app_feedback_photos']){
    await assert.rejects(fn(c=>c.query(`select * from public.${tbl}`)),{code:'42501'});
    await assert.rejects(fn(c=>c.query(`delete from public.${tbl}`)),{code:'42501'});
   }
   for(const fn of [owner,stranger])await assert.rejects(fn(c=>c.query('select private.app_feedback_operator()')),{code:'42501'});
  });

  await t.test('operator check follows the allow table',async()=>{
   await pool.query("delete from public.app_operator_features where feature='dev_inbox'");
   await assert.rejects(owner(c=>c.query("select public.app_feedback_list('all')")),{code:'42501'});
   await pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'dev_inbox')",[WS_A]);
  });

  await t.test('rollback removes the functions and record; tables and feedback stay',async()=>{
   const n=(await pool.query('select count(*)::int n from public.app_feedback')).rows[0].n;
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select to_regprocedure('public.app_feedback_send(text,jsonb,jsonb)') f")).rows[0].f,null);
   assert.equal((await pool.query("select to_regprocedure('private.app_feedback_operator()') f")).rows[0].f,null);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_feedback')).rows[0].n,n);
   await guardFails(/FEEDBACK_PREREQUISITE_CHANGED/);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
