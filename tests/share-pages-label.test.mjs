// 공유 페이지 링크 이름표: 비워도 되고(누구에게 준 링크인지 구분하는 용도일 뿐), 길이·제어문자만 막는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {labelProblem, LIMITS, linkState} from '../app/share-pages-model.mjs';

test('빈 이름표는 허용한다', () => {
  for (const v of ['', '   ', null, undefined]) assert.equal(labelProblem(v), '');
});
test('이름표 길이·제어문자는 계속 막는다', () => {
  assert.equal(labelProblem('○○지부'), '');
  assert.match(labelProblem('가'.repeat(LIMITS.label + 1)), /자까지/);
  assert.match(labelProblem('a\u0007b'), /쓸 수 없는/);
});
test('목록은 빈 이름표를 "이름표 없음"으로 보이고, 화면에 막는 문구가 없다', async () => {
  const js = await readFile(new URL('../app/share-pages.js', import.meta.url), 'utf8');
  assert.match(js, /link\.label \|\| '이름표 없음'/);
  assert.match(js, /비워도 돼요 · 링크를 가진 누구나 봐요/);
  assert.doesNotMatch(js, /이름표를 입력/);
  assert.equal(typeof linkState, 'function');
});
