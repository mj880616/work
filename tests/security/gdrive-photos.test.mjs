import test from 'node:test';
import assert from 'node:assert/strict';

// S46-24 ③: 실제 gdrive-photos handler를 지어낸 Supabase(PostgREST)와 지어낸 Google Drive로 돌린다. 네트워크 없음.
// 비밀값·토큰·계정·파일 이름은 모두 고정 가짜 글자다.
const {createGdriveHandler,takenOf,photoRow,cleanName,scopeHas,TRASH_NOTE}=await import('../../supabase/functions/gdrive-photos/handler.ts');

const SB='https://sb.example.test',WS='a0000000-0000-4000-8000-000000000001',WS2='a0000000-0000-4000-8000-000000000002';
const USER='u0000000-0000-4000-8000-000000000001',OTHER='u0000000-0000-4000-8000-000000000002';
const JWT='synthetic-user-jwt',JWT2='synthetic-other-jwt',ACCESS='synthetic-access-token',FULL='https://www.googleapis.com/auth/drive';
const ENV={SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',SUPABASE_ANON_KEY:'synthetic-anon-key'};

function world({features=['calls','gdrive_photos'],allowed=WS,driveWs=WS,scope=`${FULL}.file ${FULL}`,members={[USER]:WS,[OTHER]:WS2}}={}){
 const db={folders:[],photos:[],sync:[]};
 const drive={
  F1:{id:'F1',name:'가상 사진',mimeType:'application/vnd.google-apps.folder',parents:['root'],trashed:false},
  F2:{id:'F2',name:'가상 보관',mimeType:'application/vnd.google-apps.folder',parents:['root'],trashed:false},
  P1:{id:'P1',name:'a.jpg',mimeType:'image/jpeg',size:'10',parents:['F1'],trashed:false,createdTime:'2026-10-01T00:00:00Z',imageMediaMetadata:{time:'2026:10:02 09:30:00'},thumbnailLink:'https://lh3.googleusercontent.com/x=s220'},
  P2:{id:'P2',name:'b.mp4',mimeType:'video/mp4',size:'20',parents:['F1'],trashed:false,createdTime:'2026-10-03T00:00:00Z'},
  D1:{id:'D1',name:'doc.pdf',mimeType:'application/pdf',parents:['F1'],trashed:false,createdTime:'2026-10-03T00:00:00Z'},
 };
 const calls=[];
 const ok=(v,status=200,headers={})=>new Response(v===null?null:JSON.stringify(v),{status,headers:{'content-type':'application/json',...headers}});
 const tableOf=p=>({app_gdrive_folders:'folders',app_gdrive_photos:'photos',app_gdrive_sync:'sync'})[p];
 function match(row,params){
  for(const [k,v] of params){
   if(['select','order','limit','on_conflict','or'].includes(k))continue;
   const [op,...rest]=v.split('.');const val=rest.join('.');
   if(op==='eq'&&String(row[k])!==val)return false;
   if(op==='in'&&!val.slice(1,-1).split(',').map(s=>s.replace(/"/g,'')).includes(String(row[k])))return false;
   if(op==='lt'&&!(String(row[k])<val))return false;
  }
  const or=params.get('or');
  if(or&&or.startsWith('(index_lock_until.is.null')){const at=or.split('.lt.')[1].slice(0,-1);if(row.index_lock_until&&!(row.index_lock_until<at))return false;}
  return true;
 }
 async function fetch(url,init={}){
  const u=new URL(url),method=init.method||'GET',h=init.headers||{};
  calls.push({method,host:u.host,path:u.pathname,search:u.search,body:init.body});
  if(u.host==='sb.example.test'){
   if(u.pathname==='/auth/v1/user'){const t=h.Authorization?.slice(7);return t===JWT?ok({id:USER}):t===JWT2?ok({id:OTHER}):ok({msg:'bad'},401);}
   if(u.pathname==='/rest/v1/rpc/app_my_features'){assert.notEqual(h.Authorization,'Bearer '+ENV.SUPABASE_SERVICE_ROLE_KEY,'features use the user token');return ok(h.Authorization==='Bearer '+JWT?features:[]);}
   assert.equal(h.Authorization,'Bearer '+ENV.SUPABASE_SERVICE_ROLE_KEY);
   if(u.pathname==='/rest/v1/rpc/app_operator_feature_workspace')return ok(allowed);
   const name=u.pathname.replace('/rest/v1/',''),p=u.searchParams;
   if(name==='app_workspace_members'){const id=p.get('user_id').slice(3);return ok(members[id]?[{workspace_id:members[id]}]:[]);}
   if(name==='app_workspaces')return ok(driveWs?[{id:driveWs}]:[]);
   if(name==='public_policy_drive_config')return ok([{google_client_id:'c',google_client_secret:'s',google_refresh_token:'synthetic-refresh'}]);
   const t=tableOf(name);assert.ok(t,name);const list=db[t];
   if(method==='GET'){let r=list.filter(x=>match(x,p));if(t==='photos')r=r.sort((a,b)=>a.taken_at<b.taken_at?1:-1);return ok(r);}
   if(method==='POST'){const rows=[].concat(JSON.parse(init.body));const ignore=/ignore-duplicates/.test(h.Prefer||'');
    for(const r of rows){const i=list.findIndex(x=>x.workspace_id===r.workspace_id&&(t==='sync'||x.item_id===r.item_id));if(i<0)list.push({...r});else if(!ignore)Object.assign(list[i],r);}return ok(null,201);}
   if(method==='PATCH'){const v=JSON.parse(init.body);const hit=list.filter(x=>match(x,p));hit.forEach(x=>Object.assign(x,v));return ok(/representation/.test(h.Prefer||'')?hit:null,/representation/.test(h.Prefer||'')?200:204);}
   if(method==='DELETE'){db[t]=list.filter(x=>!match(x,p));return ok(null,204);}
  }
  if(u.host==='oauth2.googleapis.com'&&u.pathname==='/token')return ok({access_token:ACCESS,scope,expires_in:3600});
  if(u.host==='lh3.googleusercontent.com')return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/jpeg'}});
  if(u.host==='www.googleapis.com'){
   assert.equal(h.Authorization,'Bearer '+ACCESS);
   assert.notEqual(method,'DELETE','never permanently delete');
   const m=u.pathname.match(/^\/drive\/v3\/files(?:\/([^/]+))?$/);assert.ok(m,u.pathname);const id=m[1]&&decodeURIComponent(m[1]);
   if(!id&&method==='GET'){
    const qq=u.searchParams.get('q'),parent=qq.match(/^'([^']+)' in parents/)[1];
    const folders=/mimeType='application\/vnd.google-apps.folder'/.test(qq);
    return ok({files:Object.values(drive).filter(f=>!f.trashed&&f.parents.includes(parent)&&(folders?f.mimeType.endsWith('folder'):/^(image|video)\//.test(f.mimeType)))});
   }
   if(!id&&method==='POST'){const b=JSON.parse(init.body);const nid='N'+Object.keys(drive).length;drive[nid]={id:nid,...b,trashed:false};return ok({id:nid,name:b.name});}
   const f=drive[id];if(!f&&id!=='root')return ok({error:'nf'},404);
   if(method==='GET'&&u.searchParams.get('alt')==='media')return new Response('bytes',{status:h.Range?206:200,headers:{'content-type':f.mimeType,'content-range':h.Range?'bytes 0-4/5':''}});
   if(method==='GET')return ok(f);
   if(method==='PATCH'){const b=JSON.parse(init.body);Object.assign(f,b);const add=u.searchParams.get('addParents');if(add){f.parents=[add];}return ok(f);}
  }
  throw new Error('unexpected '+url);
 }
 const handler=createGdriveHandler({fetch,env:k=>ENV[k],now:(()=>{let t=Date.parse('2026-10-31T03:00:00Z');return ()=>(t+=1000);})()});
 const call=async(b,{jwt=JWT,headers={}}={})=>{const r=await handler(new Request('https://fn.example.test/gdrive-photos',{method:'POST',headers:{'content-type':'application/json',...(jwt?{Authorization:'Bearer '+jwt}:{}),...headers},body:JSON.stringify(b)}));
  const type=r.headers.get('content-type')||'';return {status:r.status,body:type.startsWith('application/json')?await r.json():await r.text(),headers:r.headers};};
 return {db,drive,calls,call};
}

test('pure helpers: EXIF time read as Seoul, created time approx, only image/video rows, names and scope',()=>{
 assert.deepEqual(takenOf({imageMediaMetadata:{time:'2026:10:02 09:30:00'}}),{taken_at:'2026-10-02T00:30:00.000Z',approx:false});
 assert.deepEqual(takenOf({createdTime:'2026-10-01T20:00:00Z'}),{taken_at:'2026-10-01T20:00:00.000Z',approx:true});
 const r=photoRow(WS,'F1',{id:'P9',name:'n.jpg',mimeType:'image/jpeg',createdTime:'2026-10-01T20:00:00Z'},'s');
 assert.equal(r.taken_day,'2026-10-02');assert.equal(r.video,false);
 assert.equal(photoRow(WS,'F1',{id:'P9',name:'n.pdf',mimeType:'application/pdf',createdTime:'2026-10-01T20:00:00Z'},'s'),null);
 assert.equal(photoRow(WS,'F1',{id:'bad id',name:'n.jpg',mimeType:'image/jpeg',createdTime:'2026-10-01T20:00:00Z'},'s'),null);
 assert.equal(cleanName(' a'),null);assert.equal(cleanName('a\nb'),null);assert.equal(cleanName('..'),null);assert.equal(cleanName('가상 폴더'),'가상 폴더');
 assert.equal(scopeHas(`${FULL}.file`),false);assert.equal(scopeHas(`${FULL}.readonly`),false);assert.equal(scopeHas(`x ${FULL}`),true);
});

test('gate: login, owner, operator feature by user token, and Drive-connection owner — all server side',async()=>{
 const w=world();
 assert.equal((await w.call({action:'status'},{jwt:''})).status,401);
 assert.equal((await w.call({action:'status'},{jwt:'nope'})).status,401);
 const other=await w.call({action:'status'},{jwt:JWT2});assert.equal(other.status,403);assert.equal(other.body.error,'feature_required');
 assert.equal((await world({features:['calls']}).call({action:'status'})).body.error,'feature_required');
 assert.equal((await world({allowed:WS2}).call({action:'status'})).body.error,'drive_owner_mismatch');
 assert.equal((await world({driveWs:WS2}).call({action:'status'})).body.error,'drive_owner_mismatch');
 assert.equal((await world({allowed:null}).call({action:'status'})).body.error,'drive_owner_mismatch');
 assert.equal((await world({members:{}}).call({action:'status'})).body.error,'forbidden');
 // 화면이 보낸 작업공간 값은 무시한다.
 const s=await w.call({action:'status',workspace_id:WS2});assert.equal(s.status,200);assert.equal(s.body.scope,true);
 assert.ok(!w.calls.some(c=>c.host==='www.googleapis.com'),'gate fails before any Drive call');
 assert.equal((await w.call({action:'nope'})).body.error,'action_invalid');
});

test('scope missing: status says scope:false, everything else answers scope_missing without touching Drive files',async()=>{
 const w=world({scope:`${FULL}.file`});
 const s=await w.call({action:'status'});assert.equal(s.status,200);assert.equal(s.body.scope,false);
 for(const b of [{action:'folders'},{action:'folder-toggle',id:'F1',enabled:true},{action:'sync'}]){
  const r=await w.call(b);assert.equal(r.status,403);assert.equal(r.body.error,'scope_missing');
 }
 assert.ok(!w.calls.some(c=>c.host==='www.googleapis.com'));
});

test('folders start off; turning one on indexes only its own photos and videos; list newest first; off removes them',async()=>{
 const w=world();
 const f=await w.call({action:'folders'});
 assert.deepEqual(f.body.folders.map(x=>[x.id,x.enabled]).sort(),[['F1',false],['F2',false]]);
 assert.equal((await w.call({action:'list'})).body.items.length,0);
 const on=await w.call({action:'folder-toggle',id:'F1',enabled:true});assert.equal(on.body.indexed,2);
 assert.equal(w.db.folders[0].enabled,true);
 const l=await w.call({action:'list'});
 assert.deepEqual(l.body.items.map(i=>[i.id,i.video,i.day,i.approx]),[['P2',true,'2026-10-03',true],['P1',false,'2026-10-02',false]]);
 assert.equal((await w.call({action:'folders'})).body.folders.find(x=>x.id==='F1').enabled,true);
 await w.call({action:'folder-toggle',id:'F1',enabled:false});
 assert.equal(w.db.photos.length,0);assert.equal(w.db.folders[0].enabled,false);
 assert.equal((await w.call({action:'folder-toggle',id:'P1',enabled:true})).body.error,'folder_not_found');
});

test('thumbnail and media only for indexed photos; Range passes through',async()=>{
 const w=world();
 assert.equal((await w.call({action:'thumb',id:'P1'})).body.error,'photo_not_in_index');
 await w.call({action:'folder-toggle',id:'F1',enabled:true});
 const t=await w.call({action:'thumb',id:'P1',size:'large'});assert.equal(t.status,200);assert.equal(t.headers.get('content-type'),'image/jpeg');
 assert.ok(w.calls.some(c=>c.host==='lh3.googleusercontent.com'&&c.path.endsWith('=s1600')));
 const m=await w.call({action:'media',id:'P2'},{headers:{range:'bytes=0-4'}});assert.equal(m.status,206);assert.equal(m.headers.get('content-type'),'video/mp4');
});

test('writes need confirm:true; trash only moves to Drive trash (no delete); rename, move, folder create/rename/trash',async()=>{
 const w=world();
 await w.call({action:'folder-toggle',id:'F1',enabled:true});
 for(const b of [{action:'trash',ids:['P1']},{action:'rename',id:'P1',name:'c.jpg'},{action:'move',ids:['P1'],to:'F2'},{action:'folder-create',name:'새'},{action:'folder-rename',id:'F2',name:'x'},{action:'folder-trash',id:'F2'}]){
  const r=await w.call(b);assert.equal(r.status,400,b.action);assert.equal(r.body.error,'confirm_required');
 }
 assert.ok(!w.calls.some(c=>c.host==='www.googleapis.com'&&c.method!=='GET'),'nothing written without confirm');
 assert.equal((await w.call({action:'trash',ids:['F2'],confirm:true})).body.error,'photo_not_in_index','only indexed photos');
 assert.equal((await w.call({action:'trash',ids:Array.from({length:51},(_,i)=>'X'+i),confirm:true})).body.error,'ids_invalid');
 const r=await w.call({action:'rename',id:'P1',name:'c.jpg',confirm:true});assert.equal(r.body.ok,true);
 assert.equal(w.drive.P1.name,'c.jpg');assert.equal(w.db.photos.find(p=>p.item_id==='P1').name,'c.jpg');
 const mv=await w.call({action:'move',ids:['P1'],to:'F2',confirm:true});assert.deepEqual(mv.body.moved,['P1']);
 assert.deepEqual(w.drive.P1.parents,['F2']);assert.equal(w.db.photos.some(p=>p.item_id==='P1'),false,'moved out of switched-on folders');
 assert.ok(w.calls.some(c=>c.method==='PATCH'&&/addParents=F2/.test(c.search)&&/removeParents=F1/.test(c.search)));
 const tr=await w.call({action:'trash',ids:['P2'],confirm:true});assert.deepEqual(tr.body.trashed,['P2']);assert.equal(tr.body.note,TRASH_NOTE);
 assert.equal(w.drive.P2.trashed,true);assert.equal(w.db.photos.length,0);
 const nf=await w.call({action:'folder-create',parent:'F1',name:'가상 새 폴더',confirm:true});assert.equal(nf.body.enabled,false);
 assert.equal(w.drive[nf.body.id].mimeType,'application/vnd.google-apps.folder');assert.deepEqual(w.drive[nf.body.id].parents,['F1']);
 await w.call({action:'folder-rename',id:nf.body.id,name:'가상 이름',confirm:true});assert.equal(w.drive[nf.body.id].name,'가상 이름');
 assert.equal((await w.call({action:'folder-trash',id:'root',confirm:true})).body.error,'folder_invalid');
 const ft=await w.call({action:'folder-trash',id:'F1',confirm:true});assert.equal(ft.body.ok,true);assert.equal(w.drive.F1.trashed,true);
 assert.equal(w.db.folders.length,0);
 assert.equal((await w.call({action:'folder-create',name:'a\u0000',confirm:true})).body.error,'name_invalid');
 const trashCalls=w.calls.filter(c=>c.method==='PATCH'&&c.body&&JSON.parse(c.body).trashed===true);assert.equal(trashCalls.length,2);
});

test('sync: re-lists switched-on folders, drops photos gone from Drive, turns off a vanished folder, and locks',async()=>{
 const w=world();
 await w.call({action:'folder-toggle',id:'F1',enabled:true});
 await w.call({action:'folder-toggle',id:'F2',enabled:true});
 w.drive.P2.trashed=true;
 const s=await w.call({action:'sync'});assert.equal(s.body.ok,true);
 assert.deepEqual(w.db.photos.map(p=>p.item_id),['P1']);
 assert.equal(w.db.sync[0].index_lock_until,null);assert.ok(w.db.sync[0].synced_at);
 delete w.drive.F2;
 await w.call({action:'sync'});assert.equal(w.db.folders.find(f=>f.item_id==='F2').enabled,false);
 w.db.sync[0].index_lock_until='2026-11-01T00:00:00.000Z';
 assert.equal((await w.call({action:'sync'})).body.busy,true);
});
