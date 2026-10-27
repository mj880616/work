// Fresh local PostgreSQL 17 only. No Supabase, Google or production credentials.
// ORG-쟁의단계 DB: app_dispute_stages, app_suborganization_dispute_stages, app_dispute_stage_delete — through the approved DB workflow runner.
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
const version='20261024100000',name='org_dispute_stage_db',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const ORG_A2='23000000-0000-4000-8000-000000000011',ORG_A3='23000000-0000-4000-8000-000000000012';

// Production-like state of the organization table (Task 12a): no anon/PUBLIC grant, owner helper for tables that hang off an organization.
const prerequisites=`
  revoke all on public.app_suborganizations from public, anon;
  create function private.app_is_owner_organization(p_organization uuid) returns boolean language sql stable security definer
    set search_path = pg_catalog, public as $$
    select coalesce((select private.app_is_workspace_owner(o.workspace_id) from public.app_suborganizations o where o.id = p_organization), false) $$;
  revoke all on function private.app_is_owner_organization(uuid) from public, anon, authenticated;
  grant execute on function private.app_is_owner_organization(uuid) to authenticated, service_role;
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  insert into public.app_suborganizations values ('${ORG_A2}','${WS_A}'), ('${ORG_A3}','${WS_A}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;

test('org dispute stage db: precheck, dry-run, apply, owner boundary, flags, default guard, delete with organization move, guarded rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'org-dispute-stage-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,preserve]=await Promise.all(['precheck','postcheck','snapshot','rollback','preserve'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const addStage=(ws,n,order,flags={})=>owner(async c=>(await c.query('insert into public.app_dispute_stages(workspace_id,name,sort_order,is_struggle,is_ending,is_default) values ($1,$2,$3,$4,$5,$6) returning id',[ws,n,order,!!flags.struggle,!!flags.ending,!!flags.def])).rows[0].id);
  const addHistory=(sub,org,stage,stageName,date='2026-10-20')=>as('authenticated',sub,c=>c.query('insert into public.app_suborganization_dispute_stages(organization_id,stage_id,stage_name,stage_date) values ($1,$2,$3,$4)',[org,stage,stageName,date]));
  const current=async org=>(await pool.query('select stage_id,stage_name,stage_date::text d from public.app_suborganization_dispute_stages where organization_id=$1 order by stage_date desc,created_at desc,id desc limit 1',[org])).rows[0];
  const del=(stage,move)=>owner(async c=>(await c.query('select public.app_dispute_stage_delete($1,$2) r',[stage,move])).rows[0].r);

  await t.test('approval plan: expanded rules, full flow; new tables and one invoker function; nothing widens access',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.functions,['public.app_dispute_stage_delete']);
   assert.deepEqual(plan.review.definer,[]);assert.equal(plan.review.restrictive,2);assert.equal(plan.review.triggers,0);
   assert.equal(prepareMigration({mode:'dry-run',version,runId:'1',root}).flow,'full');
   assert.match(toDryRun(migration),/rollback;\s*$/);
  });
  await t.test('precheck as the read-only role: expected values',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.deepEqual([v['dispute stages table count'],v['dispute history table count'],v['dispute delete function count'],v['suborganizations rows']],['0','0','0','4']);
  });
  await t.test('a changed prerequisite stops the migration before any change',async()=>{
   const stops=async()=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),/ORG_DISPUTE_STAGE_DB_PREREQUISITE_CHANGED/);await c.query('rollback');}finally{c.release();}};
   await pool.query('grant select on public.app_suborganizations to anon');
   assert.equal(values(await readOnly(precheck))['no anon or public table privilege on suborganizations'],'아니오');await stops();
   await pool.query('revoke select on public.app_suborganizations from anon');
   await pool.query('alter policy task12a_owner_all on public.app_suborganizations using (true)');
   assert.equal(values(await readOnly(precheck))['suborganizations owner policy is authenticated owner-only'],'아니오');await stops();
   await pool.query('alter policy task12a_owner_all on public.app_suborganizations using (private.app_is_workspace_owner(workspace_id))');
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9901');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await readOnly(precheck),beforeCheck);
  });
  await t.test('apply passes postcheck; tables are empty; organization table untouched; second apply refused',async()=>{
   const apply=await run('apply','9902');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck)),pre=values(beforeCheck);
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else if(pre[item]!==undefined)assert.equal(value,pre[item],item);
   }
   assert.deepEqual([post['dispute stage rows'],post['dispute history rows']],['0','0']);
   assert.equal((await run('apply','9903')).ok,false);
  });
  await t.test('stages table: owner only, anon refused, name and flag rules, default is single and fixed',async()=>{
   const def=await addStage(WS_A,'교섭 시작 전',10,{def:true});
   const mid=await addStage(WS_A,'교섭 중',20),fight=await addStage(WS_A,'쟁의행위',70,{struggle:true}),done=await addStage(WS_A,'타결',80,{ending:true});
   assert.ok(def&&mid&&fight&&done);
   // anon: no table privilege, no function execute.
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_dispute_stages')),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_suborganization_dispute_stages')),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query('select public.app_dispute_stage_delete($1,false)',[mid])),{code:'42501'});
   // Stranger: sees only their own workspace; cannot write into the owner's; cannot touch the owner's rows.
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_dispute_stages'))).rows[0].n,0);
   await assert.rejects(stranger(c=>c.query("insert into public.app_dispute_stages(workspace_id,name) values ($1,'침입')",[WS_A])),{code:'42501'});
   assert.equal((await stranger(c=>c.query("update public.app_dispute_stages set name='가로채기' where id=$1",[mid]))).rowCount,0);
   assert.equal((await stranger(c=>c.query('delete from public.app_dispute_stages where id=$1',[mid]))).rowCount,0);
   assert.deepEqual((await stranger(c=>c.query('select public.app_dispute_stage_delete($1,true) r',[mid]))).rows[0].r,{ok:false,error:'STAGE_MISSING',moved:0});
   // Two flags at once are refused (insert and update); the default cannot carry a flag; names 1~20 chars, unique per workspace.
   await assert.rejects(addStage(WS_A,'둘다',90,{struggle:true,ending:true}),{code:'23514'});
   await assert.rejects(owner(c=>c.query('update public.app_dispute_stages set is_ending=true where id=$1',[fight])),{code:'23514'});
   await assert.rejects(owner(c=>c.query('update public.app_dispute_stages set is_struggle=true where id=$1',[done])),{code:'23514'});
   await assert.rejects(owner(c=>c.query('update public.app_dispute_stages set is_struggle=true where id=$1',[def])),{code:'23514'});
   assert.equal((await owner(c=>c.query('update public.app_dispute_stages set is_struggle=false,is_ending=true where id=$1',[fight]))).rowCount,1);
   assert.equal((await owner(c=>c.query('update public.app_dispute_stages set is_struggle=true,is_ending=false where id=$1',[fight]))).rowCount,1);
   for(const bad of ['','   ','가'.repeat(21)])await assert.rejects(addStage(WS_A,bad,95),{code:'23514'});
   await assert.rejects(addStage(WS_A,'교섭 중',95),{code:'23505'});
   assert.ok(await addStage(WS_A,'가'.repeat(20),96));
   // Another default in the same workspace is refused; a rename of the default is fine; the flag and ids cannot be edited.
   await assert.rejects(addStage(WS_A,'두번째 기본',5,{def:true}),{code:'23505'});
   assert.equal((await owner(c=>c.query("update public.app_dispute_stages set name='시작 전' where id=$1",[def]))).rowCount,1);
   await owner(c=>c.query("update public.app_dispute_stages set name='교섭 시작 전' where id=$1",[def]));
   await assert.rejects(owner(c=>c.query('update public.app_dispute_stages set is_default=false where id=$1',[def])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('update public.app_dispute_stages set is_default=true where id=$1',[mid])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('update public.app_dispute_stages set workspace_id=$1 where id=$2',[WS_B,mid])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('update public.app_dispute_stages set id=gen_random_uuid() where id=$1',[mid])),{code:'42501'});
   // The other workspace has its own default.
   assert.ok(await as('authenticated',STRANGER,async c=>(await c.query("insert into public.app_dispute_stages(workspace_id,name,is_default) values ($1,'교섭 시작 전',true) returning id",[WS_B])).rows[0].id));
   // The default cannot be deleted, directly or through the function.
   assert.equal((await owner(c=>c.query('delete from public.app_dispute_stages where id=$1',[def]))).rowCount,0);
   assert.deepEqual(await del(def,true),{ok:false,error:'DEFAULT_STAGE',moved:0});
   assert.equal((await pool.query('select count(*)::int n from public.app_dispute_stages where id=$1',[def])).rows[0].n,1);
  });
  await t.test('history: owner only; stage must belong to the organization workspace; name copy checked; no edits',async()=>{
   const rows=(await pool.query('select id,name from public.app_dispute_stages where workspace_id=$1',[WS_A])).rows,id=n=>rows.find(r=>r.name===n).id;
   const other=(await pool.query('select id from public.app_dispute_stages where workspace_id=$1',[WS_B])).rows[0].id;
   await addHistory(OWNER,ORG_A,id('쟁의행위'),'쟁의행위','2026-10-20');
   assert.equal((await current(ORG_A)).stage_name,'쟁의행위');
   // Wrong name copy, missing stage id, other workspace's stage, other workspace's organization, stranger: all refused by the server.
   await assert.rejects(addHistory(OWNER,ORG_A,id('쟁의행위'),'가짜 이름'),{code:'42501'});
   await assert.rejects(addHistory(OWNER,ORG_A,null,'쟁의행위'),{code:'42501'});
   await assert.rejects(addHistory(OWNER,ORG_A,other,'교섭 시작 전'),{code:'42501'});
   await assert.rejects(addHistory(OWNER,ORG_B,id('쟁의행위'),'쟁의행위'),{code:'42501'});
   await assert.rejects(addHistory(STRANGER,ORG_A,id('쟁의행위'),'쟁의행위'),{code:'42501'});
   await assert.rejects(addHistory(STRANGER,ORG_B,id('쟁의행위'),'쟁의행위'),{code:'42501'});
   await assert.rejects(addHistory(OWNER,ORG_A,id('쟁의행위'),'쟁의행위','not-a-date'),{code:'22007'});
   await assert.rejects(owner(c=>c.query("insert into public.app_suborganization_dispute_stages(organization_id,stage_id,stage_name,stage_date,created_by) values ($1,$2,'쟁의행위','2026-10-21',$3)",[ORG_A,id('쟁의행위'),STRANGER])),{code:'42501'});
   // created_by comes from the login, never from the client.
   await addHistory(OWNER,ORG_A,id('교섭 중'),'교섭 중','2026-10-21');
   assert.equal((await pool.query("select created_by from public.app_suborganization_dispute_stages where stage_name='교섭 중'")).rows[0].created_by,OWNER);
   // Reads: the owner sees the lines, a stranger none. No edits for anyone; deleting one line returns to the earlier stage.
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_suborganization_dispute_stages'))).rows[0].n,0);
   await assert.rejects(owner(c=>c.query("update public.app_suborganization_dispute_stages set stage_name='x'")),{code:'42501'});
   assert.equal((await stranger(c=>c.query('delete from public.app_suborganization_dispute_stages'))).rowCount,0);
   assert.equal((await owner(c=>c.query("delete from public.app_suborganization_dispute_stages where organization_id=$1 and stage_name='교섭 중'",[ORG_A]))).rowCount,1);
   assert.equal((await current(ORG_A)).stage_name,'쟁의행위');
  });
  await t.test('delete: used stage is refused directly and by the function until confirmed; confirmed delete moves organizations to the default atomically',async()=>{
   const rows=(await pool.query('select id,name from public.app_dispute_stages where workspace_id=$1',[WS_A])).rows,id=n=>rows.find(r=>r.name===n).id;
   const fight=id('쟁의행위'),def=id('교섭 시작 전'),mid=id('교섭 중');
   await addHistory(OWNER,ORG_A2,fight,'쟁의행위','2026-10-22');
   await addHistory(OWNER,ORG_A3,fight,'쟁의행위','2026-10-01');
   await addHistory(OWNER,ORG_A3,mid,'교섭 중','2026-10-05'); // ORG_A3 moved on: its current stage is no longer 쟁의행위
   // Direct delete is refused while an organization is currently at the stage.
   assert.equal((await owner(c=>c.query('delete from public.app_dispute_stages where id=$1',[fight]))).rowCount,0);
   // Function without confirmation: names the organizations (ORG_A and ORG_A2 only), changes nothing.
   const ask=await del(fight,false);
   assert.equal(ask.ok,false);assert.equal(ask.error,'ORGS_AT_STAGE');assert.equal(ask.count,2);assert.deepEqual([...ask.organization_ids].sort(),[ORG_A,ORG_A2].sort());
   assert.equal((await pool.query('select count(*)::int n from public.app_dispute_stages where id=$1',[fight])).rows[0].n,1);
   // Confirmed: both organizations move to the default stage; histories keep the old name copy; the stage disappears.
   const moved=await del(fight,true);assert.deepEqual(moved,{ok:true,moved:2});
   assert.equal((await pool.query('select count(*)::int n from public.app_dispute_stages where id=$1',[fight])).rows[0].n,0);
   for(const org of [ORG_A,ORG_A2]){const cur=await current(org);assert.equal(cur.stage_id,def);assert.equal(cur.stage_name,'교섭 시작 전');}
   assert.equal((await current(ORG_A3)).stage_name,'교섭 중');
   const old=(await pool.query("select organization_id,stage_id from public.app_suborganization_dispute_stages where stage_name='쟁의행위' order by organization_id")).rows;
   assert.equal(old.length,3);assert.ok(old.every(r=>r.stage_id===null));
   // The moved line is dated today (Seoul) or later, never before the line it replaces.
   assert.ok((await pool.query("select stage_date::text d from public.app_suborganization_dispute_stages where stage_id=$1 and organization_id=$2",[def,ORG_A2])).rows[0].d>='2026-10-22');
   // A stage only used by old history lines (nobody is there now) deletes without moving anyone.
   assert.deepEqual(await del(mid,false),{ok:false,error:'ORGS_AT_STAGE',moved:0,count:1,organization_ids:[ORG_A3]});
   const spare=await addStage(WS_A,'조정신청',30,{struggle:true});
   await addHistory(OWNER,ORG_A,spare,'조정신청','2026-10-25');await addHistory(OWNER,ORG_A,def,'교섭 시작 전','2026-10-26');
   assert.deepEqual(await del(spare,false),{ok:true,moved:0});
   // Unknown id, null id, stranger.
   assert.equal((await del('29000000-0000-4000-8000-000000000999',true)).error,'STAGE_MISSING');
   assert.equal((await del(null,true)).error,'INVALID_INPUT');
  });
  await t.test('delete without a default stage in the workspace stops with NO_DEFAULT_STAGE and changes nothing',async()=>{
   const loneWs=WS_B,s=await as('authenticated',STRANGER,async c=>(await c.query("insert into public.app_dispute_stages(workspace_id,name) values ($1,'임시') returning id",[loneWs])).rows[0].id);
   await pool.query('delete from public.app_dispute_stages where workspace_id=$1 and is_default',[WS_B]);
   await pool.query("insert into public.app_suborganization_dispute_stages(organization_id,stage_id,stage_name,stage_date) values ($1,$2,'임시','2026-10-20')",[ORG_B,s]);
   const r=(await stranger(c=>c.query('select public.app_dispute_stage_delete($1,true) r',[s]))).rows[0].r;
   assert.deepEqual(r,{ok:false,error:'NO_DEFAULT_STAGE',moved:0});
   assert.equal((await pool.query('select count(*)::int n from public.app_dispute_stages where id=$1',[s])).rows[0].n,1);
  });
  await t.test('SQL authorization regression file passes on the applied schema',async()=>{
   await pool.query(await read('supabase/tests/authz_dispute_stages.sql'));
  });
  await t.test('deleting an organization removes its history lines; guarded rollback and preserve',async()=>{
   await pool.query('delete from public.app_suborganizations where id=$1',[ORG_A3]);
   assert.equal((await pool.query('select count(*)::int n from public.app_suborganization_dispute_stages where organization_id=$1',[ORG_A3])).rows[0].n,0);
   const kinds=(await readOnly(preserve)).map(r=>r.kind);assert.ok(kinds.includes('stage')&&kinds.includes('history'));
   const c=await pool.connect();
   try{await assert.rejects(c.query(rollbackSQL),/ORG_DISPUTE_STAGE_DB_ROLLBACK_BLOCKED/);await c.query('rollback');}finally{c.release();}
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,1);
   await pool.query('delete from public.app_suborganization_dispute_stages');await pool.query('delete from public.app_dispute_stages');
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const drop=rows=>rows.filter(r=>r.item!=='suborganizations rows');
   assert.deepEqual(drop(await readOnly(precheck)),drop(beforeCheck));
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
