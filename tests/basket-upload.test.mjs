import { test } from 'node:test';
import assert from 'node:assert/strict';
const mod = import('../app/basket-upload.js');
const file = name => new File(['text'], name, {type:'text/plain'});
const rt = {copyUploadFile:async f=>new File([await f.arrayBuffer()],f.name,{type:f.type})};
const batch = async (files, id) => {const m=await mod;const b=m.createUploadBatch(id);b.entries=files.map(file=>({file,kind:'pending'}));return b;};

test('text and files use memory copies, one multipart file per request, then returned note_id', async()=>{
 const m=await mod,b=await batch([file('one'),file('two'),file('three')]);const calls=[];let active=0;
 const request=async(fd,original)=>{active++;assert.equal(active,1);assert.equal(fd.getAll('file').length,1);assert.notEqual(fd.get('file'),original);calls.push({id:fd.get('note_id'),text:fd.get('raw_text')});await Promise.resolve();active--;return {ok:true,note_id:'n',attachments:calls.map((_,i)=>({drive_file_id:'id'+i}))};};
 await m.uploadBatch(b,{raw_text:' 原文\n ',rt,request});
 assert.deepEqual(calls,[{id:null,text:' 原文\n '},{id:'n',text:null},{id:'n',text:null}]);assert.ok(b.entries.every(e=>e.kind==='success'));
 await m.uploadBatch(b,{raw_text:'must not post',rt,request});assert.equal(calls.length,3);
});
test('file only omits raw_text and existing note preserves original text',async()=>{
 const m=await mod;for(const id of [undefined,'existing']){const b=await batch([file('one')],id);await m.uploadBatch(b,{raw_text:id?'ignore':'',rt,request:async fd=>{assert.equal(fd.get('raw_text'),null);assert.equal(fd.get('note_id'),id||null);return {ok:true,note_id:id||'new',attachments:[]};}});}
});
test('copy read failure sends zero requests and leaves later files pending',async()=>{
 const m=await mod,b=await batch([file('bad'),file('next')]);let requests=0;
 await assert.rejects(m.uploadBatch(b,{rt:{copyUploadFile:async()=>{throw Object.assign(Error('read'),{code:'file_read_failed'});}},request:async()=>requests++}),/파일을 읽지/);
 assert.equal(requests,0);assert.equal(b.entries[0].kind,'error');assert.equal(b.entries[1].kind,'pending');
});
test('preflight blocks >100MiB, empty, >20 including existing attachments and oversized text before copying',async()=>{
 const m=await mod;let copies=0;const opts={rt:{copyUploadFile:async()=>copies++},request:async()=>assert.fail('no requests')};
 for(const files of [[{name:'large',size:104857601}],[{name:'empty',size:0}],Array.from({length:21},()=>file('one'))])await assert.rejects(m.uploadBatch(await batch(files),opts));
 const b=await batch([file('one')],'n');b.attachments=Array.from({length:20},()=>({}));await assert.rejects(m.uploadBatch(b,opts),/20/);
 await assert.rejects(m.uploadBatch(await batch([file('one')]),{...opts,raw_text:'가'.repeat(20001)}),/20,000/);assert.equal(copies,0);
});
for(const [status,code,message] of [[503,'note_save_result_unknown','저장 결과를 확인하지 못했습니다. 바구니에서 확인 후 다시 시도하세요'],[409,'note_changed','업데이트를 다시 불러'],[401,'unauthorized','로그인'],[413,'too_large','100MiB']])test(`${status} ${code} stops later uploads and preserves completed files`,async()=>{
 const m=await mod,b=await batch([file('one'),file('bad'),file('next')]);let calls=0;
 const request=async()=>{if(++calls===1)return {ok:true,note_id:'n',attachments:[{drive_file_id:'done'}]};throw Object.assign(Error('server'),{status,code});};
 await assert.rejects(m.uploadBatch(b,{rt,request}),e=>e.message.includes(message));assert.equal(calls,2);assert.equal(b.entries[0].kind,'success');assert.equal(b.entries[2].kind,'pending');
 if(status===503||status===409){await assert.rejects(m.uploadBatch(b,{rt,request}));assert.equal(calls,2);}
 else {await assert.rejects(m.uploadBatch(b,{rt,request}));assert.equal(calls,3);}
});
test('stale owner after copy cannot send a request',async()=>{
 const m=await mod,b=await batch([file('one')]);let current=true;
 await assert.rejects(m.uploadBatch(b,{rt:{copyUploadFile:async f=>{current=false;return f;}},isCurrent:()=>current,request:()=>assert.fail('stale request')}));
});
test('Drive links permit only ASCII letters numbers underscore hyphen',async()=>{
 const m=await mod;assert.equal(m.driveFileUrl('abc_Z-09'),'https://drive.google.com/file/d/abc_Z-09/view');
 for(const id of ['',null,'a/b','a?x','a#','한글','https://bad','a%2F','a\n'])assert.equal(m.driveFileUrl(id),null);
});
test('native upload transport preserves API error code, never replays 401 and keeps multipart headers',async()=>{
 const m=await mod;let calls=0;const original=file('one'),fd=new FormData();fd.append('file',original);
 const runtime={config:{url:'https://test',key:'publishable'},session:{ensure:async()=>true,read:()=>({access_token:'test-token'}),refresh:()=>assert.fail('no automatic replay')}};
 for(const [status,code] of [[409,'note_changed'],[503,'note_save_result_unknown'],[401,'unauthorized'],[413,'too_large']])await assert.rejects(m.uploadBasketFile(fd,original,runtime,async(url,opts)=>{calls++;assert.equal(url,'https://test/functions/v1/basket-files');assert.equal(opts.headers['Content-Type'],undefined);assert.equal(opts.signal,undefined);return new Response(JSON.stringify({code,error:'failed'}),{status});}),e=>e.code===code&&e.status===status);
 assert.equal(calls,4);
});
test('non JSON HTTP 413 remains a known size failure, malformed success remains unknown',async()=>{
 const m=await mod,f=file('one'),fd=new FormData();fd.append('file',f);
 const runtime={config:{url:'https://test',key:'publishable'},session:{ensure:async()=>true,read:()=>({access_token:'test'})}};
 await assert.rejects(m.uploadBasketFile(fd,f,runtime,async()=>new Response('too large',{status:413})),e=>e.status===413);
 const b=await batch([f]);await assert.rejects(m.uploadBatch(b,{rt,request:async()=>({ok:true,note_id:'n'})}),e=>e.code==='note_save_result_unknown');assert.ok(b.blocked);
});
test('multipart text character preflight accounts for canonical CRLF before making any request',async()=>{
 const m=await mod,b=await batch([file('one')]);let copies=0;
 await assert.rejects(m.uploadBatch(b,{raw_text:'가'.repeat(19999)+'\n',rt:{copyUploadFile:async()=>copies++}}),/20,000/);assert.equal(copies,0);
 await m.uploadBatch(b,{raw_text:'가'.repeat(19998)+'\n',rt,request:async()=>({ok:true,note_id:'n',attachments:[]})});assert.equal(b.entries[0].kind,'success');
});
test('only validated current basket upload successes publish safe summary refresh metadata',async()=>{
 const m=await mod,events=[];globalThis.window={dispatchEvent:event=>events.push(event.detail)};
 try{
  const b=await batch([file('one'),file('two')],'n');await m.uploadBatch(b,{rt,request:async()=>({ok:true,note_id:'n',attachments:[]})});
  assert.equal(events.length,2);assert.deepEqual(events[0],{path:'/functions/v1/basket-files',method:'POST',fields:['attachments'],action:'',projectLinked:false});
  for(const result of [{ok:false},{ok:true,note_id:'other',attachments:[]},{ok:true,note_id:'n'}])await assert.rejects(m.uploadBatch(await batch([file('private')],'n'),{rt,request:async()=>result}));
  assert.equal(events.length,2);
  let current=true;await assert.rejects(m.uploadBatch(await batch([file('private')],'n'),{rt,isCurrent:()=>current,request:async()=>{current=false;return {ok:true,note_id:'n',attachments:[]};}}));assert.equal(events.length,2);
  window.dispatchEvent=()=>{throw Error('subscriber');};await m.uploadBatch(await batch([file('private')],'n'),{rt,request:async()=>({ok:true,note_id:'n',attachments:[]})});
 }finally{delete globalThis.window;}
});

