// S52-24 WEEKLY-칸합치기·이미있음(요청함 11/07 19:03): 같은 주제는 한 칸, [넣기] 뒤 비슷한 제안 0개, [이미 있음]은 '빼기'와 따로.
// 이름·글은 모두 합성(주제 A 등). 실제 업무 이름·내용을 쓰지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {sameName, foldTargetKey, areaInKeys, lineIn} from '../app/weekly-cell-names.mjs';
import {flowCells, flowMaterial, summaryCells} from '../app/weekly-flow-cells.js';
import {weekMaterial, missingAreas, editableRows, withAreaRows} from '../app/weekly-hwpx/draft.mjs';
import {withCellLine, weekCells, placeDraft, cellId, summaryKeys, withSummaryText} from '../app/weekly-draft-store.js';
import {summaryCellKey} from '../app/weekly-summary-hand.mjs';
import {droppedOf, keptOf, learnPicks, sortPicks, hadTexts, cellKeptRates} from '../app/weekly-picks.mjs';
import {hqSuggestions} from '../app/weekly-hq-schedule.js';

const T = n => `2026-11-0${n}T00:00:00.000Z`;
// 바탕: '의제' 사업영역 아래 세부 과제 '주제/A'·'주제/B' 칸 + 예전 규칙으로 뒤에 더해진 사업영역 칸 '주제·A ›'(부호만 다름).
const base = {v:1, base:null, me:'', me_from:'', date:'', rows:[], titles:[], proposed:{at:T(1), base:{from:'personal', document_id:'d1'}, cells:[
  {section:'summary', key:'의제›주제/A', n:0, lines:['- 가상 회의 1차']},
  {section:'summary', key:'의제›주제/B', n:0, lines:[]},
  {section:'summary', key:'주제·A›', n:0, lines:[]},
  {section:'summary', key:'가 영역›가-1 과제', n:0, lines:['- 가상 교섭']},
  {section:'summary', key:'가 영역›', n:0, lines:['- 원래 같은 묶음의 빈 과제 줄']},
]}};
// 예전에 사람이 [넣기]로 아래 칸(주제·A ›)에 넣어 둔 줄(저장된 값).
const saved = {...base, rows:[{section:'summary', key:'주제·A›', n:0, lines:['- 가상 회의 2차']}]};

test('이름 맞추기: 띄어쓰기·부호만 다른 이름은 같은 이름, 세부 과제 이름도 그 주제 칸', () => {
  assert.ok(sameName('주제/A', '주제·A'));
  assert.ok(sameName('주제 · A', '주제,A'));
  assert.ok(!sameName('주제A', '주제B'));
  assert.ok(areaInKeys('주제·A', ['의제›주제/A']));
  assert.equal(foldTargetKey('주제·A›', ['의제›주제/A', '주제·A›']), '의제›주제/A');
  // 원래 같은 표 묶음(사업영역 글자가 그대로 같음)의 빈 세부 과제 줄은 접지 않는다.
  assert.equal(foldTargetKey('가 영역›', ['가 영역›가-1 과제', '가 영역›']), null);
  // 부호만 다른 사업영역 이름이면 그 사업영역의 첫 칸으로.
  assert.equal(foldTargetKey('가·영역›', ['가 영역›가-1 과제', '가·영역›']), '가 영역›가-1 과제');
  assert.equal(foldTargetKey('나/영역›', ['나·영역›나-1 과제', '나/영역›']), '나·영역›나-1 과제');
});

test('같은 주제 칸은 한 칸: 둘로 나뉘어 저장된 칸은 위 의제 칸에 묶여 보이고(저장값은 그대로), 새 빈 칸도 만들지 않는다', () => {
  const cells = summaryCells(saved, ['주제·A', '주제 / B', '가 영역']);
  assert.deepEqual(cells.map(c => [c.key, c.lines]), [
    ['의제›주제/A', ['- 가상 회의 1차', '- 가상 회의 2차']],
    ['의제›주제/B', []],
    ['가 영역›가-1 과제', ['- 가상 교섭']],
    ['가 영역›', ['- 원래 같은 묶음의 빈 과제 줄']],
  ]);
  assert.deepEqual(saved.rows, [{section:'summary', key:'주제·A›', n:0, lines:['- 가상 회의 2차']}], '저장된 값은 고쳐 쓰지 않음');
  assert.ok(!summaryKeys(saved).includes('주제·A›'));
});

