import test from 'node:test';
import assert from 'node:assert/strict';
// S48-3b: 칸별 그대로 쓴 비율(서버 actionDigest 와 같은 셈), AI 재료 날짜·상태, 한 줄 [빼기] 메모리, 개선 제안 두 줄 읽기·쉬운 꼬리표.
import {cellKeptRates, withPick, pickGroup} from '../app/weekly-picks.mjs';
import {materialLine, materialState} from '../app/weekly-ai-material.mjs';
import {keepLines, markUserDrop, clearUserDrops, workLinePick} from '../app/work-scope-model.mjs';
import {readReview, SUGGESTION_AREA} from '../app/weekly-feedback.mjs';

const AT = i => `2026-10-29T0${i}:00:00.000Z`;
test('cellKeptRates: 묶음마다 넣음/(넣음+고쳐서+뺌), 줄 동작·규칙 후보·개선 제안은 셈 밖, 보고서 순서', () => {
  let p = null;
  p = withPick(p, {kind:'material', from:'record', cell:'summary:1', text:'가'}, 'take', AT(1));
  p = withPick(p, {kind:'material', from:'record', cell:'summary:1', text:'나'}, 'drop', AT(2));
  p = withPick(p, {kind:'material', from:'record', cell:'summary:2', text:'다'}, 'take', AT(3));
  p = withPick(p, {kind:'calendar', from:'calendar', cell:'orgref:o1', text:'라'}, 'edit', AT(4));
  p = withPick(p, {kind:'line', from:'hand', cell:'summary:1', text:'마'}, 'cut', AT(5));
  p = withPick(p, {kind:'review', from:'ai', cell:'개선 제안', text:'바'}, 'take', AT(6));
  p = withPick(p, workLinePick('2026-10-27', '가상 동호회'), 'drop', AT(7));
  assert.deepEqual(cellKeptRates(p), [{group:'2. 사업 요약', percent:67, answered:3}, {group:'4. 산하 조직', percent:0, answered:1}, {group:'참고', percent:0, answered:1}]);
  assert.equal(pickGroup({cell:'notes:lines:2026-10-27'}), '참고');
  assert.deepEqual(cellKeptRates(null), []);
});

test('materialLine: 보고일 기준 끝남·오늘·예정, 날짜 없는 줄·이미 만든 AI 글은 그대로', () => {
  const d = day => day.slice(5).replace('-', '.');
  assert.equal(materialLine({day:'2026-10-27', text:'가상 교섭'}, '2026-10-30', d), '10.27 [끝남] 가상 교섭');
  assert.equal(materialLine({day:'2026-10-30', text:'가상 회의'}, '2026-10-30', d), '10.30 [오늘] 가상 회의');
  assert.equal(materialLine({day:'2026-11-02', text:'가상 집회'}, '2026-10-30', d), '11.02 [예정] 가상 집회');
  assert.equal(materialLine({day:'', text:'가상 줄'}, '2026-10-30', d), '가상 줄');
  assert.equal(materialLine({day:'2026-10-27', text:'x', ai:'가상 달력 참고'}, '2026-10-30', d), '가상 달력 참고');
  assert.equal(materialState('bad', '2026-10-30'), '');
});

test('한 줄 [빼기]: keepLines 가 사람이 뺀 줄도 빼고, 되돌리면 다시', () => {
  clearUserDrops();
  const lines = new Map([['2026-10-27', {raw_text:'가상 교섭\n가상 동호회'}]]);
  markUserDrop('2026-10-27', '가상 동호회');
  assert.equal(keepLines(lines, new Set()).get('2026-10-27').raw_text, '가상 교섭');
  markUserDrop('2026-10-27', '가상 동호회', false);
  assert.equal(keepLines(lines, new Set()).get('2026-10-27').raw_text, '가상 교섭\n가상 동호회');
  assert.deepEqual(workLinePick('2026-10-27', ' 가상 동호회 '), {kind:'work_line', from:'record', cell:'notes:lines:2026-10-27', org:'', text:'가상 동호회'});
});

test('개선 제안: how(어떻게) 줄을 읽고, 꼬리표는 쉬운 말', () => {
  const r = readReview({at:AT(1), candidates:[], suggestions:[{id:'s1', area:'material', text:'끝난 일을 또 쓰는 일이 줄어요', how:'AI에게 날짜와 예정/끝남을 같이 주기'}, {id:'s2', area:'flow', text:'옛 제안'}]});
  assert.equal(r.suggestions[0].how, 'AI에게 날짜와 예정/끝남을 같이 주기');
  assert.equal(r.suggestions[1].how, undefined);
  assert.deepEqual(SUGGESTION_AREA, {input:'입력 화면', material:'AI 자료', flow:'일 순서'});
});
