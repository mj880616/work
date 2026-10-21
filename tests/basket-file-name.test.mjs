import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentName, attachmentTitle } from '../app/basket-file-name.mjs';
import { suggestNoteTitle } from '../app/basket-data.js';
import { memoLine } from '../app/journal-data.js';

// BASKET-드롭제목: names the server stored before PR #925 (Deno formData() cut at ; = and kept \" escapes;
// old basket-pc sent a MIME encoded word). Display only — the stored value is not changed.
const hwp = name => ({file_name:name, mime_type:'application/x-hwp', drive_file_id:'d1', size_bytes:3});
test('a good name is shown as stored', () => {
  assert.equal(attachmentName(hwp('연구 목적 및 면접조사 (최종).hwp')), '연구 목적 및 면접조사 (최종).hwp');
  assert.equal(attachmentTitle(hwp('회의록.hwp')), '파일 · 회의록.hwp');
  assert.equal(attachmentTitle({file_name:'a.jpg', mime_type:'image/jpeg'}), '사진 · a.jpg');
});
test('a lone quote becomes a readable fallback with the extension its type implies', () => {
  const file = hwp('"');
  assert.equal(attachmentName(file), '이름 없는 파일.hwp');
  assert.equal(attachmentTitle(file), '파일 · 이름 없는 파일.hwp');
  assert.equal(attachmentTitle({file_name:'"', mime_type:'image/png'}), '사진 · 이름 없는 사진.png');
  assert.equal(attachmentName({file_name:'"', mime_type:'application/x-unknown'}), '이름 없는 파일');
  assert.equal(attachmentName({file_name:'  ', mime_type:''}), '이름 없는 파일');
  assert.equal(attachmentName(null), '이름 없는 파일');
});
test('what is left of a cut or escaped name is shown without the stray quotes', () => {
  assert.equal(attachmentName(hwp('"회의록')), '회의록');
  assert.equal(attachmentName(hwp('say \\"hi\\".txt')), 'say "hi".txt');
  assert.equal(attachmentName(hwp('"a.hwp"')), 'a.hwp');
});
test('an old basket-pc encoded word is decoded', () => {
  const name = '연구 목적.hwp', b64 = Buffer.from(name, 'utf8').toString('base64');
  assert.equal(attachmentName(hwp(`=?utf-8?B?${b64}?=`)), name);
  assert.equal(attachmentName(hwp('=?utf-8?B?!!!?=')), '=?utf-8?B?!!!?=');
});
test('note title suggestion and journal line use the same display name', () => {
  assert.equal(suggestNoteTitle({raw_text:'', attachments:[hwp('"')]}), '이름 없는 파일.hwp');
  assert.equal(memoLine({raw_text:'', attachments:[hwp('"회의록'), hwp('b.hwp')]}), '첨부: 회의록 외 1개');
  assert.equal(memoLine({raw_text:'', attachments:[{file_name:''}, {file_name:''}]}), '첨부 2개');
});
