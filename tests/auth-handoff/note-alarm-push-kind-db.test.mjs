// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic(가상 이름).
// S69-97 NOTE-알림 DB(20261125130000_note_alarm_push_kind): 폰 알림 종류 'note'를 알림 기록·알림 설정 검사에 더한다 — 승인형 DB workflow 실행기로.
// 앞 판 20261115234500_signup_notify까지 저장소 파일 그대로 적용한다(앞 단계 준비는 signup-notify-db.test.mjs와 같다).
// - 규칙 통과(full 흐름), 시험 적용은 아무것도 안 바꿈, 적용 뒤 사후 확인 모두 예, 두 번째 적용 거절.
// - note 기록·설정 kinds.note 참/거짓 저장 됨, 모르는 종류·키·참거짓 아닌 값은 그대로 거절, 앞 판 종류(family·signup) 그대로.
// - 되돌리기는 note 줄이나 설정이 있으면 멈추고, 지우면 snapshot과 같아진다(signup 판 정의로).
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
const version='20261125130000',name='note_alarm_push_kind',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  alter table auth.users add column email text, add column raw_user_meta_data jsonb, add column last_sign_in_at timestamptz;
  insert into auth.users(id,raw_user_meta_data) values ('${OWNER}','{"full_name":"가상 운영자"}'),('${STRANGER}','{"name":"가상 사람A"}');
  alter table public.app_workspace_members add column created_at timestamptz not null default now();
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
  insert into public.app_profiles(user_id,display_name) values ('${OWNER}','가상 별명'),('${STRANGER}',null);`;
const BEFORE=['20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261025200000_call_personal_box',
 '20261025210000_feed_item_archive','20261026120000_call_user_edit','20261026190000_tg_sender_names','20261027010000_tg_room_day_group',
 '20261027030000_tg_sender_names_read','20261027200000_tg_summary_edit','20261028030000_tg_room_day_context','20261029090000_operator_features'];

test('note alarm push kind db: plan, dry-run, apply, note accepted, unknown kind refused, rollback guarded',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'note-alarm-push-kind-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-24','2026-10-24T03:00:00Z','가상 통화','가상 요약','call:na1')",[WS_A]);
  await pool.query(await read('supabase/migrations/'+BEFORE.at(-1)+'.sql'));
  for(const f of ['20261031120000_gdrive_photo_index','20261102160000_cloud_files_index','20261101010000_phone_push','20261101210000_push_log_notices'])await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query("insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261105100000','family_notes',array['synthetic prerequisite record'])");
  await pool.query(await read('supabase/migrations/20261105120000_family_push_kind.sql'));
  await pool.query(await read('supabase/migrations/20261103100000_dev_inbox_feature.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const guardFails=async pattern=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),pattern);await c.query('rollback');}finally{c.release();}};
  const addLog=(c,kind,ref)=>c.query("insert into public.app_push_log(workspace_id,kind,ref_key,day,status) values ($1,$2,$3,'2026-11-25','sent')",[WS_A,kind,ref]);
  const setPrefs=(c,prefs)=>c.query('update public.app_profiles set notify_prefs=$1::jsonb where user_id=$2',[JSON.stringify(prefs),OWNER]);

  await t.test('guard: stops without changes until signup_notify is applied',async()=>{
   await guardFails(/NOTE_ALARM_PUSH_KIND_PREREQUISITE_CHANGED/);
   await pool.query(await read('supabase/migrations/20261115234500_signup_notify.sql'));
  });
  await server(c=>addLog(c,'family','fam:1'));
  await server(c=>addLog(c,'signup','su:1'));
  await owner(c=>setPrefs(c,{kinds:{family:false,signup:true},quiet:{from:'23:00',to:'06:30'}}));
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules, full flow, no grant/policy/definer, three-line summary, expect lines',()=>{
   for(const mode of ['apply','dry-run']){const plan=prepareMigration({mode,version,runId:'1',root});assert.equal(plan.flow,'full');assert.deepEqual(plan.review.definer,[]);}
   const code=migration.replace(/--.*$/gm,'').replace(/insert into supabase_migrations\.schema_migrations[\s\S]*?\]\);/,'');
   assert.doesNotMatch(code,/\bgrant\b|\brevoke\b|create policy|drop policy|security definer|create (or replace )?function|disable row level security|rtw_|\bto (anon|public)\b/i);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   for(const sql of [precheck,postcheck])for(const r of (sql.match(/^-- expect: .*$/gm)||[]))assert.match(r,/^-- expect: .+ = (예|기록)$/);
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
   assert.doesNotMatch(migration+rollbackSQL+summary+precheck+postcheck+snapshot,/[A-Za-z0-9._-]+@[A-Za-z0-9-]+\.[A-Za-z]/,'no mail address');
  });
  await t.test('precheck all yes; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9972');assert.equal(apply.ok,true,apply.summary);
   const after=values(await readOnly(postcheck)),pre=values(beforeCheck);
   for(const [item,value] of Object.entries(after)){if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);else assert.equal(value,pre[item],item);}
   assert.equal((await run('apply','9973')).ok,false);
  });
  await t.test('note accepted in log and prefs; earlier kinds kept; unknown kinds and keys refused; grants unchanged',async()=>{
   await server(c=>addLog(c,'note','note:1795000000'));
   for(const k of ['task_due','commitment','meeting_done','collect_stall','morning','evening','next_week','quiet_digest','test','family','signup'])await server(c=>addLog(c,k,'keep:'+k));
   await assert.rejects(server(c=>addLog(c,'notes','x1')),{code:'23514'});
   await assert.rejects(server(c=>addLog(c,'Note','x2')),{code:'23514'});
   await owner(c=>setPrefs(c,{kinds:{note:true,signup:false,family:false},quiet:{from:'23:00',to:'06:30'}}));
   assert.equal((await pool.query("select notify_prefs->'kinds'->>'note' v from public.app_profiles where user_id=$1",[OWNER])).rows[0].v,'true');
   await owner(c=>setPrefs(c,{kinds:{note:false}}));
   await assert.rejects(owner(c=>setPrefs(c,{kinds:{note:'no'}})),{code:'23514'});
   await assert.rejects(owner(c=>setPrefs(c,{kinds:{note_alarm:true}})),{code:'23514'});
   await assert.rejects(owner(c=>setPrefs(c,{kinds:{unknown:true}})),{code:'23514'});
   await assert.rejects(owner(c=>setPrefs(c,{note:true})),{code:'23514'});
   await assert.rejects(owner(c=>addLog(c,'note','note:2')),{code:'42501'});
   await assert.rejects(anon(c=>c.query('select 1 from public.app_push_log')),{code:'42501'});
   assert.equal((await pool.query("select count(*)::int n from public.app_push_log where kind in ('family','signup')")).rows[0].n,4);
  });
  await t.test('rollback: refused while note rows or prefs exist; after clearing returns to the snapshot',async()=>{
   const blocked=async()=>{const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/NOTE_ALARM_PUSH_KIND_ROLLBACK_BLOCKED: note rows exist/);await c.query('rollback');}finally{c.release();}};
   await blocked();
   await pool.query("delete from public.app_push_log where kind='note'");
   await blocked(); // 설정의 kinds.note가 남아 있으면 여전히 멈춘다.
   await pool.query("delete from public.app_push_log where ref_key like 'keep:%'");
   await pool.query("update public.app_profiles set notify_prefs='{\"kinds\":{\"family\":false,\"signup\":true},\"quiet\":{\"from\":\"23:00\",\"to\":\"06:30\"}}'::jsonb where user_id=$1",[OWNER]);
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(precheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   await assert.rejects(server(c=>addLog(c,'note','note:3')),{code:'23514'});
   await server(c=>addLog(c,'signup','su:2'));
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
