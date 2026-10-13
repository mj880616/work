import assert from 'node:assert/strict';
import {createBasketHandler} from '../../../supabase/functions/basket-files/handler.ts';
const PHOTO={drive_file_id:'source',file_name:'photo.jpg',mime_type:'image/jpeg',size_bytes:4};
export const STAMP='2026-10-13T01:00:00.123456+00:00';
const meta=(id,mime,name)=>({id,name,mimeType:mime,ownedByMe:true,trashed:false,parents:['folder'],permissions:[{type:'user',role:'owner'}],capabilities:{canDownload:true,canDelete:true},version:'1',size:'4'});
export function ocrHarness(options={}){
 const NOTE=options.note?.id??'10000000-0000-4000-8000-000000000001',WS=options.note?.workspace_id??'20000000-0000-4000-8000-000000000001';
 const note=options.note??{id:NOTE,workspace_id:WS,updated_at:STAMP,attachments:[structuredClone(PHOTO)],raw_text:'原文保護',archived_at:options.archived?STAMP:null,ai_export_allowed:!options.excluded};
 const calls={rpc:[],drive:[],logs:[],client:[],writes:[]};let doc=null,counter=0,settingsReads=0;
 const admin={auth:{getUser:async jwt=>({data:{user:jwt==='owner'?{id:'user'}:null},error:null})},from(table){
  if(table==='app_notes'&&options.adminNotes)return options.adminNotes();
  assert.notEqual(table,'app_notes','OCR must use caller RLS rather than admin note reads/writes');
  const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:table==='app_workspace_members'?{role:options.nonOwner?'member':'owner',workspace_id:WS}:{basket_folder_id:options.settingsCleared&&++settingsReads>1?null:'folder'},error:null}),single:async()=>({data:{google_client_id:'client',google_client_secret:'secret',google_refresh_token:'refresh'},error:null})};return q;
 }};
 const user={from(table){assert.equal(table,'app_notes');const filters={};const q={select(){return q;},eq(k,v){filters[k]=v;return q;},maybeSingle:async()=>({data:filters.id===NOTE&&filters.workspace_id===WS?structuredClone(note):null,error:null})};return q;},async rpc(name,args){
  assert.equal(name,'app_basket_update_attachment_ocr');calls.rpc.push(structuredClone(args));
  if(options.rpcHook){const result=await options.rpcHook(name,args,note,calls);if(result)return result;}
  if(options.missingDb)return {data:null,error:{code:'PGRST202'}};
  if(args.p_note_id===null)return {data:{ok:false,error:'INVALID_INPUT'},error:null};
  if(args.p_note_updated_at!==note.updated_at)return {data:{ok:false,error:'NOTE_CHANGED'},error:null};
  if(JSON.stringify(args.p_expected_attachment)!==JSON.stringify(note.attachments[0]))return {data:{ok:false,error:'ATTACHMENT_CHANGED'},error:null};
  if((note.attachments[0].ocr?.text??'')!==(args.p_ocr.text??''))note.updated_at=`2026-10-13T02:00:00.${String(++counter).padStart(6,'0')}+00:00`;
  note.attachments[0]={...note.attachments[0],ocr:structuredClone(args.p_ocr)};calls.writes.push(structuredClone(note.attachments[0].ocr));
  if(options.commitUnknown&&args.p_ocr.state==='done')return {data:null,error:{code:'NETWORK'}};
  return {data:{ok:true,updated_at:note.updated_at,attachment:structuredClone(note.attachments[0])},error:null};
 }};
 const fetcher=async(input,init={})=>{
  const url=new URL(input),method=init.method||'GET';calls.drive.push({url,method});
  if(url.hostname==='oauth2.googleapis.com')return Response.json({access_token:'token'});
  if(url.pathname.endsWith('/about'))return Response.json({importFormats:{'image/jpeg':['application/vnd.google-apps.document'],'image/png':['application/vnd.google-apps.document']},exportFormats:{'application/vnd.google-apps.document':['text/plain']}});
  if(url.pathname==='/drive/v3/files/folder')return Response.json({...meta('folder','application/vnd.google-apps.folder','Web2 바구니'),parents:['root']});
  if(url.pathname==='/drive/v3/files'&&method==='GET'&&!url.searchParams.get('q')?.includes("name = 'Web2 바구니'")&&options.discoveryStatus)return new Response(null,{status:options.discoveryStatus});
  if(url.pathname==='/drive/v3/files'&&method==='GET')return Response.json({files:url.searchParams.get('q')?.includes("name = 'Web2 바구니'")?options.noRoot?[]:[{...meta('folder','application/vnd.google-apps.folder','Web2 바구니'),parents:['root']}]:options.discoveryEmpty?[]:options.discoveryFiles??(doc?[doc]:[])});
  if(url.pathname==='/drive/v3/files/source'&&url.searchParams.get('alt')==='media')return new Response(options.sourceBytes??new Uint8Array([255,216,255,0]));
  if(url.pathname==='/drive/v3/files/source')return Response.json({...meta('source','image/jpeg','photo.jpg'),...options.sourceMetadata});
  if(url.pathname==='/upload/drive/v3/files'&&url.searchParams.get('uploadType')==='resumable')return new Response('{}',{headers:{location:'https://www.googleapis.com/legacy-upload'}});
  if(url.pathname==='/legacy-upload'&&method==='PUT')return Response.json({id:'legacy-second'});
  if(url.pathname==='/upload/drive/v3/files'){
   assert.equal(calls.writes.at(-1)?.cleanup_state,'create_pending','durable attempt before remote POST');
   const body=new TextDecoder().decode(await new Response(init.body).arrayBuffer()),properties=JSON.parse(body.split('\r\n\r\n')[1].split('\r\n')[0]);
   doc={...meta('temp','application/vnd.google-apps.document','OCR'),...properties,id:'temp'};
   if(options.createUnknown)throw Error('PRIVATE_CREATE_ERROR');return Response.json({id:'temp'});
  }
  if(url.pathname==='/drive/v3/files/temp'&&method==='GET')return Response.json({...doc,...options.temp});
  if(url.pathname==='/drive/v3/files/temp/export'){
   if(options.onExport)await options.onExport(note);
   if(options.sourceChanged)note.updated_at='2026-10-13T03:00:00.999999+00:00';
   return new Response(options.text??'인식 글');
  }
  if(url.pathname==='/drive/v3/files/temp'&&method==='DELETE'){if(options.onDelete)await options.onDelete(note);if(options.cleanupFail)return new Response(null,{status:503});doc=null;return new Response(null,{status:204});}
  throw Error('unexpected HTTP');
 };
 const makeHandler=()=>createBasketHandler(admin,{fetch:fetcher,log:code=>calls.logs.push(code),userClient:authorization=>{calls.client.push(authorization);assert.equal(authorization,'Bearer owner');return options.user??user;}});let handler=makeHandler();
 const request=(action='ocr-read',extra={},method='POST',token='owner')=>{
  const url=method==='GET'?`https://edge.test/basket-files?action=${action}&note_id=${extra.note_id||NOTE}`:'https://edge.test/basket-files';
  return handler(new Request(url,{method,headers:{Authorization:'Bearer '+token,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify({action,note_id:NOTE,note_updated_at:note.updated_at,expected_attachment:structuredClone(note.attachments[0]),...extra})}:{})}));
 };
 return {handler,request,note,calls,user,fetcher,restart:()=>{handler=makeHandler();}};
}
