// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic(가상 이름·가상 메일).
// S62-29 OPS-가입자현황 PR①(20261116003000_signup_status): 운영자 가입자 목록 함수 넓히기 — 승인형 DB workflow 실행기로.
// - 규칙 통과(full 흐름), 시험 적용은 아무것도 안 바꿈, 적용 뒤 사후 확인 모두 예, 두 번째 적용 거절.
// - 운영자(dev_inbox owner)만: 어제와 같은 배열(새 가입부터)에 칸 일곱(조직·부서·이름·직책·이메일·가입일·마지막 사용)만 받는다.
//   배열 모양 유지 — 배포된 phone-push 알림 줄(name·signed_up_at)과 지금 화면이 그대로 읽는다. 숫자 셋은 화면이 센다(app/signups-model).
// - 거절: 운영자 아닌 계정·비로그인·service_role, 허용 행이 없어진 운영자. 도우미 함수는 누구도 직접 못 부름.
// - 원칙("운영자는 누가 가입했는지만 보고, 기록한 내용은 보지 않습니다"): 목록에 기록 내용·id가 없고, 운영자도 다른 작업공간 기록을 읽지 못한다.
// - 되돌리기: 함수가 어제 모양(배열)으로 돌아가고 snapshot과 같아진다.
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
const version='20261116003000',name='signup_status',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const NEWBIE='20000000-0000-4000-8000-000000000003',WS_C='21000000-0000-4000-8000-000000000003';
const RTW_ONLY='20000000-0000-4000-8000-000000000004';
const SECRET_NOTE='가상 비밀 노트 내용';
// 시각은 시험이 도는 때 기준(이번 주·최근 7일 판정이 날짜에 흔들리지 않게).
const prerequisites=`
  alter table auth.users add column email text, add column raw_user_meta_data jsonb, add column last_sign_in_at timestamptz;
  insert into auth.users(id,email,raw_user_meta_data,last_sign_in_at) values
    ('${OWNER}','owner@example.test','{"full_name":"가상 운영자"}',now()-interval '20 days'),
    ('${STRANGER}','stranger@example.test','{"name":"가상 사람A"}',now()-interval '2 days'),
    ('${NEWBIE}','newbie@example.test','{}',null),
    ('${RTW_ONLY}','rtw@example.test','{"full_name":"가상 읽생기"}',now());
  create table auth.sessions(id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz, updated_at timestamptz, ip inet, user_agent text);
  insert into auth.sessions(user_id,created_at,updated_at,ip,user_agent) values
    ('${OWNER}',now()-interval '20 days',now()-interval '1 hour','192.0.2.10','가상 기기'),
    ('${OWNER}',now()-interval '40 days',now()-interval '39 days',null,null),
    ('${STRANGER}',now()-interval '30 days',now()-interval '29 days',null,null);
  alter table public.app_workspace_members add column created_at timestamptz not null default now();
  update public.app_workspace_members set created_at=now()-interval '60 days' where user_id='${OWNER}';
  update public.app_workspace_members set created_at=now()-interval '30 days' where user_id='${STRANGER}';
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
  create table public.app_profiles(user_id uuid primary key,display_name text,job_title text,union_name text,department_name text,
    created_at timestamptz default now(),updated_at timestamptz default now());
  alter table public.app_profiles enable row level security;
  create policy task12a_owner_all on public.app_profiles for all to authenticated
    using (private.app_is_owner_profile(user_id)) with check (private.app_is_owner_profile(user_id));
  create policy task12a_profile_self_select on public.app_profiles for select to authenticated using (user_id = (select auth.uid()));
  revoke all on public.app_profiles from public, anon, authenticated;
  grant select, update on public.app_profiles to authenticated;
  insert into public.app_profiles(user_id,display_name,job_title,union_name,department_name) values
    ('${OWNER}','운영자 별명','가상 직책','가상 노조','가상 부서'),('${STRANGER}',null,'  ',null,'가상 부서B');`;
const BEFORE=['20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261025200000_call_personal_box',
 '20261025210000_feed_item_archive','20261026120000_call_user_edit','20261026190000_tg_sender_names','20261027010000_tg_room_day_group',
 '20261027030000_tg_sender_names_read','20261027200000_tg_summary_edit','20261028030000_tg_room_day_context','20261029090000_operator_features'];

