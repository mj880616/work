import test from 'node:test';
import assert from 'node:assert/strict';
import {deleteDocument,luDeleteErrorMessage} from '../app/document-delete.js';

const doc={id:'doc-1',file_name:'회의자료.pdf',project_id:'project-1',meeting_id:'meeting-1'};
const unknown='삭제 결과를 확인하지 못했습니다. 다시 삭제하지 말고 자료실 목록 또는 회의자료를 다시 열어 확인해 주세요. Drive 원본 상태도 직접 확인해 주세요.';
const auth='로그인 세션을 확인하지 못했습니다. 다시 로그인한 뒤 자료 목록과 원본 상태를 먼저 확인해 주세요.';
const driveAuth='Google Drive 연결을 확인해 주세요. 다시 삭제하기 전에 자료 목록과 원본 상태를 먼저 확인해 주세요.';
const legacy='자료 등록을 삭제했습니다. Drive 파일 처리 결과는 확인하지 못했습니다. 원본 상태를 직접 확인해 주세요.';
const event={type:'kptu:documents-changed',detail:{project_id:doc.project_id,meeting_id:doc.meeting_id}};
function harness(t,answers=[]){
  const originals={confirm:globalThis.confirm,alert:globalThis.alert,window:globalThis.window,location:globalThis.location};
  const confirms=[],alerts=[],events=[],timeline=[];
  globalThis.confirm=message=>{confirms.push(message);timeline.push('confirm');return answers.shift()};
  globalThis.alert=message=>{alerts.push(message);timeline.push('alert')};
  globalThis.window={dispatchEvent:event=>{events.push({type:event.type,detail:event.detail});timeline.push('event')}};
  globalThis.location={href:''};
  t.after(()=>Object.assign(globalThis,originals));
  return {confirms,alerts,events,timeline};
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}

test('shared deletion cancellation sends no request or refresh and gives conditional Drive guidance',async t=>{
  const h=harness(t,[false]),calls=[];
  assert.equal(await deleteDocument(doc,{api:async(...args)=>calls.push(args)}),false);
  assert.deepEqual(calls,[]);assert.deepEqual(h.events,[]);assert.deepEqual(h.alerts,[]);
  assert.equal(h.confirms[0],'“회의자료.pdf” 자료 등록을 삭제할까요?\n파일도 Drive 휴지통으로 이동할 수 있습니다. 삭제 결과에서 원본 보존 여부를 확인해 주세요.');
  assert.doesNotMatch(h.confirms[0],/30일|\nDrive 휴지통으로 이동합니다/);
});

test('shared deletion sends one existing request without refresh/replay and signals both document links',async t=>{
  const h=harness(t,[true]),calls=[];
  assert.equal(await deleteDocument(doc,{expectedSessionEpoch:17,api:async(...args)=>{calls.push(args);return {ok:true}}}),true);
  assert.deepEqual(calls,[['/functions/v1/document-actions',{method:'POST',body:{action:'delete',document_id:doc.id},refreshSession:false,expectedSessionEpoch:17}]]);
  assert.deepEqual(h.alerts,[legacy]);assert.deepEqual(h.events,[event]);
  assert.deepEqual(h.timeline,['confirm','alert','event']);
});

const successes=[
  [{ok:true,drive_result:'preserved',drive_preserved:true,reason:'note_reference'},'자료 등록을 삭제했습니다. 바구니 원본 파일은 Drive에 보존했습니다.'],
  [{ok:true,drive_result:'preserved',drive_preserved:true,reason:'private_basket_original'},'자료 등록을 삭제했습니다. 바구니 원본 파일은 Drive에 보존했습니다.'],
  [{ok:true,drive_result:'trashed',drive_preserved:false,reason:'ordinary_library'},'자료 등록을 삭제하고 파일을 Drive 휴지통으로 이동했습니다. 파일은 Drive 휴지통에서 확인해 주세요.'],
  [{ok:true,drive_result:'already_trashed',drive_preserved:false,reason:'ordinary_library'},'자료 등록을 삭제했습니다. 파일은 이미 Drive 휴지통에 있었습니다.'],
  [{ok:true,drive_result:'missing',drive_preserved:false,reason:'ordinary_library'},'자료 등록을 삭제했습니다. 연결된 Drive 파일은 찾을 수 없었습니다.'],
  [{ok:true,drive_result:'no_file',drive_preserved:false,reason:'ordinary_library'},'자료 등록을 삭제했습니다. 이 자료에 연결된 Drive 파일 ID는 없었습니다.'],
  [{ok:true},legacy],
  [{ok:true,extension:'ignored'},legacy]
];
for(const [data,message] of successes)test(`confirmed helper result: ${data.reason||'legacy'}/${data.drive_result||data.extension||'only ok'}`,async t=>{
  const h=harness(t,[true]);
  assert.equal(await deleteDocument(doc,{api:async()=>data}),true);
  assert.deepEqual(h.alerts,[message]);assert.deepEqual(h.events,[event]);
  assert.deepEqual(h.timeline,['confirm','alert','event']);
});

