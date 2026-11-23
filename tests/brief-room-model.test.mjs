// BRIEF-브리핑룸 PR ②: supabase/functions/_shared/brief-room.mjs (순수 함수). 네트워크 없음, 예시 자료만.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../supabase/functions/_shared/brief-room.mjs';

// 예시 자료(실제 자료 아님): 3쪽, 쪽 나눔 \f.
const P1 = '1. 개요\n예시 기관 경영평가 편람 개정안이다. 의견 제출은 11월 28일까지 한다.';
const P2 = '2. 평가 지표\n인건비 관리의 적정성 지표 배점을 현행 5점에서 8점으로 상향하고,\n총인건비 인상률 준수 여부를 감점 요소로 반영한다.';
const P3 = '3-2. 정원 관리\n신규 인력 수요는 기존 총인건비 범위 내에서 재배치를 우선 검토한다.';
const RAW = `﻿${P1}\r\n\f${P2}\u0007\f\n${P3}\n\n\n`;

test('tidyBriefText keeps page breaks and drops control chars', () => {
  const { text, cut } = m.tidyBriefText(RAW);
  assert.equal(cut, false);
  assert.equal(text.split('\f').length, 3);
  assert.doesNotMatch(text, /[\u0007﻿\r]/);
  assert.equal(m.tidyBriefText('가'.repeat(20), 10).cut, true);
});

test('pageStarts / pageAt: 1-based pages, unknown when no breaks', () => {
  const { text } = m.tidyBriefText(RAW);
  const s = m.pageStarts(text);
  assert.equal(s.length, 3);
  assert.equal(m.pageAt(s, 0), 1);
  assert.equal(m.pageAt(s, text.indexOf('인건비 관리')), 2);
  assert.equal(m.pageAt(s, text.indexOf('신규 인력')), 3);
  assert.equal(m.pageAt([0], 5), null);
});

test('splitChunks: whole pages per chunk, long page split, covers all text', () => {
  const pages = Array.from({ length: 10 }, (_, i) => `${i + 1}쪽 내용 `.repeat(400)); // 쪽마다 약 2,800자
  const text = pages.join('\f');
  const chunks = m.splitChunks(text, 12000);
  assert.ok(chunks.length >= 2 && chunks.length <= 4, String(chunks.length));
  for (const c of chunks) assert.ok(c.end - c.start <= 12000);
  // 조각 경계는 쪽 나눔 자리
  for (const c of chunks.slice(1)) assert.equal(text[c.start - 1], '\f');
  const joined = chunks.map(c => text.slice(c.start, c.end)).join('');
  assert.equal(joined.replace(/\f/g, ''), text.replace(/\f/g, ''));
  const long = '문장입니다.\n'.repeat(5000); // 쪽 없음, 3만 자 이상
  const lc = m.splitChunks(long, 12000);
  assert.ok(lc.length >= 3);
  for (const c of lc) assert.ok(c.end - c.start <= 12000);
  assert.equal(lc.map(c => long.slice(c.start, c.end)).join(''), long);
});

test('findQuote: ignores spaces/line breaks/quote shapes, rejects paraphrase and too-short', () => {
  const { text } = m.tidyBriefText(RAW);
  const f = m.foldForMatch(text);
  assert.ok(m.findQuote(f, '“인건비 관리의 적정성 지표 배점을 현행 5점에서 8점으로 상향하고, 총인건비 인상률 준수 여부를 감점 요소로 반영한다.”') > 0);
  assert.equal(m.findQuote(f, '인건비 관리 지표 배점을 5점에서 8점으로 올린다.'), -1);
  assert.equal(m.findQuote(f, '인건비'), -1);
});

const ctxOf = () => {
  const { text } = m.tidyBriefText(RAW);
  const starts = m.pageStarts(text);
  return { text, starts, folded: m.foldForMatch(text), chunk: { start: 0, end: text.length } };
};

