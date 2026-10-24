// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic (no real project names).
// TRASH-삭제휴지통 1단계: 20261024193000_trash_projects_db — project [삭제] goes to the trash (deleted_at) instead of DELETE,
// trashed rows are hidden from authenticated reads by a restrictive policy, and app_trash_list/restore/purge are owner-only.
// The existing unlink trigger (20260921231000) and the depth guard (20261021053502) are applied from their real files.
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
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
const version='20261024193000',name='trash_projects_db',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const id=n=>`27000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

// Existing shapes the trash depends on: app_spaces (parent_id self reference on delete cascade, owner RLS), the records the
// unlink trigger keeps (tasks, events, meetings, documents, pages) and project-owned rows that cascade (workstreams, progress).
// Nothing here comes from production.
const shapes=`
  alter table public.app_spaces add column owner_id uuid default '${OWNER}', add column name text not null default 'p',
    add column parent_id uuid references public.app_spaces(id) on delete cascade, add column status text default 'active',
    add column sort_order integer default 0;
  create table public.app_project_workstreams(id uuid primary key, project_id uuid not null references public.app_spaces(id) on delete cascade, title text);
  create table public.app_project_progress_updates(id uuid primary key, project_id uuid not null references public.app_spaces(id) on delete cascade, body text);
  create table public.app_tasks(id uuid primary key, workspace_id uuid not null, project_id uuid references public.app_spaces(id),
    workstream_id uuid references public.app_project_workstreams(id), source_type text, source_id uuid, title text);
  create table public.app_events(id uuid primary key, workspace_id uuid not null, project_id uuid references public.app_spaces(id),
    workstream_id uuid references public.app_project_workstreams(id));
  alter table public.app_meetings add column project_id uuid references public.app_spaces(id), add column workstream_id uuid references public.app_project_workstreams(id);
  create table public.app_documents(id uuid primary key, workspace_id uuid not null, project_id uuid references public.app_spaces(id),
    workstream_id uuid references public.app_project_workstreams(id));
  create table public.app_pages(id uuid primary key, workspace_id uuid not null, space_id uuid references public.app_spaces(id),
    workstream_id uuid references public.app_project_workstreams(id));
  grant select, insert, update, delete on public.app_spaces, public.app_project_workstreams, public.app_project_progress_updates,
    public.app_tasks, public.app_events, public.app_meetings, public.app_documents, public.app_pages to authenticated;
  alter table public.app_spaces enable row level security;
  create policy synthetic_spaces_owner on public.app_spaces for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));`;

test('TRASH 1단계: prechecks, apply, delete goes to trash and keeps links, hidden from reads, owner-only list/restore/purge, rerun safe, rollback',{timeout:120000},async t=>{
 let cluster,pool;
 const directory=await mkdtemp(join(tmpdir(),'trash-projects-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex');
 cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 await cluster.initialise();await cluster.start();
 try{
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(shapes);
  await pool.query('delete from public.app_spaces');
  await pool.query(await read('supabase/migrations/20260921231000_fix_project_delete_workstream_unlink.sql'));
  await pool.query(await read('supabase/migrations/20261021053502_prj_depth_guard.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const v=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value??r.ok]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn);
  const rpc=(sub,fn,...args)=>as('authenticated',sub,c=>c.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)).then(x=>x.rows[0].r);
  const del=n=>owner(c=>c.query('delete from public.app_spaces where id=$1',[id(n)]));
  const visible=async n=>(await owner(c=>c.query('select count(*)::int n from public.app_spaces where id=any($1)',[n.map(id)]))).rows[0].n;
  const row=async n=>(await pool.query('select deleted_at is not null trashed,deleted_root_id from public.app_spaces where id=$1',[id(n)])).rows[0];
  const links=async()=>(await pool.query(`select
    (select string_agg(coalesce(project_id::text,'-')||'/'||coalesce(workstream_id::text,'-')||'/'||coalesce(source_id::text,'-'),',' order by id) from public.app_tasks) tasks,
    (select string_agg(coalesce(project_id::text,'-'),',' order by id) from public.app_events) events,
    (select string_agg(coalesce(project_id::text,'-'),',' order by id) from public.app_meetings) meetings,
    (select string_agg(coalesce(project_id::text,'-'),',' order by id) from public.app_documents) docs,
    (select string_agg(coalesce(space_id::text,'-'),',' order by id) from public.app_pages) pages,
    (select count(*)::int from public.app_project_workstreams) ws,(select count(*)::int from public.app_project_progress_updates) progress`)).rows[0];
  // Synthetic data: tree 1 > 2 > 3 with records on every level, a sibling top project 10, and a stranger's project 50.
  for(const [n,p,ws,o] of [[1,null,WS_A,OWNER],[2,1,WS_A,OWNER],[3,2,WS_A,OWNER],[10,null,WS_A,OWNER],[50,null,WS_B,STRANGER]])
   await pool.query('insert into public.app_spaces(id,workspace_id,owner_id,name,parent_id) values($1,$2,$3,$4,$5)',[id(n),ws,o,'시험 '+n,p==null?null:id(p)]);
  for(const n of [1,2,3,10]){
   await pool.query('insert into public.app_project_workstreams values($1,$2,$3)',[id(100+n),id(n),'흐름']);
   await pool.query('insert into public.app_project_progress_updates values($1,$2,$3)',[id(200+n),id(n),'기록']);
   await pool.query("insert into public.app_tasks values($1,$2,$3,$4,'project',$3,'할 일')",[id(300+n),WS_A,id(n),id(100+n)]);
   await pool.query('insert into public.app_events values($1,$2,$3,$4)',[id(400+n),WS_A,id(n),id(100+n)]);
   await pool.query('insert into public.app_meetings(id,workspace_id,project_id,workstream_id) values($1,$2,$3,$4)',[id(500+n),WS_A,id(n),id(100+n)]);
   await pool.query('insert into public.app_documents values($1,$2,$3,$4)',[id(600+n),WS_A,id(n),id(100+n)]);
   await pool.query('insert into public.app_pages values($1,$2,$3,$4)',[id(700+n),WS_A,id(n),id(100+n)]);
  }
  const before=(await pool.query(snapshot)).rows,beforeCheck=v((await pool.query(precheck)).rows),linksBefore=await links();

  await t.test('pair files pass the workflow parser; the migration takes the approval-once expanded flow',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.targets,['app_spaces']);
   assert.deepEqual(plan.review.definer.sort(),['private.app_trash_space_before_delete','public.app_trash_list','public.app_trash_purge','public.app_trash_restore']);
   assert.equal(plan.review.policies,1);assert.equal(plan.review.restrictive,1);
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/to (anon|public)\b|rtw_|disable row level|drop policy|alter policy|as permissive/i);
   assert.match(code,/create policy app_spaces_trash_hidden on public\.app_spaces as restrictive for all to authenticated/);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261024193000', 'trash_projects_db'/);
  });
  await t.test('precheck: every condition is 예',()=>{
   for(const k of ['new migration absent','trash columns absent','trash functions absent','trash trigger policy constraint index absent','id workspace_id parent_id are uuid',
    'name column present','RLS enabled and not forced','postgres owns or bypasses RLS','owner check function present','parent_id foreign key cascades','only the unlink before delete trigger'])
    assert.equal(beforeCheck[k],'예',k);
   assert.equal(beforeCheck['project row count'],'5');
  });
  await t.test('apply refuses (and changes nothing) when another before-delete trigger exists',async()=>{
   await pool.query(`create function private.synthetic_noop() returns trigger language plpgsql as $$begin return old; end$$;
     create trigger app_spaces_zz_other before delete on public.app_spaces for each row execute function private.synthetic_noop();`);
   assert.equal(v((await pool.query(precheck)).rows)['only the unlink before delete trigger'],'아니오');
   await assert.rejects(pool.query(migration),/TRASH_PROJECTS_PREREQUISITE_CHANGED/);await pool.query('rollback');
   await pool.query('drop trigger app_spaces_zz_other on public.app_spaces; drop function private.synthetic_noop();');
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(v((await pool.query(precheck)).rows),beforeCheck);
  });
  await t.test('dry-run (last commit -> rollback) leaves no trace; apply passes postcheck',async()=>{
   await pool.query(migration.replace(/commit;\s*$/,'rollback;'));
   assert.equal(await history(),0);assert.deepEqual(v((await pool.query(precheck)).rows),beforeCheck);
   await pool.query(migration);
   assert.equal(await history(),1);
   const post=v((await pool.query(postcheck)).rows);
   for(const k of ['objects and history agree','trash installed','trash trigger runs before unlink','unlink trigger still enabled','RLS still enabled and not forced'])assert.equal(post[k],'예',k);
   for(const k of ['project row count','top project count','foreign keys to app_spaces by action','triggers','constraints hash','columns hash','owner RLS grants hash','policies hash','rows hash (parent links only)'])assert.equal(post[k],beforeCheck[k],k);
   const fns=(await pool.query(`select p.oid::regprocedure::text f,has_function_privilege('anon',p.oid,'execute') a,has_function_privilege('authenticated',p.oid,'execute') u,
     has_function_privilege('service_role',p.oid,'execute') s from pg_proc p where proname like 'app_trash_%' order by 1`)).rows;
   assert.deepEqual(fns.map(f=>[f.f,f.a,f.u,f.s]),[['app_trash_list(text)',false,true,false],['app_trash_purge(text,uuid)',false,true,false],
    ['app_trash_restore(text,uuid)',false,true,false],['private.app_trash_space_before_delete()',false,false,false]]);
  });
  await t.test('the existing screen DELETE moves the project and its children to the trash; every link stays',async()=>{
   assert.equal(await visible([1,2,3,10]),4);
   const r=await del(1);
   assert.equal(r.rowCount,0); // nothing is deleted; PostgREST answers the same 204
   assert.equal(await visible([1,2,3]),0);assert.equal(await visible([10]),1);
   for(const n of [1,2,3])assert.deepEqual(await row(n),{trashed:true,deleted_root_id:id(1)});
   assert.deepEqual(await row(10),{trashed:false,deleted_root_id:null});
   assert.deepEqual(await links(),linksBefore);
   // Records that point at a trashed project stay readable (they were never deleted), as before with an empty project.
   assert.equal((await owner(c=>c.query('select count(*)::int n from public.app_tasks where project_id=$1',[id(2)]))).rows[0].n,1);
  });
  await t.test('the screen cannot see, change, re-delete or forge trash rows',async()=>{
   assert.equal((await owner(c=>c.query("update public.app_spaces set name='고침' where id=$1",[id(1)]))).rowCount,0);
   assert.equal((await del(2)).rowCount,0);assert.deepEqual(await row(2),{trashed:true,deleted_root_id:id(1)});
   await assert.rejects(owner(c=>c.query('update public.app_spaces set deleted_at=now(),deleted_root_id=id where id=$1',[id(10)])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_spaces(id,workspace_id,owner_id,name,deleted_at,deleted_root_id) values($1,$2,$3,'위조',now(),$1)",[id(20),WS_A,OWNER])),{code:'42501'});
   await assert.rejects(pool.query('update public.app_spaces set deleted_at=now() where id=$1',[id(10)]),{code:'23514'}); // pair check
  });
  await t.test('app_trash_list: owner sees only the batch top with child count; stranger sees nothing; anon cannot call',async()=>{
   const list=await rpc(OWNER,'app_trash_list','project');
   assert.equal(list.length,1);
   assert.deepEqual({id:list[0].id,name:list[0].name,parent:list[0].parent_id,children:list[0].child_count,inTrash:list[0].parent_in_trash,kind:list[0].kind},
    {id:id(1),name:'시험 1',parent:null,children:2,inTrash:false,kind:'project'});
   assert.deepEqual(await rpc(STRANGER,'app_trash_list','project'),[]);
   await assert.rejects(rpc(OWNER,'app_trash_list','task'),/TRASH_KIND_UNKNOWN/);
   await assert.rejects(as('anon','',c=>c.query("select public.app_trash_list('project')")),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query("select public.app_trash_restore('project',$1)",[id(1)])),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query("select public.app_trash_purge('project',$1)",[id(1)])),{code:'42501'});
  });
  await t.test('app_trash_restore: only the owner, only a batch top; brings back the whole batch with links',async()=>{
   await assert.rejects(rpc(STRANGER,'app_trash_restore','project',id(1)),/TRASH_NOT_FOUND/);
   await assert.rejects(rpc(OWNER,'app_trash_restore','project',id(2)),/TRASH_NOT_FOUND/); // a child inside the batch
   await assert.rejects(rpc(OWNER,'app_trash_restore','project',id(10)),/TRASH_NOT_FOUND/); // not in the trash
   const r=await rpc(OWNER,'app_trash_restore','project',id(1));
   assert.deepEqual(r,{ok:true,kind:'project',id:id(1),restored:3});
   assert.equal(await visible([1,2,3,10]),4);
   assert.deepEqual(await links(),linksBefore);
   assert.deepEqual(await rpc(OWNER,'app_trash_list','project'),[]);
  });
  await t.test('a child trashed first keeps its own batch; restoring it waits for its parent',async()=>{
   await del(3);await del(1);
   assert.deepEqual(await row(3),{trashed:true,deleted_root_id:id(3)});
   assert.deepEqual(await row(2),{trashed:true,deleted_root_id:id(1)});
   const list=await rpc(OWNER,'app_trash_list','project');
   assert.deepEqual(list.map(x=>[x.id,x.child_count,x.parent_in_trash]).sort(),[[id(1),1,false],[id(3),0,true]].sort());
   await assert.rejects(rpc(OWNER,'app_trash_restore','project',id(3)),/TRASH_PARENT_IN_TRASH/);
   assert.equal((await rpc(OWNER,'app_trash_restore','project',id(1))).restored,2);
   assert.equal(await visible([1,2,3]),2);
   assert.equal((await rpc(OWNER,'app_trash_restore','project',id(3))).restored,1);
   assert.equal(await visible([1,2,3]),3);
   assert.deepEqual(await links(),linksBefore);
  });
  await t.test('deleting a parent and its child in one statement fails safely (nothing lost)',async()=>{
   await assert.rejects(owner(c=>c.query('delete from public.app_spaces where id=any($1)',[[id(1),id(2)]])));
   assert.equal(await visible([1,2,3]),3);assert.deepEqual(await links(),linksBefore);
  });
  await t.test('other saves still work: rename, move, 3-level guard',async()=>{
   await owner(c=>c.query("update public.app_spaces set name='고친 이름' where id=$1",[id(10)]));
   await assert.rejects(owner(c=>c.query('update public.app_spaces set parent_id=$2 where id=$1',[id(10),id(3)])),{code:'23514'});
   await owner(c=>c.query('update public.app_spaces set parent_id=$2 where id=$1',[id(10),id(1)]));
   await owner(c=>c.query('update public.app_spaces set parent_id=null where id=$1',[id(10)]));
  });
  await t.test('app_trash_purge: owner only, trash only; then the old delete behaviour runs (unlink + cascade)',async()=>{
   await assert.rejects(rpc(OWNER,'app_trash_purge','project',id(10)),/TRASH_NOT_FOUND/);
   assert.equal(await visible([10]),1);
   await del(1);
   await assert.rejects(rpc(STRANGER,'app_trash_purge','project',id(1)),/TRASH_NOT_FOUND/);
   await assert.rejects(rpc(OWNER,'app_trash_purge','project',id(2)),/TRASH_NOT_FOUND/);
   assert.deepEqual(await rpc(OWNER,'app_trash_purge','project',id(1)),{ok:true,kind:'project',id:id(1)});
   assert.equal((await pool.query('select count(*)::int n from public.app_spaces where id=any($1)',[[1,2,3].map(id)])).rows[0].n,0);
   const after=await links();
   assert.equal(after.ws,1);assert.equal(after.progress,1); // only project 10's own rows remain
   for(const k of ['events','meetings','docs','pages']){
    const ids=after[k].split(',');
    assert.equal(ids.filter(x=>x===id(10)).length,1,k);
    assert.ok([1,2,3].every(n=>!ids.includes(id(n))),k); // unlinked, the rows themselves remain
    assert.equal(ids.length,linksBefore[k].split(',').length,k);
   }
   assert.equal(after.tasks.split(',').filter(x=>x==='-/-/-').length,3);
   assert.deepEqual(await rpc(OWNER,'app_trash_list','project'),[]);
   assert.equal((await pool.query('select count(*)::int n from public.app_spaces where id=$1',[id(50)])).rows[0].n,1);
  });
  await t.test('running the migration again is refused and keeps one history row',async()=>{
   await assert.rejects(pool.query(migration),/TRASH_PROJECTS_PREREQUISITE_CHANGED/);await pool.query('rollback');
   assert.equal(await history(),1);
  });
  await t.test('rollback removes only the trash pieces; trashed projects come back; delete is immediate again',async()=>{
   await pool.query('insert into public.app_spaces(id,workspace_id,owner_id,name) values($1,$2,$3,$4)',[id(30),WS_A,OWNER,'시험 30']);
   await del(30);assert.equal(await visible([30]),0);
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   const post=v((await pool.query(postcheck)).rows);
   assert.equal(post['objects and history agree'],'예');assert.equal(post['trash installed'],'아니오');
   assert.equal(await visible([30]),1);
   assert.equal((await del(30)).rowCount,1);
   await pool.query(migration);assert.equal(await history(),1);
   assert.equal(v((await pool.query(postcheck)).rows)['trash installed'],'예');
   await pool.query(rollbackSQL);assert.equal(await history(),0);
  });
 }finally{
  await closePool(pool);
  if(cluster)await cluster.stop().catch(()=>{});
 }
});
