import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {shareTarget, linksIn, withoutLinks, noteDraft, noteBodyWithExtra, taskDraft, taskNotesWithExtra, folderOptions, NOTE_TITLE_MAX, TASK_NOTES_MAX} from '../app/share-target-model.mjs';
import {parseShareList} from '../app/share-intake-model.mjs';

const ID = 'AbCdEfGhIjKlMnOpQrStUv';

test('공유 목록의 들어갈 곳: 노트·할 일만, 나머지는 정리함', () => {
  assert.equal(parseShareList({id:ID, items:[], target:'note'}).target, 'note');
  assert.equal(parseShareList({id:ID, items:[], target:'task'}).target, 'task');
  assert.equal(parseShareList({id:ID, items:[]}).target, 'basket');
  assert.equal(parseShareList({id:ID, items:[], target:'<x>'}).target, 'basket');
  assert.equal(shareTarget('note'), 'note');
  assert.equal(shareTarget('trash'), 'basket');
});

test('링크 찾기·빼기', () => {
  assert.deepEqual(linksIn('보기 https://a.kr/x). 그리고 http://b.kr/y https://a.kr/x'), ['https://a.kr/x', 'http://b.kr/y']);
  assert.equal(withoutLinks('제목 https://a.kr/x\n\n\n\n둘째'), '제목\n\n둘째');
});

test('노트 초안: 링크 공유는 링크 제목, 글은 첫 줄, 파일만이면 파일 이름', () => {
  assert.deepEqual(noteDraft({subject:'기사 제목', text:'https://ex.com/a'}), {title:'기사 제목', body:'https://ex.com/a'});
  assert.deepEqual(noteDraft({text:'  첫 줄\r\n둘째'}), {title:'첫 줄', body:'첫 줄\n둘째'});
  assert.deepEqual(noteDraft({files:[{name:'회의 사진.jpg'}]}), {title:'회의 사진', body:''});
  assert.equal(noteDraft({}).title, '공유한 노트');
  assert.equal([...noteDraft({text:'가'.repeat(500)}).title].length, NOTE_TITLE_MAX);
  assert.equal(noteBodyWithExtra('본문', ' 메모\n한 줄 '), '메모 한 줄\n\n본문');
  assert.equal(noteBodyWithExtra('', '메모'), '메모');
  assert.equal(noteBodyWithExtra('본문', '  '), '본문');
});

test('할 일 초안: 제목은 링크 뺀 첫 줄, 링크는 메모로', () => {
  assert.deepEqual(taskDraft({subject:'기사 제목', text:'이거 읽기 https://ex.com/a\n메모줄'}), {title:'이거 읽기', notes:'기사 제목\n메모줄\nhttps://ex.com/a'});
  assert.deepEqual(taskDraft({subject:'기사 제목', text:'https://ex.com/a'}), {title:'기사 제목', notes:'https://ex.com/a'});
  assert.deepEqual(taskDraft({text:'https://ex.com/a'}), {title:'https://ex.com/a', notes:'https://ex.com/a'});
  assert.deepEqual(taskDraft({files:[{name:'영수증.pdf'}]}), {title:'영수증', notes:''});
  assert.equal(taskNotesWithExtra('https://ex.com', '먼저 볼 것'), '먼저 볼 것\nhttps://ex.com');
  assert.ok([...taskNotesWithExtra('가'.repeat(9000), '')].length <= TASK_NOTES_MAX);
});

test('노트 폴더 고르기 줄: 나무 순서·깊이, 고리·주인 없는 폴더도 빠지지 않음', () => {
  assert.deepEqual(folderOptions([{id:'b', name:'B', parent_id:'a'}, {id:'a', name:' A '}, {id:'c', name:'C', parent_id:'zz'}, {id:'d', name:''}, {id:'e', name:'E', parent_id:'e'}]),
    [{id:'a', name:'A', depth:0}, {id:'b', name:'B', depth:1}, {id:'c', name:'C', depth:0}, {id:'e', name:'E', depth:0}]);
  assert.deepEqual(folderOptions(null), []);
});

test('창은 받은 글을 HTML로 넣지 않고, 노트·할 일 화면과 같은 서버 길만 쓴다', () => {
  const src = readFileSync(new URL('../app/share-target.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src.replace(/dialog\.innerHTML = `[\s\S]*?`;/, ''), /innerHTML|insertAdjacentHTML/);
  for (const use of ['createNoteDoc', 'setNoteFolderRef', 'uploadNoteFiles', 'createGoogleTask', 'attachNewTaskFiles']) assert.match(src, new RegExp(use));
  const basket = readFileSync(new URL('../app/basket-share.js', import.meta.url), 'utf8');
  assert.match(basket, /list\.target === 'note' \|\| list\.target === 'task'/);
});
