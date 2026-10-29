import test from 'node:test';
import assert from 'node:assert/strict';

// JOURNAL-일기원드라이브 1~2단계: 실제 onedrive-photos handler를 지어낸 Supabase와 지어낸 Microsoft Graph로 돌린다. 네트워크 없음.
// 비밀값·토큰·계정은 모두 고정 가짜 글자다.
const {createOneDriveHandler}=await import('../../supabase/functions/onedrive-photos/handler.ts');
const {memTables}=await import('./onedrive-fake-db.mjs');
const {insideFolder,folderPathOf,safeDownloadUrl,seoulDay,graphNextLink,scopeAllowed,normalizeScopes,SCOPE}=await import('../../supabase/functions/onedrive-photos/graph.ts');

const WS='a0000000-0000-4000-8000-000000000001',USER='u0000000-0000-4000-8000-000000000001',OTHER='u0000000-0000-4000-8000-000000000002';
const JWT='synthetic-user-jwt',NOW=Date.parse('2026-10-26T03:00:00Z');
const ENV={ONEDRIVE_CLIENT_ID:'synthetic-client-id',ONEDRIVE_CLIENT_SECRET:'synthetic-client-secret-0123456789',ONEDRIVE_REDIRECT_URI:'https://synthetic.example.test/app/onedrive-return.html'};
const REFRESH='synthetic-refresh-token-AAAA',REFRESH2='synthetic-refresh-token-BBBB',ACCESS='synthetic-access-token';

// 연결 표는 운영 권한을 흉내 낸다(workspace_id 고치기·upsert 거절). 색인 표 두 개는 메모리 표(onedrive-fake-db.mjs).
function fakeAdmin({role='owner',row=null,saveError=false,index={}}={}){
  const mem=memTables(index);
  const state={row,writes:[],mem};
  const conn=()=>{
    const q={filters:[]};
    const api={
      select(){return api;},eq(k,v){q.filters.push([k,v]);return api;},
      maybeSingle(){return Promise.resolve({data:state.row,error:null});},
      // 운영 DB처럼: service_role에는 workspace_id 고치기 권한이 없어 upsert(ON CONFLICT DO UPDATE SET workspace_id=…)는 항상 42501.
      upsert(v){state.writes.push({op:'upsert',v});return Promise.resolve({error:{code:'42501'}});},
      insert(v){state.writes.push({op:'insert',v});if(saveError==='insert')return Promise.resolve({error:{code:'42501'}});
        if(state.row)return Promise.resolve({error:{code:'23505'}});state.row={...v};return Promise.resolve({error:null});},
      update(v){
        const u={filters:[],or:null,ret:false};
        const run=()=>{
          if('workspace_id' in v)return {error:{code:'42501'}};
          // 색인 진행 칸만 바꾸는 고치기(잠금·진행 저장·색인 비우기)는 연결 저장 기록(writes)과 따로 센다.
          const progressOnly=Object.keys(v).every(k=>['delta_link','next_link','index_done_at','synced_at','index_lock_until'].includes(k));
          if(progressOnly)state.progress=(state.progress||0)+1;else state.writes.push({op:'update',v});
          const connFields='refresh_token' in v||'folder_id' in v;
          if(connFields&&(saveError===true||saveError==='update'))return {error:{code:'42501'}};
          const ok=state.row&&u.filters.every(([k,val])=>k==='workspace_id'?val===WS:state.row[k]===val)
            &&(!u.or||state.row.index_lock_until==null||String(state.row.index_lock_until)<u.or);
          if(ok)Object.assign(state.row,v);
          return {error:null,data:ok?[{workspace_id:WS}]:[]};
        };
        const c={eq(k,val){u.filters.push([k,val]);return c;},or(expr){u.or=expr.split('.lt.')[1];return c;},select(){u.ret=true;return c;},
          then(res,rej){return Promise.resolve().then(run).then(r=>u.ret?r:{error:r.error}).then(res,rej);}};
        return c;
      },
      delete(){return {eq(){state.writes.push({op:'delete'});state.row=null;return Promise.resolve({error:null});}};},
    };
    return api;
  };
  const members=()=>{const f={};const api={select(){return api;},eq(k,v){f[k]=v;return api;},
    maybeSingle(){return Promise.resolve({data:f.user_id===USER?{workspace_id:WS,role}:null,error:null});}};return api;};
  return {state,auth:{getUser:async t=>t===JWT?{data:{user:{id:USER}},error:null}:t==='other'?{data:{user:{id:OTHER}},error:null}:{data:{user:null},error:{status:401}}},
    from:t=>t==='app_workspace_members'?members():t==='app_onedrive_connections'?conn():mem.from(t)};
}

// 지어낸 Microsoft: 토큰 주소, Graph, 임시 사진 주소.
// 사진 메뉴 ①: 옮기기(PATCH, $batch 하위 요청)·Web2 휴지통 폴더 만들기(POST children)·찾기(경로 주소)·재생 주소도 흉내 낸다.
// moveReply(id)·deleteReply(id)가 상태 번호(또는 Response)를 주면 그것으로 답한다. trashExists면 만들기가 409(이미 있음)다.
const TRASH='TRASH!1',TRASH_NAME='.Web2 휴지통';
function fakeMicrosoft({tokenReply,items={},itemById={},thumb,deleteReply,moveReply,trashExists=false,deltaPages=[[]],deltaChanges=[],deltaReply,batchReply,subReply}={}){
  const calls=[];
  const pathOf=id=>itemById[id]?.parentReference?.path&&itemById[id].name?itemById[id].parentReference.path+'/'+itemById[id].name:'/drive/root:/Pictures/Camera';
  const makeTrash=parent=>(itemById[TRASH]={id:TRASH,name:TRASH_NAME,folder:{},parentReference:{id:parent,path:'/drive/root:/Pictures/Camera'}});
  if(trashExists)makeTrash('F1!100');
  const moveOne=(id,body)=>{
    const own=moveReply?.(id);if(own)return {status:own,body:{}};
    const it=itemById[id];if(!it)return {status:404,body:{}};
    const target=body.parentReference.id;
    it.parentReference={id:target,path:target===TRASH?'/drive/root:/Pictures/Camera/'+TRASH_NAME:'/drive/root:/Pictures/Camera'};
    return {status:200,body:{id,name:it.name||id,parentReference:it.parentReference}};
  };
  const fetch=async(url,init={})=>{
    url=String(url);calls.push({url,init});
    if(url.startsWith('https://login.microsoftonline.com/')){
      const form=new URLSearchParams(String(init.body));
      calls[calls.length-1].form=form;
      const r=tokenReply?tokenReply(form):{status:200,body:{access_token:ACCESS,refresh_token:REFRESH2,scope:'Files.ReadWrite User.Read',expires_in:3600}};
      return new Response(JSON.stringify(r.body),{status:r.status});
    }
    if(url.startsWith('https://graph.microsoft.com/v1.0/')){
      assert.equal(init.headers.Authorization,`Bearer ${ACCESS}`);
      if(init.method==='DELETE'){
        const id=decodeURIComponent(url.slice('https://graph.microsoft.com/v1.0/me/drive/items/'.length));
        return deleteReply?deleteReply(id):new Response(null,{status:204});
      }
      // $batch: 하위 요청마다 사진 정보(itemById) 또는 썸네일 목록을 지어 답한다. subReply(req)가 답을 주면 그것을 쓴다.
      if(url==='https://graph.microsoft.com/v1.0/$batch'&&init.method==='POST'){
        if(batchReply){const r=batchReply(JSON.parse(init.body));if(r)return r;}
        const {requests}=JSON.parse(init.body);
        const responses=requests.map(q=>{
          const own=subReply?.(q);if(own)return {id:q.id,...own};
          const t=q.url.match(/^\/me\/drive\/items\/([^/?]+)\/thumbnails\?select=([a-z0-9]+)$/);
          if(t){const id=decodeURIComponent(t[1]);return itemById[id]?{id:q.id,status:200,body:{value:[{id:'0',[t[2]]:{url:'https://thumbs.synthetic.example.test/u/'+id+'/'+t[2]}}]}}:{id:q.id,status:404,body:{}};}
          const one=q.url.match(/^\/me\/drive\/items\/([^/?]+)\?\$select=id,(?:name,)?file,folder,parentReference$/);
          if(one&&q.method==='GET'){const id=decodeURIComponent(one[1]);return itemById[id]?{id:q.id,status:200,body:itemById[id]}:{id:q.id,status:404,body:{}};}
          const mv=q.url.match(/^\/me\/drive\/items\/([^/?]+)\?@microsoft\.graph\.conflictBehavior=rename$/);
          if(mv&&q.method==='PATCH'){assert.equal(q.headers['Content-Type'],'application/json');return {id:q.id,...moveOne(decodeURIComponent(mv[1]),q.body)};}
          const del=q.url.match(/^\/me\/drive\/items\/([^/?]+)$/);
          if(del&&q.method==='DELETE'){const id=decodeURIComponent(del[1]);const st=deleteReply?deleteReply(id):204;const status=typeof st==='number'?st:st.status;
            if(status===204)delete itemById[id];return {id:q.id,status,body:{}};}
          return {id:q.id,status:400,body:{}};
        }).reverse();
        return new Response(JSON.stringify({responses}),{headers:{'content-type':'application/json'}});
      }
      const path=decodeURIComponent(url.slice('https://graph.microsoft.com/v1.0'.length).split('?')[0]);
      const thumbMatch=path.match(/^\/me\/drive\/items\/([^/]+)\/thumbnails\/0\/([^/]+)\/content$/);
      if(thumbMatch){return thumb?thumb(thumbMatch):new Response(null,{status:302,headers:{location:'https://thumbs.synthetic.example.test/t/abc'}});}
      const delta=path.match(/^\/me\/drive\/items\/([^/]+)\/delta$/);
      if(delta){
        const u=new URL(url),tok=u.searchParams.get('token');
        if(deltaReply){const r=deltaReply(tok,delta[1]);if(r)return r;}
        const base='https://graph.microsoft.com/v1.0/me/drive/items/'+encodeURIComponent(delta[1])+'/delta?token=';
        if(tok==='latest')return new Response(JSON.stringify({value:deltaChanges,'@odata.deltaLink':base+'latest'}));
        const i=tok===null?0:Number(tok);
        return new Response(JSON.stringify({value:deltaPages[i]||[],...(i<deltaPages.length-1?{'@odata.nextLink':base+(i+1)}:{'@odata.deltaLink':base+'latest'})}));
      }
      const kids=path.match(/^\/me\/drive\/(?:root|items\/([^/]+))\/children$/);
      if(kids&&init.method!=='POST'){const key=kids[1]||'root';const page=items[key];if(!page)return new Response('{}',{status:404});
        const u=new URL(url);if(u.searchParams.get('page')==='2')return new Response(JSON.stringify({value:page.second||[]}));
        return new Response(JSON.stringify({value:page.first||page,...(page.second?{'@odata.nextLink':'https://graph.microsoft.com/v1.0'+path+'?page=2'}:{})}));}
      const kidsPost=path.match(/^\/me\/drive\/items\/([^/]+)\/children$/);
      if(kidsPost&&init.method==='POST'){
        const b=JSON.parse(init.body);assert.equal(b.name,TRASH_NAME);assert.equal(b['@microsoft.graph.conflictBehavior'],'fail');
        if(itemById[TRASH])return new Response('{}',{status:409});
        return new Response(JSON.stringify(makeTrash(kidsPost[1])),{status:201});
      }
      const byPath=path.match(/^\/me\/drive\/items\/([^/:]+):\/(.+):$/);
      if(byPath){return byPath[2]===TRASH_NAME&&itemById[TRASH]?new Response(JSON.stringify(itemById[TRASH])):new Response('{}',{status:404});}
      const one=path.match(/^\/me\/drive\/items\/([^/]+)$/);
      if(one&&itemById[one[1]]){
        const it={...itemById[one[1]]};
        if(new URL(url).searchParams.get('$select')?.includes('@microsoft.graph.downloadUrl'))it['@microsoft.graph.downloadUrl']='https://media.synthetic.example.test/d/'+one[1];
        return new Response(JSON.stringify(it));
      }
      return new Response('{}',{status:404});
    }
    if(url.startsWith('https://thumbs.synthetic.example.test/')){
      assert.equal(init.headers?.Authorization,undefined,'token must not go to the temporary address');
      return new Response(new Uint8Array([0xff,0xd8,0xff,1,2,3]),{headers:{'content-type':'image/jpeg'}});
    }
    throw new Error('unexpected fetch '+url);
  };
  return {fetch,calls};
}

