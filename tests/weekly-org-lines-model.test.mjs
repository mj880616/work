import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as m from '../app/weekly-org-lines-model.mjs';

// WEEKLY-메뉴짝짓기 P3: 주별 조직보고 표 판정(정렬·3줄 넘음·부실·지난주 가져오기·충돌). 자료는 모두 가짜.
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const L = (id, day, body, state = 'in', extra = {}) => ({id, day, end_day: null, body, state, sort_order: 0, ...extra});

test('주 기준(월~일)·주 표기·날짜 표기', () => {
  assert.equal(m.mondayOf('2026-11-08'), '2026-11-02'); // 일요일 → 그 주 월요일
  assert.equal(m.mondayOf('2026-11-02'), '2026-11-02');
  assert.equal(m.shiftWeek('2026-11-02', -1), '2026-10-26');
  assert.equal(m.weekLabel('2026-11-02'), '11.2~11.8');
  assert.equal(m.weekLabel('2026-12-28'), '2026.12.28~2027.1.3');
  assert.equal(m.dayText('2026-11-02'), '11.2.');
  assert.equal(m.dayText('2026-11-02', '2026-11-05'), '11.2.~11.5.');
  assert.equal(m.dayText(null), '');
  assert.equal(m.lineText(L('a', '2026-11-03', ' 가상 교섭 상견례 ')), '- 11.3. 가상 교섭 상견례');
  assert.equal(m.lineText(L('a', null, '가상 현안 설명회 준비')), '- 가상 현안 설명회 준비');
});

test('조직 칸: 날짜 오름차순(날짜 없는 줄 맨 뒤)·넣은 줄 최근 3줄 + 외 n줄·제안 줄 따로·3줄 넘음·부실', () => {
  const lines = [L('n', null, '날짜 없음'), L('d', '2026-11-05', '넷'), L('a', '2026-11-02', '하나'), L('b', '2026-11-03', '둘'), L('c', '2026-11-04', '셋'),
    L('s', '2026-11-04', '제안', 'suggested'), L('x', '2026-11-04', '뺀 줄', 'dropped')];
  const p = m.cellParts(lines);
  assert.deepEqual(p.placed.map(l => l.id), ['a', 'b', 'c', 'd', 'n']);
  assert.deepEqual(p.shown.map(l => l.id), ['c', 'd', 'n']);
  assert.deepEqual(p.older.map(l => l.id), ['a', 'b']);
  assert.deepEqual(p.suggested.map(l => l.id), ['s']);
  assert.equal(p.dropped, 1);assert.equal(p.over, true);assert.equal(p.thin, false);
  assert.deepEqual(m.reportLines(lines), ['- 11.2. 하나', '- 11.3. 둘', '- 11.4. 셋', '- 11.5. 넷', '- 날짜 없음'], '주간보고에는 넣은 줄만, 자르지 않음');
  assert.equal(m.cellParts([L('a', '2026-11-02', '하나'), L('s', null, '제안', 'suggested')]).thin, true, '넣은 줄 1줄 이하 = 부실');
  assert.equal(m.cellParts([]).thin, true);
  assert.equal(m.THIN_MAX, 1);
});

test('수기 줄 검사: 날짜 선택·끝나는 날은 시작일 뒤·글 필수', () => {
  assert.deepEqual(m.checkDraft({day: '', end_day: '', body: ' 가상 '}), {ok: true, value: {day: null, end_day: null, body: '가상'}});
  assert.deepEqual(m.checkDraft({day: '2026-11-02', end_day: '2026-11-05', body: 'a'}).value, {day: '2026-11-02', end_day: '2026-11-05', body: 'a'});
  assert.equal(m.checkDraft({day: '2026-11-05', end_day: '2026-11-02', body: 'a'}).field, 'end_day');
  assert.equal(m.checkDraft({day: '', end_day: '2026-11-02', body: 'a'}).field, 'end_day');
  assert.equal(m.checkDraft({day: '2026-13-01', body: 'a'}).field, 'day');
  assert.equal(m.checkDraft({day: '2026-11-02', body: '  '}).field, 'body');
});

