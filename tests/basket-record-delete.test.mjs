import test from 'node:test';
import assert from 'node:assert/strict';

const events=[];
globalThis.window={dispatchEvent:event=>events.push(event.type)};
const mod=await import('../app/basket-record-delete.js');
const ctx={user:{id:'owner'},workspace:{id:'ws 1'}};
const rtFor=(api,state={ctx})=>({context:{read:()=>state.ctx},session:{epoch:()=>7},api});
const withConfirm=async(answer,fn)=>{const calls=[];globalThis.confirm=text=>{calls.push(text);return answer;};try{return {result:await fn(),calls};}finally{delete globalThis.confirm;}};
const q=path=>new URL(path,'http://fixture');

test('disconnect deletes exactly that link id inside the signed-in workspace',async()=>{
  events.length=0;const calls=[];
  const rt=rtFor(async(path,options={})=>{calls.push({path,...options});return [{id:'link/1'}];});
  const {result,calls:asked}=await withConfirm(true,()=>mod.disconnectRecordLink('link/1',{kind:'organization',rt}));
  assert.equal(result.status,'deleted');
  assert.deepEqual(asked,['이 조직에서만 빠집니다. 메모는 바구니에 남고, 이 연결에 적은 요약은 사라집니다.']);
  assert.equal(calls.length,1);
  const url=q(calls[0].path);
  assert.equal(url.pathname,'/rest/v1/app_record_links');
  assert.equal(url.searchParams.get('id'),'eq.link/1');
  assert.equal(url.searchParams.get('workspace_id'),'eq.ws 1');
  assert.deepEqual([...url.searchParams.keys()].sort(),['id','select','workspace_id']);
  assert.equal(calls[0].method,'DELETE');assert.equal(calls[0].prefer,'return=representation');assert.equal(calls[0].expectedSessionEpoch,7);
  assert.deepEqual(events,['kptu:basket-links-changed']);
});

test('cancelled confirmation sends no write',async()=>{
  events.length=0;const calls=[];
  const rt=rtFor(async(path,options={})=>{calls.push({path,...options});return [];});
  const {result}=await withConfirm(false,()=>mod.disconnectRecordLink('link',{kind:'project',rt}));
  assert.equal(result.status,'cancelled');assert.equal(calls.length,0);assert.deepEqual(events,[]);
  const note=rtFor(async(path,options={})=>{calls.push({path,...options});return path.includes('app_notes')?[{id:'note',attachments:[{},{}]}]:[{id:'l1',organization_id:'o'},{id:'l2',project_id:'p'}];});
  const {result:noteResult,calls:asked}=await withConfirm(false,()=>mod.deleteNoteOriginal('note',{rt:note}));
  assert.equal(noteResult.status,'cancelled');
  assert.deepEqual(asked,['메모 원문을 지웁니다. 연결된 조직·프로젝트 2곳에서도 사라집니다. 첨부 파일 2개는 Drive에 남습니다. 되돌릴 수 없습니다.']);
  assert.ok(calls.every(call=>!call.method||call.method==='GET'));
});

test('note delete targets exactly that note id and workspace; links go by cascade',async()=>{
  events.length=0;const calls=[];
  const rt=rtFor(async(path,options={})=>{calls.push({path,...options});if(options.method==='DELETE')return [{id:'n1'}];return path.includes('app_notes')?[{id:'n1',attachments:[]}]:[{id:'l1',organization_id:'o'},{id:'l2',meeting_id:'m'}];});
  const {result,calls:asked}=await withConfirm(true,()=>mod.deleteNoteOriginal('n1',{rt}));
  assert.equal(result.status,'deleted');assert.equal(result.message,'메모를 지웠어요. 첨부 파일은 Drive에 남아 있어요.');
  assert.match(asked[0],/조직·프로젝트 1곳/);assert.match(asked[0],/회의·자료실 연결 1곳/);assert.match(asked[0],/첨부 파일 0개/);
  const writes=calls.filter(call=>call.method==='DELETE');
  assert.equal(writes.length,1);
  const url=q(writes[0].path);
  assert.equal(url.pathname,'/rest/v1/app_notes');
  assert.equal(url.searchParams.get('id'),'eq.n1');assert.equal(url.searchParams.get('workspace_id'),'eq.ws 1');
  assert.deepEqual([...url.searchParams.keys()].sort(),['id','select','workspace_id']);
  for(const call of calls)assert.equal(q(call.path).searchParams.get('workspace_id'),'eq.ws 1');
  assert.deepEqual(events,['kptu:basket-links-changed']);
});

test('empty delete result is reported as missing, not as a success',async()=>{
  const rt=rtFor(async()=>[]);
  const {result}=await withConfirm(true,()=>mod.disconnectRecordLink('gone',{rt}));
  assert.equal(result.status,'missing');
});

test('a thrown write is re-read: still present means failed, gone means deleted, unreadable means unknown',async()=>{
  for(const [present,readFails,expected] of [[true,false,'failed'],[false,false,'deleted'],[true,true,'unknown']]){
    events.length=0;
    const rt=rtFor(async(path,options={})=>{if(options.method==='DELETE')throw Object.assign(Error('network'),{status:0});if(readFails)throw Error('offline');return present?[{id:'l'}]:[];});
    const {result}=await withConfirm(true,()=>mod.disconnectRecordLink('l',{rt}));
    assert.equal(result.status,expected);
    assert.deepEqual(events,expected==='failed'?[]:['kptu:basket-links-changed']);
  }
});

test('an account change during the request never reports to the old screen',async()=>{
  const state={ctx};
  const rt=rtFor(async(path,options={})=>{if(options.method==='DELETE'){state.ctx={user:{id:'other'},workspace:{id:'ws 2'}};return [{id:'l'}];}return [];},state);
  events.length=0;
  const {result}=await withConfirm(true,()=>mod.disconnectRecordLink('l',{rt}));
  assert.equal(result.status,'stale');
  assert.deepEqual(events,[],'the other account screen is not told to refresh by the old request');
});

test('concurrent requests for the same record send one write',async()=>{
  let release,writes=0;
  const rt=rtFor(async(path,options={})=>{if(options.method==='DELETE'){writes++;await new Promise(r=>release=r);return [{id:'l'}];}return [];});
  globalThis.confirm=()=>true;
  try{
    const first=mod.disconnectRecordLink('l',{rt}),second=await mod.disconnectRecordLink('l',{rt});
    assert.equal(second.status,'busy');
    await new Promise(r=>setTimeout(r,0));release();assert.equal((await first).status,'deleted');
  }finally{delete globalThis.confirm;}
  assert.equal(writes,1);
});

test('missing note before confirmation does not ask or write',async()=>{
  const calls=[];
  const rt=rtFor(async(path,options={})=>{calls.push(options.method||'GET');return [];});
  const {result,calls:asked}=await withConfirm(true,()=>mod.deleteNoteOriginal('n',{rt}));
  assert.equal(result.status,'missing');assert.deepEqual(asked,[]);assert.ok(!calls.includes('DELETE'));
});