const connected={refresh_token:REFRESH,scope:'files.readwrite user.read',folder_id:'F1!100',folder_name:'카메라',folder_path:'/drive/root:/Pictures/Camera',connected_at:'2026-10-20T00:00:00Z'};
const FIX0='2000-01-01T00:00:00Z';
// takenFixAt: 찍은 시각 고침 기준(운영 값은 graph.ts TAKEN_FIX_AT). 다른 시험은 옛 색인 다시 받기와 상관없게 아주 이른 값으로 둔다.
const make=({admin=fakeAdmin({row:{...connected}}),ms=fakeMicrosoft(),env=ENV,now=()=>NOW,takenFixAt=FIX0}={})=>({
  admin,ms,handler:createOneDriveHandler(admin,{env:n=>env[n],fetch:ms.fetch,now,log:()=>{},takenFixAt}),
});
const post=(handler,body,{jwt=JWT,type='application/json',method='POST'}={})=>handler(new Request('https://synthetic.test/functions/v1/onedrive-photos',{
  method,headers:{...(jwt?{Authorization:`Bearer ${jwt}`}:{}),...(type?{'Content-Type':type}:{})},...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}));
const read=async r=>JSON.parse(await r.text());

test('login, owner and request shape are checked before anything else',async()=>{
  const {handler,ms}=make();
  assert.equal((await handler(new Request('https://x.test',{method:'OPTIONS'}))).status,200);
  assert.equal((await post(handler,{action:'status'},{jwt:null})).status,401);
  assert.equal((await post(handler,{action:'status'},{jwt:'bad'})).status,401);
  assert.equal((await post(handler,{action:'status'},{jwt:'other'})).status,403);
  assert.equal((await post(handler,null,{method:'GET'})).status,405);
  assert.equal((await post(handler,{action:'status'},{type:'text/plain'})).status,415);
  assert.equal((await post(handler,'{not json')).status,400);
  assert.equal((await post(handler,{action:'nope'})).status,400);
  assert.equal((await post(handler,{action:'__proto__'})).status,400);
  assert.equal((await post(handler,{action:'status',pad:'x'.repeat(17000)})).status,413);
  assert.equal(ms.calls.length,0);
  const viewer=make({admin:fakeAdmin({role:'viewer'})});
  assert.equal((await post(viewer.handler,{action:'status'})).status,403);
});

test('without secrets the function stops safely: status says not configured, every other action is 424, no network',async()=>{
  const {handler,ms,admin}=make({env:{}, admin:fakeAdmin()});
  assert.deepEqual(await read(await post(handler,{action:'status'})),{configured:false,connected:false,folder:null});
  for(const body of [{action:'auth-start'},{action:'auth-finish',code:'12345678',state:'a.b'}]){
    const r=await post(handler,body);assert.equal(r.status,424);assert.deepEqual(await read(r),{error:'onedrive_not_configured'});
  }
  // 짧은 비밀값·http 주소도 '준비 안 됨'
  const weak=make({env:{...ENV,ONEDRIVE_CLIENT_SECRET:'short'}});
  assert.equal((await read(await post(weak.handler,{action:'status'}))).configured,false);
  const insecure=make({env:{...ENV,ONEDRIVE_REDIRECT_URI:'http://x.test/cb'}});
  assert.equal((await read(await post(insecure.handler,{action:'status'}))).configured,false);
  assert.equal(ms.calls.length,0);assert.equal(admin.state.writes.length,0);
});

test('status when configured: connected flag and folder name only, never the token',async()=>{
  const none=make({admin:fakeAdmin()});
  assert.deepEqual(await read(await post(none.handler,{action:'status'})),{configured:true,connected:false,folder:null,connected_at:null,can_delete:false});
  const ok=make();const text=await (await post(ok.handler,{action:'status'})).text();
  assert.deepEqual(JSON.parse(text),{configured:true,connected:true,folder:{name:'카메라'},connected_at:'2026-10-20T00:00:00Z',can_delete:true});
  assert.ok(!text.includes(REFRESH));
});

test('auth-start builds a sign-in address for exactly the files read/write scope with a signed, expiring state',async()=>{
  const {handler}=make({admin:fakeAdmin()});
  const {url}=await read(await post(handler,{action:'auth-start'}));
  const u=new URL(url);
  assert.equal(u.origin+u.pathname,'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  assert.equal(u.searchParams.get('scope'),'Files.ReadWrite offline_access User.Read');assert.equal(SCOPE,'Files.ReadWrite offline_access User.Read');
  assert.equal(u.searchParams.get('redirect_uri'),ENV.ONEDRIVE_REDIRECT_URI);
  assert.equal(u.searchParams.get('client_id'),ENV.ONEDRIVE_CLIENT_ID);
  assert.ok(!url.includes(ENV.ONEDRIVE_CLIENT_SECRET));assert.ok(!/\.All|AppFolder|Selected/i.test(url));
  const state=u.searchParams.get('state');assert.match(state,/^[\w-]+\.[\w-]+$/);
});

async function startState(handler){const {url}=await read(await post(handler,{action:'auth-start'}));return new URL(url).searchParams.get('state');}

test('auth-finish: exchanges the code on the server, stores the refresh token, answers without it',async()=>{
  const ctx=make({admin:fakeAdmin({row:{...connected}})});const state=await startState(ctx.handler);
  const r=await post(ctx.handler,{action:'auth-finish',code:'synthetic-code-123',state});
  const text=await r.text();assert.equal(r.status,200);assert.deepEqual(JSON.parse(text),{connected:true});
  assert.ok(!text.includes(REFRESH2)&&!text.includes(ACCESS));
  const call=ctx.ms.calls.find(c=>c.form);assert.equal(call.form.get('grant_type'),'authorization_code');
  assert.equal(call.form.get('client_secret'),ENV.ONEDRIVE_CLIENT_SECRET);assert.equal(call.form.get('code'),'synthetic-code-123');
  // 이미 연결 행이 있으면: 넣기(23505) → 허용된 칸만 고치기. upsert는 쓰지 않는다.
  assert.deepEqual(ctx.admin.state.writes.map(w=>w.op),['insert','update']);
  const saved=ctx.admin.state.writes.at(-1);assert.ok(!('workspace_id' in saved.v),'workspace_id is never in the update');
  assert.equal(saved.v.refresh_token,REFRESH2);assert.equal(ctx.admin.state.row.refresh_token,REFRESH2);
  assert.equal(saved.v.folder_id,null,'reconnect clears the folder');assert.equal(ctx.admin.state.row.folder_path,null);assert.equal(saved.v.scope,'files.readwrite user.read');
});

test('auth-finish first connection: plain insert with workspace_id, no upsert; save failures log the stage and DB code only',async()=>{
  const logs=[];const admin=fakeAdmin();const ms=fakeMicrosoft();
  const handler=createOneDriveHandler(admin,{env:n=>ENV[n],takenFixAt:FIX0,fetch:ms.fetch,now:()=>NOW,log:c=>logs.push(c)});
  const r=await post(handler,{action:'auth-finish',code:'synthetic-code-123',state:await startState(handler)});
  assert.equal(r.status,200);assert.deepEqual(admin.state.writes.map(w=>w.op),['insert']);
  assert.equal(admin.state.writes[0].v.workspace_id,WS);assert.equal(admin.state.row.refresh_token,REFRESH2);
  assert.deepEqual(logs,[]);
  // 다음 status는 연결됨
  assert.equal((await read(await post(handler,{action:'status'}))).connected,true);
  for(const [saveError,row,code] of [['insert',null,'onedrive_save_failed:insert:42501'],['update',{...connected},'onedrive_save_failed:update:42501']]){
    const logs2=[];const a=fakeAdmin({row,saveError});const m=fakeMicrosoft();
    const h=createOneDriveHandler(a,{env:n=>ENV[n],takenFixAt:FIX0,fetch:m.fetch,now:()=>NOW,log:c=>logs2.push(c)});
    const res=await post(h,{action:'auth-finish',code:'synthetic-code-123',state:await startState(h)});
    assert.equal(res.status,503);assert.deepEqual(await read(res),{error:'onedrive_unavailable'});
    assert.deepEqual(logs2,[code]);
    for(const l of logs2)for(const secret of [REFRESH2,ACCESS,ENV.ONEDRIVE_CLIENT_SECRET,'synthetic-code-123'])assert.ok(!l.includes(secret));
  }
  // Microsoft가 갱신 토큰을 안 주거나 거절하면 그 단계 이름을 남긴다(설명문은 남기지 않음).
  for(const [reply,status,code] of [
    [{status:200,body:{access_token:ACCESS,scope:'Files.ReadWrite User.Read'}},502,'onedrive_refresh_token_missing'],
    [{status:401,body:{error:'invalid_client',error_description:'synthetic secret-ish text'}},424,'onedrive_token_rejected:401:invalid_client'],
    [{status:500,body:{error:'server_error'}},503,'onedrive_token_rejected:500:server_error'],
  ]){
    const logs3=[];const a=fakeAdmin();const m=fakeMicrosoft({tokenReply:()=>reply});
    const h=createOneDriveHandler(a,{env:n=>ENV[n],takenFixAt:FIX0,fetch:m.fetch,now:()=>NOW,log:c=>logs3.push(c)});
    const res=await post(h,{action:'auth-finish',code:'synthetic-code-123',state:await startState(h)});
    assert.equal(res.status,status,code);assert.deepEqual(logs3,[code]);assert.equal(a.state.writes.length,0);
  }
});

test('auth-finish rejects forged, other-user, expired and replayed-shape states without calling Microsoft',async()=>{
  const ctx=make({admin:fakeAdmin()});const state=await startState(ctx.handler);
  const [body,mac]=state.split('.');
  const forged=Buffer.from(JSON.stringify({u:USER,w:WS,e:NOW+999999,n:'x'})).toString('base64url')+'.'+mac;
  for(const bad of [forged,state+'x','a.b','nodot',body,42,null,state+'.extra']){
    const r=await post(ctx.handler,{action:'auth-finish',code:'synthetic-code-123',state:bad});assert.equal(r.status,400,String(bad));
  }
  const late=createOneDriveHandler(ctx.admin,{env:n=>ENV[n],takenFixAt:FIX0,fetch:ctx.ms.fetch,now:()=>NOW+11*60*1000,log:()=>{}});
  assert.equal((await post(late,{action:'auth-finish',code:'synthetic-code-123',state})).status,400);
  // 같은 서명이어도 다른 사용자 이름으로는 못 쓴다: 다른 사용자가 만든 상태를 이 사용자가 내면 거절
  const otherAdmin=fakeAdmin();const otherUser=createOneDriveHandler({...otherAdmin,from:t=>t==='app_workspace_members'?{select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{workspace_id:WS,role:'owner'},error:null})}:otherAdmin.from(t)},{env:n=>ENV[n],takenFixAt:FIX0,fetch:ctx.ms.fetch,now:()=>NOW,log:()=>{}});
  assert.equal((await post(otherUser,{action:'auth-finish',code:'synthetic-code-123',state},{jwt:'other'})).status,400);
  assert.equal((await post(ctx.handler,{action:'auth-finish',code:'x',state})).status,400);
  assert.equal(ctx.ms.calls.length,0);assert.equal(ctx.admin.state.writes.length,0);
});

