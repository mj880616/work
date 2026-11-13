import test from 'node:test';
import assert from 'node:assert/strict';
import { droppedTitle } from '../app/note-file-drop.js';

// NOTE-목록에파일놓기: 목록에 놓은 파일로 연 새 노트 창의 제목 칸 첫 값 = 첫 파일 이름에서 확장자를 뺀 것.
test('droppedTitle: 첫 파일 이름, 마지막 확장자만 뺀다', () => {
  assert.equal(droppedTitle([{name: '교섭 요구안.pdf'}, {name: '다른.hwp'}]), '교섭 요구안');
  assert.equal(droppedTitle([{name: '회의록 v1.2 최종.hwpx'}]), '회의록 v1.2 최종');
  assert.equal(droppedTitle([{name: '확장자없음'}]), '확장자없음');
  assert.equal(droppedTitle([{name: '.env'}]), '.env');
  assert.equal(droppedTitle([{name: '  줄\n바꿈.txt '}]), '줄 바꿈');
  assert.equal(droppedTitle([]), '');
  assert.equal([...droppedTitle([{name: 'ㄱ'.repeat(300) + '.pdf'}])].length, 200);
});
