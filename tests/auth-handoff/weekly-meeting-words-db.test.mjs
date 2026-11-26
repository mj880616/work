// Fresh local PostgreSQL only. No Supabase, Google or production credentials.
// WEEKLY-내부회의사람별: app_profiles.weekly_hidden_meeting_kinds 기본값 → 빈 목록, 운영자(calls 작업공간 owner) 한 행에만 '*단어*' 여섯을 더함.
// 운영자 아닌 행 중 옛 기본값 그대로인 행은 빈 목록으로(사용자 11/17 "비워"), 직접 바꾼 행·권한·정책은 그대로, 다른 계정은 남의 목록을 읽지도 쓰지도 못한다. 지어낸 계정만.
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
import {fixture,OWNER,STRANGER,WS_A} from './basket4-fixture.mjs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261117190000',name='weekly_meeting_words',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const OUTSIDER='20000000-0000-4000-8000-000000000003',CUSTOM='20000000-0000-4000-8000-000000000004';
const WORDS=['*상집*','*중집*','*집행위*','*집행국*','*상무집행*','*중앙집행*'];
const OLD=['궤도집행국회의','본부집행위'];
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Production-like prerequisites: task12a profile RLS + 20261022090000 column (applied from its own file) + operator allow table.
// OWNER = 운영자(WS_A에 calls 허용), STRANGER = 다른 작업공간 주인(옛 기본 목록), OUTSIDER = WS_A의 owner 아닌 구성원.
const prerequisites=`
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
  create table public.app_operator_features(workspace_id uuid not null references public.app_workspaces(id), feature text not null, primary key(workspace_id, feature));
  alter table public.app_operator_features enable row level security;
  revoke all on public.app_operator_features from public, anon, authenticated, service_role;
  insert into public.app_operator_features values ('${WS_A}', 'calls');
  insert into public.app_workspace_members values ('${WS_A}', '${OUTSIDER}', 'viewer');
  insert into public.app_profiles(user_id,display_name) values ('${OWNER}','운영자'),('${STRANGER}','남'),('${OUTSIDER}','다른 구성원');
  insert into supabase_migrations.schema_migrations(version,name) values('20261018112943','doc_categories_profile');
`;

