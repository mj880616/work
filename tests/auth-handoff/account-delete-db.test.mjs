// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic (made-up names).
// S69 STORE-계정삭제(20261124130000_account_delete): 로그인한 본인만, 자기 작업공간 하나만 지운다.
// 지키는 것: 적용만으로는 아무 줄도 안 지워짐, 비로그인·anon·위임 열쇠 거절, 확인 글자 틀리면 거절, 운영자·owner 둘·관리자(남 있음) 거절,
// 미리 보기는 끝까지 해 보고 되돌림, 지우면 내 작업공간 모든 표(휴지통 행 포함, cascade 아닌 표 포함)·내 user 표 0줄,
// 남의 작업공간·남의 묶음 줄은 그대로(내가 남의 프로젝트 멤버였던 옛 줄도 그대로), 파일 경로는 내 페이지·일정 아래 것만,
// 실행 표 직접 접근 0·남는 줄 0, 남는 표가 생기면 확인 SQL이 잡음, 되돌리기 뒤 카탈로그 원래대로.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,PROJECT_B} from './basket4-fixture.mjs';
import {prerequisites,accountFixture,countsSQL,USER_C,USER_D,USER_E,USER_F,PAGE_A,MEDIA_A,EVENT_A,GROUP_ALONE,GROUP_SHARED,GROUP_F} from './account-delete-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261124130000',name='account_delete',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

