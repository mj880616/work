// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic(가상 이름).
// S62-25 OPS-새가입알림 PR①(20261115234500_signup_notify): 알림 종류 'signup'·운영자 가입자 목록·폰 알림 서버 전용 새 가입 세기 — 승인형 DB workflow 실행기로.
// - 규칙 통과(full 흐름), 시험 적용은 아무것도 안 바꿈, 적용 뒤 사후 확인 모두 예, 두 번째 적용 거절.
// - 가입자 목록은 운영자(dev_inbox owner)만 — 다른 이용자·비로그인·service_role 거절. 돌려주는 칸은 이름·가입 시각·마지막 접속뿐(메일·id 없음).
// - 새 가입 세기는 service_role만 — 이용자·비로그인 거절. 초 단위로 지난 가입을 다시 세지 않는다.
// - 알림 기록·설정 검사에 signup이 들어가고 모르는 종류는 그대로 거절. 되돌리기는 signup 줄이 있으면 멈추고, 지우면 snapshot과 같아진다.
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
const version='20261115234500',name='signup_notify',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const NEWBIE='20000000-0000-4000-8000-000000000003',WS_C='21000000-0000-4000-8000-000000000003';
const RTW_ONLY='20000000-0000-4000-8000-000000000004';
const prerequisites=`
  alter table auth.users add column email text, add column raw_user_meta_data jsonb, add column last_sign_in_at timestamptz;
  insert into auth.users(id,email,raw_user_meta_data,last_sign_in_at) values
    ('${OWNER}','owner@example.test','{"full_name":"가상 운영자"}','2026-11-15T01:00:00Z'),
    ('${STRANGER}','stranger@example.test','{"name":"가상 사람A"}','2026-11-15T02:00:00Z'),
    ('${NEWBIE}','newbie@example.test','{}',null),
    ('${RTW_ONLY}','rtw@example.test','{"full_name":"가상 읽생기"}',null);
  alter table public.app_workspace_members add column created_at timestamptz not null default now();
  update public.app_workspace_members set created_at='2026-10-01T00:00:00Z' where user_id='${OWNER}';
  update public.app_workspace_members set created_at='2026-11-14T10:00:00.400Z' where user_id='${STRANGER}';
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;
  create function private.app_is_owner_profile(p_user uuid)
  returns boolean language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select exists (select 1 from public.app_workspace_members subject
      join public.app_workspace_members owner on owner.workspace_id = subject.workspace_id and owner.role = 'owner' and owner.user_id = (select auth.uid())
      where subject.user_id = p_user)
  $$;
  revoke all on function private.app_is_owner_profile(uuid) from public, anon, authenticated;
  grant execute on function private.app_is_owner_profile(uuid) to authenticated, service_role;
  create table public.app_profiles(user_id uuid primary key,display_name text,created_at timestamptz default now(),updated_at timestamptz default now());
  alter table public.app_profiles enable row level security;
  create policy task12a_owner_all on public.app_profiles for all to authenticated
    using (private.app_is_owner_profile(user_id)) with check (private.app_is_owner_profile(user_id));
  create policy task12a_profile_self_select on public.app_profiles for select to authenticated using (user_id = (select auth.uid()));
  revoke all on public.app_profiles from public, anon, authenticated;
  grant select, update on public.app_profiles to authenticated;
  insert into public.app_profiles(user_id,display_name) values ('${OWNER}','운영자 별명'),('${STRANGER}',null);`;
const BEFORE=['20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261025200000_call_personal_box',
 '20261025210000_feed_item_archive','20261026120000_call_user_edit','20261026190000_tg_sender_names','20261027010000_tg_room_day_group',
 '20261027030000_tg_sender_names_read','20261027200000_tg_summary_edit','20261028030000_tg_room_day_context','20261029090000_operator_features'];