const invalidResults=[
  null,undefined,'ok','{"ok":true}',true,[],[{ok:true}],{}, {ok:false},{ok:1},{ok:'true'},
  {error:'server refused'},{ok:true,error:'server refused'},
  {ok:true,drive_result:'preserved'}, {ok:true,drive_preserved:true}, {ok:true,reason:'note_reference'},
  {ok:true,drive_result:undefined}, {ok:true,drive_result:null,drive_preserved:false,reason:'ordinary_library'},
  {ok:true,drive_result:'preserved',drive_preserved:false,reason:'note_reference'},
  {ok:true,drive_result:'preserved',drive_preserved:true,reason:'ordinary_library'},
  {ok:true,drive_result:'trashed',drive_preserved:true,reason:'ordinary_library'},
  {ok:true,drive_result:'trashed',drive_preserved:false,reason:'note_reference'},
  {ok:true,drive_result:'trashed',drive_preserved:'false',reason:'ordinary_library'},
  {ok:true,drive_result:'unknown',drive_preserved:false,reason:'ordinary_library'},
  {ok:true,drive_result:'partial',drive_preserved:false,reason:'ordinary_library'},
  {ok:true,drive_result:'unchanged',drive_preserved:false,reason:'ordinary_library'},
  {ok:true,drive_result:'no_file',drive_preserved:false,reason:'unrecognized'},
  {ok:true,code:'RESULT_UNKNOWN'},
  {ok:true,drive_result:'preserved',drive_preserved:true,reason:'note_reference',token_delete_result:'confirmed',document_delete_result:'unknown'},
  {ok:true,drive_result:'trashed',drive_preserved:false,reason:'ordinary_library',document_delete_result:'not_started'}
];
for(const [index,data] of invalidResults.entries())test(`unconfirmed helper payload ${index} retains boolean false and emits no refresh`,async t=>{
  const h=harness(t,[true]);let calls=0;
  assert.equal(await deleteDocument(doc,{api:async()=>{calls++;return data}}),false);
  assert.equal(calls,1);assert.deepEqual(h.alerts,[unknown]);assert.deepEqual(h.events,[]);
});

test('native confirmation treats malicious file names as literal text',async t=>{
  const h=harness(t,[false]);const name='<img src=x onerror="globalThis.hacked=true"> & </script>';
  assert.equal(await deleteDocument({...doc,file_name:name},{api:async()=>assert.fail('cancelled delete sent')}),false);
  assert.equal(h.confirms[0],`“${name}” 자료 등록을 삭제할까요?\n파일도 Drive 휴지통으로 이동할 수 있습니다. 삭제 결과에서 원본 보존 여부를 확인해 주세요.`);
  assert.equal(globalThis.hacked,undefined);assert.deepEqual(h.events,[]);
});

