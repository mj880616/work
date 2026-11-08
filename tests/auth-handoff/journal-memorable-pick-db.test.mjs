// Fresh local PostgreSQL only. No Supabase, OpenAI or production credentials. All data synthetic.
// S54-23 FORGET-소식바로잡기 ② DB(20261109020000_journal_memorable_pick): 잊지 말기 소식 줄마다 AI가 정한 종류·이유 한 줄 표 app_journal_memorable_picks.
// - 승인형 workflow의 plan·dry-run·apply가 통과(확장 규칙)하고, dry-run은 아무것도 남기지 않는다. 기존 소식 표 권한·정책·트리거 해시는 그대로.
// - 로그인 사용자는 자기 작업공간 소식 줄에만 종류·이유를 넣고(다른 작업공간 줄·남의 작업공간 이름으로는 안 됨) kind·reason만 고친다. 지우기 없음.
// - 운영자 기능(calls·telegram)이 빠지면 소유자도 못 읽는다(restrictive). anon·service_role 권한 없음. 소식 줄을 지우면 함께 지워진다.
// - 되돌리기는 새 표와 기록만 지운다(소식 줄 그대로), 다시 적용된다.
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
const version='20261109020000',name='journal_memorable_pick',stem=version+'_'+name;
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

test('journal memorable picks: plan, dry-run, apply, owner-only same-workspace write, operator feature, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'memorable-pick-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  await pool.query("update public.app_workspaces set slug='kptu-work' where id=$1",[WS_A]);
  await pool.query("update public.app_workspaces set slug='other-work' where id=$1",[WS_B]);
  for(const f of BEFORE.slice(0,-1))await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const feed=async(ws,ref)=>(await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-11-08','2026-11-08T03:00:00Z','가상 통화','가상 요약',$2) returning id",[ws,ref])).rows[0].id;
  const F1=await feed(WS_A,'call:a1'),F2=await feed(WS_A,'call:a2');
  await pool.query(await read('supabase/migrations/'+BEFORE.at(-1)+'.sql'));
  await pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'calls')",[WS_B]);
  const FB=await feed(WS_B,'call:b1');
  await pool.query(await read('supabase/migrations/20261103230000_journal_memorable.sql'));
  const line=async(ws,fid,text)=>(await pool.query("insert into public.app_journal_memorable(workspace_id,day,source,feed_item_id,line) values($1,'2026-11-08','call',$2,$3) returning id",[ws,fid,text])).rows[0].id;
  const M1=await line(WS_A,F1,'가상 소식 하나'),M2=await line(WS_A,F2,'가상 소식 둘'),MB=await line(WS_B,FB,'다른 작업공간 소식');
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL]=await Promise.all(['precheck','postcheck','snapshot','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  const check=async sql=>Object.fromEntries((await readOnly(sql)).map(r=>[r.item,r.value]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const before=(await pool.query(snapshot)).rows;let pre;

  await t.test('files: read-only checks, three-line summary, expanded workflow accepts apply and dry-run',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const p=prepareMigration({mode,version,runId:'1',root});assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');}
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'').replace(/'[^']*'/g,"''");
   assert.doesNotMatch(code,/security definer|disable row level|\banon\b(?!,)|create (or replace )?function|create trigger|rtw_|\bdelete\s+from\b|\bupdate\s+public\.|alter table public\.app_journal_memorable\b(?!_picks)/i);
   pre=await check(precheck);
   for(const k of ['new migration absent','previous step applied','picks table absent'])assert.equal(pre[k],'예',k);
   assert.equal(pre['memorable rows'],'3');assert.equal(pre['memorable suggested rows'],'3');
  });

  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await check(precheck),pre);assert.equal(await history(),0);
  });

  await t.test('apply passes postcheck; existing memorable table unchanged',async()=>{
   const result=await run('apply','9972');assert.equal(result.ok,true,result.summary);
   assert.equal(await history(),1);
   const post=await check(postcheck);
   for(const k of ['history row present','picks table RLS on, empty','picks two authenticated policies, one restrictive','picks: no anon/service_role, no delete, value columns only'])assert.equal(post[k],'예',k);
   for(const k of ['memorable rows','memorable suggested rows','memorable grants policies triggers hash'])assert.equal(post[k],pre[k],k);
   assert.equal((await run('apply','9973')).ok,false,'second apply stops');
   await assert.rejects(pool.query(migration),/JOURNAL_MEMORABLE_PICK_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  await t.test('owner writes kind/reason on own lines only; checks hold; no delete; anon and service_role have nothing',async()=>{
   const put=(sub,ws,mid,kind='org',reason='조직보고 · 가상 지부')=>as('authenticated',sub,c=>c.query('insert into public.app_journal_memorable_picks(memorable_id,workspace_id,kind,reason) values($1,$2,$3,$4)',[mid,ws,kind,reason]));
   await put(OWNER,WS_A,M1);
   await assert.rejects(put(OWNER,WS_A,MB),{code:'42501'},'other workspace line under my workspace id');
   await assert.rejects(put(OWNER,WS_B,MB),{code:'42501'},'other workspace');
   await assert.rejects(put(STRANGER,WS_A,M2),{code:'42501'},'not the owner');
   await assert.rejects(put(OWNER,WS_A,M2,'weekly'),{code:'23514'},'kind outside five');
   await assert.rejects(put(OWNER,WS_A,M2,'task',''),{code:'23514'},'empty reason');
   await assert.rejects(put(OWNER,WS_A,M2,'task','가'.repeat(61)),{code:'23514'},'reason over 60');
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_journal_memorable_picks(memorable_id,workspace_id,kind,reason,picked_at) values($1,$2,'task','할 일',now())",[M2,WS_A])),{code:'42501'});
   await put(OWNER,WS_A,M2,'task','할 일 · 집행위 안건');
   const mine=await as('authenticated',OWNER,c=>c.query('select memorable_id,kind,reason from public.app_journal_memorable_picks order by kind'));
   assert.deepEqual(mine.rows.map(r=>r.kind),['org','task']);
   await as('authenticated',OWNER,c=>c.query("update public.app_journal_memorable_picks set kind='area',reason='사업보고 · 가상 사업' where memorable_id=$1",[M1]));
   await assert.rejects(as('authenticated',OWNER,c=>c.query('update public.app_journal_memorable_picks set memorable_id=$1 where memorable_id=$2',[M2,M1])),{code:'42501'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query('delete from public.app_journal_memorable_picks where memorable_id=$1',[M1])),{code:'42501'});
   assert.equal((await as('authenticated',STRANGER,c=>c.query('select * from public.app_journal_memorable_picks'))).rows.length,0);
   await assert.rejects(as('anon','',c=>c.query('select * from public.app_journal_memorable_picks')),{code:'42501'});
   await assert.rejects(as('service_role','',c=>c.query('select * from public.app_journal_memorable_picks')),{code:'42501'});
  });

  await t.test('operator feature removed: owner reads nothing and cannot insert; restored: rows back',async()=>{
   const saved=(await pool.query('select feature from public.app_operator_features where workspace_id=$1',[WS_A])).rows.map(r=>r.feature);
   await pool.query("delete from public.app_operator_features where workspace_id=$1 and feature in ('calls','telegram')",[WS_A]);
   assert.equal((await as('authenticated',OWNER,c=>c.query('select * from public.app_journal_memorable_picks'))).rows.length,0);
   for(const f of saved.filter(f=>f==='calls'||f==='telegram'))await pool.query('insert into public.app_operator_features(workspace_id,feature) values($1,$2)',[WS_A,f]);
   assert.equal((await as('authenticated',OWNER,c=>c.query('select * from public.app_journal_memorable_picks'))).rows.length,2);
  });

  await t.test('deleting the news line removes its pick; rollback drops the table and record only; re-apply works',async()=>{
   await pool.query('delete from public.app_journal_memorable where id=$1',[M2]);
   assert.equal((await pool.query('select count(*)::int n from public.app_journal_memorable_picks')).rows[0].n,1);
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.equal((await pool.query("select to_regclass('public.app_journal_memorable_picks') is null as gone")).rows[0].gone,true);
   assert.equal((await pool.query('select count(*)::int n from public.app_journal_memorable')).rows[0].n,2,'news lines stay');
   const again=await run('apply','9974');assert.equal(again.ok,true,again.summary);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
