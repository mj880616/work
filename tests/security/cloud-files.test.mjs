import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// S48-12b ③: 실제 cloud-files handler를 지어낸 Supabase(PostgREST)·원드라이브(Graph)·구글 드라이브로 돌린다. 네트워크 없음.
// 비밀값·토큰·계정·파일 이름은 모두 고정 가짜 글자다.
const {createCloudFilesHandler,odRow,gdRow,safeOpenUrl,servedType,FRESH_MS,cleanName,idList,uniqueName,safeUploadUrl,ACROSS_MAX_BYTES}=await import('../../supabase/functions/cloud-files/handler.ts');
const {createHash}=await import('node:crypto');
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
 const calls=[],writes=[],uploads={};
 const odItem=id=>od.pages[0].find(x=>x.id===id);
 const gdFile=id=>gd.pages.flat().find(x=>x.id===id);
 const hashOf=(alg,bytes)=>createHash(alg).update(bytes).digest('hex');
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
   if(op==='neq'&&String(row[k])===val)return false;
   if(op==='is'&&val==='null'&&row[k]!=null)return false;
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
  // 구글 DELETE는 영구 삭제다: 어떤 경우에도 보내지 않는다. 원드라이브 DELETE는 items/{id}(휴지통)만.
  if(u.host==='www.googleapis.com')assert.notEqual(method,'DELETE','Google DELETE is a permanent delete');
  if(method==='DELETE')assert.match(u.pathname,/^\/v1\.0\/me\/drive\/items\/[^/]+$/,'only OneDrive recycle-bin delete');
  if(method!=='GET')writes.push({method,host:u.host,path:u.pathname,search:u.search,body:typeof init.body==='string'?JSON.parse(init.body):null});
  // 이어 올리기 조각(토큰 없이).
  if(method==='PUT'&&(u.host==='sn1.up.1drv.com'||(u.host==='www.googleapis.com'&&u.searchParams.get('upload_id')))){
   assert.equal(h.Authorization,undefined,'upload URL gets no token');
   const up=uploads[url];const m=/^bytes (\d+)-(\d+)\/(\d+)$|^bytes \*\/(\d+)$/.exec(h['Content-Range']);assert.ok(m,h['Content-Range']);
   if(m[1]!==undefined){assert.equal(Number(m[1]),up.bytes.length);up.bytes=Buffer.concat([up.bytes,Buffer.from(init.body)]);}
   const total=Number(m[3]??m[4]);
   if(up.bytes.length<total)return new Response(null,{status:up.dest==='gd'?308:202});
   const bytes=up.corrupt?Buffer.concat([up.bytes.subarray(1),Buffer.from([0])]):up.bytes;
   if(up.dest==='gd')return ok({id:'GUP',name:up.name,mimeType:'application/pdf',parents:up.parents,size:String(bytes.length),md5Checksum:hashOf('md5',bytes),ownedByMe:true},200);
   return ok({id:'OUP!7',name:up.name,size:bytes.length,file:{mimeType:'application/octet-stream',hashes:{sha1Hash:hashOf('sha1',bytes).toUpperCase()}},parentReference:{id:up.parent}},201);
  }
  if(u.host==='www.googleapis.com'){
   assert.equal(h.Authorization,'Bearer '+GD_ACCESS);
   const P=u.pathname.replace('/drive/v3','');
   if(P==='/files/root')return ok({id:gd.root});
   if(P==='/changes/startPageToken')return ok({startPageToken:gd.start});
   if(u.pathname==='/upload/drive/v3/files'&&method==='POST'){assert.equal(u.searchParams.get('uploadType'),'resumable');const b=JSON.parse(init.body);
    const loc='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=U'+(Object.keys(uploads).length+1);
    uploads[loc]={dest:'gd',name:b.name,parents:b.parents,bytes:Buffer.alloc(0),corrupt:gd.corrupt};return new Response(null,{status:200,headers:{location:loc}});}
   if(P==='/files'&&method==='POST'){const b=JSON.parse(init.body);assert.equal(b.mimeType,'application/vnd.google-apps.folder');
    return ok({id:'GNEW',name:b.name,mimeType:b.mimeType,parents:b.parents,ownedByMe:true});}
   const wm=/^\/files\/([A-Za-z0-9_-]+)$/.exec(P);
   if(wm&&method==='PATCH'){const f=gdFile(wm[1]);assert.ok(f,'patch known file');const b=JSON.parse(init.body);
    if(b.name)f.name=b.name;if(b.trashed===true)f.trashed=true;
    if(u.searchParams.get('addParents')){assert.deepEqual(u.searchParams.get('removeParents').split(','),f.parents);f.parents=[u.searchParams.get('addParents')];}
    return ok({...f});}
   if(wm&&u.searchParams.get('fields')==='parents,ownedByMe'){const f=gdFile(wm[1]);return ok({parents:f.parents,ownedByMe:f.ownedByMe});}
   if(P==='/files'&&/ in parents/.test(u.searchParams.get('q')||'')){const m=/^'([^']+)' in parents and 'me' in owners and trashed=false$/.exec(u.searchParams.get('q'));assert.ok(m,'children q');
    return ok({files:(gd.children||[]).filter(f=>f.parents[0]===m[1])});}
   if(P==='/files'){assert.equal(u.searchParams.get('q'),"'me' in owners and trashed=false");const tok=u.searchParams.get('pageToken');const i=tok?Number(tok):0;gd.callMs&&(clock+=gd.callMs);
    return ok({files:gd.pages[i],...(i+1<gd.pages.length?{nextPageToken:String(i+1)}:{})});}
   if(P==='/changes'){assert.equal(u.searchParams.get('restrictToMyDrive'),'true');if(u.searchParams.get('pageToken')==='bad')return ok({error:{}},400);
    return ok({changes:gd.changes,newStartPageToken:'101'});}
   const m=/^\/files\/([A-Za-z0-9_-]+)(\/export)?$/.exec(P);
   if(m&&m[2]){assert.equal(u.searchParams.get('mimeType'),'application/pdf');return new Response(new Uint8Array([37,80,68,70]),{headers:{'content-type':'application/pdf','content-length':'4'}});}
   if(m&&u.searchParams.get('alt')==='media'){const b=gd.media?.[m[1]]||new Uint8Array([9,9]);return new Response(b,{headers:{'content-type':'application/pdf','content-length':String(b.length)}});}
   if(m)return ok({id:m[1],webViewLink:'https://drive.google.com/file/d/'+m[1]+'/view',thumbnailLink:'https://lh3.googleusercontent.com/t=s220',trashed:false});
  }
  if(u.host==='lh3.googleusercontent.com')return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/jpeg'}});
  if(u.host==='graph.microsoft.com'){
   assert.equal(h.Authorization,'Bearer '+OD_ACCESS);
   const P=u.pathname.replace('/v1.0','');
   if(P==='/me/drive/root')return ok({id:od.root});
   if(/\/children$/.test(P)&&method==='GET'){const par=/items\/([^/]+)\/children/.exec(P)?.[1];const pid=par?decodeURIComponent(par):od.root;
    return ok({value:(od.children||[]).filter(x=>x.parentReference.id===pid)});}
   if(P==='/me/drive/root/delta'){
    if(u.searchParams.get('token')==='expired'){if(od.gone410){od.gone410=false;return ok({error:{code:'resyncRequired'}},410);}}
    if(od.multi){od.callMs&&(clock+=od.callMs);const tk=u.searchParams.get('token')||'p0',n=Number(tk.slice(1));
     if(tk.startsWith('p'))return ok({value:od.multi[n],...(n+1<od.multi.length?{'@odata.nextLink':'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=p'+(n+1)}:{'@odata.deltaLink':'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=later'})});}
    if(u.searchParams.get('token')==='later')return ok({value:od.next,'@odata.deltaLink':'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=later'});
    return ok({value:od.pages[0],'@odata.deltaLink':'https://graph.microsoft.com/v1.0/me/drive/root/delta?token='+(od.gone410?'expired':'later')});
   }
   if(method==='PUT'&&/:\/content$/.test(P)){const nm=decodeURIComponent(P.split(':/')[1]);const par=/items\/([^/:]+)/.exec(P)?.[1];
    const bytes=Buffer.from(init.body);return ok({id:'OUP!7',name:nm,size:bytes.length,file:{mimeType:'application/octet-stream',hashes:{sha1Hash:hashOf('sha1',bytes)}},parentReference:{id:par?decodeURIComponent(par):od.root}},201);}
   if(method==='POST'&&/:\/createUploadSession$/.test(P)){const par=/items\/([^/:]+)/.exec(P)?.[1];const loc='https://sn1.up.1drv.com/up/'+(Object.keys(uploads).length+1);
    uploads[loc]={dest:'od',name:JSON.parse(init.body).item.name,parent:par?decodeURIComponent(par):od.root,bytes:Buffer.alloc(0),corrupt:od.corrupt};return ok({uploadUrl:loc});}
   if(method==='POST'&&/\/children$/.test(P)){const b=JSON.parse(init.body);assert.equal(b['@microsoft.graph.conflictBehavior'],'fail');
    const par=/items\/([^/]+)\/children/.exec(P)?.[1];return ok({id:'ONEW!9',name:b.name,folder:{childCount:0},parentReference:{id:par?decodeURIComponent(par):od.root}},201);}
   const im=/^\/me\/drive\/items\/([^/]+)$/.exec(P);
   if(im&&method==='DELETE'){assert.ok(odItem(decodeURIComponent(im[1])));return new Response(null,{status:204});}
   if(im&&method==='PATCH'){const it=odItem(decodeURIComponent(im[1]));assert.ok(it);const b=JSON.parse(init.body);
    if(b.name){if(od.taken===b.name)return ok({error:{code:'nameAlreadyExists'}},409);it.name=b.name;}
    if(b.parentReference)it.parentReference={id:b.parentReference.id};
    return ok({...it});}
   if(/\/content$/.test(P)){assert.equal(init.redirect,'manual');const iid=/items\/([^/]+)\//.exec(P)?.[1]||'';
    return new Response(null,{status:302,headers:{location:DL+'?i='+iid+(u.searchParams.get('format')?'&pdf':'')}});}
   const m=/^\/me\/drive\/items\/([^/]+)$/.exec(P);
   if(m)return ok({id:decodeURIComponent(m[1]),webUrl:'https://onedrive.live.com/?id=x'});
  }
  if(url.startsWith(DL)){assert.equal(h.Authorization,undefined,'pre-authenticated URL gets no token');
   if(url.endsWith('&pdf'))return new Response(new Uint8Array([37,80]),{headers:{'content-type':'application/pdf'}});
   if(calls.at(-2)?.path.includes('/thumbnails/'))return new Response(new Uint8Array([1]),{headers:{'content-type':'image/jpeg'}});
   const mid=decodeURIComponent(new URL(url).searchParams.get('i')||'');
   if(od.media?.[mid]){const b=od.media[mid];return new Response(b,{headers:{'content-type':'application/octet-stream','content-length':String(b.length)}});}
   return new Response('<script>x</script>',{status:h.Range?206:200,headers:{'content-type':'text/html','content-range':h.Range?'bytes 0-1/5':''}});}
  throw new Error('unexpected host '+u.host+u.pathname);
 }
 const handler=createCloudFilesHandler({fetch,env:k=>ENV[k],now:()=>clock});
 const post=(body,jwt=JWT,headers={})=>handler(new Request('https://fn.example.test/cloud-files',{method:'POST',headers:{Authorization:'Bearer '+jwt,'content-type':'application/json',...headers},body:JSON.stringify(body)}));
 return {db,gd,od,calls,writes,uploads,handler,post,tick:ms=>{clock+=ms;}};
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

