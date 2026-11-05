// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S50-12 FAMILY-잊지말기 4단계 DB(20261105120000_family_push_kind): 폰 알림 종류 'family'를 알림 기록·알림 설정 검사에 더한다 — 승인형 DB workflow 실행기로.
// 앞 단계 20261101010000_phone_push·20261101210000_push_log_notices는 저장소 파일 그대로 적용하고, 20261105100000_family_notes는 기록 1행만 둔다(이 변경은 그 표를 쓰지 않음).
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
const version='20261105120000',name='family_push_kind',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Production-like prerequisites: app_profiles with task12a owner RLS, authenticated SELECT/UPDATE only, anon revoked.
const prerequisites=`
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;
  create function private.app_is_owner_profile(p_user uuid)
  returns boolean language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select exists (
      select 1
      from public.app_workspace_members subject
      join public.app_workspace_members owner
        on owner.workspace_id = subject.workspace_id
       and owner.role = 'owner'
       and owner.user_id = (select auth.uid())
      where subject.user_id = p_user
    )
  $$;
  revoke all on function private.app_is_owner_profile(uuid) from public, anon, authenticated;
  grant execute on function private.app_is_owner_profile(uuid) to authenticated, service_role;
  create table public.app_profiles(user_id uuid primary key,display_name text,created_at timestamptz default now(),updated_at timestamptz default now());
  alter table public.app_profiles enable row level security;
  create policy task12a_owner_all on public.app_profiles for all to authenticated
    using (private.app_is_owner_profile(user_id)) with check (private.app_is_owner_profile(user_id));
  create policy task12a_profile_self_select on public.app_profiles for select to authenticated
    using (user_id = (select auth.uid()));
  revoke all on public.app_profiles from public, anon, authenticated;
  grant select, update on public.app_profiles to authenticated;
  insert into public.app_profiles(user_id,display_name) values ('${OWNER}','소유자'),('${STRANGER}','남');`;

test('family push kind db: plan, dry-run, apply, family accepted, unknown kind refused, rollback guarded',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'family-push-kind-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query(await read('supabase/migrations/20261101010000_phone_push.sql'));
  await pool.query(await read('supabase/migrations/20261101210000_push_log_notices.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const addLog=(c,kind,ref)=>c.query("insert into public.app_push_log(workspace_id,kind,ref_key,day,status) values ($1,$2,$3,'2026-11-05','sent')",[WS_A,kind,ref]);
  const setPrefs=(c,prefs)=>c.query('update public.app_profiles set notify_prefs=$1::jsonb where user_id=$2',[JSON.stringify(prefs),OWNER]);
  const guardFails=async(pattern)=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),pattern);await c.query('rollback');}finally{c.release();}};

  await t.test('guard: stops without changes until the family notes step is recorded',async()=>{
   await guardFails(/FAMILY_PUSH_KIND_PREREQUISITE_CHANGED/);
   await pool.query("insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261105100000','family_notes',array['synthetic prerequisite record'])");
  });
  await server(c=>addLog(c,'test','t1'));
  await owner(c=>setPrefs(c,{kinds:{task_due:false},quiet:{from:'23:00',to:'06:30'}}));
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));

  await t.test('files: expanded rules, full flow, no grant/policy/definer, three-line summary, expect lines',()=>{
   for(const mode of ['apply','dry-run']){const plan=prepareMigration({mode,version,runId:'1',root});assert.equal(plan.flow,'full');assert.deepEqual(plan.review.definer,[]);}
   const code=migration.replace(/--.*$/gm,'').replace(/insert into supabase_migrations\.schema_migrations[\s\S]*?\]\);/,''); // 기록 1행의 설명 글은 빼고 본다
   assert.doesNotMatch(code,/\bgrant\b|\brevoke\b|create policy|drop policy|security definer|disable row level security|rtw_|\bto (anon|public)\b/i);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   for(const sql of [precheck,postcheck])for(const r of (sql.match(/^-- expect: .*$/gm)||[]))assert.match(r,/^-- expect: .+ = (예|기록)$/);
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
  });
  await t.test('precheck all yes; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const dry=await run('dry-run','9951');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9952');assert.equal(apply.ok,true,apply.summary);
   const after=values(await readOnly(postcheck)),pre=values(beforeCheck);
   for(const [item,value] of Object.entries(after)){if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);else assert.equal(value,pre[item],item);}
   assert.equal((await run('apply','9953')).ok,false);
  });
  await t.test('family is accepted in log and prefs; unknown kinds still refused; old rows and prefs kept; grants unchanged',async()=>{
   await server(c=>addLog(c,'family','fam:1730790000'));
   await assert.rejects(server(c=>addLog(c,'feelings','x1')),{code:'23514'});
   await owner(c=>setPrefs(c,{kinds:{family:false,task_due:false},quiet:{from:'23:00',to:'06:30'}}));
   await assert.rejects(owner(c=>setPrefs(c,{kinds:{family:'no'}})),{code:'23514'});
   await assert.rejects(owner(c=>setPrefs(c,{kinds:{unknown:true}})),{code:'23514'});
   await assert.rejects(owner(c=>addLog(c,'family','fam:2')),{code:'42501'});
   await assert.rejects(anon(c=>c.query('select 1 from public.app_push_log')),{code:'42501'});
   assert.equal((await pool.query("select count(*)::int n from public.app_push_log where kind='test'")).rows[0].n,1);
  });
  await t.test('rollback: refused while family rows exist; after clearing returns to the snapshot',async()=>{
   {const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/FAMILY_PUSH_KIND_ROLLBACK_BLOCKED: family rows exist/);await c.query('rollback');}finally{c.release();}}
   await pool.query("delete from public.app_push_log where kind='family'");
   await pool.query("update public.app_profiles set notify_prefs=notify_prefs #- '{kinds,family}' where user_id=$1",[OWNER]);
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(precheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
