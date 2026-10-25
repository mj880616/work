// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// CALL-손고치기 1단계: 20261026120000_call_user_edit - user-edited call values live in two new owner-read-only tables; one owner-checked
// definer function is the only writer; the AI-filled columns of both call tables are never touched.
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
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261026120000',name='call_user_edit',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const CALL={workspace_id:WS_A,source:'call',day:'2026-10-25',occurred_at:'2026-10-25T01:10:00Z',title:'가상 통화',raw_count:0,points:'["[확정] 가상 가","가상 나"]',source_ref:'call:ue1'};
const MISSING='99999999-9999-4999-8999-999999999999';
const ID=/^[0-9a-f-]{36}$/;

test('call user edit: user values live in separate owner-read-only tables, one owner-checked function writes them, AI columns stay; rollback guarded',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'call-user-edit-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query('revoke usage on schema private from service_role');
  await pool.query('grant select on public.app_spaces to authenticated');
  await pool.query('alter table public.app_spaces enable row level security');
  await pool.query('create policy fake_owner_read on public.app_spaces for select to authenticated using (private.app_is_workspace_owner(workspace_id))');
  for(const f of ['20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261025200000_call_personal_box'])await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const COLS=['workspace_id','source','day','occurred_at','title','raw_count','points','source_ref'];
  const putWork=(c,over={})=>{const r={...CALL,...over};return c.query(`insert into public.app_feed_items(${COLS.join(',')}) values(${COLS.map((k,i)=>k==='points'?`$${i+1}::jsonb`:`$${i+1}`).join(',')})`,COLS.map(k=>r[k]));};
  const workRow=async ref=>(await pool.query('select * from public.app_feed_items where source_ref=$1',[ref])).rows[0];
  const edit=(id,patch)=>owner(c=>c.query('select public.app_call_edit($1,$2::jsonb) r',[id,JSON.stringify(patch)])).then(r=>r.rows[0].r);
  const before=(await pool.query(snapshot)).rows;
  await server(c=>putWork(c));
  await pool.query("insert into public.app_call_personal(workspace_id,kind,day,occurred_at,title,source_ref) values($1,'personal','2026-10-25','2026-10-25T01:20:00Z','가상 개인 통화','call:up1')",[WS_A]);
  const beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules pass; two new tables, one definer function; no grant on the existing tables; summary 3 lines; rollback guarded',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual(plan.functions,['public.app_call_edit']);
    assert.deepEqual(plan.review.definer,['public.app_call_edit']);
    assert.deepEqual(plan.createdTables.sort(),['app_call_edit_history','app_call_edits']);
    assert.equal(plan.review.triggers,0);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0].replace(/\s+/g,' '));
   assert.deepEqual(grants,['grant select on table public.app_call_edits to authenticated;','grant select on table public.app_call_edit_history to authenticated;','grant execute on function public.app_call_edit(uuid, jsonb) to authenticated;']);
   assert.doesNotMatch(code,/grant [^;]*(app_feed_items|app_call_personal)/i);
   assert.doesNotMatch(code,/alter table public\.app_(feed_items|call_personal)|alter policy|drop policy|create trigger|create or replace|rtw_|disable row level security|\bto (anon|public)\b/i);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261026120000', 'call_user_edit'/);
   assert.match(rollbackSQL,/SQL Editor 경로 전용/);assert.match(rollbackSQL,/CALL_USER_EDIT_ROLLBACK_BLOCKED/);
  });
  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   const dry=await run('dry-run','9961');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9962');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck));
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else if(v[item]!==undefined)assert.equal(value,v[item],item);
   }
   assert.equal((await run('apply','9963')).ok,false);
  });
  await t.test('owner edits title, name, organization and points; AI columns and history are kept; same value twice writes no history',async()=>{
   const call=await workRow('call:ue1');
   const r1=await edit(call.id,{title:'손으로 고친 제목',counterpart:'가상 팀장',organization_id:ORG_A,points:['고친 줄 하나','고친 줄 둘']});
   assert.equal(r1.ok,true);assert.equal(r1.changed,true);assert.equal(r1.vals.title,'손으로 고친 제목');assert.equal(r1.vals.organization_id,ORG_A);
   const same=await workRow('call:ue1');
   assert.equal(same.title,'가상 통화');assert.deepEqual(same.points,['[확정] 가상 가','가상 나']);assert.equal(same.counterpart,null);assert.equal(same.organization_id,null);
   const hist=(await pool.query("select field,old_value,new_value from public.app_call_edit_history where call_id=$1 order by field",[call.id])).rows;
   assert.deepEqual(hist.map(h=>h.field),['counterpart','organization_id','points','title']);
   assert.equal(hist.find(h=>h.field==='title').old_value,'가상 통화');
   assert.deepEqual(hist.find(h=>h.field==='points').old_value,['[확정] 가상 가','가상 나']);
   const again=await edit(call.id,{title:'손으로 고친 제목'});assert.equal(again.changed,false);
   assert.equal((await pool.query('select count(*)::int n from public.app_call_edit_history where call_id=$1',[call.id])).rows[0].n,4);
   await edit(call.id,{title:'다시 고침'});
   const h2=(await pool.query("select old_value,new_value from public.app_call_edit_history where call_id=$1 and field='title' order by edited_at desc, id limit 1",[call.id])).rows[0];
   assert.equal(h2.new_value,'다시 고침');
   const cleared=await edit(call.id,{organization_id:null});assert.equal(cleared.vals.organization_id,null);
   const reset=await edit(call.id,{reset:['title','points']});assert.deepEqual(Object.keys(reset.vals).sort(),['counterpart','organization_id']);
   assert.equal((await workRow('call:ue1')).title,'가상 통화');
  });
  await t.test('personal calls can be edited except the organization; the id survives a move between boxes',async()=>{
   const p=(await pool.query("select id from public.app_call_personal where source_ref='call:up1'")).rows[0];
   const r=await edit(p.id,{title:'개인 손 제목'});assert.equal(r.vals.title,'개인 손 제목');
   await assert.rejects(edit(p.id,{organization_id:null}),/CALL_EDIT_PERSONAL_ORG/);
   await owner(c=>c.query("select public.app_call_move($1,'work')",[p.id]));
   const moved=await workRow('call:up1');assert.equal(moved.id,p.id);
   assert.equal((await pool.query('select vals->>$2 v from public.app_call_edits where call_id=$1',[p.id,'title'])).rows[0].v,'개인 손 제목');
  });
  await t.test('bad input, other workspace organization, strangers, anon, service_role and unknown rows are refused',async()=>{
   const call=await workRow('call:ue1');
   for(const [patch,re] of [[{bogus:1},/CALL_EDIT_FIELD/],[{title:''},/CALL_EDIT_TITLE/],[{title:'가'.repeat(81)},/CALL_EDIT_TITLE/],[{title:'가\n나'},/CALL_EDIT_TITLE/],[{counterpart:'가'.repeat(101)},/CALL_EDIT_COUNTERPART/],[{points:Array(9).fill('가')},/CALL_EDIT_POINTS/],[{points:['  ']},/CALL_EDIT_POINTS/],[{points:[1]},/CALL_EDIT_POINTS/],[{reset:['source']},/CALL_EDIT_FIELD/],[{organization_id:'x'},/CALL_EDIT_ORGANIZATION/],[{organization_id:ORG_B},/FEED_LINK_SCOPE/],[{organization_id:MISSING},/FEED_LINK_SCOPE/]])
    await assert.rejects(edit(call.id,patch),re,JSON.stringify(patch));
   await assert.rejects(owner(c=>c.query("select public.app_call_edit($1,'[]'::jsonb)",[call.id])),/CALL_EDIT_PATCH/);
   await assert.rejects(edit(MISSING,{title:'가'}),/CALL_NOT_FOUND/);
   await assert.rejects(stranger(c=>c.query("select public.app_call_edit($1,'{\"title\":\"x\"}')",[call.id])),/CALL_NOT_FOUND/);
   await assert.rejects(as('anon','',c=>c.query("select public.app_call_edit($1,'{}')",[call.id])),{code:'42501'});
   await assert.rejects(server(c=>c.query("select public.app_call_edit($1,'{}')",[call.id])),{code:'42501'});
  });
  await t.test('nobody writes the new tables directly; the owner reads them; strangers, anon and service_role see nothing',async()=>{
   const call=await workRow('call:ue1');
   for(const sql of ["insert into public.app_call_edits(call_id,workspace_id) values(gen_random_uuid(),'"+WS_A+"')","update public.app_call_edits set vals='{}'","delete from public.app_call_edits","insert into public.app_call_edit_history(workspace_id,call_id,field) values('"+WS_A+"',gen_random_uuid(),'title')","update public.app_call_edit_history set field='title'","delete from public.app_call_edit_history"])
    await assert.rejects(owner(c=>c.query(sql)),{code:'42501'},sql);
   assert.ok((await owner(c=>c.query('select * from public.app_call_edits'))).rows.length>=1);
   assert.ok((await owner(c=>c.query('select * from public.app_call_edit_history'))).rows.length>=4);
   assert.equal((await stranger(c=>c.query('select * from public.app_call_edits'))).rows.length,0);
   assert.equal((await stranger(c=>c.query('select * from public.app_call_edit_history'))).rows.length,0);
   await assert.rejects(as('anon','',c=>c.query('select * from public.app_call_edits')),{code:'42501'});
   await assert.rejects(server(c=>c.query('select * from public.app_call_edits')),{code:'42501'});
   await assert.rejects(server(c=>c.query('select * from public.app_call_edit_history')),{code:'42501'});
   assert.ok(ID.test(call.id));
  });
  await t.test('the existing call tables keep their grants: still no direct title or points write for the owner',async()=>{
   const call=await workRow('call:ue1');
   await assert.rejects(owner(c=>c.query("update public.app_feed_items set title='직접' where id=$1",[call.id])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_feed_items set points='[]' where id=$1",[call.id])),{code:'42501'});
  });
  await t.test('rollback is refused while user edits exist, then restores the snapshot after they are emptied; re-apply works',async()=>{
   const blocked=async()=>{const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/CALL_USER_EDIT_ROLLBACK_BLOCKED/);await c.query('rollback');}finally{c.release();}};
   await blocked();
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,1,'nothing changed');
   await pool.query('delete from public.app_call_edits');await pool.query('delete from public.app_call_edit_history');
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.equal((await pool.query("select to_regclass('public.app_call_edits') a,to_regprocedure('public.app_call_edit(uuid,jsonb)') f")).rows[0].a,null);
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
