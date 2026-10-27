// 요약 복사 글 만들기(app/summary-copy-model.mjs). 이름·내용은 모두 지어낸 것.
import test from 'node:test';
import assert from 'node:assert/strict';
import {summaryCopyText, pointCopyLines, callCopyText} from '../app/summary-copy-model.mjs';

test('통화: 제목(상대 · 주제)·날짜·핵심내용, 머리표는 글 뒤에', () => {
  const text = callCopyText({who:'예시지부 홍길동 위원장', title:'가상 교섭 일정 조정', dayText:'10. 6. (화)', time:'09:42', points:['일정 변경', '[확정] 요구안 유지', '[예정] 회신 기한', '[확인] 장소']});
  assert.equal(text, '예시지부 홍길동 위원장 · 가상 교섭 일정 조정\n10. 6. (화) 09:42\n\n- 일정 변경\n- 요구안 유지 [확정]\n- 회신 기한 [예정]\n- 장소 [확인]');
});

test('통화: 상대가 없으면 주제만, 제목이 없으면 (제목 없음), 날짜 조각은 있는 것만', () => {
  assert.equal(callCopyText({title:'주제', dayText:'10. 6. (화)', points:['가']}), '주제\n10. 6. (화)\n\n- 가');
  assert.equal(callCopyText({who:'가상지부', points:['가']}), '가상지부 · (제목 없음)\n\n- 가');
});

test('핵심내용이 없으면 복사할 글이 없다', () => {
  assert.equal(callCopyText({who:'가', title:'나', points:[]}), '');
  assert.equal(callCopyText({who:'가', title:'나', points:['', null, 3]}), '');
  assert.deepEqual(pointCopyLines('글'), []);
});

test('일반 요약: 제목·날짜 줄 뒤 빈 줄, 본문 빈 줄은 뺀다', () => {
  assert.equal(summaryCopyText({title:'가상지부 단톡', meta:'10. 6. (화) 09:31', body:['  교섭 다음 주 화요일  ']}), '가상지부 단톡\n10. 6. (화) 09:31\n\n교섭 다음 주 화요일');
  assert.equal(summaryCopyText({body:['한 줄', '', '두 줄']}), '한 줄\n두 줄');
  assert.equal(summaryCopyText({title:'가', body:[null]}), '');
  assert.equal(summaryCopyText(), '');
});
