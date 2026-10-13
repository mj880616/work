// Real handler + real Drive provider + real local owner-RLS RPC. All data synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {fixture,OWNER,STRANGER,WS_A} from './basket4-fixture.mjs';
import {ocrHarness} from '../security/helpers/basket-ocr-fixture.mjs';
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

test('photo server consumes main SQL with exact owner-JWT CAS and preserves legacy upload',{timeout:90000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'photo-server-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;const ends=[];
 try{
  await cluster.initialise();await cluster.start();pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false});pool.on('connect',c=>ends.push(new Promise(r=>c.once('end',r))));
  await pool.query(fixture);
  for(const file of ['20260927103344_task_impl2_notes_record_links.sql','20260928123601_task_meeting_followup_record_links.sql'])await pool.query(await read('supabase/migrations/'+file));
  await pool.query(`create table public.app_documents(id uuid primary key,workspace_id uuid);alter table public.app_spaces add column owner_id uuid default '${OWNER}',add column name text,add column parent_id uuid,add column status text default 'active',add column metadata jsonb default '{"project_system":"v2"}';grant select,update on public.app_spaces to authenticated;alter table public.app_spaces enable row level security;create policy synthetic_spaces_owner on public.app_spaces for all to authenticated using(private.app_is_workspace_owner(workspace_id)) with check(private.app_is_workspace_owner(workspace_id));`);
  for(const file of ['20261010120000_basket1_notes_links.sql','20261011180000_basket4a_confirm_links.sql','20261012100000_basket_link_view_db.sql','20261013034836_basket_photo_ocr_db.sql'])await pool.query(await read('supabase/migrations/'+file));
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const row=async(id,role='authenticated',sub=OWNER)=>as(role,sub,async c=>(await c.query("select to_jsonb(n) value from public.app_notes n where id=$1 and workspace_id=$2",[id,WS_A])).rows[0]?.value??null);
  async function harness(options={}){
   const id=randomUUID();await pool.query("insert into public.app_notes(id,workspace_id,raw_text,attachments,updated_at,archived_at,ai_export_allowed,metadata)values($1,$2,'unchanged raw',$3::jsonb,'2026-10-13T01:00:00.123456Z','2026-10-12T00:00:00Z',false,'{\"unrelated\":true}')",[id,WS_A,JSON.stringify([{drive_file_id:'source',file_name:'photo.jpg',mime_type:'image/jpeg',size_bytes:4}])]);
   const shared=await row(id),role=options.role??'authenticated',sub=options.sub??OWNER;let h;
   const user={from(table){assert.equal(table,'app_notes');const filters={};const q={select(){return q;},eq(k,v){filters[k]=v;return q;},async maybeSingle(){try{const data=await row(filters.id,role,sub);return {data:data?.workspace_id===filters.workspace_id?data:null,error:null};}catch(e){return {data:null,error:{code:e.code}};}}};return q;},async rpc(name,args){assert.equal(name,'app_basket_update_attachment_ocr');h.calls.rpc.push(structuredClone(args));if(options.lateStartCommit&&args.p_ocr?.cleanup_state==='create_pending'){
     options.lateStartCommit=false;
     const c=await pool.connect();await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[OWNER]);await c.query('set local role authenticated');
     const data=(await c.query('select public.app_basket_update_attachment_ocr($1,$2,$3::jsonb,$4::jsonb) value',[args.p_note_id,args.p_note_updated_at,JSON.stringify(args.p_expected_attachment),JSON.stringify(args.p_ocr)])).rows[0].value;assert.equal(data.ok,true);
     h.commitLate=async()=>{await c.query('commit');c.release();Object.assign(shared,await row(id));h.calls.writes.push(structuredClone(data.attachment.ocr));};
     return {data:null,error:{code:'NETWORK'}};
    }if(options.blockCleanupStates?.includes(args.p_ocr?.cleanup_state))return {data:null,error:{code:'NETWORK'}};try{
     const data=await as(role,sub,async c=>(await c.query('select public.app_basket_update_attachment_ocr($1,$2,$3::jsonb,$4::jsonb) value',[args.p_note_id,args.p_note_updated_at,JSON.stringify(args.p_expected_attachment),JSON.stringify(args.p_ocr)])).rows[0].value);
     if(data.ok){Object.assign(shared,await row(id));h.calls.writes.push(structuredClone(data.attachment.ocr));}
     if(data.ok&&((options.lostDoneResponse&&args.p_ocr.state==='done')||(options.lostStartResponse&&args.p_ocr.cleanup_state==='create_pending')))return {data:null,error:{code:'NETWORK'}};
     return {data,error:null};
    }catch(e){return {data:null,error:{code:e.code}};}}};
   const adminNotes=()=>{
    const filters={},q={select(){return q;},eq(k,v){filters[k]=v;return q;},update(v){q.payload=v;return q;},async maybeSingle(){
     try{const data=await as('service_role',OWNER,async c=>{
      if(!q.payload)return (await c.query('select to_jsonb(n) value from public.app_notes n where id=$1 and workspace_id=$2',[filters.id,filters.workspace_id])).rows[0]?.value??null;
      return (await c.query('update public.app_notes set attachments=$3::jsonb,updated_at=$4::timestamptz where id=$1 and workspace_id=$2 and updated_at=$5::timestamptz and attachments=$6::jsonb returning id',[filters.id,filters.workspace_id,JSON.stringify(q.payload.attachments),q.payload.updated_at,filters.updated_at,filters.attachments])).rows[0]??null;
     });return {data,error:null,status:200};}catch(e){return {data:null,error:{code:e.code},status:400};}
    }};return q;
   };
   const providerOptions={...options,note:shared,user,adminNotes};h=ocrHarness(providerOptions);h.providerOptions=providerOptions;return h;
  }
  await t.test('actual SQL commits text once, lifecycle versions stay exact, archive/exclusion/raw/metadata survive',async()=>{
   const h=await harness(),before=structuredClone(h.note),r=await(await h.request()).json();assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.cleanup_state,'deleted');assert.equal(r.ocr_saved,true);assert.equal(r.text_changed,true);
   assert.equal(h.calls.writes[0].cleanup_state,'create_pending');assert.equal(h.calls.writes.at(-1).cleanup_state,'deleted');assert.equal(h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length,1);
   assert.notEqual(h.note.updated_at,before.updated_at);for(const key of ['raw_text','metadata','archived_at','ai_export_allowed','created_at'])assert.deepEqual(h.note[key],before[key]);
   const after=h.note.updated_at;assert.equal((await(await h.request('ocr-reconcile',{attempt_id:h.note.attachments[0].ocr.attempt_id})).json()).text_changed,false);assert.equal(h.note.updated_at,after);
  });
  await t.test('two handlers competing on one snapshot get one durable attempt and one external POST',async()=>{
   const h=await harness({createUnknown:true}),snapshot={note_updated_at:h.note.updated_at,expected_attachment:structuredClone(h.note.attachments[0])};
   const responses=await Promise.all([h.request('ocr-read',snapshot),h.request('ocr-read',snapshot)]);assert.equal(responses.filter(r=>r.status===503).length,1);assert.equal(responses.filter(r=>r.status===409).length,1);
   assert.equal(h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length,1);assert.equal(h.note.attachments[0].ocr.cleanup_state,'create_unknown');
   assert.equal((await h.request()).status,409);
  });
  await t.test('unknown RPC response readback confirms real commit, never repeats import',async()=>{
   const h=await harness({lostDoneResponse:true});const r=await(await h.request()).json();assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.ocr_saved,true);assert.equal(h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length,1);
  });
  await t.test('late raw edit rejects text; restart requires an explicit exact-current confirmation and creates no second doc',async()=>{
   let once=true;const h=await harness({onExport:async n=>{if(once){once=false;await pool.query("update public.app_notes set raw_text='new raw',updated_at=updated_at+interval '1 second' where id=$1",[n.id]);}}});
   const first=await(await h.request()).json();assert.equal(first.code,'NOTE_CHANGED');assert.equal((await row(h.note.id)).attachments[0].ocr.text,undefined);assert.equal(h.calls.drive.some(c=>c.method==='DELETE'),false);
   Object.assign(h.note,await row(h.note.id));const attempt_id=h.note.attachments[0].ocr.attempt_id;
   assert.equal((await h.request('ocr-reconcile',{attempt_id})).status,409);assert.equal((await row(h.note.id)).attachments[0].ocr.text,undefined);
   const result=await(await h.request('ocr-reconcile',{attempt_id,confirm_current_note_version:h.note.updated_at})).json();assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.cleanup_state,'deleted');assert.equal(h.note.raw_text,'new raw');
   assert.equal(h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length,1);
  });
  await t.test('unbounded OCR text never commits a prefix; retained tracking can be cleaned with no source deletion',async()=>{
   const h=await harness({text:'😀'.repeat(16385)}),r=await(await h.request()).json();assert.equal(r.code,'OCR_TEXT_TOO_LONG');
   const n=await row(h.note.id);assert.equal(n.attachments[0].ocr.text,undefined);assert.equal(n.attachments[0].ocr.state,'failed');assert.equal(n.attachments[0].ocr.temp_document_id,'temp');assert.equal(h.calls.drive.some(c=>c.method==='DELETE'),false);
   Object.assign(h.note,n);const clean=await(await h.request('ocr-cleanup',{attempt_id:n.attachments[0].ocr.attempt_id})).json();assert.equal(clean.ok,true,JSON.stringify(clean));assert.equal(clean.cleanup_state,'deleted');assert.equal(clean.ocr_saved,false);
   assert.equal(h.calls.drive.filter(c=>c.method==='DELETE'&&c.url.pathname.endsWith('/source')).length,0);
  });
  await t.test('real owner RPC pending after lost CREATE and lost unknown-status persistence cannot be reset by restart cleanup',async()=>{
   const options={createUnknown:true,blockCleanupStates:['create_unknown']},h=await harness(options);const first=await(await h.request()).json();assert.equal(first.code,'OCR_CREATE_UNKNOWN');
   Object.assign(h.note,await row(h.note.id));const original=h.note.updated_at,attempt=h.note.attachments[0].ocr.attempt_id;assert.equal(h.note.attachments[0].ocr.cleanup_state,'create_pending');assert.equal(h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length,1);
   h.restart();const cleanup=await(await h.request('ocr-cleanup',{attempt_id:attempt})).json();assert.equal(cleanup.code,'OCR_TEMP_UNKNOWN');
   await h.request();assert.equal(h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length,1);const n=await row(h.note.id);assert.equal(n.attachments[0].ocr.attempt_id,attempt);assert.equal(n.attachments[0].ocr.cleanup_state,'create_pending');assert.equal(n.updated_at,original);assert.equal(cleanup.result_unknown,true);
   h.providerOptions.discoveryStatus=503;assert.notEqual((await h.request('ocr-reconcile',{attempt_id:attempt})).status,200);delete h.providerOptions.discoveryStatus;
   await h.request();assert.equal(h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length,1);assert.equal((await row(h.note.id)).attachments[0].ocr.cleanup_state,'create_pending');
  });
  await t.test('negative readback does not disprove a late attempt commit; a restarted worker cannot release it',async()=>{
   const h=await harness({lateStartCommit:true});try{
    const first=await(await h.request()).json();assert.equal(first.code,'OCR_DB_RESULT_UNKNOWN');assert.equal(first.result_unknown,true);assert.equal((await row(h.note.id)).attachments[0].ocr,undefined);assert.equal(h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length,0);
   }finally{if(h.commitLate)await h.commitLate();}
   const attempt=h.note.attachments[0].ocr.attempt_id;assert.equal(h.note.attachments[0].ocr.cleanup_state,'create_pending');h.restart();
   const cleanup=await(await h.request('ocr-cleanup',{attempt_id:attempt})).json();assert.equal(cleanup.code,'OCR_TEMP_UNKNOWN');assert.equal(cleanup.result_unknown,true);
   await h.request();assert.equal((await row(h.note.id)).attachments[0].ocr.attempt_id,attempt);assert.equal((await row(h.note.id)).attachments[0].ocr.cleanup_state,'create_pending');assert.equal(h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length,0);
  });
  await t.test('real owner RPC permits fresh known pre-POST failure recovery without altering source flags',async()=>{
   const options={sourceBytes:new Uint8Array([1,2,3,4]),lostStartResponse:true},h=await harness(options),before=structuredClone(h.note),r=await(await h.request()).json();assert.equal(r.code,'OCR_SOURCE_UNSUPPORTED');assert.equal(r.result_unknown,false);
   const n=await row(h.note.id),attempt=n.attachments[0].ocr.attempt_id;assert.equal(n.attachments[0].ocr.state,'failed');assert.equal(n.attachments[0].ocr.cleanup_state,'none');assert.equal(n.updated_at,before.updated_at);assert.equal(h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length,0);
   delete h.providerOptions.sourceBytes;const next=await(await h.request()).json();assert.equal(next.ok,true);assert.equal(h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length,1);assert.notEqual(h.note.attachments[0].ocr.attempt_id,attempt);
   for(const key of ['raw_text','metadata','archived_at','ai_export_allowed'])assert.deepEqual(h.note[key],before[key]);
  });
  await t.test('caller owner-RLS, service-role execute denial and unknown capability fail closed',async()=>{
   for(const options of [{sub:STRANGER},{role:'service_role',sub:OWNER}]){const h=await harness(options);assert.notEqual((await h.request()).status,200);assert.equal(h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length,0);}
   const h=await harness();await assert.rejects(as('service_role',OWNER,c=>c.query('select public.app_basket_update_attachment_ocr(null,null,null,null)')),{code:'42501'});
   assert.equal((await row(h.note.id)).attachments[0].ocr,undefined);
  });
  await t.test('legacy service-role append preserves every OCR field and source; no auth-only CHECK dependency',async()=>{
   const h=await harness({cleanupFail:true});await h.request();const before=structuredClone(h.note.attachments[0]);
   const form=new FormData();form.append('note_id',h.note.id);form.append('file',new File([new Uint8Array([137,80,78,71,13,10,26,10])],'legacy.png',{type:'image/png'}));
   const response=await h.handler(new Request('https://edge.test/basket-files',{method:'POST',headers:{Authorization:'Bearer owner'},body:form}));assert.equal(response.status,200,JSON.stringify(await response.json()));
   const n=await row(h.note.id);assert.deepEqual(n.attachments[0],before);assert.equal(n.attachments.length,2);
  });
 }finally{if(pool){await pool.end();await Promise.all(ends);}await cluster.stop();}
});
