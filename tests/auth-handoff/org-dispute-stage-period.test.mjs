// Fresh local PostgreSQL 17 only. No Supabase, Google or production credentials. All data synthetic.
// ORG-쟁의단계 다듬기 DB: 20261024170000_org_dispute_stage_period — end_date column + CHECK (end >= start) on the history table,
// column grants insert(end_date) / update(stage_id, stage_name, stage_date, end_date) to authenticated only, one restrictive update policy
// (same checks as insert), existing owner policy untouched, guarded rollback.
// The approved DB workflow refuses a grant on an existing table (grant-existing), so the file is applied as written (SQL Editor, phone path C);
// this test applies the file directly and also proves that refusal so the path in the PR stays accurate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {fixture,OWNER,STRANGER,WS_A,WS_B,ORG_A,ORG_B} from './basket4-fixture.mjs';
import {checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {validateExpanded,ExpandedRejection} from '../../scripts/ops/db-migration-expanded.mjs';
const version='20261024170000',name='org_dispute_stage_period',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const ORG_A2='23000000-0000-4000-8000-000000000011';

const prerequisites=`
  revoke all on public.app_suborganizations from public, anon;
  create function private.app_is_owner_organization(p_organization uuid) returns boolean language sql stable security definer
    set search_path = pg_catalog, public as $$
    select coalesce((select private.app_is_workspace_owner(o.workspace_id) from public.app_suborganizations o where o.id = p_organization), false) $$;
  revoke all on function private.app_is_owner_organization(uuid) from public, anon, authenticated;
  grant execute on function private.app_is_owner_organization(uuid) to authenticated, service_role;
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  insert into public.app_suborganizations values ('${ORG_A2}','${WS_A}');`;

test('org dispute stage period: end date, history edit and delete, owner boundary, guarded rollback',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'org-dispute-period-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false});
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query(await read('supabase/migrations/20261024100000_org_dispute_stage_db.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL]=await Promise.all(['precheck','postcheck','snapshot','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const v=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  const addStage=(ws,sub,n,order,flags={})=>as('authenticated',sub,async c=>(await c.query('insert into public.app_dispute_stages(workspace_id,name,sort_order,is_struggle,is_ending,is_default) values ($1,$2,$3,$4,$5,$6) returning id',[ws,n,order,!!flags.struggle,!!flags.ending,!!flags.def])).rows[0].id);
  const current=async org=>(await pool.query('select id,stage_id,stage_name,stage_date::text d from public.app_suborganization_dispute_stages where organization_id=$1 order by stage_date desc,created_at desc,id desc limit 1',[org])).rows[0];

  // Existing rows from before the migration (must stay exactly as they are).
  const def=await addStage(WS_A,OWNER,'교섭 시작 전',10,{def:true}),mid=await addStage(WS_A,OWNER,'교섭 중',20);
  const vote=await addStage(WS_A,OWNER,'파업 찬반투표',60,{struggle:true}),fight=await addStage(WS_A,OWNER,'쟁의중',70,{struggle:true});
  const otherDef=await addStage(WS_B,STRANGER,'교섭 시작 전',10,{def:true});
  await owner(c=>c.query("insert into public.app_suborganization_dispute_stages(organization_id,stage_id,stage_name,stage_date) values ($1,$2,'교섭 중','2026-10-01')",[ORG_A,mid]));
  const dataHash=async()=>(await pool.query("select md5(string_agg((to_jsonb(r)-'end_date')::text,E'\\n' order by r.id)) h from public.app_suborganization_dispute_stages r")).rows[0].h;
  const beforeData=await dataHash();
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;

  await t.test('files: read-only checks, three-line summary, only the expected grants and policy, history row last',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'');
   assert.match(code,/^begin;\n/);assert.match(code,/\ncommit;\n$/);
   assert.deepEqual(code.match(/\bgrant\b[^;]*;/gi),[
    'grant insert (end_date) on table public.app_suborganization_dispute_stages to authenticated;',
    'grant update (stage_id, stage_name, stage_date, end_date) on table public.app_suborganization_dispute_stages to authenticated;']);
   assert.deepEqual(code.match(/create policy \w+/gi),['create policy dispute_stage_history_stage_ws_update']);
   assert.match(code,/as restrictive\s+for update to authenticated/);
   assert.doesNotMatch(code,/security definer|create (or replace )?function|create table|alter policy|drop policy|row level security|\brevoke\b|to anon|to public|to service_role|rtw_|grant delete|grant all|\bnot valid\b/i);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261024170000', 'org_dispute_stage_period', array\['[^']*'\]\);\s*commit;\s*$/);
   // The approved workflow refuses this file (existing table grant): the PR states SQL Editor (phone path C).
   assert.throws(()=>validateExpanded(migration,{version,name}),e=>e instanceof ExpandedRejection&&e.reason==='grant-existing');
   const rb=rollbackSQL.replace(/--.*$/gm,'');
   assert.match(rb,/where end_date is not null\) then\s+raise exception/);
   assert.doesNotMatch(rb,/drop table|\bgrant\b|alter policy/i);
  });
  await t.test('precheck reports the expected pre-apply state',()=>{
   const p=v(beforeCheck);
   for(const k of ['prerequisite recorded','new migration absent','history and stage tables exist','RLS enabled on history','no anon or public or service_role privilege on history','two history policies in the current shape'])assert.equal(p[k],'예',k);
   assert.equal(p['history update privilege'],'아니오');
   assert.deepEqual([p['end date column count'],p['end date check count'],p['history rows'],p['stage rows']],['0','0','1','5']);
  });
  await t.test('prerequisite changes stop the migration without any change',async()=>{
   const attempts=[
    ['grant select on public.app_suborganization_dispute_stages to anon','revoke select on public.app_suborganization_dispute_stages from anon'],
    ['grant update (stage_date) on public.app_suborganization_dispute_stages to authenticated','revoke update (stage_date) on public.app_suborganization_dispute_stages from authenticated'],
    ['alter table public.app_suborganization_dispute_stages disable row level security','alter table public.app_suborganization_dispute_stages enable row level security'],
    ['create policy synthetic_extra on public.app_suborganization_dispute_stages for select to authenticated using (true)','drop policy synthetic_extra on public.app_suborganization_dispute_stages'],
    ['alter policy dispute_stage_history_owner_all on public.app_suborganization_dispute_stages using (true)','alter policy dispute_stage_history_owner_all on public.app_suborganization_dispute_stages using (private.app_is_owner_organization(organization_id))'],
    ['alter table public.app_suborganization_dispute_stages add column end_date date','alter table public.app_suborganization_dispute_stages drop column end_date'],
    ["delete from supabase_migrations.schema_migrations where version='20261024100000'","insert into supabase_migrations.schema_migrations(version,name) values('20261024100000','org_dispute_stage_db')"],
   ];
   for(const [breakIt,fixIt] of attempts){
    await pool.query(breakIt);
    try{const c=await pool.connect();try{await assert.rejects(c.query(migration),/ORG_DISPUTE_STAGE_PERIOD_PREREQUISITE_CHANGED/,breakIt);await c.query('rollback');}finally{c.release();}}
    finally{await pool.query(fixIt);}
   }
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply once; postcheck all 예 and equal to the precheck values; existing rows unchanged; second apply refused',async()=>{
   await pool.query(migration);
   const post=(await pool.query(postcheck)).rows;
   assert.ok(post.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'),JSON.stringify(post.filter(r=>r.value==='아니오')));
   for(const r of post.filter(r=>!/^(예|아니오)$/.test(r.value)))assert.equal(r.value,v(beforeCheck)[r.item],r.item);
   assert.equal(await history(),1);
   assert.equal(await dataHash(),beforeData,'existing rows unchanged');
   assert.equal((await pool.query('select count(*)::int n from public.app_suborganization_dispute_stages where end_date is not null')).rows[0].n,0);
   const c=await pool.connect();try{await assert.rejects(c.query(migration),/ORG_DISPUTE_STAGE_PERIOD_PREREQUISITE_CHANGED/);await c.query('rollback');}finally{c.release();}
  });
  await t.test('end date: optional, same day allowed, before start refused (insert and update)',async()=>{
   const ins=(org,stage,n,d,e)=>owner(c=>c.query('insert into public.app_suborganization_dispute_stages(organization_id,stage_id,stage_name,stage_date,end_date) values ($1,$2,$3,$4,$5) returning id',[org,stage,n,d,e]));
   const a=(await ins(ORG_A,vote,'파업 찬반투표','2026-11-03','2026-11-05')).rows[0].id;
   assert.ok((await ins(ORG_A2,vote,'파업 찬반투표','2026-11-03','2026-11-03')).rows[0].id);
   assert.ok((await ins(ORG_A2,fight,'쟁의중','2026-11-06',null)).rows[0].id);
   await assert.rejects(ins(ORG_A,vote,'파업 찬반투표','2026-11-03','2026-11-02'),{code:'23514'});
   await assert.rejects(owner(c=>c.query("update public.app_suborganization_dispute_stages set end_date='2026-11-01' where id=$1",[a])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("update public.app_suborganization_dispute_stages set stage_date='2026-11-06' where id=$1",[a])),{code:'23514'});
   assert.equal((await pool.query('select end_date::text e from public.app_suborganization_dispute_stages where id=$1',[a])).rows[0].e,'2026-11-05');
  });
  await t.test('edit one line: stage, date and end date; checked like insert; other columns fixed; current stage recomputed',async()=>{
   const line=await current(ORG_A);assert.equal(line.stage_name,'파업 찬반투표');
   const upd=(sub,sql,args)=>as('authenticated',sub,c=>c.query(sql,args));
   assert.equal((await upd(OWNER,"update public.app_suborganization_dispute_stages set stage_id=$2,stage_name='쟁의중',stage_date='2026-11-04',end_date=null where id=$1",[line.id,fight])).rowCount,1);
   assert.deepEqual(await current(ORG_A),{...line,stage_id:fight,stage_name:'쟁의중',d:'2026-11-04'});
   // Same checks as insert: name copy must match, stage id required, stage from the same workspace only.
   await assert.rejects(upd(OWNER,"update public.app_suborganization_dispute_stages set stage_name='가짜 이름' where id=$1",[line.id]),{code:'42501'});
   await assert.rejects(upd(OWNER,"update public.app_suborganization_dispute_stages set stage_id=null where id=$1",[line.id]),{code:'42501'});
   await assert.rejects(upd(OWNER,"update public.app_suborganization_dispute_stages set stage_id=$2,stage_name='교섭 시작 전' where id=$1",[line.id,otherDef]),{code:'42501'});
   // Columns outside the four cannot be changed by anyone through authenticated.
   for(const set of [`organization_id='${ORG_A2}'`,`created_by='${STRANGER}'`,'created_at=now()','id=gen_random_uuid()'])
    await assert.rejects(upd(OWNER,`update public.app_suborganization_dispute_stages set ${set} where id=$1`,[line.id]),{code:'42501'},set);
   // Stranger, no-login, anon and service_role cannot edit the owner's line.
   assert.equal((await upd(STRANGER,"update public.app_suborganization_dispute_stages set stage_date='2026-01-01' where id=$1",[line.id])).rowCount,0);
   assert.equal((await as('authenticated',null,c=>c.query("update public.app_suborganization_dispute_stages set stage_date='2026-01-01' where id=$1",[line.id]))).rowCount,0);
   for(const role of ['anon','service_role'])await assert.rejects(as(role,null,c=>c.query("update public.app_suborganization_dispute_stages set stage_date='2026-01-01'")),{code:'42501'},role);
   // The stranger cannot move their own line into the owner's workspace stage either.
   const sLine=(await stranger(c=>c.query("insert into public.app_suborganization_dispute_stages(organization_id,stage_id,stage_name,stage_date) values ($1,$2,'교섭 시작 전','2026-10-20') returning id",[ORG_B,otherDef]))).rows[0].id;
   await assert.rejects(upd(STRANGER,"update public.app_suborganization_dispute_stages set stage_id=$2,stage_name='쟁의중' where id=$1",[sLine,fight]),{code:'42501'});
   // Editing the date of an older line moves which line is current.
   const old=(await pool.query("select id from public.app_suborganization_dispute_stages where organization_id=$1 and stage_name='교섭 중'",[ORG_A])).rows[0].id;
   await upd(OWNER,"update public.app_suborganization_dispute_stages set stage_date='2026-11-10' where id=$1",[old]);
   assert.equal((await current(ORG_A)).stage_name,'교섭 중');
   await upd(OWNER,"update public.app_suborganization_dispute_stages set stage_date='2026-10-01' where id=$1",[old]);
   assert.equal((await current(ORG_A)).stage_name,'쟁의중');
  });
  await t.test('delete one line: owner only; the current stage falls back to the latest remaining line; the default rule stays',async()=>{
   const line=await current(ORG_A);
   assert.equal((await stranger(c=>c.query('delete from public.app_suborganization_dispute_stages where id=$1',[line.id]))).rowCount,0);
   await assert.rejects(as('anon',null,c=>c.query('delete from public.app_suborganization_dispute_stages where id=$1',[line.id])),{code:'42501'});
   assert.equal((await owner(c=>c.query('delete from public.app_suborganization_dispute_stages where id=$1',[line.id]))).rowCount,1);
   assert.equal((await current(ORG_A)).stage_name,'교섭 중');
   // Deleting every line leaves no history: the screen reads that as the default stage (no stored current stage).
   await owner(c=>c.query('delete from public.app_suborganization_dispute_stages where organization_id=$1',[ORG_A]));
   assert.equal(await current(ORG_A),undefined);
   // The default stage still cannot be deleted; a stage in use still cannot be deleted directly.
   assert.equal((await owner(c=>c.query('delete from public.app_dispute_stages where id=$1',[def]))).rowCount,0);
   assert.equal((await owner(c=>c.query('delete from public.app_dispute_stages where id=$1',[fight]))).rowCount,0);
   // The delete function keeps working with end dates (moved line has no end date).
   const moved=(await owner(c=>c.query('select public.app_dispute_stage_delete($1,true) r',[fight]))).rows[0].r;
   assert.deepEqual(moved,{ok:true,moved:1});
   const cur=await current(ORG_A2);assert.equal(cur.stage_id,def);
   assert.equal((await pool.query('select end_date from public.app_suborganization_dispute_stages where id=$1',[cur.id])).rows[0].end_date,null);
  });
  await t.test('guarded rollback: stops while end dates exist, then restores the previous schema exactly',async()=>{
   assert.ok((await pool.query('select count(*)::int n from public.app_suborganization_dispute_stages where end_date is not null')).rows[0].n>0);
   const c=await pool.connect();
   try{await assert.rejects(c.query(rollbackSQL),/ORG_DISPUTE_STAGE_PERIOD_ROLLBACK_BLOCKED/);await c.query('rollback');}finally{c.release();}
   assert.equal(await history(),1);
   await pool.query('update public.app_suborganization_dispute_stages set end_date=null');
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const post=(await pool.query(postcheck)).rows;
   assert.ok(post.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'),'postcheck after rollback');
   const drop=rows=>rows.filter(r=>!['history rows','stage rows','recent migrations'].includes(r.item));
   assert.deepEqual(drop((await pool.query(precheck)).rows),drop(beforeCheck));
   await assert.rejects(owner(c=>c.query("update public.app_suborganization_dispute_stages set stage_date='2026-10-02'")),{code:'42501'},'no edit after rollback');
  });
 }finally{
  if(pool)await pool.end().catch(()=>{});
  await cluster.stop().catch(()=>{});
 }
});
