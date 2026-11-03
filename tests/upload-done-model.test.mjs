// LIB-업로드완료알림: app/upload-done-model.mjs 알림 글·시간.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const m=await import('../app/upload-done-model.mjs');

test('알림 글: 한 개는 파일 이름, 여러 개는 개수, 실패는 따로',()=>{
  assert.equal(m.uploadDoneLine({done:1,names:['보고서.pdf']}),'보고서.pdf 올렸어요');
  assert.equal(m.uploadDoneLine({done:3,names:['a','b','c']}),'3개 올렸어요');
  assert.equal(m.uploadDoneLine({done:2,failed:1}),'2개 올렸어요 · 1개 못 올렸어요');
  assert.equal(m.uploadDoneLine({failed:2}),'2개 못 올렸어요');
  assert.equal(m.uploadDoneLine({done:2,where:'주간보고'}),'주간보고에 2개 올렸어요');
  assert.equal(m.uploadDoneLine({}),'');
});
test('긴 파일 이름은 줄여서 한 줄',()=>{
  const line=m.uploadDoneLine({done:1,names:['아주아주아주아주아주아주아주아주아주아주긴파일이름.pdf']});
  assert.ok(line.endsWith('… 올렸어요')&&line.length<=36);
});
test('시간: 기본 알림(2초)보다 길게, 실패는 더 길게',()=>{
  assert.ok(m.uploadDoneMs()>2000);assert.ok(m.uploadDoneMs({failed:1})>m.uploadDoneMs());
});
test('자료실 올리기 길(끌어 놓기·등록 창)과 사업 보고 사진이 같은 부품을 부른다',()=>{
  for(const f of ['library-upload.js','meeting-round-detail.js'])assert.match(readFileSync(new URL('../app/'+f,import.meta.url),'utf8'),/announceUploaded\(/,f);
  assert.match(readFileSync(new URL('../app/upload-done.js',import.meta.url),'utf8'),/notify\(/);
});
