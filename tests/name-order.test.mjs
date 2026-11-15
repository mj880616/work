// NEWS-출처목록가나다: 이름 목록 화면 순서의 공용 정렬 함수(app/name-order.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {compareName, sortByName} from '../app/name-order.mjs';

test('가나다: 한글 가나다, 영어 ABC(대소문자 무시), 숫자는 크기대로 맨 앞', () => {
  const names = ['플랫폼C', 'Socialist Worker', '사회진보연대', 'jacobin', '전국결집', '사회주의자', '10노조', '노동자연대', 'Labor Notes', '사회주의를향한전진', '2노조', 'Red Pepper'];
  assert.deepEqual(sortByName(names, n => n), ['2노조', '10노조', '노동자연대', '사회주의를향한전진', '사회주의자', '사회진보연대', '전국결집', '플랫폼C', 'jacobin', 'Labor Notes', 'Red Pepper', 'Socialist Worker']);
});

test('요청함 예시 그대로: 노동조합·정당 묶음', () => {
  const rows = names => names.map((name, i) => ({key: 'k' + i, name}));
  assert.deepEqual(sortByName(rows(['공공운수노조', '금속노조', '서비스연맹', '학비노조'])).map(r => r.name), ['공공운수노조', '금속노조', '서비스연맹', '학비노조']);
  assert.deepEqual(sortByName(rows(['노동당', '녹색당', '진보당', '정의당'])).map(r => r.name), ['노동당', '녹색당', '정의당', '진보당']);
});

test('원본은 그대로, 같은 이름은 key 순서, 빈 값·이상한 입력도 깨지지 않음', () => {
  const list = [{key: 'b', name: '같음'}, {key: 'a', name: '같음'}, {key: 'c', name: '가'}];
  const out = sortByName(list);
  assert.deepEqual(out.map(r => r.key), ['c', 'a', 'b']);
  assert.deepEqual(list.map(r => r.key), ['b', 'a', 'c']);
  assert.deepEqual(sortByName(null), []);
  assert.deepEqual(sortByName([{name: null, key: 'x'}, {name: '가', key: 'y'}]).map(r => r.key), ['x', 'y']);
  assert.equal(compareName('가', '나'), -1);
  assert.equal(compareName('B', 'a'), 1);
  assert.equal(compareName(' 가 ', '가'), 0);
});
