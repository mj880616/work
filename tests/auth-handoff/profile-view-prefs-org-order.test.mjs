// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S50-13 MULTI-노조사용자 ②-3(D5): app_profiles_view_prefs_check accepts org_order (담당조직 묶음·순서·고르기에서 뺄 조직) and report_calendar,
// and the same migration moves the values that were in the screen code into the operator (calls workspace owner) profile only.
// - 다른 칸 규칙 그대로(앞 판 photo_zoom의 서른아홉 칸을 그대로 받고, 전에 거절하던 값은 계속 거절).
// - 권한 그대로: 프로필은 내 행만, anon은 못 읽는다. 표 권한·정책 수 그대로. 다른 사람 프로필은 비어 있음.
// - 승인형 workflow의 plan·dry-run·apply가 통과한다. rollback은 프로필 값을 지우는 update가 있어 SQL Editor 전용이고, 두 칸만 지운 뒤 원래 검사로 돌아간다.
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
const version='20261105131500',name='profile_view_prefs_org_order',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const OUTSIDER='20000000-0000-4000-8000-000000000003';
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

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
  create table public.app_operator_features(workspace_id uuid not null, feature text not null);
  alter table public.app_operator_features enable row level security;
  revoke all on public.app_operator_features from public, anon, authenticated;
  insert into public.app_operator_features values ('${WS_A}','calls'),('${WS_B}','family');
  insert into supabase_migrations.schema_migrations(version,name) values('20261018112943','doc_categories_profile'),('20261022163000','profile_quick_links'),('20261023150000','profile_library_view');
