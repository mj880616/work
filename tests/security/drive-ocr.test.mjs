import test from 'node:test';
import assert from 'node:assert/strict';
import {createDriveOcr,ocrMarkers} from '../../supabase/functions/_shared/drive-ocr.ts';
const PHOTO={drive_file_id:'source',file_name:'photo.jpg',mime_type:'image/jpeg',size_bytes:4};
const IDS={note:'10000000-0000-4000-8000-000000000001',workspace:'20000000-0000-4000-8000-000000000001',attempt:'30000000-0000-4000-8000-000000000001',stamp:'2026-10-13T01:00:00.123456+00:00'};
const privateMeta=(id,mime,name)=>({id,name,mimeType:mime,ownedByMe:true,trashed:false,parents:['folder'],permissions:[{type:'user',role:'owner'}],capabilities:{canDownload:true,canDelete:true},version:'1',size:'4',md5Checksum:'synthetic'});
async function harness(options={}){
 const markers=await ocrMarkers(IDS.note,IDS.workspace,'source',IDS.attempt,IDS.stamp,'1');
 const calls=[],meta=privateMeta('source','image/jpeg','photo.jpg');let doc={...privateMeta('temp','application/vnd.google-apps.document','OCR'),appProperties:markers};
 const fetcher=async(input,init={})=>{
  const url=new URL(input),method=init.method||'GET';calls.push({url,method,init});
  assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer token');
  if(url.pathname.endsWith('/about'))return Response.json(options.formats||{importFormats:{'image/jpeg':['application/vnd.google-apps.document'],'image/png':['application/vnd.google-apps.document']},exportFormats:{'application/vnd.google-apps.document':['text/plain']}});
  if(url.pathname==='/drive/v3/files/source'&&url.searchParams.get('alt')==='media')return new Response(options.sourceBytes||new Uint8Array([255,216,255,0]));
  if(url.pathname==='/drive/v3/files/source')return Response.json({...meta,...options.source});
  if(url.pathname==='/drive/v3/files/temp/export')return new Response(options.text??' 글\r\n ');
  if(url.pathname==='/drive/v3/files/temp'&&method==='GET')return Response.json({...doc,...options.temp});
  if(url.pathname==='/drive/v3/files/temp'&&method==='DELETE')return new Response(null,{status:options.deleteStatus||204});
  if(url.pathname==='/drive/v3/files'&&method==='GET')return Response.json(typeof options.list==='function'?options.list(url):options.list||{files:[doc]});
  if(url.pathname==='/upload/drive/v3/files'){
   const bytes=new Uint8Array(await new Response(init.body).arrayBuffer());
   assert.ok(new TextDecoder().decode(bytes).includes('application/vnd.google-apps.document'));
   assert.ok(new TextDecoder().decode(bytes).includes(IDS.stamp));
   if(options.createUnknown)throw Error('PRIVATE_REMOTE_ERROR');
   return Response.json({id:options.createdId||'temp'});
  }
  throw Error('unexpected request');
 };
 return {drive:createDriveOcr({fetch:fetcher}),markers,calls};
}
test('Drive uses drive.file-compatible import/export without changing the original',async()=>{
 const h=await harness();assert.deepEqual(await h.drive.formats('token'),['image/jpeg','image/png']);
 const source=await h.drive.source(PHOTO,'folder','token');
 assert.equal(await h.drive.create(source,PHOTO,'folder',h.markers,'token'),'temp');
 assert.equal((await h.drive.temp('temp','source','folder',h.markers,'token')).id,'temp');
 assert.equal(await h.drive.text('temp','token'),' 글\r\n ');
 await h.drive.remove('temp','source','folder',h.markers,'token');
 assert.equal(h.calls.filter(c=>c.method==='POST').length,1);assert.equal(h.calls.filter(c=>c.method==='DELETE').length,1);
 assert.equal(h.calls.some(c=>c.method==='PATCH'||(c.method==='DELETE'&&c.url.pathname.endsWith('/source'))),false);
});
test('source identity and private permissions are checked before importing',async()=>{
 for(const source of [{id:'other'},{mimeType:'application/pdf'},{name:'other'},{size:'5'},{ownedByMe:false},{parents:['other']},{permissions:undefined},{permissions:[{type:'anyone',role:'reader'}]},{capabilities:{canDownload:false}},{trashed:true}]){
  const h=await harness({source});await assert.rejects(h.drive.source(PHOTO,'folder','token'));assert.equal(h.calls.some(c=>c.method==='POST'||c.method==='DELETE'),false);
 }
});
test('wrong binary signature, length or unavailable import maps never create a document',async()=>{
 for(const sourceBytes of [new Uint8Array([1,2,3,4]),new Uint8Array([255,216,255])]){
  const h=await harness({sourceBytes});const source=await h.drive.source(PHOTO,'folder','token');await assert.rejects(h.drive.create(source,PHOTO,'folder',h.markers,'token'));assert.equal(h.calls.some(c=>c.method==='POST'),false);
 }
 assert.deepEqual(await(await harness({formats:{importFormats:{},exportFormats:{}}})).drive.formats('token'),[]);
});
test('unknown creation is marked unknown and never retried',async()=>{
 const h=await harness({createUnknown:true}),source=await h.drive.source(PHOTO,'folder','token');
 await assert.rejects(h.drive.create(source,PHOTO,'folder',h.markers,'token'),e=>e.unknown===true&&e.code==='OCR_CREATE_UNKNOWN');
 assert.equal(h.calls.filter(c=>c.method==='POST').length,1);assert.equal(h.calls.filter(c=>c.method==='DELETE').length,0);
});
test('strict temp identity prevents arbitrary or original deletion',async()=>{
 for(const temp of [{id:'source'},{mimeType:'image/jpeg'},{parents:['other']},{permissions:undefined},{ownedByMe:false},{appProperties:{...await ocrMarkers(IDS.note,IDS.workspace,'other',IDS.attempt,IDS.stamp,'1')}},{capabilities:{canDelete:false}}]){
  const h=await harness({temp});await assert.rejects(h.drive.remove('temp','source','folder',h.markers,'token'));assert.equal(h.calls.some(c=>c.method==='DELETE'),false);
 }
 const h=await harness();await assert.rejects(h.drive.remove('source','source','folder',h.markers,'token'));assert.equal(h.calls.length,0);
});
test('text export refuses oversized or invalid UTF8 rather than truncating',async()=>{
 for(const text of ['x'.repeat(16385),'😀'.repeat(16385),new Uint8Array([0xc0,0xaf]),new Uint8Array([0])]){
  const h=await harness({text});await assert.rejects(h.drive.text('temp','token'));assert.equal(h.calls.some(c=>c.method==='DELETE'),false);
 }
 const h=await harness({text:'😀'.repeat(16384)});assert.equal((await h.drive.text('temp','token')).length,32768);
});
test('delete unknown retains the known identity and is never silently accepted',async()=>{
 const h=await harness({deleteStatus:503});await assert.rejects(h.drive.remove('temp','source','folder',h.markers,'token'),e=>e.code==='OCR_DELETE_UNKNOWN');
 assert.equal(h.calls.filter(c=>c.method==='DELETE').length,1);
});