test('한 칸에 넣기: 넣으면 그 주제 칸에 들어가고, 묶여 있던 칸은 그 저장에서 한 칸으로 합쳐진다', () => {
  const next = withCellLine(saved, {section:'summary', key:'의제›주제/A', act:'add', text:'- 가상 회의 3차'});
  assert.deepEqual(next.rows, [{section:'summary', key:'의제›주제/A', n:0, lines:['- 가상 회의 1차', '- 가상 회의 2차', '- 가상 회의 3차']}]);
  assert.deepEqual(flowCells(next, 'summary').map(c => c.key), ['의제›주제/A', '의제›주제/B', '가 영역›가-1 과제', '가 영역›']);
  // 묶인 줄을 빼면 다시 살아나지 않는다(합친 뒤 옛 칸이 남지 않음).
  const cut = withCellLine(next, {section:'summary', key:'의제›주제/A', act:'cut', index:1});
  assert.deepEqual(weekCells(cut).get(cellId('summary', '의제›주제/A', 0)), ['- 가상 회의 1차', '- 가상 회의 3차']);
  // 사업요약표 직접 쓰기(사업영역만 있는 줄)도 같은 주제 칸으로.
  assert.equal(summaryCellKey(['의제›주제/A'], '주제·A', ''), '의제›주제/A');
  const typed = withSummaryText(base, {area:'주제 · A', task:'', text:'가상 줄'});
  assert.deepEqual(typed.rows.map(r => r.key), ['의제›주제/A']);
});

test('한글 파일·확정본: 바탕 줄을 더하지 않고, 나뉘어 저장된 칸 줄은 같은 주제 칸에 붙는다', () => {
  const rows = [{index:0, area:'의제', task:'주제/A', lines:[]}, {index:1, area:'가 영역', task:'가-1 과제', lines:[]}];
  assert.deepEqual(missingAreas(rows, ['주제·A', '가·영역', '다 영역']), ['다 영역']);
  const ids = new Set([cellId('summary', '의제›주제/A', 0), cellId('summary', '가 영역›가-1 과제', 0)]);
  const initial = new Map([[cellId('summary', '의제›주제/A', 0), ['- 가상 회의 1차']], [cellId('summary', '가 영역›가-1 과제', 0), ['- 가상 교섭']]]);
  const placed = placeDraft(saved, ids, initial);
  assert.deepEqual(placed.cells.get(cellId('summary', '의제›주제/A', 0)), ['- 가상 회의 1차', '- 가상 회의 2차']);
  assert.deepEqual(placed.unplaced, []);
  // 묶을 칸이 없으면 전처럼 버리지 않고 따로 둔다.
  assert.equal(placeDraft({rows:[{section:'summary', key:'없는 영역›', n:0, lines:['- x']}]}, ids, initial).unplaced.length, 1);
  // 표 묶음 이름이 부호만 다르면 새 묶음이 아니라 그 묶음 아래에(가운뎃점·빗금).
  const team = {summary:[{area:['나/영역'], rows:[]}]};
  assert.equal(withAreaRows(team, ['나·영역'], '가상 이름').summary.length, 1);
  assert.equal(typeof editableRows, 'function');
});

test('제안 재료: 그 주제의 기록은 위 의제 칸으로, 넣은 뒤 부호·띄어쓰기만 다른 제안은 0개', () => {
  const model = {summary:{names:['주제·A'], areas:[{name:'주제·A', rows:[{task:null, items:[{day:'2026-11-03', text:'가상 회의 4차 결과.'}]}, {task:{name:'세부 하나'}, items:[{day:'2026-11-04', text:'가상 자료 정리'}]}]}], others:[]}, orgs:{sections:[]}};
  const m = flowMaterial(weekMaterial, model, saved), id = cellId('summary', '의제›주제/A', 0);
  assert.deepEqual(m.get(id).map(x => x.text), ['- 가상 회의 4차 결과.', '- 세부 하나: 가상 자료 정리']);
  assert.ok(![...m.keys()].includes(cellId('summary', '주제·A›', 0)));
  // 끝 점·띄어쓰기만 다른 글로 넣어도(예: AI 제안을 넣음) 그 기록 제안은 남지 않는다.
  const took = withCellLine(saved, {section:'summary', key:'의제›주제/A', act:'take', text:'- 가상 회의  4차 결과', item:{kind:'ai_line', from:'ai', cell:'summary:의제›주제/A', org:'', text:'- 가상 회의  4차 결과'}});
  assert.deepEqual(flowMaterial(weekMaterial, model, took).get(id).map(x => x.text), ['- 세부 하나: 가상 자료 정리']);
  // 넣은 줄 안에 그대로 든 제안('세부 하나: 글' 안의 '글')도 이미 있는 것.
  assert.ok(lineIn(['- 세부 하나: 가상 자료 정리.'], '가상 자료 정리'));
  assert.ok(!lineIn(['- 가상 자료'], '가상 자료 정리 결과'));
});

