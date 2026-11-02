import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// S48-12b ③: 실제 cloud-files handler를 지어낸 Supabase(PostgREST)·원드라이브(Graph)·구글 드라이브로 돌린다. 네트워크 없음.
// 비밀값·토큰·계정·파일 이름은 모두 고정 가짜 글자다.
const {createCloudFilesHandler,odRow,gdRow,safeOpenUrl,servedType,FRESH_MS}=await import('../../supabase/functions/cloud-files/handler.ts');
const root=new URL('../../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');

const SB='https://sb.example.test',WS='a0000000-0000-4000-8000-000000000001',WS2='a0000000-0000-4000-8000-000000000002';
const USER='u0000000-0000-4000-8000-000000000001',OTHER='u0000000-0000-4000-8000-000000000002';
const JWT='synthetic-user-jwt',JWT2='synthetic-other-jwt',GD_ACCESS='synthetic-gd-access',OD_ACCESS='synthetic-od-access',FULL='https://www.googleapis.com/auth/drive';
const ENV={SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',SUPABASE_ANON_KEY:'synthetic-anon-key',
 ONEDRIVE_CLIENT_ID:'synthetic-client',ONEDRIVE_CLIENT_SECRET:'synthetic-secret-0123456789',ONEDRIVE_TENANT:'common'};
const DL='https://dl.example-1drv.test/x';

