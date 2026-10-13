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
  await t.test('changed legacy attachment constraint is rejected before schema mutation',async()=>{
   await pool.query('delete from public.app_notes');await pool.query(await read('docs/'+stem+'.rollback.sql'));
   const original=(await pool.query("select pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.app_notes'::regclass and conname='app_notes_attachments_check'")).rows[0].def;
   await pool.query('alter table public.app_notes drop constraint app_notes_attachments_check;alter table public.app_notes add constraint app_notes_attachments_check check(true)');
   await assert.rejects(pool.query(migration),/PHOTO_OCR_PREREQUISITE_CHANGED/);await pool.query('rollback');assert.equal((await pool.query("select to_regprocedure('public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)') fn")).rows[0].fn,null);
   await pool.query('alter table public.app_notes drop constraint app_notes_attachments_check;alter table public.app_notes add constraint app_notes_attachments_check '+original);await pool.query(migration);
  });
  await t.test('custom function default ACL cannot silently grant a new service-role entry point',async()=>{
   await pool.query('delete from public.app_notes');await pool.query(await read('docs/'+stem+'.rollback.sql'));
   await pool.query('alter default privileges in schema public grant execute on functions to service_role');
   try{await assert.rejects(pool.query(migration),/PHOTO_OCR_PREREQUISITE_CHANGED/);await pool.query('rollback');assert.equal((await pool.query("select to_regprocedure('public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)') fn")).rows[0].fn,null);}finally{await pool.query('alter default privileges in schema public revoke execute on functions from service_role');}
   await pool.query(migration);
  });
  await t.test('unexpected note trigger fails closed before adding OCR capability',async()=>{
   await pool.query('delete from public.app_notes');await pool.query(await read('docs/'+stem+'.rollback.sql'));
   await pool.query(`create function public.synthetic_touch_note()returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;create trigger synthetic_touch_note before update on public.app_notes for each row execute function public.synthetic_touch_note();`);
   try{await assert.rejects(pool.query(migration),/PHOTO_OCR_PREREQUISITE_CHANGED/);await pool.query('rollback');const rows=(await pool.query(await read('docs/'+stem+'.precheck.sql'))).rows;assert.equal(rows.find(r=>r.item==='notes triggers absent').value,'아니오');}finally{await pool.query('drop trigger synthetic_touch_note on public.app_notes;drop function public.synthetic_touch_note()');}
  });
 }finally{if(pool){await pool.end();await Promise.all(clientEnds);}await cluster.stop();}
});
