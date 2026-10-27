// Fresh local PostgreSQL only. No Supabase, Google or production credentials.
// UI-자주가는링크편집: app_profiles.quick_link_groups jsonb + widened quick_links CHECK + group_ref CHECK through the approved DB workflow runner.
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
const version='20261027170000',name='profile_quick_link_groups',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const OUTSIDER='20000000-0000-4000-8000-000000000003';
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Production-like prerequisites (task12a + doc_categories_profile already recorded): app_profiles with owner RLS,
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
  insert into supabase_migrations.schema_migrations(version,name) values('20261018112943','doc_categories_profile');
`;

test('quick link groups: dry-run, apply, own-row writes, CHECKs and guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'quick-link-groups-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(prerequisites);
  // The earlier migration (quick_links column + two-group CHECK) is applied from the repository file as it was.
  await pool.query(await read('supabase/migrations/20261022163000_profile_quick_links.sql'));
  const rollbackSQL=await read('docs/'+stem+'.rollback.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  const saved=new Map(),saveSnapshot=async(file,body)=>{saved.set(file,body);};
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const json=v=>v===undefined?undefined:v===null?null:JSON.stringify(v);
  // One PATCH like the screen: links and (optionally) groups together.
  const write=(sub,user,links,groups)=>as('authenticated',sub,c=>groups===undefined
    ?c.query('update public.app_profiles set quick_links=$1::jsonb where user_id=$2',[json(links),user])
    :c.query('update public.app_profiles set quick_links=$1::jsonb,quick_link_groups=$2::jsonb where user_id=$3',[json(links),json(groups),user]));
  const read_=async user=>(await pool.query('select quick_links,quick_link_groups from public.app_profiles where user_id=$1',[user])).rows[0];
  const link=(group,name='이름',url='https://example.org/')=>({group,name,url});
  const legacy=[link('work','A'),link('org','B','http://b.example.org/x?y=1')];
  const groups=[{id:'work',name:'업무'},{id:'org',name:'담당조직 홈페이지'},{id:'etc',name:'기타'},{id:'gab12cd',name:'새 분류'}];
  // Legacy list saved with the earlier migration's own shape (before this migration).
  await write(OWNER,OWNER,legacy);
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;

  await t.test('before apply the earlier CHECK refuses other groups and there is no groups column',async()=>{
   const v=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));
   assert.deepEqual([v['prerequisite recorded'],v['new migration absent'],v['new column count'],v['links check old shape'],v['custom link groups saved'],v['RLS enabled'],v['anon or public table privilege'],v['two owner policies'],v['profiles rows'],v['saved link lists']],
    ['예','예','0','예','0','예','아니오','예','3','1']);
   await assert.rejects(write(OWNER,OWNER,[link('etc')]),{code:'23514'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query("update public.app_profiles set quick_link_groups='[]' where user_id=$1",[OWNER])),{code:'42703'});
  });
  await t.test('plan accepts the migration and its companion files',()=>{
   const p=plan('apply','9700');assert.ok(p&&!p.rejected,JSON.stringify(p).slice(0,300));
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9701');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('apply passes postcheck; saved links stay; grants, policies and rows unchanged',async()=>{
   const apply=await run('apply','9702');assert.equal(apply.ok,true,apply.summary);
   assert.ok((await pool.query(postcheck)).rows.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'));
   assert.deepEqual((await pool.query('select quick_links,quick_link_groups from public.app_profiles order by user_id')).rows.map(r=>[r.quick_links!==null,r.quick_link_groups]).sort(),[[false,null],[false,null],[true,null]]);
   assert.deepEqual((await read_(OWNER)).quick_links,legacy,'the legacy link list (work/org) is untouched and still valid');
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
   assert.equal((await pool.query("select relacl::text acl from pg_class where oid='public.app_profiles'::regclass")).rows[0].acl.match(/authenticated=[a-z]*/)[0],'authenticated=rw');
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid='public.app_profiles'::regclass")).rows[0].n,2);
   assert.equal((await pool.query("select count(*)::int n from pg_constraint where conrelid='public.app_profiles'::regclass and conname in ('app_profiles_quick_links_check','app_profiles_quick_link_groups_check','app_profiles_quick_links_group_ref_check') and convalidated")).rows[0].n,3);
  });
  await t.test('the owner saves groups and links in one write; other rows, outsiders and anon cannot',async()=>{
   const links=[link('gab12cd','새'),link('etc','기타 하나'),link('work','A')];
   assert.equal((await write(OWNER,OWNER,links,groups)).rowCount,1);
   assert.deepEqual(await read_(OWNER),{quick_links:links,quick_link_groups:groups});
   assert.equal((await write(OWNER,STRANGER,links,groups)).rowCount,0,'another profile row is not writable');
   assert.equal((await write(OUTSIDER,OUTSIDER,links,groups)).rowCount,0,'a non-owner member cannot write even the own row');
   assert.deepEqual(await read_(OUTSIDER),{quick_links:null,quick_link_groups:null});
   await assert.rejects(as('anon','',c=>c.query('select quick_link_groups from public.app_profiles limit 1')),{code:'42501'});
  });
  await t.test('links may only point at a group in the same row; the default pair applies while groups are empty',async()=>{
   await assert.rejects(write(OWNER,OWNER,[link('zzz')],groups),{code:'23514'},'unknown group');
   await assert.rejects(write(OWNER,OWNER,[link('gab12cd')],[{id:'work',name:'업무'}]),{code:'23514'},'group removed while a link still points at it');
   await assert.rejects(write(OWNER,OWNER,[link('etc')],null),{code:'23514'},'empty groups = work and org only');
   await assert.rejects(write(OWNER,OWNER,[link('gab12cd')]),{code:'23514'},'links only, groups left as saved, group not in it');
   assert.equal((await write(OWNER,OWNER,[link('work'),link('org')],null)).rowCount,1);
   assert.equal((await write(OWNER,OWNER,[],[{id:'only',name:'하나'}])).rowCount,1,'empty list with one group');
   assert.equal((await write(OWNER,OWNER,legacy,null)).rowCount,1);
  });
  await t.test('the groups CHECK',async()=>{
   const bad=[[],{},'x',1,[1],[{id:'a'}],[{name:'이름'}],[{id:'a',name:'이름',extra:1}],[{id:'A',name:'이름'}],[{id:'a-b',name:'이름'}],[{id:'',name:'이름'}],[{id:'a'.repeat(13),name:'이름'}],
    [{id:5,name:'이름'}],[{id:'a',name:5}],[{id:'a',name:''}],[{id:'a',name:' 앞'}],[{id:'a',name:'뒤 '}],[{id:'a',name:'두\n줄'}],[{id:'a',name:'가'.repeat(21)}],
    Array.from({length:13},(_,i)=>({id:'g'+i,name:'n'+i})),[null]];
   for(const value of bad)await assert.rejects(write(OWNER,OWNER,[],value),{code:'23514'},JSON.stringify(value).slice(0,80));
   for(const value of [[{id:'a',name:'가'}],[{id:'a'.repeat(12),name:'가'.repeat(20)}],[{id:'a1',name:'두 단어'}],Array.from({length:12},(_,i)=>({id:'g'+i,name:'n'+i}))])
    assert.equal((await write(OWNER,OWNER,[],value)).rowCount,1,JSON.stringify(value).slice(0,80));
   await write(OWNER,OWNER,legacy,null);
  });
  await t.test('the links CHECK still refuses everything the earlier one refused, and missing or non-text fields',async()=>{
   const ok=link('work');
   const bad=[{},'x',[null],[1],[[]],[{...ok,extra:1}],[{group:'work',name:'a'}],[{group:'work',url:'https://a.org'}],[{name:'a',url:'https://a.org'}],
    [{...ok,group:5}],[{...ok,group:'Work'}],[{...ok,group:'a-b'}],[{...ok,group:''}],[{...ok,group:'a'.repeat(13)}],
    [{...ok,name:''}],[{...ok,name:' a'}],[{...ok,name:'a '}],[{...ok,name:'두\n줄'}],[{...ok,name:'가'.repeat(41)}],[{...ok,name:5}],
    [{...ok,url:'javascript:alert(1)'}],[{...ok,url:'ftp://a.org'}],[{...ok,url:'https://a b.org'}],[{...ok,url:'https://'}],[{...ok,url:5}],
    Array.from({length:61},(_,i)=>link('work','n'+i,'https://a.org/'+i))];
   for(const value of bad)await assert.rejects(write(OWNER,OWNER,value),{code:'23514'},JSON.stringify(value).slice(0,80));
   for(const value of [[],[ok],[link('org','가'.repeat(40),'HTTPS://A.ORG/x')],Array.from({length:60},(_,i)=>link('work','n'+i,'https://a.org/'+i))])
    assert.equal((await write(OWNER,OWNER,value)).rowCount,1,JSON.stringify(value).slice(0,80));
   await write(OWNER,OWNER,legacy,null);
  });
  await t.test('rollback refuses while groups are saved, and keeps them',async()=>{
   const links=[link('gab12cd','새'),link('work','A')];
   await write(OWNER,OWNER,links,groups);
   const result=await run('rollback','9703');assert.equal(result.ok,false,result.summary);
   const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/PROFILE_QUICK_LINK_GROUPS_ROLLBACK_BLOCKED: groups saved/);await c.query('rollback');}finally{c.release();}
   assert.deepEqual(await read_(OWNER),{quick_links:links,quick_link_groups:groups});
  });
  await t.test('rollback is cancelled as a whole while a link sits in a custom group, even without a groups list',async()=>{
   // Reachable only by a privileged write that bypasses the group_ref CHECK; emulate by dropping it in a rolled-back transaction.
   const c=await pool.connect();try{
    await c.query('begin');await c.query('alter table public.app_profiles drop constraint app_profiles_quick_links_group_ref_check');
    await c.query("update public.app_profiles set quick_link_groups=null,quick_links=$1::jsonb where user_id=$2",[JSON.stringify([link('gab12cd')]),OWNER]);
    await assert.rejects(c.query(rollbackSQL),{code:'23514'},'re-adding the original links CHECK refuses the row, so nothing is changed');
   }finally{await c.query('rollback').catch(()=>{});c.release();}
  });
  await t.test('rollback restores the earlier schema once nothing custom remains; legacy links survive; re-apply works',async()=>{
   await write(OWNER,OWNER,legacy,null);
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
   await assert.rejects(write(OWNER,OWNER,[link('etc')]),{code:'23514'});
   assert.deepEqual((await pool.query('select quick_links from public.app_profiles where user_id=$1',[OWNER])).rows[0].quick_links,legacy,'saved links survive the rollback');
   const again=await run('apply','9705');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
