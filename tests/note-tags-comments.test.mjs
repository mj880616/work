import test from 'node:test';
import assert from 'node:assert/strict';
import {noteTags, tagGroups, noteHasTag, tagKey} from '../app/note-tags.mjs';
import {COMMENT_KINDS, kindName, quoteFromSelection, commentDraft, commentRows, commentsOf, commentText} from '../app/note-comments.mjs';

// NOTE-읽생기아이디어 1단계: 해시태그 읽기(따로 저장 없음)와 댓글 계산. 이름·글은 지어낸 것.
test('hashtags: #word at line start or after a space/bracket; headings, ##, url anchors and numbers are not tags', () => {
  assert.deepEqual(noteTags('#읽기 오늘 글\n본문 #생각정리, (#질문) "#인용"'), ['읽기', '생각정리', '질문', '인용']);
  assert.deepEqual(noteTags('# 제목\n## 소제목\n###\nhttps://a.example/p#part 와 page#x'), []);
  assert.deepEqual(noteTags('#1755 #2026 #a1 #_x'), ['a1', '_x']);
  assert.deepEqual(noteTags('#Book #book #BOOK'), ['Book'], '대소문자는 하나로, 처음 모양');
  assert.deepEqual(noteTags('#끝- #a_b-c'), ['끝', 'a_b-c']);
  assert.equal(noteTags('#' + '가'.repeat(41)).length, 0, '41자는 태그 아님');
  assert.deepEqual(noteTags('#' + '가'.repeat(40)), ['가'.repeat(40)]);
  assert.deepEqual(noteTags(null), []);
});

test('tag groups: count per tag (one per note), most used first then by name; filter by key', () => {
  const notes = [
    {id: 'a', title: '가 #읽기', raw_text: '#읽기 #생각'},
    {id: 'b', title: '나', raw_text: '본문 #생각'},
    {id: 'c', title: '다', raw_text: '#가나다 #생각'},
  ];
  assert.deepEqual(tagGroups(notes).map(g => [g.tag, g.count]), [['생각', 3], ['가나다', 1], ['읽기', 1]]);
  assert.equal(noteHasTag(notes[0], tagKey('읽기')), true);
  assert.equal(noteHasTag(notes[1], tagKey('읽기')), false);
});

test('comment kinds and drafts: three kinds, trimmed quote only for quote kind, limits', () => {
  assert.deepEqual(COMMENT_KINDS.map(k => k.name), ['생각', '질문', '인용']);
  assert.equal(kindName('question'), '질문');
  assert.equal(quoteFromSelection('  첫 줄\n\n 둘째   줄 '), '첫 줄 둘째 줄');
  assert.equal(quoteFromSelection('   '), null);
  assert.equal([...quoteFromSelection('가'.repeat(1200))].length, 1000);
  assert.deepEqual(commentDraft({kind: 'quote', quote: ' 문장 ', body: '내 생각'}), {kind: 'quote', quote: '문장', body: '내 생각'});
  assert.deepEqual(commentDraft({kind: 'thought', quote: '문장', body: '줄\r\n바꿈'}), {kind: 'thought', quote: null, body: '줄\n바꿈'});
  assert.equal(commentDraft({kind: 'nope', body: '가'}).kind, 'thought');
  assert.throws(() => commentDraft({kind: 'thought', body: '  '}), /댓글을 써 주세요/);
  assert.throws(() => commentDraft({kind: 'thought', body: '가'.repeat(4001)}), /4000자/);
});

test('comment rows: by kind and query (body, quote, note title), newest first, hidden notes left out; per-note order', () => {
  const notes = new Map([['n1', {id: 'n1', title: '책 노트'}], ['n2', {id: 'n2', title: '회의 노트'}]]);
  const cs = [
    {id: '1', note_id: 'n1', kind: 'thought', body: '좋은 문장', quote: null, created_at: '2026-11-01T01:00:00Z'},
    {id: '2', note_id: 'n2', kind: 'question', body: '왜?', quote: null, created_at: '2026-11-02T01:00:00Z'},
    {id: '3', note_id: 'n1', kind: 'quote', body: '밑줄', quote: '바다는 넓다', created_at: '2026-11-01T02:00:00Z'},
    {id: '4', note_id: 'gone', kind: 'thought', body: '휴지통 노트', quote: null, created_at: '2026-11-03T01:00:00Z'},
  ];
  const noteById = id => notes.get(id);
  assert.deepEqual(commentRows(cs, {noteById}).map(c => c.id), ['2', '3', '1']);
  assert.deepEqual(commentRows(cs, {kind: 'quote', noteById}).map(c => c.id), ['3']);
  assert.deepEqual(commentRows(cs, {query: '바다', noteById}).map(c => c.id), ['3']);
  assert.deepEqual(commentRows(cs, {query: '회의', noteById}).map(c => c.id), ['2']);
  assert.deepEqual(commentsOf(cs, 'n1').map(c => c.id), ['1', '3']);
  assert.match(commentText(cs, 'n1'), /바다는 넓다/);
});
