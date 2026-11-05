// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic(합성 글·합성 작업공간).
// S51-6 NEWS-전면개편 P4a(20261106080000_feed_reads_news_prefs): 글 읽음 표 app_feed_reads + 화면 선택 기억 검사에 news_tab·news_font.
// - 승인형 DB workflow 확장 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예. rollback 모드는 받지 않는다(SQL Editor 전용).
// - 읽음: 소유자만 넣기·읽기·지우기, 고치기 없음. 같은 글 두 번 넣으면 한 줄. 남의 글 id·남의 작업공간 거절. 글이 지워지면 함께 지워짐. anon·service_role 없음.
// - 화면 기억: 앞 판(org_order)의 마흔한 칸을 그대로 받고 news_tab·news_font만 더 받는다. 옛 now_tab 값 규칙 그대로. 전에 거절하던 값은 계속 거절.
// - 되돌리기: 줄이 있거나 두 칸을 저장한 프로필이 있으면 멈추고, 없으면 표·함수·검사·기록만 원래대로(검사 정의가 앞 판과 글자 그대로 같음).
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
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261106080000',name='feed_reads_news_prefs',stem=version+'_'+name;
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

test('feed reads + news prefs db: plan, dry-run, apply, owner-only reads, one row per item, same workspace, cascade, CHECK, SQL Editor rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'feed-reads-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(profiles);await pool.query(items);
  for(const f of EARLIER)await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const allYes=async sql=>{for(const r of await readOnly(sql))assert.equal(r.value,'예',r.item);};
  const guardFails=async pattern=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),pattern);await c.query('rollback');}finally{c.release();}};
  const writePrefs=(sub,user,value)=>as('authenticated',sub,c=>c.query('update public.app_profiles set view_prefs=$1::jsonb where user_id=$2',[value===null?null:JSON.stringify(value),user]));
  const savedPrefs=async user=>(await pool.query('select view_prefs from public.app_profiles where user_id=$1',[user])).rows[0].view_prefs;
  const checkDef=async()=>(await pool.query("select pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.app_profiles'::regclass and conname='app_profiles_view_prefs_check'")).rows[0].d;
  const ids=(await pool.query(`with p as (insert into public.app_outside_posts(workspace_id) values ($1),($1),($2) returning id,workspace_id),
    n as (insert into public.app_news_items(workspace_id,title) values ($1,'합성 기사'),($2,'남의 기사') returning id,workspace_id)
    select (select id from p where workspace_id=$1 order by id limit 1) pa0,(select id from p where workspace_id=$1 order by id offset 1 limit 1) pa1,(select id from p where workspace_id=$2) pb,
           (select id from n where workspace_id=$1) na,(select id from n where workspace_id=$2) nb`,[WS_A,WS_B])).rows[0];
  const markPost=(c,ws,post)=>c.query('insert into public.app_feed_reads(workspace_id,outside_post_id) values ($1,$2) on conflict (outside_post_id) do nothing',[ws,post]);
  const markNews=(c,ws,item)=>c.query('insert into public.app_feed_reads(workspace_id,news_item_id) values ($1,$2) on conflict (news_item_id) do nothing',[ws,item]);
  const count=async()=>(await pool.query('select count(*)::int n from public.app_feed_reads')).rows[0].n;

  // org_order 판까지 받던 마흔한 칸을 모두 담은 값(시험용 가짜 이름): 적용 뒤에도 통째로 받아야 한다(앞 판 키가 다 남는지).
  const ALL_OLD={theme:'lemon',split_ratio:{tasks:0.4,telegram:0.3,reports3:0.25,photos:0.3,noteboard:0.2,now:0.35},home_cards:['quiet','todo'],diary_view:'list',photo_view:{filter:'star',cols:4,sort:'name_asc'},quiet_weeks:3,note_view:'board',note_boards:[{id:'b1a2b3c4',name:'보드'}],note_board:'b1a2b3c4',photo_hint:2,photo_sources:{onedrive:true,phone:false},org_tab:'table',tg_view:'room',phone_folders_off:['DCIM/Camera/'],album_view:'thumb',now_tab:'news',collect_hidden_on:'2026-11-01',link_hidden_on:'2026-11-01',ed_more:true,
   nav_collapsed:true,calendar_view:'week',home_quick_mode:'task',note_folder:'all',report_view:'calendar',menu_layout:{bar:['home','tasks'],rest:['notes']},photo_cols:4,photo_cols_wide:8,diary_onedrive:false,
   phone_folders_known:['0123abcd'],col_widths:{files:{name:240,day:90}},photo_sources_phone:{phone:true,onedrive:false},photo_sources_pc:{onedrive:true,gdrive:false},photo_level:'month',report_period:{mode:'range',from:'2026-10-01',to:'2026-10-31'},files_sources:{app:{od:true,gd:false},pc:{gd:true}},files_dest_recent:[{source:'gd',id:'gdFolder1',name:'가짜 업무 공간'}],files_two:{pc:{fold:true}},note_sort:'manual',photo_zoom:{app:'day',pc:'year'},
   org_order:{groups:[{name:'가묶음',orgs:['가짜노조']}],hidden:['옛 가짜 조직']},report_calendar:'가짜 업무 달력'};
  const NEWS_GOOD=[{news_tab:'all'},{news_tab:'movement'},{news_tab:'media'},{news_tab:'archive'},{news_font:'s'},{news_font:'m'},{news_font:'l'},{news_tab:'media',news_font:'l',now_tab:'saved'}];
  const NEWS_BAD=[{news_tab:'press'},{news_tab:'saved'},{news_tab:'outside'},{news_tab:''},{news_tab:1},{news_tab:null},{news_tab:['all']},{news_tab:'ALL'},
   {news_font:'xl'},{news_font:'S'},{news_font:''},{news_font:2},{news_font:null},{news_font:true},{news_font:{s:1}}];

  await t.test('guard: stops without changes when the outside/news DB steps or the org_order view prefs step are not recorded',async()=>{
   await guardFails(/FEED_READS_NEWS_PREFS_PREREQUISITE_CHANGED/);
   await pool.query(ITEM_STEPS);
   await guardFails(/FEED_READS_NEWS_PREFS_PREREQUISITE_CHANGED/);
   assert.equal((await pool.query("select to_regclass('public.app_feed_reads') t")).rows[0].t,null);
   await pool.query(await read('supabase/migrations/'+ORG_ORDER+'.sql'));
  });
  const orgOrderDef=await checkDef();
  await writePrefs(OWNER,OWNER,ALL_OLD);
  const before=(await pool.query(snapshot)).rows;

  await t.test('files: expanded rules, full flow, one new table and one invoker guard, rollback mode refused, summary 3 lines, snapshot reads catalogs only',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const sql of [precheck,postcheck,snapshot,rollbackSQL,migration])assert.doesNotMatch(sql.replace(/--.*$/gm,''),/information_schema/i);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.flow,'full');assert.equal(plan.rules,'expanded');
    assert.deepEqual([...plan.createdTables],['app_feed_reads']);
    assert.deepEqual([...plan.functions],['private.app_feed_reads_scope_guard']);
    assert.deepEqual(plan.review.definer,[]);
   }
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bto (anon|public)\b|disable row level security|alter policy|drop policy|security definer|rtw_|grant usage on schema|to service_role/i);
   assert.doesNotMatch(code,/alter table public\.app_(outside_posts|news_items|now_signals)|on public\.app_(outside_posts|news_items|now_signals|profiles)\b/i,'existing tables untouched');
   assert.doesNotMatch(code,/update public\.app_profiles/i,'no profile row change');
   assert.doesNotMatch(code,/2026110604|2026110605|2026110607/,'no dependency on P1/P2 steps');
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id in the migration');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261106080000', 'feed_reads_news_prefs'/);
   assert.match(rollbackSQL,/SQL Editor\(폰 경로 C\) 전용/);
   assert.match(rollbackSQL,/FEED_READS_NEWS_PREFS_ROLLBACK_BLOCKED: rows exist/);
   assert.match(rollbackSQL,/FEED_READS_NEWS_PREFS_ROLLBACK_BLOCKED: saved news prefs exist/);
  });

  await t.test('before apply: the CHECK refuses the new keys and accepts all old keys',async()=>{
   assert.equal(Object.keys(ALL_OLD).length,41,'all keys of the org_order check');
   for(const v of NEWS_GOOD.slice(0,7))await assert.rejects(writePrefs(STRANGER,STRANGER,v),{code:'23514'},JSON.stringify(v));
   assert.deepEqual(await savedPrefs(OWNER),ALL_OLD);
  });

  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(await readOnly(precheck));
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.match(v['view prefs check definition hash'],/^[0-9a-f]{32}:length=\d+$/);
   assert.ok(before.some(r=>r.kind==='profiles constraint'&&r.name==='app_profiles_view_prefs_check'&&r.definition.startsWith('md5:'+v['view prefs check definition hash'].split(':')[0])),'precheck hash = snapshot hash');
   for(const r of before)assert.ok(String(r.definition).length<=8192,r.name);
   await allYes(postcheck);
   const dry=await run('dry-run','9991');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9992');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.equal((await run('apply','9993')).ok,false);
   assert.deepEqual(await savedPrefs(OWNER),ALL_OLD,'profile rows unchanged');
  });

  await t.test('view prefs: every old key still accepted, news_tab and news_font accepted, bad values and old refusals still refused',async()=>{
   for(const v of NEWS_GOOD){
    assert.equal((await writePrefs(STRANGER,STRANGER,v)).rowCount,1,JSON.stringify(v));assert.deepEqual(await savedPrefs(STRANGER),v);
    assert.equal((await writePrefs(STRANGER,STRANGER,{...ALL_OLD,...v})).rowCount,1,'with all old keys '+JSON.stringify(v));
   }
   for(const v of NEWS_BAD)await assert.rejects(writePrefs(STRANGER,STRANGER,v),{code:'23514'},JSON.stringify(v));
   for(const v of [{now_tab:'all'},{now_tab:'media'},{photo_zoom:{pc:'week'}},{theme:'dark'},{extra:'x'},{split_ratio:{news:0.5}},[],'x'])
    await assert.rejects(writePrefs(STRANGER,STRANGER,v),{code:'23514'},JSON.stringify(v));
   for(const v of ['outside','news','saved','search'])assert.equal((await writePrefs(STRANGER,STRANGER,{now_tab:v})).rowCount,1,'old now_tab '+v);
   assert.equal((await writePrefs(STRANGER,OWNER,{news_tab:'all'})).rowCount,0,'another profile row is not writable');
   assert.equal((await writePrefs(OUTSIDER,OUTSIDER,{news_tab:'all'})).rowCount,0,'a non-owner member cannot write');
   assert.ok((await checkDef()).length>orgOrderDef.length,'only added');
  });

  await t.test('shape: columns, one item exactly, unique per item, cascade foreign keys',async()=>{
   const cols=(await pool.query("select attname from pg_attribute where attrelid='public.app_feed_reads'::regclass and attnum>0 and not attisdropped order by attnum")).rows.map(r=>r.attname);
   assert.deepEqual(cols,['id','workspace_id','outside_post_id','news_item_id','read_at']);
   await assert.rejects(pool.query('insert into public.app_feed_reads(workspace_id) values ($1)',[WS_A]),{code:'23514'},'no item');
   await assert.rejects(pool.query('insert into public.app_feed_reads(workspace_id,outside_post_id,news_item_id) values ($1,$2,$3)',[WS_A,ids.pa0,ids.na]),{code:'23514'},'two items');
   await assert.rejects(pool.query('insert into public.app_feed_reads(workspace_id,outside_post_id) values ($1,gen_random_uuid())',[WS_A]),{code:'23514'},'missing post (guard first)');
  });

  await t.test('owner: mark read twice = one row, read own, unmark; no update; other workspace item or workspace refused',async()=>{
   await owner(c=>markPost(c,WS_A,ids.pa0));
   await owner(c=>markPost(c,WS_A,ids.pa0));
   await owner(c=>markPost(c,WS_A,ids.pa1));
   await owner(c=>markNews(c,WS_A,ids.na));
   await owner(c=>markNews(c,WS_A,ids.na));
   assert.equal(await count(),3,'same item twice = one row');
   await assert.rejects(pool.query('insert into public.app_feed_reads(workspace_id,news_item_id) values ($1,$2)',[WS_A,ids.na]),{code:'23505'},'unique per item');
   assert.equal((await owner(c=>c.query('select count(*)::int n from public.app_feed_reads'))).rows[0].n,3);
   assert.equal((await owner(c=>c.query("select count(*)::int n from public.app_feed_reads where read_at > now() - interval '1 minute'"))).rows[0].n,3,'read_at default');
   await assert.rejects(owner(c=>c.query("update public.app_feed_reads set read_at=now()")),{code:'42501'},'no update');
   await assert.rejects(owner(c=>c.query("insert into public.app_feed_reads(workspace_id,outside_post_id,read_at) values ($1,$2,now())",[WS_A,ids.pa1])),{code:'42501'},'read_at default only');
   await assert.rejects(owner(c=>c.query("insert into public.app_feed_reads(id,workspace_id,outside_post_id) values (gen_random_uuid(),$1,$2)",[WS_A,ids.pa1])),{code:'42501'},'id default only');
   // 남의 글 id로 내 작업공간 줄 → 트리거가 거절(남의 읽음 표시를 막지 못함). 남의 작업공간 줄 → 정책이 거절.
   await assert.rejects(owner(c=>markPost(c,WS_A,ids.pb)),{code:'23514'},'other workspace post');
   await assert.rejects(owner(c=>markNews(c,WS_A,ids.nb)),{code:'23514'},'other workspace news item');
   await assert.rejects(owner(c=>markNews(c,WS_B,ids.nb)),/FEED_READ_SCOPE|row-level security/,'other workspace row');
   await assert.rejects(owner(c=>markPost(c,WS_B,ids.pa1)),/FEED_READ_SCOPE|row-level security/,'own post into other workspace');
   assert.equal(await count(),3);
   await stranger(c=>markNews(c,WS_B,ids.nb));
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_feed_reads'))).rows[0].n,1,'stranger sees own only');
   assert.equal((await stranger(c=>c.query('delete from public.app_feed_reads where outside_post_id=$1',[ids.pa0]))).rowCount,0,'cannot unmark others');
   assert.equal((await owner(c=>c.query('delete from public.app_feed_reads where outside_post_id=$1',[ids.pa1]))).rowCount,1,'unmark own');
   assert.equal(await count(),3);
  });

  await t.test('anon and service_role: nothing; only the guard names the table and nobody executes it',async()=>{
   await assert.rejects(anon(c=>c.query('select 1 from public.app_feed_reads')),{code:'42501'});
   await assert.rejects(anon(c=>markPost(c,WS_A,ids.pa1)),{code:'42501'});
   await assert.rejects(server(c=>c.query('select 1 from public.app_feed_reads')),{code:'42501'});
   const fns=(await pool.query("select p.oid::regprocedure::text f from pg_proc p where p.prosrc ~ 'app_feed_reads'")).rows.map(r=>r.f);
   assert.deepEqual(fns,[]);
   for(const role of ['authenticated','anon','service_role'])
    assert.equal((await pool.query("select has_function_privilege($1,'private.app_feed_reads_scope_guard()','execute') x",[role])).rows[0].x,false,role);
   assert.equal((await pool.query("select count(*)::int n from pg_views where definition ~ 'app_feed_reads'")).rows[0].n,0);
  });

  await t.test('cascade: deleting the post or news item removes its read row',async()=>{
   await pool.query('delete from public.app_news_items where id=$1',[ids.nb]);
   await pool.query('delete from public.app_outside_posts where id=$1',[ids.pa0]);
   assert.equal(await count(),1);
  });

  await t.test('rollback (SQL Editor): blocked while rows or saved news prefs exist; then restores table, function, CHECK text and record; re-apply works',async()=>{
   const blocked=async pattern=>{const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),pattern);await c.query('rollback');}finally{c.release();}};
   await writePrefs(STRANGER,STRANGER,{news_tab:'media'});
   await blocked(/FEED_READS_NEWS_PREFS_ROLLBACK_BLOCKED: rows exist/);
   await pool.query('delete from public.app_feed_reads');
   await blocked(/FEED_READS_NEWS_PREFS_ROLLBACK_BLOCKED: saved news prefs exist/);
   assert.notEqual((await pool.query("select to_regclass('public.app_feed_reads') t")).rows[0].t,null);
   await writePrefs(STRANGER,STRANGER,null);
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal(await checkDef(),orgOrderDef,'CHECK is the org_order text again');
   await allYes(postcheck);
   assert.equal(values(await readOnly(precheck))['new migration absent'],'예');
   assert.deepEqual(await savedPrefs(OWNER),ALL_OLD,'other saved values survive');
   assert.equal((await pool.query('select count(*)::int n from public.app_outside_posts')).rows[0].n,2,'posts untouched');
   await assert.rejects(writePrefs(STRANGER,STRANGER,{news_tab:'all'}),{code:'23514'});
   const again=await run('apply','9994');assert.equal(again.ok,true,again.summary);
   await allYes(postcheck);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