test('[이미 있음]: 그 제안과 비슷한 제안이 사라지고, 빼기(쓸모없음)와 따로 저장·셈', () => {
  const model = {summary:{names:[], areas:[{name:'가 영역', rows:[{task:{name:'가-1 과제'}, items:[{day:'2026-11-03', text:'가상 결의 대회'}, {day:'2026-11-04', text:'가상 결의대회.'}]}]}], others:[]}, orgs:{sections:[]}};
  const id = cellId('summary', '가 영역›가-1 과제', 0);
  const before = flowMaterial(weekMaterial, model, base).get(id);
  assert.equal(before.length, 2);
  const item = {kind:'material', from:'record', cell:'summary:가 영역›가-1 과제', org:'', text:'11/3 가상 결의 대회'};
  const had = withCellLine(base, {section:'summary', key:'가 영역›가-1 과제', act:'have', item});
  assert.equal(had.picks.items.at(-1).act, 'have');
  assert.deepEqual(weekCells(had).get(id), ['- 가상 교섭'], '칸 글은 그대로');
  assert.deepEqual(flowMaterial(weekMaterial, model, had).get(id), [], '부호·띄어쓰기만 다른 제안도 함께 빠짐');
  assert.deepEqual([...hadTexts(had.picks).keys()], ['summary:가 영역›가-1 과제']);
  // 이번 주 다시 보이지 않음(droppedOf) — 그러나 받은 것(kept)도 거절(drop) 셈도 아님.
  assert.equal(droppedOf(had.picks).get(had.picks.items.at(-1).key).act, 'have');
  assert.equal(keptOf(had.picks).size, 0);
  const sorted = sortPicks([item], x => x, {dropped:droppedOf(had.picks)});
  assert.equal(sorted.gone[0].why, 'have');
  const rows = ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'].map((week_start, n) => ({week_start, picks:{items:[{...item, key:`k${n}`, act:'have', at:T(n + 1)}]}}));
  const learn = learnPicks(rows);
  assert.equal(learn.blocks(item), false, '[이미 있음]을 여러 번 눌러도 그 종류를 안 내게 막지 않음');
  assert.deepEqual(cellKeptRates(had.picks), [], '그대로 쓴 비율의 답에 들어가지 않음');
  // 다른 동작 없이 'have' 하나만 있으면 보고서 줄이 아니라 제안 기록이다.
  assert.throws(() => withCellLine(base, {section:'summary', key:'가 영역›가-1 과제', act:'have'}));
});

test('2) 주요 일정 제안: 손으로 적은 줄·[이미 있음]으로 치운 일정과 부호만 다르면 내지 않음', () => {
  const events = [{key:'e1', label:'11.10.(화)', day:'2026-11-10', time:'10:00', title:'가상 공동집회', place:'가상 광장'}];
  const learn = learnPicks([]);
  const shown = hqSuggestions(events, [], new Map(), null, learn);
  assert.equal(shown.length, 1);
  const text = shown[0].text;
  const picks = {items:[{key:shown[0].key, kind:'calendar', from:'calendar', cell:'requests:hq', org:'', act:'have', text, at:T(1)}]};
  assert.deepEqual(hqSuggestions(events, [], new Map(), picks, learn), []);
  assert.deepEqual(hqSuggestions(events, [{id:'r1', day:'2026-11-10', time:'10:00', title:'가상 공동 집회.', place:'가상 광장'}], new Map(), null, learn), []);
});
