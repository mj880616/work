// Fresh local PostgreSQL only. No Supabase, Google or production credentials.
// S67-57: app_profiles_custom_words_check accepts two more slots (affiliation, weekly) through the approved DB workflow runner,
// plus the operator one-off SQL (docs/ops/custom-words-operator-slots.*) that adds only those two names to the operator owner's row.
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
const version='20261121073000',name='profile_custom_words_slots',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const OUTSIDER='20000000-0000-4000-8000-000000000003';
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Same production-like prerequisites as profile-custom-words.test.mjs, then 20261120210000 itself (custom_words + 15-slot CHECK).
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
  create table public.app_profiles(user_id uuid primary key,display_name text,job_title text,created_at timestamptz default now(),updated_at timestamptz default now());
  alter table public.app_profiles enable row level security;
  create policy task12a_owner_all on public.app_profiles for all to authenticated
    using (private.app_is_owner_profile(user_id)) with check (private.app_is_owner_profile(user_id));
  create policy task12a_profile_self_select on public.app_profiles for select to authenticated
    using (user_id = (select auth.uid()));
  revoke all on public.app_profiles from public, anon, authenticated;
  grant select, update on public.app_profiles to authenticated;
  insert into public.app_workspace_members values ('${WS_A}', '${OUTSIDER}', 'viewer');
  insert into public.app_profiles(user_id,display_name) values ('${OWNER}','소유자'),('${STRANGER}','남'),('${OUTSIDER}','다른 구성원');
  insert into supabase_migrations.schema_migrations(version,name) values('20261022163000','profile_quick_links');
  create table public.app_operator_features(workspace_id uuid not null,feature text not null,primary key(workspace_id,feature));
  alter table public.app_operator_features enable row level security;
  revoke all on public.app_operator_features from public, anon, authenticated;
