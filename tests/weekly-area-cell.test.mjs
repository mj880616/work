// WEEKLY-화면정돈 ② 0순위: 2. 1) 묶음 표 한 칸 줄 목록(app/weekly-area-cell.mjs). 이름·글은 합성 값.
import test from 'node:test';
import assert from 'node:assert/strict';
import {areaCellParts, cellLines, cellText, splitCellText} from '../app/weekly-area-cell.mjs';

const parts = areaCellParts({own: {space: 'a', body: '- 가상 연구 착수\n가상 자기 줄'}, subs: [{space: 's1', name: '가상 세부 1', body: '-가상 연구 착수'}, {space: 's2', name: '가상 세부 2', body: ''}]});

test('자기 칸과 세부 과제 칸에 같은 줄이 있으면 세부 과제 아래 한 번만 보인다', () => {
  assert.deepEqual(parts.own.lines, ['가상 자기 줄']);
  assert.equal(parts.own.hidden, 1);
  assert.deepEqual(cellLines(parts), ['가상 자기 줄', '◦ 가상 세부 1', '-가상 연구 착수']);
});

test('글상자 글 = 보이는 줄 그대로, 저장하면 ◦ 줄로 칸마다 다시 나눈다', () => {
  assert.equal(cellText(parts), '가상 자기 줄\n◦ 가상 세부 1\n-가상 연구 착수');
  const {bodies, unknown} = splitCellText('가상 자기 줄 고침\n◦ 가상세부 1\n- 새 줄\n◦ 가상 세부 2\n- 둘째 칸 새 줄', parts);
  assert.deepEqual(Object.fromEntries(bodies), {a: '가상 자기 줄 고침', s1: '- 새 줄', s2: '- 둘째 칸 새 줄'});
  assert.deepEqual(unknown, []);
});

test('글상자에서 지운 칸은 빈 글이 되어 중복 줄을 지울 수 있다', () => {
  const {bodies} = splitCellText('◦ 가상 세부 1\n-가상 연구 착수', parts);
  // 자기 칸에 숨어 있던 같은 줄도 저장하면 빠진다(보이는 대로 저장).
  assert.deepEqual(Object.fromEntries(bodies), {a: '', s1: '-가상 연구 착수', s2: ''});
  assert.deepEqual(Object.fromEntries(splitCellText('', parts).bodies), {a: '', s1: '', s2: ''});
});

test('이름이 맞는 세부 과제가 없는 ◦ 줄은 자기 칸에 글 그대로 두고 확인 필요로 알린다', () => {
  const {bodies, unknown} = splitCellText('◦ 없는 이름\n- 글', parts);
  assert.equal(bodies.get('a'), '◦ 없는 이름\n- 글');
  assert.deepEqual(unknown, ['없는 이름']);
});