test('parseChunkNote: invented quote dropped, page reassigned by server, page refs outside range removed', () => {
  const ctx = { ...ctxOf(), names: ['정원 관리'] };
  const raw = JSON.stringify({
    lead: '인건비 배점이 오른다(2쪽).',
    touches: ['정원 관리 지표 신설(3쪽)', '<script>', 7],
    todos: ['의견 제출 11/28까지(1쪽)', '없는 쪽(99쪽)'],
    conflicts: ['총인건비 안에서 재배치(3쪽)'],
    quotes: [
      { text: '신규 인력 수요는 기존 총인건비 범위 내에서 재배치를 우선 검토한다.', heading: '3-2. 정원 관리', why: '충원 요구를 막는 근거', page: 50 },
      { text: '인력 충원을 전면 금지한다.', heading: '지어낸 문장', why: 'x' },
    ],
  });
  const n = m.parseChunkNote('```json\n' + raw + '\n```', ctx);
  assert.equal(n.quotes.length, 1);
  assert.equal(n.quotes[0].page, 3);
  assert.deepEqual(n.touches, ['정원 관리 지표 신설(3쪽)']);
  assert.deepEqual(n.todos, ['의견 제출 11/28까지(1쪽)', '없는 쪽']);
  assert.equal(m.parseChunkNote('그냥 글', ctx), null);
});

test('parseChunkNote: unknown pages → page null and page refs stripped', () => {
  const text = m.tidyBriefText(RAW.replace(/\f/g, '\n')).text;
  const ctx = { text, starts: m.pageStarts(text), folded: m.foldForMatch(text), chunk: { start: 0, end: text.length } };
  const n = m.parseChunkNote(JSON.stringify({ lead: '요지', todos: ['의견 제출(1쪽)'], quotes: [{ text: '신규 인력 수요는 기존 총인건비 범위 내에서 재배치를 우선 검토한다.' }] }), ctx);
  assert.equal(n.quotes[0].page, null);
  assert.deepEqual(n.todos, ['의견 제출']);
});

test('verifyBrief: quotes only by candidate id, text from candidates, AI가 고른 순서(중요한 순) 그대로', () => {
  const ctx = ctxOf();
  const note = m.parseChunkNote(JSON.stringify({ lead: 'a', quotes: [
    { text: '신규 인력 수요는 기존 총인건비 범위 내에서 재배치를 우선 검토한다.', heading: '3-2', why: '충원' },
    { text: '인건비 관리의 적정성 지표 배점을 현행 5점에서 8점으로 상향하고', heading: '2', why: '배점' },
  ] }), ctx);
  const candidates = m.quoteCandidates([note, note]);
  assert.equal(candidates.length, 2); // 같은 인용은 한 번
  const b = m.verifyBrief(JSON.stringify({
    lead: '인건비 배점이 늘고 정원 관리 지표가 생김.',
    glance: [], todos: [], orgs: [], counters: [],
    quotes: [{ id: 'q1', why: '충원 요구를 막는 근거' }, { id: 'q2' }, { id: 'q9' }, { id: 'q1' }, { text: '새로 쓴 인용' }],
  }), { candidates, pageCount: 3 });
  assert.equal(b.quotes.length, 2);
  assert.deepEqual(b.quotes.map(q => q.page), [3, 2]);
  assert.equal(b.quotes[0].why, '충원 요구를 막는 근거');
  assert.equal(b.quotes[1].text, candidates[1].text);
  assert.equal(m.verifyBrief(JSON.stringify({ lead: '' }), { candidates, pageCount: 3 }), null);
  assert.equal(m.verifyBrief(JSON.stringify({ lead: 'x'.repeat(121) }), { candidates, pageCount: 3 }), null);
});

test('chunkWithPages marks pages; inputs carry no ids', () => {
  const { text, starts } = ctxOf();
  const body = m.chunkWithPages(text, starts, { start: 0, end: text.length });
  assert.match(body, /^〔1쪽〕/);
  assert.match(body, /〔3쪽〕\n3-2/);
  const scope = m.scopeText(['예시 가지부', '<x>'], ['사업영역 A']);
  assert.equal(scope, '내가 등록한 담당 대상: 예시 가지부\n내가 등록한 프로젝트: 사업영역 A');
  assert.match(m.chunkInput({ index: 0, total: 2, title: '예시', scope, body }), /조각 1\/2/);
  assert.equal(m.stepTotal(3), 4);
});

