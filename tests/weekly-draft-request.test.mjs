import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pickMaterial, draftRequest, sendLine, dayText, LEARN_BODY_BYTES, DRAFT_CELLS_MAX} from '../app/weekly-draft-request.mjs';
import {pickKey} from '../app/weekly-picks.mjs';
import {cellIdOf} from '../app/weekly-feedback.mjs';

// WEEKLY-자동화 ③: 재료 짝짓기·AI 초안 몸통 규칙을 화면 밖 공용 모듈로. 글은 모두 지어낸 것(가 지부·가상 과제), 개인정보·업무 내용 없음.
const RAW = {
  byRow: new Map([[0, [{day: '2026-11-10', text: '- 가상 과제 회의', src: 'record'}, {day: '2026-11-10', text: '- 가상 과제 회의', src: 'record'}, {text: '가상 요약 줄', summary: true}]]]),
  byOrg: new Map([[1, [{day: '2026-11-11', text: '가 지부 위원회', from: '가 지부'}, {orgRef: true, orgId: 'org-a', day: '2026-11-12', text: '가 지부 교섭'}]]]),
  unmatched: [{day: '2026-11-12', text: '어디에도 안 맞는 기록', from: '바구니'}],
  orgUnmatched: [],
};
const cellName = key => ({'summary:0': 'summary:가상영역›가상과제', 'orgs:1': 'orgs:가 지부'})[key] ?? key;

test('화면은 공용 모듈을 부른다(같은 규칙 두 벌 없음)', () => {
  const src = readFileSync(new URL('../app/journal-hwpx.js', import.meta.url), 'utf8');
  assert.match(src, /from '\.\/weekly-draft-request\.mjs'/);
  assert.ok(!/const sendLine = /.test(src), 'sendLine 사본 없음');
  assert.ok(!/const describeMaterial = /.test(src), 'describeMaterial 사본 없음');
  assert.ok(!/LEARN_BODY_BYTES = /.test(src), '몸통 상한 사본 없음');
});

test('제안 짝짓기: 같은 줄은 한 번, 칸 이름·출처·조직이 제안 기록 열쇠에 들어간다', () => {
  const m = pickMaterial(RAW, {cellName});
  const row = m.byRow.get(0);
  assert.equal(row.length, 2);
  assert.deepEqual(row.map(x => x.pick.from), ['record', 'ai']);
  assert.equal(row[0].pick.cell, 'summary:가상영역›가상과제');
  assert.equal(row[0].pick.text, `${dayText({day: '2026-11-10'})}가상 과제 회의`);
  const org = m.byOrg.get(1);
  assert.equal(org[0].pick.org, '가 지부');
  assert.equal(org[1].pick.kind, 'calendar');
  assert.equal(org[1].pick.cell, 'orgref:org-a');
  assert.equal(m.unmatched[0].pick.kind, 'unmatched');
  assert.equal(m.gone.size, 0);
});

test('뺀 제안은 목록에서 빠지고 gone 에 남는다', () => {
  const first = pickMaterial(RAW, {cellName}).byRow.get(0)[0].pick;
  const m = pickMaterial(RAW, {cellName, opts: {dropped: new Map([[pickKey(first), {act: 'drop'}]])}});
  assert.equal(m.byRow.get(0).length, 1);
  assert.equal(m.gone.get('summary:0').length, 1);
  assert.deepEqual(pickMaterial(null).byRow, new Map());
});

const cellAtOf = n => new Map(Array.from({length: n}, (_, i) => [cellIdOf('summary', `가상영역›과제${i}`, 0), {section: 'summary', index: i}]));

test('몸통: 칸마다 바탕 줄·재료 줄, 참고 줄은 출처를 앞에. ref → 칸 id', () => {
  const cellAt = new Map([[cellIdOf('summary', '가상영역›가상과제', 0), {section: 'summary', index: 0}], [cellIdOf('orgs', '가 지부', 0), {section: 'orgs', index: 1}]]);
  const initial = new Map([[cellIdOf('summary', '가상영역›가상과제', 0), ['- 바탕 줄 <하나>', '', '  둘  ']]]);
  const {request, refs, cells} = draftRequest({start: '2026-11-09', mode: 'draft', cellAt, initial, material: pickMaterial(RAW, {cellName}), report: '2026-11-16'});
  assert.equal(cells, 2);
  assert.equal(request.kind, 'weekly_draft');
  assert.equal(request.week_start, '2026-11-09');
  assert.deepEqual(request.cells[0].lines, ['- 바탕 줄 하나', '둘']);
  assert.equal(request.cells[0].material.length, 2);
  assert.ok(request.cells[0].material[0].includes('가상 과제 회의'));
  assert.deepEqual(request.cells[1].lines, []);
  assert.equal(request.cells[1].material.length, 2);
  assert.equal(refs.get('c2'), cellIdOf('orgs', '가 지부', 0));
  assert.ok(request.unmatched[0].startsWith('바구니: '));
});

test('몸통: 칸은 80개까지, 크면 참고 줄 → 뒤 칸 재료부터 덜어 낸다(칸 글은 그대로)', () => {
  const n = DRAFT_CELLS_MAX + 5, long = '가'.repeat(390);
  const material = {byRow: new Map(Array.from({length: n}, (_, i) => [i, Array.from({length: 20}, (_, k) => ({text: `${long}${k}`}))])), byOrg: new Map(),
    unmatched: Array.from({length: 40}, (_, k) => ({text: `${long}${k}`})), orgUnmatched: []};
  const initial = new Map([...cellAtOf(n).keys()].map(id => [id, ['바탕 줄']]));
  const {request, cells} = draftRequest({start: '2026-11-09', mode: 'draft', cellAt: cellAtOf(n), initial, material, report: '2026-11-16'});
  assert.equal(cells, DRAFT_CELLS_MAX);
  assert.ok(new TextEncoder().encode(JSON.stringify(request)).length <= LEARN_BODY_BYTES);
  assert.equal(request.unmatched.length, 0);
  assert.equal(request.cells[0].material.length, 20);
  assert.equal(request.cells.at(-1).material.length, 0);
  assert.ok(request.cells.every(c => c.lines[0] === '바탕 줄'));
});

test('보내는 줄: 제어 글자·꺾쇠 빼고 공백 하나로, 길이 자름', () => {
  assert.equal(sendLine('가\u0000나 <b>  다​', 100), '가 나 b 다');
  assert.equal(sendLine('가'.repeat(10), 3), '가가가');
  assert.equal(sendLine(null, 5), '');
});
