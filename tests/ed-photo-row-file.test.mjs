// S48-21: 저장 모양(ed1)의 사진 나란히(photo_row)·파일 칸(file), 서식 줄 펼침 기억(view_prefs ed_more). DOM 없이 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cleanDoc, PHOTO_ROW_MAX, fileHref, fileSizeText, isEmptyDoc} from '../app/ed-schema.mjs';
import {toPlain, toTelegram, toHangul} from '../app/ed-text.mjs';
import {docToMarkdown} from '../app/ed-markdown-out.mjs';
import {validValue, KEYS} from '../app/view-prefs.js';

const ed1 = (...nodes) => ({v: 'ed1', doc: {type: 'doc', content: nodes}});
const pic = (id, alt = '') => ({type: 'image', attrs: {src: `share:${id}`, alt}});
const row = (...pics) => ({type: 'photo_row', content: pics});
const para = text => ({type: 'paragraph', attrs: {style: 'body2'}, content: [{type: 'text', text}]});

test('photo_row keeps 2..PHOTO_ROW_MAX photos; one photo is that photo again; past the limit starts the next row', () => {
  assert.equal(PHOTO_ROW_MAX, 4);
  assert.deepEqual(cleanDoc(ed1(row(pic('a'), pic('b')))).doc.content, [row(pic('a'), pic('b'))]);
  assert.deepEqual(cleanDoc(ed1(row(pic('a')))).doc.content, [pic('a')]);
  const five = cleanDoc(ed1(row(...['a', 'b', 'c', 'd', 'e'].map(id => pic(id))))).doc.content;
  assert.deepEqual(five, [row(pic('a'), pic('b'), pic('c'), pic('d')), pic('e')]);
  // Only photos inside a row: letters, tables or files in it are dropped; an empty row goes.
  assert.deepEqual(cleanDoc(ed1(row(pic('a'), para('글'), {type: 'file', attrs: {src: 'drive:x', name: 'n'}}, pic('b')))).doc.content, [row(pic('a'), pic('b'))]);
  assert.deepEqual(cleanDoc(ed1(row(), para('남김'))).doc.content, [para('남김')]);
  // A photo's own rules still hold inside a row (an outside address is never kept as src).
  assert.deepEqual(cleanDoc(ed1(row({type: 'image', attrs: {src: 'https://x.test/a.png', alt: '바깥'}}, pic('b')))).doc.content,
    [row({type: 'image', attrs: {src: null, alt: '바깥'}}, pic('b'))]);
  assert.equal(isEmptyDoc(ed1(row(pic('a'), pic('b')))), false);
});

test('file: our own drive id only, the name as one line (200 letters), a size only when it is a whole positive number', () => {
  const clean = attrs => cleanDoc(ed1({type: 'file', attrs})).doc.content[0];
  assert.deepEqual(clean({src: 'drive:abc_1-2', name: '회의 자료.pdf', size: 2048}), {type: 'file', attrs: {src: 'drive:abc_1-2', name: '회의 자료.pdf', size: 2048}});
  assert.deepEqual(clean({src: 'https://evil.test/x', name: 'a\nb\tc', size: -1}), {type: 'file', attrs: {src: null, name: 'a b c'}});
  assert.deepEqual(clean({src: 'share:abc', name: 'x', size: 1.5}), {type: 'file', attrs: {src: null, name: 'x'}});
  assert.equal(clean({src: 'drive:a', name: '가'.repeat(300)}).attrs.name.length, 200);
  assert.deepEqual(clean({src: 'drive:a', name: 'x', size: '10'}).attrs, {src: 'drive:a', name: 'x'});
  // A file card inside a list item or a quote is kept too (it is a block like a photo).
  const quote = cleanDoc(ed1({type: 'blockquote', content: [{type: 'file', attrs: {src: 'drive:q', name: 'q'}}]})).doc.content[0];
  assert.deepEqual(quote.content[0], {type: 'file', attrs: {src: 'drive:q', name: 'q'}});
});

test('fileHref opens only a drive: id as its Drive page; fileSizeText reads like the attachment cards', () => {
  assert.equal(fileHref('drive:abc_1-2'), 'https://drive.google.com/file/d/abc_1-2/view');
  for (const bad of ['share:abc', 'drive:', 'drive:a/b', 'javascript:alert(1)', null, 3]) assert.equal(fileHref(bad), '', String(bad));
  assert.equal(fileSizeText(0), '');
  assert.equal(fileSizeText(undefined), '');
  assert.equal(fileSizeText(900), '900 B');
  assert.equal(fileSizeText(2048), '2.0 KB');
  assert.equal(fileSizeText(5 * 1048576), '5.0 MB');
  assert.equal(fileSizeText(3 * 1073741824), '3.0 GB');
});

test('letters: a row is its photos one line each, a file is "[파일: 이름 (크기)]" (search·AI·copies·markdown)', () => {
  const doc = ed1(para('앞'), row(pic('a', '첫'), pic('b')), {type: 'file', attrs: {src: 'drive:f', name: '자료.hwp', size: 1536}}, para('뒤'));
  assert.equal(toPlain(doc), '앞\n\n[사진: 첫]\n[사진]\n\n[파일: 자료.hwp (1.5 KB)]\n\n뒤');
  assert.match(toTelegram(doc), /\[사진: 첫\]\n\[사진\]/);
  const hangul = toHangul(doc);
  assert.match(hangul.text, /\[파일: 자료\.hwp \(1\.5 KB\)\]/);
  assert.match(hangul.html, /\[사진: 첫\] \[사진\]/);
  assert.match(hangul.html, /\[파일: 자료\.hwp \(1\.5 KB\)\]/);
  const md = docToMarkdown(doc);
  assert.ok(md.includes('\\[사진: 첫\\]\n\\[사진\\]'), md);
  assert.ok(md.includes('\\[파일: 자료.hwp\\]'), md);
});

test('ed_more: a server screen setting (참·거짓), not kept on the device', () => {
  assert.ok(KEYS.includes('ed_more'));
  assert.equal(validValue('ed_more', true), true);
  assert.equal(validValue('ed_more', false), true);
  for (const v of ['true', 1, null, [true], {on: true}]) assert.equal(validValue('ed_more', v), false, JSON.stringify(v));
  const ed = readFileSync(new URL('../app/ed-editor.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ed, /localStorage|sessionStorage|indexedDB/);
  assert.match(ed, /viewPrefs\.set\('ed_more', moreOn, \{rejectable: true\}\)/);
});

test('[파일] and [사진] appear only where the opener gives them; notes give both through the note attachments upload', () => {
  const ed = readFileSync(new URL('../app/ed-editor.js', import.meta.url), 'utf8');
  assert.match(ed, /if \(key === 'file' && !files\) continue;/);
  assert.match(ed, /if \(key === 'photo' && !photos\) continue;/);
  const notes = readFileSync(new URL('../app/basket-notes.js', import.meta.url), 'utf8');
  assert.match(notes, /mountEditField\(host, selected, \{photos:photosFor\(id\), files:filesFor\(id\)\}\)/);
  assert.match(notes, /const filesFor = id => noteFiles\(\{getNote:\(\) => selected\?\.id === id \? selected : null, upload:noteUpload\(id\)\}\)/);
  // Share pages get no [파일] yet (their files would need the page's own private storage).
  const share = readFileSync(new URL('../app/share-pages.js', import.meta.url), 'utf8');
  assert.doesNotMatch(share, /files:/);
});
