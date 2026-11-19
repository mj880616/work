import test from 'node:test';
import assert from 'node:assert/strict';
import {fullText, orgNewsOn, projectRecordsOn, BODY_KEEP} from '../app/journal-data.js';
import {weekMaterial} from '../app/weekly-hwpx/draft.mjs';
import {pickMaterial, draftRequest, sendBody, MATERIAL_CHARS, HEAD_CHARS, CUT_MARK, BODY_GONE} from '../app/weekly-draft-request.mjs';
import {cellIdOf} from '../app/weekly-feedback.mjs';

// WEEKLY-재료전체 ① (S67-07): 화면 줄은 첫 줄 그대로, 주간보고 AI 초안 재료에만 기록 전체 글(본문).
// 글은 모두 지어낸 것(가상 조직·가상 사업), 개인정보·업무 내용 없음.
const DAY = '2026-11-17';
const LONG = ['가상 조직 1차 회의', '- 가상 안건 하나 합의', '- 가상 안건 둘 다음 주 다시 논의', '다음 일정: 가상 2차 회의 11.24.'].join('\n');
const orgUpdates = [
  {id: 'u1', organization_id: 'o1', organization: {name: '가 조직'}, occurred_at: '2026-11-17T01:00:00Z', raw_text: LONG, detail_text: '가상 상세 한 줄'},
  {id: 'u2', organization_id: 'o1', organization: {name: '가 조직'}, occurred_at: '2026-11-17T02:00:00Z', raw_text: '한 줄뿐인 기록'},
];

test('fullText: 모든 줄(같은 줄 한 번), 화면 줄과 같은 한 줄이면 빈 글, 상한', () => {
  assert.equal(fullText('가', '가'), '');
  assert.equal(fullText('가', '가\n나\n가', '나\n다'), '나\n다');
  assert.equal(fullText('x', '가\n나'), '가\n나');
  assert.equal(fullText('x', '**굵게**\n# 제목'), '굵게\n제목');
  const big = fullText('', 'ㄱ'.repeat(BODY_KEEP + 10));
  assert.equal([...big].length, BODY_KEEP + 1);
  assert.ok(big.endsWith('…'));
});

test('orgNewsOn: 화면 줄은 첫 줄 그대로, {body:true}일 때만 bodies', () => {
  const plain = orgNewsOn({orgUpdates}, DAY);
  assert.deepEqual(plain, [{name: '가 조직', items: ['가상 조직 1차 회의', '한 줄뿐인 기록']}]);
  const withBody = orgNewsOn({orgUpdates}, DAY, {body: true});
  assert.deepEqual(withBody[0].items, plain[0].items);
  assert.deepEqual(withBody[0].bodies, ['가상 안건 하나 합의\n가상 안건 둘 다음 주 다시 논의\n다음 일정: 가상 2차 회의 11.24.\n가상 상세 한 줄', '']);
  // 바구니 업데이트(조직 연결)도 원문 전체
  const basket = {notes: [{id: 'n1', raw_text: '가상 업데이트 첫 줄\n가상 업데이트 둘째 줄', occurred_at: '2026-11-17T03:00:00Z'}],
    links: [{id: 'L1', note_id: 'n1', status: 'confirmed', organization_id: 'o1', organization: {name: '가 조직'}, summary: '가상 요약'}], docs: []};
  const b = orgNewsOn({basket}, DAY, {body: true});
  assert.deepEqual(b[0].items, ['가상 요약']);
  assert.deepEqual(b[0].bodies, ['가상 업데이트 첫 줄\n가상 업데이트 둘째 줄'], '화면 줄(링크 요약)과 다르면 원문 전체');
});

test('projectRecordsOn: 진행 기록 전체 글은 body 로, 한 줄 기록은 body 없음', () => {
  const projectUpdates = [{id: 'p1', project_id: 'pr', project: {name: '가 사업'}, summary: '가상 진행 첫 줄\n가상 진행 둘째 줄', effective_on: DAY},
    {id: 'p2', project_id: 'pr', project: {name: '가 사업'}, summary: '한 줄', effective_on: DAY}];
  const rows = projectRecordsOn({projectUpdates}, DAY);
  assert.deepEqual(rows.map(r => r.text), ['가상 진행 첫 줄', '한 줄']);
  assert.equal(rows[0].body, '가상 진행 둘째 줄');
  assert.ok(!('body' in rows[1]));
});

