import test from 'node:test';
import assert from 'node:assert/strict';
import {noteTags, tagGroups, noteHasTag, tagKey} from '../app/note-tags.mjs';

// NOTE-읽생기아이디어 1단계: 해시태그 읽기(따로 저장 없음). 이름·글은 지어낸 것. 옛 댓글 계산은 S69-94에서 메모(tests/memo-model.test.mjs)로 옮겼다.
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
