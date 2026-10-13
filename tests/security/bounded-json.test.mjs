import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const url=new URL('../../supabase/functions/_shared/bounded-json.mjs',import.meta.url);
const {readBoundedJson,NOTE_RESPONSE_BYTES}=existsSync(url)?await import(url.href):{};
test('bounded JSON reads exact decoded byte boundary and cancels overflow without trusting Content-Length',async()=>{
  assert.equal(typeof readBoundedJson,'function');
  const data='["한글😀"]',bytes=new TextEncoder().encode(data);
  assert.deepEqual(await readBoundedJson(new Response(bytes),{maxBytes:bytes.length}),['한글😀']);
  let cancelled=false;
  const response=new Response(new ReadableStream({start(c){c.enqueue(bytes);},cancel(){cancelled=true;}}),{headers:{'Content-Length':'1'}});
  await assert.rejects(readBoundedJson(response,{maxBytes:bytes.length-1})); assert.equal(cancelled,true);
});
test('bounded JSON rejects malformed UTF8/JSON and stream failures',async()=>{
  assert.equal(typeof readBoundedJson,'function');
  for(const body of [new Uint8Array([0xff]),'{broken'])await assert.rejects(readBoundedJson(new Response(body),{maxBytes:99}));
  await assert.rejects(readBoundedJson(new Response(new ReadableStream({start(c){c.error(Error('secret'));}})),{maxBytes:99}));
});
test('guard admits five max-length OCR notes including escaped control text and all bounded metadata',async()=>{
  assert.equal(typeof readBoundedJson,'function');
  const f={drive_file_id:'f'.repeat(255),file_name:'\u0001'.repeat(255),mime_type:'image/png',size_bytes:104857600,
    ocr:{state:'done',original_file_id:'f'.repeat(255),attempt_id:'10000000-0000-4000-8000-000000000001',cleanup_state:'delete_failed',temp_document_id:'t'.repeat(255),text:'\u0001'.repeat(16384),error_code:'E'.repeat(64),cleanup_error_code:'E'.repeat(64)}};
  const rows=Array.from({length:5},(_,i)=>({id:`n${i}`,workspace_id:'ws',raw_text:'\u0001'.repeat(20000),attachments:Array.from({length:20},()=>f)}));
  const wire=JSON.stringify(rows);assert.ok(new TextEncoder().encode(wire).length<NOTE_RESPONSE_BYTES);
  assert.deepEqual(await readBoundedJson(new Response(wire),{maxBytes:NOTE_RESPONSE_BYTES}),rows);
});

test('overflow returns controlled failure even when stream cancellation never settles',async()=>{
 let cancelled=false;
 const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2]));},cancel(){cancelled=true;return new Promise(()=>{});}}));
 const result=await Promise.race([readBoundedJson(response,{maxBytes:1}).then(()=> 'unexpected_success',e=>e.message),new Promise(r=>setImmediate(()=>r('blocked_on_cancel')))]);
 assert.equal(result,'BOUNDED_JSON_FAILED');assert.equal(cancelled,true);assert.equal(response.body.locked,false);
});