test('signup status db: plan, dry-run, apply, operator-only seven fields, no record content, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'signup-status-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  // 다른 작업공간(WS_B, 가상 사람A)의 기록 — 운영자도 읽지 못해야 한다.
  await pool.query("insert into public.app_documents(id,workspace_id,extracted_text) values('31000000-0000-4000-8000-000000000001',$1,$2)",[WS_B,SECRET_NOTE]);
  await pool.query("update public.app_workspaces set slug='kptu-work' where id=$1",[WS_A]);
  await pool.query("update public.app_workspaces set slug='other-work' where id=$1",[WS_B]);
  for(const f of BEFORE.slice(0,-1))await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-24','2026-10-24T03:00:00Z','가상 통화','가상 요약','call:ss1')",[WS_A]);
  await pool.query(await read('supabase/migrations/'+BEFORE.at(-1)+'.sql'));
  for(const f of ['20261031120000_gdrive_photo_index','20261102160000_cloud_files_index','20261101010000_phone_push','20261101210000_push_log_notices'])await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query("insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261105100000','family_notes',array['synthetic prerequisite record'])");
  for(const f of ['20261105120000_family_push_kind','20261103100000_dev_inbox_feature'])await pool.query(await read('supabase/migrations/'+f+'.sql'));
  // 새 가입(가상): 이번 주 가입, 로그인 기록 없음.
  await pool.query("insert into public.app_workspaces(id) values($1)",[WS_C]);
  await pool.query("insert into public.app_workspace_members(workspace_id,user_id,role,created_at) values($1,$2,'owner',now())",[WS_C,NEWBIE]);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const guardFails=async pattern=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),pattern);await c.query('rollback');}finally{c.release();}};
  const list=async()=>(await owner(c=>c.query('select public.app_signup_list() v'))).rows[0].v;

  await t.test('guard: stops without changes until signup_notify and profile_union_department are applied',async()=>{
   await guardFails(/SIGNUP_STATUS_PREREQUISITE_CHANGED/);
   await pool.query(await read('supabase/migrations/20261115234500_signup_notify.sql'));
   await guardFails(/SIGNUP_STATUS_PREREQUISITE_CHANGED/);
   await pool.query("insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261115223000','profile_union_department',array['synthetic prerequisite record'])");
  });
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const oldList=await list();

  await t.test('files: expanded rules, full flow, summary 3 lines, expect lines, snapshot reads catalogs only, no anon/public grant, no mail address',()=>{
   for(const mode of ['apply','dry-run']){const plan=prepareMigration({mode,version,runId:'1',root});assert.equal(plan.flow,'full');}
   const code=migration.replace(/--.*$/gm,'').replace(/insert into supabase_migrations\.schema_migrations[\s\S]*?\]\);/,'');
   assert.doesNotMatch(code,/create policy|drop policy|disable row level security|rtw_|grant [^;]* to (anon|public|service_role)\b|on table|grant (select|insert|update|delete)|create table|alter table/i);
   assert.doesNotMatch(code,/\bip\b|user_agent|app_documents|app_notes|app_events|app_tasks|app_pages|app_feed|app_ai/i,'no device info, no record tables');
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   for(const sql of [precheck,postcheck])for(const r of (sql.match(/^-- expect: .*$/gm)||[]))assert.match(r,/^-- expect: .+ = (예|기록|1)$/);
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
   assert.doesNotMatch(migration+rollbackSQL+summary+precheck+postcheck+snapshot,/[A-Za-z0-9._-]+@[A-Za-z0-9-]+\.[A-Za-z]/,'no mail address');
  });
  await t.test('precheck all yes; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   assert.ok(Array.isArray(oldList),'before: yesterday shape (array)');
   for(const p of oldList)assert.deepEqual(Object.keys(p).sort(),['last_seen_at','name','signed_up_at']);
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(await list(),oldList,'dry-run keeps the old function');
   const apply=await run('apply','9972');assert.equal(apply.ok,true,apply.summary);
   const after=values(await readOnly(postcheck)),pre=values(beforeCheck);
   for(const [item,value] of Object.entries(after)){if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);else assert.equal(value,pre[item],item);}
   assert.equal((await run('apply','9973')).ok,false);
  });
  await t.test('list: operator gets the same array shape with exactly seven fields per person, newest first, RTW-only users absent',async()=>{
   const r=await list();
   assert.ok(Array.isArray(r),'array kept for phone-push notice line and the current screen');
   assert.deepEqual(r.map(p=>p.name),['이름 없음','가상 사람A','가상 운영자']);
   for(const p of r)assert.deepEqual(Object.keys(p).sort(),['department_name','email','job_title','last_seen_at','name','signed_up_at','union_name']);
   const [newbie,a,op]=r;
   assert.deepEqual({u:op.union_name,d:op.department_name,j:op.job_title,e:op.email},{u:'가상 노조',d:'가상 부서',j:'가상 직책',e:'owner@example.test'});
   assert.deepEqual({u:a.union_name,d:a.department_name,j:a.job_title,e:a.email},{u:null,d:'가상 부서B',j:null,e:'stranger@example.test'},'빈칸·공백만은 null');
   assert.deepEqual({u:newbie.union_name,d:newbie.department_name,j:newbie.job_title,last:newbie.last_seen_at},{u:null,d:null,j:null,last:null},'프로필·로그인 없음');
   // 마지막 사용 = 로그인과 세션 갱신 중 늦은 것: 운영자는 1시간 전 갱신(로그인은 20일 전), 사람A는 2일 전 로그인(세션은 29일 전).
   const age=v=>(Date.now()-Date.parse(v))/3600000;
   assert.ok(age(op.last_seen_at)>0.9&&age(op.last_seen_at)<1.2,'operator last used ~1h ago');
   assert.ok(age(a.last_seen_at)>47&&age(a.last_seen_at)<49,'person A last used ~2 days ago');
   assert.ok(age(newbie.signed_up_at)<1,'new signup this week');
  });
  await t.test('no record content: no ids, no device info, no notes; operator still cannot read another workspace record',async()=>{
   const text=JSON.stringify(await list());
   assert.doesNotMatch(text,/2[013]000000-|kptu-work|other-work|192\.0\.2|가상 기기/);
   assert.ok(!text.includes(SECRET_NOTE));
   // 운영자(WS_A owner)는 다른 작업공간(WS_B) 기록을 표로 읽어도 0줄(RLS 그대로).
   assert.equal((await owner(c=>c.query('select count(*)::int n from public.app_documents'))).rows[0].n,0);
   assert.equal((await owner(c=>c.query('select count(*)::int n from public.app_documents where workspace_id=$1',[WS_B]))).rows[0].n,0);
   // 다른 사람 프로필 행도 표로는 못 읽는다(목록 함수가 정한 칸만).
   assert.equal((await owner(c=>c.query('select count(*)::int n from public.app_profiles where user_id=$1',[STRANGER]))).rows[0].n,0);
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_documents'))).rows[0].n,1,'본인은 자기 기록을 읽는다');
  });
  await t.test('refused: non-operator, anonymous, service_role, operator without allow row; helper closed',async()=>{
   for(const fn of [stranger,anon,server])await assert.rejects(fn(c=>c.query('select public.app_signup_list()')),{code:'42501'});
   for(const fn of [owner,stranger,anon,server])await assert.rejects(fn(c=>c.query('select * from private.app_signup_people()')),{code:'42501'});
   await assert.rejects(stranger(c=>c.query('select public.app_signup_since(now())')),{code:'42501'});
   await pool.query("delete from public.app_operator_features where feature='dev_inbox'");
   await assert.rejects(owner(c=>c.query('select public.app_signup_list()')),{code:'42501'});
   await pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'dev_inbox')",[WS_A]);
   // 허용 행을 되돌리면 운영자는 다시 받는다.
   assert.equal((await list()).length,3);
  });
  await t.test('rollback: back to yesterday fields and the snapshot',async()=>{
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(await list(),oldList);
   for(const r of await readOnly(precheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
