import test from 'node:test';
import assert from 'node:assert/strict';

// S71-21 PHOTO-내용찾기 ②: gdrive-photos content-find(사진을 설명 낱말로 찾기). 설계 docs/design/photo-content-search.md 4-3절.
// 실제 handler를 지어낸 Supabase(PostgREST·rpc)와 지어낸 Google Drive로 돌린다. 네트워크 없음. 토큰·id·낱말은 모두 고정 가짜 글자다.
const {createGdriveHandler,cleanQuery,parseCsv,indexFromCsv,matchIndex,PHOTO_INDEX_SHEET}=await import('../../supabase/functions/gdrive-photos/handler.ts');

const SB='https://sb.example.test',WS='a0000000-0000-4000-8000-000000000001',WS2='a0000000-0000-4000-8000-000000000002';
const USER='u0000000-0000-4000-8000-000000000001',OTHER='u0000000-0000-4000-8000-000000000002';
const JWT='synthetic-user-jwt',JWT2='synthetic-other-jwt',ACCESS='synthetic-access-token',FULL='https://www.googleapis.com/auth/drive';
const ENV={SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key'};
const SHEET='SYNTHSHEET0001',ROOTF='SYNTHROOTFOLDER01',NAMEDF='SYNTHNAMEDFOLDER1';
// 가짜 색인(머리 줄 + 따옴표·쉼표·줄바꿈이 든 칸 + skip 줄 + 모양이 틀린 id).
const CSV=['id,출처,방법,낱말,건너뛴 까닭,적은 때',
 'GDPHOTO0001,gdrive,vision,가상낱말가 가상낱말나,,2026-11-26',
 'GDPHOTO0002,gdrive,ocr,"가상낱말가, 가상 낱말다",,2026-11-26',
 'GDPHOTO0003,gdrive,skip,가상낱말가,heic,2026-11-26',
 'bad id,gdrive,vision,가상낱말가,,2026-11-26',
 '"GDPHOTO0004",gdrive,vision,"줄이\n두 줄인 가상낱말라",,2026-11-26'].join('\r\n');
const WORDS=['가상낱말','낱말다','두 줄'];

function world({feature=WS,sheets=[{id:SHEET,parents:[ROOTF]}],named=[{id:NAMEDF}],root=ROOTF,csv=CSV,members={[USER]:WS,[OTHER]:WS2}}={}){
 const calls=[],logs=[];
 const ok=(v,status=200)=>new Response(v===null?null:JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
 async function fetch(url,init={}){
  const u=new URL(url),method=init.method||'GET',h=init.headers||{};
  calls.push({method,host:u.host,path:u.pathname,search:u.search,body:init.body});
  if(u.host==='sb.example.test'){
   if(u.pathname==='/auth/v1/user'){const t=h.Authorization?.slice(7);return t===JWT?ok({id:USER}):t===JWT2?ok({id:OTHER}):ok({msg:'bad'},401);}
   assert.equal(h.Authorization,'Bearer '+ENV.SUPABASE_SERVICE_ROLE_KEY);
   const name=u.pathname.replace('/rest/v1/',''),p=u.searchParams;
   if(name==='rpc/app_operator_feature_workspace'){assert.equal(method,'POST');assert.deepEqual(JSON.parse(init.body),{p_feature:'photo_content'});return ok(feature);}
   if(name==='app_workspace_members'){const id=p.get('user_id').slice(3);return ok(members[id]?[{workspace_id:members[id]}]:[]);}
   if(name==='public_policy_drive_config')return ok([{google_client_id:'c',google_client_secret:'s'}]);
   if(name==='app_drive_connections'){const ws=p.get('workspace_id').slice(3);return ok(ws===WS||ws===WS2?[{google_refresh_token:'synthetic-refresh-'+ws.slice(-1)}]:[]);}
   if(name==='app_drive_settings'){assert.equal(p.get('workspace_id'),'eq.'+WS,'only the caller workspace settings');return ok(root?[{root_folder_id:root}]:[]);}
   throw new Error('unexpected table '+name);
  }
  if(u.host==='oauth2.googleapis.com'&&u.pathname==='/token')return ok({access_token:ACCESS,scope:`${FULL}.file ${FULL}`,expires_in:3600});
  if(u.host==='www.googleapis.com'){
   assert.equal(h.Authorization,'Bearer '+ACCESS);assert.equal(method,'GET','content-find only reads');
   const ex=u.pathname.match(/^\/drive\/v3\/files\/([^/]+)\/export$/);
   if(ex){assert.equal(decodeURIComponent(ex[1]),SHEET,'export only the sheet the server found');assert.equal(u.searchParams.get('mimeType'),'text/csv');
    return new Response(csv,{headers:{'content-type':'text/csv'}});}
   assert.equal(u.pathname,'/drive/v3/files');
   const qq=u.searchParams.get('q');
   assert.match(qq,/trashed = false/);assert.match(qq,/'me' in owners/);
   if(qq.includes("mimeType = 'application/vnd.google-apps.folder'")){assert.match(qq,/^name = 'WORK ON\+'/);return ok({files:named});}
   if(qq.includes("mimeType = 'application/vnd.google-apps.spreadsheet'")){
    assert.ok(qq.startsWith(`name = '${PHOTO_INDEX_SHEET}'`));
    const ps=[...qq.matchAll(/'([^']+)' in parents/g)].map(m=>m[1]);
    return ok({files:sheets.filter(s=>s.parents.some(x=>ps.includes(x)))});
   }
  }
  throw new Error('unexpected '+url);
 }
 let t=Date.parse('2026-11-26T09:00:00Z');
 const handler=createGdriveHandler({fetch,env:k=>ENV[k],now:()=>t});
 const call=async(b,{jwt=JWT}={})=>{
  const orig=console.error;console.error=(...a)=>{logs.push(a.join(' '));};
  try{const r=await handler(new Request('https://fn.example.test/gdrive-photos',{method:'POST',headers:{'content-type':'application/json',...(jwt?{Authorization:'Bearer '+jwt}:{})},body:JSON.stringify(b)}));
   const text=await r.text();return {status:r.status,text,body:JSON.parse(text)};}
  finally{console.error=orig;}
 };
 return {calls,logs,call,tick:ms=>{t+=ms;}};
}

test('pure helpers: query clean-up, CSV with quotes and line breaks, index shape, matching and cap',()=>{
 assert.equal(cleanQuery('  가상  낱말 '),'가상 낱말');assert.equal(cleanQuery('AbC'),'abc');
 for(const bad of ['',' ','x'.repeat(51),'a\u0000b',null,3,['a']])assert.equal(cleanQuery(bad),null);
 assert.deepEqual(parseCsv('a,"b,c","d""e"\r\n"x\ny",z'),[['a','b,c','d"e'],['x\ny','z']]);
 assert.deepEqual(parseCsv('﻿id,낱말\n'),[['id','낱말']]);
 assert.equal(indexFromCsv('name,words\nX,y'),null,'no id or 낱말 head = shape differs');
 const e=indexFromCsv(CSV);
 assert.deepEqual(e.map(x=>x.id),['GDPHOTO0001','GDPHOTO0002','GDPHOTO0004'],'skip rows and bad ids are dropped');
 assert.deepEqual(matchIndex(e,'가상낱말가').ids,['GDPHOTO0001','GDPHOTO0002']);
 assert.deepEqual(matchIndex(e,'가상 낱말다').ids,['GDPHOTO0002']);
 assert.deepEqual(matchIndex(e,'가상낱말다').ids,['GDPHOTO0002'],'spaces ignored');
 assert.deepEqual(matchIndex(e,'가상낱말 두').ids,['GDPHOTO0004'],'every word must be there');
 assert.deepEqual(matchIndex(e,'없는말').ids,[]);
 const many=Array.from({length:2100},(_,i)=>({id:'GDP'+String(i).padStart(6,'0'),words:'가상',tight:'가상'}));
 const m=matchIndex(many,'가상');assert.equal(m.ids.length,2000);assert.equal(m.more,true);
});

test('gate: login and own workspace first; without the photo_content key 403 before any Drive call',async()=>{
 const w=world();
 assert.equal((await w.call({action:'content-find',q:'가상'},{jwt:''})).status,401);
 assert.equal((await w.call({action:'content-find',q:'가상'},{jwt:'nope'})).status,401);
 // 다른 가입자(허용 표에 없음): 화면이 남의 작업공간 id를 보내도 403, 구글 토큰·드라이브를 부르지 않는다.
 const other=await w.call({action:'content-find',q:'가상',workspace_id:WS,sheet:SHEET},{jwt:JWT2});
 assert.equal(other.status,403);assert.equal(other.body.error,'feature_off');
 assert.ok(!w.calls.some(c=>c.host==='oauth2.googleapis.com'||c.host==='www.googleapis.com'));
 // 허용 표의 답이 없거나(여러 곳·0곳) 다른 작업공간이면 운영자 owner도 403.
 for(const feature of [null,WS2,'not-a-uuid']){const r=await world({feature}).call({action:'content-find',q:'가상'});assert.equal(r.status,403,String(feature));}
 assert.equal((await w.call({action:'content-find',q:''})).body.error,'q_invalid');
 assert.equal((await w.call({action:'content-find',q:'x'.repeat(51)})).status,400);
});

test('sheet lookup: none = empty result, two = error, the screen cannot choose the sheet',async()=>{
 const none=await world({sheets:[]}).call({action:'content-find',q:'가상낱말가'});
 assert.equal(none.status,200);assert.deepEqual(none.body,{ok:true,index:false,ids:[],more:false});
 const noFolder=await world({named:[],root:null}).call({action:'content-find',q:'가상낱말가'});
 assert.deepEqual(noFolder.body,{ok:true,index:false,ids:[],more:false});
 const two=await world({sheets:[{id:SHEET,parents:[ROOTF]},{id:'SYNTHSHEET0002',parents:[NAMEDF]}]}).call({action:'content-find',q:'가상낱말가'});
 assert.equal(two.status,409);assert.equal(two.body.error,'index_ambiguous');
 // 시트가 'WORK ON+' 이름 폴더 안에만 있어도 찾는다(맨 위 앱 폴더 id가 없을 때).
 const byName=await world({root:null,sheets:[{id:SHEET,parents:[NAMEDF]}]}).call({action:'content-find',q:'가상낱말가'});
 assert.deepEqual(byName.body.ids,['GDPHOTO0001','GDPHOTO0002']);
 // 다른 폴더(WORK ON+ 밖)의 같은 이름 시트는 보지 않는다.
 const outside=await world({sheets:[{id:SHEET,parents:['SYNTHELSEWHERE01']}]}).call({action:'content-find',q:'가상낱말가'});
 assert.equal(outside.body.index,false);
 const shape=await world({csv:'name,words\nGDPHOTO0001,가상'}).call({action:'content-find',q:'가상'});
 assert.equal(shape.status,422);assert.equal(shape.body.error,'index_shape');
});

test('answer: only matching ids, never the description words; logs carry no words; memory cache only',async()=>{
 const w=world();
 const r=await w.call({action:'content-find',q:'가상낱말가',sheet:'SYNTHOTHERSHEET1'});
 assert.equal(r.status,200);
 assert.deepEqual(r.body,{ok:true,index:true,ids:['GDPHOTO0001','GDPHOTO0002'],more:false});
 const r2=await w.call({action:'content-find',q:'낱말라'});
 assert.deepEqual(r2.body.ids,['GDPHOTO0004']);
 for(const word of [...WORDS,'vision','ocr','heic'])for(const x of [r.text,r2.text])assert.ok(!x.includes(word),'no description text in the answer: '+word);
 assert.ok(w.logs.every(l=>!WORDS.some(word=>l.includes(word))),'no words in logs');
 // 몇 분 안의 두 번째 찾기는 시트를 다시 받지 않는다(인스턴스 메모리). 5분이 지나면 다시 받는다.
 const exports=()=>w.calls.filter(c=>c.path.endsWith('/export')).length;
 assert.equal(exports(),1);
 w.tick(5*60*1000+1);await w.call({action:'content-find',q:'가상'});assert.equal(exports(),2);
 // 아무것도 쓰지 않는다(Drive·DB 쓰기 없음).
 assert.ok(w.calls.filter(c=>c.host==='www.googleapis.com').every(c=>c.method==='GET'));
 assert.ok(w.calls.filter(c=>c.host==='sb.example.test'&&c.path.startsWith('/rest/v1/')&&c.path!=='/rest/v1/rpc/app_operator_feature_workspace').every(c=>c.method==='GET'));
});