const photo = (id, mime='image/jpeg') => ({drive_file_id:id,file_name:id+'.jpg',mime_type:mime,size_bytes:4});
function fakeOcr(calls, {result, thrown=false}={}) {
 return {state:{enabled:true},capabilities:async()=>{calls.push('capabilities');return {ok:true};},read:async(n,id)=>{calls.push(['read',n,id]);if(thrown)throw Error('provider private detail');return result||{ok:true,note_id:n,drive_file_id:id,attachment:{...photo(id),ocr:{state:'done',text:'saved photo',original_file_id:id,attempt_id:'22222222-2222-4222-8222-222222222222',temp_document_id:'temp_'+id,cleanup_state:'deleted'}},updated_at:'2026-10-06T01:00:01.234567Z',requestStartUpdatedAt:'2026-10-06T01:00:00.123456Z'};}};
}
test('OCR runs serially only after the complete successful multipart batch and only newly saved supported sources',async()=>{
 const m=await mod,b=await batch([file('one'),file('two')],'n');b.attachments=[photo('existing')];const calls=[],notices=[];
 const controller=fakeOcr(calls);const request=async()=>{calls.push('multipart');const i=calls.filter(x=>x==='multipart').length;return {ok:true,note_id:'n',attachments:[photo('existing'),photo('new1'),...(i===2?[photo('new2','image/png'),photo('pdf','application/pdf')]:[])]};};
 const result=await m.uploadBatch(b,{rt,request,ocr:controller,onOcrChange:value=>{assert.ok(b.entries.every(e=>e.kind==='success'));notices.push(value);}});
 assert.deepEqual(calls,['multipart','multipart','capabilities',['read','n','new1'],['read','n','new2']]);assert.equal(notices.length,2);assert.equal(result.ok,true);assert.equal(b.blocked,null);assert.deepEqual(Object.keys(result),['ok','note_id','attachments']);assert.ok(b.entries.every(e=>e.kind==='success'));
});
for(const mode of ['failed','unknown','throw','observer'])test('confirmed upload survives separate OCR '+mode+' without replay',async()=>{
 const m=await mod,b=await batch([file('one')]);const calls=[],notices=[];let sends=0;
 const result={ok:false,code:mode==='unknown'?'OCR_RESULT_UNKNOWN':'OCR_FAILED',retryable:false,result_unknown:mode==='unknown',ocr_saved:false,text_changed:false};
 const ocr=fakeOcr(calls,{result,thrown:mode==='throw'});
 const request=async()=>{sends++;return {ok:true,note_id:'n',attachments:[photo('new')]};};
 const saved=await m.uploadBatch(b,{rt,request,ocr,onOcrChange:value=>{notices.push(value);if(mode==='observer')throw Error('observer');}});
 assert.equal(saved.ok,true);assert.equal(sends,1);assert.equal(b.entries[0].kind,'success');assert.deepEqual(b.entries[0].file,{name:'one',size:4});assert.equal(b.blocked,null);assert.equal(notices.length,1);assert.equal(notices[0].note_id,'n');assert.equal(notices[0].drive_file_id,'new');
 await m.uploadBatch(b,{rt,request,ocr});assert.equal(sends,1);assert.equal(calls.filter(x=>Array.isArray(x)).length,1);
});
test('partial multipart failure does not start OCR even for already saved photo',async()=>{
 const m=await mod,b=await batch([file('one'),file('bad')]);const calls=[];let sends=0;
 await assert.rejects(m.uploadBatch(b,{rt,ocr:fakeOcr(calls),request:async()=>{if(++sends===1)return {ok:true,note_id:'n',attachments:[photo('new')]};throw Object.assign(Error(),{status:503});}}));
 assert.equal(b.entries[0].kind,'success');assert.equal(b.entries[1].kind,'error');assert.ok(b.blocked);assert.deepEqual(calls,[]);
});
test('default-disabled OCR keeps legacy minimal upload responses and performs no session or OCR fetch',async()=>{
 const m=await mod,b=await batch([file('one')]);let notices=0;
 await m.uploadBatch(b,{rt:{...rt,session:{read:()=>assert.fail('disabled session'),ensure:()=>assert.fail('disabled ensure')}},request:async()=>({ok:true,note_id:'legacy',attachments:[{drive_file_id:'minimal'}]}),onOcrChange:()=>notices++});assert.equal(notices,0);
});

