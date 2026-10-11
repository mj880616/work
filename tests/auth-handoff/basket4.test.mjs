import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,PROJECT_A2,PROJECT_B,ORG_A,ORG_B} from './basket4-fixture.mjs';
const version='20261011180000', name='basket4a_confirm_links', stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
test('BASKET-4a approved plan + real PostgreSQL owner RLS, atomic confirmation and rollback', {timeout:90000},async t=>{
 for(const mode of ['apply','dry-run','rollback'])assert.doesNotThrow(()=>prepareMigration({mode,version,runId:'404',root:new URL('../../',import.meta.url).pathname}));
 const migration=await read('supabase/migrations/'+stem+'.sql');
 const directory=await mkdtemp(join(tmpdir(),'basket4-isolated-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;const clientEnds=[];
 try{
 await cluster.initialise();await cluster.start();pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false});pool.on('connect',client=>clientEnds.push(new Promise(done=>client.once('end',done))));
 await pool.query(fixture);
 for(const file of ['20260927103344_task_impl2_notes_record_links.sql','20260928123601_task_meeting_followup_record_links.sql'])await pool.query(await read('supabase/migrations/'+file));
 await pool.query(`create table public.app_documents(id uuid primary key, workspace_id uuid);alter table public.app_spaces add column owner_id uuid default '${OWNER}',add column name text, add column parent_id uuid, add column status text default 'active',add column metadata jsonb default '{"project_system":"v2"}';
 grant select on public.app_spaces to authenticated;alter table public.app_spaces enable row level security;
 create policy spaces_owner on public.app_spaces for all to authenticated using(private.app_is_workspace_owner(workspace_id)) with check(private.app_is_workspace_owner(workspace_id));
 -- SELECT FOR SHARE requires UPDATE ACL, just like the actual app_spaces owner path.
 grant update on public.app_spaces to authenticated;`);
 await pool.query(await read('supabase/migrations/20261010120000_basket1_notes_links.sql'));
 const note=(await pool.query(`insert into public.app_notes(workspace_id,raw_text,updated_at)values($1,E'  원문\n',$2) returning *`,[WS_A,'2026-10-11T01:02:03.123456Z'])).rows[0], stamp='2026-10-11T01:02:03.123456Z';
 const policies=(await pool.query('select polname,pg_get_expr(polqual,polrelid) qual,pg_get_expr(polwithcheck,polrelid) chk from pg_policy order by polname')).rows;
 async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub]);await c.query('set local role '+role);const result=await fn(c);await c.query('commit');return result;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
 const target=(kind,id)=>({kind,target_id:id,reason:'일반 글 <b>이유</b>'});
 const call=(targets,updated=stamp,sub=OWNER,role='authenticated')=>as(role,sub,async c=>(await c.query('select public.app_basket_confirm_links($1,$2,$3::jsonb) result',[note.id,updated,JSON.stringify(targets)])).rows[0].result);
 const count=async()=>Number((await pool.query('select count(*) n from public.app_record_links where note_id=$1',[note.id])).rows[0].n);
 await t.test('precheck, dry-run leaves no function, postcheck has no NULL baseline',async()=>{
 const before=(await pool.query(await read('docs/'+stem+'.precheck.sql'))).rows;assert.equal(before.find(r=>r.item==='function absent').value,'예');
 await pool.query(migration.replace(/commit;\s*$/i,'rollback;'));assert.equal((await pool.query("select to_regprocedure('public.app_basket_confirm_links(uuid,timestamptz,jsonb)') fn")).rows[0].fn,null);
 await pool.query(migration);const post=(await pool.query(await read('docs/'+stem+'.postcheck.sql'))).rows;for(const row of post)assert.equal(row.ok,'예',row.item);
 assert.deepEqual((await pool.query('select polname,pg_get_expr(polqual,polrelid) qual,pg_get_expr(polwithcheck,polrelid) chk from pg_policy order by polname')).rows,policies);
 });
 await t.test('only authenticated executes; stranger cannot see or confirm owner note',async()=>{
 await assert.rejects(call([target('project',PROJECT_A)],stamp,OWNER,'anon'),{code:'42501'});
 await assert.rejects(call([target('project',PROJECT_A)],stamp,OWNER,'public_probe'),{code:'42501'});
 assert.equal((await call([target('project',PROJECT_A)],stamp,STRANGER)).error,'NOTE_MISSING');assert.equal(await count(),0);
 });
 await t.test('strict targets reject invalid structure/unknown keys/4b/UUID/size without writes',async()=>{
 for(const targets of [null,{},[],Array.from({length:21},()=>target('project',PROJECT_A)),[{...target('project',PROJECT_A),workspace_id:WS_B}],[target('library',PROJECT_A)],[target('project','bad')],[{...target('project',PROJECT_A),reason:'가'.repeat(2001)}],[{kind:'project',target_id:PROJECT_A}],[[target('project',PROJECT_A)]]])assert.equal((await call(targets)).error,'INVALID_TARGETS');assert.equal(await count(),0);
 });
 await t.test('one invalid target rejects the entire note; same workspace checked with invoker visibility',async()=>{
 for(const id of [PROJECT_B,'20000000-0000-4000-8000-999999999999']){assert.equal((await call([target('organization',ORG_A),target('project',id)])).error,'TARGET_MISSING');assert.equal(await count(),0);}
 // Same caller owns another workspace: visible-but-foreign is explicitly refused.
 await pool.query('insert into public.app_workspace_members values($1,$2,\'owner\')',[WS_B,OWNER]);
 assert.equal((await call([target('organization',ORG_A),target('project',PROJECT_B)])).error,'TARGET_WORKSPACE');
 assert.equal((await call([target('organization',ORG_B)])).error,'TARGET_WORKSPACE');assert.equal(await count(),0);
 });
 await t.test('archived and non-project destinations are not selectable',async()=>{
 await pool.query(`update public.app_spaces set status='archived' where id=$1`,[PROJECT_A]);assert.equal((await call([target('project',PROJECT_A)])).error,'TARGET_UNSELECTABLE');
 await pool.query(`update public.app_spaces set status='active',metadata='{}' where id=$1`,[PROJECT_A]);assert.equal((await call([target('project',PROJECT_A)])).error,'TARGET_UNSELECTABLE');
 await pool.query(`update public.app_spaces set metadata='{"project_system":"v2"}',status='archived' where id=$1;`,[PROJECT_A2]);await pool.query('update public.app_spaces set parent_id=$1 where id=$2',[PROJECT_A2,PROJECT_A]);assert.equal((await call([target('project',PROJECT_A)])).error,'TARGET_UNSELECTABLE');
 await pool.query(`update public.app_spaces set metadata='{"project_system":"v2"}',status='active',parent_id=null where id=$1`,[PROJECT_A]);
 });
 await t.test('v2 project below an excluded legacy archived parent remains a catalog root',async()=>{
 await pool.query(`update public.app_spaces set metadata='{}',status='archived' where id=$1`,[PROJECT_A2]);
 await pool.query('update public.app_spaces set parent_id=$1 where id=$2',[PROJECT_A2,PROJECT_A]);
 const result=await call([target('project',PROJECT_A)]);assert.equal(result.ok,true);
 await pool.query('delete from public.app_record_links where note_id=$1',[note.id]);await pool.query('update public.app_spaces set parent_id=null where id=$1',[PROJECT_A]);
 });
 await t.test('same-workspace other-owner project is excluded; its owned child can be an orphan root',async()=>{
 await pool.query('update public.app_spaces set owner_id=$1 where id=$2',[STRANGER,PROJECT_A]);assert.equal((await call([target('project',PROJECT_A)])).error,'TARGET_UNSELECTABLE');
 await pool.query('update public.app_spaces set owner_id=$1,parent_id=$2 where id=$3',[OWNER,PROJECT_A,PROJECT_A2]);
 await pool.query("update public.app_spaces set metadata='{\"project_system\":\"v2\"}',status='active' where id=$1",[PROJECT_A2]);
 assert.equal((await call([target('project',PROJECT_A2)])).ok,true);
 await pool.query('delete from public.app_record_links where note_id=$1',[note.id]);await pool.query('update public.app_spaces set owner_id=$1,parent_id=null where id in($2,$3)',[OWNER,PROJECT_A,PROJECT_A2]);
 });
 await t.test('management_version numeric strings follow canonical Number coercion',async()=>{
 for(const management_version of ['2.0','02',' 2 ','2e0','0x2','0b10',[2]]){
 await pool.query('update public.app_spaces set metadata=$1::jsonb where id=$2',[JSON.stringify({management_version}),PROJECT_A]);assert.equal((await call([target('project',PROJECT_A)])).ok,true,JSON.stringify(management_version));
 await pool.query('delete from public.app_record_links where note_id=$1',[note.id]);
 }
 await pool.query(`update public.app_spaces set metadata='{"project_system":"v2"}' where id=$1`,[PROJECT_A]);
 });
 await t.test('changed (including microseconds), archived and AI excluded reject',async()=>{
 assert.equal((await call([target('project',PROJECT_A)],'2026-10-11T01:02:03.123457Z')).error,'NOTE_CHANGED');
 await pool.query('update public.app_notes set archived_at=now() where id=$1',[note.id]);assert.equal((await call([target('project',PROJECT_A)])).error,'NOTE_ARCHIVED');
 await pool.query('update public.app_notes set archived_at=null,ai_export_allowed=false where id=$1',[note.id]);assert.equal((await call([target('project',PROJECT_A)])).error,'AI_EXCLUDED');
 await pool.query('update public.app_notes set ai_export_allowed=true where id=$1',[note.id]);assert.equal(await count(),0);
 });
 await t.test('note row lock waits for an in-flight edit, then refuses the old timestamp',async()=>{
 const editor=await pool.connect(),caller=await pool.connect();
 try{
 await editor.query('begin');await editor.query('update public.app_notes set updated_at=$1 where id=$2',['2026-10-11T01:02:03.123457Z',note.id]);
 await caller.query('begin');await caller.query("select set_config('request.jwt.claim.sub',$1,true)",[OWNER]);await caller.query('set local role authenticated');
 const pending=caller.query('select public.app_basket_confirm_links($1,$2,$3::jsonb) result',[note.id,stamp,JSON.stringify([target('project',PROJECT_A)])]);
 let blocked=false;for(let i=0;i<40&&!blocked;i++){blocked=(await pool.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1",[caller.processID])).rows[0]?.blocked; if(!blocked)await new Promise(r=>setTimeout(r,10));}
 assert.equal(blocked,true);await editor.query('commit');assert.equal((await pending).rows[0].result.error,'NOTE_CHANGED');await caller.query('commit');
 }finally{await editor.query('rollback');await caller.query('rollback');editor.release();caller.release();await pool.query('update public.app_notes set updated_at=$1 where id=$2',[stamp,note.id]);}
 assert.equal(await count(),0);
 });
 await t.test('an insert rejected by existing invoker RLS rolls back earlier links in the note',async()=>{
 await pool.query("create policy synthetic_deny_org on public.app_record_links as restrictive for insert to authenticated with check(organization_id is null)");
 try{assert.deepEqual(await call([target('project',PROJECT_A),target('organization',ORG_A)]),{ok:false,error:'PERMISSION_DENIED',created:0,existing:0});assert.equal(await count(),0);}
 finally{await pool.query('drop policy synthetic_deny_org on public.app_record_links');}
 });
 await t.test('success, correct report kinds, repeat and concurrent presses do not duplicate or modify notes',async()=>{
 const before=(await pool.query('select * from public.app_notes where id=$1',[note.id])).rows[0];const targets=[target('organization',ORG_A),target('project',PROJECT_A)];
 assert.deepEqual(await call(targets),{ok:true,created:2,existing:0});assert.deepEqual(await call(targets),{ok:true,created:0,existing:2});
 await Promise.all([call(targets),call(targets)]);assert.equal(await count(),2);
 assert.deepEqual((await pool.query('select status,report_kind from public.app_record_links where note_id=$1 order by report_kind',[note.id])).rows,[{status:'confirmed',report_kind:'business'},{status:'confirmed',report_kind:'organization'}]);
 assert.deepEqual((await pool.query('select * from public.app_notes where id=$1',[note.id])).rows[0],before);
 });
 await t.test('owner RLS is still enforced on direct writes, and exact rollback preserves confirmed rows',async()=>{
 await assert.rejects(as('authenticated',STRANGER,c=>c.query(`insert into public.app_record_links(workspace_id,note_id,project_id)values($1,$2,$3)`,[WS_A,note.id,PROJECT_A2])),{code:'42501'});
 await pool.query(await read('docs/'+stem+'.rollback.sql'));assert.equal(await count(),2);await pool.query(migration);assert.deepEqual(await call([target('project',PROJECT_A)]),{ok:true,created:0,existing:1});
 });
 }finally{if(pool){await pool.end();await Promise.all(clientEnds);}await cluster.stop();}
});