test('shared error guidance uses check-first session, revoked Drive and generic messages',()=>{
  assert.equal(luDeleteErrorMessage({status:401}),auth);
  assert.equal(luDeleteErrorMessage({code:'session_required'}),auth);
  assert.equal(luDeleteErrorMessage({message:'invalid_grant'}),driveAuth);
  assert.equal(luDeleteErrorMessage({status:424}),driveAuth);
  assert.equal(luDeleteErrorMessage({message:'permission denied'}),unknown);
});
for(const e of [
  {status:400,code:'http_400',message:'자료 등록 삭제 결과를 확인하지 못했습니다.'},
  {code:'network_error',message:'네트워크 연결을 확인한 뒤 다시 시도해 주세요.'},
  {code:'timeout',message:'요청 시간이 초과되었습니다. 다시 시도해 주세요.'},
  {code:'DOCUMENT_CHANGED',drive_result:'trashed',message:'source changed'},
  {code:'BASKET_ORIGIN_UNKNOWN',message:'source unknown'}
])test(`phase-safe thrown failure ${e.code} never certifies Drive/metadata unchanged`,async t=>{
  const h=harness(t,[true]);let calls=0;
  assert.equal(await deleteDocument(doc,{api:async()=>{calls++;throw e}}),false);
  assert.equal(calls,1);assert.deepEqual(h.alerts,[unknown]);assert.deepEqual(h.events,[]);
  assert.equal(luDeleteErrorMessage(e),unknown);
});

for(const e of [{code:'RESULT_UNKNOWN',message:'invalid_grant'}, {status:424,drive_result:'unknown',message:'invalid_grant'}, {code:'RESULT_UNKNOWN',drive_result:'preserved',token_delete_result:'confirmed',document_delete_result:'unknown',message:'invalid_grant'}])test(`explicit unknown takes precedence over reconnect: ${JSON.stringify(e)}`,async t=>{
  const h=harness(t,[true]);let reconnects=0;
  assert.equal(await deleteDocument(doc,{role:'owner',api:async()=>{throw e},maybeReconnect:async()=>{reconnects++;return true}}),false);
  assert.equal(reconnects,0);assert.equal(h.confirms.length,1);assert.deepEqual(h.alerts,[unknown]);assert.deepEqual(h.events,[]);
  assert.equal(luDeleteErrorMessage(e),unknown);
});

test('HTTP success body error retains safe unknown fields rather than using revoked text for recovery',async t=>{
  const h=harness(t,[true]);let reconnects=0;
  assert.equal(await deleteDocument(doc,{api:async()=>({ok:true,error:'invalid_grant',code:'RESULT_UNKNOWN',drive_result:'preserved',document_delete_result:'unknown'}),maybeReconnect:async()=>{reconnects++;return true}}),false);
  assert.equal(reconnects,0);assert.deepEqual(h.alerts,[unknown]);assert.deepEqual(h.events,[]);
});

test('deletion permission is left to the server even for a non-owner UI context',async t=>{
  const h=harness(t,[true]),calls=[];
  assert.equal(await deleteDocument(doc,{role:'member',api:async(...args)=>{calls.push(args);throw new Error('owner required')}}),false);
  assert.equal(calls.length,1);assert.deepEqual(h.events,[]);assert.deepEqual(h.alerts,[unknown]);
});

for(const role of ['owner','admin'])for(const reconnect of [false,true])test(`revoked Drive preserves ${role} reconnect route without replay: ${reconnect}`,async t=>{
  const h=harness(t,[true,reconnect]),calls=[];
  assert.equal(await deleteDocument(doc,{role,api:async(path,options)=>{
    calls.push({path,body:options.body});
    if(path.endsWith('document-actions'))throw new Error('Token has been expired or revoked');
    return {url:'https://example.org/reconnect'};
  }}),false);
  assert.equal(h.confirms.length,2);assert.match(h.confirms[1],/Google Drive 연결이 만료됐습니다/);
  assert.match(h.confirms[1],/재연결 후 자료 목록과 원본 상태를 먼저 확인해 주세요/);
  assert.doesNotMatch(h.confirms[1],/같은 작업을 다시 실행/);
  assert.deepEqual(h.alerts,[driveAuth]);assert.deepEqual(h.events,[]);
  assert.equal(calls.length,reconnect?2:1);
  if(reconnect){assert.deepEqual(calls[1],{path:'/functions/v1/public-policy-drive',body:{action:'drive-start'}});assert.equal(globalThis.location.href,'https://example.org/reconnect')}
});

