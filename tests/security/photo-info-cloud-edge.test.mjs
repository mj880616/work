import test from 'node:test';
import assert from 'node:assert/strict';
import {tiff,jpeg,gpsSeoul} from './jpeg-exif-fixture.mjs';

// S50-31 PHOTO-정보고치기 ②: onedrive-photos·gdrive-photos의 photos-meta-read·photos-meta-write를 지어낸 Supabase·Graph·Drive로 돌린다. 네트워크 없음.
// 사진·토큰·계정·이름·위치는 모두 지어낸 값이다.
const {createOneDriveHandler}=await import('../../supabase/functions/onedrive-photos/handler.ts');
const {createGdriveHandler}=await import('../../supabase/functions/gdrive-photos/handler.ts');
const {readJpegMeta,sameOutsideExif}=await import('../../supabase/functions/_shared/jpeg-exif.ts');
const {memTables}=await import('./onedrive-fake-db.mjs');

const WS='a0000000-0000-4000-8000-000000000001',USER='u0000000-0000-4000-8000-000000000001',JWT='synthetic-user-jwt';
const photoBytes=()=>jpeg(tiff({ifd0:{0x010f:[2,'SYNTH'],0x0110:[2,'Cam'],0x0132:[2,'2026:10:01 19:00:00']},exif:{0x9003:[2,'2026:10:01 19:00:00'],0x9011:[2,'+09:00']},gps:gpsSeoul}).tiff);
const take=v=>new Date(Date.parse(v)).toISOString();

