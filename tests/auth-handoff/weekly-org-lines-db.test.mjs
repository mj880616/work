// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// WEEKLY-메뉴짝짓기 P1(20261104211500_weekly_org_lines): app_weekly_org_lines — through the approved DB workflow runner.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,ORG_A,ORG_B} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261104211500',name='weekly_org_lines',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const ORG_A2='23000000-0000-4000-8000-000000000021';
const UPD_A='26000000-0000-4000-8000-000000000001',UPD_B='26000000-0000-4000-8000-000000000002';
const NOTE_A='27000000-0000-4000-8000-000000000001',NOTE_B='27000000-0000-4000-8000-000000000002';
const ROW_A='28000000-0000-4000-8000-000000000001',ROW_B='28000000-0000-4000-8000-000000000002';
const MON='2026-11-02',NEXT_MON='2026-11-09';

// Source tables the guard reads, with the same owner-only RLS shape as production (synthetic, minimal columns).
const prerequisites=`
  revoke all on public.app_suborganizations from public, anon;
  grant select on public.app_suborganizations to authenticated;
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  insert into public.app_suborganizations values ('${ORG_A2}','${WS_A}');
  create table public.app_suborganization_updates(id uuid primary key, organization_id uuid not null references public.app_suborganizations(id) on delete cascade, raw_text text);
  alter table public.app_suborganization_updates enable row level security;
  revoke all on public.app_suborganization_updates from public, anon, authenticated, service_role;
  grant select on public.app_suborganization_updates to authenticated;
  create policy upd_owner on public.app_suborganization_updates for all to authenticated
    using (exists (select 1 from public.app_suborganizations o where o.id = organization_id and private.app_is_workspace_owner(o.workspace_id)));
  create table public.app_notes(id uuid primary key, workspace_id uuid not null references public.app_workspaces(id), kind text);
  alter table public.app_notes enable row level security;
  revoke all on public.app_notes from public, anon, authenticated, service_role;
  grant select on public.app_notes to authenticated;
  create policy notes_owner on public.app_notes for all to authenticated using (private.app_is_workspace_owner(workspace_id));
  create table public.app_org_status_rows(id uuid primary key, workspace_id uuid not null references public.app_workspaces(id), organization_id uuid);
  alter table public.app_org_status_rows enable row level security;
  revoke all on public.app_org_status_rows from public, anon, authenticated, service_role;
  grant select on public.app_org_status_rows to authenticated;
  create policy rows_owner on public.app_org_status_rows for all to authenticated using (private.app_is_workspace_owner(workspace_id));
  insert into supabase_migrations.schema_migrations(version,name) values ('20261030234000','org_status_rows');
  insert into public.app_suborganization_updates values ('${UPD_A}','${ORG_A}','기록'), ('${UPD_B}','${ORG_B}','남의 기록');
  insert into public.app_notes values ('${NOTE_A}','${WS_A}','basket'), ('${NOTE_B}','${WS_B}','basket');
  insert into public.app_org_status_rows values ('${ROW_A}','${WS_A}','${ORG_A}'), ('${ROW_B}','${WS_B}','${ORG_B}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;

test('weekly org lines db: plan, dry-run, apply, owner boundary, source guard, no delete, concurrency stamp, limit, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'weekly-org-lines-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL]=await Promise.all(['precheck','postcheck','snapshot','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const refused=e=>['42501','23514'].includes(e.code);
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const add=(sub,ws,org,body,x={})=>as('authenticated',sub,async c=>(await c.query(
   'insert into public.app_weekly_org_lines(workspace_id,week_start,organization_id,day,end_day,body,sort_order,state,origin,source_update_ids,source_note_ids,source_status_ids,source_hash) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id,updated_at::text',
   [ws,x.week??MON,org,x.day??null,x.end??null,body,x.sort??0,x.state??'in',x.origin??'user',x.upd??[],x.notes??[],x.rows??[],x.hash??null])).rows[0]);

  await t.test('approval plan: expanded rules, full flow, no definer function',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.review.definer,[]);
   assert.equal(prepareMigration({mode:'dry-run',version,runId:'1',root}).flow,'full');
   assert.match(toDryRun(migration),/rollback;\s*$/);
  });
  await t.test('precheck: all yes before apply',()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
  await t.test('dry-run leaves schema and history unchanged',async()=>{
   const dry=await run('dry-run','9921');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; second apply refused',async()=>{
   const apply=await run('apply','9922');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9923')).ok,false);
  });
  await t.test('lines: owner only, anon refused, stranger sees and changes nothing',async()=>{
   const a=await add(OWNER,WS_A,ORG_A,'가상 교섭 상견례',{day:'2026-11-02'});
   assert.ok(a.id);
   assert.ok(await add(OWNER,WS_A,ORG_A,'파업 찬반투표',{day:'2026-11-02',end:'2026-11-05',state:'suggested',origin:'ai',upd:[UPD_A],notes:[NOTE_A],rows:[ROW_A],hash:'0123456789abcdef'}));
   assert.ok(await add(OWNER,WS_A,ORG_A,'가상 현안 설명회 준비'));
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_weekly_org_lines')),{code:'42501'});
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_weekly_org_lines'))).rows[0].n,0);
   await assert.rejects(add(STRANGER,WS_A,ORG_A,'침입'),refused);
   await assert.rejects(add(STRANGER,WS_B,ORG_A,'남의 조직'),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,ORG_B,'남의 조직'),{code:'23514'});
   assert.equal((await stranger(c=>c.query("update public.app_weekly_org_lines set body='가로채기' where id=$1",[a.id]))).rowCount,0);
  });
  await t.test('no delete privilege: dropping a line is state=dropped',async()=>{
   const a=await add(OWNER,WS_A,ORG_A2,'뺄 줄');
   await assert.rejects(owner(c=>c.query('delete from public.app_weekly_org_lines where id=$1',[a.id])),{code:'42501'});
   assert.equal((await owner(c=>c.query("update public.app_weekly_org_lines set state='dropped' where id=$1",[a.id]))).rowCount,1);
  });
  await t.test('value rules: week is Monday, period, body, order, state, origin, sources, hash',async()=>{
   await assert.rejects(add(OWNER,WS_A,ORG_A,'화요일',{week:'2026-11-03'}),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,ORG_A,'거꾸로',{day:'2026-11-05',end:'2026-11-02'}),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,ORG_A,'시작 없음',{end:'2026-11-05'}),{code:'23514'});
   for(const bad of ['',' 앞 빈칸','가'.repeat(201),'줄\n바꿈'])await assert.rejects(add(OWNER,WS_A,ORG_A,bad),{code:'23514'},JSON.stringify(bad));
   await assert.rejects(add(OWNER,WS_A,ORG_A,'순서',{sort:1001}),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,ORG_A,'상태',{state:'maybe'}),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,ORG_A,'출처',{origin:'robot'}),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,ORG_A,'해시',{hash:'XYZ'}),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,ORG_A,'근거 많음',{upd:Array.from({length:11},()=>UPD_A)}),{code:'23514'});
  });
  await t.test('sources must be visible records of the same workspace (on insert and when changed)',async()=>{
   await assert.rejects(add(OWNER,WS_A,ORG_A,'남의 기록',{upd:[UPD_B]}),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,ORG_A,'남의 업데이트',{notes:[NOTE_B]}),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,ORG_A,'남의 현황 줄',{rows:[ROW_B]}),{code:'23514'});
   await assert.rejects(add(OWNER,WS_A,ORG_A,'없는 기록',{upd:['26000000-0000-4000-8000-0000000000ff']}),{code:'23514'});
   const a=await add(OWNER,WS_A,ORG_A,'출처 더하기',{upd:[UPD_A]});
   await assert.rejects(owner(c=>c.query('update public.app_weekly_org_lines set source_update_ids=$1 where id=$2',[[UPD_A,UPD_B],a.id])),{code:'23514'});
   assert.equal((await owner(c=>c.query('update public.app_weekly_org_lines set source_note_ids=$1 where id=$2',[[NOTE_A],a.id]))).rowCount,1);
   // The original record disappears later: editing the line's text still works.
   await pool.query('delete from public.app_suborganization_updates where id=$1',[UPD_A]);
   assert.equal((await owner(c=>c.query("update public.app_weekly_org_lines set body='출처 더하기 고침',edited=true where id=$1",[a.id]))).rowCount,1);
  });
  await t.test('scope columns fixed; updated_at is server time and works as a concurrency stamp',async()=>{
   const a=await add(OWNER,WS_A,ORG_A,'동시 고침');
   for(const [col,val] of [['organization_id',ORG_A2],['workspace_id',WS_B],['week_start',NEXT_MON],['origin','ai'],['updated_at','2000-01-01']])
    await assert.rejects(owner(c=>c.query(`update public.app_weekly_org_lines set ${col}=$1 where id=$2`,[val,a.id])),{code:'42501'},col);
   await assert.rejects(owner(c=>c.query("insert into public.app_weekly_org_lines(id,workspace_id,week_start,organization_id,body) values (gen_random_uuid(),$1,$2,$3,'id 지정')",[WS_A,MON,ORG_A])),{code:'42501'});
   // Stamps are compared as text with microseconds (as PostgREST returns them). Screen 1 saves against the value it read; screen 2 then saves with the same stale value and changes 0 rows.
   const first=await owner(c=>c.query("update public.app_weekly_org_lines set body='화면 1' where id=$1 and updated_at=$2 returning updated_at::text",[a.id,a.updated_at]));
   assert.equal(first.rowCount,1);assert.ok(first.rows[0].updated_at>a.updated_at);
   assert.equal((await owner(c=>c.query("update public.app_weekly_org_lines set body='화면 2' where id=$1 and updated_at=$2",[a.id,a.updated_at]))).rowCount,0);
  });
  await t.test('weeks are separate: editing last week leaves this week unchanged',async()=>{
   const last=await add(OWNER,WS_A,ORG_A2,'지난주 줄',{week:MON});
   const now=await add(OWNER,WS_A,ORG_A2,'지난주 줄',{week:NEXT_MON,origin:'last_week'});
   await owner(c=>c.query("update public.app_weekly_org_lines set body='지난주 줄 고침' where id=$1",[last.id]));
   assert.equal((await owner(c=>c.query('select body from public.app_weekly_org_lines where id=$1',[now.id]))).rows[0].body,'지난주 줄');
  });
  await t.test('at most 40 lines per organization per week; other weeks and organizations are separate',async()=>{
   const have=(await pool.query('select count(*)::int n from public.app_weekly_org_lines where organization_id=$1 and week_start=$2',[ORG_A,MON])).rows[0].n;
   for(let i=have;i<40;i++)await add(OWNER,WS_A,ORG_A,'줄 '+i,{state:'suggested'});
   await assert.rejects(add(OWNER,WS_A,ORG_A,'마흔한째'),{code:'23514'});
   assert.ok(await add(OWNER,WS_A,ORG_A,'다음 주 첫 줄',{week:NEXT_MON}));
   assert.ok(await add(OWNER,WS_A,ORG_A2,'다른 조직 줄'));
  });
  await t.test('deleting an organization removes its lines; rollback returns to the snapshot',async()=>{
   await pool.query('delete from public.app_suborganizations where id=$1',[ORG_A2]);
   assert.equal((await pool.query('select count(*)::int n from public.app_weekly_org_lines where organization_id=$1',[ORG_A2])).rows[0].n,0);
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
