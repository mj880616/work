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
for(const [status,code,message] of [[503,'note_save_result_unknown','저장 결과를 확인하지 못했습니다. 바구니에서 확인 후 다시 시도하세요'],[409,'note_changed','메모를 다시 불러'],[401,'unauthorized','로그인'],[413,'too_large','100MiB']])test(`${status} ${code} stops later uploads and preserves completed files`,async()=>{
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
