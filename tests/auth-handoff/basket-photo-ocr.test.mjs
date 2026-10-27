// Fresh local PostgreSQL only. No Supabase, Google or production credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {fixture,OWNER,STRANGER,WS_A,ORG_A,PROJECT_A} from './basket4-fixture.mjs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261013034836',name='basket_photo_ocr_db',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const baseAttachment={drive_file_id:'synthetic-original',file_name:'image.png',mime_type:'image/png',size_bytes:42};
const start=(file=baseAttachment.drive_file_id)=>({state:'reading',attempt_id:randomUUID(),original_file_id:file,cleanup_state:'create_pending'});
const made=o=>({...o,cleanup_state:'created',temp_document_id:'synthetic-temp-'+o.attempt_id});
const done=(o,text='인식 글')=>({...o,state:text===''?'empty':'done',text});
const stamp='2026-10-13T01:02:03.123456Z';

test('photo OCR compatible DB, exact CAS, text versions and preservation', {timeout:90000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'photo-ocr-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;const clientEnds=[];
 try{
  await cluster.initialise();await cluster.start();pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false});pool.on('connect',c=>clientEnds.push(new Promise(r=>c.once('end',r))));
  await pool.query(fixture);
  for(const file of ['20260927103344_task_impl2_notes_record_links.sql','20260928123601_task_meeting_followup_record_links.sql'])await pool.query(await read('supabase/migrations/'+file));
  await pool.query(`create table public.app_documents(id uuid primary key,workspace_id uuid);alter table public.app_spaces add column owner_id uuid default '${OWNER}',add column name text,add column parent_id uuid,add column status text default 'active',add column metadata jsonb default '{"project_system":"v2"}';grant select,update on public.app_spaces to authenticated;alter table public.app_spaces enable row level security;create policy synthetic_spaces_owner on public.app_spaces for all to authenticated using(private.app_is_workspace_owner(workspace_id)) with check(private.app_is_workspace_owner(workspace_id));`);
  for(const file of ['20261010120000_basket1_notes_links.sql','20261011180000_basket4a_confirm_links.sql','20261012100000_basket_link_view_db.sql'])await pool.query(await read('supabase/migrations/'+file));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  await t.test('independent version SELECT precedes catalog gates and reports the actual isolated PostgreSQL',async()=>{
   const rows=(await pool.query(await read('docs/'+stem+'.version-check.sql'))).rows;
   const actual=(await pool.query("select current_setting('server_version_num')::integer number,current_setting('server_version')version")).rows[0];
   assert.equal(rows.find(r=>r.item==='server_version_num')?.value,String(actual.number));assert.equal(rows.find(r=>r.item==='PostgreSQL 16+ catalog prerequisite')?.value,'예');assert.match(actual.version,/^17\.6(?:\D|$)/);
   assert.ok(migration.indexOf('PHOTO_OCR_POSTGRES_VERSION_UNSUPPORTED')<migration.indexOf('pg_auth_members'));
  });
  await t.test('version guard rejects a missing or pre-16 catalog prerequisite before executing newer reads',async()=>{
   // Evaluate the unchanged guard against synthetic version rows on PG17.6.
   // This proves its threshold/unknown decision, not whole PostgreSQL16 support.
   const guard=migration.match(/do \$\$([\s\S]*?PHOTO_OCR_POSTGRES_VERSION_UNSUPPORTED[\s\S]*?)\$\$;/)[0];
   for(const value of ['159999',null]){
    const relation=value===null?"(select 'server_version_num'::text name,'170006'::text setting where false)pg_settings":"(values('server_version_num','"+value+"'))pg_settings(name,setting)";
    await assert.rejects(pool.query(guard.replace('from pg_settings','from '+relation)),/PHOTO_OCR_POSTGRES_VERSION_UNSUPPORTED/);
   }
   for(const value of ['160000','170006'])await pool.query(guard.replace('from pg_settings',"from (values('server_version_num','"+value+"'))pg_settings(name,setting)"));
  });
  // This is the TDD gate: empty pre-feature migration has no callable OCR RPC.
  await pool.query(migration);
  assert.notEqual((await pool.query("select to_regprocedure('public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)') fn")).rows[0].fn,null,'new OCR RPC must exist after applying the preparation migration');
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const note=async(attachments=[baseAttachment],extra={})=>(await pool.query('insert into public.app_notes(workspace_id,raw_text,attachments,updated_at,metadata,archived_at,ai_export_allowed) values($1,$2,$3::jsonb,$4,$5::jsonb,$6,$7) returning id',[WS_A,extra.raw_text??'보존 원문',JSON.stringify(attachments),stamp,JSON.stringify({untouched:'synthetic'}),extra.archived_at??null,extra.ai_export_allowed??true])).rows[0].id;
  const current=async id=>(await pool.query('select n.*,updated_at::text stamp from public.app_notes n where id=$1',[id])).rows[0];
  const call=async(id,next,expected,versionText,sub=OWNER,role='authenticated')=>{const n=await current(id);return as(role,sub,async c=>(await c.query('select public.app_basket_update_attachment_ocr($1,$2,$3::jsonb,$4::jsonb) result',[id,versionText??n.stamp,JSON.stringify(expected??n.attachments[0]),JSON.stringify(next)])).rows[0].result);};
  const writeAs=async(role,attachments,id)=>as(role,OWNER,c=>id?c.query('update public.app_notes set attachments=$1::jsonb where id=$2',[JSON.stringify(attachments),id]):c.query('insert into public.app_notes(workspace_id,raw_text,attachments)values($1,$2,$3::jsonb)',[WS_A,'',JSON.stringify(attachments)]));
  await t.test('old service-role uploads preserve OCR while appending base attachments',async()=>{
   const id=await note(),o=start();assert.equal((await call(id,o)).ok,true);
   const before=await current(id);await writeAs('service_role',[...before.attachments,{...baseAttachment,drive_file_id:'synthetic-second'}],id);assert.deepEqual((await current(id)).attachments[0],before.attachments[0]);
   for(const count of [1,20])await writeAs('service_role',Array.from({length:count},(_,i)=>({...baseAttachment,drive_file_id:'legacy-'+i})));
   await writeAs('authenticated',[baseAttachment]);
  });
  await t.test('inline CHECK admits optional OCR without helpers and enforces Unicode and byte caps at every slot',async()=>{
   for(const role of ['authenticated','service_role'])for(const text of ['','ascii','가\n'.repeat(20),'😀'.repeat(16384),'e\u0301'.repeat(8192)]){
    const o=done(made(start()),text);await writeAs(role,[{...baseAttachment,ocr:o}]);
   }
   for(const files of [[{...baseAttachment,ocr:done(made(start()),'a'.repeat(16385))}],Array.from({length:20},(_,i)=>({...baseAttachment,drive_file_id:'slot-'+i,ocr:done(made(start('slot-'+i)),i===19?'😀'.repeat(16385):'ok')}))])await assert.rejects(writeAs('service_role',files),{code:'23514'});
   const o=done(made(start()));
   const bad=[null,[],7,{}, {...o,unknown:true},{...o,text:null},{...o,text:7},{...o,text:['nested']},{...o,state:['done']},{...o,attempt_id:[o.attempt_id]},{...o,cleanup_state:['created']},{...o,original_file_id:[baseAttachment.drive_file_id]},{...o,temp_document_id:[o.temp_document_id]},{...o,attempt_id:'bad'},{...o,original_file_id:'other'},{...o,temp_document_id:baseAttachment.drive_file_id},{...o,cleanup_state:'created',temp_document_id:undefined},{...o,state:'done',text:''},{...o,state:'empty',text:'letters'},{...o,cleanup_state:'surprise'},{...o,cleanup_state:'none',temp_document_id:undefined}];
   for(const value of bad)await assert.rejects(writeAs('authenticated',[{...baseAttachment,ocr:value}]),{code:'23514'});
   for(const value of [[[{...baseAttachment,ocr:o}]],{not:'array'},[null],[{...baseAttachment,ocr:o,mime_type:'application/pdf'}]])await assert.rejects(writeAs('service_role',value),{code:'23514'});
   await writeAs('service_role',[{...baseAttachment,mime_type:'application/pdf'}]);
  });
  await t.test('authenticated-only CHECK helper blocks service-role despite bypassrls',async()=>{
   await pool.query(`create function public.synthetic_auth_check(jsonb)returns boolean language sql immutable as $$select true$$;revoke all on function public.synthetic_auth_check(jsonb)from public;grant execute on function public.synthetic_auth_check(jsonb)to authenticated;create table public.synthetic_check(a jsonb check(public.synthetic_auth_check(a)));grant all on public.synthetic_check to authenticated,service_role;`);
   await as('authenticated',OWNER,c=>c.query("insert into public.synthetic_check values('[]')"));await assert.rejects(as('service_role',OWNER,c=>c.query("insert into public.synthetic_check values('[]')")),{code:'42501'});
   await pool.query('drop table public.synthetic_check;drop function public.synthetic_auth_check(jsonb)');
  });
  await t.test('reading and cleanup retain prior effective text and original version; text commits increase DB version',async()=>{
   const id=await note(),before=await current(id);let o=start();assert.equal((await call(id,o)).ok,true);assert.equal((await current(id)).stamp,before.stamp);
   o=made(o);assert.equal((await call(id,o)).ok,true);assert.equal((await current(id)).stamp,before.stamp);
   o=done(o,'😀 인식\n 글');assert.equal((await call(id,o)).ok,true);let n=await current(id);assert.equal((await pool.query('select $1::timestamptz > $2::timestamptz newer',[n.stamp,before.stamp])).rows[0].newer,true);
   const textStamp=n.stamp;o={...o,cleanup_state:'delete_pending'};assert.equal((await call(id,o)).ok,true);o={...o,cleanup_state:'delete_failed',cleanup_error_code:'DELETE_FAILED'};assert.equal((await call(id,o)).ok,true);assert.equal((await current(id)).stamp,textStamp);assert.equal((await current(id)).attachments[0].ocr.text,'😀 인식\n 글');
   assert.equal((await call(id,{...start(),text:o.text})).error,'INVALID_TRANSITION');
   o={...o,cleanup_state:'delete_pending',cleanup_error_code:undefined};assert.equal((await call(id,o)).ok,true);o={...o,cleanup_state:'deleted'};assert.equal((await call(id,o)).ok,true);assert.equal((await current(id)).stamp,textStamp);
   o={...start(),text:o.text};assert.equal((await call(id,o)).ok,true);assert.equal((await current(id)).stamp,textStamp);
   o={...o,state:'failed',cleanup_state:'create_unknown',error_code:'CREATE_UNKNOWN'};assert.equal((await call(id,o)).ok,true);assert.equal((await current(id)).stamp,textStamp);assert.equal((await call(id,{...start(),text:o.text})).error,'INVALID_TRANSITION');
   n=await current(id);assert.equal(n.raw_text,before.raw_text);assert.deepEqual(n.metadata,before.metadata);assert.equal(n.created_at.toISOString(),before.created_at.toISOString());
  });
  await t.test('empty recognition projection does not bump unread version, but clears a prior text with a new version',async()=>{
   const id=await note(),before=await current(id);let o=made(start());assert.equal((await call(id,{...o,cleanup_state:'create_pending',temp_document_id:undefined})).ok,true);assert.equal((await call(id,o)).ok,true);o=done(o,'');assert.equal((await call(id,o)).ok,true);assert.equal((await current(id)).stamp,before.stamp);
   const id2=await note();o=start();await call(id2,o);o=made(o);await call(id2,o);o=done(o,'old text');await call(id2,o);o={...o,cleanup_state:'delete_pending'};await call(id2,o);o={...o,cleanup_state:'deleted'};await call(id2,o);const previous=(await current(id2)).stamp;o={...start(),text:'old text'};await call(id2,o);o=made(o);await call(id2,o);o=done(o,'');assert.equal((await call(id2,o)).ok,true);assert.equal((await pool.query('select $1::timestamptz > $2::timestamptz newer',[(await current(id2)).stamp,previous])).rows[0].newer,true);
  });
  await t.test('RPC only changes one OCR object and preserves excluded/archive content and approved summary',async()=>{
   const id=await note([baseAttachment,{...baseAttachment,drive_file_id:'synthetic-other'}],{archived_at:'2026-10-12T00:00:00Z',ai_export_allowed:false});
   const link=(await pool.query("insert into public.app_record_links(workspace_id,note_id,organization_id,summary)values($1,$2,$3,'보존 요약')returning id",[WS_A,id,ORG_A])).rows[0].id,before=await current(id);let o=start();assert.equal((await call(id,o)).ok,true);o=made(o);await call(id,o);o=done(o);await call(id,o);const after=await current(id);
   for(const key of ['raw_text','workspace_id','metadata','ai_export_allowed'])assert.deepEqual(after[key],before[key]);for(const key of ['occurred_at','created_at','archived_at'])assert.equal(after[key].toISOString(),before[key].toISOString());assert.deepEqual(after.attachments[1],before.attachments[1]);assert.equal((await pool.query('select summary from public.app_record_links where id=$1',[link])).rows[0].summary,'보존 요약');
  });
  await t.test('exact microsecond note version, attachment and attempts reject stale saves and unsupported input',async()=>{
   const id=await note(),initial=await current(id),o=start();assert.equal((await call(id,o,undefined,'2026-10-13T01:02:03.123457Z')).error,'NOTE_CHANGED');assert.equal((await call(id,o,{...baseAttachment,size_bytes:43})).error,'ATTACHMENT_CHANGED');assert.equal((await call(id,o)).ok,true);assert.equal((await call(id,made(o),initial.attachments[0],initial.stamp)).error,'ATTACHMENT_CHANGED');
   for(const next of [null,[],{...o,text:'unearned text'},{...made(o),attempt_id:randomUUID()},{...o,original_file_id:'wrong'},{...o,temp_document_id:baseAttachment.drive_file_id}])assert.equal((await call(id,next)).ok,false);
   const dup=await note([baseAttachment,baseAttachment]);assert.equal((await call(dup,start())).error,'ATTACHMENT_CHANGED');
   assert.equal((await call(randomUUID(),start(),baseAttachment,stamp)).error,'NOTE_MISSING');
  });
  await t.test('owner RLS, anon/PUBLIC and restrictive UPDATE cannot report success',async()=>{
   const id=await note(),before=await current(id);
   for(const role of ['anon','public_probe','service_role'])await assert.rejects(call(id,start(),undefined,undefined,OWNER,role),{code:'42501'});
   assert.equal((await call(id,start(),undefined,undefined,STRANGER)).error,'NOTE_MISSING');assert.equal((await call(id,start(),undefined,undefined,'')).ok,false);
   await pool.query('create policy synthetic_deny_photo_update on public.app_notes as restrictive for update to authenticated using(false)');try{assert.equal((await call(id,start())).error,'NOTE_MISSING');}finally{await pool.query('drop policy synthetic_deny_photo_update on public.app_notes');}
   await pool.query('create policy synthetic_deny_photo_check on public.app_notes as restrictive for update to authenticated with check(false)');try{assert.equal((await call(id,start())).error,'PERMISSION_DENIED');}finally{await pool.query('drop policy synthetic_deny_photo_check on public.app_notes');}
   assert.deepEqual((await current(id)).attachments,before.attachments);
  });
  await t.test('late raw-text edit rejects old OCR approval while current-attempt cleanup can reconcile',async()=>{
   const id=await note();let o=start();await call(id,o);o=made(o);await call(id,o);const old=await current(id);
   await pool.query("update public.app_notes set raw_text='changed source',updated_at=updated_at+interval '1 second'where id=$1",[id]);
   assert.equal((await call(id,done(o),old.attachments[0],old.stamp)).error,'NOTE_CHANGED');assert.equal((await current(id)).attachments[0].ocr.text,undefined);
   const latest=await current(id);assert.equal((await call(id,{...o,state:'failed',cleanup_state:'delete_pending',error_code:'NOTE_CHANGED'},latest.attachments[0],latest.stamp)).ok,true);assert.equal((await current(id)).stamp,latest.stamp);assert.equal((await current(id)).raw_text,'changed source');
  });
  await t.test('a real RLS policy changing between row-lock and UPDATE cannot turn zero updated rows into success',async()=>{
   const id=await note(),before=await current(id);
   await pool.query(`create sequence private.synthetic_photo_calls;grant usage on sequence private.synthetic_photo_calls to authenticated;create function private.synthetic_photo_visible()returns boolean language sql volatile as $$select nextval('private.synthetic_photo_calls')<=1$$;revoke all on function private.synthetic_photo_visible()from public;grant execute on function private.synthetic_photo_visible()to authenticated;create policy synthetic_photo_zero_update on public.app_notes as restrictive for update to authenticated using(private.synthetic_photo_visible());`);
   try{assert.equal((await call(id,start())).error,'PERMISSION_DENIED');assert.deepEqual((await current(id)).attachments,before.attachments);assert.equal((await pool.query('select last_value::int n from private.synthetic_photo_calls')).rows[0].n,2);}finally{await pool.query('drop policy synthetic_photo_zero_update on public.app_notes;drop function private.synthetic_photo_visible();drop sequence private.synthetic_photo_calls');}
  });
  await t.test('two real sessions serialize same-version different-attempt updates and reject late worker',async()=>{
   const id=await note(),n=await current(id),first=await pool.connect(),second=await pool.connect();let pending;
   try{for(const c of [first,second]){await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[OWNER]);await c.query('set local role authenticated');}
    const q='select public.app_basket_update_attachment_ocr($1,$2,$3::jsonb,$4::jsonb) result';const params=o=>[id,n.stamp,JSON.stringify(n.attachments[0]),JSON.stringify(o)];assert.equal((await first.query(q,params(start()))).rows[0].result.ok,true);pending=second.query(q,params(start()));let blocked=false;for(let i=0;i<100&&!blocked;i++){blocked=(await pool.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1",[second.processID])).rows[0]?.blocked;if(!blocked)await new Promise(r=>setTimeout(r,10));}assert.equal(blocked,true);await first.query('commit');assert.equal((await pending).rows[0].result.error,'ATTACHMENT_CHANGED');await second.query('commit');
   }finally{await first.query('rollback');await second.query('rollback');if(pending)await pending;first.release();second.release();}
  });
  await t.test('old confirm sees OCR text commit as a changed note; summary CAS remains independent',async()=>{
   const id=await note(),n=await current(id);const confirm=targets=>as('authenticated',OWNER,async c=>(await c.query('select public.app_basket_confirm_links($1,$2,$3::jsonb) result',[id,n.stamp,JSON.stringify(targets)])).rows[0].result);
   assert.equal((await confirm([{kind:'organization',target_id:ORG_A,reason:'synthetic',summary:'approved'}])).ok,true);let o=start();await call(id,o);o=made(o);await call(id,o);o=done(o);await call(id,o);assert.equal((await confirm([{kind:'project',target_id:PROJECT_A,reason:'synthetic'}])).error,'NOTE_CHANGED');const link=(await pool.query('select id from public.app_record_links where note_id=$1',[id])).rows[0].id;assert.equal((await as('authenticated',OWNER,async c=>(await c.query("select public.app_basket_update_link_summary($1,'approved','manual') result",[link])).rows[0].result)).ok,true);
  });
  await t.test('attempt and known temp identities survive unknown generation and cleanup retries',async()=>{
   const id=await note();let o=start();await call(id,o);o={...o,state:'failed',cleanup_state:'create_unknown',error_code:'CREATE_UNKNOWN'};assert.equal((await call(id,o)).ok,true);
   assert.equal((await call(id,start())).error,'INVALID_TRANSITION');assert.equal((await call(id,{...o,attempt_id:randomUUID()})).error,'INVALID_TRANSITION');
   o={...made(o)};assert.equal((await call(id,o)).ok,true);assert.equal((await call(id,{...o,temp_document_id:'different-temp'})).error,'INVALID_TRANSITION');assert.equal((await call(id,{...o,cleanup_state:'none',temp_document_id:undefined})).error,'INVALID_TRANSITION');
   o={...o,cleanup_state:'delete_pending'};await call(id,o);o={...o,cleanup_state:'delete_failed',cleanup_error_code:'DELETE_FAILED'};await call(id,o);assert.equal((await call(id,start())).error,'INVALID_TRANSITION');o={...o,cleanup_state:'delete_pending',cleanup_error_code:undefined};await call(id,o);o={...o,cleanup_state:'deleted'};await call(id,o);assert.equal((await current(id)).attachments[0].ocr.temp_document_id,o.temp_document_id);assert.equal((await call(id,start())).ok,true);
  });
  await t.test('two text commits in one actual transaction strictly advance timestamps, with same-text lifecycle unchanged',async()=>{
   const id=await note();await as('authenticated',OWNER,async c=>{
    const get=async()=>(await c.query('select attachments,updated_at::text stamp from public.app_notes where id=$1',[id])).rows[0];
    const change=async next=>{const n=await get();const result=(await c.query('select public.app_basket_update_attachment_ocr($1,$2,$3::jsonb,$4::jsonb) result',[id,n.stamp,JSON.stringify(n.attachments[0]),JSON.stringify(next)])).rows[0].result;assert.equal(result.ok,true,JSON.stringify(result));return(await get()).stamp;};
    let o=start();await change(o);o=made(o);await change(o);o=done(o,'first');const first=await change(o);o={...o,cleanup_state:'delete_pending'};assert.equal(await change(o),first);o={...o,cleanup_state:'deleted'};await change(o);o={...start(),text:'first'};await change(o);o=made(o);await change(o);o=done(o,'second');const second=await change(o);assert.equal((await c.query('select $1::timestamptz>$2::timestamptz newer',[second,first])).rows[0].newer,true);
   });
  });
  await t.test('used rollback refuses without losing any source/text/temp tracking',async()=>{
   const before=(await pool.query('select row_to_json(n) row from public.app_notes n order by id')).rows;await assert.rejects(pool.query(await read('docs/'+stem+'.rollback.sql')),/OCR_DATA_PRESERVATION_REQUIRED/);await pool.query('rollback');assert.deepEqual((await pool.query('select row_to_json(n) row from public.app_notes n order by id')).rows,before);assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,1);
  });
  // Remove only synthetic records to verify unused migration recovery, then exact apply workflow.
  await pool.query('delete from public.app_notes');
  await pool.query(await read('docs/'+stem+'.rollback.sql'));
  await t.test('real workflow dry-run preserves original snapshot and apply/unused rollback are paired',async()=>{
   const root=new URL('../../',import.meta.url).pathname;const plan=mode=>prepareMigration({mode,version,runId:mode==='apply'?'9102':mode==='rollback'?'9103':'9101',root});
   await note();const snapshot=await read('docs/'+stem+'.snapshot.sql'),before=(await pool.query(snapshot)).rows;
   const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
   const dry=await runMigrationPlan(plan('dry-run'),query);assert.equal(dry.ok,true,dry.summary);assert.deepEqual((await pool.query(snapshot)).rows,before);await pool.query("set timezone='Asia/Seoul'");assert.deepEqual((await pool.query(snapshot)).rows,before);await pool.query("set timezone='UTC'");
   const apply=await runMigrationPlan(plan('apply'),query);assert.equal(apply.ok,true,apply.summary);const rollback=await runMigrationPlan(plan('rollback'),query);assert.equal(rollback.ok,true,rollback.summary);assert.deepEqual((await pool.query(snapshot)).rows,before);
   await pool.query(migration);
  });
  await t.test('unused rollback waits for a concurrent migration-record edit and preserves its committed revision',async()=>{
   await pool.query('delete from public.app_notes');
   const before=(await pool.query("select pg_get_constraintdef(c.oid) chk,pg_get_functiondef(p.oid) fn,p.proacl::text acl from pg_constraint c cross join pg_proc p where c.conrelid='public.app_notes'::regclass and c.conname='app_notes_attachments_check' and p.oid='public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)'::regprocedure")).rows;
   const original=(await pool.query('select * from supabase_migrations.schema_migrations where version=$1',[version])).rows[0];
   const writer=await pool.connect(),worker=await pool.connect();let pending;
   try{
    await writer.query('begin');await writer.query('update supabase_migrations.schema_migrations set statements=$1 where version=$2',[['synthetic concurrent revision'],version]);
    const query=async(sql,options={})=>{try{if(options.readOnly)await worker.query('begin read only');const r=await worker.query(sql);if(options.readOnly)await worker.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await worker.query('rollback');throw e;}};
    pending=runMigrationPlan(prepareMigration({mode:'rollback',version,runId:'9599',root:new URL('../../',import.meta.url).pathname}),query);
    let blocked=false;for(let i=0;i<100&&!blocked;i++){blocked=(await pool.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1",[worker.processID])).rows[0]?.blocked;if(!blocked)await new Promise(r=>setTimeout(r,10));}assert.equal(blocked,true);
    await writer.query('commit');const result=await pending;assert.equal(result.ok,false,'a newly committed history revision must not be deleted by unused rollback');
    assert.deepEqual((await pool.query("select pg_get_constraintdef(c.oid) chk,pg_get_functiondef(p.oid) fn,p.proacl::text acl from pg_constraint c cross join pg_proc p where c.conrelid='public.app_notes'::regclass and c.conname='app_notes_attachments_check' and p.oid='public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)'::regprocedure")).rows,before);
    assert.deepEqual((await pool.query('select statements from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].statements,['synthetic concurrent revision']);
   }finally{
    await writer.query('rollback');await worker.query('rollback');if(pending)await pending;writer.release();worker.release();
    if((await pool.query("select to_regprocedure('public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)')fn")).rows[0].fn===null)await pool.query(migration);
    await pool.query('update supabase_migrations.schema_migrations set name=$1,statements=$2 where version=$3',[original.name,original.statements,version]);
   }
  });
  await t.test('unused rollback through actual runner refuses CHECK/RPC/history drift before changing source',async drift=>{
   await pool.query('delete from public.app_notes');
   const rollbackSQL=await read('docs/'+stem+'.rollback.sql');
   const exactCheck=(await pool.query("select pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.app_notes'::regclass and conname='app_notes_attachments_check'")).rows[0].def;
   const exactFn=(await pool.query("select pg_get_functiondef('public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)'::regprocedure) def")).rows[0].def;
   const exactHistory=(await pool.query('select * from supabase_migrations.schema_migrations where version=$1',[version])).rows[0];
   const fingerprint=async()=>(await pool.query(`select 'notes' kind,coalesce(jsonb_agg(to_jsonb(n)order by id),'[]'::jsonb) value from public.app_notes n
     union all select 'CHECK',coalesce(jsonb_agg(jsonb_build_object('definition',pg_get_constraintdef(c.oid),'validated',c.convalidated,'local',c.conislocal,'inherit_count',c.coninhcount)),'[]'::jsonb) from pg_constraint c where c.conrelid='public.app_notes'::regclass and c.conname='app_notes_attachments_check'
     union all select 'RPC',coalesce(jsonb_agg(to_jsonb(p)order by p.oid),'[]'::jsonb) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='app_basket_update_attachment_ocr'
     union all select 'history',coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) from supabase_migrations.schema_migrations m where m.version='20261013034836' order by kind`)).rows;
   const root=new URL('../../',import.meta.url).pathname;
   const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
   const cases=[
    ['later CHECK cap19',()=>pool.query('alter table public.app_notes drop constraint app_notes_attachments_check;alter table public.app_notes add constraint app_notes_attachments_check check(('+exactCheck.slice(6)+') and jsonb_array_length(attachments)<=19)')],
    ['unvalidated CHECK',()=>pool.query('alter table public.app_notes drop constraint app_notes_attachments_check;alter table public.app_notes add constraint app_notes_attachments_check '+exactCheck+' not valid')],
    ['RPC body changed',()=>pool.query(exactFn.replace('v_note public.app_notes%rowtype;','v_note public.app_notes%rowtype; -- synthetic later implementation'))],
    ['RPC config changed',()=>pool.query("alter function public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)set search_path=public")],
    ['RPC ACL added',()=>pool.query('grant execute on function public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)to service_role')],
    ['history statements changed',()=>pool.query('update supabase_migrations.schema_migrations set statements=$1 where version=$2',[['synthetic later record'],version])],
    ['history name changed',()=>pool.query('update supabase_migrations.schema_migrations set name=$1 where version=$2',['synthetic_other_name',version])]
   ];
   // A later stricter CHECK is part of the same named definition, not a separate
   // constraint: old rollback must not silently erase that downstream contract.
   for(const [index,[label,change]]of cases.entries())await drift.test(label,async()=>{
    try{
     await change();const before=await fingerprint();
     const result=await runMigrationPlan(prepareMigration({mode:'rollback',version,runId:String(9600+index),root}),query);
     assert.equal(result.ok,false,'rollback must reject '+label);assert.deepEqual(await fingerprint(),before,'runner must preserve current definition, grants, record and source');
     // Also check SQL Editor path: name mismatch is refused by workflow before
     // executing SQL, but the rollback SQL must independently protect the record.
     await assert.rejects(pool.query(rollbackSQL),/PHOTO_OCR_ROLLBACK_CHANGED/);await pool.query('rollback');assert.deepEqual(await fingerprint(),before);
    }finally{
     await pool.query('rollback');await pool.query('alter table public.app_notes drop constraint app_notes_attachments_check;alter table public.app_notes add constraint app_notes_attachments_check '+exactCheck);
     await pool.query(exactFn);await pool.query('revoke all on function public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)from public,anon,authenticated,service_role;grant execute on function public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)to authenticated');
     await pool.query('insert into supabase_migrations.schema_migrations(version,name,statements)values($1,$2,$3)on conflict(version)do update set name=excluded.name,statements=excluded.statements',[exactHistory.version,exactHistory.name,exactHistory.statements]);
    }
   });
  });
  await t.test('same-name CHECK on another public table cannot satisfy source or rollback gates',async collision=>{
   await pool.query('delete from public.app_notes');
   const root=new URL('../../',import.meta.url).pathname;
   const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
   const fingerprint=async()=>(await pool.query(`select 'notes' kind,coalesce(jsonb_agg(to_jsonb(n)order by id),'[]'::jsonb) value from public.app_notes n
    union all select 'CHECK',coalesce(jsonb_agg(to_jsonb(c)order by c.oid),'[]'::jsonb)from pg_constraint c where c.connamespace='public'::regnamespace and c.conname='app_notes_attachments_check'
    union all select 'RPC',coalesce(jsonb_agg(to_jsonb(p)order by p.oid),'[]'::jsonb)from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='app_basket_update_attachment_ocr'
    union all select 'history',coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb)from supabase_migrations.schema_migrations m where m.version='20261013034836' order by kind`)).rows;
   for(const [index,[phase,operation]]of [['old','precheck'],['old','postcheck'],['old','dry-run.postcheck'],['old','apply'],['old','dry-run'],['old','direct apply'],['applied','postcheck'],['applied','rollback'],['applied','direct rollback']].entries())await collision.test(phase+' '+operation,async()=>{
    if(phase==='old')await pool.query(await read('docs/'+stem+'.rollback.sql'));
    const exactCheck=(await pool.query("select pg_get_constraintdef(oid)def from pg_constraint where conrelid='public.app_notes'::regclass and conname='app_notes_attachments_check'")).rows[0].def;
    const exactFn=phase==='applied'?(await pool.query("select pg_get_functiondef('public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)'::regprocedure)def")).rows[0].def:null;
    const history=phase==='applied'?(await pool.query('select * from supabase_migrations.schema_migrations where version=$1',[version])).rows[0]:null;
    try{
     await pool.query('create table public.synthetic_later_catalog_collision(attachments jsonb,constraint app_notes_attachments_check '+exactCheck+');alter table public.app_notes drop constraint app_notes_attachments_check;alter table public.app_notes add constraint app_notes_attachments_check check(('+exactCheck.slice(6)+') and jsonb_array_length(attachments)<=19)');
     await note();const before=await fingerprint();
     const snapshot=(await pool.query(await read('docs/'+stem+'.snapshot.sql'))).rows;assert.equal(snapshot.find(r=>r.name==='public attachments CHECK name count')?.definition,'2');
     if(['precheck','postcheck','dry-run.postcheck'].includes(operation)){
      const rows=(await pool.query(await read('docs/'+stem+'.'+operation+'.sql'))).rows;
      const item=operation==='precheck'?'exact old CHECK intact':operation==='postcheck'?'mode-specific attachments CHECK':'exact old CHECK restored';
      assert.equal(rows.find(r=>r.item===item)?.[operation==='precheck'?'value':'ok'],operation==='precheck'?'아니오':false,'a decoy CHECK must not attest the real notes CHECK');
     }else if(operation.startsWith('direct')){
      await assert.rejects(pool.query(operation==='direct apply'?migration:await read('docs/'+stem+'.rollback.sql')),/PHOTO_OCR_(?:PREREQUISITE|ROLLBACK)_CHANGED/);await pool.query('rollback');
     }else{
      const result=await runMigrationPlan(prepareMigration({mode:operation,version,runId:String(9700+index),root}),query);assert.equal(result.ok,false,'runner must reject target CHECK drift despite the exact decoy');
     }
     assert.deepEqual(await fingerprint(),before,'rejection must preserve notes, later CHECK, current RPC and migration history');
    }finally{
     await pool.query('rollback');await pool.query('drop table public.synthetic_later_catalog_collision;alter table public.app_notes drop constraint app_notes_attachments_check;alter table public.app_notes add constraint app_notes_attachments_check '+exactCheck);
     await pool.query('delete from public.app_notes');
     if(phase==='old'){
      await pool.query('drop function if exists public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)');await pool.query('delete from supabase_migrations.schema_migrations where version=$1',[version]);await pool.query(migration);
     }else{
      await pool.query(exactFn);await pool.query('revoke all on function public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)from public,anon,authenticated,service_role;grant execute on function public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)to authenticated');
      await pool.query('insert into supabase_migrations.schema_migrations(version,name,statements)values($1,$2,$3)on conflict(version)do update set name=excluded.name,statements=excluded.statements',[history.version,history.name,history.statements]);
     }
    }
   });
  });
  await t.test('changed legacy attachment constraint is rejected before schema mutation',async()=>{
   await pool.query('delete from public.app_notes');await pool.query(await read('docs/'+stem+'.rollback.sql'));
   const original=(await pool.query("select pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.app_notes'::regclass and conname='app_notes_attachments_check'")).rows[0].def;
   await pool.query('alter table public.app_notes drop constraint app_notes_attachments_check;alter table public.app_notes add constraint app_notes_attachments_check check(true)');
   await assert.rejects(pool.query(migration),/PHOTO_OCR_PREREQUISITE_CHANGED/);await pool.query('rollback');assert.equal((await pool.query("select to_regprocedure('public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)') fn")).rows[0].fn,null);
   await pool.query('alter table public.app_notes drop constraint app_notes_attachments_check;alter table public.app_notes add constraint app_notes_attachments_check '+original);await pool.query(migration);
  });
  await t.test('hosted three-role function defaults preserve uploads and grant only authenticated OCR execution',async hosted=>{
   for(const scope of ['in schema public',''])await hosted.test(scope||'global',async()=>{
    await pool.query('delete from public.app_notes');await pool.query(await read('docs/'+stem+'.rollback.sql'));
    await pool.query('alter default privileges '+scope+' grant execute on functions to anon,authenticated,service_role');
    try{
     const readiness=(await pool.query(await read('docs/'+stem+'.precheck.sql'))).rows;assert.equal(readiness.find(r=>r.item==='supported function defaults')?.value,'예');
     await pool.query(migration);
     const rights=(await pool.query("select has_function_privilege('authenticated','public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)','EXECUTE') auth,has_function_privilege('anon','public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)','EXECUTE') anon,has_function_privilege('service_role','public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)','EXECUTE') service,has_function_privilege('public_probe','public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)','EXECUTE') other")).rows[0];assert.deepEqual(rights,{auth:true,anon:false,service:false,other:false});
     await writeAs('service_role',[baseAttachment]);const id=await note();assert.equal((await call(id,start())).ok,true);await assert.rejects(call(id,start(),undefined,undefined,OWNER,'service_role'),{code:'42501'});
    }finally{
     await pool.query('rollback');await pool.query('alter default privileges '+scope+' revoke execute on functions from anon,authenticated,service_role');
     if((await pool.query("select to_regprocedure('public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)') fn")).rows[0].fn===null)await pool.query(migration);
    }
   });
  });
  await t.test('existing NOINHERIT authenticator gateway remains supported without direct OCR execution',async()=>{
   await pool.query('delete from public.app_notes');await pool.query(await read('docs/'+stem+'.rollback.sql'));await pool.query('create role authenticator noinherit;grant authenticated to authenticator');
   try{await pool.query(migration);assert.equal((await pool.query("select has_function_privilege('authenticator','public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)','EXECUTE') direct,pg_has_role('authenticator','authenticated','SET') gateway")).rows[0].direct,false);assert.equal((await pool.query("select pg_has_role('authenticator','authenticated','SET') gateway")).rows[0].gateway,true);}finally{await pool.query('rollback');await pool.query('revoke authenticated from authenticator;drop role authenticator');if((await pool.query("select to_regprocedure('public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)')fn")).rows[0].fn===null)await pool.query(migration);}
  });
  await t.test('unknown role and inherited authenticated execution fail closed without weakening existing memberships',async gates=>{
   await pool.query('delete from public.app_notes');await pool.query(await read('docs/'+stem+'.rollback.sql'));
   const cases=[
    ['unknown default role','alter default privileges in schema public grant execute on functions to public_probe','alter default privileges in schema public revoke execute on functions from public_probe'],
    ['default grant option','alter default privileges in schema public grant execute on functions to authenticated with grant option','alter default privileges in schema public revoke execute on functions from authenticated'],
    ['unknown auth inheritor','grant authenticated to public_probe','revoke authenticated from public_probe'],
    ['service auth inheritor','grant authenticated to service_role','revoke authenticated from service_role'],
    ['unknown SET-only auth member','alter role public_probe noinherit;grant authenticated to public_probe','revoke authenticated from public_probe;alter role public_probe inherit'],
    // Only the exact Supabase-managed Realtime name in its NOINHERIT/INHERIT FALSE shape is accepted.
    ['Realtime admin inheriting authenticated','create role supabase_realtime_admin noinherit;grant authenticated to supabase_realtime_admin with inherit true','revoke authenticated from supabase_realtime_admin;drop role supabase_realtime_admin'],
    ['Realtime admin INHERIT role','create role supabase_realtime_admin inherit;grant authenticated to supabase_realtime_admin with inherit false','revoke authenticated from supabase_realtime_admin;drop role supabase_realtime_admin'],
    ['look-alike Realtime name','create role supabase_realtime_admin2 noinherit;grant authenticated to supabase_realtime_admin2 with inherit false','revoke authenticated from supabase_realtime_admin2;drop role supabase_realtime_admin2']
   ];
   for(const [label,change,restore]of cases)await gates.test(label,async()=>{
    await pool.query(change);try{const readiness=(await pool.query(await read('docs/'+stem+'.precheck.sql'))).rows;const item=change.startsWith('alter default')?'supported function defaults':'auth execution paths supported';assert.equal(readiness.find(r=>r.item===item)?.value,'아니오');await assert.rejects(pool.query(migration),/PHOTO_OCR_PREREQUISITE_CHANGED/);await pool.query('rollback');assert.equal((await pool.query("select to_regprocedure('public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)') fn")).rows[0].fn,null);}finally{await pool.query('rollback');await pool.query(restore);if((await pool.query("select to_regprocedure('public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)')fn")).rows[0].fn!==null)await pool.query(await read('docs/'+stem+'.rollback.sql'));}
   });
   await pool.query(migration);
  });
  await t.test('unexpected note trigger fails closed before adding OCR capability',async()=>{
   await pool.query('delete from public.app_notes');await pool.query(await read('docs/'+stem+'.rollback.sql'));
   await pool.query(`create function public.synthetic_touch_note()returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;create trigger synthetic_touch_note before update on public.app_notes for each row execute function public.synthetic_touch_note();`);
   try{await assert.rejects(pool.query(migration),/PHOTO_OCR_PREREQUISITE_CHANGED/);await pool.query('rollback');const rows=(await pool.query(await read('docs/'+stem+'.precheck.sql'))).rows;assert.equal(rows.find(r=>r.item==='notes triggers absent').value,'아니오');}finally{await pool.query('drop trigger synthetic_touch_note on public.app_notes;drop function public.synthetic_touch_note()');}
  });
  const exactRows=async()=>(await pool.query("select length(check_clause) n,md5(check_clause) hash from information_schema.check_constraints where constraint_schema='public' and constraint_name='app_notes_attachments_check'")).rows;
  await t.test('local migration order reproduces the production old CHECK text exactly',async()=>{
   await pool.query('delete from public.app_notes');if((await pool.query("select to_regprocedure('public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)')fn")).rows[0].fn!==null)await pool.query(await read('docs/'+stem+'.rollback.sql'));
   // 2026-10-14 production read-only observation: length 1059, md5 below.
   assert.deepEqual(await exactRows(),[{n:1059,hash:'1036ac313de32f9538d1f7af61eea291'}]);
  });
  await t.test('production role layout: read-only endpoint role and Supabase-managed members pass every gate',async()=>{
   // Supabase layout: postgres inherits authenticated (excluded as executor), authenticator and
   // supabase_realtime_admin are NOINHERIT gateways, read-only requests use a pg_read_all_data role.
   await pool.query(`create role supabase_read_only_user login bypassrls;grant pg_read_all_data to supabase_read_only_user;create role authenticator noinherit;grant authenticated to authenticator;create role supabase_realtime_admin nologin noinherit;grant authenticated to supabase_realtime_admin with inherit false;grant authenticated to postgres`);
   try{
    await note();
    const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly){await c.query('begin read only');await c.query('set local role supabase_read_only_user');}const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
    // information_schema hides the CHECK from the read-only role; the gates read pg_constraint instead.
    assert.deepEqual(await query("select count(*)::int n from information_schema.check_constraints where constraint_name='app_notes_attachments_check'",{readOnly:true}),[{n:0}]);
    const readiness=await query(await read('docs/'+stem+'.precheck.sql'),{readOnly:true});
    const verdicts=readiness.filter(r=>['예','아니오'].includes(r.value));assert.ok(verdicts.length>=10);
    for(const r of verdicts)assert.equal(r.value,'예',r.item);
    const plan=mode=>prepareMigration({mode,version,runId:{'dry-run':'9801',apply:'9802',rollback:'9803'}[mode],root:new URL('../../',import.meta.url).pathname});
    const dry=await runMigrationPlan(plan('dry-run'),query);assert.equal(dry.ok,true,dry.summary);assert.equal(dry.verification,'complete',dry.summary);
    const apply=await runMigrationPlan(plan('apply'),query);assert.equal(apply.ok,true,apply.summary);assert.doesNotMatch(apply.summary.split('사후 검사:')[1],/아니오/);
    // Accepted gateways still have no inherited direct EXECUTE on the new RPC.
    for(const role of ['authenticator','supabase_realtime_admin'])assert.equal((await pool.query("select has_function_privilege($1,'public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)','EXECUTE') x",[role])).rows[0].x,false,role);
    const rollback=await runMigrationPlan(plan('rollback'),query);assert.equal(rollback.ok,true,rollback.summary);assert.doesNotMatch(rollback.summary.split('사후 검사:')[1],/아니오/);
   }finally{await pool.query('rollback');await pool.query('delete from public.app_notes;revoke authenticated from postgres;revoke authenticated from supabase_realtime_admin;drop role supabase_realtime_admin;revoke authenticated from authenticator;drop role authenticator;drop owned by supabase_read_only_user;drop role supabase_read_only_user');}
  });
  await t.test('CHECK gates ignore whitespace-only deparse differences but reject different meaning',async gates=>{
   const migrationNow=migration,rollbackSQL=await read('docs/'+stem+'.rollback.sql');
   // Production 2026-10-14 vs a re-indented rendering of the same expression.
   const spaces="replace(%s,E'\\n    ELSE false\\nEND',E'\\n        ELSE false\\n        END')",meaning="replace(%s,'<= 20','<= 21')";
   const inPrecheck=async(form,file,item,key)=>{const sql=(await read('docs/'+stem+'.'+file+'.sql')).replaceAll('regexp_replace(pg_get_constraintdef(oid),','regexp_replace('+form.replace('%s','pg_get_constraintdef(oid)')+',');return (await pool.query(sql)).rows.find(r=>r.item===item)?.[key];};
   const guard=(sql,form)=>sql.replace('regexp_replace(check_clause,','regexp_replace('+form.replace('%s','check_clause')+',');
   await gates.test('old CHECK: precheck, dry-run original-state check and migration guard',async()=>{
    assert.equal(await inPrecheck(spaces,'precheck','exact old CHECK intact','value'),'예');assert.equal(await inPrecheck(meaning,'precheck','exact old CHECK intact','value'),'아니오');
    assert.equal(await inPrecheck(spaces,'dry-run.postcheck','exact old CHECK restored','ok'),true);assert.equal(await inPrecheck(meaning,'dry-run.postcheck','exact old CHECK restored','ok'),false);
    assert.equal(await inPrecheck(spaces,'postcheck','mode-specific attachments CHECK','ok'),true);assert.equal(await inPrecheck(meaning,'postcheck','mode-specific attachments CHECK','ok'),false);
    await assert.rejects(pool.query(guard(migrationNow,meaning)),/PHOTO_OCR_PREREQUISITE_CHANGED/);await pool.query('rollback');
    await pool.query(guard(migrationNow,spaces));
   });
   await gates.test('new CHECK: applied postcheck and unused rollback guard',async()=>{
    assert.equal(await inPrecheck(spaces,'postcheck','mode-specific attachments CHECK','ok'),true);assert.equal(await inPrecheck(meaning,'postcheck','mode-specific attachments CHECK','ok'),false);
    const newSpaces="replace(%s,E'\\n    ELSE false\\nEND',E'\\n  ELSE false\\n  END')",newMeaning="replace(%s,'<= 16384','<= 16385')";
    assert.equal(await inPrecheck(newMeaning,'postcheck','mode-specific attachments CHECK','ok'),false);
    await assert.rejects(pool.query(guard(rollbackSQL,newMeaning)),/PHOTO_OCR_ROLLBACK_CHANGED/);await pool.query('rollback');
    await assert.rejects(pool.query(guard(rollbackSQL,meaning)),/PHOTO_OCR_ROLLBACK_CHANGED/);await pool.query('rollback');
    await pool.query(guard(rollbackSQL,newSpaces));assert.equal((await pool.query("select to_regprocedure('public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)')fn")).rows[0].fn,null);
   });
  });
 }finally{if(pool){await pool.end();await Promise.all(clientEnds);}await cluster.stop();}
});
