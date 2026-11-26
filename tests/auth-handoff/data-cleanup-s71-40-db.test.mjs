// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic (no real organization, person or title).
// S71-40 DATA-정리두가지:
//  (가) 20261126201000_org_others_to_trash — 운영자 작업공간의 '그 외' 조직(활성·휴지통 밖·담당 아님) 중 참조 기록이 없는 조직만 휴지통으로(백업 표에 사본).
//  (나) 20261126202000_profile_affiliation_clear — 모든 프로필의 소속·부서·직책 비우기(이름 그대로, 백업 표에 옛 값).
// 승인형 DB workflow 실행기로 plan·dry-run·apply를 시험하고, 담당 조직·참조 있는 조직·비활성·남의 작업공간 조직은 안 바뀌는지,
// 모르는 외래 키·운영자 작업공간 둘·78곳 넘음·프로필 트리거가 담당 표를 바꾸면 멈추는지, 백업 표가 닫혀 있는지, rollback으로 돌아오는지 본다.
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
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

const id=n=>`24000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
// 조직(작업공간 A = 운영자): 담당 둘(1: 담당자 표, 2: 프로필 담당 표), 그 외 참조 없음 셋(3·4·5), 그 외 참조 있음 둘(6: 조직 기록, 7: 텔레그램 기억할 일 이름),
// 비활성 그 외 하나(8), 이미 휴지통 하나(9). 작업공간 B(운영자 아님): 그 외 참조 없음 하나(10).
const ORGS={assignee:id(1),workplace:id(2),free1:id(3),free2:id(4),free3:id(5),withUpdate:id(6),withMemorable:id(7),inactive:id(8),trashed:id(9),otherWs:id(10)};
// 운영 app_suborganizations를 가리키는 외래 키 22곳(표.칸). 모양만(칸은 최소).
const REF_TABLES=[
 ['app_suborganization_assignees','organization_id','cascade',', user_id uuid'],['app_profile_workplaces','organization_id','set null',', user_id uuid'],
 ['app_suborganization_updates','organization_id','cascade',''],['app_suborganization_timeline','organization_id','cascade',''],
 ['app_suborganization_weekly_reports','organization_id','cascade',''],['app_suborganization_status_items','organization_id','cascade',''],
 ['app_suborganization_affiliations','organization_id','cascade',''],['app_suborganization_dispute_stages','organization_id','cascade',''],
 ['app_event_suborganizations','organization_id','cascade',''],['app_record_links','organization_id','cascade',''],
 ['app_documents','organization_id','set null',''],['app_todo_candidates','organization_id','set null',''],
 ['app_ledger_organizations','suborganization_id','set null',''],['app_weekly_org_summaries','organization_id','cascade',''],
 ['app_feed_items','organization_id','set null',''],['app_calendar_work_refs','organization_id','set null',''],
 ['app_org_key_people','organization_id','cascade',''],['app_org_key_people_briefs','organization_id','cascade',''],
 ['app_pre_meeting_sheets','organization_id','cascade',''],['app_org_status_rows','organization_id','cascade',''],
 ['app_weekly_org_lines','organization_id','cascade',''],['app_library_folders','organization_id','set null',''],
];
const THIRD='20000000-0000-4000-8000-000000000003';
const shapes=`
  alter table public.app_suborganizations add column active boolean default true, add column deleted_at timestamptz;
  create policy app_suborganizations_trash_hidden on public.app_suborganizations as restrictive for all to authenticated
    using (deleted_at is null) with check (deleted_at is null);
  revoke all on public.app_suborganizations from anon;
  insert into supabase_migrations.schema_migrations(version,name) values('20261025100000','trash_org_report_db'),('20261115223000','profile_union_department');
  delete from public.app_suborganizations;
  create table public.app_operator_features(workspace_id uuid not null references public.app_workspaces(id), feature text not null, primary key(workspace_id,feature));
  alter table public.app_operator_features enable row level security;
  revoke all on public.app_operator_features from public, anon, authenticated, service_role;
  insert into public.app_operator_features values ('${WS_A}','calls'),('${WS_A}','telegram');
  ${REF_TABLES.map(([t,c,d,extra])=>`create table public.${t}(id uuid primary key default gen_random_uuid(), ${c} uuid references public.app_suborganizations(id) on delete ${d}${extra});
  alter table public.${t} enable row level security; revoke all on public.${t} from anon;`).join('\n  ')}
  create table public.app_journal_memorable(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, org_name text);
  create table public.app_profiles(user_id uuid primary key, display_name text, job_title text, union_name text, department_name text, view_prefs jsonb, updated_at timestamptz default now());
  alter table public.app_profiles enable row level security;
  create policy task12a_profile_self_select on public.app_profiles for select to authenticated using (user_id = (select auth.uid()));
  revoke all on public.app_profiles from public, anon, authenticated;
  grant select, update on public.app_profiles to authenticated;
  create table public.app_collab_members(id uuid primary key default gen_random_uuid(), user_id uuid not null, display_name text not null, title text);
  alter table public.app_collab_members enable row level security;
  revoke all on public.app_collab_members from public, anon, authenticated;
  insert into public.app_suborganizations(id,workspace_id,name,active,deleted_at) values
    ('${ORGS.assignee}','${WS_A}','예시 담당 하나',true,null),('${ORGS.workplace}','${WS_A}','예시 담당 둘',true,null),
    ('${ORGS.free1}','${WS_A}','예시 그 외 하나',true,null),('${ORGS.free2}','${WS_A}','예시 그 외 둘',null,null),('${ORGS.free3}','${WS_A}','예시 그 외 셋',true,null),
    ('${ORGS.withUpdate}','${WS_A}','예시 기록 있음',true,null),('${ORGS.withMemorable}','${WS_A}','예시 이름 연결',true,null),
    ('${ORGS.inactive}','${WS_A}','예시 비활성',false,null),('${ORGS.trashed}','${WS_A}','예시 휴지통',true,now() - interval '3 days'),
    ('${ORGS.otherWs}','${WS_B}','예시 남의 조직',true,null);
  insert into public.app_suborganization_assignees(organization_id,user_id) values ('${ORGS.assignee}','${OWNER}');
  insert into public.app_profile_workplaces(organization_id,user_id) values ('${ORGS.workplace}','${OWNER}');
  insert into public.app_suborganization_updates(organization_id) values ('${ORGS.withUpdate}'),('${ORGS.assignee}');
  insert into public.app_journal_memorable(workspace_id,org_name) values ('${WS_A}','예시 이름 연결'),('${WS_B}','예시 그 외 하나');
  insert into public.app_profiles(user_id,display_name,job_title,union_name,department_name,view_prefs) values
    ('${OWNER}','예시 소유자','예시 직책','예시 소속','예시 부서','{"a":1}'),('${STRANGER}','예시 남',' 예시 직책 둘',null,null,null),('${THIRD}','예시 셋',null,null,null,null);
  insert into public.app_collab_members(user_id,display_name,title) values ('${OWNER}','예시 소유자','예시 직책');