`;

const EARLIER=['20261023180000_profile_view_prefs','20261027020000_profile_view_prefs_report_view','20261027040000_profile_view_prefs_theme10',
 '20261027070000_profile_view_prefs_theme_refresh','20261028020000_profile_view_prefs_menu_home','20261028090000_profile_view_prefs_photo_cols',
 '20261028100000_profile_view_prefs_diary_view','20261028150000_profile_view_prefs_diary_onedrive','20261026140000_diary_onedrive_db','20261028010000_onedrive_photo_index',
 '20261028220000_photo_menu_index','20261029010000_profile_view_prefs_split_screens','20261029103000_profile_view_prefs_quiet_weeks','20261029183000_profile_view_prefs_note_view',
 '20261030091000_profile_view_prefs_note_boards','20261030150000_photo_sort','20261029150000_photo_tags','20261030190000_profile_view_prefs_photo_hint','20261030230000_photo_sources','20261030233000_profile_view_prefs_org_tab','20261031010000_profile_view_prefs_tg_view','20261031030000_profile_view_prefs_split_more','20261031060000_profile_view_prefs_phone_folders','20261031235000_profile_view_prefs_album_view','20261102141000_profile_view_prefs_now_tab','20261102170000_profile_view_prefs_link_hidden','20261102190000_profile_view_prefs_ed_more','20261102213000_profile_view_prefs_phone_known','20261103160000_profile_view_prefs_files_cols','20261103190000_profile_view_prefs_photo_device','20261103200000_profile_view_prefs_report_period','20261104090000_profile_view_prefs_files_sources','20261104130000_profile_view_prefs_files_dest','20261104190000_profile_view_prefs_files_two','20261104201000_profile_view_prefs_note_sort','20261104221000_profile_view_prefs_photo_zoom'];

test('view prefs org order (MULTI 2-3): plan, dry-run, apply moves the operator values only, CHECK, SQL Editor rollback',{timeout:150000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'view-prefs-org-order-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  await pool.query(prerequisites);
  for(const f of EARLIER)await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const rollbackSQL=await read('docs/'+stem+'.rollback.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  const saveSnapshot=async()=>{};
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const write=(sub,user,value)=>as('authenticated',sub,c=>c.query('update public.app_profiles set view_prefs=$1::jsonb where user_id=$2',[value===null?null:JSON.stringify(value),user]));
  const saved_=async user=>(await pool.query('select view_prefs from public.app_profiles where user_id=$1',[user])).rows[0].view_prefs;
  const base={theme:'lemon',split_ratio:{tasks:0.4,telegram:0.3,reports3:0.25,photos:0.3,noteboard:0.2},home_cards:['quiet','todo'],diary_view:'list',photo_view:{filter:'star',cols:4,sort:'name_asc'},quiet_weeks:3,note_view:'board',note_boards:[{id:'b1a2b3c4',name:'보드'}],note_board:'b1a2b3c4',photo_hint:2,photo_sources:{onedrive:true,phone:false},org_tab:'table',tg_view:'room',phone_folders_off:['DCIM/Camera/'],album_view:'thumb',now_tab:'news',collect_hidden_on:'2026-11-01',link_hidden_on:'2026-11-01',ed_more:true};
  // 앞 판(20261104221000)까지 받던 서른아홉 칸을 모두 담은 값: 적용 뒤에도 통째로 받아야 한다(앞 판 키가 다 남는지, V49 교훈).
  const ALL_OLD={...base,nav_collapsed:true,calendar_view:'week',home_quick_mode:'task',note_folder:'all',report_view:'calendar',menu_layout:{bar:['home','tasks'],rest:['notes']},photo_cols:4,photo_cols_wide:8,diary_onedrive:false,
   phone_folders_known:['0123abcd'],col_widths:{files:{name:240,day:90}},photo_sources_phone:{phone:true,onedrive:false},photo_sources_pc:{onedrive:true,gdrive:false},photo_level:'month',report_period:{mode:'range',from:'2026-10-01',to:'2026-10-31'},files_sources:{app:{od:true,gd:false},pc:{gd:true}},files_dest_recent:[{source:'gd',id:'gdFolder1',name:'가짜 업무 공간'}],files_two:{pc:{fold:true}},note_sort:'manual',photo_zoom:{app:'day',pc:'year'}};
  // 시험용 가짜 이름(실제 조직 이름 아님).
  const MINE={org_order:{groups:[{name:'가묶음',orgs:['가짜노조','나짜지부']},{name:'나묶음',orgs:['다짜지부']}],hidden:['옛 가짜 조직']},report_calendar:'가짜 업무 달력'};
  const GOOD=[MINE,{org_order:{groups:[],hidden:[]}},{report_calendar:'가'.repeat(60)},{org_order:{groups:Array(12).fill({name:'a'.repeat(20),orgs:['b']}),hidden:[]}},{org_order:{groups:[{name:'가'.repeat(20),orgs:['가'.repeat(60)]}],hidden:['가'.repeat(60)]}},{org_order:{groups:[{name:'a',orgs:Array(40).fill('b')}],hidden:Array(40).fill('x')}}];
  const BAD=[{org_order:[]},{org_order:null},{org_order:'x'},{org_order:{groups:[]}},{org_order:{hidden:[]}},{org_order:{groups:[],hidden:[],x:1}},{org_order:{groups:{},hidden:[]}},{org_order:{groups:[],hidden:'a'}},
   {org_order:{groups:Array(13).fill({name:'a',orgs:['b']}),hidden:[]}},{org_order:{groups:[],hidden:Array(41).fill('x')}},{org_order:{groups:['a'],hidden:[]}},{org_order:{groups:[{name:'a'}],hidden:[]}},{org_order:{groups:[{orgs:['a']}],hidden:[]}},
   {org_order:{groups:[{name:'a',orgs:['b'],x:1}],hidden:[]}},{org_order:{groups:[{name:'',orgs:['b']}],hidden:[]}},{org_order:{groups:[{name:'a'.repeat(21),orgs:['b']}],hidden:[]}},{org_order:{groups:[{name:1,orgs:['b']}],hidden:[]}},
   {org_order:{groups:[{name:'a',orgs:[]}],hidden:[]}},{org_order:{groups:[{name:'a',orgs:Array(41).fill('b')}],hidden:[]}},{org_order:{groups:[{name:'a',orgs:'b'}],hidden:[]}},{org_order:{groups:[{name:'a',orgs:[1]}],hidden:[]}},
   {org_order:{groups:[{name:'a',orgs:['']}],hidden:[]}},{org_order:{groups:[{name:'a',orgs:['가'.repeat(61)]}],hidden:[]}},{org_order:{groups:[{name:'a',orgs:[['b']]}],hidden:[]}},{org_order:{groups:[{name:'a\nb',orgs:['b']}],hidden:[]}},
   {org_order:{groups:[],hidden:['a\tb']}},{org_order:{groups:[],hidden:[1]}},{org_order:{groups:[],hidden:['']}},
   {report_calendar:''},{report_calendar:1},{report_calendar:null},{report_calendar:['a']},{report_calendar:'가'.repeat(61)},{report_calendar:'a\nb'}];

  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;
  const value=name=>beforeCheck.find(r=>r.item===name)?.value;
  await t.test('before apply: the CHECK refuses the new keys and accepts all old keys; the operator profile is found',async()=>{
   for(const name of ['prerequisite recorded','new migration absent','view prefs check without org order','operator profile exactly one','operator profile has room','RLS enabled','two owner policies'])assert.equal(value(name),'예',name);
   assert.equal(value('saved org order or report calendar'),'0');
   assert.equal(value('anon or public table privilege'),'아니오');
   await assert.rejects(write(STRANGER,STRANGER,MINE),{code:'23514'});
   assert.equal((await write(OWNER,OWNER,ALL_OLD)).rowCount,1,'every previous key is accepted before');
  });
  await t.test('plan accepts apply and dry-run; the rollback file is SQL Editor only (profile update)',()=>{
   const p=plan('apply','9980');assert.ok(p&&!p.rejected,JSON.stringify(p).slice(0,300));
   assert.ok(plan('dry-run','9981'));
   assert.throws(()=>plan('rollback','9982'));
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9983');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
   assert.deepEqual(await saved_(OWNER),ALL_OLD);
  });
  await t.test('apply passes postcheck; only the operator profile gets the values, merged with what it had',async()=>{
   const apply=await run('apply','9984');assert.equal(apply.ok,true,apply.summary);
   assert.ok((await pool.query(postcheck)).rows.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'));
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
   const mine=await saved_(OWNER);
   for(const [k,v] of Object.entries(ALL_OLD))assert.deepEqual(mine[k],v,'kept '+k);
   assert.equal(mine.org_order.groups.length,4);assert.deepEqual(mine.org_order.groups.map(g=>g.orgs.length),[1,4,4,4]);assert.equal(mine.org_order.hidden.length,1);
   assert.equal(typeof mine.report_calendar,'string');
   assert.equal(await saved_(STRANGER),null,'another workspace owner is untouched');
   assert.equal(await saved_(OUTSIDER),null);
   assert.equal((await pool.query("select relacl::text acl from pg_class where oid='public.app_profiles'::regclass")).rows[0].acl.match(/authenticated=[a-z]*/)[0],'authenticated=rw');
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid='public.app_profiles'::regclass")).rows[0].n,2);
  });
  await t.test('own-row writes: new keys with all old keys; not another row, not a non-owner member, not anon',async()=>{
   assert.equal(Object.keys(ALL_OLD).length,39,'all keys of the previous check');
   for(const v of GOOD){assert.equal((await write(STRANGER,STRANGER,v)).rowCount,1,JSON.stringify(v).slice(0,80));assert.deepEqual(await saved_(STRANGER),v);assert.equal((await write(STRANGER,STRANGER,{...ALL_OLD,...v})).rowCount,1,JSON.stringify(v).slice(0,80))}
   assert.equal((await write(STRANGER,OWNER,MINE)).rowCount,0,'another profile row is not writable');
   assert.equal((await write(OUTSIDER,OUTSIDER,MINE)).rowCount,0,'a non-owner member cannot write even the own row');
   await assert.rejects(as('anon','',c=>c.query('select view_prefs from public.app_profiles limit 1')),{code:'42501'});
  });
  await t.test('the CHECK refuses badly shaped new keys and still refuses what it refused before',async()=>{
   for(const v of BAD)await assert.rejects(write(STRANGER,STRANGER,v),{code:'23514'},JSON.stringify(v).slice(0,80));
   for(const v of [{photo_zoom:{pc:'week'}},{photo_level:'week'},{files_two:{pc:{fold:1}}},{theme:'dark'},{extra:'x'},[],'x'])await assert.rejects(write(STRANGER,STRANGER,v),{code:'23514'},JSON.stringify(v));
  });
  await t.test('rollback (SQL Editor) removes only the two keys and restores the previous CHECK; re-apply works',async()=>{
   await write(STRANGER,STRANGER,{...base,...MINE});
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(await saved_(STRANGER),base,'other saved values survive the rollback');
   assert.deepEqual(await saved_(OWNER),ALL_OLD,'the operator keeps every other value');
   await assert.rejects(write(STRANGER,STRANGER,MINE),{code:'23514'});
   assert.deepEqual((await pool.query(precheck)).rows,beforeCheck,'precheck is as before');
   const again=await run('apply','9985');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
