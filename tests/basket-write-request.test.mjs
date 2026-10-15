import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// BASKET-4b-2: one write-request candidate per basket note in metadata.write_request.
globalThis.window={dispatchEvent:()=>true,addEventListener:()=>{}};
const mod=await import('../app/basket-write-request.js');
const tasks=await import('../app/basket-note-tasks.js');
const id='10000000-0000-4000-8000-000000000001',stamp='2026-10-15T01:00:00.123456+00:00',marked='2026-10-15T02:00:00.000Z';
const candidate=(extra={})=>({reason:'기자회견 합의 근거',marked_at:marked,handed_off_at:null,...extra});
const noteWith=(metadata={})=>({id,updated_at:stamp,raw_text:'10/20 기자회견\n장소: 본사 앞',metadata});
const rtFor=handler=>{const calls=[];return {calls,context:{read:()=>({user:{id:'u1'},workspace:{id:'w1'}})},api:async(path,options={})=>{calls.push({path,method:options.method||'GET',body:options.body,options});return handler(path,options,calls.length);}};};
const query=path=>new URL('https://x'+path).searchParams;

test('only a well-formed candidate is read; the reason is optional and at most 500 characters',()=>{
  assert.deepEqual(mod.noteWriteRequest(noteWith({write_request:candidate()})),candidate());
  assert.deepEqual(mod.noteWriteRequest(noteWith({write_request:candidate({reason:''})})).reason,'');
  for(const bad of [null,'x',[],candidate({reason:1}),candidate({marked_at:'아님'}),candidate({handed_off_at:'아님'}),candidate({reason:'가'.repeat(501)})])
    assert.equal(mod.noteWriteRequest(noteWith({write_request:bad})),null);
  assert.equal(mod.noteWriteRequest(null),null);
  assert.equal(mod.writeRequestReasonProblem(''),'');
  assert.equal(mod.writeRequestReasonProblem('가'.repeat(500)),'');
  assert.match(mod.writeRequestReasonProblem('가'.repeat(501)),/500자/);
  const entry=mod.writeRequestEntry('  이유  ',new Date(marked));
  assert.deepEqual(entry,{reason:'이유',marked_at:marked,handed_off_at:null});
});

test('the candidate keeps every other metadata key and stores no ledger id or url',()=>{
  const metadata={tasks:[{task_id:'t1'}],keep:{a:1}};
  const next=mod.withWriteRequest(metadata,{...candidate(),ledger_id:'L-1',url:'https://x'});
  assert.deepEqual(Object.keys(next.write_request).sort(),['handed_off_at','marked_at','reason']);
  assert.deepEqual(next.tasks,[{task_id:'t1'}]);assert.deepEqual(next.keep,{a:1});
  assert.equal(metadata.write_request,undefined);
  assert.deepEqual(mod.withWriteRequest({...next},null),{tasks:[{task_id:'t1'}],keep:{a:1}});
});

test('guards cover the original version, the first task and the candidate mark',()=>{
  const empty=query('/?'+mod.writeRequestGuard(noteWith({tasks:[{task_id:'t1'}]}),{empty:true}));
  assert.equal(empty.get('updated_at'),'eq.'+stamp);assert.equal(empty.get('metadata->write_request'),'is.null');
  assert.equal(empty.get('metadata->tasks->0->>task_id'),'eq.t1');assert.equal(empty.has('metadata->write_request->>marked_at'),false);
  const held=query('/?'+mod.writeRequestGuard(noteWith({write_request:candidate()})));
  assert.equal(held.get('metadata->write_request->>marked_at'),'eq.'+marked);assert.equal(held.get('metadata->tasks->0->>task_id'),'is.null');
  // A task record (BASKET-할일출처) now also refuses to drop a candidate marked in between.
  assert.equal(query('/?'+tasks.noteTaskGuard(noteWith({write_request:candidate()}))).get('metadata->write_request->>marked_at'),'eq.'+marked);
  assert.equal(query('/?'+tasks.noteTaskGuard(noteWith({}))).get('metadata->write_request->>marked_at'),'is.null');
});

test('marking sends one conditional metadata-only PATCH and never touches updated_at',async()=>{
  const note=noteWith({tasks:[{task_id:'t1'}]});
  const rt=rtFor((path,options)=>[{id,updated_at:stamp,metadata:options.body.metadata}]);
  const result=await mod.markWriteRequest(note,'이유',{rt,expectedSessionEpoch:3,now:new Date(marked)});
  assert.equal(result.status,'ok');assert.equal(rt.calls.length,1);
  const [call]=rt.calls,q=query(call.path);
  assert.equal(call.method,'PATCH');assert.deepEqual(Object.keys(call.body),['metadata']);
  assert.equal(q.get('id'),'eq.'+id);assert.equal(q.get('workspace_id'),'eq.w1');assert.equal(q.get('metadata->write_request'),'is.null');
  assert.equal(call.options.expectedSessionEpoch,3);
  assert.deepEqual(call.body.metadata,{tasks:[{task_id:'t1'}],write_request:{reason:'이유',marked_at:marked,handed_off_at:null}});
});

