// WEEKLY-환류입력창 ②: 줄 옆 '이렇게 바꾸면?'의 화면 없는 부분(app/weekly-line-suggest.mjs). 가짜 글만 쓴다.
// 서버 쪽(규칙·고침 기록이 재료로 들어감, 이번 주 행은 읽지 않음)은 tests/security/ai-assist-weekly-learn.test.mjs 가 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {caretLine, askTargets, lineRequest, readAnswer, replaceLine, suggestKey, LINE_ASK_MAX, BODY_BYTES, PER_OPEN, PICK_MS, PAUSE_MS} from '../app/weekly-line-suggest.mjs';

const CELL = 'summary\u0000가›가-1\u00000';
test('커서 줄', () => {
  const v = '- 첫 줄\n- 둘째 줄\n- 셋째';
  assert.deepEqual(caretLine(v, 0), {index:0, text:'- 첫 줄'});
  assert.deepEqual(caretLine(v, v.indexOf('둘째')), {index:1, text:'- 둘째 줄'});
  assert.deepEqual(caretLine(v, v.length), {index:2, text:'- 셋째'});
  assert.deepEqual(caretLine('', 5), {index:0, text:''});
});
test('물을 줄: 고른 칸 줄만, 커서 줄 먼저, 짧은 줄·받은 줄·같은 줄은 빼고 8줄까지', () => {
  const lines = ['- 가상 줄 하나', '- ', '- 가상 줄 둘', '- 가상 줄 하나', ...Array.from({length:12}, (_, i) => `- 가상 줄 ${i + 3}번`)];
  const known = new Map([[suggestKey(CELL, '- 가상 줄 둘'), null]]);
  const t = askTargets(lines, 2, known, CELL);
  assert.equal(t[0], 0, '커서 줄(이미 받음)은 빼고 다음부터');
  assert.ok(!t.includes(1) && !t.includes(2) && !t.includes(3));
  assert.equal(t.length, LINE_ASK_MAX);
  assert.deepEqual(askTargets(lines, 4, new Map(), CELL)[0], 4);
});
test('요청 몸통: 그 칸 지금 줄·그 칸 옆 기록만(개인본·다른 칸·이름 없음), 참조 l1~, 크기 상한', () => {
  const lines = ['- 가상 교섭 <진행>', '- 가상 행사'];
  const {request, refs} = lineRequest({week:'2026-10-26', where:'요약 · 가 › 가-1', lines, targets:[1, 0], material:['10/28 가상 교섭 결렬']});
  assert.deepEqual(Object.keys(request).sort(), ['cell', 'kind', 'lines', 'material', 'week_start', 'where']);
  assert.equal(request.kind, 'weekly_line');
  assert.deepEqual(request.lines, [{ref:'l1', text:'- 가상 행사'}, {ref:'l2', text:'- 가상 교섭 진행'}]);
  assert.deepEqual(request.cell, ['- 가상 교섭 진행', '- 가상 행사']);
  assert.deepEqual([...refs], [['l1', 1], ['l2', 0]]);
  const big = lineRequest({week:'2026-10-26', where:'칸', lines:Array(20).fill('가'.repeat(300)), targets:[0], material:Array(20).fill('나'.repeat(400))});
  assert.ok(new TextEncoder().encode(JSON.stringify(big.request)).length <= BODY_BYTES);
  assert.equal(big.request.lines.length, 1);
});
test('답 읽기: 같은 줄·빈 답은 제안 없음(null), 모르는 참조 버림, 물은 줄은 모두 기억', () => {
  const lines = ['- 가상 하나', '- 가상 둘', '- 가상 셋'];
  const refs = new Map([['l1', 0], ['l2', 1], ['l3', 2]]);
  const m = readAnswer({lines:[{ref:'l1', text:'- 가상 하나(10.28.)'}, {ref:'l2', text:' - 가상  둘 '}, {ref:'l9', text:'x'}]}, refs, lines, CELL);
  assert.equal(m.get(suggestKey(CELL, '- 가상 하나')), '- 가상 하나(10.28.)');
  assert.equal(m.get(suggestKey(CELL, '- 가상 둘')), null);
  assert.equal(m.get(suggestKey(CELL, '- 가상 셋')), null);
  assert.equal(m.size, 3);
});
test('줄 바꾸기·되돌리기: 그 줄만, 그새 바뀐 줄은 건드리지 않음', () => {
  const v = '- 가상 하나\n- 가상 둘';
  const next = replaceLine(v, 1, '- 가상 둘', '- 가상 둘(완료)');
  assert.equal(next, '- 가상 하나\n- 가상 둘(완료)');
  assert.equal(replaceLine(next, 1, '- 가상 둘(완료)', '- 가상 둘'), v);
  assert.equal(replaceLine(v, 1, '- 다른 줄', 'x'), null);
  assert.equal(replaceLine(v, 5, '- 가상 둘', 'x'), null);
});
test('묻는 때·횟수: 고를 때·멈출 때만, 상자 한 번에 12번까지', () => {
  assert.ok(PICK_MS >= 500 && PAUSE_MS >= 1000 && PAUSE_MS > PICK_MS);
  assert.equal(PER_OPEN, 12);
});
