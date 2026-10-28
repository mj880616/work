// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// FEAT-1029 ② DB(20261029070000_pre_meeting_sheets): app_pre_meeting_sheets — through the approved DB workflow runner.
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
const version='20261029070000',name='pre_meeting_sheets',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const ORG_A2='23000000-0000-4000-8000-000000000031';

const prerequisites=`
  revoke all on public.app_suborganizations from public, anon;
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  insert into public.app_suborganizations values ('${ORG_A2}','${WS_A}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;

test('pre-meeting sheets db: plan, dry-run, apply, owner boundary, org scope, org delete cascade, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'pre-meeting-sheets-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const KEY='primary:evt-4th-round';
  const top=JSON.stringify([{text:'3차에서 남은 쟁점은 두 가지임.',refs:['m1']}]);
  const groups=JSON.stringify([{group:'meetings',title:'A 사업장 임금교섭 3차',day:'2026-10-27',source_kind:'meeting',source_id:'m1'}]);
  const save=(sub,ws,org,key,extra={})=>as('authenticated',sub,c=>c.query(
   `insert into public.app_pre_meeting_sheets(workspace_id,event_key,organization_id,event_title,event_start,event_end,event_location,top_lines,groups,ai_status,made_by)
    values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)
    on conflict (workspace_id,event_key) do update set organization_id=excluded.organization_id,event_title=excluded.event_title,event_start=excluded.event_start,
      event_end=excluded.event_end,event_location=excluded.event_location,top_lines=excluded.top_lines,groups=excluded.groups,ai_status=excluded.ai_status,made_by=excluded.made_by,updated_at=now()`,
   [ws,key,org,extra.title??'A 사업장 임금교섭 4차',extra.start??'2026-11-03T05:00:00Z',extra.end??'2026-11-03T07:00:00Z',extra.location??'본사 회의실',
    extra.top??top,extra.groups??groups,extra.ai??'ok',extra.made??'auto']));

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
   const dry=await run('dry-run','9901');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; second apply refused',async()=>{
   const apply=await run('apply','9902');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9903')).ok,false);
  });
  await t.test('owner writes one row per event; regenerate overwrites; anon and other workspaces refused',async()=>{
   await save(OWNER,WS_A,ORG_A,KEY);
   await save(OWNER,WS_A,ORG_A,KEY,{ai:'limit',top:'[]',made:'user',title:'A 사업장 임금교섭 4차(변경)'});
   const rows=(await owner(c=>c.query('select ai_status,made_by,event_title,jsonb_array_length(top_lines) n from public.app_pre_meeting_sheets'))).rows;
   assert.deepEqual(rows,[{ai_status:'limit',made_by:'user',event_title:'A 사업장 임금교섭 4차(변경)',n:0}]);
   // The event can be re-linked to another organization of the same workspace.
   await save(OWNER,WS_A,ORG_A2,KEY);
   assert.equal((await owner(c=>c.query('select organization_id from public.app_pre_meeting_sheets'))).rows[0].organization_id,ORG_A2);
   await save(OWNER,WS_A,ORG_A,KEY);
   // anon: no privilege at all.
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_pre_meeting_sheets')),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query(`insert into public.app_pre_meeting_sheets(workspace_id,event_key,organization_id,event_title,event_start,ai_status,made_by) values ('${WS_A}','primary:x','${ORG_A}','t',now(),'ok','auto')`)),{code:'42501'});
   // Stranger: sees nothing, cannot write into the owner's workspace, cannot change or delete the owner's row.
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_pre_meeting_sheets'))).rows[0].n,0);
   await assert.rejects(save(STRANGER,WS_A,ORG_A,'primary:other'),refused);
   assert.equal((await stranger(c=>c.query("update public.app_pre_meeting_sheets set ai_status='failed'"))).rowCount,0);
   await assert.rejects(stranger(c=>c.query('delete from public.app_pre_meeting_sheets')),{code:'42501'});
   // Owner of WS_A is not owner of WS_B.
   await assert.rejects(save(OWNER,WS_B,ORG_B,'primary:b'),refused);
  });
  await t.test('organization scope: another workspace organization refused on insert and on re-link',async()=>{
   await assert.rejects(save(OWNER,WS_A,ORG_B,'primary:other-org'),{code:'23514'});
   await assert.rejects(save(STRANGER,WS_B,ORG_A,'primary:cross'),{code:'23514'});
   await assert.rejects(owner(c=>c.query('update public.app_pre_meeting_sheets set organization_id=$1',[ORG_B])),{code:'23514'});
   assert.equal((await owner(c=>c.query('select organization_id from public.app_pre_meeting_sheets'))).rows[0].organization_id,ORG_A);
  });
  await t.test('owner cannot delete, move keys or set created_at',async()=>{
   await assert.rejects(owner(c=>c.query('delete from public.app_pre_meeting_sheets')),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_pre_meeting_sheets set event_key='primary:moved'")),{code:'42501'});
   await assert.rejects(owner(c=>c.query('update public.app_pre_meeting_sheets set workspace_id=$1',[WS_B])),{code:'42501'});
   await assert.rejects(owner(c=>c.query(`insert into public.app_pre_meeting_sheets(workspace_id,event_key,organization_id,event_title,event_start,ai_status,made_by,created_at) values ('${WS_A}','primary:c','${ORG_A}','t',now(),'ok','auto',now())`)),{code:'42501'});
  });
  await t.test('shape guard: key, title, time order, top at most 3, arrays only, known status and maker',async()=>{
   const bad=extra=>assert.rejects(save(OWNER,WS_A,ORG_A,extra.key??'primary:bad',extra),{code:'23514'});
   await bad({key:'ab'});await bad({key:'primary:with space'});await bad({key:'x'.repeat(601)});
   await bad({title:''});await bad({title:'줄\n바꿈'});await bad({title:'가'.repeat(301)});
   await bad({location:''});await bad({start:'2026-11-03T07:00:00Z',end:'2026-11-03T05:00:00Z'});
   await bad({top:JSON.stringify([{},{},{},{}])});await bad({groups:'{}'});await bad({top:'{}'});
   await bad({ai:'great'});await bad({made:'schedule'});
   await bad({groups:JSON.stringify(Array.from({length:201},()=>({})))});
   assert.ok(await save(OWNER,WS_A,ORG_A,'primary:no-end',{end:null,location:null}));
  });
  await t.test('deleting an organization removes its sheets; rollback returns to the snapshot',async()=>{
   assert.equal((await pool.query('select count(*)::int n from public.app_pre_meeting_sheets where organization_id=$1',[ORG_A])).rows[0].n,2);
   await pool.query('delete from public.app_suborganizations where id=$1',[ORG_A]);
   assert.equal((await pool.query('select count(*)::int n from public.app_pre_meeting_sheets')).rows[0].n,0);
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