test('zero rows are settled by one read: already a candidate, or the note changed',async()=>{
  const already=rtFor((path,options)=>options.method==='PATCH'?[]:[{id,updated_at:stamp,metadata:{write_request:candidate({marked_at:'2026-10-15T00:00:00.000Z'})}}]);
  assert.equal((await mod.markWriteRequest(noteWith(),'',{rt:already})).status,'already');
  assert.deepEqual(already.calls.map(c=>c.method),['PATCH','GET']);
  const changed=rtFor((path,options)=>options.method==='PATCH'?[]:[{id,updated_at:'2026-10-15T09:00:00Z',metadata:{}}]);
  assert.equal((await mod.markWriteRequest(noteWith(),'',{rt:changed})).status,'changed');
  assert.equal(changed.calls.length,2);
});

test('an unclear result is never resent: one read decides, a failed read is unknown',async()=>{
  let sent=null;
  const landed=rtFor((path,options)=>{if(options.method==='PATCH'){sent=options.body.metadata;throw Object.assign(Error('timeout'),{status:0});}return [{id,updated_at:stamp,metadata:sent}];});
  assert.equal((await mod.markWriteRequest(noteWith(),'',{rt:landed})).status,'ok');
  assert.deepEqual(landed.calls.map(c=>c.method),['PATCH','GET']);
  const lost=rtFor((path,options)=>{if(options.method==='PATCH')throw Error('502');return [{id,updated_at:stamp,metadata:{}}];});
  assert.equal((await mod.markWriteRequest(noteWith(),'',{rt:lost})).status,'not_saved');
  assert.equal(lost.calls.filter(c=>c.method==='PATCH').length,1);
  const blind=rtFor(()=>{throw Error('offline');});
  assert.equal((await mod.markWriteRequest(noteWith(),'',{rt:blind})).status,'unknown');
  assert.deepEqual(blind.calls.map(c=>c.method),['PATCH','GET']);
});

test('handing off records only handed_off_at; cancelling removes only this candidate',async()=>{
  const note=noteWith({write_request:candidate(),keep:1});
  const rt=rtFor((path,options)=>[{id,updated_at:stamp,metadata:options.body.metadata}]);
  const handed=await mod.handOffWriteRequest(note,{rt,now:new Date('2026-10-15T03:00:00.000Z')});
  assert.equal(handed.status,'ok');
  assert.deepEqual(rt.calls[0].body.metadata,{keep:1,write_request:{...candidate(),handed_off_at:'2026-10-15T03:00:00.000Z'}});
  assert.equal(query(rt.calls[0].path).get('metadata->write_request->>marked_at'),'eq.'+marked);
  const cancelled=await mod.cancelWriteRequest(note,{rt});
  assert.equal(cancelled.status,'ok');assert.deepEqual(rt.calls[1].body.metadata,{keep:1});
  assert.equal(query(rt.calls[1].path).get('metadata->write_request->>marked_at'),'eq.'+marked);
  // A newer candidate marked in another tab is not removed.
  const other=rtFor((path,options)=>options.method==='PATCH'?[]:[{id,updated_at:stamp,metadata:{write_request:candidate({marked_at:'2026-10-15T05:00:00.000Z'})}}]);
  assert.equal((await mod.cancelWriteRequest(note,{rt:other})).status,'ok');
  assert.equal(other.calls.filter(c=>c.method==='PATCH').length,1);
});

test('copied text is a plain candidate note with no ledger write or run instruction',()=>{
  const text=mod.writeRequestCopyText(noteWith(),candidate(),{origin:'https://desk.example/app/'});
  assert.match(text,/쓰기요청 후보 · 미제출/);assert.match(text,/아직 원장에 기록되지 않았어요/);
  assert.match(text,/이유: 기자회견 합의 근거/);assert.match(text,/10\/20 기자회견\n장소: 본사 앞/);
  assert.match(text,new RegExp(`https://desk\\.example/app/\\?view=basket&note=${id}`));
  assert.doesNotMatch(text,/기록해 ?주세요|써 ?주세요|작성해 ?주세요|실행|자동|write_request|ledger/i);
  assert.match(mod.writeRequestCopyText(noteWith(),candidate({reason:''}),{origin:'https://desk.example/app/'}),/이유: \(적지 않음\)/);
});

test('no new table, RPC, Edge call or Drive write; the Drive copy never reads metadata',()=>{
  const source=readFileSync(new URL('../app/basket-write-request.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\/rpc\/|\/functions\/v1|googleapis|updated_at:/);
  assert.match(source,/\/rest\/v1\/app_notes\?/);
  const drive=readFileSync(new URL('../supabase/functions/drive-summary/basket-read.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(drive,/metadata|write_request/);
  const ai=readFileSync(new URL('../app/basket-classification-ui.js',import.meta.url),'utf8');
  assert.match(ai,/WRITE_REQUEST_HINT/);
});