function world({features=['calls','files','gdrive_photos'],allowed=WS,driveWs=WS,gdScope=FULL,odScope='Files.ReadWrite offline_access User.Read',odConn=true}={}){
 let clock=Date.parse('2026-11-02T08:00:00Z');
 const db={items:[],sync:[],stars:[],conn:odConn?[{workspace_id:WS,refresh_token:'synthetic-refresh',scope:odScope}]:[]};
 const gd={root:'ROOTG',start:'100',pages:[
   [{id:'GF1',name:'가상폴더',mimeType:'application/vnd.google-apps.folder',parents:['ROOTG'],ownedByMe:true},
    {id:'GA',name:'가상 초안.pdf',mimeType:'application/pdf',parents:['GF1'],size:'12',md5Checksum:'ABCDEF0123456789abcdef0123456789',modifiedTime:'2026-11-01T00:00:00Z',ownedByMe:true}],
   [{id:'GS',name:'남이 준 파일',mimeType:'application/pdf',parents:['X'],ownedByMe:false},
    {id:'GDOC',name:'가상 문서',mimeType:'application/vnd.google-apps.document',parents:['ROOTG'],ownedByMe:true}]],
  changes:[]};
 const od={root:'ODROOT!1',pages:[[
   {id:'ODROOT!1',name:'root',root:{},folder:{}},
   {id:'OF!2',name:'문서',folder:{childCount:1},parentReference:{id:'ODROOT!1'}},
   {id:'OX!3',name:'회의.docx',size:900,file:{mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',hashes:{quickXorHash:'AAAA+/=='}},parentReference:{id:'OF!2'}},
   {id:'OH!4',name:'page.html',size:5,file:{mimeType:'text/html',hashes:{sha1Hash:'A'.repeat(40)}},parentReference:{id:'OF!2'}}]],
  next:[],gone410:false};
 const calls=[];
 const ok=(v,status=200,headers={})=>new Response(v===null?null:JSON.stringify(v),{status,headers:{'content-type':'application/json',...headers}});
 const T={app_cloud_items:'items',app_cloud_sync:'sync',app_cloud_stars:'stars',app_onedrive_connections:'conn'};
 const key={items:r=>r.workspace_id+r.source+r.item_id,sync:r=>r.workspace_id+r.source,stars:r=>r.workspace_id+r.source+r.item_id,conn:r=>r.workspace_id};
 function match(row,params){
  for(const [k,v] of params){
   if(['select','order','limit','on_conflict','or'].includes(k))continue;
   const i=v.indexOf('.'),op=v.slice(0,i),val=v.slice(i+1);
   if(op==='eq'&&String(row[k])!==val)return false;
   if(op==='in'&&!val.slice(1,-1).split(',').map(s=>s.replace(/"/g,'')).includes(String(row[k])))return false;
   if(op==='lt'&&!(row[k]!=null&&String(row[k])<val))return false;
  }
  const or=params.get('or');
  if(or&&or.startsWith('(lock_until.is.null')){const at=or.split('.lt.')[1].slice(0,-1);if(row.lock_until&&!(row.lock_until<at))return false;}
  return true;
 }
 async function fetch(url,init={}){
  const u=new URL(url),method=init.method||'GET',h=init.headers||{};
  calls.push({method,host:u.host,path:u.pathname,search:u.search,auth:h.Authorization,range:h.Range});
  if(u.host==='sb.example.test'){
   if(u.pathname==='/auth/v1/user'){const t=h.Authorization?.slice(7);return t===JWT?ok({id:USER}):t===JWT2?ok({id:OTHER}):ok({msg:'bad'},401);}
   if(u.pathname==='/rest/v1/rpc/app_my_features'){assert.notEqual(h.Authorization,'Bearer '+ENV.SUPABASE_SERVICE_ROLE_KEY,'features use the user token');return ok(h.Authorization==='Bearer '+JWT?features:[]);}
   assert.equal(h.Authorization,'Bearer '+ENV.SUPABASE_SERVICE_ROLE_KEY);
   if(u.pathname==='/rest/v1/rpc/app_operator_feature_workspace'){assert.equal(JSON.parse(init.body).p_feature,'files');return ok(allowed);}
   const name=u.pathname.replace('/rest/v1/',''),p=u.searchParams;
   if(name==='app_workspace_members'){const id=p.get('user_id').slice(3);return ok(id===USER?[{workspace_id:WS}]:id===OTHER?[{workspace_id:WS2}]:[]);}
   if(name==='app_workspaces')return ok(driveWs?[{id:driveWs}]:[]);
   if(name==='public_policy_drive_config')return ok([{google_client_id:'c',google_client_secret:'s',google_refresh_token:'synthetic-gd-refresh'}]);
   const t=T[name];assert.ok(t,name);
   const rep=/representation/.test(h.Prefer||'');
   if(method==='GET')return ok(db[t].filter(x=>match(x,p)));
   if(method==='POST'){const ignore=/ignore-duplicates/.test(h.Prefer||'');
    for(const r of [].concat(JSON.parse(init.body))){const i=db[t].findIndex(x=>key[t](x)===key[t](r));if(i<0)db[t].push({...r});else if(!ignore)Object.assign(db[t][i],r);}return ok(null,201);}
   if(method==='PATCH'){const v=JSON.parse(init.body);const hit=db[t].filter(x=>match(x,p));hit.forEach(x=>Object.assign(x,v));return rep?ok(hit):ok(null,204);}
   if(method==='DELETE'){const hit=db[t].filter(x=>match(x,p));db[t]=db[t].filter(x=>!match(x,p));return rep?ok(hit):ok(null,204);}
  }
  if(u.host==='oauth2.googleapis.com'&&u.pathname==='/token')return ok({access_token:GD_ACCESS,scope:gdScope,expires_in:3600});
  if(u.host==='login.microsoftonline.com'){const b=new URLSearchParams(init.body);assert.equal(b.get('scope'),'Files.ReadWrite offline_access User.Read');
   return ok({access_token:OD_ACCESS,refresh_token:'synthetic-refresh-2',expires_in:3600});}
  assert.notEqual(method,'DELETE','never delete anything in a cloud');
  assert.equal(method,'GET','read-only function');
  if(u.host==='www.googleapis.com'){
   assert.equal(h.Authorization,'Bearer '+GD_ACCESS);
   const P=u.pathname.replace('/drive/v3','');
   if(P==='/files/root')return ok({id:gd.root});
   if(P==='/changes/startPageToken')return ok({startPageToken:gd.start});
   if(P==='/files'){assert.equal(u.searchParams.get('q'),"'me' in owners and trashed=false");const tok=u.searchParams.get('pageToken');const i=tok?Number(tok):0;
    return ok({files:gd.pages[i],...(i+1<gd.pages.length?{nextPageToken:String(i+1)}:{})});}
   if(P==='/changes'){assert.equal(u.searchParams.get('restrictToMyDrive'),'true');if(u.searchParams.get('pageToken')==='bad')return ok({error:{}},400);
    return ok({changes:gd.changes,newStartPageToken:'101'});}
   const m=/^\/files\/([A-Za-z0-9_-]+)(\/export)?$/.exec(P);
   if(m&&m[2]){assert.equal(u.searchParams.get('mimeType'),'application/pdf');return new Response(new Uint8Array([37,80,68,70]),{headers:{'content-type':'application/pdf','content-length':'4'}});}
   if(m&&u.searchParams.get('alt')==='media')return new Response(new Uint8Array([9,9]),{headers:{'content-type':'application/pdf','content-length':'2'}});
   if(m)return ok({id:m[1],webViewLink:'https://drive.google.com/file/d/'+m[1]+'/view',thumbnailLink:'https://lh3.googleusercontent.com/t=s220',trashed:false});
  }
  if(u.host==='lh3.googleusercontent.com')return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/jpeg'}});
  if(u.host==='graph.microsoft.com'){
   assert.equal(h.Authorization,'Bearer '+OD_ACCESS);
   const P=u.pathname.replace('/v1.0','');
   if(P==='/me/drive/root')return ok({id:od.root});
   if(P==='/me/drive/root/delta'){
    if(u.searchParams.get('token')==='expired'){if(od.gone410){od.gone410=false;return ok({error:{code:'resyncRequired'}},410);}}
    if(u.searchParams.get('token')==='later')return ok({value:od.next,'@odata.deltaLink':'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=later'});
    return ok({value:od.pages[0],'@odata.deltaLink':'https://graph.microsoft.com/v1.0/me/drive/root/delta?token='+(od.gone410?'expired':'later')});
   }
   if(/\/content$/.test(P)){assert.equal(init.redirect,'manual');return new Response(null,{status:302,headers:{location:DL+(u.searchParams.get('format')?'?pdf':'')}});}
   const m=/^\/me\/drive\/items\/([^/]+)$/.exec(P);
   if(m)return ok({id:decodeURIComponent(m[1]),webUrl:'https://onedrive.live.com/?id=x'});
  }
  if(url.startsWith(DL)){assert.equal(h.Authorization,undefined,'pre-authenticated URL gets no token');
   if(url.endsWith('?pdf'))return new Response(new Uint8Array([37,80]),{headers:{'content-type':'application/pdf'}});
   if(calls.at(-2)?.path.includes('/thumbnails/'))return new Response(new Uint8Array([1]),{headers:{'content-type':'image/jpeg'}});
   return new Response('<script>x</script>',{status:h.Range?206:200,headers:{'content-type':'text/html','content-range':h.Range?'bytes 0-1/5':''}});}
  throw new Error('unexpected host '+u.host+u.pathname);
 }
 const handler=createCloudFilesHandler({fetch,env:k=>ENV[k],now:()=>clock});
 const post=(body,jwt=JWT,headers={})=>handler(new Request('https://fn.example.test/cloud-files',{method:'POST',headers:{Authorization:'Bearer '+jwt,'content-type':'application/json',...headers},body:JSON.stringify(body)}));
 return {db,gd,od,calls,handler,post,tick:ms=>{clock+=ms;}};
}
const j=async r=>({status:r.status,body:await r.json()});

test('gate: OPTIONS, login, owner, files feature; Drive owner mismatch blocks only Google',async()=>{
 const w=world();
 assert.equal((await w.handler(new Request('https://fn.example.test',{method:'OPTIONS'}))).status,200);
 assert.equal((await w.handler(new Request('https://fn.example.test',{method:'POST',body:'{}'}))).status,401);
 assert.equal((await j(await w.post({action:'status'},'nope'))).status,401);
 assert.deepEqual(await j(await w.post({action:'status'},JWT2)),{status:403,body:{ok:false,error:'feature_required'}});
 const nf=world({features:['calls','gdrive_photos']});
 assert.deepEqual(await j(await nf.post({action:'status'})),{status:403,body:{ok:false,error:'feature_required'}});
 assert.equal((await w.post({action:'nope'})).status,400);
 assert.equal((await w.post({action:'status'},JWT,{'content-type':'text/plain'})).status,415);
 const mis=world({driveWs:WS2});
 const s=await j(await mis.post({action:'sync'}));
 assert.equal(s.status,403,'Drive owner mismatch is a hard stop');
 const st=await j(await mis.post({action:'status'}));
 assert.equal(st.body.gd.connected,false);assert.equal(st.body.od.connected,true);
});

test('google: first scan via startPageToken + files.list, my drive only, root normalized, then changes follow',async()=>{
 const w=world();
 const r=await j(await w.post({action:'sync',source:'gd'}));
 assert.equal(r.status,200);assert.equal(r.body.gd.done,true);
 const ids=w.db.items.map(x=>x.item_id).sort();
 assert.deepEqual(ids,['GA','GDOC','GF1'],'남이 준 파일(ownedByMe false)은 넣지 않음');
 const ga=w.db.items.find(x=>x.item_id==='GA');
 assert.equal(ga.parent_id,'GF1');assert.equal(ga.hash,'md5:abcdef0123456789abcdef0123456789');assert.equal(ga.size_bytes,12);
 assert.equal(w.db.items.find(x=>x.item_id==='GF1').parent_id,null);
 const sync=w.db.sync.find(x=>x.source==='gd');
 assert.equal(sync.cursor,'101');assert.ok(sync.index_done_at);assert.equal(sync.next_page,null);assert.equal(sync.lock_until,null);
 assert.deepEqual(r.body.changed.map(x=>x.item_id).sort(),['GA','GDOC','GF1']);
 assert.ok(!JSON.stringify(r.body).includes('synthetic'),'no token in response');
 // 2분 안에는 클라우드를 부르지 않는다(F2).
 const n=w.calls.length;
 assert.equal((await j(await w.post({action:'sync',source:'gd'}))).body.gd.fresh,true);
 assert.ok(w.calls.slice(n).every(c=>c.host==='sb.example.test'));
 // 2분 뒤: 바뀐 것만. 지운 폴더는 그 아래까지 빠지고, 휴지통 파일은 trashed 표시.
 w.tick(FRESH_MS+1);
 w.gd.changes=[{fileId:'GF1',removed:true},{fileId:'GDOC',file:{id:'GDOC',name:'가상 문서',mimeType:'application/vnd.google-apps.document',parents:['ROOTG'],trashed:true,ownedByMe:true}},
  {fileId:'GN',file:{id:'GN',name:'새 파일.txt',mimeType:'text/plain',parents:['ROOTG'],ownedByMe:true}}];
 const c=await j(await w.post({action:'sync'}));
 assert.deepEqual(w.db.items.filter(x=>x.source==='gd').map(x=>x.item_id).sort(),['GDOC','GN']);
 assert.equal(w.db.items.find(x=>x.item_id==='GDOC').trashed,true);
 assert.deepEqual(c.body.removed.filter(x=>x.source==='gd').map(x=>x.id).sort(),['GA','GF1']);
 // 커서가 거절되면(400) 그 출처만 처음부터 다시 훑는다.
 w.tick(FRESH_MS+1);
 w.db.sync.find(x=>x.source==='gd').cursor='bad';w.gd.changes=[];
 await w.post({action:'sync',source:'gd'});
 assert.equal(w.db.sync.find(x=>x.source==='gd').cursor,null);
 w.tick(1000);
 const again=await j(await w.post({action:'sync',source:'gd'}));
 assert.equal(again.body.gd.done,true);
 assert.deepEqual(w.db.items.filter(x=>x.source==='gd').map(x=>x.item_id).sort(),['GA','GDOC','GF1'],'다시 훑으면 옛 줄(GN)은 빠짐');
});

test('onedrive: delta scan skips root, normalizes parent, saves rotated refresh token; deleted folder takes children; 410 rescans',async()=>{
 const w=world();
 const r=await j(await w.post({action:'sync',source:'od'}));
 assert.equal(r.body.od.done,true);
 assert.deepEqual(w.db.items.map(x=>x.item_id).sort(),['OF!2','OH!4','OX!3']);
 assert.equal(w.db.items.find(x=>x.item_id==='OF!2').parent_id,null);
 assert.equal(w.db.items.find(x=>x.item_id==='OX!3').hash,'qx:AAAA+/==');
 assert.equal(w.db.items.find(x=>x.item_id==='OH!4').hash,'sha1:'+'a'.repeat(40));
 assert.equal(w.db.conn[0].refresh_token,'synthetic-refresh-2');
 assert.match(w.db.sync.find(x=>x.source==='od').cursor,/^https:\/\/graph\.microsoft\.com\//);
 w.tick(FRESH_MS+1);
 w.od.next=[{id:'OF!2',deleted:{}}];
 const c=await j(await w.post({action:'sync',source:'od'}));
 assert.deepEqual(w.db.items.filter(x=>x.source==='od'),[]);
 assert.deepEqual(c.body.removed.map(x=>x.id).sort(),['OF!2','OH!4','OX!3']);
 // 410 resyncRequired → 처음부터
 const w2=world();w2.od.gone410=true;
 await w2.post({action:'sync',source:'od'});
 w2.tick(FRESH_MS+1);w2.od.gone410=true;
 const x=await j(await w2.post({action:'sync',source:'od'}));
 assert.equal(x.body.od.done,true);
 assert.deepEqual(w2.db.items.map(i=>i.item_id).sort(),['OF!2','OH!4','OX!3']);
});

test('onedrive: missing connection or widened scope is reported, not crashed',async()=>{
 assert.equal((await j(await world({odConn:false}).post({action:'sync',source:'od'}))).body.od.error,'od_not_connected');
 assert.equal((await j(await world({odScope:'Files.ReadWrite.All offline_access'}).post({action:'sync',source:'od'}))).body.od.error,'od_reconnect_needed');
 assert.equal((await j(await world({gdScope:FULL+'.file'}).post({action:'sync',source:'gd'}))).body.gd.error,'gd_scope_missing');
});

test('thumb, media, preview, open-url: only indexed items; risky types become downloads; no token reaches the pre-auth URL',async()=>{
 const w=world();
 await w.post({action:'sync'});
 assert.deepEqual(await j(await w.post({action:'media',source:'od',id:'NOPE!1'})),{status:404,body:{ok:false,error:'not_in_index'}});
 assert.equal((await w.post({action:'media',source:'gd',id:'bad id'})).status,400);
 assert.equal((await w.post({action:'media',source:'xx',id:'GA'})).status,400);
 const m=await w.post({action:'media',source:'od',id:'OH!4'},JWT,{range:'bytes=0-1'});
 assert.equal(m.status,206);assert.equal(m.headers.get('content-type'),'application/octet-stream');
 assert.match(m.headers.get('content-disposition'),/^attachment/);assert.equal(m.headers.get('x-content-type-options'),'nosniff');
 assert.ok(w.calls.some(c=>c.range==='bytes=0-1'&&c.host==='dl.example-1drv.test'));
 const g=await w.post({action:'media',source:'gd',id:'GA'});
 assert.equal(g.headers.get('content-type'),'application/pdf');assert.equal(g.headers.get('content-disposition'),null);
 assert.equal((await w.post({action:'media',source:'gd',id:'GDOC'})).status,415);
 assert.equal((await w.post({action:'media',source:'gd',id:'GF1'})).status,404,'folders are not media');
 const p1=await w.post({action:'preview',source:'od',id:'OX!3'});
 assert.equal(p1.status,200);assert.equal(p1.headers.get('content-type'),'application/pdf');
 assert.ok(w.calls.some(c=>c.path.endsWith('/content')&&c.search==='?format=pdf'));
 assert.equal((await w.post({action:'preview',source:'gd',id:'GDOC'})).headers.get('content-type'),'application/pdf');
 assert.equal((await w.post({action:'preview',source:'od',id:'OH!4'})).status,415);
 assert.equal((await w.post({action:'preview',source:'gd',id:'GA'})).status,415);
 assert.equal((await w.post({action:'thumb',source:'gd',id:'GA'})).headers.get('content-type'),'image/jpeg');
 assert.deepEqual((await j(await w.post({action:'open-url',source:'gd',id:'GF1'}))).body,{ok:true,url:'https://drive.google.com/file/d/GF1/view'});
 assert.deepEqual((await j(await w.post({action:'open-url',source:'od',id:'OX!3'}))).body,{ok:true,url:'https://onedrive.live.com/?id=x'});
 // 다른 작업공간 사람은 같은 id여도 못 받는다(문에서 막힘).
 assert.equal((await w.post({action:'media',source:'gd',id:'GA'},JWT2)).status,403);
});

test('helpers: rows, open url hosts, served types',()=>{
 assert.equal(odRow(WS,'R',{id:'R',root:{}},'t'),null);
 assert.equal(odRow(WS,'R',{id:'a b',name:'x',parentReference:{id:'R'}},'t'),null);
 assert.equal(gdRow(WS,'R',{id:'X',name:'n',ownedByMe:false},'t'),null);
 assert.equal(gdRow(WS,'R',{id:'X',name:'',ownedByMe:true},'t'),null);
 assert.equal(safeOpenUrl('gd','https://evil.example/x'),null);
 assert.equal(safeOpenUrl('od','http://onedrive.live.com/x'),null);
 assert.equal(safeOpenUrl('od','https://x.sharepoint.com/a'),'https://x.sharepoint.com/a');
 for(const t of ['text/html','image/svg+xml','application/javascript','application/xhtml+xml',null])assert.equal(servedType(t).inline,false,String(t));
 for(const t of ['image/jpeg','video/mp4','application/pdf','text/plain; charset=utf-8'])assert.equal(servedType(t).inline,true,t);
});

test('static: read-only function — no permanent delete, trash emptying, sharing links, permission or owner changes, no writes to clouds',()=>{
 const src=read('supabase/functions/cloud-files/handler.ts')+read('supabase/functions/cloud-files/index.ts');
 const code=src.split('\n').filter(l=>!l.trim().startsWith('//')).join('\n');
 for(const bad of [/permanentDelete/i,/emptyTrash/i,/createLink/i,/\/invite\b/i,/\/permissions/i,/transferOwnership/i,/files\.delete/i,/Files\.ReadWrite\.All/,
  /method:\s*"(PUT|PATCH|DELETE)"[^\n]*(GRAPH|DRIVE)/,/uploadType|createUploadSession/])assert.doesNotMatch(code,bad,String(bad));
 // 클라우드로 가는 요청은 모두 GET(토큰 받기·Supabase 제외): cloud()/cloudJson()은 method를 받지 않는다.
 assert.doesNotMatch(code,/cloud\([^)]*method:/);
 assert.match(code,/FEATURE = "files"/);
 assert.match(code,/includes\(FEATURE\)/);
 assert.match(read('supabase/functions/cloud-files/index.ts'),/verify_jwt=true/);
 assert.doesNotMatch(code,/localStorage|console\.log/);
});

test('deploy table: cloud-files registered once with verify_jwt true, first deploy pending',()=>{
 const rows=read('docs/web2-env6b-edge-source.md').split('\n').filter(l=>/^\| \d+ \| `cloud-files` \|/.test(l));
 assert.equal(rows.length,1);
 assert.match(rows[0],/\| 배포 대기 \| 없음 \| \*\*true\*\* \|/);
});
