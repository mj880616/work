// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic.
// S67-53 참고 묶음 처음 3개 정리(docs/ops/ref-bundle-seed-cleanup.{precheck,apply,rollback}.sql):
// 2026-10-23 migration(20261023231500_ref_bundle_db)이 모든 작업공간에 넣은 'A노조'·'공공기관사업(본부)'·'기타 조직' 중
// 운영자 허용 표(app_operator_features)에 없는 작업공간의, 연결된 기록이 없는 것만 지운다. 운영자 작업공간·연결 있는 묶음·다른 이름 묶음은 그대로.
// precheck는 조회 전용 역할로 개수만, apply는 백업 표(권한 없음)에 남기고, rollback은 같은 id·이름·순서로 되살린다.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,PROJECT_B,MEETING_A,MEETING_B} from './basket4-fixture.mjs';
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const WS_C='21000000-0000-4000-8000-000000000003',THIRD='20000000-0000-4000-8000-000000000003';
const SEED=['A노조','공공기관사업(본부)','기타 조직'];
const NOTE_AT='2026-10-23T01:02:03.123456Z';

// ref-bundle-db.test.mjs와 같은 운영 모양 선행 사슬(그 migration이 20261023023500 위에 선다).
const spaces=`create table public.app_documents(id uuid primary key, workspace_id uuid);
  alter table public.app_spaces add column owner_id uuid default '${OWNER}', add column name text, add column parent_id uuid,
    add column status text default 'active', add column metadata jsonb default '{"project_system":"v2"}';
  grant select, update on public.app_spaces to authenticated; alter table public.app_spaces enable row level security;
  create policy spaces_owner on public.app_spaces for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));`;
