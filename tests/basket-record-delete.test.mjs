import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const events=[];
globalThis.window={dispatchEvent:event=>events.push(event.type)};
const mod=await import('../app/basket-record-delete.js');
const ctx={user:{id:'owner'},workspace:{id:'ws 1'}};
const rtFor=(api,state={ctx})=>({config:{url:'https://sb.invalid',key:'anon'},context:{read:()=>state.ctx},session:{epoch:()=>7,ensure:async()=>true,read:()=>({access_token:'jwt',user:state.ctx.user})},api});
const withConfirm=async(answer,fn)=>{const calls=[];globalThis.confirm=text=>{calls.push(text);return answer;};try{return {result:await fn(),calls};}finally{delete globalThis.confirm;}};
const q=path=>new URL(path,'http://fixture');

test('disconnect deletes exactly that link id inside the signed-in workspace',async()=>{
  events.length=0;const calls=[];
  const rt=rtFor(async(path,options={})=>{calls.push({path,...options});return [{id:'link/1'}];});
  const {result,calls:asked}=await withConfirm(true,()=>mod.disconnectRecordLink('link/1',{name:'합성 조직',rt}));
  assert.equal(result.status,'deleted');
  // BUG-바구니연결해제: one wording on every screen, naming the place.
  assert.deepEqual(asked,['합성 조직 연결을 해제할까요? 업데이트는 남아요']);
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
  assert.deepEqual(asked,['업데이트 원문을 지웁니다. 연결된 조직·사업영역 2곳에서도 사라집니다. 첨부 파일 2개는 Drive 휴지통으로 옮깁니다(30일 안에 복구 가능).']);
  assert.ok(calls.every(call=>!call.method||call.method==='GET'));
});

