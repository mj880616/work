import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
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
const browserUrl=new URL('../app/basket-ocr-text.mjs',import.meta.url);
test('browser OCR source exists and is byte-identical to the Edge pure source',()=>{
 assert.ok(existsSync(browserUrl),'browser OCR pure projection must exist');
 assert.deepEqual(readFileSync(browserUrl),readFileSync(new URL('../supabase/functions/_shared/basket-ocr-text.mjs',import.meta.url)));
});
test('browser projection applies the same lifecycle, source identity and Unicode rejection fixtures',async()=>{
 assert.ok(existsSync(browserUrl),'browser OCR pure projection must exist');
 const browser=await import(browserUrl);
 assert.deepEqual(browser.OCR_LIMITS,OCR_LIMITS);assert.ok(Object.isFrozen(browser.OCR_LIMITS));
 const valid=[file(),file({mime_type:'application/pdf'}),file({ocr:{state:'unread',original_file_id:'source',cleanup_state:'none'}}),file({ocr:ocr({state:'empty',text:''})})];
 for(const state of ['reading','done','failed'])for(const cleanup_state of ['created','delete_pending','deleted','delete_failed'])valid.push(file({ocr:ocr({state,cleanup_state})}));
 valid.push(file({mime_type:'image/png',ocr:ocr({text:'😀'.repeat(16384)})}));
 for(const value of valid)assert.equal(browser.effectiveOcrText(value),effectiveOcrText(value));
 for(const bad of [null,'private',[],{},ocr({state:'unknown'}),ocr({text:7}),ocr({text:null}),ocr({text:'a'.repeat(16385)}),ocr({original_file_id:'other'}),ocr({temp_document_id:'source'}),ocr({extra:'untrusted'}),ocr({state:'empty',text:'not-empty'}),ocr({cleanup_state:'none'}),ocr({error_code:'private error'}),ocr({attempt_id:'not-uuid'})])assert.throws(()=>browser.effectiveOcrText(file({ocr:bad})),/BASKET_ATTACHMENT_INVALID/);
 assert.throws(()=>browser.effectiveOcrText(file({mime_type:'application/pdf',ocr:ocr()})),/BASKET_ATTACHMENT_INVALID/);
 for(const text of ['x'.repeat(16384),'😀'.repeat(16384),' 글\r\n ',' \r\n\t'])assert.equal(browser.decodeOcrBytes(new TextEncoder().encode(text)),decodeOcrBytes(new TextEncoder().encode(text)));
 for(const text of ['x'.repeat(16385),'😀'.repeat(16385)])assert.throws(()=>browser.validateOcrText(text),/OCR_TEXT_TOO_LONG/);
 assert.equal(browser.validateOcrText('😀'.repeat(16384)),'😀'.repeat(16384));
 assert.throws(()=>browser.validateOcrText('\0'),/OCR_TEXT_INVALID/);
 for(const bytes of [new Uint8Array(65537),new Uint8Array([0xc0,0xaf]),new Uint8Array([0])])assert.throws(()=>browser.decodeOcrBytes(bytes),/OCR_TEXT_(INVALID|TOO_LONG)/);
});
