import test from 'node:test';
import assert from 'node:assert/strict';
import {addTagToDoc, removeTagFromDoc, removeTagFromTitle, cleanTagInput, isTagLine, tagsOfNote, tagKey} from '../app/note-tags.mjs';
import {cleanDoc} from '../app/ed-schema.mjs';
import {toPlain} from '../app/ed-text.mjs';

// S67-48 태그 칸: 칸에서 붙이고 빼도 원본은 본문 #태그 하나. 글은 지어낸 것.
const p = (...parts) => ({type: 'paragraph', attrs: {style: 'body2'}, content: parts.map(t => typeof t === 'string' ? {type: 'text', text: t} : t)});
const doc = (...blocks) => cleanDoc({type: 'doc', content: blocks});
const text = value => toPlain(cleanDoc(value));

test('tag input: leading # dropped, spaces become _, needs a letter, 40 chars, symbols only _ -', () => {
  assert.equal(cleanTagInput(' #교섭 '), '교섭');
  assert.equal(cleanTagInput('##공항 철도'), '공항_철도');
  assert.equal(cleanTagInput('Book-'), 'Book');
  assert.equal(cleanTagInput('2026'), null);
  assert.equal(cleanTagInput('a!b'), null);
  assert.equal(cleanTagInput(''), null);
  assert.equal(cleanTagInput('가'.repeat(40)), '가'.repeat(40));
  assert.equal(cleanTagInput('가'.repeat(41)), null);
});

test('add: goes on the tag line at the end (made when missing), two tags in a row, same tag (any case) is not added twice', () => {
  let d = doc(p('본문 #생각 중간'), p('끝'));
  d = addTagToDoc(d, '교섭');
  assert.equal(text(d), '본문 #생각 중간\n\n끝\n\n#교섭');
  d = addTagToDoc(d, '공항철도');
  assert.equal(text(d), '본문 #생각 중간\n\n끝\n\n#교섭 #공항철도', '두 번째는 같은 태그 줄에');
  assert.equal(addTagToDoc(d, '교섭'), null);
  assert.equal(addTagToDoc(d, '생각'), null, '본문 중간에 이미 있음');
  assert.equal(addTagToDoc(doc(p('#Book 읽기')), 'book'), null, '대소문자는 같은 태그');
  assert.equal(isTagLine(cleanDoc(d).doc.content.at(-1)), true);
  assert.equal(isTagLine(p('#교섭 오늘')), false);
  // 빈 끝 줄은 건너뛰고, 서식 있는 끝 조각 뒤에는 서식 없이 붙는다.
  const marked = doc(p({type: 'text', text: '#굵게', marks: [{type: 'strong'}]}), p(''));
  const out = cleanDoc(addTagToDoc(marked, '더함')).doc.content;
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].content.map(c => [c.text, !!c.marks]), [['#굵게', true], [' #더함', false]]);
  assert.equal(text(addTagToDoc(null, '처음')), '#처음', '빈 노트');
});

test('remove: every place (middle of the text too), any case, keeps other words; a tag-only line goes away', () => {
  const d = doc(p('회의 #교섭 정리, #Book'), p('#교섭 #공항철도'), {type: 'bullet_list', content: [{type: 'list_item', content: [p('항목 #교섭')]}]});
  const out = removeTagFromDoc(d, tagKey('교섭'));
  assert.equal(text(out), '회의 정리, #Book\n\n#공항철도\n\n- 항목');
  assert.deepEqual(tagsOfNote({title: '', raw_text: text(out)}), ['Book', '공항철도']);
  const out2 = removeTagFromDoc(out, tagKey('공항철도'));
  assert.equal(text(out2), '회의 정리, #Book\n\n- 항목', '태그만 있던 줄은 없어짐');
  assert.equal(text(removeTagFromDoc(out2, 'book')), '회의 정리,\n\n- 항목');
  assert.equal(removeTagFromDoc(out2, tagKey('없음')), null, '없는 태그는 바꾸지 않음');
  assert.equal(text(removeTagFromDoc(doc(p('#교섭')), '교섭')), '', '태그만 있던 노트는 빈 글');
  // 비슷한 낱말(#교섭안)·주소 속 #·# 제목은 건드리지 않는다.
  assert.equal(text(removeTagFromDoc(doc(p('#교섭안 #교섭 https://a.example/p#교섭')), '교섭')), '#교섭안 https://a.example/p#교섭');
});

test('old letters notes (lines are breaks inside one paragraph): last line is the tag line, a removed last line leaves no break', () => {
  const br = {type: 'hard_break'};
  let d = doc(p('본문 중간 #교섭 이야기', br, '#현장'));
  d = removeTagFromDoc(d, '교섭');
  assert.equal(text(d), '본문 중간 이야기\n#현장');
  d = addTagToDoc(d, '공항철도');
  assert.equal(text(d), '본문 중간 이야기\n#현장 #공항철도');
  d = removeTagFromDoc(removeTagFromDoc(d, '현장'), '공항철도');
  assert.equal(text(d), '본문 중간 이야기');
});

test('remove keeps marks on the words around it', () => {
  const d = doc(p({type: 'text', text: '중요', marks: [{type: 'strong'}]}, ' #교섭 끝'));
  const out = cleanDoc(removeTagFromDoc(d, '교섭')).doc.content[0].content;
  assert.deepEqual(out.map(c => [c.text, !!c.marks]), [['중요', true], [' 끝', false]]);
});

test('title: the tag is taken out of the title too', () => {
  assert.equal(removeTagFromTitle('회의 #Book 메모', 'book'), '회의 메모');
  assert.equal(removeTagFromTitle('제목', 'book'), '제목');
  assert.equal(removeTagFromTitle('#교섭', '교섭'), '');
});