test('reconciliation searches every page and requires one exact private-marker identity',async()=>{
 const h=await harness({list:url=>url.searchParams.has('pageToken')?{files:[{id:'temp'}]}:{files:[],nextPageToken:'second'}});
 assert.equal(await h.drive.find('folder',h.markers,'token'),'temp');
 const calls=h.calls.filter(c=>c.url.pathname==='/drive/v3/files');assert.equal(calls.length,2);
 assert.ok(calls.every(c=>c.url.searchParams.get('q').includes("appProperties has { key='attempt'")));
 assert.equal(h.calls.some(c=>c.method==='POST'||c.method==='DELETE'),false);
 for(const list of [{files:[]},{files:[{id:'temp'},{id:'other'}]},{files:[],incompleteSearch:true},{files:[],nextPageToken:'cycle'}]){
  const probe=await harness({list});
  if(list.files.length===0&&!list.incompleteSearch&&!list.nextPageToken)assert.equal(await probe.drive.find('folder',probe.markers,'token'),null);
  else await assert.rejects(probe.drive.find('folder',probe.markers,'token'));
  assert.equal(probe.calls.some(c=>c.method==='POST'||c.method==='DELETE'),false);
 }
});

test('provider reports the actual create dispatch boundary, including response loss but excluding pre-POST failure',async()=>{
 for(const options of [{},{createUnknown:true},{sourceBytes:new Uint8Array([1,2,3,4])}]){
  const h=await harness(options),source=await h.drive.source(PHOTO,'folder','token');let dispatched=0;
  try{await h.drive.create(source,PHOTO,'folder',h.markers,'token',()=>{dispatched++;});}catch{}
  assert.equal(dispatched,options.sourceBytes?0:1);assert.equal(h.calls.filter(c=>c.method==='POST').length,dispatched);
 }
});
