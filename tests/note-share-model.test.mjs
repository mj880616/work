// S71-69 SHARE-글공유 ②: 노트 [공유] — 글만 있는 노트 판정·보낼 글·고르기 칸.
import test from 'node:test';
import assert from 'node:assert/strict';
import {noteIsPlain, docIsPlain, noteShareText, noteShareChoices, noteFileName, NOTE_SHARE_CHOICES} from '../app/note-share-model.mjs';

const doc = content => ({v: 'ed1', doc: {type: 'doc', content}});
const p = (...content) => ({type: 'paragraph', attrs: {style: 'body2'}, content});
const t = (text, marks) => (marks ? {type: 'text', text, marks} : {type: 'text', text});

test('편집기 문서: 문단·글자·줄바꿈만이면 글만', () => {
  assert.equal(docIsPlain(doc([p(t('첫 줄'), {type: 'hard_break'}, t('둘째 줄')), p(t('다음 문단'))])), true);
  assert.equal(docIsPlain(doc([{type: 'paragraph', attrs: {style: 'body1'}, content: [t('큰 글자 본문')]}])), true, '본문 글자 크기는 상관없음');
  assert.equal(docIsPlain(doc([p(t('https://a.example.org/x', [{type: 'link', attrs: {href: 'https://a.example.org/x'}}]))])), true, '글자가 곧 주소인 링크');
  for (const [name, d] of [
    ['굵게', doc([p(t('굵게', [{type: 'strong'}]))])],
    ['글자 링크', doc([p(t('여기', [{type: 'link', attrs: {href: 'https://a.example.org/'}}]))])],
    ['머리글', doc([{type: 'heading', attrs: {level: 1}, content: [t('제목')]}])],
    ['표', doc([{type: 'table', content: [{type: 'table_row', content: [{type: 'table_cell', content: [p(t('칸'))]}]}]}])],
    ['체크 목록', doc([{type: 'bullet_list', attrs: {marker: 'check'}, content: [{type: 'list_item', content: [p(t('할 일'))]}]}])],
    ['사진', doc([{type: 'image', attrs: {src: 'drive:abc', alt: '사진'}}])],
    ['가운데 맞춤', doc([{type: 'paragraph', attrs: {style: 'body2', align: 'center'}, content: [t('가운데')]}])],
    ['인용', doc([{type: 'blockquote', content: [p(t('인용'))]}])],
  ]) assert.equal(docIsPlain(d), false, name);
});
test('노트: 첨부가 있거나 마크다운 표시가 있으면 고르기, 마크다운을 끈 노트·표시 없는 글은 글만', () => {
  assert.equal(noteIsPlain({title: 'a', raw_text: '그냥 글\n1) 하나\n- 둘'}), true);
  assert.equal(noteIsPlain({title: 'a', raw_text: '**굵게**'}), false);
  assert.equal(noteIsPlain({title: 'a', raw_text: '| a | b |\n|---|---|\n| 1 | 2 |'}), false);
  assert.equal(noteIsPlain({title: 'a', raw_text: '**굵게**', metadata: {markdown: false}}), true, '마크다운 끔 = 쓴 그대로');
  assert.equal(noteIsPlain({title: 'a', raw_text: '글', attachments: [{drive_file_id: 'x', mime_type: 'image/jpeg'}]}), false);
  assert.equal(noteIsPlain({title: 'a', doc: doc([p(t('글'))])}), true);
  assert.equal(noteIsPlain(null), false);
});
test('보낼 글 = 제목 + 빈 줄 + 본문', () => {
  assert.deepEqual(noteShareText({title: ' 회의  메모 ', raw_text: '첫 줄\r\n둘째 줄\n'}), {title: '회의 메모', body: '첫 줄\n둘째 줄', text: '회의 메모\n\n첫 줄\n둘째 줄'});
  assert.equal(noteShareText({title: '', doc: doc([p(t('본문만'))])}).text, '본문만');
  assert.equal(noteShareText({title: '제목만', raw_text: ''}).text, '제목만');
  assert.equal(noteShareText({title: '', raw_text: '  '}), null);
});
test('고르기 칸: [HTML 파일][PDF 파일][링크][글만 보내기], 게시할 수 없으면 링크 없음', () => {
  assert.deepEqual(NOTE_SHARE_CHOICES.map(x => x[1]), ['HTML 파일', 'PDF 파일', '링크', '글만 보내기']);
  assert.deepEqual(noteShareChoices({canLink: false}).map(x => x[0]), ['html', 'pdf', 'text']);
  assert.match(noteFileName('회의/메모', 'pdf', new Date(2026, 10, 27)), /^회의 메모 2026-11-27\.pdf$/);
  assert.match(noteFileName('', 'html', new Date(2026, 10, 27)), /^노트 2026-11-27\.html$/);
});
