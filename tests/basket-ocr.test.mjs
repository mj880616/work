import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const url = new URL('../app/basket-ocr.js', import.meta.url);
// Missing-feature adapter lets RED reach behavioral assertions before the new module exists.
const absent = () => ({state: Object.freeze({enabled:false,busy:false,snapshot:null,capabilities:null,outcome:null}),
  ...Object.fromEntries(['capabilities','status','read','reconcile','cleanup'].map(k => [k, async () => ({ok:false,code:'NOT_IMPLEMENTED'})]))});
const {createBasketOcr = absent, BASKET_OCR_ENABLED} = existsSync(url) ? await import(url) : {};
const note = '10000000-0000-4000-8000-000000000001';
const attempt = '20000000-0000-4000-8000-000000000002';
const oldAttempt = '30000000-0000-4000-8000-000000000003';
const stamp = '2026-10-13T12:34:56.123456+00:00';
const nextStamp = '2026-10-13T12:35:56.654321+00:00';
const cap = (patch={}) => ({ok:true,protocol_version:1,db:'supported',supported_mime_types:['image/jpeg','image/png'],limits:{characters:16384,utf8_bytes:65536},...patch});
const file = (patch={}) => ({drive_file_id:'original',file_name:'photo.jpg',mime_type:'image/jpeg',size_bytes:4,...patch});
const ocr = (patch={}) => ({state:'reading',original_file_id:'original',attempt_id:attempt,cleanup_state:'created',temp_document_id:'temp',text:'retained',...patch});
const snapshot = (attachments=[file()],updated_at=stamp) => ({ok:true,note_id:note,updated_at,attachments});
const success = (attachment=file({ocr:ocr({state:'done',cleanup_state:'deleted',text:'new text'})}),patch={}) => ({ok:true,note_id:note,updated_at:nextStamp,attachment,ocr_saved:['done','empty'].includes(attachment.ocr?.state),text_changed:true,cleanup_state:attachment.ocr?.cleanup_state,...patch});
const failure = (patch={}) => ({ok:false,code:'OCR_UNSUPPORTED',retryable:false,result_unknown:false,ocr_saved:false,text_changed:false,...patch});
const response = (value,status=200) => Object.assign(Response.json(value,{status}),{testValue:value,testRole:Object.hasOwn(value,'attachments')?'status':Object.hasOwn(value,'protocol_version')?'cap':'write'});
const deferred = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness({enabled=true,waitMs=1000,isCurrent=()=>true}={}) {
  let owner='owner',workspace='workspace',epoch=1,sessionOwner='owner',ensures=0,reads=0;
  const calls=[],changes=[],queue=[];let latest=snapshot();
  const rt={config:{url:'https://example.invalid',key:'publishable'},context:{read:()=>({user:{id:owner},workspace:{id:workspace}})},session:{epoch:()=>epoch,ensure:async()=>{ensures++;return true;},read:()=>{reads++;return {access_token:'fake-owner-token',user:{id:sessionOwner}};},refresh:()=>assert.fail('no 401 refresh'),},api:()=>assert.fail('no generic API')};
  const controller=createBasketOcr({rt,enabled,waitMs,isCurrent,onChange:s=>changes.push(s),fetcher:async(...args)=>{calls.push(args);const value=args[0].includes('action=ocr-status') && (!queue.length || queue[0]?.testRole==='write') ? response(latest) : queue.shift();if(value?.testRole==='status')latest=value.testValue;if(args[1].method==='POST'&&value?.testValue?.attachment)latest=snapshot([value.testValue.attachment],value.testValue.updated_at??latest.updated_at);if(value instanceof Error)throw value;return typeof value==='function'?value(...args):value;}});
  return {controller,calls,changes,queue,rt,counts:()=>({ensures,reads}),scope:patch=>{owner=patch.owner??owner;workspace=patch.workspace??workspace;epoch=patch.epoch??epoch;sessionOwner=patch.sessionOwner??owner;}};
}
async function prepare(h,attachments=[file()],updated_at=stamp){h.queue.push(response(cap()),response(snapshot(attachments,updated_at)));assert.equal((await h.controller.capabilities()).ok,true);assert.equal((await h.controller.status(note)).ok,true);}
const postCalls = h => h.calls.filter(([,o])=>o.method==='POST');
test('source-controlled flag is false and default-off returns before every auth or endpoint touch',async()=>{
  assert.equal(BASKET_OCR_ENABLED,false);
  const h=harness({enabled:undefined});
  // Explicitly omit the optional enabled parameter to exercise the actual default.
  const c=createBasketOcr({rt:h.rt,fetcher:()=>assert.fail('disabled fetch')});
  for(const [method,args] of [['capabilities',[]],['status',[note]],['read',[note,'original']],['reconcile',[note,'original']],['cleanup',[note,'original']]])assert.equal((await c[method](...args)).code,'OCR_DISABLED');
  assert.deepEqual(h.counts(),{ensures:0,reads:0});assert.equal(c.state.enabled,false);
});
test('native owner auth, exact protocol and status are immutable snapshots',async()=>{
  const h=harness();await prepare(h);
  assert.equal(h.calls[0][0],'https://example.invalid/functions/v1/basket-files?action=ocr-capabilities');
  assert.equal(h.calls[1][0],`https://example.invalid/functions/v1/basket-files?action=ocr-status&note_id=${note}`);
  assert.deepEqual(h.calls[0][1].headers,{apikey:'publishable',Authorization:'Bearer fake-owner-token'});
  assert.equal(h.controller.state.snapshot.updated_at,stamp);assert.ok(Object.isFrozen(h.controller.state.snapshot.attachments[0]));
  assert.throws(()=>{h.controller.state.snapshot.attachments[0].file_name='changed';},TypeError);
});
for(const bad of [cap({protocol_version:2}),cap({db:'unsupported'}),cap({limits:{characters:16385,utf8_bytes:65536}}),cap({limits:{characters:16384,utf8_bytes:65537}}),cap({supported_mime_types:['image/webp']}),cap({supported_mime_types:['image/jpeg','image/jpeg']}),cap({supported_mime_types:[]}),cap({extra:'provider secret'}),cap({limits:{characters:16384,utf8_bytes:65536,extra:1}})])test(`unusable capability does not enable execution ${JSON.stringify(bad)}`,async()=>{
  const h=harness();h.queue.push(response(bad));assert.equal((await h.controller.capabilities()).ok,false);
  assert.equal((await h.controller.read(note,'original')).ok,false);assert.equal(postCalls(h).length,0);
});
for(const [label,bad] of [['wrong note',{...snapshot(),note_id:attempt}],['timestamp',{...snapshot(),updated_at:'x'}],['too long timestamp',{...snapshot(),updated_at:stamp+' '.repeat(64)}],['duplicate',snapshot([file(),file()])],['21 files',snapshot(Array.from({length:21},(_,i)=>file({drive_file_id:`f${i}`})))],['null OCR',snapshot([file({ocr:null})])],['extra file',snapshot([file({private:'SECRET'})])],['size',snapshot([file({size_bytes:104857601})])],['fraction',snapshot([file({size_bytes:1.5})])],['name',snapshot([file({file_name:'😀'.repeat(256)})])],['source',snapshot([file({ocr:ocr({original_file_id:'wrong'})})])],['mime',snapshot([file({mime_type:'a/b/c'})])],['extra envelope',{...snapshot(),raw_text:'SECRET'}]])test(`malformed status fails closed: ${label}`,async()=>{
  const h=harness();h.queue.push(response(bad));assert.equal((await h.controller.status(note)).ok,false);assert.equal(h.controller.state.snapshot,null);
});
test('read sends the complete stored attachment and unnormalized microsecond CAS only',async()=>{
  const source=file({ocr:ocr({state:'failed',attempt_id:oldAttempt,cleanup_state:'deleted',error_code:'OCR_TEXT_INVALID'})});
  const h=harness();await prepare(h,[source]);h.queue.push(response(success()));
  const result=await h.controller.read(note,'original');assert.equal(result.ok,true);
  assert.deepEqual(JSON.parse(postCalls(h)[0][1].body),{action:'ocr-read',note_id:note,note_updated_at:stamp,expected_attachment:source});
  assert.equal(postCalls(h)[0][1].signal,undefined);assert.equal(result.requestStartUpdatedAt,stamp);assert.equal(h.controller.state.outcome.requestStartUpdatedAt,stamp);
  assert.equal(h.controller.state.snapshot.updated_at,nextStamp);assert.equal(h.controller.state.outcome.text,'new text');
  assert.equal(h.calls[2][0],`https://example.invalid/functions/v1/basket-files?action=ocr-status&note_id=${note}`);
});
test('retained text and saved recognition remain independent of deletion failure',async()=>{
  const attachment=file({ocr:ocr({state:'done',cleanup_state:'delete_failed',text:'committed',cleanup_error_code:'OCR_DELETE_FAILED'})});
  const h=harness();await prepare(h);h.queue.push(response(failure({code:'OCR_DELETE_FAILED',note_id:note,updated_at:nextStamp,attachment,cleanup_state:'delete_failed',ocr_saved:true,text_changed:true,attempt_id:attempt,temp_document_id:'temp'}),502));
  const result=await h.controller.read(note,'original');assert.equal(result.ok,false);assert.equal(result.status,502);assert.equal(result.ocr_saved,true);assert.equal(result.text,'committed');assert.equal(result.cleanup_state,'delete_failed');assert.equal(result.code,'OCR_DELETE_FAILED');assert.equal(result.result_unknown,false);
});
test('early fixed-field error accepts omitted attachment and cleanup, without provider text',async()=>{
  const h=harness();await prepare(h);h.queue.push(response(failure(),409));
  const result=await h.controller.read(note,'original');assert.equal(result.code,'OCR_UNSUPPORTED');assert.equal(result.status,409);assert.equal(result.result_unknown,false);assert.equal(result.cleanup_state,undefined);
});
for(const [label,value] of [['outer auth',()=>response({error:'PRIVATE provider body',code:'session_required'},401)],['invalid flags',()=>response({...success(),ocr_saved:false})],['foreign attachment',()=>response(success(file({drive_file_id:'foreign',ocr:ocr({original_file_id:'foreign'})})))],['extra error',()=>response(failure({message:'SECRET'}),409)],['bad optional attempt',()=>response(failure({attempt_id:'bad'}),409)],['bad optional timestamp',()=>response(failure({updated_at:4}),409)],['cleanup mismatch',()=>response({...success(),cleanup_state:'created'})],['nonboolean',()=>response(failure({text_changed:1}),409)],['network',()=>{throw Error('SECRET');}],['malformed',()=>new Response('{bad')],['missing',()=>new Response(null)],['fatal UTF8',()=>new Response(new Uint8Array([0xc0,0xaf]))]])test(`dispatched ${label} is unknown and never POST-replayed`,async()=>{
  const h=harness();await prepare(h);h.queue.push(response(snapshot(h.controller.state.snapshot.attachments,h.controller.state.snapshot.updated_at)),value);const result=await h.controller.read(note,'original');
  assert.equal(result.result_unknown,true);assert.equal(postCalls(h).length,1);assert.doesNotMatch(JSON.stringify(h.controller.state),/SECRET|PRIVATE/);
  assert.equal((await h.controller.read(note,'original')).code,'OCR_ATTEMPT_UNRESOLVED');assert.equal(postCalls(h).length,1);
  if(label==='outer auth')assert.equal(result.status,401);
});
test('negative status after a lost read cannot prove absence or authorize fresh import',async()=>{
  const h=harness();await prepare(h);h.queue.push(response(snapshot()),Error('lost'));await h.controller.read(note,'original');
  h.queue.push(response(snapshot()));await h.controller.status(note);
  assert.equal(h.controller.state.outcome.result_unknown,true);assert.equal((await h.controller.read(note,'original')).code,'OCR_ATTEMPT_UNRESOLVED');assert.equal(postCalls(h).length,1);
  assert.equal((await h.controller.reconcile(note,'original')).code,'OCR_ATTEMPT_UNRESOLVED');
});
test('reconcile and cleanup use the same persisted attempt and never arbitrary temp IDs',async()=>{
  const source=file({ocr:ocr()});const h=harness();await prepare(h,[source]);
  h.queue.push(response(success(file({ocr:ocr({state:'done',cleanup_state:'delete_failed'})}),{text_changed:false})));
  await h.controller.reconcile(note,'original');
  const current=h.controller.state.snapshot.attachments[0];h.queue.push(response(success(file({ocr:ocr({state:'done',cleanup_state:'deleted'})}),{text_changed:false})));
  await h.controller.cleanup(note,'original');
  assert.deepEqual(JSON.parse(postCalls(h)[0][1].body),{action:'ocr-reconcile',note_id:note,note_updated_at:stamp,expected_attachment:source,attempt_id:attempt});
  assert.deepEqual(JSON.parse(postCalls(h)[1][1].body),{action:'ocr-cleanup',note_id:note,note_updated_at:nextStamp,expected_attachment:current,attempt_id:attempt});
  assert.equal((await h.controller.cleanup(note,'original',{temp_document_id:'victim'})).ok,false);assert.equal(postCalls(h).length,2);
});
test('changed-note reconciliation needs explicit current raw timestamp; source conflict cannot be waived',async()=>{
  const source=file({ocr:ocr()});const h=harness();await prepare(h,[source]);
  h.queue.push(response(failure({code:'NOTE_CHANGED',note_id:note,updated_at:stamp,attachment:source,cleanup_state:'created',attempt_id:attempt}),409));await h.controller.reconcile(note,'original');
  h.queue.push(response(snapshot([source],nextStamp)));await h.controller.status(note);
  assert.equal((await h.controller.reconcile(note,'original',{confirmCurrentNoteVersion:stamp})).ok,false);assert.equal(postCalls(h).length,1);
  h.queue.push(response(failure({code:'OCR_SOURCE_CHANGED',note_id:note,updated_at:nextStamp,attachment:source,cleanup_state:'created',attempt_id:attempt}),409));
  await h.controller.reconcile(note,'original',{confirmCurrentNoteVersion:nextStamp});
  assert.equal(JSON.parse(postCalls(h)[1][1].body).confirm_current_note_version,nextStamp);
  assert.equal((await h.controller.reconcile(note,'original',{confirmCurrentNoteVersion:nextStamp})).code,'OCR_SOURCE_CHANGED');assert.equal(postCalls(h).length,2);
});
for(const source of [file({mime_type:'application/pdf'}),file({ocr:ocr({cleanup_state:'create_pending',temp_document_id:undefined})}),file({ocr:ocr({state:'failed',cleanup_state:'delete_failed'})}),file({ocr:ocr()})])test(`new read forbidden for unresolved or unsupported source ${JSON.stringify(source)}`,async()=>{
  // undefined is omitted exactly as stored JSON would omit it.
  const h=harness();await prepare(h,[JSON.parse(JSON.stringify(source))]);assert.equal((await h.controller.read(note,'original')).ok,false);assert.equal(postCalls(h).length,0);
});
test('owner/session/workspace changes discard late results and cannot release a live write lock',async()=>{
  const h=harness();await prepare(h);const late=deferred();h.queue.push(response(snapshot()),()=>late.promise);const pending=h.controller.read(note,'original');
  await new Promise(resolve=>setImmediate(resolve));h.scope({owner:'other',epoch:2,workspace:'other-workspace'});
  assert.equal((await h.controller.read(note,'original')).code,'OCR_BUSY');late.resolve(response(success()));const result=await pending;
  assert.equal(result.code,'OCR_STALE');assert.equal(h.changes.filter(s=>s.outcome?.ok).length,0);assert.equal(h.controller.state.snapshot,null);
});
test('context and authenticated owner must agree before dispatch',async()=>{
  const h=harness();h.scope({sessionOwner:'foreign'});assert.equal((await h.controller.capabilities()).code,'SESSION_REQUIRED');assert.equal(h.calls.length,0);
});
test('navigation guard invalidation during ensure prevents endpoint dispatch',async()=>{
  let current=true;const h=harness({isCurrent:()=>current});h.rt.session.ensure=async()=>{current=false;return true;};assert.equal((await h.controller.capabilities()).code,'OCR_STALE');assert.equal(h.calls.length,0);
});
test('deadline covers a never-ending body read and cancels/releases it without aborting POST',async()=>{
  let cancelled=0;const body=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled++;}});const h=harness({waitMs:15});await prepare(h);h.queue.push(response(snapshot()),new Response(body));
  const start=Date.now(),result=await h.controller.read(note,'original');assert.equal(result.result_unknown,true);assert.equal(result.code,'OCR_RESULT_UNKNOWN');assert.ok(Date.now()-start<500);assert.equal(cancelled,1);assert.equal(body.locked,false);assert.equal(postCalls(h).length,1);
});
test('late timed-out fetch cannot clear a newer flight or overwrite another note record',async()=>{
  const h=harness({waitMs:20});await prepare(h);const late=deferred();h.queue.push(response(snapshot()),()=>late.promise);await h.controller.read(note,'original');
  const statusLate=deferred();h.queue.push(()=>statusLate.promise);const second=h.controller.status(note);await new Promise(resolve=>setImmediate(resolve));
  late.resolve(response(success()));await new Promise(resolve=>setImmediate(resolve));assert.equal(h.controller.state.busy,true);assert.equal((await h.controller.read(note,'original')).code,'OCR_BUSY');
  statusLate.resolve(response(snapshot()));await second;assert.equal(h.controller.state.outcome.result_unknown,true);assert.equal(postCalls(h).length,1);
});
test('full valid 20-attachment supplementary escaped status fits 4MiB without truncation',async()=>{
  // 12 bytes/codepoint for surrogate escapes: 20*16384*12 plus bounded CHECK-valid metadata.
  const files=Array.from({length:20},(_,i)=>file({drive_file_id:`${i}`.padEnd(255,'x'),file_name:'😀'.repeat(255),size_bytes:104857600,ocr:ocr({original_file_id:`${i}`.padEnd(255,'x'),state:'done',text:'😀'.repeat(16384),temp_document_id:`temp${i}`.padEnd(255,'x'),cleanup_state:'delete_failed',error_code:'E'.repeat(64),cleanup_error_code:'C'.repeat(64)})}));
  const json=JSON.stringify(snapshot(files)).replace(/[\uD800-\uDFFF]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  assert.ok(Buffer.byteLength(json)>3900000);assert.ok(Buffer.byteLength(json)<=4078476);assert.ok(Buffer.byteLength(json)<4194304);
  const h=harness();h.queue.push(new Response(json));assert.equal((await h.controller.status(note)).ok,true);assert.equal(h.controller.state.snapshot.attachments[19].ocr.text,'😀'.repeat(16384));
});
for(const extra of [0,1])test(`decoded stream ${extra?'one over':'exact'} 4MiB cap`,async()=>{
  let cancelled=0;const json=JSON.stringify(snapshot());const bytes=Buffer.from(json+' '.repeat(4194304-Buffer.byteLength(json)+extra));
  let offset=0;const body=new ReadableStream({pull(c){if(offset===bytes.length){c.close();return;}c.enqueue(bytes.subarray(offset,offset+64000));offset=Math.min(offset+64000,bytes.length);},cancel(){cancelled++;}},{highWaterMark:0});
  const h=harness();h.queue.push(new Response(body));const result=await h.controller.status(note);assert.equal(result.ok,extra===0);assert.equal(body.locked,false);if(extra)assert.equal(cancelled,1);
});
test('maximum bounded read request preserves supplementary OCR rather than truncating',async()=>{
  const source=file({drive_file_id:'s'.repeat(255),file_name:'😀'.repeat(255),size_bytes:104857600,ocr:ocr({original_file_id:'s'.repeat(255),state:'done',text:'😀'.repeat(16384),cleanup_state:'deleted',temp_document_id:'t'.repeat(255)})});
  const h=harness();await prepare(h,[source]);h.queue.push(response(failure(),409));await h.controller.read(note,source.drive_file_id);
  const body=postCalls(h)[0][1].body;assert.ok(Buffer.byteLength(body)<=266240);assert.deepEqual(JSON.parse(body).expected_attachment,source);
});

test('write target note is explicit and fresh status prevents using another note snapshot',async()=>{
  const h=harness();await prepare(h);const other='40000000-0000-4000-8000-000000000004';
  h.queue.push(response({...snapshot(),note_id:other,updated_at:nextStamp}),response({...success(),note_id:other}));
  assert.equal((await h.controller.read(other,'original')).ok,true);
  assert.deepEqual(JSON.parse(postCalls(h)[0][1].body),{action:'ocr-read',note_id:other,note_updated_at:nextStamp,expected_attachment:file()});
  assert.equal(h.calls[2][0],`https://example.invalid/functions/v1/basket-files?action=ocr-status&note_id=${other}`);
});
test('fresh write status rejecting foreign note cannot send a POST',async()=>{
  const h=harness();await prepare(h);h.queue.push(response({...snapshot(),note_id:attempt}));
  assert.equal((await h.controller.read(note,'original')).ok,false);assert.equal(postCalls(h).length,0);
});
test('late manual status for invalidated note/view cannot overwrite current scope snapshot',async()=>{
  let current=true;const h=harness({isCurrent:()=>current});await prepare(h);const late=deferred();h.queue.push(()=>late.promise);
  const pending=h.controller.status(note);await new Promise(resolve=>setImmediate(resolve));current=false;late.resolve(response(snapshot([file({file_name:'late private'})])));
  assert.equal((await pending).code,'OCR_STALE');assert.doesNotMatch(JSON.stringify(h.changes),/late private/);
});
test('fresh CAS status invalidated during a write is stale and never dispatches POST',async()=>{
  let current=true;const h=harness({isCurrent:()=>current});await prepare(h);const late=deferred();h.queue.push(()=>late.promise);
  const pending=h.controller.read(note,'original');await new Promise(resolve=>setImmediate(resolve));current=false;late.resolve(response(snapshot()));
  assert.equal((await pending).code,'OCR_STALE');assert.equal(postCalls(h).length,0);
});
test('a known note conflict requires an explicit version confirmation before any repeated reconcile',async()=>{
  const source=file({ocr:ocr()});const h=harness();await prepare(h,[source]);
  h.queue.push(response(failure({code:'NOTE_CHANGED',note_id:note,updated_at:stamp,attachment:source,cleanup_state:'created',attempt_id:attempt}),409));
  await h.controller.reconcile(note,'original');
  h.queue.push(response(snapshot([source],nextStamp)));await h.controller.status(note);
  assert.equal((await h.controller.reconcile(note,'original')).code,'NOTE_CHANGED');assert.equal(postCalls(h).length,1);
});
test('write response text_changed is checked against the retained source text',async()=>{
  const h=harness();await prepare(h,[file({ocr:ocr({state:'failed',cleanup_state:'deleted'})})]);
  h.queue.push(response(success(file({ocr:ocr({state:'done',text:'retained',cleanup_state:'deleted'})}),{text_changed:true})));
  assert.equal((await h.controller.read(note,'original')).result_unknown,true);
});
test('error optional same-attempt fields cannot identify another persisted operation',async()=>{
  const h=harness();await prepare(h,[file({ocr:ocr()})]);h.queue.push(response(failure({attempt_id:oldAttempt}),409));
  assert.equal((await h.controller.reconcile(note,'original')).result_unknown,true);
});
test('a resolved same attempt unblocks a lost result only after validated reconcile success',async()=>{
  const h=harness();await prepare(h);h.queue.push(response(snapshot()),Error('lost'));await h.controller.read(note,'original');
  const pending=file({ocr:ocr({cleanup_state:'create_unknown',temp_document_id:undefined})});
  h.queue.push(response(snapshot([JSON.parse(JSON.stringify(pending))])));await h.controller.status(note);
  assert.equal((await h.controller.read(note,'original')).code,'OCR_ATTEMPT_UNRESOLVED');
  h.queue.push(response(success()));assert.equal((await h.controller.reconcile(note,'original')).ok,true);
  h.queue.push(response(success(undefined,{text_changed:false}),200));assert.equal((await h.controller.read(note,'original')).ok,true);assert.equal(postCalls(h).length,3);
});
test('unknown marker remains owner-scoped after switching notes and back',async()=>{
  const h=harness();await prepare(h);h.queue.push(response(snapshot()),Error('lost'));await h.controller.read(note,'original');
  const other='40000000-0000-4000-8000-000000000004';h.queue.push(response({...snapshot(),note_id:other}));await h.controller.status(other);
  h.queue.push(response(snapshot()));await h.controller.status(note);
  assert.equal((await h.controller.read(note,'original')).code,'OCR_ATTEMPT_UNRESOLVED');assert.equal(postCalls(h).length,1);
});
test('a valid note conflict may return another writer’s retained text without claiming this request changed text',async()=>{
  const h=harness();await prepare(h,[file({ocr:ocr({state:'done',cleanup_state:'deleted',text:'prior'})})]);
  const changed=file({ocr:ocr({state:'done',cleanup_state:'deleted',text:'external'})});
  h.queue.push(response(failure({code:'NOTE_CHANGED',note_id:note,updated_at:nextStamp,attachment:changed,cleanup_state:'deleted',ocr_saved:true}),409));
  const result=await h.controller.read(note,'original');assert.equal(result.code,'NOTE_CHANGED');assert.equal(result.result_unknown,false);assert.equal(result.text_changed,false);assert.equal(result.text,'external');assert.equal(result.requestStartUpdatedAt,stamp);
});
for(const patch of [{owner:'other'},{workspace:'other'},{epoch:2}])test(`independent scope component rejects late reply ${JSON.stringify(patch)}`,async()=>{
  const h=harness();await prepare(h);const late=deferred();h.queue.push(response(snapshot()),()=>late.promise);const pending=h.controller.read(note,'original');
  await new Promise(resolve=>setImmediate(resolve));h.scope(patch);late.resolve(response(success()));assert.equal((await pending).code,'OCR_STALE');assert.equal(h.controller.state.snapshot,null);
});
for(const [label,patch] of [['codepoints',{ocr:ocr({state:'done',text:'😀'.repeat(16385)})}],['NUL',{ocr:ocr({text:'\0'})}],['original id',{drive_file_id:'a'.repeat(256)}],['size zero',{size_bytes:0}]])test(`stored attachment one-over/invalid boundary refuses execution: ${label}`,async()=>{
  const h=harness();h.queue.push(response(snapshot([file(patch)])));const result=await h.controller.status(note);assert.equal(result.code,'OCR_RESPONSE_INVALID');
});
test('capability subset enables only its supported MIME and never guesses JPEG support',async()=>{
  const h=harness();h.queue.push(response(cap({supported_mime_types:['image/png']})));assert.equal((await h.controller.capabilities()).ok,true);
  h.queue.push(response(snapshot()));assert.equal((await h.controller.read(note,'original')).code,'OCR_SOURCE_UNSUPPORTED');assert.equal(postCalls(h).length,0);
});
test('a cleanup failure cannot erase an earlier same-attempt source conflict',async()=>{
  const source=file({ocr:ocr()});const h=harness();await prepare(h,[source]);
  h.queue.push(response(failure({code:'OCR_SOURCE_CHANGED',note_id:note,updated_at:stamp,attachment:source,cleanup_state:'created',attempt_id:attempt}),409));await h.controller.reconcile(note,'original');
  h.queue.push(response(failure({code:'OCR_DELETE_FAILED',note_id:note,updated_at:stamp,attachment:source,cleanup_state:'created',attempt_id:attempt}),502));await h.controller.cleanup(note,'original');
  assert.equal((await h.controller.reconcile(note,'original',{confirmCurrentNoteVersion:stamp})).code,'OCR_SOURCE_CHANGED');assert.equal(postCalls(h).length,2);
});
for(const method of ['reconcile','cleanup'])test(`${method} cannot switch from selected attempt A to fresh attempt B at the same raw timestamp`,async()=>{
  const h=harness();await prepare(h,[file({ocr:ocr()})]);
  h.queue.push(response(snapshot([file({ocr:ocr({attempt_id:oldAttempt,temp_document_id:'other-temp'})})])));
  const result=await h.controller[method](note,'original');assert.equal(result.code,'OCR_ATTEMPT_UNRESOLVED');assert.equal(postCalls(h).length,0);
  assert.equal(h.controller.state.snapshot.attachments[0].ocr.attempt_id,oldAttempt);
});
for(const method of ['reconcile','cleanup'])test(`${method} requires an explicit prior validated status for its exact note and persisted attempt`,async()=>{
  const h=harness();await prepare(h,[file({ocr:ocr()})]);const other='40000000-0000-4000-8000-000000000004';
  h.queue.push(response({...snapshot([file({ocr:ocr()})]),note_id:other}));
  assert.equal((await h.controller[method](other,'original')).code,'OCR_ATTEMPT_UNRESOLVED');assert.equal(postCalls(h).length,0);assert.equal(h.calls.length,2);
});