test('auth-finish refuses wide permissions (.All, AppFolder, Selected) and a missing ReadWrite, and stores nothing',async()=>{
  for(const scope of ['Files.ReadWrite.All offline_access','Files.ReadWrite Files.Read.All','Files.ReadWrite.AppFolder','Files.ReadWrite.Selected User.Read','Files.Read offline_access','User.Read','Files.Read.All','Files.ReadWrite Sites.ReadWrite.All']){
    const ctx=make({admin:fakeAdmin(),ms:fakeMicrosoft({tokenReply:()=>({status:200,body:{access_token:ACCESS,refresh_token:REFRESH2,scope,expires_in:3600}})})});
    const state=await startState(ctx.handler);
    const r=await post(ctx.handler,{action:'auth-finish',code:'synthetic-code-123',state});
    assert.equal(r.status,400,scope);assert.deepEqual(await read(r),{error:'onedrive_scope_invalid'});assert.equal(ctx.admin.state.writes.length,0);
  }
  // 마이크로소프트가 주소 접두사를 붙여 돌려줘도 같은 판정
  const prefixed=make({admin:fakeAdmin(),ms:fakeMicrosoft({tokenReply:()=>({status:200,body:{access_token:ACCESS,refresh_token:REFRESH2,scope:'https://graph.microsoft.com/Files.ReadWrite https://graph.microsoft.com/User.Read',expires_in:3600}})})});
  const ok=await post(prefixed.handler,{action:'auth-finish',code:'synthetic-code-123',state:await startState(prefixed.handler)});
  assert.equal(ok.status,200);assert.equal(prefixed.admin.state.writes.at(-1).v.scope,'files.readwrite user.read');
  const rejected=make({admin:fakeAdmin(),ms:fakeMicrosoft({tokenReply:()=>({status:400,body:{error:'invalid_grant'}})})});
  const state=await startState(rejected.handler);
  assert.equal((await post(rejected.handler,{action:'auth-finish',code:'synthetic-code-123',state})).status,424);
});

test('folder list: sub-folders only, sorted; folder-set refuses non-folders, the drive root and other ids',async()=>{
  const ms=fakeMicrosoft({items:{root:{first:[{id:'F2',name:'문서',folder:{}},{id:'P1',name:'a.jpg',file:{mimeType:'image/jpeg'}},{id:'F1!100',name:'가사진',folder:{}}]}},
    itemById:{'F1!100':{id:'F1!100',name:'카메라',folder:{},parentReference:{path:'/drive/root:/Pictures'}},ROOT:{id:'ROOT',name:'root',folder:{},parentReference:{}},P1:{id:'P1',name:'a.jpg',file:{},parentReference:{path:'/drive/root:'}}}});
  const ctx=make({admin:fakeAdmin({row:{...connected,folder_id:null,folder_name:null,folder_path:null}}),ms});
  assert.deepEqual((await read(await post(ctx.handler,{action:'folders'}))).folders,[{id:'F1!100',name:'가사진'},{id:'F2',name:'문서'}]);
  assert.equal((await post(ctx.handler,{action:'folders',parent_id:'../x'})).status,400);
  for(const id of ['P1','ROOT','../../etc','']){assert.ok([400,404].includes((await post(ctx.handler,{action:'folder-set',folder_id:id})).status),id);}
  assert.equal((await post(ctx.handler,{action:'folder-set',folder_id:'F1!100'})).status,200);
  const patch=ctx.admin.state.writes.at(-1).v;assert.equal(patch.folder_path,'/drive/root:/Pictures/카메라');assert.equal(patch.folder_id,'F1!100');
  const none=make({admin:fakeAdmin()});assert.equal((await post(none.handler,{action:'folders'})).status,424);
});

test('photos: read from the server index, grouped by Seoul day, photos only (videos indexed but not in the diary), sub-folders included, month checked',async()=>{
  const top={id:'F1!100',name:'카메라',folder:{},parentReference:{id:'ROOT!1'}};
  const ms=fakeMicrosoft({deltaPages:[[top,
      {id:'A1',name:'a.jpg',file:{mimeType:'image/jpeg'},photo:{takenDateTime:'2026-10-13T00:30:00Z'},parentReference:{id:'F1!100'}}, // 카메라 벽시계 서울 10-13 00:30(UTC로는 10-12)
      {id:'A2',name:'b.heic',file:{mimeType:'image/heic'},photo:{takenDateTime:'2026-10-13T01:00:00Z'},parentReference:{id:'F1!100'}},
      {id:'A3',name:'c.mp4',file:{mimeType:'video/mp4'},photo:{takenDateTime:'2026-10-13T01:00:00Z'},parentReference:{id:'F1!100'}},
      {id:'A4',name:'d.jpg',file:{mimeType:'image/jpeg'},photo:{takenDateTime:'2026-10-01T05:00:00Z'},parentReference:{id:'F1!100'}}, // 카메라 벽시계 서울 10-01 05:00(UTC로는 09-30)
      {id:'A5',name:'e.jpg',file:{mimeType:'image/jpeg'},fileSystemInfo:{createdDateTime:'2026-10-20T00:00:00Z'},parentReference:{id:'F1!100'}},
      {id:'A6',name:'f.jpg',file:{mimeType:'image/jpeg'},photo:{takenDateTime:'2026-11-01T00:00:00Z'},parentReference:{id:'F1!100'}},
      {id:'SUB',name:'하위',folder:{},parentReference:{id:'F1!100'}}],
    [{id:'A7',name:'g.png',file:{mimeType:'image/png'},photo:{takenDateTime:'2026-10-13T02:00:00Z'},parentReference:{id:'F1!100'}},{id:'bad id!!/',name:'x',file:{mimeType:'image/png'},parentReference:{id:'F1!100'}},
     {id:'B1',name:'h.jpg',file:{mimeType:'image/jpeg'},photo:{takenDateTime:'2026-10-13T03:00:00Z'},parentReference:{id:'SUB'}}]]});
  const ctx=make({ms});
  const out=await read(await post(ctx.handler,{action:'photos',month:'2026-10'}));
  assert.equal(out.indexing,false);
  assert.deepEqual(Object.keys(out.days).sort(),['2026-10-01','2026-10-13','2026-10-20']);
  assert.deepEqual(out.days['2026-10-13'].map(p=>p.id),['A1','A2','A7','B1']);
  assert.equal(out.days['2026-10-20'][0].approx,true);assert.equal(out.days['2026-10-13'][0].approx,false);assert.equal(out.truncated,false);
  // 저장한 것은 목록 정보뿐: 사진 표 칸은 정해진 것만
  for(const r of ctx.admin.state.mem.tables.app_onedrive_photos)assert.deepEqual(Object.keys(r).sort(),['approx','duration_ms','enabled','height','item_id','kind','lat','lon','mime','name','orig_parent_id','parent_id',
    'screenshot','sha1','size_bytes','taken_at','taken_day','trashed_at','updated_at','width','workspace_id'].filter(k=>k!=='enabled'||'enabled' in r).sort());
  // 동영상(A3)도 색인하지만 일기 날짜 화면(photos)에는 사진만 나온다.
  assert.equal(ctx.admin.state.mem.tables.app_onedrive_photos.find(r=>r.item_id==='A3').kind,'video');
  for(const month of ['2026-13','2026-1','x',null,'2026-10-01'])assert.equal((await post(ctx.handler,{action:'photos',month})).status,400,String(month));
  assert.equal((await post(make({admin:fakeAdmin({row:{...connected,folder_id:null,folder_path:null}})}).handler,{action:'photos',month:'2026-10'})).status,424);
});

test('photo: only inside the chosen folder, thumbnail fetched server side without the token, size limited',async()=>{
  const inFolder={id:'A1',file:{mimeType:'image/jpeg'},parentReference:{path:'/drive/root:/Pictures/Camera/2026'}};
  const ms=fakeMicrosoft({itemById:{A1:inFolder,OUT:{id:'OUT',file:{mimeType:'image/jpeg'},parentReference:{path:'/drive/root:/Pictures/Camera2'}},
    VID:{id:'VID',file:{mimeType:'video/mp4'},parentReference:{path:'/drive/root:/Pictures/Camera'}},DIR:{id:'DIR',folder:{},parentReference:{path:'/drive/root:/Pictures/Camera'}}}});
  const ctx=make({ms});
  const r=await post(ctx.handler,{action:'photo',id:'A1',size:'large'});
  assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/jpeg');assert.equal(r.headers.get('cache-control'),'private, max-age=3600');
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[0xff,0xd8,0xff,1,2,3]);
  assert.ok(ms.calls.some(c=>c.url.includes('/thumbnails/0/c1600x1600/content')));
  assert.equal((await post(ctx.handler,{action:'photo',id:'OUT'})).status,403);
  for(const id of ['DIR','MISSING'])assert.equal((await post(ctx.handler,{action:'photo',id})).status,404,id);
  assert.equal((await post(ctx.handler,{action:'photo',id:'VID'})).status,200,'a video inside the folder has a thumbnail too');
  for(const body of [{id:'../x'},{id:'A1',size:'huge'},{id:'A1',size:'__proto__'},{}])assert.equal((await post(ctx.handler,{action:'photo',...body})).status,400);
  assert.equal((await post(make({admin:fakeAdmin()}).handler,{action:'photo',id:'A1'})).status,424);
  // 임시 주소가 내부 주소·http면 받지 않는다
  for(const location of ['http://thumbs.synthetic.example.test/t','https://127.0.0.1/t','https://localhost/t','/relative']){
    const bad=make({ms:fakeMicrosoft({itemById:{A1:inFolder},thumb:()=>new Response(null,{status:302,headers:{location}})})});
    assert.equal((await post(bad.handler,{action:'photo',id:'A1'})).status,502,location);
  }
  const notImage=make({ms:fakeMicrosoft({itemById:{A1:inFolder},thumb:()=>new Response('<html>',{headers:{'content-type':'text/html'}})})});
  assert.equal((await post(notImage.handler,{action:'photo',id:'A1'})).status,502);
});

test('photo-urls: many photos in one $batch, only photos and videos inside the chosen folder get an address, no token in the reply',async()=>{
  const inside=id=>({id,file:{mimeType:'image/jpeg'},parentReference:{path:'/drive/root:/Pictures/Camera/2026'}});
  const itemById={A1:inside('A1'),A2:inside('A2'),OUT:{id:'OUT',file:{mimeType:'image/jpeg'},parentReference:{path:'/drive/root:/Pictures/Camera2'}},
    VID:{id:'VID',file:{mimeType:'video/mp4'},parentReference:{path:'/drive/root:/Pictures/Camera'}},DIR:{id:'DIR',folder:{},parentReference:{path:'/drive/root:/Pictures/Camera'}}};
  for(let i=0;i<14;i++)itemById['P'+i]=inside('P'+i);
  const ms=fakeMicrosoft({itemById});const ctx=make({ms});
  const r=await post(ctx.handler,{action:'photo-urls',ids:['A1','A2','OUT','VID','DIR','MISSING','A1'],size:'large'});
  assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
  const text=await r.text(),out=JSON.parse(text);
  assert.deepEqual(out.urls,{A1:'https://thumbs.synthetic.example.test/u/A1/c1600x1600',A2:'https://thumbs.synthetic.example.test/u/A2/c1600x1600',VID:'https://thumbs.synthetic.example.test/u/VID/c1600x1600'});
  assert.deepEqual(out.failed,{OUT:'outside',DIR:'missing',MISSING:'missing'});
  assert.equal(out.retry_after,undefined);
  for(const secret of [ACCESS,REFRESH,REFRESH2])assert.ok(!text.includes(secret),'no token in the reply');
  const batches=ms.calls.filter(c=>c.url.endsWith('/$batch'));
  assert.equal(batches.length,1,'six distinct photos fit one $batch');
  assert.equal(JSON.parse(batches[0].init.body).requests.length,12);
  assert.ok(!ms.calls.some(c=>c.url.startsWith('https://thumbs.')),'the server does not download the pictures on this path');
  // 기본 크기는 small, 20장이면 Graph $batch 두 번(한 번에 10장 = 하위 요청 20개)
  const ids=[...Array(14).keys()].map(i=>'P'+i).concat(['A1','A2','OUT','VID','DIR','MISSING']);
  const before=ms.calls.filter(c=>c.url.endsWith('/$batch')).length;
  const small=await read(await post(ctx.handler,{action:'photo-urls',ids}));
  assert.equal(Object.keys(small.urls).length,17);assert.match(small.urls.P0,/\/c480x480$/);
  const after=ms.calls.filter(c=>c.url.endsWith('/$batch')).slice(before);
  assert.equal(after.length,2);assert.ok(after.every(c=>JSON.parse(c.init.body).requests.length<=20));
});

test('photo-urls: requests that arrive together share one token refresh',async()=>{
  const inside=id=>({id,file:{mimeType:'image/jpeg'},parentReference:{path:'/drive/root:/Pictures/Camera'}});
  const ms=fakeMicrosoft({itemById:{A1:inside('A1'),A2:inside('A2'),A3:inside('A3')}});const ctx=make({ms});
  const outs=await Promise.all(['A1','A2','A3'].map(id=>post(ctx.handler,{action:'photo-urls',ids:[id]}).then(read)));
  assert.deepEqual(outs.map(o=>Object.keys(o.urls)),[['A1'],['A2'],['A3']]);
  assert.equal(ms.calls.filter(c=>c.form).length,1,'one token request for three requests at once');
});