test('member Drive error cannot enter the owner/admin reconnect route',async t=>{
  const h=harness(t,[true]);let calls=0;
  assert.equal(await deleteDocument(doc,{role:'member',api:async()=>{calls++;throw {status:424,message:'invalid_grant'}}}),false);
  assert.equal(calls,1);assert.equal(h.confirms.length,1);assert.equal(globalThis.location.href,'');assert.deepEqual(h.alerts,[driveAuth]);assert.deepEqual(h.events,[]);
});

for(const e of [{status:401}, {code:'session_required'}])test(`auth failure sends one destructive request and no reconnect: ${JSON.stringify(e)}`,async t=>{
  const h=harness(t,[true]);let calls=0,reconnects=0;
  assert.equal(await deleteDocument(doc,{api:async()=>{calls++;throw e},maybeReconnect:async()=>{reconnects++;return true}}),false);
  assert.equal(calls,1);assert.equal(reconnects,0);assert.deepEqual(h.alerts,[auth]);assert.deepEqual(h.events,[]);
});

test('stale before confirmation sends no request and shows no private text',async t=>{
  const h=harness(t,[true]);let calls=0;
  assert.equal(await deleteDocument(doc,{isCurrent:()=>false,api:async()=>{calls++;return {ok:true}}}),false);
  assert.equal(calls,0);assert.deepEqual(h.confirms,[]);assert.deepEqual(h.alerts,[]);assert.deepEqual(h.events,[]);
});

test('scope invalidated by confirmation sends zero requests',async t=>{
  const h=harness(t);let current=true,calls=0;
  globalThis.confirm=message=>{h.confirms.push(message);current=false;return true};
  assert.equal(await deleteDocument(doc,{isCurrent:()=>current,api:async()=>{calls++;return {ok:true}}}),false);
  assert.equal(calls,0);assert.equal(h.confirms.length,1);assert.deepEqual(h.alerts,[]);assert.deepEqual(h.events,[]);
});

for(const result of ['success','failure','revoked'])test(`stale after ${result} reply suppresses notices/reconnect/events`,async t=>{
  const h=harness(t,[true]),reply=deferred();let current=true,reconnects=0;
  const pending=deleteDocument(doc,{isCurrent:()=>current,api:()=>reply.promise,maybeReconnect:async()=>{reconnects++;return true}});
  current=false;
  if(result==='success')reply.resolve({ok:true});else reply.reject(new Error(result==='revoked'?'invalid_grant':'timeout'));
  assert.equal(await pending,false);assert.equal(reconnects,0);assert.deepEqual(h.alerts,[]);assert.deepEqual(h.events,[]);
});

test('scope invalidated during success notice cannot dispatch success or authorize removal',async t=>{
  const h=harness(t,[true]);let current=true;
  globalThis.alert=message=>{h.alerts.push(message);current=false};
  assert.equal(await deleteDocument(doc,{isCurrent:()=>current,api:async()=>({ok:true})}),false);
  assert.deepEqual(h.alerts,[legacy]);assert.deepEqual(h.events,[]);
});

test('concurrent shared callers of one document/epoch prompt and request only once',async t=>{
  const h=harness(t,[true,true]),reply=deferred();let calls=0;
  const options={expectedSessionEpoch:4,api:()=>{calls++;return reply.promise}};
  const first=deleteDocument(doc,options);
  const duplicate=deleteDocument({...doc},options);
  reply.resolve({ok:true});
  assert.equal(await duplicate,false);assert.equal(await first,true);
  assert.equal(calls,1);assert.equal(h.confirms.length,1);assert.deepEqual(h.alerts,[legacy]);assert.deepEqual(h.events,[event]);
});

test('a blocked caller finally cannot release the active document lock',async t=>{
  const h=harness(t,[true,true,true]),reply=deferred();let calls=0;
  const options={expectedSessionEpoch:5,api:()=>{calls++;return reply.promise}};
  const first=deleteDocument(doc,options);
  const second=deleteDocument(doc,options);const third=deleteDocument(doc,options);
  reply.resolve({ok:true});
  assert.equal(await second,false);assert.equal(await third,false);assert.equal(await first,true);
  assert.equal(calls,1);assert.equal(h.confirms.length,1);assert.deepEqual(h.events,[event]);
});

