// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// LIB-두칸보기(20261109193000_profile_view_prefs_library_two): app_profiles_view_prefs_check accepts
// library_two (boolean) and split_ratio.library through the approved DB workflow runner.
// - 다른 칸 규칙 그대로(앞 판 profile_view_prefs_org_row_order의 쉰두 칸을 그대로 받고, 전에 거절하던 값은 계속 거절).
// - 권한 그대로: 프로필은 내 행만, anon은 못 읽는다. 표 권한·정책 수 그대로.
// - 승인형 workflow의 plan·dry-run·apply가 통과하고, rollback은 library_two·split_ratio.library가 저장돼 있으면 멈춘 뒤 비우면 앞 판 검사와 글자 그대로 같은 모양으로 돌아간다.
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
const version='20261109193000',name='profile_view_prefs_library_two',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const OUTSIDER='20000000-0000-4000-8000-000000000003';
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// 프로필 표·운영자 허용 표는 org_order 시험(profile-view-prefs-org-order.test.mjs)과 같은 합성 모양이다.
const profiles=`
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
// 사회운동 글·뉴스 기사 표는 이 migration이 가리키는 칸(id·workspace_id)만 갖춘 합성 모양이다(운영과 같은 소유자 정책·화면 읽기 권한).
const items=`
  create table public.app_outside_posts(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id) on delete cascade, title text not null default '합성 성명');
  create table public.app_news_items(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id) on delete cascade, title text);
  alter table public.app_outside_posts enable row level security;
  alter table public.app_news_items enable row level security;
  revoke all on table public.app_outside_posts, public.app_news_items from public, anon, authenticated, service_role;
  grant select on table public.app_outside_posts, public.app_news_items to authenticated;
  grant select, insert, update, delete on table public.app_outside_posts, public.app_news_items to service_role;
  create policy outside_posts_owner_select on public.app_outside_posts for select to authenticated using (private.app_is_workspace_owner(workspace_id));
  create policy news_items_owner_all on public.app_news_items for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke usage on schema private from service_role;`;
const ITEM_STEPS=`insert into supabase_migrations.schema_migrations(version,name) values ('20261031230000','outside_statements'),('20261101233000','news_clipping');`;

const EARLIER=['20261023180000_profile_view_prefs','20261027020000_profile_view_prefs_report_view','20261027040000_profile_view_prefs_theme10',
 '20261027070000_profile_view_prefs_theme_refresh','20261028020000_profile_view_prefs_menu_home','20261028090000_profile_view_prefs_photo_cols',
 '20261028100000_profile_view_prefs_diary_view','20261028150000_profile_view_prefs_diary_onedrive','20261026140000_diary_onedrive_db','20261028010000_onedrive_photo_index',
 '20261028220000_photo_menu_index','20261029010000_profile_view_prefs_split_screens','20261029103000_profile_view_prefs_quiet_weeks','20261029183000_profile_view_prefs_note_view',
 '20261030091000_profile_view_prefs_note_boards','20261030150000_photo_sort','20261029150000_photo_tags','20261030190000_profile_view_prefs_photo_hint','20261030230000_photo_sources','20261030233000_profile_view_prefs_org_tab','20261031010000_profile_view_prefs_tg_view','20261031030000_profile_view_prefs_split_more','20261031060000_profile_view_prefs_phone_folders','20261031235000_profile_view_prefs_album_view','20261102141000_profile_view_prefs_now_tab','20261102170000_profile_view_prefs_link_hidden','20261102190000_profile_view_prefs_ed_more','20261102213000_profile_view_prefs_phone_known','20261103160000_profile_view_prefs_files_cols','20261103190000_profile_view_prefs_photo_device','20261103200000_profile_view_prefs_report_period','20261104090000_profile_view_prefs_files_sources','20261104130000_profile_view_prefs_files_dest','20261104190000_profile_view_prefs_files_two','20261104201000_profile_view_prefs_note_sort','20261104221000_profile_view_prefs_photo_zoom'];
const ORG_ORDER='20261105131500_profile_view_prefs_org_order';

const NEWS_PREFS='20261106080000_feed_reads_news_prefs';
const FILES_LOOK='20261106200000_profile_view_prefs_files_look';
const RECENT_FOLDED='20261106233000_profile_view_prefs_recent_folded';
const FILES_PANES='20261107110000_profile_view_prefs_files_panes';
const BOX_SHUT='20261107130000_profile_view_prefs_box_shut';
const TREE_PINS='20261108030000_profile_view_prefs_files_tree_pins';
const FILES_LAST='20261108060000_profile_view_prefs_files_last';
const CATEGORY_ROLES='20261108080000_profile_view_prefs_category_roles';
const ORG_ROW_ORDER='20261109150000_profile_view_prefs_org_row_order';

test('view prefs library two: plan, dry-run, apply, own-row writes, CHECK and guarded rollback',{timeout:200000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'view-prefs-library-two-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(profiles);await pool.query(items);
  for(const f of EARLIER)await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query(ITEM_STEPS);
  await pool.query(await read('supabase/migrations/'+ORG_ORDER+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const plan=(mode,id)=>prepareMigration({mode,version,runId:id,root});
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const write=(sub,user,value)=>as('authenticated',sub,c=>c.query('update public.app_profiles set view_prefs=$1::jsonb where user_id=$2',[value===null?null:JSON.stringify(value),user]));
  const saved_=async user=>(await pool.query('select view_prefs from public.app_profiles where user_id=$1',[user])).rows[0].view_prefs;
  const checkDef=async()=>(await pool.query("select pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.app_profiles'::regclass and conname='app_profiles_view_prefs_check'")).rows[0].d;
  const guardFails=async pattern=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),pattern);await c.query('rollback');}finally{c.release();}};
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));

  // 앞 판(org_row_order)까지 받던 쉰두 칸을 모두 담은 값(시험용 가짜 이름): 적용 뒤에도 통째로 받아야 한다.
  const ALL_OLD={theme:'lemon',split_ratio:{tasks:0.4,telegram:0.3,reports3:0.25,photos:0.3,noteboard:0.2,now:0.35,files:0.3},home_cards:['quiet','todo'],diary_view:'list',photo_view:{filter:'star',cols:4,sort:'name_asc'},quiet_weeks:3,note_view:'board',note_boards:[{id:'b1a2b3c4',name:'보드'}],note_board:'b1a2b3c4',photo_hint:2,photo_sources:{onedrive:true,phone:false},org_tab:'table',tg_view:'room',phone_folders_off:['DCIM/Camera/'],album_view:'thumb',now_tab:'news',collect_hidden_on:'2026-11-01',link_hidden_on:'2026-11-01',ed_more:true,
   nav_collapsed:true,calendar_view:'week',home_quick_mode:'task',note_folder:'all',report_view:'calendar',menu_layout:{bar:['home','tasks'],rest:['notes']},photo_cols:4,photo_cols_wide:8,diary_onedrive:false,
   phone_folders_known:['0123abcd'],col_widths:{files:{name:240,day:90}},photo_sources_phone:{phone:true,onedrive:false},photo_sources_pc:{onedrive:true,gdrive:false},photo_level:'month',report_period:{mode:'range',from:'2026-10-01',to:'2026-10-31'},files_sources:{app:{od:true,gd:false},pc:{gd:true}},files_dest_recent:[{source:'gd',id:'gdFolder1',name:'가짜 업무 공간'}],files_two:{pc:{fold:true}},note_sort:'manual',photo_zoom:{app:'day',pc:'year'},
   org_order:{groups:[{name:'가묶음',orgs:['가짜노조']}],hidden:['옛 가짜 조직']},report_calendar:'가짜 업무 달력',news_tab:'media',news_font:'l',
   files_look:{app:{narrow:'grid'},pc:{wide:'big'}},recent_folded:['files'],files_panes:{app:['od','ph'],pc:['pc','gd']},box_shut:{pc:{files:['od']}},
   files_tree:{app:{fold:true},pc:{wide:false}},files_pins:['od:F1','gd:x'],files_last:[{od:'F1'},{gd:'x'}],category_roles:{weekly_team:'가짜보고›팀 판'},org_row_order:'desc'};
  const RANGE={library_two:false};
  const WIDTH={split_ratio:{library:0.42}};
  const GOOD=[{library_two:true},{library_two:false},WIDTH,{library_two:false,split_ratio:{library:0.5,files:0.3}}];
  const BAD=[{library_two:'true'},{library_two:null},{library_two:[]},{library_two:{}},{library_two:1},{library_two:''},{library_two:{pc:true}},
   {split_ratio:{library:0}},{split_ratio:{library:1}},{split_ratio:{library:'0.4'}},{split_ratio:{library:-0.2}},{split_ratio:{library2:0.4}},{library_tw:true}];

  await t.test('guard: stops without changes when the org row order step is not recorded',async()=>{
   await guardFails(/PROFILE_VIEW_PREFS_LIBRARY_TWO_PREREQUISITE_CHANGED/);
   await pool.query(await read('supabase/migrations/'+NEWS_PREFS+'.sql'));
   await pool.query(await read('supabase/migrations/'+FILES_LOOK+'.sql'));
   await pool.query(await read('supabase/migrations/'+RECENT_FOLDED+'.sql'));
   await pool.query(await read('supabase/migrations/'+FILES_PANES+'.sql'));
   await guardFails(/PROFILE_VIEW_PREFS_LIBRARY_TWO_PREREQUISITE_CHANGED/);
   await pool.query(await read('supabase/migrations/'+BOX_SHUT+'.sql'));
   await pool.query(await read('supabase/migrations/'+TREE_PINS+'.sql'));
   await guardFails(/PROFILE_VIEW_PREFS_LIBRARY_TWO_PREREQUISITE_CHANGED/);
   await pool.query(await read('supabase/migrations/'+FILES_LAST+'.sql'));
   await guardFails(/PROFILE_VIEW_PREFS_LIBRARY_TWO_PREREQUISITE_CHANGED/);
   await pool.query(await read('supabase/migrations/'+CATEGORY_ROLES+'.sql'));
   await guardFails(/PROFILE_VIEW_PREFS_LIBRARY_TWO_PREREQUISITE_CHANGED/);
   await pool.query(await read('supabase/migrations/'+ORG_ROW_ORDER+'.sql'));
  });
  const prevDef=await checkDef();
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;

  await t.test('before apply the CHECK refuses library_two and split_ratio.library and accepts the old keys',async()=>{
   const v=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));
   assert.equal(v['prerequisite recorded'],'예');assert.equal(v['new migration absent'],'예');
   assert.equal(v['view prefs check without library two'],'예');assert.equal(v['saved library two'],'0');
   await assert.rejects(write(OWNER,OWNER,RANGE),{code:'23514'});await assert.rejects(write(OWNER,OWNER,WIDTH),{code:'23514'});
   assert.equal(Object.keys(ALL_OLD).length,52,'all keys of the org row order check');
   assert.equal((await write(OWNER,OWNER,ALL_OLD)).rowCount,1,'every previous key is accepted before');
   await write(OWNER,OWNER,null);
  });
  await t.test('plan accepts the migration and its companion files; summary has three lines',()=>{
   const p=plan('apply','9980');assert.ok(p&&!p.rejected,JSON.stringify(p).slice(0,300));
   assert.ok(plan('rollback','9981'));
   assert.equal(summary.trim().split('\n').length,3);
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9982');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('apply passes postcheck; grants, policies and rows unchanged',async()=>{
   const apply=await run('apply','9983');assert.equal(apply.ok,true,apply.summary);
   assert.ok((await pool.query(postcheck)).rows.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'));
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
   assert.equal((await pool.query("select relacl::text acl from pg_class where oid='public.app_profiles'::regclass")).rows[0].acl.match(/authenticated=[a-z]*/)[0],'authenticated=rw');
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid='public.app_profiles'::regclass")).rows[0].n,2);
  });
  await t.test('the owner saves library_two and split_ratio.library together with the old keys; other rows, outsiders and anon cannot',async()=>{
   assert.equal((await write(OWNER,OWNER,ALL_OLD)).rowCount,1,'every previous key is still accepted');assert.deepEqual(await saved_(OWNER),ALL_OLD);
   for(const v of GOOD){assert.equal((await write(OWNER,OWNER,v)).rowCount,1,JSON.stringify(v));assert.deepEqual(await saved_(OWNER),v);assert.equal((await write(OWNER,OWNER,{...ALL_OLD,...v,split_ratio:{...ALL_OLD.split_ratio,...(v.split_ratio||{})}})).rowCount,1,JSON.stringify(v))}
   assert.equal((await write(OWNER,STRANGER,RANGE)).rowCount,0,'another profile row is not writable');
   assert.equal((await write(OUTSIDER,OUTSIDER,RANGE)).rowCount,0,'a non-owner member cannot write even the own row');
   assert.equal(await saved_(OUTSIDER),null);
   await assert.rejects(as('anon','',c=>c.query('select view_prefs from public.app_profiles limit 1')),{code:'42501'});
  });
  await t.test('the CHECK refuses badly shaped library_two and split_ratio.library and still refuses what it refused before',async()=>{
   for(const v of BAD)await assert.rejects(write(OWNER,OWNER,v),{code:'23514'},JSON.stringify(v));
   for(const v of [{news_tab:'press'},{news_font:'xl'},{photo_zoom:{pc:'week'}},{files_two:{pc:{fold:1}}},{files_sources:{pc:{od:'yes'}}},{col_widths:{files:{day:39}}},{files_look:{pc:{wide:'g3'}}},{recent_folded:['photos']},{files_panes:{pc:['od']}},{files_panes:{pc:['od','dropbox']}},{box_shut:{pc:{files:['dropbox']}}},{files_tree:{pc:{narrow:true}}},{files_pins:['ph:x']},{files_last:[{pc:'x'}]},{theme:'dark'},{extra:'x'},[],'x'])await assert.rejects(write(OWNER,OWNER,v),{code:'23514'},JSON.stringify(v));
  });
  await t.test('rollback refuses while library_two or split_ratio.library is saved, and keeps it',async()=>{
   await write(OWNER,OWNER,RANGE);
   const result=await run('rollback','9984');assert.equal(result.ok,false,result.summary);
   const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/PROFILE_VIEW_PREFS_LIBRARY_TWO_ROLLBACK_BLOCKED: library two-pane prefs saved/);await c.query('rollback');}finally{c.release();}
   assert.deepEqual(await saved_(OWNER),RANGE);
  });
  await t.test('rollback restores the previous check word for word once no library_two remains; re-apply works',async()=>{
   await write(OWNER,OWNER,ALL_OLD);
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.equal(await checkDef(),prevDef);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await assert.rejects(write(OWNER,OWNER,RANGE),{code:'23514'});
   assert.deepEqual(await saved_(OWNER),ALL_OLD,'other saved values survive the rollback');
   const again=await run('apply','9985');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
