// 공유 페이지 링크 이름표: 비워도 되고(누구에게 준 링크인지 구분하는 용도일 뿐), 길이·제어문자만 막는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {labelProblem, LIMITS, linkState} from '../app/share-pages-model.mjs';

test('빈 이름표는 허용한다', () => {
  for (const v of ['', '   ', null, undefined]) assert.equal(labelProblem(v), '');
});
test('이름표 길이·제어문자는 계속 막는다', () => {
  assert.equal(labelProblem('○○지부'), '');
  assert.match(labelProblem('가'.repeat(LIMITS.label + 1)), /자까지/);
  assert.match(labelProblem('a\u0007b'), /쓸 수 없는/);
});
test('링크 상태 계산은 남는다(노트 게시가 쓴다)', () => {
  assert.equal(typeof linkState, 'function');
});
