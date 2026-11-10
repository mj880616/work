// Fresh local PostgreSQL 17 only. No Supabase, Google or production credentials. All data synthetic.
// S56-31 MTG-참석인원칸 DB: app_meetings.attendees text null + 200-char check (the [회의] 참석인원 한 줄, 장소 칸과 같은 모양)
// through the approved DB workflow runner (expanded rules, full flow), with a guarded SQL Editor rollback.
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
import {fixture,OWNER,STRANGER,WS_A,MEETING_A,MEETING_B} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261110231000',name='bizreport_meeting_attendees',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Production-like app_meetings (owner RLS + trash restrictive policy, eight-kind CHECK, location + 200-char check, anon revoked,
// updated_at touch trigger) — the shape after 20261022182319·20261023023500·20261025100000.
const schema=`
  alter table public.app_meetings
    add column series_name text, add column meeting_at timestamptz, add column location text,
    add column activity_kind text not null default 'meeting', add column deleted_at timestamptz,
    add column created_at timestamptz not null default now(), add column updated_at timestamptz not null default now();
  alter table public.app_meetings add constraint app_meetings_activity_kind_check check (activity_kind in
    ('meeting', 'policy', 'negotiation', 'press', 'assembly', 'struggle', 'education', 'other'));
  alter table public.app_meetings add constraint app_meetings_location_length_check check (location is null or char_length(location) <= 200);
  alter table public.app_meetings enable row level security;
  create policy task12a_owner_all on public.app_meetings for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  create policy app_meetings_trash_hidden on public.app_meetings as restrictive for all to authenticated
    using (deleted_at is null) with check (deleted_at is null);
  revoke all on public.app_meetings from public, anon, authenticated, service_role;
  grant select, insert, update, delete on public.app_meetings to authenticated, service_role;
  create function private.app_touch_meeting() returns trigger language plpgsql as $$ begin new.updated_at = clock_timestamp(); return new; end $$;
  create trigger app_meetings_touch before update on public.app_meetings for each row execute function private.app_touch_meeting();
  update public.app_meetings set title='합성 운영위원회', location='합성 회의실' where id='${MEETING_A}';
  insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261023023500','bizreport_meeting_links',array['x']);
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;

test('bizreport meeting attendees: plan, precheck, dry-run, apply, owner boundary, guarded rollback',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'bizreport-attendees-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(schema);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,preserve]=await Promise.all(['precheck','postcheck','snapshot','rollback','preserve'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const summary=await read('docs/'+stem+'.summary.md');
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const setAttendees=(value,sub=OWNER,id=MEETING_A)=>as('authenticated',sub,c=>c.query('update public.app_meetings set attendees=$2 where id=$1',[id,value]));
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('approval plan: expanded rules, full flow, one table; summary has three lines; workflow rollback refused (SQL Editor only)',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.targets,['app_meetings']);
   assert.equal(prepareMigration({mode:'dry-run',version,runId:'1',root}).flow,'full');
   assert.match(toDryRun(migration),/rollback;\s*$/);
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
   const code=sql=>sql.replace(/--[^\n]*/g,''); // 주석 밖 SQL만
   for(const file of [migration,precheck,postcheck,snapshot,rollbackSQL,preserve])assert.doesNotMatch(code(file),/information_schema/);
   assert.doesNotMatch(code(migration),/\b(grant|revoke|create policy|alter policy|drop policy|create function|create trigger|create index|security definer)\b/i);
   assert.doesNotMatch(code(migration),/\b(anon|public)\s*;/i);
   assert.match(code(migration),/insert into supabase_migrations\.schema_migrations[\s\S]*'20261110231000', 'bizreport_meeting_attendees'[\s\S]*\);\s*commit;\s*$/);
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);
   assert.match(lines[0],/^무엇이 바뀌나: /);assert.match(lines[1],/^잘못되면: /);assert.match(lines[2],/^되돌리는 법: /);
  });
  await t.test('precheck as the read-only role: expected values; owner sees the same',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,item==='anon or public table privilege'?'아니오':'예',item);
   assert.deepEqual([v['new column count'],v['new check count'],v['meetings rows'],v['meetings with location']],['0','0','2','1']);
   assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('before apply the column does not exist',async()=>{
   await assert.rejects(setAttendees('3명'),{code:'42703'});
  });
  await t.test('a second permissive policy stops the migration before any change',async()=>{
   await pool.query('create policy extra_read on public.app_meetings for select to authenticated using (private.app_is_workspace_owner(workspace_id))');
   assert.equal(values(await readOnly(precheck))['one permissive owner policy (task12a shape)'],'아니오');
   const c=await pool.connect();try{await assert.rejects(c.query(migration),/BIZREPORT_MEETING_ATTENDEES_PREREQUISITE_CHANGED/);await c.query('rollback');}finally{c.release();}
   await pool.query('drop policy extra_read on public.app_meetings');
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9931');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await readOnly(precheck),beforeCheck);
  });
  await t.test('apply passes postcheck; existing rows null and untouched; second apply refused',async()=>{
   const apply=await run('apply','9932');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck)),pre=values(beforeCheck);
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else if(pre[item]!==undefined)assert.equal(value,pre[item],item);
   }
   assert.deepEqual((await pool.query('select title,location,attendees from public.app_meetings where id=$1',[MEETING_A])).rows,[{title:'합성 운영위원회',location:'합성 회의실',attendees:null}]);
   const again=await run('apply','9933');assert.equal(again.ok,false);
  });
  await t.test('owner writes, reads and clears one line; 200 chars max; stranger and anon cannot',async()=>{
   assert.equal((await setAttendees('12명 (위원장 외 11명)')).rowCount,1);
   assert.equal((await as('authenticated',OWNER,c=>c.query('select attendees from public.app_meetings where id=$1',[MEETING_A]))).rows[0].attendees,'12명 (위원장 외 11명)');
   assert.equal((await setAttendees('가'.repeat(200))).rowCount,1);
   await assert.rejects(setAttendees('가'.repeat(201)),{code:'23514'});
   assert.equal((await as('authenticated',OWNER,c=>c.query('insert into public.app_meetings(id,workspace_id,title,attendees) values (gen_random_uuid(),$1,$2,$3)',[WS_A,'합성 새 회의','5명']))).rowCount,1);
   assert.equal((await setAttendees('남이 씀',STRANGER)).rowCount,0);
   assert.equal((await setAttendees('남이 씀',OWNER,MEETING_B)).rowCount,0);
   assert.equal((await as('authenticated',STRANGER,c=>c.query('select count(*)::int n from public.app_meetings where attendees is not null')).catch(e=>{throw e})).rows[0].n,0);
   await assert.rejects(as('anon','',c=>c.query('select attendees from public.app_meetings')),{code:'42501'});
   assert.equal((await setAttendees('12명')).rowCount,1);
  });
  await t.test('rollback: blocked while a report has attendees; preserve reads id and the line only; then the column is gone',async()=>{
   const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/BIZREPORT_MEETING_ATTENDEES_ROLLBACK_BLOCKED: reports with attendees/);await c.query('rollback');}finally{c.release();}
   const kept=await readOnly(preserve);assert.equal(kept.length,2);assert.deepEqual(Object.keys(kept[0]),['id','attendees']);
   await pool.query("delete from public.app_meetings where title='합성 새 회의'");
   await pool.query('update public.app_meetings set attendees=null');
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.equal(values(await readOnly(postcheck))['column, check and history agree'],'예');
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const again=await run('apply','9936');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
