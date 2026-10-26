import test from 'node:test';
import assert from 'node:assert/strict';

// JOURNAL-일기원드라이브 1단계: 실제 onedrive-photos handler를 지어낸 Supabase와 지어낸 Microsoft Graph로 돌린다. 네트워크 없음.
// 비밀값·토큰·계정은 모두 고정 가짜 글자다.
const {createOneDriveHandler}=await import('../../supabase/functions/onedrive-photos/handler.ts');
const {insideFolder,folderPathOf,safeDownloadUrl,seoulDay,graphNextLink}=await import('../../supabase/functions/onedrive-photos/graph.ts');

const WS='a0000000-0000-4000-8000-000000000001',USER='u0000000-0000-4000-8000-000000000001',OTHER='u0000000-0000-4000-8000-000000000002';
const JWT='synthetic-user-jwt',NOW=Date.parse('2026-10-26T03:00:00Z');
const ENV={ONEDRIVE_CLIENT_ID:'synthetic-client-id',ONEDRIVE_CLIENT_SECRET:'synthetic-client-secret-0123456789',ONEDRIVE_REDIRECT_URI:'https://synthetic.example.test/app/onedrive-callback'};
const REFRESH='synthetic-refresh-token-AAAA',REFRESH2='synthetic-refresh-token-BBBB',ACCESS='synthetic-access-token';

function fakeAdmin({role='owner',row=null,saveError=false}={}){
  const state={row,writes:[]};
  const q=table=>{
    const ctx={table,filters:{}};
    const api={
      select(){return api;},eq(k,v){ctx.filters[k]=v;return api;},
      maybeSingle(){
        if(table==='app_workspace_members')return Promise.resolve({data:ctx.filters.user_id===USER?{workspace_id:WS,role}:null,error:null});
        if(table==='app_onedrive_connections')return Promise.resolve({data:state.row,error:null});
        return Promise.resolve({data:null,error:null});
      },
      upsert(v){state.writes.push({op:'upsert',v});if(saveError)return Promise.resolve({error:{}});state.row={...v};return Promise.resolve({error:null});},
      update(v){ctx.patch=v;return {eq(k,val){state.writes.push({op:'update',v});if(saveError)return Promise.resolve({error:{}});if(state.row&&val===WS)Object.assign(state.row,v);return Promise.resolve({error:null});}};},
      delete(){return {eq(){state.writes.push({op:'delete'});state.row=null;return Promise.resolve({error:null});}};},
    };
    return api;
  };
  return {state,auth:{getUser:async t=>t===JWT?{data:{user:{id:USER}},error:null}:t==='other'?{data:{user:{id:OTHER}},error:null}:{data:{user:null},error:{status:401}}},from:q};
}