test('지난주 가져오기: 이번 주(뺀 줄 포함)에 비슷한 글이 있으면 다시 넣지 않고, 40줄을 넘지 않는다', () => {
  const last = [L('a', '2026-10-27', '가상 요구안 설문 시작'), L('b', '2026-10-30', '가상 대의원 간담회')];
  const have = [L('h', '2026-11-03', '가상 대의원 간담회', 'dropped', {sort_order: 4})];
  const plan = m.importPlan(last, have);
  assert.deepEqual(plan, [{day: '2026-10-27', end_day: null, body: '가상 요구안 설문 시작', sort_order: 5}]);
  const full = Array.from({length: 40}, (_, i) => L('f' + i, null, '줄 ' + 'abcdefghij'[i % 10] + i, 'in', {sort_order: i}));
  assert.deepEqual(m.importPlan(last, full), []);
  assert.equal(m.hasRoom(full), false);assert.equal(m.LINES_MAX, 40);
});

test('충돌 판정: 다른 화면이 같은 값이면 충돌 아님, 다르면 그 글, 없어졌으면 gone', () => {
  const mine = {day: '2026-11-02', end_day: null, body: '가상 4개소', state: 'in'};
  assert.equal(m.conflictOf(mine, {...mine}), null);
  assert.deepEqual(m.conflictOf(mine, {...mine, body: '가상 3개소'}), {gone: false, body: '가상 3개소', state: 'in'});
  assert.deepEqual(m.conflictOf(mine, null), {gone: true, body: ''});
});

test('ORG-기록하나로 O-6: 옛 주별 표 부품은 읽기만(쓰기·지우기·이벤트 없음), 브라우저 저장소 없음', () => {
  const wl = read('app/weekly-org-lines.js');
  assert.match(wl, /export async function readWeekLines/);
  assert.doesNotMatch(wl, /method: '(POST|PATCH|DELETE)'|createWeekLines|weekTableHtml|kptu:weekly-org-lines-changed/);
  for (const f of ['app/weekly-org-lines.js', 'app/week-pick.js', 'app/weekly-org-lines-model.mjs']) assert.doesNotMatch(read(f), /\?v=|\b(?:local|session)Storage\b/);
});

test('S50-25 ⑨ sourceRecord: 담당조직 기록 먼저, 그다음 업데이트·노트, 현황 표 줄만이면 빈 값, 출처 없으면 null', async () => {
  const {sourceRecord} = await import('../app/weekly-org-lines-model.mjs');
  const A = '0f0e0d0c-0b0a-4908-8706-050403020100', B = '1f0e0d0c-0b0a-4908-8706-050403020100';
  assert.equal(sourceRecord({source_update_ids: [A], source_note_ids: [B]}), `up:${A}`);
  assert.equal(sourceRecord({source_update_ids: [], source_note_ids: [B]}), `note:${B}`);
  assert.equal(sourceRecord({source_status_ids: [A]}), '');
  assert.equal(sourceRecord({source_update_ids: [1, ''], source_note_ids: null}), null);
  assert.equal(sourceRecord({}), null);
  assert.equal(sourceRecord(null), null);
});

// S52-25 WEEKLY-조직현황폰: 주간 정리 흐린 제안 줄 — 넣은 줄과 같은(부호만 다른 것 포함) 글은 다시 나오지 않는다.
test('weekSuggestions: 제안 행 + (넣은 줄 1줄 이하면) 지난주·현황 표 줄, 같은 글 두 번 없음', async () => {
  const {weekSuggestions, SUG_SHOWN} = await import('../app/weekly-org-lines-model.mjs');
  const L = (id, body, state = 'in', day = null) => ({id, body, state, day, end_day: null, sort_order: 0});
  const got = weekSuggestions([L('a', '가상 보도자료 배포는 5일로 순연'), L('b', '가상 AI 제안 줄', 'suggested'), L('c', '가상 보도자료 배포는 5일로 순연.', 'suggested'), L('d', '가상 뺀 줄', 'dropped')],
    [{id: 'st1', body: '- 가상 보도자료 배포는 5일로 순연'}, {id: 'st2', body: '가상 준법투쟁 돌입'}, {id: 'st3', body: '가상 뺀 줄'}, {id: 'st4', body: '가상 AI 제안 줄!'}]);
  assert.deepEqual(got.map(x => [x.kind, x.line.id]), [['line', 'b'], ['last', 'st2']]);
  // 넣은 줄이 2줄이면 지난주 줄은 제안하지 않는다(서로 다른 제안 행은 비슷해 보여도 둘 다 남는다).
  const two = weekSuggestions([L('a', '가상 하나'), L('b', '가상 둘'), L('c', '가상 제안 하나', 'suggested'), L('e', '가상 제안 둘', 'suggested')], [{id: 'st2', body: '가상 준법투쟁 돌입'}]);
  assert.deepEqual(two.map(x => x.line.id), ['c', 'e']);
  assert.equal(SUG_SHOWN, 3);
});
