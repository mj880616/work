import test from 'node:test';
import assert from 'node:assert/strict';
import {deleteDocument,luDeleteErrorMessage} from '../app/document-delete.js';

const doc={id:'doc-1',file_name:'회의자료.pdf',project_id:'project-1',meeting_id:'meeting-1'};
function harness(t,answers){
  const originals={confirm:globalThis.confirm,alert:globalThis.alert,window:globalThis.window,location:globalThis.location};
  const confirms=[],alerts=[],events=[];
  globalThis.confirm=message=>{confirms.push(message);return answers.shift()};
  globalThis.alert=message=>alerts.push(message);
  globalThis.window={dispatchEvent:event=>events.push({type:event.type,detail:event.detail})};
  globalThis.location={href:''};
  t.after(()=>Object.assign(globalThis,originals));
  return {confirms,alerts,events};
}

test('shared deletion cancellation sends no request or refresh',async t=>{
  const h=harness(t,[false]),calls=[];
  assert.equal(await deleteDocument(doc,{api:async(...args)=>calls.push(args)}),false);
  assert.deepEqual(calls,[]);assert.deepEqual(h.events,[]);
  assert.match(h.confirms[0],/회의자료.pdf.*\nDrive 휴지통으로 이동합니다.*30일 안에 복구/);
});

test('shared deletion sends one existing request and signals both document links',async t=>{
  const h=harness(t,[true]),calls=[];
  assert.equal(await deleteDocument(doc,{api:async(...args)=>{calls.push(args);return {ok:true}}}),true);
  assert.deepEqual(calls,[['/functions/v1/document-actions',{method:'POST',body:{action:'delete',document_id:doc.id}}]]);
  assert.deepEqual(h.events,[{type:'kptu:documents-changed',detail:{project_id:doc.project_id,meeting_id:doc.meeting_id}}]);
});

test('shared error guidance retains session, revoked Drive and generic rules',()=>{
  assert.equal(luDeleteErrorMessage({status:401}),'로그인 세션이 만료됐습니다. 다시 로그인한 뒤 삭제해 주세요.');
  assert.equal(luDeleteErrorMessage({code:'session_required'}),luDeleteErrorMessage({status:401}));
  assert.equal(luDeleteErrorMessage({message:'invalid_grant'}),'Google Drive 연결이 만료됐습니다. 관리자에게 Drive 재연결을 요청해 주세요. 자료 기록은 삭제되지 않았습니다.');
  assert.equal(luDeleteErrorMessage({message:'permission denied'}),'자료를 삭제하지 못했습니다. 관리자에게 오류 확인을 요청해 주세요.');
});

test('delete failures keep documents unchanged and do not emit refresh',async t=>{
  const h=harness(t,[true]);
  assert.equal(await deleteDocument(doc,{api:async()=>({error:'server refused'})}),false);
  assert.deepEqual(h.alerts,[luDeleteErrorMessage({})]);assert.deepEqual(h.events,[]);
});

test('deletion permission is left to the server even for a non-owner UI context',async t=>{
  const h=harness(t,[true]),calls=[];
  assert.equal(await deleteDocument(doc,{role:'member',api:async(...args)=>{calls.push(args);throw new Error('owner required')}}),false);
  assert.equal(calls.length,1);assert.deepEqual(h.events,[]);assert.deepEqual(h.alerts,[luDeleteErrorMessage({})]);
});

for(const reconnect of [false,true])test(`revoked Drive uses existing reconnect prompt: ${reconnect}`,async t=>{
  const h=harness(t,[true,reconnect]),calls=[];
  assert.equal(await deleteDocument(doc,{role:'owner',api:async(path,options)=>{
    calls.push({path,body:options.body});
    if(path.endsWith('document-actions'))throw new Error('Token has been expired or revoked');
    return {url:'https://example.org/reconnect'};
  }}),false);
  assert.equal(h.confirms.length,2);assert.match(h.confirms[1],/Google Drive 연결이 만료됐습니다/);
  assert.equal(calls.length,reconnect?2:1);assert.deepEqual(h.events,[]);
  if(reconnect){assert.deepEqual(calls[1],{path:'/functions/v1/public-policy-drive',body:{action:'drive-start'}});assert.equal(globalThis.location.href,'https://example.org/reconnect');assert.deepEqual(h.alerts,[])}
  else assert.deepEqual(h.alerts,[luDeleteErrorMessage({message:'invalid_grant'})]);
});
