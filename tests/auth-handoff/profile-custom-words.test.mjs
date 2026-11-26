// Fresh local PostgreSQL only. No Supabase, Google or production credentials.
// APP-기록+이름바꾸기(S67-44): app_profiles.custom_words jsonb + CHECK through the approved DB workflow runner,
// plus the operator one-off SQL (docs/ops/custom-words-operator.*) that fills only the operator owner's row.
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
const version='20261120210000',name='profile_custom_words',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const OUTSIDER='20000000-0000-4000-8000-000000000003';
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Production-like prerequisites (task12a + profile_quick_links already recorded, operator allow-list table): app_profiles with owner RLS,
// authenticated SELECT/UPDATE only, anon revoked.
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

test('profile custom words: dry-run, apply, own-row writes, CHECK, operator SQL and guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'profile-custom-words-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(prerequisites);
  const rollbackSQL=await read('docs/'+stem+'.rollback.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const opPre=await read('docs/ops/custom-words-operator.precheck.sql'),opApply=await read('docs/ops/custom-words-operator.apply.sql'),opBack=await read('docs/ops/custom-words-operator.rollback.sql');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  const saved=new Map(),saveSnapshot=async(file,body)=>{saved.set(file,body);};
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const write=(sub,user,value)=>as('authenticated',sub,c=>c.query('update public.app_profiles set custom_words=$1::jsonb where user_id=$2',[value===null?null:JSON.stringify(value),user]));
  const words=async user=>(await pool.query('select custom_words from public.app_profiles where user_id=$1',[user])).rows[0].custom_words;
  const oneShot=async sql=>{const c=await pool.connect();try{await c.query(sql);}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;

  await t.test('precheck values before apply',()=>{
   const v=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));
   assert.deepEqual([v['prerequisite recorded'],v['new migration absent'],v['new column count'],v['RLS enabled'],v['anon or public table privilege'],
    v['authenticated can update profiles'],v['owner policies only (current shape)'],v['owner check function (task12a body)'],v['owner profile row exists'],v['profiles rows']],
    ['예','예','0','예','아니오','예','예','예','예','3']);
  });
  await t.test('operator SQL refuses before the migration',async()=>{
   await assert.rejects(oneShot(opApply),/CUSTOM_WORDS_OPERATOR_MIGRATION_MISSING|custom_words/);
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9701');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('apply passes postcheck; every profile starts empty; grants and policies unchanged',async()=>{
   const apply=await run('apply','9702');assert.equal(apply.ok,true,apply.summary);
   assert.ok((await pool.query(postcheck)).rows.every(r=>/^(예|\d+|[0-9a-f]{32})$/.test(r.value)),'postcheck values');
   assert.ok((await pool.query(postcheck)).rows.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'));
   assert.deepEqual((await pool.query('select custom_words from public.app_profiles')).rows.map(r=>r.custom_words),[null,null,null]);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
   assert.equal((await pool.query("select relacl::text acl from pg_class where oid='public.app_profiles'::regclass")).rows[0].acl.match(/authenticated=[a-z]*/)[0],'authenticated=rw');
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid='public.app_profiles'::regclass")).rows[0].n,2);
  });
  const good={area:'캠페인',kind_policy:'기획 회의',menu_org:'거래처·부서·직원'};
  await t.test('the owner saves own names; other rows, outsiders and anon cannot read or write',async()=>{
   assert.equal((await write(OWNER,OWNER,good)).rowCount,1);assert.deepEqual(await words(OWNER),good);
   assert.equal((await write(OWNER,STRANGER,good)).rowCount,0,'another profile row is not writable');
   assert.equal(await words(STRANGER),null);
   assert.equal((await write(OUTSIDER,OUTSIDER,good)).rowCount,0,'a non-owner member cannot write even the own row');
   assert.equal(await words(OUTSIDER),null);
   // 남의 행은 읽히지 않는다(owner RLS): STRANGER로 읽으면 OWNER 행이 없다.
   assert.deepEqual((await as('authenticated',STRANGER,c=>c.query('select custom_words from public.app_profiles where user_id=$1',[OWNER]))).rows,[]);
   await assert.rejects(as('anon','',c=>c.query('select custom_words from public.app_profiles limit 1')),{code:'42501'});
   assert.equal((await write(OWNER,OWNER,{})).rowCount,1,'an empty object is allowed');
   assert.equal((await write(OWNER,OWNER,null)).rowCount,1,'back to the default');
   assert.equal((await as('authenticated',OWNER,c=>c.query("update public.app_profiles set display_name='소유자',job_title=null,updated_at=now() where user_id=$1",[OWNER]))).rowCount,1);
  });
  await t.test('the CHECK refuses unknown slots, bad shapes and symbols',async()=>{
   const bad=[[],'x',1,{nope:'이름'},{area:1},{area:null},{area:['이름']},{area:{a:1}},{area:''},{area:' 앞'},{area:'뒤 '},{area:'두\n줄'},{area:'가'.repeat(21)},
    {area:'<b>'},{area:'a&b'},{area:'"따옴"'},{area:"작'은"},{area:'역\\빗'},{area:'백`틱'},{area:'탭\t'},{Area:'이름'},{'kind_meeting ':'회의'}];
   for(const value of bad)await assert.rejects(write(OWNER,OWNER,value),{code:'23514'},JSON.stringify(value).slice(0,80));
   for(const value of [{area:'가'.repeat(20)},{area:'캠페인 묶음'},{menu_biz:'사업 관리',kind_other:'기타 활동'},NOJO_NAMES])
    assert.equal((await write(OWNER,OWNER,value)).rowCount,1,JSON.stringify(value).slice(0,80));
   await write(OWNER,OWNER,null);
  });
  await t.test('operator SQL fills only the operator owner, refuses to overwrite, and its rollback empties only that value',async()=>{
   await pool.query(`insert into public.app_operator_features values ('${WS_A}','calls'),('${WS_A}','telegram')`);
   const pre=Object.fromEntries((await pool.query(opPre)).rows.map(r=>[r.item,r.value]));
   assert.deepEqual(Object.entries(pre).filter(([k])=>!k.startsWith('profiles with names')).map(([,v])=>v),['예','예','예','예','예','예']);
   await oneShot(opApply);
   assert.deepEqual(await words(OWNER),NOJO_NAMES);
   assert.equal(await words(STRANGER),null);assert.equal(await words(OUTSIDER),null);
   await assert.rejects(oneShot(opApply),/CUSTOM_WORDS_OPERATOR_NOT_EMPTY_OR_NO_PROFILE/,'does not overwrite');
   // 사용자가 화면에서 바꿨으면 되돌리기가 멈춘다.
   await write(OWNER,OWNER,{...NOJO_NAMES,area:'사업'});
   await assert.rejects(oneShot(opBack),/CUSTOM_WORDS_OPERATOR_CHANGED_SINCE_APPLY/);
   await write(OWNER,OWNER,NOJO_NAMES);
   await oneShot(opBack);
   assert.equal(await words(OWNER),null);
   await oneShot(opApply);
  });
  await t.test('rollback refuses while any names are saved, and keeps them',async()=>{
   const result=await run('rollback','9703');assert.equal(result.ok,false,result.summary);
   const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/PROFILE_CUSTOM_WORDS_ROLLBACK_BLOCKED: names saved/);await c.query('rollback');}finally{c.release();}
   assert.deepEqual(await words(OWNER),NOJO_NAMES);
  });
  await t.test('rollback restores the original schema once names are empty; re-apply works',async()=>{
   await oneShot(opBack);
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const again=await run('apply','9705');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