`;


const NOJO_NAMES={menu_biz:'사업 관리',report:'사업 보고',area:'사업영역',menu_org:'조직 관리',org_one:'담당조직',org_report:'조직 보고',workplace:'투쟁사업장',
 kind_meeting:'회의',kind_policy:'정책',kind_negotiation:'교섭',kind_press:'언론',kind_assembly:'국회',kind_struggle:'투쟁',kind_education:'교육',kind_other:'기타'};
const NEW_NAMES={affiliation:'노조',weekly:'주간 보고'};

test('profile custom words slots: dry-run, apply, new slots, CHECK, operator SQL and guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'profile-custom-words-slots-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(prerequisites);
  await pool.query(await read('supabase/migrations/20261120210000_profile_custom_words.sql'));
  const rollbackSQL=await read('docs/'+stem+'.rollback.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const op15=await read('docs/ops/custom-words-operator.apply.sql');
  const opPre=await read('docs/ops/custom-words-operator-slots.precheck.sql'),opApply=await read('docs/ops/custom-words-operator-slots.apply.sql'),opBack=await read('docs/ops/custom-words-operator-slots.rollback.sql');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  const saveSnapshot=async()=>{};
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const write=(sub,user,value)=>as('authenticated',sub,c=>c.query('update public.app_profiles set custom_words=$1::jsonb where user_id=$2',[value===null?null:JSON.stringify(value),user]));
  const words=async user=>(await pool.query('select custom_words from public.app_profiles where user_id=$1',[user])).rows[0].custom_words;
  const oneShot=async sql=>{const c=await pool.connect();try{await c.query(sql);}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const checkDef=async()=>(await pool.query("select pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.app_profiles'::regclass and conname='app_profiles_custom_words_check'")).rows[0].d;
  await pool.query(`insert into public.app_operator_features values ('${WS_A}','calls'),('${WS_A}','telegram')`);
  await oneShot(op15);
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows,beforeDef=await checkDef();

  await t.test('precheck values before apply',()=>{
   const v=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));
   assert.deepEqual([v['prerequisite recorded'],v['new migration absent'],v['custom words check without new slots'],v['saved new slots'],v['RLS enabled'],v['anon or public table privilege'],v['two owner policies'],v['profiles rows']],
    ['예','예','예','0','예','아니오','예','3']);
  });
  await t.test('before the migration the new slots are refused and the operator SQL stops',async()=>{
   await assert.rejects(write(OWNER,OWNER,{...NOJO_NAMES,...NEW_NAMES}),{code:'23514'});
   await assert.rejects(oneShot(opApply),/CUSTOM_WORDS_OPERATOR_SLOTS_MIGRATION_MISSING/);
   assert.deepEqual(await words(OWNER),NOJO_NAMES);
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9711');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('apply passes postcheck; rows, grants and policies unchanged',async()=>{
   const apply=await run('apply','9712');assert.equal(apply.ok,true,apply.summary);
   const post=(await pool.query(postcheck)).rows;
   assert.ok(post.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'),JSON.stringify(post));
   const pre=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));
   for(const r of post)if(/hash$|^profiles rows$/.test(r.item))assert.equal(r.value,pre[r.item],r.item);
   assert.deepEqual(await words(OWNER),NOJO_NAMES,'saved names untouched');
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid='public.app_profiles'::regclass")).rows[0].n,2);
   assert.match(await checkDef(),/affiliation/);
  });
  await t.test('the CHECK takes the two new slots with the same name rules and still refuses unknown slots',async()=>{
   assert.equal((await write(STRANGER,STRANGER,{affiliation:'회사'})).rowCount,0,'non-owner of the row cannot write');
   for(const value of [{affiliation:'회사'},{weekly:'한 주 돌아보기'},{area:'캠페인',affiliation:'단체',weekly:'주간'}])
    assert.equal((await write(OWNER,OWNER,value)).rowCount,1,JSON.stringify(value));
   for(const value of [{nope:'이름'},{affiliation:''},{affiliation:'<b>'},{weekly:'가'.repeat(21)},{weekly:1},{Affiliation:'회사'}])
    await assert.rejects(write(OWNER,OWNER,value),{code:'23514'},JSON.stringify(value));
   await write(OWNER,OWNER,NOJO_NAMES);
  });
  await t.test('operator SQL adds only the two names to the operator owner, refuses to overwrite, and its rollback removes only them',async()=>{
   const pre=Object.fromEntries((await pool.query(opPre)).rows.map(r=>[r.item,r.value]));
   assert.deepEqual(Object.entries(pre).filter(([k])=>!k.startsWith('profiles with')).map(([,v])=>v),['예','예','예','예','예']);
   await oneShot(opApply);
   assert.deepEqual(await words(OWNER),{...NOJO_NAMES,...NEW_NAMES});
   assert.equal(await words(STRANGER),null);assert.equal(await words(OUTSIDER),null);
   await assert.rejects(oneShot(opApply),/CUSTOM_WORDS_OPERATOR_SLOTS_EMPTY_OR_ALREADY_SET/,'does not overwrite');
   await write(OWNER,OWNER,{...NOJO_NAMES,weekly:'한 주'});
   await assert.rejects(oneShot(opBack),/CUSTOM_WORDS_OPERATOR_SLOTS_CHANGED_SINCE_APPLY/);
   await write(OWNER,OWNER,{...NOJO_NAMES,...NEW_NAMES});
   await oneShot(opBack);
   assert.deepEqual(await words(OWNER),NOJO_NAMES);
   await oneShot(opApply);
  });
  await t.test('rollback refuses while new slot names are saved, and keeps them',async()=>{
   const result=await run('rollback','9713');assert.equal(result.ok,false,result.summary);
   const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/PROFILE_CUSTOM_WORDS_SLOTS_ROLLBACK_BLOCKED: new slot names saved/);await c.query('rollback');}finally{c.release();}
   assert.deepEqual(await words(OWNER),{...NOJO_NAMES,...NEW_NAMES});
  });
  await t.test('rollback restores the 15-slot CHECK once the new names are gone; re-apply works',async()=>{
   await oneShot(opBack);
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.equal(await checkDef(),beforeDef);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(await words(OWNER),NOJO_NAMES);
   const again=await run('apply','9715');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