const meetings=`
  alter table public.app_meetings
    add column series_name text, add column project_id uuid references public.app_spaces(id) on delete set null,
    add column created_at timestamptz not null default now(), add column updated_at timestamptz not null default now();
  alter table public.app_meetings enable row level security;
  create policy task12a_owner_all on public.app_meetings for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke all on public.app_meetings from public, anon, authenticated, service_role;
  grant select, insert, update, delete on public.app_meetings to authenticated, service_role;
  create function private.app_touch_meeting() returns trigger language plpgsql as $$ begin new.updated_at = clock_timestamp(); return new; end $$;
  create trigger app_meetings_touch before update on public.app_meetings for each row execute function private.app_touch_meeting();
  update public.app_meetings set project_id='${PROJECT_A}' where id='${MEETING_A}';
  update public.app_meetings set project_id='${PROJECT_B}' where id='${MEETING_B}';
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
// 셋째 작업공간(다른 테스터): migration 전에 있어야 처음 3개가 들어간다.
const third=`insert into public.app_workspaces values ('${WS_C}');
  insert into public.app_workspace_members values ('${WS_C}', '${THIRD}', 'owner');`;
// 운영자 허용 표: 운영(20261029090000_operator_features)과 같은 모양(RLS 켬, 정책·API 권한 없음). WS_B를 운영자 작업공간으로 둔다.
const operator=`create table public.app_operator_features (
    workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
    feature text not null, created_at timestamptz not null default now(),
    constraint app_operator_features_pkey primary key (workspace_id, feature),
    constraint app_operator_features_feature_check check (feature in ('calls', 'telegram')));
  alter table public.app_operator_features enable row level security;
  revoke all on table public.app_operator_features from public, anon, authenticated, service_role;
  insert into public.app_operator_features (workspace_id, feature) values ('${WS_B}', 'calls'), ('${WS_B}', 'telegram');`;

test('ref bundle seed cleanup: counts-only precheck, guarded apply, operator and linked bundles kept, rollback restores',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'ref-seed-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  for(const file of ['20260927103344_task_impl2_notes_record_links.sql','20260928123601_task_meeting_followup_record_links.sql'])await pool.query(await read('supabase/migrations/'+file));
  await pool.query(spaces);
  for(const file of ['20261010120000_basket1_notes_links.sql','20261011180000_basket4a_confirm_links.sql','20261012100000_basket_link_view_db.sql'])await pool.query(await read('supabase/migrations/'+file));
  await pool.query(meetings);
  await pool.query(await read('supabase/migrations/20261023023500_bizreport_meeting_links.sql'));
  await pool.query(third);
  await pool.query(await read('supabase/migrations/20261023231500_ref_bundle_db.sql'));
  await pool.query(operator);
  const [precheck,apply,rollback]=await Promise.all(['precheck','apply','rollback'].map(k=>read('docs/ops/ref-bundle-seed-cleanup.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const last=r=>{const list=Array.isArray(r)?r:[r];return list.filter(x=>x.rows?.length).at(-1)?.rows||[];};
  const run=async sql=>last(await pool.query(sql));
  const stops=async(sql,pattern)=>{const c=await pool.connect();try{await assert.rejects(c.query(sql),pattern);await c.query('rollback');}finally{c.release();}};
  const bundles=async()=>(await pool.query('select id,workspace_id,name,sort_order,created_at,updated_at from public.app_reference_bundles order by workspace_id,sort_order,name')).rows;
  const names=async ws=>(await pool.query('select name from public.app_reference_bundles where workspace_id=$1 order by sort_order,name',[ws])).rows.map(r=>r.name);
  const bundleId=async(ws,n)=>(await pool.query('select id from public.app_reference_bundles where workspace_id=$1 and name=$2',[ws,n])).rows[0].id;
  const num=row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,typeof v==='string'&&/^\d+$/.test(v)?Number(v):v]));

  // 준비: 테스터 WS_A의 '기타 조직'에 참고 연결 하나(앱 저장 함수로), 직접 만든 다른 이름 묶음 하나. WS_C는 처음 3개 그대로.
  const noteId=(await pool.query("insert into public.app_notes(workspace_id,raw_text,updated_at) values ($1,'합성 메모',$2) returning id",[WS_A,NOTE_AT])).rows[0].id;
  const linked=await bundleId(WS_A,'기타 조직');
  const made=await as('authenticated',OWNER,async c=>(await c.query("select public.app_basket_confirm_links($1,$2,$3::jsonb) r",[noteId,NOTE_AT,JSON.stringify([{kind:'reference',target_id:linked,reason:'합성'}])])).rows[0].r);
  assert.deepEqual(made,{ok:true,created:1,existing:0});
  await pool.query("insert into public.app_reference_bundles(workspace_id,name,sort_order) values ($1,'합성 내 묶음',40)",[WS_A]);
  const linksBefore=(await pool.query('select count(*)::int n from public.app_record_links')).rows[0].n;
  const snapshot=await bundles();

  await t.test('precheck as the read-only role: counts only, no names or ids',async()=>{
   const rows=await readOnly(precheck);assert.equal(rows.length,1);const v=num(rows[0]);
   assert.equal(v.ok_migration_applied,true);assert.equal(v.ok_operator_rows_present,true);assert.equal(v.ok_backup_absent,true);
   assert.deepEqual([v.operator_workspaces,v.delete_targets,v.delete_target_workspaces,v.kept_with_links,v.operator_bundles_untouched,v.backup_rows,v.backup_tables],[1,5,2,1,3,0,0]);
   const shown=JSON.stringify(rows);for(const word of [...SEED,'합성',WS_A,WS_B,WS_C])assert.ok(!shown.includes(word),word);
  });

  await t.test('apply stops before any change when the operator table is empty',async()=>{
   await pool.query('alter table public.app_operator_features rename to app_operator_features_hold');
   await pool.query('create table public.app_operator_features (like public.app_operator_features_hold including all)');
   await stops(apply,/REF_BUNDLE_SEED_CLEANUP_PREREQUISITE_CHANGED/);
   await pool.query('drop table public.app_operator_features');await pool.query('alter table public.app_operator_features_hold rename to app_operator_features');
   assert.deepEqual(await bundles(),snapshot);
   assert.equal((await pool.query("select to_regclass('ops_backup.s67_53_ref_bundle_seed') r")).rows[0].r,null);
  });

  await t.test('apply: only unlinked seed bundles of non-operator workspaces are removed; result is counts',async()=>{
   const result=num((await run(apply))[0]);
   assert.deepEqual(result,{deleted:5,kept_with_links:1,operator_bundles_untouched:3});
   assert.deepEqual(await names(WS_B),SEED); // 운영자 작업공간 그대로
   assert.deepEqual(await names(WS_A),['기타 조직','합성 내 묶음']); // 연결 있는 묶음·다른 이름 묶음은 남음
   assert.deepEqual(await names(WS_C),[]);
   assert.equal((await pool.query('select count(*)::int n from public.app_record_links')).rows[0].n,linksBefore);
   assert.equal((await pool.query('select count(*)::int n from public.app_record_links where bundle_id=$1',[linked])).rows[0].n,1);
   // 백업 표: 지운 5줄 그대로, API 역할 권한 없음, RLS 켬.
   const backup=(await pool.query('select id,workspace_id,name,sort_order,created_at,updated_at from ops_backup.s67_53_ref_bundle_seed order by workspace_id,sort_order,name')).rows;
   assert.deepEqual(backup,snapshot.filter(b=>backup.some(k=>k.id===b.id)));assert.equal(backup.length,5);
   for(const role of ['anon','authenticated','service_role'])
     for(const priv of ['select','insert','update','delete'])
       assert.equal((await pool.query(`select has_table_privilege('${role}','ops_backup.s67_53_ref_bundle_seed','${priv}') p`)).rows[0].p,false,role+' '+priv);
   assert.equal((await pool.query("select relrowsecurity r from pg_class where oid='ops_backup.s67_53_ref_bundle_seed'::regclass")).rows[0].r,true);
   const after=num((await readOnly(precheck))[0]);
   assert.deepEqual([after.delete_targets,after.kept_with_links,after.operator_bundles_untouched,after.backup_rows,after.backup_tables,after.ok_backup_absent],[0,1,3,5,1,false]);
  });

  await t.test('apply again stops (already applied) and changes nothing',async()=>{
   const now=await bundles();
   await stops(apply,/REF_BUNDLE_SEED_CLEANUP_PREREQUISITE_CHANGED/);
   assert.deepEqual(await bundles(),now);
  });

  await t.test('owners cannot see the backup through the API roles',async()=>{
   await assert.rejects(as('authenticated',THIRD,c=>c.query('select count(*) from ops_backup.s67_53_ref_bundle_seed')),/permission denied/);
   assert.deepEqual(await as('authenticated',STRANGER,async c=>(await c.query('select name from public.app_reference_bundles order by sort_order')).rows.map(r=>r.name)),SEED);
  });

  await t.test('rollback restores the same rows; a second rollback skips them all',async()=>{
   assert.deepEqual(num((await run(rollback))[0]),{restored:5,skipped:0});
   assert.deepEqual(await bundles(),snapshot);
   assert.deepEqual(num((await run(rollback))[0]),{restored:0,skipped:5});
   assert.deepEqual(await bundles(),snapshot);
   // 되살린 묶음은 다시 그 주인만 본다.
   assert.deepEqual(await as('authenticated',THIRD,async c=>(await c.query('select name from public.app_reference_bundles order by sort_order')).rows.map(r=>r.name)),SEED);
  });

  await t.test('rollback stops without a backup table',async()=>{
   await pool.query('drop table ops_backup.s67_53_ref_bundle_seed');
   await stops(rollback,/REF_BUNDLE_SEED_ROLLBACK_NO_BACKUP/);
  });
 }finally{
  await closePool(pool);await cluster.stop();
 }
});