test('static: no permanent delete, trash emptying, sharing links, permission or owner changes; Google never gets DELETE',()=>{
 const src=read('supabase/functions/cloud-files/handler.ts')+read('supabase/functions/cloud-files/index.ts');
 const code=src.split('\n').filter(l=>!l.trim().startsWith('//')).join('\n');
 for(const bad of [/permanentDelete/i,/emptyTrash/i,/createLink/i,/\/invite\b/i,/\/permissions/i,/transferOwnership/i,/files\.delete/i,/Files\.ReadWrite\.All/,
  /\/restore\b/i,/supportsAllDrives/i])assert.doesNotMatch(code,bad,String(bad));
 // DELETE는 원드라이브 휴지통 한 곳(toTrash)에서만, 구글로는 PATCH trashed:true만.
 assert.equal((code.match(/"DELETE"\)/g)||[]).length,1,'one OneDrive recycle-bin DELETE call');
 assert.match(code,/od_trash", token, `\$\{GRAPH\}\/me\/drive\/items\/\$\{encodeURIComponent\(id\)\}`, "DELETE"\)/);
 assert.match(code,/gd_trash", token, `\$\{DRIVE\}\/files\/[^`]+`, "PATCH", \{ trashed: true \}\)/);
 // 모든 쓰기 action은 confirm:true를 먼저 본다.
 for(const a of ['rename','mkdir','move','trash','across'])assert.match(code,new RegExp(`async ${a}\\(\\{[^}]*\\}\\) \\{\\n\\s*mustConfirm\\(b\\);`),a);
 assert.match(code,/FEATURE = "files"/);
 assert.match(code,/includes\(FEATURE\)/);
 assert.match(read('supabase/functions/cloud-files/index.ts'),/verify_jwt=true/);
 assert.doesNotMatch(code,/console\.log/);
});

test('write gate: confirm:true required, other workspace blocked, only indexed items, bad names rejected',async()=>{
 const w=world();
 await w.post({action:'sync'});
 const n=w.writes.length;
 assert.deepEqual(await j(await w.post({action:'rename',source:'od',id:'OX!3',name:'새 이름.docx'})),{status:400,body:{ok:false,error:'confirm_required'}});
 assert.equal((await w.post({action:'trash',source:'od',ids:['OX!3'],confirm:'yes'})).status,400);
 assert.equal((await w.post({action:'rename',source:'od',id:'OX!3',name:'x.docx',confirm:true},JWT2)).status,403,'other workspace');
 assert.equal((await w.post({action:'rename',source:'od',id:'OX!3',name:'x.docx',confirm:true},'nope')).status,401);
 assert.equal((await w.post({action:'rename',source:'od',id:'NOPE!1',name:'x',confirm:true})).status,404);
 assert.equal((await w.post({action:'trash',source:'gd',ids:['GA','NOPE'],confirm:true})).status,404,'one unknown id stops the whole batch');
 for(const bad of ['', 'a/b', 'a\\b', 'x.', 'a:b', 'x'.repeat(121), 'a\u0000b'])
  assert.deepEqual((await j(await w.post({action:'rename',source:'gd',id:'GA',name:bad,confirm:true}))).body.error,'name_invalid',JSON.stringify(bad));
 assert.equal((await w.post({action:'trash',source:'gd',ids:[],confirm:true})).status,400);
 assert.equal((await w.post({action:'trash',source:'gd',ids:Array.from({length:201},(_,i)=>'G'+i),confirm:true})).status,400,'over 200');
 assert.equal((await w.post({action:'trash',source:'gd',ids:['GA','GA'],confirm:true})).status,400,'duplicates');
 assert.equal(w.writes.length,n,'nothing was written to any cloud');
 // 다른 작업공간의 색인 줄은 대상이 아니다(작업공간은 서버가 로그인에서 정함).
 w.db.items.push({workspace_id:WS2,source:'gd',item_id:'GZ',parent_id:null,name:'남의 것',is_folder:false,trashed:false});
 assert.equal((await w.post({action:'trash',source:'gd',ids:['GZ'],confirm:true})).status,404);
});

test('rename and mkdir: cloud first, then index updated in the same request; same-name blocked',async()=>{
 const w=world();
 await w.post({action:'sync'});
 const r=await j(await w.post({action:'rename',source:'od',id:'OX!3',name:'회의 정리.docx',confirm:true}));
 assert.equal(r.status,200);assert.equal(r.body.changed[0].name,'회의 정리.docx');
 assert.equal(w.db.items.find(x=>x.item_id==='OX!3').name,'회의 정리.docx');
 assert.ok(w.writes.some(x=>x.method==='PATCH'&&x.search.includes('conflictBehavior=fail')));
 assert.equal((await j(await w.post({action:'rename',source:'od',id:'OX!3',name:'PAGE.HTML',confirm:true}))).body.error,'name_taken','case-insensitive sibling');
 w.od.taken='겹침.docx';
 assert.deepEqual(await j(await w.post({action:'rename',source:'od',id:'OX!3',name:'겹침.docx',confirm:true})),{status:409,body:{ok:false,error:'name_taken'}});
 const g=await j(await w.post({action:'rename',source:'gd',id:'GA',name:'고친 초안.pdf',confirm:true}));
 assert.equal(g.body.changed[0].parent_id,'GF1');assert.equal(w.db.items.find(x=>x.item_id==='GA').name,'고친 초안.pdf');
 const m=await j(await w.post({action:'mkdir',source:'gd',parent:'GF1',name:'새 폴더',confirm:true}));
 assert.equal(m.body.changed[0].item_id,'GNEW');assert.equal(m.body.changed[0].is_folder,true);assert.equal(m.body.changed[0].parent_id,'GF1');
 const mr=await j(await w.post({action:'mkdir',source:'od',parent:null,name:'맨 위 새 폴더',confirm:true}));
 assert.equal(mr.body.changed[0].parent_id,null,'root parent normalized');
 assert.equal((await w.post({action:'mkdir',source:'gd',parent:'GA',name:'x',confirm:true})).status,400,'parent must be a folder');
 assert.equal((await j(await w.post({action:'mkdir',source:'od',parent:null,name:'문서',confirm:true}))).body.error,'name_taken');
 assert.ok(!JSON.stringify(r.body).includes('synthetic'));
});

test('move within a cloud: parents swapped, folder cannot go under itself, results reflected',async()=>{
 const w=world();
 await w.post({action:'sync'});
 const r=await j(await w.post({action:'move',source:'gd',ids:['GA'],to:null,confirm:true}));
 assert.equal(r.status,200);assert.equal(r.body.changed[0].parent_id,null);assert.deepEqual(r.body.failed,[]);assert.deepEqual(r.body.left,[]);
 const pw=w.writes.find(x=>x.method==='PATCH'&&x.path.endsWith('/files/GA'));
 assert.equal(new URLSearchParams(pw.search).get('addParents'),'ROOTG');assert.equal(new URLSearchParams(pw.search).get('removeParents'),'GF1');
 assert.equal(w.db.items.find(x=>x.item_id==='GA').parent_id,null);
 assert.equal((await j(await w.post({action:'move',source:'gd',ids:['GF1'],to:'GF1',confirm:true}))).body.error,'move_into_self');
 const o=await j(await w.post({action:'move',source:'od',ids:['OX!3','OH!4'],to:null,confirm:true}));
 assert.deepEqual(o.body.changed.map(x=>x.item_id).sort(),['OH!4','OX!3']);
 assert.ok(o.body.changed.every(x=>x.parent_id===null));
 const back=await j(await w.post({action:'move',source:'od',ids:['OX!3'],to:'OF!2',confirm:true}));
 assert.equal(back.body.changed[0].parent_id,'OF!2');
 assert.equal((await w.post({action:'move',source:'od',ids:['OX!3'],to:'OH!4',confirm:true})).status,400,'destination must be a folder');
});

test('trash: OneDrive goes to its own recycle bin (DELETE items/{id}), Google only trashed:true; folder takes children out of the index',async()=>{
 const w=world();
 await w.post({action:'sync'});
 w.db.stars.push({workspace_id:WS,source:'od',item_id:'OX!3'});
 const r=await j(await w.post({action:'trash',source:'od',ids:['OF!2'],confirm:true}));
 assert.equal(r.status,200);
 assert.deepEqual(r.body.removed.map(x=>x.id).sort(),['OF!2','OH!4','OX!3']);
 assert.deepEqual(w.db.items.filter(x=>x.source==='od'),[]);assert.deepEqual(w.db.stars,[]);
 assert.deepEqual(w.writes.filter(x=>x.method==='DELETE').map(x=>x.path),['/v1.0/me/drive/items/OF!2']);
 const g=await j(await w.post({action:'trash',source:'gd',ids:['GA','GDOC'],confirm:true}));
 assert.deepEqual(g.body.removed.map(x=>x.id).sort(),['GA','GDOC']);
 assert.ok(w.writes.filter(x=>x.host==='www.googleapis.com').every(x=>x.method==='PATCH'&&x.body.trashed===true));
});

test('across: one file, size and hash checked, original trashed only after the copy matches',async()=>{
 const bytes=Buffer.from(Array.from({length:3000},(_,i)=>(i*7)&255));
 const w=world();
 w.gd.pages[0].push({id:'GB',name:'옮길 파일.pdf',mimeType:'application/pdf',parents:['GF1'],size:String(bytes.length),md5Checksum:createHash('md5').update(bytes).digest('hex'),ownedByMe:true});
 w.gd.media={GB:bytes};
 await w.post({action:'sync'});
 // 구글 → 원드라이브(작은 파일은 한 번에 PUT)
 const r=await j(await w.post({action:'across',source:'gd',id:'GB',to_source:'od',to:'OF!2',confirm:true}));
 assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal(r.body.changed[0].source,'od');assert.equal(r.body.changed[0].parent_id,'OF!2');assert.equal(r.body.changed[0].size_bytes,3000);
 assert.deepEqual(r.body.removed,[{source:'gd',id:'GB'}]);assert.equal(r.body.kept_original,false);
 assert.equal(w.gd.pages[0].find(x=>x.id==='GB').trashed,true,'original went to Google trash');
 assert.ok(w.db.items.some(x=>x.item_id==='OUP!7'));assert.ok(!w.db.items.some(x=>x.item_id==='GB'));
 // 원드라이브 → 구글(이어 올리기, 조각에는 토큰 없음). 이름이 겹치면 (2).
 const big=Buffer.alloc(11*1024*1024,5);
 w.od.pages[0].push({id:'OB!8',name:'가상 초안.pdf',size:big.length,file:{mimeType:'application/pdf',hashes:{sha1Hash:createHash('sha1').update(big).digest('hex')}},parentReference:{id:'OF!2'}});
 w.od.media={'OB!8':big};
 w.tick(FRESH_MS+1);w.od.next=[w.od.pages[0].at(-1)];
 await w.post({action:'sync',source:'od'});
 const x=await j(await w.post({action:'across',source:'od',id:'OB!8',to_source:'gd',to:'GF1',confirm:true}));
 assert.equal(x.status,200,JSON.stringify(x.body));
 assert.equal(Object.values(w.uploads).find(u=>u.dest==='gd').name,'가상 초안 (2).pdf');
 assert.equal(Object.values(w.uploads).find(u=>u.dest==='gd').bytes.length,big.length,'sent in chunks');
 assert.ok(w.writes.some(y=>y.method==='DELETE'&&y.path==='/v1.0/me/drive/items/OB!8'),'original to OneDrive recycle bin');
});

test('across: refuses folders, Google docs, unknown size, over 200MB, same cloud; corrupted copy is trashed and original kept',async()=>{
 const w=world();
 w.gd.pages[0].push({id:'GH',name:'큰 파일.zip',mimeType:'application/zip',parents:['ROOTG'],size:String(ACROSS_MAX_BYTES+1),ownedByMe:true},
  {id:'GQ',name:'작은.bin',mimeType:'application/octet-stream',parents:['ROOTG'],size:'4',md5Checksum:createHash('md5').update(Buffer.from([1,2,3,4])).digest('hex'),ownedByMe:true});
 w.gd.media={GQ:new Uint8Array([1,2,3,4])};
 await w.post({action:'sync'});
 const e=async b=>(await j(await w.post({confirm:true,action:'across',to_source:'od',to:null,...b}))).body.error;
 assert.equal(await e({source:'gd',id:'GF1'}),'across_folder');
 assert.equal(await e({source:'gd',id:'GDOC'}),'across_unsupported');
 assert.equal(await e({source:'gd',id:'GH'}),'too_large');
 assert.equal(await e({source:'gd',id:'GA',to_source:'gd'}),'dest_invalid');
 assert.equal(await e({source:'gd',id:'GA'}),'changed_since_index','index size 12 but cloud gives 2 bytes');
 // 원드라이브 쪽 결과 해시가 다르면: 새 것은 휴지통, 원본은 그대로.
 w.od.corrupt=true;
 const big=Buffer.alloc(5*1024*1024,1);
 w.gd.pages[0].push({id:'GR',name:'큰.bin',mimeType:'application/octet-stream',parents:['ROOTG'],size:String(big.length),md5Checksum:createHash('md5').update(big).digest('hex'),ownedByMe:true});
 w.gd.media.GR=big;w.tick(FRESH_MS+1);w.gd.changes=[{fileId:'GR',file:w.gd.pages[0].at(-1)}];
 await w.post({action:'sync',source:'gd'});
 const before=w.writes.length;
 assert.equal(await e({source:'gd',id:'GR'}),'verify_failed');
 const after=w.writes.slice(before);
 assert.ok(after.some(x=>x.method==='DELETE'&&x.path==='/v1.0/me/drive/items/OUP!7'),'bad copy to recycle bin');
 assert.ok(!after.some(x=>x.host==='www.googleapis.com'&&x.body?.trashed),'original untouched');
 assert.ok(w.db.items.some(x=>x.item_id==='GR'));
});

test('write helpers: names, id lists, unique names, upload hosts',()=>{
 assert.equal(cleanName('  보고서  초안.hwp '),'보고서 초안.hwp');
 assert.equal(cleanName('a/b'),null);assert.equal(cleanName(3),null);
 assert.deepEqual(idList(['A','B'],'gd'),['A','B']);assert.equal(idList(['A!1'],'gd'),null);assert.deepEqual(idList(['A!1'],'od'),['A!1']);
 assert.equal(uniqueName('a.pdf',['A.PDF','a (2).pdf']),'a (3).pdf');assert.equal(uniqueName('폴더',['x']),'폴더');assert.equal(uniqueName('.env',['.env']),'.env (2)');
 assert.equal(safeUploadUrl('gd','https://www.googleapis.com/upload/drive/v3/files?upload_id=1'),'https://www.googleapis.com/upload/drive/v3/files?upload_id=1');
 assert.equal(safeUploadUrl('gd','https://evil.example/upload/drive/v3/files'),null);
 assert.equal(safeUploadUrl('od','https://sn1.up.1drv.com/up/1'),'https://sn1.up.1drv.com/up/1');
 assert.equal(safeUploadUrl('od','https://1drv.com.evil.example/up'),null);
 assert.equal(safeUploadUrl('od','http://sn1.up.1drv.com/up/1'),null);
});

test('deploy table: cloud-files registered once with verify_jwt true, first deploy pending',()=>{
 const rows=read('docs/web2-env6b-edge-source.md').split('\n').filter(l=>/^\| \d+ \| `cloud-files` \|/.test(l));
 assert.equal(rows.length,1);
 assert.match(rows[0],/\| 배포 대기 \| 없음 \| \*\*true\*\* \|/);
});

// S48-65: 쪽이 3개 넘게 이어지는 큰 드라이브(시간 상한으로 끊겨 여러 번 이어 받기)도 끝까지 훑는지.
const sampleOd=(pages,per)=>Array.from({length:pages},(_,p)=>Array.from({length:per},(_,i)=>{const n=p*per+i;
 return n%5===0?{id:'F'+n+'!1',name:'폴더'+n,folder:{childCount:1},parentReference:{id:'ODROOT!1'}}
  :{id:'X'+n+'!1',name:'파일'+n+'.txt',size:10,file:{mimeType:'text/plain',hashes:{sha1Hash:'B'.repeat(40)}},parentReference:{id:'F'+(n-n%5)+'!1'}};}));
test('onedrive: 5-page drive is scanned to the end across resumed calls (budget cut), no page skipped, nothing swept',async()=>{
 const w=world();w.od.multi=sampleOd(5,10);w.od.callMs=3000;
 let calls=0,last;
 do{last=(await j(await w.post({action:'sync',source:'od'}))).body.od;calls++;w.tick(1000);}while(last.more&&calls<10);
 assert.ok(calls>1,'시간 상한으로 여러 번에 나눠 받음');assert.equal(last.done,true);
 assert.equal(w.db.items.filter(x=>x.source==='od').length,50);
 assert.ok(w.db.sync.find(x=>x.source==='od').index_done_at);assert.equal(w.db.sync.find(x=>x.source==='od').next_page,null);
});
test('google: 5-page drive is scanned to the end across resumed calls (budget cut)',async()=>{
 const w=world();w.gd.callMs=3000;
 w.gd.pages=Array.from({length:5},(_,p)=>Array.from({length:10},(_,i)=>{const n=p*10+i;
  return n%5===0?{id:'GF'+n,name:'폴더'+n,mimeType:'application/vnd.google-apps.folder',parents:['ROOTG'],ownedByMe:true}
   :{id:'GX'+n,name:'파일'+n,mimeType:'text/plain',parents:['GF'+(n-n%5)],size:'3',ownedByMe:true};}));
 let calls=0,last;
 do{last=(await j(await w.post({action:'sync',source:'gd'}))).body.gd;calls++;w.tick(1000);}while(last.more&&calls<10);
 assert.ok(calls>1);assert.equal(last.done,true);
 assert.equal(w.db.items.filter(x=>x.source==='gd').length,50);
});

test('folder: 폴더만 클라우드에서 바로 읽어 색인에 합침 — 새로 찾은 줄만 돌려주고, 색인 밖 폴더·남의 파일은 거절/제외',async()=>{
 const w=world();
 await w.post({action:'sync'});
 const before=w.db.items.length;
 w.od.children=[{id:'OX!3',name:'회의.docx',size:900,file:{mimeType:'text/plain',hashes:{}},parentReference:{id:'OF!2'}},
  {id:'ONEW!5',name:'새 파일.txt',size:7,file:{mimeType:'text/plain',hashes:{sha1Hash:'C'.repeat(40)}},parentReference:{id:'OF!2'}}];
 const r=await j(await w.post({action:'folder',source:'od',id:'OF!2'}));
 assert.equal(r.status,200);assert.equal(r.body.found,2);assert.equal(r.body.added,2,'OX!3은 이름은 같아도 수정 시각 칸이 달라져 바뀐 줄로 봄');
 assert.ok(w.db.items.find(x=>x.item_id==='ONEW!5'));assert.equal(w.db.items.length,before+1);
 const again=await j(await w.post({action:'folder',source:'od',id:'OF!2'}));
 assert.equal(again.body.added,0,'두 번째는 새로 찾은 것 없음');
 w.gd.children=[{id:'GNEW2',name:'직접 읽은.txt',mimeType:'text/plain',parents:['GF1'],ownedByMe:true,size:'4'},{id:'GOTHER',name:'남의것',mimeType:'text/plain',parents:['GF1'],ownedByMe:false}];
 const g=await j(await w.post({action:'folder',source:'gd',id:'GF1'}));
 assert.equal(g.body.found,1);assert.ok(w.db.items.find(x=>x.item_id==='GNEW2'));assert.ok(!w.db.items.find(x=>x.item_id==='GOTHER'));
 const bad=await j(await w.post({action:'folder',source:'gd',id:'NOT_INDEXED'}));
 assert.equal(bad.status,404);
 assert.equal((await j(await w.post({action:'folder',source:'od',id:'bad id!'}))).status,400);
 assert.equal((await j(await w.post({action:'folder',source:'od',id:'OF!2'},JWT2))).status>=400,true,'다른 사용자 거절');
 assert.ok(!w.calls.some(c=>['POST','PATCH','DELETE','PUT'].includes(c.method)&&['graph.microsoft.com','www.googleapis.com'].includes(c.host)),'클라우드에는 쓰지 않음');
});
