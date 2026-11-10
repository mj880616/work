// WEEKLY-한흐름확정 ② 화면: [주간 정리] 칸 줄 = 그 주 draft 한 벌(proposed 위에 rows), (칸 아래 제안은 RECORD-한줄 B-5로 지움.) 글은 모두 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import {flowCells, siteCells} from '../app/weekly-flow-cells.js';
import {withCellLine} from '../app/weekly-draft-store.js';

const draft = {v:1, base:null, me:'', me_from:'', date:'', rows:[], titles:[], proposed:{at:'2026-11-01T00:00:00.000Z', base:{from:'personal', document_id:'d1'}, cells:[
  {section:'summary', key:'가 영역›가-1 과제', n:0, lines:['- 가상 교섭 3차']},
  {section:'summary', key:'나 영역›나-1 과제', n:0, lines:[]},
  {section:'orgs', key:'A 지부', n:0, lines:['- 가상 소식']},
  {section:'sites', key:'B 노조', n:0, lines:['- 가상 조정 신청']},
]}};
test('칸 목록: 바탕 순서, 섹션별, 고친 칸(rows)이 바탕 위에', () => {
  assert.deepEqual(flowCells(draft, 'summary').map(c => [c.key, c.lines]), [['가 영역›가-1 과제', ['- 가상 교섭 3차']], ['나 영역›나-1 과제', []]]);
  const next = withCellLine(draft, {section:'summary', key:'나 영역›나-1 과제', act:'add', text:'- 손으로 쓴 줄'});
  assert.deepEqual(flowCells(next, 'summary')[1].lines, ['- 손으로 쓴 줄']);
  assert.deepEqual(flowCells(next, 'sites').map(c => c.key), ['B 노조']);
});

test('줄 제안 [수용]: 그 줄만 바꾸고(칸 끝에 더하지 않음), 그새 줄이 바뀌었으면 거절', () => {
  const item = {kind:'ai_line', from:'ai', cell:'summary:가 영역›가-1 과제', org:'', text:'- 가상 교섭 3차(마무리)', before:'- 가상 교섭 3차', line:'- 가상 교섭 3차'};
  const next = withCellLine(draft, {section:'summary', key:'가 영역›가-1 과제', act:'take', index:0, text:'- 가상 교섭 3차(마무리)', item});
  assert.deepEqual(flowCells(next, 'summary')[0].lines, ['- 가상 교섭 3차(마무리)']);
  assert.equal(next.picks.items.at(-1).kind, 'ai_line');
  assert.equal(next.picks.items.at(-1).act, 'take');
  assert.throws(() => withCellLine(next, {section:'summary', key:'가 영역›가-1 과제', act:'take', index:0, text:'- 다른 줄', item}), {code:'index'});
  assert.throws(() => withCellLine(draft, {section:'summary', key:'가 영역›가-1 과제', act:'take', index:3, text:'- 다른 줄', item}), {code:'index'});
});

test('투쟁 사업장: 구성(order)에 넣은 내 담당 조직(4번 칸 이름)은 바탕에 없어도 빈 칸으로, 남의 이름은 아님', () => {
  assert.deepEqual(siteCells(draft, null).map(c => c.key), ['B 노조']);
  const layout = {order:['B 노조', 'A 지부', '바깥 모임'], hidden:[], at:'2026-11-01T00:00:00.000Z'};
  assert.deepEqual(siteCells(draft, layout).map(c => [c.key, c.lines]), [['B 노조', ['- 가상 조정 신청']], ['A 지부', []]]);
  // 그 빈 칸에 줄을 쓰면 rows 로 남아 그다음부터는 칸 그 자체로.
  const next = withCellLine(draft, {section:'sites', key:'A 지부', act:'add', text:'- 새 사업장 소식'});
  assert.deepEqual(siteCells(next, layout).map(c => [c.key, c.lines]), [['B 노조', ['- 가상 조정 신청']], ['A 지부', ['- 새 사업장 소식']]]);
});

// WEEKLY-한흐름확정 ③: 내 사업영역은 이 주 기록이 없어도 칸이 모두 있다(바탕에 내 줄이 없던 사업영역은 빈 칸으로 뒤에).
test('요약 칸: 내 사업영역 전부 — 칸이 없는 사업영역은 빈 칸, 이름 모양(띄어쓰기·가운뎃점) 무시', async () => {
  const {summaryCells, areaCellKey} = await import('../app/weekly-flow-cells.js');
  const cells = summaryCells(draft, ['가 영역', '다 · 영역', '나영역', '다·영역']);
  assert.deepEqual(cells.map(c => [c.key, c.lines, !!c.added]), [['가 영역›가-1 과제', ['- 가상 교섭 3차'], false], ['나 영역›나-1 과제', [], false], ['다 · 영역›', [], true]]);
  assert.equal(areaCellKey('다 · 영역'), '다 · 영역›');
  // 빈 칸에 줄을 더하면 그 주 draft rows 에 남고, 다음에 그릴 때 같은 칸(더한 칸이 아니라 저장된 칸)으로 보인다.
  const next = withCellLine(draft, {section:'summary', key:areaCellKey('다 · 영역'), act:'add', text:'- 손으로 쓴 가상 줄'});
  const again = summaryCells(next, ['가 영역', '다 · 영역']);
  assert.deepEqual(again.map(c => [c.key, c.lines, !!c.added]).at(-1), ['다 · 영역›', ['- 손으로 쓴 가상 줄'], false]);
  assert.equal(again.length, 3);
});
