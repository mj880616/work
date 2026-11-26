import test from 'node:test';
import assert from 'node:assert/strict';

// S71-62 PHOTO-찾기넓히기·설명: gdrive-photos 드라이브 글자 찾기(content-find 합치기·drive-find)와 사진 설명(desc-get·desc-set·desc-words).
// 실제 handler를 지어낸 Supabase(PostgREST·rpc)와 지어낸 Google Drive로 돌린다. 네트워크 없음. 토큰·id·낱말은 모두 고정 가짜 글자다.
const {createGdriveHandler,cleanDesc,joinDesc,driveFindQuery,descWords,DESC_MAX,DESC_PROP}=await import('../../supabase/functions/gdrive-photos/handler.ts');

const SB='https://sb.example.test',WS='a0000000-0000-4000-8000-000000000001',WS2='a0000000-0000-4000-8000-000000000002';
const USER='u0000000-0000-4000-8000-000000000001',OTHER='u0000000-0000-4000-8000-000000000002';
const JWT='synthetic-user-jwt',JWT2='synthetic-other-jwt',ACCESS='synthetic-access-token',FULL='https://www.googleapis.com/auth/drive';
const ENV={SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key'};
const FOLDER_ON='SYNTHFOLDERON001',FOLDER_OFF='SYNTHFOLDEROFF01',SHEET='SYNTHSHEET0001',ROOTF='SYNTHROOTFOLDER01';
// 색인(켠 폴더 안 사진): 내 작업공간 P1·P2·P3, 꺼진 폴더 P4. 다른 작업공간 사진 X1(남의 파일).
const PHOTOS=[{ws:WS,id:'GDPHOTO0001',parent:FOLDER_ON},{ws:WS,id:'GDPHOTO0002',parent:FOLDER_ON},{ws:WS,id:'GDPHOTO0003',parent:FOLDER_ON},
 {ws:WS,id:'GDPHOTO0004',parent:FOLDER_OFF},{ws:WS2,id:'GDOTHER00001',parent:'SYNTHOTHERFOLDER'}];
const CSV='id,방법,낱말\r\nGDPHOTO0001,vision,가상바다 가상하늘\r\nGDPHOTO0003,vision,가상바다';

function world({feature=WS,scope=`${FULL}.file ${FULL}`,found=['GDPHOTO0002','GDPHOTO0001','GDPHOTO0004','GDOTHER00001','NOTINDEX0001'],descs={},foundComplete=true}={}){
 const calls=[],logs=[],desc={GDPHOTO0001:'',GDPHOTO0002:'가상 앞설명',GDPHOTO0003:'',...descs},props={};
 const ok=(v,status=200)=>new Response(v===null?null:JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
 async function fetch(url,init={}){
  const u=new URL(url),method=init.method||'GET',h=init.headers||{};
  calls.push({method,host:u.host,path:u.pathname,search:u.search,body:init.body});
  if(u.host==='sb.example.test'){
   if(u.pathname==='/auth/v1/user'){const t=h.Authorization?.slice(7);return t===JWT?ok({id:USER}):t===JWT2?ok({id:OTHER}):ok({msg:'bad'},401);}
   assert.equal(h.Authorization,'Bearer '+ENV.SUPABASE_SERVICE_ROLE_KEY);
   const name=u.pathname.replace('/rest/v1/',''),p=u.searchParams;
   assert.equal(method,name.startsWith('rpc/')?'POST':'GET','these actions never write the database');
   if(name==='rpc/app_operator_feature_workspace')return ok(feature);
   if(name==='app_workspace_members'){const id=p.get('user_id').slice(3);return ok(id===USER?[{workspace_id:WS}]:id===OTHER?[{workspace_id:WS2}]:[]);}
   if(name==='public_policy_drive_config')return ok([{google_client_id:'c',google_client_secret:'s'}]);
   if(name==='app_drive_connections')return ok([{google_refresh_token:'synthetic-refresh-'+p.get('workspace_id').slice(-1)}]);
   if(name==='app_drive_settings')return ok([{root_folder_id:ROOTF}]);
   const ws=p.get('workspace_id')?.slice(3);
   if(name==='app_gdrive_folders')return ok(ws===WS?[{item_id:FOLDER_ON,parent_id:'root',name:'f',enabled:true},{item_id:FOLDER_OFF,parent_id:'root',name:'g',enabled:false}]:[]);
   if(name==='app_gdrive_photos'){
    const ids=[...p.get('item_id').matchAll(/"([^"]+)"/g)].map(m=>m[1]);
    return ok(PHOTOS.filter(x=>x.ws===ws&&ids.includes(x.id)).map(x=>({item_id:x.id,parent_id:x.parent,name:'n',video:false})));
   }
   throw new Error('unexpected table '+name);
  }
  if(u.host==='oauth2.googleapis.com'&&u.pathname==='/token')return ok({access_token:ACCESS,scope,expires_in:3600});
  if(u.host==='www.googleapis.com'){
   assert.equal(h.Authorization,'Bearer '+ACCESS);
   const one=u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
   if(one){
    const id=decodeURIComponent(one[1]);
    assert.ok(PHOTOS.some(x=>x.ws===WS&&x.id===id),'Drive is called only for the caller\'s indexed photos: '+id);
    if(method==='PATCH'){const b=JSON.parse(init.body);desc[id]=b.description;props[id]=b.properties;return ok({id,description:b.description});}
    assert.equal(method,'GET');return ok({id,description:desc[id]??'',trashed:false});
   }
   if(u.pathname.endsWith('/export'))return new Response(CSV,{headers:{'content-type':'text/csv'}});
   assert.equal(u.pathname,'/drive/v3/files');assert.equal(method,'GET');
   const qq=u.searchParams.get('q');
   assert.match(qq,/trashed = false/);assert.match(qq,/'me' in owners/);
   if(qq.includes('fullText contains'))return ok({files:found.map(id=>({id})),...(foundComplete?{}:{nextPageToken:'more'})});
   if(qq.includes('properties has'))return ok({files:Object.entries(desc).filter(([id])=>props[id]?.[DESC_PROP]==='1').map(([id,description])=>({id,description}))});
   if(qq.includes("mimeType = 'application/vnd.google-apps.folder'"))return ok({files:[]});
   if(qq.includes("mimeType = 'application/vnd.google-apps.spreadsheet'"))return ok({files:[{id:SHEET}]});
  }
  throw new Error('unexpected '+url);
 }
 const handler=createGdriveHandler({fetch,env:k=>ENV[k],now:()=>Date.parse('2026-11-26T13:00:00Z')});
 const call=async(b,{jwt=JWT}={})=>{
  const orig=console.error;console.error=(...a)=>{logs.push(a.join(' '));};
  try{const r=await handler(new Request('https://fn.example.test/gdrive-photos',{method:'POST',headers:{'content-type':'application/json',...(jwt?{Authorization:'Bearer '+jwt}:{})},body:JSON.stringify(b)}));
   const text=await r.text();return {status:r.status,text,body:JSON.parse(text)};}
  finally{console.error=orig;}
 };
 const patches=()=>calls.filter(c=>c.host==='www.googleapis.com'&&c.method==='PATCH');
 const google=()=>calls.filter(c=>c.host==='www.googleapis.com');
 return {calls,logs,call,desc,props,patches,google};
}

test('pure helpers: description clean-up, append, drive query escaping, frequent words',()=>{
 assert.equal(cleanDesc('  가상\n바다  하늘 '),'가상 바다 하늘');
 assert.equal(cleanDesc(''),'','empty = clear');
 assert.equal(cleanDesc('가'.repeat(DESC_MAX)).length,DESC_MAX);
 for(const bad of ['가'.repeat(DESC_MAX+1),'a\u0000b','a\u0007b',null,3,['a']])assert.equal(cleanDesc(bad),null);
 assert.equal(joinDesc('','가상'),'가상');
 assert.equal(joinDesc('가상 앞','뒤'),'가상 앞 뒤');
 assert.equal(joinDesc('가상 앞 뒤','뒤'),'가상 앞 뒤','same tail is not added twice');
 assert.equal(joinDesc(undefined,'뒤'),'뒤');
 const qq=driveFindQuery("가상 o'x");
 assert.equal(qq,"fullText contains '가상' and fullText contains 'o\\'x' and (mimeType contains 'image/' or mimeType contains 'video/') and trashed = false and 'me' in owners");
 assert.equal((driveFindQuery('a b c d e f g h i j').match(/fullText/g)||[]).length,8,'eight words at most');
 assert.deepEqual(descWords(['가상바다 가상하늘, 2026','가상바다 #가상바다','가상산',null,'x'.repeat(21)]),['가상바다','가상하늘','가상산']);
 assert.equal(descWords(Array.from({length:30},(_,i)=>'w'+i)).length,12);
});

test('content-find merges the sheet index with Drive text search: one id once, only own indexed photos in enabled folders',async()=>{
 const w=world();
 const r=await w.call({action:'content-find',q:'가상바다'});
 assert.equal(r.status,200);
 // 시트(1·3) 먼저, 그다음 드라이브(2·1). 꺼진 폴더(4)·남의 사진·색인에 없는 id는 빠진다.
 assert.deepEqual(r.body,{ok:true,index:true,ids:['GDPHOTO0001','GDPHOTO0003','GDPHOTO0002'],more:false});
 for(const word of ['가상하늘','vision'])assert.ok(!r.text.includes(word),'no description words in the answer');
 assert.equal(w.patches().length,0,'finding never writes Drive');
 // 드라이브 결과가 한 쪽을 넘으면 more:true.
 assert.equal((await world({foundComplete:false}).call({action:'content-find',q:'가상바다'})).body.more,true);
});

test('drive-find: no operator key needed, full Drive scope needed, same filter; bad words refused before Drive',async()=>{
 const w=world({feature:null});
 const r=await w.call({action:'drive-find',q:'가상바다'});
 assert.equal(r.status,200);assert.deepEqual(r.body,{ok:true,ids:['GDPHOTO0002','GDPHOTO0001'],more:false});
 assert.ok(!w.google().some(c=>c.path.endsWith('/export')),'drive-find does not read the sheet index');
 const narrow=world({scope:`${FULL}.file`});
 const s=await narrow.call({action:'drive-find',q:'가상바다'});
 assert.equal(s.status,403);assert.equal(s.body.error,'scope_missing');assert.equal(narrow.google().length,0);
 const b=world();
 assert.equal((await b.call({action:'drive-find',q:''})).body.error,'q_invalid');
 assert.equal((await b.call({action:'drive-find',q:'x'.repeat(51)})).status,400);
 assert.equal(b.google().length,0);
 assert.equal((await b.call({action:'drive-find',q:'가상'},{jwt:''})).status,401);
});

test('desc-get / desc-set refuse another person\'s file id and photos outside the index before touching Drive',async()=>{
 for(const id of ['GDOTHER00001','GDPHOTO0004','NOTINDEX0001']){
  const w=world();
  const g=await w.call({action:'desc-get',id});
  assert.equal(g.status,404,id);assert.equal(g.body.error,'photo_not_in_index');
  const s=await w.call({action:'desc-set',ids:[id],text:'가상',mode:'set',confirm:true});
  assert.equal(s.status,404,id);
  const a=await w.call({action:'desc-set',ids:['GDPHOTO0001',id],text:'가상',mode:'add',confirm:true});
  assert.equal(a.status,404,'one foreign id refuses the whole request: '+id);
  assert.equal(w.google().length,0,'no Drive call at all: '+id);
 }
 // 다른 가입자가 내 사진 id를 보내도 그 사람 작업공간 색인으로만 본다.
 const w=world();
 assert.equal((await w.call({action:'desc-set',ids:['GDPHOTO0001'],text:'가상',mode:'set',confirm:true},{jwt:JWT2})).status,404);
 assert.equal((await w.call({action:'desc-get',id:'GDPHOTO0001'},{jwt:JWT2})).status,404);
 assert.equal(w.patches().length,0);
});

test('desc-set: confirm, mode, length and shape checks; set writes the Drive description and a marker property',async()=>{
 const w=world();
 const base={action:'desc-set',ids:['GDPHOTO0001'],text:'가상바다',mode:'set'};
 assert.equal((await w.call(base)).body.error,'confirm_required');
 assert.equal((await w.call({...base,confirm:true,mode:'x'})).body.error,'mode_invalid');
 assert.equal((await w.call({...base,confirm:true,text:'가'.repeat(DESC_MAX+1)})).body.error,'text_invalid');
 assert.equal((await w.call({...base,confirm:true,text:'<b>\u0000'})).body.error,'text_invalid');
 assert.equal((await w.call({...base,confirm:true,ids:['GDPHOTO0001','GDPHOTO0002']})).body.error,'ids_invalid','set is one photo');
 assert.equal((await w.call({...base,confirm:true,mode:'add',text:''})).body.error,'text_invalid','add needs words');
 assert.equal((await w.call({...base,confirm:true,ids:Array.from({length:51},(_,i)=>'GDP'+i)})).body.error,'ids_invalid');
 assert.equal(w.patches().length,0);
 const ok=await w.call({...base,confirm:true,text:' 가상바다  <script>x</script> '});
 assert.equal(ok.status,200);
 assert.deepEqual(ok.body,{ok:true,done:[{id:'GDPHOTO0001',description:'가상바다 <script>x</script>'}],failed:[]});
 assert.equal(w.desc.GDPHOTO0001,'가상바다 <script>x</script>','stored as plain text; the screen escapes when drawing');
 assert.deepEqual(w.props.GDPHOTO0001,{[DESC_PROP]:'1'});
 const p=w.patches()[0];assert.match(p.search,/fields=id%2Cdescription|fields=id,description/);
 assert.deepEqual(Object.keys(JSON.parse(p.body)).sort(),['description','properties'],'only description and the marker change');
 // 빈 글 = 설명 지우기(표시 속성도 지움).
 await w.call({...base,confirm:true,text:''});
 assert.equal(w.desc.GDPHOTO0001,'');assert.deepEqual(w.props.GDPHOTO0001,{[DESC_PROP]:null});
 assert.ok(w.logs.every(l=>!l.includes('가상바다')),'no words in logs');
});

test('desc-set add: appends after each photo\'s own description; too long is reported per photo, others still saved',async()=>{
 const w=world({descs:{GDPHOTO0003:'가'.repeat(DESC_MAX-2)}});
 const r=await w.call({action:'desc-set',ids:['GDPHOTO0001','GDPHOTO0002','GDPHOTO0003'],text:'가상산',mode:'add',confirm:true});
 assert.equal(r.status,200);
 assert.deepEqual(r.body.done,[{id:'GDPHOTO0001',description:'가상산'},{id:'GDPHOTO0002',description:'가상 앞설명 가상산'}]);
 assert.deepEqual(r.body.failed,[{id:'GDPHOTO0003',why:'too_long'}]);
 assert.equal(w.desc.GDPHOTO0003,'가'.repeat(DESC_MAX-2),'too long one is untouched');
});

test('desc-get reads one description; desc-words counts only the app-marked descriptions and returns words only',async()=>{
 const w=world();
 const g=await w.call({action:'desc-get',id:'GDPHOTO0002'});
 assert.deepEqual(g.body,{ok:true,id:'GDPHOTO0002',description:'가상 앞설명'});
 assert.deepEqual((await w.call({action:'desc-words'})).body,{ok:true,words:[]},'nothing marked yet (the 2nd photo was not written by the app)');
 await w.call({action:'desc-set',ids:['GDPHOTO0001','GDPHOTO0003'],text:'가상바다',mode:'add',confirm:true});
 await w.call({action:'desc-set',ids:['GDPHOTO0001'],text:'가상바다 가상하늘',mode:'set',confirm:true});
 const words=await w.call({action:'desc-words'});
 assert.deepEqual(words.body,{ok:true,words:['가상바다','가상하늘']});
 const q=w.google().filter(c=>c.search.includes('properties')).map(c=>new URL('https://x'+c.path+c.search).searchParams.get('q'));
 assert.deepEqual(q,Array(2).fill(`properties has { key='${DESC_PROP}' and value='1' } and trashed = false and 'me' in owners`));
 const narrow=world({scope:`${FULL}.file`});
 assert.equal((await narrow.call({action:'desc-words'})).body.error,'scope_missing');
 assert.equal((await narrow.call({action:'desc-get',id:'GDPHOTO0001'})).body.error,'scope_missing');
});
