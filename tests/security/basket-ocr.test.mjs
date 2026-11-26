import test from 'node:test';
import assert from 'node:assert/strict';
import {ocrHarness,STAMP} from './helpers/basket-ocr-fixture.mjs';
test('authenticated GET capability and status cause no row or Drive file writes',async()=>{
 const h=ocrHarness(),cap=await(await h.request('ocr-capabilities',{},'GET')).json();
 assert.equal(cap.protocol_version,1);assert.equal(cap.db,'supported');assert.deepEqual(cap.supported_mime_types,['image/jpeg','image/png']);
 const status=await h.request('ocr-status',{},'GET');assert.equal(status.status,200);assert.equal(status.headers.get('cache-control'),'no-store');
 assert.equal(h.calls.writes.length,0);assert.equal(h.calls.drive.some(c=>['POST','PATCH','DELETE'].includes(c.method)&&c.url.hostname==='www.googleapis.com'),false);
});
test('old or unknown DB, nonowner, forged workspace and invalid JWT cannot create or delete',async()=>{
 for(const options of [{missingDb:true},{nonOwner:true}]){
  const h=ocrHarness(options);assert.notEqual((await h.request()).status,200);assert.equal(h.calls.writes.length,0);assert.equal(h.calls.drive.some(c=>c.method==='DELETE'||c.url.pathname.includes('/upload/')),false);
 }
 const h=ocrHarness();assert.equal((await h.request('ocr-read',{},'POST','forged')).status,401);assert.equal(h.calls.rpc.length,0);
 assert.equal((await h.request('ocr-read',{workspace_id:'other'})).status,400);assert.equal(h.calls.writes.length,0);
});
test('durable caller-JWT attempt, text and cleanup preserve original and source flags',async()=>{
 for(const options of [{},{archived:true,excluded:true}]){
  const h=ocrHarness(options),result=await(await h.request()).json();assert.equal(result.ok,true);assert.equal(result.ocr_saved,true);assert.equal(result.cleanup_state,'deleted');assert.equal(result.text_changed,true);
  assert.equal(h.note.raw_text,'原文保護');assert.equal(h.note.archived_at,options.archived?STAMP:null);assert.equal(h.note.ai_export_allowed,!options.excluded);
  assert.equal(h.note.attachments[0].drive_file_id,'source');assert.equal(h.note.attachments[0].ocr.text,'인식 글');assert.equal(h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length,1);
 }
});
test('create unknown is durable and reconciliation never regenerates it',async()=>{
 const h=ocrHarness({createUnknown:true,discoveryEmpty:true});assert.equal((await h.request()).status,503);assert.equal(h.note.attachments[0].ocr.cleanup_state,'create_unknown');
 const posts=h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length;assert.notEqual((await h.request()).status,200);
 const attempt_id=h.note.attachments[0].ocr.attempt_id;await h.request('ocr-reconcile',{attempt_id});
 assert.equal(h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length,posts);assert.equal(h.note.attachments[0].ocr.attempt_id,attempt_id);
});
test('saved OCR survives cleanup failure and cleanup retries do not create a new document',async()=>{
 const h=ocrHarness({cleanupFail:true}),result=await(await h.request()).json();assert.equal(result.ocr_saved,true);assert.equal(result.cleanup_state,'delete_failed');assert.equal(h.note.attachments[0].ocr.text,'인식 글');
 const count=h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length;await h.request('ocr-cleanup',{attempt_id:h.note.attachments[0].ocr.attempt_id});assert.equal(h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length,count);
});
test('source conflicts retain known temp tracking without committing text or deleting',async()=>{
 const h=ocrHarness({sourceChanged:true});assert.equal((await h.request()).status,409);
 assert.equal(h.note.attachments[0].ocr.text,undefined);assert.equal(h.note.attachments[0].ocr.temp_document_id,'temp');assert.equal(h.calls.drive.some(c=>c.method==='DELETE'),false);
 const result=await h.request('ocr-reconcile',{attempt_id:h.note.attachments[0].ocr.attempt_id});assert.equal(result.status,409);assert.equal(h.note.attachments[0].ocr.text,undefined);
});
test('read-back confirms a committed text write despite its lost RPC response',async()=>{
 const h=ocrHarness({commitUnknown:true});const result=await(await h.request()).json();assert.equal(result.ocr_saved,true);assert.equal(h.note.attachments[0].ocr.text,'인식 글');assert.equal(h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length,1);
});