test('old epoch settlement cannot release a new epoch pending lock',async t=>{
  const h=harness(t,[true,true,true]),oldReply=deferred(),newReply=deferred();let epoch=8,calls=0;
  const old=deleteDocument(doc,{expectedSessionEpoch:8,isCurrent:()=>epoch===8,api:()=>{calls++;return oldReply.promise}});
  epoch=9;
  const options={expectedSessionEpoch:9,isCurrent:()=>epoch===9,api:()=>{calls++;return newReply.promise}};
  const next=deleteDocument(doc,options);
  oldReply.resolve({ok:true});assert.equal(await old,false);
  const duplicate=deleteDocument(doc,options);
  newReply.resolve({ok:true});assert.equal(await duplicate,false);assert.equal(await next,true);
  assert.equal(calls,2);assert.equal(h.confirms.length,2);assert.deepEqual(h.alerts,[legacy]);assert.deepEqual(h.events,[event]);
});

test('different document IDs do not share a pending lock',async t=>{
  const h=harness(t,[true,true]),reply=deferred();let calls=0;
  const options={expectedSessionEpoch:11,api:()=>{calls++;return reply.promise}};
  const first=deleteDocument(doc,options),second=deleteDocument({...doc,id:'doc-2'},options);
  reply.resolve({ok:true});assert.equal(await first,true);assert.equal(await second,true);
  assert.equal(calls,2);assert.equal(h.confirms.length,2);assert.equal(h.events.length,2);
});

test('cancellation and unknown settlement release only ephemeral locks for explicit later actions',async t=>{
  const h=harness(t,[false,true,true]);let calls=0;
  const options={expectedSessionEpoch:12,api:async()=>{calls++;return calls===1?null:{ok:true}}};
  assert.equal(await deleteDocument(doc,options),false);
  assert.equal(await deleteDocument(doc,options),false);
  assert.equal(await deleteDocument(doc,options),true);
  assert.equal(calls,2);assert.equal(h.confirms.length,3);assert.deepEqual(h.alerts,[unknown,legacy]);assert.deepEqual(h.events,[event]);
});

test('scope invalidated during reconnect confirmation prevents drive-start',async t=>{
  const h=harness(t);let current=true,calls=0;
  globalThis.confirm=message=>{h.confirms.push(message);if(h.confirms.length===2)current=false;return true};
  assert.equal(await deleteDocument(doc,{role:'owner',isCurrent:()=>current,api:async()=>{calls++;throw new Error('invalid_grant')}}),false);
  assert.equal(calls,1);assert.equal(h.confirms.length,2);assert.equal(globalThis.location.href,'');assert.deepEqual(h.alerts,[driveAuth]);assert.deepEqual(h.events,[]);
});

for(const success of [true,false])test(`stale reconnect reply suppresses navigation/error: ${success}`,async t=>{
  const h=harness(t,[true,true]),reply=deferred(),started=deferred();let current=true,calls=0;
  const pending=deleteDocument(doc,{role:'owner',isCurrent:()=>current,api:async path=>{
    calls++;if(path.endsWith('document-actions'))throw new Error('invalid_grant');
    started.resolve();return reply.promise;
  }});
  await started.promise;current=false;
  if(success)reply.resolve({url:'https://example.org/reconnect'});else reply.reject(new Error('private reconnect error'));
  assert.equal(await pending,false);assert.equal(calls,2);assert.equal(globalThis.location.href,'');assert.deepEqual(h.alerts,[driveAuth]);assert.deepEqual(h.events,[]);
});

test('injected reconnect receives current context and stale settlement cannot show another notice',async t=>{
  const h=harness(t,[true]),reply=deferred(),started=deferred();let current=true,calls=0,context;
  const isCurrent=()=>current;
  const pending=deleteDocument(doc,{expectedSessionEpoch:20,isCurrent,api:async()=>{calls++;throw new Error('invalid_grant')},maybeReconnect:async(e,scope)=>{
    context=scope;assert.equal(e.message,'invalid_grant');started.resolve();return reply.promise;
  }});
  await started.promise;current=false;reply.resolve(false);
  assert.equal(await pending,false);assert.equal(calls,1);
  assert.equal(context?.isCurrent,isCurrent);assert.equal(context?.expectedSessionEpoch,20);
  assert.deepEqual(h.alerts,[driveAuth]);assert.deepEqual(h.events,[]);
});