test('account delete db: plan, dry-run, apply, refusals, check, own workspace only, files, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'account-delete-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  // 앞 단계 묶음 표·함수는 저장소 migration 원문 그대로(운영에 적용된 대로).
  await pool.query(await read('supabase/migrations/20261118110000_collab_groups.sql'));
  await pool.query(accountFixture);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,sql,params=[],claims=null){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)",[sub||'',JSON.stringify(claims||(sub?{sub}:{}))]);await c.query('set local role '+role);const r=await c.query(sql,params);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const check=(sub,claims)=>as('authenticated',sub,'select public.app_account_delete_check() as r',[],claims).then(r=>r[0].r);
  const del=(sub,confirm='삭제',claims)=>as('authenticated',sub,'select public.app_account_delete($1) as r',[confirm],claims).then(r=>r[0].r);
  const refuse=async(p,msg)=>{await assert.rejects(p,e=>{assert.equal(e.message,msg);return true;});};
  const counts=async(ws,user)=>Object.fromEntries((await pool.query(countsSQL(ws,user))).rows.map(r=>[r.k,r.n]));
  const yes=rows=>{for(const r of rows){const v=r.value??r.ok;if(/^(예|아니오)$/.test(v))assert.equal(v,'예',r.item);}};
  const item=(rows,k)=>rows.find(r=>r.item===k)?.[('value' in rows[0])?'value':'ok'];
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules, three definer functions, only authenticated grants, no id inputs, summary 3 lines',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');
   assert.deepEqual([...plan.functions].sort(),['private.app_account_delete_run','public.app_account_delete','public.app_account_delete_check']);
   assert.equal(plan.review.policies,0);assert.equal(plan.review.triggers,1);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
  });

  await t.test('precheck yes and zero leftovers, dry-run changes nothing, apply passes postcheck and deletes nothing, second apply refused',async()=>{
   yes(beforeCheck);
   assert.equal(item(beforeCheck,'tables left behind'),'0');
   assert.equal(item(beforeCheck,'links that keep rows'),'0');
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9982');assert.equal(apply.ok,true,apply.summary);
   const post=await readOnly(postcheck);yes(post);
   for(const k of ['workspace rows','member rows','existing boundary hash','left table names','link names','restrict links inside'])
    assert.equal(item(post,k),item(beforeCheck,k),k);
   assert.equal((await run('apply','9983')).ok,false);
  });

  const A0=await counts(WS_A,OWNER),B0=await counts(WS_B,STRANGER);
  await t.test('no login, anon, delegated key, wrong confirm word: refused and nothing changes',async()=>{
   await refuse(check(''),'ACCOUNT_AUTH_REQUIRED');
   await refuse(del(''),'ACCOUNT_AUTH_REQUIRED');
   await assert.rejects(as('anon','','select public.app_account_delete_check()'),/permission denied/);
   await assert.rejects(as('anon','',"select public.app_account_delete('삭제')"),/permission denied/);
   await refuse(del(OWNER,'지우기'),'ACCOUNT_CONFIRM_MISMATCH');
   await refuse(del(OWNER,null),'ACCOUNT_CONFIRM_MISMATCH');
   const delegated={sub:OWNER,role:'authenticated',client_id:'synthetic-outside-app'};
   assert.deepEqual(await check(OWNER,delegated),{ok:false,code:'ACCOUNT_DELEGATED_REFUSED'});
   await refuse(del(OWNER,'삭제',delegated),'ACCOUNT_DELEGATED_REFUSED');
   assert.deepEqual(await counts(WS_A,OWNER),A0);
  });

  await t.test('operator, two owners in one workspace, admin of a group with others: refused with a reason code',async()=>{
   assert.deepEqual(await check(USER_C),{ok:false,code:'ACCOUNT_OPERATOR_KEEP'});
   await refuse(del(USER_C),'ACCOUNT_OPERATOR_KEEP');
   assert.deepEqual(await check(USER_D),{ok:false,code:'ACCOUNT_WORKSPACE_SHARED'});
   assert.deepEqual(await check(USER_E),{ok:false,code:'ACCOUNT_WORKSPACE_SHARED'});
   await refuse(del(USER_D),'ACCOUNT_WORKSPACE_SHARED');
   assert.deepEqual(await check(USER_F),{ok:false,code:'ACCOUNT_GROUP_ADMIN_MOVE'});
   await refuse(del(USER_F),'ACCOUNT_GROUP_ADMIN_MOVE');
   assert.equal((await pool.query('select count(*)::int n from public.app_collab_members where group_id=$1',[GROUP_F])).rows[0].n,2);
  });

  await t.test('check runs the whole delete and undoes it; run table closed to API roles',async()=>{
   assert.deepEqual(await check(OWNER),{ok:true});
   assert.deepEqual(await counts(WS_A,OWNER),A0);
   for(const role of ['authenticated','anon'])await assert.rejects(as(role,OWNER,'select count(*) from public.app_account_delete_runs'),/permission denied/);
   await assert.rejects(as('authenticated',OWNER,'insert into public.app_account_delete_runs(probe) values (false)'),/permission denied/);
   const [{n}]=(await pool.query('select count(*)::int n from public.app_account_delete_runs')).rows;assert.equal(n,0);
  });

  await t.test('delete: my workspace and my user rows gone (trash rows too), stranger untouched, file paths only under my pages and events',async()=>{
   const r=await del(OWNER);
   assert.equal(r.ok,true);
   assert.deepEqual(r.files,[
    {b:'share-page-media',p:`${PAGE_A}/${MEDIA_A}.jpg`},
    {b:'team-event-media',p:`${EVENT_A}/p1-thumb.jpg`},
    {b:'team-event-media',p:`${EVENT_A}/p1.jpg`},
   ]);
   const A1=await counts(WS_A,OWNER);
   for(const [k,v] of Object.entries(A1))assert.equal(v,0,k);
   assert.ok(Object.values(A0).every(v=>v>=0)&&A0.notes===2&&A0.spaces===2,'fixture had rows to delete');
   assert.deepEqual(await counts(WS_B,STRANGER),B0);
   const q=async sql=>(await pool.query(sql)).rows[0];
   // 남의 프로젝트에 남아 있던 내 옛 멤버 줄은 남의 기록이라 그대로, 내 프로젝트의 남 멤버 줄은 내 프로젝트와 함께 사라짐.
   assert.deepEqual(await q(`select (select count(*)::int from public.app_space_members where project_id='${PROJECT_B}' and user_id='${OWNER}') b, (select count(*)::int from public.app_space_members where project_id='${PROJECT_A}') a`),{b:1,a:0});
   // 묶음: 혼자인 묶음은 사라지고, 남의 묶음은 내 줄만 빠지고 '나감' 한 줄, 관리자·남의 멤버 그대로. 내 들어오기 요청·시도 기록 사라짐.
   assert.deepEqual(await q(`select (select count(*)::int from public.app_collab_groups where id='${GROUP_ALONE}') alone,
     (select string_agg(event,',' order by at) from public.app_collab_member_log where group_id='${GROUP_SHARED}' and user_id='${OWNER}') log,
     (select member_role from public.app_collab_members where group_id='${GROUP_SHARED}' and user_id='${STRANGER}') admin,
     (select count(*)::int from public.app_collab_members where group_id='${GROUP_F}') f`),{alone:0,log:'join,leave',admin:'admin',f:2});
   assert.deepEqual(await q('select (select count(*)::int from public.app_account_delete_runs) runs'),{runs:0});
   // 다른 사람은 그대로 쓸 수 있다.
   assert.deepEqual(await check(STRANGER),{ok:true});
  });

  await t.test('after delete: no workspace, so check and delete say so (login itself stays)',async()=>{
   assert.deepEqual(await check(OWNER),{ok:false,code:'ACCOUNT_WORKSPACE_REQUIRED'});
   await refuse(del(OWNER),'ACCOUNT_WORKSPACE_REQUIRED');
   assert.equal((await pool.query('select count(*)::int n from auth.users')).rows[0].n,0); // 시험 Auth 표는 손대지 않는다(원래 0)
  });

  await t.test('safety net: a new table with a workspace column outside the list shows up in the checks',async()=>{
   await pool.query('create table public.app_zz_new_records(workspace_id uuid, body text)');
   const post=await readOnly(postcheck);
   assert.equal(item(post,'tables left behind'),'1');
   assert.equal(item(post,'left table names'),'app_zz_new_records');
   await pool.query('drop table public.app_zz_new_records');
  });

  await t.test('rollback removes only the new objects and restores the catalog snapshot',async()=>{
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await assert.rejects(check(STRANGER),/function public\.app_account_delete_check\(\) does not exist/);
   yes(await readOnly(precheck));
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
