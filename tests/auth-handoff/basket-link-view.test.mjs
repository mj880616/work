import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,PROJECT_A2,PROJECT_B,ORG_A,ORG_B,MEETING_A} from './basket4-fixture.mjs';
const version='20261012100000', name='basket_link_view_db', stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
test('BASKET link summaries: real PostgreSQL validation, CAS, owner boundary and exact rollback', {timeout:90000},async t=>{

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
 const prior=await read('supabase/migrations/20261011180000_basket4a_confirm_links.sql');await pool.query(prior);
 const policies=(await pool.query('select polname,pg_get_expr(polqual,polrelid) qual,pg_get_expr(polwithcheck,polrelid) chk from pg_policy order by polname')).rows;
 const originalACL=(await pool.query("select proacl from pg_proc where oid='public.app_basket_confirm_links(uuid,timestamptz,jsonb)'::regprocedure")).rows;
 const priorDefinition=(await pool.query("select pg_get_functiondef('public.app_basket_confirm_links(uuid,timestamptz,jsonb)'::regprocedure) def")).rows[0].def;
 const legacyNote=(await pool.query('insert into public.app_notes(workspace_id,raw_text)values($1,$2) returning id',[WS_A,'기존 메모'])).rows[0];
 await pool.query('insert into public.app_documents(id,workspace_id)values($1,$2)',[PROJECT_A2,WS_A]);
 await pool.query(`insert into public.app_record_links(workspace_id,google_task_id,google_tasklist_id,task_completed,project_id)values($1,'legacy-task','legacy-list',false,$2);
 `,[WS_A,PROJECT_A]);
 await pool.query('insert into public.app_record_links(workspace_id,note_id,meeting_id)values($1,$2,$3)',[WS_A,legacyNote.id,MEETING_A]);
 await pool.query('insert into public.app_record_links(workspace_id,note_id,document_id)values($1,$2,$3)',[WS_A,legacyNote.id,PROJECT_A2]);
 const legacyRows=async()=>(await pool.query('select * from public.app_record_links where note_id=$1 or google_task_id=$2 order by id',[legacyNote.id,'legacy-task'])).rows.map(({summary,...row})=>row);
 const legacyBefore=await legacyRows();
 const migration=await read('supabase/migrations/'+stem+'.sql');
 async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub]);await c.query('set local role '+role);const result=await fn(c);await c.query('commit');return result;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
 const target=(kind,id,summary)=>({kind,target_id:id,reason:'분류 이유',...(summary===undefined?{}:{summary})});
 const call=(targets,updated=stamp,sub=OWNER,role='authenticated')=>as(role,sub,async c=>(await c.query('select public.app_basket_confirm_links($1,$2,$3::jsonb) result',[note.id,updated,JSON.stringify(targets)])).rows[0].result);
 const edit=(id,expected,summary,sub=OWNER,role='authenticated')=>as(role,sub,async c=>(await c.query('select public.app_basket_update_link_summary($1,$2,$3) result',[id,expected,summary])).rows[0].result);
 const links=async()=>(await pool.query('select * from public.app_record_links where note_id=$1 order by organization_id nulls last',[note.id])).rows;
 const clear=()=>pool.query('delete from public.app_record_links where note_id=$1',[note.id]);
 const invariant=(await pool.query(await read('docs/20261011180000_basket4a_confirm_links.snapshot.sql'))).rows.filter(r=>['owner RLS/grants hash','policies hash'].includes(r.item));
 await t.test('dry-run restores prior function and no column; apply checks pass; workflow rollback is explicitly unsupported',async()=>{
 for(const mode of ['apply','dry-run'])assert.doesNotThrow(()=>prepareMigration({mode,version,runId:'404',root:new URL('../../',import.meta.url).pathname}));
 assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'404',root:new URL('../../',import.meta.url).pathname}),/DB plan rejected/);
 await pool.query("create or replace function public.app_basket_confirm_links(p_note_id uuid,p_note_updated_at timestamptz,p_targets jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$begin return '{}'::jsonb;end;$$");
 await assert.rejects(pool.query(migration),/BASKET-4a prerequisite differs/);await pool.query('rollback');
 await pool.query(prior.slice(0,prior.indexOf('insert into supabase_migrations')).replace('create function','create or replace function')+'commit;');
 await pool.query('alter table public.app_notes disable row level security');
 await assert.rejects(pool.query(migration),/BASKET-4a prerequisite differs/);await pool.query('rollback');
 assert.equal((await pool.query("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='app_record_links' and column_name='summary'")).rows[0].n,0);
 await pool.query('alter table public.app_notes enable row level security');
 const pre=(await pool.query(await read('docs/'+stem+'.precheck.sql'))).rows;for(const row of pre)assert.equal(row.value,'예',row.item);
 const calls=[];
 const execute=async(sql,{readOnly=false}={})=>{calls.push({sql,readOnly});const client=await pool.connect();try{if(readOnly)await client.query('begin read only');const result=await client.query(sql);if(readOnly)await client.query('commit');return Array.isArray(result)?result.at(-1).rows:result.rows;}catch(error){await client.query('rollback');throw error;}finally{client.release();}};
 const plan=mode=>prepareMigration({mode,version,runId:'404',root:new URL('../../',import.meta.url).pathname});
 const dry=await runMigrationPlan(plan('dry-run'),execute);assert.equal(dry.ok,true,dry.summary);
 assert.equal(dry.verification,'complete');
 const dryPlan=plan('dry-run');
 assert.equal(calls.filter(call=>call.sql===dryPlan.checks.precheck.sql&&call.readOnly).length,2);
 assert.equal(calls.filter(call=>call.sql===dryPlan.checks.dryRunPostcheck.sql&&call.readOnly).length,1);
 assert.equal(calls.some(call=>call.sql===(plan('apply')).checks.postcheck.sql),false);
 assert.deepEqual((await pool.query("select proacl from pg_proc where oid='public.app_basket_confirm_links(uuid,timestamptz,jsonb)'::regprocedure")).rows,originalACL);
 assert.deepEqual((await pool.query('select polname,pg_get_expr(polqual,polrelid) qual,pg_get_expr(polwithcheck,polrelid) chk from pg_policy order by polname')).rows,policies);
 assert.equal((await pool.query("select to_regprocedure('public.app_basket_update_link_summary(uuid,text,text)') fn")).rows[0].fn,null);
 assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version='20261012100000'")).rows[0].n,0);
 // Each lost #506 prior-state invariant must be caught independently.
 for(const change of ["create or replace function public.app_basket_confirm_links(p_note_id uuid,p_note_updated_at timestamptz,p_targets jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$begin return '{}'::jsonb;end;$$;", "alter function public.app_basket_confirm_links(uuid,timestamptz,jsonb) set search_path=public;", "alter table public.app_record_links add column summary text;", "create function public.app_basket_update_link_summary(uuid,text,text) returns jsonb language sql as $$select '{}'::jsonb;$$;"]){
 const client=await pool.connect();try{await client.query('begin');await client.query(change);const rows=(await client.query(dryPlan.checks.dryRunPostcheck.sql)).rows;assert.equal(rows.length,1);assert.equal(rows[0].ok,'아니오');}finally{await client.query('rollback');client.release();}}
 assert.equal((await pool.query("select pg_get_functiondef('public.app_basket_confirm_links(uuid,timestamptz,jsonb)'::regprocedure) def")).rows[0].def,priorDefinition);
 assert.equal((await pool.query("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='app_record_links' and column_name='summary'")).rows[0].n,0);
 const applied=await runMigrationPlan(plan('apply'),execute);assert.equal(applied.ok,true,applied.summary);assert.match(applied.summary,/ops_backup.20261012100000_app_record_links_404/);assert.deepEqual(await legacyRows(),legacyBefore);for(const row of (await pool.query(await read('docs/'+stem+'.postcheck.sql'))).rows)assert.equal(row.ok,'예',row.item);
 assert.deepEqual((await pool.query('select polname,pg_get_expr(polqual,polrelid) qual,pg_get_expr(polwithcheck,polrelid) chk from pg_policy order by polname')).rows,policies);
 });
 await t.test('summary is stored as approved text, reason-only stays null; confirmed repeats preserve it',async()=>{
 assert.deepEqual(await call([target('organization',ORG_A,'  10월 12일 09시 서울, 담당자 3명 협의  '),target('project',PROJECT_A)]),{ok:true,created:2,existing:0});
 const rows=await links();assert.equal(rows[0].summary,'  10월 12일 09시 서울, 담당자 3명 협의  ');assert.equal(rows[1].summary,null);
 assert.deepEqual(await call([target('organization',ORG_A,'다른 요약'),target('project',PROJECT_A,'새 요약')]),{ok:true,created:0,existing:2});
 assert.deepEqual(await links(),rows);await clear();
 });
 await t.test('nullable confirm; 1/2000 code point limits; whitespace and non-string/unknown keys rejected atomically',async()=>{
 for(const summary of [null,'v','vv','가','😀'.repeat(2000)]){assert.equal((await call([target('project',PROJECT_A,summary)])).ok,true);assert.equal((await links())[0].summary,summary);await clear();}
 for(const summary of ['', '\u000b','\u0085', ' \t\n\r', '\u00a0\u3000\ufeff', '가'.repeat(2001),7,{},[],true]){
 assert.equal((await call([target('organization',ORG_A,'정상'),target('project',PROJECT_A,summary)])).error,'INVALID_TARGETS');assert.equal((await links()).length,0);}
 assert.equal((await call([{...target('project',PROJECT_A,'정상'),unexpected:true}])).error,'INVALID_TARGETS');
 for(const summary of ['', ' \n','\u000b','\u0085','\u00a0\u3000','가'.repeat(2001)])await assert.rejects(as('authenticated',OWNER,c=>c.query('insert into public.app_record_links(workspace_id,note_id,project_id,summary) values($1,$2,$3,$4)',[WS_A,note.id,PROJECT_A,summary])),{code:'23514'});
 });
 await t.test('manual edit uses null-safe expected summary; empty/null/overlong input cannot clear it',async()=>{
 await call([target('organization',ORG_A),target('project',PROJECT_A,'기존')]);const [org,project]=await links();
 assert.deepEqual(await edit(org.id,null,'수정'),{ok:true});assert.equal((await edit(org.id,null,'옛 화면')).error,'SUMMARY_CHANGED');
 assert.equal((await edit(project.id,null,'옛 화면')).error,'SUMMARY_CHANGED');assert.deepEqual(await edit(project.id,'기존','최신'),{ok:true});
 for(const summary of [null,'','\u000b','\u0085',' \t\n','\u00a0\u3000','가'.repeat(2001)])assert.equal((await edit(org.id,'수정',summary)).error,'INVALID_INPUT');
 assert.equal((await edit(null,null,'수정')).error,'INVALID_INPUT');assert.equal((await edit(org.id,'가'.repeat(2001),'수정')).error,'INVALID_INPUT');
 for(const summary of ['v','vv','가','😀'.repeat(2000)]){const current=(await links())[0].summary;assert.equal((await edit(org.id,current,summary)).ok,true);}
 await clear();
 });
 await t.test('two actual sessions block and refuse stale expected summary after the first commits',async()=>{
 await call([target('organization',ORG_A)]);const [row]=await links();const first=await pool.connect(),second=await pool.connect();let pending;
 try{for(const c of [first,second]){await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[OWNER]);await c.query('set local role authenticated');}
 assert.equal((await first.query('select public.app_basket_update_link_summary($1,null,$2) result',[row.id,'첫 수정'])).rows[0].result.ok,true);
 pending=second.query('select public.app_basket_update_link_summary($1,null,$2) result',[row.id,'두번째 수정']);
 let blocked=false;for(let i=0;i<40&&!blocked;i++){blocked=(await pool.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1",[second.processID])).rows[0]?.blocked;if(!blocked)await new Promise(r=>setTimeout(r,10));}
 assert.equal(blocked,true);await first.query('commit');assert.equal((await pending).rows[0].result.error,'SUMMARY_CHANGED');await second.query('commit');
 }finally{await first.query('rollback');await second.query('rollback');if(pending)await pending;first.release();second.release();}
 assert.equal((await links())[0].summary,'첫 수정');await clear();
 });
 await t.test('archived/AI-excluded note can be manually edited; new confirmation still refuses',async()=>{
 await call([target('organization',ORG_A,'이전')]);const [row]=await links();
 await pool.query('update public.app_notes set archived_at=now(),ai_export_allowed=false where id=$1',[note.id]);
 assert.equal((await edit(row.id,'이전','보관 후 수정')).ok,true);assert.equal((await call([target('project',PROJECT_A,'신규')])).error,'NOTE_ARCHIVED');
 await pool.query('update public.app_notes set archived_at=null where id=$1',[note.id]);assert.equal((await call([target('project',PROJECT_A,'신규')])).error,'AI_EXCLUDED');
 await pool.query('update public.app_notes set ai_export_allowed=true where id=$1',[note.id]);await clear();
 });
 await t.test('non-login, hidden owner rows, nonexistent and wrong source/status/target never edit',async()=>{
 await call([target('organization',ORG_A,'소유자 요약')]);const [row]=await links();
 for(const role of ['anon','public_probe'])await assert.rejects(edit(row.id,'소유자 요약','침입',OWNER,role),{code:'42501'});
 assert.equal((await edit(row.id,'소유자 요약','침입','')).error,'PERMISSION_DENIED');assert.equal((await edit(row.id,'소유자 요약','침입',STRANGER)).error,'NOT_FOUND');
 assert.equal((await edit('20000000-0000-4000-8000-999999999999',null,'수정')).error,'NOT_FOUND');
 const extra=(await pool.query(`insert into public.app_record_links(workspace_id,google_task_id,google_tasklist_id,task_completed,project_id) values($1,'task','list',false,$2) returning id`,[WS_A,PROJECT_A])).rows[0];assert.equal((await edit(extra.id,null,'수정')).error,'NOT_FOUND');
 const suggested=(await pool.query("insert into public.app_record_links(workspace_id,note_id,project_id,status)values($1,$2,$3,'suggested') returning id",[WS_A,note.id,PROJECT_A])).rows[0];assert.equal((await edit(suggested.id,null,'수정')).error,'NOT_FOUND');
 assert.equal((await call([target('project',PROJECT_A,'확정')])).error,'SUGGESTED_EXISTS');
 const other=(await pool.query('insert into public.app_record_links(workspace_id,note_id,meeting_id)values($1,$2,$3) returning id',[WS_A,note.id,MEETING_A])).rows[0];assert.equal((await edit(other.id,null,'수정')).error,'NOT_FOUND');
 await pool.query('insert into public.app_documents(id,workspace_id)values($1,$2)',[PROJECT_A,WS_A]);
 const doc=(await pool.query('insert into public.app_record_links(workspace_id,note_id,document_id)values($1,$2,$3) returning id',[WS_A,note.id,PROJECT_A])).rows[0];assert.equal((await edit(doc.id,null,'수정')).error,'NOT_FOUND');
 assert.equal((await links())[0].summary,'소유자 요약');await clear();await pool.query('delete from public.app_record_links where id=$1',[extra.id]);
 });
 await t.test('visible foreign workspace and target-owner mismatch rejected on both paths',async()=>{
 await pool.query("insert into public.app_workspace_members values($1,$2,'owner')",[WS_B,OWNER]);
 assert.equal((await call([target('organization',ORG_A,'정상'),target('project',PROJECT_B,'타공간')])).error,'TARGET_WORKSPACE');assert.equal((await links()).length,0);
 await call([target('organization',ORG_A,'원래'),target('project',PROJECT_A,'원래')]);const [org,project]=await links();
 await pool.query('update public.app_suborganizations set workspace_id=$1 where id=$2',[WS_B,ORG_A]);assert.equal((await edit(org.id,'원래','외부')).error,'PERMISSION_DENIED');await pool.query('update public.app_suborganizations set workspace_id=$1 where id=$2',[WS_A,ORG_A]);
 await pool.query('update public.app_spaces set owner_id=$1 where id=$2',[STRANGER,PROJECT_A]);assert.equal((await edit(project.id,'원래','외부')).error,'PERMISSION_DENIED');await pool.query('update public.app_spaces set owner_id=$1 where id=$2',[OWNER,PROJECT_A]);
 await pool.query('update public.app_notes set workspace_id=$1 where id=$2',[WS_B,note.id]);assert.equal((await edit(org.id,'원래','외부')).error,'PERMISSION_DENIED');await pool.query('update public.app_notes set workspace_id=$1 where id=$2',[WS_A,note.id]);
 await clear();
 });
 await t.test('missing destination rejects summary-bearing batch without partial inserts; update RLS cannot silently succeed',async()=>{
 assert.equal((await call([target('organization',ORG_A,'정상'),target('project','20000000-0000-4000-8000-999999999999','없는 대상')])).error,'TARGET_MISSING');assert.equal((await links()).length,0);
 await call([target('organization',ORG_A,'원래')]);const [row]=await links();const before=(await pool.query('select * from public.app_notes where id=$1',[note.id])).rows;
 await pool.query('create policy synthetic_deny_update on public.app_record_links as restrictive for update to authenticated using(false)');
 try{assert.equal((await edit(row.id,'원래','수정')).error,'PERMISSION_DENIED');assert.equal((await links())[0].summary,'원래');}finally{await pool.query('drop policy synthetic_deny_update on public.app_record_links');}
 assert.deepEqual((await pool.query('select * from public.app_notes where id=$1',[note.id])).rows,before);await clear();
 });
 await t.test('RLS insertion failure rolls back every summary-bearing destination',async()=>{
 await pool.query("create policy synthetic_deny_org on public.app_record_links as restrictive for insert to authenticated with check(organization_id is null)");
 try{assert.equal((await call([target('project',PROJECT_A,'정상'),target('organization',ORG_A,'거절')])).error,'PERMISSION_DENIED');assert.equal((await links()).length,0);}finally{await pool.query('drop policy synthetic_deny_org on public.app_record_links');}
 });
 let preservationIndex=0;
 const preservation=async()=>{
 const result=(await pool.query(await read('docs/'+stem+'.preserve.sql'))).rows[0];
 const file=join(directory,'private-preservation-'+(++preservationIndex)+'.json');
 await writeFile(file,JSON.stringify(result),{mode:0o600});
 const reopened=JSON.parse(await readFile(file,'utf8'));
 assert.deepEqual(JSON.parse(Buffer.from(reopened.preservation_hex,'hex').toString('utf8')),reopened.preservation_json);
 return reopened;
 };
 const privateSQL=async(kind,backup)=>(await read('docs/'+stem+'.'+kind+'.sql')).replace('PASTE_VERIFIED_PRIVATE_HEX',backup.preservation_hex);
 const resetTransaction=()=>pool.query('rollback');
 await t.test('late edit commits while recovery waits for lock: refuses stale file and preserves new summary',async()=>{
 await call([target('organization',ORG_A,'synthetic original')]);const [row]=await links(),backup=await preservation();
 const writer=await pool.connect(),recovery=await pool.connect();let pending;
 try{
 await writer.query('begin');await writer.query('update public.app_record_links set summary=$1 where id=$2',['synthetic late edit',row.id]);
 pending=recovery.query(await privateSQL('recovery',backup));const refused=assert.rejects(pending,/SUMMARY_PRESERVATION_CHANGED/);
 let blocked=false;for(let i=0;i<100&&!blocked;i++){blocked=(await pool.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1",[recovery.processID])).rows[0]?.blocked;if(!blocked)await new Promise(r=>setTimeout(r,10));}
 assert.equal(blocked,true);await writer.query('commit');await refused;await recovery.query('rollback');
 assert.equal((await links())[0].summary,'synthetic late edit');
 assert.notEqual((await pool.query("select to_regprocedure('public.app_basket_update_link_summary(uuid,text,text)') fn")).rows[0].fn,null);
 }finally{await writer.query('rollback');await recovery.query('rollback');if(pending)await pending.catch(()=>{});writer.release();recovery.release();}
 await clear();
 });
 await t.test('same count with changed text or relationship refuses recovery without clearing anything',async()=>{
 await call([target('organization',ORG_A,'synthetic preserved')]);const [row]=await links(),backup=await preservation();
 await pool.query('update public.app_record_links set summary=$1 where id=$2',['synthetic changed',row.id]);
 await assert.rejects(pool.query(await privateSQL('recovery',backup)),/SUMMARY_PRESERVATION_CHANGED/);await resetTransaction();
 assert.equal((await links())[0].summary,'synthetic changed');
 await pool.query('update public.app_record_links set summary=$1,status=$2 where id=$3',['synthetic preserved','suggested',row.id]);
 await assert.rejects(pool.query(await privateSQL('recovery',backup)),/SUMMARY_PRESERVATION_CHANGED/);await resetTransaction();
 assert.equal((await links())[0].status,'suggested');assert.equal((await links())[0].summary,'synthetic preserved');await clear();
 });
 await t.test('added null-summary row and deleted row refuse full-row preservation mismatch',async()=>{
 await call([target('organization',ORG_A,'synthetic preserved')]);const backup=await preservation();
 await call([target('project',PROJECT_A)]);await assert.rejects(pool.query(await privateSQL('recovery',backup)),/SUMMARY_PRESERVATION_CHANGED/);await resetTransaction();
 assert.equal((await links())[0].summary,'synthetic preserved');await clear();
 await assert.rejects(pool.query(await privateSQL('recovery',backup)),/SUMMARY_PRESERVATION_CHANGED/);await resetTransaction();
 });
 await t.test('failure restoring old function rolls back summary clearing and every schema change',async()=>{
 await call([target('organization',ORG_A,'synthetic preserved')]);const backup=await preservation(),before=await links();
 const currentDefinition=(await pool.query("select pg_get_functiondef('public.app_basket_confirm_links(uuid,timestamptz,jsonb)'::regprocedure) def")).rows[0].def;
 // PostgreSQL rejects changing an existing function argument name, after the clear and DROP.
 const broken=(await privateSQL('recovery',backup)).replace('p_note_id uuid, p_note_updated_at','p_incompatible_name uuid, p_note_updated_at');
 await assert.rejects(pool.query(broken),/cannot change name of input parameter/);await resetTransaction();
 assert.deepEqual(await links(),before);
 assert.equal((await pool.query("select pg_get_functiondef('public.app_basket_confirm_links(uuid,timestamptz,jsonb)'::regprocedure) def")).rows[0].def,currentDefinition);
 for(const r of (await pool.query(await read('docs/'+stem+'.postcheck.sql'))).rows)assert.equal(r.ok,'예',r.item);
 await clear();
 });
 await t.test('rollback refuses summary loss; externally backed-up summaries allow exact prior restoration and 4a calls',async()=>{
 await call([target('organization',ORG_A,'보존 요약')]);const preserved=await links();
 const rollback=await read('docs/'+stem+'.rollback.sql');await assert.rejects(pool.query(rollback),/SUMMARY_BACKUP_REQUIRED/);await pool.query('rollback');
 const backup=await preservation();
 const allBefore=backup.preservation_json.map(({summary,...row})=>row);
 // Different SQL sessions/timezones must not change preservation equality.
 await pool.query("set timezone='Asia/Seoul'");
 await pool.query(await privateSQL('recovery',backup));
 await pool.query("set timezone='UTC'");
 const allAfter=(await preservation()).preservation_json.map(({summary,...row})=>row);
 assert.deepEqual(allAfter,allBefore);
 assert.deepEqual((await pool.query("select proacl from pg_proc where oid='public.app_basket_confirm_links(uuid,timestamptz,jsonb)'::regprocedure")).rows,originalACL);assert.deepEqual(await legacyRows(),legacyBefore);
 assert.equal((await pool.query("select pg_get_functiondef('public.app_basket_confirm_links(uuid,timestamptz,jsonb)'::regprocedure) def")).rows[0].def,priorDefinition);
 assert.equal((await pool.query("select to_regprocedure('public.app_basket_update_link_summary(uuid,text,text)') fn")).rows[0].fn,null);
 assert.deepEqual(await call([target('project',PROJECT_A),target('organization',ORG_A)]),{ok:true,created:1,existing:1});
 assert.equal((await call([target('project',PROJECT_A,'미지원')])).error,'INVALID_TARGETS');
 assert.equal((await call([target('project',PROJECT_A)],'2026-10-11T01:02:03.123457Z')).error,'NOTE_CHANGED');
 assert.equal((await call([target('project',PROJECT_B)])).error,'TARGET_WORKSPACE');
 assert.deepEqual((await pool.query(await read('docs/20261011180000_basket4a_confirm_links.snapshot.sql'))).rows.filter(r=>['owner RLS/grants hash','policies hash'].includes(r.item)),invariant);
 await pool.query(migration);await pool.query(await privateSQL('restore',backup));assert.equal((await links())[0].summary,'보존 요약');
 // Conditional replay never overwrites a later edit, a changed relationship or a deleted link.
 await pool.query('update public.app_record_links set summary=$1 where id=$2',['synthetic later edit',preserved[0].id]);
 await pool.query(await privateSQL('restore',backup));assert.equal((await links())[0].summary,'synthetic later edit');
 await pool.query('update public.app_record_links set summary=null,status=$1 where id=$2',['suggested',preserved[0].id]);
 await pool.query(await privateSQL('restore',backup));assert.equal((await links())[0].summary,null);
 await clear();await pool.query(await privateSQL('restore',backup));assert.equal((await links()).length,0);
 });
 }finally{if(pool){await pool.end();await Promise.all(clientEnds);}await cluster.stop();}
});