test('photo-urls: request shape and limits are checked before Microsoft is asked',async()=>{
  const ms=fakeMicrosoft();const ctx=make({ms});
  const many=[...Array(21).keys()].map(i=>'P'+i);
  for(const body of [{},{ids:[]},{ids:'A1'},{ids:many},{ids:['../x']},{ids:['A1',5]},{ids:['A1'],size:'huge'},{ids:['A1'],size:'__proto__'}])
    assert.equal((await post(ctx.handler,{action:'photo-urls',...body})).status,400,JSON.stringify(body).slice(0,40));
  assert.equal(ms.calls.length,0);
  assert.equal((await post(make({admin:fakeAdmin()}).handler,{action:'photo-urls',ids:['A1']})).status,424,'not connected');
  assert.equal((await post(make({admin:fakeAdmin({row:{...connected,folder_id:null,folder_path:null}})}).handler,{action:'photo-urls',ids:['A1']})).status,424,'no folder');
  assert.equal((await post(ctx.handler,{action:'photo-urls',ids:['A1']},{jwt:'other'})).status,403,'owner only');
  assert.equal((await post(ctx.handler,{action:'photo-urls',ids:['A1']},{jwt:null})).status,401);
});

test('photo-urls: Microsoft 429 on the batch or on one photo becomes failed:throttled with retry_after; unsafe addresses are dropped',async()=>{
  const inside=id=>({id,file:{mimeType:'image/jpeg'},parentReference:{path:'/drive/root:/Pictures/Camera'}});
  const whole=make({ms:fakeMicrosoft({itemById:{A1:inside('A1')},batchReply:()=>new Response('{}',{status:429,headers:{'retry-after':'17'}})})});
  assert.deepEqual(await read(await post(whole.handler,{action:'photo-urls',ids:['A1','A2']})),{urls:{},failed:{A1:'throttled',A2:'throttled'},retry_after:17});
  const one=make({ms:fakeMicrosoft({itemById:{A1:inside('A1'),A2:inside('A2'),A3:inside('A3')},subReply:q=>{
    if(q.url.includes('/A2/thumbnails'))return {status:429,headers:{'Retry-After':'4'},body:{}};
    if(q.url.includes('/A3/thumbnails'))return {status:200,body:{value:[{c480x480:{url:'http://thumbs.synthetic.example.test/plain'}}]}};
    return null;}})});
  const out=await read(await post(one.handler,{action:'photo-urls',ids:['A1','A2','A3']}));
  assert.deepEqual(Object.keys(out.urls),['A1']);
  assert.deepEqual(out.failed,{A2:'throttled',A3:'unavailable'});assert.equal(out.retry_after,4);
  const expired=make({ms:fakeMicrosoft({batchReply:()=>new Response('{}',{status:401})})});
  assert.equal((await post(expired.handler,{action:'photo-urls',ids:['A1']})).status,424);
  const broken=make({ms:fakeMicrosoft({batchReply:()=>new Response('{}',{status:500})})});
  assert.deepEqual(await read(await post(broken.handler,{action:'photo-urls',ids:['A1']})),{urls:{},failed:{A1:'unavailable'}});
});

test('refresh token rotation is saved, access token is reused, expired grant becomes 424',async()=>{
  const ms=fakeMicrosoft({deltaPages:[[],[],[]]});const ctx=make({ms});
  await post(ctx.handler,{action:'sync'});await post(ctx.handler,{action:'sync'});
  assert.equal(ms.calls.filter(c=>c.form).length,1,'one token request, then cached');
  assert.equal(ctx.admin.state.row.refresh_token,REFRESH2);
  const dead=make({ms:fakeMicrosoft({tokenReply:()=>({status:400,body:{error:'invalid_grant'}})})});
  const r=await post(dead.handler,{action:'photos',month:'2026-10'});assert.equal(r.status,424);assert.deepEqual(await read(r),{error:'onedrive_auth_expired'});
  const save=make({admin:fakeAdmin({row:{...connected},saveError:true})});assert.equal((await post(save.handler,{action:'sync'})).status,503);
  assert.equal(save.admin.state.row.index_lock_until,null,'lock is released after a failure');
});

test('disconnect deletes the stored connection; no response ever carries a token or secret',async()=>{
  const ctx=make();const r=await post(ctx.handler,{action:'disconnect'});
  assert.deepEqual(await read(r),{connected:false});assert.equal(ctx.admin.state.row,null);
  const all=make();
  for(const body of [{action:'status'},{action:'auth-start'},{action:'folders'},{action:'photos',month:'2026-10'}]){
    const text=await (await post(all.handler,body)).text();
    for(const secret of [REFRESH,REFRESH2,ACCESS,ENV.ONEDRIVE_CLIENT_SECRET])assert.ok(!text.includes(secret),body.action);
  }
});

test('scope rule: ReadWrite required, .All/AppFolder/Selected refused',()=>{
  assert.ok(scopeAllowed(normalizeScopes('Files.ReadWrite offline_access User.Read')));
  for(const bad of ['files.readwrite.all','files.read','files.readwrite.appfolder files.readwrite','files.readwrite.selected','files.readwrite sites.read.all',''])assert.ok(!scopeAllowed(normalizeScopes(bad)),bad);
});

test('helpers: path boundary, folder path, temporary address, Seoul day, Graph next link',()=>{
  assert.ok(insideFolder('/drive/root:/Pictures/Camera','/drive/root:/Pictures/Camera'));
  assert.ok(insideFolder('/drive/root:/Pictures/Camera/2026/10','/drive/root:/Pictures/Camera'));
  assert.ok(!insideFolder('/drive/root:/Pictures/Camera2','/drive/root:/Pictures/Camera'));
  assert.ok(!insideFolder('/drive/root:/Pictures','/drive/root:/Pictures/Camera'));
  assert.ok(insideFolder('/drive/root:/Pictures/%EC%B9%B4%EB%A9%94%EB%9D%BC','/drive/root:/Pictures/카메라'));
  assert.ok(!insideFolder(undefined,'/x')&&!insideFolder('/x',''));
  assert.equal(folderPathOf({id:'1',name:'카메라',parentReference:{path:'/drive/root:/Pictures/'}}),'/drive/root:/Pictures/카메라');
  assert.equal(folderPathOf({id:'1',name:'root',parentReference:{}}),null);
  assert.ok(safeDownloadUrl('https://a.b.test/x'));
  for(const bad of [null,'http://a.b.test/x','https://10.0.0.1/x','https://[::1]/x','https://localhost/x','https://a.local/x','https://u:p@a.b.test/x','nope'])assert.equal(safeDownloadUrl(bad),null,String(bad));
  assert.equal(seoulDay('2026-10-12T15:00:00Z'),'2026-10-13');assert.equal(seoulDay('x'),null);
  assert.ok(graphNextLink('https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=1'));
  for(const bad of ['https://evil.test/v1.0/x','http://graph.microsoft.com/x','https://graph.microsoft.com.evil.test/x','https://u@graph.microsoft.com/x',5])assert.equal(graphNextLink(bad),null,String(bad));
});

const inFolderItem={id:'A1',file:{mimeType:'image/jpeg'},parentReference:{path:'/drive/root:/Pictures/Camera/2026'}};
const deletes=ms=>ms.calls.filter(c=>c.init.method==='DELETE');

const moves=ms=>ms.calls.filter(c=>c.url.endsWith('/$batch')).flatMap(c=>JSON.parse(c.init.body).requests.filter(q=>q.method==='PATCH'));
const trashCreates=ms=>ms.calls.filter(c=>c.init.method==='POST'&&/\/children$/.test(c.url));

test('photo-delete: owner only, chosen folder only, needs confirm, moves into the Web2 trash folder (no DELETE) and keeps the stars',async()=>{
  const ms=fakeMicrosoft({itemById:{A1:{...inFolderItem},OUT:{id:'OUT',file:{mimeType:'image/jpeg'},parentReference:{path:'/drive/root:/Pictures/Camera2'}},
    VID:{id:'VID',file:{mimeType:'video/mp4'},parentReference:{path:'/drive/root:/Pictures/Camera'}},DIR:{id:'DIR',folder:{},parentReference:{path:'/drive/root:/Pictures/Camera'}},
    TOP:{id:'TOP',file:{mimeType:'image/jpeg'},parentReference:{path:'/drive/root:/Pictures'}}}});
  const ctx=make({ms});
  const r=await post(ctx.handler,{action:'photo-delete',id:'A1',confirm:true});
  assert.equal(r.status,200);assert.deepEqual(await read(r),{deleted:true,trashed:true});
  assert.equal(deletes(ms).length,0,'nothing goes to the OneDrive recycle bin directly');
  assert.equal(trashCreates(ms).length,1,'the Web2 trash folder is made once under the chosen folder');
  assert.ok(trashCreates(ms)[0].url.endsWith('/me/drive/items/F1!100/children'));
  assert.deepEqual(moves(ms).map(q=>[q.url,q.body.parentReference.id]),[['/me/drive/items/A1?@microsoft.graph.conflictBehavior=rename',TRASH]]);
  const trashRow=ctx.admin.state.mem.tables.app_onedrive_folders.find(f=>f.item_id===TRASH);
  assert.deepEqual([trashRow.role,trashRow.enabled,trashRow.parent_id,trashRow.name],['trash',false,'F1!100',TRASH_NAME]);
  // 동영상도 지운다(휴지통 폴더는 다시 만들지 않는다)
  assert.equal((await post(ctx.handler,{action:'photo-delete',id:'VID',confirm:true})).status,200);
  assert.equal(trashCreates(ms).length,1);
  // 폴더 밖·폴더 자체 위·사진 아님·없음: 옮기기 호출이 한 번도 나가지 않는다
  const before=moves(ms).length;
  assert.equal((await post(ctx.handler,{action:'photo-delete',id:'OUT',confirm:true})).status,403);
  assert.equal((await post(ctx.handler,{action:'photo-delete',id:'TOP',confirm:true})).status,403);
  for(const id of ['DIR','MISSING'])assert.equal((await post(ctx.handler,{action:'photo-delete',id,confirm:true})).status,404,id);
  for(const body of [{id:'A1'},{id:'A1',confirm:'true'},{id:'A1',confirm:1},{id:'../x',confirm:true},{confirm:true},{ids:[],confirm:true},{ids:['A1']},
    {ids:Array.from({length:51},(_,i)=>'Z'+i),confirm:true},{ids:['../x'],confirm:true},{ids:'A1',confirm:true}])
    assert.equal((await post(ctx.handler,{action:'photo-delete',...body})).status,400,JSON.stringify(body));
  assert.equal(moves(ms).length,before);
  // 다른 사용자·비로그인은 옮기기까지 못 간다
  assert.equal((await post(ctx.handler,{action:'photo-delete',id:'A1',confirm:true},{jwt:'other'})).status,403);
  assert.equal((await post(ctx.handler,{action:'photo-delete',id:'A1',confirm:true},{jwt:null})).status,401);
  assert.equal(moves(ms).length,before);assert.equal(deletes(ms).length,0);
  // 별표 표는 건드리지 않는다(이 함수는 연결·색인 표 밖을 쓰지 않는다)
  assert.equal(ctx.admin.state.writes.filter(w=>w.op==='delete').length,0);
});

