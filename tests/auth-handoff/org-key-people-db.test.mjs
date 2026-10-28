// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// ORG-주요인물 DB(20261029014700_org_key_people): app_org_key_people + app_org_key_people_briefs — through the approved DB workflow runner.
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
const version='20261029014700',name='org_key_people',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const ORG_A2='23000000-0000-4000-8000-000000000021';

const prerequisites=`
  revoke all on public.app_suborganizations from public, anon;
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  insert into public.app_suborganizations values ('${ORG_A2}','${WS_A}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;

test('org key people db: plan, dry-run, apply, owner boundary, scope and match-name guard, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'org-key-people-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  // A stranger cannot see the owner's organization: the scope guard (23514) or RLS (42501) refuses first.
  const refused=e=>['42501','23514'].includes(e.code);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item??r.kind,r.value??r.ok]));
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const addPerson=(sub,ws,org,nm,match=[])=>as('authenticated',sub,async c=>(await c.query('insert into public.app_org_key_people(workspace_id,organization_id,name,match_names) values ($1,$2,$3,$4) returning id',[ws,org,nm,match])).rows[0].id);

  await t.test('approval plan: expanded rules, full flow, no definer function, two triggers',()=>{
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
   const dry=await run('dry-run','9901');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; second apply refused',async()=>{
   const apply=await run('apply','9902');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9903')).ok,false);
  });
  await t.test('people: owner only, anon refused, same-workspace organization, clean match names, one name per organization',async()=>{
   const kim=await addPerson(OWNER,WS_A,ORG_A,'김하나',['김하나','김 위원장']);
   assert.ok(kim);
   // Same person may be key person of another organization (separate row).
   assert.ok(await addPerson(OWNER,WS_A,ORG_A2,'김하나',['김하나']));
   await assert.rejects(addPerson(OWNER,WS_A,ORG_A,'김하나'),{code:'23505'});
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_org_key_people')),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_org_key_people_briefs')),{code:'42501'});
   // Stranger cannot read or write the owner's rows, nor attach to the owner's organization.
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_org_key_people'))).rows[0].n,0);
   await assert.rejects(addPerson(STRANGER,WS_A,ORG_A,'침입'),refused);
   assert.equal((await stranger(c=>c.query("update public.app_org_key_people set name='가로채기' where id=$1",[kim]))).rowCount,0);
   assert.equal((await stranger(c=>c.query('delete from public.app_org_key_people where id=$1',[kim]))).rowCount,0);
   // Owner of WS_A cannot point a row at another workspace's organization (scope guard), stranger cannot either.
   await assert.rejects(addPerson(OWNER,WS_A,ORG_B,'남의 조직'),{code:'23514'});
   await assert.rejects(addPerson(STRANGER,WS_B,ORG_A,'남의 조직'),{code:'23514'});
   // Name and match-name rules.
   for(const bad of ['',' 김','가'.repeat(41)])await assert.rejects(addPerson(OWNER,WS_A,ORG_A,bad),{code:'23514'});
   for(const bad of [['김'],[' 김하나'],['김하나','김하나'],['a\nb'],Array.from({length:21},(_,i)=>'이름'+i)])
    await assert.rejects(addPerson(OWNER,WS_A,ORG_A,'박둘',bad),{code:'23514'});
   await assert.rejects(owner(c=>c.query("update public.app_org_key_people set match_names=array['김'] where id=$1",[kim])),{code:'23514'});
   // Owner edits: name, match names, order. Ids and scope columns are fixed.
   assert.equal((await owner(c=>c.query("update public.app_org_key_people set match_names=array['김하나','하나 위원장'],sort_order=2,updated_at=now() where id=$1",[kim]))).rowCount,1);
   await assert.rejects(owner(c=>c.query('update public.app_org_key_people set organization_id=$1 where id=$2',[ORG_A2,kim])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('update public.app_org_key_people set workspace_id=$1 where id=$2',[WS_B,kim])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_org_key_people(id,workspace_id,organization_id,name) values (gen_random_uuid(),$1,$2,'id 지정')",[WS_A,ORG_A])),{code:'42501'});
   assert.equal((await owner(c=>c.query('delete from public.app_org_key_people where organization_id=$1',[ORG_A2]))).rowCount,1);
  });
  await t.test('briefs: owner writes one row per organization; stranger and other workspace refused',async()=>{
   const write=(sub,ws,org,text)=>as('authenticated',sub,c=>c.query("insert into public.app_org_key_people_briefs(organization_id,workspace_id,day,brief) values ($1,$2,'2026-10-29',$3) on conflict (organization_id) do update set brief=excluded.brief,day=excluded.day,updated_at=now()",[org,ws,text]));
   await write(OWNER,WS_A,ORG_A,'요즘 교섭 일정 조율 중(김하나).');
   await write(OWNER,WS_A,ORG_A,'요즘 조정 신청 준비(김하나).');
   assert.equal((await pool.query('select count(*)::int n, max(brief) b from public.app_org_key_people_briefs')).rows[0].b,'요즘 조정 신청 준비(김하나).');
   await assert.rejects(write(STRANGER,WS_A,ORG_A,'침입'),refused);
   await assert.rejects(write(OWNER,WS_A,ORG_B,'남의 조직'),{code:'23514'});
   for(const bad of ['','가'.repeat(301),'줄\n바꿈'])await assert.rejects(write(OWNER,WS_A,ORG_A2,bad),{code:'23514'});
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_org_key_people_briefs'))).rows[0].n,0);
   await assert.rejects(owner(c=>c.query('update public.app_org_key_people_briefs set organization_id=$1',[ORG_A2])),{code:'42501'});
  });
  await t.test('deleting an organization removes its rows; rollback returns to the snapshot',async()=>{
   await pool.query('delete from public.app_suborganizations where id=$1',[ORG_A]);
   assert.equal((await pool.query('select count(*)::int n from public.app_org_key_people where organization_id=$1',[ORG_A])).rows[0].n,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_org_key_people_briefs where organization_id=$1',[ORG_A])).rows[0].n,0);
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