test('weekly meeting words: dry-run, apply, operator row only, new rows empty, guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'weekly-meeting-words-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(prerequisites);
  await pool.query(await read('supabase/migrations/20261022090000_weekly_report_meeting_kinds.sql'));
  // 운영자는 그 뒤 종류 하나를 더 뺐다(지금 값이 기본값과 달라도 그대로 남는지 본다).
  await pool.query("update public.app_profiles set weekly_hidden_meeting_kinds=array['궤도집행국회의','본부집행위','가상운영위']::text[] where user_id=$1",[OWNER]);
  // 다른 작업공간 주인이 직접 바꾼 목록(옛 기본값과 다름) — 그대로 남아야 한다.
  await pool.query("insert into public.app_workspaces values ('21000000-0000-4000-8000-000000000004')");
  await pool.query("insert into public.app_workspace_members values ('21000000-0000-4000-8000-000000000004',$1,'owner')",[CUSTOM]);
  await pool.query("insert into public.app_profiles(user_id,display_name,weekly_hidden_meeting_kinds) values ($1,'직접 바꾼 사람',array['본부집행위']::text[])",[CUSTOM]);
  const rollbackSQL=await read('docs/'+stem+'.rollback.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const list=async user=>(await pool.query('select weekly_hidden_meeting_kinds k from public.app_profiles where user_id=$1',[user])).rows[0]?.k;
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;
  const pre=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));

  await t.test('precheck values before apply (counts only)',()=>{
   assert.deepEqual([pre['prerequisite recorded'],pre['new migration absent'],pre['old default (two kinds)'],pre['word entries'],pre['operator profiles'],pre['operator list has room'],
    pre['RLS enabled'],pre['anon or public table privilege'],pre['authenticated can update profiles'],pre['owner policies only (current shape)'],pre['profiles rows'],
    pre['non-operator profiles with the old default list'],pre['non-operator profiles with an empty list'],pre['non-operator profiles with another list'],pre['non-operator profiles with the old default or an empty list']],
    ['예','예','예','0','1','예','예','아니오','예','예','4','2','0','1','2']);
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9901');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
   assert.deepEqual(await list(OWNER),[...OLD,'가상운영위']);
  });
  await t.test('prerequisite changes stop the migration without any change',async()=>{
   const attempts=[
    ['grant select on public.app_profiles to anon','revoke select on public.app_profiles from anon'],
    ['alter table public.app_profiles disable row level security','alter table public.app_profiles enable row level security'],
    ["create policy synthetic_extra on public.app_profiles for select to authenticated using (true)",'drop policy synthetic_extra on public.app_profiles'],
    ["alter table public.app_profiles alter column weekly_hidden_meeting_kinds set default '{}'::text[]","alter table public.app_profiles alter column weekly_hidden_meeting_kinds set default array['궤도집행국회의', '본부집행위']::text[]"],
    [`update public.app_profiles set weekly_hidden_meeting_kinds=array['*가상*']::text[] where user_id='${STRANGER}'`,`update public.app_profiles set weekly_hidden_meeting_kinds=array['궤도집행국회의','본부집행위']::text[] where user_id='${STRANGER}'`],
    [`insert into public.app_operator_features values ('21000000-0000-4000-8000-000000000002','calls')`,`delete from public.app_operator_features where workspace_id='21000000-0000-4000-8000-000000000002'`],
    [`delete from public.app_operator_features`,`insert into public.app_operator_features values ('${WS_A}','calls')`],
    [`update public.app_profiles set weekly_hidden_meeting_kinds=array(select 'k'||g from generate_series(1,95) g) where user_id='${OWNER}'`,`update public.app_profiles set weekly_hidden_meeting_kinds=array['궤도집행국회의','본부집행위','가상운영위']::text[] where user_id='${OWNER}'`],
    ["delete from supabase_migrations.schema_migrations where version='20261022090000'","insert into supabase_migrations.schema_migrations(version,name) values('20261022090000','weekly_report_meeting_kinds')"],
   ];
   for(const [breakIt,fixIt] of attempts){
    await pool.query(breakIt);
    try{const c=await pool.connect();try{await assert.rejects(c.query(migration),/WEEKLY_MEETING_WORDS_PREREQUISITE_CHANGED/,breakIt);await c.query('rollback');}finally{c.release();}}
    finally{await pool.query(fixIt);}
   }
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply: operator keeps every kind and gains the six words; others unchanged; postcheck passes',async()=>{
   const apply=await run('apply','9902');assert.equal(apply.ok,true,apply.summary);
   const post=(await pool.query(postcheck)).rows;
   assert.ok(post.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'),JSON.stringify(post));
   for(const r of post.filter(r=>!/^(예|아니오)$/.test(r.value)))assert.equal(r.value,pre[r.item],r.item);
   assert.deepEqual(await list(OWNER),[...OLD,'가상운영위',...WORDS]);
   assert.deepEqual(await list(STRANGER),[],'옛 기본값 그대로인 다른 사람 행은 비운다(사용자 결정 "비워")');
   assert.deepEqual(await list(OUTSIDER),[]);
   assert.deepEqual(await list(CUSTOM),['본부집행위'],'직접 바꾼 목록은 그대로');
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
   assert.equal((await pool.query("select relacl::text acl from pg_class where oid='public.app_profiles'::regclass")).rows[0].acl.match(/authenticated=[a-z]*/)[0],'authenticated=rw');
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid='public.app_profiles'::regclass")).rows[0].n,2);
  });
  const NEW='20000000-0000-4000-8000-000000000009';
  await t.test('a new profile starts with an empty list',async()=>{
   await pool.query('insert into public.app_profiles(user_id,display_name) values ($1,$2)',[NEW,'새 사람']);
   assert.deepEqual(await list(NEW),[]);
   await pool.query('delete from public.app_profiles where user_id=$1',[NEW]);
  });
  await t.test('owner reads and changes only own list; others cannot see or write it',async()=>{
   const readAs=(sub,user)=>as('authenticated',sub,c=>c.query('select weekly_hidden_meeting_kinds k from public.app_profiles where user_id=$1',[user])).then(r=>r.rows);
   assert.deepEqual((await readAs(OWNER,OWNER))[0].k,[...OLD,'가상운영위',...WORDS]);
   assert.deepEqual(await readAs(STRANGER,OWNER),[]);
   assert.equal((await as('authenticated',STRANGER,c=>c.query("update public.app_profiles set weekly_hidden_meeting_kinds='{}' where user_id=$1",[OWNER]))).rowCount,0);
   await assert.rejects(as('anon','',c=>c.query('select weekly_hidden_meeting_kinds from public.app_profiles limit 1')),{code:'42501'});
   // 단어 항목도 기존 CHECK 그대로: 띄어쓰기·쉼표 없는 1~100자.
   await assert.rejects(as('authenticated',OWNER,c=>c.query("update public.app_profiles set weekly_hidden_meeting_kinds=array['*가 상*']::text[] where user_id=$1",[OWNER])),{code:'23514'});
  });
  await t.test('rollback (SQL Editor only) removes just the six words and restores the default; re-apply works',async()=>{
   assert.throws(()=>plan('rollback','9903'),/DB plan rejected/,'승인형 workflow rollback 모드는 받지 않는다(SQL Editor 전용)');
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.deepEqual(await list(OWNER),[...OLD,'가상운영위']);
   assert.deepEqual(await list(STRANGER),[],'비운 다른 사람 목록은 빈 채로 남는다(rollback 설명)');assert.deepEqual(await list(CUSTOM),['본부집행위']);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const changed=new Set(['non-operator profiles with the old default list','non-operator profiles with an empty list']);
   assert.deepEqual((await pool.query(precheck)).rows.filter(r=>!changed.has(r.item)),beforeCheck.filter(r=>!changed.has(r.item)));
   const post=(await pool.query(postcheck)).rows;assert.ok(post.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'),JSON.stringify(post));
   const again=await run('apply','9905');assert.equal(again.ok,true,again.summary);
   assert.deepEqual(await list(OWNER),[...OLD,'가상운영위',...WORDS]);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