test('photo-delete: folder not chosen, not connected, read-only grant and Graph answers map to safe errors',async()=>{
  assert.equal((await post(make({admin:fakeAdmin()}).handler,{action:'photo-delete',id:'A1',confirm:true})).status,424);
  assert.equal((await post(make({admin:fakeAdmin({row:{...connected,folder_id:null,folder_name:null,folder_path:null}})}).handler,{action:'photo-delete',id:'A1',confirm:true})).status,424);
  const readOnly=make({admin:fakeAdmin({row:{...connected,scope:'files.read user.read'}}),ms:fakeMicrosoft({itemById:{A1:{...inFolderItem}}})});
  const r=await post(readOnly.handler,{action:'photo-delete',id:'A1',confirm:true});
  assert.equal(r.status,424);assert.deepEqual(await read(r),{error:'onedrive_reconnect_needed'});assert.equal(moves(readOnly.ms).length,0);assert.equal(trashCreates(readOnly.ms).length,0);
  assert.equal((await read(await post(readOnly.handler,{action:'status'}))).can_delete,false);
  for(const [status,want,error] of [[404,404,'onedrive_item_missing'],[403,424,'onedrive_reconnect_needed'],[409,502,'onedrive_delete_failed'],[500,502,'onedrive_delete_failed']]){
    const ctx=make({ms:fakeMicrosoft({itemById:{A1:{...inFolderItem}},moveReply:()=>status})});
    const out=await post(ctx.handler,{action:'photo-delete',id:'A1',confirm:true});assert.equal(out.status,want,String(status));assert.deepEqual(await read(out),{error});
  }
  const expired=make({ms:fakeMicrosoft({itemById:{A1:{...inFolderItem}},batchReply:()=>new Response('{}',{status:401})})});
  assert.deepEqual(await read(await post(expired.handler,{action:'photo-delete',id:'A1',confirm:true})),{error:'onedrive_auth_expired'});
  const busy=make({ms:fakeMicrosoft({itemById:{A1:{...inFolderItem}},batchReply:()=>new Response('{}',{status:429,headers:{'retry-after':'7'}})})});
  const t=await post(busy.handler,{action:'photo-delete',id:'A1',confirm:true});assert.equal(t.status,429);assert.deepEqual(await read(t),{retry_after:7,error:'onedrive_throttled'});
  const down=make({ms:{calls:[],fetch:async(url,init)=>{if(String(url).endsWith('/$batch'))throw new Error('net');return fakeMicrosoft({itemById:{A1:{...inFolderItem}}}).fetch(url,init);}}});
  assert.equal((await post(down.handler,{action:'photo-delete',id:'A1',confirm:true})).status,503);
});

test('the new function is pre-registered once in the section 5 table with verify_jwt true',async()=>{
  const {readFileSync}=await import('node:fs');
  const doc=readFileSync('docs/web2-env6b-edge-source.md','utf8');
  const rows=doc.split('\n').filter(l=>/^\|\s*\d+\s*\|\s*`onedrive-photos`/.test(l));
  assert.equal(rows.length,1);assert.equal(rows[0].split('|')[6].replace(/[*\s]/g,''),'true');
  const index=readFileSync('supabase/functions/onedrive-photos/index.ts','utf8');
  assert.match(index,/verify_jwt=true/);
});

// ── 사진 색인(2026-10-28): 달마다 폴더를 훑지 않고 delta를 나눠 받아 서버 표에 적는다 ──
const topItem={id:'F1!100',name:'카메라',folder:{},parentReference:{id:'ROOT!1'}};
const pic=(id,parent,at='2026-10-13T01:00:00Z')=>({id,name:'img-'+id+'.jpg',file:{mimeType:'image/jpeg'},photo:{takenDateTime:at},parentReference:{id:parent}});
const dir=(id,parent,name=id)=>({id,name,folder:{},parentReference:{id:parent}});
const tree=()=>[[topItem,dir('S1','F1!100','2025'),dir('S2','F1!100','2026'),dir('S21','S2','여행'),
  pic('P0','F1!100'),pic('P1','S1'),pic('P2','S2'),pic('P3','S21'),pic('P4','S21',  '2026-09-01T01:00:00Z')]];

test('sync: pages are cut per request (more:true), the next-page link is saved and the next request continues; only Graph links',async()=>{
  const pages=Array.from({length:20},(_,i)=>[pic('Q'+i,'F1!100')]);pages[0].unshift(topItem);
  const ms=fakeMicrosoft({deltaPages:pages});const ctx=make({ms});
  const first=await read(await post(ctx.handler,{action:'sync'}));
  assert.deepEqual(first,{more:true,indexing:true});
  assert.match(ctx.admin.state.row.next_link,/^https:\/\/graph\.microsoft\.com\/.*token=15$/);assert.equal(ctx.admin.state.row.index_lock_until,null);
  assert.equal(ctx.admin.state.mem.tables.app_onedrive_photos.length,15);
  const second=await read(await post(ctx.handler,{action:'sync'}));
  assert.deepEqual(second,{more:false,indexing:false});
  assert.equal(ctx.admin.state.row.next_link,null);assert.match(ctx.admin.state.row.delta_link,/token=latest$/);
  assert.equal(ctx.admin.state.mem.tables.app_onedrive_photos.length,20);
  // 저장된 주소가 Graph 주소가 아니면 따라가지 않고 처음부터 받는다
  const evil=make({admin:fakeAdmin({row:{...connected,next_link:'https://evil.example.test/steal'}}),ms:fakeMicrosoft({deltaPages:tree()})});
  await post(evil.handler,{action:'sync'});
  assert.ok(evil.ms.calls.every(c=>!c.url.includes('evil.example.test')));
});

test('sync: a second request while one runs is refused with onedrive_index_busy; an expired lock is taken over',async()=>{
  const busy=make({admin:fakeAdmin({row:{...connected,index_lock_until:new Date(NOW+30000).toISOString()}}),ms:fakeMicrosoft({deltaPages:tree()})});
  const r=await post(busy.handler,{action:'sync'});assert.equal(r.status,409);assert.deepEqual(await read(r),{error:'onedrive_index_busy'});
  assert.equal(busy.ms.calls.length,0,'no Microsoft call while busy');
  const stale=make({admin:fakeAdmin({row:{...connected,index_lock_until:new Date(NOW-1000).toISOString()}}),ms:fakeMicrosoft({deltaPages:tree()})});
  assert.equal((await post(stale.handler,{action:'sync'})).status,200);
  // 달 조회는 바쁘면 색인을 건너뛰고 지금까지의 표로 답한다
  assert.equal((await post(busy.handler,{action:'photos',month:'2026-10'})).status,200);
});

test('sync: Graph 429/503 becomes onedrive_throttled with Retry-After, progress so far is kept and the lock released',async()=>{
  const pages=[[topItem,pic('A','F1!100')],[pic('B','F1!100')]];
  for(const [status,header,want] of [[429,'120',120],[503,null,30],[429,'0',1]]){
    const ms=fakeMicrosoft({deltaPages:pages,deltaReply:tok=>tok==='1'?new Response('{}',{status,headers:header===null?{}:{'retry-after':header}}):null});
    const ctx=make({ms});const r=await post(ctx.handler,{action:'sync'});
    assert.equal(r.status,429);assert.deepEqual(await read(r),{retry_after:want,error:'onedrive_throttled'});
    assert.match(ctx.admin.state.row.next_link,/token=1$/);assert.equal(ctx.admin.state.row.index_lock_until,null);
    assert.deepEqual(ctx.admin.state.mem.tables.app_onedrive_photos.map(p=>p.item_id),['A']);
  }
  // 달 조회는 요청 많음이면 건너뛰고 답한다(화면이 일반 실패 문구를 띄우지 않게)
  const ms=fakeMicrosoft({deltaPages:pages,deltaReply:()=>new Response('{}',{status:429,headers:{'retry-after':'5'}})});
  const out=await post(make({ms}).handler,{action:'photos',month:'2026-10'});assert.equal(out.status,200);assert.equal((await read(out)).indexing,true);
});

test('sync: 410 from Graph clears the index and starts over; deleted items and non-photos leave the index',async()=>{
  const ctx=make({ms:fakeMicrosoft({deltaPages:tree()})});await post(ctx.handler,{action:'sync'});
  assert.equal(ctx.admin.state.mem.tables.app_onedrive_photos.length,5);
  ctx.ms.calls.length=0;
  const changes=[{id:'P1',deleted:{}},{id:'S21',deleted:{}},{id:'P2',name:'now.mp4',file:{mimeType:'video/mp4'},parentReference:{id:'S2'}}];
  const later=createOneDriveHandler(ctx.admin,{env:n=>ENV[n],takenFixAt:FIX0,fetch:fakeMicrosoft({deltaPages:tree(),deltaChanges:changes}).fetch,now:()=>NOW,log:()=>{}});
  assert.deepEqual(await read(await post(later,{action:'sync'})),{more:false,indexing:false});
  assert.deepEqual(ctx.admin.state.mem.tables.app_onedrive_photos.map(p=>p.item_id).sort(),['P0']);
  assert.ok(!ctx.admin.state.mem.tables.app_onedrive_folders.some(f=>f.item_id==='S21'));
  let gone=0;
  const resync=createOneDriveHandler(ctx.admin,{env:n=>ENV[n],takenFixAt:FIX0,fetch:fakeMicrosoft({deltaPages:tree(),deltaReply:tok=>tok==='latest'&&!gone++?new Response('{}',{status:410}):null}).fetch,now:()=>NOW,log:()=>{}});
  assert.deepEqual(await read(await post(resync,{action:'sync'})),{more:false,indexing:false});
  assert.equal(ctx.admin.state.mem.tables.app_onedrive_photos.length,5,'rebuilt from the first page');
});

test('folders-tree and folder-toggle: counts per folder, switching a folder off hides it and everything below it',async()=>{
  const ctx=make({ms:fakeMicrosoft({deltaPages:tree()})});await post(ctx.handler,{action:'sync'});
  const t=await read(await post(ctx.handler,{action:'folders-tree'}));
  assert.deepEqual(t.top,{id:'F1!100',name:'카메라',count:1,total:5});assert.equal(t.indexing,false);
  assert.deepEqual(t.folders.map(f=>[f.id,f.parent_id,f.enabled,f.count,f.total]),[['S1','F1!100',true,1,1],['S2','F1!100',true,1,3],['S21','S2',true,2,2]]);
  const days=async()=>(await read(await post(ctx.handler,{action:'photos',month:'2026-10'}))).days['2026-10-13'].map(p=>p.id);
  assert.deepEqual(await days(),['P0','P1','P2','P3']);
  assert.deepEqual(await read(await post(ctx.handler,{action:'folder-toggle',folder_id:'S2',enabled:false})),{folder:{id:'S2',enabled:false}});
  assert.deepEqual(await days(),['P0','P1'],'S2 and its sub-folder S21 are hidden');
  await post(ctx.handler,{action:'folder-toggle',folder_id:'S2',enabled:true});await post(ctx.handler,{action:'folder-toggle',folder_id:'S21',enabled:false});
  assert.deepEqual(await days(),['P0','P1','P2']);
  // 다음 변경 받기가 켜짐 설정을 덮지 않는다
  await post(ctx.handler,{action:'sync'});assert.equal(ctx.admin.state.mem.tables.app_onedrive_folders.find(f=>f.item_id==='S21').enabled,false);
  for(const body of [{folder_id:'F1!100',enabled:false},{folder_id:'S1',enabled:'false'},{folder_id:'../x',enabled:true},{enabled:true}])
    assert.equal((await post(ctx.handler,{action:'folder-toggle',...body})).status,400,JSON.stringify(body));
  assert.equal((await post(ctx.handler,{action:'folder-toggle',folder_id:'NOPE',enabled:true})).status,404);
  assert.equal((await post(ctx.handler,{action:'folder-toggle',folder_id:'S1',enabled:true},{jwt:'other'})).status,403);
});

test('index belongs to the chosen top folder: changing it, reconnecting and disconnecting clear it; delete removes the row',async()=>{
  const ms=fakeMicrosoft({deltaPages:tree(),itemById:{
    'F9!1':{id:'F9!1',name:'다른',folder:{},parentReference:{path:'/drive/root:'}},
    'F1!100':{id:'F1!100',name:'카메라',folder:{},parentReference:{path:'/drive/root:/Pictures'}},
    P3:{id:'P3',file:{mimeType:'image/jpeg'},parentReference:{path:'/drive/root:/Pictures/Camera/2026/여행'}}}});
  const ctx=make({ms});await post(ctx.handler,{action:'sync'});
  await post(ctx.handler,{action:'folder-toggle',folder_id:'S1',enabled:false});
  // 같은 폴더를 다시 고르면 그대로(경로만 갱신), 다른 폴더면 비움
  ctx.admin.state.row.folder_path='/drive/root:/Pictures/카메라';
  await post(ctx.handler,{action:'folder-set',folder_id:'F1!100'});
  assert.equal(ctx.admin.state.mem.tables.app_onedrive_photos.length,5);assert.ok(ctx.admin.state.row.delta_link);
  ctx.admin.state.row.folder_path='/drive/root:/Pictures/Camera';
  assert.equal((await post(ctx.handler,{action:'photo-delete',id:'P3',confirm:true})).status,200);
  const p3=ctx.admin.state.mem.tables.app_onedrive_photos.find(p=>p.item_id==='P3');
  assert.deepEqual([p3.parent_id,p3.orig_parent_id,typeof p3.trashed_at],[TRASH,'S21','string'],'the row moves into the Web2 trash with its original folder');
  await post(ctx.handler,{action:'folder-set',folder_id:'F9!1'});
  assert.equal(ctx.admin.state.mem.tables.app_onedrive_photos.length,0);assert.equal(ctx.admin.state.mem.tables.app_onedrive_folders.length,0);
  assert.equal(ctx.admin.state.row.delta_link,null);assert.equal(ctx.admin.state.row.index_done_at,null);
  const again=make({ms:fakeMicrosoft({deltaPages:tree()})});await post(again.handler,{action:'sync'});
  await post(again.handler,{action:'auth-finish',code:'synthetic-code-123',state:await startState(again.handler)});
  assert.equal(again.admin.state.mem.tables.app_onedrive_photos.length,0);assert.equal(again.admin.state.row.delta_link,null);
  const bye=make({ms:fakeMicrosoft({deltaPages:tree()})});await post(bye.handler,{action:'sync'});
  await post(bye.handler,{action:'disconnect'});assert.equal(bye.admin.state.mem.tables.app_onedrive_photos.length,0);
});