// 지어낸 Microsoft: 토큰 주소, Graph, 임시 사진 주소.
function fakeMicrosoft({tokenReply,items={},itemById={},thumb}={}){
  const calls=[];
  const fetch=async(url,init={})=>{
    url=String(url);calls.push({url,init});
    if(url.startsWith('https://login.microsoftonline.com/')){
      const form=new URLSearchParams(String(init.body));
      calls[calls.length-1].form=form;
      const r=tokenReply?tokenReply(form):{status:200,body:{access_token:ACCESS,refresh_token:REFRESH2,scope:'Files.Read User.Read',expires_in:3600}};
      return new Response(JSON.stringify(r.body),{status:r.status});
    }
    if(url.startsWith('https://graph.microsoft.com/v1.0/')){
      assert.equal(init.headers.Authorization,`Bearer ${ACCESS}`);
      const path=decodeURIComponent(url.slice('https://graph.microsoft.com/v1.0'.length).split('?')[0]);
      const thumbMatch=path.match(/^\/me\/drive\/items\/([^/]+)\/thumbnails\/0\/([^/]+)\/content$/);
      if(thumbMatch){return thumb?thumb(thumbMatch):new Response(null,{status:302,headers:{location:'https://thumbs.synthetic.example.test/t/abc'}});}
      const kids=path.match(/^\/me\/drive\/(?:root|items\/([^/]+))\/children$/);
      if(kids){const key=kids[1]||'root';const page=items[key];if(!page)return new Response('{}',{status:404});
        const u=new URL(url);if(u.searchParams.get('page')==='2')return new Response(JSON.stringify({value:page.second||[]}));
        return new Response(JSON.stringify({value:page.first||page,...(page.second?{'@odata.nextLink':'https://graph.microsoft.com/v1.0'+path+'?page=2'}:{})}));}
      const one=path.match(/^\/me\/drive\/items\/([^/]+)$/);
      if(one&&itemById[one[1]])return new Response(JSON.stringify(itemById[one[1]]));
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

const connected={refresh_token:REFRESH,folder_id:'F1!100',folder_name:'카메라',folder_path:'/drive/root:/Pictures/Camera',connected_at:'2026-10-20T00:00:00Z'};
const make=({admin=fakeAdmin({row:{...connected}}),ms=fakeMicrosoft(),env=ENV}={})=>({
  admin,ms,handler:createOneDriveHandler(admin,{env:n=>env[n],fetch:ms.fetch,now:()=>NOW,log:()=>{}}),
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
  assert.deepEqual(await read(await post(none.handler,{action:'status'})),{configured:true,connected:false,folder:null,connected_at:null});
  const ok=make();const text=await (await post(ok.handler,{action:'status'})).text();
  assert.deepEqual(JSON.parse(text),{configured:true,connected:true,folder:{name:'카메라'},connected_at:'2026-10-20T00:00:00Z'});
  assert.ok(!text.includes(REFRESH));
});

test('auth-start builds a read-only sign-in address with a signed, expiring state',async()=>{
  const {handler}=make({admin:fakeAdmin()});
  const {url}=await read(await post(handler,{action:'auth-start'}));
  const u=new URL(url);
  assert.equal(u.origin+u.pathname,'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  assert.equal(u.searchParams.get('scope'),'Files.Read offline_access');
  assert.equal(u.searchParams.get('redirect_uri'),ENV.ONEDRIVE_REDIRECT_URI);
  assert.equal(u.searchParams.get('client_id'),ENV.ONEDRIVE_CLIENT_ID);
  assert.ok(!url.includes(ENV.ONEDRIVE_CLIENT_SECRET));assert.ok(!/ReadWrite/i.test(url));
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
  const saved=ctx.admin.state.writes.at(-1);assert.equal(saved.op,'upsert');
  assert.equal(saved.v.refresh_token,REFRESH2);assert.equal(saved.v.workspace_id,WS);
  assert.equal(saved.v.folder_id,null,'reconnect clears the folder');assert.equal(saved.v.scope,'files.read user.read');
});

test('auth-finish rejects forged, other-user, expired and replayed-shape states without calling Microsoft',async()=>{
  const ctx=make({admin:fakeAdmin()});const state=await startState(ctx.handler);
  const [body,mac]=state.split('.');
  const forged=Buffer.from(JSON.stringify({u:USER,w:WS,e:NOW+999999,n:'x'})).toString('base64url')+'.'+mac;
  for(const bad of [forged,state+'x','a.b','nodot',body,42,null,state+'.extra']){
    const r=await post(ctx.handler,{action:'auth-finish',code:'synthetic-code-123',state:bad});assert.equal(r.status,400,String(bad));
  }
  const late=createOneDriveHandler(ctx.admin,{env:n=>ENV[n],fetch:ctx.ms.fetch,now:()=>NOW+11*60*1000,log:()=>{}});
  assert.equal((await post(late,{action:'auth-finish',code:'synthetic-code-123',state})).status,400);
  // 같은 서명이어도 다른 사용자 이름으로는 못 쓴다: 다른 사용자가 만든 상태를 이 사용자가 내면 거절
  const otherAdmin=fakeAdmin();const otherUser=createOneDriveHandler({...otherAdmin,from:t=>t==='app_workspace_members'?{select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{workspace_id:WS,role:'owner'},error:null})}:otherAdmin.from(t)},{env:n=>ENV[n],fetch:ctx.ms.fetch,now:()=>NOW,log:()=>{}});
  assert.equal((await post(otherUser,{action:'auth-finish',code:'synthetic-code-123',state},{jwt:'other'})).status,400);
  assert.equal((await post(ctx.handler,{action:'auth-finish',code:'x',state})).status,400);
  assert.equal(ctx.ms.calls.length,0);assert.equal(ctx.admin.state.writes.length,0);
});

test('auth-finish refuses broader permissions than read-only and stores nothing',async()=>{
  for(const scope of ['Files.ReadWrite offline_access','Files.Read Files.ReadWrite.All','User.Read','Files.Read.All']){
    const ctx=make({admin:fakeAdmin(),ms:fakeMicrosoft({tokenReply:()=>({status:200,body:{access_token:ACCESS,refresh_token:REFRESH2,scope,expires_in:3600}})})});
    const state=await startState(ctx.handler);
    const r=await post(ctx.handler,{action:'auth-finish',code:'synthetic-code-123',state});
    assert.equal(r.status,400,scope);assert.deepEqual(await read(r),{error:'onedrive_scope_invalid'});assert.equal(ctx.admin.state.writes.length,0);
  }
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

test('photos: groups by Seoul day, keeps the month, images only, walks sub-folders, follows only Graph next pages',async()=>{
  const ms=fakeMicrosoft({items:{'F1!100':{first:[
      {id:'A1',name:'a.jpg',file:{mimeType:'image/jpeg'},photo:{takenDateTime:'2026-10-12T15:30:00Z'}}, // 서울 10-13 00:30
      {id:'A2',name:'b.heic',file:{mimeType:'image/heic'},photo:{takenDateTime:'2026-10-13T01:00:00Z'}},
      {id:'A3',name:'c.mp4',file:{mimeType:'video/mp4'},photo:{takenDateTime:'2026-10-13T01:00:00Z'}},
      {id:'A4',name:'d.jpg',file:{mimeType:'image/jpeg'},photo:{takenDateTime:'2026-09-30T20:00:00Z'}}, // 서울 10-01
      {id:'A5',name:'e.jpg',file:{mimeType:'image/jpeg'},fileSystemInfo:{createdDateTime:'2026-10-20T00:00:00Z'}},
      {id:'A6',name:'f.jpg',file:{mimeType:'image/jpeg'},photo:{takenDateTime:'2026-11-01T00:00:00Z'}},
      {id:'SUB',name:'하위',folder:{}}],second:[{id:'A7',name:'g.png',file:{mimeType:'image/png'},photo:{takenDateTime:'2026-10-13T02:00:00Z'}},{id:'bad id!!/',name:'x',file:{mimeType:'image/png'}}]},
    SUB:[{id:'B1',name:'h.jpg',file:{mimeType:'image/jpeg'},photo:{takenDateTime:'2026-10-13T03:00:00Z'}}]}});
  const ctx=make({ms});
  const out=await read(await post(ctx.handler,{action:'photos',month:'2026-10'}));
  assert.deepEqual(Object.keys(out.days).sort(),['2026-10-01','2026-10-13','2026-10-20']);
  assert.deepEqual(out.days['2026-10-13'].map(p=>p.id),['A1','A2','A7','B1']);
  assert.equal(out.days['2026-10-20'][0].approx,true);assert.equal(out.days['2026-10-13'][0].approx,false);assert.equal(out.truncated,false);
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
  for(const id of ['VID','DIR','MISSING'])assert.equal((await post(ctx.handler,{action:'photo',id})).status,404,id);
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

test('refresh token rotation is saved, access token is reused, expired grant becomes 424',async()=>{
  const ms=fakeMicrosoft({items:{'F1!100':[]}});const ctx=make({ms});
  await post(ctx.handler,{action:'photos',month:'2026-10'});await post(ctx.handler,{action:'photos',month:'2026-10'});
  assert.equal(ms.calls.filter(c=>c.form).length,1,'one token request, then cached');
  assert.equal(ctx.admin.state.row.refresh_token,REFRESH2);
  const dead=make({ms:fakeMicrosoft({tokenReply:()=>({status:400,body:{error:'invalid_grant'}})})});
  const r=await post(dead.handler,{action:'photos',month:'2026-10'});assert.equal(r.status,424);assert.deepEqual(await read(r),{error:'onedrive_auth_expired'});
  const save=make({admin:fakeAdmin({row:{...connected},saveError:true})});assert.equal((await post(save.handler,{action:'photos',month:'2026-10'})).status,503);
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

test('the new function is pre-registered once in the section 5 table with verify_jwt true',async()=>{
  const {readFileSync}=await import('node:fs');
  const doc=readFileSync('docs/web2-env6b-edge-source.md','utf8');
  const rows=doc.split('\n').filter(l=>/^\|\s*\d+\s*\|\s*`onedrive-photos`/.test(l));
  assert.equal(rows.length,1);assert.equal(rows[0].split('|')[6].replace(/[*\s]/g,''),'true');
  const index=readFileSync('supabase/functions/onedrive-photos/index.ts','utf8');
  assert.match(index,/verify_jwt=true/);
});