test('unverified returned document identity is never persisted as a deletable document',async()=>{
 const h=ocrHarness({temp:{ownedByMe:false}}),response=await h.request();assert.equal(response.status,409);
 assert.equal(h.note.attachments[0].ocr.temp_document_id,undefined);
 assert.equal(h.note.attachments[0].ocr.cleanup_state,'create_unknown');
 assert.equal(h.calls.drive.some(c=>c.method==='DELETE'),false);
 assert.equal((await response.json()).temp_document_id,undefined);
});
test('a completed cleanup returns the committed result without reading the deleted document again',async()=>{
 const h=ocrHarness();await h.request();const count=h.calls.drive.length;
 const result=await(await h.request('ocr-reconcile',{attempt_id:h.note.attachments[0].ocr.attempt_id})).json();
 assert.equal(result.ok,true);assert.equal(result.ocr_saved,true);assert.equal(result.cleanup_state,'deleted');assert.equal(result.text_changed,false);
 assert.equal(h.calls.drive.length,count);
});
test('a raw edit after acknowledged DELETE preserves saved text and records cleanup with current-attempt CAS',async()=>{
 const h=ocrHarness({onDelete:note=>{note.raw_text='edited while cleaning';note.updated_at='2026-10-13T05:00:00.654321+00:00';}});
 const result=await(await h.request()).json();assert.equal(result.ok,true);assert.equal(result.ocr_saved,true);assert.equal(result.cleanup_state,'deleted');
 assert.equal(h.note.raw_text,'edited while cleaning');assert.equal(h.note.attachments[0].ocr.text,'인식 글');
 assert.equal(h.calls.drive.filter(c=>c.method==='DELETE').length,1);
});

test('concurrent settings removal never lets OCR create a replacement folder or save settings',async()=>{
 const h=ocrHarness({settingsCleared:true,noRoot:true});await h.request();
 assert.equal(h.calls.drive.some(c=>c.url.hostname==='www.googleapis.com'&&c.method==='POST'),false);
 assert.equal(h.calls.writes.length,0);
});

test('unknown creation can adopt its exact private document without import replay',async()=>{
 const h=ocrHarness({createUnknown:true});await h.request();const attempt_id=h.note.attachments[0].ocr.attempt_id;
 const r=await(await h.request('ocr-reconcile',{attempt_id})).json();assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.cleanup_state,'deleted');
 assert.equal(h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length,1);
 assert.equal(h.calls.logs.some(code=>code.includes('PRIVATE_CREATE_ERROR')||code.includes('인식 글')),false);
});
test('a negative read after unknown attempt persistence never permits external creation or DB write replay',async()=>{
 let mutations=0;const h=ocrHarness({rpcHook:(_name,args)=>args.p_note_id!==null?(mutations++,{data:null,error:{code:'NETWORK'}}):null});
 const r=await(await h.request()).json();assert.equal(r.code,'OCR_DB_RESULT_UNKNOWN');assert.equal(r.result_unknown,true);assert.equal(mutations,1);
 assert.equal(h.calls.drive.some(c=>c.url.pathname.includes('/upload/')||c.method==='DELETE'),false);
 assert.equal(h.note.attachments[0].ocr,undefined);
});
test('discovery never exposes an unverified candidate as a known temporary document',async()=>{
 const h=ocrHarness({createUnknown:true,temp:{ownedByMe:false}});await h.request();
 const r=await(await h.request('ocr-reconcile',{attempt_id:h.note.attachments[0].ocr.attempt_id})).json();
 assert.equal(r.code,'OCR_IDENTITY_INVALID');assert.equal(r.temp_document_id,undefined);assert.equal(h.note.attachments[0].ocr.temp_document_id,undefined);
 assert.equal(h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length,1);assert.equal(h.calls.drive.some(c=>c.method==='DELETE'),false);
});

test('restarted pending or unknown attempts survive cleanup and reconciliation refusals without another import',async()=>{
 const cases=[['cleanup',{},'ocr-cleanup'],['discovery-http',{discoveryStatus:503},'ocr-reconcile'],['ambiguous',{discoveryFiles:[{id:'temp'},{id:'other'}]},'ocr-reconcile'],['identity',{temp:{ownedByMe:false}},'ocr-reconcile'],['source',{sourceMetadata:{ownedByMe:false}},'ocr-reconcile'],['not-found',{discoveryEmpty:true},'ocr-reconcile']];
 for(const [initial,createUnknown,blocked]of [['create_pending',true,'create_unknown'],['create_pending',false,'created'],['create_unknown',true,null]])for(const [label,failure,action]of cases){
  const options={createUnknown,rpcHook:(_name,args)=>blocked&&args.p_ocr?.cleanup_state===blocked?{data:null,error:{code:'NETWORK'}}:null};
  const h=ocrHarness(options);await h.request();const attempt=h.note.attachments[0].ocr.attempt_id;
  assert.equal(h.note.attachments[0].ocr.cleanup_state,initial);assert.equal(h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length,1);
  Object.assign(options,failure);h.restart();const refusal=await(await h.request(action,{attempt_id:attempt})).json();assert.equal(refusal.ok,false,label);
  for(const key of Object.keys(failure))delete options[key];
  await h.request();assert.equal(h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length,1,initial+':'+label+' must never regenerate');
  assert.equal(h.note.attachments[0].ocr.attempt_id,attempt,label);assert.ok(['create_pending','create_unknown'].includes(h.note.attachments[0].ocr.cleanup_state),label);if(initial==='create_unknown')assert.equal(h.note.attachments[0].ocr.cleanup_state,'create_unknown',label);assert.equal(h.note.attachments[0].ocr.state,'reading',label);
  assert.equal(refusal.result_unknown,true,label);assert.equal(h.calls.drive.some(c=>c.method==='DELETE'),false,label);
 }
});
test('only a fresh confirmed attempt with a known pre-POST binary failure can return to failed/none',async()=>{
 const options={sourceBytes:new Uint8Array([1,2,3,4])},h=ocrHarness(options),r=await(await h.request()).json();
 assert.equal(r.code,'OCR_SOURCE_UNSUPPORTED');assert.equal(r.result_unknown,false);assert.equal(h.note.attachments[0].ocr.state,'failed');assert.equal(h.note.attachments[0].ocr.cleanup_state,'none');
 const oldAttempt=h.note.attachments[0].ocr.attempt_id;assert.equal(h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length,0);
 delete options.sourceBytes;const next=await(await h.request()).json();assert.equal(next.ok,true);assert.notEqual(h.note.attachments[0].ocr.attempt_id,oldAttempt);assert.equal(h.calls.drive.filter(c=>c.url.pathname.includes('/upload/')).length,1);
});