// ---------- 원드라이브 ----------
const ACCESS='synthetic-access-token',TOP='F1!100',TRASH='TRASH!1',TOP_PATH='/drive/root:/Pictures/Camera';
const ENV={ONEDRIVE_CLIENT_ID:'synthetic-client-id',ONEDRIVE_CLIENT_SECRET:'synthetic-client-secret-0123456789',ONEDRIVE_REDIRECT_URI:'https://synthetic.example.test/app/onedrive-return.html'};
function oneDrive({scope='files.readwrite user.read',putReply,downloadReply}={}){
 const mem=memTables({app_onedrive_folders:[{workspace_id:WS,item_id:TOP,parent_id:null,name:'카메라',enabled:true},{workspace_id:WS,item_id:TRASH,parent_id:TOP,name:'.Web2 휴지통',enabled:false,role:'trash'}]});
 const row={refresh_token:'synthetic-refresh',scope,folder_id:TOP,folder_name:'카메라',folder_path:TOP_PATH,connected_at:'2026-10-20T00:00:00Z'};
 const conn=()=>{const api={select(){return api;},eq(){return api;},maybeSingle(){return Promise.resolve({data:row,error:null});},update(){const c={eq(){return c;},select(){return c;},then(r){return Promise.resolve({error:null,data:[{workspace_id:WS}]}).then(r);}};return c;}};return api;};
 const members=()=>{const f={};const api={select(){return api;},eq(k,v){f[k]=v;return api;},maybeSingle(){return Promise.resolve({data:f.user_id===USER?{workspace_id:WS,role:'owner'}:null,error:null});}};return api;};
 const admin={auth:{getUser:async t=>t===JWT?{data:{user:{id:USER}},error:null}:{data:{user:null},error:{status:401}}},
  from:t=>t==='app_workspace_members'?members():t==='app_onedrive_connections'?conn():mem.from(t)};
 const files={
  'P1!1':{id:'P1!1',name:'a.jpg',mime:'image/jpeg',parent:TOP,path:TOP_PATH,bytes:photoBytes(),etag:'"e1"'},
  'P2!1':{id:'P2!1',name:'b.png',mime:'image/png',parent:TOP,path:TOP_PATH,bytes:new Uint8Array(10),etag:'"e2"'},
  'P3!1':{id:'P3!1',name:'c.jpg',mime:'image/jpeg',parent:'OUT!1',path:'/drive/root:/Other',bytes:photoBytes(),etag:'"e3"'},
  'P4!1':{id:'P4!1',name:'d.jpg',mime:'image/jpeg',parent:TRASH,path:TOP_PATH+'/.Web2 휴지통',bytes:photoBytes(),etag:'"e4"'},
  'P5!1':{id:'P5!1',name:'e.jpg',mime:'image/jpeg',parent:TOP,path:TOP_PATH,bytes:photoBytes(),etag:'"e5"'},
 };
 const calls=[];
 const ok=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
 const meta=f=>{const m=readJpegMeta(f.bytes).meta||{};return {id:f.id,name:f.name,size:f.bytes.length,eTag:f.etag,file:{mimeType:f.mime},parentReference:{id:f.parent,path:f.path},
  '@microsoft.graph.downloadUrl':'https://dl.example.test/'+encodeURIComponent(f.id),createdDateTime:'2026-10-01T00:00:00Z',
  photo:m.taken?{takenDateTime:new Date(Date.parse(m.taken)+9*3600e3).toISOString().slice(0,19)+'Z'}:undefined,fileSystemInfo:{createdDateTime:'2026-10-01T00:00:00Z'}};};
 async function fetch(url,init={}){
  url=String(url);const h=init.headers||{},method=init.method||'GET';calls.push({url,method,headers:h,size:init.body?.length});
  if(url.startsWith('https://login.microsoftonline.com/'))return ok({access_token:ACCESS,refresh_token:'synthetic-refresh',scope,expires_in:3600});
  if(url.startsWith('https://dl.example.test/')){
   assert.equal(h.Authorization,undefined,'download address gets no token');
   const f=files[decodeURIComponent(url.split('/').pop())];const own=downloadReply?.(f);if(own)return own;
   if(h.Range){const [,a,z]=/bytes=(\d+)-(\d+)/.exec(h.Range);return new Response(f.bytes.slice(Number(a),Number(z)+1),{status:206});}
   return new Response(f.bytes);
  }
  if(url.startsWith('https://graph.microsoft.com/v1.0/me/drive/items/')){
   assert.equal(h.Authorization,'Bearer '+ACCESS);
   const rest=url.slice('https://graph.microsoft.com/v1.0/me/drive/items/'.length),id=decodeURIComponent(rest.split(/[/?]/)[0]),f=files[id];
   if(method==='PUT'&&rest.includes('/content')){
    const own=putReply?.(f,h);if(own)return own;
    if(h['If-Match']!==f.etag)return ok({error:{code:'preconditionFailed'}},412);
    f.bytes=new Uint8Array(init.body);f.etag='"'+f.etag.slice(1,-1)+'x"';return ok(meta(f));
   }
   if(method==='GET')return f?ok(meta(f)):ok({error:{}},404);
  }
  throw new Error('unexpected '+method+' '+url);
 }
 const handler=createOneDriveHandler(admin,{env:k=>ENV[k],fetch,now:()=>Date.parse('2026-11-05T13:00:00Z'),log:()=>{}});
 const call=async(body,jwt=JWT)=>{const r=await handler(new Request('https://fn.example.test/onedrive-photos',{method:'POST',headers:{'content-type':'application/json',...(jwt?{Authorization:'Bearer '+jwt}:{})},body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};};
 return {call,files,calls,mem};
}

test('onedrive meta read: only JPEG in the chosen folder (not trash), first 256KB only, camera shown',async()=>{
 const w=oneDrive();
 const r=await w.call({action:'photos-meta-read',ids:['P1!1','P2!1','P3!1','P4!1','NO!1']});
 assert.equal(r.status,200);
 const by=Object.fromEntries(r.body.items.map(i=>[i.id,i]));
 assert.deepEqual(by['P1!1'],{id:'P1!1',can:true,taken:'2026-10-01T10:00:00.000Z',lat:37.56,lon:126.98,make:'SYNTH',model:'Cam'});
 assert.equal(by['P2!1'].why,'not_jpeg');assert.equal(by['P3!1'].why,'outside');assert.equal(by['P4!1'].why,'trashed');assert.equal(by['NO!1'].why,'missing');
 assert.ok(w.calls.filter(c=>c.url.startsWith('https://dl.')).every(c=>c.headers.Range==='bytes=0-262143'));
 assert.equal((await w.call({action:'photos-meta-read',ids:Array.from({length:11},(_,i)=>'P'+i+'!1')})).status,400);
 assert.equal((await w.call({action:'photos-meta-read',ids:['P1!1']},'')).status,401);
});

test('onedrive meta write: needs confirm; rewrites only Exif, uploads a new version with If-Match, returns before/after, reindexes that photo',async()=>{
 const w=oneDrive();
 assert.equal((await w.call({action:'photos-meta-write',items:[{id:'P1!1',taken:'2026-10-01T02:00:00Z'}]})).status,400,'confirm required');
 for(const bad of [[],[{id:'P1!1'}],[{id:'P1!1',taken:'x'}],[{id:'P1!1',loc:{lat:99,lon:0}}],[{id:'bad id',taken:'2026-10-01T02:00:00Z'}],[{id:'P1!1',taken:'2026-10-01T02:00:00Z'},{id:'P1!1',loc:null}]])
  assert.equal((await w.call({action:'photos-meta-write',confirm:true,items:bad})).status,400,JSON.stringify(bad));
 const original=w.files['P1!1'].bytes;
 const r=await w.call({action:'photos-meta-write',confirm:true,items:[{id:'P1!1',taken:'2026-10-01T02:00:00Z',loc:{lat:35.1,lon:129.04}},{id:'P2!1',taken:'2026-10-01T02:00:00Z'},{id:'P3!1',loc:null}]});
 assert.equal(r.status,200);
 assert.deepEqual(r.body.done,[{id:'P1!1',before:{taken:'2026-10-01T10:00:00.000Z',lat:37.56,lon:126.98},after:{taken:'2026-10-01T02:00:00.000Z',lat:35.1,lon:129.04}}]);
 assert.deepEqual(r.body.failed,{'P2!1':'not_jpeg','P3!1':'outside'});
 assert.ok(sameOutsideExif(original,w.files['P1!1'].bytes),'picture bytes unchanged');
 const put=w.calls.find(c=>c.method==='PUT');assert.equal(put.headers['If-Match'],'"e1"');assert.equal(put.headers['Content-Type'],'image/jpeg');
 assert.equal(w.calls.filter(c=>c.method==='PUT').length,1,'only the editable photo is uploaded');
 const rowAfter=(await w.mem.from('app_onedrive_photos').select('*').eq('item_id','P1!1').maybeSingle()).data;
 assert.equal(rowAfter.taken_at&&take(rowAfter.taken_at),'2026-10-01T02:00:00.000Z','index re-read for that photo');
 assert.ok(!w.calls.some(c=>c.method==='DELETE'),'nothing deleted');
});

test('onedrive meta write: changed in between (412) is not overwritten; reconnect needed without write scope',async()=>{
 const w=oneDrive({putReply:()=>new Response('{}',{status:412})});
 const r=await w.call({action:'photos-meta-write',confirm:true,items:[{id:'P5!1',taken:'2026-10-01T02:00:00Z'}]});
 assert.deepEqual(r.body,{done:[],failed:{'P5!1':'changed'}});
 const ro=oneDrive({scope:'files.read user.read'});
 const x=await ro.call({action:'photos-meta-write',confirm:true,items:[{id:'P5!1',taken:'2026-10-01T02:00:00Z'}]});
 assert.equal(x.status,424);assert.equal(x.body.error,'onedrive_reconnect_needed');
 assert.ok(!ro.calls.some(c=>c.method==='PUT'));
});

// ---------- 구글 드라이브 ----------
const SB='https://sb.example.test',GENV={SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',SUPABASE_ANON_KEY:'synthetic-anon-key'};
const FULL='https://www.googleapis.com/auth/drive';
function gdrive({features=['gdrive_photos'],revBump=false}={}){
 const db={folders:[{workspace_id:WS,item_id:'F1',parent_id:'root',name:'가상',enabled:true}],photos:[
  {workspace_id:WS,item_id:'G1',parent_id:'F1',name:'a.jpg',video:false,taken_at:'2026-10-01T10:00:00.000Z',approx:false,taken_day:'2026-10-01'},
  {workspace_id:WS,item_id:'G2',parent_id:'F1',name:'b.png',video:false,taken_at:'2026-10-01T10:00:00.000Z',approx:false,taken_day:'2026-10-01'},
  {workspace_id:WS,item_id:'G4',parent_id:'F9',name:'off.jpg',video:false,taken_at:'2026-10-01T10:00:00.000Z',approx:false,taken_day:'2026-10-01'}]};
 const files={G1:{mimeType:'image/jpeg',bytes:photoBytes(),rev:'r1'},G2:{mimeType:'image/png',bytes:new Uint8Array(9),rev:'r1'},G4:{mimeType:'image/jpeg',bytes:photoBytes(),rev:'r1'}};
 const calls=[];
 const ok=(v,status=200)=>new Response(v===null?null:JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
 async function fetch(url,init={}){
  const u=new URL(url),h=init.headers||{},method=init.method||'GET';calls.push({host:u.host,path:u.pathname,search:u.search,method,headers:h});
  if(u.host==='sb.example.test'){
   if(u.pathname==='/auth/v1/user')return h.Authorization==='Bearer '+JWT?ok({id:USER}):ok({},401);
   if(u.pathname==='/rest/v1/rpc/app_my_features')return ok(features);
   if(u.pathname==='/rest/v1/rpc/app_operator_feature_workspace')return ok(WS);
   const name=u.pathname.replace('/rest/v1/',''),p=u.searchParams;
   if(name==='app_workspace_members')return ok([{workspace_id:WS}]);
   if(name==='app_workspaces')return ok([{id:WS}]);
   if(name==='public_policy_drive_config')return ok([{google_client_id:'c',google_client_secret:'s',google_refresh_token:'synthetic-refresh'}]);
   if(name==='app_gdrive_folders')return ok(db.folders);
   if(name==='app_gdrive_photos'&&method==='GET'){const ids=p.get('item_id').slice(4,-1).split(',').map(s=>s.replace(/"/g,''));return ok(db.photos.filter(r=>ids.includes(r.item_id)));}
   if(name==='app_gdrive_photos'&&method==='POST'){for(const r of JSON.parse(init.body)){const i=db.photos.findIndex(x=>x.item_id===r.item_id);if(i<0)db.photos.push(r);else Object.assign(db.photos[i],r);}return ok(null,201);}
   throw new Error('unexpected db '+method+' '+name);
  }
  if(u.host==='oauth2.googleapis.com')return ok({access_token:ACCESS,scope:FULL,expires_in:3600});
  if(u.host==='www.googleapis.com'){
   assert.equal(h.Authorization,'Bearer '+ACCESS);
   assert.notEqual(method,'DELETE');
   const up=u.pathname.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/);
   if(up){assert.equal(method,'PATCH');assert.equal(u.searchParams.get('uploadType'),'media');const f=files[up[1]];f.bytes=new Uint8Array(init.body);f.rev='r'+(Number(f.rev.slice(1))+1);return ok({id:up[1]});}
   const m=u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);assert.ok(m,u.pathname);const id=decodeURIComponent(m[1]),f=files[id];
   if(!f)return ok({},404);
   if(u.searchParams.get('alt')==='media'){if(h.Range){const [,a,z]=/bytes=(\d+)-(\d+)/.exec(h.Range);return new Response(f.bytes.slice(Number(a),Number(z)+1),{status:206});}return new Response(f.bytes);}
   if(revBump&&calls.filter(c=>c.path===u.pathname&&!c.search.includes('alt=')).length===2)f.rev='r-other';
   const time=readJpegMeta(f.bytes).meta?.taken;
   return ok({id,name:'x.jpg',mimeType:f.mimeType,size:String(f.bytes.length),trashed:false,headRevisionId:f.rev,createdTime:'2026-10-01T00:00:00Z',
    imageMediaMetadata:time?{time:new Date(Date.parse(time)+9*3600e3).toISOString().slice(0,19).replace('T',' ').replace(/-/g,':')}:undefined});
  }
  throw new Error('unexpected '+url);
 }
 const handler=createGdriveHandler({fetch,env:k=>GENV[k],now:()=>Date.parse('2026-11-05T13:00:00Z')});
 const call=async b=>{const r=await handler(new Request('https://fn.example.test/gdrive-photos',{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+JWT},body:JSON.stringify(b)}));return {status:r.status,body:await r.json()};};
 return {call,files,calls,db};
}

test('gdrive meta read: indexed (folder on) JPEG only, first 256KB only; operator gate stays first',async()=>{
 const w=gdrive();
 const r=await w.call({action:'photos-meta-read',ids:['G1','G2','G4']});
 assert.equal(r.status,200);
 const by=Object.fromEntries(r.body.items.map(i=>[i.id,i]));
 assert.equal(by.G1.can,true);assert.equal(by.G1.taken,'2026-10-01T10:00:00.000Z');assert.equal(by.G1.lat,37.56);
 assert.equal(by.G2.why,'not_jpeg');assert.equal(by.G4.why,'missing','folder off = not in the list');
 assert.ok(w.calls.filter(c=>c.search.includes('alt=media')).every(c=>c.headers.Range==='bytes=0-262143'));
 const gate=gdrive({features:[]});
 assert.equal((await gate.call({action:'photos-meta-read',ids:['G1']})).body.error,'feature_required');
 assert.ok(!gate.calls.some(c=>c.host==='www.googleapis.com'));
});

test('gdrive meta write: confirm needed; new revision with only Exif changed; reindex; revision changed in between = not overwritten',async()=>{
 const w=gdrive();
 assert.equal((await w.call({action:'photos-meta-write',items:[{id:'G1',taken:'2026-10-01T02:00:00Z'}]})).body.error,'confirm_required');
 assert.equal((await w.call({action:'photos-meta-write',confirm:true,items:[{id:'G1'}]})).status,400);
 const original=w.files.G1.bytes;
 const r=await w.call({action:'photos-meta-write',confirm:true,items:[{id:'G1',taken:'2026-10-01T02:00:00Z',loc:null},{id:'G2',taken:'2026-10-01T02:00:00Z'},{id:'G4',taken:'2026-10-01T02:00:00Z'}]});
 assert.equal(r.status,200);
 assert.deepEqual(r.body.done,[{id:'G1',before:{taken:'2026-10-01T10:00:00.000Z',lat:37.56,lon:126.98},after:{taken:'2026-10-01T02:00:00.000Z',lat:null,lon:null}}]);
 assert.deepEqual(r.body.failed,{G2:'not_jpeg',G4:'missing'});
 assert.ok(sameOutsideExif(original,w.files.G1.bytes));
 assert.equal(w.files.G1.rev,'r2');
 assert.equal(w.db.photos.find(p=>p.item_id==='G1').taken_at,'2026-10-01T02:00:00.000Z','index re-read for that photo');
 const busy=gdrive({revBump:true});
 const x=await busy.call({action:'photos-meta-write',confirm:true,items:[{id:'G1',taken:'2026-10-01T02:00:00Z'}]});
 assert.deepEqual(x.body.failed,{G1:'changed'});
 assert.ok(!busy.calls.some(c=>c.path.startsWith('/upload/')),'no upload when the revision changed');
});