test('index responses carry list facts only: no token, secret or Graph link',async()=>{
  const ctx=make({ms:fakeMicrosoft({deltaPages:tree()})});
  for(const body of [{action:'sync'},{action:'folders-tree'},{action:'photos',month:'2026-10'}]){
    const text=await (await post(ctx.handler,body)).text();
    for(const secret of [REFRESH,REFRESH2,ACCESS,ENV.ONEDRIVE_CLIENT_SECRET,'graph.microsoft.com','token='])assert.ok(!text.includes(secret),body.action+' '+secret);
  }
});

// ── OD-미리받기(2026-10-28): 일기 탭을 열 때 서버가 Microsoft를 몇 번 부르는지 잰다(새로 뜬 서버 = 토큰 기억 없음) ──
// 일기 탭 첫 열기의 차례: status → photos(이번 달) → (날짜를 열면) photo-urls. photos는 마지막 받기가 10분 넘었으면 그 자리에서 delta를 받는다.
test('measure: Microsoft round trips per diary entry step on a cold server; photos waits for delta only when the last sync is over 10 minutes old',async()=>{
  const kinds=calls=>calls.map(c=>c.url.startsWith('https://login.microsoftonline.com/')?'token':c.url.includes('/$batch')?'batch':c.url.includes('/delta')?'delta':'other');
  const iso=ms=>new Date(NOW-ms).toISOString();
  const row=ago=>({...connected,index_done_at:iso(86400000),synced_at:iso(ago),delta_link:'https://graph.microsoft.com/v1.0/me/drive/items/F1!100/delta?token=latest'});
  const steps=async ago=>{
    const ms=fakeMicrosoft({deltaPages:tree(),itemById:{P0:{id:'P0',file:{mimeType:'image/jpeg'},parentReference:{path:'/drive/root:/Pictures/Camera'}}}});
    const ctx=make({admin:fakeAdmin({row:row(ago)}),ms});
    const out={};
    for(const [name,body] of [['status',{action:'status'}],['photos',{action:'photos',month:'2026-10'}],['photo-urls',{action:'photo-urls',ids:['P0'],size:'small'}]]){
      const before=ms.calls.length;assert.equal((await post(ctx.handler,body)).status,200,name);out[name]=kinds(ms.calls.slice(before));
    }
    return out;
  };
  // 11분 전에 받았음(앱을 오래 안 열었음): photos가 토큰 새로 받기 + delta 한 쪽을 기다린 뒤 답한다. photo-urls는 같은 서버면 토큰을 다시 쓴다.
  assert.deepEqual(await steps(11*60000),{status:[],photos:['token','delta'],'photo-urls':['batch']});
  // 2분 전에 받았음(미리 받기가 먼저 돈 뒤): photos는 Microsoft를 부르지 않고 서버 표만 읽는다. 토큰은 photo-urls에서 처음 받는다.
  assert.deepEqual(await steps(2*60000),{status:[],photos:[],'photo-urls':['token','batch']});
});

// ── 사진 메뉴 ①(PHOTO-사진메뉴): library·months·days·media-url·여러 장 지우기·Web2 휴지통 ─────────────────────────
const fresh={...connected,index_done_at:'2026-10-26T02:59:00Z',synced_at:'2026-10-26T02:59:00Z',delta_link:'https://graph.microsoft.com/v1.0/me/drive/items/F1!100/delta?token=latest'};
const WSX=WS;
const frow=(item_id,parent_id,name=item_id,extra={})=>({workspace_id:WSX,item_id,parent_id,name,enabled:true,role:null,updated_at:'2026-10-26T00:00:00Z',...extra});
const prow=(item_id,parent_id,taken_at,extra={})=>({workspace_id:WSX,item_id,parent_id,name:'img-'+item_id+'.jpg',taken_at,approx:false,taken_day:taken_at.slice(0,10),
  kind:'photo',mime:'image/jpeg',size_bytes:1000,width:4000,height:3000,duration_ms:null,sha1:null,lat:null,lon:null,screenshot:false,trashed_at:null,orig_parent_id:null,
  updated_at:'2026-10-26T00:00:00Z',...extra});
// 맨 위 F1!100 아래 S1(켜짐)·OFF(꺼짐)·휴지통. 같은 시각 사진 묶음(T1~T5)이 쪽 경계를 넘는다.
function library(){
  const folders=[frow('F1!100',null,'카메라'),frow('S1','F1!100','2026'),frow('OFF','F1!100','숨김',{enabled:false}),frow(TRASH,'F1!100',TRASH_NAME,{enabled:false,role:'trash'})];
  const photos=[prow('A1','F1!100','2026-10-20T01:00:00Z'),prow('A2','S1','2026-10-19T01:00:00Z',{kind:'video',mime:'video/mp4',duration_ms:42000}),
    prow('A3','S1','2026-10-18T01:00:00Z',{screenshot:true,mime:'image/png'}),prow('H1','OFF','2026-10-17T01:00:00Z'),
    ...['T1','T2','T3','T4','T5'].map(id=>prow(id,'F1!100','2026-10-16T01:00:00Z')),prow('B1','S1','2026-09-03T01:00:00Z'),
    prow('X1',TRASH,'2026-10-21T01:00:00Z',{trashed_at:'2026-10-25T00:00:00Z',orig_parent_id:'S1'})];
  return {app_onedrive_folders:folders,app_onedrive_photos:photos};
}
const lib=(opts={})=>make({admin:fakeAdmin({row:{...fresh},index:library()}),...opts});
const ids=out=>out.items.map(i=>i.id);

test('library: newest first, visible folders only (off and Web2 trash hidden), list facts only, no Graph call when the index is fresh',async()=>{
  const ctx=lib();
  const r=await post(ctx.handler,{action:'library'});assert.equal(r.status,200);
  const text=await r.text(),out=JSON.parse(text);
  assert.deepEqual(ids(out),['A1','A2','A3','T5','T4','T3','T2','T1','B1']);
  assert.equal(out.next_cursor,null);assert.equal(out.indexing,false);
  assert.deepEqual(out.items[1],{id:'A2',name:'img-A2.jpg',taken_at:'2026-10-19T01:00:00.000Z',approx:false,day:'2026-10-19',kind:'video',mime:'video/mp4',width:4000,height:3000,duration_ms:42000,screenshot:false});
  assert.ok(!/lat|lon|sha1|graph\.microsoft|synthetic-refresh|synthetic-access/.test(text),'no location, hash, Graph link or token');
  assert.equal(ctx.ms.calls.length,0);
});

test('library: cursor pages walk ties at the same second without gaps or repeats; filters video/shot/star and folder_id',async()=>{
  const ctx=lib();const seen=[];let cursor=null;
  for(let i=0;i<10;i++){const out=await read(await post(ctx.handler,{action:'library',limit:2,...(cursor?{cursor}:{})}));seen.push(...ids(out));cursor=out.next_cursor;if(!cursor)break;}
  assert.deepEqual(seen,['A1','A2','A3','T5','T4','T3','T2','T1','B1']);
  assert.deepEqual(ids(await read(await post(ctx.handler,{action:'library',filter:'video'}))),['A2']);
  assert.deepEqual(ids(await read(await post(ctx.handler,{action:'library',filter:'shot'}))),['A3']);
  assert.deepEqual(ids(await read(await post(ctx.handler,{action:'library',filter:'star',star_ids:['B1','T2','H1','X1','NOPE']}))),['T2','B1'],'stars only among visible, not trashed');
  assert.deepEqual(ids(await read(await post(ctx.handler,{action:'library',folder_id:'S1'}))),['A2','A3','B1']);
  assert.deepEqual(ids(await read(await post(ctx.handler,{action:'library',folder_id:'OFF'}))),['H1'],'a switched-off folder can still be opened by id');
  assert.equal((await post(ctx.handler,{action:'library',folder_id:TRASH})).status,404,'the trash folder is not a library folder');
  assert.equal((await post(ctx.handler,{action:'library',folder_id:'ELSEWHERE'})).status,404);
  for(const body of [{filter:'x'},{filter:'star'},{star_ids:'A1'},{star_ids:['../x']},{star_ids:Array.from({length:501},(_,i)=>'S'+i)},{limit:0},{limit:201},{limit:2.5},{limit:'5'},
    {cursor:'A1'},{cursor:{t:'nope',id:'A1'}},{cursor:{t:'2026-10-16T01:00:00Z',id:'../x'}},{cursor:[]},{folder_id:'../x'}])
    assert.equal((await post(ctx.handler,{action:'library',...body})).status,400,JSON.stringify(body));
  assert.equal((await post(make({admin:fakeAdmin({row:{...fresh,folder_id:null,folder_path:null}})}).handler,{action:'library'})).status,424);
  assert.equal((await post(ctx.handler,{action:'library'},{jwt:'other'})).status,403);
});

test('months and days: counts per month and day over visible photos, star cover first, filters shared with library',async()=>{
  const ctx=lib();
  const m=await read(await post(ctx.handler,{action:'months'}));
  assert.deepEqual(m,{months:{'2026-10':8,'2026-09':1},total:9,indexing:false});
  assert.deepEqual((await read(await post(ctx.handler,{action:'months',filter:'video'}))).months,{'2026-10':1});
  const d=await read(await post(ctx.handler,{action:'days',month:'2026-10'}));
  assert.deepEqual(Object.keys(d.days).sort(),['2026-10-16','2026-10-18','2026-10-19','2026-10-20']);
  assert.deepEqual(d.days['2026-10-16'],{count:5,cover:{id:'T1',kind:'photo'}});
  assert.deepEqual((await read(await post(ctx.handler,{action:'days',month:'2026-10',star_ids:['T4']}))).days['2026-10-16'].cover,{id:'T4',kind:'photo'});
  assert.deepEqual((await read(await post(ctx.handler,{action:'days',month:'2026-10'}))).days['2026-10-19'].cover.kind,'video');
  for(const month of ['2026-13','x',null])assert.equal((await post(ctx.handler,{action:'days',month})).status,400);
  assert.equal((await post(ctx.handler,{action:'months',filter:'star'})).status,400,'star needs star_ids');
});