test('complete multipart phase precedes real enabled controller fresh CAS for each new photo',async()=>{
 const {createBasketOcr}=await import('../app/basket-ocr.js');const m=await mod,b=await batch([file('one'),file('two')]);
 const noteId='11111111-1111-4111-8111-111111111111',owner='owner',workspace='workspace';let stamp='2026-10-06T01:00:00.123456Z',files=[],count=0;const calls=[];
 const runtime={...rt,context:{read:()=>({user:{id:owner},workspace:{id:workspace}})},session:{ensure:async()=>true,read:()=>({access_token:'synthetic',user:{id:owner}}),epoch:()=>1},config:{url:'https://synthetic.invalid',key:'publishable'}};
 const ocr=createBasketOcr({rt:runtime,enabled:true,fetcher:async(url,opts)=>{
  const action=opts.method==='POST'?JSON.parse(opts.body).action:new URL(url).searchParams.get('action');calls.push(action);
  if(action==='ocr-capabilities')return Response.json({ok:true,protocol_version:1,db:'supported',limits:{characters:16384,utf8_bytes:65536},supported_mime_types:['image/jpeg','image/png']});
  if(action==='ocr-status')return Response.json({ok:true,note_id:noteId,updated_at:stamp,attachments:files});
  const body=JSON.parse(opts.body);assert.equal(body.note_updated_at,stamp);assert.deepEqual(body.expected_attachment,files.find(f=>f.drive_file_id===body.expected_attachment.drive_file_id));count++;
  const attachment={...body.expected_attachment,ocr:{state:'done',text:'photo '+count,attempt_id:count===1?'22222222-2222-4222-8222-222222222222':'33333333-3333-4333-8333-333333333333',original_file_id:body.expected_attachment.drive_file_id,temp_document_id:'temp_'+count,cleanup_state:'deleted'}};
  stamp=count===1?'2026-10-06T01:00:01.234567Z':'2026-10-06T01:00:02.345678Z';files=files.map(f=>f.drive_file_id===attachment.drive_file_id?attachment:f);
  return Response.json({ok:true,note_id:noteId,updated_at:stamp,attachment,ocr_saved:true,text_changed:true,cleanup_state:'deleted'});
 }});
 const result=await m.uploadBatch(b,{rt:runtime,ocr,request:async()=>{calls.push('multipart');files=[...files,photo('file_'+files.length)];return {ok:true,note_id:noteId,attachments:structuredClone(files)};}});
 assert.deepEqual(calls,['multipart','multipart','ocr-capabilities','ocr-status','ocr-read','ocr-status','ocr-read']);assert.deepEqual(result.attachments.map(f=>f.ocr.text),['photo 1','photo 2']);assert.ok(b.entries.every(e=>e.kind==='success'));
});
