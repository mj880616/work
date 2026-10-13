import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveOcrText, decodeOcrBytes, OCR_LIMITS } from '../supabase/functions/_shared/basket-ocr-text.mjs';
const attempt='10000000-0000-4000-8000-000000000001';
const file=(changes={})=>({drive_file_id:'source',file_name:'photo.jpg',mime_type:'image/jpeg',size_bytes:4,...changes});
const ocr=(changes={})=>({state:'done',attempt_id:attempt,original_file_id:'source',cleanup_state:'created',temp_document_id:'temp',text:'이전 인식 글',...changes});
test('OCR projection is independent of lifecycle and retains previously stored text',()=>{
 assert.equal(effectiveOcrText(file()),'');
 for(const state of ['reading','done','failed'])assert.equal(effectiveOcrText(file({ocr:ocr({state})})),'이전 인식 글');
 for(const cleanup_state of ['created','delete_pending','deleted','delete_failed'])assert.equal(effectiveOcrText(file({ocr:ocr({cleanup_state})})),'이전 인식 글');
 assert.equal(effectiveOcrText(file({ocr:ocr({state:'empty',text:''})})), '');
 assert.equal(effectiveOcrText(file({ocr:{state:'unread',original_file_id:'source',cleanup_state:'none'}})), '');
});
test('valid Unicode and UTF8 limits include supplementary characters without truncation',()=>{
 const text='😀'.repeat(16384),bytes=new TextEncoder().encode(text);
 assert.equal(bytes.length,65536);assert.equal(decodeOcrBytes(bytes),text);
 assert.equal(effectiveOcrText(file({ocr:ocr({text})})),text);
 assert.equal(OCR_LIMITS.characters,16384);assert.equal(OCR_LIMITS.utf8Bytes,65536);
 for(const value of ['x'.repeat(16385),'😀'.repeat(16385)])assert.throws(()=>decodeOcrBytes(new TextEncoder().encode(value)),/OCR_TEXT_TOO_LONG/);
 assert.throws(()=>decodeOcrBytes(new Uint8Array(65537)),/OCR_TEXT_TOO_LONG/);
});
test('invalid UTF8 and NUL are rejected instead of normalized',()=>{
 assert.throws(()=>decodeOcrBytes(new Uint8Array([0xc0,0xaf])),/OCR_TEXT_INVALID/);
 assert.throws(()=>decodeOcrBytes(new Uint8Array([0])),/OCR_TEXT_INVALID/);
 assert.equal(decodeOcrBytes(new TextEncoder().encode(' \r\n\t')), '');
 assert.equal(decodeOcrBytes(new TextEncoder().encode(' 글\r\n ')), ' 글\r\n ');
});
test('stored malformed OCR or mismatched source cannot leak into a copy',()=>{
 for(const bad of [null,'private',[],{},ocr({state:'unknown'}),ocr({text:7}),ocr({text:null}),ocr({text:'a'.repeat(16385)}),ocr({original_file_id:'other'}),ocr({temp_document_id:'source'}),ocr({extra:'untrusted'}),ocr({state:'empty',text:'not-empty'}),ocr({cleanup_state:'none'}),ocr({error_code:'private error'}),ocr({attempt_id:'not-uuid'})])assert.throws(()=>effectiveOcrText(file({ocr:bad})),/BASKET_ATTACHMENT_INVALID/);
 assert.throws(()=>effectiveOcrText(file({mime_type:'application/pdf',ocr:ocr()})),/BASKET_ATTACHMENT_INVALID/);
 assert.equal(effectiveOcrText(file({mime_type:'application/pdf'})), '');
});