test('media-url: a short-lived address for one photo or video inside the chosen folder; play is videos only; no token in the reply',async()=>{
  const itemById={V1:{id:'V1',name:'clip.mp4',size:5,file:{mimeType:'video/mp4'},parentReference:{path:'/drive/root:/Pictures/Camera/2026'}},
    P1:{id:'P1',name:'a.jpg',size:3,file:{mimeType:'image/jpeg'},parentReference:{path:'/drive/root:/Pictures/Camera'}},
    OUT:{id:'OUT',file:{mimeType:'video/mp4'},parentReference:{path:'/drive/root:/Pictures/Camera2'}},DOC:{id:'DOC',file:{mimeType:'application/pdf'},parentReference:{path:'/drive/root:/Pictures/Camera'}}};
  const ctx=make({ms:fakeMicrosoft({itemById})});
  const r=await post(ctx.handler,{action:'media-url',id:'V1',purpose:'play'});const text=await r.text();
  assert.equal(r.status,200);assert.deepEqual(JSON.parse(text),{url:'https://media.synthetic.example.test/d/V1',expires_in:3000,kind:'video',mime:'video/mp4',size:5,name:'clip.mp4'});
  for(const secret of [ACCESS,REFRESH,REFRESH2])assert.ok(!text.includes(secret));
  assert.ok(ctx.ms.calls.some(c=>/\$select=.*@microsoft\.graph\.downloadUrl/.test(decodeURIComponent(c.url))));
  assert.equal((await read(await post(ctx.handler,{action:'media-url',id:'P1'}))).kind,'photo');
  assert.equal((await post(ctx.handler,{action:'media-url',id:'P1',purpose:'play'})).status,400);
  assert.equal((await post(ctx.handler,{action:'media-url',id:'OUT',purpose:'download'})).status,403);
  for(const id of ['DOC','MISSING'])assert.equal((await post(ctx.handler,{action:'media-url',id})).status,404,id);
  for(const body of [{id:'../x'},{id:'V1',purpose:'stream'},{}])assert.equal((await post(ctx.handler,{action:'media-url',...body})).status,400);
  const unsafe=make({ms:{calls:[],fetch:async(url,init)=>{const res=await fakeMicrosoft({itemById}).fetch(url,init);
    if(String(url).includes('downloadUrl')){const b=await res.json();b['@microsoft.graph.downloadUrl']='http://127.0.0.1/x';return new Response(JSON.stringify(b));}return res;}}});
  assert.equal((await post(unsafe.handler,{action:'media-url',id:'V1'})).status,502);
});

test('photo-delete with ids: up to 50 in $batch, per-photo results, index rows move into the trash with their folder',async()=>{
  const itemById={};
  for(const id of ['A1','A2','A3','B1'])itemById[id]={id,name:'img-'+id+'.jpg',file:{mimeType:id==='A2'?'video/mp4':'image/jpeg'},parentReference:{id:id==='A1'?'F1!100':'S1',path:'/drive/root:/Pictures/Camera/2026'}};
  itemById.OUT={id:'OUT',file:{mimeType:'image/jpeg'},parentReference:{path:'/drive/root:/Elsewhere'}};
  const ctx=lib({ms:fakeMicrosoft({itemById,trashExists:true,moveReply:id=>id==='B1'?409:0})});
  const out=await read(await post(ctx.handler,{action:'photo-delete',ids:['A1','A2','A3','B1','OUT','MISSING','A1'],confirm:true}));
  assert.deepEqual(out,{deleted:false,moved:['A1','A2','A3'],failed:{B1:'move_failed',OUT:'outside',MISSING:'missing'}});
  assert.equal(trashCreates(ctx.ms).length,0,'the trash folder already exists (index row checked against OneDrive)');
  const rows=Object.fromEntries(ctx.admin.state.mem.tables.app_onedrive_photos.map(r=>[r.item_id,r]));
  assert.deepEqual(['A1','A2','A3'].map(id=>[rows[id].parent_id,rows[id].orig_parent_id,!!rows[id].trashed_at]),[[TRASH,'F1!100',true],[TRASH,'S1',true],[TRASH,'S1',true]]);
  assert.equal(rows.B1.parent_id,'S1');assert.equal(rows.B1.trashed_at,null);
  assert.deepEqual(ids(await read(await post(ctx.handler,{action:'library'}))),['T5','T4','T3','T2','T1','B1'],'trashed photos leave the library at once');
  assert.ok(ctx.ms.calls.filter(c=>c.url.endsWith('/$batch')).every(c=>JSON.parse(c.init.body).requests.length<=20));
});

test('Web2 trash: found again by name when the index lost it; a vanished trash folder is replaced; folder-toggle and folders-tree never show it',async()=>{
  // 색인에 휴지통 표시가 없고 원드라이브에는 이미 있음(다른 기기에서 만듦) → 만들기 409 → 이름으로 찾아 쓴다.
  const index=library();index.app_onedrive_folders=index.app_onedrive_folders.filter(f=>f.item_id!==TRASH);index.app_onedrive_photos=index.app_onedrive_photos.filter(p=>p.item_id!=='X1');
  const itemById={A1:{id:'A1',name:'a.jpg',file:{mimeType:'image/jpeg'},parentReference:{id:'F1!100',path:'/drive/root:/Pictures/Camera'}}};
  const ctx=make({admin:fakeAdmin({row:{...fresh},index}),ms:fakeMicrosoft({itemById,trashExists:true})});
  assert.equal((await post(ctx.handler,{action:'photo-delete',id:'A1',confirm:true})).status,200);
  assert.equal(trashCreates(ctx.ms).length,1);assert.ok(ctx.ms.calls.some(c=>c.url.includes(':/'+encodeURIComponent(TRASH_NAME)+':')));
  assert.equal(ctx.admin.state.mem.tables.app_onedrive_folders.find(f=>f.item_id===TRASH).role,'trash');
  // 색인의 휴지통 폴더가 원드라이브에서 사라졌으면 표시를 떼고 새로 만든다.
  const gone=lib({ms:fakeMicrosoft({itemById:{A1:{...itemById.A1,parentReference:{...itemById.A1.parentReference}}}})});
  const r=await post(gone.handler,{action:'photo-delete',id:'A1',confirm:true});assert.equal(r.status,200);
  assert.equal(trashCreates(gone.ms).length,1);
  // 휴지통 폴더는 켤 수 없고 폴더 트리에 없다.
  const t=lib();
  assert.equal((await post(t.handler,{action:'folder-toggle',folder_id:TRASH,enabled:true})).status,404);
  const tree=await read(await post(t.handler,{action:'folders-tree'}));
  assert.deepEqual(tree.folders.map(f=>f.id).sort(),['OFF','S1']);assert.equal(tree.top.total,10,'switched-off folders still count, the trash does not');
});

test('trash-list stamps photos moved in from the OneDrive app, sends ones over 30 days to the OneDrive recycle bin (20 per visit), lists the rest',async()=>{
  const index=library();
  index.app_onedrive_photos.push(prow('OLD1',TRASH,'2026-08-01T01:00:00Z',{trashed_at:'2026-09-01T00:00:00Z',orig_parent_id:'S1'}),prow('APP1',TRASH,'2026-10-01T01:00:00Z'));
  const itemById={OLD1:{id:'OLD1',file:{mimeType:'image/jpeg'},parentReference:{id:TRASH,path:'/drive/root:/Pictures/Camera/'+TRASH_NAME}}};
  const ctx=make({admin:fakeAdmin({row:{...fresh},index}),ms:fakeMicrosoft({itemById})});
  const out=await read(await post(ctx.handler,{action:'trash-list'}));
  assert.equal(out.purged,1);assert.deepEqual(out.items.map(i=>i.id),['APP1','X1']);
  assert.equal(out.items[0].trashed_at,new Date(NOW).toISOString());
  assert.deepEqual(out.items[1].from,{id:'S1',name:'2026'});assert.equal(out.items[1].purge_at,'2026-11-24T00:00:00.000Z');
  const dels=ctx.ms.calls.filter(c=>c.url.endsWith('/$batch')).flatMap(c=>JSON.parse(c.init.body).requests.filter(q=>q.method==='DELETE'));
  assert.deepEqual(dels.map(q=>q.url),['/me/drive/items/OLD1']);
  assert.ok(!ctx.admin.state.mem.tables.app_onedrive_photos.some(p=>p.item_id==='OLD1'));
  // 읽기 전용 권한이면 비우지 않고 목록만
  const ro=make({admin:fakeAdmin({row:{...fresh,scope:'files.read user.read'},index:library()}),ms:fakeMicrosoft()});
  assert.deepEqual((await read(await post(ro.handler,{action:'trash-list'}))).purged,0);assert.equal(ro.ms.calls.length,0);
  // 휴지통이 아직 없으면 빈 목록
  const none=make({admin:fakeAdmin({row:{...fresh}})});assert.deepEqual(await read(await post(none.handler,{action:'trash-list'})),{items:[],purged:0,truncated:false});
});

test('trash-restore moves back to the original folder (or the top folder when it is gone); trash-purge only touches the trash and needs confirm',async()=>{
  const index=library();
  index.app_onedrive_photos.push(prow('X2',TRASH,'2026-10-22T01:00:00Z',{trashed_at:'2026-10-25T00:00:00Z',orig_parent_id:'GONE'}));
  const inTrash=id=>({id,name:'img-'+id+'.jpg',file:{mimeType:'image/jpeg'},parentReference:{id:TRASH,path:'/drive/root:/Pictures/Camera/'+TRASH_NAME}});
  const itemById={X1:inTrash('X1'),X2:inTrash('X2'),A1:{id:'A1',file:{mimeType:'image/jpeg'},parentReference:{id:'F1!100',path:'/drive/root:/Pictures/Camera'}}};
  const ctx=make({admin:fakeAdmin({row:{...fresh},index}),ms:fakeMicrosoft({itemById,trashExists:true})});
  const out=await read(await post(ctx.handler,{action:'trash-restore',ids:['X1','X2','A1']}));
  assert.deepEqual(out,{restored:['X1','X2'].filter(Boolean).sort((a,b)=>a==='X1'?-1:1),failed:{A1:'not_in_trash'}});
  assert.deepEqual(moves(ctx.ms).map(q=>[q.url.split('?')[0],q.body.parentReference.id]).sort(),[['/me/drive/items/X1','S1'],['/me/drive/items/X2','F1!100']]);
  const rows=Object.fromEntries(ctx.admin.state.mem.tables.app_onedrive_photos.map(r=>[r.item_id,r]));
  assert.deepEqual([rows.X1.parent_id,rows.X1.trashed_at,rows.X1.orig_parent_id],['S1',null,null]);assert.equal(rows.X2.parent_id,'F1!100');
  assert.ok(ids(await read(await post(ctx.handler,{action:'library'}))).includes('X1'));
  // 바로 지우기: 휴지통 밖(A1)은 거절, confirm 없으면 400
  itemById.X3=inTrash('X3');ctx.admin.state.mem.tables.app_onedrive_photos.push(prow('X3',TRASH,'2026-10-23T01:00:00Z',{trashed_at:'2026-10-25T00:00:00Z'}));
  assert.equal((await post(ctx.handler,{action:'trash-purge',ids:['X3']})).status,400);
  const p=await read(await post(ctx.handler,{action:'trash-purge',ids:['X3','A1'],confirm:true}));
  assert.deepEqual(p,{purged:['X3'],failed:{A1:'not_in_trash'}});
  assert.ok(!ctx.admin.state.mem.tables.app_onedrive_photos.some(r=>r.item_id==='X3'));assert.ok(itemById.A1);
  const ro=make({admin:fakeAdmin({row:{...fresh,scope:'files.read user.read'},index:library()})});
  for(const action of ['trash-restore','trash-purge'])assert.deepEqual(await read(await post(ro.handler,{action,ids:['X1'],confirm:true})),{error:'onedrive_reconnect_needed'});
  const none=make({admin:fakeAdmin({row:{...fresh}})});assert.equal((await post(none.handler,{action:'trash-restore',ids:['X1']})).status,404);
});