// S69-98 NOTE-에버노트 ④: 노트(kind 'note')의 사진은 바구니 안 비공개 폴더 '노트 첨부'에 있다. OCR은 그 폴더를 찾기만 하고(만들지 않음),
// 임시 문서도 그 폴더에 두었다가 지운다. 폴더가 없거나 공유돼 있으면 거절하고 아무것도 쓰지 않는다. 바구니 업데이트(kind 없음)는 그대로 맨 위 폴더.
test('note photo: OCR reads inside the private "노트 첨부" folder, never creates it, refuses a shared one, keeps root photos',async()=>{
 const h=ocrHarness({noteKind:true}),result=await(await h.request()).json();
 assert.equal(result.ok,true);assert.equal(result.ocr_saved,true);assert.equal(result.cleanup_state,'deleted');
 assert.equal(h.note.attachments[0].ocr.text,'인식 글');assert.equal(h.note.raw_text,'原文保護');assert.equal(h.calls.childLookups,1);
 const upload=h.calls.drive.find(c=>c.url.pathname==='/upload/drive/v3/files');assert.ok(upload);
 const shared=ocrHarness({noteKind:true,sharedNoteFolder:true}),r=await shared.request();assert.equal(r.status,409);assert.equal((await r.json()).code,'OCR_FOLDER_UNAVAILABLE');
 assert.equal(shared.calls.writes.length,0);assert.equal(shared.calls.drive.some(c=>c.url.pathname.includes('/upload/')||c.method==='DELETE'),false);
 // A note that was an update keeps its old photos in the root: no "노트 첨부" folder, or the photo's parent is the root → read in the root as before.
 for(const options of [{noteKind:true,noNoteFolder:true,sourceMetadata:{parents:['folder']}},{noteKind:true,sourceMetadata:{parents:['folder']}}]){
  const m=ocrHarness(options),got=await(await m.request()).json();assert.equal(got.ok,true);assert.equal(m.note.attachments[0].ocr.text,'인식 글');
 }
 // Neither folder (e.g. moved elsewhere in Drive): refused by the private-parent check, nothing written.
 const lost=ocrHarness({noteKind:true,sourceMetadata:{parents:['elsewhere']}});assert.equal((await lost.request()).status,409);assert.equal(lost.calls.writes.length,0);
 // A basket update keeps reading in the root folder (no child-folder lookup).
 const b=ocrHarness();assert.equal((await(await b.request()).json()).ok,true);assert.equal(b.calls.childLookups,undefined);
});

// S71-49 NOTE-보드사진: 보드에 넣은 사진은 맨 위 앱 폴더 안 '보드 사진'에 있다. OCR은 '노트 첨부'에 없을 때만 그 폴더를 찾고(만들지 않음), 거기서 읽는다.
test('board photo: OCR reads a note photo inside "보드 사진" of the top app folder, never creates it',async()=>{
 const h=ocrHarness({noteKind:true,appRoot:true,sourceMetadata:{parents:['boardpics']}}),got=await(await h.request()).json();
 assert.equal(got.ok,true);assert.equal(h.note.attachments[0].ocr.text,'인식 글');assert.equal(h.calls.boardLookups,1);
 assert.equal(h.calls.drive.some(c=>c.method==='POST'&&c.url.pathname==='/drive/v3/files'),false,'no folder is created');
 // A photo found in "노트 첨부" never looks for the board folder.
 const n=ocrHarness({noteKind:true,appRoot:true});assert.equal((await(await n.request()).json()).ok,true);assert.equal(n.calls.boardLookups,undefined);
 // No top app folder known: the board folder is not looked up; a photo elsewhere is still refused.
 const lost=ocrHarness({noteKind:true,sourceMetadata:{parents:['boardpics']}});assert.equal((await lost.request()).status,409);assert.equal(lost.calls.writes.length,0);assert.equal(lost.calls.boardLookups,undefined);
});