test('weekMaterial → 몸통: 재료 줄에 본문이 따라가고, 줄 글·짝짓기는 그대로', () => {
  const sections = orgNewsOn({orgUpdates}, DAY, {body: true});
  const model = {summary: {areas: [], others: [{name: '가 사업', items: [{day: DAY, text: '가상 진행 첫 줄', body: '가상 진행 첫 줄\n가상 진행 둘째 줄'}]}]},
    orgs: {sections: sections.map(s => ({name: s.name, items: s.items.map((text, i) => ({day: DAY, text, ...(s.bodies[i] ? {body: s.bodies[i]} : {})}))}))}};
  const m = weekMaterial(model, [], []);
  assert.deepEqual(m.orgUnmatched.map(l => l.text), ['- 가상 조직 1차 회의', '- 한 줄뿐인 기록']);
  assert.ok(m.orgUnmatched[0].body.includes('가상 안건 둘 다음 주 다시 논의'));
  assert.ok(!('body' in m.orgUnmatched[1]));
  assert.ok(m.unmatched[0].body.includes('둘째 줄'));
  const {request, cut} = draftRequest({start: '2026-11-16', mode: 'test', cellAt: new Map([[cellIdOf('summary', '가›나', 0), {section: 'summary', index: 0}]]), initial: new Map(),
    material: pickMaterial(m), report: '2026-11-20'});
  const sent = request.unmatched.find(l => l.includes('가상 조직 1차 회의'));
  assert.match(sent, /^가 조직: 11월 17일\(화\) \[끝남\] - 가상 조직 1차 회의\n본문:\n가상 안건 하나 합의\n/);
  assert.ok(sent.includes('다음 일정: 가상 2차 회의 11.24.'));
  assert.ok(request.unmatched.some(l => l === '가 조직: 11월 17일(화) [끝남] - 한 줄뿐인 기록'), '한 줄 기록은 본문 없이');
  assert.deepEqual(cut, {shrunk: 0, dropped: 0, lines: 0});
});

const cellAtOf = n => new Map(Array.from({length: n}, (_, i) => [cellIdOf('summary', `가상영역›과제${i}`, 0), {section: 'summary', index: i}]));

test('기록 하나 상한: 머리 줄 400자·재료 1500자, 넘친 본문은 잘림 표시', () => {
  const body = Array.from({length: 30}, (_, i) => `가상 본문 줄 ${i} ${'ㄴ'.repeat(80)}`).join('\n');
  const material = {byRow: new Map([[0, [{day: '2026-11-17', text: 'ㅁ'.repeat(500), body}]]]), byOrg: new Map(), unmatched: [], orgUnmatched: []};
  const {request} = draftRequest({start: '2026-11-16', mode: 'draft', cellAt: cellAtOf(1), initial: new Map(), material, report: '2026-11-20'});
  const [line] = request.cells[0].material, [head] = line.split('\n');
  assert.equal([...head].length, HEAD_CHARS);
  assert.ok([...line].length <= MATERIAL_CHARS);
  assert.ok(line.endsWith(CUT_MARK));
  assert.ok(line.split('\n').length <= 40);
});

test('몸통이 넘치면 긴 본문부터 줄이고(같으면 옛 기록부터), 그다음 본문 빼기, 머리 줄은 남긴다', () => {
  const big = n => Array.from({length: 12}, (_, i) => `가상 본문 ${n}-${i} ${'ㄷ'.repeat(100)}`).join('\n');
  const list = Array.from({length: 20}, (_, k) => ({day: `2026-11-${String(10 + (k % 7)).padStart(2, '0')}`, text: `가상 기록 ${k}`, body: big(k)}));
  const material = {byRow: new Map(Array.from({length: 4}, (_, i) => [i, list])), byOrg: new Map(), unmatched: [], orgUnmatched: []};
  const maxBytes = 120 * 1024;
  const {request, cut} = draftRequest({start: '2026-11-16', mode: 'draft', cellAt: cellAtOf(4), initial: new Map(), material, report: '2026-11-20', maxBytes});
  assert.ok(new TextEncoder().encode(JSON.stringify(request)).length <= maxBytes);
  assert.ok(cut.shrunk + cut.dropped > 0);
  assert.equal(cut.lines, 0, '머리 줄은 하나도 덜어 내지 않음');
  for (const c of request.cells) assert.equal(c.material.length, 20);
  assert.ok(request.cells.flatMap(c => c.material).every(l => /^11월 1\d일\(.\) \[끝남\] 가상 기록 \d+/.test(l)));
  // 아주 작은 상한: 본문을 모두 빼고 머리 줄에 '(본문 잘림)', 그래도 넘치면 전처럼 뒤에서부터 재료 줄을 덜어 냄
  const tight = draftRequest({start: '2026-11-16', mode: 'draft', cellAt: cellAtOf(4), initial: new Map(), material, report: '2026-11-20', maxBytes: 3 * 1024});
  assert.ok(new TextEncoder().encode(JSON.stringify(tight.request)).length <= 3 * 1024);
  assert.ok(tight.request.cells[0].material.length > 0);
  assert.ok(tight.request.cells.flatMap(c => c.material).every(l => !l.includes('\n') && l.endsWith(BODY_GONE.trim())));
  assert.ok(tight.cut.lines > 0);
});

test('sendBody: 제어 문자·꺾쇠 빼고 줄마다 정리, 연락처 가림', () => {
  assert.equal(sendBody('가\u0007나\n\n<다>\n연락 010-1234-5678 someone@example.com', 200), '가 나\n다\n연락 (연락처) (연락처)');
  assert.equal(sendBody('가나다라마', 0), '');
});