// S68-45(명진 11/23): 최종 브리핑 v2 — 한눈에 3줄·챙길 일{기한,할 일,급함}·우리 조직 관련{이름,내용}·대응할 것{주장,반박}. AI 답은 믿지 않는 입력.
test('S68-45 verifyBrief v2: 칸 모양·길이·꼬리말·쪽 표시·담당 이름 검사', () => {
  const b = m.verifyBrief(JSON.stringify({
    lead: '인건비 배점 상향.',
    glance: ['인건비 배점 5점→8점(3쪽)', '정원 지표 신설이 논의됨', 'x'.repeat(81), '넷째 줄'],
    todos: [
      { due: '11/28', text: '의견 제출(2쪽)', urgent: true },
      { due: '', text: '내부 검토 계획이 언급됨', urgent: 'yes' },
      { due: 'x'.repeat(21), text: '기한이 너무 긺', urgent: false },
      { due: '연내', text: '<b>꺾쇠</b>', urgent: false },
      '그냥 글',
      { due: '연내', text: '지표 대응(99쪽)', urgent: false },
    ],
    orgs: [{ name: '예시 가지부', text: '정원 지표 대상' }, { name: '다른 곳', text: '무관' }, { name: '', text: '예시 가지부 인원 영향' }],
    counters: [{ claim: '총인건비 안 재배치', reply: '충원 요구 근거(3쪽)' }, { claim: '', reply: '빈 주장' }, { claim: '반박 없음', reply: '' }],
    quotes: [],
  }), { candidates: [], pageCount: 3, names: ['예시 가지부'] });
  assert.equal(b.v, 2);
  assert.deepEqual(b.glance, ['인건비 배점 5점→8점(3쪽)', '정원 지표 신설', '넷째 줄']);
  assert.deepEqual(b.todos, [
    { due: '11/28', text: '의견 제출(2쪽)', urgent: true },
    { due: '', text: '내부 검토 계획', urgent: false },
    { due: '연내', text: '지표 대응', urgent: false },
  ]);
  assert.deepEqual(b.orgs, [{ name: '예시 가지부', text: '정원 지표 대상' }, { name: '예시 가지부', text: '예시 가지부 인원 영향' }]);
  assert.deepEqual(b.counters, [{ claim: '총인건비 안 재배치', reply: '충원 요구 근거(3쪽)' }, { claim: '반박 없음', reply: '' }]);
  assert.equal(b.touches, undefined, '옛 칸은 새로 만들지 않음');
  assert.equal(b.scope, undefined);
  const none = m.verifyBrief(JSON.stringify({ lead: '요지.', orgs: [{ name: '예시', text: '아무' }] }), { candidates: [], pageCount: null, names: [] });
  assert.deepEqual(none.orgs, []);
  assert.equal(none.scope, 'none');
  assert.deepEqual(none.glance, ['요지.']);
});

test('S68-45 trimTail·matchScopeName', () => {
  assert.equal(m.trimTail('예산 축소가 논의됨.'), '예산 축소');
  assert.equal(m.trimTail('하반기 시행 예정임'), '하반기 시행 예정임', '뜻이 있는 꼬리는 남김');
  assert.equal(m.trimTail('논의됨'), '논의됨', '다 지워지면 그대로');
  assert.equal(m.matchScopeName('예시거래처', '', ['예시 거래처']), '예시 거래처');
  assert.equal(m.matchScopeName('', '예시 거래처 단가', ['예시 거래처']), '예시 거래처');
  assert.equal(m.matchScopeName('다른 곳', '무관', ['예시 거래처']), null);
  assert.equal(m.matchScopeName('예시 거래처', '', null), null);
});

test('S68-45 MERGE_INSTRUCTIONS·MERGE_SCHEMA: v2 칸과 문장 규칙', async () => {
  assert.match(m.MERGE_INSTRUCTIONS, /"glance"/);
  assert.match(m.MERGE_INSTRUCTIONS, /"counters"/);
  assert.match(m.MERGE_INSTRUCTIONS, /꼬리말을 붙이지 않는다/);
  assert.match(m.CHUNK_INSTRUCTIONS, /꼬리말을 붙이지 않는다/);
  const r = await import('../supabase/functions/document-actions/brief-run.mjs');
  assert.deepEqual(r.MERGE_SCHEMA.required, ['lead', 'glance', 'todos', 'orgs', 'counters', 'quotes']);
  assert.deepEqual(r.MERGE_SCHEMA.properties.todos.items.required, ['due', 'text', 'urgent']);
  assert.equal(r.MERGE_SCHEMA.properties.todos.items.properties.urgent.type, 'boolean');
  assert.deepEqual(r.MERGE_SCHEMA.properties.orgs.items.required, ['name', 'text']);
  assert.deepEqual(r.MERGE_SCHEMA.properties.counters.items.required, ['claim', 'reply']);
  assert.deepEqual(r.CHUNK_SCHEMA.required, ['lead', 'touches', 'todos', 'conflicts', 'quotes'], '조각 메모는 그대로(진행 중 작업 호환)');
});
