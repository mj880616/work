// WEEKLY-한흐름확정 ② 화면: [주간 정리] 칸 줄 = 그 주 draft 한 벌(proposed 위에 rows), 제안 = 이번 주 재료 중 칸에 아직 없는 줄. 글은 모두 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import {flowCells, flowMaterial} from '../app/weekly-flow-cells.js';
import {weekMaterial} from '../app/weekly-hwpx/draft.mjs';
import {withCellLine} from '../app/weekly-draft-store.js';

const draft = {v:1, base:null, me:'', me_from:'', date:'', rows:[], titles:[], proposed:{at:'2026-11-01T00:00:00.000Z', base:{from:'personal', document_id:'d1'}, cells:[
  {section:'summary', key:'가 영역›가-1 과제', n:0, lines:['- 가상 교섭 3차']},
  {section:'summary', key:'나 영역›나-1 과제', n:0, lines:[]},
  {section:'orgs', key:'A 지부', n:0, lines:['- 가상 소식']},
  {section:'sites', key:'B 노조', n:0, lines:['- 가상 조정 신청']},
]}};
const model = {summary:{areas:[{name:'가 영역', rows:[{task:{name:'가-1 과제'}, items:[{day:'2026-10-28', text:'가상 교섭 3차'}, {day:'2026-10-29', text:'가상 교섭 4차 일정'}]}]}], others:[]},
  orgs:{sections:[{id:'o1', name:'A 지부', items:[{day:'2026-10-30', text:'가상 결의'}]}]}};

test('칸 목록: 바탕 순서, 섹션별, 고친 칸(rows)이 바탕 위에', () => {
  assert.deepEqual(flowCells(draft, 'summary').map(c => [c.key, c.lines]), [['가 영역›가-1 과제', ['- 가상 교섭 3차']], ['나 영역›나-1 과제', []]]);
  const next = withCellLine(draft, {section:'summary', key:'나 영역›나-1 과제', act:'add', text:'- 손으로 쓴 줄'});
  assert.deepEqual(flowCells(next, 'summary')[1].lines, ['- 손으로 쓴 줄']);
  assert.deepEqual(flowCells(next, 'sites').map(c => c.key), ['B 노조']);
});

test('제안: 이름이 같은 칸에, 이미 칸에 든 글은 빼고', () => {
  const m = flowMaterial(weekMaterial, model, draft);
  const cells = flowCells(draft, 'summary');
  assert.deepEqual(m.get(cells[0].id).map(x => x.text), ['- 가상 교섭 4차 일정']);
  assert.deepEqual(m.get(cells[1].id), []);
  assert.deepEqual(m.get(flowCells(draft, 'orgs')[0].id).map(x => x.text), ['- 가상 결의']);
  // [수용]하면 그 글은 제안에서 빠진다.
  const took = withCellLine(draft, {section:'summary', key:'가 영역›가-1 과제', act:'take', text:'- 가상 교섭 4차 일정', item:{kind:'material', from:'record', cell:'summary:가 영역›가-1 과제', org:'', text:'10월 29일 가상 교섭 4차 일정'}});
  assert.deepEqual(flowMaterial(weekMaterial, model, took).get(cells[0].id), []);
});