test('signup notify db: plan, dry-run, apply, operator-only list, server-only count, kind accepted, rollback guarded',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'signup-notify-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  for(const f of BEFORE.slice(0,-1))await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-24','2026-10-24T03:00:00Z','가상 통화','가상 요약','call:su1')",[WS_A]);
  await pool.query(await read('supabase/migrations/'+BEFORE.at(-1)+'.sql'));
  for(const f of ['20261031120000_gdrive_photo_index','20261102160000_cloud_files_index','20261101010000_phone_push','20261101210000_push_log_notices'])await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query("insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261105100000','family_notes',array['synthetic prerequisite record'])");
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const guardFails=async pattern=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),pattern);await c.query('rollback');}finally{c.release();}};
  const addLog=(c,kind,ref)=>c.query("insert into public.app_push_log(workspace_id,kind,ref_key,day,status) values ($1,$2,$3,'2026-11-15','sent')",[WS_A,kind,ref]);
  const setPrefs=(c,prefs)=>c.query('update public.app_profiles set notify_prefs=$1::jsonb where user_id=$2',[JSON.stringify(prefs),OWNER]);

  await t.test('guard: stops without changes until family_push_kind and dev_inbox are applied',async()=>{
   await guardFails(/SIGNUP_NOTIFY_PREREQUISITE_CHANGED/);
   await pool.query(await read('supabase/migrations/20261105120000_family_push_kind.sql'));
   await guardFails(/SIGNUP_NOTIFY_PREREQUISITE_CHANGED/);
   await pool.query(await read('supabase/migrations/20261103100000_dev_inbox_feature.sql'));
  });
  await server(c=>addLog(c,'family','fam:1'));
  await owner(c=>setPrefs(c,{kinds:{family:false},quiet:{from:'23:00',to:'06:30'}}));
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules, full flow, summary 3 lines, expect lines, snapshot reads catalogs only, no anon/public grant',()=>{
   for(const mode of ['apply','dry-run']){const plan=prepareMigration({mode,version,runId:'1',root});assert.equal(plan.flow,'full');}
   const code=migration.replace(/--.*$/gm,'').replace(/insert into supabase_migrations\.schema_migrations[\s\S]*?\]\);/,'');
   assert.doesNotMatch(code,/create policy|drop policy|disable row level security|rtw_|grant [^;]* to (anon|public)\b|on table|grant (select|insert|update|delete)/i);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   for(const sql of [precheck,postcheck])for(const r of (sql.match(/^-- expect: .*$/gm)||[]))assert.match(r,/^-- expect: .+ = (예|기록|1)$/);
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
   assert.doesNotMatch(migration+rollbackSQL+summary,/@|example\./,'no mail address');
  });
  await t.test('precheck all yes; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const dry=await run('dry-run','9961');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9962');assert.equal(apply.ok,true,apply.summary);
   const after=values(await readOnly(postcheck)),pre=values(beforeCheck);
   for(const [item,value] of Object.entries(after)){if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);else assert.equal(value,pre[item],item);}
   assert.equal((await run('apply','9963')).ok,false);
  });
  await t.test('signup kind accepted in log and prefs; unknown kinds refused; old rows kept',async()=>{
   await server(c=>addLog(c,'signup','su:1794700000'));
   await assert.rejects(server(c=>addLog(c,'feelings','x1')),{code:'23514'});
   await owner(c=>setPrefs(c,{kinds:{signup:false,family:false}}));
   await assert.rejects(owner(c=>setPrefs(c,{kinds:{signup:'no'}})),{code:'23514'});
   await assert.rejects(owner(c=>setPrefs(c,{kinds:{unknown:true}})),{code:'23514'});
   assert.equal((await pool.query("select count(*)::int n from public.app_push_log where kind='family'")).rows[0].n,1);
  });
  await t.test('list: operator only, names and times only, newest first, RTW-only users absent',async()=>{
   const list=(await owner(c=>c.query('select public.app_signup_list() v'))).rows[0].v;
   assert.deepEqual(list.map(r=>r.name),['가상 사람A','가상 운영자']);
   for(const r of list)assert.deepEqual(Object.keys(r).sort(),['last_seen_at','name','signed_up_at']);
   assert.doesNotMatch(JSON.stringify(list),/@|example|2[01]000000-/);
   for(const fn of [stranger,anon,server])await assert.rejects(fn(c=>c.query('select public.app_signup_list()')),{code:'42501'});
   for(const fn of [owner,stranger,anon,server])await assert.rejects(fn(c=>c.query('select * from private.app_signup_people()')),{code:'42501'});
   // 운영자 허용 행이 없으면 운영자도 거절(서버 허용 표로만 판정).
   await pool.query("delete from public.app_operator_features where feature='dev_inbox'");
   await assert.rejects(owner(c=>c.query('select public.app_signup_list()')),{code:'42501'});
   await pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'dev_inbox')",[WS_A]);
  });
  await t.test('since: service_role only, counts new signups once by second, no other columns',async()=>{
   for(const fn of [owner,stranger,anon])await assert.rejects(fn(c=>c.query("select public.app_signup_since('2026-11-01T00:00:00Z')")),{code:'42501'});
   await assert.rejects(server(c=>c.query('select public.app_signup_since(null)')),{code:'22023'});
   const since=async at=>(await server(c=>c.query('select public.app_signup_since($1) v',[at]))).rows[0].v;
   let r=await since('2026-11-01T00:00:00Z');
   assert.deepEqual(r,{count:1,names:['가상 사람A'],newest:Math.floor(Date.parse('2026-11-14T10:00:00Z')/1000)});
   // 열쇠(초)를 받은 뒤에는 같은 가입을 다시 세지 않는다(0.4초가 붙어 있어도).
   assert.deepEqual(await since(new Date(r.newest*1000).toISOString()),{count:0,names:[],newest:null});
   // 새 가입(가상): 작업공간 + owner 행. 구글 이름이 없으면 '이름 없음'.
   await pool.query("insert into public.app_workspaces(id) values($1)",[WS_C]);
   await pool.query("insert into public.app_workspace_members(workspace_id,user_id,role,created_at) values($1,$2,'owner','2026-11-15T12:00:00Z')",[WS_C,NEWBIE]);
   r=await since(new Date(Date.parse('2026-11-14T10:00:00Z')).toISOString());
   assert.deepEqual(r,{count:1,names:['이름 없음'],newest:Math.floor(Date.parse('2026-11-15T12:00:00Z')/1000)});
   r=await since('2026-11-01T00:00:00Z');assert.equal(r.count,2);assert.deepEqual(r.names,['이름 없음','가상 사람A']);
   await pool.query('update public.app_profiles set display_name=$2 where user_id=$1',[STRANGER,'프로필 이름']);
   await pool.query("insert into public.app_profiles(user_id,display_name) values($1,'가상 사람B')",[NEWBIE]);
   r=await since('2026-11-01T00:00:00Z');assert.deepEqual(r.names,['가상 사람B','가상 사람A'],'구글 이름이 먼저, 없으면 프로필 이름');
   assert.equal(WS_B.length,36);
  });
  await t.test('rollback: refused while signup rows exist; after clearing returns to the snapshot',async()=>{
   {const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/SIGNUP_NOTIFY_ROLLBACK_BLOCKED: signup rows exist/);await c.query('rollback');}finally{c.release();}}
   await pool.query("delete from public.app_push_log where kind='signup'");
   await pool.query("update public.app_profiles set notify_prefs='{\"kinds\":{\"family\":false},\"quiet\":{\"from\":\"23:00\",\"to\":\"06:30\"}}'::jsonb where user_id=$1",[OWNER]);
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(precheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