`;

test('S71-40 DATA-정리두가지: (가) 그 외 조직 휴지통 · (나) 프로필 소속·부서·직책 비우기',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'s71-40-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(shapes);
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const one=async sql=>(await pool.query(sql)).rows[0];
  const items=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const mustStop=async(sql,re,label)=>{const c=await pool.connect();try{await assert.rejects(c.query(sql),re,label);await c.query('rollback');}finally{c.release();}};
  const closed=async table=>{for(const role of ['anon','authenticated','service_role'])assert.equal((await one(`select has_table_privilege('${role}','public.${table}','select,insert,update,delete,truncate,references,trigger') v`)).v,false,role+' '+table);
   assert.equal((await one(`select relrowsecurity v from pg_class where oid='public.${table}'::regclass`)).v,true);
   assert.equal((await one(`select count(*)::int n from pg_policy where polrelid='public.${table}'::regclass`)).n,0);
   for(const role of ['anon','authenticated']){const c=await pool.connect();try{await c.query('begin');await c.query('set local role '+role);await assert.rejects(c.query(`select * from public.${table}`),/permission denied/,role);}finally{await c.query('rollback');c.release();}}};

  await t.test('(가) 그 외 조직 → 휴지통',async t2=>{
   const version='20261126201000',stem=version+'_org_others_to_trash';
   const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
   const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
   const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
   const run=(mode,rid)=>runMigrationPlan(plan(mode,rid),query,{saveSnapshot:async()=>{}});
   const state=async()=>(await pool.query('select id,workspace_id,name,active,deleted_at from public.app_suborganizations order by id')).rows;
   const refRows=async()=>(await pool.query(`select ${REF_TABLES.map(([t])=>`(select count(*) from public.${t})`).join('||\':\'||')}||':'||(select count(*) from public.app_journal_memorable) v`)).rows[0].v;
   const beforeOrgs=await state(),beforeRefs=await refRows(),before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows,pre=items(beforeCheck);

   await t2.test('precheck: yes/no items as expected, counts only',()=>{
    assert.equal(pre['prerequisite recorded'],'예');assert.equal(pre['new migration absent'],'예');assert.equal(pre['backup table absent'],'예');
    assert.equal(pre['RLS enabled'],'예');assert.equal(pre['anon or public table privilege'],'아니오');assert.equal(pre['operator workspace one owner'],'예');
    assert.equal(pre['fk list as expected'],'예');assert.equal(pre['fk count'],'22');
    assert.equal(pre['other orgs'],'5');assert.equal(pre['other orgs with records'],'2');assert.equal(pre['other orgs to trash'],'3');
    assert.equal(pre['other orgs in suborganization_updates'],'1');assert.equal(pre['other orgs in journal_memorable names'],'1');
    assert.equal(pre['other orgs inactive untouched'],'1');assert.equal(pre['assigned orgs'],'2');assert.equal(pre['orgs in trash'],'1');
    assert.ok(beforeCheck.length<=64);
    assert.ok(beforeCheck.every(r=>/^(예|아니오|\d+|[0-9a-f]{32})$/.test(r.value)),JSON.stringify(beforeCheck));
   });
   await t2.test('static plan accepts dry-run and apply (one new closed table, no grants, policies, functions or triggers)',()=>{
    for(const mode of ['dry-run','apply']){const p=plan(mode,'1');assert.ok(p,mode);if(p.review){assert.equal(p.review.grants||0,0);assert.equal(p.review.policies||0,0);assert.equal(p.review.triggers||0,0);assert.deepEqual(p.review.definer||[],[])}}
   });
   await t2.test('dry-run leaves organizations, references, schema and history unchanged',async()=>{
    const dry=await run('dry-run','9931');assert.equal(dry.ok,true,dry.summary);
    assert.deepEqual(await state(),beforeOrgs);assert.equal(await refRows(),beforeRefs);
    assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
   });
   await t2.test('unknown FK, two operator workspaces, more than 78 others or an existing record stop without any change',async()=>{
    const attempts=[
     ['create table public.app_new_org_ref(id uuid primary key, organization_id uuid references public.app_suborganizations(id))','drop table public.app_new_org_ref'],
     [`insert into public.app_operator_features values ('${WS_B}','telegram')`,`delete from public.app_operator_features where workspace_id='${WS_B}'`],
     [`insert into public.app_suborganizations(id,workspace_id,name) select gen_random_uuid(),'${WS_A}','예시 많은 조직 '||g from generate_series(1,74) g`,"delete from public.app_suborganizations where name like '예시 많은 조직 %'"],
     ["delete from supabase_migrations.schema_migrations where version='20261025100000'","insert into supabase_migrations.schema_migrations(version,name) values('20261025100000','trash_org_report_db')"],
     ["insert into supabase_migrations.schema_migrations(version,name) values('20261126201000','org_others_to_trash')","delete from supabase_migrations.schema_migrations where version='20261126201000'"],
    ];
    for(const [breakIt,fixIt] of attempts){await pool.query(breakIt);try{await mustStop(migration,/ORG_OTHERS_TO_TRASH_PREREQUISITE_CHANGED/,breakIt);}finally{await pool.query(fixIt);}}
    assert.deepEqual(await state(),beforeOrgs);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
   });
   await t2.test('apply moves only the three free others to trash; assigned, referenced, inactive, already trashed and other workspace untouched',async()=>{
    const apply=await run('apply','9932');assert.equal(apply.ok,true,apply.summary);
    const after=new Map((await state()).map(o=>[o.id,o])),was=new Map(beforeOrgs.map(o=>[o.id,o]));
    for(const k of ['free1','free2','free3'])assert.ok(after.get(ORGS[k]).deleted_at,k);
    for(const k of ['assignee','workplace','withUpdate','withMemorable','inactive','trashed','otherWs'])assert.deepEqual(after.get(ORGS[k]),was.get(ORGS[k]),k);
    assert.equal(after.size,was.size,'줄은 지우지 않음');assert.equal(await refRows(),beforeRefs,'참조 줄 그대로');
    const backup=(await pool.query('select organization_id,workspace_id,row_data from public.app_cleanup_s71_40_orgs order by organization_id')).rows;
    assert.deepEqual(backup.map(b=>b.organization_id),[ORGS.free1,ORGS.free2,ORGS.free3]);
    assert.ok(backup.every(b=>b.workspace_id===WS_A&&b.row_data.deleted_at===null&&b.row_data.id===b.organization_id));
    await closed('app_cleanup_s71_40_orgs');
    const post=items((await pool.query(postcheck)).rows);
    for(const [k,v] of Object.entries(post)){if(/^(예|아니오)$/.test(v))assert.equal(v,'예',k);else assert.equal(v,pre[k],k);}
    assert.equal((await one("select count(*)::int n from supabase_migrations.schema_migrations where version='20261126201000'")).n,1);
   });
   await t2.test('rollback restores the moved organizations (a purged one from its backup row) and drops the backup table; re-apply works',async()=>{
    await pool.query('delete from public.app_suborganizations where id=$1',[ORGS.free3]);
    await pool.query(rollbackSQL);
    assert.deepEqual(await state(),beforeOrgs);
    assert.equal((await one("select to_regclass('public.app_cleanup_s71_40_orgs') is null v")).v,true);
    assert.equal((await one("select count(*)::int n from supabase_migrations.schema_migrations where version='20261126201000'")).n,0);
    assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
    const again=await run('apply','9933');assert.equal(again.ok,true,again.summary);
    await pool.query(rollbackSQL);assert.deepEqual(await state(),beforeOrgs);
   });
  });

  await t.test('(나) 프로필 소속·부서·직책 비우기',async t2=>{
   const version='20261126202000',stem=version+'_profile_affiliation_clear';
   const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
   const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
   const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
   const run=(mode,rid)=>runMigrationPlan(plan(mode,rid),query,{saveSnapshot:async()=>{}});
   const state=async()=>(await pool.query('select user_id,display_name,job_title,union_name,department_name,view_prefs from public.app_profiles order by user_id')).rows;
   const beforeRows=await state(),before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows,pre=items(beforeCheck);

   await t2.test('precheck counts only',()=>{
    assert.equal(pre['profiles to clear'],'2');assert.equal(pre['union names'],'1');assert.equal(pre['department names'],'1');assert.equal(pre['job titles'],'2');
    assert.equal(pre['collab member titles'],'1');assert.equal(pre['three columns nullable text'],'예');assert.equal(pre['anon or public table privilege'],'아니오');
    assert.ok(beforeCheck.every(r=>/^(예|아니오|\d+|[0-9a-f]{32})$/.test(r.value)),JSON.stringify(beforeCheck));
   });
   await t2.test('static plan accepts dry-run and apply',()=>{
    for(const mode of ['dry-run','apply']){const p=plan(mode,'1');assert.ok(p,mode);if(p.review){assert.equal(p.review.grants||0,0);assert.equal(p.review.policies||0,0);assert.equal(p.review.triggers||0,0)}}
   });
   await t2.test('dry-run leaves profiles unchanged',async()=>{
    const dry=await run('dry-run','9941');assert.equal(dry.ok,true,dry.summary);
    assert.deepEqual(await state(),beforeRows);assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
   });
   await t2.test('prerequisite changes or a profile trigger touching assignees stop without any change',async()=>{
    const attempts=[
     ["delete from supabase_migrations.schema_migrations where version='20261115223000'","insert into supabase_migrations.schema_migrations(version,name) values('20261115223000','profile_union_department')",/PREREQUISITE_CHANGED/],
     ['grant select on public.app_profiles to anon','revoke select on public.app_profiles from anon',/PREREQUISITE_CHANGED/],
     ['alter table public.app_profiles disable row level security','alter table public.app_profiles enable row level security',/PREREQUISITE_CHANGED/],
     [`create function public.s71_probe() returns trigger language plpgsql as $$ begin insert into public.app_suborganization_assignees(organization_id,user_id) values ('${ORGS.free1}',new.user_id); return new; end $$;
       create trigger s71_probe after update on public.app_profiles for each row execute function public.s71_probe();`,
      'drop trigger s71_probe on public.app_profiles; drop function public.s71_probe();',/PROFILE_AFFILIATION_CLEAR_POSTCHECK_FAILED/],
    ];
    for(const [breakIt,fixIt,re] of attempts){await pool.query(breakIt);try{await mustStop(migration,re,breakIt);}finally{await pool.query(fixIt);}}
    assert.deepEqual(await state(),beforeRows);
   });
   await t2.test('apply empties the three columns for everyone; names, other columns and collab member titles stay',async()=>{
    const apply=await run('apply','9942');assert.equal(apply.ok,true,apply.summary);
    const after=await state();
    assert.deepEqual(after,beforeRows.map(r=>({...r,job_title:null,union_name:null,department_name:null})));
    assert.equal((await one('select count(*)::int n from public.app_collab_members where title is not null')).n,1);
    assert.equal((await one('select count(*)::int n from public.app_cleanup_s71_40_profiles')).n,2);
    await closed('app_cleanup_s71_40_profiles');
    const post=items((await pool.query(postcheck)).rows);
    for(const [k,v] of Object.entries(post)){if(/^(예|아니오)$/.test(v))assert.equal(v,'예',k);else assert.equal(v,pre[k],k);}
   });
   await t2.test('rollback refills only still-empty columns and drops the backup table; re-apply works',async()=>{
    await pool.query("update public.app_profiles set job_title='예시 새 직책' where user_id=$1",[STRANGER]);
    await pool.query(rollbackSQL);
    const after=await state();
    assert.deepEqual(after,beforeRows.map(r=>r.user_id===STRANGER?{...r,job_title:'예시 새 직책'}:r),'새로 적은 값은 덮지 않음');
    assert.equal((await one("select to_regclass('public.app_cleanup_s71_40_profiles') is null v")).v,true);
    assert.equal((await one("select count(*)::int n from supabase_migrations.schema_migrations where version='20261126202000'")).n,0);
    const again=await run('apply','9943');assert.equal(again.ok,true,again.summary);
    assert.equal((await one('select count(*)::int n from public.app_profiles where job_title is not null or union_name is not null or department_name is not null')).n,0);
   });
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
