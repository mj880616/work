import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dayLabel, cleanBody, sortRows, splitRows, weeklyLines, moveRow, orderChanges, insertRow, refillPlan, siteLinesFromTable, SHOWN, ROWS_MAX} from '../app/org-status-model.mjs';

// DESK-현황표: 담당조직 [현황 표]와 주간보고 '3. 2) 투쟁 사업장 현황' 그 조직 칸이 같은 판정을 쓴다.
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const R = (id, day, body, sort_order, source = 'user', evidence = []) => ({id, day, body, sort_order, source, evidence});

test('날짜 표기와 글 다듬기(DB 검사와 같은 200자·제어문자 없음)', () => {
  assert.equal(dayLabel('2026-10-29'), '10.29.(목)');
  assert.equal(dayLabel('2026-10-26'), '10.26.(월)');
  assert.equal(dayLabel('2026-02-30'), '');
  assert.equal(cleanBody('  지노위\n2차\t조정 '), '지노위 2차 조정');
  assert.equal([...cleanBody('가'.repeat(250))].length, 200);
});

test('순서: sort_order 먼저, 같으면 최신 날짜 먼저 · 처음 4줄만 보이고 주간보고 칸도 그 4줄', () => {
  const rows = [R('a', '2026-10-01', '옛 일', 5), R('b', '2026-10-29', '지노위 2차 조정회의 — 조정 종료(쟁의권 확보)', 0), R('c', '2026-10-26', '조합원 총력 결의대회', 1),
    R('d', '2026-10-20', '교섭 결렬', 2), R('e', '2026-10-15', '쟁의 결의', 2), R('f', '2026-10-10', '조정 신청', 3)];
  assert.deepEqual(sortRows(rows).map(r => r.id), ['b', 'c', 'd', 'e', 'f', 'a']);
  const {shown, older} = splitRows(rows);
  assert.equal(shown.length, SHOWN);assert.deepEqual(older.map(r => r.id), ['f', 'a']);
  assert.deepEqual(weeklyLines(rows), ['- 10.29.(목) 지노위 2차 조정회의 — 조정 종료(쟁의권 확보)', '- 10.26.(월) 조합원 총력 결의대회', '- 10.20.(화) 교섭 결렬', '- 10.15.(목) 쟁의 결의']);
  assert.deepEqual(weeklyLines([]), []);
});

test('줄 옮기기·넣기는 0..n-1 순서를 다시 붙이고 바뀐 줄만 고친다', () => {
  const rows = [R('a', '2026-10-29', 'A', 0), R('b', '2026-10-26', 'B', 1), R('c', '2026-10-20', 'C', 2)];
  const moved = moveRow(rows, 'c', -1);
  assert.deepEqual(moved.map(r => r.id), ['a', 'c', 'b']);
  assert.deepEqual(orderChanges(moved, rows), [{id: 'c', sort_order: 1}, {id: 'b', sort_order: 2}]);
  assert.equal(moveRow(rows, 'a', -1), null);
  const ins = insertRow(rows, {id: null, day: '2026-10-27', body: '새 줄'});
  assert.deepEqual(ins.map(r => r.id ?? 'new'), ['a', 'new', 'b', 'c']);
});

test('다시 채우기: AI 줄만 바꾸고 명진이 넣거나 고친 줄은 그대로·같은 줄은 다시 안 넣음·날짜 자리에 끼움', () => {
  const rows = [R('u1', '2026-10-29', '지노위 2차 조정회의 — 조정 종료', 0, 'user'), R('a1', '2026-10-24', '옛 AI 줄', 1, 'ai'), R('u2', '2026-10-10', '조정 신청', 2, 'user')];
  const plan = refillPlan(rows, [
    {day: '2026-10-29', text: '지노위 2차 조정회의 — 조정 종료', evidence: ['x']},
    {day: '2026-10-26', text: '조합원 총력 결의대회', evidence: ['e1']},
    {day: '2026-10-26', text: '조합원 총력 결의대회', evidence: ['e1']},
    {day: 'bad', text: '날짜 틀림'},
    {day: '2026-10-05', text: ' - 쟁의 결의 ', evidence: 'nope'},
  ]);
  assert.deepEqual(plan.remove, ['a1']);
  assert.deepEqual(plan.add, [{day: '2026-10-26', body: '조합원 총력 결의대회', evidence: ['e1'], sort_order: 1}, {day: '2026-10-05', body: '- 쟁의 결의', evidence: [], sort_order: 3}]);
  assert.deepEqual(plan.order, [], 'user rows keep their places (0 and 2)');
  assert.deepEqual(plan.rows.map(r => r.body), ['지노위 2차 조정회의 — 조정 종료', '조합원 총력 결의대회', '조정 신청', '- 쟁의 결의']);
  const full = Array.from({length: ROWS_MAX}, (_, i) => R('u' + i, '2026-10-01', '줄' + i, i));
  assert.equal(refillPlan(full, [{day: '2026-10-29', text: '넘침'}]).add.length, 0);
});

test('주간보고 칸: 표가 있으면 [쟁의 단계 줄] + 표 줄, 없으면 null(직전 확정본 그대로)', () => {
  const stage = t => /^- 쟁의발생 결의\(/.test(t);
  const rows = [R('b', '2026-10-29', '지노위 2차 조정회의', 0)];
  assert.deepEqual(siteLinesFromTable(['- 쟁의발생 결의(10.20)', '- 지난 확정본 줄'], rows, stage), ['- 쟁의발생 결의(10.20)', '- 10.29.(목) 지노위 2차 조정회의']);
  assert.equal(siteLinesFromTable(['- 지난 확정본 줄'], [], stage), null);
});

test('화면 연결: 소탭은 view_prefs.org_tab 하나, 현황 표 자리는 org-status-table.js 하나, 주간보고는 같은 표를 읽는다', () => {
  const wd = read('app/workplace-detail.js'), st = read('app/org-status-table.js'), hw = read('app/journal-hwpx.js');
  assert.match(wd, /id="wdSubTabs"[^>]*role="tablist"/);
  assert.match(wd, /data-wd-sub="log"[^>]*>기록</);assert.match(wd, /data-wd-sub="table"[^>]*>현황 표</);
  assert.match(wd, /viewPrefs\.set\('org_tab'/);
  assert.match(wd, /paintStatusTable\(/);
  assert.match(st, /app_org_status_rows/);assert.match(st, /kind: 'org_status_rows'/);
  assert.match(st, /기록에서 다시 채우기 \(AI\)/);assert.match(st, /주간보고 투쟁 사업장 현황에 그대로 들어감/);
  assert.match(st, /type="date"/, 'date is picked on the shared calendar field');
  for (const src of [st, read('app/org-status-model.mjs')]) assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB/, 'no device storage');
  assert.match(hw, /readStatusRows\(/);assert.match(hw, /siteLinesFromTable\(/);
});