test('delta indexing: videos, size, location, sha1 and screenshots fill the new columns; the trash folder is found by name and its photos keep their trash columns',async()=>{
  const vid={id:'V1',name:'clip.mov',size:2048,file:{mimeType:'video/quicktime',hashes:{sha1Hash:'0123456789ABCDEF0123456789ABCDEF01234567'}},video:{duration:42000,width:1920,height:1080},
    location:{latitude:37.5,longitude:127.0},fileSystemInfo:{createdDateTime:'2026-10-13T01:00:00Z'},parentReference:{id:'F1!100'}};
  const shot={...pic('S1X','F1!100'),name:'Screenshot_20261013-100000.png',file:{mimeType:'image/png'},image:{width:1080,height:2400},location:{latitude:95,longitude:1}};
  const ms=fakeMicrosoft({deltaPages:[[topItem,vid,shot,dir(TRASH,'F1!100',TRASH_NAME),pic('IN1',TRASH),{...pic('DOC','F1!100'),file:{mimeType:'application/pdf'}}]]});
  const ctx=make({ms,admin:fakeAdmin({row:{...connected},index:{app_onedrive_photos:[prow('IN1',TRASH,'2026-10-13T01:00:00Z',{trashed_at:'2026-10-20T00:00:00Z',orig_parent_id:'S1'})]}})});
  await post(ctx.handler,{action:'sync'});
  const rows=Object.fromEntries(ctx.admin.state.mem.tables.app_onedrive_photos.map(r=>[r.item_id,r]));
  assert.deepEqual([rows.V1.kind,rows.V1.mime,rows.V1.size_bytes,rows.V1.width,rows.V1.height,rows.V1.duration_ms,rows.V1.sha1,rows.V1.lat,rows.V1.lon,rows.V1.approx],
    ['video','video/quicktime',2048,1920,1080,42000,'0123456789abcdef0123456789abcdef01234567',37.5,127,true]);
  assert.deepEqual([rows.S1X.kind,rows.S1X.screenshot,rows.S1X.lat,rows.S1X.lon,rows.S1X.width],['photo',true,null,null,1080],'an out-of-range location is dropped');
  assert.ok(!rows.DOC);
  assert.deepEqual([rows.IN1.parent_id,rows.IN1.trashed_at,rows.IN1.orig_parent_id],[TRASH,'2026-10-20T00:00:00Z','S1'],'trash columns kept while the photo stays in the trash');
  const trash=ctx.admin.state.mem.tables.app_onedrive_folders.find(f=>f.item_id===TRASH);assert.deepEqual([trash.role,trash.enabled],['trash',false]);
  // 원드라이브 앱에서 휴지통 밖으로 꺼내면 휴지통 칸이 비워진다
  ctx.admin.state.row.index_lock_until=null;
  const out=make({ms:fakeMicrosoft({deltaChanges:[pic('IN1','F1!100')]}),admin:ctx.admin});
  await post(out.handler,{action:'sync'});
  const in1=ctx.admin.state.mem.tables.app_onedrive_photos.find(r=>r.item_id==='IN1');
  assert.deepEqual([in1.parent_id,in1.trashed_at,in1.orig_parent_id],['F1!100',null,null]);
  assert.equal(ctx.admin.state.mem.tables.app_onedrive_folders.find(f=>f.item_id===TRASH).role,'trash','the folder keeps its trash mark');
  // 일기 날짜 화면에는 사진만(동영상·휴지통 제외)
  const diary=await read(await post(out.handler,{action:'photos',month:'2026-10'}));
  assert.deepEqual(Object.values(diary.days).flat().map(p=>p.id).sort(),['IN1','S1X']);
});

// ── 찍은 시각(2026-10-29): Graph photo.takenDateTime은 카메라 벽시계(한국 시각)에 'Z'만 붙여 준다 ──
test('taken time: camera clock is read as Seoul wall time, created time (approx) stays UTC, the screen label shows the same wall time and day',async()=>{
  const {cameraClockToUtc,takenOf}=await import('../../supabase/functions/onedrive-photos/graph.ts');
  const {takenLabel}=await import('../../app/diary-onedrive.js');
  const shot=at=>({id:'X',file:{mimeType:'image/jpeg'},photo:{takenDateTime:at}});
  // 한국에서 10:00에 찍은 사진 → 진짜 UTC 01:00, 화면 10:00, 같은 날
  const a=takenOf(shot('2026-10-29T10:00:00Z'));
  assert.deepEqual(a,{at:'2026-10-29T01:00:00.000Z',approx:false});
  assert.equal(seoulDay(a.at),'2026-10-29');assert.equal(takenLabel({taken_at:a.at,approx:false}),'10:00');
  // 23:30 사진도 같은 날(옛 규칙은 다음 날 08:30으로 넘겼다)
  const b=takenOf(shot('2026-10-29T23:30:00Z'));
  assert.equal(seoulDay(b.at),'2026-10-29');assert.equal(takenLabel({taken_at:b.at,approx:false}),'23:30');
  // 자정 직후·밀리초·시간대 없는 값
  assert.equal(seoulDay(takenOf(shot('2026-10-30T00:05:00Z')).at),'2026-10-30');
  assert.equal(cameraClockToUtc('2026-10-29T10:00:00.250Z'),'2026-10-29T01:00:00.250Z');
  assert.equal(cameraClockToUtc('2026-10-29T10:00:00'),'2026-10-29T01:00:00.000Z');
  // 시간대를 밝힌 값은 그대로 믿는다
  assert.equal(cameraClockToUtc('2026-10-29T10:00:00+02:00'),'2026-10-29T08:00:00.000Z');
  // 모양이 이상하면 찍은 시각을 버리고 파일 생성 시각(approx)으로
  for(const bad of ['x','2026-13-01T00:00:00Z','2026-10-29',null,42])assert.equal(cameraClockToUtc(bad),null,String(bad));
  // 파일 생성 시각(approx 줄)은 진짜 UTC라 바꾸지 않는다
  const c=takenOf({id:'Y',file:{mimeType:'image/jpeg'},fileSystemInfo:{createdDateTime:'2026-10-29T01:00:00Z'}});
  assert.deepEqual(c,{at:'2026-10-29T01:00:00Z',approx:true});assert.equal(takenLabel({taken_at:c.at,approx:true}),'대략 10:00');
  const d=takenOf({id:'Z',file:{mimeType:'image/jpeg'},photo:{takenDateTime:'nope'},fileSystemInfo:{createdDateTime:'2026-10-29T14:30:00Z'}});
  assert.deepEqual(d,{at:'2026-10-29T14:30:00Z',approx:true});assert.equal(seoulDay(d.at),'2026-10-29');
});

test('taken time: the index stores the real time; library and day lists give it back unchanged (no double +9)',async()=>{
  const ms=fakeMicrosoft({deltaPages:[[topItem,pic('E1','F1!100','2026-10-13T16:00:00Z'),pic('E2','F1!100','2026-10-13T09:15:00Z')]]});
  const ctx=make({ms});
  await post(ctx.handler,{action:'sync'});
  const rows=Object.fromEntries(ctx.admin.state.mem.tables.app_onedrive_photos.map(r=>[r.item_id,r]));
  assert.equal(rows.E1.taken_at,'2026-10-13T07:00:00.000Z');assert.equal(rows.E1.taken_day,'2026-10-13','16:00 photo stays on its day');
  assert.equal(rows.E2.taken_at,'2026-10-13T00:15:00.000Z');assert.equal(rows.E2.taken_day,'2026-10-13');
  const {takenLabel}=await import('../../app/diary-onedrive.js');
  const month=await read(await post(ctx.handler,{action:'photos',month:'2026-10'}));
  assert.deepEqual(month.days['2026-10-13'].map(p=>[p.id,takenLabel(p)]),[['E2','09:15'],['E1','16:00']]);
  const lib=await read(await post(ctx.handler,{action:'library'}));
  assert.deepEqual(lib.items.map(p=>[p.id,p.day,takenLabel(p)]),[['E1','2026-10-13','16:00'],['E2','2026-10-13','09:15']]);
});

test('taken time: an index finished before the fix is walked again from the start once; rows get the real time, rows OneDrive no longer has are swept',async()=>{
  const FIX='2026-10-25T00:00:00Z',OLD='2026-10-20T00:00:00Z';
  const old=(item_id,parent_id,taken_at,day)=>({workspace_id:WS,item_id,parent_id,name:'img-'+item_id+'.jpg',taken_at,approx:false,taken_day:day,updated_at:OLD,kind:'photo',trashed_at:null});
  const index={
    app_onedrive_folders:[{workspace_id:WS,item_id:'F1!100',parent_id:null,name:'카메라',enabled:true,updated_at:OLD},
      {workspace_id:WS,item_id:'S1',parent_id:'F1!100',name:'2025',enabled:false,updated_at:OLD},
      {workspace_id:WS,item_id:'GONEDIR',parent_id:'F1!100',name:'지운 폴더',enabled:true,updated_at:OLD}],
    // 옛 규칙으로 적힌 줄: 16:00(카메라) 사진이 '16:00Z'로, 다음 날로 묶여 있다
    app_onedrive_photos:[old('P0','F1!100','2026-10-13T16:00:00Z','2026-10-14'),old('GONE','F1!100','2026-10-13T01:00:00Z','2026-10-13')],
  };
  const row={...connected,index_done_at:OLD,synced_at:'2026-10-26T02:59:00Z',delta_link:'https://graph.microsoft.com/v1.0/me/drive/items/F1!100/delta?token=latest'};
  const ms=fakeMicrosoft({deltaPages:[[topItem,dir('S1','F1!100','2025'),pic('P0','F1!100','2026-10-13T16:00:00Z'),pic('P1','S1')]]});
  const ctx=make({admin:fakeAdmin({row,index}),ms,takenFixAt:FIX});
  // 방금 받은 색인이라도(10분 안) 옛 규칙이면 달 조회가 다시 받기를 시작한다
  const out=await read(await post(ctx.handler,{action:'photos',month:'2026-10'}));
  assert.equal(out.indexing,false);
  const deltaCalls=ms.calls.filter(c=>c.url.includes('/delta'));
  assert.ok(deltaCalls.length>=1&&!new URL(deltaCalls[0].url).searchParams.has('token'),'starts from the first page, not the saved delta link');
  const photos=Object.fromEntries(ctx.admin.state.mem.tables.app_onedrive_photos.map(r=>[r.item_id,r]));
  assert.deepEqual(Object.keys(photos).sort(),['P0','P1'],'GONE swept');
  assert.equal(photos.P0.taken_at,'2026-10-13T07:00:00.000Z');assert.equal(photos.P0.taken_day,'2026-10-13');
  assert.deepEqual(out.days['2026-10-13'].map(p=>p.id),['P0'],'P1 is in a folder switched off');assert.equal(out.days['2026-10-14'],undefined);
  const folders=Object.fromEntries(ctx.admin.state.mem.tables.app_onedrive_folders.map(r=>[r.item_id,r]));
  assert.deepEqual(Object.keys(folders).sort(),['F1!100','S1'],'deleted folder swept, top kept');
  assert.equal(folders.S1.enabled,false,'folder on/off choice kept');
  assert.equal(ctx.admin.state.row.index_done_at,new Date(NOW).toISOString());assert.match(ctx.admin.state.row.delta_link,/token=latest$/);
  // 한 번만: 다음 받기는 저장한 변경 주소로 이어 간다
  ms.calls.length=0;
  assert.deepEqual(await read(await post(ctx.handler,{action:'sync'})),{more:false,indexing:false});
  assert.ok(ms.calls.filter(c=>c.url.includes('/delta')).every(c=>new URL(c.url).searchParams.get('token')==='latest'));
  assert.deepEqual(ctx.admin.state.mem.tables.app_onedrive_photos.map(r=>r.item_id).sort(),['P0','P1']);
});

test('taken time: the re-walk spreads over requests like a first index (indexing:true until done) and keeps rows visible meanwhile',async()=>{
  const FIX='2026-10-25T00:00:00Z',OLD='2026-10-20T00:00:00Z';
  const index={app_onedrive_folders:[{workspace_id:WS,item_id:'F1!100',parent_id:null,name:'카메라',enabled:true,updated_at:OLD}],
    app_onedrive_photos:Array.from({length:20},(_,i)=>({workspace_id:WS,item_id:'Q'+i,parent_id:'F1!100',name:'q.jpg',taken_at:'2026-10-13T01:00:00Z',approx:false,taken_day:'2026-10-13',updated_at:OLD,kind:'photo',trashed_at:null}))};
  const pages=Array.from({length:20},(_,i)=>[pic('Q'+i,'F1!100')]);pages[0].unshift(topItem);
  const row={...connected,index_done_at:OLD,synced_at:OLD,delta_link:'https://graph.microsoft.com/v1.0/me/drive/items/F1!100/delta?token=latest'};
  const ctx=make({admin:fakeAdmin({row,index}),ms:fakeMicrosoft({deltaPages:pages}),takenFixAt:FIX});
  assert.deepEqual(await read(await post(ctx.handler,{action:'sync'})),{more:true,indexing:true});
  assert.equal(ctx.admin.state.row.index_done_at,null);assert.equal(ctx.admin.state.row.delta_link,null);
  assert.equal(ctx.admin.state.mem.tables.app_onedrive_photos.length,20,'nothing removed mid-walk');
  assert.deepEqual(await read(await post(ctx.handler,{action:'sync'})),{more:false,indexing:false});
  assert.equal(ctx.admin.state.mem.tables.app_onedrive_photos.length,20);
  assert.ok(ctx.admin.state.mem.tables.app_onedrive_photos.every(r=>r.taken_at==='2026-10-12T16:00:00.000Z'&&r.taken_day==='2026-10-13'));
});