test('note delete targets exactly that note id and workspace; links go by cascade',async()=>{
  events.length=0;const calls=[];
  const rt=rtFor(async(path,options={})=>{calls.push({path,...options});if(options.method==='DELETE')return [{id:'n1'}];return path.includes('app_notes')?[{id:'n1',attachments:[]}]:[{id:'l1',organization_id:'o'},{id:'l2',meeting_id:'m'}];});
  const {result,calls:asked}=await withConfirm(true,()=>mod.deleteNoteOriginal('n1',{rt}));
  assert.equal(result.status,'deleted');assert.equal(result.message,'업데이트를 지웠어요.');
  assert.match(asked[0],/조직·사업영역 1곳/);assert.match(asked[0],/사업 보고·자료실 연결 1곳/);assert.doesNotMatch(asked[0],/첨부/);
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

// Server path: notes with attachments go to basket-files note-delete first.
const NOTE_ROW={id:'n1',updated_at:'2026-10-14T01:00:00Z',attachments:[{drive_file_id:'a'},{drive_file_id:'b'}]};
function serverCase({reply,throws,present=false,readFails=false}){
  const calls=[],posts=[];
  const rt=rtFor(async(path,options={})=>{calls.push({path,...options});
    if(options.method==='DELETE')return [{id:'n1'}];
    if(path.includes('app_record_links'))return [{id:'l1',organization_id:'o'}];
    if(calls.some(c=>c.after))return [];
    if(readFails&&posts.length)throw Error('offline');
    return posts.length&&!present?[]:[NOTE_ROW];});
  const fetcher=async(url,init)=>{posts.push({url,init});if(throws)throw Error('network');
    return new Response(typeof reply.body==='string'?reply.body:JSON.stringify(reply.body),{status:reply.status});};
  return {rt,fetcher,calls,posts};
}
const body=(extra={})=>({action:'note-delete',note_id:'n1',attachments_total:2,trashed:2,failed:0,unknown:0,ok:true,note_deleted:true,...extra});

test('note with attachments posts once to basket-files note-delete with the user JWT and no REST delete',async()=>{
  events.length=0;const c=serverCase({reply:{status:200,body:body()}});
  const {result,calls:asked}=await withConfirm(true,()=>mod.deleteNoteOriginal('n1',{rt:c.rt,fetcher:c.fetcher}));
  assert.deepEqual(asked,['업데이트 원문을 지웁니다. 연결된 조직·사업영역 1곳에서도 사라집니다. 첨부 파일 2개는 Drive 휴지통으로 옮깁니다(30일 안에 복구 가능).']);
  assert.deepEqual(result,{status:'deleted',message:'업데이트를 지우고 첨부를 Drive 휴지통으로 옮겼어요.'});
  assert.equal(c.posts.length,1);
  assert.equal(c.posts[0].url,'https://sb.invalid/functions/v1/basket-files?action=note-delete');
  assert.equal(c.posts[0].init.method,'POST');assert.equal(c.posts[0].init.headers.Authorization,'Bearer jwt');
  assert.deepEqual(JSON.parse(c.posts[0].init.body),{action:'note-delete',note_id:'n1',note_updated_at:'2026-10-14T01:00:00Z'});
  assert.equal(c.calls.some(x=>x.method==='DELETE'),false);assert.deepEqual(events,['kptu:basket-links-changed']);
});

test('partial and unknown trash results are named in plain words',async()=>{
  for(const [extra,message] of [[{trashed:1,failed:1},'업데이트를 지웠어요. 첨부 1개는 Drive에 남았어요.'],
    [{trashed:0,failed:2},'업데이트를 지웠어요. 첨부 2개는 Drive에 남았어요.'],
    [{trashed:0,failed:1,unknown:1},'업데이트를 지웠어요. 첨부 1개는 Drive에 남았어요. 첨부 1개는 휴지통 이동 결과를 확인하지 못했어요. Drive에서 확인해 주세요.']]){
    const c=serverCase({reply:{status:200,body:body(extra)}});
    const {result}=await withConfirm(true,()=>mod.deleteNoteOriginal('n1',{rt:c.rt,fetcher:c.fetcher}));
    assert.deepEqual(result,{status:'deleted',message});
  }
});

test('legacy server reply falls back to the owner-RLS REST delete and says attachments stay in Drive',async()=>{
  events.length=0;
  const c=serverCase({reply:{status:400,body:{ok:false,code:'OCR_REQUEST_INVALID',retryable:false,result_unknown:false,ocr_saved:false,text_changed:false}}});
  const {result}=await withConfirm(true,()=>mod.deleteNoteOriginal('n1',{rt:c.rt,fetcher:c.fetcher}));
  assert.deepEqual(result,{status:'deleted',message:'업데이트를 지웠어요. 첨부 파일은 Drive에 남아 있어요.'});
  const writes=c.calls.filter(x=>x.method==='DELETE');assert.equal(writes.length,1);
  assert.equal(q(writes[0].path).pathname,'/rest/v1/app_notes');assert.equal(q(writes[0].path).searchParams.get('id'),'eq.n1');
  assert.equal(c.posts.length,1);assert.deepEqual(events,['kptu:basket-links-changed']);
});

test('only the exact legacy refusal falls back; other server failures never REST delete',async()=>{
  for(const [reply,status,message] of [
    [{status:400,body:{ok:false,code:'OCR_REQUEST_INVALID',action:'note-delete'}},'deleted',null],
    [{status:409,body:body({ok:false,note_deleted:false,code:'note_changed',trashed:2})},'failed','업데이트가 바뀌었어요. 다시 불러온 뒤 확인해 주세요. 첨부 2개는 이미 Drive 휴지통으로 옮겼어요(30일 안에 복구 가능).'],
    [{status:404,body:body({ok:false,note_deleted:false,code:'note_not_found',trashed:0})},'missing','업데이트를 찾을 수 없어요. 이미 지워졌을 수 있어요.'],
    [{status:503,body:body({ok:false,note_deleted:false,code:'note_delete_unavailable',trashed:0})},'failed','업데이트를 지우지 못했어요. 다시 시도해 주세요.'],
    [{status:502,body:'<html>gateway</html>'},'deleted',null],
    [{status:401,body:{code:'session_required'}},'deleted',null]]){
    const c=serverCase({reply});
    const {result}=await withConfirm(true,()=>mod.deleteNoteOriginal('n1',{rt:c.rt,fetcher:c.fetcher}));
    assert.equal(result.status,status,JSON.stringify(reply));if(message)assert.equal(result.message,message);
    assert.equal(c.calls.some(x=>x.method==='DELETE'),false,'no REST delete for '+JSON.stringify(reply));
  }
});

test('an unclear server outcome re-reads the note row and never resends',async()=>{
  for(const [options,status] of [[{throws:true},'deleted'],[{throws:true,present:true},'failed'],[{throws:true,readFails:true},'unknown'],
    [{reply:{status:503,body:body({ok:false,note_deleted:false,code:'note_delete_result_unknown'})},present:true},'failed']]){
    const c=serverCase(options);
    const {result}=await withConfirm(true,()=>mod.deleteNoteOriginal('n1',{rt:c.rt,fetcher:c.fetcher}));
    assert.equal(result.status,status,JSON.stringify(options));assert.equal(c.posts.length,1);
    assert.equal(c.calls.some(x=>x.method==='DELETE'),false);
  }
  const slow=serverCase({reply:{status:200,body:body()}});
  const hang=()=>new Promise(()=>{});
  const {result}=await withConfirm(true,()=>mod.deleteNoteOriginal('n1',{rt:slow.rt,fetcher:hang,waitMs:5}));
  assert.equal(result.status,'failed');
});

test('cancelled server-path confirmation sends nothing; missing session sends nothing',async()=>{
  const c=serverCase({reply:{status:200,body:body()}});
  const {result}=await withConfirm(false,()=>mod.deleteNoteOriginal('n1',{rt:c.rt,fetcher:c.fetcher}));
  assert.equal(result.status,'cancelled');assert.equal(c.posts.length,0);assert.equal(c.calls.some(x=>x.method==='DELETE'),false);
  const d=serverCase({reply:{status:200,body:body()}});d.rt.session.read=()=>null;
  const {result:noSession}=await withConfirm(true,()=>mod.deleteNoteOriginal('n1',{rt:d.rt,fetcher:d.fetcher}));
  assert.equal(noSession.status,'failed');assert.equal(d.posts.length,0);
});

test('disconnect wording and the × name fall back to "이" without a name',()=>{
  assert.equal(mod.disconnectConfirmText(''),'이 연결을 해제할까요? 업데이트는 남아요');
  assert.equal(mod.disconnectLabel('합성 프로젝트'),'합성 프로젝트 연결 해제');
  assert.equal(mod.UNDO_MS,2000);
});

// Undo re-links through the existing confirm-links RPC only: one note read, one RPC, same place and summary.
for(const [summary,expectedTarget] of [['연결 요약',{kind:'project',target_id:'p1',reason:'직접 연결',summary:'연결 요약'}],[null,{kind:'project',target_id:'p1',reason:'직접 연결'}]])
test(`restore re-links the same place ${summary?'with':'without'} its summary`,async()=>{
  events.length=0;const calls=[];
  const rt=rtFor(async(path,options={})=>{calls.push({path,...options});if(path.startsWith('/rest/v1/app_notes'))return [{id:'n1',updated_at:'2026-10-17T01:00:00Z'}];return {ok:true,created:1,existing:0};});
  const result=await mod.restoreRecordLink({noteId:'n1',kind:'project',targetId:'p1',summary},{rt});
  assert.deepEqual(result,{status:'restored',message:'연결을 되돌렸어요.'});
  assert.equal(calls.length,2);
  const read=q(calls[0].path);assert.equal(read.pathname,'/rest/v1/app_notes');assert.equal(read.searchParams.get('id'),'eq.n1');assert.equal(read.searchParams.get('workspace_id'),'eq.ws 1');assert.equal(calls[0].method,undefined);
  assert.equal(calls[1].path,'/rest/v1/rpc/app_basket_confirm_links');assert.equal(calls[1].method,'POST');
  assert.deepEqual(calls[1].body,{p_note_id:'n1',p_note_updated_at:'2026-10-17T01:00:00Z',p_targets:[expectedTarget]});
  assert.deepEqual(events,['kptu:basket-links-changed']);
});

for(const [error,message] of [['NOTE_ARCHIVED','보류한 업데이트라 연결을 되돌리지 못했어요. 보류를 해제한 뒤 다시 이어 주세요.'],['AI_EXCLUDED','AI 제외로 표시된 업데이트라 연결을 되돌리지 못했어요.'],['TARGET_UNSELECTABLE','연결했던 곳을 찾거나 고를 수 없어 되돌리지 못했어요.'],['SUGGESTED_EXISTS','연결을 되돌리지 못했어요. 업데이트에서 [연결하기]로 다시 이어 주세요.']])
test(`restore refusal ${error} explains and sends nothing else`,async()=>{
  events.length=0;const calls=[];
  const rt=rtFor(async(path,options={})=>{calls.push(path);return path.startsWith('/rest/v1/app_notes')?[{id:'n1',updated_at:'t'}]:{ok:false,error,created:0,existing:0};});
  const result=await mod.restoreRecordLink({noteId:'n1',kind:'organization',targetId:'o1'},{rt});
  assert.deepEqual(result,{status:'failed',message});assert.equal(calls.length,2);assert.deepEqual(events,[]);
});

test('restore of a missing note never calls the RPC; a thrown RPC is unknown and re-read by the lists',async()=>{
  events.length=0;let calls=0;
  let rt=rtFor(async()=>{calls++;return [];});
  assert.deepEqual(await mod.restoreRecordLink({noteId:'n1',kind:'project',targetId:'p1'},{rt}),{status:'failed',message:'업데이트를 찾을 수 없어 연결을 되돌리지 못했어요.'});assert.equal(calls,1);
  rt=rtFor(async path=>{if(path.startsWith('/rest/v1/app_notes'))return [{id:'n1',updated_at:'t'}];throw Error('network');});
  assert.equal((await mod.restoreRecordLink({noteId:'n1',kind:'project',targetId:'p1'},{rt})).status,'unknown');assert.deepEqual(events,['kptu:basket-links-changed']);
  assert.equal((await mod.restoreRecordLink({noteId:'n1',kind:'meeting',targetId:'m1'},{rt})).status,'failed');
});

test('restore after an account switch reports stale and writes nothing',async()=>{
  events.length=0;const state={ctx};let rpc=0;
  const rt=rtFor(async path=>{if(path.startsWith('/rest/v1/app_notes')){state.ctx={user:{id:'other'},workspace:{id:'ws 2'}};return [{id:'n1',updated_at:'t'}];}rpc++;return {ok:true};},state);
  assert.deepEqual(await mod.restoreRecordLink({noteId:'n1',kind:'project',targetId:'p1'},{rt}),{status:'stale'});assert.equal(rpc,0);assert.deepEqual(events,[]);
});

// REF-참고묶음 화면 2: a reference bundle link (bundle_id) is put back as kind 'reference' through the same RPC.
test('restore re-links a reference bundle as kind reference; the link kind helpers name the bundle',async()=>{
  events.length=0;const calls=[];
  const rt=rtFor(async(path,options={})=>{calls.push({path,...options});if(path.startsWith('/rest/v1/app_notes'))return [{id:'n1',updated_at:'2026-10-24T01:00:00Z'}];return {ok:true,created:1,existing:0};});
  const result=await mod.restoreRecordLink({noteId:'n1',kind:'reference',targetId:'b1',summary:'참고 요약'},{rt});
  assert.deepEqual(result,{status:'restored',message:'연결을 되돌렸어요.'});
  assert.deepEqual(calls[1].body.p_targets,[{kind:'reference',target_id:'b1',reason:'직접 연결',summary:'참고 요약'}]);
  assert.equal(mod.linkRestoreKind({bundle_id:'b1'}),'reference');assert.equal(mod.linkRestoreTarget({bundle_id:'b1'}),'b1');
  assert.equal(mod.linkRestoreKind({organization_id:'o1'}),'organization');assert.equal(mod.linkRestoreKind({project_id:'p1'}),'project');
  assert.equal(mod.linkRestoreTarget({project_id:'p1'}),'p1');
});

// ---- TRASH-다른삭제 5단계: trash:true는 휴지통으로 보낸다(예전 note-delete 경로·삭제 확인 글은 쓰지 않는다) ----
const trashApi=({state='ready',kind='basket',attachments=[{}],links=[{id:'l1',organization_id:'o'},{id:'l2'}],lands=true,deleteFails=false}={})=>{
  const calls=[],trashed=[];
  const api=async(path,options={})=>{
    calls.push({path,...options});
    if(path.endsWith('app_trash_list')){
      if(state==='missing')throw Object.assign(new Error('TRASH_KIND_UNKNOWN'),{status:400,code:'22023'});
      if(state==='failed')throw Object.assign(new Error('boom'),{status:500});
      return trashed.map(id=>({kind:'note',id,note_kind:kind,title:'합성',preview:'',file_count:1,link_count:2,deleted_at:'2026-10-26T01:00:00Z'}));
    }
    if(path.endsWith('app_trash_restore')){trashed.length=0;return {ok:true};}
    if(options.method==='DELETE'){if(deleteFails)throw Object.assign(new Error('RLS'),{status:403});if(lands)trashed.push('n1');return [];}
    return path.includes('app_notes')?[{id:'n1',kind,updated_at:'2026-10-26T00:00:00Z',attachments}]:links;
  };
  return {api,calls,trashed};
};
const writesOf=calls=>calls.filter(call=>call.method==='DELETE');

test('trash: after the confirmation one owner-RLS delete is sent, the trash list proves it landed, and one undo line is offered',async()=>{
  events.length=0;mod.closeUndoNotice();
  const fake=trashApi();
  const {result,calls:asked}=await withConfirm(true,()=>mod.deleteNoteOriginal('n1',{rt:rtFor(fake.api),trash:true}));
  assert.equal(result.status,'deleted');assert.equal(result.message,'');
  assert.deepEqual(asked,['업데이트를 휴지통으로 옮길까요?\n첨부 파일 1개는 Drive에 그대로 남습니다.\n연결된 2곳은 그대로 이어져 있고, 휴지통에서 되돌리면 원래대로 돌아옵니다.']);
  const writes=writesOf(fake.calls);assert.equal(writes.length,1);
  const url=q(writes[0].path);
  assert.equal(url.pathname,'/rest/v1/app_notes');assert.equal(url.searchParams.get('id'),'eq.n1');assert.equal(url.searchParams.get('workspace_id'),'eq.ws 1');
  assert.deepEqual([...url.searchParams.keys()].sort(),['id','select','workspace_id']);
  assert.ok(fake.calls.every(call=>!String(call.path).includes('basket-files')),'예전 서버 경로를 쓰지 않는다');
  assert.deepEqual(fake.calls.filter(call=>call.path.endsWith('app_trash_list')).map(call=>call.body),[{p_kind:'note'},{p_kind:'note'}]);
  assert.deepEqual(events,['kptu:basket-links-changed']);
});

test('trash: before the database is ready nothing is asked or sent and the reason is in plain words',async()=>{
  events.length=0;
  const fake=trashApi({state:'missing'});
  const {result,calls:asked}=await withConfirm(true,()=>mod.deleteNoteOriginal('n1',{rt:rtFor(fake.api),trash:true}));
  assert.equal(result.status,'failed');assert.equal(result.message,'노트·업데이트 휴지통은 준비 중입니다. 준비가 끝나기 전에는 삭제할 수 없습니다.');
  assert.deepEqual(asked,[]);assert.deepEqual(writesOf(fake.calls),[]);assert.deepEqual(events,[]);
  const failing=trashApi({state:'failed'});
  const second=await withConfirm(true,()=>mod.deleteNoteOriginal('n1',{rt:rtFor(failing.api),trash:true}));
  assert.equal(second.result.status,'failed');assert.match(second.result.message,/확인하지 못해 삭제하지 않았습니다/);
  assert.deepEqual(second.calls,[]);assert.deepEqual(writesOf(failing.calls),[]);
});

test('trash: cancelling sends nothing; a missing note does not ask',async()=>{
  const fake=trashApi();
  const {result}=await withConfirm(false,()=>mod.deleteNoteOriginal('n1',{rt:rtFor(fake.api),trash:true}));
  assert.equal(result.status,'cancelled');assert.deepEqual(writesOf(fake.calls),[]);
  const gone=rtFor(async(path)=>path.endsWith('app_trash_list')?[]:[]);
  const second=await withConfirm(true,()=>mod.deleteNoteOriginal('n1',{rt:gone,trash:true}));
  assert.equal(second.result.status,'missing');assert.deepEqual(second.calls,[]);
});

test('trash: a refused delete is failed, and a delete that is neither in the trash nor readable is never called a success',async()=>{
  const refused=trashApi({deleteFails:true});
  const first=await withConfirm(true,()=>mod.deleteNoteOriginal('n1',{rt:rtFor(refused.api),trash:true}));
  assert.equal(first.result.status,'failed');assert.equal(first.result.message,'업데이트를 지우지 못했어요. 다시 시도해 주세요.');
  const lost=trashApi({lands:false});
  const base=lost.api;
  const api=async(path,options={})=>{if(!options.method&&path.includes('app_notes')&&lost.calls.some(c=>c.method==='DELETE'))return [];return base(path,options);};
  const second=await withConfirm(true,()=>mod.deleteNoteOriginal('n1',{rt:rtFor(api),trash:true}));
  assert.equal(second.result.status,'unknown');assert.equal(second.result.message,'결과를 확인하지 못했어요. 목록을 다시 불러와 실제 상태를 확인해 주세요.');
});

test('trash: notes (kind note) use the note wording, and the default call without trash keeps the diary path',async()=>{
  const fake=trashApi({kind:'note',attachments:[]});
  const {calls:asked}=await withConfirm(false,()=>mod.deleteNoteOriginal('n1',{rt:rtFor(fake.api),trash:true}));
  assert.equal(asked[0],'노트를 휴지통으로 옮길까요?\n연결된 2곳은 그대로 이어져 있고, 휴지통에서 되돌리면 원래대로 돌아옵니다.');
  const diary=trashApi();
  await withConfirm(false,()=>mod.deleteNoteOriginal('n1',{rt:rtFor(diary.api),describe:()=>'일기를 지웁니다.'}));
  assert.ok(diary.calls.every(call=>!call.path.endsWith('app_trash_list')),'일기(trash 없음)는 휴지통 함수를 부르지 않는다');
});

test('screens: every update/note delete call goes to the trash; only the diary keeps the immediate delete',()=>{
  for(const file of ['basket.js','basket-notes.js','basket-link-records.js']){
    const text=readFileSync(new URL('../app/'+file,import.meta.url),'utf8');
    const calls=[...text.matchAll(/deleteNoteOriginal\([^)]*\)/g)].map(m=>m[0]);
    assert.ok(calls.length>0,file);
    for(const call of calls)assert.match(call,/trash:\s*true/,file+' '+call);
  }
  const diary=readFileSync(new URL('../app/diary.js',import.meta.url),'utf8');
  assert.doesNotMatch(diary,/trash:\s*true/);
});
