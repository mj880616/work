// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic (no real project names).
// PRJ-3단 DB 안전망: 20261021053502_prj_depth_guard — app_spaces at most 3 levels, no cycle. SQL Editor only
// (the approved DB workflow does not accept CREATE TRIGGER), so the file is applied as written, like phone path C.
// Optional: PRJ_DEPTH_PG_PORT=<port> runs the same checks on an already running local server (user postgres, trust auth).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {fixture,OWNER,STRANGER,WS_A,WS_B} from './basket4-fixture.mjs';
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
const version='20261021053502',name='prj_depth_guard',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const externalPort=process.env.PRJ_DEPTH_PG_PORT;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const id=n=>`26000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

// Existing app_spaces shape the guard depends on (parent_id self reference with on delete cascade, owner RLS) and the
// workspace consistency trigger body from 20260916030032. Nothing here comes from production.
const spaces=`
  alter table public.app_spaces add column owner_id uuid default '${OWNER}', add column name text not null default 'p',
    add column parent_id uuid references public.app_spaces(id) on delete cascade, add column status text default 'active',
    add column sort_order integer default 0, add column metadata jsonb default '{"project_system":"v2"}';
  create function private.app_enforce_space_workspace() returns trigger language plpgsql security definer
    set search_path = pg_catalog, public as $$
  begin
    if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
      raise exception using errcode='23514', message='project workspace_id is immutable';
    end if;
    if new.parent_id is not null and not exists (select 1 from public.app_spaces p where p.id = new.parent_id and p.workspace_id = new.workspace_id) then
      raise exception using errcode='23514', message='parent project must belong to the same workspace';
    end if;
    return new;
  end $$;
  revoke all on function private.app_enforce_space_workspace() from public;
  create trigger app_spaces_workspace_consistency before insert or update on public.app_spaces for each row execute function private.app_enforce_space_workspace();
  grant select, insert, update, delete on public.app_spaces to authenticated;
  alter table public.app_spaces enable row level security;
  create policy app_spaces_scoped_read on public.app_spaces for select to authenticated using (owner_id = (select auth.uid()));
  create policy synthetic_spaces_owner on public.app_spaces for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));`;

test('PRJ-3단 depth guard: prechecks, apply, 3 levels allowed, 4th level / cycle / deep move refused, rerun safe, rollback restores',{timeout:90000},async t=>{
 let cluster,pool,adminPool,database='postgres',port;
 if(externalPort){
  port=Number(externalPort);database='prj_depth_'+randomBytes(4).toString('hex');
  adminPool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres',ssl:false});
  await adminPool.query('create database '+database);
  for(const role of ['anon','authenticated','public_probe','service_role'])await adminPool.query(`drop role if exists ${role}`).catch(()=>{});
 }else{
  const directory=await mkdtemp(join(tmpdir(),'prj-depth-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));port=sock.address().port;await new Promise(r=>sock.close(r));
  const password=randomBytes(24).toString('hex');
  cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
  await cluster.initialise();await cluster.start();
  process.env.PRJ_DEPTH_PASSWORD=password;
 }
 try{
  pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password:process.env.PRJ_DEPTH_PASSWORD,database,ssl:false});
  await pool.query(fixture);await pool.query(spaces);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const v=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value??r.ok]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const add=(n,parent,ws=WS_A,owner=OWNER)=>as('authenticated',owner,c=>c.query('insert into public.app_spaces(id,workspace_id,owner_id,name,parent_id) values($1,$2,$3,$4,$5)',[id(n),ws,owner,'시험 '+n,parent==null?null:id(parent)]));
  const move=(n,parent)=>as('authenticated',OWNER,c=>c.query('update public.app_spaces set parent_id=$2 where id=$1',[id(n),parent==null?null:id(parent)]));
  const depthErr={code:'23514',message:/^PRJ_DEPTH_LIMIT: projects are limited to 3 levels$/};
  const cycleErr={code:'23514',message:/^PRJ_PARENT_CYCLE: /};
  // Existing data: two 3-level trees, a 2-level tree and a top project (the shape a reorganisation can leave behind).
  await pool.query(`update public.app_spaces set parent_id=null`);
  for(const [n,p] of [[1,null],[2,1],[3,2],[10,null],[11,10],[12,11],[13,10],[20,null],[21,20],[30,null]])
   await pool.query('insert into public.app_spaces(id,workspace_id,name,parent_id) values($1,$2,$3,$4)',[id(n),WS_A,'시험 '+n,p==null?null:id(p)]);
  const before=(await pool.query(snapshot)).rows,beforeCheck=v((await pool.query(precheck)).rows);

  await t.test('pre/post checks are read-only aggregates the workflow parser accepts; the migration is SQL Editor only',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   assert.throws(()=>prepareMigration({mode:'apply',version,runId:'1',root}),/DB plan rejected/);
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|grant |policy|disable row level|add column|update public|delete from public|rtw_/i);
   assert.match(code,/security invoker\s+set search_path = ''/);
   assert.match(code,/revoke all on function private\.app_enforce_space_depth\(\) from public, anon, authenticated;/);
   assert.match(code,/before insert or update of parent_id on public\.app_spaces\s+for each row execute function private\.app_enforce_space_depth\(\);/);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261021053502', 'prj_depth_guard'/);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/delete from public|update public|truncate|cascade|grant |policy/i);
  });
  await t.test('precheck: three levels at most, no cycle',()=>{
   assert.deepEqual([beforeCheck['new migration absent'],beforeCheck['depth trigger absent'],beforeCheck['depth function absent'],beforeCheck['parent_id uuid'],beforeCheck['RLS enabled'],
    beforeCheck['max depth'],beforeCheck['rows at level 3'],beforeCheck['rows deeper than 3 levels (=0)'],beforeCheck['rows not reachable from a top project (=0)'],
    beforeCheck['rows whose parent is itself (=0)'],beforeCheck['rows whose parent is missing (=0)'],beforeCheck['rows whose parent is in another workspace (=0)']],
    ['예','예','예','예','예','3','2','0','0','0','0','0']);
  });
  await t.test('apply refuses (and changes nothing) when a 4th level or a cycle already exists',async()=>{
   await pool.query('insert into public.app_spaces(id,workspace_id,name,parent_id) values($1,$2,$3,$4)',[id(4),WS_A,'시험 4',id(3)]);
   assert.equal(v((await pool.query(precheck)).rows)['rows deeper than 3 levels (=0)'],'1');
   await assert.rejects(pool.query(migration),/PRJ_DEPTH_GUARD_PREREQUISITE_CHANGED: depth over 3/);await pool.query('rollback');
   await pool.query('delete from public.app_spaces where id=$1',[id(4)]);
   await pool.query('update public.app_spaces set parent_id=$2 where id=$1',[id(1),id(3)]);
   assert.equal(v((await pool.query(precheck)).rows)['rows not reachable from a top project (=0)'],'3');
   await assert.rejects(pool.query(migration),/PRJ_DEPTH_GUARD_PREREQUISITE_CHANGED: depth over 3, cycle/);await pool.query('rollback');
   await pool.query('update public.app_spaces set parent_id=null where id=$1',[id(1)]);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(v((await pool.query(precheck)).rows),beforeCheck);
  });
  await t.test('apply passes postcheck; rows, constraints, grants and policies unchanged',async()=>{
   await pool.query(migration);
   assert.equal(await history(),1);
   const post=v((await pool.query(postcheck)).rows);
   for(const k of ['trigger and history agree','guard installed','no rows deeper than 3 levels','no unreachable rows (cycle or broken parent)','RLS still enabled'])assert.equal(post[k],'예',k);
   for(const k of ['project row count','max depth','constraints hash','owner RLS grants hash','policies hash','rows hash (parent links only)'])assert.equal(post[k],beforeCheck[k],k);
   const fn=(await pool.query("select prosecdef,proconfig,has_function_privilege('authenticated',oid,'execute') a,has_function_privilege('anon',oid,'execute') n from pg_proc where oid=to_regprocedure('private.app_enforce_space_depth()')")).rows[0];
   assert.deepEqual(fn,{prosecdef:false,proconfig:['search_path=""'],a:false,n:false});
  });
  await t.test('normal 3 levels are allowed for the owner; a 4th level is refused',async()=>{
   await add(40,null);await add(41,40);await add(42,41);
   await assert.rejects(add(43,42),depthErr);
   await assert.rejects(add(44,3),depthErr);
   // Edits that keep the parent, and moves to the top, are not checked and still work.
   await as('authenticated',OWNER,c=>c.query("update public.app_spaces set name='고친 이름', sort_order=5 where id=$1",[id(42)]));
   await as('authenticated',OWNER,c=>c.query('update public.app_spaces set parent_id=parent_id where id=$1',[id(42)]));
   await move(42,null);await move(42,41);
   assert.equal((await pool.query('select count(*)::int n from public.app_spaces where id=any($1)',[[id(43),id(44)]])).rows[0].n,0);
  });
  await t.test('a project cannot be placed under itself or anything below it',async()=>{
   await assert.rejects(move(40,40),cycleErr);
   await assert.rejects(move(40,41),cycleErr);
   await assert.rejects(move(40,42),cycleErr);
   await assert.rejects(move(41,42),cycleErr);
   await assert.rejects(as('authenticated',OWNER,c=>c.query('insert into public.app_spaces(id,workspace_id,owner_id,name,parent_id) values($1,$2,$3,$4,$1)',[id(45),WS_A,OWNER,'시험 45'])),cycleErr);
   assert.equal((await pool.query('select parent_id from public.app_spaces where id=$1',[id(40)])).rows[0].parent_id,null);
  });
  await t.test('moving a project that has children counts the levels below it',async()=>{
   // 20 has one child (2 levels). Under a level-1 project it ends at 3 levels; under a level-2 project it would be 4.
   await assert.rejects(move(20,41),depthErr);
   await assert.rejects(move(20,2),depthErr);
   await assert.rejects(move(20,42),depthErr);
   await move(20,40);
   assert.equal((await pool.query('select parent_id from public.app_spaces where id=$1',[id(21)])).rows[0].parent_id,id(20));
   await move(20,null);
   // A 3-level tree can only stay at the top.
   await assert.rejects(move(10,30),depthErr);
   // 13 has no child: it can go under a level-2 project.
   await move(13,41);await move(13,10);
  });
  await t.test('two saves at the same time cannot build a cycle together',async()=>{
   // A and B are both top projects. One save moves A under B while another moves B under A; the second must wait and refuse.
   await add(60,null);await add(61,null);
   const c1=await pool.connect(),c2=await pool.connect();
   try{
    for(const c of [c1,c2]){await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[OWNER]);await c.query('set local role authenticated');}
    await c1.query('update public.app_spaces set parent_id=$2 where id=$1',[id(60),id(61)]);
    const second=c2.query('update public.app_spaces set parent_id=$2 where id=$1',[id(61),id(60)]);
    await new Promise(r=>setTimeout(r,200));
    await c1.query('commit');
    await assert.rejects(second,cycleErr);await c2.query('rollback');
   }finally{c1.release();c2.release();}
   assert.equal((await pool.query('select parent_id from public.app_spaces where id=$1',[id(61)])).rows[0].parent_id,null);
   await move(60,null);
  });
  await t.test('owner RLS is unchanged: another owner cannot see or move these projects',async()=>{
   assert.equal((await as('authenticated',STRANGER,c=>c.query('select count(*)::int n from public.app_spaces where workspace_id=$1',[WS_A]))).rows[0].n,0);
   assert.equal((await as('authenticated',STRANGER,c=>c.query('update public.app_spaces set parent_id=null where id=$1',[id(42)]))).rowCount,0);
   await assert.rejects(add(50,null,WS_A,STRANGER),{code:'42501'});
   await add(51,null,WS_B,STRANGER);await add(52,51,WS_B,STRANGER);await add(53,52,WS_B,STRANGER);
   await assert.rejects(add(54,53,WS_B,STRANGER),depthErr);
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_spaces limit 1')),{code:'42501'});
  });
  await t.test('running the migration again is refused and keeps one history row',async()=>{
   await assert.rejects(pool.query(migration),/PRJ_DEPTH_GUARD_PREREQUISITE_CHANGED: schema differs/);await pool.query('rollback');
   assert.equal(await history(),1);
   assert.equal(v((await pool.query(postcheck)).rows)['guard installed'],'예');
  });
  await t.test('rollback removes only the guard; schema returns to the snapshot; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const post=v((await pool.query(postcheck)).rows);
   assert.equal(post['trigger and history agree'],'예');assert.equal(post['guard installed'],'아니오');
   // Without the guard the database accepts a 4th level again (the screen check stays).
   await add(43,42);
   await pool.query('delete from public.app_spaces where id=$1',[id(43)]);
   await pool.query(migration);
   assert.equal(await history(),1);
   await assert.rejects(add(43,42),depthErr);
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
 }finally{
  if(pool)await pool.end();
  if(cluster)await cluster.stop().catch(()=>{});
  if(adminPool){await adminPool.query('drop database if exists '+database+' with (force)').catch(()=>{});for(const role of ['anon','authenticated','public_probe','service_role'])await adminPool.query(`drop role if exists ${role}`).catch(()=>{});await adminPool.end();}
 }
});
